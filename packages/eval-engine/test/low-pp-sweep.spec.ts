import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { parseReplayLog, toId, type TurnSnapshot } from '@fulllifegames/replay-core';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { legalChoices } from '../src/forward/choices';
import { deserializeBattleExact } from '../src/forward/serialize';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { CHAMPIONS, mon, playClicks, RULES, type Mode, type Rules } from './dice-fixtures';
import { sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#106): the PP a move has left. A move at 0 PP in the game ranked first in the rebuilt battle (Revival Blessing, 1 PP, used
 * once and offered again): the rebuild spends PP by the moves it plays, and a Leppa Berry the log rules out, or a turn the rebuild played
 * differently, leaves its slot at the wrong count. The snapshot now carries the PP the log shows spent (`ppUsed`, read by @pkmn/client);
 * the snapshot correction sets each own move slot to the simulator's maximum minus that count.
 *
 * The sweep plays every Dex move with a low PP count (base PP of 8 or less: the moves that run dry within a few uses) in every rule set the
 * corpus plays (Generations 1 to 9 and the Champions mod), singles and doubles. A case plays up to three turns on a board in which the body
 * uses the move, takes the spectator log, parses it with the replay parser, and checks three things against the simulator's own slot:
 *   1. the log's count (maximum minus `ppUsed`) equals the simulator's PP after the logged uses;
 *   2. a rebuild that drifted either way (every move at full PP: the uses never happened; every move at 0: a berry it never saw) takes the
 *      simulator's PP back from the snapshot;
 *   3. the ranking (`legalChoices`) of the corrected rebuild offers exactly what the simulator offers, so no move it disables is ranked.
 * The rows after the sweep are the reported scenes: Revival Blessing, Pressure (two PP per use), a Leppa Berry restore, Spite and Eerie Spell.
 */
await loadSimMods('gen9championsou');

const LOW_PP = 8;
// Struggle is never a slot of a body: it appears when every slot is empty, and the client leaves it out of the count.
const lowPp = (move: DexMove): boolean => move.pp > 0 && move.pp <= LOW_PP && move.id !== 'struggle';

/** The log as the spectator sees it (the public half of every `|split|` pair), closed by a turn line so the parser takes the last boundary. */
function spectatorLog(battle: Battle): string {
  const out: string[] = [];
  for (let index = 0; index < battle.log.length; index++) {
    if (battle.log[index].startsWith('|split|')) { out.push(battle.log[index + 2]); index += 2; } else out.push(battle.log[index]);
  }
  if (!/^\|turn\|/.test(out[out.length - 1])) out.push(`|turn|${battle.turn + 1}`);
  return out.join('\n');
}

const AIMED_FOE = new Set(['normal', 'any', 'adjacentFoe']);
const AIMED_ALLY = new Set(['adjacentAlly', 'adjacentAllyOrSelf']);

/** A click for the body's first slot (aimed when the game type needs a target) and the matching splash of its partner. */
function clickOf(mode: Mode, slot: number, target: string, aim = ''): string {
  if (mode === 'singles') return `move ${slot}`;
  const named = aim || (AIMED_FOE.has(target) ? '1' : AIMED_ALLY.has(target) ? '-2' : '');
  return `move ${slot}${named ? ` ${named}` : ''}, move 1`;
}
const splashClick = (mode: Mode): string => (mode === 'singles' ? 'move 1' : 'move 1, move 1');

interface Board { battle: Battle; mode: Mode }

interface BoardOptions {
  rules: Rules;
  mode: Mode;
  /** The body's moves; its click slot is the index plus one. */
  moves: string[];
  item?: string;
  foe?: { species: string; moves: string[]; ability?: string };
}

function boardFor({ rules, mode, moves, item, foe }: BoardOptions): Board {
  const body: PokemonSet = { ...mon(rules, { species: 'Snorlax', moves, gender: 'M' }), ...(item ? { item } : {}) };
  const front = { ...mon(rules, { species: foe?.species ?? 'Vaporeon', moves: foe?.moves ?? ['splash'] }), ...(foe?.ability ? { ability: foe.ability } : {}) };
  const splash = (species: string) => mon(rules, { species, moves: ['splash'] });
  const battle = mode === 'singles'
    ? battleOf(rules.singles, [body], [front])
    : battleOf(rules.doubles!, [body, splash('Blissey')], [front, splash('Vaporeon')]);
  return { battle, mode };
}

/** Plays the scripted turns while the simulator takes them; returns how many it played. */
function play(board: Board, turns: { p1: string; p2: string }[]): number {
  let played = 0;
  for (const turn of turns) {
    if (board.battle.ended) break;
    const request = board.battle.sides[0].activeRequest;
    if (!request || 'wait' in request || 'forceSwitch' in request) break;
    try { playClicks(board.battle, turn); } catch { break; }
    played++;
  }
  return played;
}

const snapshotOf = (battle: Battle): TurnSnapshot => {
  const snapshots = parseReplayLog(spectatorLog(battle));
  return snapshots[snapshots.length - 1];
};

const bodyOf = (battle: Battle) => battle.sides[0].pokemon[0];

/** The simulator's slots of the body, by move id, with the maximum and the PP they hold. */
const slotsOf = (battle: Battle): Map<string, { pp: number; maxpp: number }> =>
  new Map(bodyOf(battle).baseMoveSlots.map(slot => [slot.id, { pp: slot.pp, maxpp: slot.maxpp }]));

const rebuilt = (battle: Battle): Battle => deserializeBattleExact(serializeLiveBattle(battle));

/** Drifts the named moves (all of the body's when none is named); a move the log never shows keeps the count the simulator gave it. */
function setPp(battle: Battle, pp: 'full' | 'empty', names?: string[]): void {
  const ids = names?.map(toId);
  for (const slot of [...bodyOf(battle).baseMoveSlots, ...bodyOf(battle).moveSlots]) {
    if (!ids || ids.includes(slot.id)) slot.pp = pp === 'full' ? slot.maxpp : 0;
  }
}

const offered = (battle: Battle): string[] | null => {
  if (battle.ended || !battle.sides[0].activeRequest) return null;
  return legalChoices({ serialized: serializeLiveBattle(battle) }, 'p1').map(option => option.choice).sort();
};

/** The count the snapshot gives for one move, against the simulator's slot: a message when they differ. */
function readingProblem(snapshot: TurnSnapshot, truth: Battle, moveName: string): string | null {
  const slot = slotsOf(truth).get(toId(moveName));
  if (!slot) return 'the body lost the slot';
  const spent = snapshot.p1.pokemon[0].ppUsed?.[moveName];
  if (spent === undefined) return slot.pp === slot.maxpp ? null : `the log shows no use, the slot holds ${slot.pp}/${slot.maxpp}`;
  const [least, most] = typeof spent === 'number' ? [spent, spent] : spent;
  const low = Math.max(0, slot.maxpp - most);
  const high = Math.max(0, slot.maxpp - least);
  return slot.pp >= low && slot.pp <= high ? null : `the log counts ${least}..${most} spent, the slot holds ${slot.pp}/${slot.maxpp}`;
}

/** What the correction does to a rebuild that drifted: the problems found for the body's slots and for the ranking. */
function driftProblems(truth: Battle, snapshot: TurnSnapshot, moveNames: string[]): string[] {
  const problems: string[] = [];
  const baseline = rebuilt(truth);
  correctBattleFromSnapshot(baseline, snapshot);
  const wanted = offered(baseline);
  for (const drift of ['full', 'empty'] as const) {
    const drifted = rebuilt(truth);
    setPp(drifted, drift, moveNames);
    correctBattleFromSnapshot(drifted, snapshot);
    const got = slotsOf(drifted);
    for (const name of moveNames) {
      const slot = got.get(toId(name))!;
      const want = slotsOf(truth).get(toId(name))!;
      const spent = snapshot.p1.pokemon[0].ppUsed?.[name];
      const exact = typeof spent === 'number';
      if (exact && slot.pp !== want.pp) problems.push(`${drift}: ${name} reads ${slot.pp}, the simulator ${want.pp}`);
    }
    if (JSON.stringify(offered(drifted)) !== JSON.stringify(wanted)) problems.push(`${drift}: the ranking offers ${JSON.stringify(offered(drifted))}, the simulator ${JSON.stringify(wanted)}`);
  }
  return problems;
}

/** Whether the ranking of the corrected rebuild offers a move the simulator disables (the truth's own request decides). */
function offersDisabled(truth: Battle, moveIds: string[]): string[] {
  const request = truth.sides[0].activeRequest;
  if (truth.ended || !request || !('active' in request) || !request.active) return [];
  const disabled = new Set(request.active[0].moves.filter(entry => entry.disabled).map(entry => entry.id));
  const choices = offered(truth) ?? [];
  return moveIds.filter(id => disabled.has(id) && choices.some(choice => choice.split(/[ ,]+/).includes(id)));
}

describe.each(SWEEP_CASES)('#106 low-PP moves, spent PP read from the log ($name)', ({ rules, mode }) => {
  test('the log count, the correction of a drifted rebuild and the ranking agree with the simulator', () => {
    const { moves } = sweepMoves(rules, lowPp, false);
    expect(moves.length).toBeGreaterThan(0);
    const bad: string[] = [];
    let played = 0;
    for (const move of moves) {
      const board = boardFor({ rules, mode, moves: [move.id, 'splash'] });
      const turns = Array.from({ length: 3 }, () => ({ p1: clickOf(mode, 1, move.target), p2: splashClick(mode) }));
      if (play(board, turns) === 0) continue;
      played++;
      const snapshot = snapshotOf(board.battle);
      const reading = readingProblem(snapshot, board.battle, move.name);
      if (reading) bad.push(`${move.id}: ${reading}`);
      for (const problem of driftProblems(board.battle, snapshot, [move.name])) bad.push(`${move.id}: ${problem}`);
    }
    expect(played).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});

/** The scenes of the report, one row per game type. */
const GEN9: Rules = RULES.find(rules => rules.generation === 9 && rules !== CHAMPIONS)!;
const MODS: [string, Rules][] = [['Generation 9', GEN9], ['Champions', CHAMPIONS]];

describe.each(MODS)('#106 the reported scenes (%s)', (_label, rules) => {
  describe.each(['singles', 'doubles'] as const)('%s', mode => {
    test('Revival Blessing, used once, is a move at 0 PP: the rebuild that kept it at 1 loses it, and the ranking does not offer it', () => {
      const board = boardFor({ rules, mode, moves: ['revivalblessing', 'splash'] });
      expect(play(board, [{ p1: clickOf(mode, 1, 'self'), p2: splashClick(mode) }])).toBe(1);
      expect(slotsOf(board.battle).get('revivalblessing')!.pp).toBe(0);
      const snapshot = snapshotOf(board.battle);
      expect(snapshot.p1.pokemon[0].ppUsed).toMatchObject({ 'Revival Blessing': 1 });
      const drifted = rebuilt(board.battle);
      setPp(drifted, 'full', ['Revival Blessing']);
      correctBattleFromSnapshot(drifted, snapshot);
      expect(slotsOf(drifted).get('revivalblessing')!.pp).toBe(0);
      expect((offered(drifted) ?? []).some(choice => choice.split(/[ ,]+/).includes('revivalblessing'))).toBe(false);
      expect(driftProblems(board.battle, snapshot, ['Revival Blessing'])).toEqual([]);
    });

    test('a Leppa Berry the log shows restores the move once: the count follows the log and the second use empties it', () => {
      const board = boardFor({ rules, mode, moves: ['revivalblessing', 'splash'], item: 'leppaberry' });
      const turn = { p1: clickOf(mode, 1, 'self'), p2: splashClick(mode) };
      expect(play(board, [turn])).toBe(1);
      const afterFirst = snapshotOf(board.battle);
      expect(bodyOf(board.battle).item).toBe('');
      expect(slotsOf(board.battle).get('revivalblessing')!.pp).toBe(1);
      expect(afterFirst.p1.pokemon[0].ppUsed).toMatchObject({ 'Revival Blessing': 0 });
      expect(driftProblems(board.battle, afterFirst, ['Revival Blessing'])).toEqual([]);
      expect(play(board, [turn])).toBe(1);
      const afterSecond = snapshotOf(board.battle);
      expect(slotsOf(board.battle).get('revivalblessing')!.pp).toBe(0);
      expect(driftProblems(board.battle, afterSecond, ['Revival Blessing'])).toEqual([]);
    });

    test('a Leppa Berry the log rules out: a rebuild that ate it is set back to the count of the log', () => {
      const truth = boardFor({ rules, mode, moves: ['revivalblessing', 'splash'] });
      const turn = { p1: clickOf(mode, 1, 'self'), p2: splashClick(mode) };
      expect(play(truth, [turn])).toBe(1);
      const snapshot = snapshotOf(truth.battle);
      const guessed = rebuilt(truth.battle);
      for (const slot of bodyOf(guessed).baseMoveSlots) slot.pp = slot.maxpp;
      for (const slot of bodyOf(guessed).moveSlots) slot.pp = slot.maxpp;
      correctBattleFromSnapshot(guessed, snapshot);
      expect(slotsOf(guessed).get('revivalblessing')!.pp).toBe(0);
      expect(offersDisabled(guessed, ['revivalblessing'])).toEqual([]);
      expect(offered(guessed)).toEqual(offered(truth.battle));
    });
  });
});

describe.each(MODS)('#106 Pressure, Spite and Eerie Spell (%s)', (_label, rules) => {
  describe.each(['singles', 'doubles'] as const)('%s', mode => {
    test('Pressure charges two PP per use against its holder', () => {
      const board = boardFor({ rules, mode, moves: ['overheat', 'splash'], foe: { species: 'Zapdos', moves: ['splash'], ability: 'pressure' } });
      expect(play(board, [1, 2].map(() => ({ p1: clickOf(mode, 1, 'normal'), p2: splashClick(mode) })))).toBe(2);
      const slot = slotsOf(board.battle).get('overheat')!;
      expect(slot.pp).toBe(slot.maxpp - 4);
      const snapshot = snapshotOf(board.battle);
      expect(snapshot.p1.pokemon[0].ppUsed).toMatchObject({ Overheat: 4 });
      expect(driftProblems(board.battle, snapshot, ['Overheat'])).toEqual([]);
    });

    test('Spite takes four PP off the last move', () => {
      const board = boardFor({ rules, mode, moves: ['overheat', 'splash'], foe: { species: 'Gengar', moves: ['splash', 'spite'] } });
      const turns = [
        { p1: clickOf(mode, 1, 'normal'), p2: splashClick(mode) },
        { p1: clickOf(mode, 2, 'self'), p2: mode === 'singles' ? 'move 2' : 'move 2 1, move 1' },
      ];
      expect(play(board, turns)).toBe(2);
      const slot = slotsOf(board.battle).get('overheat')!;
      expect(slot.pp).toBe(slot.maxpp - 5);
      const snapshot = snapshotOf(board.battle);
      expect(snapshot.p1.pokemon[0].ppUsed).toMatchObject({ Overheat: 5 });
      expect(driftProblems(board.battle, snapshot, ['Overheat'])).toEqual([]);
    });

    test('Eerie Spell takes three PP off the last move', () => {
      const board = boardFor({ rules, mode, moves: ['overheat', 'splash'], foe: { species: 'Spectrier', moves: ['splash', 'eeriespell'] } });
      const turns = [
        { p1: clickOf(mode, 1, 'normal'), p2: splashClick(mode) },
        { p1: clickOf(mode, 2, 'self'), p2: mode === 'singles' ? 'move 2' : 'move 2 1, move 1' },
      ];
      expect(play(board, turns)).toBe(2);
      const slot = slotsOf(board.battle).get('overheat')!;
      expect(slot.pp).toBe(slot.maxpp - 4);
      const snapshot = snapshotOf(board.battle);
      expect(snapshot.p1.pokemon[0].ppUsed).toMatchObject({ Overheat: 4 });
      expect(driftProblems(board.battle, snapshot, ['Overheat'])).toEqual([]);
    });
  });
});

/**
 * Round 89 (#106): the client's Pressure count has a Generation 3 branch, because the log of that generation does not always show the foe's
 * ability: a foe whose species can only have Pressure charges it, a foe whose species can have it beside another ability leaves the count a
 * range. `getPressurePP` of parser-state.ts reads the generation from the client's Dex; this row holds that read to the simulator in
 * Generation 3, singles and doubles, against a species with the one ability (Zapdos), and one with two (Aerodactyl: Rock Head or Pressure,
 * played with each).
 */
const GEN3: Rules = RULES.find(rules => rules.generation === 3)!;
const PRESSURE_FOES: { label: string; species: string; ability: string; perUse: number; exact: boolean }[] = [
  { label: 'a species that can only have Pressure', species: 'Zapdos', ability: 'pressure', perUse: 2, exact: true },
  { label: 'a species with Pressure or Rock Head, holding Pressure', species: 'Aerodactyl', ability: 'pressure', perUse: 2, exact: false },
  { label: 'a species with Pressure or Rock Head, holding Rock Head', species: 'Aerodactyl', ability: 'rockhead', perUse: 1, exact: false },
];

describe.each(['singles', 'doubles'] as const)('#106 Pressure in Generation 3, %s', mode => {
  test.each(PRESSURE_FOES)('$label: the log\'s count holds the simulator\'s PP', ({ species, ability, perUse, exact }) => {
    const board = boardFor({ rules: GEN3, mode, moves: ['overheat', 'splash'], foe: { species, moves: ['splash'], ability } });
    expect(play(board, [1, 2].map(() => ({ p1: clickOf(mode, 1, 'normal'), p2: splashClick(mode) })))).toBe(2);
    const slot = slotsOf(board.battle).get('overheat')!;
    expect(slot.pp).toBe(slot.maxpp - 2 * perUse);
    const snapshot = snapshotOf(board.battle);
    expect(readingProblem(snapshot, board.battle, 'Overheat')).toBeNull();
    // the single-ability species charges two PP per use whatever the log shows; the other leaves a range around the simulator's count
    if (exact) expect(snapshot.p1.pokemon[0].ppUsed).toMatchObject({ Overheat: 4 });
    else expect(snapshot.p1.pokemon[0].ppUsed?.Overheat).not.toBeUndefined();
    expect(driftProblems(board.battle, snapshot, ['Overheat'])).toEqual([]);
  });
});

describe('#106 a snapshot without the count changes nothing', () => {
  test('a snapshot written before round 89 leaves the slots alone', () => {
    const board = boardFor({ rules: GEN9, mode: 'singles', moves: ['revivalblessing', 'splash'] });
    play(board, [{ p1: 'move 1', p2: 'move 1' }]);
    const snapshot = snapshotOf(board.battle);
    for (const side of [snapshot.p1, snapshot.p2]) for (const entry of side.pokemon) delete entry.ppUsed;
    const drifted = rebuilt(board.battle);
    setPp(drifted, 'full');
    correctBattleFromSnapshot(drifted, snapshot);
    expect(slotsOf(drifted).get('revivalblessing')!.pp).toBe(1);
  });
});
