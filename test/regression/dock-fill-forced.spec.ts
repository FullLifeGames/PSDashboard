import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import {
  createBranchStateFromBattle, createLocalTreeExecutor, searchPosition, searchTreesOrchestrated, serializeLiveBattle, type BranchSimState,
} from '@fulllifegames/eval-engine';
import { pickFill, slotChoicesOf } from '../../src/lib/dock-fill';

/**
 * Round 84 (turn dock), step A7a, ruling 2a: the engine fills a forced replacement like any slot. The premise, proved on the real
 * simulator and the real search: the evaluation ranks the replacement at a forced position (the dock serializes the live battle
 * at its open request, as the sweep does for a knockout), and `pickFill` maps the best line onto the forced slot, in singles and in
 * doubles, with one side or both replacing. Memento faints its user at once, so the turn ends in the open request.
 */
const EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs: EVS, ivs: IVS, level: 50,
});

const LEAVERS = ['Rillaboom', 'Parasect'];
const STAYERS = ['Snorlax', 'Corviknight'];
const BENCH = ['Pikachu', 'Eevee'];

/** One side's team: `leaving` bodies that Memento away, the rest of the field on Splash, then two on the bench. */
function team(active: number, leaving: number): PokemonSet[] {
  const front = (leaving > 0 ? LEAVERS : STAYERS).slice(0, active).map(species => mon(species, ['Memento', 'Splash']));
  return [...front, ...BENCH.map(species => mon(species, ['Splash']))];
}

/** The position after one turn in which `p1Leaving` bodies of P1 and `p2Leaving` bodies of P2 faint. */
function forcedPosition(format: string, active: number, p1Leaving: number, p2Leaving: number): Battle {
  const battle = new Battle({
    formatid: toID(format) as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(team(active, p1Leaving)) }, p2: { name: 'Beta', team: Teams.pack(team(active, p2Leaving)) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  // Memento aims at a foe in doubles; every other body plays Splash.
  const command = (leaving: number) => Array.from({ length: active }, (_, slot) => (slot < leaving ? `move 1${active > 1 ? ' 1' : ''}` : 'move 2')).join(', ');
  battle.choose('p1', command(p1Leaving));
  battle.choose('p2', command(p2Leaving));
  return battle;
}

const ROWS = [
  { name: 'singles, P1 replaces', format: 'gen9customgame', active: 1, p1: 1, p2: 0 },
  { name: 'singles, both replace', format: 'gen9customgame', active: 1, p1: 1, p2: 1 },
  { name: 'doubles, one slot of P1 replaces', format: 'gen9doublescustomgame', active: 2, p1: 1, p2: 0 },
  { name: 'doubles, both slots of P2 replace', format: 'gen9doublescustomgame', active: 2, p1: 0, p2: 2 },
  { name: 'doubles, one slot of each side replaces', format: 'gen9doublescustomgame', active: 2, p1: 1, p2: 1 },
] as const;

describe('the evaluation at a forced replacement', () => {
  for (const row of ROWS) {
    test(`${row.name}: the search ranks the bench and pickFill fills the forced slot`, () => {
      const battle = forcedPosition(row.format, row.active, row.p1, row.p2);
      const state: BranchSimState = createBranchStateFromBattle(battle as never, [], {});
      expect(state.p1ForceSwitch || state.p2ForceSwitch, 'the scene is a forced position').toBe(true);
      const result = searchPosition(serializeLiveBattle(battle as never), { depth: 1, samples: 1, tera: false });
      for (const side of ['p1', 'p2'] as const) {
        const forced = side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches;
        const ranked = result.perSide[side];
        if (!forced.some(Boolean)) {
          // The side that waits is ranked as a wait, which the fill skips: its slots stay empty.
          expect(pickFill(side, ranked, state, forced.map(() => null)).every(choice => choice === null)).toBe(true);
          continue;
        }
        expect(ranked.length, `${side} has ranked replacements`).toBeGreaterThan(0);
        const parts = slotChoicesOf(state, side, ranked[0]);
        expect(parts, `${side}: the best line maps onto the pickers`).not.toBeNull();
        const filled = pickFill(side, ranked, state, forced.map(() => null));
        forced.forEach((needs, slot) => {
          if (needs) expect(filled[slot], `${side} slot ${slot} holds a switch`).toMatchObject({ kind: 'switch' });
          else expect(filled[slot], `${side} slot ${slot} is not asked`).toBeNull();
        });
      }
    });
  }
});

describe('the single evaluation of the app at a forced replacement', () => {
  // The dock's run is the app's single evaluation: the DUCT trees, the verify round and the forced-win prover, on the live battle.
  for (const row of [ROWS[0], ROWS[2]]) {
    test(`${row.name}: the orchestrated tree search with the prover returns the ranked bench`, { timeout: 300_000 }, async () => {
      const battle = forcedPosition(row.format, row.active, row.p1, row.p2);
      const state = createBranchStateFromBattle(battle as never, [], {});
      const serialized = serializeLiveBattle(battle as never);
      const result = await searchTreesOrchestrated(
        createLocalTreeExecutor(serialized, 'standard'), { depth: 1, samples: 1, tera: false, mode: 'mcts', ruleset: 'standard' },
      );
      const forced = state.p1ForceSwitches;
      const filled = pickFill('p1', result.perSide.p1, state, forced.map(() => null));
      forced.forEach((needs, slot) => {
        if (needs) expect(filled[slot]).toMatchObject({ kind: 'switch' });
      });
    });
  }
});
