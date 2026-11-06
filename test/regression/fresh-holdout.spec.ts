import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  FRESH_FORMATS, appendFamily, checkReplay, drawCandidates, eligibleRows, idsIn, pairKey, takeChecked,
} from '../../scripts/fresh-holdout.mjs';

/**
 * Round 86 (the fresh VGC holdout, step H2): scripts/fresh-holdout.mjs draws a holdout of rated ladder games that no
 * tracked file, no local note and no .fit-corpus file names. The rule is written and deterministic: per format by
 * rating, one game per player pair over the whole draw. The fixture below stands in for the public replay search, so
 * no spec here touches the network.
 */

type Row = { id: string; format: string; rating: number | null; players: string[] };
const row = (format: string, n: number, rating: number | null, p1: string, p2: string): Row => ({
  id: `${format}-${n}`, format, rating, players: [p1, p2],
});
const A = 'gen9vgc2026regi';
const B = 'gen9vgc2026regf';
const NO_KNOWN = new Set<string>();
const options = { minRating: 1500 };
const ids = (games: { id: string }[]) => games.map(game => game.id);

describe('the rows that can enter', () => {
  test('another server, a tournament, an unrated game and a game under the floor never enter', () => {
    const listing = [
      row(A, 1, 1800, 'a', 'b'),
      { ...row(A, 2, 1800, 'c', 'd'), id: `dawn-${A}-2` },
      { ...row(A, 3, 1800, 'e', 'f'), id: `smogtours-${A}-3` },
      { ...row(A, 4, 1800, 'g', 'h'), id: `china-${A}-4` },
      row(A, 5, null, 'i', 'j'),
      row(A, 6, 0, 'k', 'l'),
      row(A, 7, 1499, 'm', 'n'),
      row(A, 8, 1500, 'o', 'p'),
      row(B, 9, 1800, 'q', 'r'),
    ];
    expect(ids(eligibleRows(listing, NO_KNOWN, { ...options, format: A }))).toEqual([`${A}-1`, `${A}-8`]);
  });

  test('an id that a known set holds never enters, and a repeated row counts once', () => {
    const listing = [row(B, 10, 1700, 'a', 'b'), row(B, 11, 1650, 'c', 'd'), row(B, 11, 1650, 'c', 'd')];
    expect(ids(eligibleRows(listing, new Set([`${B}-10`]), { ...options, format: B }))).toEqual([`${B}-11`]);
  });

  test('ids are read from text the way the known set needs them', () => {
    const text = 'see gen9vgc2026regi-2630685175, smogtours-gen9vgc2025regh-123456 and gen9ou-1234567 plus dawn-gen9vgc2024regg-9999999.';
    expect(idsIn(text).sort()).toEqual([
      'dawn-gen9vgc2024regg-9999999', 'gen9vgc2024regg-9999999', 'gen9vgc2025regh-123456', 'gen9vgc2026regi-2630685175',
      'smogtours-gen9vgc2025regh-123456',
    ]);
  });
});

describe('the draw', () => {
  const quotas = [{ format: A, quota: 2 }, { format: B, quota: 2 }];
  const take = (listing: Row[], known = NO_KNOWN, check: (game: { id: string }) => boolean = () => true) =>
    takeChecked(drawCandidates(listing, known, { ...options, formats: quotas }), check);

  test('one game per player pair: the higher rating enters, in one format and across two', async () => {
    const listing = [
      row(A, 1, 1700, 'x', 'y'), row(A, 2, 1800, 'y', 'x'), row(A, 3, 1600, 'p', 'q'),
      row(B, 4, 1900, 'x', 'y'), row(B, 5, 1550, 'r', 's'),
    ];
    const drawn = await take(listing);
    expect(Object.fromEntries(drawn.map(entry => [entry.format, ids(entry.games)]))).toEqual({
      [A]: [`${A}-2`, `${A}-3`],
      [B]: [`${B}-5`],
    });
    expect(pairKey(['Y', 'x'])).toBe(pairKey(['x', 'y!']));
  });

  test('the quota of a format holds, and a failed check takes the next game in rating order', async () => {
    const listing = [
      row(A, 1, 1900, 'a1', 'a2'), row(A, 2, 1800, 'b1', 'b2'), row(A, 3, 1700, 'c1', 'c2'), row(A, 4, 1600, 'd1', 'd2'),
      row(B, 5, 1800, 'e1', 'e2'),
    ];
    expect(ids((await take(listing))[0].games)).toEqual([`${A}-1`, `${A}-2`]);
    const checked = await take(listing, NO_KNOWN, (game: { id: string }) => game.id !== `${A}-2`);
    expect(ids(checked[0].games)).toEqual([`${A}-1`, `${A}-3`]);
    expect(checked[0]).toMatchObject({ rejected: 1, short: 0 });
    expect(checked[1]).toMatchObject({ short: 1 });
  });

  test('a pair whose game failed its check stays free for its next game', async () => {
    const listing = [row(A, 1, 1900, 'p', 'q'), row(A, 2, 1800, 'p', 'q')];
    const drawn = await takeChecked(
      drawCandidates(listing, NO_KNOWN, { ...options, formats: [{ format: A, quota: 1 }] }),
      (game: { id: string }) => game.id !== `${A}-1`,
    );
    expect(ids(drawn[0].games)).toEqual([`${A}-2`]);
  });

  test('the order of the listing never changes the draw', async () => {
    const listing: Row[] = [];
    for (let n = 1; n <= 24; n++) listing.push(row(n % 2 ? A : B, n, 1500 + ((n * 37) % 11) * 20, `p${n % 7}`, `q${n % 5}`));
    listing.push(row(A, 3, 1500 + ((3 * 37) % 11) * 20, 'p3', 'q3'));
    const base = JSON.stringify(await take(listing));
    let state = 12345;
    const shuffled = (): Row[] => {
      const copy = [...listing];
      for (let i = copy.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        const j = state % (i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };
    for (let run = 0; run < 5; run++) expect(JSON.stringify(await take(shuffled()))).toBe(base);
  });

  test('a replay passes with a winner among its players, six turns and a rating at the floor', () => {
    const log = (turns: number, win = '|win|Ann') => `|player|p1|Ann\n${Array.from({ length: turns }, (_, i) => `|turn|${i + 1}`).join('\n')}\n${win}`;
    const good = { players: ['Ann', 'Bob'], rating: 1650, log: log(6) };
    expect(checkReplay(good, { minTurns: 6, minRating: 1500 })).toBe(true);
    expect(checkReplay({ ...good, log: log(5) }, { minTurns: 6, minRating: 1500 })).toBe(false);
    expect(checkReplay({ ...good, log: log(6, '|win|Zed') }, { minTurns: 6, minRating: 1500 })).toBe(false);
    expect(checkReplay({ ...good, log: log(6, '') }, { minTurns: 6, minRating: 1500 })).toBe(false);
    expect(checkReplay({ ...good, rating: 1499 }, { minTurns: 6, minRating: 1500 })).toBe(false);
    expect(checkReplay({ ...good, rating: null }, { minTurns: 6, minRating: 1500 })).toBe(false);
  });
});

describe('the format table', () => {
  test('seven formats of the old holdout at three times its size, and regj apart', () => {
    expect(Object.fromEntries(FRESH_FORMATS.map((entry: { format: string; quota: number }) => [entry.format, entry.quota]))).toEqual({
      gen9vgc2026regi: 264, gen9vgc2026regf: 195, gen9vgc2025regi: 156, gen9vgc2025regh: 108,
      gen9vgc2024regg: 165, gen9vgc2024regh: 171, gen9vgc2025regg: 186, gen9vgc2025regj: 165,
    });
    expect(FRESH_FORMATS.slice(0, 7).reduce((sum: number, entry: { quota: number }) => sum + entry.quota, 0)).toBe(1245);
  });
});

describe('the manifest', () => {
  const old = {
    note: 'Round 65: one third.',
    sets: [
      { key: 'vgc|a|b', family: 'vgc', ids: ['gen9vgc2024regg-1'] },
      { key: 'doublesou|c|d', family: 'doublesou', ids: ['gen9doublesou-2', 'gen9doublesou-3'] },
    ],
  };
  const games = [
    { id: `${A}-10`, players: ['Eve', 'Zoe!'] },
    { id: `${B}-11`, players: ['Max', 'Ann'] },
  ];

  test('appendFamily leaves the old sets byte for byte and adds one set per game', () => {
    const next = appendFamily(old, 'vgc2', games, 'Round 86: test draw.');
    expect(JSON.stringify(next.sets.slice(0, 2))).toBe(JSON.stringify(old.sets));
    expect(next.note).toBe(old.note);
    expect(next.sets.slice(2)).toEqual([
      { key: 'vgc2|eve|zoe', family: 'vgc2', ids: [`${A}-10`] },
      { key: 'vgc2|ann|max', family: 'vgc2', ids: [`${B}-11`] },
    ]);
    expect(next.drawn).toEqual({ vgc2: 'Round 86: test draw.' });
    expect(old.sets).toHaveLength(2);
  });

  test('a second draw of the same family throws, and so does a game the manifest holds', () => {
    const next = appendFamily(old, 'vgc2', games, 'x');
    expect(() => appendFamily(next, 'vgc2', games, 'x')).toThrow(/vgc2 is already drawn/);
    expect(() => appendFamily(old, 'vgc3', [{ id: 'gen9vgc2024regg-1', players: ['a', 'b'] }], 'x')).toThrow(/already in the manifest/);
  });
});

describe('build-fit-holdout.mjs keeps what it does not draw', () => {
  test('a rebuild drops nothing of vgc2 and rewrites the four families of the corpus', () => {
    const root = mkdtempSync(join(tmpdir(), 'fresh-holdout-'));
    try {
      mkdirSync(join(root, 'test/regression/fixtures'), { recursive: true });
      mkdirSync(join(root, '.fit-corpus'));
      const replays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => ({ id: `gen9doublesou-${n}`, format: 'gen9doublesou', source: 'ladder' }));
      writeFileSync(join(root, 'test/regression/fixtures/fit-corpus-manifest.json'), JSON.stringify({ replays }));
      for (const [index, replay] of replays.entries()) {
        writeFileSync(join(root, '.fit-corpus', `${replay.id}.json`), JSON.stringify({ players: [`Alpha${index}`, `Beta${index}`] }));
      }
      const fresh = { key: 'vgc2|eve|zoe', family: 'vgc2', ids: [`${A}-10`] };
      writeFileSync(join(root, 'test/regression/fixtures/fit-holdout-manifest.json'), JSON.stringify({
        note: 'old note',
        sets: [{ key: 'vgc|stale|set', family: 'vgc', ids: ['gen9vgc2024regg-1'] }, fresh],
        drawn: { vgc2: 'Round 86: test draw.' },
      }));
      execFileSync(process.execPath, [resolve('scripts/build-fit-holdout.mjs')], { cwd: root, stdio: 'pipe' });
      const rebuilt = JSON.parse(readFileSync(join(root, 'test/regression/fixtures/fit-holdout-manifest.json'), 'utf8'));
      expect(rebuilt.sets.filter((set: { family: string }) => set.family === 'vgc2')).toEqual([fresh]);
      expect(rebuilt.drawn).toEqual({ vgc2: 'Round 86: test draw.' });
      expect(rebuilt.sets.some((set: { key: string }) => set.key === 'vgc|stale|set')).toBe(false);
      expect(rebuilt.sets.some((set: { family: string }) => set.family === 'doublesou')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
