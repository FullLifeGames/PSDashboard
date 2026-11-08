import { appendFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { FIXTURES, rebuild, type FixtureId, type GameType } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B12 (T306): the faint step plays the last roll step first. A roll step moves the hits on
 * the bodies of the mismatch one place along their order; the last step is the extreme of every order (the hardest hit of a body the log
 * knocked out, the softest of a body it did not). If even that step does not give the log's faints, no step between does, and the turn goes
 * on to the seed search with one play of the steps instead of up to fifteen. A step set that gives the faints is played in the old order.
 *
 * B12's count over the bank replays that B11 sampled: in 29 of 49 VGC and 33 of 44 Champions VGC step searches the last step misses a
 * faint and no step set is taken; the 13 and 5 accepted sets and the 7 and 6 perfect ones before the last step all fit it (0 lost).
 * The rows hold the twelve fixtures: the count of `playForcedTurn` calls one rebuild makes (`plays`; a trial is one or two calls; the count
 * before the change in the comment; the faint steps' own trials fall by 136 over the ten replays that move), and the hash of the rebuild's
 * battle log and of its alignment records, which the change must not move.
 *
 * Round 88 (gate of 08.11.2026): T325 (the slowest move as the stand-in of a body that never acts), T337 (an accuracy die per hit) and X2
 * (a body with a cant line keeps its place in the turn) move six rows. 2629703929 turns 9 to 12, 2695803506 turn 1, 2663093831 turns 10
 * and 11 and 648453 turn 33 now rebuild as the log shows them; 653785 turn 22 shows one more difference (the simulator knocks Lopunny out
 * with Dragon Claw where the log leaves it 18/271 HP), and 2630685175 shifts only its damage dice from turn 1.
 */

const counter = vi.hoisted(() => ({ plays: 0 }));
vi.mock('../../packages/eval-engine/src/dice/play.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../packages/eval-engine/src/dice/play.ts')>();
  return { ...actual, playForcedTurn: (...args: Parameters<typeof actual.playForcedTurn>) => { counter.plays++; return actual.playForcedTurn(...args); } };
});

const hashOf = (text: string): string => { let hash = 7; for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0; return `${text.length}:${hash}`; };

interface Row { plays: number; log: string; records: string }
const ROWS: Record<FixtureId, Row> = {
  'smogtours-gen8ou-573756': { plays: 306, log: '55385:-227915766', records: '12037:-849299304' }, // 306 before
  'smogtours-gen8ou-562428': { plays: 70, log: '14065:878376274', records: '1906:-1870928336' }, // 70 before
  'smogtours-gen6ou-648453': { plays: 243, log: '17383:369831988', records: '3222:356002956' }, // 253 before
  'smogtours-gen6ou-649664': { plays: 90, log: '14045:-1895746750', records: '1993:-1082029582' }, // 99 before
  'smogtours-gen6ou-653785': { plays: 194, log: '14309:-1595011329', records: '2168:818953523' }, // 250 before
  'smogtours-gen6ou-655336': { plays: 92, log: '14086:452960982', records: '2341:-2010242956' }, // 101 before
  'gen9championsou-2628340185': { plays: 109, log: '13184:-452248840', records: '2082:-679139574' }, // 117 before
  'smogtours-gen9doublesou-912045': { plays: 94, log: '11255:-274969247', records: '863:-177670543' }, // 124 before
  'gen9doublesou-2663093831': { plays: 188, log: '16457:-327827304', records: '1216:1131273756' }, // 255 before
  'gen9vgc2026regi-2630685175': { plays: 79, log: '12127:2084224386', records: '866:495371160' }, // 80 before
  'gen9vgc2026regi-2629703929': { plays: 34, log: '8112:-157510885', records: '1036:-1509701834' }, // 121 before
  'gen9championsvgc2026regmc-2695803506': { plays: 34, log: '10550:-1779205691', records: '1036:-1509701834' }, // 57 before
};

describe.each(['singles', 'doubles', 'vgc'] as GameType[])('the faint step plays the last roll step first: %s', type => {
  test.each(FIXTURES.filter(fixture => fixture.type === type).map(fixture => [fixture.id] as const))('%s', { timeout: 180_000 }, async id => {
    counter.plays = 0;
    const built = await rebuild(id, { bare: true });
    const got: Row = {
      plays: counter.plays,
      log: hashOf(built.battleLog.filter(line => !line.startsWith('|t:|')).join('|')),
      records: hashOf(JSON.stringify([...built.records.values()].map(record => [record.turn, record.seed, record.via, record.actual]))),
    };
    if (process.env.B12_PRINT) appendFileSync(process.env.B12_PRINT, `${JSON.stringify({ id, ...got })}\n`);
    else expect(got).toEqual(ROWS[id]);
  });
});
