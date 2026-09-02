import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime, executeBranchChoices } from '../packages/eval-engine/src/branch-engine';
import { parseReplayLog } from '../packages/replay-core/src/protocol-parser';

// When a replayed protocol choice is rejected mid-reconstruction (typically a
// team edit removed the move the replay used), the sim keeps the OTHER side's
// already-accepted choice for that turn pending. Every later write then
// commits a turn with that stale one-turn-old choice: the user's first
// "Execute turn" plays the leftover switch — whose target the active-slot
// correction has already put in — and the sim hints "A switch failed because
// the Pokémon trying to switch in is already in." while the user's real
// choices land one commit late (gen9draft-2058494320 turn 4, Cryogonal died
// in place of the chosen Dragapult switch).
function makeSet(name: string, species: string, moves: string[]): PokemonSet {
  return {
    name,
    species,
    item: '',
    ability: 'No Ability',
    moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    gender: '',
  };
}

const replayLog = [
  '|j|Alpha',
  '|j|Beta',
  '|gametype|singles',
  '|player|p1|Alpha|1|',
  '|player|p2|Beta|2|',
  '|teamsize|p1|1',
  '|teamsize|p2|2',
  '|gen|9',
  '|tier|[Gen 9] Custom Game',
  '|rule|HP Percentage Mod: HP is shown in percentages',
  '|',
  '|start',
  '|switch|p1a: Snorlax|Snorlax, F|100/100',
  '|switch|p2a: Pikachu|Pikachu, F|100/100',
  '|turn|1',
  '|',
  // The real game: p2 switches to Eevee, p1 sets up with Curse. The teams
  // handed to the branch have Curse edited away, so the replayed p1 choice
  // is rejected while p2's switch is accepted and left pending.
  '|switch|p2a: Eevee|Eevee, F|100/100',
  '|move|p1a: Snorlax|Curse|p1a: Snorlax',
  '|-boost|p1a: Snorlax|atk|1',
  '|-boost|p1a: Snorlax|def|1',
  '|-unboost|p1a: Snorlax|spe|1',
  '|',
  '|upkeep',
  '|turn|2',
].join('\n');

test.describe('rejected replay choices', () => {
  test('a rejected protocol choice does not leave the other side\'s choice pending', async () => {
    const snapshots = parseReplayLog(replayLog);
    const snapshot = snapshots.find(entry => entry.turn === 2);
    expect(snapshot).toBeTruthy();

    // The "edited" p1 team no longer knows Curse — the move the protocol used.
    const p1Team = [makeSet('Snorlax', 'Snorlax', ['Amnesia', 'Protect'])];
    const p2Team = [
      makeSet('Pikachu', 'Pikachu', ['Protect', 'Substitute']),
      makeSet('Eevee', 'Eevee', ['Protect', 'Substitute']),
    ];

    const runtime = await reconstructBranchRuntime({
      format: 'gen9customgame',
      p1Team,
      p2Team,
      replayLog,
      targetTurn: 2,
      snapshot,
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[1].active[0]?.name).toBe('Eevee');
    // No side may enter the branch with a locked leftover choice.
    for (const side of battle.sides) {
      expect(side.isChoiceDone(), `${side.id} entered the branch with a pending choice`).toBe(false);
    }

    // The user's turn: p1 sets up, p2 switches back to Pikachu.
    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move amnesia' },
        { side: 'p2', command: 'switch 2' },
      ],
    });
    expect(result.ok).toBe(true);

    const executedTurn = runtime.log.join('\n');
    expect(executedTurn).not.toContain('already in');
    expect(executedTurn).toContain('|switch|p2a: Pikachu');
    expect(battle.sides[1].active[0]?.name).toBe('Pikachu');
  });
});
