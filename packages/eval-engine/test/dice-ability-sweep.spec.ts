import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import type { PRNGSeed } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport, ForcedDie } from '../src/dice/types';
import { CLASSES } from './dice-census-support';
import {
  chanceOfEffect, hitDie, labelOf, mentions, nameOf, PROC_IDS, PROCS, present, procBoard, type Proc,
} from './dice-ability-support';
import { playClicks, sweepSelection } from './dice-fixtures';
import { forcedOn, monOf, newTally, outfitBoard, SWEEP_CASES, sweepClicks } from './dice-sweep-support';

// Round 82 (forced dice), lane A4: the procs of abilities and items. A contact ability (Cute Charm, Flame Body, Poison Point,
// Static), Cursed Body, the attacker's Poison Touch and Toxic Chain and the Focus Band draw a chance inside the move in
// flight; the module names the die by the holder's slot, the move, the body that was hit and the ability's or the item's id.
// Every proc in every rule set the Dex gives it, singles and doubles, forced to happen and not to, on three seeds; the witness
// is the protocol line that names the ability or the item. The end of the turn and the future moves are further down.
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12'];
const why = (report: DieReport): string => `${report.took}: ${report.reason ?? 'no reason'}`;
const procDie = (proc: Proc, kind: 'ability-proc' | 'item-proc', happens: boolean): ForcedDie => ({
  name: { slot: 'p1a', moveId: proc.move, targetSlot: 'p2a', kind, effectId: proc.id }, result: { happens },
});
const kindOf = (proc: Proc): 'ability-proc' | 'item-proc' => (proc.kind === 'abilities' ? 'ability-proc' : 'item-proc');

describe.each(SWEEP_CASES)('the procs: $name', ({ rules, mode, name }) => {
  const tally = newTally();
  const procs = sweepSelection(PROCS.filter(proc => present(rules, proc.kind, proc.id)), 'rows');
  const seeds = sweepSelection(SEEDS, 'seeds');

  describe.each(procs.map(proc => [proc.id, proc] as const))('%s', (_id, proc) => {
    const label = labelOf(rules, proc.kind, proc.id);
    const clicks = sweepClicks(mode, 'normal');

    test.each(seeds.flatMap(seed => [true, false].map(happens => [seed, happens] as const)))('seed %s, forced %s', (seed, happens) => {
      const board = procBoard(rules, mode, proc);
      board.prng.setSeed(seed as PRNGSeed);
      const { report, battle, start } = forcedOn(board, clicks, [hitDie(proc.move), procDie(proc, kindOf(proc), happens)]);
      const shown = report.forced[1];
      tally.cases++;
      expect(shown.took, `${rules.name} ${mode} ${proc.id} ${happens}: ${why(shown)}`).toBe('applied');
      tally.applied++;
      expect(mentions(battle, start, label), `${label} shown in the protocol`).toBe(happens);
      if (proc.id === 'focusband') {
        const target = monOf(battle, 'p2a');
        expect(target.fainted, 'the band saves the body from the lethal hit').toBe(!happens);
      }
      // the chance the report names is one the simulator asked for while the effect's handler ran
      const asked = chanceOfEffect(procBoard(rules, mode, proc), clicks, proc.id, playClicks);
      if (asked.length > 0) expect(asked).toContain(shown.chance);
    });

    test('a move that makes no contact reaches no contact handler: no draw', () => {
      if (proc.id === 'cursedbody' || proc.id === 'toxicchain' || proc.id === 'focusband') return;
      const board = outfitBoard(rules, mode, { species: 'Snorlax', moves: ['swift'], ...(proc.holder === 'user' ? { ability: nameOf(rules, proc.kind, proc.id) } : {}) },
        { species: 'Vaporeon', ...(proc.holder === 'target' ? { ability: nameOf(rules, proc.kind, proc.id) } : {}) });
      const { report } = forcedOn(board, sweepClicks(mode, 'allAdjacentFoes'), [hitDie('swift'), { ...procDie({ ...proc, move: 'swift' }, 'ability-proc', true) }]);
      expect(report.forced[1].took, why(report.forced[1])).toBe('no-draw');
      tally.noDraw++;
    });
  });

  test('the Focus Band on a hit that does not faint: the draw runs, the item stays quiet', () => {
    if (!present(rules, 'items', 'focusband')) return;
    const proc = PROCS.find(entry => entry.id === 'focusband')!;
    const board = procBoard(rules, mode, { ...proc, lethal: false });
    const { report, battle, start } = forcedOn(board, sweepClicks(mode, 'normal'), [hitDie('tackle'), procDie(proc, 'item-proc', true)]);
    expect(report.forced[1].took, why(report.forced[1])).toBe('blocked');
    expect(mentions(battle, start, labelOf(rules, 'items', 'focusband'))).toBe(false);
  });

  test('the sweep was exercised', () => {
    summaries.push(`${name}: ${procs.length} procs ${JSON.stringify({ ...tally, bad: undefined, unexercised: undefined })}`);
    expect(tally.cases).toBe(procs.length * seeds.length * 2);
  });
});

describe('the census holds the sweep', () => {
  test('every proc the census finds in scope is one the sweeps play', () => {
    const rows = Object.entries(CLASSES).filter(([, entry]) => entry.kind === 'ability-proc' || entry.kind === 'item-proc');
    expect(rows.length).toBeGreaterThan(0);
    for (const [key] of rows) expect(PROC_IDS, key).toContain(key.split('/')[1]);
    for (const id of PROC_IDS) expect(rows.some(([key]) => key.split('/')[1] === id), `${id} is in the census`).toBe(true);
    expect(sweepSelection(PROC_IDS)).toEqual(PROC_IDS);
  });
});
