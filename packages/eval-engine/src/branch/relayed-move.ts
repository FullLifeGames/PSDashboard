import { toId, type RulesDex } from '@fulllifegames/replay-core';

/**
 * Round 89 (#135): a `|move|` line that another effect wrote for a body is not the body's click. The simulator writes a move line with
 * `|[from] <effect>` when the move runs with a source effect (`@pkmn/sim` battle-actions.js, `useMove`/`runMove`): Magic Bounce and Dancer
 * (an Ability, `ability: <name>`), and the volatile of a move that relays another body's move (Magic Coat, Snatch: a Condition, whose
 * `fullname` is its bare name). A lock continuation (`lockedmove`) and a move that runs early under its own click (Pursuit) write a `[from]`
 * too, and those lines are the body's own action. The rule reads the Dex, never a name: older logs write the Ability or the Condition
 * without its prefix (`[from]ability: Magic Bounce` without the space, `[from] Magic Bounce`, `[from] Magic Coat`).
 */

/** The effect a move line names after `[from]` (with or without the space), as written; undefined when the line has none. */
export function moveLineSource(line: string): string | undefined {
  const field = line.split('|').slice(5).find(part => part.startsWith('[from]'));
  return field?.slice('[from]'.length).trim() || undefined;
}

const volatilesByDex = new WeakMap<RulesDex, ReadonlySet<string>>();

/** The ids of every volatile a Dex move sets on a body, as the Dex lists them: the states that can relay a move (Magic Coat, Snatch) or lock one. */
function moveVolatiles(dex: RulesDex): ReadonlySet<string> {
  let ids = volatilesByDex.get(dex);
  if (!ids) {
    ids = new Set(dex.moves.all().flatMap(move => {
      const volatile = move.volatileStatus ?? move.self?.volatileStatus;
      return volatile ? [toId(volatile)] : [];
    }));
    volatilesByDex.set(dex, ids);
  }
  return ids;
}

/**
 * Does another effect own this move line, so that the body's click is a later line of its slot? True for an Ability (prefixed, or the
 * bare form of older logs) and for a Condition that is the volatile of a Dex move and carries no lock handler (`onLockMove`, which
 * `lockedmove` carries: its continuation is the body's own action). False for a `move:` or `item:` source, a bare move name
 * (`[from]Sleep Talk`), and a Condition that is no body's volatile (Pursuit, the Pledges' side conditions).
 */
export function isRelayedMoveLine(line: string, dex: RulesDex): boolean {
  const source = moveLineSource(line);
  if (!source) return false;
  const colon = source.indexOf(':');
  if (colon >= 0) return toId(source.slice(0, colon)) === 'ability';
  const id = toId(source);
  if (dex.abilities.get(id).exists) return true;
  const condition = dex.conditions.get(id);
  return condition.exists && !('onLockMove' in condition) && moveVolatiles(dex).has(condition.id);
}
