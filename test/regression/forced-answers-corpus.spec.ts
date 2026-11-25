import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough, refusalsOfTurn } from './rebuild-through';


// Each answer keeps the slot of its switch line: a pair written b before a fills the slots in the log's order.
const revived = (lines: string[]): string[] =>
  lines.flatMap(line => line.match(/^\|-heal\|p[12]: ([^|]+)\|[^|]*\|\[from\] move: Revival Blessing/)?.[1] ?? []);
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

describe('the revive answer names the body the log revives', () => {
  for (const row of REVIVES) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}`, async () => {
      const { logged, emitted, refusals } = await rebuildThrough(row.id, row.turn);
      const want = revived(logged);
      expect(want.length, 'the log revives one body').toBe(1);
      expect(revived(emitted)).toEqual(want);
      expect(await refusalsOfTurn(row.id, row.turn, refusals)).toBe(0);
    }, 300_000);
  }
});

const SLOTS = [
  { id: 'gen9vgc2025regj-2454075999', turn: 2, type: 'VGC', what: 'Ditto enters p2a and copies Zamazenta', check: 'same' },
  { id: 'gen9doublesou-2541045678-1ertvggdw53ukc02fm57whpqor02nrdpw', turn: 4, type: 'Doubles OU', what: 'Incineroar enters p1a, Dondozo p1b', check: 'same' },
  { id: 'gen9doublesou-2540933323-oyd64ua9y2vdpq5olnuxeqsd6mavqxvpw', turn: 4, type: 'Doubles OU', what: 'Landorus enters p1a, Moltres p1b', check: 'same' },
  { id: 'gen9doublesou-2540881163-kjrg80o41xdbjc2icm49ms5de61au5mpw', turn: 3, type: 'Doubles OU', what: 'p2b takes the body of p2b', check: 'within' },
  { id: 'gen9championsvgc2026regmbbo3-2682059865', turn: 1, type: 'Champions VGC', what: 'two different bench bodies', check: 'distinct' },
];

describe('a forced replacement enters the slot the log names', () => {
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
