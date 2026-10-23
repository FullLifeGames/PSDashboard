import { getSpeciesUsageSet, getSpeciesUsageStats } from './smogon/usage-lookup.ts';
import type { SmogonUsageStats, UsageProbability, UsageSpread } from './smogon/stats-types.ts';
import { getSpeciesSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions } from './smogon/sets-lookup.ts';
import { applyCoherenceVetoes, itemFromChosenSet, publishedIvs, selectCuratedSet, type MoveCandidate } from './set-coherence.ts';
import { isChampionsFormat } from './champions-format.ts';
import type { SpreadCandidate, SpreadOrigin } from './spreads/ladder.ts';
import { settleOpenMoves, unfilledOpenMoves } from './team/open-moves.ts';
import type {
  OpenMove, OpponentTeamInfo, PokemonEvs, PokemonEvsInfo, PokemonFieldInfo, PokemonMoveInfo, RevealedPokemonInfo,
} from './types.ts';
import { toId } from './ids.ts';
import { dexOfSources, type RulesDex } from './rules-dex.ts';

export const EMPTY_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function unknownField(): PokemonFieldInfo {
  return { value: '', source: 'unknown' };
}

export function revealedField(value: string): PokemonFieldInfo {
  return { value, source: 'revealed' };
}

export function guessedField(value: string, probability?: number, sourceDetail?: string): PokemonFieldInfo {
  return { value, source: 'guessed', probability, sourceDetail };
}

export function manualField(value: string): PokemonFieldInfo {
  return { value, source: 'manual' };
}

export function unknownEvs(): PokemonEvsInfo {
  return { value: { ...EMPTY_EVS }, source: 'unknown' };
}

export function guessedEvs(value: PokemonEvs, probability?: number, sourceDetail?: string): PokemonEvsInfo {
  return { value, source: 'guessed', probability, sourceDetail };
}

export function manualEvs(value: PokemonEvs): PokemonEvsInfo {
  return { value, source: 'manual' };
}

export function manualMove(name: string): PokemonMoveInfo {
  return { name, source: 'manual' };
}

/** Provenance label the stats panel shows for damage-solved spreads. */
export const INFERRED_SPREAD_DETAIL = 'fits observed damage';
/** A spread only a proven move order checked (round 69, T69). */
export const ORDER_SPREAD_DETAIL = 'fits the observed move order';
/** A spread whose HP the log's maximum HP set inside the guess (round 69, T69). */
export const MEASURED_HP_SPREAD_DETAIL = 'HP read from the log, the rest kept from the guess';
/** Provenance details for items the move-order evidence decided (round 37). */
export const INFERRED_ITEM_DETAIL = 'moved first, Choice Scarf inferred';
export const RULED_OUT_ITEM_DETAIL = 'moved second, Choice Scarf ruled out';
/** The damage lines dropped a guessed boost item (round 69, T26). */
export const NO_BOOST_ITEM_DETAIL = 'damage rules out a boost item';

const ITEM_DETAIL = { 'moved-first': INFERRED_ITEM_DETAIL, 'moved-second': RULED_OUT_ITEM_DETAIL, 'no-boost': NO_BOOST_ITEM_DETAIL } as const;

/** A guessed or unknown item gives way to the item the solver decided. */
function overlayItem(pokemon: RevealedPokemonInfo, candidate: SpreadCandidate): PokemonFieldInfo {
  const itemGuessed = pokemon.item.source === 'guessed' || pokemon.item.source === 'unknown';
  if (!itemGuessed) return pokemon.item;
  // A dropped boost item with no other item to take its place leaves the item unknown, as the build fields it.
  if (candidate.itemReason === 'no-boost' && !candidate.item) return { ...unknownField(), sourceDetail: NO_BOOST_ITEM_DETAIL };
  if (!candidate.item) return pokemon.item;
  return guessedField(candidate.item, undefined, ITEM_DETAIL[candidate.itemReason ?? 'moved-second']);
}

const ORIGIN_DETAIL: Record<Exclude<SpreadOrigin, 'prior'>, string> = {
  damage: INFERRED_SPREAD_DETAIL, order: ORDER_SPREAD_DETAIL, hp: MEASURED_HP_SPREAD_DETAIL,
};
const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const sameStats = (a: Partial<PokemonEvs>, b: Partial<PokemonEvs>, fallback: number) =>
  STAT_IDS.every(stat => (a[stat] ?? fallback) === (b[stat] ?? fallback));

/**
 * The EVs the panel shows for a solved spread. The label says who checked it (round 69, T69): a spread that keeps the
 * guess's numbers keeps the guess's label, a changed one carries its origin's, and an entry no evidence solved shows
 * its numbers under the label of the guess they come from.
 */
function overlayEvs(pokemon: RevealedPokemonInfo, candidate: SpreadCandidate): PokemonEvsInfo {
  const guess = pokemon.evs;
  if (guess.source === 'guessed' && sameStats(guess.value, candidate.evs, 0)) return guess;
  const origin = candidate.origin ?? 'damage';
  if (origin === 'prior') return guess.source === 'guessed' ? { ...guess, value: { ...candidate.evs } } : guessedEvs({ ...candidate.evs });
  return guessedEvs({ ...candidate.evs }, undefined, ORIGIN_DETAIL[origin]);
}

/** The nature, on the same terms as the EVs. */
function overlayNature(pokemon: RevealedPokemonInfo, candidate: SpreadCandidate): PokemonFieldInfo {
  const guess = pokemon.nature;
  if (guess?.source === 'guessed' && toId(guess.value) === toId(candidate.nature)) return guess;
  const origin = candidate.origin ?? 'damage';
  if (origin === 'prior') return guess?.source === 'guessed' ? { ...guess, value: candidate.nature } : guessedField(candidate.nature);
  return guessedField(candidate.nature, undefined, ORIGIN_DETAIL[origin]);
}

/** The IVs a solved candidate carries (the Speed IV a seen order took back) replace a guess, never a user's. */
function overlayIvs(pokemon: RevealedPokemonInfo, candidate: SpreadCandidate): PokemonEvsInfo | undefined {
  const shown = pokemon.ivs;
  if (!candidate.ivs || shown?.source === 'manual' || shown?.source === 'revealed') return shown;
  if (shown && sameStats(shown.value, candidate.ivs, 31)) return shown;
  return guessedEvs({ ...candidate.ivs }, undefined, ORDER_SPREAD_DETAIL);
}

/**
 * Display overlay for damage-consistent spreads and the items the
 * move-order evidence decided: mirrors the simulator precedence
 * (edited/revealed/sheet beat inference; inference beats usage guesses),
 * so what the panel shows is what the sim runs.
 */
export function applyInferredSpreads(
  info: OpponentTeamInfo,
  side: 'p1' | 'p2',
  inferred: Map<string, SpreadCandidate> | null,
): OpponentTeamInfo {
  if (!inferred || inferred.size === 0) return info;
  return {
    ...info,
    pokemon: info.pokemon.map(pokemon => {
      const candidate = inferred.get(`${side}:${toId(pokemon.species)}`);
      if (!candidate) return pokemon;
      const item = overlayItem(pokemon, candidate);
      const evsGuessed = pokemon.evs.source === 'guessed' || pokemon.evs.source === 'unknown';
      const natureGuessed = !pokemon.nature || pokemon.nature.source === 'guessed' || pokemon.nature.source === 'unknown';
      if (!evsGuessed) return { ...pokemon, item };
      const ivs = overlayIvs(pokemon, candidate);
      return {
        ...pokemon,
        item,
        evs: overlayEvs(pokemon, candidate),
        ...(ivs ? { ivs } : {}),
        ...(natureGuessed ? { nature: overlayNature(pokemon, candidate) } : {}),
      };
    }),
  };
}

/**
 * Item values carry display annotations ("Sitrus Berry (consumed)",
 * "(has item)") that describe battle knowledge, not the set. This strips them
 * down to the set's item name — '' when there is no real item name at all.
 * Every boundary that needs a plain item (sets export/import, editor fields,
 * simulator teams) must go through this instead of the raw value.
 */
export function itemSetValue(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed || trimmed.startsWith('(')) return '';
  return trimmed.replace(/\s*\(consumed\)\s*$/i, '').trim();
}

function guessedMove(move: UsageProbability): PokemonMoveInfo {
  return {
    name: move.value,
    source: 'guessed',
    probability: move.probability,
    sourceDetail: move.sourceDetail,
  };
}

function guessedMoveFromSet(move: SetAssumption): PokemonMoveInfo {
  return {
    name: move.value,
    source: 'guessed',
    sourceDetail: move.sourceDetail,
  };
}

function allowedSetFallback(setFallback: SetAssumption | undefined, ruledOut?: string[]): SetAssumption | undefined {
  if (!setFallback) return undefined;
  return (ruledOut ?? []).includes(toId(setFallback.value)) ? undefined : setFallback;
}

/**
 * `preferSet` = the set fallback is the WINNING curated set (matched against
 * revealed evidence) — it then beats the usage marginal, exactly as it does
 * in the simulator's team builder. An unselected first-set fallback keeps
 * losing to usage.
 */
function normalizeItemField(
  item: PokemonFieldInfo,
  fallback: UsageProbability | undefined,
  setFallback?: SetAssumption,
  ruledOut?: string[],
  preferSet = false,
): PokemonFieldInfo {
  const allowedSet = allowedSetFallback(setFallback, ruledOut);
  if (item.value && item.value !== '(has item)') return item;
  if (allowedSet && (preferSet || !fallback)) return guessedField(allowedSet.value, undefined, allowedSet.sourceDetail);
  if (!fallback) return item;
  return guessedField(fallback.value, fallback.probability, fallback.sourceDetail);
}

function normalizeAbilityField(
  ability: PokemonFieldInfo,
  fallback: UsageProbability | undefined,
  setFallback?: SetAssumption,
  ruledOut?: string[],
  preferSet = false,
): PokemonFieldInfo {
  const allowedSet = allowedSetFallback(setFallback, ruledOut);
  if (ability.value) return ability;
  if (allowedSet && (preferSet || !fallback)) return guessedField(allowedSet.value, undefined, allowedSet.sourceDetail);
  if (!fallback) return ability;
  return guessedField(fallback.value, fallback.probability, fallback.sourceDetail);
}

function normalizeEvsField(
  evs: PokemonEvsInfo | undefined,
  fallback: UsageSpread | undefined,
  setFallback?: SetSpreadAssumption,
  preferSet = false,
): PokemonEvsInfo {
  if (evs && evs.source !== 'unknown') return evs;
  if (setFallback?.evs && (preferSet || !fallback)) return guessedEvs(setFallback.evs, undefined, setFallback.sourceDetail);
  if (!fallback?.evs) return evs ?? unknownEvs();
  return guessedEvs(fallback.evs, fallback.probability, fallback.sourceDetail);
}

function normalizeNatureField(
  nature: PokemonFieldInfo | undefined,
  fallback: UsageSpread | undefined,
  setFallback?: SetSpreadAssumption,
  preferSet = false,
): PokemonFieldInfo | undefined {
  if (nature && nature.source !== 'unknown' && nature.value) return nature;
  if (setFallback?.nature && (preferSet || !fallback)) return guessedField(setFallback.nature, undefined, setFallback.sourceDetail);
  if (!fallback?.nature) return nature;
  return guessedField(fallback.nature, fallback.probability, fallback.sourceDetail);
}

/**
 * Dedup key for move fills: "Hidden Power" and "Hidden Power Grass" describe
 * the same slot — a guessed typed variant must not join a revealed generic
 * one (G12).
 */
function moveDedupKey(name: string): string {
  const id = toId(name);
  return id.startsWith('hiddenpower') ? 'hiddenpower' : id;
}

/** Usage-move candidates offered to the veto pass (the tail refills vetoed
 * slots) — mirrors the team builder's USAGE_MOVE_POOL. */
const GUESS_MOVE_POOL = 10;

type SpeciesUsage = ReturnType<typeof getSpeciesUsageSet>;
type SmogonSet = ReturnType<typeof getSpeciesSetAssumption>;
type CuratedSet = ReturnType<typeof selectCuratedSet>;

/**
 * The same coherent-set selection the simulator's team builder runs — the
 * panel's fills and the sim's fills come from one winner (or one shared
 * marginal fallback), never from two different guessers (GPL Body Press).
 */
function curatedSetFor(dex: RulesDex, pokemon: RevealedPokemonInfo, usageSet: SpeciesUsage, smogonSet: SmogonSet): CuratedSet | null {
  const proven = (field: PokemonFieldInfo) =>
    field.source === 'revealed' || field.source === 'manual' ? toId(field.value) : '';
  const known = pokemon.moves.filter(move => move.source === 'revealed' || move.source === 'manual');
  return smogonSet ? selectCuratedSet([smogonSet, ...(smogonSet.alternatives ?? [])], {
    dex, revealedMoves: known.map(move => toId(move.name)),
    // The Z-moves and Max moves the revealed moves do not explain: a set with a move to fill them fits better (round 70).
    openMoves: unfilledOpenMoves(dex, pokemon.openMoves, known.map(move => move.name)),
    // A consumed or knocked-off item is still the set's item (round 63).
    revealedItem: proven({ ...pokemon.item, value: itemSetValue(pokemon.item.value) }),
    revealedAbility: proven(pokemon.ability),
    ruledOutItems: pokemon.ruledOut?.items ?? [],
    ruledOutAbilities: pokemon.ruledOut?.abilities ?? [],
    usageProbability: moveId =>
      usageSet?.moves.find(move => toId(move.value) === moveId)?.probability ?? 0,
    // The item after a rule-out, as the build reads it (round 64, decision 19).
    guessedItem: pokemon.item.source === 'guessed' ? itemSetValue(pokemon.item.value) : '',
    usageItem: usageSet?.item?.value ?? '',
  }) : null;
}

/** The curated set's fields, falling back to the marginal set assumption. */
function setFallbacks(curated: CuratedSet | null, smogonSet: SmogonSet) {
  return {
    item: curated?.item ?? smogonSet?.item,
    ability: curated?.ability ?? smogonSet?.ability,
    spread: curated?.spread ?? smogonSet?.spread,
  };
}

/**
 * The move pool in the build's offer order (assembleMoves): known, the
 * curated set (spared by veto rows 1 and 2), earlier guesses, usage, marginal
 * set moves when nothing curated won, then the usage tail (round 63, T89
 * with T28).
 */
function assembleMovePool(
  pokemon: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsage, smogonSet: SmogonSet,
  usageTail: UsageProbability[],
): { pool: MoveCandidate[]; infoFor: Map<string, PokemonMoveInfo> } {
  const infoFor = new Map<string, PokemonMoveInfo>();
  const pool: MoveCandidate[] = [];
  const pooled = new Set<string>();
  const known = (move: PokemonMoveInfo) => move.source === 'revealed' || move.source === 'manual';
  const offer = (move: PokemonMoveInfo, mark: { fromSet?: true; tail?: true } = {}) => {
    const key = moveDedupKey(move.name);
    if (pooled.has(key)) return;
    pooled.add(key);
    infoFor.set(move.name, move);
    pool.push({ name: move.name, guessed: !known(move), ...mark });
  };
  for (const move of pokemon.moves) if (known(move)) offer(move);
  for (const move of curated?.moves ?? []) offer(guessedMoveFromSet(move), { fromSet: true });
  for (const move of pokemon.moves) offer(move);
  for (const move of usageSet?.moves ?? []) offer(guessedMove(move));
  if (!curated) for (const move of smogonSet?.moves ?? []) offer(guessedMoveFromSet(move));
  for (const move of usageTail) offer(guessedMove(move), { tail: true });
  return { pool, infoFor };
}

/**
 * Known moves always stay; vetoed guesses drop and the pool's tail refills
 * the display up to four slots. The item rows spare the chosen set's moves
 * when the item is that set's own (T131), as the build does. A Z-move's or
 * Max move's open slot is settled as the build settles it (round 70).
 */
function vetoedMoves(
  dex: RulesDex, pool: MoveCandidate[], infoFor: Map<string, PokemonMoveInfo>, itemValue: string, curated: CuratedSet | null,
  open: readonly OpenMove[] | undefined,
): PokemonMoveInfo[] {
  const item = itemSetValue(itemValue);
  const shown = (candidates: MoveCandidate[]): MoveCandidate[] => {
    const kept: MoveCandidate[] = [];
    for (const candidate of applyCoherenceVetoes(candidates, { dex, itemId: toId(item), itemFromSet: itemFromChosenSet(dex, curated, item) })) {
      if (infoFor.has(candidate.name) && (!candidate.guessed || kept.length < 4)) kept.push(candidate);
    }
    return kept;
  };
  return settleOpenMoves(dex, pool, open, shown).flatMap(candidate => infoFor.get(candidate.name) ?? []);
}

/**
 * Display follows computed data (⑤): the sim substitutes a typeless
 * "Hidden Power" with the evidence/usage variant — show that same name so
 * the visible sheet and the simulated set agree. The revealed status
 * stays; only the name gains the typed suffix, marked by its detail.
 */
function withTypedHiddenPower(
  moves: PokemonMoveInfo[], species: string, hpTypeResolver: ((species: string) => string | null) | undefined,
): PokemonMoveInfo[] {
  return hpTypeResolver
    ? moves.map(move => {
      if (toId(move.name) !== 'hiddenpower') return move;
      const resolved = hpTypeResolver(species);
      return resolved ? { ...move, name: resolved, sourceDetail: 'HP type via evidence/usage' } : move;
    })
    : moves;
}

/**
 * The IVs the build plays (round 69, T136): the chosen published set's, read by the rule the build reads
 * (publishedIvs), shown as a guess; the user's own stay. A Champions body plays IV 31 whatever the set lists, so it
 * shows none, and a set that lists none leaves the field open (the body plays 31).
 */
function ivsField(
  pokemon: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsage, smogonSet: SmogonSet, format: string,
): PokemonEvsInfo | undefined {
  if (pokemon.ivs?.source === 'manual' || pokemon.ivs?.source === 'revealed') return pokemon.ivs;
  const published = isChampionsFormat(format) ? undefined : publishedIvs(curated, !!usageSet?.spread, smogonSet);
  if (!published || Object.keys(published).length === 0) return undefined;
  const sourceDetail = (curated ?? smogonSet)?.spread?.sourceDetail;
  return guessedEvs({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...published }, undefined, sourceDetail);
}

export function enrichPokemonInfo(
  pokemon: RevealedPokemonInfo,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
  hpTypeResolver?: (species: string) => string | null,
): RevealedPokemonInfo {
  // The Dex of the game the sets and the usage were published for (round 75, T160).
  const dex = dexOfSources(setAssumptions?.format, usageStats?.format);
  const usageSet = getSpeciesUsageSet(usageStats, pokemon.species, pokemon.ruledOut, GUESS_MOVE_POOL);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, pokemon.species);
  const curated = curatedSetFor(dex, pokemon, usageSet, smogonSet);
  const fallback = setFallbacks(curated, smogonSet);

  // The item resolves BEFORE the moves — the Choice/AV veto rows read it.
  const item = normalizeItemField(pokemon.item, usageSet?.item, fallback.item, pokemon.ruledOut?.items, !!curated);
  const usageTail = getSpeciesUsageStats(pokemon.species, usageStats)?.moves.slice(GUESS_MOVE_POOL) ?? [];
  const { pool, infoFor } = assembleMovePool(pokemon, curated, usageSet, smogonSet, usageTail);
  const moves = vetoedMoves(dex, pool, infoFor, item.value, curated, pokemon.openMoves);
  const ivs = ivsField(pokemon, curated, usageSet, smogonSet, setAssumptions?.format ?? '');

  return {
    ...pokemon,
    ...(ivs ? { ivs } : {}),
    ability: normalizeAbilityField(pokemon.ability, usageSet?.ability, fallback.ability, pokemon.ruledOut?.abilities, !!curated),
    item,
    evs: normalizeEvsField(pokemon.evs, usageSet?.spread, fallback.spread, !!curated),
    nature: normalizeNatureField(pokemon.nature, usageSet?.spread, fallback.spread, !!curated),
    moves: withTypedHiddenPower(moves, pokemon.species, hpTypeResolver),
  };
}

export function enrichTeamInfo(
  teamInfo: OpponentTeamInfo,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
  hpTypeResolver?: (species: string) => string | null,
): OpponentTeamInfo {
  return {
    pokemon: teamInfo.pokemon.map(pokemon => enrichPokemonInfo(pokemon, usageStats, setAssumptions, hpTypeResolver)),
  };
}
