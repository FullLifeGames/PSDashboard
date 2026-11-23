import { useEffect, useRef, useState } from 'react';
import { looksLikeReplayFileContent } from '../lib/replay-file';
import { loadGame } from '../lib/new-game/store';
import type { LoadReplayResult } from './useReplay';
import { parseRequestedTurn } from './useRequestedTurn';

interface EmbedHostOptions {
  loadReplay: (urlOrId: string) => Promise<LoadReplayResult>;
  loadReplayFile: (content: string, fileName?: string) => Promise<LoadReplayResult>;
}

export interface EmbedHostState {
  /** `?embed=1`: the app is framed by another site and hides its chrome. */
  embed: boolean;
  /** `?replay=<id|url>`: replay to load on startup. */
  requestedReplay: string | null;
  /** `?turn=<n>`: the turn to open that replay on (read once; null for no turn, a non-number, or a link a share link or a held game overrides). */
  requestedTurn: number | null;
  /** `?game=<id>`: the saved game the address names (opened by `useOpenAddress`). */
  requestedGame: string | null;
}

/**
 * Lets another site drive the app: `?replay=` auto-loads a replay, `&turn=<n>` opens it on that turn (`useRequestedTurn`), `?embed=1`
 * strips the chrome, and the host page can post `{ type: 'ps-load-replay', replay }` (an id, a URL, a raw protocol log or an exported
 * replay HTML). The app answers with `ps-embed-ready` / `ps-replay-loaded` / `ps-replay-error`; these types are disjoint from the
 * internal viewer protocol (`ps-turn`, `ps-seek-turn`, `ps-append-log`, `ps-replay-ready`), so both listeners share the window.
 */
export function useEmbedHost({ loadReplay, loadReplayFile }: EmbedHostOptions): EmbedHostState {
  const [config] = useState<EmbedHostState>(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedGame = params.get('game');
    // a saved game the address names is the game to open; a game this browser does not hold leaves the replay link its way
    const requestedReplay = requestedGame && loadGame(requestedGame) ? null : params.get('replay');
    return {
      embed: params.get('embed') === '1',
      requestedReplay,
      // the turn belongs to the replay link; a #branch= share link owns the view and brings its own turn
      requestedTurn: requestedReplay === null || window.location.hash.startsWith('#branch=') ? null : parseRequestedTurn(params.get('turn')),
      requestedGame,
    };
  });
  const autoLoadedRef = useRef(false);

  useEffect(() => {
    if (!config.requestedReplay || autoLoadedRef.current) return;
    // A #branch= share link owns the view: no replay fetch behind it.
    if (window.location.hash.startsWith('#branch=')) return;
    autoLoadedRef.current = true;
    void loadReplay(config.requestedReplay);
  }, [config.requestedReplay, loadReplay]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; replay?: unknown } | null;
      if (!data || data.type !== 'ps-load-replay' || typeof data.replay !== 'string') return;
      const replay = data.replay;
      const source = event.source as Window | null;

      void (async () => {
        const result = looksLikeReplayFileContent(replay)
          ? await loadReplayFile(replay, 'host-replay')
          : await loadReplay(replay);
        try {
          source?.postMessage(result.data
            ? { type: 'ps-replay-loaded', id: result.data.id, format: result.data.formatid }
            : { type: 'ps-replay-error', message: result.error ?? 'Unknown error' }, '*');
        } catch {
          // The host window is gone: nothing to answer.
        }
      })();
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [loadReplay, loadReplayFile]);

  useEffect(() => {
    if (!config.embed || window.parent === window) return;
    window.parent.postMessage({ type: 'ps-embed-ready' }, '*');
  }, [config.embed]);

  return config;
}
