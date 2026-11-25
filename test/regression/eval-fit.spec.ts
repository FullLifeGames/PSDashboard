import { test, describe } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildTeamsFromReplay } from '../../packages/replay-core/src/team-builder';
import { reconstructBranchRuntime } from '../../packages/eval-engine/src/branch-engine';
import { getBranchSimulatorFormat, replayBringOnly } from '../../packages/replay-core/src/replay-format';
import { parseReplayLogWithObservations } from '../../packages/replay-core/src/protocol-parser';
import {
  CHAMPIONS_DOUBLES_FEATURE_WEIGHTS, CHAMPIONS_FEATURE_WEIGHTS, createMatchupCache, DOUBLES_FEATURE_WEIGHTS, evalFeatures,
  evaluatePosition, EVAL_WEIGHTS, FEATURE_WEIGHTS, VGC_DOUBLES_FEATURE_WEIGHTS, type EvalFeatures,
} from '../../packages/eval-engine/src/eval-function';
import { battleFaintedFraction } from '../../packages/eval-engine/src/search';
import { WINPROB_K_OF, wpUnits } from '../../packages/eval-engine/src/winprob';
import {
  bootstrapPhaseK, brierScore, crossValidate, fitConstantK, fitLogistic, fitPhaseK, logLossScore,
  mulberry32, phaseBucket,
} from './fit-helpers';
import {
  dumpSamples, familyOf, familyReports, liftHolds, parseKTable, parseModelForms, parseWeightSet, phaseKReports, rootScaleReports, rulesetOfId, withModelForms, withoutHoldout, withoutUnratedLadder,
  type FamilySample, type Ruleset,
} from './fit-families';
import { holdoutSets } from './bank-universe';
import { loadReplayMods } from '../../src/lib/replay-mods';

// REPORTS ONLY: adopting a fitted weight means editing EVAL_WEIGHTS by hand and passing the calibration gate.

const MANIFEST_PATH = 'test/regression/fixtures/fit-corpus-manifest.json';
const CACHE_DIR = '.fit-corpus';
// The stamp covers the feature keys, the weights and the manifest's replays; a changed feature DEFINITION (same keys,
// same weights) still needs the file deleted by hand.
const SAMPLES_CACHE = join(CACHE_DIR, 'samples-cache.json');

const SAMPLES_DIR = process.env.EVAL_FIT_SAMPLES;
const SLICE = (process.env.EVAL_FIT_SLICE ?? '').match(/^(\d+)\/(\d+)$/);
const slicePart = SLICE ? { k: Number(SLICE[1]), n: Number(SLICE[2]) } : null;

const bringOnlyFor = (...args: Parameters<typeof replayBringOnly>) => replayBringOnly(...args) ?? undefined;
const FEATURE_KEYS = Object.keys(FEATURE_WEIGHTS) as (keyof EvalFeatures)[];
const cacheStamp = (manifest: { replays: { id: string }[] }) => JSON.stringify({
  schema: 2, // FitSample gained faintedFraction/genClass, a bump forces one recapture
  featureKeys: FEATURE_KEYS,
  weights: { EVAL_WEIGHTS, FEATURE_WEIGHTS, DOUBLES_FEATURE_WEIGHTS, VGC_DOUBLES_FEATURE_WEIGHTS, CHAMPIONS_FEATURE_WEIGHTS, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS },
  manifestIds: manifest.replays.map(entry => entry.id),
});

type Manifest = { replays: { id: string; format: string; source: 'tournament' | 'ladder' }[] };

// An empty folder means capture; a folder with missing or stale slices stops the run instead of recapturing the corpus.
function cachedSamples(manifest: Manifest): FitSample[] {
  const stamp = cacheStamp(manifest);
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf-8')) as { stamp?: string; samples: FitSample[] };
  if (!SAMPLES_DIR) {
    const cached = existsSync(SAMPLES_CACHE) ? read(SAMPLES_CACHE) : null;
    return cached?.stamp === stamp ? cached.samples : [];
  }
  if (slicePart || !existsSync(SAMPLES_DIR)) return [];
  const slices = readdirSync(SAMPLES_DIR).map(name => name.match(/^samples-(\d+)of(\d+)\.json$/)).filter(match => match !== null);
  const total = Number(slices[0]?.[2] ?? 0);
  if (slices.length === 0) return [];
  if (slices.length !== total || slices.some(match => Number(match[2]) !== total)) throw new Error(`incomplete capture in ${SAMPLES_DIR}: ${slices.length} of ${total} slices`);
  const parts = slices.map(match => read(join(SAMPLES_DIR, match[0])));
  if (parts.some(part => part.stamp !== stamp)) throw new Error(`stale capture in ${SAMPLES_DIR}: the stamp differs`);
  return parts.flatMap(part => part.samples);
}

function writeSamples(manifest: Manifest, samples: FitSample[]): string {
  if (!SAMPLES_DIR) {
    writeFileSync(SAMPLES_CACHE, JSON.stringify({ stamp: cacheStamp(manifest), samples }));
    return SAMPLES_CACHE;
  }
  mkdirSync(SAMPLES_DIR, { recursive: true });
  const path = join(SAMPLES_DIR, `samples-${slicePart?.k ?? 1}of${slicePart?.n ?? 1}.json`);
  writeFileSync(path, JSON.stringify({ stamp: cacheStamp(manifest), samples }));
  return path;
}

const tables = (singles: Record<keyof EvalFeatures, number>, doubles: Record<keyof EvalFeatures, number>) =>
  ({ singles: FEATURE_KEYS.map(key => singles[key]), doubles: FEATURE_KEYS.map(key => doubles[key]) });

const FAMILIES = [
  { name: 'standard-singles', ...tables(FEATURE_WEIGHTS, DOUBLES_FEATURE_WEIGHTS) },
  { name: 'standard-doubles', ...tables(FEATURE_WEIGHTS, DOUBLES_FEATURE_WEIGHTS) },
  { name: 'vgc-doubles', ...tables(FEATURE_WEIGHTS, VGC_DOUBLES_FEATURE_WEIGHTS) },
  { name: 'champions-singles', ...tables(CHAMPIONS_FEATURE_WEIGHTS, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS) },
  { name: 'champions-doubles', ...tables(CHAMPIONS_FEATURE_WEIGHTS, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS) },
];

const familiesToFit = () => {
  const names = (process.env.EVAL_FIT_FAMILIES ?? '').split(',').map(name => name.trim()).filter(Boolean);
  return names.length === 0 ? FAMILIES : FAMILIES.filter(family => names.includes(family.name));
};

const HOLD = { shared: ['trickRoom', 'choiceMismatch', 'boosts'], doubles: ['boosts'] };

const listOf = (name: string) => (process.env[name] ?? '').split(',').map(part => part.trim()).filter(Boolean);

// The start tables must give back every captured score, or the fit refuses.
const kOf = (ruleset: Ruleset) => WINPROB_K_OF[ruleset];

const familySamplesOf = (samples: FitSample[]): FamilySample[] => samples.map(sample => ({
  game: sample.game, set: sample.set ?? sample.game, gameType: sample.gameType, ruleset: sample.ruleset ?? rulesetOfId(sample.game),
  g: sample.g, p1Won: sample.p1Won, faintedFraction: sample.faintedFraction, score: sample.score, wp: sample.wp, lastPair: sample.lastPair,
  search: sample.search,
}));

function writePhaseKReport(samples: FitSample[]) {
  const draws = Number(process.env.EVAL_FIT_DRAWS ?? 200);
  const report = phaseKReports(familySamplesOf(samples), familiesToFit(), kOf, draws);
  const out = process.env.EVAL_FIT_K_OUT ?? join(SAMPLES_DIR ?? CACHE_DIR, 'phase-k-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  for (const [name, entry] of Object.entries(report)) {
    console.log('fitted' in entry ? `phase K ${name}: k0=${entry.fitted.k0.toFixed(2)} k1=${entry.fitted.k1.toFixed(2)} sets=${entry.sets}` : `phase K ${name}: ${entry.skipped}`);
  }
  console.log(`-> ${out}`);
}

function writeRootScaleReport(samples: FitSample[]) {
  const draws = Number(process.env.EVAL_FIT_DRAWS ?? 200);
  const names = familiesToFit().map(family => family.name);
  const stamp = process.env.EVAL_FIT_ROOT_K;
  const captured = stamp ? parseKTable(readFileSync(stamp, 'utf-8')) : kOf;
  const report = rootScaleReports(familySamplesOf(samples).filter(sample => names.includes(familyOf(sample))), kOf, captured, draws);
  const out = process.env.EVAL_FIT_K_OUT ?? join(SAMPLES_DIR ?? CACHE_DIR, 'root-scale-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  for (const [name, entry] of Object.entries(report)) {
    console.log('scale' in entry
      ? `root scale ${name}: c0=${entry.scale.k0.toFixed(2)} c1=${entry.scale.k1.toFixed(2)} K'=${entry.kPrime.k0.toFixed(2)}+${entry.kPrime.k1.toFixed(2)}·ff sets=${entry.sets}`
      : `root scale ${name}: ${entry.skipped}`);
  }
  console.log(`-> ${out}`);
}

function writeKReport(samples: FitSample[]): boolean {
  if (process.env.EVAL_FIT_ROOT_SCALE === '1') writeRootScaleReport(samples);
  else if (process.env.EVAL_FIT_PHASE_K === '1') writePhaseKReport(samples);
  else return false;
  return true;
}

function writeRefitReport(samples: FitSample[]) {
  const draws = Number(process.env.EVAL_FIT_DRAWS ?? 200);
  const formed = withModelForms(familySamplesOf(samples), FEATURE_KEYS, familiesToFit(), parseModelForms(process.env.EVAL_FIT_FORMS ?? ''));
  const options = {
    seeds: 20, folds: 5, draws, minGames: 20, hold: liftHolds(HOLD, listOf('EVAL_FIT_LIFT')),
    ...(process.env.EVAL_FIT_ONLY ? { only: listOf('EVAL_FIT_ONLY') } : {}), set: parseWeightSet(process.env.EVAL_FIT_SET ?? ''),
    captured: parseWeightSet(process.env.EVAL_FIT_CAPTURED ?? ''),
  };
  const report = familyReports(formed.samples, formed.names, formed.families, kOf, options, wpUnits);
  const out = process.env.EVAL_FIT_OUT ?? join(SAMPLES_DIR ?? CACHE_DIR, 'fit-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`identity: ${report.identity.samples} checked, ${report.identity.skipped ?? 0} from a search left out`);
  for (const [name, entry] of Object.entries(report.families)) {
    console.log('verdict' in entry
      ? `refit ${name}: adopt=${entry.verdict.adopt} wins=${entry.summary.pooled.logLossWins}/20 sets=${entry.games}`
      : `refit ${name}: ${entry.skipped}`);
  }
  console.log(`-> ${out}`);
}

function samplesOf(manifest: Manifest): FitSample[] {
  if (!process.env.EVAL_FIT_DUMP) return cachedSamples(manifest);
  const fromDumps = dumpSamplesOf(process.env.EVAL_FIT_DUMP);
  // An empty read would fall back to this spec's naked capture: a dump made without g must stop the run instead.
  if (fromDumps.length === 0) throw new Error(`EVAL_FIT_DUMP: no sample with a feature vector in ${process.env.EVAL_FIT_DUMP}`);
  return fromDumps;
}

function dumpSamplesOf(paths: string): FitSample[] {
  const playersOf = (id: string) => (JSON.parse(readFileSync(join(CACHE_DIR, `${id}.json`), 'utf-8')) as { players?: string[] }).players ?? [];
  const genClass = (id: string): FitSample['genClass'] => (/^(smogtours-)?gen9/.test(id) ? 'gen9' : 'old');
  const samples = dumpSamples(paths.split(','), playersOf);
  const { kept, dropped } = process.env.EVAL_FIT_UNRATED === '1' ? { kept: samples, dropped: 0 } : withoutUnratedLadder(samples);
  console.log(`unrated ladder: ${dropped} samples left out${process.env.EVAL_FIT_UNRATED === '1' ? ' (EVAL_FIT_UNRATED=1 keeps them)' : ''}`);
  return kept.map(sample => ({ ...sample, source: sample.source ?? 'ladder', genClass: genClass(sample.game) }));
}

// No fit ever trains on the holdout (scripts/build-fit-holdout.mjs).
function fitSamples(samples: FitSample[]): FitSample[] {
  const holdout = new Set(holdoutSets().flatMap(set => set.ids));
  const { kept, dropped } = withoutHoldout(samples, holdout);
  console.log(`holdout: ${dropped} samples of ${new Set(samples.filter(sample => holdout.has(sample.game)).map(sample => sample.game)).size} games left out`);
  return kept;
}

interface FitSample {
  game: string;
  source: 'tournament' | 'ladder';
  gameType: 'singles' | 'doubles';
  genClass: 'gen9' | 'old';
  /** Features scaled by scale/normalizer: the tanh argument's addends. */
  g: number[];
  score: number;
  faintedFraction: number;
  p1Won: boolean;
  /** From bank dumps: the cluster key, the rule set, a score in wp-units, the last pair (no identity check). */
  set?: string;
  ruleset?: Ruleset;
  wp?: boolean;
  lastPair?: boolean;
  search?: boolean;
}

async function captureEntry(entry: Manifest['replays'][number], samples: FitSample[]): Promise<void> {
  const cachePath = join(CACHE_DIR, `${entry.id}.json`);
  if (!existsSync(cachePath)) return;
  try {
    const replay = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
      id?: string; log: string; players?: string[]; format?: string; formatid?: string;
    };
    const winnerName = replay.log.match(/\|win\|(.+)/)?.[1]?.trim();
    const players = replay.players ?? [];
    if (!winnerName || players.length < 2) return;
    const p1Won = winnerName === players[0];
    if (!p1Won && winnerName !== players[1]) return;
    const gameType: FitSample['gameType'] = /\|gametype\|doubles/.test(replay.log) ? 'doubles' : 'singles';
    const ruleset = rulesetOfId(entry.id);
    const set = `${ruleset}-${gameType}|${players.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, '')).sort().join('|')}`;
    const genClass: FitSample['genClass'] = /^gen9/.test(replay.formatid ?? entry.format) ? 'gen9' : 'old';

    await loadReplayMods(replay);
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    if (p1Team.length === 0 || p2Team.length === 0 || snapshots.length < 4) return;

    const maxTurn = snapshots.length;
    const step = Math.max(1, Math.ceil(maxTurn / 8));
    const wanted = new Set<number>();
    for (let turn = 2; turn < maxTurn; turn += step) wanted.add(turn);

    const replayMeta = { id: entry.id, format: replay.format ?? entry.format, formatid: replay.formatid, log: replay.log };
    const bringOnly = bringOnlyFor(replayMeta as Parameters<typeof replayBringOnly>[0], snapshots);

    await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replayMeta as Parameters<typeof getBranchSimulatorFormat>[0]),
      p1Team, p2Team,
      bringOnly,
      replayLog: replay.log,
      targetTurn: maxTurn - 1,
      snapshot: snapshots[Math.min(maxTurn - 2, snapshots.length - 1)],
      capturePositions: {
        snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
        onPosition: (turn, battle) => {
          if (!wanted.has(turn) || battle.ended) return;
          const cache = createMatchupCache(ruleset);
          const features = evalFeatures(battle, cache);
          const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
          const scaleOverNorm = EVAL_WEIGHTS.scale / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp));
          const g = FEATURE_KEYS.map(key => features[key] * scaleOverNorm);
          const score = evaluatePosition(battle, cache);
          if (Number.isNaN(score) || g.some(Number.isNaN)) return;
          samples.push({
            game: entry.id, source: entry.source, gameType, genClass, g, score, ruleset, set,
            faintedFraction: battleFaintedFraction(battle), p1Won,
          });
        },
      },
    });
    console.log(`${entry.id}: ok`);
  } catch (error) {
    console.log(`${entry.id}: ${error instanceof Error ? error.message : error}`);
  }
}

function impliedWeights(fit: { beta: number[]; sigma: number[] }): number[] {
  const perUnit = fit.beta.map((value, j) => value / fit.sigma[j]);
  const bodiesIndex = FEATURE_KEYS.indexOf('bodies');
  const reference = perUnit[bodiesIndex];
  const bodiesHand = FEATURE_WEIGHTS.bodies;
  return perUnit.map(value => (reference !== 0 ? (value / reference) * bodiesHand : NaN));
}

describe('eval weight fitting (EVAL_FIT=1)', () => {
  test('fit feature weights on the pinned corpus and report', { timeout: 7200000 }, async ({ skip }) => {
    skip(!process.env.EVAL_FIT, 'weight fitting is opt-in: EVAL_FIT=1');
    skip(!existsSync(MANIFEST_PATH), 'run node scripts/build-fit-corpus.mjs first');

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
    const loaded: FitSample[] = samplesOf(manifest);
    console.log(`loaded ${loaded.length} cached samples`);

    const cacheHit = loaded.length > 0;
    const replays = slicePart ? manifest.replays.filter((_, index) => index % slicePart.n === slicePart.k - 1) : manifest.replays;
    for (const entry of cacheHit ? [] : replays) await captureEntry(entry, loaded);

    const games = new Set(loaded.map(sample => sample.game));
    console.log(`\nsamples=${loaded.length} games=${games.size}`);
    if (!cacheHit && loaded.length > 0) console.log(`cached samples to ${writeSamples(manifest, loaded)}`);
    if (slicePart) return;
    const samples = fitSamples(loaded);
    if (samples.length < 100) {
      console.log('too few samples to fit — check the corpus cache');
      return;
    }
    if (!writeKReport(samples) && (SAMPLES_DIR || process.env.EVAL_FIT_OUT)) writeRefitReport(samples);
    // The legacy reports read `score` as the static's tanh; dump samples carry the leaf value in wp-units.
    if (process.env.EVAL_FIT_LEGACY === '0' || process.env.EVAL_FIT_DUMP) return;

    const report = (label: string, subset: FitSample[]) => {
      if (subset.length < 50) {
        console.log(`${label}: too few samples (${subset.length})`);
        return;
      }
      const fit = fitLogistic(subset.map(s => ({ g: s.g, won: s.p1Won })));
      const implied = impliedWeights(fit);
      console.log(`\n${label} (n=${subset.length}, games=${new Set(subset.map(s => s.game)).size}):`);
      FEATURE_KEYS.forEach((key, j) => {
        console.log(`  ${key}: hand=${FEATURE_WEIGHTS[key]} implied=${implied[j]?.toFixed(1)}`);
      });
      return implied;
    };

    const bootstrap = (label: string, subset: FitSample[]) => {
      const subsetGames = [...new Set(subset.map(sample => sample.game))];
      if (subsetGames.length < 20) {
        console.log(`bootstrap ${label}: too few games (${subsetGames.length})`);
        return;
      }
      const byGame = new Map<string, FitSample[]>();
      for (const sample of subset) byGame.set(sample.game, [...(byGame.get(sample.game) ?? []), sample]);
      const rng = mulberry32(42);
      const draws: number[][] = [];
      for (let b = 0; b < 100; b++) {
        const resample: FitSample[] = [];
        for (let i = 0; i < subsetGames.length; i++) {
          const pick = subsetGames[Math.floor(rng() * subsetGames.length)];
          resample.push(...(byGame.get(pick) ?? []));
        }
        draws.push(impliedWeights(fitLogistic(resample.map(s => ({ g: s.g, won: s.p1Won })))));
      }
      console.log(`\nbootstrap SE ${label} (implied weights, games=${subsetGames.length}):`);
      FEATURE_KEYS.forEach((key, j) => {
        const values = draws.map(draw => draw[j]).filter(value => Number.isFinite(value));
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const se = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
        console.log(`  ${key}: mean=${mean.toFixed(1)} se=${se.toFixed(1)}`);
      });
    };

    const singles = samples.filter(sample => sample.gameType === 'singles');
    const doubles = samples.filter(sample => sample.gameType === 'doubles');
    report('ALL', samples);
    report('TOURNAMENT-ONLY', samples.filter(sample => sample.source === 'tournament'));
    report('LADDER-ONLY', samples.filter(sample => sample.source === 'ladder'));
    report('SINGLES-ONLY', singles);
    report('DOUBLES-ONLY', doubles);

    report('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));
    report('OLDGEN-ONLY', samples.filter(s => s.genClass === 'old'));

    const boostsIndex = FEATURE_KEYS.indexOf('boosts' as keyof EvalFeatures);
    const noBoosts = samples.map(s => ({ ...s, g: s.g.map((value, j) => (j === boostsIndex ? 0 : value)) }));
    report('ALL-NO-BOOSTS', noBoosts);
    bootstrap('ALL-NO-BOOSTS', noBoosts);

    bootstrap('ALL', samples);
    bootstrap('SINGLES-ONLY', singles);
    bootstrap('DOUBLES-ONLY', doubles);
    bootstrap('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));

    const cellKeys = ['sweepFastKo', 'sweepFastChip', 'sweepSlowKo', 'sweepSlowChip'] as const;
    const cellIndices = new Set(cellKeys.map(key => FEATURE_KEYS.indexOf(key)));
    const cvModels = [
      { name: 'M0 boosts-only', drop: cellIndices },
      { name: 'M1 cells-only', drop: new Set([boostsIndex]) },
      { name: 'M2 additive', drop: new Set<number>() },
    ];
    const cvSeeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const cvTranche = (label: string, subset: FitSample[]) => {
      const gameCount = new Set(subset.map(s => s.game)).size;
      if (gameCount < 25) {
        console.log(`\ncv ${label}: too few games (${gameCount})`);
        return null;
      }
      const cvSamples = subset.map(s => ({ g: s.g, won: s.p1Won, game: s.game }));
      const runs = new Map(cvModels.map(model => [model.name,
        cvSeeds.map(seed => crossValidate(cvSamples, 5, seed, model.drop))]));
      console.log(`\ncv ${label} (n=${subset.length}, games=${gameCount}, k=5, seeds=${cvSeeds.length}):`);
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      for (const model of cvModels) {
        const modelRuns = runs.get(model.name)!;
        console.log(`  ${model.name}: logloss=${mean(modelRuns.map(r => r.logLoss)).toFixed(5)} ` +
          `brier=${mean(modelRuns.map(r => r.brier)).toFixed(5)}`);
      }
      const m0 = runs.get('M0 boosts-only')!;
      const versus = (name: string) => {
        const model = runs.get(name)!;
        const deltas = cvSeeds.map((_, i) => model[i].logLoss - m0[i].logLoss);
        const wins = deltas.filter(delta => delta < 0).length;
        const meanDelta = mean(deltas);
        const brierOk = mean(model.map(r => r.brier)) <= mean(m0.map(r => r.brier));
        console.log(`  Δlogloss(${name}−M0): mean=${meanDelta.toFixed(6)} · ` +
          `wins ${wins}/${cvSeeds.length} seeds · brier ≤ M0: ${brierOk}`);
        return { meanDelta, wins, brierOk };
      };
      return { m1: versus('M1 cells-only'), m2: versus('M2 additive') };
    };
    cvTranche('ALL', samples);
    const singlesCv = cvTranche('SINGLES-ONLY', singles);
    cvTranche('DOUBLES-ONLY', doubles);
    cvTranche('GEN9-ONLY', samples.filter(s => s.genClass === 'gen9'));
    if (singlesCv) {
      const passes = (r: { meanDelta: number; wins: number; brierOk: boolean }) =>
        r.meanDelta < 0 && r.wins >= 16 && r.brierOk;
      const verdict = passes(singlesCv.m1) ? 'REPLACEMENT CANDIDATE'
        : passes(singlesCv.m2) ? 'ADDITIVE CANDIDATE' : 'STATUS QUO HOLDS';
      console.log(`\nCV VERDICT (singles): ${verdict} ` +
        `(M1 meanΔ=${singlesCv.m1.meanDelta.toFixed(6)} wins=${singlesCv.m1.wins}/20 brierOk=${singlesCv.m1.brierOk} · ` +
        `M2 meanΔ=${singlesCv.m2.meanDelta.toFixed(6)} wins=${singlesCv.m2.wins}/20 brierOk=${singlesCv.m2.brierOk})`);
    }

    for (const gameType of ['singles', 'doubles'] as const) {
      const subset = samples.filter(s => s.gameType === gameType)
        .map(s => ({ score: s.score, faintedFraction: s.faintedFraction, won: s.p1Won, game: s.game }));
      if (subset.length < 100) continue;
      const constant = fitConstantK(subset);
      const phase = fitPhaseK(subset);
      console.log(`\nwinprob ${gameType}: constant K=${constant.toFixed(2)} ` +
        `phase k0=${phase.k0.toFixed(2)} k1=${phase.k1.toFixed(2)} (n=${subset.length})`);
      const spread = bootstrapPhaseK(subset, 200, 48);
      console.log(`  bootstrap over games: k0 ±${spread.k0.se.toFixed(2)} [${spread.k0.lo.toFixed(2)}, ${spread.k0.hi.toFixed(2)}] ` +
        `k1 ±${spread.k1.se.toFixed(2)} [${spread.k1.lo.toFixed(2)}, ${spread.k1.hi.toFixed(2)}] · K at fainted ` +
        spread.at.map(entry => `${entry.ff.toFixed(2)}: ${entry.k.toFixed(2)} [${entry.lo.toFixed(2)}, ${entry.hi.toFixed(2)}]`).join(', '));
      for (const bucket of ['early', 'mid', 'late'] as const) {
        const inBucket = subset.filter(s => phaseBucket(s.faintedFraction) === bucket);
        if (inBucket.length < 30) continue;
        console.log(`  ${bucket} (n=${inBucket.length}): ` +
          `brier const=${brierScore(inBucket, constant).toFixed(4)} ` +
          `phase=${brierScore(inBucket, phase.k0, phase.k1).toFixed(4)} ` +
          `logloss const=${logLossScore(inBucket, constant).toFixed(4)} ` +
          `phase=${logLossScore(inBucket, phase.k0, phase.k1).toFixed(4)}`);
      }
    }
  });
});
