import type { Battle } from '@pkmn/sim';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { rulesDex, toId, type ReplayData } from '@fulllifegames/replay-core';
import { parseTurnBlocks } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { loggedOptions } from '../src/dice/turn';
import { hitsIn as hitsOfDex } from '../src/dice/chain';
import { secondariesIn } from '../src/dice/secondaries';
import { DIE_KINDS, type DieKind } from '../src/dice/types';
import { CLASSES } from './dice-census-support';
import { mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { CHECKS } from './dice-status-support';
import { dexOfRules, sweepClicks, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { clickedOf, moveScene, powerMoves, scan, type Scan, type Scene } from './dice-logged-sweep-support';
import { GAPS, registerKindRows, summaries, sweepMovesOf, total, WANT, writeSummaries } from './dice-logged-sweep-rows';
import { battleOf } from './power-oracle';

/**
 * The sweep of the log reader, the simulator as oracle: for every Dex entry of every kind of die the log names, in every generation
 * and mod the corpus plays (Gens 1 to 9, the Champions mod; singles everywhere, doubles from Gen 3), a turn plays under one seed and
 * writes a log; the dice `loggedDice` reads from it, forced on the same board under another seed, must give the log's turn
 * (`scoreAlignment` perfect). A plain run plays the fixed sample of each list, `DICE_SWEEPS=full` every entry. The crit and secondary
 * rows are in the sibling specs; the helpers they share are in `dice-logged-sweep-rows.ts`.
 *
 * KNOWN (`test.fails`): the causes the full sweep found in the reader (`GAPS`); each has a plain row that holds the sweep finds a
 * seed pair to repair, so a row never goes green because it played nothing. Moves aimed at a random foe in doubles stay out (see
 * `randomAim`).
 */
await loadSimMods('gen9championsou');
// a full sweep plays every Dex move of a rule set in one test (about two minutes for the crits of a doubles cell)
vi.setConfig({ testTimeout: 900_000 });

afterAll(() => writeSummaries());

const multihitOf = (move: DexMove): number | number[] | undefined => (move as unknown as { multihit?: number | number[] }).multihit;
const multiAccuracy = (move: DexMove): boolean => !!(move as unknown as { multiaccuracy?: boolean }).multiaccuracy;
const stalling = (move: DexMove): boolean => !!(move as unknown as { stallingMove?: boolean }).stallingMove;

/**
 * The moves the full sweep found the reader missed, each group with its cause. One plain row per group plays them through every
 * rule set that has them, so the main rows' sample cannot leave them out; a group moves to `GAPS` when a rule set shows it again.
 */
const FIXED: { cause: string; moves: string[]; modes: Mode[]; when?: (rules: Rules, mode: Mode) => boolean }[] = [
  { cause: 'the status line of the secondary carries "[from] move:" (the move itself), which the reader skipped as an effect of something else', moves: ['relicsong', 'wickedtorque'], modes: ['singles', 'doubles'] },
  { cause: 'the second hit of a move that picks its target names it in |-anim| only (Dragon Darts in doubles)', moves: ['dragondarts'], modes: ['singles', 'doubles'] },
  { cause: 'a move that fails after its accuracy draw is logged with no target (Psycho Shift without a status to pass): the offers of the click name the accuracy die (a miss shows only below 100 percent: Gens 4 and 5)', moves: ['psychoshift'], modes: ['singles', 'doubles'], when: rules => rules.generation <= 5 },
  { cause: 'a self effect of a spread move: one gain for the whole move from Gen 7 (`self.chance`, drawn once per move: Diamond Storm in doubles) and one per target that gave it in the secondary entry of Gen 6', moves: ['diamondstorm'], modes: ['singles', 'doubles'] },
];

registerKindRows(SWEEP_CASES, ['accuracy']);

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
  const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex), hitsOf: hitsOfDex(dex) });
  const multi = (move: DexMove): boolean => multihitOf(move) !== undefined && move.category !== 'Status';

  test('a move with a range of hits', () => {
    const result = sweepMovesOf('hit-count', rules, mode, move => multi(move) && Array.isArray(multihitOf(move)),
      move => moveScene(rules, mode, move, { channels: ['hitCounts'], kind: 'hit-count', options: options(move) }));
    expect(result.failures).toEqual([]);
    expect(result.witnesses > 0 || sweepMoves(rules, move => multi(move) && Array.isArray(multihitOf(move))).moves.length === 0).toBe(true);
  });

  // A later hit of a multi-accuracy move (Triple Axel, Triple Kick) is a die of its own: it carries its `hit`, and the reader writes
  // hits 2 to the count as yes and the next hit as no from the Dex's hit count (`hitsIn`). Without it a chain that broke after two
  // hits came back as an accuracy yes and three hits.
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

  (chain ? test : test.skip)('a move whose every hit rolls its accuracy: the hit count of the log holds on another seed (the Triple Axel row)', () => {
    expect(rows().failures).toEqual([]);
  });
});

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

// The log shows a second Protect that failed as `|-fail|`: `loggedDice` names the stalling die for it (2629703929 turn 10: the base
// was perfect by seed luck, the plain forced turn broke it); the caller names the condition that makes the move draw.
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
  const named: readonly DieKind[] = ['accuracy', 'crit', 'secondary', 'self-effect', 'hit-count', 'status-check', 'speed-tie', 'stalling', 'random-target', 'drag'];
  // damage-roll is no reader kind: the faint step forces it from a search, the log shows the HP only
  // the two kinds that sample a body (`random-target`, `drag`) are reader kinds; their sweeps are `dice-random-target-sweep.spec.ts` and `dice-drag-sweep.spec.ts`
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

// The offer names a die per later hit of a multi-accuracy move, and `loggedOptions` reads the accuracy targets of a click from the
// offer for a move the log writes with no target. The list stays one entry per target (the reconstruction plays it, ADR 0022).
describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('the accuracy targets of a click are one per target for a multi-accuracy move: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, multiAccuracy);

  test('every multi-accuracy move lists its aimed foe once', () => {
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      const scene = moveScene(rules, mode, move, { channels: [], options: {} });
      if (!scene) continue;
      const clicks = sweepClicks(mode, move.target);
      const { accuracyTargets } = loggedOptions(scene.board('1,2,3,4'), clicks);
      expect(accuracyTargets.get('p1a'), `${move.id}: one accuracy target for the one foe`).toEqual(['p2a']);
    }
  });
});
