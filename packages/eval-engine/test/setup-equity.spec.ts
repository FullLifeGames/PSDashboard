import { test, expect, describe } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, BoostsTable, PokemonSet } from '@pkmn/sim';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { combinedOptionHints, ownStages, singlesOptionHints } from '../src/search/hints';
import { boostedFraction, pairThreat } from '../src/score/threat';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 64 (T125, point 2): a doubles status part is hinted by the damage its
 * stages buy the user over two attacks (setupEquity). It read `move.boosts`
 * whoever the move lands on, so Swagger, Decorate and Coaching priced as the
 * user's own setup, and it skipped Speed, accuracy and evasion, which Stored
 * Power reads. Singles price a status move at its damage, 0, and never ask.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const option = (choice: string) => ({ choice, label: choice });
/** The support floor of a status part, and the hint of the partner's Splash. */
const FLOOR = 0.25;

/** The hint of slot 0's part, the partner Splashing (its part adds the floor). */
function partHint(battle: Battle, part: string): number {
  return combinedOptionHints(rootOf(battle), 'p1', [option(`${part}, move splash`)])[0] - FLOOR;
}

const foes = () => [splash('Machamp'), splash('Blissey')];

const nonzero = (stages: Partial<BoostsTable>) => Object.fromEntries(Object.entries(stages).filter(([, stage]) => stage)) as Partial<BoostsTable>;
const sameStages = (a: Partial<BoostsTable>, b: Partial<BoostsTable>) =>
  Object.keys({ ...a, ...b }).every(stat => a[stat as keyof BoostsTable] === b[stat as keyof BoostsTable]);

/**
 * Moves whose stages a handler sets and the Dex does not carry: Belly Drum
 * with its HP cost, Acupressure on a random stat, a Stockpile layer, Curse by
 * the user's type, Take Heart and Tidy Up beside the cure or the clearing.
 * ownStages and the setup hint leave them out, as before round 64.
 */
const HANDLER_STAGES = ['acupressure', 'bellydrum', 'curse', 'stockpile', 'takeheart', 'tidyup'];

/**
 * The stages the simulator leaves on a user after it plays the move once in
 * doubles (Mew, no ability, next to a Splashing ally, two Splashing foes),
 * aimed as the first legal choice aims it; a charging move plays its second
 * turn too.
 */
function playedStages(format: string, id: string): Partial<BoostsTable> {
  const battle = battleOf(format, [set('Mew', [id, 'splash']), splash('Pikachu')], [splash('Snorlax'), splash('Blissey')]);
  const user = battle.sides[0].active[0];
  const choice = legalChoices(rootOf(battle), 'p1').find(option => option.choice.startsWith(`move ${id}`));
  if (!choice) return {};
  battle.choose('p1', choice.choice);
  battle.choose('p2', 'move 1, move 1');
  for (let turn = 0; turn < 2 && user.volatiles['twoturnmove'] && !battle.ended; turn++) {
    battle.choose('p1', 'default');
    battle.choose('p2', 'move 1, move 1');
  }
  return { ...user.boosts };
}

describe('setup equity counts the stages the move gives its user (round 64, T125)', () => {
  test('a stage the move gives another body buys the user no setup', () => {
    // Swagger and Decorate raise the target, Coaching the ally; each user carries an attack the stages would feed.
    const swagger = battleOf('gen9doublescustomgame', [set('Garchomp', ['swagger', 'earthquake']), splash('Pikachu')], foes());
    expect(partHint(swagger, 'move swagger 1')).toBe(FLOOR);
    const decorate = battleOf('gen9doublescustomgame', [set('Garchomp', ['decorate', 'dracometeor']), splash('Pikachu')], foes());
    expect(partHint(decorate, 'move decorate 1')).toBe(FLOOR);
    const coaching = battleOf('gen9doublescustomgame', [set('Corviknight', ['coaching', 'bodypress']), splash('Pikachu')], foes());
    expect(partHint(coaching, 'move coaching -2')).toBe(FLOOR);
  });

  test('Agility buys a Stored Power carrier its power, as the simulator stages it', () => {
    const team = () => [set('Espeon', ['agility', 'storedpower']), splash('Pikachu')];
    const before = battleOf('gen9doublescustomgame', team(), foes());
    const hint = partHint(before, 'move agility');
    // The simulator plays Agility; the equity is twice the best gain the staged body reads against a foe.
    const after = battleOf('gen9doublescustomgame', team(), foes());
    after.choose('p1', 'move 1, move 1');
    after.choose('p2', 'move 1, move 1');
    const [espeon, then] = [before.sides[0].active[0], after.sides[0].active[0]];
    expect(then.boosts.spe).toBe(2);
    const gains = before.sides[1].active.map((foe, index) => {
      const foeThen = after.sides[1].active[index];
      return boostedFraction(pairThreat(then, foeThen, after), then, foeThen) - boostedFraction(pairThreat(espeon, foe, before), espeon, foe);
    });
    const equity = 2 * Math.max(...gains);
    expect(equity).toBeGreaterThan(FLOOR);
    expect(hint).toBeCloseTo(equity, 10);
  });

  test('a self-boosting move still prices its own stages (Swords Dance)', () => {
    const battle = battleOf('gen9doublescustomgame', [set('Garchomp', ['swordsdance', 'earthquake']), splash('Pikachu')], foes());
    const [chomp, machamp] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const threat = pairThreat(chomp, machamp, battle);
    const blissey = battle.sides[1].active[1];
    const best = Math.max(
      boostedFraction(threat, chomp, machamp, { atk: 2 }) - boostedFraction(threat, chomp, machamp),
      boostedFraction(pairThreat(chomp, blissey, battle), chomp, blissey, { atk: 2 }) - boostedFraction(pairThreat(chomp, blissey, battle), chomp, blissey));
    expect(partHint(battle, 'move swordsdance')).toBeCloseTo(2 * best, 10);
  });

  test('ownStages reads every Dex status move as the simulator stages its user', () => {
    for (const format of ['gen9doublescustomgame', 'gen8doublescustomgame']) {
      const dex = battleOf(format, [splash('Mew'), splash('Pikachu')], foes()).dex;
      const disagree: Record<string, { ours: Partial<BoostsTable>; sim: Partial<BoostsTable> }> = {};
      for (const move of dex.moves.all()) {
        if (move.category !== 'Status' || move.isZ || move.isMax || move.callsMove) continue;
        const [ours, sim] = [nonzero(ownStages(move) ?? {}), nonzero(playedStages(format, move.id))];
        if (!sameStages(ours, sim)) disagree[move.id] = { ours, sim };
      }
      expect({ format, moves: Object.keys(disagree).sort() })
        .toEqual({ format, moves: HANDLER_STAGES.filter(id => dex.moves.get(id).exists) });
    }
  });

  test('singles price a status move at its damage and never ask for setup', () => {
    const root = rootOf(battleOf('gen9customgame', [set('Garchomp', ['swordsdance', 'swagger', 'earthquake'])], [splash('Blissey')]));
    expect(singlesOptionHints(root, 'p1', [option('move swordsdance'), option('move swagger')])).toEqual([0, 0]);
    expect(positionBattle(root).sides[0].active[0].boosts.atk).toBe(0);
  });
});
