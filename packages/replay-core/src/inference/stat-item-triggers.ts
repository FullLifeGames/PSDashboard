import { dexOf } from '../rules-dex.ts';
import { type InferrerState } from './inferrer-state.ts';
import { ruleOutUnknown } from './item-evidence.ts';
import { arg, fromEffect, hasKw, keyOf, type LogLine } from './log-line.ts';
import { boostAnswers, foeBoostItems, spendsAfterBoost, spendsAfterFoeBoosts, spendsStanding, standingItems, type FoeBoost } from './stat-items.ts';
import { ignoresItem, type TriggerGates } from './item-triggers.ts';

type Stages = Record<string, number>;

interface Landed { holder: string; ident: string; boost: Stages; effect: string; stages: Stages | null; ignored: boolean }

export interface StatWatch {
  slots: Map<string, string>;
  stages: Map<string, Stages | null>;
  effect: string;
  landed: Landed[];
  heard: Map<string, (FoeBoost & { ignored: boolean })[]>;
  passing: Set<string>;
}

export const newStatWatch = (): StatWatch => ({ slots: new Map(), stages: new Map(), effect: '', landed: [], heard: new Map(), passing: new Set() });

const BOUNDARIES = new Set(['move', 'cant', 'switch', 'upkeep', 'turn']);
const MID_ACTION = new Set(['move', 'switch']);
const sideOf = (key: string) => key.slice(0, 2);
const clean = (): Stages => ({});

const ignored = (state: InferrerState, gates: TriggerGates, holder: string, ident: string) => ignoresItem(state, gates, { holder, ident });

const holders = (state: InferrerState, watch: StatWatch) => [...watch.slots.values()].filter(ident => keyOf(ident).startsWith(state.opponentSide));

function judge(state: InferrerState, watch: StatWatch, gates: TriggerGates) {
  const dex = dexOf(state);
  const out = (ident: string, ids: Iterable<string>) => { for (const id of ids) ruleOutUnknown(state, keyOf(ident), id); };
  for (const ident of holders(state, watch)) {
    const stages = watch.stages.get(keyOf(ident));
    if (!stages || ignored(state, gates, keyOf(ident), ident) || !Object.values(stages).some(stage => stage < 0)) continue;
    out(ident, standingItems(dex).filter(id => spendsStanding(dex, id, stages)));
  }
  const answers = boostAnswers(dex);
  for (const event of watch.landed) {
    if (event.ignored || !event.stages || ignored(state, gates, event.holder, event.ident)) continue;
    const stages = event.stages;
    out(event.ident, [...answers].filter(([id]) => spendsAfterBoost(dex, id, event.boost, event.effect, stages)).map(([id]) => id));
  }
  for (const [key, events] of watch.heard) {
    const ident = holders(state, watch).find(known => keyOf(known) === key);
    const heard = events.filter(event => !event.ignored);
    if (!ident || heard.length === 0 || ignored(state, gates, key, ident)) continue;
    out(ident, foeBoostItems(dex).filter(id => spendsAfterFoeBoosts(dex, id, heard)));
  }
  watch.landed = [];
  watch.heard.clear();
}

function addStage(watch: StatWatch, key: string, stat: string, by: number, set = false): number | null {
  const stages = watch.stages.get(key);
  if (!stages) return null;
  const before = stages[stat] ?? 0;
  stages[stat] = set ? by : Math.max(-6, Math.min(6, before + by));
  return stages[stat] - before;
}

function onBoost(state: InferrerState, watch: StatWatch, gates: TriggerGates, line: LogLine, key: string) {
  const stat = arg(line, 2);
  const change = Number(arg(line, 3));
  if (!stat || Number.isNaN(change)) return;
  const set = line.cmd === '-setboost';
  const signed = line.cmd === '-unboost' ? -change : change;
  const delta = addStage(watch, key, stat, signed, set);
  const effect = fromEffect(line).name || watch.effect;
  const ident = arg(line, 1);
  if (keyOf(ident).startsWith(state.opponentSide)) {
    if (!set) watch.landed.push({ holder: key, ident, boost: { [stat]: signed }, effect, stages: copyOf(watch.stages.get(key)), ignored: ignored(state, gates, key, ident) });
    return;
  }
  const raised = set ? delta ?? 0 : signed;
  if (raised <= 0) return;
  for (const holder of holders(state, watch)) {
    const heard = watch.heard.get(keyOf(holder)) ?? [];
    heard.push({ boost: { [stat]: raised }, effect, ignored: ignored(state, gates, keyOf(holder), holder) });
    watch.heard.set(keyOf(holder), heard);
  }
}

const copyOf = (stages: Stages | null | undefined): Stages | null => (stages ? { ...stages } : null);

const REWRITES: Record<string, (stage: number) => number> = {
  '-clearnegativeboost': stage => Math.max(0, stage), '-clearpositiveboost': stage => Math.min(0, stage), '-invertboost': stage => -stage,
};

function onStages(watch: StatWatch, line: LogLine, key: string) {
  const tag = line.cmd;
  const stages = watch.stages.get(key);
  const rewrite = REWRITES[tag];
  if (rewrite && stages) for (const stat of Object.keys(stages)) stages[stat] = rewrite(stages[stat]);
  else if (tag === '-clearboost') watch.stages.set(key, clean());
  else if (tag === '-clearallboost') for (const known of watch.stages.keys()) watch.stages.set(known, clean());
  else if (tag === '-swapboost' || tag === '-copyboost') for (const ident of [arg(line, 1), arg(line, 2)]) watch.stages.set(keyOf(ident), null);
  else if (tag === '-transform') watch.stages.set(key, null);
}

function onEntry(watch: StatWatch, line: LogLine, key: string) {
  const position = arg(line, 1).slice(0, 3);
  const left = watch.slots.get(position);
  if (left) watch.stages.delete(keyOf(left));
  watch.slots.set(position, arg(line, 1));
  watch.stages.set(key, line.cmd === 'replace' || watch.passing.has(sideOf(key)) ? null : clean());
  watch.passing.delete(sideOf(key));
  forget(watch, key);
}

function onSwap(watch: StatWatch, line: LogLine) {
  const from = arg(line, 1).slice(0, 3);
  const to = `${from.slice(0, 2)}${'abcd'[Number(arg(line, 2))] ?? ''}`;
  const moved = watch.slots.get(from);
  if (!moved || to === from) return;
  const other = watch.slots.get(to);
  watch.slots.set(to, moved);
  if (other) watch.slots.set(from, other);
  else watch.slots.delete(from);
}

function onFaint(watch: StatWatch, key: string) {
  for (const [position, ident] of watch.slots) if (keyOf(ident) === key) watch.slots.delete(position);
  watch.stages.delete(key);
  forget(watch, key);
}

function forget(watch: StatWatch, key: string) {
  watch.heard.delete(key);
  watch.landed = watch.landed.filter(event => event.holder !== key);
}

function onOther(state: InferrerState, watch: StatWatch, line: LogLine, key: string) {
  const tag = line.cmd;
  if (tag === '-ability') watch.effect = arg(line, 3) === 'boost' ? arg(line, 2) : '';
  else if (tag === '-enditem') forget(watch, key);
  else if (tag === 'move' && !hasKw(line, 'from') && dexOf(state).moves.get(arg(line, 2)).selfSwitch === 'copyvolatile') watch.passing.add(sideOf(key));
  else onStages(watch, line, key);
}

export function watchStatItems(state: InferrerState, watch: StatWatch, gates: TriggerGates, line: LogLine) {
  const tag = line.cmd;
  const key = keyOf(arg(line, 1));
  if (BOUNDARIES.has(tag) && !(MID_ACTION.has(tag) && hasKw(line, 'from'))) {
    judge(state, watch, gates);
    watch.effect = '';
  }
  if (tag === 'switch' || tag === 'drag' || tag === 'replace') onEntry(watch, line, key);
  else if (tag === 'faint') onFaint(watch, key);
  else if (tag === 'swap') onSwap(watch, line);
  else if (tag === '-boost' || tag === '-unboost' || tag === '-setboost') onBoost(state, watch, gates, line, key);
  else onOther(state, watch, line, key);
}
