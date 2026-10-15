import { describe, expect, test } from 'vitest';
import { Dex, type ModdedDex, type PokemonSet } from '@pkmn/sim';
import { hitMayCost, playedHit, type HitCost } from '../src/score/contact';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * 13.10.2026 (the contact punishments of boostsBiting): the reader plays a hit only for a pair where something could
 * cost the attacker, and that decision reads the Dex (a handler for the hit on the foe's item or ability, one for the
 * attacker's own move on its item or ability, a recoil field on the move) and plays the one move the Dex does not
 * describe (a move whose cost the simulator codes and does not list) on a bare pair, never a name. This spec holds the
 * decision to the simulator over the whole Dex of generation 9 and over the Champions mod's own Dex: wherever the
 * played hit costs the attacker HP or leaves it a status, the decision said so. A new item, ability or move in a later
 * version of the simulator that breaks the rule fails here (Chloroblast, whose recoil lives in the simulator's code, is
 * the move that found the probe).
 */

await loadSimMods('gen9championscustomgame');

/** A rule set to sweep: its format, its Dex, and the sets' stat points where the mode reads them (Champions: Stat Points in `evs`, level 50). */
interface Mode { name: string; format: string; dex: ModdedDex | typeof Dex; extra: Partial<PokemonSet> }
const MODES: Mode[] = [
  { name: 'Scarlet and Violet', format: 'gen9customgame', dex: Dex.forGen(9), extra: {} },
  { name: 'Champions', format: 'gen9championscustomgame', dex: Dex.mod('champions'), extra: { level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } } },
];

const usable = <T extends { exists: boolean; isNonstandard?: string | null }>(entry: T): boolean =>
  entry.exists && (!entry.isNonstandard || entry.isNonstandard === 'Past');

const costs = (cost: HitCost): boolean => cost.chip !== 0 || cost.statuses.length > 0;

interface Scene { name: string; attacker: PokemonSet; defender: PokemonSet; move: string }

/** Every scene of one role: the effect on the foe's side or on the attacker's, a contact move so that the foe's reactions can fire. */
function scenes({ dex, extra }: Mode): Scene[] {
  const list: Scene[] = [];
  const attacker = (more: Partial<PokemonSet> = {}) => set('Cobalion', ['ironhead', 'splash'], { ...extra, ...more });
  const defender = (more: Partial<PokemonSet> = {}) => set('Chansey', ['splash'], { ...extra, ...more });
  for (const item of dex.items.all().filter(usable)) {
    list.push({ name: `foe item ${item.id}`, attacker: attacker(), defender: defender({ item: item.name }), move: 'ironhead' });
    list.push({ name: `own item ${item.id}`, attacker: attacker({ item: item.name }), defender: defender(), move: 'ironhead' });
  }
  for (const ability of dex.abilities.all().filter(usable)) {
    list.push({ name: `foe ability ${ability.id}`, attacker: attacker(), defender: defender({ ability: ability.name }), move: 'ironhead' });
    list.push({ name: `own ability ${ability.id}`, attacker: attacker({ ability: ability.name }), defender: defender(), move: 'ironhead' });
  }
  for (const move of dex.moves.all().filter(usable)) {
    if (move.category === 'Status') continue;
    list.push({ name: `move ${move.id}`, attacker: set('Cobalion', [move.id, 'splash'], extra), defender: defender(), move: move.id });
  }
  return list;
}

interface Result { scene: Scene; cost: HitCost; may: boolean }
const swept = new Map<string, Result[]>();

/** The whole sweep of a mode, played once for the specs below. */
function sweep(mode: Mode): Result[] {
  let results = swept.get(mode.name);
  if (!results) {
    results = scenes(mode).map(scene => {
      const battle = battleOf(mode.format, [scene.attacker], [scene.defender]);
      const attacker = battle.sides[0].active[0]!;
      const defender = battle.sides[1].active[0]!;
      return { scene, cost: playedHit(battle, attacker, defender, scene.move), may: hitMayCost(battle, attacker, defender, scene.move) };
    });
    swept.set(mode.name, results);
  }
  return results;
}

describe.each(MODES)('the decision to play a hit hides no effect of the Dex of $name', mode => {
  test('wherever the played hit costs the attacker HP or a status, the decision said it might', { timeout: 240_000 }, () => {
    const hidden = sweep(mode).filter(entry => costs(entry.cost) && !entry.may).map(entry => entry.scene.name);
    expect(hidden).toEqual([]);
  });

  test('the sweep found the effects it is meant to find, so that the check above is not vacuous', () => {
    const found = new Set(sweep(mode).filter(entry => costs(entry.cost)).map(entry => entry.scene.name));
    for (const name of [
      'foe item rockyhelmet', 'foe ability roughskin', 'foe ability ironbarbs', 'foe ability flamebody', 'foe ability static',
      'foe ability effectspore', 'own item lifeorb', 'move bravebird', 'move flareblitz', 'move explosion', 'move steelbeam',
    ]) expect(found.has(name), name).toBe(true);
  });

  test('the decision is a filter and not a constant: most of the Dex is free', () => {
    const results = sweep(mode);
    const reactive = results.filter(entry => entry.scene.name.startsWith('foe ') && entry.may).length;
    const foeScenes = results.filter(entry => entry.scene.name.startsWith('foe ')).length;
    expect(reactive / foeScenes).toBeLessThan(0.2);
    const plain = results.filter(entry => entry.scene.name.startsWith('move ') && !entry.may).length;
    expect(plain / results.filter(entry => entry.scene.name.startsWith('move ')).length).toBeGreaterThan(0.8);
  });
});
