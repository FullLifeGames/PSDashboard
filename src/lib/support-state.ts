import type { PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, ReplayData } from '@fulllifegames/replay-core';
import type { BranchSlotChoice, EvalPreferences } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from './branch-history';
import type { ViewLine } from './timeline';
import { turnEntryCount } from './variation-turns';
import { isGameId, type NewGameRecord } from './new-game/record';

/**
 * Round 77 (user gate 28.10.2026, "1a 2a 3a 4a 5a"): the app's state as one readable file for a bug
 * report. It holds what a reproduction needs (the replay, the sets the app played with, the variation
 * with every slot choice, the viewed position, the messages on screen) and nothing beyond what the user
 * gave the app. The recorded positions of the variation stay out: they are large, and the rebuild
 * recomputes them from the choices.
 *
 * Round 89 (#105, H5): a new game has no replay to load, so its file carries the game's record in the optional `game` (the format,
 * both teams, the seed and every turn; its log is `replay.log`), and the restore opens the game from it. The version stays 1: a
 * new optional field is no break, a replay's file is the file of before to the byte, and an app that reads version 1 only meets a
 * game file at "Load the replay newgame-... first", a refusal and no misreading.
 */
export const SUPPORT_STATE_KIND = 'ps-dashboard-state';
export const SUPPORT_STATE_VERSION = 1;
export const NEW_ISSUE_URL = 'https://github.com/FullLifeGames/PSDashboard/issues/new';
export const CREATOR_URL = 'https://fulllifegames.com';

type Choices = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };
export type SupportHistoryEntry = Omit<BranchHistoryEntry, 'serializedPosition'>;

export interface SupportState {
  kind: typeof SUPPORT_STATE_KIND;
  version: typeof SUPPORT_STATE_VERSION;
  createdAt: string;
  app: { version: string; commit: string; url: string; embed: boolean };
  browser: { userAgent: string; width: number; height: number; pixelRatio: number };
  replay: Pick<ReplayData, 'id' | 'format' | 'formatid' | 'players' | 'log' | 'uploadtime' | 'rating' | 'viewpoint'> | null;
  knowledge: { teamText: string; editedP1Info: OpponentTeamInfo | null; editedP2Info: OpponentTeamInfo | null };
  /** The teams the app builds right now (null when no build was at hand). */
  builtSets: { p1Team: PokemonSet[]; p2Team: PokemonSet[] } | null;
  variation: { startTurn: number | null; branching: boolean; history: SupportHistoryEntry[] };
  view: { turn: number; line: ViewLine; t0: boolean; viewingVariation: boolean; liveTip: boolean };
  choices: { draft: Choices; live: Choices };
  /** Round 89 (#105, H5): the record of the open new game; absent for a replay (no key at all). */
  game?: NewGameRecord;
  /** The messages on screen when the file was written, by where they show. */
  messages: Record<string, string | null>;
  engine: { prefs: EvalPreferences; fastPlayOut: boolean; animateBranchTurns: boolean; playOutActive: boolean };
}

/** An open "Report issue" dialog: the file it offers, the filled issue link, and whether the file went out. */
export interface IssueReport {
  fileName: string;
  issueUrl: string;
  downloaded: boolean;
}

export type SupportStateInputs = Omit<SupportState, 'kind' | 'version' | 'variation' | 'game'> & {
  variation: { startTurn: number | null; branching: boolean; history: BranchHistoryEntry[] };
  game?: NewGameRecord | null;
};

export function buildSupportState({ game, ...inputs }: SupportStateInputs): SupportState {
  const history = inputs.variation.history.map(entry => {
    const kept: Partial<BranchHistoryEntry> = { ...entry };
    delete kept.serializedPosition;
    return kept as SupportHistoryEntry;
  });
  return {
    kind: SUPPORT_STATE_KIND,
    version: SUPPORT_STATE_VERSION,
    ...inputs,
    replay: inputs.replay && {
      id: inputs.replay.id, format: inputs.replay.format, formatid: inputs.replay.formatid, players: inputs.replay.players,
      log: inputs.replay.log, uploadtime: inputs.replay.uploadtime, rating: inputs.replay.rating, viewpoint: inputs.replay.viewpoint,
    },
    variation: { ...inputs.variation, history },
    ...(game ? { game } : {}),
  };
}

/** True for a file this app wrote (any later version reads its own kind). */
export function isSupportState(value: unknown): value is SupportState {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === SUPPORT_STATE_KIND
    && (value as { version?: unknown }).version === SUPPORT_STATE_VERSION;
}

const NOT_A_STATE = `Not a PS Dashboard state file (kind ${SUPPORT_STATE_KIND}, version ${SUPPORT_STATE_VERSION}).`;

/** Why a value is no file this app reads, in words for the restore's error; null for a file it reads. */
export function supportStateProblem(value: unknown): string | null {
  if (isSupportState(value)) return null;
  const file = value as { kind?: unknown; version?: unknown } | null;
  if (file && typeof file === 'object' && file.kind === SUPPORT_STATE_KIND && typeof file.version === 'number' && file.version > SUPPORT_STATE_VERSION) {
    return `This state file has version ${file.version}; this app reads version ${SUPPORT_STATE_VERSION}. Open it in a newer PS Dashboard.`;
  }
  return NOT_A_STATE;
}

/** "T7 in the variation from turn 5 (2 turns)", "T28 on the main line (variation from turn 5, 2 turns)": the line once. */
export function positionLabel(state: Pick<SupportState, 'view' | 'variation' | 'game'>): string {
  const { view, variation } = state;
  const turns = turnEntryCount(variation.history);
  const length = `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
  const hasVariation = variation.startTurn !== null && turns > 0;
  if (!view.t0 && view.viewingVariation && hasVariation) return `T${view.turn} in the variation from turn ${variation.startTurn} (${length})`;
  // a finished game's last position is the timeline's End, not one more turn (the record's turns are the finished ones)
  const atEnd = !!state.game && view.turn > state.game.turns && state.game.body.some(line => line.startsWith('|win|'));
  const where = view.t0 ? 'T0, the team preview' : atEnd ? 'the End of the main line' : `T${view.turn} on the main line`;
  return hasVariation ? `${where} (variation from turn ${variation.startTurn}, ${length})` : where;
}

/** The first message on screen, in the order a reader looks for it. */
export function screenMessage(state: Pick<SupportState, 'messages'>): string | null {
  return Object.values(state.messages).find((text): text is string => typeof text === 'string' && text.trim() !== '') ?? null;
}

export function supportFileName(state: Pick<SupportState, 'replay' | 'createdAt'>): string {
  const id = (state.replay?.id ?? 'no-replay').replace(/[^a-z0-9-]+/gi, '-');
  const stamp = state.createdAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return `ps-dashboard-state-${id}-${stamp}.json`;
}

/** The longest field text the issue link carries: GitHub refuses a URL past its limit (414). */
const FIELD_MAX = 600;
const clip = (text: string) => (text.length > FIELD_MAX ? `${text.slice(0, FIELD_MAX - 1)}…` : text);

/**
 * The new-issue link with the issue form's fields filled (`.github/ISSUE_TEMPLATE/bug_report.yml`):
 * GitHub fills a form's text fields from query parameters named by their ids. The state file goes into the form's upload
 * field, which no link fills (round 88, user report 08.11.2026: the text box took no .json file). GitHub reads forms from the
 * default branch only, and without the form it opens a blank issue: the description then carries the same
 * facts (round 77, user report 28.10.2026: the issue held the title alone).
 */
export function issueUrl(state: SupportState, fileName: string): string {
  const message = screenMessage(state);
  // a new game has no Showdown page: its id, format, seed and turns stand in the field (the state file carries the record)
  const played = state.game ? `, seed ${state.game.seed}, ${state.game.turns} ${state.game.turns === 1 ? 'turn' : 'turns'} played` : '';
  const replay = !state.replay ? 'none loaded'
    : isGameId(state.replay.id) ? `New game ${state.replay.id}, ${state.replay.format}${played} (no Showdown replay)`
      : `https://replay.pokemonshowdown.com/${state.replay.id}`;
  const version = `${state.app.version} (${state.app.commit})`;
  const position = positionLabel(state);
  const stateFile = `Attach ${fileName} (downloaded by "Report issue") to this issue.`;
  const body = [
    '### What happened?', '', 'The steps that led there, what you saw, and what you expected instead.', '',
    '### State file', '', stateFile, '',
    `**App version:** ${version}`, `**Replay:** ${replay}`, `**Position:** ${position}`,
    ...(message ? [`**Message on screen:** ${clip(message)}`] : []),
  ].join('\n');
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    title: clip(`${state.replay?.id ?? 'PS Dashboard'}: ${message ?? position}`),
    version,
    replay,
    position,
    message: clip(message ?? ''),
    body,
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}
