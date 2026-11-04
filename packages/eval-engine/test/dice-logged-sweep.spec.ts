import type { Battle } from '@pkmn/sim';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { rulesDex, toId, type ReplayData } from '@fulllifegames/replay-core';
import { parseTurnBlocks } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { loggedOptions } from '../src/dice/turn';
import { secondariesIn } from '../src/dice/secondaries';
import { DIE_KINDS, type DieKind } from '../src/dice/types';
import { CLASSES } from './dice-census-support';
import { mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { CHECKS } from './dice-status-support';
import { dexOfRules, picksOne, sweepClicks, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { clickedOf, moveScene, powerMoves, scan, witnessesWanted, type Scan, type Scene } from './dice-logged-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 86 (the engine reads the dice), lane B, step B2: the sweep of the log reader. The simulator is the oracle. For every Dex
 * entry of every kind of die the log names, in every generation and mod the corpus plays (Gens 1 to 9, the Champions mod; singles
 * everywhere, doubles from Gen 3), a turn plays under one seed and writes a log; the dice `loggedDice` reads from that log, forced
 * on the same board under another seed, must give the log's turn (`scoreAlignment` perfect). The kinds: accuracy, crit, secondary
 * and self-effect (every move with a chance entry, also under Serene Grace and Sheer Force), hit-count (the multi-accuracy
 * moves are the Triple Axel row of ruling Q4 and stay a known gap), status-check (every condition whose handler draws), speed-tie
 * and, new in this round, stalling (the `|-fail|` of a second Protect, read with the condition the caller names). The last block counts the kinds the log may show and the
 * reader does not name (the census of the ledger). A plain run plays the fixed sample of each list, `DICE_SWEEPS=full` every entry.
 *
 * KNOWN (`test.fails`, red today): the multi-accuracy rows (Q4) and the five causes the full sweep
 * found in the reader (`GAPS`); each has a plain row that holds the sweep finds a seed pair to repair, so a row never goes green because it
 * played nothing. Moves aimed at a random foe in doubles stay out (see `randomAim`).
 */
await loadSimMods('gen9championsou');
// a full sweep plays every Dex move of a rule set in one test (about two minutes for the crits of a doubles cell)
vi.setConfig({ testTimeout: 900_000 });

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const WANT = witnessesWanted();
const multihitOf = (move: DexMove): number | number[] | undefined => (move as unknown as { multihit?: number | number[] }).multihit;
const multiAccuracy = (move: DexMove): boolean => !!(move as unknown as { multiaccuracy?: boolean }).multiaccuracy;
const stalling = (move: DexMove): boolean => !!(move as unknown as { stallingMove?: boolean }).stallingMove;
/**
 * A move aimed at a random foe in doubles (Thrash, Struggle): the simulator picks the target from the stream (a `pick` of the census, out
 * of the module's scope) and the log names the one it picked. A forced turn on another seed can hit the other foe; the alignment reads
 * bodies by side and species, so two foes of one species hide the difference and the sweep leaves these moves out.
 */
const randomAim = (mode: Mode, move: DexMove): boolean => mode === 'doubles' && picksOne(move.target);
/**
 * The moves the full sweep (`DICE_SWEEPS=full`, 04.11.2026) found that `loggedDice` cannot repeat, each group with its cause. The main rows leave
 * them out; one known row per group plays them and stays red until the reader (B3, lane B's files) or a die (lane A's files) covers the cause.
 * Names stand here because the sweep's oracle is the simulator's own log of each move; the code that fixes a cause reads the Dex, not these ids.
 */
const GAPS: { cause: string; moves: string[]; modes: Mode[] }[] = [
  { cause: 'the power Present picks (damage or a heal) is a draw no kind of die names, so the other seed can pick another power than the log shows', moves: ['present'], modes: ['singles', 'doubles'] },
  { cause: 'a secondary that picks its status (the die names the chance, the pick follows the stream)', moves: ['triattack', 'direclaw'], modes: ['singles', 'doubles'] },
  { cause: "a move's own chance to move its user (Gens 7 and later) is one die for every target of a spread move, and a log where only one target gave the gain cannot be forced", moves: ['diamondstorm'], modes: ['doubles'] },
];
/**
 * The moves the full sweep found the reader missed (04.11.2026) and B3 fixed, each group with its cause. One plain row per group plays them
 * through every rule set that has them, so the main rows' sample cannot leave them out; a group moves to `GAPS` when a rule set shows it again.
 */
const FIXED: { cause: string; moves: string[]; modes: Mode[]; when?: (rules: Rules, mode: Mode) => boolean }[] = [
  { cause: 'the status line of the secondary carries "[from] move:" (the move itself), which the reader skipped as an effect of something else', moves: ['relicsong', 'wickedtorque'], modes: ['singles', 'doubles'] },
  { cause: 'the second hit of a move that picks its target names it in |-anim| only (Dragon Darts in doubles)', moves: ['dragondarts'], modes: ['singles', 'doubles'] },
  { cause: 'a move that fails after its accuracy draw is logged with no target (Psycho Shift without a status to pass): the offers of the click name the accuracy die (a miss shows only below 100 percent: Gens 4 and 5)', moves: ['psychoshift'], modes: ['singles', 'doubles'], when: rules => rules.generation <= 5 },
  { cause: 'a self effect that a spread move draws once per target: the log writes one gain per target that gave it (Diamond Storm, singles and the secondary entry of Gen 6)', moves: ['diamondstorm'], modes: ['singles', 'doubles'], when: (rules, mode) => mode === 'singles' || rules.generation <= 6 },
];

/** Whether the move is a gap of this game type (a gap may hold in singles and stay open in doubles). */
const gapped = (mode: Mode, id: string): boolean => GAPS.some(gap => gap.modes.includes(mode) && gap.moves.includes(id));
/** The moves of the main rows: none of the multi-accuracy row (ruling Q4); the moves of a gap leave through `sweepMovesOf`. */
const sound = (move: DexMove): boolean => !multiAccuracy(move);
const lowAccuracy = (move: DexMove): boolean => typeof move.accuracy === 'number' && move.accuracy < 100;

/** What a block of a case counted, for the log and the census. */
function total(label: string, moves: number, scans: Scan[]): Scan {
  const sum: Scan = { scanned: 0, skipped: 0, witnesses: 0, named: 0, rollFaints: 0, failures: [], why: {} };
  for (const entry of scans) {
    sum.scanned += entry.scanned; sum.skipped += entry.skipped; sum.witnesses += entry.witnesses; sum.named += entry.named; sum.rollFaints += entry.rollFaints;
    for (const [reason, count] of Object.entries(entry.why)) sum.why[reason] = (sum.why[reason] ?? 0) + count;
    sum.failures.push(...entry.failures);
  }
  summaries.push(`${label}: ${moves} moves, ${scans.length} played, ${sum.witnesses} witnesses (${sum.named} name the kind), ${sum.rollFaints} faints of the damage roll, ${sum.failures.length} failures, left out ${JSON.stringify(sum.why)}`);
  return sum;
}

/** Plays every move of a list through `sceneOf` and checks that the forced turn gives the log's turn. */
function sweepMovesOf(
  label: string, rules: Rules, mode: Mode, keep: (move: DexMove) => boolean, sceneOf: (move: DexMove) => Scene | null, foesOnly = true, withGaps = false,
): Scan {
  const { moves } = sweepMoves(rules, move => keep(move) && !randomAim(mode, move) && (withGaps || !gapped(mode, move.id)), foesOnly);
  const scans: Scan[] = [];
  const failures: string[] = [];
  for (const move of moves) {
    const scene = sceneOf(move);
    if (!scene) continue;
    const result = scan(scene, WANT);
    scans.push(result);
    failures.push(...result.failures.map(failure => `${move.id} ${failure}`));
  }
  const sum = total(`${label} ${rules.name} ${mode}`, moves.length, scans);
  sum.failures = failures;
  return sum;
}

/** The cases of a block: the rule sets and game types, and whether the rule set has the moves at all. */
const KINDS = {
  accuracy: { keep: (move: DexMove) => sound(move) && lowAccuracy(move), channels: ['misses'] },
  crit: { keep: (move: DexMove) => sound(move) && move.category !== 'Status', channels: ['crits'] },
} as const;

describe.each(SWEEP_CASES)('the logged accuracy and crit dice give the log\'s turn: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex) });

  for (const [kind, spec] of Object.entries(KINDS) as [keyof typeof KINDS, typeof KINDS[keyof typeof KINDS]][]) {
    test(`${kind}: every move that draws one`, () => {
      // a crit comes once in 16 to 24 draws: its seeds scan wider than the other kinds'
      const result = sweepMovesOf(kind, rules, mode, spec.keep, move => moveScene(rules, mode, move, { channels: spec.channels, kind, pool: kind === 'crit' ? 40 : undefined, options: options(move) }));
      expect(result.failures).toEqual([]);
      expect(result.witnesses, 'the sweep found a seed pair the log repairs').toBeGreaterThan(0);
      // a crit the other seed shows against a hit the log missed has no crit die in the log: the log names it where the move hit
      expect(result.named, 'the log names the die').toBeGreaterThan(0);
    });
  }
});

describe.each(SWEEP_CASES)('the logged secondaries and self effects give the log\'s turn: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const secondaries = secondariesIn(dex);
  const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondaries });
  const entries = (move: DexMove): string[] => secondaries(move.id);
  const has = (kind: 'items' | 'abilities', id: string): boolean => { const entry = dex[kind].get(id); return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard; };

  const plain = (move: DexMove): boolean => sound(move) && entries(move).length > 0;
  const ownSelf = (move: DexMove): boolean => entries(move).some(id => id.startsWith('self:'));
  const sceneOf = (move: DexMove, outfit?: { ability: string }): Scene | null =>
    moveScene(rules, mode, move, { channels: ['secondaries', 'cants'], kind: 'secondary', options: options(move) }, outfit);

  test('secondary: every move with a chance entry', () => {
    const result = sweepMovesOf('secondary', rules, mode, plain, move => sceneOf(move));
    expect(result.failures).toEqual([]);
    expect(result.witnesses).toBeGreaterThan(0);
  });

  test('self-effect: every move whose chance entry moves its own user', () => {
    const keep = (move: DexMove): boolean => sound(move) && ownSelf(move);
    const result = sweepMovesOf('self-effect', rules, mode, keep, move => sceneOf(move));
    expect(result.failures).toEqual([]);
    // a rule set whose Dex has no such move plays none (Gen 1 has no stat change of the user as a secondary)
    expect(result.witnesses > 0 || sweepMoves(rules, keep).moves.length === 0).toBe(true);
  });

  // Serene Grace doubles the chances, Sheer Force removes the secondaries: the log shows what the simulator rolled under the outfit
  for (const outfit of [{ ability: 'serenegrace' }, { ability: 'sheerforce' }]) {
    test(`secondary under ${outfit.ability}`, () => {
      if (!has('abilities', outfit.ability)) return;
      const result = sweepMovesOf(outfit.ability, rules, mode, plain, move => sceneOf(move, outfit));
      expect(result.failures).toEqual([]);
    });
  }
});

// Known gaps (see GAPS), one row per cause over every rule set that has its moves: the sweep finds seed pairs the log would repair, and the forced
// turn repairs none of them (somewhere). Where a rule set does not show the cause (Tri Attack has no secondary in Gen 1) its pairs just pass.
describe.each(SWEEP_CASES)('the moves the reader once missed hold on another seed: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  for (const { cause, moves: ids } of FIXED.filter(entry => entry.modes.includes(mode) && (entry.when?.(rules, mode) ?? true))) {
    test(cause, () => {
      const present = ids.filter(id => { const move = dex.moves.get(id); return move.exists && move.gen <= dex.gen && !move.isNonstandard; });
      const result = sweepMovesOf(`fixed ${ids[0]}`, rules, mode, move => ids.includes(move.id), move => {
        const scene = moveScene(rules, mode, move, {
          channels: ['misses', 'crits', 'secondaries', 'cants', 'hitCounts'], options: { clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex) },
        });
        return scene && { ...scene, pool: 40, want: 10 };
      }, false, true);
      expect(result.failures).toEqual([]);
      // a rule set that lacks the moves plays none
      expect(result.witnesses > 0 || present.length === 0, 'the sweep found a seed pair the log repairs').toBe(true);
    });
  }
});

describe.each(GAPS)('known gap: $cause', ({ moves: ids, modes }) => {
  let played: { witnesses: number; failures: string[] } | null = null;
  const rows = () => {
    if (played) return played;
    const result = { witnesses: 0, failures: [] as string[] };
    for (const { rules, mode, name } of SWEEP_CASES.filter(entry => modes.includes(entry.mode))) {
      const dex = dexOfRules(rules);
      const sum = sweepMovesOf(`gap ${ids[0]}`, rules, mode, move => ids.includes(move.id), move => {
        const scene = moveScene(rules, mode, move, {
          channels: ['misses', 'crits', 'secondaries', 'cants', 'hitCounts'], options: { clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex) },
        });
        return scene && { ...scene, pool: 40, want: 10 };
      }, false, true);
      result.witnesses += sum.witnesses;
      result.failures.push(...sum.failures.map(failure => `${name} ${failure}`));
    }
    played = result;
    return result;
  };

  test('the sweep finds seed pairs the log would repair', () => {
    expect(rows().witnesses).toBeGreaterThan(0);
  });

  test.fails('the turn of the log holds on another seed in every rule set', () => {
    expect(rows().failures).toEqual([]);
  });
});

describe.each(SWEEP_CASES)('the logged hit count gives the log\'s turn: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex) });
  const multi = (move: DexMove): boolean => multihitOf(move) !== undefined && move.category !== 'Status';

  test('a move with a range of hits', () => {
    const result = sweepMovesOf('hit-count', rules, mode, move => sound(move) && multi(move) && Array.isArray(multihitOf(move)),
      move => moveScene(rules, mode, move, { channels: ['hitCounts'], kind: 'hit-count', options: options(move) }));
    expect(result.failures).toEqual([]);
    expect(result.witnesses > 0 || sweepMoves(rules, move => sound(move) && multi(move) && Array.isArray(multihitOf(move))).moves.length === 0).toBe(true);
  });

  // Ruling Q4 (04.11.2026): the accuracy of one hit of a multi-accuracy move (Triple Axel, Triple Kick) is no die the module names, so a chain
  // that broke after two hits comes back as an accuracy yes and three hits. KNOWN: red until a die names the one hit (TODO proposal in the ledger).
  const chain = sweepMoves(rules, multiAccuracy).moves.length > 0;
  const hitsIn = (log: string[]): number => Math.max(0, ...log.filter(line => line.startsWith('|-hitcount|')).map(line => Number(line.split('|')[3])));
  const rows = () => sweepMovesOf('multi-accuracy', rules, mode, multiAccuracy, move => {
    const longest = Math.max(0, ...[multihitOf(move)].flat().map(Number));
    // a witness is a chain the log shows broken (fewer hits than the move's most) that the other seed plays another way
    const scene = moveScene(rules, mode, move, { channels: ['hitCounts'], kind: 'hit-count', options: options(move) });
    return scene && {
      ...scene, pool: 60, differs: (log: string[], natural: string[]) => hitsIn(log) > 0 && hitsIn(log) < longest && hitsIn(log) !== hitsIn(natural),
      extra: (log: string[], forcedLog: string[]) => hitsIn(log) === hitsIn(forcedLog) ? null : `the log shows ${hitsIn(log)} hits, the forced turn ${hitsIn(forcedLog)}`,
    };
  });

  test('a move whose every hit rolls its accuracy: the sweep finds chains the log shows broken', () => {
    if (chain) expect(rows().witnesses).toBeGreaterThan(0);
    else expect(sweepMoves(rules, multiAccuracy).moves).toEqual([]);
  });

  (chain ? test.fails : test.skip)('a move whose every hit rolls its accuracy: the hit count of the log holds on another seed (the Triple Axel row, Q4)', () => {
    expect(rows().failures).toEqual([]);
  });
});

/** The scene of a status check: Snorlax stands under the condition and uses a plain move. */
function checkScene(rules: Rules, mode: Mode, check: typeof CHECKS[number], moveId: string): Scene {
  return {
    board: seed => {
      const board = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, ...teams(rules, mode, moveId), seed);
      check.start(board);
      return board;
    },
    clicks: sweepClicks(mode, 'normal'),
    options: { clicked: clickedOf(moveId, mode), checks: new Map([['p1a', [check.id]]]) },
    channels: ['cants', 'confusionSelfHits', 'moveOrder'], kind: 'status-check',
  };
}

function teams(rules: Rules, mode: Mode, moveId: string) {
  const attacker = mon(rules, { species: 'Snorlax', moves: [moveId], gender: 'M' });
  const foe = (species: string) => mon(rules, { species, moves: ['splash'] });
  return mode === 'singles'
    ? [[attacker], [foe('Vaporeon')]] as const
    : [[attacker, foe('Blissey')], [foe('Vaporeon'), foe('Vaporeon')]] as const;
}

describe.each(SWEEP_CASES)('the logged status checks give the log\'s turn: $name', ({ rules, mode }) => {
  test.each(CHECKS.map(check => [check.id, check] as const))('%s', (_id, check) => {
    if (rules.generation < check.from) return;
    const result = scan(checkScene(rules, mode, check, 'tackle'), WANT);
    summaries.push(`status-check ${check.id} ${rules.name} ${mode}: ${result.witnesses} witnesses (${result.named} name the kind), ${result.failures.length} failures`);
    expect(result.failures).toEqual([]);
    expect(result.witnesses, 'the sweep found a seed pair the log repairs').toBeGreaterThan(0);
  });
});

/** Two Snorlax on equal Speed: the simulator shuffles who moves first. */
function tieScene(rules: Rules, mode: Mode): Scene {
  const side = (rest: string[]) => [mon(rules, { species: 'Snorlax', moves: ['tackle'], gender: 'M' }), ...rest.map(species => mon(rules, { species, moves: ['splash'] }))];
  return {
    board: seed => battleOf(mode === 'singles' ? rules.singles : rules.doubles!, side(mode === 'singles' ? [] : ['Blissey']), side(mode === 'singles' ? [] : ['Chansey']), seed),
    clicks: mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: 'move 1 1, move 1', p2: 'move 1 1, move 1' },
    options: { clicked: new Map([['p1a', 'tackle'], ['p2a', 'tackle'], ...(mode === 'doubles' ? [['p1b', 'splash'], ['p2b', 'splash']] as [string, string][] : [])]) },
    channels: ['moveOrder'], kind: 'speed-tie',
  };
}

describe.each(SWEEP_CASES)('the logged speed tie gives the log\'s turn: $name', ({ rules, mode }) => {
  test('two bodies on equal Speed: the order of the log holds on another seed', () => {
    const result = scan(tieScene(rules, mode), WANT);
    summaries.push(`speed-tie ${rules.name} ${mode}: ${result.witnesses} witnesses (${result.named} name the kind), ${result.failures.length} failures`);
    expect(result.failures).toEqual([]);
    expect(result.witnesses, 'the sweep found a seed pair the log repairs').toBeGreaterThan(0);
    expect(result.named).toBe(result.witnesses);
  });
});

/** The `|-fail|` lines of a body in a turn's lines. */
const failsOf = (lines: string[], slot: string): number => lines.filter(line => line.startsWith('|-fail|') && line.split('|')[2].startsWith(slot)).length;

/** A stalling move used twice in a row: the second use is the logged turn, the first plays plain on both seeds. */
function stallScene(rules: Rules, mode: Mode, move: DexMove): Scene | null {
  const first = sweepClicks(mode, move.target);
  const probe = moveScene(rules, mode, move, { channels: [], options: {} });
  if (!probe) return null;
  const board = (seed: string): Battle => {
    const battle = probe.board(seed);
    playClicks(battle, first);
    return battle;
  };
  // the condition the first use left on the user, as the app reads it from the offers of the body's click (`loggedOptions`)
  const { stalling } = loggedOptions(board('1,2,3,4'), first);
  return {
    board,
    clicks: first, options: { clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dexOfRules(rules)), ...(stalling ? { stalling } : {}) },
    // a failed second use writes `|-fail|` only: no channel of the alignment sees it, so the two logs decide the witness
    channels: [], kind: 'stalling',
    differs: (log, naturalLog) => failsOf(log, 'p1a') !== failsOf(naturalLog, 'p1a'),
    extra: (log, forcedLog) => failsOf(log, 'p1a') === failsOf(forcedLog, 'p1a') ? null : `the log shows ${failsOf(log, 'p1a')} fails of the user, the forced turn ${failsOf(forcedLog, 'p1a')}`,
  };
}

// The log shows a second Protect that failed as `|-fail|`: `loggedDice` names the stalling die for it (2629703929 turn 10: the base was perfect
// by seed luck, the plain forced turn broke it; B3 builds the reader, the caller names the condition that makes the move draw).
describe.each(SWEEP_CASES)('the logged stalling die gives the turn of the log: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, stalling, false);
  let played: { failures: string[]; sum: Scan } | null = null;
  const rows = () => {
    if (played) return played;
    const failures: string[] = [];
    const scans: Scan[] = [];
    for (const move of moves) {
      const scene = stallScene(rules, mode, move);
      if (!scene) continue;
      const result = scan(scene, WANT);
      scans.push(result);
      failures.push(...result.failures.map(failure => `${move.id} ${failure}`));
    }
    played = { failures, sum: total(`stalling ${rules.name} ${mode}`, moves.length, scans) };
    return played;
  };

  test('a stalling move used twice: the sweep finds a second use that the other seed plays differently', () => {
    if (moves.length > 0) expect(rows().sum.witnesses).toBeGreaterThan(0);
    else expect(moves).toEqual([]);
  });

  (moves.length > 0 ? test : test.skip)('a stalling move used twice: the log names the die and the second use fails or succeeds as the log shows', () => {
    const { failures, sum } = rows();
    expect(sum.named, 'the log names the die').toBe(sum.witnesses);
    expect(failures).toEqual([]);
  });
});

describe('the kinds the log may show and the reader does not name: the census of the ledger', () => {
  const named: readonly DieKind[] = ['accuracy', 'crit', 'secondary', 'self-effect', 'hit-count', 'status-check', 'speed-tie', 'stalling'];
  // damage-roll is no reader kind: the faint step (B4) forces it from a search, the log shows the HP only
  const unnamed = DIE_KINDS.filter(kind => !named.includes(kind) && kind !== 'damage-roll');

  test('the kinds that stay unnamed, with their Dex entries and the corpus turns that carry the event', () => {
    expect(unnamed).toEqual(['power', 'ability-proc', 'item-proc', 'move-first', 'end-of-turn']);
    const dex = rulesDex(9);
    const IDS = [
      'smogtours-gen8ou-573756', 'smogtours-gen8ou-562428', 'smogtours-gen6ou-648453', 'smogtours-gen6ou-649664', 'smogtours-gen6ou-653785',
      'smogtours-gen6ou-655336', 'gen9championsou-2628340185', 'smogtours-gen9doublesou-912045', 'gen9doublesou-2663093831',
      'gen9vgc2026regi-2630685175', 'gen9vgc2026regi-2629703929', 'gen9championsvgc2026regmc-2695803506',
    ];
    const typeOf = (id: string) => /vgc/.test(id) ? 'vgc' : /doubles/.test(id) ? 'doubles' : 'singles';
    const turns = IDS.flatMap(id => {
      const replay = JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${id}.json`, import.meta.url), 'utf-8')) as ReplayData;
      return parseTurnBlocks(replay.log).turns.map(block => ({ type: typeOf(id), lines: [...block.preUpkeep, ...block.postUpkeep] }));
    });
    for (const kind of unnamed) {
      const entries = kind === 'power'
        ? powerMoves(dex).map(move => ({ table: 'moves', id: move.id, name: move.name }))
        : Object.entries(CLASSES).filter(([, entry]) => entry.kind === kind).map(([key]) => key.split('/')).map(([table, id]) => ({ table, id, name: (table === 'items' ? dex.items : dex.abilities).get(id).name }));
      const ids = [...new Set(entries.map(entry => entry.id))];
      const carries = (lines: string[]): boolean => lines.some(line => entries.some(entry => entry.name && (entry.table === 'moves'
        ? line.startsWith('|move|') && toId(line.split('|')[3] ?? '') === entry.id
        : line.includes(`${entry.table === 'items' ? 'item' : 'ability'}: ${entry.name}`))));
      const per = ['singles', 'doubles', 'vgc'].map(type => `${type} ${turns.filter(turn => turn.type === type && carries(turn.lines)).length} of ${turns.filter(turn => turn.type === type).length}`);
      summaries.push(`census ${kind}: ${ids.length} Dex entries (${ids.join(',')}); turns of the 12 fixtures whose lines name one: ${per.join(', ')}`);
      expect(ids.length, `${kind} has Dex entries`).toBeGreaterThan(0);
    }
  });
});
