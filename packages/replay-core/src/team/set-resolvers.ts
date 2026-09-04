import type { PokemonSet } from '@pkmn/sim';
import { Dex } from '@pkmn/sim';
import type { SpeciesUsageSet } from '../smogon/stats-types.ts';
import { getSpeciesSetAssumption } from '../smogon/sets-lookup.ts';
import { applyCoherenceVetoes, selectCuratedSet, type MoveCandidate } from '../set-coherence.ts';
import { itemSetValue } from '../team-info.ts';
import type { SpreadCandidate } from '../spread-inference.ts';
import type { KnowledgeSource, PokemonEvs, RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

type SmogonSet = ReturnType<typeof getSpeciesSetAssumption>;
type CuratedSet = ReturnType<typeof selectCuratedSet>;

/** User-edited or in-game-revealed spread fields: they outrank every guess and every sheet. */
export interface EditedFields {
  editedEvs: PokemonEvs | null;
  editedNature: PokemonSet['nature'] | null;
  editedIvs: PokemonSet['ivs'] | null;
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
  return { editedEvs, editedNature, editedIvs };
}

/**
 * Only knowledge that outranks a team sheet: seen in game or user-edited.
 * Enriched infos carry usage GUESSES in value — a 58% Leftovers guess must
 * never beat a sheet's Choice Scarf.
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

/**
 * A full team sheet normally defines the moveset — but a manual edit
 * (team editor, sets import, hypothetical move) must beat the sheet, or
 * "load Draco Meteor on Kyurem" silently vanishes on sheet replays.
 * Open Team Sheets omit EVs/nature — fall back to usage spreads instead of
 * simulating an all-zero spread (B3/B6).
 */
type FallbackSpread = { nature: string; evs: PokemonSet['evs'] } | null;

/** The sheet's spread gaps fill from usage, then the marginal set. */
function fallbackSpreadFor(usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet): FallbackSpread {
  return usageSet?.spread || smogonSet?.spread || null;
}

function sheetSpread(
  userMatch: PokemonSet, edited: EditedFields, fallbackSpread: FallbackSpread,
): { nature: PokemonSet['nature']; evs: PokemonSet['evs']; ivs: PokemonSet['ivs'] } {
  const matchEvs = hasNonZeroEvs(userMatch.evs) ? userMatch.evs : fallbackSpread?.evs || userMatch.evs;
  return {
    nature: (edited.editedNature || userMatch.nature || fallbackSpread?.nature || 'Hardy') as PokemonSet['nature'],
    evs: edited.editedEvs || matchEvs,
    ivs: edited.editedIvs || userMatch.ivs,
  };
}

export function buildSheetSet(
  info: RevealedPokemonInfo,
  userMatch: PokemonSet,
  edited: EditedFields,
  usageSet: SpeciesUsageSet | null,
  smogonSet: SmogonSet,
): PokemonSet {
  const hasManualMoves = info.moves.some(move => move.source === 'manual');
  const infoMoveNames = info.moves.map(move => move.name);
  const moves = hasManualMoves
    ? mergeMoveLists(userMatch.moves, infoMoveNames)
    : mergeMoveLists(infoMoveNames, userMatch.moves);
  const spread = sheetSpread(userMatch, edited, fallbackSpreadFor(usageSet, smogonSet));
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

/**
 * Coherent-set selection: score every published set against the revealed
 * evidence — a winning curated set fills the unrevealed slots as one
 * internally coherent unit instead of independent marginals.
 */
export function selectCuratedFor(info: RevealedPokemonInfo, smogonSet: SmogonSet, usageSet: SpeciesUsageSet | null): CuratedSet | null {
  return smogonSet ? selectCuratedSet([smogonSet, ...(smogonSet.alternatives ?? [])], {
    revealedMoves: info.moves
      .filter(move => move.source === 'revealed' || move.source === 'manual')
      .map(move => toId(move.name)),
    revealedItem: toId(known(info.item)),
    revealedAbility: toId(known(info.ability)),
    ruledOutItems: info.ruledOut?.items ?? [],
    ruledOutAbilities: info.ruledOut?.abilities ?? [],
    usageProbability: moveId =>
      usageSet?.moves.find(move => toId(move.value) === moveId)?.probability ?? 0,
  }) : null;
}

export function resolveItem(info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet): string {
  const curatedItem = curated ? allowed(curated.item?.value, info.ruledOut?.items) : '';
  return cleanItem(known(info.item), curatedItem) ||
    cleanItem(info.item.value, usageSet?.item?.value || allowed(smogonSet?.item?.value, info.ruledOut?.items));
}

/**
 * Move assembly: revealed/manual knowledge first (immune to vetoes), then
 * the winning curated set's moves, then usage fills. Coherence vetoes drop
 * jointly implausible fills, and the deeper usage pool refills the slots.
 */
export function assembleMoves(
  info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet, item: string,
): string[] {
  const pool: MoveCandidate[] = info.moves.map(move => ({
    name: move.name,
    guessed: move.source !== 'revealed' && move.source !== 'manual',
  }));
  const pooled = new Set(pool.map(candidate => toId(candidate.name)));
  for (const fill of [
    ...(curated?.moves ?? []),
    ...(usageSet?.moves ?? []),
    ...(curated ? [] : (smogonSet?.moves ?? [])),
  ]) {
    if (pooled.has(toId(fill.value))) continue;
    pooled.add(toId(fill.value));
    pool.push({ name: fill.value, guessed: true });
  }
  return applyCoherenceVetoes(pool, { itemId: toId(item) })
    .slice(0, 4)
    .map(candidate => candidate.name);
}

export function resolveAbility(info: RevealedPokemonInfo, curated: CuratedSet | null, usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet): string {
  const curatedAbility = curated ? allowed(curated.ability?.value, info.ruledOut?.abilities) : '';
  return known(info.ability) || curatedAbility || info.ability.value ||
    usageSet?.ability?.value || allowed(smogonSet?.ability?.value, info.ruledOut?.abilities) ||
    defaultAbility(info.species, info.ruledOut?.abilities);
}

/** Damage-consistent spreads beat usage guesses, never edited/revealed EVs. */
type UsageSpreadLike = { nature: string; evs: PokemonSet['evs'] } | undefined;

function spreadNature(
  edited: EditedFields, inferred: SpreadCandidate | undefined, curated: CuratedSet | null,
  spread: UsageSpreadLike, setSpread: UsageSpreadLike,
): PokemonSet['nature'] {
  return (edited.editedNature || inferred?.nature || curated?.spread?.nature || spread?.nature || setSpread?.nature || 'Hardy') as PokemonSet['nature'];
}

function spreadEvs(
  species: string, edited: EditedFields, inferred: SpreadCandidate | undefined, curated: CuratedSet | null,
  spread: UsageSpreadLike, setSpread: UsageSpreadLike, revealedMoves: string[],
): PokemonSet['evs'] {
  return edited.editedEvs || inferred?.evs || curated?.spread?.evs || spread?.evs || setSpread?.evs ||
    defaultEvsFor(species, revealedMoves);
}

export function resolveSpread(
  species: string, edited: EditedFields, inferred: SpreadCandidate | undefined, curated: CuratedSet | null,
  usageSet: SpeciesUsageSet | null, smogonSet: SmogonSet, revealedMoves: string[] = [],
): { nature: PokemonSet['nature']; evs: PokemonSet['evs']; ivs: PokemonSet['ivs'] } {
  const spread = usageSet?.spread;
  const setSpread = smogonSet?.spread;
  return {
    nature: spreadNature(edited, inferred, curated, spread, setSpread),
    evs: spreadEvs(species, edited, inferred, curated, spread, setSpread, revealedMoves),
    ivs: edited.editedIvs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

function hasNonZeroEvs(evs: PokemonSet['evs'] | undefined): boolean {
  return !!evs && Object.values(evs).some(value => (value ?? 0) > 0);
}

/** The offense side the revealed attacks agree on; null when none or both categories were shown. */
function revealedOffense(revealedMoves: string[]): 'atk' | 'spa' | null {
  const categories = new Set(
    revealedMoves.map(name => Dex.moves.get(name))
      .filter(move => move.exists && move.category !== 'Status')
      .map(move => move.category),
  );
  if (categories.size !== 1) return null;
  return categories.has('Special') ? 'spa' : 'atk';
}

/**
 * Species-shaped last-resort spread (no usage data, no inference, no sets):
 * max the HIGHER base offense, plus Speed on fast species and HP otherwise.
 * The old flat 252 HP / 252 Atk default put physical EVs on special
 * attackers and left base-123-Speed Noivern outsped by everything (GPL).
 * Revealed attacks name the offense side first (573756's Kyurem showed
 * only Freeze-Dry and defaulted to 252 Atk).
 */
function defaultEvsFor(species: string, revealedMoves: string[]): PokemonSet['evs'] {
  const data = Dex.species.get(species);
  const stats = data.exists ? data.baseStats : null;
  const offense: 'atk' | 'spa' = revealedOffense(revealedMoves) ?? (stats && stats.spa > stats.atk ? 'spa' : 'atk');
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
 * A packed set with an empty ability gives the sim Pokémon NO ability at all
 * (custom games skip team validation) — the GPL reconstruction's Uxie died to
 * an Earthquake it should have been immune to. Slot 0 is Showdown's own
 * teambuilder default when nothing better is known; protocol rule-outs walk
 * to the next slot (a Bronzong that took an Earthquake is not Levitate).
 */
function defaultAbility(species: string, ruledOut?: string[]): string {
  const abilities = (Dex.species.get(species).abilities ?? {}) as unknown as Record<string, string | undefined>;
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
