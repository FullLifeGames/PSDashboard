import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import type { PokemonEvs } from '../src/types';

/**
 * Real simulator battles for the fit-field tests (round 69, T86): a scene is a few scripted turns on Gen 9 singles, Gen 9 doubles
 * or the Champions formats, and the simulator's own HP loss of the defender on each turn is the oracle. The log is public (the
 * percent lines), as the parser reads a replay.
 */

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

export type Kind = 'singles' | 'doubles' | 'champions singles' | 'champions doubles';
export const KINDS: Kind[] = ['singles', 'doubles', 'champions singles', 'champions doubles'];
export const FORMAT: Record<Kind, string> = {
  singles: 'gen9ou', doubles: 'gen9doublesou', 'champions singles': 'gen9championsou', 'champions doubles': 'gen9championsdoublescustomgame',
};
export const isDoubles = (kind: Kind) => kind.endsWith('doubles');
export const isChampions = (kind: Kind) => kind.startsWith('champions');

const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
export const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
export const set = (
  species: string, item: string, ability: string, moves: string[], nature: string, spread: Partial<PokemonEvs>, teraType?: string,
): PokemonSet => ({
  name: species, species, item, ability, moves, nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 100, gender: '', ...(teraType ? { teraType } : {}),
});
export const blissey = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
/** The doubles partner of a lead: a bulky body that splashes, another species than the lead (a Blissey foe must not have a Blissey partner). */
const partnerOf = (lead: PokemonSet) => (lead.species === 'Blissey' ? set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 }) : blissey());

/** The set on the format's scale: level 50 and Stat Points (32 for a full 252) in Champions. */
export function scaled(body: PokemonSet, kind: Kind): PokemonSet {
  if (!isChampions(kind)) return body;
  return { ...body, level: 50, evs: Object.fromEntries(Object.entries(body.evs).map(([stat, value]) => [stat, value > 0 ? 32 : 0])) as unknown as PokemonEvs };
}

/** Singles: the choice as written. Doubles: the first slot's choice, its partner splashes. */
export const alone = (doubles: boolean, choice: string, partner = 'move splash') => (doubles ? `${choice}, ${partner}` : choice);
/** The targets a doubles choice must name; a move aimed at a side or at everyone takes none. */
const CHOOSABLE_TARGETS = new Set(['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe']);
/** A move at the foe in slot a (singles: no target), optionally with the Terastallization. */
export const hit = (doubles: boolean, move: string, tera = false) =>
  `move ${toID(move)}${doubles && CHOOSABLE_TARGETS.has(Dex.moves.get(move).target) ? ' 1' : ''}${tera ? ' terastallize' : ''}`;
export const splash = (tera = false) => `move splash${tera ? ' terastallize' : ''}`;

export interface Step {
  /** A side that has nothing to choose (the other side's forced switch) is left out. */
  p1?: string;
  p2?: string;
}

export interface FieldScene {
  title: string;
  /** The teams in battle order: singles leads with the first, doubles with the first two. */
  p1: (doubles: boolean) => PokemonSet[];
  p2: (doubles: boolean) => PokemonSet[];
  attacker: string;
  defender: string;
  steps: (doubles: boolean) => Step[];
  /** The formats the scene plays (the Champions ones only where its generation has the moves and species). */
  kinds: Kind[];
  /**
   * The share the rolls may be off by where the hit reads a public HP bar: the bar shows percent rounded up, so a power that scales
   * with the attacker's HP (Eruption) is good to about a percent of its value.
   */
  barNoise?: number;
}

/** A lead with the default partner behind it in doubles, then the bench. */
export const team = (lead: PokemonSet, ...bench: PokemonSet[]) => (doubles: boolean) => (doubles ? [lead, partnerOf(lead), ...bench] : [lead, ...bench]);

export interface Scene {
  log: string;
  /** The defender's HP lost on each step, in the simulator's own numbers. */
  damage: number[];
  maxHp: number;
}

/** A battle of the scene's steps, with the reason when it is no clean scene (a hit crit or missed, a status burns the defender on the side, the defender fainted). */
export function playScene(kind: Kind, scene: FieldScene, seed: number): Scene & { reject: string } {
  const doubles = isDoubles(kind);
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(scene.p1(doubles).map(body => scaled(body, kind))) },
    p2: { name: 'Beta', team: Teams.pack(scene.p2(doubles).map(body => scaled(body, kind))) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const target = battle.p2.pokemon.find(mon => mon.species.name === scene.defender)!;
  const { maxhp: maxHp } = target;
  const damage: number[] = [];
  for (const step of scene.steps(doubles)) {
    const before = target.hp;
    if (step.p1) battle.choose('p1', step.p1);
    if (step.p2) battle.choose('p2', step.p2);
    damage.push(before - target.hp);
  }
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  const reject = /\|-crit\|/.test(log) ? 'crit' : /\|-miss\|/.test(log) ? 'miss' : /\|-status\|/.test(log) ? 'status' : target.hp <= 0 ? 'fainted' : '';
  return { log, damage, maxHp, reject };
}

/** The scene, or null when it is no clean scene. */
export function sceneOf(kind: Kind, scene: FieldScene, seed: number): Scene | null {
  const { reject, ...played } = playScene(kind, scene, seed);
  return reject ? null : played;
}

/** Up to `count` clean scenes whose last damage differs. */
export function scenesOf(kind: Kind, scene: FieldScene, count: number): Scene[] {
  const found: Scene[] = [];
  for (let seed = 1; found.length < count && seed <= 200; seed++) {
    const played = sceneOf(kind, scene, seed);
    if (played && !found.some(known => known.damage.at(-1) === played.damage.at(-1))) found.push(played);
  }
  return found;
}

/** The damage of the steps that hurt the defender. */
export const damagingTurns = (scene: Scene) => scene.damage.filter(lost => lost > 0);

const GARCHOMP = () => set('Garchomp', '', 'Rough Skin', ['Splash'], 'Careful', { hp: 252, spd: 252 });
const EXPLODER = (species: string) => set(species, '', 'Static', ['Explosion'], 'Hardy', {});
const GHOSTS = (doubles: boolean) => (doubles
  ? [set('Gengar', '', 'Cursed Body', ['Splash'], 'Timid', { hp: 252, spd: 252 }), set('Dusclops', '', 'Pressure', ['Splash'], 'Calm', { hp: 252, spd: 252 })]
  : [set('Gengar', '', 'Cursed Body', ['Splash'], 'Timid', { hp: 252, spd: 252 })]);

/** Rain from the lead's Drizzle: Weather Ball is a Water move of double power (the calculator keys it on the name). */
export const WEATHER_BALL: FieldScene = {
  title: 'Weather Ball in the rain of Drizzle',
  p1: team(set('Politoed', '', 'Drizzle', ['Weather Ball'], 'Modest', { hp: 252, spa: 252 })),
  p2: team(set('Garchomp', '', 'Rough Skin', ['Splash'], 'Careful', { hp: 252, spd: 252 })),
  attacker: 'Politoed', defender: 'Garchomp',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Weather Ball')), p2: alone(doubles, splash()) }, { p1: alone(doubles, hit(doubles, 'Weather Ball')), p2: alone(doubles, splash()) }],
  kinds: KINDS,
};

/** Terrain Pulse is an Electric move of double power in Electric Terrain. */
export const TERRAIN_PULSE: FieldScene = {
  title: 'Terrain Pulse in Electric Terrain',
  p1: team(set('Tapu Koko', '', 'Electric Surge', ['Terrain Pulse'], 'Modest', { hp: 252, spa: 252 })),
  p2: team(blissey()),
  attacker: 'Tapu Koko', defender: 'Blissey',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Terrain Pulse')), p2: alone(doubles, splash()) }, { p1: alone(doubles, hit(doubles, 'Terrain Pulse')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
};

/** Multiscale halves the hit at full HP and nothing else: the first Shadow Ball lands on a full Dragonite, the second does not. */
export const MULTISCALE: FieldScene = {
  title: 'Multiscale at full HP',
  p1: team(set('Gengar', '', 'Cursed Body', ['Shadow Ball'], 'Modest', { spa: 252, spe: 252 })),
  p2: team(set('Dragonite', '', 'Multiscale', ['Splash'], 'Impish', { hp: 252, def: 252 })),
  attacker: 'Gengar', defender: 'Dragonite',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Shadow Ball')), p2: alone(doubles, splash()) }, { p1: alone(doubles, hit(doubles, 'Shadow Ball')), p2: alone(doubles, splash()) }],
  kinds: KINDS,
};

/** Two of the side's Pokemon have fainted when Kingambit comes in: Supreme Overlord lifts its power by a fifth. */
export const SUPREME_OVERLORD: FieldScene = {
  title: 'Supreme Overlord after two fallen',
  p1: doubles => (doubles
    ? [EXPLODER('Electrode'), EXPLODER('Voltorb'), set('Kingambit', '', 'Supreme Overlord', ['Iron Head'], 'Adamant', { atk: 252, spe: 252 }), blissey()]
    : [EXPLODER('Electrode'), EXPLODER('Voltorb'), set('Kingambit', '', 'Supreme Overlord', ['Iron Head'], 'Adamant', { atk: 252, spe: 252 })]),
  p2: GHOSTS,
  attacker: 'Kingambit', defender: 'Gengar',
  steps: doubles => (doubles
    ? [
      { p1: 'move explosion, move explosion', p2: 'move splash, move splash' },
      { p1: 'switch 3, switch 4' },
      { p1: alone(true, hit(true, 'Iron Head')), p2: alone(true, splash()) },
    ]
    : [
      { p1: 'move explosion', p2: 'move splash' },
      { p1: 'switch 2' },
      { p1: 'move explosion', p2: 'move splash' },
      { p1: 'switch 3' },
      { p1: 'move ironhead', p2: 'move splash' },
    ]),
  kinds: KINDS,
};

/** A Terastallized attacker takes the Tera type's same-type bonus on its Tera-type moves. */
export const TERA_ATTACKER: FieldScene = {
  title: 'a Terastallized attacker',
  p1: team(set('Gengar', '', 'Cursed Body', ['Flamethrower'], 'Modest', { spa: 252, spe: 252 }, 'Fire')),
  p2: team(blissey()),
  attacker: 'Gengar', defender: 'Blissey',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Flamethrower', true)), p2: alone(doubles, splash()) }, { p1: alone(doubles, hit(doubles, 'Flamethrower')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
};

/** A Terastallized defender takes the Tera type's resistances: Dark resists Ghost. */
export const TERA_DEFENDER: FieldScene = {
  title: 'a Terastallized defender',
  p1: team(set('Gengar', '', 'Cursed Body', ['Shadow Ball'], 'Modest', { spa: 252, spe: 252 })),
  p2: team(set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 }, 'Dark')),
  attacker: 'Gengar', defender: 'Blissey',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Shadow Ball')), p2: alone(doubles, splash(true)) }, { p1: alone(doubles, hit(doubles, 'Shadow Ball')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
};

/** Eruption hits with 150 power times the attacker's HP fraction: Seismic Toss takes a third off Typhlosion before the second one. */
export const ERUPTION: FieldScene = {
  title: 'Eruption below full HP',
  p1: team(set('Typhlosion', '', 'Blaze', ['Eruption'], 'Modest', { hp: 252, spa: 252 })),
  p2: team(set('Blissey', '', 'Natural Cure', ['Seismic Toss', 'Splash'], 'Calm', { hp: 252, spd: 252 })),
  attacker: 'Typhlosion', defender: 'Blissey',
  steps: doubles => [
    { p1: alone(doubles, hit(doubles, 'Eruption')), p2: alone(doubles, hit(doubles, 'Seismic Toss')) },
    { p1: alone(doubles, hit(doubles, 'Eruption')), p2: alone(doubles, splash()) },
  ],
  kinds: KINDS,
  barNoise: 0.02,
};

/** Gastro Acid ends Dragonite's Multiscale: the hit after it lands at full HP without the halving. */
export const GASTRO_ACID: FieldScene = {
  title: 'Multiscale after Gastro Acid',
  p1: team(set('Gengar', '', 'Cursed Body', ['Gastro Acid', 'Shadow Ball'], 'Modest', { spa: 252, spe: 252 })),
  p2: team(set('Dragonite', '', 'Multiscale', ['Splash'], 'Impish', { hp: 252, def: 252 })),
  attacker: 'Gengar', defender: 'Dragonite',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Gastro Acid')), p2: alone(doubles, splash()) }, { p1: alone(doubles, hit(doubles, 'Shadow Ball')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
};

/** The attacker's partner holds Neutralizing Gas, which the calculator reads only on the two Pokemon of the hit. Doubles only. */
export const GAS_ON_THE_PARTNER: FieldScene = {
  title: "the partner's Neutralizing Gas",
  p1: () => [set('Gengar', '', 'Cursed Body', ['Shadow Ball'], 'Modest', { spa: 252, spe: 252 }), set('Weezing-Galar', '', 'Neutralizing Gas', ['Splash'], 'Bold', { hp: 252 })],
  p2: team(set('Dragonite', '', 'Multiscale', ['Splash'], 'Impish', { hp: 252, def: 252 })),
  attacker: 'Gengar', defender: 'Dragonite',
  steps: () => [{ p1: 'move shadowball 1, move splash', p2: 'move splash, move splash' }],
  kinds: ['doubles'],
};

/** Heatran absorbs a Flamethrower with Flash Fire, then its own Fire move hits 1.5 times harder. */
export const FLASH_FIRE: FieldScene = {
  title: 'Flash Fire after the absorbed hit',
  p1: team(set('Heatran', '', 'Flash Fire', ['Flamethrower'], 'Modest', { hp: 252, spa: 252 })),
  p2: team(set('Garchomp', '', 'Rough Skin', ['Flamethrower'], 'Careful', { hp: 252, spd: 252 })),
  attacker: 'Heatran', defender: 'Garchomp',
  steps: doubles => [
    { p1: alone(doubles, splash()), p2: alone(doubles, hit(doubles, 'Flamethrower')) },
    { p1: alone(doubles, hit(doubles, 'Flamethrower')), p2: alone(doubles, splash()) },
  ],
  kinds: ['singles', 'doubles'],
};

/** The partner's Helping Hand lifts the next hit by half; the fit used to drop that hit. Doubles only. */
export const HELPING_HAND: FieldScene = {
  title: 'Helping Hand from the partner',
  p1: () => [set('Gengar', '', 'Cursed Body', ['Shadow Ball'], 'Modest', { spa: 252, spe: 252 }), set('Blissey', '', 'Natural Cure', ['Helping Hand'], 'Calm', { hp: 252 })],
  p2: team(GARCHOMP()),
  attacker: 'Gengar', defender: 'Garchomp',
  steps: () => [{ p1: 'move shadowball 1, move helpinghand -1', p2: 'move splash, move splash' }],
  kinds: ['doubles', 'champions doubles'],
};

/** Chi-Yu's Beads of Ruin on the attacker's side lowers the defender's Special Defense by a quarter. Doubles only, Gen 9 only: Chi-Yu is not in the Champions roster and the calculator's Champions mechanics has no Ruin ability. */
export const BEADS_OF_RUIN: FieldScene = {
  title: "the partner's Beads of Ruin",
  p1: () => [set('Gengar', '', 'Cursed Body', ['Shadow Ball'], 'Modest', { spa: 252, spe: 252 }), set('Chi-Yu', '', 'Beads of Ruin', ['Splash'], 'Timid', { spe: 252 })],
  p2: team(GARCHOMP()),
  attacker: 'Gengar', defender: 'Garchomp',
  steps: () => [{ p1: 'move shadowball 1, move splash', p2: 'move splash, move splash' }, { p1: 'move shadowball 1, move splash', p2: 'move splash, move splash' }],
  kinds: ['doubles'],
};

/** Swords Dance before the hit: the stages were already read (the control: no change). */
export const BOOSTED_HIT: FieldScene = {
  title: 'a boosted hit',
  p1: team(set('Garchomp', '', 'Rough Skin', ['Swords Dance', 'Crunch'], 'Jolly', { atk: 252, spe: 252 })),
  p2: team(set('Blissey', '', 'Natural Cure', ['Splash'], 'Bold', { hp: 252, def: 252 })),
  attacker: 'Garchomp', defender: 'Blissey',
  steps: doubles => [{ p1: alone(doubles, 'move swordsdance'), p2: alone(doubles, splash()) }, { p1: alone(doubles, hit(doubles, 'Crunch')), p2: alone(doubles, splash()) }],
  kinds: KINDS,
};

/** Gravity grounds Dragonite: the Ground move that its Flying type made harmless lands, and the calculator reads Gravity off the field. */
const healer = (species: string) => set(species, '', 'Natural Cure', ['Splash', 'Soft-Boiled'], 'Calm', { hp: 252 });
export const GRAVITY: FieldScene = {
  title: 'a Ground move under Gravity',
  p1: doubles => [set('Garchomp', '', 'Rough Skin', ['Drill Run', 'Splash'], 'Jolly', { atk: 252, spe: 252 }), ...(doubles ? [healer('Blissey')] : [])],
  p2: doubles => [set('Dragonite', '', 'Inner Focus', ['Gravity', 'Swords Dance'], 'Impish', { hp: 252, def: 252 }), ...(doubles ? [healer('Chansey')] : [])],
  attacker: 'Garchomp', defender: 'Dragonite',
  // Gravity forbids Splash, so the second step's partners heal instead.
  steps: doubles => [
    { p1: alone(doubles, splash()), p2: alone(doubles, 'move gravity') },
    { p1: alone(doubles, hit(doubles, 'Drill Run'), 'move softboiled'), p2: alone(doubles, 'move swordsdance', 'move softboiled') },
  ],
  kinds: ['singles', 'doubles'],
};

/** Gastro Acid ends with the switch: Dragonite goes out and comes back, and its Multiscale works again. */
export const GASTRO_ACID_THEN_SWITCH: FieldScene = {
  title: 'Multiscale back after a switch',
  p1: team(set('Gengar', '', 'Cursed Body', ['Gastro Acid', 'Shadow Ball', 'Splash'], 'Modest', { spa: 252, spe: 252 })),
  p2: team(set('Dragonite', '', 'Multiscale', ['Splash'], 'Impish', { hp: 252, def: 252 }), set('Skarmory', '', 'Sturdy', ['Splash'], 'Impish', { hp: 252, def: 252 })),
  attacker: 'Gengar', defender: 'Dragonite',
  steps: doubles => [
    { p1: alone(doubles, hit(doubles, 'Gastro Acid')), p2: alone(doubles, splash()) },
    { p1: alone(doubles, splash()), p2: alone(doubles, doubles ? 'switch 3' : 'switch 2') },
    { p1: alone(doubles, splash()), p2: alone(doubles, doubles ? 'switch 3' : 'switch 2') },
    { p1: alone(doubles, hit(doubles, 'Shadow Ball')), p2: alone(doubles, splash()) },
  ],
  kinds: ['singles', 'doubles'],
};
