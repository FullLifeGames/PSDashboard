import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { applyForcedWin, forcedWinInput, forcedWinPossible } from '../src/search/forced-win-apply';
import { forcedWinFor, forcedWinSides } from '../src/search/forced-win';
import { createRootPosition, positionBattle } from '../src/forward-model';
import type { EvalResult, RankedChoice } from '../src/types';

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** Sets every listed body to `hp` (slot order per side) and serializes. */
function serializeAt(battle: Battle, hp: { p1?: number[]; p2?: number[] }): string {
  for (const side of ['p1', 'p2'] as const) {
    (hp[side] ?? []).forEach((value, index) => { battle.sides[side === 'p1' ? 0 : 1].pokemon[index].hp = value; });
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const row = (choice: string, ev: number): RankedChoice => ({ choice, label: choice, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });
const resultWith = (score: number, p1: string[], p2: string[], extra: Partial<EvalResult> = {}): EvalResult => ({
  score, interval: 0, depthCompleted: 1,
  perSide: { p1: p1.map(choice => row(choice, score)), p2: p2.map(choice => row(choice, -score)) },
  ...extra,
});

test.describe('forced-win trigger and bar (round 35)', () => {
  test('forcedWinInput carries score, profile, ranking order and the search allowance', () => {
    const result = resultWith(0.3, ['move seismictoss', 'move protect'], ['move softboiled'], {
      unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Machamp' } },
    });
    expect(forcedWinInput(result, { depth: 1, samples: 1, tera: false, sleepClause: true })).toEqual({
      score: 0.3,
      unanswered: result.unanswered,
      rootOrder: { p1: ['move seismictoss', 'move protect'], p2: ['move softboiled'] },
      tera: false,
      sleepClause: true,
    });
  });

  test('sides: endgame scope tries the favored side then the other; a decided profile names its side only', () => {
    const endgame = positionBattle(createRootPosition(serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
    ), { p2: [1] })));
    expect(forcedWinSides(endgame, { score: -0.1, rootOrder: { p1: [], p2: [] } })).toEqual(['p2', 'p1']);
    expect(forcedWinSides(endgame, { score: 0.2, rootOrder: { p1: [], p2: [] } })).toEqual(['p1', 'p2']);
    const full = positionBattle(createRootPosition(JSON.stringify(State.serializeBattle(makeBattle(
      [makeSet('A', 'Machamp', ['Seismic Toss']), makeSet('B', 'Chansey', ['Soft-Boiled']), makeSet('C', 'Snorlax', ['Rest'])],
      [makeSet('D', 'Machamp', ['Seismic Toss']), makeSet('E', 'Chansey', ['Soft-Boiled']), makeSet('F', 'Snorlax', ['Rest'])],
    )))));
    expect(forcedWinSides(full, { score: 0.5, rootOrder: { p1: [], p2: [] } })).toEqual([]);
    expect(forcedWinSides(full, {
      score: -0.7, rootOrder: { p1: [], p2: [] },
      unanswered: { p1: [], p2: [], decided: { side: 'p2', species: 'Machamp' } },
    })).toEqual(['p2']);
    // A named side with a lukewarm score stays out on a full board: no bank proof ever stood there.
    expect(forcedWinSides(full, {
      score: -0.5, rootOrder: { p1: [], p2: [] },
      unanswered: { p1: [], p2: [], decided: { side: 'p2', species: 'Machamp' } },
    })).toEqual([]);
    expect(forcedWinSides(full, {
      score: 0.6, rootOrder: { p1: [], p2: [] },
      unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Machamp', odds: 0.95, removes: 'Chansey' } },
    })).toEqual(['p1']);
  });

  test('forcedWinPossible mirrors the trigger without the sim: profiles, small boards, the last pair', () => {
    const noProfile = { score: 0.5, rootOrder: { p1: [], p2: [] } };
    const full = JSON.stringify(State.serializeBattle(makeBattle(
      [makeSet('A', 'Machamp', ['Seismic Toss']), makeSet('B', 'Chansey', ['Soft-Boiled']), makeSet('C', 'Snorlax', ['Rest'])],
      [makeSet('D', 'Machamp', ['Seismic Toss']), makeSet('E', 'Chansey', ['Soft-Boiled']), makeSet('F', 'Snorlax', ['Rest'])],
    )));
    expect(forcedWinPossible(full, noProfile)).toBe(false);
    expect(forcedWinPossible(full, { ...noProfile, unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Machamp' } } })).toBe(false);
    expect(forcedWinPossible(full, { ...noProfile, score: 0.7, unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Machamp' } } })).toBe(true);
    expect(forcedWinPossible(full, {
      ...noProfile, score: -0.9, unanswered: { p1: [], p2: [], nearDecided: { side: 'p2', species: 'Machamp', odds: 0.9, removes: 'Chansey' } },
    })).toBe(true);
    const pair = serializeAt(makeBattle([makeSet('Champ', 'Machamp', ['Seismic Toss'])], [makeSet('Egg', 'Chansey', ['Soft-Boiled'])]), { p2: [1] });
    expect(forcedWinPossible(pair, noProfile)).toBe(true);
    const twoVsOne = makeBattle(
      [makeSet('A', 'Machamp', ['Seismic Toss']), makeSet('B', 'Chansey', ['Soft-Boiled'])],
      [makeSet('D', 'Machamp', ['Seismic Toss']), makeSet('E', 'Chansey', ['Soft-Boiled'])],
    );
    twoVsOne.sides[1].pokemon[1].faint();
    twoVsOne.faintMessages();
    expect(forcedWinPossible(JSON.stringify(State.serializeBattle(twoVsOne)), noProfile)).toBe(true);
    expect(forcedWinPossible('not json', noProfile)).toBe(true);
  });

  test('forcedWinFor proves the endgame for the favored side and the bar lifts the score to the mass', () => {
    const serialized = serializeAt(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Protect'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
    ), { p2: [1] });
    const result = resultWith(0.4, ['move seismictoss', 'move protect'], ['move softboiled']);
    const outcome = forcedWinFor(createRootPosition(serialized), forcedWinInput(result, { depth: 1, samples: 1, tera: false }));
    expect(outcome?.side).toBe('p1');
    expect(outcome?.proof.mass).toBe(1);
    applyForcedWin(result, outcome);
    expect(result.score).toBe(1);
    expect(result.forcedWin).toEqual({ side: 'p1', turns: 1, mass: 1, caveat: 'none', engineScore: 0.4, states: outcome!.proof.states });
  });

  test('the bar blends a partial mass with the open branch static', () => {
    const result = resultWith(0.2, ['move thunder'], ['move closecombat']);
    applyForcedWin(result, { side: 'p1', proof: { mass: 0.7, turns: 1, caveat: 'none', openValue: -1, states: 3 } });
    expect(result.score).toBeCloseTo(0.4, 6);
    expect(result.forcedWin?.engineScore).toBe(0.2);
  });

  test('a coin flip (mass exactly one half) keeps the proof on the result but moves no score', () => {
    const result = resultWith(0.2, ['move tackle'], ['move tackle']);
    applyForcedWin(result, { side: 'p1', proof: { mass: 0.5, turns: 1, caveat: 'none', openValue: -1, states: 1, cells: 1 } });
    expect(result.score).toBe(0.2);
    expect(result.forcedWin).toEqual({ side: 'p1', turns: 1, mass: 0.5, caveat: 'none', engineScore: 0.2, states: 1 });
  });

  test('a mass below the threshold and a null outcome change nothing', () => {
    const result = resultWith(0.2, ['move thunder'], ['move closecombat']);
    applyForcedWin(result, { side: 'p1', proof: { mass: 0.4, turns: 1, caveat: 'none', openValue: -1, states: 3 } });
    applyForcedWin(result, null);
    expect(result.score).toBe(0.2);
    expect(result.forcedWin).toBeUndefined();
  });

  test('p2 proofs bar toward -1', () => {
    const result = resultWith(-0.3, ['move softboiled'], ['move seismictoss']);
    applyForcedWin(result, { side: 'p2', proof: { mass: 1, turns: 2, caveat: 'barring-crit', openValue: null, states: 5 } });
    expect(result.score).toBe(-1);
  });

  test('doubles: a 2v1 field is in scope and proves for the two-body side', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Champ2', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    battle.sides[1].active[1]!.faint();
    battle.faintMessages();
    const serialized = serializeAt(battle, { p2: [1] });
    const result = resultWith(0.1, [], []);
    const outcome = forcedWinFor(createRootPosition(serialized), forcedWinInput(result, { depth: 1, samples: 1, tera: false }));
    expect(outcome?.side).toBe('p1');
    expect(outcome?.proof.caveat).toBe('sampled-rolls');
  });
});
