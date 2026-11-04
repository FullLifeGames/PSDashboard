/**
 * Round 85 (T318): the part of Showdown's teambuilder table a replay frame reads. Every frame document ran
 * `data/teambuilder-tables.js` (15.8 MB, one `JSON.parse`): 185 to 200 ms on the app's main thread at load and 140 to 185 ms
 * again at every variation start, since the frame is a same-origin blob document. The replay client reads the table only in
 * `battledata.js` (ModdedDex): `BattleTeambuilderTable["gen" + i]` for the generations from the replay's own up to
 * Generation 8, and `BattleTeambuilderTable[modid]` for the mods it builds a Dex for (`battle.js`: `Dex.forGen`,
 * `Dex.mod('champions')`, `Dex.mod('gen7letsgo')`, `Dex.mod('gen9ssb')`). A worker cuts that part once per session (1.14 MB
 * of 15.8 MB), and the frame's script hook loads the part's script in place of Showdown's file. Until the part is ready, or
 * when the worker fails, frames load Showdown's file as before. The e2e sweep `test/e2e/teambuilder-table.spec.ts` compares
 * the client's Dex over the part with its Dex over the whole table, entry by entry, for every generation and these mods.
 */

/** Showdown's table, as the replay embed requests it (with a version query). */
export const TEAMBUILDER_TABLE_URL = 'https://play.pokemonshowdown.com/data/teambuilder-tables.js';

/** The mods the replay client builds a Dex for besides the generations (battle.js, the `tier` handler). */
export const TABLE_PART_MODS = ['champions', 'gen7letsgo', 'gen9ssb'] as const;

const GENERATION_KEY = /^gen[1-8]$/;

/** The keys of the table the replay client reads, whole. */
export function cutTablePart(table: Record<string, unknown>): Record<string, unknown> {
  const mods: readonly string[] = TABLE_PART_MODS;
  return Object.fromEntries(Object.entries(table).filter(([key]) => GENERATION_KEY.test(key) || mods.includes(key)));
}

/** The script a frame runs in place of Showdown's file: it sets the global the client reads (the embed sets `exports = window`). */
export function tablePartScript(table: Record<string, unknown>): string {
  return `window.BattleTeambuilderTable = JSON.parse(${JSON.stringify(JSON.stringify(cutTablePart(table)))});\n`;
}

/**
 * The frame's hook: the embed appends its scripts to <head>, and the table's script takes the part's URL instead. It wraps
 * the order hook (`EMBED_SCRIPT_ORDER_SCRIPT`), so the part keeps the table's place in the embed's order and fires its own
 * load event.
 */
export function tableSwapScript(partUrl: string): string {
  return `<script>
(function () {
  var head = window.document && document.head;
  if (!head) return;
  var append = head.appendChild;
  var table = ${JSON.stringify(TEAMBUILDER_TABLE_URL)};
  var part = ${JSON.stringify(partUrl)};
  head.appendChild = function (node) {
    if (node && node.tagName === 'SCRIPT' && node.src && node.src.split('?')[0] === table) node.src = part;
    return append.call(head, node);
  };
})();
</script>`;
}

/**
 * How long after the app starts a new frame document waits for the part. The worker answers about 1 s after navigation on
 * the user's machine (round 85 probe); a replay loaded right away waits for it instead of running the whole table, and the
 * wait never reaches past this mark.
 */
export const TABLE_PART_WAIT_MS = 1500;

let partUrl: string | undefined;
let started = false;
let waiting = false;
const listeners = new Set<() => void>();

const settle = () => {
  if (!waiting) return;
  waiting = false;
  for (const listener of listeners) listener();
};

/** The URL of the part's script once the worker has cut it; undefined before and after a failure. */
export function teambuilderTablePartUrl(): string | undefined {
  return partUrl;
}

/** Whether a new frame document waits for the part: only while the worker runs and before `TABLE_PART_WAIT_MS`. Once false, never true again. */
export function tablePartPending(): boolean {
  return waiting;
}

export function subscribeTablePart(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts the worker once per session; a frame built after the wait and before the answer loads Showdown's file. */
export function startTeambuilderTablePart(): void {
  if (started || typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  started = true;
  try {
    const worker = new Worker(new URL('../workers/teambuilder-table-worker.ts', import.meta.url), { type: 'module' });
    waiting = true;
    setTimeout(settle, TABLE_PART_WAIT_MS);
    worker.onmessage = (event: MessageEvent<{ script?: string }>) => {
      if (typeof event.data?.script === 'string') {
        partUrl = URL.createObjectURL(new Blob([event.data.script], { type: 'text/javascript' }));
        // The moment the part is ready, for the round's probe and the browser's own performance tools.
        performance.mark('teambuilder-table-part');
      }
      worker.terminate();
      settle();
    };
    worker.onerror = () => {
      worker.terminate();
      settle();
    };
  } catch {
    // No worker: frames keep Showdown's file.
    settle();
  }
}
