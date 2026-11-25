import { toId, type RulesDex } from '@fulllifegames/replay-core';


/** The effect a move line names after `[from]` (with or without the space), as written; undefined without one. */
export function moveLineSource(line: string): string | undefined {
  const field = line.split('|').slice(5).find(part => part.startsWith('[from]'));
  return field?.slice('[from]'.length).trim() || undefined;
}

const volatilesByDex = new WeakMap<RulesDex, ReadonlySet<string>>();

// The ids of every volatile a Dex move sets on a body: the states that can relay a move (Magic Coat, Snatch) or lock.
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

// True for an Ability and a Dex move's volatile without `onLockMove`; false for `move:`, `item:` and bare move names.
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
