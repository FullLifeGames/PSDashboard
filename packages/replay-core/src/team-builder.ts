import type { PokemonSet } from '@pkmn/sim';
import { Teams } from '@pkmn/sim';
import { inferOpponentTeam, unpackSheetSets } from './opponent-inferrer.ts';
import { getSpeciesUsageSet } from './smogon/usage-lookup.ts';
import type { SmogonUsageStats } from './smogon/stats-types.ts';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from './smogon/sets-lookup.ts';
import { evBudget, inferSpreads, legalizeEvs, type SpreadCandidate } from './spread-inference.ts';
import { ALL_31_IVS, type EvBudget } from './spreads/ev-budget.ts';
import { boostItemIds } from './spreads/boost-items.ts';
import { observedMaxHp } from './spreads/max-hp.ts';
import { withHiddenPowerType } from './hidden-power.ts';
import {
  assembleMoves, buildSheetSet, editedFields, findUserMatch, resolveAbility, resolveItem, resolveItemWithout, resolveSpread,
  selectCuratedFor, USAGE_MOVE_POOL, usageMoveTail,
} from './team/set-resolvers.ts';
import { resolveInferredItems, speedKnowledgeFor } from './team/inferred-items.ts';
import { abilitiesAreFree, dexLegalSet } from './team/dex-legal.ts';
import { rocksMayMiss } from './inference/rocks-tell.ts';
import type { DamageObservation, HiddenPowerEvidence, OpponentTeamInfo, RevealedPokemonInfo, SpeedOrderObservation } from './types.ts';
import { genNumOf, toId } from './ids.ts';
import { normalizeLineEndings } from './line-endings.ts';

/**
 * Build PokemonSet arrays for both sides from a replay's protocol log.
 * Pasted teams take precedence for the user's side; otherwise hidden data can
 * be filled from Smogon usage probabilities when those stats are available.
 */
export function buildTeamsFromReplay(
  rawLog: string,
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
  return buildTeams(normalizeLineEndings(rawLog), options).teams;
}

type BuildOptions = Parameters<typeof buildTeamsFromReplay>[1];
type BuiltTeams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };
type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };

/**
 * The items the protocol inference itself guesses, by side and species: its
 * one tell, Heavy-Duty Boots after a Stealth Rock switch-in without damage.
 * Enriched infos mix them with the enrichment's own guesses, so they are read
 * from the log's inference (round 64, T120). A tell is evidence only while no
 * ability the Pokémon may have explains the missing damage as well: the
 * inference's own rock check (inference/rocks-tell.ts; round 64 review, a
 * Magic Guard Clefable shows the Boots tell without Boots).
 */
function itemTells(
  log: string, options: BuildOptions, infos: SideInfos, legality: { gen: number; freeAbilities: boolean },
): Record<'p1' | 'p2', Map<string, string>> {
  const tells = (side: 'p1' | 'p2') => {
    const raw = options?.[`${side}Info`] ? inferOpponentTeam(log, side) : infos[side];
    return new Map(raw.pokemon
      .filter(mon => mon.item.source === 'guessed' && mon.item.value && !rocksMayMiss(mon, legality.gen, legality.freeAbilities))
      .map(mon => [toId(mon.species), mon.item.value]));
  };
  return { p1: tells('p1'), p2: tells('p2') };
}

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
  // Pokémon Champions counts Stat Points (32 per stat, 66 total) and every
  // IV is 31 (round 67, T145): a guess or fallback from an EV-scale source
  // reaches the Stat Point scale by the level-50 inverse (legalizeEvs), and
  // the sets keep every IV at 31, as the server plays them.
  const budget = evBudget(formatHint);
  const champions = budget.statPoints;
  const legality = { gen: parseInt(gen, 10), freeAbilities: abilitiesAreFree(log) };
  const legalize = (team: PokemonSet[]): PokemonSet[] =>
    (champions ? team.map(set => ({ ...set, evs: legalizeEvs(set.evs, formatHint), ivs: { ...ALL_31_IVS } })) : team)
      .map(set => dexLegalSet(withHappinessAssumption(set), legality));
  const hpFor = (side: 'p1' | 'p2') =>
    (options?.hpEvidence ?? []).filter(entry => entry.attackerSide === side);
  const hpTyped = (side: 'p1' | 'p2'): HiddenPowerTyping =>
    set => withHiddenPowerType(set, hpFor(side), options?.usageStats, parseInt(gen, 10));
  const tells = itemTells(log, options, infos, legality);
  const sideTeam = (side: 'p1' | 'p2', inferred?: Map<string, SpreadCandidate>) =>
    legalize(infos[side].pokemon.map(pokemon => buildSet(
      pokemon, knownTeams[side], options?.usageStats, options?.setAssumptions, inferred?.get(`${side}:${toId(pokemon.species)}`),
      { hpTyped: hpTyped(side), tellItem: tells[side].get(toId(pokemon.species)) ?? '', gen: legality.gen, budget })))
      .map(hpTyped(side));
  const build = (inferred?: Map<string, SpreadCandidate>) => ({ p1Team: sideTeam('p1', inferred), p2Team: sideTeam('p2', inferred) });

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
  carryOrdersOnly(solved, log, options, build, formatHint, infos, knownTeams);
  return resolveSolvedItems(solved, infos, formatHint, options?.usageStats, options?.setAssumptions);
}

/**
 * The one-stage chain forfeits like the app's two-stage chain: the orders-only solve (the app's pre-solve) is
 * the fallback of a mon the damage lines forfeit (round 69, B13, D8: 912045 Rillaboom).
 */
function carryOrdersOnly(
  solved: Map<string, SpreadCandidate>, log: string, options: BuildOptions, build: () => BuiltTeams, formatHint: string,
  infos: SideInfos, knownTeams: SideTeams,
): void {
  if (!options?.observations?.length || !options.speedOrders?.length) return;
  carryPreSolve(solved, inferredSpreadsFor(log, { ...options, observations: [] }, build, formatHint, infos, knownTeams));
}

/**
 * Solves the damage-consistent spreads once for a replay. The solve is
 * deterministic in (log, observations, build inputs) and runs thousands of
 * calc calls — memoize this per replay and hand the result to
 * buildTeamsFromReplay as `inferredSpreads` instead of passing raw
 * `observations` at every call site.
 */
export function solveReplaySpreads(
  rawLog: string,
  observations: DamageObservation[],
  options?: Omit<NonNullable<Parameters<typeof buildTeamsFromReplay>[1]>, 'observations' | 'inferredSpreads'>,
): Map<string, SpreadCandidate> {
  const { speedOrders = [], usageStats, setAssumptions, userTeamText } = options ?? {};
  if (observations.length === 0 && speedOrders.length === 0) return new Map();
  const log = normalizeLineEndings(rawLog);
  const infos = infosFor(log, options);
  const { teams: base, inferred: preSolved } = buildTeams(log, { ...options, p1Info: infos.p1, p2Info: infos.p2 });
  const solved = inferSpreads(observations, { p1: base.p1Team, p2: base.p2Team }, formatHintFor(log).formatHint,
    speedOrders, speedKnowledgeFor(infos, knownTeamsFor(log, userTeamText), usageStats), observedMaxHp(log));
  carryPreSolve(solved, preSolved);
  return resolveSolvedItems(solved, infos, formatHintFor(log).formatHint, usageStats, setAssumptions);
}

/**
 * The solver's item decisions as concrete items: a boost item the damage lines dropped (round 69, T26) becomes the
 * build's next choice beside every boost item and the Scarf, then a dropped Scarf resolves as before (round 37).
 */
function resolveSolvedItems(
  solved: Map<string, SpreadCandidate>, infos: SideInfos, formatHint: string,
  usageStats: SmogonUsageStats | null | undefined, setAssumptions: SmogonSetAssumptions | null | undefined,
): Map<string, SpreadCandidate> {
  const drops = new Map<string, SpreadCandidate>();
  for (const [key, candidate] of solved) {
    const [side, speciesId] = key.split(':') as ['p1' | 'p2', string];
    const info = infos[side].pokemon.find(mon => toId(mon.species) === speciesId);
    // A species with no item left in the build's lists keeps '' (no item): the Scarf resolver below must not hand the boost item back.
    if (candidate.itemReason === 'no-boost' && info) {
      drops.set(key, { ...candidate, item: resolveItemWithout(info, usageStats, setAssumptions, ['choicescarf', ...boostItemIds(genNumOf(formatHint))]) });
    }
  }
  const rest = resolveInferredItems(new Map([...solved].filter(([key]) => !drops.has(key))), infos, usageStats, setAssumptions);
  return new Map([...solved].map(([key, candidate]) => [key, drops.get(key) ?? rest.get(key) ?? candidate]));
}

/**
 * The base build's speed-only solve already decided the items and the
 * Speed the move orders asked for, and built both into its sets: the full
 * solve sees them as its prior. A mon the full solve forfeits (misfit
 * damage) leaves its map, and the caller's build would reach past that
 * prior to the usage guess, so the pre-solve's entry comes back for it,
 * with or without an item decision (round 53, 2658663776: the forfeit
 * handed Volcanion its 252 Spe back and broke four orders the pre-solve
 * held). A mon the full solve kept takes only the item decision and the
 * Speed IV the settling restored or lowered along (round 69, T132 point 2:
 * the full solve starts from those IVs, so its own answer carries none); so
 * does a forfeited mon whose max HP the log pinned, which stays in the map
 * as that same prior with the measured HP. A mon a pasted team or a team
 * sheet matches is the exception: buildSet returns the sheet set before it
 * reads `inferred`, so a carried entry reaches only the stats panel there.
 */
function carryPreSolve(solved: Map<string, SpreadCandidate>, preSolved: Map<string, SpreadCandidate> | undefined) {
  for (const [key, candidate] of preSolved ?? []) {
    const entry = solved.get(key);
    if (!entry) solved.set(key, candidate);
    else {
      const decided = candidate.item !== undefined && entry.item === undefined;
      const restored = candidate.ivs !== undefined && entry.ivs === undefined;
      if (decided || restored) {
        solved.set(key, {
          ...entry, ...(decided ? { item: candidate.item, itemReason: candidate.itemReason } : {}), ...(restored ? { ivs: candidate.ivs } : {}),
        });
      }
    }
  }
}

/** The build's Hidden Power step: a typeless "Hidden Power" takes its type from evidence or usage. */
type HiddenPowerTyping = (set: PokemonSet) => PokemonSet;

/** Per-Pokémon build context: the Hidden Power step, the item the inference tells, the generation and its EV budget (the default prior's start). */
interface SetContext {
  hpTyped: HiddenPowerTyping;
  tellItem: string;
  gen: number;
  budget: EvBudget;
}

function buildSet(
  info: RevealedPokemonInfo,
  userTeam: PokemonSet[] | null,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
  inferred?: SpreadCandidate,
  { hpTyped, tellItem, gen, budget }: SetContext = { hpTyped: set => set, tellItem: '', gen: 9, budget: evBudget('') },
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
    ? resolveItemWithout(info, usageStats, setAssumptions, inferred.itemReason === 'no-boost' ? ['choicescarf', ...boostItemIds(gen)] : 'choicescarf')
    : resolveItem(info, curated, usageSet, smogonSet, inferred?.item ?? '', tellItem);
  const moves = assembleMoves(info, curated, usageSet, smogonSet, item, usageMoveTail(usageStats, info.species));
  const revealedMoves = info.moves.filter(move => move.source === 'revealed').map(move => move.name);
  const spread = resolveSpread(info.species, edited, inferred, curated, usageSet, smogonSet, revealedMoves, budget);

  const set: PokemonSet = {
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
    // The log showed a Gigantamax: the simulator then plays the species' G-Max move (round 70).
    ...(info.gigantamax ? { gigantamax: true } : {}),
  };
  // A typeless Hidden Power reads its type before guessed IVs arrive: the step
  // keeps the type of deliberate (edited) IVs only, and the published or
  // solved ones are no such choice (round 64, T122: gen 6 Attack 0 would play
  // a Dragon-type Hidden Power).
  const default31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  return edited.editedIvs ? set : { ...hpTyped({ ...set, ivs: default31 }), ivs: spread.ivs };
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
export function extractTeamSheets(rawLog: string): { p1: PokemonSet[] | null; p2: PokemonSet[] | null } {
  return extractEmbeddedShowteamExports(normalizeLineEndings(rawLog));
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

  for (const line of log.split('\n')) {
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
        const unpacked = unpackSheetSets(showteamMatch[2]);
        if (unpacked.length > 0) fromShowteam[side] = unpacked;
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
