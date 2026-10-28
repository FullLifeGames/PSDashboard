import type { PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, ReplayData } from '@fulllifegames/replay-core';
import type { BranchSlotChoice, EvalPreferences } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from './branch-history';
import type { ViewLine } from './timeline';

/**
 * Round 77 (user gate 28.10.2026, "1a 2a 3a 4a 5a"): the app's state as one readable file for a bug
 * report. It holds what a reproduction needs (the replay, the sets the app played with, the variation
 * with every slot choice, the viewed position, the messages on screen) and nothing beyond what the user
 * gave the app. The recorded positions of the variation stay out: they are large, and the rebuild
 * recomputes them from the choices.
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
  /** The messages on screen when the file was written, by where they show. */
  messages: Record<string, string | null>;
  engine: { prefs: EvalPreferences; fastPlayOut: boolean; animateBranchTurns: boolean; playOutActive: boolean };
}

export type SupportStateInputs = Omit<SupportState, 'kind' | 'version' | 'variation'> & {
  variation: { startTurn: number | null; branching: boolean; history: BranchHistoryEntry[] };
};

export function buildSupportState(inputs: SupportStateInputs): SupportState {
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
  };
}

/** True for a file this app wrote (any later version reads its own kind). */
export function isSupportState(value: unknown): value is SupportState {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === SUPPORT_STATE_KIND
    && (value as { version?: unknown }).version === SUPPORT_STATE_VERSION;
}

/** "T28, main line (variation from turn 5, 1 turn)" — the position as the timeline bar names it. */
export function positionLabel(state: Pick<SupportState, 'view' | 'variation'>): string {
  const { view, variation } = state;
  const where = view.t0 ? 'T0 (team preview)' : `T${view.turn}, ${view.viewingVariation ? 'variation' : 'main line'}`;
  const turns = variation.history.filter(entry => entry.kind !== 'forced').length;
  if (variation.startTurn === null || turns === 0) return where;
  return `${where} (variation from turn ${variation.startTurn}, ${turns} ${turns === 1 ? 'turn' : 'turns'})`;
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
 * GitHub fills a form's text fields from query parameters named by their ids.
 */
export function issueUrl(state: SupportState, fileName: string): string {
  const message = screenMessage(state);
  const replay = state.replay ? `https://replay.pokemonshowdown.com/${state.replay.id}` : 'none loaded';
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    title: clip(`${state.replay?.id ?? 'PS Dashboard'}: ${message ?? positionLabel(state)}`),
    version: `${state.app.version} (${state.app.commit})`,
    replay,
    position: positionLabel(state),
    message: clip(message ?? ''),
    'state-file': `Drag ${fileName} (downloaded by "Report issue") into this box.`,
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}
