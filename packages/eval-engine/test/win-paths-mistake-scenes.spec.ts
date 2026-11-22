import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { searchPosition } from '../src/search/position';
import { mistakeStep } from '../src/endgame/win-paths/mistake';
import { reconstruct } from './arrival-turn';
import { playLineOn, REQUEST, won } from './win-paths-support';

/**
 * Round 89 (#130), step G7b: the mistake step on the lost endgames of the corpus, rebuilt as the engine specs rebuild a game (teams
 * from the log, the bring list for a Champions name). The first choices and the opponent's ranking at the root are the turn's own
 * ranking (the depth-1 matrix, as the card shows it). The rows pin what the simulator shows on that board: the log-only teams give
 * Keldeo no item, so a number here is not the app's (the e2e uses the app's own build).
 */
await loadSimMods('gen9championsou');

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

const SCENES = [
  { id: '649664 t23, devin (singles)', name: 'smogtours-gen6ou-649664', turn: 23, side: 'p2', ruleset: 'standard', deviation: { turn: 24, label: 'Scald', rank: 2 } },
  { id: 'Champions VGC 2695803506 t10, juacox300 (doubles 1 v 1)', name: 'gen9championsvgc2026regmc-2695803506', turn: 10, side: 'p2', ruleset: 'champions', champions: true, deviation: { turn: 10, label: 'Nasty Plot', rank: 2 } },
] as const;

async function run(scene: typeof SCENES[number]) {
  const rebuild = () => reconstruct(('champions' in scene ? 'champions/' : '') + scene.name, scene.turn, fixture(scene.name));
  const { runtime } = await rebuild();
  const serialized = serializeLiveBattle(runtime.battleStream.battle!);
  const ranking = searchPosition(serialized, { depth: 1, samples: 1, mode: 'matrix', ruleset: scene.ruleset, tera: true });
  const foe = scene.side === 'p1' ? 'p2' : 'p1';
  const first = { p1: ranking.perSide.p1[0].choice, p2: ranking.perSide.p2[0].choice };
  const foeRanking = ranking.perSide[foe].map(row => ({ choice: row.choice, ev: row.ev }));
  const step = mistakeStep(serialized, REQUEST(scene.side, { turn: scene.turn, first, foeRanking, ruleset: scene.ruleset, tera: true }));
  return { step, rebuild, foeRanking: ranking.perSide[foe].map(row => `${row.label} ${row.ev.toFixed(3)}`) };
}

describe('the mistake step on the corpus', () => {
  test.each(SCENES)('$id', async scene => {
    const { step, rebuild, foeRanking } = await run(scene);
    console.info(`${scene.id}: foe ranking ${foeRanking.join(' | ')} -> ${step.status} ${JSON.stringify(step.deviation)} chance ${step.chance} spent ${JSON.stringify(step.spent)} line ${step.line?.steps.map(item => `${item.p1.label} / ${item.p2.label}`).join(' > ')}`);
    // 649664: BKC's Scald takes Rotom-Wash, devin's Medicham-Mega comes in, and on turn 24 BKC's other choice (Scald where the matrix
    // ranks Hydro Pump first) leaves Medicham standing for High Jump Kick; 2695803506: Delphox-Mega's Nasty Plot instead of Protect (a
    // loss of 0.001 on the card) leaves Kingambit's Kowtow Cleave a free turn, and the log-only board has it finish Delphox-Mega
    expect(step.status).toBe('found');
    expect(step.deviation).toEqual(scene.deviation);
    expect(step.chance).toBeGreaterThan(0.5);
    expect(step.spent.cells).toBeLessThan(350);
    expect(step.spent.turns).toBeLessThan(175);
    expect(won(await playLineOn((await rebuild()).runtime, step.line!), scene.side)).toBe(true);
  }, 300_000);
});
