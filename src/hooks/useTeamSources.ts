import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import {
  type DamageObservation, type HiddenPowerEvidence, type OpponentTeamInfo, type ReplayData,
  type SpeedOrderObservation, logRules, parsePastedTeam, type PastedSet, parseTeamText, type SpreadCandidate,
} from '@fulllifegames/replay-core';
import type { useSmogonUsageStats } from './useSmogonUsageStats';
import type { useSmogonSetAssumptions } from './useSmogonSetAssumptions';
import type { TeamBuildOptions } from '../lib/eval-acquire';
import type { ReplayWorkerClient } from '../lib/replay-jobs/client';

const TEAM_PASTE_STORAGE_KEY = 'ps-replay-interceptor:team-paste';

function restoreTeamPaste(): { text: string; sets: PastedSet[] } | null {
  const saved = localStorage.getItem(TEAM_PASTE_STORAGE_KEY);
  if (!saved?.trim()) return null;
  const sets = parsePastedTeam(saved);
  return sets.length > 0 ? { text: saved, sets } : null;
}

export function useTeamPaste() {
  const [teamText, setTeamText] = useState(() => restoreTeamPaste()?.text ?? '');
  const [pastedSets, setPastedSets] = useState<PastedSet[] | null>(() => restoreTeamPaste()?.sets ?? null);
  const [teamPasteError, setTeamPasteError] = useState<string | null>(null);

  const handleTeamLoad = useCallback((rawText: string) => {
    const processed = parseTeamText(rawText);
    if (!processed.trim()) {
      setTeamText('');
      setPastedSets(null);
      setTeamPasteError(null);
      localStorage.removeItem(TEAM_PASTE_STORAGE_KEY);
      return;
    }

    const sets = parsePastedTeam(processed);
    if (sets.length === 0) {
      setTeamPasteError('Could not read any Pokémon sets from the paste: expected the Showdown export format.');
      return;
    }

    setTeamText(processed);
    setPastedSets(sets);
    setTeamPasteError(null);
    try {
      localStorage.setItem(TEAM_PASTE_STORAGE_KEY, processed);
    } catch {
      // Storage full/blocked: the paste still works for this session.
    }
  }, []);

  return { teamText, pastedSets, teamPasteParseError: teamPasteError, handleTeamLoad };
}

export function useHpResolver(
  replayData: ReplayData | null,
  hpEvidence: HiddenPowerEvidence[],
  usageStats: ReturnType<typeof useSmogonUsageStats>,
) {
  const [hpModule, setHpModule] = useState<typeof import('../lib/lazy/hidden-power') | null>(null);
  useEffect(() => {
    if (!replayData) return;
    void import('../lib/lazy/team-builder');
    void import('../lib/lazy/branch-engine');
    // The HP-type resolver pulls @pkmn/sim's Dex: keep it out of the main chunk.
    void import('../lib/lazy/hidden-power').then(module => setHpModule(module));
  }, [replayData]);

  const replayGenNumber = parseInt(replayData?.log.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10);
  const rules = useMemo(() => (replayData ? logRules(replayData.log) : { gen: replayGenNumber, mod: undefined }), [replayData, replayGenNumber]);

  const hpResolverFor = useCallback((side: 'p1' | 'p2') => {
    if (!hpModule) return undefined;
    const sideEvidence = hpEvidence.filter(entry => entry.attackerSide === side);
    return (species: string) =>
      hpModule.resolveHiddenPowerType(sideEvidence, usageStats.stats, species, rules);
  }, [hpModule, hpEvidence, usageStats.stats, rules]);

  return { hpResolverFor, replayGenNumber };
}

interface SpreadSolveEntry {
  refs: unknown[];
  content: string;
  value: Promise<Map<string, SpreadCandidate>>;
}

/** The damage-consistent spread solve in the replay worker, cached across call sites; callers share the promise. */
export function useSpreadSolve(inputs: {
  replayData: ReplayData | null;
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  teamText: string;
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  usageStats: ReturnType<typeof useSmogonUsageStats>;
  setAssumptions: ReturnType<typeof useSmogonSetAssumptions>;
  replayWorker: ReplayWorkerClient;
}) {
  const { replayData, observations, speedOrders, teamText, effectiveP1Info, effectiveP2Info, usageStats, setAssumptions, replayWorker } = inputs;
  const spreadSolveRef = useRef<SpreadSolveEntry | null>(null);
  const [solved, setSolved] = useState<{ replay: ReplayData | null; spreads: Map<string, SpreadCandidate> | null }>({ replay: replayData, spreads: null });
  if (solved.replay !== replayData) setSolved({ replay: replayData, spreads: null });
  useEffect(() => {
    spreadSolveRef.current = null;
  }, [replayData]);

  const getInferredSpreads = useCallback(async (
    p1InfoOverride?: OpponentTeamInfo | null,
    p2InfoOverride?: OpponentTeamInfo | null,
    opts?: TeamBuildOptions,
  ) => {
    if (!replayData || (observations.length === 0 && speedOrders.length === 0)) return undefined;
    const info1 = p1InfoOverride ?? effectiveP1Info;
    const info2 = p2InfoOverride ?? effectiveP2Info;
    const refs = [replayData, observations, speedOrders, usageStats.stats, setAssumptions.assumptions];
    const content = JSON.stringify([teamText, info1, info2]);
    const cached = spreadSolveRef.current;
    if (cached && cached.content === content && cached.refs.every((entry, index) => entry === refs[index])) {
      return cached.value;
    }
    if (opts?.cachedOnly || usageStats.loading || setAssumptions.loading) return undefined;
    const value = replayWorker.solveSpreads({
      log: replayData.log,
      observations,
      speedOrders,
      userTeamText: teamText || undefined,
      p1Info: info1,
      p2Info: info2,
      usageStats: usageStats.stats,
      setAssumptions: setAssumptions.assumptions,
    });
    const entry: SpreadSolveEntry = { refs, content, value };
    spreadSolveRef.current = entry;
    value
      .then(spreads => {
        if (spreadSolveRef.current === entry) setSolved({ replay: replayData, spreads });
      })
      .catch(() => {
        if (spreadSolveRef.current === entry) spreadSolveRef.current = null;
      });
    return value;
  }, [
    replayData, observations, speedOrders, teamText, effectiveP1Info, effectiveP2Info,
    usageStats.stats, usageStats.loading, setAssumptions.assumptions, setAssumptions.loading, replayWorker,
  ]);

  return { solvedSpreads: solved.spreads, getInferredSpreads };
}

/** Posted open team sheets, surfaced in the stats panel as 'sheet' knowledge. */
export function useSheetTeams(replayData: ReplayData | null) {
  const [sheetTeams, setSheetTeams] = useState<{ p1: PokemonSet[] | null; p2: PokemonSet[] | null }>({ p1: null, p2: null });
  const [sheetsFor, setSheetsFor] = useState(replayData);
  if (sheetsFor !== replayData) {
    setSheetsFor(replayData);
    setSheetTeams({ p1: null, p2: null });
  }
  useEffect(() => {
    let stale = false;
    if (!replayData) return;
    void import('../lib/lazy/team-builder').then(({ extractTeamSheets }) => {
      if (!stale) setSheetTeams(extractTeamSheets(replayData.log));
    });
    return () => { stale = true; };
  }, [replayData]);
  return sheetTeams;
}
