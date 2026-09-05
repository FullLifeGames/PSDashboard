import { test, expect, describe } from 'vitest';
import { buildTeamsFromReplay, parseReplayLog } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime, executeBranchChoices } from '../src/branch-engine';

// The snapshot correction assigns `pokemon.status` directly. Toxic damage is
// `statusState.stage * maxhp/16`, so without a synced statusState the stage is
// undefined and the damage computes to NaN — corrected Toxic silently deals
// nothing (user report: "Poison does not really work in Gen 3", where the
// sim's own replay of an 85%-accurate Toxic misses and the correction has to
// patch the status in).
//
// The fixture applies tox via a bare |-status| line that no replayed choice
// reproduces — the deterministic stand-in for any status the sim's own rolls
// failed to recreate. All replayed moves are self-/side-targeting so the
// reconstruction can never diverge into KOs or forced switches.
const toxicReplayLog = [
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
  '|switch|p2a: Skarmory|Skarmory, M|100/100',
  '|turn|1',
  '|',
  '|move|p1a: Machoke|Bulk Up|p1a: Machoke',
  '|-boost|p1a: Machoke|atk|1',
  '|-boost|p1a: Machoke|def|1',
  '|move|p2a: Skarmory|Spikes|p1a: Machoke',
  '|-sidestart|p1: Alpha|Spikes',
  '|-status|p1a: Machoke|tox',
  '|',
  '|-damage|p1a: Machoke|94/100 tox|[from] psn',
  '|upkeep',
  '|turn|2',
].join('\n');

describe('status snapshot correction', () => {
  test('corrected Toxic keeps dealing residual damage in the branch', async () => {
    const snapshots = parseReplayLog(toxicReplayLog);
    const snapshot = snapshots.find(entry => entry.turn === 2);
    expect(snapshot).toBeTruthy();
    expect(snapshot!.p1.pokemon.find(pokemon => pokemon.isActive)?.status).toBe('tox');

    const { p1Team, p2Team } = buildTeamsFromReplay(toxicReplayLog);
    const runtime = await reconstructBranchRuntime({
      format: 'gen3customgame',
      p1Team,
      p2Team,
      replayLog: toxicReplayLog,
      targetTurn: 2,
      snapshot,
    });

    const machoke = runtime.battleStream.battle!.sides[0].pokemon
      .find(pokemon => pokemon.species.name === 'Machoke')!;
    expect(machoke.status).toBe('tox');
    expect(machoke.statusState.id).toBe('tox');

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move bulkup' },
        { side: 'p2', command: 'move spikes' },
      ],
    });
    expect(result.ok).toBe(true);

    const executedTurn = runtime.log.join('\n');
    expect(executedTurn).toMatch(/\|-damage\|p1a: Machoke\|\d+\/\d+ tox\|\[from\] psn/);
  });
});
