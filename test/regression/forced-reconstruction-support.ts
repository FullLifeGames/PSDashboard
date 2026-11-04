/* eslint-disable no-restricted-imports -- Round 86 (B2): a white-box measurement chain like eval-calibration.spec.ts: it reads the alignment reader, the turn-block parser and the first-turn helper of the engine package, none of which the barrel exports. The integrator adds this spec and its support file to the `ignores` of the root-spec zone in eslint.zones.mjs and drops this line. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext, reconstructBranchRuntime, serializeLiveBattle, loadSimMods } from '@fulllifegames/eval-engine';
import type { TurnAlignmentRecord } from '@fulllifegames/eval-engine';
import { extractProtocolEvents, type ProtocolEvents } from '../../packages/eval-engine/src/hax-alignment';
import { parseTurnBlocks } from '../../packages/eval-engine/src/branch/protocol-choices';
import { bankTeamsFor } from './bank-build';

/**
 * Round 86 (the engine reads the dice), lane B, step B2: the twelve feedback fixtures rebuilt the way the bank builds them (pinned
 * Smogon data, `bankTeamsFor`) with the app's reconstruction, with every turn's record, emitted block and boundary position kept for
 * the rows of `forced-reconstruction.spec.ts`. The reconstruction stops before each game's last block, as the feedback run's drift
 * line counts it (356 turns).
 */

export const FIXTURES = [
  { id: 'smogtours-gen8ou-573756', type: 'singles' }, { id: 'smogtours-gen8ou-562428', type: 'singles' },
  { id: 'smogtours-gen6ou-648453', type: 'singles' }, { id: 'smogtours-gen6ou-649664', type: 'singles' },
  { id: 'smogtours-gen6ou-653785', type: 'singles' }, { id: 'smogtours-gen6ou-655336', type: 'singles' },
  { id: 'gen9championsou-2628340185', type: 'singles' },
  { id: 'smogtours-gen9doublesou-912045', type: 'doubles' }, { id: 'gen9doublesou-2663093831', type: 'doubles' },
  { id: 'gen9vgc2026regi-2630685175', type: 'vgc' }, { id: 'gen9vgc2026regi-2629703929', type: 'vgc' },
  { id: 'gen9championsvgc2026regmc-2695803506', type: 'vgc' },
] as const;

export type FixtureId = typeof FIXTURES[number]['id'];
export type GameType = typeof FIXTURES[number]['type'];

type Fixture = ReplayData & { formatid: string };

const pinnedFetcher = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const key = join('test', 'e2e-feedback', 'fixtures', 'smogon', path.replace(/[^a-z0-9.]+/gi, '_'));
  if (!existsSync(`${key}.json`)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${key}.json`, 'utf-8')) } as unknown as Response;
}) as typeof fetch;

export interface Rebuilt {
  replay: Fixture;
  /** The record of every replayed turn, by turn. */
  records: Map<number, TurnAlignmentRecord>;
  /** The serialized position at the start of every turn the reconstruction reached. */
  positions: Map<number, string>;
  /** The reconstruction's battle log, whole. */
  battleLog: string[];
  snapshotFor(turn: number): ReturnType<typeof parseReplayLogWithObservations>['snapshots'][number] | null;
  /** The log's lines of a turn (before and after the upkeep). */
  logBlock(turn: number): string[];
}

/** Rebuilds a fixture like the app: teams as the bank builds them, the 16-seed (or later the forced) reconstruction, boundaries captured. */
export async function rebuild(id: FixtureId): Promise<Rebuilt> {
  const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as Fixture;
  await loadSimMods(getBranchSimulatorFormat(replay));
  const parsed = parseReplayLogWithObservations(replay.log);
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? id, parsed, fetcher: pinnedFetcher });
  if (!built.teams) throw new Error(`${id}: no teams (${built.reason})`);
  const { p1Team, p2Team } = built.teams;
  const { snapshots, observations } = parsed;
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const blocks = parseTurnBlocks(replay.log).turns;
  const lastTurn = blocks[blocks.length - 1].turn;
  const positions = new Map<number, string>();
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: lastTurn,
    snapshot: snapshotFor(lastTurn), playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    deadlineMs: 600_000,
    capturePositions: { snapshotFor, onPosition: (turn, battle) => { positions.set(turn, serializeLiveBattle(battle)); } },
  });
  return {
    replay, positions, snapshotFor,
    records: new Map(runtime.haxAlignment.map(record => [record.turn, record])),
    battleLog: runtime.battleStream.battle!.log,
    logBlock: turn => { const block = blocks.find(entry => entry.turn === turn)!; return [...block.preUpkeep, ...block.postUpkeep]; },
  };
}

/** The lines a reconstruction emitted for a turn: between its `|turn|` line and the next, without the clock and the reseed message. */
export function emittedBlock(battleLog: string[], turn: number): string[] {
  const from = battleLog.findIndex(line => line === `|turn|${turn}`);
  const to = battleLog.findIndex(line => line === `|turn|${turn + 1}`);
  if (from < 0) return [];
  return battleLog.slice(from + 1, to >= 0 ? to + 1 : undefined).filter(line => !line.startsWith('|t:|') && !/^\|message\|The battle's RNG was reset/.test(line));
}

/** The channels and keys on which two blocks differ: the readable cause of an imperfect turn (the alignment score counts them). */
export function diffChannels(expected: ProtocolEvents, got: ProtocolEvents): string[] {
  const out: string[] = [];
  for (const channel of ['misses', 'crits', 'secondaries', 'hitCounts', 'cants', 'confusionSelfHits'] as const) {
    const a = expected[channel] as Map<string, number>;
    const b = got[channel] as Map<string, number>;
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      if ((a.get(key) ?? 0) !== (b.get(key) ?? 0)) out.push(`${channel} ${key} log=${a.get(key) ?? 0} sim=${b.get(key) ?? 0}`);
    }
  }
  const count = (order: string[]) => order.reduce((map, entry) => map.set(entry, (map.get(entry) ?? 0) + 1), new Map<string, number>());
  const [ca, cb] = [count(expected.moveOrder), count(got.moveOrder)];
  for (const key of new Set([...ca.keys(), ...cb.keys()])) {
    if ((ca.get(key) ?? 0) !== (cb.get(key) ?? 0)) out.push(`moveCount ${key} log=${ca.get(key) ?? 0} sim=${cb.get(key) ?? 0}`);
  }
  for (const faint of expected.faints) if (!got.faints.has(faint)) out.push(`faint log-only ${faint}`);
  for (const faint of got.faints) if (!expected.faints.has(faint)) out.push(`faint sim-only ${faint}`);
  if (expected.ended !== got.ended) out.push(`ended log=${expected.ended} sim=${got.ended}`);
  return out;
}

/** The diffs of a rebuilt turn's emitted block against the log. */
export const diffsOf = (rebuilt: Rebuilt, turn: number): string[] =>
  diffChannels(extractProtocolEvents(rebuilt.logBlock(turn)), extractProtocolEvents(emittedBlock(rebuilt.battleLog, turn)));
