import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex, type RulesDex } from '../src/rules-dex';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { spentAfterOwnMove, spentByHit } from '../src/inference/spent-items';

// A scene left unjudged on purpose carries its reason and must never rule the item out.

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface RuleSet { name: string; prefix: string; gen: number; champions?: boolean }
const RULESETS: RuleSet[] = [3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Generation ${gen}`, prefix: `gen${gen}`, gen }))
  .concat([{ name: 'Champions mod', prefix: 'gen9champions', gen: 9, champions: true }]);
const dexOfRules = (rules: RuleSet): RulesDex => (rules.champions ? Dex.dexes.champions : Dex.forGen(rules.gen)) as RulesDex;

const mk = (species: string, o: Partial<PokemonSet> = {}): PokemonSet =>
  ({ name: species, species, ability: 'No Ability', item: '', moves: ['splash'], level: 100, evs: { hp: 252, spa: 252 }, ...o }) as PokemonSet;

interface Scene {
  label: string;
  holder: string;
  p1: PokemonSet[];
  p2: (item: string) => PokemonSet[];
  turns: [string, string][];
  conservative?: string;
  ifFaints?: boolean;
}

// An item that prints no line, so the inference cannot learn it from the log.
const INERT = 'Light Ball';
const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const pickFor = (doubles: boolean) => (first: string, second = 'move 1'): string => (doubles ? `${first}, ${second}` : first);
const aimedFor = (doubles: boolean) => (move: number, target: number) => `move ${move}${doubles ? ` ${target}` : ''}`;
const foesFor = (doubles: boolean) => (first: PokemonSet) => (doubles ? [first, mk('Chansey', { moves: ['splash', 'protect'] })] : [first]);

function ownMoveScenes(doubles: boolean, item: string): Scene[] {
  const pick = pickFor(doubles);
  const aimed = aimedFor(doubles);
  const foes = foesFor(doubles);
  const wall = () => mk('Blissey', { moves: ['splash', 'protect', 'substitute', 'embargo', 'magicroom'] });
  const exploud = (o: Partial<PokemonSet> = {}) => (itemName: string) =>
    foes(mk('Exploud', { item: itemName, moves: ['hypervoice', 'nastyplot', 'bugbuzz', 'growl', 'splash'], ...o }));
  const scenes: Scene[] = [];
  const add = (label: string, p1: PokemonSet[], p2: (itemName: string) => PokemonSet[], turns: [string, string][], extra: Partial<Scene> = {}) =>
    scenes.push({ label, holder: 'Exploud', p1: foes(p1[0]), p2, turns, ...extra });
  const blast: [string, string] = [pick('move 1'), pick('move 1')];

  add('Hyper Voice hits', [wall()], exploud(), [blast]);
  if (!item) return scenes;
  add('Hyper Voice at +6 Special Attack', [wall()], exploud(), [[pick('move 1'), pick('move 2')], [pick('move 1'), pick('move 2')], [pick('move 1'), pick('move 2')], blast]);
  add('Hyper Voice through a Substitute', [wall()], exploud(), [[pick('move 3'), pick('move 5')], blast]);
  add('every target protects', [wall()], exploud(), [[pick('move 2', 'move 2'), pick('move 1')]]);
  add('one of two targets protects', [wall()], exploud(), [[pick('move 2', 'move 1'), pick('move 1')]]);
  add('the target is Soundproof', [mk('Kommo-o', { ability: 'Soundproof' })], exploud(), [blast]);
  add('Embargo on the holder', [wall()], exploud(), [[pick(aimed(4, 1)), pick('move 5')], blast]);
  add('Magic Room', [wall()], exploud(), [[pick('move 5'), pick('move 5')], blast]);
  add('Bug Buzz from a Sheer Force holder', [wall()], itemName => foes(mk('Nidoking', { item: itemName, ability: 'Sheer Force', moves: ['bugbuzz', 'splash'] })),
    [[pick('move 1'), pick(aimed(1, 1))]], { holder: 'Nidoking' });
  add('the hit knocks out the last foe', [mk('Pichu', { level: 1 })], exploud(), [blast]);
  add('Growl, a status sound move', [wall()], exploud(), [[pick('move 1'), pick('move 4')]], { conservative: 'Growl fires the item and hits no one: the rule needs a damaging hit' });
  const klutz = (itemName: string) => foes(mk('Lopunny', { item: itemName, ability: 'Klutz', moves: ['hypervoice', 'splash'] }));
  add('Klutz holder', [wall()], klutz, [blast], { holder: 'Lopunny' });
  add('Klutz holder beside Neutralizing Gas', [mk('Weezing', { ability: 'Neutralizing Gas' })], klutz, [blast],
    { holder: 'Lopunny', conservative: 'Neutralizing Gas turns Klutz off and the simulator uses the item; a possible Klutz stays unjudged' });
  return scenes;
}

interface HitItem {
  item: string;
  hit: string;
  miss: string;
  forced: string;
  ally?: string;
  kind?: 'type' | 'category';
  berry?: boolean;
  afterSecondary?: boolean;
  healing?: boolean;
  guard?: boolean;
  liquid?: boolean;
  effectiveness?: boolean;
}
const HIT_ITEMS: HitItem[] = [
  { item: 'Weakness Policy', hit: 'Mach Punch', miss: 'Tackle', forced: 'Force Palm', ally: 'Earthquake', effectiveness: true },
  { item: 'Enigma Berry', hit: 'Mach Punch', miss: 'Tackle', forced: 'Force Palm', ally: 'Earthquake', berry: true, effectiveness: true, healing: true },
  { item: 'Kee Berry', hit: 'Tackle', miss: 'Hyper Voice', forced: 'Force Palm', ally: 'Earthquake', kind: 'category', berry: true, afterSecondary: true },
  { item: 'Maranga Berry', hit: 'Hyper Voice', miss: 'Tackle', forced: 'Focus Blast', ally: 'Surf', kind: 'category', berry: true, afterSecondary: true },
  { item: 'Jaboca Berry', hit: 'Tackle', miss: 'Hyper Voice', forced: 'Force Palm', ally: 'Earthquake', kind: 'category', berry: true, guard: true },
  { item: 'Rowap Berry', hit: 'Hyper Voice', miss: 'Tackle', forced: 'Focus Blast', ally: 'Surf', kind: 'category', berry: true, guard: true },
  { item: 'Absorb Bulb', hit: 'Water Gun', miss: 'Tackle', forced: 'Bubble Beam', ally: 'Surf', kind: 'type', liquid: true },
  { item: 'Luminous Moss', hit: 'Water Gun', miss: 'Tackle', forced: 'Bubble Beam', ally: 'Surf', kind: 'type', liquid: true },
  { item: 'Cell Battery', hit: 'Thunderbolt', miss: 'Tackle', forced: 'Thunderbolt', ally: 'Discharge', kind: 'type' },
  { item: 'Snowball', hit: 'Ice Beam', miss: 'Tackle', forced: 'Ice Beam', kind: 'type' },
];

function hitScenes(doubles: boolean, spec: HitItem, rules: RuleSet, exists: boolean): Scene[] {
  const dex = dexOfRules(rules);
  const pick = pickFor(doubles);
  const aimed = aimedFor(doubles);
  const foes = foesFor(doubles);
  const striker = (o: Partial<PokemonSet> = {}, moves = [spec.hit]) =>
    mk('Machamp', { level: 30, evs: {}, moves: [...moves, 'splash', 'embargo', 'magicroom', 'healblock'], ...o });
  const holder = (species: string, o: Partial<PokemonSet> = {}) => (itemName: string) =>
    foes(mk(species, { item: exists ? itemName : '', moves: ['splash', 'substitute'], ...o }));
  const aim = (slot: number, move: string) => (['normal', 'any', 'adjacentFoe'].includes(dex.moves.get(move).target) ? aimed(slot, 1) : `move ${slot}`);
  const strike = (attacker: PokemonSet): [string, string] => [pick(aim(1, attacker.moves[0])), pick('move 1')];
  const scenes: Scene[] = [];
  const add = (label: string, attacker: PokemonSet, p2: (itemName: string) => PokemonSet[], before: [string, string][] = [], extra: Partial<Scene> = {}) =>
    scenes.push({ label, holder: 'Snorlax', p1: foes(attacker), p2, turns: [...before, strike(attacker)], ...extra });
  const gen = rules.gen;

  add(`${spec.hit} hits`, striker(), holder('Snorlax'));
  if (!exists) return scenes;
  add(`${spec.miss}, which the item does not read`, striker({}, [spec.miss]), holder('Snorlax'));
  add('Klutz holder', striker(), holder('Lopunny', { ability: 'Klutz' }), [], { holder: 'Lopunny' });
  add('Klutz holder beside Neutralizing Gas', striker({ species: 'Weezing', ability: 'Neutralizing Gas' }), holder('Lopunny', { ability: 'Klutz' }), [],
    { holder: 'Lopunny', conservative: 'Neutralizing Gas turns Klutz off and the simulator uses the item; a possible Klutz stays unjudged' });
  add('Embargo on the holder', striker(), holder('Snorlax'), [[pick(aimed(3, 1)), pick('move 1')]]);
  add('Magic Room', striker(), holder('Snorlax'), [[pick('move 4'), pick('move 1')]]);
  add('the holder stands behind a Substitute', striker(), holder('Snorlax'), [[pick('move 2'), pick('move 2')]]);
  add('the holder faints in the hit', striker(), holder('Pichu', { level: 1 }), [],
    { holder: 'Pichu', ifFaints: true, conservative: 'a fainted holder gets no verdict (a Jaboca or Rowap Berry still eats at 0 HP)' });
  if (spec.effectiveness) {
    add('a fixed-damage move of the same type', striker({}, ['Seismic Toss']), holder('Snorlax'));
    if (doubles) {
      const slide = (itemName: string) => [mk('Charizard', { item: itemName, moves: ['splash'] }), mk('Snorlax', { item: itemName, moves: ['splash'] })];
      add('a spread move super-effective on one of two holders: the weak one', striker({}, ['Rock Slide']), slide, [], { holder: 'Charizard' });
      add('a spread move super-effective on one of two holders: the other one', striker({}, ['Rock Slide']), slide);
    }
  }
  if (spec.healing && gen >= 5) add('Heal Block on the holder', striker(), holder('Snorlax'), [[pick(aim(5, 'healblock')), pick('move 1')]]);
  if (spec.berry && gen >= 5) add('an Unnerve attacker', striker({ species: 'Tyranitar', ability: 'Unnerve' }), holder('Snorlax'));
  if (gen >= 5) {
    add(`${spec.forced} from a Sheer Force attacker`, striker({ species: 'Nidoking', ability: 'Sheer Force' }, [spec.forced]), holder('Snorlax'), [],
      rules.champions && spec.afterSecondary ? { conservative: 'the Champions mod lets an AfterMoveSecondary item fire through Sheer Force; the rule stops at it' } : {});
  }
  if (spec.guard) add('a Magic Guard attacker', striker({ species: 'Clefable', ability: 'Magic Guard' }), holder('Snorlax'));
  if (spec.kind === 'type') add('a Normalize attacker', striker({ species: 'Delcatty', ability: 'Normalize' }), holder('Snorlax'));
  if (spec.liquid && gen >= 7) {
    add('Hyper Voice from a Liquid Voice attacker', striker({ species: 'Primarina', ability: 'Liquid Voice' }, ['Hyper Voice']), holder('Snorlax'), [],
      { conservative: 'Liquid Voice makes the sound move Water and the simulator uses the item; a possible type shift stays unjudged' });
  }
  if (spec.kind === 'category' && gen >= 8) {
    add('Shell Side Arm turned physical', striker({ evs: { atk: 252 }, nature: 'Adamant' }, ['Shell Side Arm']), holder('Snorlax', { evs: { spd: 252 }, nature: 'Lax' }), [],
      { conservative: 'the simulator picks the category from the stats at use; a move that may change it stays unjudged' });
  }
  if (doubles && spec.ally) {
    const friend = () => mk('Chansey', { moves: ['splash'] });
    scenes.push({
      label: `${spec.ally} from the holder's own ally`, holder: 'Aggron', p1: [friend(), friend()],
      p2: itemName => [striker({}, [spec.ally ?? '']), mk('Aggron', { item: itemName, moves: ['splash'] })],
      turns: [[pick('move 1'), pick('move 1')]],
    });
  }
  return scenes;
}

interface ItemSpec { item: string; scenes: (doubles: boolean, rules: RuleSet, exists: boolean) => Scene[] }
const ITEM_SPECS: ItemSpec[] = [
  { item: 'Throat Spray', scenes: (doubles, _rules, exists) => ownMoveScenes(doubles, exists ? 'Throat Spray' : '') },
  ...HIT_ITEMS.map(spec => ({ item: spec.item, scenes: (doubles: boolean, rules: RuleSet, exists: boolean) => hitScenes(doubles, spec, rules, exists) })),
];

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

const HIT_BY_GEN = (gen: number): string[] => [
  ...(gen >= 4 ? ['enigmaberry', 'jabocaberry', 'rowapberry'] : []),
  ...(gen >= 5 ? ['absorbbulb', 'cellbattery'] : []),
  ...(gen >= 6 ? ['keeberry', 'luminousmoss', 'marangaberry', 'snowball', 'weaknesspolicy'] : []),
].sort();

describe('the Dex lists the items that spend themselves when a move hits their holder', () => {
  test.each(RULESETS)('$name', rules => {
    expect([...spentByHit(dexOfRules(rules))].sort()).toEqual(HIT_BY_GEN(rules.gen));
  });
});

describe('the Dex lists the items that spend themselves after their holder\'s own move', () => {
  test.each(RULESETS)('$name', rules => {
    expect(spentAfterOwnMove(dexOfRules(rules))).toEqual(rules.gen >= 8 ? ['throatspray'] : []);
  });
});

describe('an item that a move spends and that printed no line is ruled out', () => {
  for (const rules of RULESETS) {
    for (const doubles of [false, true]) {
      test(`${rules.name}, ${doubles ? 'doubles' : 'singles'}: the rule matches the simulator in every scene`, () => {
        const dex = dexOfRules(rules);
        const problems: string[] = [];
        let fired = 0;
        let rows = 0;
        for (const { item, scenes } of ITEM_SPECS) {
          const entry = dex.items.get(item);
          const exists = entry.exists && entry.gen <= rules.gen;
          for (const scene of scenes(doubles, rules, exists)) {
            rows++;
            const label = `${item}: ${scene.label}`;
            let seeded: string;
            let inert: string;
            try {
              seeded = play(rules, doubles, scene.p1, scene.p2(item), scene.turns);
              inert = play(rules, doubles, scene.p1, scene.p2(INERT), scene.turns);
            } catch (error) {
              problems.push(`${label}: ${(error as Error).message}`);
              continue;
            }
            const used = new RegExp(`^\\|-enditem\\|p2[ab]: ${scene.holder}\\|${item}(\\||$)`, 'm').test(seeded);
            if (used && exists) fired++;
            if (ruledOut(seeded, scene.holder).includes(idOf(item))) problems.push(`${label}: rules out the item the holder has`);
            const ruled = ruledOut(inert, scene.holder).includes(idOf(item));
            const unjudged = scene.conservative && (!scene.ifFaints || new RegExp(`^\\|faint\\|p2[ab]: ${scene.holder}$`, 'm').test(seeded));
            if (!exists || unjudged) {
              if (ruled) problems.push(`${label}: rules the item out, but the rule must stay out (${scene.conservative ?? 'the item is not in the generation'})`);
            } else if (ruled !== used) {
              problems.push(`${label}: the simulator ${used ? 'uses' : 'does not use'} the item, the rule ${ruled ? 'rules it out' : 'leaves it'}`);
            }
          }
        }
        expect(problems).toEqual([]);
        if (rules.gen >= 8) {
          expect(rows).toBeGreaterThan(100);
          expect(fired).toBeGreaterThan(30);
        }
      });
    }
  }
});
