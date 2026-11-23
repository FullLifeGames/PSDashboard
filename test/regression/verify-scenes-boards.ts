import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { State } from '@pkmn/sim';
import {
  getBranchSimulatorFormat, logRules, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import {
  allTurnEvents, applyTargetCorrections, buildChoiceLockContext, deserializeBattleExact, detectSacks, reconstructBranchRuntime,
} from '@fulllifegames/eval-engine';
import { bankKeepPlayed, bankSettings } from './bank-search.ts';
import { bankTeamsFor } from './bank-build.ts';

/**
 * The boards of the verify-scenes rows (`packages/eval-engine/test/tree-orchestrator.verify-scenes.spec.ts`), built the way the app builds
 * a turn (round 89, user ruling 16.11.2026, B5a).
 *
 * The three rows of round 63 (648453 t13, 573756 t73, 912045 t8) graded boards that were exported once, with the sets
 * of that day, while the app builds its sets again on every analysis. The board here is the app's: `bankTeamsFor`
 * (the bank's door to `buildAppTeams`) over the saved replay and the saved Smogon files of the feedback harness
 * (`test/e2e-feedback/fixtures/`), the replay rebuilt to the turn with the choice locks and the target corrections,
 * the settings and the played turn read as the sweep reads them (`bankSettings`, `bankKeepPlayed`), the sacks from
 * the turn's own protocol (`detectSacks`). It is the board the feedback dump of that turn read.
 *
 * `verify-scenes-boards.spec.ts` rebuilds the three and fails when a fixture differs; `UPDATE_VERIFY_SCENES=1` writes
 * them again (then run `tree-orchestrator.verify-scenes.spec.ts` and recompute the Monte-Carlo references of its rows).
 * The fixtures live in `verify-scenes/`, beside `positions/` and not in it: the speed-layer sweeps read every file of
 * `positions/`.
 */

const REPO = new URL('../../', import.meta.url);
const FEEDBACK = new URL('test/e2e-feedback/fixtures/', REPO);
export const BOARD_DIR = new URL('packages/eval-engine/test/fixtures/verify-scenes/', REPO);

export interface SceneBoard {
  /** The replay's file stem under `test/e2e-feedback/fixtures/`. */
  id: string;
  turn: number;
}

/** The three rows of `tree-orchestrator.verify-scenes.spec.ts`; each fixture is `<id>-t<turn>-r89.json` in `BOARD_DIR`. */
export const SCENE_BOARDS: SceneBoard[] = [
  { id: 'smogtours-gen6ou-648453', turn: 13 },
  { id: 'smogtours-gen8ou-573756', turn: 73 },
  { id: 'smogtours-gen9doublesou-912045', turn: 8 },
];

export const boardFile = (scene: SceneBoard) => new URL(`${scene.id}-t${scene.turn}-r89.json`, BOARD_DIR);

/**
 * The share of fainted bodies the app's dispatch reads (`battleFaintedFraction` in the engine's search, which the barrel does
 * not export). A deliberate copy: `tree-orchestrator.verify-scenes.spec.ts` compares it with the engine's on every board.
 */
const faintedShare = (battle: { sides: { pokemon: { fainted: boolean; hp: number }[] }[] }) => {
  const bodies = battle.sides.flatMap(side => side.pokemon);
  return bodies.length > 0 ? bodies.filter(pokemon => pokemon.fainted || pokemon.hp <= 0).length / bodies.length : 0;
};

/** The harness's saved Smogon files (`smogon/<path>.json`), the same names `record-smogon-fixtures.mjs` writes. */
const recordedSmogon = (): typeof fetch => (async (url: string | URL | Request) => {
  const raw = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
  const u = new URL(raw);
  const path = u.hostname === 'pkmn.github.io' ? u.pathname.replace(/^\/smogon\/data/, '') : u.pathname;
  const file = fileURLToPath(new URL(`smogon/${path.replace(/\/{2,}/g, '/').replace(/[^a-z0-9.]+/gi, '_')}.json`, FEEDBACK));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  const text = readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown, text: async () => text };
}) as unknown as typeof fetch;

/** The fixture object of one scene: what `tree-orchestrator.verify-scenes.spec.ts` reads, plus the build's own `source`. */
export async function buildBoard(scene: SceneBoard): Promise<Record<string, unknown>> {
  const replay = JSON.parse(readFileSync(new URL(`${scene.id}.json`, FEEDBACK), 'utf8')) as {
    log: string; id?: string; formatid?: string; players: [string, string];
  };
  const parsed = parseReplayLogWithObservations(replay.log);
  const { snapshots, observations } = parsed;
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? replay.id ?? scene.id, parsed, fetcher: recordedSmogon() });
  if (!built.teams) throw new Error(`no teams for ${scene.id}`);
  const { p1Team, p2Team } = built.teams;
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  let raw: string | null = null;
  await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, bringOnly: replayBringOnly(replay, snapshots) ?? undefined,
    deadlineMs: 900_000, targetTurn: scene.turn + 1, snapshot: snapshotFor(scene.turn + 1), playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor,
      onPosition: (turn: number, battle: Parameters<typeof State.serializeBattle>[0]) => {
        if (turn === scene.turn && raw === null) raw = JSON.stringify(State.serializeBattle(battle));
      },
    },
  } as unknown as Parameters<typeof reconstructBranchRuntime>[0]);
  if (!raw) throw new Error(`no boundary at turn ${scene.turn} for ${scene.id}`);
  const battle = deserializeBattleExact(raw);
  applyTargetCorrections(battle, snapshotFor(scene.turn));
  const serialized = JSON.stringify(State.serializeBattle(battle));
  const doubles = /\|gametype\|doubles/.test(replay.log);
  const settings = bankSettings(replay);
  const keepPlayed = bankKeepPlayed(snapshots.map(snapshot => snapshot.log), scene.turn, doubles, logRules(replay.log)) ?? null;
  return {
    id: scene.id,
    turn: scene.turn,
    gameType: doubles ? 'doubles' : 'singles',
    tera: settings.tera,
    sleepClause: settings.sleepClause,
    ruleset: settings.ruleset,
    faintedFraction: faintedShare(battle),
    keepPlayed,
    played: keepPlayed,
    sacks: detectSacks(allTurnEvents(replay.log)[scene.turn] ?? [], snapshots[scene.turn - 1] ?? null, logRules(replay.log)),
    source: `buildAppTeams through bankTeamsFor over test/e2e-feedback/fixtures/${scene.id}.json and its saved Smogon files (round 89, B5a)`,
    serialized,
  };
}

export const boardText = (board: Record<string, unknown>) => `${JSON.stringify(board, null, 1)}\n`;

export function writeBoard(scene: SceneBoard, board: Record<string, unknown>): void {
  writeFileSync(boardFile(scene), boardText(board));
}
