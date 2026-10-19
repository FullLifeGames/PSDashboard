import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T246c): a replay turn in which a Tatsugiri commands a Dondozo leaves no stale choice in the reconstructed root.
 * The rebuild answered the commanding slot with `move 1` (its default for a slot with no action line), the simulator
 * handed that part to the Dondozo's slot and rejected the whole side choice ("You sent more choices than unfainted
 * Pokemon"), and the repair that answers rejected sides with `default` found both sides' choices already "done" (the
 * half-built choice passes the commanding slot by itself), so it sent nothing. The turn never committed; the position
 * at the next turn came from the snapshot correction alone, with both sides' choices of the old turn still pending in
 * `side.choice` (five VGC holdout positions lost to search errors, two more evaluated on that root). The scene is built
 * from the simulator: a game with a commanding Tatsugiri on either side or both, in slot a and in slot b, played for
 * two turns, then rebuilt from its own public log; the rebuild must commit both turns (the turn counter moves without the
 * snapshot, no choice is rejected, the log has the moves the game had) and the root with the snapshot holds the pending
 * choices the played game holds. Singles is not affected (Commander needs a partner): one row per rule set shows the same
 * rebuild there.
 */

await loadSimMods('gen9championsou');

const RULES = [
  { name: 'Scarlet/Violet', doubles: 'gen9doublescustomgame', singles: 'gen9customgame', level: 100 },
  { name: 'Pokémon Champions', doubles: 'gen9championsdoublescustomgame', singles: 'gen9championscustomgame', level: 50 },
];
const COMMANDERS: { label: string; commanders: ('p1' | 'p2')[] }[] = [
  { label: 'p1', commanders: ['p1'] },
  { label: 'p2', commanders: ['p2'] },
  { label: 'both sides', commanders: ['p1', 'p2'] },
];
const SLOTS = [{ label: 'a', tatsugiriFirst: true }, { label: 'b', tatsugiriFirst: false }];
const TARGET_TURN = 3;

/** The public lines of a played game, as a replay file holds them (the private halves of `|split|` pairs dropped). */
const publicLog = (battle: Battle): string =>
  battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|')).join('\n');

/** Who used which move, in order; the target a spread move names is a dice draw and differs between two plays of the same choices. */
const moveLines = (lines: readonly string[]): string[] =>
  lines.filter(line => line.startsWith('|move|')).map(line => line.split('|').slice(2, 4).join('|'));
const pendingActions = (battle: Battle): number[] => battle.sides.slice(0, 2).map(side => side.choice.actions.length);

interface Scene { format: string; p1: PokemonSet[]; p2: PokemonSet[]; turns: [string, string][] }

/** One reconstruction of the played game up to TARGET_TURN: without the snapshot (the turn counter is the commit) and with it (the root the search gets). */
async function rebuild(scene: Scene, log: string, withSnapshot: boolean) {
  const { snapshots } = parseReplayLogWithObservations(log);
  const runtime = await reconstructBranchRuntime({
    format: scene.format, p1Team: scene.p1, p2Team: scene.p2, replayLog: log, targetTurn: TARGET_TURN,
    snapshot: withSnapshot ? snapshots[TARGET_TURN - 1] ?? null : null,
  });
  return { runtime, battle: runtime.battleStream.battle! };
}

function playGame(scene: Scene): { battle: Battle; log: string } {
  const battle = battleOf(scene.format, scene.p1, scene.p2);
  for (const [p1, p2] of scene.turns) {
    battle.choose('p1', p1);
    battle.choose('p2', p2);
  }
  return { battle, log: publicLog(battle) };
}

describe.each(RULES)('$name: a rebuilt Commander turn commits and leaves a clean root (round 72, T246c)', rules => {
  const mon = (species: string, ability: string, moves: string[]): PokemonSet => set(species, moves, { ability, level: rules.level });
  const tatsugiri = mon('Tatsugiri', 'Commander', ['Draco Meteor', 'Muddy Water', 'Icy Wind', 'Protect']);
  const dondozo = mon('Dondozo', 'Unaware', ['Wave Crash', 'Earthquake', 'Order Up', 'Protect']);
  const fillers = [mon('Pikachu', 'Static', ['Thunderbolt', 'Protect']), mon('Snorlax', 'Immunity', ['Body Slam', 'Protect'])];
  const plain = [fillers[0], fillers[1], mon('Rillaboom', 'Grassy Surge', ['Grassy Glide', 'Protect']), mon('Incineroar', 'Intimidate', ['Fake Out', 'Protect'])];
  const team = (tatsugiriFirst: boolean, commands: boolean): PokemonSet[] =>
    commands ? [...(tatsugiriFirst ? [tatsugiri, dondozo] : [dondozo, tatsugiri]), ...fillers] : plain;

  describe.each(COMMANDERS)('Commander on $label', ({ commanders }) => {
    describe.each(SLOTS)('Tatsugiri in slot $label', ({ tatsugiriFirst }) => {
      // The commanding side sends one part (the Dondozo's), the other side two.
      const turnOne = (side: 'p1' | 'p2') => commanders.includes(side) ? 'move protect' : 'move protect, move protect';
      const turnTwo = (side: 'p1' | 'p2') => commanders.includes(side) ? 'move earthquake' : 'switch 3, switch 4';
      const scene: Scene = {
        format: rules.doubles, p1: team(tatsugiriFirst, commanders.includes('p1')), p2: team(tatsugiriFirst, commanders.includes('p2')),
        turns: [[turnOne('p1'), turnOne('p2')], [turnTwo('p1'), turnTwo('p2')]],
      };
      const game = playGame(scene);

      test('the board is what it says: the Tatsugiri commands on the sides named and the Dondozo moves for it', () => {
        expect(game.battle.turn).toBe(TARGET_TURN);
        for (const side of ['p1', 'p2'] as const) {
          const actives = game.battle.sides[side === 'p1' ? 0 : 1].active;
          const commanding = actives.filter(active => active.volatiles['commanding']).map(active => active.species.name);
          expect(commanding, side).toEqual(commanders.includes(side) ? ['Tatsugiri'] : []);
        }
        const dondozoMoves = moveLines(game.log.split('\n')).filter(line => line.includes('Dondozo|'));
        expect(dondozoMoves.length).toBe(2 * commanders.length);
      });

      test('the rebuild commits both turns by itself: the turn counter moves without the snapshot, no choice is rejected', async () => {
        const { runtime, battle } = await rebuild(scene, game.log, false);
        expect(runtime.choiceErrors.last).toBeNull();
        expect(runtime.choiceErrors.count).toBe(0);
        expect(battle.turn).toBe(TARGET_TURN);
        expect(moveLines(runtime.log)).toEqual(moveLines(game.log.split('\n')));
      });

      test('the root the search gets holds the pending choices the played game holds', async () => {
        const { battle } = await rebuild(scene, game.log, true);
        expect(battle.turn).toBe(TARGET_TURN);
        expect(battle.requestState).toBe(game.battle.requestState);
        expect(pendingActions(battle)).toEqual(pendingActions(game.battle));
      });
    });
  });

  test('singles is not affected: the Tatsugiri keeps its own moves and the rebuild commits', async () => {
    const scene: Scene = {
      format: rules.singles, p1: [tatsugiri, dondozo], p2: [dondozo, tatsugiri],
      turns: [['move protect', 'move protect'], ['move icywind', 'move earthquake']],
    };
    const game = playGame(scene);
    const { runtime, battle } = await rebuild(scene, game.log, false);
    expect(runtime.choiceErrors.count).toBe(0);
    expect(battle.turn).toBe(TARGET_TURN);
    expect(moveLines(runtime.log)).toEqual(moveLines(game.log.split('\n')));
    expect((await rebuild(scene, game.log, true)).battle.sides.slice(0, 2).map(side => side.choice.actions.length)).toEqual(pendingActions(game.battle));
  });
});
