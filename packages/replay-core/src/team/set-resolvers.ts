import type { PokemonSet } from '@pkmn/sim';
import type { RulesDex } from '../rules-dex.ts';
import type { SmogonUsageStats, SpeciesUsageSet, UsageProbability } from '../smogon/stats-types.ts';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from '../smogon/sets-lookup.ts';
import { getSpeciesUsageSet, getSpeciesUsageStats } from '../smogon/usage-lookup.ts';
import { applyCoherenceVetoes, itemFromChosenSet, publishedIvs, selectCuratedSet, type MoveCandidate } from '../set-coherence.ts';
import { itemSetValue } from '../team-info.ts';
import type { SpreadCandidate } from '../spread-inference.ts';
import type { KnowledgeSource, PokemonEvs, RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';
import { evBudget, evsOfSet, type EvBudget } from '../spreads/ev-budget.ts';
import { slotMoveKey } from './move-slots.ts';
import { settleOpenMoves, unfilledOpenMoves } from './open-moves.ts';

type SmogonSet = ReturnType<typeof getSpeciesSetAssumption>;
type CuratedSet = ReturnType<typeof selectCuratedSet>;
/** A solved spread; the speed solver may add the IVs a seen move order demands. */
type SolvedSpread = SpreadCandidate & { ivs?: Partial<PokemonEvs> };

const ALL_31: PokemonSet['ivs'] = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/** Usage-move candidates fetched per species; the vetoes refill from the tail. */
export const USAGE_MOVE_POOL = 10;

/**
 * The usage moves past USAGE_MOVE_POOL: the last refill of a pool the vetoes left short (a set has under four moves only when the whole
 * pool holds fewer than four allowed moves).
 */
export function usageMoveTail(usageStats: SmogonUsageStats | null | undefined, species: string): UsageProbability[] {
  return getSpeciesUsageStats(species, usageStats)?.moves.slice(USAGE_MOVE_POOL) ?? [];
}

/** User-edited or in-game-revealed spread fields: they outrank every guess and every sheet. */
export interface EditedFields {
  editedEvs: PokemonEvs | null;
  editedNature: PokemonSet['nature'] | null;
  /**
   * The nature the info shows beside EVs the user set. The panel keeps it (`applyInferredSpreads` leaves a body with set EVs alone), so the
   * build plays it: the solver's nature is fitted to the solver's own EVs.
   */
  shownNature: PokemonSet['nature'] | null;
  editedIvs: PokemonSet['ivs'] | null;
}

function shownNatureOf(info: RevealedPokemonInfo, editedEvs: PokemonEvs | null): PokemonSet['nature'] | null {
  return editedEvs && info.nature?.value ? (info.nature.value as PokemonSet['nature']) : null;
}

export function editedFields(info: RevealedPokemonInfo): EditedFields {
  const editedEvs = info.evs?.source === 'manual' || info.evs?.source === 'revealed'
    ? sanitizeEvs(info.evs.value)
    : null;
  const editedNature = (info.nature?.source === 'manual' || info.nature?.source === 'revealed') && info.nature.value
    ? (info.nature.value as PokemonSet['nature'])
    : null;
  const editedIvs = info.ivs?.source === 'manual' || info.ivs?.source === 'revealed'
    ? info.ivs.value
    : null;
  return { editedEvs, editedNature, shownNature: shownNatureOf(info, editedEvs), editedIvs };
}

/**
 * Only knowledge that outranks a team sheet: seen in game or user-edited. Enriched infos carry usage GUESSES in value: a 58% Leftovers guess
 * must never beat a sheet's Choice Scarf.
 */
function known(field: { value: string; source: KnowledgeSource }): string {
  return field.source === 'revealed' || field.source === 'manual' ? field.value : '';
}

export function findUserMatch(userTeam: PokemonSet[] | null, species: string): PokemonSet | undefined {
  return userTeam?.find(candidate => {
    const candidateId = toId(candidate.species);
    const infoId = toId(species);
    return candidateId === infoId ||
      toId(candidate.name || '') === infoId ||
      candidateId === toId(species.split('-')[0]) ||
      infoId === toId(candidate.species.split('-')[0]);
  });
}

function allowed(value: string | undefined, ruledOut?: string[]): string {
  return value && !(ruledOut ?? []).includes(toId(value)) ? value : '';
}

type FallbackSpread = { nature: string; evs: PokemonSet['evs'] } | null;

/** The sheet's spread gaps fill from usage, then the marginal set. */
function fallbackSpreadFor(usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet): FallbackSpread {
  return usageSet?.spread || smogonSet?.spread || null;
}

/**
 * A sheet that shows no EVs leaves them unknown, not zero: the solver's EVs (a spread the damage, the move order or the HP lines checked, never
 * its prior) come before the usage fallback; the sheet's nature and IVs stay.
 */
function sheetSpread(
  userMatch: PokemonSet, edited: EditedFields, fallbackSpread: FallbackSpread, inferred?: SpreadCandidate,
): { nature: PokemonSet['nature']; evs: PokemonSet['evs']; ivs: PokemonSet['ivs'] } {
  const solvedEvs = inferred && inferred.origin !== 'prior' ? inferred.evs : undefined;
  const matchEvs = hasNonZeroEvs(userMatch.evs) ? userMatch.evs : solvedEvs || fallbackSpread?.evs || userMatch.evs;
  return {
    nature: (edited.editedNature || userMatch.nature || fallbackSpread?.nature || 'Hardy') as PokemonSet['nature'],
    evs: edited.editedEvs || matchEvs,
    ivs: edited.editedIvs || userMatch.ivs,
  };
}

/**
 * A full team sheet normally defines the moveset, but a manual edit (team editor, sets import, hypothetical move) must beat it, or "load Draco
 * Meteor on Kyurem" silently vanishes on sheet replays. Open Team Sheets omit EVs and nature: fall back to usage spreads instead of simulating
 * an all-zero spread.
 */
export function buildSheetSet(
  info: RevealedPokemonInfo,
  userMatch: PokemonSet,
  edited: EditedFields,
  usageSet: SpeciesUsageSet | null,
  smogonSet: SmogonSet,
  inferred?: SpreadCandidate,
): PokemonSet {
  const hasManualMoves = info.moves.some(move => move.source === 'manual');
  const infoMoveNames = info.moves.map(move => move.name);
  const moves = hasManualMoves
    ? mergeMoveLists(userMatch.moves, infoMoveNames)
    : mergeMoveLists(infoMoveNames, userMatch.moves);
  const spread = sheetSpread(userMatch, edited, fallbackSpreadFor(usageSet, smogonSet), inferred);
  return {
    ...userMatch,
    moves: moves.length > 0 ? moves : userMatch.moves,
    ability: known(info.ability) || userMatch.ability,
    item: cleanItem(known(info.item), userMatch.item),
    teraType: known(info.teraType) || userMatch.teraType,
    nature: spread.nature,
    evs: spread.evs,
    ivs: spread.ivs,
    level: info.level || userMatch.level || 100,
    gender: (info.gender || userMatch.gender || '') as '' | 'M' | 'F',
  };
}

/** Coherent-set selection: scores every published set against the revealed evidence; the winner fills the unrevealed slots as one unit. */
export function selectCuratedFor(dex: RulesDex, info: RevealedPokemonInfo, smogonSet: SmogonSet, usageSet: SpeciesUsageSet | null): CuratedSet | null {
  const seen = info.moves.filter(move => move.source === 'revealed' || move.source === 'manual');
  return smogonSet ? selectCuratedSet([smogonSet, ...(smogonSet.alternatives ?? [])], {
    dex,
    revealedMoves: seen.map(move => toId(move.name)),
    // The Z-moves and Max moves the revealed moves do not explain: a set with a move to fill them fits better.
    openMoves: unfilledOpenMoves(dex, info.openMoves, seen.map(move => move.name)),
    // A consumed or knocked-off item is still the set's item.
    revealedItem: toId(itemSetValue(known(info.item))),
    revealedAbility: toId(known(info.ability)),
    ruledOutItems: info.ruledOut?.items ?? [],
    ruledOutAbilities: info.ruledOut?.abilities ?? [],
    usageProbability: moveId =>
      usageSet?.moves.find(move => toId(move.value) === moveId)?.probability ?? 0,
    // The item after a rule-out: the info's guess (the Boots tell, or the enrichment's own pick), then the usage majority.
    guessedItem: info.item.source === 'guessed' ? itemSetValue(info.item.value) : '',
    usageItem: usageSet?.item?.value ?? '',
  }) : null;
}

/**
 * Known (revealed, consumed) beats everything; then an item the move-order evidence inferred; then an item the protocol inference tells
 * (`tellItem`: Heavy-Duty Boots after a Stealth Rock switch-in without damage: evidence, as the panel shows it); then the curated set
 * and the usage marginal.
 */
export function resolveItem(
  info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet, inferredItem = '',
  tellItem = '',
): string {
  const evidence = itemSetValue(known(info.item)) || itemSetValue(inferredItem) || allowed(tellItem, info.ruledOut?.items);
  return evidence || guessedItem(info, curated, usageSet, smogonSet);
}

/** The guess when no evidence names the item: the curated set's, else the info's guess or the usage marginal. */
function guessedItem(info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet): string {
  const curatedItem = curated ? allowed(curated.item?.value, info.ruledOut?.items) : '';
  return curatedItem || cleanItem(info.item.value, usageSet?.item?.value || allowed(smogonSet?.item?.value, info.ruledOut?.items));
}

/** The item the build would pick if the excluded items were ruled out: the replacement for a dropped Scarf or a dropped boost item. */
export function resolveItemWithout(
  dex: RulesDex, info: RevealedPokemonInfo, usageStats: SmogonUsageStats | null | undefined, setAssumptions: SmogonSetAssumptions | null | undefined,
  excludedItemIds: string | readonly string[],
): string {
  const ruledOut = { abilities: info.ruledOut?.abilities ?? [], items: [...(info.ruledOut?.items ?? []), ...[excludedItemIds].flat()] };
  const stripped: RevealedPokemonInfo = {
    ...info, ruledOut,
    item: known(info.item) ? info.item : { value: '', source: 'unknown' },
  };
  const usageSet = getSpeciesUsageSet(usageStats, info.species, ruledOut, USAGE_MOVE_POOL);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, info.species);
  return resolveItem(stripped, selectCuratedFor(dex, stripped, smogonSet, usageSet), usageSet, smogonSet);
}

/**
 * Move assembly: revealed or manual knowledge first (immune to vetoes), then the winning curated set's moves (its slots already read against the
 * evidence), then the enrichment's guesses, then usage fills, the usage tail last. Coherence vetoes drop jointly implausible fills and the rest
 * of the pool refills the slots. The panel's enrichment offers the same order (team-info.ts).
 */
export function assembleMoves(
  dex: RulesDex, info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet, item: string,
  usageTail: UsageProbability[] = [],
): string[] {
  const pool: MoveCandidate[] = [];
  const pooled = new Set<string>();
  const offer = (name: string, candidate: Omit<MoveCandidate, 'name'>) => {
    if (pooled.has(slotMoveKey(dex, name))) return;
    pooled.add(slotMoveKey(dex, name));
    pool.push({ name, ...candidate });
  };
  const known = info.moves.filter(move => move.source === 'revealed' || move.source === 'manual');
  for (const move of known) offer(move.name, { guessed: false });
  // A guess the enrichment took from the usage tail stays a tail move (its boost serves nothing).
  const tailKeys = new Set(usageTail.map(fill => slotMoveKey(dex, fill.value)));
  for (const fill of curated?.moves ?? []) offer(fill.value, { guessed: true, fromSet: true });
  for (const move of info.moves) offer(move.name, { guessed: true, tail: tailKeys.has(slotMoveKey(dex, move.name)) || undefined });
  const fills = [...(usageSet?.moves ?? []), ...(curated ? [] : (smogonSet?.moves ?? []))];
  for (const fill of fills) offer(fill.value, { guessed: true });
  for (const fill of usageTail) offer(fill.value, { guessed: true, tail: true });
  const assemble = (candidates: MoveCandidate[]) =>
    applyCoherenceVetoes(candidates, { dex, itemId: toId(item), itemFromSet: itemFromChosenSet(dex, curated, item) }).slice(0, 4);
  return settleOpenMoves(dex, pool, info.openMoves, assemble).map(candidate => candidate.name);
}

export function resolveAbility(dex: RulesDex, info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet): string {
  const curatedAbility = curated ? allowed(curated.ability?.value, info.ruledOut?.abilities) : '';
  return known(info.ability) || curatedAbility || info.ability.value ||
    usageSet?.ability?.value || allowed(smogonSet?.ability?.value, info.ruledOut?.abilities) ||
    defaultAbility(dex, info.species, info.ruledOut?.abilities);
}

/** Damage-consistent spreads beat usage guesses, never edited/revealed EVs. */
type UsageSpreadLike = { nature: string; evs: PokemonSet['evs'] } | undefined;

function spreadNature(
  edited: EditedFields, inferred: SpreadCandidate | undefined, curated: CuratedSet | null,
  spread: UsageSpreadLike, setSpread: UsageSpreadLike,
): PokemonSet['nature'] {
  return (edited.editedNature || edited.shownNature || inferred?.nature || curated?.spread?.nature || spread?.nature || setSpread?.nature || 'Hardy') as PokemonSet['nature'];
}

function spreadEvs(
  dex: RulesDex, species: string, edited: EditedFields, inferred: SpreadCandidate | undefined, curated: CuratedSet | null,
  spread: UsageSpreadLike, setSpread: UsageSpreadLike, revealedMoves: string[], budget: EvBudget,
): PokemonSet['evs'] {
  return edited.editedEvs || inferred?.evs || curated?.spread?.evs || spread?.evs || setSpread?.evs ||
    defaultEvsFor(dex, species, revealedMoves, budget);
}

/**
 * The IVs, stat by stat: edited ones win whole, then an IV the speed solver decided, then the IVs the chosen Smogon set publishes (the first
 * set's when its spread is the one played), then 31.
 */
function spreadIvs(
  edited: EditedFields, inferred: SolvedSpread | undefined, curated: CuratedSet | null,
  usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet,
): PokemonSet['ivs'] {
  if (edited.editedIvs) return edited.editedIvs;
  const published = publishedIvs(curated, !!usageSet?.spread, smogonSet);
  return { ...ALL_31, ...published, ...inferred?.ivs };
}

export function resolveSpread(
  dex: RulesDex, species: string, edited: EditedFields, inferred: SolvedSpread | undefined, curated: CuratedSet | null,
  usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet, revealedMoves: string[] = [], budget: EvBudget = evBudget(''),
): { nature: PokemonSet['nature']; evs: PokemonSet['evs']; ivs: PokemonSet['ivs'] } {
  const spread = usageSet?.spread;
  const setSpread = smogonSet?.spread;
  return {
    nature: spreadNature(edited, inferred, curated, spread, setSpread),
    evs: spreadEvs(dex, species, edited, inferred, curated, spread, setSpread, revealedMoves, budget),
    ivs: spreadIvs(edited, inferred, curated, usageSet, smogonSet),
  };
}

function hasNonZeroEvs(evs: PokemonSet['evs'] | undefined): boolean {
  return !!evs && Object.values(evs).some(value => (value ?? 0) > 0);
}

/** The offense side the revealed attacks agree on; null when none or both categories were shown. */
function revealedOffense(dex: RulesDex, revealedMoves: string[]): 'atk' | 'spa' | null {
  const categories = new Set(
    revealedMoves.map(name => dex.moves.get(name))
      .filter(move => move.exists && move.category !== 'Status')
      .map(move => move.category),
  );
  if (categories.size !== 1) return null;
  return categories.has('Special') ? 'spa' : 'atk';
}

/**
 * Species-shaped last-resort spread (no usage data, no inference, no sets): max the HIGHER base offense, plus Speed on fast species and HP
 * otherwise. A flat 252 HP / 252 Atk would put physical EVs on special attackers and leave base-123-Speed Noivern outsped by everything.
 * Revealed attacks name the offense side first (a Kyurem that showed only Freeze-Dry defaulted to 252 Atk). Where the server gives a set
 * without EVs a start (Gens 1 and 2: 252 in every stat) that start is the default, whatever the species.
 */
function defaultEvsFor(dex: RulesDex, species: string, revealedMoves: string[], budget: EvBudget): PokemonSet['evs'] {
  if (budget.start > 0) return evsOfSet(undefined, budget);
  const data = dex.species.get(species);
  const stats = data.exists ? data.baseStats : null;
  const offense: 'atk' | 'spa' = revealedOffense(dex, revealedMoves) ?? (stats && stats.spa > stats.atk ? 'spa' : 'atk');
  const secondary: 'spe' | 'hp' = stats && stats.spe >= 80 ? 'spe' : 'hp';
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 };
  evs[offense] = 252;
  evs[secondary] = 252;
  return evs;
}

function sanitizeEv(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(252, Math.max(0, Math.round(value ?? 0)));
}

function sanitizeEvs(evs: PokemonEvs): PokemonEvs {
  return {
    hp: sanitizeEv(evs.hp),
    atk: sanitizeEv(evs.atk),
    def: sanitizeEv(evs.def),
    spa: sanitizeEv(evs.spa),
    spd: sanitizeEv(evs.spd),
    spe: sanitizeEv(evs.spe),
  };
}

function cleanItem(replayItem: string, fallback: string): string {
  return itemSetValue(replayItem) || fallback;
}

/**
 * A packed set with an empty ability gives the sim Pokemon NO ability at all (custom games skip team validation): a reconstructed Uxie died to
 * an Earthquake it should have been immune to. Slot 0 is Showdown's own teambuilder default when nothing better is known; protocol rule-outs
 * walk to the next slot (a Bronzong that took an Earthquake is not Levitate).
 */
function defaultAbility(dex: RulesDex, species: string, ruledOut?: string[]): string {
  const abilities = (dex.species.get(species).abilities ?? {}) as unknown as Record<string, string | undefined>;
  for (const slot of ['0', '1', 'H'] as const) {
    const ability = abilities[slot];
    if (ability && !(ruledOut ?? []).includes(toId(ability))) return ability;
  }
  // Every slot ruled out (single-ability species with contradictory evidence,
  // e.g. a video log's mis-read): keep slot 0 — a wrong ability beats none.
  return abilities['0'] || '';
}

/** `primary` defines the set; `fill` only tops it up to four moves. */
function mergeMoveLists(fill: string[], primary: string[]): string[] {
  const result = [...primary];
  for (const move of fill) {
    if (!result.some(existing => toId(existing) === toId(move))) {
      if (result.length < 4) {
        result.push(move);
      }
    }
  }
  return result.slice(0, 4);
}
