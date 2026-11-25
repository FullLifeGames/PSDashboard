import { Battle as SimBattle, PRNG, Teams, toID, type Battle, type Pokemon } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { playForcedTurn } from '../src/dice/play';
import { genShape } from '../src/dice/recognize';
import type { DiceReport, DieName, ForcedDie } from '../src/dice/types';
import { AIM_FREE_TARGETS } from '../src/dice/aim';
import { copyOf } from '../src/sim-ask/copy';
import { CHAMPIONS, mon, playClicks, RULES, stableLog, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

export type DexMove = ReturnType<ReturnType<typeof rulesDex>['moves']['get']>;

export const dexOfRules = (rules: Rules) => (rules === CHAMPIONS ? rulesDex(0) : rulesDex(rules.generation));

export const SWEEP_CASES: { rules: Rules; mode: Mode; name: string }[] = RULES.flatMap(rules =>
  (rules.doubles ? ['singles', 'doubles'] as const : ['singles'] as const).map(mode => ({ rules, mode, name: `${rules.name} ${mode}` })));

const FOE_REACHING = new Set(['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent', 'randomNormal', 'scripted']);
const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);

// A plain run plays a fixed sample of the moves (`sweepSelection`); `whole` or DICE_SWEEPS=full plays every one.
export function sweepMoves(rules: Rules, keep: (move: DexMove) => boolean, foesOnly = true, whole = false): { moves: DexMove[]; skipped: number } {
  const dex = dexOfRules(rules);
  const all = dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
    && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past') && keep(move));
  const reaching = foesOnly ? all.filter(move => FOE_REACHING.has(move.target)) : all;
  return { moves: whole ? reaching : sweepSelection(reaching, 'moves'), skipped: all.length - reaching.length };
}

export const VGC_RULES: Rules[] = RULES.filter(rules => rules.doubles && (rules.generation === 9));

export function sweepBoard(rules: Rules, moveId: string, mode: Mode, seed = '1,2,3,4', vgc = false, species = 'Snorlax'): Battle {
  const attacker = mon(rules, { species, moves: [moveId], gender: 'M' });
  const vaporeon = mon(rules, { species: 'Vaporeon', moves: ['splash'] });
  if (mode === 'singles') return battleOf(rules.singles, [attacker], [vaporeon], seed);
  const p1 = [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })];
  const p2 = [vaporeon, mon(rules, { species: 'Vaporeon', moves: ['splash'] })];
  if (!vgc) return battleOf(rules.doubles!, p1, p2, seed);
  const bench = ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'].map(species => mon(rules, { species, moves: ['splash'] }));
  const battle = new SimBattle({
    formatid: toID(rules.doubles!), seed,
    p1: { name: 'Alpha', team: Teams.pack([...p1, ...bench]) }, p2: { name: 'Beta', team: Teams.pack([...p2, ...bench]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 123456');
    battle.choose('p2', 'team 123456');
  }
  return battle;
}

/** A body locked into the second turn of a charge move takes no target: the simulator refuses one. */
export function sweepClicks(mode: Mode, target: string, locked = false): { p1: string; p2: string } {
  if (mode === 'singles') return { p1: 'move 1', p2: 'move 1' };
  return { p1: `move 1${NEEDS_AIM.has(target) && !locked ? ' 1' : ''}, move 1`, p2: 'move 1, move 1' };
}

export function sweepTargets(mode: Mode, target: string): string[] {
  if (mode === 'singles') return ['p2a'];
  if (target === 'allAdjacentFoes' || target === 'randomNormal' || target === 'scripted') return ['p2a', 'p2b'];
  if (target === 'allAdjacent') return ['p2a', 'p2b', 'p1b'];
  return ['p2a'];
}

export const picksOne = (target: string): boolean => target === 'randomNormal' || target === 'scripted';

export const isCharge = (move: DexMove): boolean => !!move.flags.charge;

export const isDelayed = (move: DexMove): boolean => !!move.flags.futuremove;

/** A move with an unmet condition (Belch before a berry is eaten) is disabled and its click refused. */
export function clicksAccepted(board: Battle, clicks: { p1: string; p2: string }): boolean {
  const probe = copyOf(board);
  probe.prng ??= board.prng.clone();
  return probe.choose('p1', clicks.p1) && probe.choose('p2', clicks.p2);
}

export function forcedOn(board: Battle, clicks: { p1: string; p2: string }, forced: ForcedDie[]): { report: DiceReport; battle: Battle; start: number } {
  const live = copyOf(board);
  // the speed layer's copy leaves the stream to its asker
  live.prng ??= board.prng.clone();
  const start = live.log.length;
  const report = playForcedTurn({ live, forced, play: battle => playClicks(battle, clicks) });
  return { report, battle: live, start };
}

export const dieOf = (moveId: string, targetSlot: string, kind: DieName['kind']): DieName => ({ slot: 'p1a', moveId, targetSlot, kind });

export const turnLines = (battle: Battle, start: number, prefix: string): string[] => battle.log.slice(start).filter(line => line.startsWith(prefix));

const slotOfIdent = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

/** Gens 3 and up name the target on a `|-miss|` line, Gens 1 and 2 only the user (so every miss counts there). */
export const missesOf = (battle: Battle, start: number, slot: string): number =>
  turnLines(battle, start, '|-miss|').filter(line => { const target = line.split('|')[3]; return target === undefined || slotOfIdent(target) === slot; }).length;

export const critsOf = (battle: Battle, start: number, slot: string): number =>
  turnLines(battle, start, '|-crit|').filter(line => slotOfIdent(line.split('|')[2]) === slot).length;

export const explained = (reason: string | undefined): boolean =>
  !!reason && /did not use|did not run|did nothing|lands two turns later|shows "|always crits|cannot miss|removed the secondary|fixed hit count|no stall draw/.test(reason);

export interface Tally { cases: number; applied: number; blocked: number; noChance: number; noDraw: number; bad: string[]; unexercised: string[] }
export const newTally = (): Tally => ({ cases: 0, applied: 0, blocked: 0, noChance: 0, noDraw: 0, bad: [], unexercised: [] });

export function monOf(battle: Battle, slot: string): Pokemon {
  return battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
}

/** A crit chance of 1 in 16 draws `random(16)` too, so the damage roll is told by its script call (Gens 3 and up). */
export function damageAtRaw(board: Battle, clicks: { p1: string; p2: string }, slot: string, raw: number): number {
  const shape = genShape(board.gen).roll;
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  const natural = battle.prng;
  let inRandomizer = false;
  const original = (battle as unknown as { randomizer(...args: unknown[]): unknown }).randomizer;
  (battle as unknown as { randomizer: unknown }).randomizer = function (this: unknown, ...args: unknown[]) {
    inRandomizer = true;
    try {
      return original.apply(this, args);
    } finally {
      inRandomizer = false;
    }
  };
  battle.prng = new (class extends PRNG {
    override random(from?: number, to?: number): number {
      const value = natural.random(from, to);
      const isRoll = shape.scope === 'randomizer' ? inRandomizer : from === shape.from && to === shape.to;
      return isRoll ? raw : value;
    }
  })(natural.getSeed());
  playClicks(battle, clicks);
  const target = monOf(battle, slot);
  return target.maxhp - target.hp;
}

export interface SecondaryEntry {
  chance?: number;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
  self?: { boosts?: Record<string, number>; volatileStatus?: string };
}

const linesOf = (battle: Battle, start: number): string[][] => battle.log.slice(start).map(line => line.split('|'));
const slotIn = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

function boostShown(rows: string[][], slot: string, stats: string[]): boolean {
  return rows.some(row => (row[1] === '-boost' || row[1] === '-unboost') && slotIn(row[2]) === slot && stats.includes(row[3]));
}

export function effectShown(battle: Battle, start: number, entry: SecondaryEntry, targetSlot: string, userSlot: string): boolean {
  const rows = linesOf(battle, start);
  if (entry.status) return rows.some(row => row[1] === '-status' && slotIn(row[2]) === targetSlot && row[3] === entry.status);
  if (entry.volatileStatus === 'flinch') return rows.some(row => row[1] === 'cant' && slotIn(row[2]) === targetSlot && row[3] === 'flinch');
  if (entry.volatileStatus) return rows.some(row => row[1] === '-start' && slotIn(row[2]) === targetSlot);
  if (entry.boosts) return boostShown(rows, targetSlot, Object.keys(entry.boosts));
  if (entry.self?.boosts) return boostShown(rows, userSlot, Object.keys(entry.self.boosts));
  if (entry.self?.volatileStatus) return rows.some(row => row[1] === '-start' && slotIn(row[2]) === userSlot);
  return rows.some(row => (row[1] === '-status' || row[1] === '-start') && slotIn(row[2]) === targetSlot);
}

export function outfitBoard(
  rules: Rules, mode: Mode, a: { species: string; moves: string[]; item?: string; ability?: string }, t: { species: string; item?: string; ability?: string },
): Battle {
  const attacker = set(a.species, a.moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), gender: 'M', item: a.item ?? '', ability: a.ability ?? 'No Ability' });
  const foe = set(t.species, ['splash'], { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), gender: 'F', item: t.item ?? '', ability: t.ability ?? 'No Ability' });
  if (mode === 'singles') return battleOf(rules.singles, [attacker], [foe]);
  return battleOf(
    rules.doubles!, [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Chansey', moves: ['splash'] })],
  );
}

export function effectLog(battle: Battle): string {
  return stableLog(battle).split('\n').map(line => {
    if (!line.startsWith('|move|')) return line;
    const fields = line.split('|');
    return AIM_FREE_TARGETS.has(battle.dex.moves.get(fields[3]).target) ? [...fields.slice(0, 4), ...fields.slice(5)].join('|') : line;
  }).join('\n');
}

/** From Gen 5 the end-of-turn damage of bodies of one speed is shuffled: two poison ticks may swap places. */
export function sameEffects(a: Battle, b: Battle): boolean {
  const left = effectLog(a);
  const right = effectLog(b);
  if (left === right) return true;
  const sorted = (log: string): string => log.split('\n').sort().join('\n');
  const bodies = (battle: Battle): string => JSON.stringify(battle.sides.map(side => side.pokemon.map(body => [body.hp, body.status, body.item, body.ability, Object.keys(body.volatiles), body.boosts])));
  return sorted(left) === sorted(right) && bodies(a) === bodies(b);
}
