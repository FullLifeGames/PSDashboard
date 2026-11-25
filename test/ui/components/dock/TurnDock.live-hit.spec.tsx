import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { simState } from '../../fixtures/sim-state';

// The calc spreads the move over every foe and holds no screen factor for a lone target; the simulator plays it.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw'] }));

const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { ...STATS, hp: 252, atk: 252, spa: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
});

function loneFoeBehind(screen: string | null): Battle {
  const battle = new Battle({
    formatid: toID('gen9doublescustomgame'), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([set('Hatterene', ['Expanding Force', 'Splash']), set('Snorlax', ['Splash'])]) },
    p2: { name: 'Beta', team: Teams.pack([set('Blissey', ['Splash']), set('Chansey', ['Splash'])]) },
  });
  battle.choose('p1', 'team 12');
  battle.choose('p2', 'team 12');
  battle.sides[1].active[1]!.faint();
  battle.resolveFaints();
  battle.field.setTerrain('psychicterrain', 'debug');
  if (screen) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]!);
  return battle;
}

function simulatorPercent(screen: string): number {
  const battle = loneFoeBehind(screen);
  const foe = battle.sides[1].active[0]!;
  const before = foe.hp;
  battle.choose('p1', 'move expandingforce 1, move splash');
  battle.choose('p2', 'move splash, pass');
  return Math.round((before - foe.hp) / foe.maxhp * 1000) / 10;
}

async function renderDock(screen: string | null, live: boolean) {
  const battle = loneFoeBehind(screen);
  render(<TurnDock
    simState={createBranchStateFromBattle(battle as never, [], {})} executeError={null} executing={false} gen={9}
    onSetChoice={vi.fn()} onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()} positionKey={`live-hit:${screen ?? 'none'}`}
    {...(live ? { getBattle: () => battle as never } : {})}
  />);
  await userEvent.click(within(document.body).getByRole('button', { name: /^P1A/ }));
  return within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Expanding Force/ });
}

const RANGE = /(\d+(?:\.\d+)?)% - (\d+(?:\.\d+)?)%/;
const shownRange = (row: HTMLElement) => row.getAttribute('title') ?? '';

describe('the dock: the preview of a forced spread on a lone foe behind a screen', () => {
  for (const screen of ['reflect', 'lightscreen', 'auroraveil']) {
    test(`behind ${screen}: with the live battle the range holds the simulator's damage`, async () => {
      const row = await renderDock(screen, true);
      await waitFor(() => expect(shownRange(row)).toMatch(RANGE));
      const [, low, high] = shownRange(row).match(RANGE)!.map(Number);
      const percent = simulatorPercent(screen);
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeGreaterThanOrEqual(low);
      expect(percent).toBeLessThanOrEqual(high);
    });
  }

  test('without a screen the calc prices the hit, live battle or not (the wait below is long enough to see a range)', async () => {
    const row = await renderDock(null, false);
    await waitFor(() => expect(shownRange(row)).toMatch(RANGE));
  });

  test('without the live battle (a stored position) the row shows no range', async () => {
    const row = await renderDock('lightscreen', false);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(shownRange(row)).toBe('');
  });
});

type Props = Parameters<typeof TurnDock>[0];

const props = (overrides: Partial<Props> = {}): Props => ({
  simState: simState('singles'), executeError: null, executing: false, gen: 9,
  onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
});

const read = () => document.documentElement.style.getPropertyValue('--ps-dock-h');

describe('the dock reports its height', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty('--ps-dock-h');
  });

  test.each(['singles', 'doubles'] as const)('a %s dock writes --ps-dock-h and removes it when it unmounts', kind => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 132 } as DOMRect);
    const { unmount } = render(<TurnDock {...props({ simState: simState(kind) })} />);
    expect(read()).toBe('132px');
    unmount();
    expect(read()).toBe('');
  });

  test('the ended notice reports it as well, and a dock without a state reports nothing', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect);
    const { rerender } = render(<TurnDock {...props({ simState: { ...simState('singles'), ended: true, winner: 'Alice' } })} />);
    expect(read()).toBe('40px');
    rerender(<TurnDock {...props({ simState: null })} />);
    expect(read()).toBe('');
  });
});
