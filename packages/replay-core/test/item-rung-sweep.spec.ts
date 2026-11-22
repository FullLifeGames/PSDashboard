import { describe, expect, test } from 'vitest';
import { Battle, Dex, PRNG, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { belongsToOthers, boostItemIds, changesSpeed } from '../src/spreads/boost-items';
import { registerChampionsDex, rulesDex } from '../src/rules-dex';

/**
 * Round 89 (#75 step 2, ruling 27): the item rung swaps in only items the Dex says boost damage, so the list it reads must be the simulator's own.
 * `boostItemIds` derives it from the damage hooks of the Dex (`onModifyAtk`, `onModifySpA`, `onBasePower`, `onModifyDamage`), with no name in code.
 * This sweep holds that derivation to the simulator in every generation the corpus plays (2 to 9) and the Champions mod: every item of the generation
 * is put in the hand of an attacker on a twin battle, and the simulator's own `getDamage` answers, with and without the item, for one move of every
 * type and category, for the moves that carry each flag, against a neutral body and one the move is super effective on (Expert Belt). An item that
 * raises the damage of any of them is a damage-boost item.
 *  - Every such item is in `boostItemIds`, but the Generation 2 pair below.
 *  - Every item `boostItemIds` lists and the generation holds raised the damage of some move: the list holds no item that does nothing.
 * The Generation 2 pair: the Light Ball and the Thick Club raise their holder's stat in that generation's own stat calculation (`gen2/scripts`, "in
 * Generation 2 this happens in stat calculation directly"), so the Dex gives the items no damage hook and the rung never offers them there. Two
 * items of one species pair in one old generation; the rung is conservative there, which is the safe side.
 * A hit with the holder's own species items (Light Ball, Soul Dew, the Plates, the masks) is played by the species the Dex names in `itemUser`.
 * The rung also asks two more questions of the Dex, held here: which items change Speed (`changesSpeed`: the Scarf's, the Iron Ball's hook) and
 * which belong to other species (`belongsToOthers`: the `itemUser` list).
 */
if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface World { name: string; format: string; dex: ReturnType<typeof Dex.forGen>; rules: ReturnType<typeof rulesDex> }
const WORLDS: World[] = [2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Generation ${gen}`, format: `gen${gen}customgame`, dex: Dex.forGen(gen), rules: rulesDex(gen) }));
WORLDS.push({ name: 'Champions mod', format: 'gen9championscustomgame', dex: Dex.dexes.champions as World['dex'], rules: rulesDex(0) });

/** Items whose boost the simulator plays outside any item hook, by generation. */
const NO_HOOK: Record<string, string[]> = { 'Generation 2': ['lightball', 'thickclub'] };

const DEFENDERS = ['Mew', 'Slowbro', 'Charizard', 'Blastoise', 'Venusaur', 'Pikachu', 'Onix', 'Gyarados', 'Machamp', 'Gengar', 'Snorlax', 'Scizor', 'Weavile', 'Clefable', 'Dragonite', 'Alakazam', 'Steelix', 'Tyranitar', 'Skarmory'];
/** Flags that say nothing about damage. */
const PLAIN_FLAGS = new Set(['protect', 'mirror', 'metronome', 'contact', 'distance', 'defrost', 'bypasssub', 'cantusetwice', 'failcopycat', 'failinstruct', 'failmimic', 'noassist', 'nosleeptalk', 'noparentalbond', 'allyanim', 'nonsky', 'failencore', 'futuremove']);

const set = (species: string): PokemonSet => ({
  name: species, species, ability: 'No Ability', item: '', moves: ['splash'], level: 50, evs: { hp: 4 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: 'Hardy', gender: '',
}) as PokemonSet;

/** One move of every type and category, and the first damaging move of every flag the Dex knows, as ids. */
function sampleMoves(dex: World['dex']): string[] {
  const picked = new Map<string, string>();
  for (const move of dex.moves.all()) {
    if (!move.exists || move.id === 'hiddenpower' || move.category === 'Status' || move.basePower < 40 || move.basePowerCallback || move.damageCallback ||
      move.multihit || move.ohko || move.isZ || move.isMax || move.selfdestruct || move.isNonstandard === 'Future' || (move.target !== 'normal' && move.target !== 'any')) continue;
    const kind = `${move.type}|${move.category}`;
    if (!picked.has(kind)) picked.set(kind, move.id);
    for (const flag of Object.keys(move.flags)) if (!PLAIN_FLAGS.has(flag) && !picked.has(`flag:${flag}`)) picked.set(`flag:${flag}`, move.id);
  }
  return [...new Set(picked.values())];
}

/** The items of the generation that raise the damage of some sampled hit, played on the simulator. */
function raisers(world: World): { raising: Set<string>; held: Set<string> } {
  const { dex } = world;
  const moves = sampleMoves(dex);
  const defenders = DEFENDERS.filter(name => dex.species.get(name).exists && dex.species.get(name).isNonstandard !== 'Future');
  const battles = new Map<string, Battle>();
  const battleOf = (attacker: string, defender: string) => {
    const key = `${attacker}|${defender}`;
    let battle = battles.get(key);
    if (!battle) {
      battle = new Battle({ formatid: world.format as never, seed: [1, 2, 3, 4], p1: { name: 'a', team: [set(attacker)] }, p2: { name: 'b', team: [set(defender)] } });
      if (battle.requestState === 'teampreview') battle.makeChoices('default', 'default');
      battles.set(key, battle);
    }
    return battle;
  };
  const base = new Map<string, number | undefined>();
  const raising = new Set<string>();
  const held = new Set<string>();
  for (const item of dex.items.all()) {
    if (!item.exists || item.isNonstandard === 'Future') continue;
    held.add(item.id);
    const users = (item.itemUser ?? []).filter(name => dex.species.get(name).exists);
    if (item.itemUser && users.length === 0) continue;
    const holder = users[0] ?? 'Mew';
    for (const id of moves) {
      const type = dex.moves.get(id).type;
      const targets = [defenders[0], ...defenders.filter(name => dex.getEffectiveness(type, dex.species.get(name).types) > 0).slice(0, 1)];
      for (const target of targets) {
        const battle = battleOf(holder, target);
        const [attacker] = battle.p1.active;
        const [defender] = battle.p2.active;
        const hit = (itemId: string): number | undefined => {
          // The twin answers one hit at a time: the log and the event depth start fresh, the PRNG on the same seed, no critical hit.
          battle.sentLogPos = battle.log.length;
          battle.eventDepth = 0;
          attacker.volatiles = {} as never;
          attacker.setItem(itemId as never);
          battle.prng = new PRNG([1, 2, 3, 4]);
          const move = dex.getActiveMove(id);
          move.willCrit = false;
          const damage = battle.actions.getDamage(attacker, defender, move);
          return typeof damage === 'number' ? damage : undefined;
        };
        const key = `${holder}|${id}|${target}`;
        if (!base.has(key)) base.set(key, hit(''));
        const without = base.get(key);
        const withItem = hit(item.id);
        if (without !== undefined && withItem !== undefined && withItem > without) raising.add(item.id);
      }
    }
  }
  return { raising, held };
}

describe('the damage-boost items of the Dex are what the simulator plays', () => {
  for (const world of WORLDS) {
    test(`${world.name}: the list of boostItemIds is the set of items that raise a hit`, () => {
      const { raising, held } = raisers(world);
      const listed = boostItemIds(world.rules);
      const missed = [...raising].filter(id => !listed.has(id)).sort();
      expect(missed, 'the simulator raises the damage, the list lacks the item').toEqual(NO_HOOK[world.name] ?? []);
      const idle = [...listed].filter(id => held.has(id) && !raising.has(id)).sort();
      expect(idle, 'the list holds an item of the generation that raised no hit').toEqual([]);
      // The sample is wide enough to say anything: a Choice item, a type item, the Life Orb or the like reach.
      expect(raising.size).toBeGreaterThan(14);
    }, 240_000);
  }
});

describe('the two other questions the item rung asks of the Dex', () => {
  const gen9 = rulesDex(9);
  test('an item that changes Speed is the one the Dex gives a Speed hook; items of other species are the ones the Dex names users for', () => {
    for (const name of ['Choice Scarf', 'Iron Ball', 'Macho Brace']) expect(changesSpeed(gen9, name), name).toBe(true);
    for (const name of ['Choice Specs', 'Life Orb', 'Leftovers', '']) expect(changesSpeed(gen9, name), name).toBe(false);
    expect(belongsToOthers(gen9, 'Gengar', 'Light Ball')).toBe(true);
    expect(belongsToOthers(gen9, 'Pikachu', 'Light Ball')).toBe(false);
    expect(belongsToOthers(gen9, 'Gengar', 'Life Orb')).toBe(false);
    // The Dex is the oracle: every Speed hook is read from it, nothing is listed.
    const hooked = gen9.items.all().filter(item => typeof (item as unknown as Record<string, unknown>).onModifySpe === 'function').map(item => item.name);
    for (const name of hooked) expect(changesSpeed(gen9, name), name).toBe(true);
    expect(hooked).toContain('Choice Scarf');
  });
});
