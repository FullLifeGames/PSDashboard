import { afterEach, describe, expect, test, vi } from 'vitest';
import { generateReplayHtml } from '../../../src/lib/replay-html';
import { EMBED_SCRIPT_ORDER_SCRIPT } from '../../../src/lib/replay-compat';
import {
  TABLE_PART_MODS, cutTablePart, tablePartScript, tableSwapScript,
} from '../../../src/lib/teambuilder-table';

/**
 * Round 85 (T318): every replay frame ran Showdown's `data/teambuilder-tables.js` (15.8 MB, 185 ms at load and again at every
 * variation start), of which the replay client reads the generation tables `gen1` to `gen8` and the mods it names
 * (`battledata.js` ModdedDex; `battle.js` Dex.mod). A worker cuts that part once per session; the frame's script hook swaps
 * the table's source for the part's script. The e2e sweep (`test/e2e/teambuilder-table.spec.ts`) holds the part to the client.
 */
const table = {
  tiers: ['header'], learnsets: { pikachu: {} }, overrideTier: {}, metagameBans: {}, natdexchampions: { x: 1 }, gen9dlc1: { y: 2 },
  gen9: { z: 3 }, gen8: { overrideMoveData: { a: 1 } }, gen7: {}, gen6: {}, gen5: {}, gen4: {}, gen3: {}, gen2: {}, gen1: { b: 2 },
  gen8dlc1: { c: 3 }, gen9vgc: {}, champions: { learnsets: {} }, gen7letsgo: { tiers: [] }, gen9ssb: { overrideItemData: {} },
};

describe('the part of the teambuilder table a replay reads', () => {
  test('keeps gen1 to gen8 and the mods the client names, whole, and nothing else', () => {
    const part = cutTablePart(table);
    expect(Object.keys(part).sort()).toEqual(['champions', 'gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen7letsgo', 'gen8', 'gen9ssb']);
    expect(part.gen8).toEqual(table.gen8);
    expect(part.champions).toEqual(table.champions);
    expect(TABLE_PART_MODS).toEqual(['champions', 'gen7letsgo', 'gen9ssb']);
  });

  test('the part\'s script sets the table the client reads', () => {
    const window: Record<string, unknown> = {};
    new Function('window', tablePartScript(table))(window);
    expect(window.BattleTeambuilderTable).toEqual(cutTablePart(table));
  });
});

describe('the frame takes the part instead of Showdown\'s table', () => {
  const opts = { log: '|turn|1', format: 'gen9ou', p1: 'A', p2: 'B' };

  test('with a part, the swap script stands after the order hook and before the embed loader; without, the page is as before', () => {
    const html = generateReplayHtml({ ...opts, teambuilderTableUrl: 'blob:http://localhost/part' });
    const swap = tableSwapScript('blob:http://localhost/part');
    expect(html).toContain(swap);
    expect(html.indexOf(EMBED_SCRIPT_ORDER_SCRIPT)).toBeLessThan(html.indexOf(swap));
    expect(html.indexOf(swap)).toBeLessThan(html.indexOf('replay-embed.js'));
    expect(generateReplayHtml(opts)).toBe(html.replace(`${swap}\n`, ''));
  });

  test('the hook swaps the table\'s source and leaves every other script alone', () => {
    const doc = document.implementation.createHTMLDocument('frame');
    const run = (script: string) => new Function('window', 'document', script.replace(/^<script>|<\/script>$/g, ''))({ document: doc }, doc);
    run(EMBED_SCRIPT_ORDER_SCRIPT);
    run(tableSwapScript('blob:http://localhost/part'));
    const append = (src: string) => {
      const node = doc.createElement('script');
      node.src = src;
      doc.head.appendChild(node);
      return node;
    };
    const tableNode = append('https://play.pokemonshowdown.com/data/teambuilder-tables.js?a7');
    const movesNode = append('https://play.pokemonshowdown.com/data/moves.js?a7');
    expect(tableNode.src).toBe('blob:http://localhost/part');
    expect(tableNode.async).toBe(false);
    expect(movesNode.src).toBe('https://play.pokemonshowdown.com/data/moves.js?a7');
    expect(movesNode.async).toBe(false);
  });
});

describe('a new frame waits for the part only while the worker runs, at most until TABLE_PART_WAIT_MS', () => {
  /** A worker that answers when the test says so. */
  class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() { FakeWorker.last = this; }
    terminate() { this.terminated = true; }
  }

  async function freshModule() {
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker);
    return import('../../../src/lib/teambuilder-table');
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('the answer ends the wait and gives the part\'s URL; listeners hear it once', async () => {
    vi.useFakeTimers();
    const store = await freshModule();
    expect(store.tablePartPending(), 'before the start nothing waits').toBe(false);
    const heard = vi.fn();
    store.subscribeTablePart(heard);
    store.startTeambuilderTablePart();
    expect(store.tablePartPending()).toBe(true);
    FakeWorker.last!.onmessage!({ data: { script: 'window.BattleTeambuilderTable = {};' } });
    expect(store.tablePartPending()).toBe(false);
    expect(store.teambuilderTablePartUrl()).toMatch(/^blob:/);
    expect(FakeWorker.last!.terminated).toBe(true);
    vi.advanceTimersByTime(store.TABLE_PART_WAIT_MS);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('a silent worker ends the wait at TABLE_PART_WAIT_MS; a late answer gives the URL and never makes frames wait again', async () => {
    vi.useFakeTimers();
    const store = await freshModule();
    store.startTeambuilderTablePart();
    vi.advanceTimersByTime(store.TABLE_PART_WAIT_MS - 1);
    expect(store.tablePartPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.tablePartPending()).toBe(false);
    expect(store.teambuilderTablePartUrl()).toBeUndefined();
    FakeWorker.last!.onmessage!({ data: { script: 'window.BattleTeambuilderTable = {};' } });
    expect(store.tablePartPending()).toBe(false);
    expect(store.teambuilderTablePartUrl()).toMatch(/^blob:/);
  });

  test('a failed worker ends the wait without a URL, and a second start starts nothing', async () => {
    const store = await freshModule();
    store.startTeambuilderTablePart();
    const first = FakeWorker.last;
    first!.onmessage!({ data: {} });
    expect(store.tablePartPending()).toBe(false);
    expect(store.teambuilderTablePartUrl()).toBeUndefined();
    store.startTeambuilderTablePart();
    expect(FakeWorker.last).toBe(first);
  });
});
