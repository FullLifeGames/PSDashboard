import type { Battle, PokemonSet } from '@pkmn/sim';
import { extractProtocolEvents, isPerfectAlignment, scoreAlignment, type ProtocolEvents } from '../src/hax-alignment';
import { strengthMix } from '../src/calc/fickle';
import { loggedActions, loggedDice, type LoggedOptions } from '../src/dice/logged-results';
import { playForcedTurn } from '../src/dice/play';
import { loggedOptions } from '../src/dice/turn';
import type { ForcedDie } from '../src/dice/types';
import { playClicks, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { sweepBoard, sweepClicks, clicksAccepted, isCharge, isDelayed, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

export type Channel = 'misses' | 'crits' | 'secondaries' | 'hitCounts' | 'cants' | 'confusionSelfHits' | 'moveOrder';

const POOL = 12;
// Spread over the whole range of the generator: nearby seeds (1,2,3,4 and 5,6,7,8) start it on nearly the same
// draws, so a rare die such as a crit would never differ between two of them.
const mixed = (n: number): string => [1, 2, 3, 4].map(k => ((n + 1) * 7919 + k * 104729 + ((n * k) % 13) * 4093) % 65521 + 1).join(',');
const logSeed = (index: number): string => mixed(index * 2);
const otherSeed = (index: number): string => mixed(index * 2 + 1);

const sameEntries = (a: Map<string, number> | string[], b: Map<string, number> | string[]): boolean =>
  JSON.stringify(a instanceof Map ? [...a].sort() : a) === JSON.stringify(b instanceof Map ? [...b].sort() : b);

export function differsIn(a: ProtocolEvents, b: ProtocolEvents, channels: readonly Channel[]): boolean {
  return channels.some(channel => !sameEntries(a[channel], b[channel]));
}

// A multi-hit move whose hits crit unevenly: one die names every hit's crit, so the log cannot be forced for it.
const unevenCrits = (log: string[]): boolean =>
  loggedActions(log).some(action => Object.entries(action.crits).some(([slot, crits]) => crits < (action.damaged[slot] ?? 0)));

export interface Scan { scanned: number; skipped: number; witnesses: number; named: number; rollFaints: number; failures: string[]; why: Record<string, number> }

export interface Scene {
  board(seed: string): Battle;
  clicks: { p1: string; p2: string };
  options: LoggedOptions;
  channels: readonly Channel[];
  pool?: number;
  want?: number;
  differs?(log: string[], naturalLog: string[]): boolean;
  kind?: ForcedDie['name']['kind'];
  extra?(log: string[], forcedLog: string[]): string | null;
}

const pick = ({ selfOf, accuracyTargets }: LoggedOptions): LoggedOptions => ({ selfOf, accuracyTargets });

function turn(battle: Battle, scene: Scene, forced?: readonly ForcedDie[]): string[] {
  const start = battle.log.length;
  if (forced) playForcedTurn({ live: battle, forced, play: played => playClicks(played, scene.clicks) });
  else playClicks(battle, scene.clicks);
  return battle.log.slice(start);
}

function leftOut(scene: Scene, expected: ProtocolEvents, dice: readonly ForcedDie[], log: string[]): string | null {
  if (expected.faints.size > 0) return 'faint';
  if (expected.ended) return 'ended';
  if (dice.length === 0 && !scene.differs) return 'no die';
  return unevenCrits(log) ? 'uneven crits' : null;
}

export function scan(scene: Scene, want: number): Scan {
  const result: Scan = { scanned: 0, skipped: 0, witnesses: 0, named: 0, rollFaints: 0, failures: [], why: {} };
  for (let index = 0; index < (scene.pool ?? POOL) && result.witnesses < (scene.want ?? want); index++) {
    const [source, other] = [scene.board(logSeed(index)), scene.board(otherSeed(index))];
    result.scanned++;
    const log = turn(source, scene);
    const expected = extractProtocolEvents(log);
    const dice = loggedDice(log, scene.options);
    const left = leftOut(scene, expected, dice, log);
    if (left) { result.skipped++; result.why[left] = (result.why[left] ?? 0) + 1; continue; }
    const naturalLog = turn(scene.board(otherSeed(index)), scene);
    const moved = scene.differs ? scene.differs(log, naturalLog) : differsIn(expected, extractProtocolEvents(naturalLog), scene.channels);
    if (!moved) { result.skipped++; result.why.unmoved = (result.why.unmoved ?? 0) + 1; continue; }
    result.witnesses++;
    if (!scene.kind || dice.some(die => die.name.kind === scene.kind)) result.named++;
    const forcedLog = turn(other, scene, dice);
    const score = scoreAlignment(expected, extractProtocolEvents(forcedLog));
    const own = scene.extra?.(log, forcedLog);
    if (own) result.failures.push(`seed ${index}: ${own}`);
    if (score.faintMismatches > 0) { result.rollFaints++; continue; }
    if (!isPerfectAlignment(score)) result.failures.push(`seed ${index}: ${JSON.stringify(score)}`);
  }
  return result;
}

export function clickedOf(moveId: string, mode: Mode): Map<string, string> {
  const clicked = new Map([['p1a', moveId], ['p2a', 'splash']]);
  if (mode === 'doubles') for (const slot of ['p1b', 'p2b']) clicked.set(slot, 'splash');
  return clicked;
}

export function moveScene(
  rules: Rules, mode: Mode, move: DexMove, extra: Pick<Scene, 'channels' | 'kind' | 'options'> & Partial<Pick<Scene, 'extra' | 'pool'>>,
  outfit?: { item?: string; ability?: string },
): Scene | null {
  if (isDelayed(move)) return null;
  const charge = isCharge(move);
  const board = (seed: string): Battle => outfit ? outfitted(rules, mode, move.id, seed, outfit) : sweepBoard(rules, move.id, mode, seed);
  const first = sweepClicks(mode, move.target);
  const clicks = charge ? sweepClicks(mode, move.target, true) : first;
  const probe = board('1,2,3,4');
  if (!clicksAccepted(probe, first)) return null;
  if (charge) {
    playClicks(probe, first);
    if (!clicksAccepted(probe, clicks)) return null;
  }
  return {
    board: seed => {
      const battle = board(seed);
      if (charge) playClicks(battle, first);
      return battle;
    },
    clicks, ...extra,
    options: { ...extra.options, ...pick(loggedOptions(probe, clicks)) },
  };
}

function outfitted(rules: Rules, mode: Mode, moveId: string, seed: string, outfit: { item?: string; ability?: string }): Battle {
  const base = { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...(rules.generation >= 2 ? { gender: 'M' as const } : {}) };
  const attacker = set('Snorlax', [moveId], { ...base, item: outfit.item ?? '', ability: outfit.ability ?? 'No Ability' });
  const foe = (species: string, moves = ['splash']): PokemonSet => set(species, moves, { ...base, ...(rules.generation >= 2 ? { gender: 'F' as const } : {}) });
  if (mode === 'singles') return battleOf(rules.singles, [attacker], [foe('Vaporeon')], seed);
  return battleOf(rules.doubles!, [attacker, foe('Blissey')], [foe('Vaporeon'), foe('Vaporeon')], seed);
}

export const witnessesWanted = (): number => sweepSelection([0, 1, 2, 3], 'seeds').length;

export function powerMoves(dex: Parameters<typeof strengthMix>[0]): { id: string; name: string }[] {
  return (dex as unknown as { moves: { all(): { exists: boolean; id: string; name: string }[] } }).moves.all()
    .filter(move => move.exists && strengthMix(dex, move.name) !== null).map(move => ({ id: move.id, name: move.name }));
}
