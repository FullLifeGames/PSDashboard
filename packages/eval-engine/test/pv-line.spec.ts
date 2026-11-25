import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createRootPosition, legalChoices } from '../src/forward-model';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { formatLine, replacementWords } from '../src/prose/line';
import type { EvalResult, RankedChoice } from '../src/types';

describe('main lines without the waiting placeholder', () => {
  test('singles: the waiting half of a step drops, both halves of a normal step stay', () => {
    expect(formatLine([
      { p1: '→ Keldeo', p2: '(waiting)' },
      { p1: 'Earthquake', p2: '→ Tornadus-Therian' },
    ])).toBe('→ Keldeo → Earthquake · → Tornadus-Therian');
    expect(formatLine([{ p1: '(waiting)', p2: '→ Muk-Alola' }])).toBe('→ Muk-Alola');
  });

  test('doubles: a replacement pair at a forced-switch node reads alone too', () => {
    expect(formatLine([
      { p1: '(waiting)', p2: '→ Rillaboom + Protect' },
      { p1: 'Heat Wave + Protect', p2: 'Wood Hammer→Chi-Yu + Fake Out→Ursaluna' },
    ])).toBe('→ Rillaboom + Protect → Heat Wave + Protect · Wood Hammer→Chi-Yu + Fake Out→Ursaluna');
  });

  test('checker: the placeholder the helper drops is the exact label the engine gives a waiting side', () => {
    const set = (name: string, species: string, moves: string[], level: number): PokemonSet => ({
      name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level, gender: '',
    });
    const battle = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([set('Machamp', 'Machamp', ['Seismic Toss'], 100)]) },
      p2: { name: 'Beta', team: Teams.pack([set('Pikachu', 'Pikachu', ['Tackle'], 30), set('Eevee', 'Eevee', ['Tackle'], 30)]) },
    });
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    const waiting = legalChoices(createRootPosition(JSON.stringify(State.serializeBattle(battle))), 'p1');
    expect(waiting).toHaveLength(1);
    expect(formatLine([{ p1: waiting[0].label, p2: '→ Eevee' }])).toBe('→ Eevee');
  });

  test('the prose line of a punished misplay drops the placeholder', () => {
    const choice = (choiceStr: string, label: string, worstCase: number, line?: RankedChoice['line']): RankedChoice =>
      ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply', ...(line ? { line } : {}) });
    const result: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 2,
      perSide: {
        p1: [
          choice('switch 2', '→ Tyranitar', 0.3, [{ p1: '→ Keldeo', p2: '(waiting)' }]),
          choice('move scald', 'Scald', -0.1),
        ],
        p2: [choice('move icepunch', 'Ice Punch', -0.1)],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 12, result,
      played: { p1: { kind: 'move', name: 'Scald', tera: false }, p2: { kind: 'move', name: 'Ice Punch', tera: false } },
      playedOutcome: -0.1, scoreBefore: 0.1, scoreAfter: -0.1,
    }), ['Alpha', 'Beta']);
    expect(summary).toContain('switching to Tyranitar');
    expect(summary).toContain(', then → Keldeo.');
    expect(summary).not.toContain('(waiting)');
  });
});

describe('a replacement step', () => {
  test('singles: it reads "replaces:" and joins the next step with a comma', () => {
    expect(formatLine([
      { p1: '(waiting)', p2: '→ Dragonite', replacement: 'p2' },
      { p1: 'Power Gem', p2: 'Dragon Dance' },
    ])).toBe('replaces: → Dragonite, Power Gem · Dragon Dance');
  });

  test('a step before it joins with the arrow, a step without the flag keeps the arrow form', () => {
    expect(formatLine([
      { p1: 'Earthquake', p2: 'Protect' },
      { p1: '→ Keldeo', p2: '(waiting)', replacement: 'p1' },
      { p1: 'Hydro Pump', p2: 'Scald' },
      { p1: '(waiting)', p2: '→ Muk-Alola' },
    ])).toBe('Earthquake · Protect → replaces: → Keldeo, Hydro Pump · Scald → → Muk-Alola');
  });

  test('doubles: the slot that passes drops, and both sides read side by side', () => {
    expect(formatLine([{ p1: '(waiting)', p2: 'pass + → Zamazenta-Crowned', replacement: 'p2' }, { p1: 'Protect + Protect', p2: 'Tailwind + Protect' }]))
      .toBe('replaces: → Zamazenta-Crowned, Protect + Protect · Tailwind + Protect');
    expect(formatLine([{ p1: '→ Rillaboom + pass', p2: '→ Amoonguss + → Incineroar', replacement: 'both' }]))
      .toBe('replaces: → Rillaboom · → Amoonguss + → Incineroar');
  });

  test('both orders of a passing slot, and a label with no pass is unchanged', () => {
    expect(replacementWords('pass + → Zamazenta-Crowned')).toBe('→ Zamazenta-Crowned');
    expect(replacementWords('→ A + → B')).toBe('→ A + → B');
  });
});
