import { PRNG, type Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { rollsStall } from '../src/dex-facts/protect';
import { delayFacts, heldStall, readsOfBoard, readsOfEntry, stallMargin, STALL_VOLATILE } from '../src/endgame/delay-facts';
import { loadSimMods } from '../src/forward/sim-mods';
import { CHAMPIONS, mon, playClicks, RULES, seedOf, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, sweepMoves } from './dice-sweep-support';
import { liveState, turnOf } from './flip-turn-support';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championsou');

const WITH_STALL = SWEEP_CASES.filter(({ rules }) => rules.generation >= 2);

interface Setup { moves: string[]; item?: string; hp?: (maxhp: number) => number }
interface Case {
  name: string;
  p1: Setup; p2: Setup; p2b?: Setup;
  t1: [string, string]; t2: [string, string]; partner?: string;
  setup?: (battle: Battle) => void;
  ids: string[];
  differs: boolean;
}

const SPLASH: Setup = { moves: ['splash'] };
const CASES: Case[] = [
  { name: 'nothing else happens', p1: SPLASH, p2: { moves: ['protect'] }, t1: ['1', '1'], t2: ['1', '1'], ids: ['protect'], differs: false },
  { name: 'the attacker blocked by the repeat, a hit at 1 HP that Endure holds up', p1: { moves: ['tackle'] }, p2: { moves: ['endure'], hp: () => 1 }, t1: ['1*', '1'], t2: ['1*', '1'], ids: ['endure'], differs: false },
  { name: 'a heal at the end of the turn', p1: SPLASH, p2: { moves: ['protect'], item: 'leftovers', hp: max => Math.floor(max / 2) }, t1: ['1', '1'], t2: ['1', '1'], ids: ['protect', 'leftovers'], differs: true },
  { name: 'a poisoned attacker', p1: SPLASH, p2: { moves: ['protect'] }, t1: ['1', '1'], t2: ['1', '1'], ids: ['protect'], differs: true, setup: battle => void battle.sides[0].active[0].setStatus('psn') },
  { name: 'a weather that ticks', p1: SPLASH, p2: { moves: ['protect'] }, t1: ['1', '1'], t2: ['1', '1'], ids: ['protect', 'raindance'], differs: true, setup: battle => void battle.field.setWeather('raindance', battle.sides[1].active[0]) },
  { name: 'a stage the attacker raises', p1: { moves: ['swordsdance'] }, p2: { moves: ['protect'] }, t1: ['1', '1'], t2: ['1', '1'], ids: ['protect', 'swordsdance'], differs: true },
  { name: 'a contact shield that hurts the attacker', p1: { moves: ['tackle'] }, p2: { moves: ['spikyshield'] }, t1: ['1*', '1'], t2: ['1*', '1'], ids: ['spikyshield', 'tackle'], differs: true },
  { name: 'an Endure that holds a body up from full HP', p1: { moves: ['splash', 'tackle'] }, p2: { moves: ['endure'] }, t1: ['1', '1'], t2: ['2*', '1'], ids: ['endure', 'tackle'], differs: true },
];
const DOUBLES_CASES: Case[] = [
  { name: 'the protector\'s partner attacks', p1: SPLASH, p2: { moves: ['protect'] }, p2b: { moves: ['tackle'] }, t1: ['1', '1'], t2: ['1', '1'], partner: '1 1', ids: ['protect', 'tackle'], differs: true },
];

const rollable = (rules: Rules): boolean => dexOfRules(rules).moves.get('protect').exists && rules.generation >= 2;

function bodyOf(rules: Rules, species: string, setup: Setup) {
  return { ...mon(rules, { species, moves: setup.moves }), ...(setup.item ? { item: setup.item } : {}) };
}

function boardOf(rules: Rules, mode: Mode, scene: Case, seed: string): Battle {
  const one = [bodyOf(rules, 'Snorlax', scene.p1)];
  const two = [bodyOf(rules, 'Vaporeon', scene.p2)];
  if (mode === 'doubles') {
    one.push(bodyOf(rules, 'Blissey', SPLASH));
    two.push(bodyOf(rules, 'Vaporeon', scene.p2b ?? SPLASH));
  }
  const battle = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, one, two, seed);
  const maxhp = battle.sides[1].active[0].maxhp;
  battle.sides[1].active[0].hp = scene.p2.hp?.(maxhp) ?? maxhp;
  scene.setup?.(battle);
  return battle;
}

const clicksOf = (mode: Mode, scene: Case, first: [string, string]): { p1: string; p2: string } => {
  const aimed = (click: string): string => click.replace('*', mode === 'doubles' ? ' 1' : '');
  return mode === 'singles' ? { p1: `move ${aimed(first[0])}`, p2: `move ${aimed(first[1])}` }
    : { p1: `move ${aimed(first[0])}, move 1`, p2: `move ${aimed(first[1])}, move ${scene.partner ?? '1'}` };
};

function heldTurn(rules: Rules, mode: Mode, scene: Case): { parent: Battle; child: Battle } | null {
  for (let index = 0; index < 60; index++) {
    const parent = boardOf(rules, mode, scene, seedOf(index));
    const refused = (): boolean => { try { playClicks(parent, clicksOf(mode, scene, scene.t1)); return false; } catch { return true; } };
    if (refused()) return null;
    const turn = turnOf(parent, clicksOf(mode, scene, scene.t2));
    const child = turn.fork();
    try { turn.play(child); } catch { return null; }
    if (!child.ended && heldStall(parent, child, 'p2')) return { parent, child };
  }
  return null;
}

const exists = (rules: Rules, ids: string[]): boolean => ids.every(id => {
  const dex = dexOfRules(rules);
  return dex.moves.get(id).exists || dex.items.get(id).exists || dex.conditions.get(id).exists;
});

describe.each(WITH_STALL)('the stall volatile and the held repeat, $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => rollsStall(dex, move), false);
  test('Gen 1 has no stalling move, every later generation has a Protect', () => expect(moves.length).toBeGreaterThan(0));
  test.each(moves.map(move => move.id))('%s: the user carries the simulator\'s stall volatile after its first use', moveId => {
    const board = boardOf(rules, mode, { name: moveId, p1: SPLASH, p2: { moves: [moveId] }, t1: ['1', '1'], t2: ['1', '1'], ids: [moveId], differs: false }, '1,2,3,4');
    playClicks(board, clicksOf(mode, { name: '', p1: SPLASH, p2: SPLASH, t1: ['1', '1'], t2: ['1', '1'], ids: [], differs: false }, ['1', '1']));
    expect(board.sides[1].active[0].volatiles[STALL_VOLATILE], `${moveId} left no stall volatile`).toBeTruthy();
  });
});

describe('Gen 1 has no stalling move', () => {
  test('no move of the Gen 1 Dex rolls against the stall counter', () => {
    const dex = dexOfRules(RULES[0]);
    expect(dex.moves.all().filter(move => move.exists && move.gen <= 1 && rollsStall(dex, move))).toEqual([]);
  });
});

describe.each(WITH_STALL)('a repeated stall that held, $name', ({ rules, mode }) => {
  const scenes = [...CASES, ...(mode === 'doubles' ? DOUBLES_CASES : [])].filter(scene => exists(rules, scene.ids));
  test('the scenes of the sweep exist in this rule set', () => expect(scenes.length).toBeGreaterThan(1));
  test.each(scenes.map(scene => [scene.name, scene] as const))('%s', (_name, scene) => {
    const held = heldTurn(rules, mode, scene);
    expect(held, 'a seed where the repeat holds').not.toBeNull();
    const equal = delayFacts(held!.parent, 'p2') === delayFacts(held!.child, 'p2');
    expect(equal).toBe(!scene.differs);
  });

  test('a first use is no held repeat, and a repeat that failed is none either', () => {
    const scene = CASES[0];
    const first = boardOf(rules, mode, scene, seedOf(0));
    const turnOne = turnOf(first, clicksOf(mode, scene, scene.t1)).fork();
    playClicks(turnOne, clicksOf(mode, scene, scene.t1));
    expect(heldStall(first, turnOne, 'p2')).toBe(false);
    let failed = 0;
    for (let index = 0; index < 60 && failed === 0; index++) {
      const parent = boardOf(rules, mode, scene, seedOf(index));
      playClicks(parent, clicksOf(mode, scene, scene.t1));
      const turn = turnOf(parent, clicksOf(mode, scene, scene.t2));
      const child = turn.fork();
      turn.play(child);
      if (!heldStall(parent, child, 'p2')) failed += 1;
    }
    expect(failed, 'a seed where the repeat fails').toBeGreaterThan(0);
  });

  test('the questions leave the live battle as they found it', () => {
    const held = heldTurn(rules, mode, CASES[0])!;
    for (const battle of [held.parent, held.child]) {
      const before = liveState(battle);
      delayFacts(battle, 'p2');
      heldStall(held.parent, held.child, 'p2');
      stallMargin(battle, 'p1', mode === 'singles' ? 'move splash' : 'move splash, move splash');
      expect(liveState(battle)).toBe(before);
    }
  });
});

function nextTurnReads(rules: Rules, mode: Mode, moves: { id: string; target: string }[]): { bad: string[]; equalCases: number } {
  let equalCases = 0;
  const bad: string[] = [];
  for (const move of moves) {
    const scene: Case = { name: move.id, p1: { moves: [move.id] }, p2: { moves: ['protect', 'splash'] }, t1: ['1', '1'], t2: ['1', '1'], ids: ['protect'], differs: false };
    const aim = ['normal', 'any', 'adjacentFoe'].includes(move.target) ? '*' : '';
    const first: [string, string] = [`1${aim}`, '1'];
    const held = heldTurn(rules, mode, { ...scene, t1: first, t2: first });
    if (!held) continue;
    // a move that rewrites its own slot (Mimic) may leave the board before the reader is asked
    const reads = readsOfBoard(held.parent);
    const same = delayFacts(held.parent, 'p2') === delayFacts(held.child, 'p2');
    if ((reads.pp || reads.calls) && same && held.parent.sides[0].active[0].moveSlots[0].pp !== held.child.sides[0].active[0].moveSlots[0].pp) bad.push(`${move.id}: PP dropped`);
    if (!same) continue;
    equalCases += 1;
    const third = clicksOf(mode, scene, [`1${aim}`, '2']);
    const logs = [held.parent, held.child].map(board => {
      const copy = turnOf(board, third).fork();
      // `effectOrder` comes from a counter that differs between the two histories; only the order of creation is read
      copy.prng = new PRNG('5,6,7,8');
      const start = copy.log.length;
      playClicks(copy, third);
      return { log: copy.log.slice(start).filter(line => !line.startsWith('|t:|') && !line.startsWith('|turn|')).join('\n'), facts: delayFacts(copy, 'p2').replace(/"effectOrder":\d+/g, '') };
    });
    if (logs[0].log !== logs[1].log || logs[0].facts !== logs[1].facts) bad.push(`${move.id}: another turn`);
  }
  return { bad, equalCases };
}

const isFutureAttack = (move: { flags: Record<string, unknown> }): boolean => !!move.flags.futuremove;

describe.each(WITH_STALL)('equal facts, the same next turn, $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const moves = sweepMoves(rules, () => true, false).moves;
  const readers = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && Object.entries(readsOfEntry(dex, 'move', move.id)).some(([name, read]) => read && name !== 'last'));
  const sample = [...new Map([...sweepSelection(moves, 'moves'), ...readers, dex.moves.get('tackle')].filter(move => !isFutureAttack(move)).map(move => [move.id, move])).values()];

  test('the sample holds moves that read PP, the last move and the entry counters', () => expect(readers.length).toBeGreaterThan(0));

  test('every move of the sample: equal facts give equal turns, an entry that reads PP keeps it', () => {
    const { bad, equalCases } = nextTurnReads(rules, mode, sample);
    expect(bad).toEqual([]);
    expect(equalCases, 'cases with equal facts').toBeGreaterThan(0);
  });
});

// From Generation 5 a future attack notes the absolute turn it lands on (`endingTurn`), which the facts drop: the later
// generations' rows are `test.fails` until the facts carry the turn relative to the count.
describe.each(WITH_STALL)('a pending future attack, equal facts, the same next turn, $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const attacks = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && isFutureAttack(move));
  const keepsTurn = rules.generation >= 5;
  test('the Dex holds a future attack', () => expect(attacks.length).toBeGreaterThan(0));
  (keepsTurn ? test.fails : test)('the turn after a held repeat is the same where the facts are equal', () => {
    const { bad } = nextTurnReads(rules, mode, attacks);
    expect(bad).toEqual([]);
  });
});

describe.each(SWEEP_CASES.filter(({ rules }) => rollable(rules)))('the PP margin, $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const margin = (own: number, stall: number, options: { pressure?: boolean; partnerStall?: boolean; foeMoves?: string[]; choice?: string } = {}): boolean => {
    const scene: Case = { name: '', p1: { moves: ['tackle'] }, p2: { moves: options.foeMoves ?? ['protect'] }, p2b: options.partnerStall ? { moves: ['protect'] } : undefined, t1: ['1', '1'], t2: ['1', '1'], ids: [], differs: false };
    const board = boardOf(rules, mode, scene, '1,2,3,4');
    for (const body of board.sides[0].active) body!.moveSlots[0].pp = own;
    const foes = board.sides[1].active;
    const protector = foes[0]!;
    const slot = protector.moveSlots.find(candidate => rollsStall(dex, dex.moves.get(candidate.id)));
    if (slot) slot.pp = stall;
    if (options.partnerStall && foes[1]) foes[1].moveSlots[0].pp = stall;
    if (options.pressure) protector.ability = 'pressure' as never;
    return stallMargin(board, 'p1', options.choice ?? (mode === 'singles' ? 'move tackle' : 'move tackle 1, move splash'));
  };

  test('the side keeps more PP than the foe can spend: 15 against 14 holds, 14 against 14 does not', () => {
    expect(margin(15, 14)).toBe(true);
    expect(margin(14, 14)).toBe(false);
    expect(margin(40, 14)).toBe(true);
  });
  test('a foe without a stalling move leaves no chain to bound', () => expect(margin(1, 0, { foeMoves: ['splash'] })).toBe(true));
  test('a choice without a move part, and a choice the board cannot parse', () => {
    expect(margin(1, 14, { choice: mode === 'singles' ? 'switch 1' : 'switch 3, switch 4' })).toBe(true);
    expect(margin(40, 14, { choice: 'team 1' })).toBe(false);
  });
  test('a move the slot does not hold (a forced Struggle) has no PP to run out of', () => {
    expect(margin(1, 14, { choice: mode === 'singles' ? 'move struggle' : 'move struggle, move struggle' })).toBe(true);
  });
  if (mode === 'doubles') {
    test('the partner\'s stall PP adds to the chain', () => {
      expect(margin(20, 14, { partnerStall: true })).toBe(false);
      expect(margin(29, 14, { partnerStall: true })).toBe(true);
    });
  }
  if (dex.abilities.get('pressure').exists) {
    test('a foe whose ability deducts extra PP (Pressure) doubles what a turn costs', () => {
      expect(margin(20, 14, { pressure: true })).toBe(false);
      expect(margin(29, 14, { pressure: true })).toBe(true);
    });
  }
});

describe('the rule sets of the sweep are the ones the corpus plays', () => {
  test('Gens 1 to 9 and the Champions mod, and Gen 1 alone cannot hold a repeat', () => {
    expect(RULES.map(rules => rules.name)).toEqual([...Array.from({ length: 9 }, (_, index) => `Gen ${index + 1}`), CHAMPIONS.name]);
    expect(WITH_STALL.every(({ rules }) => rollable(rules))).toBe(true);
  });
});
