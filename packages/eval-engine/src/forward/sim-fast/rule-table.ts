/**
 * Round 59 (T91), lever rules: every gen9ou battle rebuilt its rule table
 * (14 to 17 % of a gen9ou search). @pkmn/sim stores a format's table only
 * when its ruleset repeals nothing (dex-formats.mjs:770), and gen9ou repeals
 * a rule. The lever stores the table once per format object, as the sim does
 * for every other format; the Battle constructor then takes it
 * (getRuleTable answers format.ruleTable first, dex-formats.mjs:520). Process
 * wide: the format object is shared, so reconstruction battles share it too.
 */
import { Dex } from '@pkmn/sim';
import { onSimFastChange, simFastCounters, simFastFlags } from './state.ts';

type Format = ReturnType<typeof Dex.formats.get>;

/** Formats whose table this module stored; the lever going off resets them to null. */
const ours = new Set<Format>();
let hooked = false;

export function ensureRuleTable(formatid: string): void {
  if (!hooked) {
    onSimFastChange(syncRuleTables);
    hooked = true;
  }
  const format = Dex.formats.get(formatid, true);
  if (!format.exists) return;
  if (!format.ruleTable) {
    // The Battle constructor's own call (battle.mjs:61): the format's mod dex builds it.
    format.ruleTable = Dex.forFormat(format).formats.getRuleTable(format);
    ours.add(format);
  }
  simFastCounters.ruleTables++;
}

function syncRuleTables(): void {
  if (simFastFlags.rules) return;
  for (const format of ours) format.ruleTable = null;
  ours.clear();
}
