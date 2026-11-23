import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { heldDecided } from '../src/turn-analysis/decided-held';
import type { EvalResult, RankedChoice, UnansweredProfile, EvalSettings } from '../src/types';
import { readFileSync } from 'node:fs';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { battleFaintedFraction, searchPosition } from '../src/search';
import { autoTurnSettings } from '../src/search/budget';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { replayRuleset } from '@fulllifegames/replay-core';

const profile = (side: 'p1' | 'p2', species: string): UnansweredProfile =>
  ({ p1: [], p2: [], decided: { side, species } });

describe('the decided sweep needs the search\'s key (round 50)', () => {
  test('a sweep named against the bar is not held (749828 t23: p1 named, the bar at -1)', () => {
    expect(heldDecided({ score: -1, unanswered: profile('p1', 'Primarina') })).toBeUndefined();
  });

  test('a sweep the bar reads at the decided score is held, for either side', () => {
    expect(heldDecided({ score: -0.7, unanswered: profile('p2', 'Dragonite') })).toEqual({ side: 'p2', species: 'Dragonite' });
    expect(heldDecided({ score: 0.86, unanswered: profile('p1', 'Mandibuzz') })).toEqual({ side: 'p1', species: 'Mandibuzz' });
  });

  test('a sweep the bar only leans toward is not held', () => {
    expect(heldDecided({ score: -0.69, unanswered: profile('p2', 'Zapdos-Galar') })).toBeUndefined();
    expect(heldDecided({ score: 0.05, unanswered: profile('p1', 'Chi-Yu') })).toBeUndefined();
  });

  test('no sweep, nothing held', () => {
    expect(heldDecided({ score: 0.95, unanswered: { p1: ['Garchomp'], p2: [] } })).toBeUndefined();
    expect(heldDecided({ score: 0.95 })).toBeUndefined();
  });
});

describe('the held sweep at the analysis layer and in prose (round 50)', () => {
  const names: [string, string] = ['Alpha', 'Beta'];
  const ranked = (choice: string, label: string, ev: number): RankedChoice =>
    ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });
  const swept = (score: number): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: { p1: [ranked('move tackle', 'Tackle', -0.2)], p2: [ranked('move stompingtantrum', 'Stomping Tantrum', 0.2)] },
    unanswered: profile('p2', 'Zapdos-Galar'),
  });
  const analysisAt = (score: number, scoreAfter: number) => analyzeTurn({
    turn: 134,
    result: swept(score),
    played: {
      p1: { kind: 'move', name: 'Tackle', tera: false },
      p2: { kind: 'move', name: 'Stomping Tantrum', tera: false },
    },
    playedOutcome: score,
    scoreBefore: score,
    scoreAfter,
  });

  test('a sweep the bar does not back stays off the analysis', () => {
    // 649664 t15-t22: Medicham-Mega named for p2 while the bar leaned to p1;
    // 573756 t92-t136: the right side named, the bar between 0.33 and 0.60.
    expect(analysisAt(0.2, 0.15).p2.decided).toBeUndefined();
    expect(analysisAt(-0.6, -0.65).p2.decided).toBeUndefined();
    expect(analysisAt(-0.7, -0.75).p2.decided).toEqual({ species: 'Zapdos-Galar', announce: true });
  });

  test('a sweep the bar does not back stays silent, and its chance swing stays luck', () => {
    const summary = summarizeTurn(analysisAt(-0.4, -0.95), names);
    expect(summary).not.toContain('practically decided');
    expect(summary).not.toContain('resolving toward');
    expect(summary).toContain('how the turn rolled');
  });

  test('a held sweep speaks, and a swing toward it reads as the game resolving', () => {
    const summary = summarizeTurn(analysisAt(-0.75, -1), names);
    expect(summary).toContain('From here Zapdos-Galar clears everything Alpha has left');
    expect(summary).toContain('the decided game resolving toward Beta');
  });
});

interface BankPosition { id: string; turn: number; serialized: string; p1Won: boolean }

const load = (file: string): BankPosition =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${file}`, import.meta.url), 'utf-8')) as BankPosition;

const settingsFor = (position: BankPosition): EvalSettings => ({ depth: 1, samples: 1, tera: false, ruleset: replayRuleset({ id: position.id, log: '' }) });

async function search(position: BankPosition) {
  const settings = settingsFor(position);
  const battle = positionBattle(createRootPosition(position.serialized, settings.ruleset));
  const auto = autoTurnSettings(battleFaintedFraction(battle), battle.gameType === 'doubles');
  return auto.mode === 'mcts'
    ? searchTreesOrchestrated(createLocalTreeExecutor(position.serialized, settings.ruleset), { ...settings, mode: 'mcts' })
    : searchPosition(position.serialized, { ...settings, depth: auto.depth, samples: auto.samples });
}

describe('the decided sweep needs the bar on real positions (round 50)', () => {
  test('the bench searches each fixture under the rule set of its replay', () => {
    expect(settingsFor(load('gen9vgc2026regi-2629703929-t6.json')).ruleset).toBe('vgc');
    expect(settingsFor(load('gen9doublesou-2663093831-t12.json')).ruleset).toBe('standard');
    expect(settingsFor(load('smogtours-gen9ou-749828-t23.json')).ruleset).toBe('standard');
  });

  test('749828 t23 (singles): the sweep names Primarina for p1, the bar reads p2, nothing is held', { timeout: 120000 }, async () => {
    // Aqua Jet lends its first strike to Primarina's best move while Rillaboom's Grassy Glide goes first under the terrain; the prover proves p2, and p2 won.
    const result = await search(load('smogtours-gen9ou-749828-t23.json'));
    expect(result.unanswered?.decided?.side).toBe('p1');
    expect(result.score).toBeLessThan(0);
    expect(heldDecided(result)).toBeUndefined();
  });

  test('2629703929 t6 (doubles): the sweep names Chi-Yu for p1 under a level bar, nothing is held', { timeout: 120000 }, async () => {
    const position = load('gen9vgc2026regi-2629703929-t6.json');
    const result = await search(position);
    expect(result.unanswered?.decided).toEqual({ side: 'p1', species: 'Chi-Yu' });
    expect(Math.abs(result.score)).toBeLessThan(0.7);
    expect(heldDecided(result)).toBeUndefined();
    expect(position.p1Won).toBe(false);
  });

  test('2663093831 t12 (doubles): sweep and bar name p2, the sweep is held', { timeout: 120000 }, async () => {
    const position = load('gen9doublesou-2663093831-t12.json');
    const result = await search(position);
    expect(result.unanswered?.decided?.side).toBe('p2');
    expect(heldDecided(result)).toEqual(result.unanswered?.decided);
    expect(position.p1Won).toBe(false);
  });
});
