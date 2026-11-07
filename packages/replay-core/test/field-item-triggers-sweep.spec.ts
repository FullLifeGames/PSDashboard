import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex, type RulesDex } from '../src/rules-dex';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { fieldItemIds } from '../src/inference/field-item-triggers';

/**
 * Round 88 (T349, GitHub issue #5): the sweep of the five items that fire when the field changes. The four terrain seeds
 * (`onTerrainChange`, Generation 7 on) and Room Service (`onAnyPseudoWeatherChange`, Generation 8 on, Past in the Champions mod)
 * are used the moment their holder stands in their terrain (or under Trick Room) and the field changes or the holder enters;
 * a log that shows the trigger without the item's line rules the item out. Each scene plays twice on @pkmn/sim: once with the
 * item (does the simulator use it, and does the inference then leave it alone) and once with an inert item and the same
 * choices (does the inference rule the item out exactly when the simulator used it). The scenes cover every trigger (the lead
 * with the terrain coming up, the holder's entry, a terrain or a pseudo-weather start by a move, a drag), every gate (Klutz,
 * Embargo, Magic Room, the wrong terrain, a block that ends later, a Trick Room that ends the first one) and the cases that
 * stay open (+6, Contrary, Commander), for singles and doubles in Generations 6 to 9 and the Champions mod. A scene the rule
 * leaves unjudged on purpose (a possible Klutz under Neutralizing Gas, an item the generation does not hold) is listed with
 * its reason and must never rule the item out.
 */

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface RuleSet { name: string; prefix: string; gen: number; champions?: boolean; smoke?: boolean }
const RULESETS: RuleSet[] = [
  { name: 'Generation 6 (the items do not exist yet)', prefix: 'gen6', gen: 6, smoke: true },
  { name: 'Generation 7', prefix: 'gen7', gen: 7 },
  { name: 'Generation 8', prefix: 'gen8', gen: 8 },
  { name: 'Generation 9', prefix: 'gen9', gen: 9 },
  { name: 'Champions mod', prefix: 'gen9champions', gen: 9, champions: true },
];
const dexOfRules = (rules: RuleSet): RulesDex => (rules.champions ? Dex.dexes.champions : Dex.forGen(rules.gen)) as RulesDex;

const mk = (species: string, o: Partial<PokemonSet> = {}): PokemonSet =>
  ({ name: species, species, ability: 'No Ability', item: '', moves: ['splash'], level: 50, evs: { hp: 4 }, ...o }) as PokemonSet;

interface Scene {
  label: string;
  holder: string;
  p1: PokemonSet[];
  p2: (item: string) => PokemonSet[];
  turns: [string, string][];
  /** The simulator uses the item and the rule leaves it unjudged on purpose: it must not rule the item out. */
  conservative?: string;
}

const TERRAINS = [
  { id: 'psychicterrain', move: 'psychicterrain', surge: 'Psychic Surge' },
  { id: 'electricterrain', move: 'electricterrain', surge: 'Electric Surge' },
  { id: 'grassyterrain', move: 'grassyterrain', surge: 'Grassy Surge' },
  { id: 'mistyterrain', move: 'mistyterrain', surge: 'Misty Surge' },
];
const SEEDS = [
  { item: 'Psychic Seed', terrain: 'psychicterrain', boost: 'amnesia' },
  { item: 'Electric Seed', terrain: 'electricterrain', boost: 'irondefense' },
  { item: 'Grassy Seed', terrain: 'grassyterrain', boost: 'irondefense' },
  { item: 'Misty Seed', terrain: 'mistyterrain', boost: 'irondefense' },
];

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const KLUTZ_NG = 'Neutralizing Gas switches the Klutz holder\'s ability off and the simulator uses the item; a possible Klutz stays unjudged';

function scenesFor(doubles: boolean, rules: RuleSet, item: string, dex: RulesDex): Scene[] {
  const pick = (first: string, second = 'move 1'): string => (doubles ? `${first}, ${second}` : first);
  const idle = pick('move 1');
  const mv = (set: PokemonSet, id: string, target?: number) => `move ${set.moves.indexOf(id) + 1}${doubles && target ? ` ${target}` : ''}`;
  const A = () => mk('Rattata');
  const B = () => mk('Mew');
  const X = () => mk('Mewtwo');
  const rest = () => [A(), B(), X()];
  const holder = (o: Partial<PokemonSet> = {}) => (itemName: string) => mk('Slowpoke', { item: itemName, ...o });
  const klutz = () => (itemName: string) => mk('Lopunny', { item: itemName, ability: 'Klutz' });
  const scenes: Scene[] = [];
  const add = (label: string, p1: PokemonSet[], p2: (itemName: string) => PokemonSet[], turns: [string, string][], extra: Partial<Scene> = {}, species = 'Slowpoke') =>
    scenes.push({ label, holder: species, p1, p2, turns, ...extra });
  const lead = (h: (itemName: string) => PokemonSet) => (itemName: string) => [h(itemName), B(), A(), X()];

  const seed = SEEDS.find(entry => entry.item === item);
  if (seed) {
    const terrain = TERRAINS.find(entry => entry.id === seed.terrain)!;
    const others = TERRAINS.filter(entry => entry !== terrain);
    const setter = (extraMoves: string[] = []) => mk('Pikachu', { moves: ['splash', ...extraMoves, terrain.move] });
    const setters = () => [A(), B(), X()];
    // The terrain starts by a move with the holder on the field.
    {
      const foe = setter();
      add('terrain by a foe\'s move', [foe, ...setters()], lead(holder()), [[pick(mv(foe, terrain.move)), idle]]);
    }
    if (rules.smoke) return scenes;
    add('the holder\'s own surge at the lead', [mk('Pikachu'), ...setters()], lead(holder({ ability: terrain.surge })), [[idle, idle]]);
    add('a foe\'s surge at the lead', [mk('Rattata', { ability: terrain.surge }), ...setters()], lead(holder()), [[idle, idle]]);
    add('the holder enters under the terrain', [mk('Rattata', { ability: terrain.surge }), ...setters()], itemName => [A(), B(), holder()(itemName), X()], [[idle, pick('switch 3')]]);
    {
      const roarer = mk('Rattata', { ability: terrain.surge, moves: ['splash', 'roar'] });
      add('the holder is dragged in under the terrain', [roarer, mk('Pikachu')],
        itemName => (doubles ? [A(), B(), holder()(itemName)] : [A(), holder()(itemName)]), [[pick(mv(roarer, 'roar', 1)), idle]]);
    }
    {
      const foe = setter();
      add('Klutz holder, terrain by a move', [foe, ...setters()], lead(klutz()), [[pick(mv(foe, terrain.move)), idle]], {}, 'Lopunny');
      const gas = mk('Weezing', { ability: 'Neutralizing Gas', moves: ['splash', terrain.move] });
      add('Klutz holder under Neutralizing Gas', [gas, ...setters()], lead(klutz()), [[pick(mv(gas, terrain.move)), idle]], { conservative: KLUTZ_NG }, 'Lopunny');
    }
    {
      const foe = setter(['embargo']);
      add('Embargo on the holder, then the terrain', [foe, ...setters()], lead(holder()),
        [[pick(mv(foe, 'embargo', 1)), idle], [pick(mv(foe, terrain.move)), idle]]);
      add('Embargo ends while the terrain stands', [foe, ...setters()], lead(holder()),
        [[pick(mv(foe, 'embargo', 1)), idle], [pick(mv(foe, terrain.move)), idle], [idle, idle], [idle, idle], [idle, idle], [idle, idle]]);
      add('blocked by Embargo, then the terrain starts again after both ended', [foe, ...setters()], lead(holder()),
        [[pick(mv(foe, 'embargo', 1)), idle], [pick(mv(foe, terrain.move)), idle], [idle, idle], [idle, idle], [idle, idle], [idle, idle], [pick(mv(foe, terrain.move)), idle]]);
    }
    {
      const foe = setter(['magicroom']);
      add('Magic Room, then the terrain', [foe, ...setters()], lead(holder()), [[pick(mv(foe, 'magicroom')), idle], [pick(mv(foe, terrain.move)), idle]]);
      add('Magic Room ends while the terrain stands', [foe, ...setters()], lead(holder()),
        [[pick(mv(foe, 'magicroom')), idle], [pick(mv(foe, terrain.move)), idle], [idle, idle], [idle, idle], [idle, idle], [idle, idle]]);
    }
    {
      const foe = setter();
      add('Contrary holder', [foe, ...setters()], lead(holder({ ability: 'Contrary' })), [[pick(mv(foe, terrain.move)), idle]]);
    }
    {
      const foe = setter();
      const boosting = (itemName: string) => mk('Slowpoke', { item: itemName, moves: ['splash', seed.boost] });
      const climb = (): [string, string] => [idle, pick(mv(boosting(''), seed.boost))];
      add('stat already at +6', [foe, ...setters()], itemName => [boosting(itemName), B(), A(), X()],
        [climb(), climb(), climb(), [pick(mv(foe, terrain.move)), idle]]);
    }
    {
      const other = others[0];
      const foe = mk('Pikachu', { ability: other.surge, moves: ['splash', terrain.move] });
      add(`${other.id} stands, the seed's own terrain replaces it`, [foe, ...setters()], lead(holder()), [[pick(mv(foe, terrain.move)), idle]]);
    }
    for (const other of others) {
      add(`the wrong terrain (${other.id}) stands`, [mk('Rattata', { ability: other.surge }), ...setters()], lead(holder()), [[idle, idle]]);
    }
    if (rules.gen >= 9) {
      const foe = setter();
      add('Commander holder', [foe, ...setters()], itemName => [mk('Tatsugiri', { item: itemName, ability: 'Commander' }), mk('Dondozo'), A(), X()],
        [[pick(mv(foe, terrain.move)), idle]], {}, 'Tatsugiri');
    }
    return scenes;
  }

  // Room Service
  const trick = () => mk('Pikachu', { moves: ['splash', 'trickroom'] });
  {
    const foe = trick();
    add('Trick Room by a foe\'s move', [foe, ...rest()], lead(holder()), [[pick(mv(foe, 'trickroom')), idle]]);
  }
  if (rules.smoke) return scenes;
  {
    const own = (itemName: string) => mk('Slowpoke', { item: itemName, moves: ['splash', 'trickroom'] });
    add('Trick Room by the holder', [mk('Pikachu'), ...rest()], itemName => [own(itemName), B(), A(), X()], [[idle, pick(mv(own(''), 'trickroom'))]]);
    const foe = trick();
    add('the holder enters under Trick Room', [foe, ...rest()], itemName => [A(), B(), holder()(itemName), X()],
      [[pick(mv(foe, 'trickroom')), idle], [idle, pick('switch 3')]]);
    add('Klutz holder', [foe, ...rest()], lead(klutz()), [[pick(mv(foe, 'trickroom')), idle]], {}, 'Lopunny');
    const gas = mk('Weezing', { ability: 'Neutralizing Gas', moves: ['splash', 'trickroom'] });
    add('Klutz holder under Neutralizing Gas', [gas, ...rest()], lead(klutz()), [[pick(mv(gas, 'trickroom')), idle]], { conservative: KLUTZ_NG }, 'Lopunny');
  }
  {
    const foe = mk('Pikachu', { moves: ['splash', 'embargo', 'trickroom', 'magicroom'] });
    add('Embargo on the holder, then Trick Room', [foe, ...rest()], lead(holder()), [[pick(mv(foe, 'embargo', 1)), idle], [pick(mv(foe, 'trickroom')), idle]]);
    add('Magic Room, then Trick Room', [foe, ...rest()], lead(holder()), [[pick(mv(foe, 'magicroom')), idle], [pick(mv(foe, 'trickroom')), idle]]);
    add('a second Trick Room ends the first (the holder was blocked by Embargo at the first)', [foe, ...rest()], lead(holder()),
      [[pick(mv(foe, 'embargo', 1)), idle], [pick(mv(foe, 'trickroom')), idle], [idle, idle], [idle, idle], [idle, idle], [pick(mv(foe, 'trickroom')), idle]]);
  }
  // Every pseudo-weather the Dex names, started late under a Trick Room the holder was blocked at.
  const ids = [...new Set(dex.moves.all().filter(move => !!move.pseudoWeather && move.pseudoWeather !== 'trickroom').map(move => move.pseudoWeather as string))];
  for (const id of ids) {
    const move = dex.moves.all().find(entry => entry.pseudoWeather === id && entry.target === 'all');
    if (!move) continue;
    const foe = mk('Pikachu', { moves: ['splash', 'embargo', 'trickroom', move.id] });
    add(`${id} starts late under Trick Room (blocked by Embargo at its start)`, [foe, ...rest()], lead(holder()),
      [[pick(mv(foe, 'embargo', 1)), idle], [pick(mv(foe, 'trickroom')), idle], [idle, idle], [idle, idle], [idle, idle], [pick(mv(foe, move.id)), idle]]);
  }
  return scenes;
}

const orderOf = (team: PokemonSet[]) => team.map((_, index) => index + 1).join('');

function play(rules: RuleSet, doubles: boolean, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): string {
  const format = `${rules.prefix}${doubles ? 'doubles' : ''}customgame`;
  const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: p1 as never }, p2: { name: 'Beta', team: p2 as never } });
  if (battle.requestState === 'teampreview') battle.makeChoices(`team ${orderOf(p1)}`, `team ${orderOf(p2)}`);
  for (const [first, second] of turns) {
    const before = battle.turn;
    battle.makeChoices(first, second);
    if (!battle.ended && battle.turn === before) throw new Error(`choice not taken in ${format}: "${first}" / "${second}"`);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const ruledOut = (log: string, species: string) => inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species)?.ruledOut?.items ?? [];

const ITEMS = ['Psychic Seed', 'Electric Seed', 'Grassy Seed', 'Misty Seed', 'Room Service'];

describe('the Dex lists the five items that read the field', () => {
  test.each(RULESETS)('$name: no other item has a field handler', rules => {
    expect(fieldItemIds(dexOfRules(rules)).sort()).toEqual(ITEMS.map(idOf).sort());
  });
});

describe('a terrain seed or Room Service that never fired is ruled out (T349)', () => {
  for (const rules of RULESETS) {
    for (const doubles of [false, true]) {
      test(`${rules.name}, ${doubles ? 'doubles' : 'singles'}: the rule matches the simulator in every scene`, () => {
        const dex = dexOfRules(rules);
        const problems: string[] = [];
        let fired = 0;
        let rows = 0;
        for (const item of ITEMS) {
          const id = idOf(item);
          const entry = dex.items.get(item);
          const exists = entry.exists && entry.gen <= rules.gen;
          const withItem = scenesFor(doubles, rules, item, dex);
          for (const scene of withItem) {
            rows++;
            const label = `${item}: ${scene.label}`;
            let seeded: string;
            let inert: string;
            try {
              seeded = play(rules, doubles, scene.p1, scene.p2(item), scene.turns);
              inert = play(rules, doubles, scene.p1, scene.p2('Leftovers'), scene.turns);
            } catch (error) {
              problems.push(`${label}: ${(error as Error).message}`);
              continue;
            }
            const used = new RegExp(`^\\|-enditem\\|p2[ab]: ${scene.holder}\\|${item}$`, 'm').test(seeded);
            if (used) fired++;
            if (ruledOut(seeded, scene.holder).includes(id)) problems.push(`${label}: rules out the item the holder has`);
            const ruled = ruledOut(inert, scene.holder).includes(id);
            if (!exists || scene.conservative) {
              if (ruled) problems.push(`${label}: rules the item out, but the rule must stay out (${scene.conservative ?? 'the item is not in the generation'})`);
            } else if (ruled !== used) {
              problems.push(`${label}: the simulator ${used ? 'uses' : 'does not use'} the item, the rule ${ruled ? 'rules it out' : 'leaves it'}`);
            }
          }
        }
        expect(problems).toEqual([]);
        // The sweep is no vacuous pass: Generation 6 holds no such item, the others use some in most of their scenes.
        expect(rows).toBeGreaterThan(rules.smoke ? 4 : 50);
        if (!rules.smoke) expect(fired).toBeGreaterThan(20);
      });
    }
  }
});

/** The head of gen9championsvgc2026regmc-2710507840 (the issue's replay): Indeedee-F's Psychic Surge at the lead, a Trick Room at turn 1. */
const ISSUE_LOG = (tier: string) => [
  '|gametype|doubles', '|player|p1|Alpha|1|1000', '|player|p2|Beta|1|1008', '|gen|9', `|tier|${tier}`,
  '|poke|p1|Glimmora, L50, M, shiny|', '|poke|p1|Volcarona, L50, F|', '|poke|p1|Rillaboom, L50, F|', '|poke|p1|Kingambit, L50, F, shiny|',
  '|poke|p1|Whimsicott, L50, F, shiny|', '|poke|p1|Farigiraf, L50, M|',
  '|poke|p2|Gardevoir, L50, F|', '|poke|p2|Indeedee-F, L50, F|', '|poke|p2|Torkoal, L50, F|', '|poke|p2|Salamence, L50, M|',
  '|poke|p2|Garchomp, L50, F|', '|poke|p2|Sneasler, L50, M|', '|teampreview|4', '|teamsize|p1|4', '|teamsize|p2|4', '|start',
  '|switch|p1a: Volcarona|Volcarona, L50, F|100/100', '|switch|p1b: Kingambit|Kingambit, L50, F, shiny|100/100',
  '|switch|p2a: Torkoal|Torkoal, L50, F|100/100', '|switch|p2b: Indeedee|Indeedee-F, L50, F|100/100',
  '|-fieldstart|move: Psychic Terrain|[from] ability: Psychic Surge|[of] p2b: Indeedee', '|turn|1',
  '|move|p1b: Kingambit|Protect|p1b: Kingambit', '|-singleturn|p1b: Kingambit|Protect',
  '|move|p2a: Torkoal|Protect|p2a: Torkoal', '|-singleturn|p2a: Torkoal|Protect',
  '|move|p1a: Volcarona|Quiver Dance|p1a: Volcarona', '|-boost|p1a: Volcarona|spa|1', '|-boost|p1a: Volcarona|spd|1', '|-boost|p1a: Volcarona|spe|1',
  '|move|p2b: Indeedee|Trick Room|p2b: Indeedee', '|-fieldstart|move: Trick Room|[of] p2b: Indeedee', '|', '|upkeep', '|turn|2',
].join('\n');

describe('the issue\'s replay (gen9championsvgc2026regmc-2710507840)', () => {
  const upTo = (log: string, marker: string) => log.slice(0, log.indexOf(marker) + marker.length);

  test('turn 1: Indeedee-F stood in its own Psychic Terrain and showed no Psychic Seed', () => {
    const items = ruledOut(upTo(ISSUE_LOG('[Gen 9 Champions] VGC 2026 Reg M-C'), '|turn|1'), 'Indeedee-F');
    expect(items).toContain('psychicseed');
    expect(items).not.toContain('electricseed');
  });

  test('turn 2, judged in a Scarlet/Violet copy: no Room Service fired when Trick Room came up with Indeedee-F out', () => {
    const items = ruledOut(ISSUE_LOG('[Gen 9] VGC 2026 Reg I'), 'Indeedee-F');
    expect(items).toContain('roomservice');
    expect(items).toContain('psychicseed');
  });
});
