// The replay client reads the table only in battledata.js (ModdedDex): the generation's entry up to Gen 8, the mods'.
// A worker cuts that part (1.14 of 15.8 MB); test/e2e/teambuilder-table.spec.ts compares the Dex over part and whole.

export const TEAMBUILDER_TABLE_URL = 'https://play.pokemonshowdown.com/data/teambuilder-tables.js';

export const TABLE_PART_MODS = ['champions', 'gen7letsgo', 'gen9ssb'] as const;

const GENERATION_KEY = /^gen[1-8]$/;

export function cutTablePart(table: Record<string, unknown>): Record<string, unknown> {
  const mods: readonly string[] = TABLE_PART_MODS;
  return Object.fromEntries(Object.entries(table).filter(([key]) => GENERATION_KEY.test(key) || mods.includes(key)));
}

export function tablePartScript(table: Record<string, unknown>): string {
  return `window.BattleTeambuilderTable = JSON.parse(${JSON.stringify(JSON.stringify(cutTablePart(table)))});\n`;
}

/** Wraps `EMBED_SCRIPT_ORDER_SCRIPT`: the part keeps the table's place in the order and fires its own load event. */
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

export function teambuilderTablePartUrl(): string | undefined {
  return partUrl;
}

/** Once false, never true again. */
export function tablePartPending(): boolean {
  return waiting;
}

export function subscribeTablePart(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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
    settle();
  }
}
