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
 *
 * Round 89 (gate of 10.11.2026): the merge of lane C moves six rows again, and all six now read the simulator's
 * own order and aim. #143 (a stand-in for a move the simulator would refuse) moves 648453, 2628340185 and 2663093831: a turn that fell back
 * to the 16-seed search now plays forced with a stand-in, and `plays` counts only forced plays, so it rises with each such turn (648453 also
 * plays its last turn, 37 to 38 records). #108 (the aim of a hidden-target move) moves 2629703929 and 2695803506: Sucker Punch fails as the
 * log shows it and spread moves hit the logged targets, so only the log hash moves. #111 (the simulator's priority for the stand-in and the
 * cant order), with its memo fix (the speed and the priority handlers are read fresh on a live battle), moves 2630685175: the two
 * replacements of turn 4 land on the logged slots and the flinch of turn 5 stands after Fake Out, as in the log. 2628340185 is the one row
 * that reads worse than before: its bare rebuild has 20 perfect turns where it had 22. Its drift starts at turn 10 either way (the
 * simulator's Slowking faints where the log leaves it at 9/100), and the new stand-in of turn 11 only changes the damage that follows. The
 * app and the bank rebuild with the position correction, which this bare rebuild leaves out.
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
  'smogtours-gen6ou-648453': { plays: 337, log: '17892:-625254048', records: '3305:853411749' }, // 253 before
  'smogtours-gen6ou-649664': { plays: 90, log: '14045:-1895746750', records: '1993:-1082029582' }, // 99 before
  'smogtours-gen6ou-653785': { plays: 194, log: '14309:-1595011329', records: '2168:818953523' }, // 250 before
  'smogtours-gen6ou-655336': { plays: 92, log: '14086:452960982', records: '2341:-2010242956' }, // 101 before
  'gen9championsou-2628340185': { plays: 171, log: '13124:-552174195', records: '2080:887372144' }, // 117 before
  'smogtours-gen9doublesou-912045': { plays: 94, log: '11255:-274969247', records: '863:-177670543' }, // 124 before
  'gen9doublesou-2663093831': { plays: 203, log: '16420:-330807575', records: '1214:-1334583163' }, // 255 before
  'gen9vgc2026regi-2630685175': { plays: 79, log: '12127:1358418208', records: '866:495371160' }, // 80 before
  'gen9vgc2026regi-2629703929': { plays: 34, log: '8042:-1190777738', records: '1036:-1509701834' }, // 121 before
  'gen9championsvgc2026regmc-2695803506': { plays: 34, log: '10442:-1446357668', records: '1036:-1509701834' }, // 57 before
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
