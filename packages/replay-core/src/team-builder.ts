import type { PokemonSet } from '@pkmn/sim';
import { Teams } from '@pkmn/sim';
import { inferOpponentTeam } from './opponent-inferrer.ts';
import { getSpeciesUsageSet } from './smogon/usage-lookup.ts';
import type { SmogonUsageStats } from './smogon/stats-types.ts';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from './smogon/sets-lookup.ts';
import { evBudget, inferSpreads, legalizeEvs, type SpreadCandidate } from './spread-inference.ts';
import { observedMaxHp } from './spreads/max-hp.ts';
import { withHiddenPowerType } from './hidden-power.ts';
import {
  assembleMoves, buildSheetSet, editedFields, findUserMatch, resolveAbility, resolveItem, resolveItemWithout, resolveSpread,
  selectCuratedFor, USAGE_MOVE_POOL,
} from './team/set-resolvers.ts';
import { resolveInferredItems, speedKnowledgeFor } from './team/inferred-items.ts';
import type { DamageObservation, HiddenPowerEvidence, OpponentTeamInfo, RevealedPokemonInfo, SpeedOrderObservation } from './types.ts';
import { toId } from './ids.ts';

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
): BuiltTeams {
  return buildTeams(log, options).teams;
}

type BuildOptions = Parameters<typeof buildTeamsFromReplay>[1];
type BuiltTeams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };
type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };

function infosFor(log: string, options: BuildOptions): SideInfos {
  return { p1: options?.p1Info || inferOpponentTeam(log, 'p1'), p2: options?.p2Info || inferOpponentTeam(log, 'p2') };
}

/** The user's pasted team, else the sheets embedded in the log. */
function knownTeamsFor(log: string, userTeamText: string | undefined): SideTeams {
  const embeddedTeams = extractEmbeddedShowteamExports(log);
  const userTeam = importedUserTeam(userTeamText);
  return { p1: userTeam || embeddedTeams.p1 || null, p2: embeddedTeams.p2 || null };
}

/** The build plus the spreads it solved on the way (round 37: their item decisions ride into the app's solve). */
function buildTeams(log: string, options: BuildOptions): { teams: BuiltTeams; inferred: Map<string, SpreadCandidate> | undefined } {
  const infos = infosFor(log, options);
  const knownTeams = knownTeamsFor(log, options?.userTeamText);
  const { gen, formatHint } = formatHintFor(log);
  // Pokémon Champions uses its own EV system (32 per stat, 66 total) —
  // standard-scale guesses/fallbacks must be clamped to the format budget.
  const champions = evBudget(formatHint).perStat !== 252;
  const legalize = (team: PokemonSet[]): PokemonSet[] =>
    (champions ? team.map(set => ({ ...set, evs: legalizeEvs(set.evs, formatHint) })) : team)
      .map(withHappinessAssumption);
  const hpFor = (side: 'p1' | 'p2') =>
    (options?.hpEvidence ?? []).filter(entry => entry.attackerSide === side);
  const build = (inferred?: Map<string, SpreadCandidate>) => ({
    p1Team: legalize(infos.p1.pokemon.map(pokemon => buildSet(
      pokemon, knownTeams.p1, options?.usageStats, options?.setAssumptions,
      inferred?.get(`p1:${toId(pokemon.species)}`))))
      .map(built => withHiddenPowerType(built, hpFor('p1'), options?.usageStats, parseInt(gen, 10))),
    p2Team: legalize(infos.p2.pokemon.map(pokemon => buildSet(
      pokemon, knownTeams.p2, options?.usageStats, options?.setAssumptions,
      inferred?.get(`p2:${toId(pokemon.species)}`))))
      .map(built => withHiddenPowerType(built, hpFor('p2'), options?.usageStats, parseInt(gen, 10))),
  });

  const inferred = inferredSpreadsFor(log, options, build, formatHint, infos, knownTeams);
  return { teams: build(inferred), inferred };
}

/** A pasted user team, when the text parses to at least one set. */
function importedUserTeam(userTeamText: string | undefined): PokemonSet[] | null {
  if (!userTeamText?.trim()) return null;
  const imported = Teams.import(userTeamText);
  return imported && imported.length > 0 ? imported : null;
}

/** The generation digit and the format hint (Champions gets its own EV budget). */
function formatHintFor(log: string): { gen: string; formatHint: string } {
  const gen = log.match(/^\|gen\|(\d)/m)?.[1] ?? '9';
  const formatHint = /^\|tier\|.*champions/im.test(log) ? `gen${gen}champions` : `gen${gen}`;
  return { gen, formatHint };
}

function hasSpreadEvidence(options: BuildOptions): boolean {
  return (options?.observations?.length ?? 0) > 0 || (options?.speedOrders?.length ?? 0) > 0;
}

/**
 * Precomputed spreads win; otherwise raw observations solve against a base
 * build (guesses first, then the solver, then the caller rebuilds with the
 * overlay). The solver's item decisions come back resolved to concrete
 * items (round 37).
 */
function inferredSpreadsFor(
  log: string,
  options: BuildOptions,
  build: () => BuiltTeams,
  formatHint: string,
  infos: SideInfos,
  knownTeams: SideTeams,
): Map<string, SpreadCandidate> | undefined {
  const inferred = options?.inferredSpreads;
  if (inferred) return inferred;
  if (!hasSpreadEvidence(options)) return undefined;
  const base = build();
  const solved = inferSpreads(options?.observations ?? [], { p1: base.p1Team, p2: base.p2Team },
    formatHint, options?.speedOrders ?? [], speedKnowledgeFor(infos, knownTeams, options?.usageStats), observedMaxHp(log));
  return resolveInferredItems(solved, infos, options?.usageStats, options?.setAssumptions);
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
  const { speedOrders = [], usageStats, setAssumptions, userTeamText } = options ?? {};
  if (observations.length === 0 && speedOrders.length === 0) return new Map();
  const infos = infosFor(log, options);
  const { teams: base, inferred: preSolved } = buildTeams(log, { ...options, p1Info: infos.p1, p2Info: infos.p2 });
  const solved = inferSpreads(observations, { p1: base.p1Team, p2: base.p2Team }, formatHintFor(log).formatHint,
    speedOrders, speedKnowledgeFor(infos, knownTeamsFor(log, userTeamText), usageStats), observedMaxHp(log));
  carryItemDecisions(solved, preSolved);
  return resolveInferredItems(solved, infos, usageStats, setAssumptions);
}

/**
 * The base build's speed-only solve already decided the items and built
 * them into its sets, so the full solve sees them as set items; the
 * decisions ride into the result from that pre-solve.
 */
function carryItemDecisions(solved: Map<string, SpreadCandidate>, preSolved: Map<string, SpreadCandidate> | undefined) {
  for (const [key, candidate] of preSolved ?? []) {
    if (candidate.item === undefined) continue;
    const entry = solved.get(key);
    // A mon the full solve forfeited (misfit damage) keeps the pre-solve's spread and item.
    if (!entry) solved.set(key, candidate);
    else if (entry.item === undefined) solved.set(key, { ...entry, item: candidate.item, itemReason: candidate.itemReason });
  }
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
  // A dropped Scarf ('' from the solver) resolves without it: the guessed
  // Scarf must not return through the usage marginal (round 37).
  const item = inferred?.item === ''
    ? resolveItemWithout(info, usageStats, setAssumptions, 'choicescarf')
    : resolveItem(info, curated, usageSet, smogonSet, inferred?.item ?? '');
  const moves = assembleMoves(info, curated, usageSet, smogonSet, item);
  const revealedMoves = info.moves.filter(move => move.source === 'revealed').map(move => move.name);
  const spread = resolveSpread(info.species, edited, inferred, curated, usageSet, smogonSet, revealedMoves);

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

type SideTeams = { p1: PokemonSet[] | null; p2: PokemonSet[] | null };

/** A `/raw` chat line carrying a "View team" export: the poster's name and the parsed team. */
function chatTeamExport(line: string): { poster: string; team: PokemonSet[] } | null {
  const chatMatch = line.match(/^\|c\|([^|]+)\|\/raw\s+([\s\S]+)$/);
  if (!chatMatch || !chatMatch[2].includes('<summary>View team</summary>')) return null;
  const imported = Teams.import(showteamHtmlToText(chatMatch[2]));
  if (!imported || imported.length === 0) return null;
  return { poster: chatMatch[1], team: imported };
}

/** Sheets win over chat exports; unassigned chat exports fill the sides in posting order. */
function mergeSheetSources(fromShowteam: SideTeams, fromChat: SideTeams, unassigned: PokemonSet[][]): SideTeams {
  if (!fromChat.p1 && unassigned[0]) fromChat.p1 = unassigned[0];
  if (!fromChat.p2 && unassigned[1]) fromChat.p2 = unassigned[1];
  return {
    p1: fromShowteam.p1 || fromChat.p1,
    p2: fromShowteam.p2 || fromChat.p2,
  };
}

function extractEmbeddedShowteamExports(log: string): SideTeams {
  const playerByName = new Map<string, 'p1' | 'p2'>();
  const fromShowteam: SideTeams = { p1: null, p2: null };
  const fromChat: SideTeams = { p1: null, p2: null };
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

    const chat = chatTeamExport(line);
    if (!chat) continue;
    const side = playerByName.get(toId(chat.poster));
    if (side) {
      fromChat[side] = chat.team;
    } else {
      unassigned.push(chat.team);
    }
  }

  return mergeSheetSources(fromShowteam, fromChat, unassigned);
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
