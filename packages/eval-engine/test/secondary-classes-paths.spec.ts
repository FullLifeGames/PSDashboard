import { readFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { TIER_THRESHOLDS } from '../src/analysis';
import { classifyChild, foldClassWeights, planCellEvents, type CellEvent } from '../src/cell-blend';
import { isPivotMove } from '../src/pivot-moves';
import { createMatchupCache } from '../src/eval-function';
import { advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { configureSimFast, resetSimFastForTests, SIM_FAST_DEFAULT, simFastCounters } from '../src/forward/sim-fast/state';
import { loadSimMods } from '../src/forward/sim-mods';
import { mctsTreeSearch } from '../src/mcts';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor } from '../src/search';
import { drawPair } from '../src/pair/draw';
import { pairCellSample, PAIR_DRAW_BUDGET } from '../src/pair/sampler';
import { cellKey } from '../src/rank';
import { sampleCell } from '../src/search/cell-sampler';
import { leafValue, treeSeed } from '../src/search/leaf';
import { SEARCH_SEEDS } from './seed-streams';
import { classChildren } from '../src/search/outcome-children';
import { serializeLiveBattle } from '../src/serialize';
import type { CellBlend } from '../src/types';
import { clicksAccepted, dexOfRules, isCharge, isDelayed, outfitBoard, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove } from './dice-sweep-support';
import { mon, type Rules } from './dice-fixtures';
import { battleOf, fingerprint } from './power-oracle';
import { set } from './move-oracle';
import { doublesRoot, pairSet } from './pair-battles';
import { reconstruct } from './arrival-turn';
import {
  entriesOf, expectedClasses, FAST, hasChanceEntry, MIN_MASS, playedChances, rootOf, row, toleranceOf, weightProblems,
} from './secondary-classes-support';

await loadSimMods('gen9championsou');

const cache = createMatchupCache();
const SINGLES = SWEEP_CASES.filter(entry => entry.mode === 'singles');
const DOUBLES = SWEEP_CASES.filter(entry => entry.mode === 'doubles');
const joined = (problems: string[]): string => problems.join(' | ');

interface Cell { board: Battle; root: SimPosition; p1: string; p2: string; events: CellEvent[]; want: Map<string, number> }

type Foe = 'splash' | 'switch' | 'pivot';

const statusPivotOf = (rules: Rules): string => dexOfRules(rules).moves.all()
  .find(move => move.exists && move.category === 'Status' && move.gen <= dexOfRules(rules).gen && !move.isNonstandard && isPivotMove(dexOfRules(rules), move.id))!.id;

// Chansey (too weak to kill with a pivot) is slower than Pikachu and faster than Snorlax; Blissey waits on the bench.
function benchBoard(rules: Rules, attacker: string, attackerMove: string, foeMoves: string[]): Battle {
  return battleOf(rules.singles, [mon(rules, { species: attacker, moves: [attackerMove], gender: 'M' })],
    [mon(rules, { species: 'Chansey', moves: foeMoves }), mon(rules, { species: 'Blissey', moves: ['splash'] })]);
}

const everyBody = (board: Battle) => board.sides.flatMap(side => side.pokemon);

function cellOf(rules: Rules, move: DexMove, foe: Foe = 'splash'): { cell?: Cell; problem?: string } {
  const pivot = foe === 'pivot' ? statusPivotOf(rules) : 'splash';
  const board = foe === 'splash' ? sweepBoard(rules, move.id, 'singles', '1,2,3,4', false, FAST) : benchBoard(rules, FAST, move.id, [pivot]);
  const clicks = foe === 'switch' ? { p1: 'move 1', p2: 'switch 2' } : sweepClicks('singles', move.target);
  if (!clicksAccepted(board, clicks)) return {};
  const played = playedChances(board, clicks, ['p2a']).get('p2a');
  if (!played) return {};
  const [p1, p2] = [`move ${move.id}`, foe === 'switch' ? 'switch 2' : foe === 'pivot' ? `move ${pivot} > switch 2` : 'move splash'];
  const before = fingerprint(board, everyBody(board), move.id);
  const plan = planCellEvents(board, p1, p2);
  if (fingerprint(board, everyBody(board), move.id) !== before) return { problem: `${move.id}: the plan changed the live battle` };
  if (plan.kind === 'fail') return foe !== 'splash' && cellOf(rules, move).cell ? { problem: `${move.id}: no class plan against ${foe}, where Splash has one` } : {};
  if (plan.kind === 'none') return played.length > 0 ? { problem: `${move.id}: ${played.length} secondary die(s) and no class plan` } : {};
  const [event] = plan.events;
  if (plan.events.length !== 1 || event.event.killFraction > 0) return {};
  return { cell: { board, root: rootOf(board), p1, p2, events: plan.events, want: expectedClasses(event.event.accuracy, played) } };
}

const classMap = (blend: CellBlend | undefined): Map<string, number> => new Map((blend?.classes ?? []).map(cls => [cls.key, cls.weight]));

const AGAINST: Record<Foe, string> = { splash: '', switch: ', against a switch to the bench', pivot: ', against a slower status pivot pair' };

describe.each(SINGLES)('the class weights of the singles paths: $name', ({ rules, name }) => {
  const { moves } = sweepMoves(rules, move => hasChanceEntry(move) && !isDelayed(move) && !isCharge(move) && !move.multihit);
  const tolerance = toleranceOf(rules);
  function over(path: (cell: Cell) => Map<string, number> | string, foe: Foe): { problems: string[]; read: number } {
    const problems: string[] = [];
    let read = 0;
    for (const move of moves) {
      const { cell, problem } = cellOf(rules, move, foe);
      if (problem) problems.push(problem);
      if (!cell) continue;
      read++;
      const got = path(cell);
      if (typeof got === 'string') problems.push(`${move.id}: ${got}`);
      else problems.push(...weightProblems(got, cell.want, tolerance).map(text => `${move.id}: ${text}`));
    }
    return { problems, read };
  }

  // Gens 1 and 2 have no class plan: `boundaryEvent` reads no hit there (the calc has no rule set for them).
  if (rules.generation <= 2) {
    test(`${name}: no cell has a class plan, so the secondary dice stay seed-priced`, () => {
      const kinds = moves.slice(0, 12).map(move => planCellEvents(sweepBoard(rules, move.id, 'singles', '1,2,3,4', false, FAST), `move ${move.id}`, 'move splash').kind);
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds).not.toContain('events');
    });
    return;
  }

  for (const foe of ['splash', 'switch', 'pivot'] as const) {
    const where = AGAINST[foe];
    row('fold')(`${name}: the fold of the plan splits a hit as the chances do${where}`, () => {
      const { problems, read } = over(cell => foldClassWeights(cell.events, 'p1'), foe);
      expect(joined(problems)).toBe('');
      expect(read).toBeGreaterThan(0);
    });

    row('sampler')(`${name}: the matrix cell sampler blends the classes at the chances${where}`, () => {
      const { problems, read } = over(cell => {
        const sample = sampleCell(cell.root, 0, cell.p1, cell.p2, 3, cache, true);
        return sample.blend ? classMap(sample.blend) : `no blend (diagnostic ${JSON.stringify(sample.diagnostic?.missing)})`;
      }, foe);
      expect(joined(problems)).toBe('');
      expect(read).toBeGreaterThan(0);
    });

    row('children')(`${name}: the class children carry the chances, and every class is reached${where}`, () => {
      const { problems, read } = over(cell => {
        const children = classChildren(cell.root, cell.p1, cell.p2, { baseSeeds: SEARCH_SEEDS, forcedCap: 16 });
        if (!children) return 'no class path';
        const shares = new Map<string, number>();
        for (const entry of [...children.children, ...children.missing]) shares.set(entry.key.replace(/^p1:/, ''), entry.share);
        const open = children.missing.filter(entry => entry.share >= MIN_MASS);
        if (open.length > 0) return `classes never reached: ${open.map(entry => entry.key)}`;
        return shares;
      }, foe);
      expect(joined(problems)).toBe('');
      expect(read).toBeGreaterThan(0);
    });
  }
});

const ATTACK = 'flamethrower';

const hitBody = (log: readonly string[]): string => log.find(line => line.startsWith('|-damage|p2a:') && !line.includes('[from]'))!.split('|')[2];
const movesFirst = (log: readonly string[]): 'p1' | 'p2' => (log.findIndex(line => line.startsWith('|move|p2a:')) < log.findIndex(line => line.startsWith('|move|p1a:')) ? 'p2' : 'p1');

describe.each(SINGLES.filter(entry => entry.rules.generation >= 3))('a pivot pair on the other side: $name', ({ rules, name }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => isPivotMove(dex, move.id), false, true);
  const chance = (entriesOf(dex.moves.get(ATTACK))[0].chance ?? 0) / 100;
  const want = expectedClasses(1, [{ effectId: 'brn', chance }]);

  for (const [speed, attacker] of [['slower', FAST], ['faster', 'Snorlax']] as const) {
    test(`${name}: every pivot move with p2 ${speed}, the plan prices the hit on the body the simulator hits`, () => {
      const problems: string[] = [];
      for (const move of moves) {
        const board = benchBoard(rules, attacker, ATTACK, [move.id]);
        const [p1, p2] = [`move ${ATTACK}`, `move ${move.id} > switch 2`];
        const before = fingerprint(board, everyBody(board), ATTACK);
        const plan = planCellEvents(board, p1, p2);
        if (fingerprint(board, everyBody(board), ATTACK) !== before) problems.push(`${move.id}: the plan changed the live battle`);
        const root = rootOf(board);
        const { log } = advancePositionWithLog(root, p1, p2, '1,2,3,4');
        const first = movesFirst(log);
        // A pivot that carries something to the incoming body (Baton Pass, Shed Tail) is read as before.
        if (first === 'p2' && (move as { selfSwitch?: unknown }).selfSwitch !== true) {
          if (plan.kind !== 'fail') problems.push(`${move.id}: first, carrying its state to the next body, and the plan reads ${plan.kind}`);
          continue;
        }
        if (plan.kind !== 'events') {
          problems.push(`${move.id}: ${first} first, the plan reads ${plan.kind}`);
          continue;
        }
        const attack = plan.events.find(event => event.side === 'p1');
        if (!attack || attack.defenderIdent !== hitBody(log)) problems.push(`${move.id}: the plan hits ${attack?.defenderIdent}, the simulator ${hitBody(log)}`);
        if (plan.events.some(event => event.side === 'p2' && event.secondary?.length)) problems.push(`${move.id}: a secondary on the pivot user's own move`);
        problems.push(...weightProblems(foldClassWeights(plan.events, first), want, toleranceOf(rules)).map(text => `${move.id}: ${text}`));
        const sample = sampleCell(root, 0, p1, p2, 3, cache, true);
        if (!sample.blend) problems.push(`${move.id}: no blend`);
        else problems.push(...weightProblems(classMap(sample.blend), want, toleranceOf(rules)).map(text => `${move.id}: sampler ${text}`));
      }
      expect(joined(problems)).toBe('');
      expect(moves.length).toBeGreaterThan(0);
    });
  }
});

describe('a switch to a body whose own rules remove the secondary', () => {
  const { rules } = SINGLES.find(entry => entry.name === 'Gen 9 singles')!;
  const planAgainst = (extra: { ability?: string; item?: string }) => {
    const board = battleOf(rules.singles, [mon(rules, { species: FAST, moves: [ATTACK], gender: 'M' })],
      [mon(rules, { species: 'Chansey', moves: ['splash'] }), { ...mon(rules, { species: 'Blissey', moves: ['splash'] }), ...extra }]);
    const before = fingerprint(board, everyBody(board), ATTACK);
    const plan = planCellEvents(board, `move ${ATTACK}`, 'switch 2');
    expect(fingerprint(board, everyBody(board), ATTACK)).toBe(before);
    return plan;
  };

  test('a plain bench body takes the burn at its Dex chance', () => {
    const plan = planAgainst({});
    expect(plan.kind).toBe('events');
    expect((plan as { events: CellEvent[] }).events[0].secondary).toEqual([expect.objectContaining({ effectId: 'brn', chance: 0.1 })]);
  });

  test.each([{ ability: 'Shield Dust' }, { item: 'Covert Cloak' }])('%o on the bench body: the burn is no class', extra => {
    expect(planAgainst(extra).kind).toBe('none');
  });
});

const aimOf = (move: DexMove): string => (['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : '');
const tokensOf = (segment: string): string[] => segment.slice(segment.indexOf('=') + 1).split('+').slice(1);

function massOf(blend: CellBlend, eventKey: string, effect: string): number {
  return blend.classes.reduce((sum, cls) => {
    const segment = cls.key.split('|').find(part => part.startsWith(`${eventKey}=`));
    return segment && effect.split('+').every(token => tokensOf(segment).includes(token)) ? sum + cls.weight : sum;
  }, 0);
}

// The plan stops at coverage 0.95 and prices the rest on the nearest class (sampler.ts), so no effect is off by more.
const FLAT_BOUND = 0.05 + 1e-9;

describe.each(DOUBLES)('the pair plan reads the secondary dice: $name', ({ rules, name }) => {
  const { moves } = sweepMoves(rules, move => hasChanceEntry(move) && !isDelayed(move) && !isCharge(move) && !move.multihit
    && ['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent'].includes(move.target));

  row('pair')(`${name}: a cell with a secondary is a plan whose classes carry the chances`, () => {
    const problems: string[] = [];
    const seen: Record<string, number> = {};
    let read = 0;
    for (const move of moves) {
      // Four different speeds: two equal bodies on one priority are a speed tie, which the plan reads as a fallback.
      const board = outfitBoard(rules, 'doubles', { species: FAST, moves: [move.id] }, { species: 'Vaporeon' });
      const clicks = sweepClicks('doubles', move.target);
      if (!clicksAccepted(board, clicks)) continue;
      const played = playedChances(board, clicks, ['p2a']).get('p2a');
      if (!played || played.length === 0) continue;
      const cell = pairCellSample(rootOf(board), `move ${move.id}${aimOf(move)}, move splash`, 'move splash, move splash', 3, cache);
      const how = cell.kind === 'sample' ? `${cell.via} ${cell.reason}` : cell.kind;
      seen[how] = (seen[how] ?? 0) + 1;
      if (cell.kind === 'skip') continue;
      if (cell.kind === 'plain') {
        problems.push(`${move.id}: ${played.length} secondary die(s) and a plain cell`);
        continue;
      }
      if (cell.via === 'fallback') {
        if (cell.reason === 'flinch-chance' || cell.reason === 'cant:flinch') problems.push(`${move.id}: fallback ${cell.reason}`);
        continue;
      }
      read++;
      const blend = cell.sample.blend;
      if (!blend) {
        problems.push(`${move.id}: a plan with no blend`);
        continue;
      }
      const total = blend.classes.reduce((sum, cls) => sum + cls.weight, 0);
      if (Math.abs(total - 1) > 1e-6) problems.push(`${move.id}: the weights sum to ${total}`);
      const accuracy = typeof move.accuracy === 'number' ? move.accuracy / 100 : 1;
      for (const slot of ['p2a', 'p2b']) {
        for (const entry of (playedChances(board, clicks, [slot]).get(slot) ?? []).filter(candidate => candidate.chance >= 0.2)) {
          const mass = massOf(blend, `p1a:${move.id}>${slot}`, entry.effectId);
          const chance = accuracy * entry.chance;
          if (Math.abs(mass - chance) > FLAT_BOUND) problems.push(`${move.id} ${slot} ${entry.effectId}: mass ${mass.toFixed(3)}, chance ${chance.toFixed(3)}`);
        }
      }
    }
    expect(joined(problems)).toBe('');
    expect(read, `no cell was a plan: ${JSON.stringify(seen)}`).toBeGreaterThan(0);
  });
});


const feedback = (name: string): ReplayData =>
  JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

const has = (log: readonly string[], pattern: RegExp): boolean => log.some(line => pattern.test(line));

describe('scene: smogtours-gen8ou-573756 turn 8, the fifth Scald into Clefable (singles)', () => {
  type Scalder = { removeVolatile(id: string): boolean; addVolatile(id: string, source: unknown): unknown; volatiles: Record<string, unknown>; ability: string; baseAbility: string };
  async function turn8(mode: 'real' | 'infatuated' | 'clear'): Promise<{ board: Battle; root: SimPosition }> {
    const { runtime } = await reconstruct('smogtours-gen8ou-573756', 8, feedback('smogtours-gen8ou-573756'));
    const board = runtime.battleStream.battle as unknown as Battle;
    const scalder = board.sides[1].active[0] as unknown as Scalder;
    if (mode === 'infatuated') scalder.addVolatile('attract', board.sides[0].active[0]);
    if (mode === 'clear') {
      scalder.removeVolatile('attract');
      scalder.ability = scalder.baseAbility = 'noability';
    }
    return { board, root: createRootPosition(serializeLiveBattle(board)) };
  }

  test('the real position (no phantom infatuation): the Scald is no event, the cell reads none', { timeout: 120000 }, async () => {
    const { board } = await turn8('real');
    expect(board.sides[1].active[0].volatiles.attract).toBeUndefined();
    expect(planCellEvents(board, 'move softboiled', 'move scald').kind).toBe('none');
  });

  test('an infatuated Scald user fences the cell (set on purpose; a guard stays a guard)', { timeout: 120000 }, async () => {
    const { board } = await turn8('infatuated');
    expect(board.sides[1].active[0].volatiles.attract).toBeDefined();
    expect(planCellEvents(board, 'move softboiled', 'move scald').kind).toBe('fail');
  });

  row('scene-573756')('without the infatuation: Soft-Boiled against Scald is a plan, and the 30 percent burn splits the hit', { timeout: 120000 }, async () => {
    const { board, root } = await turn8('clear');
    const played = playedChances(board, { p1: 'move softboiled', p2: 'move scald' }, ['p1a']).get('p1a') ?? [];
    expect(played.map(entry => entry.effectId)).toContain('brn');
    const plan = planCellEvents(board, 'move softboiled', 'move scald');
    expect(plan.kind).toBe('events');
    const [event] = (plan as { events: CellEvent[] }).events;
    expect(event.moveId).toBe('scald');
    const want = expectedClasses(event.event.accuracy, played);
    expect(joined(weightProblems(foldClassWeights([event], 'p2'), want))).toBe('');
    const sample = sampleCell(root, 0, 'move softboiled', 'move scald', 3, cache, true);
    expect(joined(weightProblems(classMap(sample.blend), want))).toBe('');
    expect(want.get('hit-nokill+brn')).toBeCloseTo(0.3, 9);
  });
});

function board1v1(p1: { species: string; moves: string[] }, p2: { species: string; moves: string[] }): { board: Battle; root: SimPosition } {
  const board = battleOf('gen9customgame', [set(p1.species, p1.moves)], [set(p2.species, p2.moves)]);
  return { board, root: rootOf(board) };
}

function waterfallKey(log: readonly string[], withDice = false): string {
  if (has(log, /^\|cant\|p2a: [^|]*\|flinch/)) return 'hit-nokill+flinch|none';
  if (has(log, /^\|-miss\|p2a:/)) return 'hit-nokill|miss';
  return withDice && has(log, /^\|-status\|p1a: [^|]*\|par/) ? 'hit-nokill|hit-nokill+par' : 'hit-nokill|hit-nokill';
}

const WATERFALL = { p1: 'move waterfall', p2: 'move thunder' };

describe('scene: a singles cell with a flinching first mover', () => {
  // Blissey, not Pikachu: an Electric body is immune to the Thunder's paralysis, which the row reads in the log.
  const { board, root } = board1v1({ species: 'Blissey', moves: ['waterfall'] }, { species: 'Snorlax', moves: ['thunder'] });
  const plan = planCellEvents(board, WATERFALL.p1, WATERFALL.p2);
  const chance = (hit: number, thunder: number, flinch: number, par: number): Map<string, number> => new Map([
    ['hit-nokill|miss', hit * (1 - flinch) * (1 - thunder)],
    ['hit-nokill|hit-nokill', hit * (1 - flinch) * thunder * (1 - par)],
    ['hit-nokill|hit-nokill+par', hit * (1 - flinch) * thunder * par],
    ['hit-nokill+flinch|none', hit * flinch],
  ]);
  const played = playedChances(board, { p1: 'move 1', p2: 'move 1' }, ['p1a', 'p2a']);
  const flinch = played.get('p2a')?.find(entry => entry.effectId === 'flinch')?.chance ?? Number.NaN;
  const par = played.get('p1a')?.find(entry => entry.effectId === 'par')?.chance ?? Number.NaN;
  const want = chance(1, 0.7, flinch, par);

  test('the board is what the row says (Waterfall flinches, Thunder cannot kill, Blissey moves first)', () => {
    expect(flinch).toBeGreaterThan(0);
    expect(flinch).toBeLessThan(1);
    expect(par).toBeGreaterThan(0);
    expect(plan.kind).toBe('events');
    const thunder = (plan as { events: CellEvent[] }).events.find(event => event.moveId === 'thunder');
    expect(thunder).toBeDefined();
    expect(thunder!.event.killFraction).toBe(0);
  });

  row('flinch-classify')('classifyChild reads the flinch as a class: the second mover is none, the others keep their keys', () => {
    const events = (planCellEvents(board, WATERFALL.p1, WATERFALL.p2) as { events: CellEvent[] }).events ?? [];
    const seen = new Set<string>();
    for (let index = 0; index < 80; index++) {
      const { log } = advancePositionWithLog(root, WATERFALL.p1, WATERFALL.p2, `${index * 4 + 1},${index * 4 + 2},${index * 4 + 3},${index * 4 + 4}`);
      expect(classifyChild(log, events), log.join(' / ').slice(0, 300)).toBe(waterfallKey(log));
      seen.add(waterfallKey(log));
    }
    expect(seen.has('hit-nokill+flinch|none')).toBe(true);
    expect(seen.size).toBe(3);
  });

  row('scene-flinch-singles')('the fold, the sampler and the class children agree on the four classes', () => {
    expect(plan.kind).toBe('events');
    const events = (plan as { events: CellEvent[] }).events;
    expect(joined(weightProblems(foldClassWeights(events, 'p1'), want))).toBe('');
    const sample = sampleCell(root, 0, WATERFALL.p1, WATERFALL.p2, 3, cache, true);
    expect(joined(weightProblems(classMap(sample.blend), want))).toBe('');
    const children = classChildren(root, WATERFALL.p1, WATERFALL.p2, { baseSeeds: SEARCH_SEEDS, forcedCap: 16 });
    expect(children, 'the flinch cell stays on the class path').not.toBeNull();
    expect(children!.missing).toEqual([]);
    expect(joined(weightProblems(new Map(children!.children.map(child => [child.key.replace(/^p1:/, ''), child.share])), want))).toBe('');
  });

  row('scene-book')('the tree records the drawn class of the root cell with its flinch', () => {
    const settings = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };
    let flinched = 0;
    let paralysed = 0;
    for (let offset = 0; offset < 60; offset++) {
      const stats = mctsTreeSearch(root.serialized, settings, offset);
      const i = stats.p1Options.findIndex(option => option.choice === WATERFALL.p1);
      const j = stats.p2Options.findIndex(option => option.choice === WATERFALL.p2);
      const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
      const drawn = new Set<string>();
      for (let iteration = 0; iteration < 40; iteration++) {
        drawn.add(waterfallKey(advancePositionWithLog(root, WATERFALL.p1, WATERFALL.p2, treeSeed(iteration, offset)).log, true));
      }
      expect([...drawn], `offset ${offset}: the tree's class ${cell.classKey}`).toContain(cell.classKey);
      if (cell.classKey?.includes('+flinch')) flinched++;
      if (cell.classKey?.includes('+par')) paralysed++;
    }
    expect(flinched).toBeGreaterThan(0);
    // the Thunder's paralysis is a die of the recording sink, not a line the class reading of the log would show
    expect(paralysed).toBeGreaterThan(0);
  });
});

// Fire Fang (95 percent, 10 percent burn, 10 percent flinch) into a splash: five classes, the last of weight 0.0095.
const FANG = { p1: 'move firefang', p2: 'move splash' };

function fangKey(log: readonly string[]): string {
  if (has(log, /^\|-miss\|p1a:/)) return 'miss';
  const tokens = [has(log, /^\|-status\|p2a: [^|]*\|brn/) ? 'brn' : '', has(log, /^\|cant\|p2a: [^|]*\|flinch/) ? 'flinch' : ''].filter(Boolean);
  return ['hit-nokill', ...tokens].join('+');
}

function draws(run: () => unknown, root: SimPosition): number {
  const one = () => {
    const { child } = advancePositionWithLog(root, FANG.p1, FANG.p2, SEARCH_SEEDS[0]);
    leafValue(positionBattle(child), cache);
  };
  const before = simFastCounters.clones;
  one();
  const perDraw = simFastCounters.clones - before;
  const start = simFastCounters.clones;
  run();
  expect(perDraw, 'the speed layer counts the copies of a draw').toBeGreaterThan(0);
  return (simFastCounters.clones - start) / perDraw;
}

describe('fork counts: a missing secondary class costs one forced draw, never a chase with probe seeds', () => {
  // The rows count forks with the speed layer's copy counter, so they switch the layer on; under EVAL_SIM_FAST=0
  // (the CI job with the layer forced off) the counter stays at 0.
  beforeAll(() => configureSimFast(SIM_FAST_DEFAULT));
  afterAll(() => resetSimFastForTests());
  const { board, root } = board1v1({ species: 'Pikachu', moves: ['firefang'] }, { species: 'Vaporeon', moves: ['splash'] });
  const want = new Map<string, number>([...expectedClasses(0.95, [{ effectId: 'brn', chance: 0.1 }, { effectId: 'flinch', chance: 0.1 }])]);
  const priced = [...want].filter(([, weight]) => weight >= MIN_MASS).map(([key]) => key);
  const missingAfter = (count: number): number => priced.length - new Set(SEARCH_SEEDS.slice(0, count)
    .map(seed => fangKey(advancePositionWithLog(root, FANG.p1, FANG.p2, seed).log)).filter(key => priced.includes(key))).size;

  test('the cell is what the rows say: five classes, four of them above the mass floor, and the base seeds leave some missing', () => {
    expect(want.size).toBe(5);
    expect(priced.length).toBe(4);
    expect(missingAfter(3)).toBeGreaterThan(0);
    expect(board.sides[0].active[0]!.name).toBe('Pikachu');
  });

  row('forks-singles')('the matrix sampler draws its three base seeds and one forced draw per missing class', () => {
    const missing = missingAfter(3);
    let blend: CellBlend | undefined;
    const used = draws(() => { blend = sampleCell(root, 0, FANG.p1, FANG.p2, 3, cache, true).blend; }, root);
    expect(joined(weightProblems(classMap(blend), want))).toBe('');
    // One more copy for the reader's own read of the Fire Fang's dice (`secondaryChances`, once per cell).
    expect(used).toBeLessThanOrEqual(3 + missing + 1 + 0.5);
  });

  row('forks-children')('the class children draw their five base seeds and one forced draw per missing class', () => {
    const missing = missingAfter(SEARCH_SEEDS.length);
    let result: ReturnType<typeof classChildren> = null;
    const used = draws(() => { result = classChildren(root, FANG.p1, FANG.p2, { baseSeeds: SEARCH_SEEDS, forcedCap: 16 }); }, root);
    expect(result).not.toBeNull();
    expect(joined(weightProblems(new Map(result!.children.map(child => [child.key.replace(/^p1:/, ''), child.share])), want))).toBe('');
    expect(used).toBeLessThanOrEqual(SEARCH_SEEDS.length + missing + 0.5);
  });
});

describe('scene: a doubles cell with secondary dice (the pair plan)', () => {
  const eyes = () => doublesRoot(
    [pairSet('Fast', 'Aerodactyl', ['Extrasensory', 'Rock Slide', 'Protect'], { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
    [pairSet('Slow1', 'Snorlax', ['Rest', 'Protect']), pairSet('Slow2', 'Munchlax', ['Rest', 'Protect'])],
  );
  const EXTRASENSORY: [string, string] = ['move extrasensory 1, move softboiled', 'move rest, move rest'];
  const ROCKSLIDE: [string, string] = ['move rockslide, move softboiled', 'move rest, move rest'];

  row('scene-flinch-doubles')('Extrasensory (a flinch of one in ten): a plan of two classes, one forced draw', () => {
    const cell = pairCellSample(eyes(), ...EXTRASENSORY, 3, cache);
    expect(cell).toMatchObject({ kind: 'sample', via: 'plan', reason: null });
    const sample = (cell as { sample: { blend?: CellBlend } }).sample;
    expect(sample.blend).toBeDefined();
    const mass = massOf(sample.blend!, 'p1a:extrasensory>p2a', 'flinch');
    expect(mass).toBeCloseTo(0.1, 2);
    expect(sample.blend!.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
  });

  row('scene-flinch-doubles')('Rock Slide (two flinch dice of 30 percent behind two accuracy dice of 90): a plan, each target at its chance', () => {
    const cell = pairCellSample(eyes(), ...ROCKSLIDE, 3, cache);
    expect(cell).toMatchObject({ kind: 'sample', via: 'plan', reason: null });
    const blend = (cell as { sample: { blend?: CellBlend } }).sample.blend!;
    expect(blend.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    for (const target of ['p2a', 'p2b']) expect(Math.abs(massOf(blend, `p1a:rockslide>${target}`, 'flinch') - 0.9 * 0.3)).toBeLessThanOrEqual(FLAT_BOUND);
  });

  row('scene-lavaplume-doubles')('Lava Plume (Gen 7, a burn of 30 percent on three bodies): each burn at its chance, no class weight divided', () => {
    const { rules } = DOUBLES.find(entry => entry.name === 'Gen 7 doubles')!;
    const board = outfitBoard(rules, 'doubles', { species: FAST, moves: ['lavaplume'] }, { species: 'Vaporeon' });
    const cell = pairCellSample(rootOf(board), 'move lavaplume, move splash', 'move splash, move splash', 3, cache);
    expect(cell).toMatchObject({ kind: 'sample', via: 'plan', reason: null });
    const blend = (cell as { sample: { blend?: CellBlend } }).sample.blend!;
    expect(blend.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    for (const target of ['p2a', 'p2b', 'p1b']) expect(Math.abs(massOf(blend, `p1a:lavaplume>${target}`, 'brn') - 0.3)).toBeLessThanOrEqual(FLAT_BOUND);
    for (const cls of blend.classes) {
      const dexWeight = cls.key.split('|').reduce((product, segment) => product * (tokensOf(segment).includes('brn') ? 0.3 : 0.7), 1);
      expect(cls.weight - dexWeight, cls.key).toBeLessThanOrEqual(FLAT_BOUND);
      expect(cls.weight - dexWeight, cls.key).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  row('script-doubles')('a script answers the flinch die of one hit: yes cuts that target, no does not', () => {
    for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12']) {
      for (const happens of [true, false]) {
        const scripts = new Map([['p1a:extrasensory>p2a', { hit: true, crit: false, roll: 7, secondary: { flinch: happens } }]]);
        const { log } = drawPair(eyes(), ...EXTRASENSORY, seed, scripts as never, cache);
        expect(has(log, /^\|cant\|p2a: [^|]*\|flinch/), `${seed} ${happens}`).toBe(happens);
      }
    }
  });

  row('forks-pair')('the pair plan of a one-die cell draws the natural first draw and one forced draw', () => {
    const cell = pairCellSample(eyes(), ...EXTRASENSORY, 3, cache);
    expect(cell).toMatchObject({ kind: 'sample', via: 'plan' });
    expect((cell as { draws: number }).draws).toBeLessThanOrEqual(3 + 1);
    const rock = pairCellSample(eyes(), ...ROCKSLIDE, 3, cache);
    expect((rock as { draws?: number }).draws ?? 0).toBeLessThanOrEqual(PAIR_DRAW_BUDGET);
    expect(rock).toMatchObject({ kind: 'sample', via: 'plan' });
  });
});

describe('scene: draft turn 36, Freeze-Dry into Chilly Reception to Dragapult (singles)', () => {
  const t36 = JSON.parse(readFileSync(new URL('./fixtures/draft-t36.json', import.meta.url), 'utf-8')) as
    { settings: { tera: false; sleepClause: boolean; ruleset: 'standard' }; serialized: string };
  const { ruleset } = t36.settings;
  const root = createRootPosition(t36.serialized, ruleset);
  const dragapult = positionBattle(root).sides[1].pokemon.findIndex(body => body.species.name === 'Dragapult') + 1;
  const [freezeDry, chilly] = ['move freezedry', `move chillyreception > switch ${dragapult}`];

  row('scene-219')('the cell weighs the 10 percent freeze at its Dex chance, not at the one draw it drew', () => {
    const sample = sampleCell(root, 0, freezeDry, chilly, 3, cache, true);
    const frozen = sample.blend?.classes.find(cls => cls.key === 'hit-nokill+frz');
    expect(dragapult).toBeGreaterThan(0);
    expect(frozen?.weight).toBeCloseTo(0.1, 6);
  });

  row('scene-219')('the row reads no inaccuracy against the best reply of the matrix', { timeout: 120000 }, async () => {
    const settings = { depth: 1 as const, samples: 3 as const, mode: 'matrix' as const, prove: false, tera: false as const, sleepClause: t36.settings.sleepClause, ruleset };
    const rows = (await searchOrchestrated(createLocalExecutor(t36.serialized, ruleset), settings)).perSide.p2;
    const row = rows.find(entry => entry.choice === chilly)!;
    expect(row, 'the row is in the matrix').toBeDefined();
    expect(Math.max(...rows.map(entry => entry.ev)) - row.ev).toBeLessThan(TIER_THRESHOLDS.inaccuracy);
  });
});
