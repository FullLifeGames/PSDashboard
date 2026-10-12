import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { calcGenerationFor } from '../src/calc-gen';
import { enrichTeamInfos } from '../src/team/damage-ruleouts';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { guessedEvs, guessedField, revealedField, unknownField } from '../src/team-info';
import type { PokemonEvs, PokemonFieldInfo, RevealedPokemonInfo } from '../src/types';

/**
 * Round 69 (T169, spec decision 35): the damage judge reads a Pokemon as the defender of the hits it took. An Assault Vest
 * (special hits) or an Eviolite (both Defenses, only on a species that can still evolve) falls when a logged hit is too strong
 * for the bulkiest-not-enough holder: no EVs, IV 0 and a lowering nature at its softest, the item on. The attacker is as built
 * with its unproven item ranged (the mirror of R18): a guessed Choice Specs may be no item, a guessed Leftovers may be Specs, so
 * a hit that the attacker's item cancels against the Vest refutes nothing. Every hit is a real battle of @pkmn/sim in singles
 * and doubles; the judge sees only the log.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

type Kind = 'singles' | 'doubles';
const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

interface Build { species: string; item: string; ability: string; moves: string[]; nature: string; evs?: Partial<PokemonEvs>; ivs?: Partial<PokemonEvs> }
const set = (build: Build): PokemonSet => ({
  name: build.species, species: build.species, item: build.item, ability: build.ability, moves: build.moves, nature: build.nature,
  evs: sp(build.evs ?? {}), ivs: { ...ALL_31, ...build.ivs }, level: 100, gender: '',
}) as PokemonSet;

/** The softest bulk the judge allows: no EVs, IV 0 in HP and the defenses, a nature that lowers a defense. */
const SOFT = { nature: 'Naive', ivs: { hp: 0, def: 0, spd: 0 } };
/** The hardest: HP and both defenses at the cap and a nature that raises Special Defense. */
const HARD = { nature: 'Sassy', evs: { hp: 252, def: 252, spd: 252 }, ivs: { hp: 31, def: 31, spd: 31 } };
const SOFT_PHYSICAL = { nature: 'Hasty', ivs: { hp: 0, def: 0, spd: 0 } };

const corviknight = (item: string, body: Partial<Build>) => set({ species: 'Corviknight', item, ability: 'Pressure', moves: ['Iron Head'], ...SOFT, ...body });
const doublade = (item: string) => set({ species: 'Doublade', item, ability: 'No Guard', moves: ['Swords Dance'], ...SOFT_PHYSICAL });
const gholdengo = (item: string, moves: string[]) => set({ species: 'Gholdengo', item, ability: 'Good as Gold', moves, nature: 'Modest', evs: { spa: 252, spe: 252, hp: 4 } });
const garchomp = (item: string) => set({ species: 'Garchomp', item, ability: 'Rough Skin', moves: ['Dragon Claw'], nature: 'Adamant', evs: { atk: 252, spe: 252, hp: 4 } });
const blissey = () => set({ species: 'Blissey', item: 'Leftovers', ability: 'Natural Cure', moves: ['Soft-Boiled'], nature: 'Calm', evs: { hp: 252, spd: 252 } });
const chansey = () => set({ species: 'Chansey', item: 'Leftovers', ability: 'Natural Cure', moves: ['Soft-Boiled'], nature: 'Calm', evs: { hp: 252, spd: 252 } });

interface Scene { p1: PokemonSet; p2: PokemonSet; p1Choice: string; p2Choice: string; partner: [PokemonSet, PokemonSet] }
const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };

/** One turn of a real battle for a seed; null when the roll crit (a crit is no clean hit). */
function turnLog(kind: Kind, scene: Scene, seed: number): string | null {
  const doubles = kind === 'doubles';
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [scene.p1, scene.partner[0]] : [scene.p1]) },
    p2: { name: 'Beta', team: Teams.pack(doubles ? [scene.p2, scene.partner[1]] : [scene.p2]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  battle.choose('p1', doubles ? `${scene.p1Choice}, move softboiled` : scene.p1Choice);
  battle.choose('p2', doubles ? `${scene.p2Choice}, move softboiled` : scene.p2Choice);
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return /\|-crit\|/.test(log) ? null : log;
}

/** The first clean log in which the attacker's hit reaches the defender, and the attacker as the inference reads it. */
function sceneOf(kind: Kind, scene: Scene): { log: string; attacker: RevealedPokemonInfo } {
  for (let seed = 1; seed <= 80; seed++) {
    const log = turnLog(kind, scene, seed);
    if (!log) continue;
    const attacker = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === scene.p2.species);
    if (attacker?.hits?.some(hit => hit.defender.species === scene.p1.species)) return { log, attacker };
  }
  throw new Error('no clean hit in 80 seeds');
}

/** The attacker as the build plays it: a spread, a nature, an ability and an item that may be a guess. */
const builtAttacker = (raw: RevealedPokemonInfo, build: Build, item: PokemonFieldInfo): RevealedPokemonInfo => ({
  ...raw, ability: revealedField(build.ability), item, evs: guessedEvs(sp(build.evs ?? {})), nature: guessedField(build.nature), level: 100, gender: '',
});

/** The defender with the item the build guessed; the judge ranges its bulk, so spread and nature are placeholders. */
const holderInfo = (species: string, item: PokemonFieldInfo): RevealedPokemonInfo => ({
  species, moves: [], ability: unknownField(), item, teraType: unknownField(),
  evs: guessedEvs(sp({})), nature: guessedField('Hardy'), level: 100, gender: '',
});
const bystander = (species: string): RevealedPokemonInfo => ({ ...holderInfo(species, revealedField('Leftovers')), ability: revealedField('Natural Cure') });

const CANDIDATES = ['Assault Vest', 'Eviolite', 'Leftovers'];
const none = () => [] as string[];
const teamsOf = (kind: Kind, holder: RevealedPokemonInfo, attacker: RevealedPokemonInfo) => ({
  p1: { pokemon: kind === 'doubles' ? [holder, bystander('Blissey')] : [holder] },
  p2: { pokemon: kind === 'doubles' ? [attacker, bystander('Chansey')] : [attacker] },
});
const judge = (kind: Kind, holder: RevealedPokemonInfo, attacker: RevealedPokemonInfo, attackerItems: () => string[] = none, candidates = CANDIDATES) =>
  judgeItemsByDamage(holder, candidates, teamsOf(kind, holder, attacker), { side: 'p1', attackerItems });

const GHOLDENGO_BUILD: Build = { species: 'Gholdengo', item: '', ability: 'Good as Gold', moves: [], nature: 'Modest', evs: { spa: 252, spe: 252, hp: 4 } };
const GARCHOMP_BUILD: Build = { species: 'Garchomp', item: '', ability: 'Rough Skin', moves: [], nature: 'Adamant', evs: { atk: 252, spe: 252, hp: 4 } };
/** Dazzling Gleam hits every foe (a spread move in doubles); every other move of the scenes names its target. */
const choiceOf = (kind: Kind, move: string) => (kind === 'doubles' && move !== 'dazzlinggleam' ? `move ${move} 1` : `move ${move}`);
const specialScene = (kind: Kind, defender: PokemonSet, attackerItem: string, move = 'dazzlinggleam'): Scene =>
  ({ p1: defender, p2: gholdengo(attackerItem, ['Dazzling Gleam', 'Shadow Ball']), p1Choice: choiceOf(kind, 'ironhead'), p2Choice: choiceOf(kind, move), partner: [blissey(), chansey()] });
const physicalScene = (kind: Kind, defender: PokemonSet, attackerItem: string): Scene =>
  ({ p1: defender, p2: garchomp(attackerItem), p1Choice: 'move swordsdance', p2Choice: choiceOf(kind, 'dragonclaw'), partner: [blissey(), chansey()] });

describe('an Assault Vest the hits taken rule out (T169, decision 35)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    // Dazzling Gleam is a spread move in doubles: the log's [spread] factor goes into every roll.
    test(`${kind}: a Specs Gleam is too strong for a Vest on a Corviknight that holds none, so the Vest falls and Eviolite is no candidate`, () => {
      const { log, attacker } = sceneOf(kind, specialScene(kind, corviknight('Leftovers', {}), 'Choice Specs'));
      if (kind === 'doubles') expect(log).toMatch(/Dazzling Gleam\|[^\n]*\[spread\]/);
      const known = builtAttacker(attacker, GHOLDENGO_BUILD, revealedField('Choice Specs'));
      expect(judge(kind, holderInfo('Corviknight', guessedField('Assault Vest')), known)).toEqual(['assaultvest']);
    });

    test(`${kind}: the same hit on a Corviknight that really holds the Vest refutes nothing`, () => {
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Assault Vest', {}), 'Choice Specs'));
      const known = builtAttacker(attacker, GHOLDENGO_BUILD, revealedField('Choice Specs'));
      expect(judge(kind, holderInfo('Corviknight', guessedField('Assault Vest')), known)).toEqual([]);
    });

    test(`${kind}: a physical hit says nothing about a Vest, which reads special hits only`, () => {
      const { attacker } = sceneOf(kind, physicalScene(kind, doublade('Leftovers'), 'Choice Band'));
      const known = builtAttacker(attacker, GARCHOMP_BUILD, revealedField('Choice Band'));
      expect(judge(kind, holderInfo('Doublade', guessedField('Assault Vest')), known, none, ['Assault Vest'])).toEqual([]);
    });
  }
});

describe('an Eviolite the hits taken rule out (T169, decision 35)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: a Band Dragon Claw is too strong for an Eviolite on a Doublade that holds none; the Vest, which a physical hit cannot judge, stays`, () => {
      const { attacker } = sceneOf(kind, physicalScene(kind, doublade('Leftovers'), 'Choice Band'));
      const known = builtAttacker(attacker, GARCHOMP_BUILD, revealedField('Choice Band'));
      expect(judge(kind, holderInfo('Doublade', guessedField('Eviolite')), known)).toEqual(['eviolite']);
    });

    test(`${kind}: the same hit on a Doublade that really holds Eviolite refutes nothing`, () => {
      const { attacker } = sceneOf(kind, physicalScene(kind, doublade('Eviolite'), 'Choice Band'));
      const known = builtAttacker(attacker, GARCHOMP_BUILD, revealedField('Choice Band'));
      expect(judge(kind, holderInfo('Doublade', guessedField('Eviolite')), known)).toEqual([]);
    });

    test(`${kind}: a fully evolved species never gets Eviolite judged: where the Vest explains the hit, an Eviolite that does nothing on it must not fall`, () => {
      // Corviknight really holds a Vest at its hardest and the attacker is guessed with Choice Specs but holds none: the span
      // (no item) lets the Vest explain the hit. The calculator gives an Eviolite no effect on a species that cannot evolve, so
      // it reads like no item, which the hit does not explain; that must not count against the item.
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Assault Vest', HARD), '', 'shadowball'));
      const guessed = builtAttacker(attacker, GHOLDENGO_BUILD, guessedField('Choice Specs'));
      expect(judge(kind, holderInfo('Corviknight', guessedField('Eviolite')), guessed, none, ['Assault Vest', 'Eviolite'])).toEqual([]);
    });
  }
});

describe('the attacker\'s unproven item gets a span before a hit refutes a defender item (T169, mirror of R18)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: a guessed Choice Specs the attacker did not hold does not refute the Vest it was set against`, () => {
      // The Vest holder is the bulkiest the judge allows. Against the guessed Specs the hit looks too weak for any Vest; the
      // attacker holds no item, so the Vest it took is fine, and the span that includes no item keeps it.
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Assault Vest', HARD), '', 'shadowball'));
      const guessed = builtAttacker(attacker, GHOLDENGO_BUILD, guessedField('Choice Specs'));
      expect(judge(kind, holderInfo('Corviknight', guessedField('Assault Vest')), guessed)).toEqual([]);
    });

    test(`${kind}: a guessed Leftovers on an attacker that held Choice Specs does not refute the Vest, as long as the build can hold Specs`, () => {
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Assault Vest', {}), 'Choice Specs', 'shadowball'));
      const guessed = builtAttacker(attacker, GHOLDENGO_BUILD, guessedField('Leftovers'));
      const holder = holderInfo('Corviknight', guessedField('Assault Vest'));
      // Without the span the hit outruns the softest Vest holder against a Leftovers attacker...
      expect(judge(kind, holder, guessed)).toEqual(['assaultvest']);
      // ...with the span of the items the attacker could hold, Specs explains it.
      expect(judge(kind, holder, guessed, () => ['Choice Specs', 'Leftovers'])).toEqual([]);
    });
  }
});

describe("the attacker's built spread is a guess too (T169, the Dragonite of 752624)", () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: a physical spread built for an attacker that really hit with its Special Attack refutes no Vest`, () => {
      // Primarina of 752624 took a 63% Thunderbolt from a Dragonite the build gave a physical spread: the Vest it may hold
      // must not fall to a Special Attack the build never gave. Here the Gholdengo really has 252 Special Attack and the
      // build a physical spread; the Vest holder is at its softest, where the hit would refute it against the built spread.
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Assault Vest', {}), 'Choice Specs', 'shadowball'));
      const physical: Build = { ...GHOLDENGO_BUILD, nature: 'Adamant', evs: { atk: 252, spe: 252, hp: 4 } };
      const guessed = builtAttacker(attacker, physical, revealedField('Choice Specs'));
      expect(judge(kind, holderInfo('Corviknight', guessedField('Assault Vest')), guessed)).toEqual([]);
    });

    test(`${kind}: a spread the open team sheet fixed is taken as it is, the same spread as a guess is ranged`, () => {
      const weak: Build = { ...GHOLDENGO_BUILD, item: 'Choice Specs', moves: ['Dazzling Gleam'], nature: 'Hardy', evs: { hp: 4 } };
      const { attacker } = sceneOf(kind, { ...specialScene(kind, corviknight('Leftovers', {}), 'Choice Specs'), p2: set(weak) });
      const holder = holderInfo('Corviknight', guessedField('Assault Vest'));
      const known = { ...builtAttacker(attacker, weak, revealedField('Choice Specs')), evs: { value: sp(weak.evs ?? {}), source: 'sheet' as const } };
      expect(judge(kind, holder, known)).toEqual(['assaultvest']);
      expect(judge(kind, holder, builtAttacker(attacker, weak, revealedField('Choice Specs')))).toEqual([]);
    });
  }
});

describe('the item the log showed is never judged (T169)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    const rawOf = (attacker: RevealedPokemonInfo, holder: RevealedPokemonInfo) => ({
      p1: { pokemon: kind === 'doubles' ? [holder, bystander('Blissey')] : [holder] },
      p2: { pokemon: kind === 'doubles' ? [builtAttacker(attacker, GHOLDENGO_BUILD, revealedField('Choice Specs')), bystander('Chansey')] : [builtAttacker(attacker, GHOLDENGO_BUILD, revealedField('Choice Specs'))] },
    });

    test(`${kind}: the enrichment rules out a guessed Vest that the hit refutes and leaves the Pokemon's item open`, () => {
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Leftovers', {}), 'Choice Specs'));
      const enriched = enrichTeamInfos(rawOf(attacker, holderInfo('Corviknight', guessedField('Assault Vest'))), null, null, {}, judgeItemsByDamage);
      expect(enriched.p1.pokemon[0].ruledOut?.items).toContain('assaultvest');
      expect(enriched.p1.pokemon[0].item.value).not.toBe('Assault Vest');
    });

    test(`${kind}: a Vest the log showed stays, whatever the hit says`, () => {
      const { attacker } = sceneOf(kind, specialScene(kind, corviknight('Leftovers', {}), 'Choice Specs'));
      const enriched = enrichTeamInfos(rawOf(attacker, holderInfo('Corviknight', revealedField('Assault Vest'))), null, null, {}, judgeItemsByDamage);
      expect(enriched.p1.pokemon[0].item).toMatchObject({ value: 'Assault Vest', source: 'revealed' });
      expect(enriched.p1.pokemon[0].ruledOut?.items ?? []).toEqual([]);
    });
  }
});

describe('a Champions game prices on the calculator\'s generation 0, which has neither item (T169)', () => {
  const FORMAT_CH: Record<Kind, string> = { singles: 'gen9championsou', doubles: 'gen9championsdoublescustomgame' };
  const champions = (species: string, item: string, ability: string, moves: string[], nature: string, evs: Partial<PokemonEvs>): PokemonSet => ({
    name: species, species, item, ability, moves, nature, evs: sp(evs), ivs: { ...ALL_31 }, level: 50, gender: '',
  }) as PokemonSet;
  function championsLog(kind: Kind): string {
    for (let seed = 1; seed <= 80; seed++) {
      const doubles = kind === 'doubles';
      const wyrdeer = champions('Wyrdeer', '', 'Sap Sipper', ['Psyshield Bash'], 'Adamant', { hp: 2, atk: 32, spe: 32 });
      const target = champions('Garchomp', 'Leftovers', 'Sand Veil', ['Swords Dance'], 'Impish', { hp: 32, def: 32, spe: 2 });
      const partner = champions('Clefable', 'Leftovers', 'Magic Guard', ['Protect'], 'Calm', { hp: 32, spd: 32 });
      const battle = new Battle({
        formatid: toID(FORMAT_CH[kind]), seed: [1, 2, 3, seed],
        p1: { name: 'Alpha', team: Teams.pack(doubles ? [target, partner] : [target]) },
        p2: { name: 'Beta', team: Teams.pack(doubles ? [wyrdeer, partner] : [wyrdeer]) },
      });
      if (battle.requestState === 'teampreview') {
        battle.choose('p1', 'default');
        battle.choose('p2', 'default');
      }
      battle.choose('p1', doubles ? 'move swordsdance, move protect' : 'move swordsdance');
      battle.choose('p2', doubles ? 'move psyshieldbash 1, move protect' : 'move psyshieldbash');
      const lines = battle.log;
      const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
      if (!/\|-crit\|/.test(log) && /\|move\|p2a: Wyrdeer\|Psyshield Bash/.test(log)) return log;
    }
    throw new Error('no clean Psyshield Bash');
  }

  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the generation lacks Assault Vest and Eviolite, so a Champions hit refutes neither`, () => {
      const log = championsLog(kind);
      const raw = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === 'Wyrdeer')!;
      expect(raw.hits?.[0].format).toMatch(/champions/i);
      const gen = calcGenerationFor(raw.hits![0].gen, 'champions');
      expect(gen.items.get('assaultvest' as never)).toBeUndefined();
      expect(gen.items.get('eviolite' as never)).toBeUndefined();
      const attacker = builtAttacker(raw, { species: 'Wyrdeer', item: '', ability: 'Sap Sipper', moves: [], nature: 'Adamant', evs: { hp: 2, atk: 32, spe: 32 } }, revealedField('Life Orb'));
      const holder = { ...holderInfo('Garchomp', guessedField('Assault Vest')), level: 50 };
      expect(judge(kind, holder, { ...attacker, level: 50 })).toEqual([]);
    });
  }
});
