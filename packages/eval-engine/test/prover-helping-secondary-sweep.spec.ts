import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Battle, Pokemon, State } from '@pkmn/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { dominates } from '../src/endgame/prover';
import { endgameChildren, type EndgameChildren } from '../src/endgame/children';
import { drawChild, totalHp } from '../src/search/outcome-children';
import { cellSeeds } from '../src/search/root-quantile';
import { helpedSources, onlyHelpsMover, splitClassKey } from '../src/endgame/prover-helping';
import { secondaryEffectId } from '../src/dice/recognize';
import { mon, RULES, standing, type Mode } from './dice-fixtures';
import { dexOfRules, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championsou');

type Entry = { chance?: number; boosts?: Record<string, number>; self?: { boosts?: Record<string, number> } };
interface Reading { effectId: string; target: Record<string, number>; self: Record<string, number> }

function boostEntries(move: DexMove): Reading[] {
  const raw = move as unknown as { secondaries?: Entry[] | null; secondary?: Entry | null };
  const entries = raw.secondaries ?? (raw.secondary ? [raw.secondary] : []);
  return entries.filter(entry => entry.chance !== undefined && entry.chance < 100 && (entry.boosts || entry.self?.boosts))
    .map(entry => ({ effectId: secondaryEffectId(entry as never), target: entry.boosts ?? {}, self: entry.self?.boosts ?? {} }));
}

const helpsByDex = (entry: Reading): boolean =>
  !('spe' in entry.target) && !('spe' in entry.self) && Object.values(entry.target).every(by => by < 0) && Object.values(entry.self).every(by => by > 0);

const clicks = (mode: Mode, move: DexMove): { p1: string; p2: string } =>
  mode === 'singles'
    ? { p1: `move ${move.id}`, p2: 'move splash' }
    : { p1: `move ${move.id}${['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : ''}, move splash`, p2: 'move splash, move splash' };

interface Cell { battle: Battle; cell: EndgameChildren; order: string }

function drawCell(battle: Battle, mode: Mode, move: DexMove): Cell {
  const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
  const choice = clicks(mode, move);
  const cell = endgameChildren(root, choice.p1, choice.p2, 6);
  return { battle, cell, order: 'p1' };
}

const bodies = (battle: Battle) => battle.sides.flatMap(side => side.pokemon);
const stagesOf = (battle: Battle, side: 0 | 1): Record<string, number> => ({ ...battle.sides[side].active[0]!.boosts });

function classesOf(cell: EndgameChildren) {
  const find = (key: string) => cell.children.findIndex(child => child.key === key);
  const plain = find('p1:hit-nokill');
  const fired = cell.children.map((child, index) => ({ child, index })).filter(({ child }) => child.key?.startsWith('p1:hit-nokill+'));
  return { plain, fired };
}

function expectedStages(from: Record<string, number>, change: Record<string, number>): Record<string, number> {
  const next = { ...from };
  for (const [stat, by] of Object.entries(change)) next[stat] = Math.max(-6, Math.min(6, (next[stat] ?? 0) + by));
  return next;
}

function sameButStages(unfired: Battle, fired: Battle): boolean {
  const drop = new Set(['hp', 'lastDamage', 'hurtThisTurn', 'damage', 'damageValue', 'totalDamage', 'boosts', 'log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine', 'hints', 'effectOrder', 'quickClawRoll', 'speed', 'speedOrder', 'moveHitData']);
  const strip = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle), (key, value: unknown) => (drop.has(key) ? undefined : value));
  return strip(unfired) === strip(fired);
}

const pricesBoundary = (generation: number): boolean => generation >= 3;

const VGC_WITNESSES = ['focusblast', 'shadowball', 'psychic', 'crunch', 'ancientpower', 'chargebeam', 'fierydance', 'flamethrower'];

describe.each(SWEEP_CASES)('$name: the fired class against the unfired class', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => boostEntries(move).length > 0, mode === 'singles');
  const witnesses = VGC_WITNESSES.map(id => dex.moves.get(id)).filter(move => move.exists && boostEntries(move).length > 0 && !moves.includes(move));
  const played = [...moves, ...witnesses];
  const board = (move: DexMove, extra: { user?: Partial<ReturnType<typeof set>>; foe?: Partial<ReturnType<typeof set>> } = {}) => {
    const user = { ...mon(rules, { species: 'Snorlax', moves: [move.id], gender: 'M' }), ...extra.user };
    const foe = { ...mon(rules, { species: 'Vaporeon', moves: ['splash'] }), ...extra.foe };
    if (mode === 'singles') return battleOf(rules.singles, [user], [foe]);
    return battleOf(rules.doubles!, [user, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
  };

  if (mode === 'doubles') test('doubles: a cell draws no class, so no source is ever named', () => {
    expect(played.length).toBeGreaterThan(0);
    for (const move of played) {
      const { cell } = drawCell(board(move), mode, move);
      expect(`${move.id} ${cell.plain} ${cell.children.some(child => child.key !== undefined)}`).toBe(`${move.id} true false`);
      expect(helpedSources(cell, 'p1').every(source => source < 0)).toBe(true);
    }
  });

  if (mode === 'singles') test('every move: the fired classes read as the Dex says, and a source is named exactly then', () => {
    let witnessed = 0;
    for (const move of played) {
      const entries = boostEntries(move);
      const { battle, cell } = drawCell(board(move), mode, move);
      if (cell.plain) continue;
      const before = bodies(battle).length;
      const { plain, fired } = classesOf(cell);
      if (plain < 0) continue;
      const sources = helpedSources(cell, 'p1');
      for (const { child, index } of fired) {
        const tokens = splitClassKey(child.key!)!.outcomes[0].split('+').slice(1);
        const named = entries.filter(entry => tokens.some(token => entry.effectId === token || entry.effectId.startsWith(`${token}+`) || token.startsWith(entry.effectId)));
        if (named.length === 0) continue;
        const unfired = positionBattle(cell.children[plain].position);
        const firedBattle = positionBattle(child.position);
        const want = (side: 0 | 1, pick: (entry: Reading) => Record<string, number>) => expectedStages(stagesOf(unfired, side), Object.assign({}, ...named.map(pick)));
        expect(`${move.id} ${child.key} user ${JSON.stringify(stagesOf(firedBattle, 0))}`).toBe(`${move.id} ${child.key} user ${JSON.stringify(want(0, entry => entry.self))}`);
        expect(`${move.id} ${child.key} foe ${JSON.stringify(stagesOf(firedBattle, 1))}`).toBe(`${move.id} ${child.key} foe ${JSON.stringify(want(1, entry => entry.target))}`);
        expect(`${move.id} ${child.key} same ${sameButStages(unfired, firedBattle)}`).toBe(`${move.id} ${child.key} same true`);
        const helps = named.every(helpsByDex);
        const standingBefore = [standing(unfired), standing(firedBattle)];
        expect(`${move.id} ${child.key} ${onlyHelpsMover(unfired, firedBattle, 'p1')}`).toBe(`${move.id} ${child.key} ${helps}`);
        expect(`${move.id} ${child.key} ${sources[index] >= 0}`).toBe(`${move.id} ${child.key} ${helps}`);
        expect([standing(unfired), standing(firedBattle)]).toEqual(standingBefore);
        witnessed += 1;
      }
      expect(bodies(battle).length).toBe(before);
    }
    expect(witnessed > 0).toBe(pricesBoundary(rules.generation));
  });

  if (mode === 'singles') test('every move, the crit forced both ways in each class: the reading follows the Dex', () => {
    let witnessed = 0;
    let crits = 0;
    const skipped: string[] = [];
    for (const move of played) {
      const entries = boostEntries(move);
      const raw = move as unknown as { secondaries?: Entry[] | null; secondary?: Entry | null };
      const every = (raw.secondaries ?? (raw.secondary ? [raw.secondary] : [])).map(entry => secondaryEffectId(entry as never));
      const mine = new Set(entries.map(entry => entry.effectId));
      const battle = board(move);
      const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
      const choice = clicks(mode, move);
      if (endgameChildren(root, choice.p1, choice.p2, 6).plain) continue;
      const seed = cellSeeds(root, choice.p1, choice.p2)[0];
      const rootHp = totalHp(positionBattle(root));
      const child = (crit: boolean, fire: boolean) => {
        const secondary = Object.fromEntries(every.map(id => [id, fire && mine.has(id)]));
        return positionBattle(drawChild(root, rootHp, choice.p1, choice.p2, seed, { scripts: new Map([[`p1:${move.id}`, { hit: true, crit, secondary }]]) }).position);
      };
      const helps = entries.every(helpsByDex);
      for (const [unfiredCrit, firedCrit] of [[false, false], [false, true], [true, false], [true, true]] as const) {
        const unfired = child(unfiredCrit, false);
        const fired = child(firedCrit, true);
        const name = `${move.id} unfired crit ${unfiredCrit} fired crit ${firedCrit}`;
        if (bodies(unfired).some(body => body.fainted) || bodies(fired).some(body => body.fainted)) { skipped.push(name); continue; }
        if (JSON.stringify(stagesOf(fired, 0)) === JSON.stringify(stagesOf(unfired, 0)) && JSON.stringify(stagesOf(fired, 1)) === JSON.stringify(stagesOf(unfired, 1))) { skipped.push(`${name} (no effect)`); continue; }
        const standingBefore = [standing(unfired), standing(fired)];
        expect(`${name} same ${sameButStages(unfired, fired)}`).toBe(`${name} same true`);
        expect(`${name} ${onlyHelpsMover(unfired, fired, 'p1')}`).toBe(`${name} ${helps}`);
        expect([standing(unfired), standing(fired)]).toEqual(standingBefore);
        witnessed += 1;
        if (unfiredCrit !== firedCrit) crits += 1;
      }
    }
    expect(skipped.filter(name => name.endsWith('(no effect)'))).toEqual([]);
    expect(witnessed > 0).toBe(pricesBoundary(rules.generation));
    expect(crits > 0).toBe(pricesBoundary(rules.generation));
  });
});

interface Reactor { name: string; on: 'foe' | 'user'; ability?: string; item?: string; drop: boolean; gain: boolean }
const REACTORS: Reactor[] = [
  { name: 'nothing', on: 'foe', drop: true, gain: true },
  { name: 'Defiant', on: 'foe', ability: 'Defiant', drop: false, gain: true },
  { name: 'Competitive', on: 'foe', ability: 'Competitive', drop: false, gain: true },
  { name: 'Contrary', on: 'foe', ability: 'Contrary', drop: false, gain: true },
  { name: 'Mirror Armor', on: 'foe', ability: 'Mirror Armor', drop: false, gain: true },
  { name: 'Clear Body', on: 'foe', ability: 'Clear Body', drop: true, gain: true },
  { name: 'Simple', on: 'foe', ability: 'Simple', drop: true, gain: true },
  { name: 'Opportunist', on: 'foe', ability: 'Opportunist', drop: true, gain: false },
  { name: 'Mirror Herb', on: 'foe', item: 'Mirror Herb', drop: true, gain: false },
  { name: 'White Herb', on: 'foe', item: 'White Herb', drop: false, gain: true },
  { name: 'Eject Pack', on: 'foe', item: 'Eject Pack', drop: false, gain: true },
  { name: 'Contrary user', on: 'user', ability: 'Contrary', drop: true, gain: false },
  { name: 'Simple user', on: 'user', ability: 'Simple', drop: true, gain: true },
];

describe.each(SWEEP_CASES.filter(({ mode }) => mode === 'singles'))('$name: the reactors answer the stage change', ({ rules }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => boostEntries(move).length > 0);
  const kinds = {
    drop: moves.find(move => boostEntries(move).every(entry => helpsByDex(entry) && Object.keys(entry.self).length === 0)),
    gain: moves.find(move => boostEntries(move).every(entry => helpsByDex(entry) && Object.keys(entry.target).length === 0)),
  };
  const exists = (reactor: Reactor): boolean => {
    const rule = reactor.ability ? dex.abilities.get(reactor.ability) : reactor.item ? dex.items.get(reactor.item) : { exists: true, isNonstandard: null };
    return rule.exists && (rule.isNonstandard === null || rule.isNonstandard === undefined) && (reactor.on === 'foe' || rules.generation >= 3);
  };

  const playRow = (reactor: Reactor, kind: 'drop' | 'gain', benchLevel?: number): void => {
    const move = kinds[kind];
    const holder = { ...(reactor.ability ? { ability: reactor.ability } : {}), ...(reactor.item ? { item: reactor.item } : {}) };
    const user = { ...mon(rules, { species: 'Snorlax', moves: [move!.id], gender: 'M' }), ...(reactor.on === 'user' ? holder : {}) };
    const foe = { ...mon(rules, { species: 'Vaporeon', moves: ['splash'] }), ...(reactor.on === 'foe' ? holder : {}) };
    // a bench behind the foe: an Eject Pack with nobody to send in stays in its holder
    const bench = { ...mon(rules, { species: 'Blissey', moves: ['splash'] }), ...(benchLevel === undefined ? {} : { level: rules.level - benchLevel }) };
    const battle = battleOf(rules.singles, [user], [foe, bench]);
    const { cell } = drawCell(battle, 'singles', move!);
    const { plain, fired } = classesOf(cell);
    if (!pricesBoundary(rules.generation)) { expect(cell.plain).toBe(true); return; }
    expect(`${reactor.name} ${move!.id} fired ${fired.length > 0 && plain >= 0}`).toBe(`${reactor.name} ${move!.id} fired true`);
    const sources = helpedSources(cell, 'p1');
    for (const { child, index } of fired) {
      const unfired = positionBattle(cell.children[plain].position);
      const firedBattle = positionBattle(child.position);
      const expected = reactor[kind];
      expect(`${reactor.name} ${move!.id} ${child.key} ${onlyHelpsMover(unfired, firedBattle, 'p1')}`).toBe(`${reactor.name} ${move!.id} ${child.key} ${expected}`);
      expect(`${reactor.name} ${move!.id} ${child.key} source ${sources[index] >= 0}`).toBe(`${reactor.name} ${move!.id} ${child.key} source ${expected}`);
      if (!expected) expect(sameButStages(unfired, firedBattle) && JSON.stringify(stagesOf(firedBattle, 1)) === JSON.stringify(stagesOf(unfired, 1)) && JSON.stringify(stagesOf(firedBattle, 0)) === JSON.stringify(stagesOf(unfired, 0))).toBe(false);
    }
  };

  for (const reactor of REACTORS) {
    for (const kind of ['drop', 'gain'] as const) {
      if (kinds[kind] && exists(reactor)) test(`${reactor.name}, a ${kind}`, () => playRow(reactor, kind));
    }
  }

  const control = REACTORS[0];
  for (const kind of ['drop', 'gain'] as const) {
    for (let level = 0; level < 8; level++) {
      if (kinds[kind]) test(`${control.name}, a ${kind}, board ${level} (seed-robust)`, () => playRow(control, kind, level));
    }
  }

  test('the rule set has a drop move to play', () => {
    expect(kinds.drop?.id).toBeDefined();
  });
});

// moveHitData records ONE hit: the simulator reads it only through getMoveHitData, with the move in progress.
describe('the simulator reads a move\'s hit data only while the move runs', () => {
  const books = { calls: 0, late: [] as string[], finished: new WeakSet<object>(), label: '' };
  const patched = { get: Pokemon.prototype.getMoveHitData, clear: Battle.prototype.clearActiveMove };
  beforeAll(() => {
    Pokemon.prototype.getMoveHitData = function (this: Pokemon, move: never) {
      books.calls += 1;
      if (books.finished.has(move)) books.late.push(`${books.label} ${(move as { id: string }).id}`);
      return patched.get.call(this, move);
    };
    Battle.prototype.clearActiveMove = function (this: Battle, failed?: boolean) {
      if (this.activeMove) books.finished.add(this.activeMove);
      return patched.clear.call(this, failed);
    };
  });
  afterAll(() => {
    Pokemon.prototype.getMoveHitData = patched.get;
    Battle.prototype.clearActiveMove = patched.clear;
  });

  test('every mention of moveHitData in the simulator and the mods is in getMoveHitData', () => {
    const require = createRequire(import.meta.url);
    const hits: string[] = [];
    for (const name of ['@pkmn/sim', '@pkmn/mods']) {
      const entry = require.resolve(name).split('\\').join('/');
      const root = entry.slice(0, entry.indexOf(`/${name}/`) + name.length + 2);
      const walk = (dir: string): void => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          const path = `${dir}/${item.name}`;
          if (item.isDirectory()) walk(path);
          else if (item.name.endsWith('.js') && readFileSync(path, 'utf8').includes('moveHitData')) hits.push(path.slice(root.length));
        }
      };
      walk(root);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter(file => !file.endsWith('sim/pokemon.js'))).toEqual([]);
  });

  describe.each(SWEEP_CASES)('$name', ({ rules, mode }) => {
    const { moves } = sweepMoves(rules, move => move.category !== 'Status' && (move.basePower > 0 || !!move.damage || !!move.ohko || !!move.damageCallback), false);
    const duel = (move: DexMove): Battle => {
      const attacker = mon(rules, { species: 'Snorlax', moves: [move.id], gender: 'M' });
      const foe = mon(rules, { species: 'Vaporeon', moves: [move.id] });
      if (mode === 'singles') return battleOf(rules.singles, [attacker], [foe]);
      return battleOf(rules.doubles!, [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
    };

    test('no handler reads a finished move\'s record over three turns of every damaging move', () => {
      const before = books.calls;
      const lateBefore = books.late.length;
      let afterAMove = 0;
      let refused = 0;
      for (const move of moves) {
        books.label = `${rules.name} ${mode} ${move.id}`;
        const battle = duel(move);
        const aim = ['normal', 'any', 'adjacentFoe'].includes(move.target) ? ' 1' : '';
        for (let turn = 0; turn < 3 && !battle.ended; turn++) {
          if (battle.lastMove) afterAMove += 1;
          try {
            if (mode === 'singles') battle.makeChoices('move 1', 'move 1');
            else battle.makeChoices(`move 1${aim}, move 1`, `move 1${aim}, move 1`);
          } catch {
            if (turn === 0) refused += 1;
            break;
          }
        }
      }
      expect(moves.length).toBeGreaterThan(0);
      expect(refused * 4).toBeLessThan(moves.length);
      expect(books.late.slice(lateBefore)).toEqual([]);
      expect(afterAMove).toBeGreaterThan(0);
      if (rules.generation >= 3) expect(books.calls - before).toBeGreaterThan(0);
    });
  });

  test('the wrapper is live: a read of a finished move\'s record is booked', () => {
    const rules = RULES.find(one => one.generation === 9)!;
    const battle = battleOf(rules.singles, [mon(rules, { species: 'Snorlax', moves: ['tackle'], gender: 'M' })], [mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
    books.label = 'live';
    const lateBefore = books.late.length;
    battle.makeChoices('move 1', 'move 1');
    expect(battle.lastMove?.id).toBe('tackle');
    battle.sides[0].active[0].getMoveHitData(battle.lastMove as never);
    expect(books.late.slice(lateBefore)).toEqual(['live tackle']);
    books.late.length = lateBefore;
  });
});

test('a class key splits at its first colon, the effect id holds its own', () => {
  expect(splitClassKey('p1:hit-nokill+boosts:spd|miss')).toEqual({ order: 'p1', outcomes: ['hit-nokill+boosts:spd', 'miss'] });
  expect(splitClassKey('none')).toBeNull();
});

test('the older rule reads a class key with a colon in its effect id: a missed foe move inherits from the drawn hit', () => {
  const events = [{ side: 'p1' }, { side: 'p2' }] as never;
  expect(dominates('p1:hit-nokill+boosts:spd|hit-nokill', 'p1:hit-nokill+boosts:spd|miss', events, 'p1')).toBe(true);
  expect(dominates('p1:hit-nokill+boosts:spd|miss', 'p1:hit-nokill+boosts:spd|hit-nokill', events, 'p1')).toBe(false);
  expect(dominates('p1:hit-nokill|hit-nokill', 'p1:hit-kill|hit-nokill', events, 'p1')).toBe(true);
  expect(dominates('p1:hit-kill|hit-nokill', 'p1:hit-nokill|hit-nokill', events, 'p1')).toBe(false);
  expect(dominates('p1:hit-nokill|hit-nokill', 'p2:hit-nokill|miss', events, 'p1')).toBe(false);
});
