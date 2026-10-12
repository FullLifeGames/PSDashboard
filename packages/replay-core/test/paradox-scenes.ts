import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import type { PokemonEvs } from '../src/types';

/**
 * Real simulator battles for the paradox ability tests (round 69, T167): Protosynthesis and Quark Drive name the stat they
 * raise on the activation line. A scene is a few scripted turns on Gen 9 singles or doubles; the simulator's own HP loss of
 * the target per turn is the oracle, the log is what the parser reads.
 */

export type Kind = 'singles' | 'doubles';
export const KINDS: Kind[] = ['singles', 'doubles'];
export const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };

const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
export const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
export const set = (species: string, item: string, ability: string, moves: string[], nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
  name: species, species, item, ability, moves, nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 100, gender: '',
});
export const partner = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });

/** One scripted turn, as the choice of each side's first slot (the partner of a doubles side splashes). */
export interface Turn {
  p1: string;
  p2: string;
}

export interface SceneSpec {
  /** Side 1's lead; side 2's lead and bench (the bench is what `switch` brings in: slot 2 in singles, slot 3 in doubles). */
  attacker: PokemonSet;
  lead: PokemonSet;
  bench?: PokemonSet;
  turns: Turn[];
  /** The species whose HP the oracle follows. */
  target: string;
}

export interface Scene {
  log: string;
  /** The target's HP lost on each turn, in the simulator's own numbers. */
  damage: number[];
  maxHp: number;
}

const choice = (kind: Kind, slot: string) => (kind === 'doubles' ? `${slot}, move splash` : slot);
const doublesTarget = (kind: Kind, choiceText: string) => (kind === 'doubles' && /^move (?!swordsdance|splash)/.test(choiceText) ? `${choiceText} 1` : choiceText);

/** A battle of the spec's turns; null when a hit crit (the parser records no crit), missed or the target fainted. */
export function sceneOf(kind: Kind, spec: SceneSpec, seed: number): Scene | null {
  const doubles = kind === 'doubles';
  const p2Team = doubles ? [spec.lead, partner(), ...(spec.bench ? [spec.bench] : [])] : [spec.lead, ...(spec.bench ? [spec.bench] : [])];
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [spec.attacker, partner()] : [spec.attacker]) },
    p2: { name: 'Beta', team: Teams.pack(p2Team) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const target = battle.p2.pokemon.find(mon => mon.species.name === spec.target)!;
  const { maxhp: maxHp } = target;
  const damage: number[] = [];
  for (const turn of spec.turns) {
    const before = target.hp;
    battle.choose('p1', choice(kind, doublesTarget(kind, turn.p1)));
    battle.choose('p2', choice(kind, turn.p2.replace(/^switch \d/, doubles ? 'switch 3' : 'switch 2')));
    damage.push(before - target.hp);
  }
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  if (/\|-crit\|/.test(log) || /\|-miss\|/.test(log) || target.hp <= 0) return null;
  return { log, damage, maxHp };
}

/** Up to `count` clean scenes whose last damage differs. */
export function scenesOf(kind: Kind, spec: SceneSpec, count: number): Scene[] {
  const scenes: Scene[] = [];
  for (let seed = 1; scenes.length < count && seed <= 200; seed++) {
    const scene = sceneOf(kind, spec, seed);
    if (scene && !scenes.some(known => known.damage.at(-1) === scene.damage.at(-1))) scenes.push(scene);
  }
  return scenes;
}

/** Roaring Moon (Protosynthesis) in the sun of Torkoal (Drought): the activation comes with the first lines. */
const roaringMoon = (nature: string, spread: Partial<PokemonEvs>, moves: string[]) => set('Roaring Moon', '', 'Protosynthesis', moves, nature, spread);
const torkoal = () => set('Torkoal', '', 'Drought', ['Splash'], 'Impish', { hp: 252, def: 252 });
const DRAGON_CLAW = { p1: 'move dragonclaw', p2: 'move splash' };

/** The stat the log names is Speed (Jolly, no Attack investment); Swords Dance after the activation makes the HIT-time stat Attack. */
export const SWORDS_AFTER_ACTIVATION: SceneSpec = {
  attacker: roaringMoon('Jolly', { spe: 252 }, ['Swords Dance', 'Dragon Claw']),
  lead: torkoal(), target: 'Torkoal',
  turns: [{ p1: 'move swordsdance', p2: 'move splash' }, DRAGON_CLAW, DRAGON_CLAW],
};

/** Adamant 252 Attack: Protosynthesis names Attack and the 1.3 boost lies in the damage. */
export const ATTACK_BOOSTED: SceneSpec = {
  attacker: roaringMoon('Adamant', { atk: 252 }, ['Dragon Claw']),
  lead: torkoal(), target: 'Torkoal',
  turns: [DRAGON_CLAW, DRAGON_CLAW],
};

/** Incineroar's Intimidate (Attack -1) comes before the sun: 377 Attack would be the highest unstaged, 251 staged is not. */
export const INTIMIDATE_BEFORE_ACTIVATION: SceneSpec = {
  attacker: roaringMoon('Hardy', { atk: 252, spe: 252 }, ['Dragon Claw']),
  lead: set('Incineroar', '', 'Intimidate', ['Splash'], 'Careful', { hp: 252, spd: 252 }),
  bench: torkoal(), target: 'Torkoal',
  turns: [{ p1: 'move dragonclaw', p2: 'switch 2' }, DRAGON_CLAW],
};

/** Quark Drive in the Electric Terrain of Tapu Koko. */
export const QUARK_DRIVE: SceneSpec = {
  attacker: set('Iron Valiant', '', 'Quark Drive', ['Spirit Break'], 'Adamant', { atk: 252 }),
  lead: set('Tapu Koko', '', 'Electric Surge', ['Splash'], 'Calm', { hp: 252, spd: 252 }), target: 'Tapu Koko',
  turns: [{ p1: 'move spiritbreak', p2: 'move splash' }],
};

/** The paradox Pokémon is the one hit: Torkoal's Overheat on a Roaring Moon that Protosynthesis raised in Attack. */
export const PARADOX_DEFENDER: SceneSpec = {
  attacker: set('Torkoal', '', 'Drought', ['Overheat'], 'Modest', { hp: 252, spa: 252 }),
  lead: set('Roaring Moon', '', 'Protosynthesis', ['Splash'], 'Adamant', { hp: 252, atk: 252 }), target: 'Roaring Moon',
  turns: [{ p1: 'move overheat', p2: 'move splash' }, { p1: 'move overheat', p2: 'move splash' }],
};
