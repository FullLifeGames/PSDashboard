import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { CHAMPIONS_MOD, broughtSpeciesFor, dexOf, getReplayBringCount, logRules, parseReplayLog, replayBringOnly, speciesBaseId } from '../src/index';
import type { GameRules } from '../src/index';

/**
 * Round 89 (#116): the bring list names the species a body entered with, never the copy it wears. A Ditto that transforms
 * (Imposter on entry, the move Transform) reads as the foe's species in the client's snapshot, and the list used to name the
 * copy: the trimmed team then dropped the Ditto's set and kept the unbrought body of the copied species (VGC 2382086291),
 * or counted a side's four as five names. The sweep reads the Dex and plays a real battle of every generation the corpus
 * plays (1 to 9) and of the Champions mod, singles and, from Generation 3, doubles; no species name stands in the code.
 *
 *  - Transformers: every species whose learnset holds Transform, and every species with the ability Imposter, as of the
 *    generation (the move is the way in every generation, Imposter the way in from Generation 5). The body copies a foe on
 *    its first turn; the list must equal the simulator's own species of the bodies that stood active.
 *  - Illusion: every species with the ability, from the generation that has it. The disguise copies a party member of its
 *    own side, so the list never names a species outside the side's party, whether the disguise held or broke.
 *  - Bring limits (Scarlet/Violet VGC, Champions VGC, Battle Stadium Singles): `replayBringOnly` gives the transformer's own
 *    species and the full count for a side that fielded its whole selection.
 */
Dex.mod(CHAMPIONS_MOD, championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

type Kind = 'singles' | 'doubles';
interface Scene { label: string; gen: number; champions: boolean; rules: GameRules }

const SCENES: Scene[] = [
  ...Array.from({ length: 9 }, (_, index) => ({ label: `Generation ${index + 1}`, gen: index + 1, champions: false, rules: { gen: index + 1, mod: undefined } as GameRules })),
  { label: 'Champions', gen: 9, champions: true, rules: { gen: 9, mod: CHAMPIONS_MOD } as GameRules },
];
const kindsOf = (scene: Scene): Kind[] => (scene.gen >= 3 ? ['singles', 'doubles'] : ['singles']);
const formatOf = (scene: Scene, kind: Kind) => `gen${scene.gen}${scene.champions ? 'champions' : ''}${kind === 'doubles' ? 'doubles' : ''}customgame`;

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Hardy', evs, ivs, level: 50, gender: '',
});

type Dexish = ReturnType<typeof dexOf>;

/** The species of the generation a plain body can be: no transformer, no disguise, its own base species, listed in this Dex's generation. */
function fillersOf(dex: Dexish, scene: Scene, count: number): string[] {
  return dex.species.all()
    .filter(species => species.exists && species.gen <= scene.gen && !species.isNonstandard && species.num > 0 && species.baseSpecies === species.name &&
      !Object.values(species.abilities).some(ability => ability === 'Imposter' || ability === 'Illusion') && !learnsTransform(dex, species.id, scene.gen))
    .slice(0, count).map(species => species.name);
}

function learnsTransform(dex: Dexish, id: string, gen: number): boolean {
  const sources = dex.species.getLearnsetData(id as never)?.learnset?.transform;
  return !!sources?.some(source => Number(source[0]) <= gen);
}

const inGeneration = (dex: Dexish, scene: Scene, ability: string) => dex.abilities.get(ability).gen <= scene.gen;

/** The species of the generation that can carry the ability or the move. */
function bearersOf(dex: Dexish, scene: Scene) {
  const transformers: { name: string; imposter: boolean }[] = [];
  const illusionists: string[] = [];
  const imposterOk = inGeneration(dex, scene, 'Imposter');
  const illusionOk = inGeneration(dex, scene, 'Illusion');
  for (const species of dex.species.all()) {
    if (!species.exists || species.gen > scene.gen || species.isNonstandard) continue;
    const abilities = Object.values(species.abilities);
    const imposter = imposterOk && abilities.includes('Imposter');
    if (imposter || learnsTransform(dex, species.id, scene.gen)) transformers.push({ name: species.name, imposter });
    if (illusionOk && abilities.includes('Illusion')) illusionists.push(species.name);
  }
  return { transformers, illusionists };
}

const publicLog = (battle: Battle) => battle.log.filter((line, index) => !line.startsWith('|split|') && !battle.log[index - 1]?.startsWith('|split|')).join('\n');

/**
 * Plays `turns` (one choice pair each) from teams of the scene's format and returns the spectators' log. Choices must be legal:
 * a refused choice stops the sweep, so the row cannot pass on a battle that never played.
 */
function play(scene: Scene, kind: Kind, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): { log: string; battle: Battle } {
  const battle = new Battle({
    formatid: toID(formatOf(scene, kind)) as never, seed: [3, 1, 4, 1],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  for (const [first, second] of turns) {
    expect(battle.choose('p1', first), first).toBe(true);
    expect(battle.choose('p2', second), second).toBe(true);
  }
  return { log: publicLog(battle), battle };
}

/** The base species of the bodies the simulator's side has switched in (`previouslySwitchedIn` counts every entry): the oracle of the bring list. */
const fieldedBy = (battle: Battle, side: 0 | 1) => battle.sides[side].pokemon.filter(body => body.previouslySwitchedIn > 0).map(body => body.baseSpecies.name);
const partyOf = (battle: Battle, side: 0 | 1) => battle.sides[side].pokemon.map(body => body.baseSpecies.name);
const bases = (names: string[], rules: GameRules) => names.map(name => speciesBaseId(name, rules)).sort();

describe('the sweep sees the Dex it plays', () => {
  test('transformers and illusionists exist in every scene the corpus plays, and the generations part as the game does', () => {
    const counts = SCENES.map(scene => {
      const { transformers, illusionists } = bearersOf(dexOf(scene.rules), scene);
      return { label: scene.label, move: transformers.length, imposter: transformers.filter(entry => entry.imposter).length, illusion: illusionists.length };
    });
    for (const row of counts) expect(row.move, row.label).toBeGreaterThan(0);
    // Imposter and Illusion arrived in Generation 5.
    for (const row of counts.slice(0, 4)) expect([row.imposter, row.illusion], row.label).toEqual([0, 0]);
    for (const row of counts.slice(4)) expect([row.imposter > 0, row.illusion > 0], row.label).toEqual([true, true]);
  });
});

describe.each(SCENES)('$label', scene => {
  const dex = dexOf(scene.rules);
  const { transformers, illusionists } = bearersOf(dex, scene);
  const fillers = fillersOf(dex, scene, 8);

  for (const kind of kindsOf(scene)) {
    const doubles = kind === 'doubles';
    // Singles bring one body to the field and switch; doubles lead two and switch slot a.
    const bodyFor = (species: string, ability: string, moves: string[]) => set(species, ability, moves);

    for (const transformer of transformers) {
      for (const way of transformer.imposter ? (['Imposter', 'Transform'] as const) : (['Transform'] as const)) {
        test(`${kind}: ${transformer.name} by ${way} lists its own species, not the copy`, () => {
          const species = dex.species.get(transformer.name);
          const ability = way === 'Imposter' ? 'Imposter' : Object.values(species.abilities).find(name => name !== 'Imposter') ?? 'No Ability';
          const own = bodyFor(transformer.name, ability, way === 'Imposter' ? ['splash'] : ['transform']);
          const first = way === 'Imposter' ? 'move 1' : doubles ? 'move 1 1' : 'move 1';
          const p1 = doubles ? [own, set(fillers[0], '', ['splash']), set(fillers[1], '', ['splash'])] : [own, set(fillers[0], '', ['splash'])];
          const p2 = doubles ? [set(fillers[2], '', ['splash']), set(fillers[3], '', ['splash'])] : [set(fillers[2], '', ['splash'])];
          const turns: [string, string][] = doubles
            ? [[`${first}, move 1`, 'move 1, move 1'], ['switch 3, move 1', 'move 1, move 1']]
            : [[first, 'move 1'], ['switch 2', 'move 1']];
          const { log, battle } = play(scene, kind, p1, p2, turns);
          // The row proves something only if the copy happened.
          expect(log, 'the body transformed').toMatch(/^\|-transform\|p1a: /m);
          const rules = logRules(log);
          expect(rules).toEqual(scene.rules);
          const listed = broughtSpeciesFor(parseReplayLog(log), 'p1', rules);
          expect(bases(listed, rules)).toEqual(bases(fieldedBy(battle, 0), rules));
          expect(bases(listed, rules)).toContain(speciesBaseId(transformer.name, rules));
          expect(listed.map(name => speciesBaseId(name, rules))).not.toContain(speciesBaseId(fillers[2], rules));
        });
      }
    }

    for (const illusionist of illusionists) {
      for (const held of [true, false]) {
        test(`${kind}: ${illusionist} ${held ? 'holding' : 'losing'} its disguise lists no species outside its party`, () => {
          const own = set(illusionist, 'Illusion', ['splash']);
          // The disguise copies the last member of the party (the tail of the team).
          const p1 = doubles ? [own, set(fillers[0], '', ['splash']), set(fillers[1], '', ['splash'])] : [own, set(fillers[0], '', ['splash'])];
          // Peck is Flying in every generation: no Normal or Ghost body is immune to it. A broken disguise is pecked in slot a; a held one
          // is left alone (the foe splashes).
          const attacker = [set(fillers[2], '', ['peck', 'splash']), set(fillers[3], '', ['peck', 'splash'])];
          const p2 = doubles ? attacker : [attacker[0]];
          const strike = held ? 'move 2' : doubles ? 'move 1 1' : 'move 1';
          const turns: [string, string][] = doubles
            ? [['move 1, move 1', `${strike}, ${strike}`], ['move 1, move 1', `${strike}, ${strike}`]]
            : [['move 1', strike], ['move 1', strike]];
          const { log, battle } = play(scene, kind, p1, p2, turns);
          if (!held) expect(log, 'the disguise broke').toMatch(/^\|replace\|p1a: /m);
          const rules = logRules(log);
          const party = bases(partyOf(battle, 0), rules);
          for (const name of broughtSpeciesFor(parseReplayLog(log), 'p1', rules)) expect(party, name).toContain(speciesBaseId(name, rules));
        });
      }
    }
  }
});

/** The bring-limited formats the corpus plays: the format id gives the count, the sweep plays the body into the selection. */
const LIMITED = [
  { label: 'Scarlet/Violet VGC', formatid: 'gen9vgc2026regi', scene: SCENES[8], kind: 'doubles', count: 4 },
  { label: 'Champions VGC', formatid: 'gen9championsvgc2026regmbbo3', scene: SCENES[9], kind: 'doubles', count: 4 },
  { label: 'Battle Stadium Singles', formatid: 'gen9battlestadiumsinglesregi', scene: SCENES[8], kind: 'singles', count: 3 },
] as const;

describe.each(LIMITED)('bring limit: $label', ({ formatid, scene, kind, count }) => {
  const dex = dexOf(scene.rules);
  const { transformers } = bearersOf(dex, scene);
  const fillers = fillersOf(dex, scene, 12);
  const doubles = kind === 'doubles';

  for (const transformer of transformers) {
    for (const way of transformer.imposter ? (['Imposter', 'Transform'] as const) : (['Transform'] as const)) {
      test(`${transformer.name} by ${way}: both sides list their ${count} fielded bodies`, () => {
        const species = dex.species.get(transformer.name);
        const ability = way === 'Imposter' ? 'Imposter' : Object.values(species.abilities).find(name => name !== 'Imposter') ?? 'No Ability';
        const own = set(transformer.name, ability, way === 'Imposter' ? ['splash'] : ['transform']);
        const first = way === 'Imposter' ? 'move 1' : doubles ? 'move 1 1' : 'move 1';
        const plain = (index: number) => set(fillers[index], '', ['splash']);
        // Each side takes six into the game and fields `count` of them; the Ditto's side shows its transformer in front.
        const p1 = [own, plain(0), plain(1), plain(2), plain(3), plain(4)];
        const p2 = [plain(5), plain(6), plain(7), plain(8), plain(9), plain(10)];
        const turns: [string, string][] = doubles
          ? [[`${first}, move 1`, 'move 1, move 1'], ['switch 3, move 1', 'switch 3, move 1'], ['move 1, switch 4', 'move 1, switch 4']]
          : [[first, 'move 1'], ['switch 2', 'switch 2'], ['switch 3', 'switch 3']];
        const { log, battle } = play(scene, kind, p1, p2, turns);
        expect(log, 'the body transformed').toMatch(/^\|-transform\|p1a: /m);
        const source = { formatid, log };
        expect(getReplayBringCount(source)).toBe(count);
        const brought = replayBringOnly(source, parseReplayLog(log));
        const rules = logRules(log);
        expect(brought, 'both sides pin').not.toBeNull();
        expect(brought!.p1).toHaveLength(count);
        expect(brought!.p2).toHaveLength(count);
        expect(bases(brought!.p1, rules)).toEqual(bases(fieldedBy(battle, 0), rules));
        expect(bases(brought!.p2, rules)).toEqual(bases(fieldedBy(battle, 1), rules));
        expect(bases(brought!.p1, rules)).toContain(speciesBaseId(transformer.name, rules));
      });
    }
  }
});
