import { appendFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { FIXTURES, rebuild, type FixtureId, type GameType } from './forced-reconstruction-support';

// The hashes are records, not verdicts; the app rebuilds with the position correction, which this rebuild leaves out.

const counter = vi.hoisted(() => ({ plays: 0 }));
vi.mock('../../packages/eval-engine/src/dice/play.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../packages/eval-engine/src/dice/play.ts')>();
  return { ...actual, playForcedTurn: (...args: Parameters<typeof actual.playForcedTurn>) => { counter.plays++; return actual.playForcedTurn(...args); } };
});

const hashOf = (text: string): string => { let hash = 7; for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0; return `${text.length}:${hash}`; };

interface Row { plays: number; log: string; records: string }
const ROWS: Record<FixtureId, Row> = {
  'smogtours-gen8ou-573756': { plays: 306, log: '55385:-227915766', records: '12037:-849299304' },
  'smogtours-gen8ou-562428': { plays: 70, log: '14065:878376274', records: '1906:-1870928336' },
  'smogtours-gen6ou-648453': { plays: 337, log: '17892:920104409', records: '3305:853411749' },
  'smogtours-gen6ou-649664': { plays: 90, log: '14045:-1895746750', records: '1993:-1082029582' },
  'smogtours-gen6ou-653785': { plays: 194, log: '14309:-1595011329', records: '2168:818953523' },
  'smogtours-gen6ou-655336': { plays: 92, log: '14086:452960982', records: '2341:-2010242956' },
  'gen9championsou-2628340185': { plays: 171, log: '13124:-552174195', records: '2080:887372144' },
  'smogtours-gen9doublesou-912045': { plays: 68, log: '11907:-130188070', records: '949:-3176020' },
  'gen9doublesou-2663093831': { plays: 101, log: '15815:-827094750', records: '1213:-1283217296' },
  'gen9vgc2026regi-2630685175': { plays: 79, log: '12129:1170636370', records: '866:495371160' },
  'gen9vgc2026regi-2629703929': { plays: 34, log: '8039:-1875511929', records: '1036:-1509701834' },
  'gen9championsvgc2026regmc-2695803506': { plays: 34, log: '10444:-1889935935', records: '1036:-1509701834' },
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
