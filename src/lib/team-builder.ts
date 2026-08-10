import type { PokemonSet } from '@pkmn/sim';
import { Dex, Teams } from '@pkmn/sim';
import { inferOpponentTeam } from './opponent-inferrer';
import { getSpeciesUsageSet, type SmogonUsageStats } from './smogon-stats';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from './smogon-sets';
import { applyCoherenceVetoes, selectCuratedSet, type MoveCandidate } from './set-coherence';
import { itemSetValue } from './team-info';
import { evBudget, inferSpreads, legalizeEvs, type SpreadCandidate } from './spread-inference';
import type { DamageObservation, KnowledgeSource, OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo } from '../types';

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Usage-move candidates fetched per species — vetoes refill from the tail. */
const USAGE_MOVE_POOL = 10;

/**
 * Build PokemonSet arrays for both sides from a replay's protocol log.
 * Pasted teams take precedence for the user's side; otherwise hidden data can
 * be filled from Smogon usage probabilities when those stats are available.
 */
export function buildTeamsFromReplay(
  log: string,
  options?: {
    userTeamText?: string;
    p1Info?: OpponentTeamInfo | null;
    p2Info?: OpponentTeamInfo | null;
    usageStats?: SmogonUsageStats | null;
    setAssumptions?: SmogonSetAssumptions | null;
    /** Precomputed damage-consistent spreads, keyed `side:speciesId`. */
    inferredSpreads?: Map<string, SpreadCandidate>;
    /**
     * Raw damage observations: the builder solves spreads itself — base
     * guesses first, then the solver, then a rebuild with the overlay.
     */
    observations?: DamageObservation[];
  },
): { p1Team: PokemonSet[]; p2Team: PokemonSet[] } {
  const p1Info = options?.p1Info || inferOpponentTeam(log, 'p1');
  const p2Info = options?.p2Info || inferOpponentTeam(log, 'p2');
  const embeddedTeams = extractEmbeddedShowteamExports(log);

  let userTeam: PokemonSet[] | null = null;
  if (options?.userTeamText?.trim()) {
    const imported = Teams.import(options.userTeamText);
    if (imported && imported.length > 0) {
      userTeam = imported;
    }
  }

  const p1KnownTeam = userTeam || embeddedTeams.p1 || null;
  const p2KnownTeam = embeddedTeams.p2 || null;
  // Pokémon Champions uses its own EV system (32 per stat, 66 total) —
  // standard-scale guesses/fallbacks must be clamped to the format budget.
  const gen = log.match(/^\|gen\|(\d)/m)?.[1] ?? '9';
  const formatHint = /^\|tier\|.*champions/im.test(log) ? `gen${gen}champions` : `gen${gen}`;
  const champions = evBudget(formatHint).perStat !== 252;
  const legalize = (team: PokemonSet[]): PokemonSet[] =>
    (champions ? team.map(set => ({ ...set, evs: legalizeEvs(set.evs, formatHint) })) : team);
  const build = (inferred?: Map<string, SpreadCandidate>) => ({
    p1Team: legalize(p1Info.pokemon.map(pokemon => buildSet(
      pokemon, p1KnownTeam, options?.usageStats, options?.setAssumptions,
      inferred?.get(`p1:${toId(pokemon.species)}`)))),
    p2Team: legalize(p2Info.pokemon.map(pokemon => buildSet(
      pokemon, p2KnownTeam, options?.usageStats, options?.setAssumptions,
      inferred?.get(`p2:${toId(pokemon.species)}`)))),
  });

  let inferred = options?.inferredSpreads;
  if (!inferred && options?.observations && options.observations.length > 0) {
    const base = build();
    inferred = inferSpreads(options.observations, { p1: base.p1Team, p2: base.p2Team }, formatHint);
  }
  return build(inferred);
}

/**
 * Solves the damage-consistent spreads once for a replay. The solve is
 * deterministic in (log, observations, build inputs) and runs thousands of
 * calc calls — memoize this per replay and hand the result to
 * buildTeamsFromReplay as `inferredSpreads` instead of passing raw
 * `observations` at every call site.
 */
export function solveReplaySpreads(
  log: string,
  observations: DamageObservation[],
  options?: Omit<Parameters<typeof buildTeamsFromReplay>[1], 'observations' | 'inferredSpreads'>,
): Map<string, SpreadCandidate> {
  if (observations.length === 0) return new Map();
  const base = buildTeamsFromReplay(log, options);
  const gen = log.match(/^\|gen\|(\d)/m)?.[1] ?? '9';
  const formatHint = /^\|tier\|.*champions/im.test(log) ? `gen${gen}champions` : `gen${gen}`;
  return inferSpreads(observations, { p1: base.p1Team, p2: base.p2Team }, formatHint);
}

function buildSet(
  info: RevealedPokemonInfo,
  userTeam: PokemonSet[] | null,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
  inferred?: SpreadCandidate,
): PokemonSet {
  const editedEvs = info.evs?.source === 'manual' || info.evs?.source === 'revealed'
    ? sanitizeEvs(info.evs.value)
    : null;
  const editedNature = (info.nature?.source === 'manual' || info.nature?.source === 'revealed') && info.nature.value
    ? (info.nature.value as PokemonSet['nature'])
    : null;
  const editedIvs = info.ivs?.source === 'manual' || info.ivs?.source === 'revealed'
    ? info.ivs.value
    : null;
  // Only knowledge that outranks a team sheet: seen in game or user-edited.
  // Enriched infos carry usage GUESSES in value — a 58% Leftovers guess must
  // never beat a sheet's Choice Scarf.
  const known = (field: { value: string; source: KnowledgeSource }) =>
    field.source === 'revealed' || field.source === 'manual' ? field.value : '';
  const userMatch = userTeam?.find(candidate => {
    const candidateId = toId(candidate.species);
    const infoId = toId(info.species);
    return candidateId === infoId ||
      toId(candidate.name || '') === infoId ||
      candidateId === toId(info.species.split('-')[0]) ||
      infoId === toId(candidate.species.split('-')[0]);
  });

  const usageSet = getSpeciesUsageSet(usageStats, info.species, info.ruledOut, USAGE_MOVE_POOL);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, info.species);
  const allowed = (value: string | undefined, ruledOut?: string[]) =>
    value && !(ruledOut ?? []).includes(toId(value)) ? value : '';

  if (userMatch) {
    // A full team sheet normally defines the moveset — but a manual edit
    // (team editor, sets import, hypothetical move) must beat the sheet, or
    // "load Draco Meteor on Kyurem" silently vanishes on sheet replays.
    const hasManualMoves = info.moves.some(move => move.source === 'manual');
    const infoMoveNames = info.moves.map(move => move.name);
    const moves = hasManualMoves
      ? mergeMoveLists(userMatch.moves, infoMoveNames)
      : mergeMoveLists(infoMoveNames, userMatch.moves);
    // Open Team Sheets omit EVs/nature — fall back to usage spreads instead of
    // simulating an all-zero spread (B3/B6).
    const fallbackSpread = usageSet?.spread || smogonSet?.spread || null;
    const matchEvs = hasNonZeroEvs(userMatch.evs) ? userMatch.evs : fallbackSpread?.evs || userMatch.evs;
    return {
      ...userMatch,
      moves: moves.length > 0 ? moves : userMatch.moves,
      ability: known(info.ability) || userMatch.ability,
      item: cleanItem(known(info.item), userMatch.item),
      teraType: known(info.teraType) || userMatch.teraType,
      nature: (editedNature || userMatch.nature || fallbackSpread?.nature || 'Hardy') as PokemonSet['nature'],
      evs: editedEvs || matchEvs,
      ivs: editedIvs || userMatch.ivs,
      level: info.level || userMatch.level || 100,
      gender: (info.gender || userMatch.gender || '') as '' | 'M' | 'F',
    };
  }
  // Coherent-set selection: score every published set against the revealed
  // evidence — a winning curated set fills the unrevealed slots as one
  // internally coherent unit instead of independent marginals.
  const curated = smogonSet ? selectCuratedSet([smogonSet, ...(smogonSet.alternatives ?? [])], {
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

  const curatedItem = curated ? allowed(curated.item?.value, info.ruledOut?.items) : '';
  const item = cleanItem(known(info.item), curatedItem) ||
    cleanItem(info.item.value, usageSet?.item?.value || allowed(smogonSet?.item?.value, info.ruledOut?.items));
  // Move assembly: revealed/manual knowledge first (immune to vetoes), then
  // the winning curated set's moves, then usage fills. Coherence vetoes drop
  // jointly implausible fills, and the deeper usage pool refills the slots.
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
  const moves = applyCoherenceVetoes(pool, { itemId: toId(item) })
    .slice(0, 4)
    .map(candidate => candidate.name);
  const spread = usageSet?.spread;
  const setSpread = smogonSet?.spread;
  const curatedAbility = curated ? allowed(curated.ability?.value, info.ruledOut?.abilities) : '';

  return {
    name: info.species,
    species: info.species,
    item,
    ability: known(info.ability) || curatedAbility || info.ability.value ||
      usageSet?.ability?.value || allowed(smogonSet?.ability?.value, info.ruledOut?.abilities) ||
      defaultAbility(info.species, info.ruledOut?.abilities),
    moves: moves.length > 0 ? moves : ['Tackle'],
    // Damage-consistent spreads beat usage guesses, never edited/revealed EVs.
    nature: (editedNature || inferred?.nature || curated?.spread?.nature || spread?.nature || setSpread?.nature || 'Hardy') as PokemonSet['nature'],
    evs: editedEvs || inferred?.evs || curated?.spread?.evs || spread?.evs || setSpread?.evs || defaultEvsFor(info.species),
    ivs: editedIvs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: info.level || 100,
    gender: (info.gender || '') as '' | 'M' | 'F',
    teraType: info.teraType.value || undefined,
  };
}

function hasNonZeroEvs(evs: PokemonSet['evs'] | undefined): boolean {
  return !!evs && Object.values(evs).some(value => (value ?? 0) > 0);
}

/**
 * Species-shaped last-resort spread (no usage data, no inference, no sets):
 * max the HIGHER base offense, plus Speed on fast species and HP otherwise.
 * The old flat 252 HP / 252 Atk default put physical EVs on special
 * attackers and left base-123-Speed Noivern outsped by everything (GPL).
 */
function defaultEvsFor(species: string): PokemonSet['evs'] {
  const data = Dex.species.get(species);
  const stats = data.exists ? data.baseStats : null;
  const offense: 'atk' | 'spa' = stats && stats.spa > stats.atk ? 'spa' : 'atk';
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

/** Public: the open-team-sheet sets both players posted, if any. */
export function extractTeamSheets(log: string): { p1: PokemonSet[] | null; p2: PokemonSet[] | null } {
  return extractEmbeddedShowteamExports(log);
}

function extractEmbeddedShowteamExports(log: string): { p1: PokemonSet[] | null; p2: PokemonSet[] | null } {
  const playerByName = new Map<string, 'p1' | 'p2'>();
  const fromShowteam: { p1: PokemonSet[] | null; p2: PokemonSet[] | null } = { p1: null, p2: null };
  const fromChat: { p1: PokemonSet[] | null; p2: PokemonSet[] | null } = { p1: null, p2: null };
  const unassigned: PokemonSet[][] = [];

  for (const rawLine of log.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const playerMatch = line.match(/^\|player\|(p[12])\|([^|]+)/);
    if (playerMatch) {
      playerByName.set(toId(playerMatch[2]), playerMatch[1] as 'p1' | 'p2');
      continue;
    }

    // Open Team Sheets: |showteam|p1|<packed team, pipes included> (B3)
    const showteamMatch = line.match(/^\|showteam\|(p[12])\|([\s\S]+)$/);
    if (showteamMatch) {
      const side = showteamMatch[1] as 'p1' | 'p2';
      if (!fromShowteam[side]) {
        const unpacked = Teams.unpack(showteamMatch[2]);
        if (unpacked && unpacked.length > 0) fromShowteam[side] = unpacked;
      }
      continue;
    }

    const chatMatch = line.match(/^\|c\|([^|]+)\|\/raw\s+([\s\S]+)$/);
    if (!chatMatch || !chatMatch[2].includes('<summary>View team</summary>')) continue;

    const imported = Teams.import(showteamHtmlToText(chatMatch[2]));
    if (!imported || imported.length === 0) continue;

    const side = playerByName.get(toId(chatMatch[1]));
    if (side) {
      fromChat[side] = imported;
    } else {
      unassigned.push(imported);
    }
  }

  if (!fromChat.p1 && unassigned[0]) fromChat.p1 = unassigned[0];
  if (!fromChat.p2 && unassigned[1]) fromChat.p2 = unassigned[1];
  return {
    p1: fromShowteam.p1 || fromChat.p1,
    p2: fromShowteam.p2 || fromChat.p2,
  };
}

function showteamHtmlToText(html: string): string {
  const match = html.match(/<summary>View team<\/summary>([\s\S]*?)<\/details>/i);
  const teamHtml = match?.[1] ?? html;
  return decodeHtmlEntities(teamHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCharCode(parseInt(value, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
