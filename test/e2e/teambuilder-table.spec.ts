import { test, expect, type Frame, type Page } from '@playwright/test';
import { generateReplayHtml } from '../../src/lib/replay-html';
import { TABLE_PART_MODS, TEAMBUILDER_TABLE_URL, cutTablePart, tablePartScript } from '../../src/lib/teambuilder-table';

/**
 * Round 85 (T318): the sweep behind the part of the teambuilder table. Two replay frames, built by the app's own builder: one
 * loads Showdown's whole `teambuilder-tables.js`, the other the part's script through the swap hook. In each, the replay
 * client's Dex reads every species, move, item, ability and type its data lists, for every generation (`Dex.mod('gen1')` to
 * `Dex.mod('gen8')` and the Generation 9 `Dex`) and every mod the client names (`TABLE_PART_MODS`). The part holds when both
 * frames read the same for every entry; a read of a key the part lacks throws and fails its row.
 */
test.setTimeout(180_000);

const LOG = '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n|player|p1|A|1\n|player|p2|B|2\n|turn|1';
const DEXES = ['gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen8', 'gen9', ...TABLE_PART_MODS];

async function wholeTable(): Promise<Record<string, unknown>> {
  const response = await fetch(TEAMBUILDER_TABLE_URL);
  expect(response.ok).toBe(true);
  const exports: { BattleTeambuilderTable?: Record<string, unknown> } = {};
  new Function('exports', await response.text())(exports);
  return exports.BattleTeambuilderTable!;
}

/** Mounts two frames side by side: `whole` with Showdown's table, `part` with the part's script through the swap hook. */
async function mountFrames(page: Page, partScript: string): Promise<{ whole: Frame; part: Frame }> {
  await page.goto('/');
  // Blob URLs belong to the page's origin, so the page makes the part's URL; the app's builder then writes both documents.
  const partUrl = await page.evaluate(script => URL.createObjectURL(new Blob([script], { type: 'text/javascript' })), partScript);
  const docs = {
    whole: generateReplayHtml({ log: LOG, format: 'gen9ou' }),
    part: generateReplayHtml({ log: LOG, format: 'gen9ou', teambuilderTableUrl: partUrl }),
  };
  await page.evaluate(htmlByName => {
    document.body.innerHTML = '';
    for (const [name, html] of Object.entries(htmlByName)) {
      const frame = document.createElement('iframe');
      frame.name = name;
      frame.style.width = '1200px';
      frame.style.height = '600px';
      frame.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      document.body.appendChild(frame);
    }
  }, docs);
  const frameOf = (name: string) => page.frames().find(frame => frame.name() === name);
  const ready = () => {
    const w = window as unknown as Record<string, unknown>;
    return !!w.Dex && !!w.BattleTeambuilderTable && !!w.BattlePokedex && !!w.BattleMovedex && !!w.BattleItems && !!w.BattleAbilities;
  };
  for (const name of ['whole', 'part']) {
    await expect.poll(async () => frameOf(name)?.evaluate(ready).catch(() => false), { timeout: 90_000 }).toBe(true);
  }
  return { whole: frameOf('whole')!, part: frameOf('part')! };
}

/** Every entry the client's data lists, read through one Dex, as one string per kind (a throw reads as its message). */
function readDex(dexId: string): Record<string, string[]> {
  type Getter = { get: (id: string) => unknown };
  type ClientDex = { species: Getter; moves: Getter; items: Getter; abilities: Getter; types: Getter; mod: (id: string) => ClientDex };
  const w = window as unknown as {
    Dex: ClientDex; BattlePokedex: Record<string, { types?: string[] }>;
    BattleMovedex: object; BattleItems: object; BattleAbilities: object;
  };
  const dex = dexId === 'gen9' ? w.Dex : w.Dex.mod(dexId);
  const read = (get: (id: string) => unknown, ids: string[]) => ids.map(id => {
    try {
      return `${id} ${JSON.stringify(get(id))}`;
    } catch (error) {
      return `${id} throws ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  return {
    species: read(id => dex.species.get(id), Object.keys(w.BattlePokedex)),
    moves: read(id => dex.moves.get(id), Object.keys(w.BattleMovedex)),
    items: read(id => dex.items.get(id), Object.keys(w.BattleItems)),
    abilities: read(id => dex.abilities.get(id), Object.keys(w.BattleAbilities)),
    // The embed loads no type chart; the type names come from the species the client lists.
    types: read(id => dex.types.get(id), [...new Set(Object.values(w.BattlePokedex).flatMap(entry => entry.types ?? []))]),
  };
}

test('the part of the teambuilder table reads like the whole table, for every generation and mod the replay client names', async ({ page }) => {
  const table = await wholeTable();
  const { whole, part } = await mountFrames(page, tablePartScript(table));

  // The part's frame never asked Showdown for the table, and holds exactly the part's keys.
  const fetchedTable = (frame: Frame) => frame.evaluate(table => performance.getEntriesByType('resource').some(entry => entry.name.split('?')[0] === table), TEAMBUILDER_TABLE_URL);
  expect(await fetchedTable(whole), 'the whole frame loads Showdown\'s table').toBe(true);
  expect(await fetchedTable(part), 'the part frame loads the part instead').toBe(false);
  const keys = (frame: Frame) => frame.evaluate(() => Object.keys((window as unknown as { BattleTeambuilderTable: object }).BattleTeambuilderTable).sort());
  expect(await keys(part)).toEqual(Object.keys(cutTablePart(table)).sort());

  for (const dexId of DEXES) {
    const [fromWhole, fromPart] = await Promise.all([whole.evaluate(readDex, dexId), part.evaluate(readDex, dexId)]);
    for (const kind of Object.keys(fromWhole)) {
      expect(fromWhole[kind].length, `${dexId} ${kind}: the client lists entries`).toBeGreaterThan(0);
      const differing = fromWhole[kind].filter((line, index) => line !== fromPart[kind][index]).slice(0, 3);
      expect(differing, `${dexId} ${kind}: entries the part reads differently`).toEqual([]);
      expect(fromPart[kind].some(line => / throws /.test(line) && !fromWhole[kind].includes(line)), `${dexId} ${kind}: a read throws only with the part`).toBe(false);
    }
  }
});
