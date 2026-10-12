import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';

type BodyOf = (side: SimSide, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) => SimPokemon | undefined;

type Handler = (this: unknown, ...args: unknown[]) => unknown;
type SleepRules = { lo: number; hi: number; rest: number | null };
const sleepRulesOf = new WeakMap<object, SleepRules | null>();

/**
 * Round 69, T187: the sleep counter's rules, asked of the simulator instead of
 * typed. The sleep condition's onStart runs on a stand-in that records the one
 * random call (start time in [lo, hi), Gen 9: 2 to 4, so 1 to 3 cants), and
 * Rest's onHit on a stand-in that records the count it sets (`rest`).
 */
function sleepRules(dex: SimBattle['dex']): SleepRules | null {
  if (sleepRulesOf.has(dex)) return sleepRulesOf.get(dex)!;
  let rules: SleepRules | null = null;
  const onStart = (dex.conditions.get('slp') as unknown as { onStart?: Handler }).onStart;
  const draws: number[][] = [];
  const state: Record<string, unknown> = {};
  const battle = { effectState: state, add: () => undefined, random: (...args: number[]) => (draws.push(args), args[0] ?? 0) };
  try {
    onStart?.call(battle, { removeVolatile: () => false }, null, null);
  } catch {
    // A sleep condition that needs the battle itself gives no rules.
  }
  if (draws.length === 1 && draws[0].length === 2 && 'time' in state) {
    const target = { statusState: {} as Record<string, unknown>, setStatus: () => true };
    try {
      (dex.moves.get('rest') as unknown as { onHit?: Handler }).onHit?.call({ heal: () => undefined }, target, target, null);
    } catch {
      // No Rest count in this generation: Rest then draws like any other sleep.
    }
    const rest = target.statusState.time;
    rules = { lo: draws[0][0], hi: draws[0][1], rest: typeof rest === 'number' ? rest : null };
  }
  sleepRulesOf.set(dex, rules);
  return rules;
}

/** What one cant line takes off the counter for this body: 1, 2 for a body that wakes early (the condition's own onBeforeMove says). */
function sleepStep(body: SimPokemon): number {
  const onBeforeMove = (body.battle.dex.conditions.get('slp') as unknown as { onBeforeMove?: Handler }).onBeforeMove;
  const sleeper = { hasAbility: (ability: string) => body.hasAbility(ability), statusState: { time: 64 }, cureStatus: () => undefined, lastMove: null };
  try {
    onBeforeMove?.call({ add: () => undefined }, sleeper, null, {});
  } catch {
    return 1;
  }
  return Math.max(1, 64 - sleeper.statusState.time);
}

/**
 * Gives a body asleep in the game a remaining count the game's cant lines
 * allow (`turns` of them so far): the simulator's own count stays when it is
 * allowed, else a start time is drawn from the rest of the range. After Rest
 * (the block shows it) the count is exact. An old snapshot (no count) and a
 * generation without rules leave the counter alone.
 */
export function settleSleepCounter(body: SimPokemon, turns: number, rested: boolean, redraw: boolean) {
  const rules = sleepRules(body.battle.dex);
  if (!rules) return;
  const state = body.statusState as { time?: number; startTime?: number };
  const used = turns * sleepStep(body);
  if (rested && rules.rest !== null) {
    state.startTime = rules.rest;
    state.time = Math.max(1, rules.rest - used);
    return;
  }
  if (!redraw && typeof state.time === 'number' && state.time >= 1 && state.time <= rules.hi - 1 - used) return;
  const first = Math.max(rules.lo, used + 1);
  const start = first < rules.hi ? body.battle.random(first, rules.hi) : rules.hi - 1;
  state.startTime = start;
  state.time = Math.max(1, start - used);
}

/**
 * Round 69, T187: a lock with a random length (Outrage and its kin) that the
 * game ended (its fatigue confusion is in the block) while the simulator's
 * draw goes on: the lock ends as the simulator ends one, and the confusion
 * the fatigue starts comes with it. The lock's volatile is the one the last
 * move line of that body names in the Dex (`self.volatileStatus`).
 */
export function endLocksTheGameEnded(battle: SimBattle, snapshot: TurnSnapshot, bodyOf: BodyOf) {
  const lastMove = new Map<string, string>();
  for (const line of snapshot.log ?? []) {
    const [, tag, ident, effect, flag] = line.split('|');
    if (tag === 'move') lastMove.set(ident, effect);
    if (tag !== '-start' || effect !== 'confusion' || flag !== '[fatigue]' || !lastMove.has(ident)) continue;
    const sideIdx = ident.startsWith('p1') ? 0 : 1;
    const name = ident.replace(/^p[12][a-d]: /, '');
    const snapshotPokemon = [snapshot.p1, snapshot.p2][sideIdx].pokemon.find(pokemon => pokemon.name === name);
    const body = snapshotPokemon && bodyOf(battle.sides[sideIdx], snapshotPokemon);
    const lockId = battle.dex.moves.get(lastMove.get(ident)!).self?.volatileStatus;
    if (!body || !lockId || !body.volatiles[lockId]) continue;
    body.removeVolatile(lockId);
    body.addVolatile('confusion', body, battle.dex.conditions.get(lockId));
  }
}
