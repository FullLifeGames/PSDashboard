import { beforeAll, describe, expect, test } from 'vitest';
import { adoptSerializedRuntime } from '@fulllifegames/eval-engine';
import { forcedBlock } from '../../packages/eval-engine/src/branch/arrival-dice';
import { buildForcedSwitchChoice, hasForceSwitch } from '../../packages/eval-engine/src/branch/corrections';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../../packages/eval-engine/src/branch/protocol-choices';
import { faintStep, protocolBenchOf } from '../../packages/eval-engine/src/dice/logged-block';
import { playForcedTurn } from '../../packages/eval-engine/src/dice/play';
import { loggedDiceAt } from '../../packages/eval-engine/src/dice/turn';
import { forkBattle } from '../../packages/eval-engine/src/forward/position';
import { applyChoice, resolveForcedSwitches } from '../../packages/eval-engine/src/forward/switches';
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
 *   after B3 and B4. B3 flipped the eight of forcing to plain tests, B4a the three of the faint step;
 * - resolved by the slowest stand-in (3, round 88, T325): the log shows no action of a body that fainted or flinched before it moved, and the
 *   click that fills in takes the enabled move of the lowest priority at 0 or below, so the foe's logged action stays first;
 * - named residuals (9, and 2628340185 turn 13 by ruling Q4): the turn stays imperfect for a cause that is no die of the log. A row
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
/** Turns that the slowest stand-in resolves (round 88, T325): the log shows no action of the body, and the first move (Fake Out, Protect) ran ahead of the foe. */
const BY_STAND_IN: Row[] = [
  { id: 'smogtours-gen6ou-653785', turn: 23 }, { id: 'gen9vgc2026regi-2629703929', turn: 9 }, { id: 'gen9championsvgc2026regmc-2695803506', turn: 1 },
];
const RESOLVED = [...BY_FORCING, ...BY_FAINT_STEP, ...BY_STAND_IN];

interface Residual extends Row { cause: string; /** The diff of the emitted block against the log that the base and the forced turn share. */ stays: string | null }
const RESIDUALS: Residual[] = [
  { id: 'smogtours-gen6ou-648453', turn: 4, cause: 'damage model: the simulator keeps Rotom alive that the log\'s hit knocked out (no step of the roll kills it)', stays: null },
  { id: 'gen9championsou-2628340185', turn: 23, cause: 'damage model: the log shows the Shadow Sneak of Aegislash leaving Floette at 1/100, the roll of the simulator knocks Floette out first (round 88, T325: no unlogged choice, the move of Aegislash is in the log)', stays: 'moveCount p1:floette:moonblast log=1 sim=0' },
  { id: 'gen9championsou-2628340185', turn: 13, cause: 'ruling Q4: Triple Axel plays two hits where the log shows one (the accuracy of one hit is no die the module names), a new faint', stays: null },
  { id: 'gen9doublesou-2663093831', turn: 8, cause: 'build: the set has Inner Focus, the log shows the Intimidate drop of Multiscale', stays: 'secondaries p1:dragonite:unboost:atk:1 log=1 sim=0' },
  { id: 'smogtours-gen9doublesou-912045', turn: 9, cause: 'build: an item (Throat Spray) the log disproves', stays: 'secondaries p1:ursaluna:boost:spa:1 log=0 sim=1' },
  { id: 'smogtours-gen9doublesou-912045', turn: 1, cause: 'damage model: the simulator deals half of the log\'s damage to Rillaboom', stays: 'faint log-only p2:rillaboom' },
  { id: 'gen9doublesou-2663093831', turn: 9, cause: 'speed order: the stand-in (Scale Shot, priority 0, the slowest move of Dragonite) moves ahead of the Rock Slide that flinched it in the log, so no flinch lands (round 88, T325: the choice is the slowest the request has)', stays: 'cants p1:dragonite:flinch log=1 sim=0' },
  { id: 'gen9doublesou-2663093831', turn: 10, cause: 'damage model: the flinches now match (T325), the Rock Slide of the simulator leaves Dragonite alive that the log knocked out', stays: 'faint log-only p1:dragonite' },
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

describe.each(['singles', 'doubles', 'vgc'] as GameType[])('the rebuild plays the turn the log shows: %s', type => {
  describe('resolved by forcing the logged dice (B3)', () => {
    for (const row of BY_FORCING.filter(entry => typeOf(entry.id) === type)) {
      test(`${key(row)}: the emitted block matches the log in faints and every die`, () => {
        expect(isPerfectAlignment(recordOf(row).actual), shown(row)).toBe(true);
      });
    }
  });

  describe.skipIf(!BY_FAINT_STEP.some(entry => typeOf(entry.id) === type))('resolved by the faint step (B4)', () => {
    for (const row of BY_FAINT_STEP.filter(entry => typeOf(entry.id) === type)) {
      test(`${key(row)}: the emitted block matches the log in faints and every die`, () => {
        expect(isPerfectAlignment(recordOf(row).actual), shown(row)).toBe(true);
      });
    }
  });

  describe.skipIf(!BY_STAND_IN.some(entry => typeOf(entry.id) === type))('resolved by the slowest stand-in (T325)', () => {
    for (const row of BY_STAND_IN.filter(entry => typeOf(entry.id) === type)) {
      test(`${key(row)}: the emitted block matches the log in faints and every die`, () => {
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
  // 24 turns of the named rows missed the log in round 85 (singles 11, Doubles OU 8, VGC 5, with Q3 and Q4); B3 resolved the eight of forcing, B4
  // resolves the three of the faint step, T325 (round 88) the three of the stand-in: the imperfect rows are the residuals
  test('the named rows that miss the log: the residuals (singles 3, Doubles OU 5, VGC 2 after T325)', () => {
    const imperfect = [...RESOLVED, ...RESIDUALS].filter(row => !isPerfectAlignment(recordOf(row).actual));
    const byType = (type: GameType) => imperfect.filter(row => typeOf(row.id) === type).length;
    expect({ singles: byType('singles'), doubles: byType('doubles'), vgc: byType('vgc'), total: imperfect.length }).toEqual({ singles: 3, doubles: 5, vgc: 2, total: 10 });
  });

  // Round 86 (ruling C2): the turns the hybrid search plays under another seed than index 0
  // 2630685175 turn 3 is a named residual (the aim of a charge move sits in |-anim|): the search keeps the seed whose unnamed dice fit best and the row stays imperfect
  test('the seeded turns of the twelve replays: only 2630685175 turn 3, still a named residual', () => {
    const seeded = FIXTURES.flatMap(({ id }) => [...rebuilt.get(id)!.records.values()].filter(record => record.via === 'forced' && record.seed !== '1,2,3,4').map(record => `${key({ id, turn: record.turn })} ${record.seed}`));
    expect(seeded).toEqual([`${key({ id: 'gen9vgc2026regi-2630685175', turn: 3 })} 2,4,6,8`]);
    expect(isPerfectAlignment(recordOf({ id: 'gen9vgc2026regi-2630685175', turn: 3 }).actual)).toBe(false);
  });

  // ruling Q2: a forced turn that ends a game the log goes on past is no reading of the log; the block falls back to the seed search
  test('the fallback turns of the twelve replays: only 2630685175 turn 9, and the records say so', () => {
    const fallbacks = FIXTURES.flatMap(({ id }) => [...rebuilt.get(id)!.records.values()].filter(record => record.via === 'fallback').map(record => key({ id, turn: record.turn })));
    expect(fallbacks).toEqual([key({ id: 'gen9vgc2026regi-2630685175', turn: 9 })]);
  });

  // ruling Q2: the forced crit of 2630685175 turn 9 ends the game in the simulator, the fallback takes that turn, and the replay goes on
  test('every one of the 356 turns has a record', () => {
    const all = [...rebuilt.values()].reduce((sum, entry) => sum + entry.records.size, 0);
    expect(all).toBe(356);
  });
});

/**
 * The arrival: a branch opens at a turn of the replay (`adoptSerializedRuntime` of the position the reconstruction captured there)
 * and the user plays the first turn with nothing changed. The turn must show the block the reconstruction emitted, lines and HP,
 * and the log's block. The arrival and the rebuild play the same forced turn, the faint step included.
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

  test(`${typeOf(row.id)}: the played block matches the log`, { timeout: 120_000 }, async () => {
    const { played } = await arrival();
    expect(played.score, shown(row)).toEqual({ endedMismatch: false, faintMismatches: 0, softMismatches: 0 });
  });
});

/**
 * The part player (the choices, then each forced replacement, every part through the dice module) plays what the one-`play` prototype of the
 * plan's probe plays, which writes the choices and the log's replacements in one go: both give the block the rebuild emitted, on all 24 turns of the
 * named rows (plan section 3, forced replacements).
 */
describe.each([...RESOLVED, ...RESIDUALS].map(row => [key(row), row] as const))('the part player equals the one-play prototype: %s', (_label, row) => {
  test(`${typeOf(row.id)}: the lines of the turn from its boundary position`, () => {
    const built = rebuilt.get(row.id)!;
    const live = forkBattle({ serialized: built.positions.get(row.turn)! } as never, '1,2,3,4' as never);
    const block = parseTurnBlocks(built.replay.log).turns.find(entry => entry.turn === row.turn)!;
    const choices = { p1: getMainChoice(block.preUpkeep, 'p1', live as never), p2: getMainChoice(block.preUpkeep, 'p2', live as never) };
    const forced = { p1: collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p1', live.dex), p2: collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p2', live.dex) };
    const logged = loggedDiceAt(live, built.replay.log);
    const aligned = forcedBlock(live as never, block as never);
    // the faint step's dice, as the rebuild plays them; null is the fallback, whose block the seed search emits
    const { dice, seed } = faintStep({ battle: live, expected: aligned.expectedEvents, seed: aligned.seedChoice.seed, choices, forced, bench: protocolBenchOf(built.replay.log, [...block.preUpkeep, ...block.postUpkeep], row.turn) }, logged);
    if (!dice) {
      expect(recordOf(row).via, key(row)).toBe('fallback');
      return;
    }
    // Round 86 (ruling C2): the seed the faint step found for the dice no `DieKind` names, the seed the rebuild plays the turn under
    if (seed !== aligned.seedChoice.seed) live.resetRNG(seed);
    const start = live.log.length;
    playForcedTurn({
      live, forced: dice,
      play: battle => {
        applyChoice(battle, 'p1', choices.p1);
        applyChoice(battle, 'p2', choices.p2);
        const cursors = { p1: { current: 0 }, p2: { current: 0 } };
        for (let guard = 0; guard < 6 && !battle.ended; guard++) {
          const answers = (['p1', 'p2'] as const).flatMap((side, index) => {
            const choice = hasForceSwitch(battle, index) ? buildForcedSwitchChoice(battle, index, forced[side], cursors[side]) : null;
            return choice ? [{ side, choice }] : [];
          });
          if (answers.length === 0) break;
          for (const { side, choice } of answers) if (!battle.choose(side, choice)) return;
        }
        resolveForcedSwitches(battle, '1,2,3,4');
      },
    });
    const lines = live.log.slice(start).filter(line => !line.startsWith('|t:|'));
    expect(lines).toEqual(emittedBlock(built.battleLog, row.turn));
  });
});

/**
 * Round 86 (B4b, the phantom procs): smogtours-gen8ou-573756 built from the log alone gives Clefable its first ability, Cute Charm, and
 * Conscripts (a Toxapex) hits it with Knock Off on turn 1. The log shows no Attract. The forced turn answered only the dice the log shows,
 * so the hidden dice of seed 0 said yes to the 30 percent proc and Conscripts carried `attract` from turn 2 to turn 10. The app's own
 * build (a Smogon set with Magic Guard) never meets that die; a build from the log alone, as the engine package's helpers use, does.
 */
describe('a proc the log does not show: 573756 built from the log alone', () => {
  let naked: Rebuilt;
  beforeAll(async () => { naked = await rebuild('smogtours-gen8ou-573756', { naked: true }); }, 120_000);

  test('no turn of the rebuild shows Cute Charm or an Attract the log lacks', () => {
    const shown = (lines: readonly string[]) => lines.filter(line => /Cute Charm|Attract/.test(line));
    const logged = [...naked.records.keys()].flatMap(turn => naked.logBlock(turn));
    expect(shown(logged), 'the log has no infatuation').toEqual([]);
    expect(shown(naked.battleLog)).toEqual([]);
  });

  test('Conscripts carries no attract at the start of any turn', () => {
    const carrying = [...naked.positions.entries()].filter(([, serialized]) => serialized.includes('"attract"')).map(([turn]) => turn);
    expect(carrying).toEqual([]);
  });
});
