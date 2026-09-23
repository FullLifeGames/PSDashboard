import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { analyzeTurn } from '../src/analysis';
import { koOddsForOptions } from '../src/cell-blend';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';
import { anchorRoot, doublesRoot, pairSet, PLAYED, QUIET } from './pair-battles';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

describe('kill odds for doubles options (round 56)', () => {
  test('the played pair names its slot: Play Rough on Incineroar, a 90 % roll that kills', () => {
    const [odds] = koOddsForOptions(positionBattle(anchorRoot()), 'p1', [PLAYED[0]]);
    expect(odds).toEqual({ accuracy: 0.9, killFraction: 1, label: 'Play Rough→Incineroar' });
  });

  test('a foe the partner kills for sure carries no odds for the other slot', () => {
    // Karate Chop kills the level-30 Eevee on every roll, so Snorlax's crit-only Tackle kill on the same
    // Eevee says nothing about whether it lives; next to a Karate Chop on Pikachu the Tackle keeps its odds.
    const root = doublesRoot(
      [pairSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']), pairSet('Snorlax', 'Snorlax', ['Tackle', 'Protect'])],
      [pairSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], { level: 30 }), pairSet('Eevee', 'Eevee', ['Tackle', 'Growl'], { level: 30 })],
    );
    const [focus, split] = koOddsForOptions(positionBattle(root), 'p1', ['move karatechop 2, move tackle 2', 'move karatechop 1, move tackle 2']);
    expect(focus).toBeNull();
    expect(split).toEqual({ accuracy: 1, killFraction: expect.closeTo(1 / 24, 12), label: 'Tackle→Eevee' });
  });

  test('a pair without an uncertain kill carries no odds', () => {
    const [odds] = koOddsForOptions(positionBattle(anchorRoot()), 'p1', [QUIET[0]]);
    expect(odds).toBeNull();
  });

  test('a singles option keeps its odds without a label', () => {
    const battle = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'A', team: Teams.pack([pairSet('Jolt', 'Jolteon', ['Thunder'])]) },
      p2: { name: 'B', team: Teams.pack([pairSet('Champ', 'Machamp', ['Close Combat'])]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    battle.sides[1].active[0]!.sethp(1);
    const [odds] = koOddsForOptions(positionBattle(createRootPosition(JSON.stringify(State.serializeBattle(battle)))), 'p1', ['move thunder']);
    expect(odds).toEqual({ accuracy: 0.7, killFraction: 1 });
    expect(odds && 'label' in odds).toBe(false);
  });

  test('the true-odds note names the slot the label carries', () => {
    // The singles-shaped result of eval-summary.spec.ts, with a doubles label on the odds: the label replaces the option's name.
    const punished: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [choice('move dracometeor', 'Draco Meteor', 0.2)],
        p2: [
          choice('switch 3', '→ Dragapult', -0.05),
          { ...choice('move scald', 'Scald', -0.3), koOdds: { accuracy: 1, killFraction: 0.43, label: 'Scald→Garchomp' }, punishedBy: 'Draco Meteor' },
        ],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 23,
      result: punished,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Scald', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), ['Alpha', 'Beta']);
    expect(summary).toContain('(True odds: Scald→Garchomp kills ~43% of the time.)');
  });
});
