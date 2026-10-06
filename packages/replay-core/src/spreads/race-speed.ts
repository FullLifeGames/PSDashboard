import { Battle, Dex, Teams, toID, type Pokemon } from '@pkmn/sim';

/**
 * The Speed a race ran at, as the simulator of the replay's generation
 * plays it (round 64, T122). A Choice Scarf's Speed is the simulator's own
 * modifier and rounding (201 races at 301, not 301.5): one Scarf holder per
 * generation answers every stat through `getStat`, memoized per stat. In a
 * generation before the item exists the holder carries nothing.
 */

const holders = new Map<number, Pokemon | null>();
const memo = new Map<string, number>();

function scarfHolder(gen: number): Pokemon | null {
  if (holders.has(gen)) return holders.get(gen)!;
  const scarf = Dex.forGen(gen).items.get('choicescarf');
  let holder: Pokemon | null = null;
  if (scarf.exists && scarf.gen <= gen) {
    const team = (item: string) => Teams.pack([{
      name: 'Smeargle', species: 'Smeargle', item, ability: 'Own Tempo', moves: ['Splash'], nature: 'Hardy', gender: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
    }]);
    const battle = new Battle({
      formatid: toID(`gen${gen}customgame`), seed: '1,2,3,4',
      p1: { name: 'A', team: team('Choice Scarf') }, p2: { name: 'B', team: team('') },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1', 'team 1');
    holder = battle.sides[0].active[0] ?? null;
  }
  holders.set(gen, holder);
  return holder;
}

/** The Speed a Choice Scarf holder with this Speed stat races at. */
export function scarfedSpeed(gen: number, stat: number): number {
  const key = `${gen}:${stat}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const holder = scarfHolder(gen);
  let speed = stat;
  if (holder) {
    holder.storedStats.spe = stat;
    speed = holder.getStat('spe', true);
  }
  memo.set(key, speed);
  return speed;
}

/** A race's Speed: the stat, with the Scarf the mover held. */
export const raceSpeed = (gen: number, stat: number, scarf: boolean): number => (scarf ? scarfedSpeed(gen, stat) : stat);
