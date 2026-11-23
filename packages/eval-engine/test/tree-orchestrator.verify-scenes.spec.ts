import { describe, expect, test, afterEach } from 'vitest';
import { readFileSync, appendFileSync } from 'node:fs';
import { analyzeTurn, TIER_THRESHOLDS } from '../src/analysis';
import { battleFaintedFraction, searchPosition } from '../src/search';
import { deserializeBattleExact, createRootPosition } from '../src/forward-model';
import { autoTurnSettings } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type { EvalResult, EvalSettings, EvalLine, EvalCellJob, EvalCellValue } from '../src/types';
import type { PlayedTurn } from '../src/played';
import type { Battle } from '@pkmn/sim';
import {
  type ReplayData,
  buildTeamsFromReplay,
  formatEnforcesSleepClause,
  getBranchSimulatorFormat,
  inferReplayFormatId,
  logRules,
  parseReplayLogWithObservations,
  replayRuleset,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { createMatchupCache, evaluatePosition } from '../src/eval-function';
import { parsePlayedActions, turnEvents, detectSacks } from '../src/played';
import { serializeLiveBattle } from '../src/serialize';
import { resolveTeraPreference } from '../src/tera';
import { State } from '@pkmn/sim';
import { searchOptions } from '../src/search/options';
import { branchOf } from './branch-dice-support';
import { set } from './move-oracle';
import { mctsSearch } from '../src/mcts';
import type { StaticRuleset } from '../src/eval-function';

/**
 * Round 63 (wave 1, lane C): corpus scenes of the verify step, on positions
 * built like the feedback harness (probe docs/perf/probes/2026-10-05-r63/
 * lanes/C/mc-oracle.vt.ts, EXPORT=1) and searched like the app (four trees,
 * verify, prover). The Monte-Carlo reference is that probe's: every verified
 * cell priced by 40 fresh seeds, each child one ply deeper, per class under
 * the plan weights. Flat verdicts (analyzeTurn without the deep check).
 */

interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: EvalSettings['tera'];
  sleepClause: boolean;
  keepPlayed: EvalSettings['keepPlayed'];
  played: PlayedTurn;
  sacks: Parameters<typeof analyzeTurn>[0]['sacks'];
  /** The boards of round 89 (`verify-scenes/`) carry the rule set, the game type and the fainted share the app's dispatch reads. */
  ruleset?: EvalSettings['ruleset'];
  gameType?: 'singles' | 'doubles';
  faintedFraction?: number;
}

const scene = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Scene;

/**
 * Round 89 (user ruling 16.11.2026, B5a): the board the app builds today, from `fixtures/verify-scenes/`.
 * `test/regression/verify-scenes-boards.spec.ts` rebuilds it in every run and fails when the app's build moves it.
 */
const board = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/verify-scenes/${name}-r89.json`, import.meta.url), 'utf-8')) as Scene;

/** The search of the app's Auto mode at this board: the matrix below the fainted share where the tree starts, the tree above it. */
async function searchAsApp(position: Scene): Promise<EvalResult> {
  const resolved = autoTurnSettings(position.faintedFraction ?? 0, position.gameType === 'doubles');
  const settings: EvalSettings = {
    depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: position.tera, sleepClause: position.sleepClause,
    keepPlayed: position.keepPlayed ?? undefined, ruleset: position.ruleset,
  };
  if (resolved.mode === 'matrix') return searchPosition(position.serialized, settings);
  return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, position.ruleset), { ...settings, depth: 1, samples: 1 });
}

async function search(position: Scene): Promise<EvalResult> {
  const settings: EvalSettings = {
    depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, keepPlayed: position.keepPlayed ?? undefined,
  };
  return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized), settings);
}

function flat(position: Scene, result: EvalResult) {
  return analyzeTurn({
    turn: position.turn, result, played: position.played, playedOutcome: null,
    scoreBefore: result.score, scoreAfter: null, sacks: position.sacks,
  });
}

describe('verify scenes: every class one ply deeper (round 63, T16; boards and settings of the app since round 89)', () => {
  // Round 89 (B5a, user gate 16.11.2026): the three rows grade the board the app builds today (fixtures/verify-scenes/, kept by
  // test/regression/verify-scenes-boards.spec.ts) with the search the app's Auto mode runs on it (`searchAsApp`). Round 63 had
  // exported the boards once: 912045's Ursaluna held a Life Orb the log rules out, 648453's Tornadus-Therian a Hardy 248 HP
  // spread, and 648453 was searched with the tree where Auto runs the depth-1 matrix on an early singles turn. The references
  // are the Monte-Carlo probe of round 86 (A15b: every verified tree cell re-priced with 24 draws, 40 for 648453, one ply
  // deeper, hashed draw seeds, blocks 1001 and 5001, answers off), recomputed on the new boards. Flat verdicts: the app's
  // deeper re-search of a flagged side (`verifyFlagged`) only acquits, so a flat tier here can be one the card later clears.

  test('the boards name the share of fainted bodies the engine reads, and Auto picks the search the rows name', () => {
    // test/regression/verify-scenes-boards.ts keeps its own count of fainted bodies (the barrel does not export the engine's).
    const modes = ['smogtours-gen6ou-648453-t13', 'smogtours-gen8ou-573756-t73', 'smogtours-gen9doublesou-912045-t8'].map(name => {
      const position = board(name);
      expect(position.faintedFraction).toBe(battleFaintedFraction(deserializeBattleExact(position.serialized)));
      return autoTurnSettings(position.faintedFraction!, position.gameType === 'doubles').mode;
    });
    expect(modes).toEqual(['matrix', 'mcts', 'mcts']);
  });

  test('648453 t13: AcrOne carries no tier (matrix 0.0550; MC 0.0732 and 0.0779 on two seed blocks; round 63 board and tree: an inaccuracy, 0.1286 and 0.1312)', { timeout: 300_000 }, async () => {
    // Auto runs this turn on the matrix (one body of twelve has fainted: depth 1, three draws), so the row does too. The
    // matrix has no verify cells to re-price; the reference is the tree's, on the same board: regret 0.0732 (best Hurricane)
    // and 0.0779 (best -> Excadrill), tier none on both blocks, the tree itself 0.0758. The feedback pin of this turn (truth:
    // AcrOne without a tier, BKC's switch named) holds the same. Old pin: inaccuracy, 0.130 ± 0.02, on the round 63 board and
    // the tree. New pin: none, 0.065 ± 0.03 (the matrix, the tree and both blocks lie inside 0.055 to 0.078; the band stops
    // 0.005 under the 0.1 line of an inaccuracy).
    const position = board('smogtours-gen6ou-648453-t13');
    const analysis = flat(position, await searchAsApp(position));
    expect(analysis.p1.played?.label).toBe('Hidden Power Ice');
    expect(analysis.p1.tier).toBeUndefined();
    expect(Math.abs(analysis.p1.regret! - 0.065)).toBeLessThan(0.03);
  });

  test('573756 t73: Body Press carries no tier (0.0100; MC 0.0078 and 0.0077 on two seed blocks; round 63 board: an inaccuracy, 0.1271)', { timeout: 300_000 }, async () => {
    // The tree runs this turn (five of twelve fainted), as in the app: score -0.7405, best row -> Toxapex 0.0100 ahead of Body
    // Press, a near tie (U-turn and the switch within 0.01 of it). The reference reads
    // 0.0078 and 0.0077, best -> Toxapex, tier none. Fire Fang knocks Corviknight out at 95 %; Body Press is the only click
    // that wins the turn on a miss, which the regret prices (the 5 % miss class). The score also lies past DECIDED_SCORE
    // (0.7), which would soften a tier by one step. Old pin: none, regret < 0.1 (earlier 0.014 ± 0.02), on the round 63 board,
    // where the engine read 0.127. New pin: none, 0.009 ± 0.02 (the engine and the blocks' mean).
    const position = board('smogtours-gen8ou-573756-t73');
    const analysis = flat(position, await searchAsApp(position));
    expect(analysis.p1.played?.label).toBe('Body Press');
    expect(analysis.p1.tier).toBeUndefined();
    expect(Math.abs(analysis.p1.regret! - 0.009)).toBeLessThan(0.02);
  });

  test("912045 t8 (doubles): p1's Blood Moon line carries no tier (0.0088; MC 0.0205 and 0.0435 on two seed blocks; round 63 board: a mistake, 0.2824 and 0.2932)", { timeout: 300_000 }, async () => {
    // The tree runs this turn (eight of twelve fainted), the answers round on, as in the app. On the board the app builds
    // (Ursaluna with the Throat Spray of the recorded usage data, not the Life Orb of round 63) the engine reads score
    // 0.6987, best row Hyper Voice + Rage Powder, regret 0.0088, tier none: P2's equilibrium puts no weight on the double
    // target into Ursaluna, so the played line's one hole costs nothing. The reference re-prices the verified cells and
    // reads 0.0205 and 0.0435 (same best row), tier none on both. The three best rows lie within 0.007 of each other, so the
    // regret is a near tie (a11, item 39). Old pin: a mistake, 0.288 ± 0.04, on the round 63 board. New pin: none,
    // 0.025 ± 0.04 (the engine and the blocks' mean; the band stops 0.035 under the 0.1 line of an inaccuracy).
    const position = board('smogtours-gen9doublesou-912045-t8');
    const analysis = flat(position, await searchAsApp(position));
    expect(analysis.p1.played?.label).toBe('Blood Moon→Okidogi + Matcha Gotcha');
    expect(analysis.p1.tier).toBeUndefined();
    expect(Math.abs(analysis.p1.regret! - 0.025)).toBeLessThan(0.04);
  });
});

describe('verify scenes: doubles boundary cells and the played column (round 63, T78)', () => {
  test("2629703929 t13 (VGC): p2's winning Psychic Fangs carries no tier once Flare Blitz's kill odds are priced (0.2618 before)", { timeout: 300_000 }, async () => {
    const position = scene('gen9vgc2026regi-2629703929-t13');
    const analysis = flat(position, await search(position));
    expect(analysis.p2.played?.label).toContain('Psychic Fangs');
    expect(analysis.p2.regret!).toBeLessThan(0.1);
  });
});

const TURN = 27;
const replay = JSON.parse(readFileSync(new URL('./fixtures/gpl-replay.json', import.meta.url), 'utf-8')) as ReplayData;

async function boardAtT27(): Promise<{ battle: Battle; position: Awaited<ReturnType<typeof reconstructBranchRuntime>> }> {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotAt = (t: number) => snapshots[Math.min(t - 1, snapshots.length - 1)] ?? null;
  const position = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: TURN, snapshot: snapshotAt(TURN),
    playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: { snapshotFor: snapshotAt, onPosition: () => {} },
  });
  return { battle: position.battleStream.battle!, position };
}

describe('GPL t27: setting up behind the sleeping Rhydon (T288)', () => {
  test('the static score reads the standing +1 Defense and +1 Special Defense above the board without them', { timeout: 120000 }, async () => {
    const { battle } = await boardAtT27();
    const ruleset = replayRuleset(replay);
    const clefable = battle.sides[0].active[0]!;
    expect(clefable.species.name).toBe('Clefable');
    const score = () => evaluatePosition(battle, createMatchupCache(ruleset));
    const base = score();
    clefable.boosts.def = 1;
    clefable.boosts.spd = 1;
    const one = score();
    clefable.boosts.def = 2;
    clefable.boosts.spd = 2;
    const two = score();
    if (process.env.GPL_SIZE_OUT) appendFileSync(process.env.GPL_SIZE_OUT, `GPL t27 static (p1 view): base ${base.toFixed(4)}, +1/+1 ${one.toFixed(4)}, +2/+2 ${two.toFixed(4)}\n`);
    expect(one).toBeGreaterThan(base);
  });

  test('the played Cosmic Power reads no inaccuracy and ranks in the top two rows or within 0.05 of the best', { timeout: 240000 }, async () => {
    const { battle } = await boardAtT27();
    const { snapshots } = parseReplayLogWithObservations(replay.log);
    const rules = logRules(replay.log);
    const settings = {
      tera: resolveTeraPreference('auto', inferReplayFormatId(replay), replay.log),
      sleepClause: formatEnforcesSleepClause(getBranchSimulatorFormat(replay)),
      ruleset: replayRuleset(replay),
    };
    let fainted = 0;
    let total = 0;
    for (const side of battle.sides) for (const mon of side.pokemon) { total++; if (mon.fainted || mon.hp <= 0) fainted++; }
    const resolved = autoTurnSettings(fainted / total, false);
    expect(resolved.mode).toBe('mcts');
    const result = await searchTreesOrchestrated(
      createLocalTreeExecutor(serializeLiveBattle(battle), settings.ruleset),
      { ...settings, depth: 1, samples: 1, mode: 'mcts' } as Parameters<typeof searchTreesOrchestrated>[1],
    );
    const events = turnEvents(replay.log, TURN);
    const turn = analyzeTurn({
      turn: TURN, result, played: parsePlayedActions(events, rules), playedOutcome: null, scoreBefore: result.score, scoreAfter: null,
      sacks: detectSacks(events, snapshots[TURN - 1] ?? null, rules), actives: { p1: null, p2: null, gen: rules.gen, mod: rules.mod },
    });
    const rows = result.perSide.p1.map(row => ({ label: row.label, ev: row.ev }));
    if (process.env.GPL_SIZE_OUT) appendFileSync(process.env.GPL_SIZE_OUT, `GPL t27 rows (p1): ${rows.map(row => `${row.label} ${row.ev.toFixed(3)}`).join(', ')}; regret ${turn.p1.regret}, tier ${turn.p1.tier}\n`);
    expect(turn.p1.played?.label).toBe('Cosmic Power');
    const played = rows.findIndex(row => row.label === 'Cosmic Power');
    expect(played).toBeGreaterThanOrEqual(0);
    expect(turn.p1.tier).not.toBe('inaccuracy');
    expect(turn.p1.tier).toBeUndefined();
    expect(turn.p1.regret ?? 0).toBeLessThan(TIER_THRESHOLDS.inaccuracy);
    const best = Math.max(...rows.map(row => row.ev));
    expect(played < 2 || best - rows[played].ev <= 0.05).toBe(true);
  });
});

const mon = (species: string, moves: string[]) => set(species, moves, { level: 50 });

async function lineOf(format: string, p1: ReturnType<typeof mon>[], p2: ReturnType<typeof mon>[], pick: (labels: string[]) => { p1: string; p2: string }): Promise<EvalLine> {
  const runtime = await branchOf(format, p1, p2, '1,2,3,4');
  const serialized = JSON.stringify(State.serializeBattle(runtime.battleStream.battle!));
  const root = createRootPosition(serialized, 'standard');
  const labels = (side: 'p1' | 'p2') => searchOptions(root, side, { tera: false }).map(option => option.label);
  const step = pick([...labels('p1'), '|', ...labels('p2')]);
  const [line] = await createLocalTreeExecutor(serialized).lines!({
    requests: [{ side: 'p1', label: step.p1, for: ['engine'], donors: [[{ ...step, visits: 20 }]], visits: 20 }],
    tera: false,
  });
  return line;
}

const split = (labels: string[]) => ({ own: labels.slice(0, labels.indexOf('|')), other: labels.slice(labels.indexOf('|') + 1) });

describe('a line that ends on a switch nobody chose', () => {
  test('singles: the U-turn user is asked who to send in', async () => {
    const line = await lineOf('gen9customgame',
      [mon('Rillaboom', ['U-turn', 'Grassy Glide']), mon('Mew', ['Psychic'])], [mon('Snorlax', ['Body Slam', 'Rest']), mon('Eevee', ['Tackle'])],
      labels => { const { own, other } = split(labels); return { p1: own.find(l => l.includes('U-turn'))!, p2: other.find(l => l.includes('Body Slam'))! }; });
    expect(line.steps).toHaveLength(1);
    expect(line.awaits).toBe('p1');
  });

  test('doubles: the same, and a line that settles asks nobody', async () => {
    const p1 = [mon('Incineroar', ['U-turn', 'Fake Out']), mon('Rillaboom', ['Grassy Glide', 'Wood Hammer']), mon('Amoonguss', ['Spore']), mon('Urshifu', ['Close Combat'])];
    const p2 = [mon('Urshifu', ['Close Combat', 'Sucker Punch']), mon('Amoonguss', ['Spore', 'Rage Powder']), mon('Rillaboom', ['Grassy Glide']), mon('Incineroar', ['Fake Out'])];
    const pivot = await lineOf('gen9doublescustomgame', p1, p2, labels => {
      const { own, other } = split(labels);
      return { p1: own.find(l => l.startsWith('U-turn'))!, p2: other.find(l => l.startsWith('Close Combat'))! };
    });
    expect(pivot.awaits).toBe('p1');
    const quiet = await lineOf('gen9doublescustomgame', p1, p2, labels => {
      const { own, other } = split(labels);
      return { p1: own.find(l => !l.includes('U-turn') && !/→ /.test(l))!, p2: other.find(l => l.startsWith('Close Combat'))! };
    });
    expect(quiet.awaits).toBeUndefined();
  });
});

describe('tree-score', () => {
  interface Position { serialized: string; tera: EvalSettings['tera']; sleepClause: boolean; ruleset: StaticRuleset }

  const fixture = (name: string): Position =>
    JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Position;

  const saved = process.env.EVAL_TREE_SCORE;
  afterEach(() => {
    if (saved === undefined) delete process.env.EVAL_TREE_SCORE;
    else process.env.EVAL_TREE_SCORE = saved;
  });

  async function search(position: Position, form?: string): Promise<EvalResult> {
    if (form === undefined) delete process.env.EVAL_TREE_SCORE;
    else process.env.EVAL_TREE_SCORE = form;
    return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, position.ruleset), {
      depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, prove: false,
    });
  }

  describe('the score form on tree turns (round 67, T114)', () => {
    test('visits keeps today’s score, game reads the clamped game value, mix their midpoint; the rankings stay', { timeout: 180_000 }, async () => {
      const position = fixture('smogtours-gen6ou-649664-t14-g1');
      const visits = await search(position);
      expect(await search(position, 'visits')).toEqual(visits);
      const game = await search(position, 'game');
      expect(visits.gameValue).toBeDefined();
      // The matrix mode's score (ranking/order.ts toResult): the game value clamped into [v1, v2].
      const v1 = Math.max(...visits.perSide.p1.map(row => row.worstCase));
      const v2 = -Math.max(...visits.perSide.p2.map(row => row.worstCase));
      const clamped = Math.min(Math.max(v1, v2), Math.max(Math.min(v1, v2), visits.gameValue!));
      expect(game.score).not.toBe(visits.score);
      expect(game.score).toBeCloseTo(clamped, 12);
      expect(game.perSide).toEqual(visits.perSide);
      const mix = await search(position, 'mix');
      expect(mix.score).toBeCloseTo((visits.score + game.score) / 2, 12);
      expect(mix.perSide).toEqual(visits.perSide);
    });

    test('the single-tree path reads the same switch', { timeout: 120_000 }, () => {
      const position = fixture('smogtours-gen6ou-649664-t14-g1');
      const settings: EvalSettings = {
        depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, prove: false,
      };
      delete process.env.EVAL_TREE_SCORE;
      const visits = mctsSearch(position.serialized, settings);
      process.env.EVAL_TREE_SCORE = 'game';
      const game = mctsSearch(position.serialized, settings);
      const v1 = Math.max(...visits.perSide.p1.map(row => row.worstCase));
      const v2 = -Math.max(...visits.perSide.p2.map(row => row.worstCase));
      const clamped = Math.min(Math.max(v1, v2), Math.max(Math.min(v1, v2), visits.gameValue!));
      expect(game.score).not.toBe(visits.score);
      expect(game.score).toBeCloseTo(clamped, 12);
      expect(game.perSide).toEqual(visits.perSide);
    });

    test('a typo in the switch throws', async () => {
      await expect(search(fixture('smogtours-gen6ou-649664-t14-g1'), 'games')).rejects.toThrow(/visits, game or mix/);
    });
  });
});

describe('verify-spread-scenes', () => {
  interface Scene {
    id: string;
    turn: number;
    serialized: string;
    tera: EvalSettings['tera'];
    sleepClause: boolean;
    keepPlayed: EvalSettings['keepPlayed'];
    played: PlayedTurn;
    sacks: Parameters<typeof analyzeTurn>[0]['sacks'];
  }

  const scene = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Scene;

  const settingsOf = (position: Scene): EvalSettings => ({
    depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, keepPlayed: position.keepPlayed ?? undefined,
  });

  async function search(position: Scene): Promise<EvalResult> {
    return searchTreesOrchestrated(createLocalTreeExecutor(position.serialized), settingsOf(position));
  }

  function flat(position: Scene, result: EvalResult) {
    return analyzeTurn({
      turn: position.turn, result, played: position.played, playedOutcome: null,
      scoreBefore: result.score, scoreAfter: null, sacks: position.sacks,
    });
  }

  /** The verify step's applied value of a blended cell outside the trees: every class one ply deeper under its weight. */
  const blendedValue = (value: EvalCellValue) =>
    value.blend!.classes.reduce((sum, cls) => sum + cls.weight * (cls.deepened ?? cls.leafSum / cls.count), 0);

  describe('verify scenes: hidden lengths (round 64, T119)', () => {
    test("2629703929 t8 (VGC): the Sleep Powder cell reads every sleep counter (MC 0.585 ± 0.079 under the round 73 static, user gate 22.10.2026, 2a; 0.514 ± 0.093 under the round 70 static)", { timeout: 300_000 }, async () => {
      // Chi-Yu falls asleep in a third of the draws for one turn only and wakes into the next (0.96 one ply
      // deeper); the class's first draw slept for three (−0.17) and stood for the whole class.
      // Round 70 (Protect tempo, batch gate): Protect rows take two of p1's twelve rows and Heat Wave + Flare Blitz→Groudon
      // leaves the list, so the cell is priced through the verify step's own job, Koraidon's Flare Blitz aimed back at
      // Groudon (target 1). Fresh reference (probe docs/perf/probes/2026-10-15-mc/extra-cell-mc.vt.ts, 24 draws on seed
      // blocks 1001 and 5001, answers off): 0.5135 under the classes' weights on both blocks (plain means 0.516 and 0.526,
      // standard errors 0.092 and 0.094). The engine read 0.3981.
      // Round 73 (T248, winner-share pair value; user gate 22.10.2026, 2a): the same cell recomputed (lanes/P/extra-cell-mc.vt.ts,
      // 24 draws on seed blocks 1001 and 5001, answers off): 0.5847 under the classes' weights on both blocks (plain means
      // 0.585 and 0.595, standard errors 0.078 and 0.079; the hit class reads 0.460 against the engine's 0.333, the miss class
      // 1 on both). The engine reads 0.4871. Band: 2.5 standard errors (0.079) around the weighted value, 0.39 to 0.78.
      const position = scene('gen9vgc2026regi-2629703929-t8');
      const local = createLocalTreeExecutor(position.serialized);
      const rounds: EvalCellJob[][] = [];
      const executor: TreeExecutor = { ...local, evalCells: async (jobs, onDone) => { rounds.push(jobs); return local.evalCells(jobs, onDone); } };
      await searchTreesOrchestrated(executor, settingsOf(position));
      const verify = rounds.find(jobs => jobs.length > 0 && jobs.every(job => job.deepen !== undefined && !job.plain))!;
      // Round 86 (T323, hashed tree seeds): the trees' dice follow the Dex and the verify round no longer holds this cell; the
      // row prices it through any verify job of the scene (its deepen settings are the scene's), the cell named by its choices.
      const template = verify.find(job => job.p1Choice === 'move heatwave, move flareblitz 2' && job.p2Choice === 'move rockslide, move sleeppowder 1') ?? verify[0];
      const [old] = await local.evalCells([{ ...template, p1Choice: 'move heatwave, move flareblitz 1', p2Choice: 'move rockslide, move sleeppowder 1' }], () => {});
      expect(Math.abs(blendedValue(old) - 0.5847)).toBeLessThan(2.5 * 0.079);
      // Round 70 (batch gate, 1a): the engine grades p1's played Heat Wave + Protect an inaccuracy (0.1736, best Heat Wave +
      // Flare Blitz→Jumpluff) and p2's Protect + Encore→Koraidon an inaccuracy (0.1936, best Precipice Blades + Sleep
      // Powder→Chi-Yu), with and without the answer round. The reference on the same rows grades p1 a mistake (0.326 and
      // 0.299 on 24 draws, 0.280 on 96) and p2 none on 24 draws (0.016, 0.010) and an inaccuracy on 96 (0.147); the
      // distance stays open in T242. Under the round 69 static both graded p1 a mistake and p2 no tier.
      // Round 73 (user gate 22.10.2026, 2a): the winner-share pair value lowers both regrets, p1's Heat Wave + Protect to 0.0514
      // (best Heat Wave + Dragon Claw→Jumpluff) and p2's Protect + Encore→Koraidon to 0.0004, so neither carries a tier, with and
      // without the answer round. The fresh reference does not carry that (next test), so the tiers are pinned to the reference.
    });

    // Round 73 (user gate 22.10.2026, 2a: a pin follows the engine only where the fresh reference carries it). The fresh reference
    // on the same rows (probe docs/perf/probes/2026-10-21-r73/lanes/P/mc-oracle.vt.ts, 24 draws, seed blocks 1001 and 5001,
    // answers off) grades p1 a mistake on both blocks (0.255 and 0.298) and p2 a mistake (0.267) and an inaccuracy (0.168), while
    // the engine reads no tier for either side: the distance widened from one tier (round 70) to two on p1. The test expects the
    // reference and fails until T242 closes the distance; the day it passes, the marker goes.
    test.fails("2629703929 t8 (VGC): the tiers the fresh reference grades, p1 a mistake and p2 at least an inaccuracy (T242)", { timeout: 300_000 }, async () => {
      const position = scene('gen9vgc2026regi-2629703929-t8');
      const analysis = flat(position, await search(position));
      expect(analysis.p1.tier).toBe('mistake');
      expect(analysis.p2.tier ?? null).not.toBeNull();
    });
  });
});
