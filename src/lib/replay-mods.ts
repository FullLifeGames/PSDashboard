import { getBranchSimulatorFormat, isChampionsFormat, logRules, replayRuleset } from '@fulllifegames/replay-core';

type ReplaySource = Parameters<typeof replayRuleset>[0];

// For a log whose replay id and format do not name Champions: its tier line decides the inference's Dex.
const CHAMPIONS_LOAD_FORMAT = 'gen9championsou';

/** Every host awaits this before it parses, infers or builds: a Champions game needs its mod loaded first. */
export async function loadReplayMods(source: ReplaySource): Promise<void> {
  if (replayRuleset(source) !== 'champions' && logRules(source.log ?? '').mod !== 'champions') return;
  const format = getBranchSimulatorFormat(source);
  const { loadSimMods } = await import('./lazy/branch-engine');
  await loadSimMods(isChampionsFormat(format) ? format : CHAMPIONS_LOAD_FORMAT);
}
