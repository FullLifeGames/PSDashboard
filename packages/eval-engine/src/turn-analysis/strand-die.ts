import type { RulesDex } from '@fulllifegames/replay-core';
import { secondaryEffectId } from '../dice/recognize.ts';
import { effectNoun } from '../prose/effect-words.ts';
import { splitCombinedLabel } from './played-match.ts';
import type { Side, StrandDie } from './types.ts';

/**
 * Round 89 (T322, #59), stage 5: the dice a strand class names, as the card says them. A class key is the verify round's key of the
 * cell's outcome class: events joined with `|`, each `<slot>:<move>><slot>=<outcome>` in doubles and the bare outcome in singles
 * (`hit-kill`, `miss`, `hit-nokill+brn`; the events in p1 before p2 order, only the sides that have one). A doubles key names the
 * move; a singles key does not, so the move comes from the side's own choice (the row of the record) and the label of the opponent
 * option (the column), by the Dex: a status move has no event, and an outcome only a move with that die can cause (a miss, an effect
 * in the move's secondaries) leaves one owner. Where two damaging moves both fit, the die is named without a move. Names come from the
 * Dex of the game's rule set.
 */

interface Part { actor?: Side; moveId?: string; outcome: string }

const sideOfSlot = (slot: string): Side | undefined => (slot.startsWith('p1') ? 'p1' : slot.startsWith('p2') ? 'p2' : undefined);

/** The events of a key; `none` (the second mover a kill or a flinch stopped) is no event. */
function partsOf(classKey: string): Part[] {
  return classKey.split('|').map(piece => {
    const at = piece.lastIndexOf('=');
    if (at < 0) return { outcome: piece };
    const [actor, rest] = piece.slice(0, at).split(':');
    const moveId = rest?.split('>')[0];
    return { actor: sideOfSlot(actor ?? ''), ...(moveId ? { moveId } : {}), outcome: piece.slice(at + 1) };
  }).filter(part => part.outcome !== 'none');
}

/** The move id of a singles choice string, or none for a switch. */
function moveIdOfChoice(choice: string): string | undefined {
  const tokens = choice.trim().split(/\s+/);
  return tokens[0] === 'move' && tokens[1] ? tokens[1] : undefined;
}

/** The move id behind an opponent-option label ("Defog", "Tera + Freeze-Dry"); none for a switch or a combo of two slots. */
function moveIdOfLabel(dex: RulesDex, label: string): string | undefined {
  if (label.startsWith('→')) return undefined;
  for (const text of [label, ...splitCombinedLabel(label).slice(-1)]) {
    const move = dex.moves.get(text);
    if (move.exists) return move.id;
  }
  return undefined;
}

type DexMove = ReturnType<RulesDex['moves']['get']>;

/** Whether the move can cause the outcome: a miss needs an accuracy roll, an effect needs the entry among its secondaries, a knockout needs damage. */
function fits(dex: RulesDex, move: DexMove, outcome: string): boolean {
  if (move.category === 'Status') return false;
  const [base, ...rest] = outcome.split('+');
  if (base === 'miss') return move.accuracy !== true;
  const tokens = tokensOf(rest, dex);
  const entries = move.secondaries ?? (move.secondary ? [move.secondary] : []);
  const ids = entries.map(entry => secondaryEffectId(entry));
  return tokens.every(token => ids.includes(token));
}

/**
 * The effect ids of an outcome after its base (`hit-nokill+brn+boosts:atk+def`). The key joins its tokens with `+`, as the ids of a
 * stat change do (`boosts:atk+def`), so a stat of the Dex's own stat names after such an id belongs to it.
 */
function tokensOf(parts: string[], dex: RulesDex): string[] {
  const stats = (dex as unknown as { stats: { names: object } }).stats.names;
  const tokens: string[] = [];
  for (const part of parts) {
    const last = tokens[tokens.length - 1];
    if (last && /^(boosts|self):/.test(last) && (part in stats || part === 'accuracy' || part === 'evasion')) tokens[tokens.length - 1] = `${last}+${part}`;
    else tokens.push(part);
  }
  return tokens;
}

/** The dice of one outcome: a miss, a knockout, one per effect that came true, or the plain hit. */
function diceOf(outcome: string, move: string | undefined, dex: RulesDex): StrandDie[] {
  const named = move ? { move } : {};
  const [base, ...rest] = outcome.split('+');
  const tokens = tokensOf(rest, dex);
  if (base === 'miss') return [{ kind: 'miss', ...named }];
  if (base === 'hit-kill') return [{ kind: 'kill', ...named }];
  if (tokens.length === 0) return [{ kind: 'hit', ...named }];
  return tokens.map(token => ({ kind: 'effect' as const, ...named, effect: effectNoun(dex, token) }));
}

export interface StrandContext {
  /** The graded side. */
  side: Side;
  /** The choice string of the record's row of the strand (the played choice for P, the best for B). */
  ownChoice: string;
  /** The opponent option's label whose column holds the cell. */
  column: string;
}

/** The dice a strand class names; the plain hits drop out where another die of the class is named. */
export function strandDice(dex: RulesDex, classKey: string, context: StrandContext): StrandDie[] {
  const parts = partsOf(classKey);
  const own = moveIdOfChoice(context.ownChoice);
  const foe = moveIdOfLabel(dex, context.column);
  const moveOf = (part: Part, index: number): string | undefined => {
    if (part.moveId) return part.moveId;
    if (part.actor) return undefined;
    if (parts.length > 1) return (index === 0 ? 'p1' : 'p2') === context.side ? own : foe;
    const candidates = [own, foe].filter((id): id is string => !!id && dex.moves.get(id).category !== 'Status');
    if (candidates.length < 2) return candidates[0];
    const matching = candidates.filter(id => fits(dex, dex.moves.get(id), part.outcome));
    return matching.length === 1 ? matching[0] : undefined;
  };
  const dice = parts.flatMap((part, index) => {
    const id = moveOf(part, index);
    const move = id ? dex.moves.get(id) : undefined;
    return diceOf(part.outcome, move?.exists ? move.name : undefined, dex);
  });
  return dice.some(die => die.kind !== 'hit') ? dice.filter(die => die.kind !== 'hit') : dice;
}
