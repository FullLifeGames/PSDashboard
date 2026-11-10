import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { logRules, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import type { BringWorld } from '@fulllifegames/eval-engine';
import { ChoicePicker } from '../../../../src/components/dock/WhatIfSection';
import { SwitchRow } from '../../../../src/components/dock/SwitchRow';
import { LeadPanel } from '../../../../src/components/LeadPanel';
import { GuessedBodiesContext, STAND_IN_BADGE, STAND_IN_MARK, guessedBodies } from '../../../../src/lib/stand-in-mark';
import type { LeadOption } from '../../../../src/lib/lead-options';
import { simState, switchOption } from '../../fixtures/sim-state';

/**
 * Round 89 (#124): the body a short side's heaviest world guesses wears its own mark: the log never showed it, and the engine plays
 * it as the likeliest by usage of the bodies the side's team preview still holds. The mark names the other candidates and says
 * where the guess comes from; a teammate stand-in (round 88) keeps its own words. Doubles (four of six) and singles (three of
 * six) read the same lookup.
 */
const rules = logRules('|gen|9|\n|tier|[Gen 9] VGC 2026 Reg I');
const world = (p1: string[], weight: number, guessed = 1, p2 = ['Aerodactyl', 'Farigiraf', 'Kingambit', 'Sylveon']): BringWorld =>
  ({ p1, p2, guessed: { p1: guessed, p2: 0 }, weight });
/** Doubles: P1 fielded Farigiraf, Basculegion and Lopunny; Kingambit, Ninetales-Alola and Ceruledge are the guesses. */
const DOUBLES_WORLDS = [
  world(['Farigiraf', 'Basculegion', 'Lopunny', 'Kingambit'], 0.7),
  world(['Farigiraf', 'Basculegion', 'Lopunny', 'Ninetales-Alola'], 0.2),
  world(['Farigiraf', 'Basculegion', 'Lopunny', 'Ceruledge'], 0.1),
];
/** Singles: P1 fielded Garchomp and Gholdengo; Kingambit or Dragonite is the third. */
const SINGLES_WORLDS = [
  world(['Garchomp', 'Gholdengo', 'Kingambit'], 0.6, 1, ['Weavile', 'Clefable', 'Heatran']),
  world(['Garchomp', 'Gholdengo', 'Dragonite'], 0.4, 1, ['Weavile', 'Clefable', 'Heatran']),
];
const lookup = (worlds: BringWorld[] | null, p1: OpponentTeamInfo | null = null) => guessedBodies(p1, null, rules, worlds);
const info = (...species: [string, boolean][]): OpponentTeamInfo => ({
  pokemon: species.map(([name, standIn]) => ({ species: name, ...(standIn ? { standIn: true as const } : {}) })) as OpponentTeamInfo['pokemon'],
});

const BRING_TITLE = /The log never showed this player's last Pokémon\. The engine plays Kingambit, the likeliest by usage \(also possible: Ninetales-Alola, Ceruledge\)/;

describe('the lookup of the bring guess', () => {
  test('doubles: the heaviest world\'s guess carries the mark with the other candidates; fielded bodies and the other side carry none', () => {
    const marks = lookup(DOUBLES_WORLDS);
    expect(marks('p1', 'Kingambit')).toMatchObject({ badge: STAND_IN_BADGE, text: 'Not fielded (guessed from usage)' });
    expect(marks('p1', 'Kingambit')?.title).toMatch(BRING_TITLE);
    expect(marks('p1', 'Lopunny')).toBeNull();
    expect(marks('p2', 'Kingambit')).toBeNull();
    // A lighter world's guess is not on the heaviest world's bench.
    expect(marks('p1', 'Ceruledge')).toBeNull();
  });

  test('singles: the same lookup names the one other candidate, and a form of the species matches by the game Dex', () => {
    const marks = lookup(SINGLES_WORLDS);
    expect(marks('p1', 'Kingambit')?.title).toMatch(/The engine plays Kingambit, the likeliest by usage \(also possible: Dragonite\)/);
    expect(marks('p1', 'Garchomp')).toBeNull();
    expect(lookup([{ ...DOUBLES_WORLDS[0], p1: ['Farigiraf', 'Basculegion', 'Lopunny', 'Rotom-Wash'] }])('p1', 'Rotom-Wash')?.title)
      .toMatch(/The engine plays Rotom-Wash, the only body the team preview leaves\./);
  });

  test('a world with two guesses marks both; a game with no worlds and no stand-ins has no marks', () => {
    const two = lookup([{ p1: ['Alpha', 'Beta', 'Kingambit', 'Ceruledge'], p2: ['Gamma'], guessed: { p1: 2, p2: 0 }, weight: 1 }]);
    expect(two('p1', 'Kingambit')).not.toBeNull();
    expect(two('p1', 'Ceruledge')).not.toBeNull();
    expect(two('p1', 'Beta')).toBeNull();
    expect(lookup(null)('p1', 'Kingambit')).toBeNull();
    expect(lookup([{ ...DOUBLES_WORLDS[0], guessed: { p1: 0, p2: 0 } }])('p1', 'Kingambit')).toBeNull();
  });

  test('a teammate stand-in keeps the words of round 88, beside a bring guess', () => {
    const marks = lookup(DOUBLES_WORLDS, info(['Lopunny', true]));
    expect(marks('p1', 'Lopunny')).toMatchObject({ badge: STAND_IN_BADGE, text: STAND_IN_MARK });
    expect(marks('p1', 'Kingambit')?.text).toBe('Not fielded (guessed from usage)');
  });
});

describe('the mark on the tiles and in the picker', () => {
  test('a switch tile of the guess wears the bring wording; a fielded tile wears none', () => {
    render(
      <GuessedBodiesContext.Provider value={lookup(DOUBLES_WORLDS)}>
        <SwitchRow
          side="p1" activeName="Farigiraf" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={() => undefined}
          switches={[switchOption('Kingambit'), switchOption('Lopunny', { slot: 3 })]}
        />
      </GuessedBodiesContext.Provider>,
    );
    const guess = within(screen.getByRole('button', { name: /Kingambit/ })).getByText(STAND_IN_BADGE);
    expect(guess.getAttribute('title')).toMatch(BRING_TITLE);
    expect(within(screen.getByRole('button', { name: /Lopunny/ })).queryByText(STAND_IN_BADGE)).toBeNull();
  });

  test('the All choices list names the bring wording on the guess option (singles)', () => {
    const singles = simState('singles');
    const [first, second] = singles.p1SwitchesBySlot[0];
    const worlds = [world(['Garchomp', first.species], 0.5), world(['Garchomp', 'Dragonite'], 0.5)];
    render(
      <GuessedBodiesContext.Provider value={lookup(worlds)}>
        <ChoicePicker side="p1" label="P1" moves={singles.p1MovesBySlot[0]} switches={[first, second]} blockedSwitchKeys={new Set()} onPick={() => undefined} />
      </GuessedBodiesContext.Provider>,
    );
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: `Switch: ${first.species} (100% HP) · Not fielded (guessed from usage)` })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: `Switch: ${second.species} (100% HP)` })).toBeInTheDocument();
  });

  test('the lead picker tile of the guess wears the bring wording (doubles)', () => {
    const option = (species: string): LeadOption => ({ name: species, species, wasLead: false, wasBrought: false });
    render(
      <GuessedBodiesContext.Provider value={lookup(DOUBLES_WORLDS)}>
        <LeadPanel
          playerNames={['Alice', 'Bob']} leadsPerSide={2} bringCount={null} executing={false} onStart={() => undefined}
          p1Options={[option('Farigiraf'), option('Kingambit')]} p2Options={[option('Aerodactyl'), option('Sylveon')]}
        />
      </GuessedBodiesContext.Provider>,
    );
    expect(screen.getAllByText(STAND_IN_BADGE)).toHaveLength(1);
    expect(within(screen.getByRole('button', { name: /^Kingambit/ })).getByText(STAND_IN_BADGE).getAttribute('title')).toMatch(BRING_TITLE);
  });
});
