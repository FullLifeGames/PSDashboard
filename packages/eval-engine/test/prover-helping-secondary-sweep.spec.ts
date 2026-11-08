import { State, type Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { dominates } from '../src/endgame/prover';
import { endgameChildren, type EndgameChildren } from '../src/endgame/children';
import { helpedSources, onlyHelpsMover, splitClassKey } from '../src/endgame/prover-helping';
import { secondaryEffectId } from '../src/dice/recognize';
import { mon, standing, type Mode } from './dice-fixtures';
import { dexOfRules, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 88 (T336, #72): the prover lets the class in which a secondary effect fired take the proof of the class in which it did not,
 * when the effect only helps the side that moved (`endgame/prover-helping.ts`). The rule reads the positions the cell drew, never a name,
 * so the sweep holds it against the simulator: for every Dex move with a boost entry under 100 percent (a drop on the foe, a gain
 * for the user), in every generation and mod the corpus plays, the cell is drawn through `endgameChildren` and the fired class is
 * compared with the unfired one. Oracle: the Dex entry. The fired position must be the unfired one with exactly the entry's stages
 * added (the boost lines that landed), and the reading says "only helps the mover" exactly when no Speed stage moved (Trick Room, Gyro
 * Ball and Electro Ball turn a slower foe into a gain for it). The reactors are rows: a target with Defiant, Competitive, Contrary or
 * Mirror Armor, a White Herb or an Eject Pack answers the drop with a change the Dex entry does not carry, so the classes keep their
 * proofs; an Opportunist or a Mirror Herb copies the user's gain; a Contrary user turns its gain into a drop. Doubles: the cell fold
 * refuses a combined choice (`planCellEvents`), so a doubles cell draws no class and the rule never reaches it; the sweep holds that
 * for the same moves. Every question leaves the battles it reads standing (`standing`).
 */
await loadSimMods('gen9championsou');

type Entry = { chance?: number; boosts?: Record<string, number>; self?: { boosts?: Record<string, number> } };
interface Reading { effectId: string; target: Record<string, number>; self: Record<string, number> }

/** The entries of a move that draw a die and change boosts, as the Dex states them. */
function boostEntries(move: DexMove): Reading[] {
  const raw = move as unknown as { secondaries?: Entry[] | null; secondary?: Entry | null };
  const entries = raw.secondaries ?? (raw.secondary ? [raw.secondary] : []);
  return entries.filter(entry => entry.chance !== undefined && entry.chance < 100 && (entry.boosts || entry.self?.boosts))
    .map(entry => ({ effectId: secondaryEffectId(entry as never), target: entry.boosts ?? {}, self: entry.self?.boosts ?? {} }));
}

/** The reading of one entry the Dex gives: only helps the mover when it drops the foe, raises the user, and moves no Speed. */
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

/** The unfired child and the fired children of a cell: `p1:hit-nokill` and every class that adds effects to it. */
function classesOf(cell: EndgameChildren) {
  const find = (key: string) => cell.children.findIndex(child => child.key === key);
  const plain = find('p1:hit-nokill');
  const fired = cell.children.map((child, index) => ({ child, index })).filter(({ child }) => child.key?.startsWith('p1:hit-nokill+'));
  return { plain, fired };
}

/** The stages the fired class must show over the unfired one by the Dex: the entries that came true, clamped to the game's range. */
function expectedStages(from: Record<string, number>, change: Record<string, number>): Record<string, number> {
  const next = { ...from };
  for (const [stat, by] of Object.entries(change)) next[stat] = Math.max(-6, Math.min(6, (next[stat] ?? 0) + by));
  return next;
}

/** Whether the positions differ in nothing but the stages of the bodies and the roll's damage (the oracle's half of "only the boost lines landed"). */
function sameButStages(unfired: Battle, fired: Battle): boolean {
  const drop = new Set(['hp', 'lastDamage', 'hurtThisTurn', 'damage', 'damageValue', 'totalDamage', 'boosts', 'log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine', 'hints', 'effectOrder', 'quickClawRoll', 'speed', 'speedOrder']);
  const strip = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle), (key, value: unknown) => (drop.has(key) ? undefined : value));
  return strip(unfired) === strip(fired);
}

const VGC_WITNESSES = ['focusblast', 'shadowball', 'psychic', 'crunch', 'ancientpower', 'chargebeam', 'fierydance', 'flamethrower'];

describe.each(SWEEP_CASES)('$name: the fired class against the unfired class (round 88, T336)', ({ rules, mode }) => {
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
        // the simulator shows exactly the boost lines of the Dex entry: this foe has no ability or item that answers
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
    // Gens 1 and 2 have no kill-range model (), so no cell there draws a class and the rule never reaches them
    expect(witnessed > 0).toBe(rules.generation >= 3);
  });
});

/** A row: the foe or the user holds a rule that answers a stage change; `drop` and `gain` give the reading the Dex's rules make of a stat drop on the foe and of a stat gain for the user. */
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

describe.each(SWEEP_CASES.filter(({ mode }) => mode === 'singles'))('$name: the reactors answer the stage change (round 88, T336)', ({ rules }) => {
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

  for (const reactor of REACTORS) {
    for (const kind of ['drop', 'gain'] as const) {
      const move = kinds[kind];
      if (move && exists(reactor)) test(`${reactor.name}, a ${kind}`, () => {
        const holder = { ...(reactor.ability ? { ability: reactor.ability } : {}), ...(reactor.item ? { item: reactor.item } : {}) };
        const user = { ...mon(rules, { species: 'Snorlax', moves: [move!.id], gender: 'M' }), ...(reactor.on === 'user' ? holder : {}) };
        const foe = { ...mon(rules, { species: 'Vaporeon', moves: ['splash'] }), ...(reactor.on === 'foe' ? holder : {}) };
        // a bench behind the foe: an Eject Pack with nobody to send in stays in its holder
        const battle = battleOf(rules.singles, [user], [foe, mon(rules, { species: 'Blissey', moves: ['splash'] })]);
        const { cell } = drawCell(battle, 'singles', move!);
        const { plain, fired } = classesOf(cell);
        // Gens 1 and 2 draw no class; from Gen 3 every row must play a fired class, or it proves nothing
        if (rules.generation < 3) return expect(cell.plain).toBe(true);
        expect(`${reactor.name} ${move!.id} fired ${fired.length > 0 && plain >= 0}`).toBe(`${reactor.name} ${move!.id} fired true`);
        const sources = helpedSources(cell, 'p1');
        for (const { child, index } of fired) {
          const unfired = positionBattle(cell.children[plain].position);
          const firedBattle = positionBattle(child.position);
          const expected = reactor[kind];
          expect(`${reactor.name} ${move!.id} ${child.key} ${onlyHelpsMover(unfired, firedBattle, 'p1')}`).toBe(`${reactor.name} ${move!.id} ${child.key} ${expected}`);
          expect(`${reactor.name} ${move!.id} ${child.key} source ${sources[index] >= 0}`).toBe(`${reactor.name} ${move!.id} ${child.key} source ${expected}`);
          // a row that expects "no" must show the answer in the simulator's own position, or it proves nothing
          if (!expected) expect(sameButStages(unfired, firedBattle) && JSON.stringify(stagesOf(firedBattle, 1)) === JSON.stringify(stagesOf(unfired, 1)) && JSON.stringify(stagesOf(firedBattle, 0)) === JSON.stringify(stagesOf(unfired, 0))).toBe(false);
        }
      });
    }
  }

  test('the rule set has a drop move to play', () => {
    expect(kinds.drop?.id).toBeDefined();
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
