import { toId, type RulesDex } from '@fulllifegames/replay-core';

/** A `|move|` line that another effect wrote for a body (Magic Bounce, Dancer, Magic Coat, Snatch) is not the body's click. */

/** The effect a move line names after `[from]` (with or without the space), as written; undefined without one. */
export function moveLineSource(line: string): string | undefined {
  const field = line.split('|').slice(5).find(part => part.startsWith('[from]'));
  return field?.slice('[from]'.length).trim() || undefined;
}

const volatilesByDex = new WeakMap<RulesDex, ReadonlySet<string>>();

/** The ids of every volatile a Dex move sets on a body: the states that can relay a move (Magic Coat, Snatch) or lock one. */
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
 * Does another effect own this move line, so that the body's click is a later line of its slot? The simulator writes `|[from] <effect>`
 * when a move runs with a source effect (`@pkmn/sim` battle-actions.js, `useMove`/`runMove`); older logs drop the prefix or the space
 * (`[from]ability: Magic Bounce`, `[from] Magic Coat`). True for an Ability and for a Condition that is the volatile of a Dex move
 * without a lock handler (`onLockMove`: `lockedmove` continues the body's own action). False for a `move:` or `item:` source, a bare
 * move name (`[from]Sleep Talk`) and a Condition that is no body's volatile (Pursuit, the Pledges' side conditions).
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
