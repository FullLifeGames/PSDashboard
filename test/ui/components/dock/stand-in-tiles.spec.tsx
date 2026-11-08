import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { logRules, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import { ChoicePicker } from '../../../../src/components/dock/WhatIfSection';
import { SwitchRow } from '../../../../src/components/dock/SwitchRow';
import { LeadPanel } from '../../../../src/components/LeadPanel';
import { GuessedBodiesContext, STAND_IN_MARK, guessedBodies } from '../../../../src/lib/stand-in-mark';
import type { LeadOption } from '../../../../src/lib/lead-options';
import { simState, switchOption } from '../../fixtures/sim-state';

/**
 * Round 88 (F, #101, ruling 2): a body the log never showed (a stand-in) wears the stats panel's marker wherever the user can pick it
 * in the What-if: the dock's switch tile, its "All choices" list and the lead picker. A revealed body wears none, and a marked tile
 * still switches. Singles and doubles run the same tile path; the rows below play both.
 */
const rules = logRules('|gen|4|\n|tier|[Gen 4] OU');
const info = (...species: [string, boolean][]): OpponentTeamInfo => ({
  pokemon: species.map(([name, standIn]) => ({ species: name, ...(standIn ? { standIn: true as const } : {}) })) as OpponentTeamInfo['pokemon'],
});
const guessed = (p1: OpponentTeamInfo | null, p2: OpponentTeamInfo | null = null) => guessedBodies(p1, p2, rules);

const MARK_TITLE = new RegExp(STAND_IN_MARK.replace(/[()]/g, '\\$&'));

describe('the marker of a stand-in on the switch tiles', () => {
  test('a stand-in tile wears the marker and still switches; a revealed tile wears none', async () => {
    const onPick = vi.fn();
    render(
      <GuessedBodiesContext.Provider value={guessed(info(['Heatran', true], ['Latias', false]))}>
        <SwitchRow
          side="p1" activeName="Garchomp" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={onPick}
          switches={[switchOption('Heatran'), switchOption('Latias', { slot: 3 })]}
        />
      </GuessedBodiesContext.Provider>,
    );
    const heatran = screen.getByRole('button', { name: /Heatran/ });
    expect(within(heatran).getByTitle(MARK_TITLE)).toHaveTextContent('guessed');
    expect(within(screen.getByRole('button', { name: /Latias/ })).queryByTitle(MARK_TITLE)).toBeNull();
    await userEvent.click(heatran);
    expect(onPick).toHaveBeenCalledWith({ kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' });
  });

  test('the mark belongs to the side: the same species revealed on the other side wears none', () => {
    render(
      <GuessedBodiesContext.Provider value={guessed(info(['Heatran', true]), info(['Heatran', false]))}>
        <SwitchRow
          side="p2" activeName="Ferrothorn" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={vi.fn()}
          switches={[switchOption('Heatran')]}
        />
      </GuessedBodiesContext.Provider>,
    );
    expect(within(screen.getByRole('button', { name: /Heatran/ })).queryByTitle(MARK_TITLE)).toBeNull();
  });

  test('doubles: a stand-in on the bench of either slot wears the marker', () => {
    const doubles = simState('doubles');
    const bench = doubles.p2SwitchesBySlot[1];
    render(
      <GuessedBodiesContext.Provider value={guessed(null, info([bench[0].species, true]))}>
        <SwitchRow
          side="p2" activeName="Tornadus" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={vi.fn()}
          switches={bench}
        />
      </GuessedBodiesContext.Provider>,
    );
    expect(screen.getAllByTitle(MARK_TITLE)).toHaveLength(1);
    expect(within(screen.getByRole('button', { name: new RegExp(bench[0].species) })).getByTitle(MARK_TITLE)).toBeInTheDocument();
  });

  test('a form of the species matches by the game Dex, not by the display name', () => {
    render(
      <GuessedBodiesContext.Provider value={guessed(info(['Rotom-Wash', true]))}>
        <SwitchRow
          side="p1" activeName="Garchomp" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={vi.fn()}
          switches={[switchOption('Rotom-Wash')]}
        />
      </GuessedBodiesContext.Provider>,
    );
    expect(screen.getByTitle(MARK_TITLE)).toBeInTheDocument();
  });

  test('with no provider (a game with preview) no tile wears a marker', () => {
    render(
      <SwitchRow
        side="p1" activeName="Garchomp" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={vi.fn()}
        switches={[switchOption('Heatran')]}
      />,
    );
    expect(screen.queryByTitle(MARK_TITLE)).toBeNull();
  });
});

describe('the marker of a stand-in in the All choices list', () => {
  test('a stand-in option names the marker and stays selectable; a revealed one reads as before', async () => {
    const onPick = vi.fn();
    const singles = simState('singles');
    const [first, second] = singles.p1SwitchesBySlot[0];
    render(
      <GuessedBodiesContext.Provider value={guessed(info([first.species, true], [second.species, false]))}>
        <ChoicePicker side="p1" label="P1" moves={singles.p1MovesBySlot[0]} switches={[first, second]} blockedSwitchKeys={new Set()} onPick={onPick} />
      </GuessedBodiesContext.Provider>,
    );
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: `Switch: ${first.species} (100% HP) · ${STAND_IN_MARK}` })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: `Switch: ${second.species} (100% HP)` })).toBeInTheDocument();
    await userEvent.selectOptions(picker, `switch:${first.slot}`);
    expect(onPick).toHaveBeenLastCalledWith(`switch:${first.slot}`);
  });
});

describe('the marker of a stand-in in the lead picker', () => {
  const option = (species: string): LeadOption => ({ name: species, species, wasLead: false, wasBrought: false });

  test('singles: the stand-in tile wears the marker and still toggles; the revealed ones wear none', async () => {
    const onStart = vi.fn();
    render(
      <GuessedBodiesContext.Provider value={guessed(info(['Heatran', true], ['Latias', false]), info(['Weavile', false], ['Clefable', false]))}>
        <LeadPanel
          playerNames={['Alice', 'Bob']} leadsPerSide={1} bringCount={null} executing={false} onStart={onStart}
          p1Options={[option('Heatran'), option('Latias')]} p2Options={[option('Weavile'), option('Clefable')]}
        />
      </GuessedBodiesContext.Provider>,
    );
    expect(screen.getAllByTitle(MARK_TITLE)).toHaveLength(1);
    expect(within(screen.getByRole('button', { name: /^Heatran/ })).getByTitle(MARK_TITLE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Heatran/ }));
    expect(screen.getByRole('button', { name: /^Heatran/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('doubles: a stand-in on the second side wears the marker', () => {
    render(
      <GuessedBodiesContext.Provider value={guessed(null, info(['Kingambit', true]))}>
        <LeadPanel
          playerNames={['Alice', 'Bob']} leadsPerSide={2} bringCount={null} executing={false} onStart={vi.fn()}
          p1Options={[option('Incineroar'), option('Amoonguss')]} p2Options={[option('Tornadus'), option('Kingambit')]}
        />
      </GuessedBodiesContext.Provider>,
    );
    expect(screen.getAllByTitle(MARK_TITLE)).toHaveLength(1);
    expect(within(screen.getByRole('button', { name: /^Kingambit/ })).getByTitle(MARK_TITLE)).toBeInTheDocument();
  });
});
