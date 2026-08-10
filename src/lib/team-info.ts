import { getSpeciesUsageSet, type SmogonUsageStats, type UsageProbability, type UsageSpread } from './smogon-stats';
import { getSpeciesSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions } from './smogon-sets';
import { applyCoherenceVetoes, selectCuratedSet, type MoveCandidate } from './set-coherence';
import type { OpponentTeamInfo, PokemonEvs, PokemonEvsInfo, PokemonFieldInfo, PokemonMoveInfo, RevealedPokemonInfo } from '../types';

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

/**
 * Display overlay for damage-consistent spreads: mirrors the simulator
 * precedence (edited/revealed/sheet beat inference; inference beats usage
 * guesses), so what the panel shows is what the sim runs.
 */
export function applyInferredSpreads(
  info: OpponentTeamInfo,
  side: 'p1' | 'p2',
  inferred: Map<string, { evs: PokemonEvs; nature: string }> | null,
): OpponentTeamInfo {
  if (!inferred || inferred.size === 0) return info;
  const idOfSpecies = (species: string) => species.toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    ...info,
    pokemon: info.pokemon.map(pokemon => {
      const candidate = inferred.get(`${side}:${idOfSpecies(pokemon.species)}`);
      if (!candidate) return pokemon;
      const evsGuessed = pokemon.evs.source === 'guessed' || pokemon.evs.source === 'unknown';
      const natureGuessed = !pokemon.nature || pokemon.nature.source === 'guessed' || pokemon.nature.source === 'unknown';
      if (!evsGuessed) return pokemon;
      return {
        ...pokemon,
        evs: guessedEvs({ ...candidate.evs }, undefined, INFERRED_SPREAD_DETAIL),
        ...(natureGuessed
          ? { nature: guessedField(candidate.nature, undefined, INFERRED_SPREAD_DETAIL) }
          : {}),
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

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function allowedSetFallback(setFallback: SetAssumption | undefined, ruledOut?: string[]): SetAssumption | undefined {
  if (!setFallback) return undefined;
  return (ruledOut ?? []).includes(idOf(setFallback.value)) ? undefined : setFallback;
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
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return id.startsWith('hiddenpower') ? 'hiddenpower' : id;
}

/** Usage-move candidates offered to the veto pass (the tail refills vetoed
 * slots) — mirrors the team builder's USAGE_MOVE_POOL. */
const GUESS_MOVE_POOL = 10;

export function enrichPokemonInfo(
  pokemon: RevealedPokemonInfo,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
): RevealedPokemonInfo {
  const usageSet = getSpeciesUsageSet(usageStats, pokemon.species, pokemon.ruledOut, GUESS_MOVE_POOL);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, pokemon.species);
  const proven = (field: PokemonFieldInfo) =>
    field.source === 'revealed' || field.source === 'manual' ? idOf(field.value) : '';

  // The same coherent-set selection the simulator's team builder runs — the
  // panel's fills and the sim's fills come from one winner (or one shared
  // marginal fallback), never from two different guessers (GPL Body Press).
  const curated = smogonSet ? selectCuratedSet([smogonSet, ...(smogonSet.alternatives ?? [])], {
    revealedMoves: pokemon.moves
      .filter(move => move.source === 'revealed' || move.source === 'manual')
      .map(move => idOf(move.name)),
    revealedItem: proven(pokemon.item),
    revealedAbility: proven(pokemon.ability),
    ruledOutItems: pokemon.ruledOut?.items ?? [],
    ruledOutAbilities: pokemon.ruledOut?.abilities ?? [],
    usageProbability: moveId =>
      usageSet?.moves.find(move => idOf(move.value) === moveId)?.probability ?? 0,
  }) : null;

  // The item resolves BEFORE the moves — the Choice/AV veto rows read it.
  const item = normalizeItemField(pokemon.item, usageSet?.item, curated?.item ?? smogonSet?.item, pokemon.ruledOut?.items, !!curated);

  const infoFor = new Map<string, PokemonMoveInfo>();
  const pool: MoveCandidate[] = [];
  const pooled = new Set<string>();
  const offer = (move: PokemonMoveInfo) => {
    const key = moveDedupKey(move.name);
    if (pooled.has(key)) return;
    pooled.add(key);
    infoFor.set(move.name, move);
    pool.push({ name: move.name, guessed: move.source !== 'revealed' && move.source !== 'manual' });
  };
  for (const move of pokemon.moves) offer(move);
  for (const move of curated?.moves ?? []) offer(guessedMoveFromSet(move));
  for (const move of usageSet?.moves ?? []) offer(guessedMove(move));
  if (!curated) for (const move of smogonSet?.moves ?? []) offer(guessedMoveFromSet(move));

  // Known moves always stay; vetoed guesses drop and the pool's tail refills
  // the display up to four slots.
  const moves: PokemonMoveInfo[] = [];
  for (const candidate of applyCoherenceVetoes(pool, { itemId: idOf(itemSetValue(item.value)) })) {
    const move = infoFor.get(candidate.name);
    if (!move) continue;
    if (!candidate.guessed || moves.length < 4) moves.push(move);
  }

  return {
    ...pokemon,
    ability: normalizeAbilityField(pokemon.ability, usageSet?.ability, curated?.ability ?? smogonSet?.ability, pokemon.ruledOut?.abilities, !!curated),
    item,
    evs: normalizeEvsField(pokemon.evs, usageSet?.spread, curated?.spread ?? smogonSet?.spread, !!curated),
    nature: normalizeNatureField(pokemon.nature, usageSet?.spread, curated?.spread ?? smogonSet?.spread, !!curated),
    moves,
  };
}

export function enrichTeamInfo(
  teamInfo: OpponentTeamInfo,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
): OpponentTeamInfo {
  return {
    pokemon: teamInfo.pokemon.map(pokemon => enrichPokemonInfo(pokemon, usageStats, setAssumptions)),
  };
}
