import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex, rulesDex, type RulesDex } from '../src/rules-dex';
import { ppEaters } from '../src/inference/item-triggers';
import { maxPpOf } from '../src/inference/pp-trigger';

/**
 * Round 89 (#132): the sweep behind the Leppa Berry rule. The rule rests on two readings of the simulator that this file holds to
 * the simulator itself, in every generation and mod the corpus plays (Generations 1 to 9 and the Champions mod), for singles and
 * doubles:
 *  - which items eat when a slot of their holder sits at 0 PP (`ppEaters`): the stand-in's verdict for every item of the Dex
 *    against the simulator playing a Splash turn that spends the holder's last PP (the PP comes back, or it does not);
 *  - the maximum PP of a move (`maxpp`), asked on a twin of the battle's format (`maxPpOf`), against the slot a battle of the
 *    realm's own tiers holds for the same move (Champions computes PP its own way).
 */

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface Realm { name: string; gen: number; champions?: boolean; singles: string; doubles: string; tiers: string[] }
const REALMS: Realm[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((gen): Realm => ({ name: `Generation ${gen}`, gen, singles: `gen${gen}customgame`, doubles: `gen${gen}doublescustomgame`, tiers: [`gen${gen}ou`] })),
  { name: 'Champions mod', gen: 9, champions: true, singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame', tiers: ['gen9championsou', 'gen9championsvgc2026regmc'] },
];
const dexOf = (realm: Realm): RulesDex => (realm.champions ? rulesDex(9, 'champions') : rulesDex(realm.gen));

const mk = (species: string, item: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability: 'No Ability', moves, nature: 'Hardy', level: 100, gender: '',
  evs: { hp: 4 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});
const startOf = (battle: Battle, size: number) => {
  if (battle.requestState === 'teampreview') for (const side of ['p1', 'p2']) battle.choose(side, `team ${Array.from({ length: size }, (_, index) => index + 1).join('')}`);
};
const firstSpecies = (dex: RulesDex) => dex.species.all().find(entry => entry.gen <= dex.gen && !entry.isNonstandard)!.name;

/** Whether the simulator gives a holder PP back in the turn that spends its last one: the holder's only move has 1 PP left, and it splashes. */
function simEats(format: string, dex: RulesDex, itemName: string, doubles: boolean): boolean {
  const species = firstSpecies(dex);
  const holder = [mk(species, itemName, ['Splash'])];
  const filler = [mk(species, '', ['Splash'])];
  const own = doubles ? [...holder, ...filler] : holder;
  const foes = doubles ? [...filler, ...filler] : filler;
  const battle = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack(own) }, p2: { name: 'B', team: Teams.pack(foes) } });
  startOf(battle, own.length);
  const slot = battle.p1.pokemon[0].moveSlots[0];
  slot.pp = 1;
  battle.choose('p1', doubles ? 'move 1, move 1' : 'move 1');
  battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
  // The move must have run (Assault Vest disables Splash, a confusion hit stops it before it spends PP) and its slot must hold PP again.
  return slot.used && slot.pp > 0;
}

describe('the items that eat at 0 PP, stand-in against simulator (#132)', () => {
  // What the Dex holds: Leppa Berry from Generation 3, Mystery Berry from Generation 2 (its Dex entry keeps the handler in later generations, as a past item).
  const PINNED: Record<string, string[]> = {
    'Generation 1': [], 'Generation 2': ['mysteryberry'], 'Generation 3': ['leppaberry', 'mysteryberry'], 'Generation 4': ['leppaberry', 'mysteryberry'],
    'Generation 5': ['leppaberry', 'mysteryberry'], 'Generation 6': ['leppaberry', 'mysteryberry'], 'Generation 7': ['leppaberry', 'mysteryberry'],
    'Generation 8': ['leppaberry', 'mysteryberry'], 'Generation 9': ['leppaberry', 'mysteryberry'], 'Champions mod': ['leppaberry', 'mysteryberry'],
  };

  test.each(REALMS.map(realm => [realm.name, realm] as const))('%s: the stand-in names the items the simulator eats for', (_name, realm) => {
    const dex = dexOf(realm);
    const eaters = ppEaters(dex);
    expect([...eaters].sort(), 'the items of the Dex that eat at 0 PP').toEqual(PINNED[realm.name]);
    const items = dex.items.all().filter(item => item.exists && item.gen <= dex.gen);
    const wrong: string[] = [];
    let played = 0;
    for (const format of [realm.singles, ...(Dex.formats.get(realm.doubles).exists ? [realm.doubles] : [])]) {
      const doubles = format === realm.doubles;
      for (const item of items) {
        // Every item in singles; in doubles the eaters and one item in eight (the handlers do not read the game type).
        if (doubles && !eaters.has(item.id) && played++ % 8) continue;
        let ate: boolean;
        try {
          ate = simEats(format, dex, item.name, doubles);
        } catch (error) {
          wrong.push(`${format} ${item.id}: the simulator threw ${(error as Error).message}`);
          continue;
        }
        if (ate !== eaters.has(item.id)) wrong.push(`${format} ${item.id}: simulator ${ate}, stand-in ${eaters.has(item.id)}`);
      }
    }
    expect(wrong).toEqual([]);
    // The realm has the doubles format the corpus plays, except Generations 1 and 2 (no doubles in those games).
    if (realm.gen > 2) expect(Dex.formats.get(realm.doubles).exists, `${realm.doubles} exists`).toBe(true);
  }, 240_000);

  test('an item the Dex does not hold in the generation is no eater there', () => {
    expect(ppEaters(rulesDex(1)).size).toBe(0);
    expect(ppEaters(rulesDex(2)).has('leppaberry')).toBe(false);
  });
});

describe('the maximum PP of a move, twin against a battle of the realm\'s tiers (#132)', () => {
  test.each(REALMS.map(realm => [realm.name, realm] as const))('%s: every move of the Dex', (_name, realm) => {
    const dex = dexOf(realm);
    const moves = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen);
    const wrong: string[] = [];
    let compared = 0;
    for (const tier of realm.tiers.filter(id => Dex.formats.get(id).exists)) {
      for (let start = 0; start < moves.length; start += 4) {
        const group = moves.slice(start, start + 4);
        const species = firstSpecies(dex);
        const battle = new Battle({ formatid: toID(tier), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack([mk(species, '', group.map(move => move.name))]) }, p2: { name: 'B', team: Teams.pack([mk(species, '', ['Splash'])]) } });
        for (const move of group) {
          const slot = battle.p1.pokemon[0].moveSlots.find(entry => entry.id === move.id);
          if (!slot) continue;
          compared++;
          const asked = maxPpOf(dex, move.name);
          if (asked !== slot.maxpp) wrong.push(`${tier} ${move.id}: battle ${slot.maxpp}, twin ${asked}`);
        }
      }
    }
    expect(compared, 'moves compared').toBeGreaterThan(realm.gen > 1 ? 100 : 50);
    expect(wrong.slice(0, 20)).toEqual([]);
  }, 240_000);

  test('a move the Dex does not know has no maximum', () => {
    expect(maxPpOf(rulesDex(9), 'Not A Move')).toBeNull();
  });
});
