import { readFileSync } from 'node:fs';
import { State } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { proveForcedWin } from '../src/endgame/prover';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { applyForcedWin } from '../src/search/forced-win-apply';
import { summarizeTurn } from '../src/summary';
import { conversionFor } from '../src/win-reason';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, ForcedWinProof, RankedChoice } from '../src/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championsdoublescustomgame');

interface Scene { serialized: string; side: 'p1' | 'p2'; rootOrder: string[]; tera: boolean; sleepClause: boolean; ruleset?: StaticRuleset }
const scene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as Scene;

const names: [string, string] = ['PsychedelicDawgII', 'Opponent'];
const ranked = (choice: string, label: string, worstCase: number): RankedChoice => ({ choice, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

function speak(proof: ForcedWinProof, side: 'p1' | 'p2' = 'p1'): { card: string; report: string | undefined } {
  const result: EvalResult = {
    score: 0.5, interval: 0, depthCompleted: 1,
    perSide: { p1: [ranked('move a', 'A', 0.5)], p2: [ranked('move b', 'B', -0.5)] },
    unanswered: { p1: [], p2: [] },
  };
  applyForcedWin(result, { side, proof });
  const sign = side === 'p1' ? 1 : -1;
  const analysis = analyzeTurn({ turn: 6, result, played: null, playedOutcome: null, scoreBefore: 0.95 * sign, scoreAfter: null, playedTracking: false });
  return { card: summarizeTurn(analysis, names), report: conversionFor([analysis], side, names)?.sentence };
}

const full = (extra: Partial<ForcedWinProof> = {}): ForcedWinProof =>
  ({ mass: 1, turns: 2, caveat: 'sampled-rolls', openValue: null, states: 4, cells: 15, ...extra });

describe('the prover names what it leans on, from the battle\'s Dex', () => {
  test('doubles, Champions VGC 2682637901 turn 6: a delay by Protect and the strike Aqua Jet beside Heat Wave', () => {
    const board = scene('forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6');
    const proof = proveForcedWin(createRootPosition(board.serialized, board.ruleset), { side: board.side, rootOrder: board.rootOrder, tera: false, ruleset: board.ruleset });
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.turns).toBe(2);
    expect(proof.delay).toBe('protect');
    expect(proof.delayName).toBe('Protect');
    expect(proof.choice).toBe('move heatwave, move aquajet 1');
    expect(proof.choiceNames).toEqual({ first: 'Aqua Jet', partner: 'Heat Wave' });
  });

  test('singles: a foe at 1 HP behind Protect, delay by Protect and no choice (the pool is the search\'s list)', async () => {
    await loadSimMods('gen9customgame');
    const battle = battleOf('gen9customgame', [set('Pikachu', ['Tackle'])], [set('Snorlax', ['Protect', 'Splash'])]);
    battle.sides[1].active[0]!.hp = 1;
    const proof = proveForcedWin(createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard'), { side: 'p1', rootOrder: ['move tackle'], tera: false, ruleset: 'standard' });
    expect(proof.mass).toBeCloseTo(1, 9);
    expect(proof.delay).toBe('protect');
    expect(proof.delayName).toBe('Protect');
    expect(proof.choice).toBeUndefined();
    expect(proof.choiceNames).toBeUndefined();
  });
});

describe('the card and the report say it once, in the same words', () => {
  test('doubles: the delay clause and the winning choice, verbatim', () => {
    const { card, report } = speak(full({ delay: 'protect', delayName: 'Protect', choice: 'move heatwave, move aquajet 1', choiceNames: { first: 'Aqua Jet', partner: 'Heat Wave' } }));
    expect(card).toContain('PsychedelicDawgII wins within 2 turns against every reply on the sampled rolls; a repeated Protect only delays it. ' +
      'The winning line is Aqua Jet, which strikes first, with Heat Wave beside it.');
    expect(report).toBe('From turn 6 the win was forced: every reply lost within 2 turns on the sampled rolls; a repeated Protect only delayed it. ' +
      'The winning line was Aqua Jet, which struck first, with Heat Wave beside it.');
  });

  test('singles: the clause alone, the stall by the name the Dex gives it', () => {
    const { card, report } = speak(full({ delay: 'detect', delayName: 'Detect' }), 'p2');
    expect(card).toContain('Opponent wins within 2 turns against every reply on the sampled rolls; a repeated Detect only delays it.');
    expect(card).not.toContain('winning line');
    expect(report).toBe('From turn 6 the win was forced: every reply lost within 2 turns on the sampled rolls; a repeated Detect only delayed it.');
  });

  test('every form of the sentence ends in the clause: a mass under 1, a crit caveat, an open class', () => {
    expect(speak(full({ mass: 0.96, delay: 'protect', delayName: 'Protect' })).card)
      .toContain('wins within 2 turns against every reply in 96% of the sampled rolls; a repeated Protect only delays it.');
    expect(speak(full({ caveat: 'barring-crit', delay: 'protect', delayName: 'Protect' })).card)
      .toContain('wins within 2 turns against every reply, barring a crit; a repeated Protect only delays it.');
    expect(speak(full({
      mass: 0.95, caveat: 'barring-crit', delay: 'protect', delayName: 'Protect',
      open: { side: 'p1', moveId: 'firefang', label: 'Fire Fang', odds: 0.95, kind: 'hit' },
    })).card).toContain('against every reply if the 95% Fire Fang lands, barring a crit; a repeated Protect only delays it.');
  });

  test('a choice without a delay names the line and no stall', () => {
    const { card } = speak(full({ turns: 1, choice: 'move aquajet 1, move heatwave', choiceNames: { first: 'Aqua Jet' } }));
    expect(card).toContain('wins within 1 turn against every reply on the sampled rolls. The winning line is Aqua Jet, which strikes first.');
    expect(card).not.toContain('only delays');
  });

  test('a proof without the fields reads as before; a result cached with a delay but no name says "a stalling move"', () => {
    expect(speak(full()).card).toContain('wins within 2 turns against every reply on the sampled rolls.');
    expect(speak(full({ delay: 'protect' })).card).toContain('on the sampled rolls; a repeated stalling move only delays it.');
  });
});
