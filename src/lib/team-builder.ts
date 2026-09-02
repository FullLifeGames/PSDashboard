import type { PokemonSet } from '@pkmn/sim';
import { Teams } from '@pkmn/sim';
import { inferOpponentTeam } from './opponent-inferrer';
import { getSpeciesUsageSet, type SmogonUsageStats } from './smogon-stats';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from './smogon-sets';
import { evBudget, inferSpreads, legalizeEvs, type SpreadCandidate } from './spread-inference';
import { withHiddenPowerType } from './hidden-power';
import {
  assembleMoves, buildSheetSet, editedFields, findUserMatch, resolveAbility, resolveItem, resolveSpread, selectCuratedFor,
} from './team/set-resolvers';
import type { DamageObservation, HiddenPowerEvidence, OpponentTeamInfo, RevealedPokemonInfo, SpeedOrderObservation } from '../types';

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
    /** Observed same-turn move order — hard speed constraints for the solver. */
    speedOrders?: SpeedOrderObservation[];
    /** Typeless-HP effectiveness readings — type evidence for the resolver. */
    hpEvidence?: HiddenPowerEvidence[];
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
    (champions ? team.map(set => ({ ...set, evs: legalizeEvs(set.evs, formatHint) })) : team)
      .map(withHappinessAssumption);
  const hpFor = (side: 'p1' | 'p2') =>
    (options?.hpEvidence ?? []).filter(entry => entry.attackerSide === side);
  const build = (inferred?: Map<string, SpreadCandidate>) => ({
    p1Team: legalize(p1Info.pokemon.map(pokemon => buildSet(
      pokemon, p1KnownTeam, options?.usageStats, options?.setAssumptions,
      inferred?.get(`p1:${toId(pokemon.species)}`))))
      .map(built => withHiddenPowerType(built, hpFor('p1'), options?.usageStats, parseInt(gen, 10))),
    p2Team: legalize(p2Info.pokemon.map(pokemon => buildSet(
      pokemon, p2KnownTeam, options?.usageStats, options?.setAssumptions,
      inferred?.get(`p2:${toId(pokemon.species)}`))))
      .map(built => withHiddenPowerType(built, hpFor('p2'), options?.usageStats, parseInt(gen, 10))),
  });

  let inferred = options?.inferredSpreads;
  if (!inferred && ((options?.observations?.length ?? 0) > 0 || (options?.speedOrders?.length ?? 0) > 0)) {
    const base = build();
    inferred = inferSpreads(options?.observations ?? [], { p1: base.p1Team, p2: base.p2Team },
      formatHint, options?.speedOrders ?? []);
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
  options?: Omit<NonNullable<Parameters<typeof buildTeamsFromReplay>[1]>, 'observations' | 'inferredSpreads'>,
): Map<string, SpreadCandidate> {
  if (observations.length === 0 && (options?.speedOrders?.length ?? 0) === 0) return new Map();
  const base = buildTeamsFromReplay(log, options);
  const gen = log.match(/^\|gen\|(\d)/m)?.[1] ?? '9';
  const formatHint = /^\|tier\|.*champions/im.test(log) ? `gen${gen}champions` : `gen${gen}`;
  return inferSpreads(observations, { p1: base.p1Team, p2: base.p2Team }, formatHint, options?.speedOrders ?? []);
}

function buildSet(
  info: RevealedPokemonInfo,
  userTeam: PokemonSet[] | null,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
  inferred?: SpreadCandidate,
): PokemonSet {
  const edited = editedFields(info);
  const userMatch = findUserMatch(userTeam, info.species);
  const usageSet = getSpeciesUsageSet(usageStats, info.species, info.ruledOut, USAGE_MOVE_POOL);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, info.species);

  if (userMatch) return buildSheetSet(info, userMatch, edited, usageSet, smogonSet);

  const curated = selectCuratedFor(info, smogonSet, usageSet);
  const item = resolveItem(info, curated, usageSet, smogonSet);
  const moves = assembleMoves(info, curated, usageSet, smogonSet, item);
  const spread = resolveSpread(info.species, edited, inferred, curated, usageSet, smogonSet);

  return {
    name: info.species,
    species: info.species,
    item,
    ability: resolveAbility(info, curated, usageSet, smogonSet),
    moves: moves.length > 0 ? moves : ['Tackle'],
    nature: spread.nature,
    evs: spread.evs,
    ivs: spread.ivs,
    level: info.level || 100,
    gender: (info.gender || '') as '' | 'M' | 'F',
    teraType: info.teraType.value || undefined,
  };
}

/**
 * Showdown's teambuilder assumption: Frustration users run 0 happiness
 * (BP 102); Return users keep the sim default 255 (also BP 102). Explicit
 * values from sheets/imports win.
 */
function withHappinessAssumption(set: PokemonSet): PokemonSet {
  if (set.happiness !== undefined) return set;
  return set.moves.some(move => toId(move) === 'frustration') ? { ...set, happiness: 0 } : set;
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
