/**
 * Protocol-truth Choice locks (round 2, agenda item ③). The active
 * correction deletes `choicelock` as a divergence defense (the Vileplume
 * tricked-scarf story) — these helpers re-derive the TRUE lock from the
 * replay text so honest locks survive: sim artifacts cannot re-enter
 * because nothing here reads sim history.
 */

import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation } from '../types';
import { CHOICE_ITEMS } from './eval/sensitivity';
import { typedHiddenPowerId } from './hidden-power';
import { inferOpponentTeam } from './opponent-inferrer';

export interface ProtocolLock { species: string; moveId: string }
export interface TrailState { species: string; moves: string[]; itemDisturbed: boolean }
export type ChoiceLockTrails = Record<'p1' | 'p2', Map<number, TrailState | null>>;

const toId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * One forward walk over the log; the state AT each `|turn|N` marker is the
 * trail for turn N's position (moves the CURRENT active committed since its
 * last real entry, and whether its item was touched in that span).
 */
export function buildChoiceLockTrails(replayLog: string): ChoiceLockTrails {
  const trails: ChoiceLockTrails = { p1: new Map(), p2: new Map() };
  const current: Record<'p1' | 'p2', TrailState | null> = { p1: null, p2: null };
  for (const line of replayLog.split('\n')) {
    const entry = line.match(/^\|(?:switch|drag)\|(p[12])[a-d]?:[^|]*\|([^,|]+)/);
    if (entry) {
      current[entry[1] as 'p1' | 'p2'] = { species: entry[2].trim(), moves: [], itemDisturbed: false };
      continue;
    }
    const move = line.match(/^\|move\|(p[12])[a-d]?:/);
    if (move) {
      const state = current[move[1] as 'p1' | 'p2'];
      const moveId = toId(line.split('|')[3] ?? '');
      if (state && moveId && !state.moves.includes(moveId)) state.moves.push(moveId);
      continue;
    }
    const item = line.match(/^\|-(?:item|enditem)\|(p[12])[a-d]?:/);
    if (item) {
      const state = current[item[1] as 'p1' | 'p2'];
      if (state) state.itemDisturbed = true;
      continue;
    }
    const turn = line.match(/^\|turn\|(\d+)/);
    if (turn) {
      const n = parseInt(turn[1], 10);
      trails.p1.set(n, current.p1 ? { ...current.p1, moves: [...current.p1.moves] } : null);
      trails.p2.set(n, current.p2 ? { ...current.p2, moves: [...current.p2.moves] } : null);
    }
  }
  return trails;
}

/** The one-distinct-move rule: exactly one committed move, item untouched. */
export function protocolChoiceLock(
  trails: ChoiceLockTrails, side: 'p1' | 'p2', turn: number,
): ProtocolLock | null {
  const state = trails[side].get(turn);
  if (!state || state.itemDisturbed || state.moves.length !== 1) return null;
  return { species: state.species, moveId: state.moves[0] };
}

export type ItemCorroboration = 'corroborated' | 'contradicted' | 'ambiguous';

/** HP-bar reading slack — mirrors spread-inference's tolerance. */
const OBSERVATION_SLACK = 0.02;

/** The ×1.2 bluff items a big hit could hide behind (user: Mystic Water). */
const TYPE_BOOST_ITEMS: Record<string, string> = {
  Water: 'Mystic Water', Fire: 'Charcoal', Electric: 'Magnet', Grass: 'Miracle Seed',
  Ice: 'Never-Melt Ice', Fighting: 'Black Belt', Poison: 'Poison Barb', Ground: 'Soft Sand',
  Flying: 'Sharp Beak', Psychic: 'Twisted Spoon', Bug: 'Silver Powder', Rock: 'Hard Stone',
  Ghost: 'Spell Tag', Dragon: 'Dragon Fang', Dark: 'Black Glasses', Steel: 'Metal Coat',
  Normal: 'Silk Scarf',
};

/**
 * The user's rule (spec 1c): a merely GUESSED Choice item must survive a
 * damage check before it may justify a lock. Per observation the hypothesis
 * whose roll range (± slack) contains the observed fraction explains it;
 * corroborated = some observation ONLY the Choice item explains and none
 * only a rival explains; contradicted = some observation the Choice item
 * CANNOT explain; everything else ambiguous (evidence never blocks by
 * absence).
 */
export function corroborateChoiceItem(
  side: 'p1' | 'p2',
  species: string,
  item: string,
  teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] },
  observations: DamageObservation[],
  genNum: number,
): ItemCorroboration {
  const gen = Generations.get(Math.min(9, Math.max(1, genNum)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
  const speciesId = toId(species);
  const attackerSet = (side === 'p1' ? teams.p1Team : teams.p2Team)
    .find(candidate => toId(candidate.species) === speciesId);
  if (!attackerSet) return 'ambiguous';
  let sawChoiceOnly = false;
  for (const obs of observations) {
    if (obs.attackerSide !== side || toId(obs.attackerSpecies) !== speciesId) continue;
    const defenderTeam = side === 'p1' ? teams.p2Team : teams.p1Team;
    const defenderSet = defenderTeam.find(candidate => toId(candidate.species) === toId(obs.defenderSpecies));
    // Typeless "hiddenpower" calcs as the set's resolved variant (same seam
    // as spread-inference — the IV-default type would judge with wrong rolls).
    const calcMoveId = obs.moveId === 'hiddenpower'
      ? typedHiddenPowerId(attackerSet.moves) ?? obs.moveId
      : obs.moveId;
    const explains = (withItem: string): boolean | null => {
      try {
        const attacker = new Pokemon(gen, attackerSet.species, {
          level: attackerSet.level || 100, ability: attackerSet.ability || undefined,
          item: withItem || undefined, nature: attackerSet.nature, evs: attackerSet.evs,
          ivs: attackerSet.ivs, boosts: obs.attackerBoosts,
          status: (obs.attackerStatus || undefined) as never,
        });
        const defender = new Pokemon(gen, defenderSet?.species ?? obs.defenderSpecies, {
          level: defenderSet?.level || 100, nature: defenderSet?.nature,
          evs: defenderSet?.evs, ivs: defenderSet?.ivs, boosts: obs.defenderBoosts,
        });
        const result = calculate(gen, attacker, defender, new Move(gen, calcMoveId), new Field({}));
        const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
        const maxHp = defender.maxHP();
        if (rolls.length === 0 || maxHp <= 0) return null;
        const min = Math.min(...rolls) / maxHp - OBSERVATION_SLACK;
        const max = Math.max(...rolls) / maxHp + OBSERVATION_SLACK;
        return obs.observedFraction >= min && obs.observedFraction <= max;
      } catch {
        return null; // Unknown move/species for this gen: cannot judge.
      }
    };
    const moveType = (() => {
      try { return new Move(gen, calcMoveId).type; } catch { return undefined; }
    })();
    const bluff = moveType ? TYPE_BOOST_ITEMS[moveType] : undefined;
    const choiceFits = explains(item);
    if (choiceFits === null) continue;
    const rivalFits = [explains(''), ...(bluff ? [explains(bluff)] : [])].some(fit => fit === true);
    if (!choiceFits) {
      if (rivalFits) return 'contradicted';
      continue; // Nothing explains it (crit slack, unknown context) — cannot judge.
    }
    if (!rivalFits) sawChoiceOnly = true;
  }
  return sawChoiceOnly ? 'corroborated' : 'ambiguous';
}

export interface ChoiceLockContext {
  trails: ChoiceLockTrails;
  /** speciesId -> may this mon's (choice) item justify a lock stamp? */
  eligibility: Record<'p1' | 'p2', Record<string, boolean>>;
}

/**
 * Assembled once per game: trails from the log, eligibility from the built
 * teams — a revealed/manual choice item is trusted, a guessed one must not
 * be CONTRADICTED by the damage record (spec 1c; ambiguity never blocks).
 */
export function buildChoiceLockContext(
  replayLog: string,
  teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] },
  observations: DamageObservation[],
): ChoiceLockContext {
  const genNum = parseInt(replayLog.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10);
  const eligibility: ChoiceLockContext['eligibility'] = { p1: {}, p2: {} };
  for (const side of ['p1', 'p2'] as const) {
    const info = inferOpponentTeam(replayLog, side);
    const team = side === 'p1' ? teams.p1Team : teams.p2Team;
    for (const built of team) {
      const speciesId = toId(built.species);
      if (!CHOICE_ITEMS.has(toId(built.item ?? ''))) continue;
      const revealed = info.pokemon.find(mon => toId(mon.species) === speciesId);
      const proven = revealed?.item.source === 'revealed' || revealed?.item.source === 'manual';
      eligibility[side][speciesId] = proven ||
        corroborateChoiceItem(side, built.species, built.item, teams, observations, genNum) !== 'contradicted';
    }
  }
  return { trails: buildChoiceLockTrails(replayLog), eligibility };
}
