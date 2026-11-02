import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import type { Battle } from '@pkmn/sim';
import { serializeLiveBattle, type BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { pickerFromSerialized, type PickerSource } from '../../../../src/lib/picker-state';
import { diceBattle, setOf } from '../../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7b, moved to the dock in round 84 (A3b): the chips at a viewed replay position. A stored position
 * has its own revived battle (no branch yet), the chips read the log's dice from the replay's lines (`loggedDiceAt`), and the
 * picks go to the draft like any other pick. A position that is only approximated has no battle: once the tray opens "Dice ·
 * What if" the strip says the dice wait for the exact one.
 */
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => [] }));

/** What each reader of the log's dice was asked, and what they answer. */
const read = vi.hoisted(() => ({ logged: [] as unknown[], at: [] as unknown[][], turn: [] as unknown[][] }));
vi.mock('../../../../src/lib/lazy/branch-engine', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../src/lib/lazy/branch-engine')>()),
  loggedDiceAt: (...args: unknown[]) => {
    read.at.push(args);
    return read.logged;
  },
  loggedTurnDice: (...args: unknown[]) => {
    read.turn.push(args);
    return [];
  },
}));

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };
const AIR_SLASH: BranchSlotChoice = { kind: 'move', moveId: 'airslash', moveName: 'Air Slash' };
const LOGGED_CRIT = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'crit' }, result: { happens: true } };

const BOARDS = {
  singles: { p1: [setOf('Noivern', ['airslash', 'splash'])], p2: [setOf('Snorlax', ['splash'])] },
  doubles: {
    p1: [setOf('Noivern', ['airslash', 'splash']), setOf('Pikachu', ['thunderbolt', 'splash'])],
    p2: [setOf('Snorlax', ['splash']), setOf('Chansey', ['splash'])],
    format: 'gen9doublescustomgame',
  },
};

const storedPosition = (kind: keyof typeof BOARDS = 'singles') => pickerFromSerialized(serializeLiveBattle(diceBattle(BOARDS[kind])));

interface Shown {
  battle: Battle | null; source: PickerSource; replayLog?: string; acquiringExact?: boolean; kind?: keyof typeof BOARDS;
}

/** The dock over a viewed position: the stored position's state with the draft picks mirrored in, as the app keeps them. */
async function renderViewed({ battle, source, replayLog, acquiringExact, kind = 'singles' }: Shown) {
  const { state } = await storedPosition(kind);
  const pick: BranchSlotChoice = kind === 'doubles' ? { ...AIR_SLASH, targetLoc: 1 } : AIR_SLASH;
  const latest: { picks: Picks } = { picks: { p1: [pick], p2: [] } };
  function Host() {
    const [picks, setPicks] = useState<Picks>(latest.picks);
    const simState = useMemo(() => ({ ...state, p1Choice: picks.p1[0] ?? null, p1Choices: picks.p1, p2Choice: picks.p2[0] ?? null, p2Choices: picks.p2 }), [picks]);
    return (
      <TurnDock
        simState={simState} source={source} acquiringExact={acquiringExact} executeError={null} executing={false} gen={9} positionKey="viewed"
        onSetChoice={(side, choice, slot = 0) => setPicks(held => {
          const next = { ...held, [side]: [...held[side]] };
          next[side][slot] = choice;
          latest.picks = next;
          return next;
        })}
        onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()}
        {...(battle ? { getBattle: () => battle as never } : {})}
        {...(replayLog ? { replayLog } : {})}
      />
    );
  }
  render(<Host />);
  return latest;
}

const chipLabel = { singles: 'P1', doubles: 'P1A' };
/** Opens the tray of the slot that holds the pick, then its "Dice · What if" section. */
async function openDice(kind: keyof typeof BOARDS = 'singles') {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${chipLabel[kind]} `) }));
  await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Dice · What if/ }));
}

const settle = () => new Promise(resolve => setTimeout(resolve, 250));
const forget = () => {
  read.logged = [];
  read.at.length = 0;
  read.turn.length = 0;
};

describe('the dock dice chips at a viewed position', () => {
  test('a stored position shows the dice of the chosen move, the log among them, and a click goes to the draft', async () => {
    forget();
    read.logged = [LOGGED_CRIT];
    const { battle } = await storedPosition();
    const user = userEvent.setup();
    const latest = await renderViewed({ battle, source: 'stored', replayLog: 'the replay log' });
    await openDice();
    const crit = await screen.findByRole('group', { name: 'Crit' });
    expect(within(crit).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Crit · log', 'No crit']);
    // the log's dice come from the replay's lines, not from a branch's first-turn PRNG
    expect(read.at.some(args => args[1] === 'the replay log')).toBe(true);
    expect(read.turn).toEqual([]);
    await user.click(within(crit).getByRole('button', { name: 'No crit' }));
    // the crit needs the hit: the panel sets it with the crit (decision 5a)
    await waitFor(() => expect(latest.picks.p1[0]?.dice?.map(die => [die.name.kind, die.result])).toEqual([['crit', { happens: false }], ['accuracy', { happens: true }]]));
  });

  test('doubles: a stored position shows the dice of the chosen move, the log among them', async () => {
    forget();
    read.logged = [LOGGED_CRIT];
    const { battle } = await storedPosition('doubles');
    await renderViewed({ battle, source: 'stored', replayLog: 'the replay log', kind: 'doubles' });
    await openDice('doubles');
    const crit = await screen.findByRole('group', { name: 'Crit' });
    expect(within(crit).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Crit · log', 'No crit']);
    expect(read.at.some(args => args[0] === battle && args[1] === 'the replay log')).toBe(true);
  });

  test('a stored position of a variation has no replay log to read: the battle\'s own first-turn reading stands', async () => {
    forget();
    read.logged = [LOGGED_CRIT];
    const { battle } = await storedPosition();
    await renderViewed({ battle, source: 'stored' });
    await openDice();
    await screen.findByRole('group', { name: 'Crit' });
    expect(read.at).toEqual([]);
    expect(read.turn.length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /· log/ })).toBeNull();
  });

  test('an approximated position shows no chips and says the dice wait for the exact position', async () => {
    forget();
    await renderViewed({ battle: null, source: 'snapshot', acquiringExact: true });
    await openDice();
    await settle();
    expect(screen.queryByRole('group', { name: 'Crit' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('Dice need the exact position. They appear once it is ready.');
  });

  test('a closed tray says nothing about dice, at an approximated position either', async () => {
    forget();
    await renderViewed({ battle: null, source: 'snapshot', acquiringExact: true });
    await screen.findByRole('button', { name: /^P1/ });
    await userEvent.click(screen.getByRole('button', { name: /^P1/ }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  test('a stored position says nothing about waiting', async () => {
    forget();
    const { battle } = await storedPosition();
    await renderViewed({ battle, source: 'stored' });
    await openDice();
    await screen.findByRole('group', { name: 'Crit' });
    expect(screen.queryByRole('note')).toBeNull();
  });
});
