import type { PRNGSeed } from '@pkmn/sim';
import type { MatchupCache } from '../eval-function.ts';
import { advancePositionWithLog, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { GIMMICK_TOKENS } from '../rank.ts';
import type { EvalCellValue } from '../types.ts';
import { combinedOptionHints, isCombined } from './hints.ts';
import { leafValue } from './leaf.ts';

/** Natural draws of a plain verify cell wherever the sampler wants more than one. */
export const VERIFY_PLAIN_DRAWS = 16;
/** Share of the open weight that goes deeper (the heaviest outcome always); the rest is shifted by the mean step. */
export const VERIFY_DEEPEN_COVER = { singles: 0.9, doubles: 0 } as const;

/** Beyond the cover: 'off' shifts the one-ply leaf, 'all' runs a light sub-search, 'states' only if states differ. */
export type CheapMode = 'off' | 'all' | 'states';
export const VERIFY_CHEAP: { singles: CheapMode; doubles: CheapMode } = { singles: 'off', doubles: 'all' };

export const VERIFY_LIGHT = { options: 5, minWeight: 0.05 };

export interface CheapDeepening {
  price: (child: SimPosition) => number;
  statesOnly: boolean;
  minWeight: number;
}

export function lightOptions(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[], keep = VERIFY_LIGHT.options): ChoiceOption[] {
  if (options.length <= keep || !isCombined(options)) return options;
  const hints = combinedOptionHints(position, side, options);
  const scored = options.map((option, index) => ({ option, index, value: hints[index] }));
  const plain = scored.filter(entry => !entry.option.choice.split(/[ ,]+/).some(token => GIMMICK_TOKENS.has(token)));
  return (plain.length >= keep ? plain : scored)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, keep)
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.option);
}

/** How an outcome that goes deeper splits its draws: `split` by every state or counters only, `span` 0 never halves. */
export interface StateRule {
  split: 'state' | 'counter';
  span: number;
  cover: number;
  cap: number;
  pool: number;
}

export const VERIFY_STATE_RULE: { readonly singles: StateRule; readonly doubles: StateRule } = {
  singles: { split: 'state', span: 0.05, cover: 0.9, cap: 4, pool: VERIFY_PLAIN_DRAWS },
  doubles: { split: 'counter', span: 0, cover: 0.9, cap: 4, pool: 8 },
};

export const stateRuleFor = (position: SimPosition): StateRule =>
  VERIFY_STATE_RULE[positionBattle(position).gameType === 'doubles' ? 'doubles' : 'singles'];

export interface StateGroup {
  share: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
}

export interface OutcomeGroup {
  share: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
  groups?: StateGroup[];
}

export interface PlainDraw {
  child: SimPosition;
  log: readonly string[];
  leaf: number;
  ended: boolean;
}

type Drawn = Pick<PlainDraw, 'child' | 'leaf' | 'ended'>;
type BattlePokemon = ReturnType<typeof positionBattle>['sides'][number]['pokemon'][number];

const OUTCOME_LINE = /^\|(faint|-miss|cant)\|/;

const outcomeKey = (draw: PlainDraw): string =>
  `${draw.log.filter(line => OUTCOME_LINE.test(line)).map(line => line.split('|').slice(1, 4).join('|')).join(';')}${draw.ended ? ';end' : ''}`;

// Left out of the state key: the running effect counter and HP and damage amounts, which follow the damage roll.
const UNREAD = new Set(['effectOrder', 'hp', 'damage', 'totalDamage']);

const counters = (state: Record<string, unknown> | undefined): string => (state
  ? Object.entries(state).filter(([key, value]) => typeof value === 'number' && !UNREAD.has(key))
    .map(([key, value]) => `${key}=${String(value)}`).sort().join(',')
  : '');

function pokemonState(pokemon: BattlePokemon): string {
  const volatiles = Object.keys(pokemon.volatiles).sort().map(id => `${id}(${counters(pokemon.volatiles[id])})`).join('+');
  const boosts = Object.entries(pokemon.boosts).filter(([, stage]) => stage !== 0).map(([stat, stage]) => `${stat}${stage}`).join('');
  return `${pokemon.name}:${pokemon.fainted ? 'fnt' : ''}${pokemon.status}(${counters(pokemon.statusState)})/${volatiles}/${boosts}/${pokemon.item}`;
}

function pokemonCounts(pokemon: BattlePokemon): string {
  const status = counters(pokemon.statusState) ? `${pokemon.status}(${counters(pokemon.statusState)})` : '';
  const volatiles = Object.keys(pokemon.volatiles).sort().filter(id => counters(pokemon.volatiles[id]))
    .map(id => `${id}(${counters(pokemon.volatiles[id])})`).join('+');
  return `${pokemon.name}:${status}/${volatiles}`;
}

function sidesKey(child: SimPosition, read: (pokemon: BattlePokemon) => string): string {
  return positionBattle(child).sides.map(side => {
    const active = side.active.map(pokemon => (pokemon ? read(pokemon) : '-')).join(',');
    const bench = side.pokemon.filter(pokemon => !side.active.includes(pokemon)).map(read).sort().join(',');
    return `${active};${bench}`;
  }).join('|');
}

/** The state a child leaves on every Pokémon, HP left out: slots, status, volatiles, stat stages, item. */
export const stateKey = (child: SimPosition): string => sidesKey(child, pokemonState);

export const counterKey = (child: SimPosition): string => sidesKey(child, pokemonCounts);

export const firstDraw = <T extends Drawn>(list: readonly T[]): T => list[0];

export function nearestMean<T extends Drawn>(list: readonly T[], mean: number): T {
  let pick = list[0];
  for (const draw of list) if (Math.abs(draw.leaf - mean) < Math.abs(pick.leaf - mean)) pick = draw;
  return pick;
}

type Choose<T> = (list: readonly T[], mean: number) => T;

function spanHalves<T extends Drawn>(list: T[], pick: Choose<T>, span: number): { list: T[]; choose: Choose<T> }[] {
  const leaves = list.map(draw => draw.leaf);
  if (span <= 0 || list.length < 2 || Math.max(...leaves) - Math.min(...leaves) <= span) return [{ list, choose: pick }];
  const sorted = [...list].sort((a, b) => a.leaf - b.leaf);
  const half = Math.floor(sorted.length / 2);
  return [{ list: sorted.slice(0, half), choose: nearestMean }, { list: sorted.slice(half), choose: nearestMean }];
}

export function stateGroups<T extends Drawn>(draws: readonly T[], pick: Choose<T>): StateGroup[] | undefined {
  if (draws.length < 2) return undefined;
  const rule = stateRuleFor(draws[0].child);
  const key = rule.split === 'counter' ? counterKey : stateKey;
  const groups = new Map<string, T[]>();
  for (const draw of draws) {
    const state = key(draw.child);
    groups.set(state, [...(groups.get(state) ?? []), draw]);
  }
  const lists = [...groups.values()].flatMap(list => spanHalves(list, pick, rule.span));
  if (lists.length < 2) return undefined;
  return lists.map(({ list, choose }) => {
    const mean = list.reduce((sum, draw) => sum + draw.leaf, 0) / list.length;
    return { share: list.length / draws.length, child: choose(list, mean).child, leaf: mean, ended: list.every(draw => draw.ended) };
  });
}

export function drawPlain(root: SimPosition, p1Choice: string, p2Choice: string, seed: PRNGSeed, matchupCache: MatchupCache): PlainDraw {
  const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed);
  const battle = positionBattle(child);
  return { child, log, leaf: leafValue(battle, matchupCache), ended: battle.ended };
}

export function outcomeGroups(draws: readonly PlainDraw[]): OutcomeGroup[] {
  const groups = new Map<string, PlainDraw[]>();
  for (const draw of draws) {
    const key = outcomeKey(draw);
    groups.set(key, [...(groups.get(key) ?? []), draw]);
  }
  return [...groups.values()].map(list => {
    const mean = list.reduce((sum, draw) => sum + draw.leaf, 0) / list.length;
    const states = stateGroups(list, nearestMean);
    return {
      share: list.length / draws.length, child: nearestMean(list, mean).child, leaf: mean, ended: list.every(draw => draw.ended),
      ...(states ? { groups: states } : {}),
    };
  });
}

export interface VerifyDraws {
  firstChild: SimPosition;
  classChildren?: ReadonlyMap<string, SimPosition>;
  classGroups?: ReadonlyMap<string, StateGroup[]>;
  outcomes?: OutcomeGroup[];
}

export interface Outcome {
  weight: number;
  child: SimPosition;
  leaf: number;
  ended: boolean;
  groups?: readonly StateGroup[];
}

/** Open outcomes go deeper by descending weight (ties in list order); the rest shift by the deepened mean step. */
export function deeperValues(
  outcomes: readonly Outcome[], deepen: (child: SimPosition) => number, cover: number, cap = Number.POSITIVE_INFINITY,
  states: StateRule = VERIFY_STATE_RULE.singles, cheap?: CheapDeepening,
): number[] {
  const values = outcomes.map(outcome => outcome.leaf);
  const open = outcomes.map((outcome, index) => ({ outcome, index })).filter(entry => !entry.outcome.ended)
    .sort((a, b) => b.outcome.weight - a.outcome.weight || a.index - b.index);
  const target = cover * open.reduce((sum, entry) => sum + entry.outcome.weight, 0);
  let covered = 0;
  let step = 0;
  let taken = 0;
  const rest: number[] = [];
  for (const { outcome, index } of open) {
    if ((covered > 0 && covered >= target - 1e-12) || taken >= cap) {
      rest.push(index);
      continue;
    }
    const deeper = outcome.groups ? deeperStates(outcome.groups, deepen, states) : { value: deepen(outcome.child), leaf: outcome.leaf };
    values[index] = deeper.value;
    step += outcome.weight * (deeper.value - deeper.leaf);
    covered += outcome.weight;
    taken += 1;
  }
  for (const index of rest) {
    const outcome = outcomes[index];
    const priced = cheap !== undefined && outcome.weight >= cheap.minWeight;
    if (priced && outcome.groups) values[index] = deeperStates(outcome.groups, cheap.price, states).value;
    else values[index] = priced && !cheap.statesOnly ? cheap.price(outcome.child) : outcome.leaf + step / covered;
  }
  return values;
}

function deeperStates(groups: readonly StateGroup[], deepen: (child: SimPosition) => number, rule: StateRule): { value: number; leaf: number } {
  const values = deeperValues(groups.map(group => ({ weight: group.share, child: group.child, leaf: group.leaf, ended: group.ended })),
    deepen, rule.cover, rule.cap, rule);
  return {
    value: groups.reduce((sum, group, index) => sum + group.share * values[index], 0),
    leaf: groups.reduce((sum, group) => sum + group.share * group.leaf, 0),
  };
}

export function deepenVerifiedCell(
  value: EvalCellValue, draws: VerifyDraws, deepen: (child: SimPosition) => number, cover: number, cheap?: CheapDeepening,
): void {
  const states = stateRuleFor(draws.firstChild);
  if (value.blend) {
    const open = value.blend.classes.filter(cls => !cls.ended && draws.classChildren?.has(cls.key));
    const values = deeperValues(open.map(cls => {
      const groups = draws.classGroups?.get(cls.key);
      return { weight: cls.weight, child: draws.classChildren!.get(cls.key)!, leaf: cls.leafSum / cls.count, ended: false, ...(groups ? { groups } : {}) };
    }), deepen, cover, Number.POSITIVE_INFINITY, states, cheap);
    open.forEach((cls, index) => { cls.deepened = values[index]; });
    return;
  }
  const groups = draws.outcomes ?? [{ share: 1, child: draws.firstChild, leaf: value.value, ended: value.ended }];
  const values = deeperValues(groups.map(group => ({ ...group, weight: group.share })), deepen, cover, Number.POSITIVE_INFINITY, states, cheap);
  value.deepened = groups.reduce((sum, group, index) => sum + group.share * values[index], 0);
}
