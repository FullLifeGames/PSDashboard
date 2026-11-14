import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { requiredChoicesForActiveSlots, type BranchSlotChoice } from '../src/branch-choices';
import { resolveSideChoices } from '../src/branch/execute';
import { dieKey } from '../src/dice/types';
import { createMatchupCache } from '../src/eval-function';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import { leafValue } from '../src/search/leaf';
import type { EvalLine, EvalResult, EvalSettings } from '../src/types';
import { branchOf, runTurn, type Commands } from './branch-dice-support';
import { set } from './move-oracle';

/**
 * Round 89 (#104), step G2: the lines of a tree search, from the orchestrated search the app and the bank run. Singles and doubles
 * scenes on fresh games (the corpus scenes, a replay's turn 20 of Champions OU 2628340185 and the others, run in
 * test/regression/eval-lines-lossless.spec.ts, which needs the corpus):
 *  - each side's best row has a line, and the row a side played has one (one line, both roles, when they are the row);
 *  - the lines change nothing else: the result equals the result of the same search through an executor without the lines job;
 *  - a step's dice ride on the slot choices of their holders, and the waiting side of a replacement step holds no choice;
 *  - the line plays as a variation: each step's slot choices resolve on the rebuilt battle and play through the branch engine with
 *    the slot dice, under two different seeds, and the position after the last step has the value the line ends at.
 */

const SETTINGS: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false };

const looksLikeCommands = (battle: Parameters<typeof createBranchStateFromBattle>[0], side: 'p1' | 'p2', slots: (BranchSlotChoice | null)[]) => {
  const state = createBranchStateFromBattle(battle, [], {});
  const required = requiredChoicesForActiveSlots(side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots, side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches);
  return resolveSideChoices(battle!, side, slots, required);
};

/** One line played as a variation on a fresh branch of the scene; the value of the position after its last step, from p1's side. */
async function playAsVariation(scene: Scene, line: EvalLine, seed: string): Promise<{ value: number; steps: number }> {
  const runtime = await branchOf(scene.format, scene.p1, scene.p2, seed);
  scene.prepare?.(runtime.battleStream.battle!);
  for (const step of line.steps) {
    const battle = runtime.battleStream.battle!;
    const commands: Commands = [];
    for (const side of ['p1', 'p2'] as const) {
      const choice = side === 'p1' ? step.p1 : step.p2;
      if (choice.choice === 'wait') continue;
      const resolved = looksLikeCommands(battle, side, choice.slots);
      expect(resolved.ok, `${line.side} ${line.label}: ${side} ${choice.label} resolves${resolved.ok ? '' : ` (${resolved.error})`}`).toBe(true);
      if (!resolved.ok) return { value: NaN, steps: 0 };
      commands.push({ side, command: resolved.command });
    }
    const played = await runTurn(runtime, commands, { p1: step.p1.slots, p2: step.p2.slots });
    expect(played.ok, `${line.side} ${line.label}: the turn plays${played.ok ? '' : ` (${played.error})`}`).toBe(true);
  }
  return { value: leafValue(runtime.battleStream.battle!, createMatchupCache()), steps: line.steps.length };
}

interface Scene {
  name: string;
  format: string;
  p1: ReturnType<typeof set>[];
  p2: ReturnType<typeof set>[];
  prepare?: (battle: NonNullable<Awaited<ReturnType<typeof branchOf>>['battleStream']['battle']>) => void;
  played: NonNullable<EvalSettings['keepPlayed']>;
}

const mon = (species: string, moves: string[]) => set(species, moves, { level: 50 });

const SCENES: Scene[] = [
  {
    name: 'singles: a hit that can miss, a knock-out and a replacement',
    format: 'gen9customgame',
    p1: [mon('Machamp', ['Dynamic Punch', 'Seismic Toss', 'Bulk Up']), mon('Gyarados', ['Waterfall', 'Earthquake']), mon('Mew', ['Psychic', 'Ice Beam'])],
    p2: [mon('Pikachu', ['Thunderbolt', 'Surf']), mon('Eevee', ['Tackle', 'Quick Attack']), mon('Snorlax', ['Body Slam', 'Rest'])],
    prepare: battle => { battle.sides[1].pokemon[0].hp = 1; },
    played: { p1: { kind: 'move', name: 'Bulk Up' }, p2: { kind: 'move', name: 'Surf' } },
  },
  {
    name: 'doubles: four choices a turn and a replacement',
    format: 'gen9doublescustomgame',
    p1: [mon('Incineroar', ['Fake Out', 'Flare Blitz', 'U-turn']), mon('Rillaboom', ['Grassy Glide', 'Wood Hammer']), mon('Amoonguss', ['Spore', 'Rage Powder']), mon('Urshifu', ['Close Combat', 'Sucker Punch'])],
    p2: [mon('Urshifu', ['Close Combat', 'Sucker Punch']), mon('Amoonguss', ['Spore', 'Rage Powder']), mon('Rillaboom', ['Grassy Glide', 'Wood Hammer']), mon('Incineroar', ['Fake Out', 'Flare Blitz', 'U-turn'])],
    played: {
      p1Slots: [{ kind: 'move', name: 'Fake Out', targetLoc: 1 }, { kind: 'move', name: 'Grassy Glide', targetLoc: null }],
      p2Slots: [{ kind: 'move', name: 'Close Combat', targetLoc: -1 }, { kind: 'move', name: 'Spore', targetLoc: -2 }],
    },
  },
];

const searched = new Map<string, Promise<EvalResult>>();

/** One search per scene and executor: the tests of a scene read the same result. `plain` is the executor without the lines job. */
function search(scene: Scene, kind: 'lines' | 'plain'): Promise<EvalResult> {
  const key = `${scene.name}|${kind}`;
  if (!searched.has(key)) searched.set(key, searchOnce(scene, kind));
  return searched.get(key)!;
}

async function searchOnce(scene: Scene, kind: 'lines' | 'plain'): Promise<EvalResult> {
  const runtime = await branchOf(scene.format, scene.p1, scene.p2, '1,2,3,4');
  scene.prepare?.(runtime.battleStream.battle!);
  const serialized = JSON.stringify(State.serializeBattle(runtime.battleStream.battle!));
  const executor: TreeExecutor = kind === 'lines' ? createLocalTreeExecutor(serialized) : { ...createLocalTreeExecutor(serialized), lines: undefined };
  return searchTreesOrchestrated(executor, { ...SETTINGS, keepPlayed: scene.played });
}

describe.each(SCENES)('the lines of a tree search: $name', scene => {
  test('each side has its best row\'s line, and the lines change nothing else', async () => {
    const result = await search(scene, 'lines');
    const plain = await search(scene, 'plain');
    expect(plain.lines).toBeUndefined();
    expect(result.lines, 'the search carries lines').toBeDefined();
    const { lines, ...rest } = result;
    expect(rest, 'the score, the rankings, the matrix and the rest equal the run without the lines job').toEqual(plain);
    // a row has a line when a tree gave it the visits a line needs: the best rows of a singles search do, a doubles best row may stand on fewer
    const held = (['p1', 'p2'] as const).filter(side => lines!.some(line => line.side === side && line.for.includes('engine') && line.label === result.perSide[side][0].label));
    expect(held.length, 'a best row holds its line').toBeGreaterThanOrEqual(scene.name.startsWith('singles') ? 2 : 1);
    for (const side of ['p1', 'p2'] as const) {
      const own = lines!.filter(line => line.side === side);
      for (const line of own) {
        expect(result.perSide[side].some(row => row.label === line.label), `${side} ${line.label} is a row of the result`).toBe(true);
        expect(line.steps.length).toBeGreaterThanOrEqual(1);
        expect(line.steps.length).toBeLessThanOrEqual(3);
        expect(Number.isFinite(line.end)).toBe(true);
      }
    }
  }, 120_000);

  test('a step\'s dice ride on their holders, and the waiting side of a replacement holds no choice', async () => {
    const result = await search(scene, 'lines');
    for (const line of result.lines!) {
      for (const step of line.steps) {
        const carried = [...step.p1.slots, ...step.p2.slots].flatMap(slot => slot?.dice ?? []).map(die => dieKey(die.name)).sort();
        expect(carried, `${line.label}: every die of the step rides on a choice`).toEqual(step.dice.map(entry => dieKey(entry.die.name)).sort());
        if (step.replacement === 'p1') expect(step.p2.slots.every(slot => slot === null) && step.p2.choice === 'wait').toBe(true);
        if (step.replacement === 'p2') expect(step.p1.slots.every(slot => slot === null) && step.p1.choice === 'wait').toBe(true);
      }
    }
  }, 120_000);

  test('an engine line meets the answer that the merged ranking puts first, as far as a tree holds a line against it (G12)', async () => {
    const result = await search(scene, 'lines');
    for (const line of result.lines!.filter(entry => entry.for.includes('engine'))) {
      const other = line.side === 'p1' ? 'p2' : 'p1';
      const first = line.steps[0];
      if (first.replacement) continue;
      const ranking = result.perSide[other].map(row => row.label);
      const at = ranking.indexOf(first[other].label);
      // a tree keeps lines against its own top three answers, so the merged top three are the answers a line can meet
      expect(at, `${line.side} ${line.label}: the answer ${first[other].label} is among the merged top three`).toBeGreaterThanOrEqual(0);
      expect(at, `${line.side} ${line.label}: the answer ${first[other].label} is among the merged top three`).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  test('a line plays as a variation under two seeds and ends at its value', async () => {
    const result = await search(scene, 'lines');
    for (const line of result.lines!) {
      const first = await playAsVariation(scene, line, '1,2,3,4');
      const second = await playAsVariation(scene, line, '905,17,333,4096');
      const own = line.side === 'p1' ? 1 : -1;
      expect(first.steps).toBe(line.steps.length);
      if (!line.unforced) {
        expect(first.value * own, `${line.side} ${line.label}: the position after the line is worth what the line says`).toBeCloseTo(line.end, 9);
        expect(second.value, 'the other seed reaches the same position').toBeCloseTo(first.value, 9);
      }
    }
  }, 180_000);
});
