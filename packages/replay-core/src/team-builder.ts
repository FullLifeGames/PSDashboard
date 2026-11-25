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
import { itemClauseLimit, resolveInferredItems, speedKnowledgeFor } from './team/inferred-items.ts';
import { abilitiesAreFree, dexLegalSet, type LegalityContext } from './team/dex-legal.ts';
import { dexOf, formatRules, logRules, type GameRules } from './rules-dex.ts';
import { rocksMayMiss } from './inference/rocks-tell.ts';
import type { DamageObservation, HiddenPowerEvidence, OpponentTeamInfo, RevealedPokemonInfo, SpeedOrderObservation } from './types.ts';
import { toId } from './ids.ts';
import { normalizeLineEndings } from './line-endings.ts';
import { isChampionsFormat } from './champions-format.ts';
import { withReplayIdentity } from './team-identity.ts';
import { withStandIns, type RandomSetFile } from './team/stand-ins.ts';

/** Builds the PokemonSet arrays of both sides from a protocol log: a pasted team wins for the user, usage fills in. */
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
    /** Raw damage observations: the builder solves the spreads itself. */
    observations?: DamageObservation[];
    speedOrders?: SpeedOrderObservation[];
    /** Typeless Hidden Power effectiveness readings: type evidence for the resolver. */
    hpEvidence?: HiddenPowerEvidence[];
    /**
     * The published random-set file of a format whose Dex entry generates the team (Random Battle): a side that showed
     * fewer bodies than its `|teamsize|` gets stand-ins from it; without it that side plays short.
     */
    randomSets?: RandomSetFile | null;
  },
): BuiltTeams {
  return buildTeams(normalizeLineEndings(rawLog), options).teams;
}

type BuildOptions = Parameters<typeof buildTeamsFromReplay>[1];
type BuiltTeams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };
type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };

// Read from the log's inference: enriched infos mix in the enrichment's own guesses. A tell counts only while no
// ability the Pokemon may have explains the missing damage as well (rocks-tell.ts: Magic Guard Clefable).
function itemTells(
  log: string, options: BuildOptions, infos: SideInfos, legality: LegalityContext,
): Record<'p1' | 'p2', Map<string, string>> {
  const tells = (side: 'p1' | 'p2') => {
    const raw = options?.[`${side}Info`] ? inferOpponentTeam(log, side) : infos[side];
    return new Map(raw.pokemon
      .filter(mon => mon.item.source === 'guessed' && mon.item.value && !rocksMayMiss(mon, dexOf(legality), legality.freeAbilities))
      .map(mon => [toId(mon.species), mon.item.value]));
  };
  return { p1: tells('p1'), p2: tells('p2') };
}

function infosFor(log: string, options: BuildOptions): SideInfos {
  const given = (side: 'p1' | 'p2') => options?.[`${side}Info`] || null;
  const inferred = { p1: given('p1') || inferOpponentTeam(log, 'p1'), p2: given('p2') || inferOpponentTeam(log, 'p2') };
  if (given('p1') && given('p2')) return inferred;
  const filled = withStandIns(inferred, log, options?.usageStats, { p1: importedUserTeam(options?.userTeamText) ?? [] }, options?.randomSets);
  const pick = (side: 'p1' | 'p2') => (given(side) ? inferred[side] : filled[side]);
  return { p1: pick('p1'), p2: pick('p2') };
}

function knownTeamsFor(log: string, userTeamText: string | undefined): SideTeams {
  const embeddedTeams = extractEmbeddedShowteamExports(log);
  const userTeam = importedUserTeam(userTeamText);
  return { p1: userTeam || embeddedTeams.p1 || null, p2: embeddedTeams.p2 || null };
}

function buildTeams(log: string, options: BuildOptions): { teams: BuiltTeams; inferred: Map<string, SpreadCandidate> | undefined } {
  const infos = infosFor(log, options);
  const knownTeams = knownTeamsFor(log, options?.userTeamText);
  const { formatHint } = formatHintFor(log);
  // Champions counts Stat Points (32 per stat, 66 total) with every IV at 31: legalizeEvs converts EV-scale guesses.
  const budget = evBudget(formatHint);
  const champions = budget.statPoints;
  const legality = { ...logRules(log), freeAbilities: abilitiesAreFree(log) };
  const legalize = (team: PokemonSet[]): PokemonSet[] =>
    (champions ? team.map(set => ({ ...set, evs: legalizeEvs(set.evs, formatHint), ivs: { ...ALL_31_IVS } })) : team)
      .map(set => dexLegalSet(withHappinessAssumption(set), legality));
  const hpFor = (side: 'p1' | 'p2') =>
    (options?.hpEvidence ?? []).filter(entry => entry.attackerSide === side);
  const hpTyped = (side: 'p1' | 'p2'): HiddenPowerTyping =>
    set => withHiddenPowerType(set, hpFor(side), options?.usageStats, legality);
  const tells = itemTells(log, options, infos, legality);
  const sideTeam = (side: 'p1' | 'p2', inferred?: Map<string, SpreadCandidate>) =>
    legalize(infos[side].pokemon.map(pokemon => buildSet(
      pokemon, knownTeams[side], options?.usageStats, options?.setAssumptions, inferred?.get(`${side}:${toId(pokemon.species)}`),
      { hpTyped: hpTyped(side), tellItem: tells[side].get(toId(pokemon.species)) ?? '', rules: legality, budget })))
      .map(hpTyped(side))
      .map((set, index) => withReplayIdentity(set, infos[side].pokemon[index]));
  const build = (inferred?: Map<string, SpreadCandidate>) => ({ p1Team: sideTeam('p1', inferred), p2Team: sideTeam('p2', inferred) });

  const inferred = inferredSpreadsFor(log, options, build, formatHint, infos, knownTeams);
  return { teams: build(inferred), inferred };
}

function importedUserTeam(userTeamText: string | undefined): PokemonSet[] | null {
  if (!userTeamText?.trim()) return null;
  const imported = Teams.import(userTeamText);
  return imported && imported.length > 0 ? imported : null;
}

function formatHintFor(log: string): { gen: string; formatHint: string } {
  const gen = log.match(/^\|gen\|(\d)/m)?.[1] ?? '9';
  const formatHint = isChampionsFormat(log.match(/^\|tier\|(.*)$/m)?.[1] ?? '') ? `gen${gen}champions` : `gen${gen}`;
  return { gen, formatHint };
}

function hasSpreadEvidence(options: BuildOptions): boolean {
  return (options?.observations?.length ?? 0) > 0 || (options?.speedOrders?.length ?? 0) > 0;
}

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
    formatHint, options?.speedOrders ?? [], speedKnowledgeFor(infos, knownTeams, options?.usageStats, itemClauseLimit(log)), observedMaxHp(log));
  carryOrdersOnly(solved, log, options, build, formatHint, infos, knownTeams);
  return resolveSolvedItems(solved, infos, formatHint, options?.usageStats, options?.setAssumptions);
}

// The one-stage chain forfeits like the app's two-stage chain: the orders-only solve is a forfeited mon's fallback.
function carryOrdersOnly(
  solved: Map<string, SpreadCandidate>, log: string, options: BuildOptions, build: () => BuiltTeams, formatHint: string,
  infos: SideInfos, knownTeams: SideTeams,
): void {
  if (!options?.observations?.length || !options.speedOrders?.length) return;
  carryPreSolve(solved, inferredSpreadsFor(log, { ...options, observations: [] }, build, formatHint, infos, knownTeams));
}

/** Solves a replay's damage-consistent spreads once (thousands of calc calls); memoize, pass as `inferredSpreads`. */
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
    speedOrders, speedKnowledgeFor(infos, knownTeamsFor(log, userTeamText), usageStats, itemClauseLimit(log)), observedMaxHp(log));
  carryPreSolve(solved, preSolved);
  return resolveSolvedItems(solved, infos, formatHintFor(log).formatHint, usageStats, setAssumptions);
}

function resolveSolvedItems(
  solved: Map<string, SpreadCandidate>, infos: SideInfos, formatHint: string,
  usageStats: SmogonUsageStats | null | undefined, setAssumptions: SmogonSetAssumptions | null | undefined,
): Map<string, SpreadCandidate> {
  const drops = new Map<string, SpreadCandidate>();
  for (const [key, candidate] of solved) {
    const [side, speciesId] = key.split(':') as ['p1' | 'p2', string];
    const info = infos[side].pokemon.find(mon => toId(mon.species) === speciesId);
    // A species with no item left in the build's lists keeps '': the Scarf resolver must not hand the boost item back.
    if (candidate.itemReason === 'no-boost' && info) {
      drops.set(key, { ...candidate, item: resolveItemWithout(dexOf(formatRules(formatHint)), info, usageStats, setAssumptions, ['choicescarf', ...boostItemIds(dexOf(formatRules(formatHint)))]) });
    }
  }
  const rest = resolveInferredItems(dexOf(formatRules(formatHint)), new Map([...solved].filter(([key]) => !drops.has(key))), infos, usageStats, setAssumptions);
  return new Map([...solved].map(([key, candidate]) => [key, drops.get(key) ?? rest.get(key) ?? candidate]));
}

// A mon the full solve forfeits gets the pre-solve's entry back: the build would reach past it to the usage guess.
// A pasted team or sheet match is the exception: buildSet returns the sheet set before it reads `inferred`.
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

type HiddenPowerTyping = (set: PokemonSet) => PokemonSet;

interface SetContext {
  hpTyped: HiddenPowerTyping;
  tellItem: string;
  rules: GameRules;
  budget: EvBudget;
}

function buildSet(
  info: RevealedPokemonInfo,
  userTeam: PokemonSet[] | null,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
  inferred?: SpreadCandidate,
  { hpTyped, tellItem, rules, budget }: SetContext = { hpTyped: set => set, tellItem: '', rules: { gen: 9, mod: undefined }, budget: evBudget('') },
): PokemonSet {
  const edited = editedFields(info);
  const userMatch = findUserMatch(userTeam, info.species);
  const usageSet = getSpeciesUsageSet(usageStats, info.species, info.ruledOut, USAGE_MOVE_POOL);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, info.species);

  if (userMatch) return buildSheetSet(info, userMatch, edited, usageSet, smogonSet, inferred);

  const curated = selectCuratedFor(dexOf(rules), info, smogonSet, usageSet);
  // A dropped Scarf ('' from the solver) resolves without it: the guessed Scarf must not return via the usage marginal.
  const item = inferred?.item === ''
    ? resolveItemWithout(dexOf(rules), info, usageStats, setAssumptions, inferred.itemReason === 'no-boost' ? ['choicescarf', ...boostItemIds(dexOf(rules))] : 'choicescarf')
    : resolveItem(info, curated, usageSet, smogonSet, inferred?.item ?? '', tellItem);
  const moves = assembleMoves(dexOf(rules), info, curated, usageSet, smogonSet, item, usageMoveTail(usageStats, info.species));
  const revealedMoves = info.moves.filter(move => move.source === 'revealed').map(move => move.name);
  const spread = resolveSpread(dexOf(rules), info.species, edited, inferred, curated, usageSet, smogonSet, revealedMoves, budget);

  const set: PokemonSet = {
    name: info.species,
    species: info.species,
    item,
    ability: resolveAbility(dexOf(rules), info, curated, usageSet, smogonSet),
    moves: moves.length > 0 ? moves : ['Tackle'],
    nature: spread.nature,
    evs: spread.evs,
    ivs: spread.ivs,
    level: info.level || 100,
    gender: (info.gender || '') as '' | 'M' | 'F',
    teraType: info.teraType.value || undefined,
    // The log showed a Gigantamax: the simulator then plays the species' G-Max move.
    ...(info.gigantamax ? { gigantamax: true } : {}),
  };
  // A typeless Hidden Power reads its type before guessed IVs arrive: only edited IVs count (gen 6 Attack 0 is Dragon).
  const default31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  return edited.editedIvs ? set : { ...hpTyped({ ...set, ivs: default31 }), ivs: spread.ivs };
}

// Showdown's teambuilder: Frustration users run 0 happiness, Return users the sim default 255 (both BP 102).
function withHappinessAssumption(set: PokemonSet): PokemonSet {
  if (set.happiness !== undefined) return set;
  return set.moves.some(move => toId(move) === 'frustration') ? { ...set, happiness: 0 } : set;
}

/** The open-team-sheet sets both players posted, if any. */
export function extractTeamSheets(rawLog: string): { p1: PokemonSet[] | null; p2: PokemonSet[] | null } {
  return extractEmbeddedShowteamExports(normalizeLineEndings(rawLog));
}

type SideTeams = { p1: PokemonSet[] | null; p2: PokemonSet[] | null };

function chatTeamExport(line: string): { poster: string; team: PokemonSet[] } | null {
  const chatMatch = line.match(/^\|c\|([^|]+)\|\/raw\s+([\s\S]+)$/);
  if (!chatMatch || !chatMatch[2].includes('<summary>View team</summary>')) return null;
  const imported = Teams.import(showteamHtmlToText(chatMatch[2]));
  if (!imported || imported.length === 0) return null;
  return { poster: chatMatch[1], team: imported };
}

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
  const dex = dexOf(logRules(log));

  for (const line of log.split('\n')) {
    const playerMatch = line.match(/^\|player\|(p[12])\|([^|]+)/);
    if (playerMatch) {
      playerByName.set(toId(playerMatch[2]), playerMatch[1] as 'p1' | 'p2');
      continue;
    }

    // Open Team Sheets: |showteam|p1|<packed team, pipes included>
    const showteamMatch = line.match(/^\|showteam\|(p[12])\|([\s\S]+)$/);
    if (showteamMatch) {
      const side = showteamMatch[1] as 'p1' | 'p2';
      if (!fromShowteam[side]) {
        const unpacked = unpackSheetSets(showteamMatch[2], dex);
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
