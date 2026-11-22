import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeTurn } from '../src/analysis';
import { battleFaintedFraction, searchPosition } from '../src/search';
import { deserializeBattleExact } from '../src/forward-model';
import { autoTurnSettings } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import type { EvalResult, EvalSettings } from '../src/types';
import type { PlayedTurn } from '../src/played';

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
