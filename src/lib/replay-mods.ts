import { getBranchSimulatorFormat, isChampionsFormat, logRules, replayRuleset } from '@fulllifegames/replay-core';

type ReplaySource = Parameters<typeof replayRuleset>[0];

/** The Champions format a log names when the replay's own id and format do not (the log's tier line decides the inference's Dex). */
const CHAMPIONS_LOAD_FORMAT = 'gen9championsou';

/**
 * Round 75 (T160): the one load order of every host. The inference, the team build and the item judge read the Dex of the game
 * (replay-core's rulesDex), and a Pokémon Champions game reads the registered Champions mod, which loads on demand (about 10 MB).
 * A host awaits this before it parses, infers or builds a replay: the app's replay load, the bank's team build and the
 * calibration and fit harnesses. A replay of any other format returns at once and loads nothing.
 */
export async function loadReplayMods(source: ReplaySource): Promise<void> {
  if (replayRuleset(source) !== 'champions' && logRules(source.log ?? '').mod !== 'champions') return;
  const format = getBranchSimulatorFormat(source);
  const { loadSimMods } = await import('./lazy/branch-engine');
  await loadSimMods(isChampionsFormat(format) ? format : CHAMPIONS_LOAD_FORMAT);
}
