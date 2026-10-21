import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { poweredMove } from '../src/spreads/powered-move';
import { buildSolveContext, keyOf, rollRange, spreadFor } from '../src/spreads/fit';
import { readObservation } from '../src/spreads/observation-read';
import { simGenNum } from '../src/calc-gen';

/**
 * Round 73 (T229): a Z-move or a Max move prices from the base power of its placeholder in the Dex (1 for a Z-move, 10 for most
 * Max moves), while the simulator plays the real power of the base move. The solver read Devastating Drake as one point of damage
 * and Max Airstream as a ten-power hit, and pulled the defender's bulk and the attacker's offense toward values no set has. A
 * powered hit gives no reading: the solver leaves it out, and the one predicate comes from the Dex (`isZ`, `isMax`).
 */

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

describe('the predicate holds the code to the Dex (every move of every generation and mod the corpus plays)', () => {
  const dexes = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => [`gen ${gen}`, Dex.forGen(gen)] as const),
    ['champions', Dex.mod('champions')] as const,
  ];

  test.each(dexes)('%s: powered exactly for the Dex entries with isZ or isMax', (_name, dex) => {
    const moves = dex.moves.all();
    expect(moves.length).toBeGreaterThan(100);
    const powered = moves.filter(move => !!move.isZ || !!move.isMax);
    for (const move of moves) expect(poweredMove(dex, move.id), move.id).toBe(powered.includes(move));
    if (dex.gen >= 7 && dex.gen <= 9 && !dex.currentMod.includes('champions')) {
      // Past generations hold the entries as non-standard; the census would be empty if the Dex dropped them.
      expect(powered.length).toBeGreaterThan(30);
    }
  });

  test('an unknown id is no powered move', () => {
    expect(poweredMove(Dex.forGen(9), 'notamove')).toBe(false);
  });
});

type Format = 'singles' | 'doubles';

const mon = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});
const TOXAPEX = mon('Toxapex', '', 'Regenerator', ['Splash']);
const SLOWBRO = mon('Slowbro', '', 'Regenerator', ['Splash']);
const GARCHOMP_Z = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Dragon Claw', 'Splash']);
const GARCHOMP_MAX = mon('Garchomp', '', 'Rough Skin', ['Dragon Claw', 'Splash']);

interface Played { log: string; formatid: string; sets: { p1: PokemonSet[]; p2: PokemonSet[] } }

/** Turn 1: a plain Dragon Claw. Turn 2: the powered click (`zmove` or `dynamax`). */
function play(gen: 7 | 8, format: Format, tested: PokemonSet, power: 'zmove' | 'dynamax'): Played {
  const doubles = format === 'doubles';
  const formatid = `gen${gen}${doubles ? 'doublescustomgame' : 'customgame'}`;
  const p1 = doubles ? [TOXAPEX, SLOWBRO] : [TOXAPEX];
  const p2 = doubles ? [tested, SLOWBRO] : [tested];
  const battle = new Battle({
    formatid: toID(formatid) as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  const clicks = [`move 1${doubles ? ' 1' : ''}`, `move 1${doubles ? ' 1' : ''} ${power}`];
  for (const click of clicks) {
    expect(battle.choose('p1', doubles ? 'move 1, move 1' : 'move 1')).toBe(true);
    expect(battle.choose('p2', doubles ? `${click}, move 1` : click)).toBe(true);
  }
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return { log, formatid, sets: { p1, p2 } };
}

const SCENES: [string, 7 | 8, PokemonSet, 'zmove' | 'dynamax', string][] = [
  ['Z-move', 7, GARCHOMP_Z, 'zmove', 'devastatingdrake'],
  ['Max move', 8, GARCHOMP_MAX, 'dynamax', 'maxwyrmwind'],
];

describe('a powered hit leaves the solver, a plain hit of the same game stays', () => {
  for (const [title, gen, tested, power, powered] of SCENES) {
    for (const format of ['singles', 'doubles'] as const) {
      test(`${format}: ${title}`, () => {
        const { log, formatid, sets } = play(gen, format, tested, power);
        const { observations } = parseReplayLogWithObservations(log);
        const garchomp = observations.filter(obs => obs.attackerSpecies === 'Garchomp');
        expect(garchomp.map(obs => obs.moveId), 'the log shows both hits').toEqual(['dragonclaw', powered]);

        const ctx = buildSolveContext(observations, sets, formatid, []);
        const held = (ctx.byMon.get(keyOf('p2', 'Garchomp')) ?? []).map(obs => obs.moveId);
        expect(held, 'the solver holds the plain hit only').toEqual(['dragonclaw']);
        expect(held).not.toContain(powered);
        // The defender's key holds the same single hit: the powered one sits on neither side.
        expect((ctx.byMon.get(keyOf('p1', 'Toxapex')) ?? []).map(obs => obs.moveId)).toEqual(['dragonclaw']);

        // Why: priced from the placeholder, the calculator's range sits far under what the simulator played.
        const dex = Dex.forGen(simGenNum(ctx.gen));
        const read = readObservation(dex, ctx.sets, garchomp[1]);
        const range = rollRange(ctx, read, spreadFor(ctx, 'p2', 'Garchomp'), spreadFor(ctx, 'p1', 'Toxapex'));
        expect(range!.max).toBeLessThan(garchomp[1].observedFraction * 0.5);
      });
    }
  }
});
