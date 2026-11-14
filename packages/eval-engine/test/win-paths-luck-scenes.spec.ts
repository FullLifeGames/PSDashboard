import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { searchPosition } from '../src/search/position';
import { luckPath } from '../src/endgame/win-paths/luck';
import type { EvalLine } from '../src/types';
import { reconstruct } from './arrival-turn';
import { playLineOn, REQUEST, won } from './win-paths-support';

/**
 * Round 89 (#130), step G6: the luck step on the lost endgames of the corpus, rebuilt as the engine specs rebuild a game (teams from
 * the log, the bring list for a Champions name). The first choices at the root are the turn's own ranking (the depth-1 matrix, as
 * the card shows it), the later ones the engine's one-turn matrix. The rows pin what the simulator shows on that board: the log-only
 * teams give Keldeo no item, so a number here is not the app's (the e2e uses the app's own build).
 */
await loadSimMods('gen9championsou');

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

const SCENES = [
  { id: '649664 t23, devin (singles)', name: 'smogtours-gen6ou-649664', turn: 23, side: 'p2', ruleset: 'standard' },
  { id: 'Champions VGC 2695803506 t10, juacox300 (doubles 1 v 1)', name: 'gen9championsvgc2026regmc-2695803506', turn: 10, side: 'p2', ruleset: 'champions', champions: true },
] as const;

const shownDice = (line: EvalLine): string[] => line.steps.flatMap(step => step.dice.filter(entry => entry.shown).map(entry => {
  const result = entry.die.result;
  const text = 'happens' in result ? (result.happens ? 'happens' : 'does not happen') : JSON.stringify(result);
  return `${entry.die.name.kind} ${text} (${Math.round((entry.chance ?? 1) * 1000) / 10} %)`;
}));

async function run(scene: typeof SCENES[number]) {
  const rebuild = () => reconstruct(('champions' in scene ? 'champions/' : '') + scene.name, scene.turn, fixture(scene.name));
  const { runtime } = await rebuild();
  const serialized = serializeLiveBattle(runtime.battleStream.battle!);
  const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: scene.ruleset, tera: true });
  const first = { p1: ranking.perSide.p1[0].choice, p2: ranking.perSide.p2[0].choice };
  const step = luckPath(serialized, REQUEST(scene.side, { first, ruleset: scene.ruleset, tera: true }));
  return { step, rebuild };
}

describe('the luck step on the corpus', () => {
  test('649664 t23: devin wins when the shown dice go his way, and the line replays to the win', async () => {
    const { step, rebuild } = await run(SCENES[0]);
    expect(step.status).toBe('found');
    const line = step.line!;
    // the path: the first choices play out (Scald takes Rotom-Wash, devin sends Medicham-Mega in), then Hydro Pump misses and High Jump Kick hits
    const dice = shownDice(line);
    console.info(`649664 t23 for devin: ${line.steps.map(entry => `${entry.p1.label} / ${entry.p2.label}`).join(' > ')} · ${dice.join(' · ')} · this sequence: ${Math.round((step.chance ?? 0) * 1000) / 10} %`);
    expect(line.steps.at(-1)!.p2.label).toBe('High Jump Kick');
    const last = line.steps.at(-1)!.dice;
    const accuracies = last.filter(entry => entry.die.name.kind === 'accuracy');
    expect(accuracies.map(entry => entry.die.name.slot)).toEqual(['p1a', 'p2a']);
    expect(accuracies.map(entry => ('happens' in entry.die.result ? entry.die.result.happens : null))).toEqual([false, true]);
    // Hydro Pump's 80 percent and High Jump Kick's 90 percent are the Gen 6 Dex's
    expect(accuracies[0].chance).toBeCloseTo(0.2, 9);
    expect(accuracies[1].chance).toBeCloseTo(0.9, 9);
    expect(step.chance).toBeGreaterThan(0);
    expect(step.chance).toBeLessThanOrEqual(0.2 * 0.9 + 1e-12);
    expect(step.spent.cells).toBeLessThan(600);
    expect(won((await playLineOn((await rebuild()).runtime, line)), 'p2')).toBe(true);
  }, 300_000);

  test('Champions VGC 2695803506 t10: both sides on their first choice leave juacox300 nothing within three turns, inside the budget', async () => {
    const { step } = await run(SCENES[1]);
    // Delphox-Mega's first choice is Protect each turn and Kingambit's Sucker Punch fails against it; burn takes Kingambit first
    expect(step.status).toBe('none');
    expect(step.line).toBeUndefined();
    expect(step.spent.cells).toBeLessThan(600);
    expect(step.spent.turns).toBeLessThan(400);
  }, 300_000);
});
