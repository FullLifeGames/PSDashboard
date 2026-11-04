/// <reference lib="webworker" />
import { TEAMBUILDER_TABLE_URL, tablePartScript } from '../lib/teambuilder-table';

/**
 * Round 85 (T318): reads Showdown's teambuilder table off the main thread and posts the script of the part a replay frame
 * reads (`src/lib/teambuilder-table.ts`). Showdown serves the file with `Access-Control-Allow-Origin: *`. On any failure the
 * worker posts no script, and frames load Showdown's file as before.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

async function cut(): Promise<void> {
  try {
    const response = await fetch(TEAMBUILDER_TABLE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    // The file is one statement, `exports.BattleTeambuilderTable = JSON.parse('…')`; it runs here as the embed runs it.
    const exports: { BattleTeambuilderTable?: Record<string, unknown> } = {};
    new Function('exports', source)(exports);
    if (!exports.BattleTeambuilderTable) throw new Error('no table');
    scope.postMessage({ script: tablePartScript(exports.BattleTeambuilderTable) });
  } catch {
    scope.postMessage({});
  }
}

void cut();
