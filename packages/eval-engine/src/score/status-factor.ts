import { PRNG, toID, type Battle, type Pokemon, type PokemonSet } from '@pkmn/sim';
import { twinBattle } from '../sim-ask/index.ts';

/**
 * Round 69 (T102, decision 17): the right status multiplier of a body. The
 * flat multiplier of `bodies` (EVAL_WEIGHTS.status) prices a burn, poison or
 * paralysis the same on every mon, but an ability can change what a status
 * costs: Poison Heal heals where poison hurts, Guts and Toxic Boost and Flare
 * Boost turn the status into extra power, Quick Feet into speed, Marvel
 * Scale into bulk, Magic Guard takes the chip. The simulator knows each case,
 * so the answer is played, not listed: a twin battle reads six channels
 * (HP over an idle turn, damage dealt and taken with a physical and a special
 * move, speed) for the ability with and without the status, against a mon
 * with no ability. The status costs the channels where the plain statused mon
 * is worse than the plain healthy one; an ability that lifts one of its
 * channels above its own healthy value turns the status into a gain (right
 * multiplier 1), else the right multiplier is the applied one plus the share
 * of the cost the ability gives back (the cost it still pays against the
 * cost of a mon with no ability: Magic Guard under poison pays none, Analytic
 * under burn pays all of it and more). A cost is the share a channel loses
 * (a halved Attack is half whatever the mon's Attack), except for the HP of
 * an idle turn, which is a fraction of the mon's HP already.
 *
 * The idle turn rolls dice (Shed Skin cures a third of the time): that
 * channel is played on several seeds and the answer is the mean, so an ability
 * that cures by chance gets the share of the cost it saves in expectation.
 * test/status-fix.spec.ts holds every ability under every status to whole
 * turns of real battles.
 *
 * Burn, paralysis, poison and toxic are played. Sleep and freeze keep the
 * applied multiplier: their cost is the turns the mon cannot act, which no
 * deterministic channel of the twin reads (Early Bird, Natural Cure and
 * Hydration are rests of this step).
 */

/** The statuses with a cost the twin can read: chip damage, a halved Attack, a halved Speed. */
const PLAYED = new Set(['brn', 'par', 'psn', 'tox']);

const CHANNELS = ['residual', 'physOut', 'specOut', 'physIn', 'specIn', 'speed'] as const;
type Channel = (typeof CHANNELS)[number];

/** Every channel reads higher-is-better for the mon, so a cost is a drop and a gain a rise. */
type Reading = Record<Channel, number>;

/** A physical and a special move that always hit; the spec holds both categories to the Dex. */
const PHYSICAL = 'aerialace';
const SPECIAL = 'aurasphere';

/** The seeds of the idle turn: the dice of an end-of-turn cure or chip. */
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24', '25,26,27,28', '29,30,31,32'] as const;
type Seed = (typeof SEEDS)[number];

/** A rise or a drop smaller than this share of the value (or of one HP fraction for the residual) is noise of the damage rolls. */
const NOISE = 0.03;
const RESIDUAL_NOISE = 1e-3;

const noise = (channel: Channel, value: number): number => Math.max(NOISE * Math.abs(value), channel === 'residual' ? RESIDUAL_NOISE : 0);

function twinOf(format: string, ability: string, seed: Seed): Battle {
  const mon = (id: string): PokemonSet => ({
    name: 'Snorlax', species: 'Snorlax', item: '', ability: id, moves: ['splash'], nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  });
  return twinBattle(format, { p1: { name: 'Mine', team: [mon(ability)] }, p2: { name: 'Foe', team: [mon('noability')] } }, { seed });
}

/** The damage `from` deals `to` with the move at the fixed dice, no crit: what the simulator's own damage step gives. */
export function damageOf(battle: Battle, from: Pokemon, to: Pokemon, moveId: string): number {
  const move = battle.dex.getActiveMove(moveId);
  const { activeMove, activePokemon, activeTarget, prng } = battle;
  battle.activeMove = move;
  battle.activePokemon = from;
  battle.activeTarget = to;
  battle.prng = new PRNG('1,2,3,4');
  try {
    return battle.actions.getDamage(from, to, move, true) || 0;
  } finally {
    battle.activeMove = activeMove;
    battle.activePokemon = activePokemon;
    battle.activeTarget = activeTarget;
    battle.prng = prng;
  }
}

/** The mon with `ability` (and `status` when given) on a battle seeded `seed`, or null where the simulator does not let it carry the status. */
function carrying(format: string, ability: string, status: string | null, seed: Seed): { battle: Battle; mine: Pokemon; foe: Pokemon } | null {
  const battle = twinOf(format, ability, seed);
  const mine = battle.sides[0].active[0]!;
  const foe = battle.sides[1].active[0]!;
  if (status && (!mine.setStatus(status, null, null, true) || mine.status !== status)) return null;
  return { battle, mine, foe };
}

/** HP over an idle turn, as a fraction of the mon's HP, with the dice of `seed`. */
function idleTurn(format: string, ability: string, status: string | null, seed: Seed): number | null {
  const twin = carrying(format, ability, status, seed);
  if (!twin) return null;
  const hp = twin.mine.hp;
  twin.battle.choose('p1', 'move 1');
  twin.battle.choose('p2', 'move 1');
  return (twin.mine.hp - hp) / twin.mine.maxhp;
}

interface Played { fixed: Reading; idle: number[] }

/** The six channels of the mon with `ability` (and `status` when given): one reading of the damage and speed channels, the idle turn on every seed. */
function readChannels(format: string, ability: string, status: string | null): Played | null {
  try {
    const twin = carrying(format, ability, status, SEEDS[0]);
    if (!twin) return null;
    const { battle, mine, foe } = twin;
    const idle = SEEDS.map(seed => idleTurn(format, ability, status, seed));
    if (idle.some(turn => turn === null)) return null;
    const fixed: Reading = {
      residual: 0,
      physOut: damageOf(battle, mine, foe, PHYSICAL),
      specOut: damageOf(battle, mine, foe, SPECIAL),
      physIn: -damageOf(battle, foe, mine, PHYSICAL),
      specIn: -damageOf(battle, foe, mine, SPECIAL),
      speed: mine.getActionSpeed(),
    };
    return { fixed, idle: idle as number[] };
  } catch {
    return null;
  }
}

const readings = new Map<string, Played | null>();

function memoReading(format: string, ability: string, status: string | null): Played | null {
  const key = `${format}|${ability}|${status}`;
  let reading = readings.get(key);
  if (reading === undefined) {
    reading = readChannels(format, ability, status);
    readings.set(key, reading);
  }
  return reading;
}

/**
 * The share of a cost the ability gives back in one channel: 1 when the
 * statused ability mon loses nothing of its healthy value, 0 when it loses
 * as much as a mon with no ability (a share of the value; the idle turn's HP
 * and a value of 0 compare the difference).
 */
function givenBack(channel: Channel, base: [number, number], mon: [number, number]): number {
  const [baseHealthy, baseStatused] = base;
  const [healthy, statused] = mon;
  const share = (from: number, to: number) => (channel === 'residual' || from === 0 ? from - to : 1 - to / from);
  const baseCost = share(baseHealthy, baseStatused);
  return Math.min(1, Math.max(0, 1 - share(healthy, statused) / baseCost));
}

/** The verdict of one seed of the idle turn: 1 where the status is a gain for the ability, else the share of the cost given back. */
function verdictOn(seed: number, played: [Played, Played, Played, Played]): number {
  const [baseHealthy, baseStatused, healthy, statused] = played;
  const at = (turn: Played): Reading => ({ ...turn.fixed, residual: turn.idle[seed] });
  const [bh, bs, h, s] = [at(baseHealthy), at(baseStatused), at(healthy), at(statused)];
  if (CHANNELS.some(channel => s[channel] > h[channel] + noise(channel, h[channel]))) return 1;
  const costs = CHANNELS.filter(channel => bs[channel] < bh[channel] - noise(channel, bh[channel]));
  if (costs.length === 0) return 0;
  return costs.reduce((sum, channel) => sum + givenBack(channel, [bh[channel], bs[channel]], [h[channel], s[channel]]), 0) / costs.length;
}

/** What the ability gives back of the status's cost, averaged over the dice of the idle turn, and whether the dice decide it. */
interface Verdict { recovered: number; dice: boolean }

const NONE: Verdict = { recovered: 0, dice: false };

function verdictOf(format: string, ability: string, status: string): Verdict {
  const played = [memoReading(format, 'noability', null), memoReading(format, 'noability', status), memoReading(format, ability, null), memoReading(format, ability, status)];
  if (played.some(turn => !turn)) return NONE;
  const bySeed = SEEDS.map((_, seed) => verdictOn(seed, played as [Played, Played, Played, Played]));
  return { recovered: bySeed.reduce((sum, value) => sum + value, 0) / bySeed.length, dice: bySeed.some(value => Math.abs(value - bySeed[0]) > 1e-9) };
}

const verdicts = new Map<string, Verdict>();

function verdictFor(format: string, ability: string, status: string): Verdict {
  const key = `${format}|${ability}|${status}`;
  let verdict = verdicts.get(key);
  if (!verdict) {
    verdict = verdictOf(format, ability, status);
    verdicts.set(key, verdict);
  }
  return verdict;
}

/**
 * The right multiplier of a body with `ability` under `status`, given the
 * multiplier `applied` for every body: `applied` where the ability changes
 * nothing, 1 where it turns the status into a gain, between where it gives
 * part of the cost back. `format` is the twin's (removalFormat of the battle).
 */
export function statusRight(format: string, ability: string, status: string, applied: number): number {
  const id = toID(ability);
  if (!id || id === 'noability' || applied === 1 || !PLAYED.has(status)) return applied;
  const { recovered } = verdictFor(format, id, status);
  return recovered >= 1 ? 1 : applied + (1 - applied) * recovered;
}

/** Whether the dice of the idle turn decide what the ability gives back under the status (Shed Skin: a cure a third of the time). */
export function statusByChance(format: string, ability: string, status: string): boolean {
  const id = toID(ability);
  return !!id && id !== 'noability' && PLAYED.has(status) && verdictFor(format, id, status).dice;
}
