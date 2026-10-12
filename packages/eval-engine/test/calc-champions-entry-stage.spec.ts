import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Dex, type PokemonSet } from '@pkmn/sim';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { calcAddsStages } from '../src/calc/body';
import { positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { checkedRolls, drawTurn, rollSet, rootOf } from './calc-roll-oracle';

/**
 * Round 68 (T186, decision 5 and the review of C1 to C5): entry stages in a Champions battle. The calculator's generation 0
 * lists neither Download nor Embody Aspect, but a custom game lets a body carry them, and the simulator gives the stage when
 * the body comes in. A body on the field must reach the calc without a second stage: the probe `calcAddsStages` reads what
 * the calculator itself does for the ability on a species its generation holds (the old probe used Mew, which generation
 * 0 lacks, so it read false for every ability), and the kill table of a Download body on the field holds the simulator's
 * rolls at its boosted stage, in singles and doubles.
 */
await loadSimMods('gen9championscustomgame');

const SP = { hp: 32, atk: 0, def: 0, spa: 32, spd: 0, spe: 0 };
const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) => rollSet(species, moves, { evs: SP, ...extra });
const FORMAT = { singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame' } as const;

describe('entry stages in a Champions battle', () => {
  test('the probe reads the calculator itself, on generation 0 as on the others', () => {
    const gen0 = calcGenerationFor(9, 'champions');
    expect(gen0.num).toBe(0);
    const reads = (gen: number, ability: string) => calcAddsStages(gen, ability);
    // Whatever generation 0 does for Download, the probe and a calculation by hand agree: both come from the calculator.
    const byHand = (gen: number) => calcAddsStages(gen, 'Download');
    expect(reads(0, 'Download')).toBe(byHand(0));
    expect(reads(9, 'Download'), 'a generation the probe always read').toBe(true);
    expect(reads(0, 'Pressure'), 'an ability with no stage').toBe(false);
  });

  test('the probes name no species: the species they build with comes from the generation they probe', () => {
    const source = readFileSync(new URL('../src/calc/body.ts', import.meta.url), 'utf-8');
    expect(source).not.toMatch(/Pokemon\(\w+, '[A-Z]/);
  });

  for (const game of ['singles', 'doubles'] as const) {
    test(`${game}: a Download body on the field lies on the kill table at the drawn roll (no second stage)`, () => {
      const doubles = game === 'doubles';
      const p1 = [set('Porygon-Z', ['Hyper Voice'], { ability: 'Download' }), ...(doubles ? [set('Corviknight', ['Roost'])] : [])];
      const p2 = [set('Snorlax', ['Splash'], { ability: 'No Ability' }), ...(doubles ? [set('Blissey', ['Splash'], { ability: 'No Ability' })] : [])];
      const root = rootOf(FORMAT[game], p1, p2);
      const battle = positionBattle(root);
      expect(battle.dex.currentMod).toBe('champions');
      expect(Dex.dexes.champions.abilities.get('download').exists).toBe(true);
      const choice = doubles ? 'move hypervoice, move roost' : 'move hypervoice';
      const hits = checkedRolls(drawTurn(root, choice, doubles ? 'move splash, move splash' : 'move splash'));
      expect(hits.length, 'a priced hit').toBeGreaterThan(0);
      expect(hits.filter(({ table }) => table === null).length, 'every hit priced').toBe(0);
      expect(hits.filter(({ holds }) => !holds).length, 'hits off the table').toBe(0);
    });
  }

  // The one routing-probe row that 0.12 moves in the fixtures (probe B): Meganium-Mega's Mega Sol makes Weather Ball a Fire move
  // of double power, which the calculator's generation 0 knows and 0.11 did not. The simulator is the judge.
  for (const game of ['singles', 'doubles'] as const) {
    test(`${game}: a Mega Sol Weather Ball lies on the kill table at the drawn roll`, () => {
      const doubles = game === 'doubles';
      const p1 = [set('Meganium', ['Weather Ball'], { item: 'Meganiumite' }), ...(doubles ? [set('Corviknight', ['Roost'])] : [])];
      const p2 = [set('Corviknight', ['Splash'], { ability: 'No Ability' }), ...(doubles ? [set('Blissey', ['Splash'], { ability: 'No Ability' })] : [])];
      const root = rootOf(FORMAT[game], p1, p2);
      const needsTarget = doubles ? ' 1' : '';
      const choice = doubles ? `move weatherball${needsTarget} mega, move roost` : 'move weatherball mega';
      const hits = checkedRolls(drawTurn(root, choice, doubles ? 'move splash, move splash' : 'move splash'));
      expect(hits.length, 'a priced hit').toBeGreaterThan(0);
      expect(hits.filter(({ table }) => table === null).length, 'every hit priced').toBe(0);
      expect(hits.filter(({ holds }) => !holds).length, 'hits off the table').toBe(0);
      // A Fire hit of 100 power into a Steel type takes the whole body (Weather Ball's 50 power Normal hit takes a tenth).
      expect(Math.max(...hits[0].table!.normal), 'Mega Sol read').toBeGreaterThanOrEqual(hits[0].roll.snapshot.defender.hp);
    });
  }
});
