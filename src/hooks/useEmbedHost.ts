import { useEffect, useRef, useState } from 'react';
import { looksLikeReplayFileContent } from '../lib/replay-file';
import type { LoadReplayResult } from './useReplay';

interface EmbedHostOptions {
  loadReplay: (urlOrId: string) => Promise<LoadReplayResult>;
  loadReplayFile: (content: string, fileName?: string) => Promise<LoadReplayResult>;
}

export interface EmbedHostState {
  /** `?embed=1` — the app is framed by another site and hides its chrome. */
  embed: boolean;
  /** `?replay=<id|url>` — replay to load on startup. */
  requestedReplay: string | null;
}

/**
 * Lets another site drive the app: `?replay=` deep links auto-load a replay,
 * `?embed=1` strips the chrome for iframe use, and the host page can post
 * `{ type: 'ps-load-replay', replay }` where `replay` is an id, a URL, a raw
 * protocol log, or a full exported replay HTML document. The app answers with
 * `ps-embed-ready` / `ps-replay-loaded` / `ps-replay-error`.
 *
 * These message types are disjoint from the internal replay viewer protocol
 * (`ps-turn`, `ps-seek-turn`, `ps-append-log`, `ps-replay-ready`), so both
 * listeners can share the window.
 */
export function useEmbedHost({ loadReplay, loadReplayFile }: EmbedHostOptions): EmbedHostState {
  const [config] = useState<EmbedHostState>(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      embed: params.get('embed') === '1',
      requestedReplay: params.get('replay'),
    };
  });
  const autoLoadedRef = useRef(false);

  useEffect(() => {
    if (!config.requestedReplay || autoLoadedRef.current) return;
    // A #branch= share link owns the view — don't fetch a replay behind it.
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
          // The host window is gone — nothing to answer.
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
