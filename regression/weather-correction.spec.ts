import { test, expect } from '@playwright/test';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime, executeBranchChoices } from '../src/lib/branch-engine';
import { parseReplayLog } from '../src/lib/protocol-parser';

// @pkmn/client reports weather by display name ("Sand", not "Sandstorm").
// The snapshot correction must translate that back to the sim's condition id,
// or it overwrites the correctly reconstructed weather with a nonexistent id
// and every weather residual silently stops (user report: gen 3 branch at
// turn 20 of gen3customgame-2115579570 dealt no Sandstorm damage).
const sandstormReplayLog = [
  '|j|Alpha',
  '|j|Beta',
  '|gametype|singles',
  '|player|p1|Alpha|1|',
  '|player|p2|Beta|2|',
  '|teamsize|p1|2',
  '|teamsize|p2|2',
  '|gen|3',
  '|tier|[Gen 3] Custom Game',
  '|rule|HP Percentage Mod: HP is shown in percentages',
  '|',
  '|start',
  '|switch|p1a: Machoke|Machoke, F|100/100',
  '|switch|p2a: Tyranitar|Tyranitar, M|100/100',
  '|-weather|Sandstorm|[from] ability: Sand Stream|[of] p2a: Tyranitar',
  '|turn|1',
  '|',
  // Deterministic turn 1: self-targeting moves cannot miss or KO, so the
  // sim's own damage rolls can never diverge into a forced switch here.
  '|move|p1a: Machoke|Bulk Up|p1a: Machoke',
  '|-boost|p1a: Machoke|atk|1',
  '|-boost|p1a: Machoke|def|1',
  '|move|p2a: Tyranitar|Substitute|p2a: Tyranitar',
  '|-start|p2a: Tyranitar|Substitute',
  '|-damage|p2a: Tyranitar|75/100',
  '|',
  '|-weather|Sandstorm|[upkeep]',
  '|-damage|p1a: Machoke|94/100|[from] Sandstorm',
  '|upkeep',
  '|turn|2',
].join('\n');

test.describe('weather snapshot correction', () => {
  test('keeps ability weather intact through branch reconstruction and residuals', async () => {
    const snapshots = parseReplayLog(sandstormReplayLog);
    const snapshot = snapshots.find(entry => entry.turn === 2);
    expect(snapshot).toBeTruthy();
    // Precondition for the whole scenario: the client snapshot uses the
    // display name, which the sim does not know as a condition.
    expect(snapshot!.field.weather).toBe('Sand');

    const { p1Team, p2Team } = buildTeamsFromReplay(sandstormReplayLog);
    const runtime = await reconstructBranchRuntime({
      format: 'gen3customgame',
      p1Team,
      p2Team,
      replayLog: sandstormReplayLog,
      targetTurn: 2,
      snapshot,
    });

    const field = runtime.battleStream.battle!.field;
    expect(field.weather).toBe('sandstorm');
    expect(field.weatherState.id).toBe('sandstorm');

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move bulkup' },
        { side: 'p2', command: 'move substitute' },
      ],
    });
    expect(result.ok).toBe(true);

    const executedTurn = runtime.log.join('\n');
    expect(executedTurn).toContain('|-weather|Sandstorm|[upkeep]');
    expect(executedTurn).toMatch(/\|-damage\|p1a: Machoke\|\d+\/\d+\|\[from\] Sandstorm/);
  });
});
