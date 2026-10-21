import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '@fulllifegames/eval-engine';
import { BranchPanel } from '../../src/components/BranchPanel';

/**
 * Round 73 (T202, design gate 3a): Hatterene's Expanding Force in Psychic Terrain against a lone Blissey behind a screen. The
 * calculator spreads the move over every foe and holds no screen factor for the one target the simulator plays, so the preview
 * hands the live battle of the branch to the engine and shows the simulator's own range. Without a live battle it shows no range.
 * The oracle is the simulator: it plays the move and the HP the foe loses lies in the shown range.
 */
vi.mock('../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { ...STATS, hp: 252, atk: 252, spa: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
});

/** A doubles battle in Psychic Terrain in which the first foe stands alone behind a screen. */
function loneFoeBehind(screen: string | null): Battle {
  const battle = new Battle({
    formatid: toID('gen9doublescustomgame'), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([set('Hatterene', ['Expanding Force', 'Splash']), set('Snorlax', ['Splash'])]) },
    p2: { name: 'Beta', team: Teams.pack([set('Blissey', ['Splash']), set('Chansey', ['Splash'])]) },
  });
  battle.choose('p1', 'team 12');
  battle.choose('p2', 'team 12');
  battle.sides[1].active[1]!.faint();
  battle.faintMessages();
  battle.field.setTerrain('psychicterrain', 'debug');
  if (screen) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]!);
  return battle;
}

/** The percent of Blissey's HP the simulator takes off when Hatterene plays the move. */
function simulatorPercent(screen: string): number {
  const battle = loneFoeBehind(screen);
  const foe = battle.sides[1].active[0]!;
  const before = foe.hp;
  battle.choose('p1', 'move expandingforce 1, move splash');
  battle.choose('p2', 'move splash, pass');
  return Math.round((before - foe.hp) / foe.maxhp * 1000) / 10;
}

const p1a = () => {
  const heading = [...document.querySelectorAll('.ps-side-label')].find(label => label.textContent === 'P1A')!;
  return within(heading.closest('.ps-side-controls') as HTMLElement);
};

function renderPanel(screen: string | null, live: boolean) {
  localStorage.setItem('ps-replay-interceptor:picker-advanced', '1');
  const battle = loneFoeBehind(screen);
  render(<BranchPanel
    simState={createBranchStateFromBattle(battle as never, [], {})} executeError={null} executing={false} gen={9}
    onSetChoice={vi.fn()} onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()} positionKey={`live-hit:${screen ?? 'none'}`}
    {...(live ? { getBattle: () => battle as never } : {})}
  />);
  return p1a().getByRole('button', { name: /Expanding Force/ });
}

const RANGE = /^(\d+(?:\.\d+)?)% - (\d+(?:\.\d+)?)%/;
/** The damage line of a move row (the range, then the KO chance). */
const shownRange = (row: HTMLElement) => row.querySelector('.ps-movebtn-dmg')?.textContent ?? '';

describe('BranchPanel: the preview of a forced spread on a lone foe behind a screen', () => {
  for (const screen of ['reflect', 'lightscreen', 'auroraveil']) {
    test(`behind ${screen}: with the live battle the range holds the simulator's damage`, async () => {
      const row = renderPanel(screen, true);
      await waitFor(() => expect(shownRange(row)).toMatch(RANGE));
      const [, low, high] = shownRange(row).match(RANGE)!.map(Number);
      const percent = simulatorPercent(screen);
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeGreaterThanOrEqual(low);
      expect(percent).toBeLessThanOrEqual(high);
    });
  }

  test('without a screen the calc prices the hit, live battle or not (the wait below is long enough to see a range)', async () => {
    const row = renderPanel(null, false);
    await waitFor(() => expect(shownRange(row)).toMatch(RANGE));
  });

  test('without the live battle (a stored position) the row shows no range', async () => {
    const row = renderPanel('lightscreen', false);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Expanding Force/ }).length).toBeGreaterThan(0));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(shownRange(row)).toBe('');
  });
});
