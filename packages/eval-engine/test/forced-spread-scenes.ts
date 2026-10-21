import type { Battle, PokemonSet } from '@pkmn/sim';
import type { SimPosition } from '../src/forward-model';
import { rollSet as set, rootOf } from './calc-roll-oracle';

/** The scenes of the forced spread behind a screen (round 73, T202): which hits the calc forces onto every foe, and the doubles battle that plays them. */

const terapagos = (): PokemonSet => set('Terapagos', ['Tera Starstorm', 'Splash'], { ability: 'Tera Shift', teraType: 'Stellar' });
const hatterene = (): PokemonSet => set('Hatterene', ['Expanding Force', 'Splash']);
export const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });

export const SCREENS = ['reflect', 'lightscreen', 'auroraveil'] as const;
export const IDLE = 'move splash, move splash';
export const IDLE_ALONE = 'move splash, pass';

export interface Scene {
  title: string;
  attacker: () => PokemonSet;
  move: string;
  id: string;
  choice: string;
  terrain: string;
  /** Applies to the battle before the position is cut. */
  field: (battle: Battle) => void;
}

export const SCENES: Scene[] = [
  {
    title: 'Expanding Force in Psychic Terrain', attacker: hatterene, move: 'Expanding Force', id: 'expandingforce',
    choice: 'move expandingforce 1, move splash', terrain: 'psychicterrain', field: battle => { battle.field.setTerrain('psychicterrain', 'debug'); },
  },
  {
    title: 'Tera Starstorm after the Tera click', attacker: terapagos, move: 'Tera Starstorm', id: 'terastarstorm',
    choice: 'move terastarstorm 1 terastallize, move splash', terrain: '', field: () => undefined,
  },
];

/** A doubles battle with the first foe alone (`alone`) or beside a second one, and `screen` up on the foes' side. */
export function doubles(scene: Scene, screen: string | null, alone: boolean): SimPosition {
  return rootOf('gen9doublescustomgame', [scene.attacker(), wall('Snorlax')], [wall(), wall('Chansey')], battle => {
    if (alone) {
      battle.sides[1].active[1]!.faint();
      battle.faintMessages();
    }
    scene.field(battle);
    if (screen) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]!);
  });
}
