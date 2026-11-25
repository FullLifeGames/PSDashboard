// @pkmn/sim stores a format's rule table only when its ruleset repeals nothing (dex-formats.mjs:770); gen9ou does;
// the lever stores it once per format object, as the sim does for other formats. Process wide.
import { dexOfFormat, simFormats } from '@fulllifegames/replay-core';
import { onSimFastChange, simFastCounters, simFastFlags } from './state.ts';

type Format = ReturnType<ReturnType<typeof simFormats>['get']>;

const ours = new Set<Format>();
let hooked = false;

export function ensureRuleTable(formatid: string): void {
  if (!hooked) {
    onSimFastChange(syncRuleTables);
    hooked = true;
  }
  const format = simFormats().get(formatid, true);
  if (!format.exists) return;
  if (!format.ruleTable) {
    // The Battle constructor's own call (battle.mjs:61): the format's mod dex builds it.
    format.ruleTable = dexOfFormat(format).formats.getRuleTable(format);
    ours.add(format);
  }
  simFastCounters.ruleTables++;
}

function syncRuleTables(): void {
  if (simFastFlags.rules) return;
  for (const format of ours) format.ruleTable = null;
  ours.clear();
}
