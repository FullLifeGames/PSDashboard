import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport, ForcedDie } from '../src/dice/types';
import { genShape } from '../src/dice/recognize';
import { copyOf } from '../src/sim-ask/copy';
import { CLASSES } from './dice-census-support';
import { END_IDS, END_ROWS, endBoard, present } from './dice-ability-support';
import { playClicks } from './dice-fixtures';
import { critsOf, dexOfRules, forcedOn, missesOf, monOf, newTally, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, turnLines } from './dice-sweep-support';

// Round 82 (forced dice), lane A4: the dice of the end of the turn. The simulator runs the Residual event of every body after
// the moves: Shed Skin sheds a status, Harvest brings a berry back, Healer cures an ally (one draw for each statused ally, the
// die is named by the holder and the ally), and Gen 2 thaws a frozen body. A future move (Future Sight, Doom Desire) lands in
// the end-of-turn handling two turns after its use and draws its accuracy, crit and damage roll there; those dice carry the
// move's own name, like the dice of any hit. Every die, in every rule set the Dex gives it, singles and doubles, forced to
// happen and not to, on three seeds; the witness is the protocol line the effect writes.
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12'];
const why = (report: DieReport): string => `${report.took}: ${report.reason ?? 'no reason'}`;
const dieOf = (id: string, happens: boolean, targetSlot?: string): ForcedDie => ({
  name: { slot: 'p1a', moveId: '', ...(targetSlot ? { targetSlot } : {}), kind: 'end-of-turn', effectId: id }, result: { happens },
});

describe.each(SWEEP_CASES)('the end of the turn: $name', ({ rules, mode, name }) => {
  const tally = newTally();
  const rows = END_ROWS.filter(row => (row.kind === 'condition' || present(rules, 'abilities', row.id)) && (!row.doubles || mode === 'doubles') && (!row.only || row.only(rules)));
  const clicks = sweepClicks(mode, 'self');

  describe.each(rows.map(row => [row.id, row] as const))('%s', (_id, row) => {
    test.each(SEEDS.flatMap(seed => [true, false].map(happens => [seed, happens] as const)))('seed %s, forced %s', (seed, happens) => {
      const board = endBoard(rules, mode, row);
      board.prng.setSeed(seed as PRNGSeed);
      const { report, battle, start } = forcedOn(board, clicks, [dieOf(row.id, happens, row.targetSlot)]);
      tally.cases++;
      expect(report.forced[0].took, `${rules.name} ${mode} ${row.id} ${happens}: ${why(report.forced[0])}`).toBe('applied');
      tally.applied++;
      const shown = battle.log.slice(start).some(line => row.witness(rules).test(line));
      expect(shown, `${row.id} shown in the protocol`).toBe(happens);
      if (row.id === 'shedskin' || row.id === 'frz') expect(monOf(battle, 'p1a').status === '', 'the status is gone iff the effect happened').toBe(happens);
      if (row.id === 'healer') expect(monOf(battle, 'p1b').status === '', 'the ally is cured iff the effect happened').toBe(happens);
    });

    test('a holder with nothing to do draws no die', () => {
      const idle = endBoard(rules, mode, row);
      // the position the handler waits for is taken away: no status to shed or cure, and sunshine for Harvest (it draws every turn
      // but a sunny one, whether or not a berry waits)
      if (row.id === 'shedskin' || row.id === 'frz') monOf(idle, 'p1a').clearStatus();
      if (row.id === 'healer') monOf(idle, 'p1b').clearStatus();
      if (row.id === 'harvest') idle.field.setWeather('sunnyday', monOf(idle, 'p1a'));
      const { report } = forcedOn(idle, clicks, [dieOf(row.id, true, row.targetSlot)]);
      expect(report.forced[0].took, why(report.forced[0])).toBe('no-draw');
      tally.noDraw++;
    });
  });

  test('the sweep was exercised', () => {
    summaries.push(`${name}: ${rows.length} rows ${JSON.stringify({ ...tally, bad: undefined, unexercised: undefined })}`);
    expect(tally.cases).toBe(rows.length * SEEDS.length * 2);
  });
});

/** Plays `turns` turns of the same clicks on a copy of the board. */
function after(board: Battle, clicks: { p1: string; p2: string }, turns: number): Battle {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  for (let turn = 0; turn < turns; turn++) playClicks(copy, clicks);
  return copy;
}

describe.each(SWEEP_CASES)('the future moves: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => !!move.flags.futuremove);
  const tally = newTally();
  const dex = dexOfRules(rules);

  describe.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    const clicks = sweepClicks(mode, move.target);
    const label = dex.moves.get(move.id).name;

    /** The turns it takes the move to land: the first turn whose lines end the move's condition on the target. */
    function landing(): number {
      const copy = after(sweepBoard(rules, move.id, mode), clicks, 0);
      for (let turn = 1; turn <= 4; turn++) {
        const start = copy.log.length;
        playClicks(copy, clicks);
        if (copy.log.slice(start).some(line => line.startsWith('|-end|') && line.includes(`move: ${label}`))) return turn;
      }
      throw new Error(`${move.id} never landed`);
    }

    test('the turn it lands: accuracy, crit and the damage roll are dice of that turn', () => {
      const turn = landing();
      expect(turn, 'a future move lands after its use').toBeGreaterThan(1);
      for (const seed of SEEDS) {
        for (const happens of [true, false]) {
          const board = sweepBoard(rules, move.id, mode);
          board.prng.setSeed(seed as PRNGSeed);
          const ready = after(board, clicks, turn - 1);
          const accuracy: ForcedDie = { name: { slot: 'p1a', moveId: move.id, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens } };
          const { report, battle, start } = forcedOn(ready, clicks, [accuracy]);
          tally.cases++;
          const shown = report.forced[0];
          // Gens 2 to 4 and the moves that cannot miss draw no accuracy: the report says so, and the protocol shows no miss
          if (shown.took === 'no-draw') {
            tally.noDraw++;
            expect(missesOf(battle, start, 'p2a'), `${rules.name} ${move.id}: ${why(shown)}`).toBe(0);
            continue;
          }
          // a move of 100 percent cannot be made to miss: the draw runs and the report says no-chance, the protocol shows the hit
          if (shown.took === 'no-chance' && !happens) {
            expect(shown.chance, why(shown)).toBe(1);
            expect(missesOf(battle, start, 'p2a')).toBe(0);
            tally.noChance++;
            continue;
          }
          expect(shown.took, `${rules.name} ${mode} ${move.id} ${happens}: ${why(shown)}`).toBe('applied');
          tally.applied++;
          expect(missesOf(battle, start, 'p2a') === 0, 'the protocol shows the answer').toBe(happens);
          if (happens) expect(turnLines(battle, start, '|-damage|p2a').length, 'a hit does damage').toBeGreaterThan(0);
        }
      }
    });

    test('the turn it lands: a forced crit and the lowest and highest damage roll', () => {
      const turn = landing();
      const board = sweepBoard(rules, move.id, mode);
      const ready = after(board, clicks, turn - 1);
      const hit: ForcedDie = { name: { slot: 'p1a', moveId: move.id, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
      const crit = (happens: boolean): ForcedDie => ({ name: { slot: 'p1a', moveId: move.id, targetSlot: 'p2a', kind: 'crit' }, result: { happens } });
      const roll = (step: number): ForcedDie => ({ name: { slot: 'p1a', moveId: move.id, targetSlot: 'p2a', kind: 'damage-roll' }, result: { step } });
      const lost = (dice: ForcedDie[]): { took: string[]; hp: number; crits: number } => {
        const played = forcedOn(ready, clicks, dice);
        return { took: played.report.forced.map(entry => entry.took), hp: monOf(played.battle, 'p2a').hp, crits: critsOf(played.battle, played.start, 'p2a') };
      };
      const plain = lost([hit]);
      if (plain.took[0] === 'no-draw') {
        tally.unexercised.push(`${move.id}: no accuracy draw`);
        return;
      }
      const withCrit = lost([hit, crit(true)]);
      const withoutCrit = lost([hit, crit(false)]);
      // Gens 2 to 4 land a future move as typeless damage with no crit: the die is never drawn and the protocol shows none
      const critDrawn = withCrit.took[1] !== 'no-draw';
      const low = lost(critDrawn ? [hit, crit(false), roll(0)] : [hit, roll(0)]);
      const high = lost(critDrawn ? [hit, crit(false), roll(genShape(rules.generation).roll.steps - 1)] : [hit, roll(genShape(rules.generation).roll.steps - 1)]);
      tally.cases += 4;
      if (critDrawn) {
        expect(withCrit.took[1], 'crit applied').toBe('applied');
        expect(withCrit.crits).toBe(1);
        expect(withoutCrit.crits).toBe(0);
      } else {
        expect(rules.generation, `${move.id} draws no crit before Gen 5`).toBeLessThan(5);
        expect(withCrit.crits, 'no crit shows').toBe(0);
        // the same landing draws no damage roll either: the damage is fixed
        expect(low.took.slice(1), 'no roll is drawn').toEqual(['no-draw']);
        expect(high.hp, 'the damage does not move with the roll').toBe(low.hp);
        tally.noDraw++;
        return;
      }
      expect(low.took.slice(2), 'roll applied').toEqual(['applied']);
      expect(high.hp, 'the highest damage roll hurts more than the lowest').toBeLessThan(low.hp);
    });
  });

  test('the sweep was exercised', () => {
    summaries.push(`${name}: ${moves.length} future moves ${JSON.stringify({ ...tally, bad: undefined, unexercised: undefined })}`);
    expect(moves.length > 0 || rules.generation < 2, 'a rule set from Gen 2 on has a future move').toBe(true);
  });
});

describe('the census holds the sweep', () => {
  test('every end-of-turn handler the census finds is one the sweep plays', () => {
    const rows = Object.entries(CLASSES).filter(([, entry]) => entry.kind === 'end-of-turn');
    expect(rows.length).toBeGreaterThan(0);
    for (const [key] of rows) expect(END_IDS, key).toContain(key.split('/')[1]);
    for (const id of END_IDS) expect(rows.some(([key]) => key.split('/')[1] === id), `${id} is in the census`).toBe(true);
  });
});
