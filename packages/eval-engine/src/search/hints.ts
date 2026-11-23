import type { BoostsTable, Pokemon } from '@pkmn/sim';
import { boostedFraction, pairThreat, singleMoveFraction } from '../eval-function.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { forkBattle } from '../forward/position.ts';
import { bodyAsClicked } from '../calc/tera-click.ts';
import { RULE_MOVES } from '../move-use.ts';
import { shieldsFromHits, shieldsSide } from '../dex-facts/protect.ts';
import { sideIndex } from '@fulllifegames/replay-core';
import { bodyInView, callHandler, guarded, isolated, protectorStops } from '../sim-ask/index.ts';

/** Static per-option threat hints: candidate restriction ranks with them and the MCTS expansion order reuses them. */

export const isCombined = (options: ChoiceOption[]) => options.some(option => option.choice.includes(','));

/** Floor hint for any status move: Protect, redirection, speed control stay rankable. */
const SUPPORT_HINT = 0.25;
/** Fake Out on the turn it works: damage plus one neutralized foe action. */
const FLINCH_BONUS = 0.3;
/**
 * A KO that only the two attacks together make (or that a Protect denies the foes) takes one action off the board, as a flinch does.
 * A side protector (Wide Guard, Quick Guard) and a Protect earn the damage they deny, up to this much.
 */
const PAIR_KO_BONUS = FLINCH_BONUS;
const SETUP_HORIZON = 2;
/** Spread moves hit both foes, at the doubles spread penalty. */
const SPREAD_FACTOR = 0.75;

const clampStage = (stage: number) => Math.max(-6, Math.min(6, stage));

interface HintBoard {
  position: SimPosition;
  side: 'p1' | 'p2';
  battle: ReturnType<typeof positionBattle>;
  sideState: ReturnType<typeof positionBattle>['sides'][number];
  foeActives: (Pokemon | null)[];
  foes: Pokemon[];
  actors: Pokemon[];
}

function hintBoard(position: SimPosition, side: 'p1' | 'p2', battle = positionBattle(position)): HintBoard {
  const sideState = battle.sides[sideIndex(side)];
  const foeActives = sideState.foe.active;
  const foes = foeActives.filter((foe): foe is Pokemon => !!foe && !foe.fainted);
  const actors = sideState.active.filter((active): active is Pokemon => !!active && !active.fainted);
  return { position, side, battle, sideState, foeActives, foes, actors };
}

type HintDex = HintBoard['battle']['dex'];
type DexMove = ReturnType<HintDex['moves']['get']>;

/**
 * A self-targeted move whose volatile carries the redirect handler (Follow Me, Rage Powder); test/doubles-pair-hints.spec.ts plays
 * every self-targeted move against this reading.
 */
export function redirectsFoes(dex: HintDex, move: DexMove): boolean {
  return move.target === 'self' && !!move.volatileStatus && 'onFoeRedirectTarget' in dex.conditions.get(move.volatileStatus);
}

/**
 * The moves that stop the hits on their user (Protect, Detect and their kin) or on its whole side (Wide Guard, Quick Guard, Crafty
 * Shield, Mat Block), by the one Protect predicate of dex-facts/protect.ts; test/side-protector-hints.spec.ts and
 * test/protect-tempo-hints.spec.ts play the moves against these readings.
 */
export { shieldsFromHits, shieldsSide };

export { protectorStops };

const STAGES = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const;

/**
 * The stages a status move gives its user, as the simulator applies them: `self.boosts` always land on the user, the move's own
 * `boosts` on its targets, and the user is among them only for the target classes 'self' and 'allies' (the simulator's
 * alliesAndSelf). Swagger and Decorate raise the target, Coaching the ally: none of them is the user's setup.
 * test/setup-equity.spec.ts plays every Dex move with stages in the simulator against this reading.
 */
export function ownStages(move: DexMove): Partial<BoostsTable> | null {
  const onUser = move.target === 'self' || move.target === 'allies' ? move.boosts : null;
  const self = move.self?.boosts;
  if (!onUser && !self) return null;
  const stages: Partial<BoostsTable> = {};
  for (const stat of STAGES) {
    const stage = (onUser?.[stat] ?? 0) + (self?.[stat] ?? 0);
    if (stage) stages[stat] = stage;
  }
  return Object.keys(stages).length > 0 ? stages : null;
}

/**
 * Damage-fraction gain a self-boosting move would buy over SETUP_HORIZON turns. Every stage a damage fraction reads counts, and
 * only the user's own: Iron Defense buys a Body Press carrier its Defense, Calm Mind and Agility buy a Stored Power carrier its
 * power (boostedFraction reads PairThreat.axes); a stage no move of the carrier reads changes no fraction.
 */
function setupEquity(board: HintBoard, attacker: Pokemon, moveId: string): number {
  const { battle, foes } = board;
  const boosts = ownStages(battle.dex.moves.get(moveId));
  if (!boosts) return 0;
  const stages: Partial<BoostsTable> = {};
  for (const stat of STAGES) stages[stat] = clampStage(attacker.boosts[stat] + (boosts[stat] ?? 0));
  let equity = 0;
  for (const foe of foes) {
    const threat = pairThreat(attacker, foe, battle);
    const now = boostedFraction(threat, attacker, foe);
    const then = boostedFraction(threat, attacker, foe, stages);
    equity = Math.max(equity, (then - now) * SETUP_HORIZON);
  }
  return equity;
}

function switchHint(board: HintBoard, tokens: string[]): number {
  const { battle, sideState, foes } = board;
  const candidate = sideState.pokemon[parseInt(tokens[1], 10) - 1];
  if (!candidate || foes.length === 0) return 0;
  return Math.max(...foes.map(foe =>
    boostedFraction(pairThreat(candidate, foe, battle), candidate, foe) -
    boostedFraction(pairThreat(foe, candidate, battle), foe, candidate)));
}

/**
 * A Tera option is hinted on the terastallized body: its STAB, Tera Blast and the 60-power floor follow the Tera type. The body is
 * set terastallized for the call and restored, as speed.ts effectiveSpeed does.
 */
function asClicked<T>(attacker: Pokemon, clicked: boolean, ask: () => T): T {
  if (!clicked || attacker.terastallized || !attacker.teraType) return ask();
  attacker.terastallized = attacker.teraType;
  try {
    return ask();
  } finally {
    attacker.terastallized = undefined;
  }
}

interface ClickedTwin {
  battle: ReturnType<typeof positionBattle>;
  mon: Pokemon;
  board: HintBoard | null;
}

/**
 * The body the simulator makes at a Tera click that changes the forme (Terapagos-Terastal into Terapagos-Stellar with its other
 * stats, HP and type; Ogerpon into its Tera forme with Embody Aspect), which the flag in asClicked cannot give. calc/tera-click.ts
 * says whether the click changes the forme; the twin is a fork of the position whose body the simulator's own terastallize ran
 * on, kept per body (the position never changes and is never written). A click that keeps the forme returns null.
 */
const clickedTwins = new WeakMap<Pokemon, ClickedTwin | null>();

function clickedTwin(position: SimPosition, side: 'p1' | 'p2', mon: Pokemon): ClickedTwin | null {
  let twin = clickedTwins.get(mon);
  if (twin === undefined) {
    twin = formeClick(position, side, mon);
    clickedTwins.set(mon, twin);
  }
  return twin;
}

function formeClick(position: SimPosition, side: 'p1' | 'p2', mon: Pokemon): ClickedTwin | null {
  if (mon.terastallized || !mon.teraType) return null;
  const battle = positionBattle(position);
  if (bodyAsClicked(battle, mon, true).species === mon.species.name) return null;
  const fork = forkBattle(position, '1,2,3,4');
  const twinMon = fork.sides[sideIndex(side)].pokemon[battle.sides[sideIndex(side)].pokemon.indexOf(mon)];
  fork.actions.terastallize(twinMon);
  return { battle: fork, mon: twinMon, board: null };
}

function twinBoard(twin: ClickedTwin, position: SimPosition, side: 'p1' | 'p2'): HintBoard {
  twin.board ??= hintBoard(position, side, twin.battle);
  return twin.board;
}

/**
 * The target the move has at use: its own onModifyMove, asked from the
 * simulator for the moves whose rule at use is known (RULE_MOVES), on the
 * body that uses it. Tera Starstorm of a Terapagos-Stellar hits both foes.
 */
function targetAtUse(board: HintBoard, attacker: Pokemon, move: DexMove, victim: Pokemon | undefined = board.foes[0]): DexMove['target'] {
  const handler = RULE_MOVES.has(move.id) ? (move as { onModifyMove?: unknown }).onModifyMove : undefined;
  if (typeof handler !== 'function') return move.target;
  const { battle } = board;
  const active = battle.dex.getActiveMove(move.id);
  const view = isolated(battle);
  const answered = guarded(battle, [move], () =>
    callHandler(handler as (this: unknown, move: unknown, user: Pokemon, target: Pokemon | undefined) => void, view,
      [active, bodyInView(view, attacker), victim && bodyInView(view, victim)]));
  return answered.ok ? active.target : move.target;
}

/**
 * The damage a protector denies the `covered` bodies: per known damaging move of a foe, as it lands (target at use, a spread hit
 * at the spread factor), the damage on the covered bodies whose hit the protector's handler stops, each capped at the body's HP.
 * The sum over the bodies for a spread hit, the larger one for a single-target hit (the foe aims it at one); the most any move of
 * a foe denies. A side protector covers the whole side: Wide Guard answers the spread attacker, Quick Guard the priority move,
 * Crafty Shield (status only) no damage. A Protect covers its user alone and stops every hit whose move carries the flag its
 * handler checks.
 */
function deniedDamage(board: HintBoard, protector: DexMove, covered: Pokemon[]): number {
  const { battle, foes } = board;
  let most = 0;
  for (const foe of foes) {
    for (const slot of foe.moveSlots) {
      const move = battle.dex.moves.get(slot.id);
      if (slot.pp <= 0 || slot.disabled || !move.exists || move.category === 'Status') continue;
      let summed = 0;
      let largest = 0;
      let spread = false;
      for (const body of covered) {
        const attack = battle.dex.getActiveMove(move.id);
        attack.target = targetAtUse(board, foe, move, body);
        if (!protectorStops(battle, protector, attack, foe, body)) continue;
        spread = attack.target === 'allAdjacentFoes' || attack.target === 'allAdjacent';
        const denied = Math.min(singleMoveFraction(foe, body, move.id, battle) * (spread ? SPREAD_FACTOR : 1), body.hp / body.maxhp);
        summed += denied;
        largest = Math.max(largest, denied);
      }
      most = Math.max(most, spread ? summed : largest);
    }
  }
  return most;
}

interface PartRead {
  hint: number;
  foeSlot: number;
  foeHp: number;
  damage: number;
  attack: number;
  redirect: boolean;
  tempo: number;
}

const plainRead = (hint: number): PartRead => ({ hint, foeSlot: 0, foeHp: 0, damage: 0, attack: 0, redirect: false, tempo: 0 });

function pairOnlyKo(board: HintBoard, mon: Pokemon): boolean {
  const hits = board.foes.map(foe => boostedFraction(pairThreat(foe, mon, board.battle), foe, mon));
  const hp = mon.hp / mon.maxhp;
  return hits.length > 1 && hits.every(hit => hit < hp) && hits.reduce((sum, hit) => sum + hit, 0) >= hp;
}

function moveHint(board: HintBoard, tokens: string[], partIndex: number): PartRead {
  const attacker = board.actors[partIndex];
  if (!attacker || board.foes.length === 0) return plainRead(0);
  const clicks = tokens.includes('terastallize');
  const twin = clicks ? clickedTwin(board.position, board.side, attacker) : null;
  if (twin) return moveHintOf(twinBoard(twin, board.position, board.side), tokens, twin.mon);
  return asClicked(attacker, clicks, () => moveHintOf(board, tokens, attacker));
}

function moveHintOf(board: HintBoard, tokens: string[], attacker: Pokemon): PartRead {
  const { battle, foes } = board;
  const move = battle.dex.moves.get(tokens[1]);
  if (move.category === 'Status') {
    const read = plainRead(Math.max(SUPPORT_HINT, setupEquity(board, attacker, tokens[1])));
    read.redirect = redirectsFoes(battle.dex, move);
    // A Protect earns the damage it denies its user, up to the flinch-sized ceiling; a KO that only the pair can make keeps the whole
    // ceiling.
    if (shieldsFromHits(battle.dex, move)) read.tempo = pairOnlyKo(board, attacker) ? PAIR_KO_BONUS : Math.min(PAIR_KO_BONUS, deniedDamage(board, move, [attacker]));
    if (shieldsSide(battle.dex, move)) read.tempo = Math.min(PAIR_KO_BONUS, deniedDamage(board, move, board.actors));
    return read;
  }
  const target = targetAtUse(board, attacker, move);
  if (target === 'allAdjacentFoes' || target === 'allAdjacent') {
    const spread = foes.reduce((sum, foe) => sum + singleMoveFraction(attacker, foe, tokens[1], battle), 0) * SPREAD_FACTOR;
    return { ...plainRead(spread), attack: spread };
  }
  const targetLoc = tokens.length > 2 ? parseInt(tokens[2], 10) : NaN;
  // A move aimed at the own partner (Pollen Puff's heal, a U-turn into it) is support, not foe damage.
  if (targetLoc < 0) return plainRead(SUPPORT_HINT);
  return aimedRead(board, tokens, attacker, targetLoc);
}

function aimedRead(board: HintBoard, tokens: string[], attacker: Pokemon, targetLoc: number): PartRead {
  const { battle, foeActives, foes } = board;
  let damage: number;
  let foe: Pokemon | undefined;
  if (Number.isFinite(targetLoc) && targetLoc > 0) {
    const aimed = foeActives[targetLoc - 1];
    foe = aimed && !aimed.fainted ? aimed : undefined;
    damage = foe ? singleMoveFraction(attacker, foe, tokens[1], battle) : 0;
  } else {
    damage = Math.max(...foes.map(each => singleMoveFraction(attacker, each, tokens[1], battle)));
    if (foes.length === 1) foe = foes[0];
  }
  const hint = tokens[1] === 'fakeout' && attacker.activeMoveActions === 0 ? damage + FLINCH_BONUS : damage;
  const read: PartRead = { ...plainRead(hint), attack: hint };
  if (foe) {
    read.foeSlot = foeActives.indexOf(foe) + 1;
    read.foeHp = foe.hp / foe.maxhp;
    read.damage = damage;
  }
  return read;
}

function partRead(board: HintBoard, part: string, partIndex: number): PartRead {
  const tokens = part.trim().split(' ');
  if (tokens[0] === 'switch') return plainRead(switchHint(board, tokens));
  if (tokens[0] !== 'move') return plainRead(0);
  return moveHint(board, tokens, partIndex);
}

/**
 * What the two parts of a combined option do together. Two attacks on one foe that only the pair KOs count the KO bonus; a
 * redirection move is priced as the damage of the partner it covers (never below its own hint); a Protect that denies a pair-only
 * KO carries its tempo. Singles options have one part: this never applies there.
 */
function pairTerms(reads: PartRead[]): number {
  if (reads.length !== 2) return 0;
  const [a, b] = reads;
  let extra = a.tempo + b.tempo;
  if (a.redirect) extra += Math.max(0, b.attack - a.hint);
  if (b.redirect) extra += Math.max(0, a.attack - b.hint);
  if (a.foeSlot > 0 && a.foeSlot === b.foeSlot && a.damage > 0 && b.damage > 0) {
    const hp = a.foeHp;
    if (a.damage < hp && b.damage < hp && a.damage + b.damage >= hp) extra += PAIR_KO_BONUS;
  }
  return extra;
}

/**
 * The hint of every part a position has priced, per side and slot: a doubles node ranks some hundred combos built from a few dozen
 * parts. A hint that reads a body on other terms restores it (asClicked, effectiveSpeed), so the position's battle never changes.
 */
const partHints = new WeakMap<SimPosition, Map<string, PartRead>>();

function partMemo(position: SimPosition): Map<string, PartRead> {
  let memo = partHints.get(position);
  if (!memo) {
    memo = new Map();
    partHints.set(position, memo);
  }
  return memo;
}

export function combinedOptionHints(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
): number[] {
  const memo = partMemo(position);
  let board: HintBoard | null = null;
  return options.map(option => {
    const reads = option.choice.split(',').map((part, partIndex) => {
      const key = `${side}:${partIndex}:${part}`;
      let read = memo.get(key);
      if (read === undefined) {
        board ??= hintBoard(position, side);
        read = partRead(board, part, partIndex);
        memo.set(key, read);
      }
      return read;
    });
    return reads.reduce((sum, read) => sum + read.hint, 0) + pairTerms(reads);
  });
}

export function singlesOptionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const opponent = battle.sides[side === 'p1' ? 1 : 0].active[0];
  const active = sideState.active[0];
  const hint = (option: ChoiceOption): number => {
    // The waiting side's sentinel (mid-turn nodes): nothing to rank.
    if (option.choice === 'wait') return 0;
    if (!opponent || opponent.fainted) return 0;
    if (option.choice.startsWith('move ')) {
      if (!active || active.fainted) return 0;
      const clicks = option.choice.endsWith(' terastallize');
      const moveId = option.choice.split(' ')[1];
      const twin = clicks ? clickedTwin(position, side, active) : null;
      if (twin) return singleMoveFraction(twin.mon, twin.battle.sides[side === 'p1' ? 1 : 0].active[0], moveId, twin.battle);
      return asClicked(active, clicks, () => singleMoveFraction(active, opponent, moveId, battle));
    }
    const slot = parseInt(option.choice.split(' ')[1], 10);
    const candidate = sideState.pokemon[slot - 1];
    if (!candidate) return 0;
    return boostedFraction(pairThreat(candidate, opponent, battle), candidate, opponent) -
      boostedFraction(pairThreat(opponent, candidate, battle), opponent, candidate);
  };
  return options.map(hint);
}

export function optionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  if (isCombined(options)) return combinedOptionHints(position, side, options);
  return singlesOptionHints(position, side, options);
}
