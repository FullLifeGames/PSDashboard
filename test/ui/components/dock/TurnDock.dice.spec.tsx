import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import type { Battle } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type BranchSlotChoice, type ForcedDie } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { diceBattle, setOf } from '../../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7a, moved to the dock in round 84 (A3b): the dice chips on a real battle. The dock asks the
 * simulator which dice the chosen move draws once a tray opens "Dice · What if", shows one set of chips per slot (one per target
 * of a spread move), and a click edits the slot's choice, which the dock hands to `onSetChoice` like any other pick. A closed
 * tray asks nothing and shows no chips.
 */
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => [] }));

/** What the log shows for the first turn: a spec sets it. The engine reads it from the battle's logged PRNG (arrival-dice.ts), which a battle built in this file does not have. */
const shown = vi.hoisted(() => ({ logged: [] as unknown[] }));
vi.mock('../../../../src/lib/lazy/branch-engine', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../src/lib/lazy/branch-engine')>()),
  loggedTurnDice: () => shown.logged,
}));

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

/** The dock over a live battle with its own picks, as the app keeps them. `latest` shows what the app would hold. */
function renderDock(battle: Battle, options: { live?: boolean; first?: Picks } = {}) {
  const { live = true, first = { p1: [], p2: [] } } = options;
  const latest: { picks: Picks } = { picks: first };
  function Host() {
    const [picks, setPicks] = useState<Picks>(first);
    const simState = useMemo(() => createBranchStateFromBattle(battle as never, [], { p1Choices: picks.p1, p2Choices: picks.p2 }), [picks]);
    return (
      <TurnDock
        simState={simState} executeError={null} executing={false} gen={9} positionKey="dice"
        onSetChoice={(side, choice, slot = 0) => setPicks(held => {
          const next = { ...held, [side]: [...held[side]] };
          next[side][slot] = choice;
          latest.picks = next;
          return next;
        })}
        onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()}
        {...(live ? { getBattle: () => battle as never } : {})}
      />
    );
  }
  render(<Host />);
  return latest;
}

const dockChip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);
/** Opens the slot's tray and its "Dice · What if" section. */
async function openDice(label: string) {
  await userEvent.click(dockChip(label));
  await userEvent.click(tray().getByRole('button', { name: /Dice · What if/ }));
}
/** A move tile of the open tray. */
const tile = (name: RegExp) => tray().getByRole('button', { name });

const singles = () => diceBattle({
  p1: [setOf('Noivern', ['airslash', 'splash'])], p2: [setOf('Snorlax', ['splash'])],
});

const diceOf = (picks: Picks, who: 'p1' | 'p2', slot = 0): ForcedDie[] | undefined => picks[who][slot]?.dice;
const kinds = (dice: ForcedDie[] | undefined) => dice?.map(die => [die.name.kind, die.result]);
const settle = () => new Promise(resolve => setTimeout(resolve, 250));

describe('the dock dice chips', () => {
  test('a closed tray shows no chips, even with a move chosen', async () => {
    renderDock(singles(), { first: { p1: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash' }], p2: [] } });
    await settle();
    expect(screen.queryByRole('group', { name: /Dice for/ })).toBeNull();
    await userEvent.click(dockChip('P1'));
    await settle();
    expect(screen.queryByRole('group', { name: /Dice for/ })).toBeNull();
  });

  test('without the branch battle there are no chips to offer', async () => {
    renderDock(singles(), { live: false, first: { p1: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash' }], p2: [] } });
    await openDice('P1');
    await settle();
    expect(screen.queryByRole('group', { name: /Dice for/ })).toBeNull();
  });

  test('a chosen move shows its dice, a click forces a result and a second click gives it back', async () => {
    const latest = renderDock(singles());
    await openDice('P1');
    await userEvent.click(tile(/Air Slash/));
    const dice = await screen.findByRole('group', { name: 'Dice for P1' });
    for (const caption of ['Hit', 'Crit', 'Flinch']) expect(within(dice).getByRole('group', { name: caption })).toBeInTheDocument();
    expect(within(within(dice).getByRole('group', { name: 'Hit' })).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Hits', 'Misses']);
    expect(within(dice).getByRole('combobox', { name: 'Damage roll' })).toBeInTheDocument();

    await userEvent.click(within(within(dice).getByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' }));
    expect(diceOf(latest.picks, 'p1')).toEqual([
      { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'flinch' }, result: { happens: true } },
      { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } },
    ]);
    const chip = () => within(screen.getByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' });
    await waitFor(() => expect(chip()).toHaveAttribute('aria-pressed', 'true'));

    // a second click gives the flinch back to the seed; the hit it pulled in stays set and shows, one click from clear
    await userEvent.click(chip());
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['accuracy', { happens: true }]]);
    await waitFor(() => expect(chip()).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(within(screen.getByRole('group', { name: 'Hit' })).getByRole('button', { name: 'Hits' }));
    expect('dice' in latest.picks.p1[0]!).toBe(false);
  });

  test('the other result of a die replaces the first, and the damage roll is a select', async () => {
    const latest = renderDock(singles());
    await openDice('P1');
    await userEvent.click(tile(/Air Slash/));
    const crit = () => screen.getByRole('group', { name: 'Crit' });
    await userEvent.click(await within(await screen.findByRole('group', { name: 'Crit' })).findByRole('button', { name: 'Crit' }));
    await userEvent.click(within(crit()).getByRole('button', { name: 'No crit' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['crit', { happens: false }], ['accuracy', { happens: true }]]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Damage roll' }), '15');
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['crit', { happens: false }], ['accuracy', { happens: true }], ['damage-roll', { step: 15 }]]);
  });

  test('a new move for the slot gives its dice back to the seed', async () => {
    const latest = renderDock(singles());
    await openDice('P1');
    await userEvent.click(tile(/Air Slash/));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' }));
    expect(diceOf(latest.picks, 'p1')).toHaveLength(2);
    await userEvent.click(tile(/Splash/));
    expect('dice' in latest.picks.p1[0]!).toBe(false);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Flinch' })).toBeNull());
  });

  test('a die the panel does not offer any more stays visible as a set chip and clears on a click', async () => {
    const stray: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'confusion' }, result: { happens: true } };
    const latest = renderDock(singles(), { first: { p1: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash', dice: [stray] }], p2: [] } });
    await openDice('P1');
    const chip = await screen.findByRole('button', { name: 'Confusion' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip);
    expect('dice' in latest.picks.p1[0]!).toBe(false);
  });
});

const doubles = () => diceBattle({
  format: 'gen9doublescustomgame',
  p1: [setOf('Garchomp', ['rockslide', 'splash'], { name: 'Chomp' }), setOf('Blissey', ['splash'])],
  p2: [setOf('Snorlax', ['splash']), setOf('Chansey', ['splash'])],
});

describe('the dock dice chips in doubles', () => {
  test('a spread move shows one set of chips per target, each target named', async () => {
    const latest = renderDock(doubles());
    await openDice('P1A');
    await userEvent.click(tile(/Rock Slide/));
    const dice = await screen.findByRole('group', { name: 'Dice for P1A' });
    for (const name of ['Snorlax', 'Chansey']) {
      expect(await within(dice).findByRole('group', { name: `Hit against ${name}` })).toBeInTheDocument();
      expect(within(dice).getByRole('group', { name: `Flinch against ${name}` })).toBeInTheDocument();
    }
    await userEvent.click(within(within(dice).getByRole('group', { name: 'Flinch against Chansey' })).getByRole('button', { name: 'Flinch' }));
    expect(diceOf(latest.picks, 'p1')?.map(die => [die.name.targetSlot, die.name.kind, die.result])).toEqual([['p2b', 'secondary', { happens: true }], ['p2b', 'accuracy', { happens: true }]]);
  });
});

describe('the dock dice of the turn', () => {
  const tied = () => diceBattle({
    p1: [setOf('Snorlax', ['tackle'], { name: 'Alpha Mon' })], p2: [setOf('Snorlax', ['tackle', 'splash'], { name: 'Beta Mon' })],
  });
  const tackle: BranchSlotChoice = { kind: 'move', moveId: 'tackle', moveName: 'Tackle' };

  test('two bodies that tie in speed get a speed tie chip once both sides chose, set on the lower slot', async () => {
    const latest = renderDock(tied(), { first: { p1: [tackle], p2: [tackle] } });
    await openDice('P1');
    const order = await screen.findByRole('group', { name: 'Move order' });
    expect(within(order).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Alpha Mon first', 'Beta Mon first']);
    await userEvent.click(within(order).getByRole('button', { name: 'Beta Mon first' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['speed-tie', { first: 'p2a' }]]);
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Move order' })).getByRole('button', { name: 'Beta Mon first' })).toHaveAttribute('aria-pressed', 'true'));
  });

  test('a Pokémon with an end-of-turn die gets an End of turn row', async () => {
    const battle = diceBattle({
      p1: [setOf('Snorlax', ['splash'])], p2: [setOf('Tropius', ['splash'], { ability: 'Harvest', item: 'Sitrus Berry' })],
    });
    const splash: BranchSlotChoice = { kind: 'move', moveId: 'splash', moveName: 'Splash' };
    const latest = renderDock(battle, { first: { p1: [splash], p2: [splash] } });
    await openDice('P1');
    const row = await screen.findByRole('group', { name: 'End of turn for Tropius' });
    expect(within(row).getByRole('group', { name: 'Harvest' })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Triggers' }));
    expect(diceOf(latest.picks, 'p2')?.map(die => [die.name.slot, die.name.kind, die.result])).toEqual([['p2a', 'end-of-turn', { happens: true }]]);
  });

  test('before both sides chose there is no row for the turn', async () => {
    renderDock(tied(), { first: { p1: [tackle], p2: [] } });
    await openDice('P1');
    await settle();
    expect(screen.queryByRole('group', { name: 'Dice of the turn' })).toBeNull();
  });
});

describe('the dock dice a forced die needs (decision 5a)', () => {
  const airSlash: BranchSlotChoice = { kind: 'move', moveId: 'airslash', moveName: 'Air Slash' };

  test('forcing a crit sets the hit and says why, and a miss takes the crit back', async () => {
    const latest = renderDock(singles());
    await openDice('P1');
    await userEvent.click(tile(/Air Slash/));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Crit' })).getByRole('button', { name: 'Crit' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['crit', { happens: true }], ['accuracy', { happens: true }]]);
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Hit' })).getByRole('button', { name: 'Hits' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('Air Slash hits Snorlax because the crit needs a hit.')).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('group', { name: 'Hit' })).getByRole('button', { name: 'Misses' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['accuracy', { happens: false }]]);
    await waitFor(() => expect(screen.queryByText(/because the crit needs a hit/)).toBeNull());
  });

  test('a paralysed attacker has a status check chip that says what the body does, and a forced secondary passes it', async () => {
    const battle = singles();
    battle.sides[0].active[0]!.setStatus('par');
    const latest = renderDock(battle, { first: { p1: [airSlash], p2: [] } });
    await openDice('P1');
    const check = await screen.findByRole('group', { name: 'Paralysis check' });
    expect(within(check).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Paralysis lets it move', 'Paralysis stops it']);
    await userEvent.click(within(screen.getByRole('group', { name: 'Flinch' })).getByRole('button', { name: 'Flinch' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([
      ['secondary', { happens: true }], ['accuracy', { happens: true }], ['status-check', { happens: true }],
    ]);
    expect(await screen.findByText('Noivern passes the Paralysis check because the flinch needs it to move.')).toBeInTheDocument();
  });

  test('a spread move sets the hit on the target of the forced die only', async () => {
    const latest = renderDock(doubles());
    await openDice('P1A');
    await userEvent.click(tile(/Rock Slide/));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Crit against Chansey' })).getByRole('button', { name: 'Crit' }));
    expect(diceOf(latest.picks, 'p1')?.map(die => [die.name.kind, die.name.targetSlot])).toEqual([['crit', 'p2b'], ['accuracy', 'p2b']]);
  });
});

describe('the dock chips on the first turn of a branch', () => {
  const airSlash: BranchSlotChoice = { kind: 'move', moveId: 'airslash', moveName: 'Air Slash' };
  const loggedCrit = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'crit' }, result: { happens: true } };

  test('the log result of an action left as logged reads "log", and a click forces the other result', async () => {
    shown.logged = [loggedCrit];
    try {
      const latest = renderDock(singles(), { first: { p1: [airSlash], p2: [] } });
      await openDice('P1');
      const crit = await screen.findByRole('group', { name: 'Crit' });
      expect(within(crit).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Crit · log', 'No crit']);
      expect(within(crit).getByRole('button', { name: 'Crit · log' })).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(within(crit).getByRole('button', { name: 'No crit' }));
      expect(kinds(diceOf(latest.picks, 'p1'))).toEqual([['crit', { happens: false }], ['accuracy', { happens: true }]]);
      await waitFor(() => expect(within(screen.getByRole('group', { name: 'Crit' })).getByRole('button', { name: 'Crit · log' })).toBeInTheDocument());
    } finally {
      shown.logged = [];
    }
  });

  test('another move shows no log result: the logged die belongs to the logged action', async () => {
    shown.logged = [loggedCrit];
    try {
      renderDock(singles(), { first: { p1: [{ kind: 'move', moveId: 'splash', moveName: 'Splash' }], p2: [] } });
      await openDice('P1');
      await settle();
      expect(screen.queryByRole('button', { name: /· log/ })).toBeNull();
    } finally {
      shown.logged = [];
    }
  });
});

describe('the dock Quick Claw die', () => {
  const quickClaw = (format: string) => diceBattle({
    format,
    p1: [setOf('Snorlax', ['tackle'], { name: 'Alpha Mon', item: 'Quick Claw' })], p2: [setOf('Snorlax', ['tackle'], { name: 'Beta Mon' })],
  });
  const tackle: BranchSlotChoice = { kind: 'move', moveId: 'tackle', moveName: 'Tackle' };

  test('Gen 3 draws it once per turn for every holder on the field, and the chip says so', async () => {
    renderDock(quickClaw('gen3customgame'), { first: { p1: [tackle], p2: [tackle] } });
    await openDice('P1');
    const row = await screen.findByRole('group', { name: 'Quick Claw on Alpha Mon' });
    expect(within(row).getAllByRole('button').map(chip => chip.textContent)).toEqual(['Acts first', 'Does not act first']);
    expect(screen.getByText('The game draws this die once per turn for every holder on the field, so a chip here applies to all of them.')).toBeInTheDocument();
  });

  test('Gen 9 draws it per holder: no such note', async () => {
    renderDock(quickClaw('gen9customgame'), { first: { p1: [tackle], p2: [tackle] } });
    await openDice('P1');
    await screen.findByRole('group', { name: 'Quick Claw on Alpha Mon' });
    expect(screen.queryByText(/for every holder on the field/)).toBeNull();
  });
});

describe('the dock damage roll select', () => {
  const airSlash: BranchSlotChoice = { kind: 'move', moveId: 'airslash', moveName: 'Air Slash' };
  const percent = (option: HTMLElement) => Number(/(\d+(?:\.\d)?)%/.exec(option.textContent ?? '')![1]);

  /** The damage of each step as the calculator prices it, read the way the panel reads it. */
  function stepsOf(battle: Battle, crit = false): number[] {
    const state = createBranchStateFromBattle(battle as never, [], {});
    const result = calcSingleDamageRange(state.p1ActiveSlots![0]!, state.p2ActiveSlots![0]!, state.p1MovesBySlot![0][0], { gen: 9, rolls: true, ...(crit ? { isCrit: true } : {}) });
    return result.rolls!.damage;
  }

  test('every step lists its damage from the calculator, lowest first, and min and max set the ends', async () => {
    const battle = singles();
    const latest = renderDock(battle, { first: { p1: [airSlash], p2: [] } });
    await openDice('P1');
    const select = await screen.findByRole('combobox', { name: 'Damage roll' });
    const options = within(select).getAllByRole('option');
    expect(options.map(option => option.textContent)[0]).toBe('As rolled');
    const steps = options.slice(1);
    expect(steps).toHaveLength(16);
    expect(steps[0].textContent).toMatch(/^Damage roll 1 · \d+(\.\d)?%$/);
    const maxhp = battle.sides[1].active[0]!.maxhp;
    expect(steps.map(percent)).toEqual(stepsOf(battle).map(damage => Math.round(damage / maxhp * 1000) / 10));
    const roll = screen.getByRole('group', { name: 'Damage roll' });
    await userEvent.click(within(roll).getByRole('button', { name: 'Max' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toContainEqual(['damage-roll', { step: 15 }]);
    await userEvent.click(within(screen.getByRole('group', { name: 'Damage roll' })).getByRole('button', { name: 'Min' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toContainEqual(['damage-roll', { step: 0 }]);
    expect(within(screen.getByRole('group', { name: 'Damage roll' })).queryByRole('button', { name: 'Lowest KO roll' })).toBeNull();
  });

  test('the lowest KO roll is the first step that takes the foe down, and the steps from it read KO', async () => {
    const battle = singles();
    const damage = stepsOf(battle);
    battle.sides[1].active[0]!.hp = damage[8];
    const latest = renderDock(battle, { first: { p1: [airSlash], p2: [] } });
    await openDice('P1');
    const select = await screen.findByRole('combobox', { name: 'Damage roll' });
    const texts = within(select).getAllByRole('option').slice(1).map(option => option.textContent ?? '');
    expect(texts.map(text => text.endsWith(' · KO'))).toEqual(damage.map(value => value >= damage[8]));
    const first = damage.findIndex(value => value >= damage[8]);
    await userEvent.click(within(screen.getByRole('group', { name: 'Damage roll' })).getByRole('button', { name: 'Lowest KO roll' }));
    expect(kinds(diceOf(latest.picks, 'p1'))).toContainEqual(['damage-roll', { step: first }]);
  });

  test('a forced crit switches the numbers to the crit damage and says so', async () => {
    const battle = singles();
    renderDock(battle, { first: { p1: [airSlash], p2: [] } });
    await openDice('P1');
    await userEvent.click(within(await screen.findByRole('group', { name: 'Crit' })).getByRole('button', { name: 'Crit' }));
    const maxhp = battle.sides[1].active[0]!.maxhp;
    await waitFor(() => {
      const steps = within(screen.getByRole('combobox', { name: 'Damage roll' })).getAllByRole('option').slice(1);
      expect(steps.map(percent)).toEqual(stepsOf(battle, true).map(damage => Math.round(damage / maxhp * 1000) / 10));
    });
    expect(screen.getByText('The damages show a crit.')).toBeInTheDocument();
  });

  test('a spread move has one select per target, each with its own damage', async () => {
    const battle = doubles();
    renderDock(battle);
    await openDice('P1A');
    await userEvent.click(tile(/Rock Slide/));
    const first = await screen.findByRole('combobox', { name: 'Damage roll against Snorlax' });
    const second = screen.getByRole('combobox', { name: 'Damage roll against Chansey' });
    expect(within(first).getAllByRole('option')).toHaveLength(17);
    const top = (select: HTMLElement) => percent(within(select).getAllByRole('option').at(-1)!);
    expect(top(first)).toBeGreaterThan(0);
    expect(top(second)).not.toBe(top(first));
  });
});

describe('the dock marks a move that carries forced dice', () => {
  const forcedCrit: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'crit' }, result: { happens: true } };

  test('the chip says "dice", and the tile of the picked move carries the "forced" flag', async () => {
    const pick: BranchSlotChoice = { kind: 'move', moveId: 'airslash', moveName: 'Air Slash', dice: [forcedCrit] };
    renderDock(singles(), { first: { p1: [pick], p2: [] } });
    expect(dockChip('P1')).toHaveTextContent('Air Slash · dice');
    await userEvent.click(dockChip('P1'));
    expect(within(tile(/Air Slash/)).getByText('forced')).toBeInTheDocument();
    expect(within(tile(/Splash/)).queryByText('forced')).toBeNull();
  });

  test('in doubles each slot marks its own move', async () => {
    const pick: BranchSlotChoice = { kind: 'move', moveId: 'rockslide', moveName: 'Rock Slide', dice: [{ ...forcedCrit, name: { ...forcedCrit.name, moveId: 'rockslide', targetSlot: 'p2b' } }] };
    renderDock(doubles(), { first: { p1: [pick, { kind: 'move', moveId: 'splash', moveName: 'Splash' }], p2: [] } });
    expect(dockChip('P1A')).toHaveTextContent('Rock Slide · dice');
    expect(dockChip('P1B')).not.toHaveTextContent('dice');
    await userEvent.click(dockChip('P1A'));
    expect(within(tile(/Rock Slide/)).getByText('forced')).toBeInTheDocument();
    expect(within(tile(/Splash/)).queryByText('forced')).toBeNull();
    await userEvent.click(dockChip('P1B'));
    expect(within(tile(/Splash/)).queryByText('forced')).toBeNull();
  });
});
