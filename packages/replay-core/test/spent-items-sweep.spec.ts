import { describe, expect, test } from 'vitest';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex, type RulesDex } from '../src/rules-dex';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { spentAfterOwnMove } from '../src/inference/spent-items';

// Each scene plays with the item and with an inert one: the inference rules the item out exactly when the sim used it.
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
}

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function ownMoveScenes(doubles: boolean, item: string): Scene[] {
  const pick = (first: string, second = 'move 1'): string => (doubles ? `${first}, ${second}` : first);
  const aimed = (move: number, target: number) => `move ${move}${doubles ? ` ${target}` : ''}`;
  const wall = () => mk('Blissey', { moves: ['splash', 'protect', 'substitute', 'embargo', 'magicroom'] });
  const friend = () => mk('Chansey', { moves: ['splash', 'protect'] });
  const foes = (first: PokemonSet) => (doubles ? [first, friend()] : [first]);
  const exploud = (o: Partial<PokemonSet> = {}) => (itemName: string) =>
    foes(mk('Exploud', { item: itemName, moves: ['hypervoice', 'nastyplot', 'bugbuzz', 'growl', 'splash'], ...o }));
  const scenes: Scene[] = [];
  const add = (label: string, p1: PokemonSet[], p2: (itemName: string) => PokemonSet[], turns: [string, string][], extra: Partial<Scene> = {}) =>
    scenes.push({ label, holder: 'Exploud', p1: foes(p1[0]), p2, turns, ...extra });
  const blast: [string, string] = [pick('move 1'), pick('move 1')];

  add('Hyper Voice hits', [wall()], exploud(), [blast]);
  if (item !== 'Throat Spray') return scenes;
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

describe('the Dex lists the items that spend themselves after their holder\'s own move', () => {
  test.each(RULESETS)('$name', rules => {
    expect(spentAfterOwnMove(dexOfRules(rules))).toEqual(rules.gen >= 8 ? ['throatspray'] : []);
  });
});

describe('an item that its holder\'s own move spends and that printed no line is ruled out', () => {
  for (const rules of RULESETS) {
    for (const doubles of [false, true]) {
      test(`${rules.name}, ${doubles ? 'doubles' : 'singles'}: the rule matches the simulator in every scene`, () => {
        const dex = dexOfRules(rules);
        const problems: string[] = [];
        let fired = 0;
        let rows = 0;
        for (const item of ['Throat Spray']) {
          const entry = dex.items.get(item);
          const exists = entry.exists && entry.gen <= rules.gen;
          for (const scene of ownMoveScenes(doubles, exists ? item : '')) {
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
            const used = new RegExp(`^\\|-enditem\\|p2a: ${scene.holder}\\|${item}$`, 'm').test(seeded);
            if (used && exists) fired++;
            if (ruledOut(seeded, scene.holder).includes(idOf(item))) problems.push(`${label}: rules out the item the holder has`);
            const ruled = ruledOut(inert, scene.holder).includes(idOf(item));
            if (!exists || scene.conservative) {
              if (ruled) problems.push(`${label}: rules the item out, but the rule must stay out (${scene.conservative ?? 'the item is not in the generation'})`);
            } else if (ruled !== used) {
              problems.push(`${label}: the simulator ${used ? 'uses' : 'does not use'} the item, the rule ${ruled ? 'rules it out' : 'leaves it'}`);
            }
          }
        }
        expect(problems).toEqual([]);
        if (rules.gen >= 8) {
          expect(rows).toBeGreaterThan(10);
          expect(fired).toBeGreaterThan(5);
        }
      });
    }
  }
});
