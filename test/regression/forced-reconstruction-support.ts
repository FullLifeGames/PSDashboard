import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext, reconstructBranchRuntime, serializeLiveBattle, loadSimMods } from '@fulllifegames/eval-engine';
import type { TurnAlignmentRecord } from '@fulllifegames/eval-engine';
import { extractProtocolEvents, type ProtocolEvents } from '../../packages/eval-engine/src/hax-alignment';
import { parseTurnBlocks } from '../../packages/eval-engine/src/branch/protocol-choices';
import { bankTeamsFor, bankWorldsFor } from './bank-build';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';


// The reconstruction stops before each game's last block, as the feedback run's drift line counts it (356 turns).
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

export const pinnedFetcher = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const key = join('test', 'e2e-feedback', 'fixtures', 'smogon', path.replace(/[^a-z0-9.]+/gi, '_'));
  if (!existsSync(`${key}.json`)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${key}.json`, 'utf-8')) } as unknown as Response;
}) as typeof fetch;

export interface Rebuilt {
  replay: Fixture;
  records: Map<number, TurnAlignmentRecord>;
  positions: Map<number, string>;
  battleLog: string[];
  snapshotFor(turn: number): ReturnType<typeof parseReplayLogWithObservations>['snapshots'][number] | null;
  logBlock(turn: number): string[];
}

export async function rebuild(id: string, options: { naked?: boolean; corpus?: boolean; through?: number; bare?: boolean } = {}): Promise<Rebuilt> {
  const replay = JSON.parse(readFileSync(options.corpus ? join('.fit-corpus', `${id}.json`) : join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as Fixture;
  await loadSimMods(getBranchSimulatorFormat(replay));
  const parsed = parseReplayLogWithObservations(replay.log);
  const built = options.naked
    ? { teams: buildTeamsFromReplay(replay.log, { observations: parsed.observations, speedOrders: parsed.speedOrders }), usageStats: null, reason: 'no teams' }
    : await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? id, parsed, fetcher: options.corpus ? diskCachedSmogonFetcher() : pinnedFetcher });
  if (!built.teams) throw new Error(`${id}: no teams (${built.reason})`);
  const { p1Team, p2Team } = built.teams;
  const { snapshots, observations } = parsed;
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const blocks = parseTurnBlocks(replay.log).turns;
  // `through`: the last turn whose boundary position the caller needs (captured on reaching the next turn).
  const lastTurn = options.through === undefined ? blocks[blocks.length - 1].turn : options.through + 1;
  const positions = new Map<number, string>();
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: lastTurn,
    snapshot: snapshotFor(lastTurn), playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    bringOnly: bankWorldsFor(replay, parseReplayLog(replay.log), built.usageStats)[0].bringOnly,
    deadlineMs: 600_000,
    capturePositions: options.bare ? undefined : { snapshotFor, onPosition: (turn, battle) => { positions.set(turn, serializeLiveBattle(battle)); } },
  });
  return {
    replay, positions, snapshotFor,
    records: new Map(runtime.haxAlignment.map(record => [record.turn, record])),
    battleLog: runtime.battleStream.battle!.log,
    logBlock: turn => { const block = blocks.find(entry => entry.turn === turn)!; return [...block.preUpkeep, ...block.postUpkeep]; },
  };
}

export function emittedBlock(battleLog: string[], turn: number): string[] {
  const from = battleLog.findIndex(line => line === `|turn|${turn}`);
  const to = battleLog.findIndex(line => line === `|turn|${turn + 1}`);
  if (from < 0) return [];
  return battleLog.slice(from + 1, to >= 0 ? to + 1 : undefined).filter(line => !line.startsWith('|t:|') && !/^\|message\|The battle's RNG was reset/.test(line));
}

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

export const diffsOf = (rebuilt: Rebuilt, turn: number): string[] =>
  diffChannels(extractProtocolEvents(rebuilt.logBlock(turn)), extractProtocolEvents(emittedBlock(rebuilt.battleLog, turn)));
