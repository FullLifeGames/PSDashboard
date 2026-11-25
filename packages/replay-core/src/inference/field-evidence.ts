import { conditionTurns, startsForGood } from '../dex-facts/screen-turns.ts';
import { terrainConditions } from '../dex-facts/index.ts';
import { Protocol } from '@pkmn/protocol';
import { toId } from '../ids.ts';
import { dexOf } from '../rules-dex.ts';
import type { InferrerState } from './inferrer-state.ts';
import { arg, fromEffect, hasKw, keyOf, ofIdent, type LogLine } from './log-line.ts';
import { judge, type Interval } from './screen-evidence.ts';

// Design: EVALUATION.md "Rule-outs".

type Kind = 'weather' | 'terrain';

export interface FieldWatch {
  turn: number;
  /** Bare `|` lines since the turn line: the first is the turn's header, the second opens the residual phase. */
  bars: number;
  upkept: boolean;
  open: Map<Kind, { id: string; interval: Interval }>;
}

const newWatch = (): FieldWatch => ({ turn: 0, bars: 0, upkept: false, open: new Map() });

function setsField(state: InferrerState, moveName: string, id: string): boolean {
  const move = dexOf(state).moves.get(moveName);
  const field = move.exists ? move.weather ?? move.terrain : undefined;
  return !!field && toId(field) === id;
}

const inResidual = (watch: FieldWatch): boolean => watch.turn >= 1 && !watch.upkept && watch.bars >= 2;

function setterOf(state: InferrerState, id: string, line: LogLine): string | null {
  const from = fromEffect(line);
  if (from.type === 'ability') {
    const holder = ofIdent(line);
    return holder && !startsForGood(dexOf(state), id, from.name) ? holder : null;
  }
  const move = state.screenWatch?.move;
  return hasKw(line, 'from') || !move || move.from || !setsField(state, move.name, id) ? null : move.ident;
}

// A start before the first turn (a lead's ability) or after `|upkeep|` (a replacement's) counts from the next turn.
function intervalOf(state: InferrerState, watch: FieldWatch, id: string, line: LogLine): Interval | null {
  const table = conditionTurns(dexOf(state), id);
  if (!table || table.byItem.size === 0 || inResidual(watch) || hasKw(line, 'silent')) return null;
  const ident = setterOf(state, id, line);
  if (!ident) return null;
  const items = state.itemWatch;
  const key = keyOf(ident);
  return {
    turn: watch.turn === 0 || watch.upkept ? watch.turn + 1 : watch.turn, ident, key, table,
    doubt: !items || items.items.has(key),
    blocked: !items || items.embargoed.has(key) || items.magicRoom,
  };
}

// A new start replaces its kind (a replaced terrain logs no end); the same one again (own weather) keeps the count.
function onStart(state: InferrerState, watch: FieldWatch, kind: Kind, id: string, line: LogLine) {
  if (watch.open.get(kind)?.id === id) return;
  watch.open.delete(kind);
  const interval = intervalOf(state, watch, id, line);
  if (interval) watch.open.set(kind, { id, interval });
}

function onEnd(state: InferrerState, watch: FieldWatch, kind: Kind, id: string | null) {
  const open = watch.open.get(kind);
  if (!open) return;
  watch.open.delete(kind);
  if (id !== null && id !== open.id) return;
  if (inResidual(watch)) judge(state, open.interval, watch.turn - open.interval.turn + 1);
}

/** Call it after `watchScreenEvidence` (it updates the latest move line this reads) and `watchItemEvidence`. */
export function watchFieldEvidence(state: InferrerState, line: LogLine) {
  const watch = (state.fieldWatch ??= newWatch());
  if (line.cmd === 'turn') {
    watch.turn = Number(arg(line, 1)) || 0;
    watch.bars = 0;
    watch.upkept = false;
  } else if (line.cmd === 'done') watch.bars++;
  else if (line.cmd === 'upkeep') watch.upkept = true;
  if (line.cmd === '-weather') {
    if (hasKw(line, 'upkeep')) return;
    const id = toId(arg(line, 1));
    if (id === 'none') onEnd(state, watch, 'weather', null);
    else onStart(state, watch, 'weather', id, line);
    return;
  }
  if (line.cmd !== '-fieldstart' && line.cmd !== '-fieldend') return;
  const id = toId(Protocol.parseEffect(arg(line, 1)).name);
  if (!terrainConditions(dexOf(state)).has(id)) return;
  if (line.cmd === '-fieldstart') onStart(state, watch, 'terrain', id, line);
  else onEnd(state, watch, 'terrain', id);
}
