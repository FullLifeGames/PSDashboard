import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  calcSingleDamageRange, type BranchMoveOption, type BranchSimState, type BranchSlotChoice, type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { NO_MODIFIERS, moveOption, pokemon, simState, targetOption } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/**
 * Round 84 (turn dock), step A3b: the Tera cases of the old BranchPanel spec (T20 decision 18, T124 points 1, 2 and 4) against the
 * dock. A gimmick toggle sits in the open tray and reaches the damage preview of every tile; one Tera per side and turn; an armed
 * toggle belongs to one position. A tile keeps the calc's own range in its tooltip, so the numbers are read from there.
 */
type Props = Parameters<typeof TurnDock>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    simState: simState('singles'), executeError: null, executing: false, gen: 9,
    onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
  };
}

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

/** The dock over a position whose picks the host keeps, as the app keeps them: a toggle on a picked move edits that pick. */
function Stateful({ base, first, positionKey }: { base: BranchSimState; first: Picks; positionKey?: string }) {
  const [picks, setPicks] = useState<Picks>(first);
  const state = { ...base, p1Choices: picks.p1, p1Choice: picks.p1[0] ?? null, p2Choices: picks.p2, p2Choice: picks.p2[0] ?? null };
  return (
    <TurnDock
      {...props({ simState: state, positionKey })}
      onSetChoice={(side, choice, slot = 0) => setPicks(held => ({ ...held, [side]: held[side].map((entry, index) => (index === slot ? choice : entry)) }))}
    />
  );
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);
const tile = (name: RegExp) => tray().getByRole('button', { name });
const toggle = (label: string) => screen.getByRole('button', { name: label });

/** The tile's tooltip holds the calc's range of the hit it shows. */
const showsRange = (find: () => HTMLElement, range: string) =>
  waitFor(() => expect(find()).toHaveAttribute('title', expect.stringContaining(range)));

const calcRange = (attacker: SimPokemonInfo, defender: SimPokemonInfo, move: BranchMoveOption, gameType: 'Singles' | 'Doubles') =>
  calcSingleDamageRange(attacker, defender, move, { gameType, gen: 9 }).range;

const singlesBase = simState('singles');
const [garchomp] = singlesBase.p1ActiveSlots as SimPokemonInfo[];
const [ferrothorn] = singlesBase.p2ActiveSlots as SimPokemonInfo[];
const earthquake = singlesBase.p1MovesBySlot[0][0];
const groundTera = () => simState('singles', { p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Ground' }] });

describe('the Tera toggle reaches the damage preview (T20, decision 18)', () => {
  test('singles: pressing the attacker Tera toggle moves the number to the calc after the click, and back', async () => {
    render(<TurnDock {...props({ simState: groundTera() })} />);
    await userEvent.click(chip('P1'));
    const plain = calcRange(garchomp, ferrothorn, earthquake, 'Singles');
    const tera = calcRange({ ...garchomp, teraType: 'Ground' }, ferrothorn, earthquake, 'Singles');
    expect(tera).not.toBe(plain);
    await showsRange(() => tile(/Earthquake/), plain);
    await userEvent.click(toggle('Tera (Ground)'));
    await showsRange(() => tile(/Earthquake/), tera);
    await userEvent.click(toggle('Tera (Ground)'));
    await showsRange(() => tile(/Earthquake/), plain);
  });

  test('singles: the defender Tera toggle moves the attacker number too', async () => {
    render(<TurnDock {...props({ simState: simState('singles', { p2ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }] }) })} />);
    const tera = calcRange(garchomp, { ...ferrothorn, teraType: 'Fire' }, earthquake, 'Singles');
    expect(tera).not.toBe(calcRange(garchomp, ferrothorn, earthquake, 'Singles'));
    await userEvent.click(chip('P2'));
    await userEvent.click(toggle('Tera (Fire)'));
    await userEvent.click(chip('P1'));
    await showsRange(() => tile(/Earthquake/), tera);
  });

  test('doubles: the toggle on a picked move moves the number of both targets', async () => {
    const doubles = simState('doubles', { p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS }] });
    const [incineroar] = doubles.p1ActiveSlots as SimPokemonInfo[];
    const flareBlitz = doubles.p1MovesBySlot[0][1];
    const pick: BranchSlotChoice = { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1 };
    render(<Stateful base={doubles} first={{ p1: [pick, null], p2: [null, null] }} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(toggle('Tera (Fire)'));
    expect(chip('P1A')).toHaveTextContent('Flare Blitz → P2A · Tera');
    for (const target of doubles.p2ActiveSlots as SimPokemonInfo[]) {
      const tera = calcSingleDamageRange({ ...incineroar, teraType: 'Fire' }, target, flareBlitz, { gameType: 'Doubles', gen: 9 });
      expect(tera.range).not.toBe(calcRange(incineroar, target, flareBlitz, 'Doubles'));
      const button = within(screen.getByRole('group', { name: 'Target for Flare Blitz' })).getByTitle(`Flare Blitz into ${target.species} (100%)`);
      await waitFor(() => expect(button).toHaveTextContent(`${Math.round(tera.minPercent)}-${Math.round(tera.maxPercent)}%`));
    }
  });

  test('Mega Evolve stays out of the preview', async () => {
    render(<TurnDock {...props({ simState: simState('singles', {
      p1ModifiersBySlot: [{ ...NO_MODIFIERS, canMegaEvo: true, teraType: 'Ground' }],
      p2ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }],
    }) })} />);
    await userEvent.click(chip('P1'));
    await showsRange(() => tile(/Earthquake/), calcRange(garchomp, ferrothorn, earthquake, 'Singles'));
    await userEvent.click(toggle('Mega Evolve'));
    expect(toggle('Mega Evolve')).toHaveAttribute('aria-pressed', 'true');
    expect(toggle('Tera (Ground)')).toHaveAttribute('aria-pressed', 'false');
    // The number before the click cannot show a leak: no recomputation may have landed yet (T126). The defender's Tera
    // recomputes the preview for sure, and that recomputation reads P1's armed Mega too.
    const megaLeftOut = calcRange(garchomp, { ...ferrothorn, teraType: 'Fire' }, earthquake, 'Singles');
    expect(megaLeftOut).not.toBe(calcRange({ ...garchomp, teraType: 'Ground' }, { ...ferrothorn, teraType: 'Fire' }, earthquake, 'Singles'));
    await userEvent.click(chip('P2'));
    await userEvent.click(toggle('Tera (Fire)'));
    await userEvent.click(chip('P1'));
    await showsRange(() => tile(/Earthquake/), megaLeftOut);
  });
});

describe('armed toggles belong to one position (T124 point 2)', () => {
  test('singles: a new position releases the armed Tera, and the number falls back to the plain attacker', async () => {
    const at = (positionKey: string) => props({ positionKey, simState: groundTera() });
    const { rerender } = render(<TurnDock {...at('r1:main:2')} />);
    await userEvent.click(chip('P1'));
    await userEvent.click(toggle('Tera (Ground)'));
    await showsRange(() => tile(/Earthquake/), calcRange({ ...garchomp, teraType: 'Ground' }, ferrothorn, earthquake, 'Singles'));
    rerender(<TurnDock {...at('r1:main:3')} />);
    expect(document.querySelector('.ps-tray')).toBeNull();
    await userEvent.click(chip('P1'));
    expect(toggle('Tera (Ground)')).toHaveAttribute('aria-pressed', 'false');
    await showsRange(() => tile(/Earthquake/), calcRange(garchomp, ferrothorn, earthquake, 'Singles'));
  });

  test('doubles: every armed slot of both sides falls back on a new position', async () => {
    const at = (positionKey: string) => props({ positionKey, simState: simState('doubles', {
      p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS }],
      p2ModifiersBySlot: [{ ...NO_MODIFIERS }, { ...NO_MODIFIERS, teraType: 'Steel' }],
    }) });
    const { rerender } = render(<TurnDock {...at('r1:variation:5')} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(toggle('Tera (Fire)'));
    await userEvent.click(chip('P2B'));
    await userEvent.click(toggle('Tera (Steel)'));
    expect(toggle('Tera (Steel)')).toHaveAttribute('aria-pressed', 'true');
    rerender(<TurnDock {...at('r1:variation:6')} />);
    await userEvent.click(chip('P1A'));
    expect(toggle('Tera (Fire)')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip('P2B'));
    expect(toggle('Tera (Steel)')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('one Tera per side in doubles (T124 point 1)', () => {
  const doubles = (overrides: Partial<BranchSimState> = {}) => simState('doubles', {
    p1ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Fire' }, { ...NO_MODIFIERS, teraType: 'Bug' }], ...overrides,
  });
  const fixture = doubles();
  const [incineroar, amoonguss] = fixture.p1ActiveSlots as SimPokemonInfo[];
  const [rillaboom] = fixture.p2ActiveSlots as SimPokemonInfo[];
  const flareBlitz = fixture.p1MovesBySlot[0][1];
  const pollenPuff = fixture.p1MovesBySlot[1][1];

  test('the partner of an armed Tera cannot arm its own, and its tiles stay untoggled', async () => {
    const picks: Picks = {
      p1: [{ kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1 }, { kind: 'move', moveId: 'pollenpuff', moveName: 'Pollen Puff', targetLoc: 1 }],
      p2: [null, null],
    };
    render(<Stateful base={fixture} first={picks} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(toggle('Tera (Fire)'));
    // P1A's Tera reaches its own tile ...
    await showsRange(() => tile(/Flare Blitz/), calcRange({ ...incineroar, teraType: 'Fire' }, rillaboom, flareBlitz, 'Doubles'));
    await userEvent.click(chip('P1B'));
    const bug = toggle('Tera (Bug)');
    expect(bug).toBeDisabled();
    expect(bug).toHaveAttribute('title', 'P1A already terastallizes this turn.');
    await userEvent.click(bug);
    expect(bug).toHaveAttribute('aria-pressed', 'false');
    // ... and P1B's tile stays as the calc reads the untoggled Amoonguss.
    const plain = calcRange(amoonguss, rillaboom, pollenPuff, 'Doubles');
    expect(plain).not.toBe(calcRange({ ...amoonguss, teraType: 'Bug' }, rillaboom, pollenPuff, 'Doubles'));
    await showsRange(() => tile(/Pollen Puff/), plain);
    // Released on P1A, the Tera is free for P1B again.
    await userEvent.click(chip('P1A'));
    await userEvent.click(toggle('Tera (Fire)'));
    await userEvent.click(chip('P1B'));
    expect(toggle('Tera (Bug)')).toBeEnabled();
  });

  test('a switch picked after arming frees the Tera: the partner takes it, and the first slot gives way (review of wave 1.5)', async () => {
    const switchPick = { kind: 'switch' as const, speciesId: 'flutter mane', pokemonName: 'Flutter Mane' };
    const { rerender } = render(<TurnDock {...props({ simState: fixture })} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(toggle('Tera (Fire)'));
    await userEvent.click(chip('P1B'));
    expect(toggle('Tera (Bug)')).toBeDisabled();
    rerender(<TurnDock {...props({ simState: doubles({ p1Choices: [switchPick, null] }) })} />);
    const bug = toggle('Tera (Bug)');
    expect(bug).toBeEnabled();
    await userEvent.click(bug);
    expect(bug).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip('P1A'));
    const fire = toggle('Tera (Fire)');
    expect(fire).toHaveAttribute('aria-pressed', 'false');
    expect(fire).toHaveAttribute('title', 'P1B already terastallizes this turn.');
  });

  test('a pending choice that terastallizes holds the Tera for its side too', async () => {
    const flareBlitzTera = { kind: 'move' as const, moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1, modifier: 'terastallize' as const };
    render(<TurnDock {...props({ simState: doubles({ p1Choices: [flareBlitzTera, null] }) })} />);
    await userEvent.click(chip('P1B'));
    expect(toggle('Tera (Bug)')).toBeDisabled();
    await userEvent.click(chip('P1A'));
    expect(toggle('Tera (Fire)')).toBeEnabled();
  });

  test('the preview reads the picks: Protect on Rillaboom\'s partner lands both Dragon Darts on Rillaboom (T124 point 4)', async () => {
    const dragapult = pokemon('Dragapult', { isActive: true, activeSlot: 0, ability: 'Clear Body', item: '', moves: [{ name: 'Dragon Darts', type: 'Dragon' }] });
    const darts = moveOption('Dragon Darts', { type: 'Dragon', requiresTarget: true, targetOptions: [targetOption('p2', 0, 'Rillaboom', 1), targetOption('p2', 1, 'Tornadus', 2)] });
    const protect = { kind: 'move' as const, moveId: 'protect', moveName: 'Protect' };
    const dartsPick = { kind: 'move' as const, moveId: 'dragondarts', moveName: 'Dragon Darts', targetLoc: 1 };
    const scene = (p2Choices: (BranchSlotChoice | null)[]) => doubles({
      p1ActiveSlots: [dragapult, amoonguss], p1MovesBySlot: [[darts], fixture.p1MovesBySlot[1]], p1Choices: [dartsPick, null], p2Choices,
    });
    const dartsInto = (context: object) => calcSingleDamageRange(dragapult, rillaboom, darts, { gameType: 'Doubles', gen: 9, ...context }).range;
    const split = dartsInto({ defenderPartner: fixture.p2ActiveSlots[1] });
    const both = dartsInto({ defenderPartner: null });
    expect(split).not.toBe(both);
    const { rerender } = render(<TurnDock {...props({ simState: scene([null, null]) })} />);
    await userEvent.click(chip('P1A'));
    await showsRange(() => tile(/Dragon Darts/), split);
    rerender(<TurnDock {...props({ simState: scene([null, protect]) })} />);
    await showsRange(() => tile(/Dragon Darts/), both);
  });

  test('each side holds its own Tera', async () => {
    render(<TurnDock {...props({ simState: doubles({ p2ModifiersBySlot: [{ ...NO_MODIFIERS, teraType: 'Grass' }, { ...NO_MODIFIERS }] }) })} />);
    await userEvent.click(chip('P1A'));
    await userEvent.click(toggle('Tera (Fire)'));
    await userEvent.click(chip('P2A'));
    await userEvent.click(toggle('Tera (Grass)'));
    expect(toggle('Tera (Grass)')).toHaveAttribute('aria-pressed', 'true');
  });
});
