import { PRNG, State } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { evaluatePosition } from './eval-function';

export interface ChoiceOption {
  /** Sim choice string, accepted verbatim by Battle#choose. */
  choice: string;
  label: string;
}

/** An immutable battle position. The serialized string is the identity. */
export interface SimPosition {
  serialized: string;
}

const battleCache = new WeakMap<SimPosition, Battle>();

export function createRootPosition(serializedBattle: string): SimPosition {
  return { serialized: serializedBattle };
}

/** Cached read-only deserialization — never mutate the returned battle. */
export function positionBattle(position: SimPosition): Battle {
  let battle = battleCache.get(position);
  if (!battle) {
    battle = State.deserializeBattle(position.serialized);
    battleCache.set(position, battle);
  }
  return battle;
}

function toPosition(battle: Battle): SimPosition {
  const position: SimPosition = { serialized: JSON.stringify(State.serializeBattle(battle)) };
  battleCache.set(position, battle);
  return position;
}

const choiceKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function sideIndex(side: 'p1' | 'p2'): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}

export function legalChoices(position: SimPosition, side: 'p1' | 'p2'): ChoiceOption[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const request = sideState.activeRequest;
  if (!request || battle.ended) return [];

  const options: ChoiceOption[] = [];
  const active = 'active' in request ? request.active?.[0] : undefined;
  const forced = 'forceSwitch' in request && !!request.forceSwitch?.[0];
  const trapped = !!active && 'trapped' in active && !!active.trapped;

  if (active && !forced) {
    for (const move of active.moves) {
      if ('disabled' in move && move.disabled) continue;
      options.push({ choice: `move ${choiceKey(move.move)}`, label: move.move });
      if ('canTerastallize' in active && active.canTerastallize) {
        options.push({
          choice: `move ${choiceKey(move.move)} terastallize`,
          label: `Tera + ${move.move}`,
        });
      }
    }
  }

  if (forced || !trapped) {
    sideState.pokemon.forEach((pokemon, index) => {
      if (pokemon.isActive || pokemon.fainted) return;
      options.push({ choice: `switch ${index + 1}`, label: `→ ${pokemon.name}` });
    });
  }

  return options;
}

/**
 * Deserializes a fresh copy of the position and seeds its PRNG so the
 * advance is reproducible.
 */
function forkBattle(position: SimPosition, seed: PRNGSeed): Battle {
  const battle = State.deserializeBattle(position.serialized);
  battle.prng = new PRNG(seed);
  return battle;
}

function applyChoice(battle: Battle, side: 'p1' | 'p2', choice: string): void {
  if (!battle.choose(side, choice)) {
    const error = battle.sides[sideIndex(side)].choice.error || 'choice rejected';
    throw new Error(`${side} "${choice}": ${error}`);
  }
}

/**
 * Resolves any open forced-switch requests (mid-turn KOs) by greedily
 * picking the replacement whose entry statically evaluates best for the
 * choosing side. Runs until the battle is back at a turn boundary or over.
 */
function resolveForcedSwitches(battle: Battle, seed: PRNGSeed): void {
  for (let guard = 0; guard < 6; guard++) {
    if (battle.ended) return;
    const pending = battle.sides
      .slice(0, 2)
      .filter(side => side.requestState === 'switch' && !side.isChoiceDone());
    if (pending.length === 0) return;

    const midTurn = JSON.stringify(State.serializeBattle(battle));
    for (const side of pending) {
      const replacements = side.pokemon
        .map((pokemon, index) => ({ pokemon, slot: index + 1 }))
        .filter(({ pokemon }) => !pokemon.isActive && !pokemon.fainted);
      if (replacements.length === 0) continue;

      let best = replacements[0];
      if (replacements.length > 1) {
        const perspective = side.id === 'p1' ? 1 : -1;
        let bestValue = -Infinity;
        for (const candidate of replacements) {
          const trial = State.deserializeBattle(midTurn);
          trial.prng = new PRNG(seed);
          trial.choose(side.id as 'p1' | 'p2', `switch ${candidate.slot}`);
          const value = perspective * evaluatePosition(trial);
          if (value > bestValue) {
            bestValue = value;
            best = candidate;
          }
        }
      }
      applyChoice(battle, side.id as 'p1' | 'p2', `switch ${best.slot}`);
    }
  }
}

/**
 * Advances one full turn under a fixed seed. The returned position is at a
 * normal turn boundary or game end; the input position is never mutated.
 */
export function advancePosition(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
): SimPosition {
  const battle = forkBattle(position, seed);
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  resolveForcedSwitches(battle, seed);
  return toPosition(battle);
}
