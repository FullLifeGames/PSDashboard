import type { PokemonSet, Pokemon } from '@pkmn/sim';
import { CHAMPIONS_MOD } from '../calc-gen.ts';
import type { RulesDex } from '../rules-dex.ts';
import { twinBattle } from '../sim-ask/twin.ts';
import type { RaceSpeedEffects } from '../types.ts';

// A Scarf races at the simulator's own rounding (201 at 301, not 301.5): one holder per generation, read by `getStat`.

const holders = new Map<string, Pokemon | null>();
const memo = new Map<string, number>();

const hasScarf = (dex: RulesDex): boolean => dex.items.get('choicescarf').exists && dex.items.get('choicescarf').gen <= dex.gen;

function holderOf(dex: RulesDex, item: string): Pokemon {
  const team = (held: string): PokemonSet[] => [{
    name: 'Smeargle', species: 'Smeargle', item: held, ability: dex.gen >= 3 ? 'Own Tempo' : '', moves: ['Splash'], nature: 'Hardy', gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
  }];
  const battle = twinBattle(`gen${dex.gen}${dex.currentMod === CHAMPIONS_MOD ? 'champions' : ''}customgame`, { p1: { name: 'A', team: team(item) }, p2: { name: 'B', team: team('') } });
  return battle.sides[0].active[0]!;
}

function scarfHolder(dex: RulesDex): Pokemon | null {
  if (holders.has(dex.currentMod)) return holders.get(dex.currentMod)!;
  const holder = hasScarf(dex) ? holderOf(dex, 'Choice Scarf') : null;
  holders.set(dex.currentMod, holder);
  return holder;
}

export function scarfedSpeed(dex: RulesDex, stat: number): number {
  const key = `${dex.currentMod}:${stat}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const holder = scarfHolder(dex);
  let speed = stat;
  if (holder) {
    holder.storedStats.spe = stat;
    speed = holder.getStat('spe', true);
  }
  memo.set(key, speed);
  return speed;
}

const effectHolders = new Map<string, Pokemon>();

// A trap: the paradox volatile picks its stat when it starts, so the stat the log showed is written on its state.
function effectHolder(dex: RulesDex, scarf: boolean, effects: RaceSpeedEffects): Pokemon {
  const key = `${dex.currentMod}:${scarf}:${JSON.stringify(effects)}`;
  let holder = effectHolders.get(key);
  if (!holder) {
    holder = holderOf(dex, scarf && hasScarf(dex) ? 'Choice Scarf' : '');
    if (effects.stage) holder.boosts.spe = effects.stage;
    for (const id of effects.sideConditions ?? []) holder.side.addSideCondition(id, holder);
    if (effects.volatile) {
      holder.addVolatile(effects.volatile);
      holder.volatiles[effects.volatile].bestStat = 'spe';
    }
    effectHolders.set(key, holder);
  }
  return holder;
}

const effectMemo = new Map<string, number>();

function effectSpeed(dex: RulesDex, stat: number, scarf: boolean, effects: RaceSpeedEffects): number {
  if (Object.keys(effects).length === 0) return scarf ? scarfedSpeed(dex, stat) : stat;
  const key = `${dex.currentMod}:${scarf}:${stat}:${JSON.stringify(effects)}`;
  let speed = effectMemo.get(key);
  if (speed === undefined) {
    const holder = effectHolder(dex, scarf, effects);
    holder.storedStats.spe = stat;
    speed = holder.getStat('spe');
    effectMemo.set(key, speed);
  }
  return speed;
}

/** Which of a mover's entries the race reads: the winner's faster one, the loser's slower one. */
export type RacePick = 'max' | 'min';

/** A mover's Speed in a race: the stat with its Scarf and the proven effects, read through a simulator twin. */
export function raceSpeed(dex: RulesDex, stat: number, scarf: boolean, effects?: RaceSpeedEffects[], pick: RacePick = 'max'): number {
  if (!effects || effects.length === 0) return scarf ? scarfedSpeed(dex, stat) : stat;
  const speeds = effects.map(entry => effectSpeed(dex, stat, scarf, entry));
  return pick === 'max' ? Math.max(...speeds) : Math.min(...speeds);
}
