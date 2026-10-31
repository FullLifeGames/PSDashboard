import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';

/**
 * Round 82 (forced dice), step A7a: small real battles for the panel's dice specs. The panel asks the simulator which dice a move
 * draws, so these specs play on a live battle instead of a stand-in. Custom Game formats carry every move and no team preview.
 */
const STATS = { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 };

export const setOf = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs: STATS,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '', ...extra,
});

export interface DiceBoard { p1: PokemonSet[]; p2: PokemonSet[]; format?: string; seed?: string }

/** A battle past team preview, the first set of each side leading (two in doubles). */
export function diceBattle({ p1, p2, format = 'gen9customgame', seed = '1,2,3,4' }: DiceBoard): Battle {
  const battle = new Battle({
    formatid: toID(format), seed,
    p1: { name: 'Alpha', team: Teams.pack(p1) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/**
 * Round 82 (forced dice), step A7c: the public log of a fresh game past team preview, the replay log a branch at turn 1 starts from
 * (the hook specs hand it to `startBranch` with the teams), without the clock lines and the secret halves of split lines.
 */
export function freshLog({ p1, p2, format }: DiceBoard & { format: string }): string {
  const battle = diceBattle({ p1, p2, format });
  return battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|') && !line.startsWith('|t:|')).join('\n');
}
