import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough, refusalsOfTurn } from './rebuild-through';

/**
 * Round 89 (#131, #144): the forced answers of the rebuild. A replacement request is answered from the log's switch lines, and a Revival
 * Blessing request from the log's `-heal ... [from] move: Revival Blessing` line. Before, the list kept the species of each switch line and
 * dropped its slot, so a pair written b before a filled the slots in the wrong order (VGC 2454075999: Ditto in p2b copied Raging Bolt instead
 * of Zamazenta), a request the log leaves half empty sent one bench body into two slots (Champions VGC 2682059865), and the revive request
 * took the next switch species or the first living body, which the simulator refuses ("You have to pass to a fainted Pokémon"; the
 * rebuild then plays `default`, the first fainted body of the party).
 *
 * Each row rebuilds a corpus game like the bank does, through the turn, and compares the turn's emitted block with the log's block. The
 * unit rows with the same causes are in `packages/eval-engine/test/forced-answers.spec.ts`.
 */

/** The revive lines of a block: the name of the body each `-heal ... [from] move: Revival Blessing` brings back. */
const revived = (lines: string[]): string[] =>
  lines.flatMap(line => line.match(/^\|-heal\|p[12]: ([^|]+)\|[^|]*\|\[from\] move: Revival Blessing/)?.[1] ?? []);
/** The switches of a block with their slot, and the Transform targets: what a replacement put on the field and what Imposter copied. */
const entrances = (lines: string[]): string[] =>
  lines.flatMap(line => /^\|switch\|/.test(line) ? [line.split('|').slice(1, 4).join('|')] : /^\|-transform\|/.test(line) ? [line.split('|').slice(1, 4).join('|')] : [])
    .sort();

const REVIVES = [
  { id: 'gen9championsou-2691945913', turn: 10, type: 'Champions OU', name: 'Samurott' },
  { id: 'gen9championsou-2692599072', turn: 5, type: 'Champions OU', name: 'Raichu' },
  { id: 'smogtours-gen9ou-746810', turn: 116, type: 'Gen 9 OU', name: 'Dondozo' },
  { id: 'gen9doublesou-2662174649', turn: 7, type: 'Doubles OU', name: 'Pawmot' },
  { id: 'gen9vgc2026regi-2573969087', turn: 6, type: 'VGC', name: 'Calyrex' },
  { id: 'gen9championsvgc2026regmc-2691996964', turn: 7, type: 'Champions VGC', name: 'Gholdengo' },
];

describe('the revive answer names the body the log revives (#131)', () => {
  for (const row of REVIVES) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}`, async () => {
      const { logged, emitted, refusals } = await rebuildThrough(row.id, row.turn);
      const want = revived(logged);
      expect(want.length, 'the log revives one body').toBe(1);
      expect(revived(emitted)).toEqual(want);
      // the simulator accepts the answer, so no refusal and no `default`
      expect(await refusalsOfTurn(row.id, row.turn, refusals)).toBe(0);
    }, 300_000);
  }
});

const SLOTS = [
  { id: 'gen9vgc2025regj-2454075999', turn: 2, type: 'VGC', what: 'Ditto enters p2a and copies Zamazenta', check: 'same' },
  // Doubles OU: the log writes p1b before p1a after the upkeep; the rebuild put the two bodies on the swapped slots.
  { id: 'gen9doublesou-2541045678-1ertvggdw53ukc02fm57whpqor02nrdpw', turn: 4, type: 'Doubles OU', what: 'Incineroar enters p1a, Dondozo p1b', check: 'same' },
  { id: 'gen9doublesou-2540933323-oyd64ua9y2vdpq5olnuxeqsd6mavqxvpw', turn: 4, type: 'Doubles OU', what: 'Landorus enters p1a, Moltres p1b', check: 'same' },
  // The log replaces p2a and p2b; the rebuild asks for p2b only (it did not knock out p2a's body): p2b takes the body the log names for p2b.
  { id: 'gen9doublesou-2540881163-kjrg80o41xdbjc2icm49ms5de61au5mpw', turn: 3, type: 'Doubles OU', what: 'p2b takes the body of p2b', check: 'within' },
  // The rebuild knocks out both p2 actives where the log knocks out one (a drift of the damage); the second slot has no logged body,
  // and its fallback must not take the body the first slot took.
  { id: 'gen9championsvgc2026regmbbo3-2682059865', turn: 1, type: 'Champions VGC', what: 'two different bench bodies', check: 'distinct' },
];

describe('a forced replacement enters the slot the log names (#144)', () => {
  for (const row of SLOTS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      const { logged, emitted, refusals } = await rebuildThrough(row.id, row.turn);
      if (row.check === 'same') expect(entrances(emitted)).toEqual(entrances(logged));
      else if (row.check === 'within') {
        const switches = entrances(emitted).filter(line => line.startsWith('switch|p2'));
        expect(switches.length).toBeGreaterThan(0);
        expect(switches.every(line => entrances(logged).includes(line))).toBe(true);
      } else {
        const sent = emitted.filter(line => line.startsWith('|switch|')).map(line => line.split('|')[3]);
        expect(sent.length).toBeGreaterThan(1);
        expect(new Set(sent).size).toBe(sent.length);
        expect(entrances(logged).every(entrance => entrances(emitted).includes(entrance))).toBe(true);
      }
      expect(await refusalsOfTurn(row.id, row.turn, refusals)).toBe(0);
    }, 300_000);
  }
});
