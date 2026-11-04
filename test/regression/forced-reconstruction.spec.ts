/* eslint-disable no-restricted-imports -- Round 86 (B2): a white-box measurement chain like eval-calibration.spec.ts: it reads the alignment reader, the turn-block parser and the first-turn helper of the engine package, none of which the barrel exports. The integrator adds this spec and its support file to the `ignores` of the root-spec zone in eslint.zones.mjs and drops this line. */
import { beforeAll, describe, expect, test } from 'vitest';
import { adoptSerializedRuntime } from '@fulllifegames/eval-engine';
import { isPerfectAlignment } from '../../packages/eval-engine/src/hax-alignment';
import { playTurn } from '../../packages/eval-engine/test/arrival-turn';
import { diffsOf, emittedBlock, FIXTURES, rebuild, type FixtureId, type GameType, type Rebuilt } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B2 (T306): the rebuild plays each turn under the dice the log shows, not under
 * the best of sixteen seeds. The twelve feedback fixtures rebuilt like the app has 24 turns whose rebuild misses the log (the drift
 * line of round 85: singles 11, Doubles OU 8, VGC 5). The plan's probe played each of them with the log's dice (`lanes/B/plan.md`,
 * section 2); this spec holds its table.
 *
 * Rows by kind:
 * - resolved by forcing (8) and by the faint step (2), plus 648453 turn 7 (ruling Q3: a burn the simulator's damage roll blocks), perfect
 *   after B3 and B4. KNOWN (`test.fails`, red today because the seed search picks the best of sixteen seeds and none repairs the turn),
 *   flipped to plain tests in the step that resolves them;
 * - named residuals (12, and 2628340185 turn 13 by ruling Q4): the turn stays imperfect for a cause that is no die of the log. A row
 *   holds the cause where the base and the forced turn share it, so a later fix moves a row to the gate by failing it;
 * - guards: the two turns the base plays perfectly by seed luck and a plain forced turn breaks (2629703929 turn 10, a failed second
 *   Protect; 2663093831 turn 11, a damage roll the faint step repairs), and the 330 other perfect turns, counted per replay;
 * - arrival rows: a branch adopted at a resolved turn, first turn with nothing changed, plays the block the reconstruction emitted.
 */

type Row = { id: FixtureId; turn: number };
const key = (row: Row): string => `${row.id} t${row.turn}`;
const typeOf = (id: FixtureId): GameType => FIXTURES.find(fixture => fixture.id === id)!.type;

/** Turns that forcing the log's dice resolves (B3). */
const BY_FORCING: Row[] = [
  { id: 'smogtours-gen8ou-573756', turn: 72 }, { id: 'smogtours-gen8ou-573756', turn: 73 },
  { id: 'smogtours-gen8ou-573756', turn: 84 }, { id: 'smogtours-gen8ou-573756', turn: 130 },
  { id: 'gen9championsou-2628340185', turn: 4 },
  { id: 'gen9doublesou-2663093831', turn: 5 }, { id: 'smogtours-gen9doublesou-912045', turn: 5 },
  { id: 'gen9championsvgc2026regmc-2695803506', turn: 5 },
];
/** Turns that the faint step resolves (B4): the damage roll decides a faint the log shows, or (648453 turn 7, ruling Q3) a die the roll blocks. */
const BY_FAINT_STEP: Row[] = [
  { id: 'smogtours-gen6ou-649664', turn: 8 }, { id: 'gen9doublesou-2663093831', turn: 12 }, { id: 'smogtours-gen6ou-648453', turn: 7 },
];
const RESOLVED = [...BY_FORCING, ...BY_FAINT_STEP];
/** The rows that are red today: every turn the plan resolves. A later step moves its rows out of this set (the step names them in its commit). */
const KNOWN = new Set(RESOLVED.map(key));

interface Residual extends Row { cause: string; /** The diff of the emitted block against the log that the base and the forced turn share. */ stays: string | null }
const RESIDUALS: Residual[] = [
  { id: 'smogtours-gen6ou-648453', turn: 4, cause: 'damage model: the simulator keeps Rotom alive that the log\'s hit knocked out (no step of the roll kills it)', stays: null },
  { id: 'smogtours-gen6ou-653785', turn: 23, cause: 'unlogged choice: Lopunny dies unseen, so the choice fills in move 1 (Fake Out) and the order flips', stays: 'moveCount p1:lopunny:fakeout log=0 sim=1' },
  { id: 'gen9championsou-2628340185', turn: 23, cause: 'unlogged choice: Aegislash dies unseen, Shadow Sneak (priority) kills Floette first', stays: 'moveCount p1:floette:moonblast log=1 sim=0' },
  { id: 'gen9championsou-2628340185', turn: 13, cause: 'ruling Q4: Triple Axel plays two hits where the log shows one (the accuracy of one hit is no die the module names), a new faint', stays: null },
  { id: 'gen9doublesou-2663093831', turn: 8, cause: 'build: the set has Inner Focus, the log shows the Intimidate drop of Multiscale', stays: 'secondaries p1:dragonite:unboost:atk:1 log=1 sim=0' },
  { id: 'smogtours-gen9doublesou-912045', turn: 9, cause: 'build: an item (Throat Spray) the log disproves', stays: 'secondaries p1:ursaluna:boost:spa:1 log=0 sim=1' },
  { id: 'smogtours-gen9doublesou-912045', turn: 1, cause: 'damage model: the simulator deals half of the log\'s damage to Rillaboom', stays: 'faint log-only p2:rillaboom' },
  { id: 'gen9doublesou-2663093831', turn: 9, cause: 'unlogged choice: a flinched body whose move the log does not show gets Protect', stays: 'cants p1:dragonite:flinch log=1 sim=0' },
  { id: 'gen9doublesou-2663093831', turn: 10, cause: 'unlogged choice: a flinched body gets Protect; Dragonite then survives a hit the log killed it with', stays: 'cants p1:tinglu:flinch log=1 sim=0' },
  { id: 'gen9championsvgc2026regmc-2695803506', turn: 1, cause: 'unlogged choice: Sneasler dies unseen, so Fake Out is filled in', stays: 'moveCount p1:sneasler:fakeout log=0 sim=1' },
  { id: 'gen9vgc2026regi-2629703929', turn: 9, cause: 'unlogged choice: Chi-Yu dies unseen, so Protect is filled in', stays: 'moveCount p1:chiyu:protect log=0 sim=1' },
  { id: 'gen9vgc2026regi-2630685175', turn: 3, cause: 'unlogged aim: a charge move\'s |move| line names no target (the aim sits in |-anim|)', stays: null },
  { id: 'gen9vgc2026regi-2630685175', turn: 9, cause: 'damage model and a premature end: the log\'s crit leaves Zamazenta alive, a forced crit ends the game in the simulator (ruling Q2: the fallback takes this turn)', stays: null },
];
/** The turns the base plays perfectly and a plain forced turn breaks: the rebuild must keep them perfect. */
const GUARDS: Row[] = [{ id: 'gen9vgc2026regi-2629703929', turn: 10 }, { id: 'gen9doublesou-2663093831', turn: 11 }];
const NAMED = new Set([...RESOLVED, ...RESIDUALS, ...GUARDS].map(key));
/** Perfect turns outside the named rows, per replay (330 of the 356 turns). */
const OTHER_PERFECT: Record<FixtureId, number> = {
  'smogtours-gen8ou-573756': 134,
  'smogtours-gen8ou-562428': 22,
  'smogtours-gen6ou-648453': 36,
  'smogtours-gen6ou-649664': 22,
  'smogtours-gen6ou-653785': 24,
  'smogtours-gen6ou-655336': 27,
  'gen9championsou-2628340185': 21,
  'smogtours-gen9doublesou-912045': 8,
  'gen9doublesou-2663093831': 8,
  'gen9vgc2026regi-2630685175': 8,
  'gen9vgc2026regi-2629703929': 10,
  'gen9championsvgc2026regmc-2695803506': 10,
};

const rebuilt = new Map<FixtureId, Rebuilt>();
beforeAll(async () => {
  for (const { id } of FIXTURES) rebuilt.set(id, await rebuild(id));
}, 600_000);

const recordOf = (row: Row) => {
  const record = rebuilt.get(row.id)!.records.get(row.turn);
  if (!record) throw new Error(`${key(row)}: the reconstruction has no record of this turn`);
  return record;
};
const shown = (row: Row): string => {
  const { actual } = recordOf(row);
  return `${key(row)} [${typeOf(row.id)}] seed ${recordOf(row).seed}: faint ${actual.faintMismatches}, soft ${actual.softMismatches}, ended ${actual.endedMismatch}; ${diffsOf(rebuilt.get(row.id)!, row.turn).join(' ; ')}`;
};
/** A KNOWN row is red until the step that resolves it: `test.fails` while the set names it, a plain test after. */
const rowTest = (row: Row) => (KNOWN.has(key(row)) ? test.fails : test);

describe.each(['singles', 'doubles', 'vgc'] as GameType[])('the rebuild plays the turn the log shows: %s', type => {
  describe('resolved by forcing the logged dice (B3)', () => {
    for (const row of BY_FORCING.filter(entry => typeOf(entry.id) === type)) {
      rowTest(row)(`${key(row)}: the emitted block matches the log in faints and every die`, () => {
        expect(isPerfectAlignment(recordOf(row).actual), shown(row)).toBe(true);
      });
    }
  });

  describe.skipIf(!BY_FAINT_STEP.some(entry => typeOf(entry.id) === type))('resolved by the faint step (B4)', () => {
    for (const row of BY_FAINT_STEP.filter(entry => typeOf(entry.id) === type)) {
      rowTest(row)(`${key(row)}: the emitted block matches the log in faints and every die`, () => {
        expect(isPerfectAlignment(recordOf(row).actual), shown(row)).toBe(true);
      });
    }
  });

  describe('named residuals: the cause is no die of the log', () => {
    for (const row of RESIDUALS.filter(entry => typeOf(entry.id) === type)) {
      test(`${key(row)}: ${row.cause}`, () => {
        expect(isPerfectAlignment(recordOf(row).actual), `${key(row)} is no longer a residual: ${shown(row)}`).toBe(false);
        if (row.stays) expect(diffsOf(rebuilt.get(row.id)!, row.turn), key(row)).toContain(row.stays);
      });
    }
  });

  describe('guards: the turns that stay perfect', () => {
    for (const row of GUARDS.filter(entry => typeOf(entry.id) === type)) {
      test(`${key(row)}: perfect today, perfect after the forced turn`, () => {
        expect(isPerfectAlignment(recordOf(row).actual), shown(row)).toBe(true);
      });
    }

    test.each(FIXTURES.filter(fixture => fixture.type === type).map(fixture => [fixture.id] as const))('%s: every other turn stays perfect', id => {
      const others = [...rebuilt.get(id)!.records.keys()].filter(turn => !NAMED.has(key({ id, turn })));
      const imperfect = others.filter(turn => !isPerfectAlignment(recordOf({ id, turn }).actual));
      expect(imperfect.map(turn => shown({ id, turn }))).toEqual([]);
      expect(others.length, 'the count of the other perfect turns').toBe(OTHER_PERFECT[id]);
    });
  });
});

describe('the counts of the drift line', () => {
  test('24 turns of 356 miss the log today: singles 11, Doubles OU 8, VGC 5 (the named rows with Q3 and Q4)', () => {
    const imperfect = [...RESOLVED, ...RESIDUALS].filter(row => !isPerfectAlignment(recordOf(row).actual));
    const byType = (type: GameType) => imperfect.filter(row => typeOf(row.id) === type).length;
    expect({ singles: byType('singles'), doubles: byType('doubles'), vgc: byType('vgc'), total: imperfect.length }).toEqual({ singles: 11, doubles: 8, vgc: 5, total: 24 });
    const all = [...rebuilt.values()].reduce((sum, entry) => sum + entry.records.size, 0);
    expect(all).toBe(356);
  });
});

/**
 * The arrival: a branch opens at a turn of the replay (`adoptSerializedRuntime` of the position the reconstruction captured there)
 * and the user plays the first turn with nothing changed. The turn must show the block the reconstruction emitted, lines and HP,
 * and (KNOWN) the log's block. The arrival and the rebuild search the same seeds today; after B3 both play the forced turn.
 */
describe.each(RESOLVED.map(row => [key(row), row] as const))('the arrival plays the reconstruction\'s block: %s', (_label, row) => {
  async function arrival() {
    const built = rebuilt.get(row.id)!;
    const adopted = adoptSerializedRuntime({
      serialized: built.positions.get(row.turn)!, replayLog: built.replay.log, targetTurn: row.turn, snapshot: built.snapshotFor(row.turn),
    });
    return { built, played: await playTurn(adopted, built.replay.log, row.turn) };
  }

  test(`${typeOf(row.id)}: the played lines and HP equal the reconstruction's emitted block`, { timeout: 120_000 }, async () => {
    const { built, played } = await arrival();
    const lines = played.lines.filter(line => !line.startsWith('|t:|'));
    expect(lines).toEqual(emittedBlock(built.battleLog, row.turn));
  });

  (KNOWN.has(key(row)) ? test.fails : test)(`${typeOf(row.id)}: the played block matches the log`, { timeout: 120_000 }, async () => {
    const { played } = await arrival();
    expect(played.score, shown(row)).toEqual({ endedMismatch: false, faintMismatches: 0, softMismatches: 0 });
  });
});
