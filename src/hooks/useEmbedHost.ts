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
  embed: boolean;
  requestedReplay: string | null;
  /** `?turn=<n>`, read once; null for no turn, a non-number, or when a share link or held game overrides the link. */
  requestedTurn: number | null;
  requestedGame: string | null;
}

/** Host-page contract: `ps-load-replay` in; `ps-embed-ready` / `ps-replay-loaded` / `ps-replay-error` out. */
export function useEmbedHost({ loadReplay, loadReplayFile }: EmbedHostOptions): EmbedHostState {
  const [config] = useState<EmbedHostState>(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedGame = params.get('game');
    const requestedReplay = requestedGame && loadGame(requestedGame) ? null : params.get('replay');
    return {
      embed: params.get('embed') === '1',
      requestedReplay,
      requestedTurn: requestedReplay === null || window.location.hash.startsWith('#branch=') ? null : parseRequestedTurn(params.get('turn')),
      requestedGame,
    };
  });
  const autoLoadedRef = useRef(false);

  useEffect(() => {
    if (!config.requestedReplay || autoLoadedRef.current) return;
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
