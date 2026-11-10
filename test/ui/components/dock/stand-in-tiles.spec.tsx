import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { inferOpponentTeam, logRules, withStandIns, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import { ChoicePicker } from '../../../../src/components/dock/WhatIfSection';
import { SwitchRow } from '../../../../src/components/dock/SwitchRow';
import { LeadPanel } from '../../../../src/components/LeadPanel';
import { GuessedBodiesContext, RANDOM_SET_MARK, STAND_IN_MARK, guessedBodies } from '../../../../src/lib/stand-in-mark';
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

/**
 * Round 89 (lane B, #117): a body that came from the format's random-set data (a Random Battle) wears its own words, in the same places:
 * the switch tile, the All choices list, the lead picker, singles and doubles. The bodies are the real output of `withStandIns` on logs
 * the simulator played, so the provenance the lookup reads is the provenance the fill writes.
 */
describe('the marker of a random-set stand-in', () => {
  const game = (id: string) => JSON.parse(readFileSync(`packages/replay-core/test/fixtures/random-${id}.json`, 'utf-8')) as { log: string; randomSets: never };
  const filledOf = (id: string) => {
    const { log, randomSets } = game(id);
    const filled = withStandIns({ p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') }, log, null, undefined, randomSets);
    return { rules: logRules(log), p1: filled.p1, standIns: filled.p1.pokemon.filter(mon => mon.standIn).map(mon => mon.species) };
  };
  const MARK = new RegExp(RANDOM_SET_MARK.replace(/[()]/g, '\\$&'));

  test.each(['gen3randombattle-1', 'gen9randomdoublesbattle-11'])('%s: the lookup words the guesses, never the shown bodies', id => {
    const { rules, p1, standIns } = filledOf(id);
    const lookup = guessedBodies(p1, null, rules);
    expect(standIns.length).toBeGreaterThan(0);
    for (const species of standIns) {
      expect(lookup('p1', species)).toMatchObject({ text: RANDOM_SET_MARK, badge: 'guessed' });
      expect(lookup('p1', species)?.title).toMatch(/random-set data/);
    }
    const shown = p1.pokemon.filter(mon => !mon.standIn)[0].species;
    expect(lookup('p1', shown)).toBeNull();
  });

  test('singles: a random-set tile wears the random-set words, not the teammate words, and still switches', async () => {
    const { rules, p1, standIns } = filledOf('gen3randombattle-1');
    const onPick = vi.fn();
    render(
      <GuessedBodiesContext.Provider value={guessedBodies(p1, null, rules)}>
        <SwitchRow
          side="p1" activeName="Garchomp" pending={null} blockedSwitchKeys={new Set()} played={null} onPick={onPick}
          switches={[switchOption(standIns[0])]}
        />
      </GuessedBodiesContext.Provider>,
    );
    const tile = screen.getByRole('button', { name: new RegExp(standIns[0]) });
    expect(within(tile).getByTitle(MARK)).toHaveTextContent('guessed');
    expect(within(tile).queryByTitle(MARK_TITLE)).toBeNull();
    await userEvent.click(tile);
    expect(onPick).toHaveBeenCalled();
  });

  test('doubles: the All choices list names the random-set mark for a guess of the Doubles battle', () => {
    const { rules, p1, standIns } = filledOf('gen9randomdoublesbattle-11');
    const doubles = simState('doubles');
    const [first] = doubles.p1SwitchesBySlot[0];
    const asGuess = { ...first, species: standIns[0], name: standIns[0] };
    render(
      <GuessedBodiesContext.Provider value={guessedBodies(p1, null, rules)}>
        <ChoicePicker side="p1" label="P1" moves={doubles.p1MovesBySlot[0]} switches={[asGuess]} blockedSwitchKeys={new Set()} onPick={vi.fn()} />
      </GuessedBodiesContext.Provider>,
    );
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: new RegExp(`${standIns[0]}.*${RANDOM_SET_MARK.replace(/[()]/g, '\\$&')}`) })).toBeInTheDocument();
  });

  test('the lead picker marks a guess of either game type', () => {
    for (const id of ['gen3randombattle-1', 'gen9randomdoublesbattle-11']) {
      const { rules, p1, standIns } = filledOf(id);
      const { unmount } = render(
        <GuessedBodiesContext.Provider value={guessedBodies(p1, null, rules)}>
          <LeadPanel
            playerNames={['Alice', 'Bob']} leadsPerSide={id.includes('doubles') ? 2 : 1} bringCount={null} executing={false} onStart={vi.fn()}
            p1Options={standIns.slice(0, 2).map(name => ({ name, species: name, wasLead: false, wasBrought: false }))} p2Options={['Weavile', 'Clefable'].map(name => ({ name, species: name, wasLead: false, wasBrought: false }))}
          />
        </GuessedBodiesContext.Provider>,
      );
      expect(screen.getAllByTitle(MARK).length).toBeGreaterThan(0);
      unmount();
    }
  });
});
