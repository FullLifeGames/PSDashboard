import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { playForcedTurn } from '../src/dice/play';
import type { DieName, DieReport, ForcedDie } from '../src/dice/types';
import {
  boardOf, clicksOf, mon, PIKACHU, playClicks, RULES, seedOf, SNORLAX, type Mode, type Rules, type Scene,
} from './dice-fixtures';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

// Round 82 (forced dice), decision D9: the report of a forced turn. `applied` when the protocol shows the answer, `no-draw`
// when the simulator never drew the die, `no-chance` when the draw cannot give the answer, `blocked` when the draw ran and
// the effect did not land. Every row reads the report next to the protocol's own lines.
await loadSimMods('gen9championsou');

const SEEDS = Array.from({ length: 8 }, (_, index) => seedOf(index));
const gameTypes = (rules: Rules): Mode[] => (rules.doubles ? ['singles', 'doubles'] : ['singles']);
const cases = RULES.flatMap(rules => gameTypes(rules).map(mode => ({ rules, mode })));
const fromGen3 = RULES.filter(rules => rules.generation >= 3).map(rules => ({ rules }));

const name = (moveId: string, kind: DieName['kind'], targetSlot = 'p2a'): DieName => ({ slot: 'p1a', moveId, targetSlot, kind });
const lines = (battle: Battle, prefix: string): string[] => battle.log.filter(line => line.startsWith(prefix));

function forcedReport(board: Battle, scene: Scene, mode: Mode, forced: ForcedDie[]): { report: DieReport; battle: Battle } {
  const report = playForcedTurn({ live: board, forced, play: battle => playClicks(battle, clicksOf(scene, mode)) });
  return { report: report.forced[0], battle: board };
}

const MEGA_KICK: Scene = { id: 'mega kick', a: SNORLAX(['megakick']), t: PIKACHU(['splash']) };
const TACKLE: Scene = { id: 'tackle', a: SNORLAX(['tackle']), t: PIKACHU(['splash']) };
const STRENGTH: Scene = { id: 'strength', a: SNORLAX(['strength']), t: { species: 'Chansey', moves: ['splash'] } };

describe.each(cases)('the report of a forced accuracy: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('yes and no are applied and the protocol shows the answer; the report carries the chance and the log index', () => {
    for (const seed of SEEDS) {
      const yes = forcedReport(boardOf(rules, MEGA_KICK, mode, seed)!, MEGA_KICK, mode, [{ name: name('megakick', 'accuracy'), result: { happens: true } }]);
      const no = forcedReport(boardOf(rules, MEGA_KICK, mode, seed)!, MEGA_KICK, mode, [{ name: name('megakick', 'accuracy'), result: { happens: false } }]);
      expect(yes.report.took, `yes ${seed}`).toBe('applied');
      expect(lines(yes.battle, '|-miss|'), `yes ${seed}`).toEqual([]);
      expect(yes.report.chance).toBeGreaterThan(0.7);
      expect(yes.report.chance).toBeLessThan(0.8);
      expect(yes.report.logIndex).toBeGreaterThan(0);
      expect(no.report.took, `no ${seed}`).toBe('applied');
      expect(lines(no.battle, '|-miss|').length, `no ${seed}`).toBe(1);
    }
  });

  test('a forced miss on a move that cannot miss is no chance exactly when the turn still hits', () => {
    for (const seed of SEEDS) {
      const { report, battle } = forcedReport(boardOf(rules, TACKLE, mode, seed)!, TACKLE, mode, [{ name: name('tackle', 'accuracy'), result: { happens: false } }]);
      const hit = lines(battle, '|-miss|').length === 0;
      expect(report.took === 'no-chance', `${rules.name} ${seed} ${report.took}`).toBe(hit);
      if (hit) expect(report.reason).toBeTruthy();
    }
  });

  test('a die of a move the user never uses is no draw, with a reason', () => {
    const { report } = forcedReport(boardOf(rules, TACKLE, mode, SEEDS[0])!, TACKLE, mode, [{ name: name('megakick', 'accuracy'), result: { happens: true } }]);
    expect(report.took).toBe('no-draw');
    expect(report.reason).toMatch(/did not use/);
  });
});

describe.each(fromGen3)('a forced hit on an immune body: $rules.name', ({ rules }: { rules: Rules }) => {
  const IMMUNE: Scene = { id: 'tackle into Gastly', a: SNORLAX(['tackle']), t: { species: 'Gastly', moves: ['splash'] } };
  test('the draw that never runs or the hit that does not land says immune', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const board = boardOf(rules, IMMUNE, 'singles', seed)!;
      const { report, battle } = forcedReport(board, IMMUNE, 'singles', [{ name: name('tackle', 'accuracy'), result: { happens: true } }]);
      expect(lines(battle, '|-immune|').length).toBe(1);
      expect(['no-draw', 'blocked']).toContain(report.took);
      expect(report.reason).toMatch(/immune/);
    }
  });
});

describe.each(cases)('the report of a forced crit: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('yes is applied when the protocol shows the crit, no when it shows none', () => {
    let crits = 0;
    for (const seed of SEEDS) {
      const die = (happens: boolean): ForcedDie => ({ name: name('tackle', 'crit'), result: { happens } });
      const yes = forcedReport(boardOf(rules, TACKLE, mode, seed)!, TACKLE, mode, [die(true)]);
      const no = forcedReport(boardOf(rules, TACKLE, mode, seed)!, TACKLE, mode, [die(false)]);
      if (lines(yes.battle, '|-miss|').length > 0) {
        expect(yes.report.took, `${seed} missed`).toBe('no-draw');
        continue;
      }
      expect(lines(yes.battle, '|-crit|').length, seed).toBe(1);
      expect(yes.report.took, `yes ${seed}`).toBe('applied');
      expect(lines(no.battle, '|-crit|').length, seed).toBe(0);
      expect(no.report.took, `no ${seed}`).toBe('applied');
      crits++;
    }
    expect(crits).toBeGreaterThan(0);
  });
});

describe.each(fromGen3)('a forced crit on a body that blocks it: $rules.name', ({ rules }: { rules: Rules }) => {
  test('the draw ran, no crit line shows: blocked', () => {
    let blocked = 0;
    for (const seed of SEEDS) {
      const p1 = [mon(rules, SNORLAX(['tackle']))];
      const p2 = [set('Cloyster', ['splash'], { ability: 'Shell Armor', level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) })];
      const board = battleOf(rules.singles, p1, p2, seed);
      const report = playForcedTurn({
        live: board, forced: [{ name: name('tackle', 'crit'), result: { happens: true } }], play: battle => playClicks(battle, clicksOf(TACKLE, 'singles')),
      }).forced[0];
      if (lines(board, '|-miss|').length) continue;
      expect(lines(board, '|-crit|'), seed).toEqual([]);
      expect(report.took, seed).toBe('blocked');
      expect(report.reason).toBeTruthy();
      blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe('a move that always crits draws no crit', () => {
  const FROST: Scene = { id: 'frost breath', a: SNORLAX(['frostbreath']), t: PIKACHU(['splash']) };
  test.each(RULES.filter(rules => rules.generation >= 5).map(rules => ({ rules })))('$rules.name: both answers are no chance, the crit shows', ({ rules }: { rules: Rules }) => {
    let played = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      for (const happens of [true, false]) {
        const board = boardOf(rules, FROST, 'singles', seed);
        if (!board) continue;
        const { report, battle } = forcedReport(board, FROST, 'singles', [{ name: name('frostbreath', 'crit'), result: { happens } }]);
        if (lines(battle, '|-miss|').length) continue;
        expect(lines(battle, '|-crit|').length).toBe(1);
        expect(report.took).toBe('no-chance');
        played++;
      }
    }
    expect(played).toBeGreaterThan(0);
  });
});

describe.each(cases)('the report of a forced damage roll: $rules.name $mode', ({ rules, mode }: { rules: Rules; mode: Mode }) => {
  test('a step in range is applied and the damage line shows; a step out of range is no chance', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const inRange = forcedReport(boardOf(rules, STRENGTH, mode, seed)!, STRENGTH, mode, [{ name: name('strength', 'damage-roll'), result: { step: 3 } }]);
      if (lines(inRange.battle, '|-miss|').length) {
        expect(inRange.report.took).toBe('no-draw');
        continue;
      }
      expect(inRange.report.took, seed).toBe('applied');
      const outOfRange = forcedReport(boardOf(rules, STRENGTH, mode, seed)!, STRENGTH, mode, [{ name: name('strength', 'damage-roll'), result: { step: 99 } }]);
      expect(outOfRange.report.took, seed).toBe('no-chance');
      expect(outOfRange.report.reason).toMatch(/step/);
    }
  });
});
