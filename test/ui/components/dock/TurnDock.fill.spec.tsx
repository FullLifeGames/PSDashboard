import { describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import type { DockFillView } from '../../../../src/hooks/useDockFill';
import { simState, type FormatKind } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

/**
 * Round 84 (turn dock), step A5: what the dock shows of the engine's fill at the live tip: a placeholder of the chip's own size
 * while the run is pending, the origin mark on a filled chip, the note while the game analysis runs, and the waiting Execute.
 */

type Props = Parameters<typeof TurnDock>[0];

const move = (moveId: string, moveName: string, targetLoc?: number): BranchSlotChoice => ({ kind: 'move', moveId, moveName, ...(targetLoc ? { targetLoc } : {}) });

function fillOf(overrides: Partial<DockFillView> = {}): DockFillView {
  return {
    pending: false, busy: false, waits: false, engine: { p1: [], p2: [] }, choices: null, deferred: { p1: [], p2: [] }, picks: { p1: [], p2: [] }, queueExecute: vi.fn(), onUserChoice: vi.fn(),
    restore: vi.fn(() => null), holdTray: vi.fn(), release: vi.fn(), arm: vi.fn(), ...overrides,
  };
}

function renderDock(kind: FormatKind, fill: DockFillView, extra: Partial<Props> = {}, state = simState(kind)) {
  const props: Props = {
    simState: state, executeError: null, executing: false, gen: 9, onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(),
    onExecuteTurn: vi.fn(), fill, ...extra,
  };
  render(<TurnDock {...props} />);
  return props;
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const execute = () => document.querySelector('.ps-execute-btn') as HTMLButtonElement;

describe.each(['singles', 'doubles'] as const)('TurnDock fill, %s', (kind) => {
  const labels = kind === 'doubles' ? ['P1A', 'P1B', 'P2A', 'P2B'] : ['P1', 'P2'];

  test('while the run is pending every empty chip holds a placeholder in the chip\'s own box', () => {
    renderDock(kind, fillOf({ pending: true }));
    for (const label of labels) {
      expect(chip(label)).toHaveTextContent('engine choosing…');
      expect(chip(label)).toHaveAttribute('data-empty', 'true');
      expect(chip(label).querySelector('.ps-dock-pick')).not.toBeNull();
    }
    expect(document.querySelectorAll('.ps-dock-chip')).toHaveLength(labels.length);
  });

  test('the placeholder is marked for the style: pending while the run goes, busy during the game analysis, nothing otherwise', () => {
    const wait = () => [...document.querySelectorAll('.ps-dock-chip .ps-dock-pick')].map(pick => pick.getAttribute('data-wait'));
    const { unmount } = render(<TurnDock {...({ simState: simState(kind), executeError: null, executing: false, gen: 9, onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), fill: fillOf({ pending: true }) } as Props)} />);
    expect(wait()).toEqual(labels.map(() => 'pending'));
    unmount();
    render(<TurnDock {...({ simState: simState(kind), executeError: null, executing: false, gen: 9, onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), fill: fillOf({ busy: true }) } as Props)} />);
    expect(wait()).toEqual(labels.map(() => 'busy'));
  });

  test('a chip that holds a choice, or whose fill found nothing, carries no mark', () => {
    renderDock(kind, fillOf());
    expect([...document.querySelectorAll('.ps-dock-pick')].every(pick => !pick.hasAttribute('data-wait'))).toBe(true);
  });

  test('during the game analysis the empty chips say the engine is busy, and Execute stays locked', () => {
    renderDock(kind, fillOf({ busy: true }));
    for (const label of labels) expect(chip(label)).toHaveTextContent('engine busy with the game analysis');
    expect(execute()).toBeDisabled();
  });

  test('a fill that found no agreeing choice leaves the chip reading "choose"', () => {
    renderDock(kind, fillOf());
    for (const label of labels) expect(chip(label)).toHaveTextContent(/choose$/);
    expect(chip(labels[0])).not.toHaveTextContent('engine');
  });
});

describe('TurnDock fill, marks', () => {
  test('doubles: a filled chip carries the origin "engine"; the slot the user picked carries none', () => {
    const state = simState('doubles', {
      p1Choices: [move('flareblitz', 'Flare Blitz', 2), move('ragepowder', 'Rage Powder')],
      p2Choices: [move('grassyglide', 'Grassy Glide', 1), move('tailwind', 'Tailwind')],
    });
    renderDock('doubles', fillOf({ engine: { p1: [false, true], p2: [true, true] } }), {}, state);
    expect(chip('P1A')).not.toHaveAttribute('data-origin');
    expect(chip('P1A')).not.toHaveTextContent('engine');
    expect(chip('P1B')).toHaveAttribute('data-origin', 'engine');
    expect(chip('P1B')).toHaveTextContent('Rage Powder engine');
    expect(chip('P2A')).toHaveAttribute('data-origin', 'engine');
    expect(execute()).toBeEnabled();
  });

  test('singles: the filled chip names its move and the engine', () => {
    const state = simState('singles', { p1Choices: [move('earthquake', 'Earthquake')], p2Choices: [move('leechseed', 'Leech Seed')] });
    renderDock('singles', fillOf({ engine: { p1: [true], p2: [true] } }), {}, state);
    expect(chip('P1')).toHaveTextContent('Earthquake engine');
    expect(chip('P2')).toHaveTextContent('Leech Seed engine');
  });

  test('a pick in the tray tells the fill that the slot is the user\'s, before the choice is stored', async () => {
    const order: string[] = [];
    const fill = fillOf({ engine: { p1: [true], p2: [true] } });
    vi.mocked(fill.onUserChoice).mockImplementation(() => { order.push('user'); });
    const state = simState('singles', { p1Choices: [move('earthquake', 'Earthquake')], p2Choices: [move('leechseed', 'Leech Seed')] });
    const props = renderDock('singles', fill, { onSetChoice: vi.fn(() => { order.push('set'); }) }, state);
    await userEvent.click(chip('P1'));
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Stone Edge/ }));
    // round 89 (#153): the pick goes along, for Hard mode
    expect(fill.onUserChoice).toHaveBeenCalledWith('p1', 0, expect.objectContaining({ moveId: 'stoneedge' }));
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'stoneedge' }), 0);
    expect(order).toEqual(['user', 'set']);
  });
});

describe('TurnDock fill, Execute', () => {
  test('pressed while the run is pending, Execute waits for the engine instead of running', async () => {
    const fill = fillOf({ pending: true });
    const props = renderDock('doubles', fill);
    expect(execute()).toBeEnabled();
    expect(execute()).toHaveTextContent('Execute Turn');
    await userEvent.click(execute());
    expect(fill.queueExecute).toHaveBeenCalledTimes(1);
    expect(props.onExecuteTurn).not.toHaveBeenCalled();
  });

  test('a queued Execute reads "Waits for engine…" and cannot be pressed again', () => {
    renderDock('doubles', fillOf({ pending: true, waits: true }));
    expect(execute()).toHaveTextContent('Waits for engine…');
    expect(execute()).toBeDisabled();
  });

  test('with every slot chosen Execute runs the turn at once, whatever the run is doing', async () => {
    const fill = fillOf({ pending: true });
    const state = simState('singles', { p1Choices: [move('earthquake', 'Earthquake')], p2Choices: [move('leechseed', 'Leech Seed')] });
    const props = renderDock('singles', fill, {}, state);
    await userEvent.click(execute());
    expect(props.onExecuteTurn).toHaveBeenCalledWith({ p1: state.p1Choices, p2: state.p2Choices });
    expect(fill.queueExecute).not.toHaveBeenCalled();
  });

  test('without a fill, Execute is locked until every slot is chosen, as before', () => {
    renderDock('doubles', undefined as unknown as DockFillView, { fill: null });
    expect(execute()).toBeDisabled();
    expect(execute()).toHaveTextContent(/^Select /);
  });
});

describe.each(['singles', 'doubles'] as const)('TurnDock fill, the open tray, %s', (kind) => {
  const first = kind === 'doubles' ? 'P1A' : 'P1';

  test('the open tray is reported to the fill, and its closing too', async () => {
    const fill = fillOf();
    renderDock(kind, fill);
    await userEvent.click(chip(first));
    expect(fill.holdTray).toHaveBeenLastCalledWith({ side: 'p1', slot: 0 });
    await userEvent.click(chip(first));
    expect(fill.holdTray).toHaveBeenLastCalledWith(null);
  });

  test('a click on a chip arms the fill (Q19 b, the trigger at a replay turn)', async () => {
    const fill = fillOf();
    renderDock(kind, fill);
    expect(fill.arm).not.toHaveBeenCalled();
    await userEvent.click(chip(first));
    expect(fill.arm).toHaveBeenCalledTimes(1);
  });
});

describe.each(['singles', 'doubles'] as const)('TurnDock fill, the engine\'s choice for the open slot, %s', (kind) => {
  const first = kind === 'doubles' ? 'P1A' : 'P1';
  const second = kind === 'doubles' ? 'P1B' : 'P2';
  const deferredMove = kind === 'doubles' ? move('flareblitz', 'Flare Blitz', 2) : move('earthquake', 'Earthquake');
  const moveName = kind === 'doubles' ? 'Flare Blitz' : 'Earthquake';
  const benched = kind === 'doubles' ? { speciesId: 'fluttermane', pokemonName: 'Flutter Mane' } : { speciesId: 'heatran', pokemonName: 'Heatran' };
  const deferredSwitch: BranchSlotChoice = { kind: 'switch', ...benched };
  const withDeferred = (choice: BranchSlotChoice) => fillOf({ deferred: { p1: [choice, null], p2: [null, null] } });
  const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);

  test('the chip reads "engine: <pick> · choose", stays empty and carries no origin; no box changes its size', () => {
    renderDock(kind, withDeferred(deferredMove));
    expect(chip(first)).toHaveTextContent(`engine: ${moveName} · choose`);
    expect(chip(first)).toHaveAttribute('data-empty', 'true');
    expect(chip(first)).not.toHaveAttribute('data-origin');
    expect(chip(first).querySelector('.ps-dock-pick')).not.toHaveAttribute('data-wait');
    expect(chip(second)).not.toHaveTextContent('engine:');
    expect(document.querySelectorAll('.ps-dock-chip')).toHaveLength(kind === 'doubles' ? 4 : 2);
  });

  test('a deferred switch reads in the dock\'s notation', () => {
    renderDock(kind, withDeferred(deferredSwitch));
    expect(chip(first)).toHaveTextContent(`engine: → ${benched.pokemonName} · choose`);
  });

  test('the engine\'s move tile carries the "engine" badge, and no other tile does', async () => {
    renderDock(kind, withDeferred(deferredMove));
    await userEvent.click(chip(first));
    const badges = document.querySelectorAll('.ps-tray .ps-movebtn .ps-engine-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('engine');
    expect(badges[0].closest('.ps-movebtn')).toHaveTextContent(moveName);
    expect(document.querySelectorAll('.ps-tray .ps-switchbtn .ps-engine-badge')).toHaveLength(0);
  });

  test('the engine\'s bench tile carries the "engine" badge', async () => {
    renderDock(kind, withDeferred(deferredSwitch));
    await userEvent.click(chip(first));
    const badges = document.querySelectorAll('.ps-tray .ps-switchbtn .ps-engine-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('.ps-switchbtn')).toHaveTextContent(benched.pokemonName);
    expect(document.querySelectorAll('.ps-tray .ps-movebtn .ps-engine-badge')).toHaveLength(0);
  });

  test('every way to close the tray hands the slot back to the fill', async () => {
    const fill = withDeferred(deferredMove);
    renderDock(kind, fill);
    const closed = async (close: () => Promise<void>) => {
      await userEvent.click(chip(first));
      vi.mocked(fill.release).mockClear();
      await close();
      expect(fill.release).toHaveBeenCalledTimes(1);
      expect(fill.release).toHaveBeenCalledWith('p1', 0);
      expect(document.querySelector('.ps-tray')).toBeNull();
    };
    await closed(() => userEvent.click(tray().getByRole('button', { name: 'Done' })));
    await closed(() => userEvent.click(chip(first)));
    await closed(() => userEvent.keyboard('{Escape}'));
    await closed(() => userEvent.click(document.body));
    // Another chip's tray closes the first one's and opens its own.
    await userEvent.click(chip(first));
    vi.mocked(fill.release).mockClear();
    await userEvent.click(chip(second));
    expect(fill.release).toHaveBeenCalledWith('p1', 0);
    expect(document.querySelector('.ps-tray')).not.toBeNull();
  });

  test('opening the dice section is not a release', async () => {
    const fill = withDeferred(deferredMove);
    renderDock(kind, fill);
    await userEvent.click(chip(first));
    await userEvent.click(tray().getByRole('button', { name: /Dice · What if/ }));
    expect(fill.release).not.toHaveBeenCalled();
  });

  test('Execute with the tray open takes the deferred pick as the slot\'s choice, closes the tray and runs the turn with it', async () => {
    const others = kind === 'doubles'
      ? { p1Choices: [null, move('ragepowder', 'Rage Powder')], p2Choices: [move('grassyglide', 'Grassy Glide', 1), move('tailwind', 'Tailwind')] }
      : { p1Choices: [null], p2Choices: [move('leechseed', 'Leech Seed')] };
    const state = simState(kind, others);
    const fill = withDeferred(deferredMove);
    const props = renderDock(kind, fill, {}, state);
    // The label counts the deferred pick as chosen.
    expect(execute()).toBeEnabled();
    expect(execute()).toHaveTextContent('Execute Turn');
    await userEvent.click(chip(first));
    await userEvent.click(execute());
    expect(fill.release).toHaveBeenCalledWith('p1', 0);
    expect(document.querySelector('.ps-tray')).toBeNull();
    expect(props.onExecuteTurn).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(props.onExecuteTurn).mock.calls[0][0];
    expect(sent.p1[0]).toEqual(deferredMove);
    expect(sent.p2).toEqual(state.p2Choices);
  });

  test('a deferred pick that leaves another slot empty keeps Execute locked', () => {
    renderDock(kind, withDeferred(deferredMove), {}, simState(kind));
    expect(execute()).toBeDisabled();
  });
});

describe.each(['singles', 'doubles'] as const)('TurnDock fill, a forced replacement, %s', (kind) => {
  // P1 replaces: singles its only slot, doubles slot B (the other slot plays on); P2 waits.
  const slot = kind === 'doubles' ? 1 : 0;
  const forcedChip = kind === 'doubles' ? 'P1B' : 'P1';
  const waitingChip = kind === 'doubles' ? 'P2A' : 'P2';
  const forcedFlags = { p1ForceSwitch: true, p1ForceSwitches: kind === 'doubles' ? [false, true] : [true] };
  const body = kind === 'doubles' ? { speciesId: 'fluttermane', pokemonName: 'Flutter Mane' } : { speciesId: 'heatran', pokemonName: 'Heatran' };
  const pick: BranchSlotChoice = { kind: 'switch', ...body };
  const filled = () => simState(kind, { ...forcedFlags, p1Choices: kind === 'doubles' ? [null, pick] : [pick] });
  const engineMarks = { p1: kind === 'doubles' ? [false, true] : [true], p2: kind === 'doubles' ? [false, false] : [false] };

  test('while the run is pending the forced slot reads "engine choosing…", the waiting side and the partner do not', () => {
    renderDock(kind, fillOf({ pending: true }), {}, simState(kind, forcedFlags));
    expect(chip(forcedChip)).toHaveTextContent('engine choosing…');
    expect(chip(forcedChip).querySelector('.ps-dock-pick')).toHaveAttribute('data-wait', 'pending');
    expect(chip(waitingChip)).not.toHaveTextContent('engine');
    expect(chip(waitingChip)).toHaveAttribute('inert');
    if (kind === 'doubles') expect(chip('P1A')).not.toHaveTextContent('engine choosing');
  });

  test('the chip of the slot that must replace is marked, whatever it reads', () => {
    renderDock(kind, fillOf({ pending: true }), {}, simState(kind, forcedFlags));
    expect(chip(forcedChip)).toHaveAttribute('data-forced', 'true');
    expect(chip(waitingChip)).not.toHaveAttribute('data-forced');
  });

  test('an Execute pressed before the fill queues behind it', async () => {
    const fill = fillOf({ pending: true });
    const props = renderDock(kind, fill, {}, simState(kind, forcedFlags));
    expect(execute()).toBeEnabled();
    expect(execute()).toHaveTextContent('Execute Turn');
    await userEvent.click(execute());
    expect(fill.queueExecute).toHaveBeenCalledTimes(1);
    expect(props.onExecuteTurn).not.toHaveBeenCalled();
  });

  test('the engine\'s replacement stands on the chip with the mark "engine", and Execute sends it', async () => {
    const props = renderDock(kind, fillOf({ engine: engineMarks }), {}, filled());
    expect(chip(forcedChip)).toHaveAttribute('data-origin', 'engine');
    expect(chip(forcedChip)).toHaveTextContent(`→ ${body.pokemonName} engine`);
    expect(execute()).toBeEnabled();
    await userEvent.click(execute());
    expect(props.onExecuteTurn).toHaveBeenCalledTimes(1);
  });

  test('a queued Execute reads "Waits for engine…"', () => {
    renderDock(kind, fillOf({ pending: true, waits: true }), {}, simState(kind, forcedFlags));
    expect(execute()).toHaveTextContent('Waits for engine…');
    expect(execute()).toBeDisabled();
  });

  test('without a pick and without a run there is no Execute: a click on the bench still sends the body in at once', async () => {
    const props = renderDock(kind, fillOf(), {}, simState(kind, forcedFlags));
    expect(execute()).toBeNull();
    await userEvent.click(chip(forcedChip));
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: new RegExp(body.pokemonName) }));
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', { kind: 'switch', ...body }, slot);
  });

  test('the engine\'s replacement can be changed by a bench click, which is the user\'s pick', async () => {
    const fill = fillOf({ engine: engineMarks });
    const props = renderDock(kind, fill, {}, filled());
    await userEvent.click(chip(forcedChip));
    const other = kind === 'doubles' ? 'Urshifu' : 'Latias';
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: new RegExp(other) }));
    expect(fill.onUserChoice).toHaveBeenCalledWith('p1', slot, expect.objectContaining({ kind: 'switch', pokemonName: other }));
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ kind: 'switch', pokemonName: other }), slot);
  });
});

describe('TurnDock fill, two forced slots of one side (ruling 16a, doubles)', () => {
  // P1 replaces both bodies; P2 waits. The engine holds slot A with Flutter Mane; the user's bench click is in slot B.
  const flags = { p1ForceSwitch: true, p1ForceSwitches: [true, true] };
  const flutter: BranchSlotChoice = { kind: 'switch', speciesId: 'fluttermane', pokemonName: 'Flutter Mane' };
  const urshifu: BranchSlotChoice = { kind: 'switch', speciesId: 'urshifu', pokemonName: 'Urshifu' };
  const clickUrshifuInB = async () => {
    await userEvent.click(chip('P1B'));
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Urshifu/ }));
  };
  const withOnlyA = () => simState('doubles', { ...flags, p1Choices: [flutter, null] });

  test('while another forced slot holds only the engine pick, the click records the choice and sends nothing', async () => {
    const onRecordChoice = vi.fn();
    const fill = fillOf({ engine: { p1: [true, false], p2: [false, false] } });
    const props = renderDock('doubles', fill, { onRecordChoice }, withOnlyA());
    await clickUrshifuInB();
    expect(fill.onUserChoice).toHaveBeenCalledWith('p1', 1, urshifu);
    expect(onRecordChoice).toHaveBeenCalledWith('p1', urshifu, 1);
    expect(props.onSetChoice).not.toHaveBeenCalled();
  });

  test('when the other forced slot holds a pick of the user, the click sends at once as before', async () => {
    const onRecordChoice = vi.fn();
    const props = renderDock('doubles', fillOf({ engine: { p1: [false, false], p2: [false, false] } }), { onRecordChoice }, withOnlyA());
    await clickUrshifuInB();
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', urshifu, 1);
    expect(onRecordChoice).not.toHaveBeenCalled();
  });

  test('without a record path (a replay turn) the click goes through onSetChoice', async () => {
    const props = renderDock('doubles', fillOf({ engine: { p1: [true, false], p2: [false, false] } }), {}, withOnlyA());
    await clickUrshifuInB();
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', urshifu, 1);
  });

  test('after the recorded click Execute stays, enabled, with both picks counted', async () => {
    const both = simState('doubles', { ...flags, p1Choices: [flutter, urshifu] });
    const props = renderDock('doubles', fillOf({ engine: { p1: [true, false], p2: [false, false] } }), { onRecordChoice: vi.fn() }, both);
    expect(execute()).toBeEnabled();
    await userEvent.click(execute());
    expect(props.onExecuteTurn).toHaveBeenCalledTimes(1);
  });
});


/**
 * Round 89 (#153, HM3b, user gate 15.11.2026): "Back to the engine's pick" in the open tray of a slot that holds a user pick that
 * differs from what the fill chose. The click asks the fill (`restore`) for the choice and writes it like any pick, but without telling
 * the fill that the user chose: the slot is the engine's again. Singles and doubles; in doubles per slot.
 */
describe.each(['singles', 'doubles'] as const)('TurnDock fill, Back to the engine\'s pick, %s', (kind) => {
  const first = kind === 'doubles' ? 'P1A' : 'P1';
  const engineMove = kind === 'doubles' ? move('flareblitz', 'Flare Blitz', 2) : move('earthquake', 'Earthquake');
  const userMove = kind === 'doubles' ? move('protect', 'Protect') : move('stoneedge', 'Stone Edge');
  const slots = (first: BranchSlotChoice | null, second: BranchSlotChoice | null = null) => (kind === 'doubles' ? [first, second] : [first]);
  const opponent = kind === 'doubles' ? [null, null] : [null];
  const state = (choice: BranchSlotChoice | null) => simState(kind, { p1Choices: slots(choice), p2Choices: opponent });
  const fillWith = (overrides: Partial<DockFillView> = {}) => fillOf({
    picks: { p1: slots(engineMove), p2: opponent }, engine: { p1: slots(null).map(() => false), p2: opponent.map(() => false) },
    restore: vi.fn(() => engineMove), ...overrides,
  });
  const back = () => screen.queryByRole('button', { name: "Back to the engine's pick" });

  test('shown in the tray of a slot with a user pick that differs from the engine\'s: a .ps-btn', async () => {
    renderDock(kind, fillWith(), {}, state(userMove));
    expect(back()).toBeNull();
    await userEvent.click(chip(first));
    expect(back()).toBeInTheDocument();
    expect(back()).toHaveClass('ps-btn');
  });

  test('the click restores the fill\'s choice: the slot is written, the fill is not told that the user chose', async () => {
    const fill = fillWith();
    const props = renderDock(kind, fill, {}, state(userMove));
    await userEvent.click(chip(first));
    await userEvent.click(back()!);
    expect(fill.restore).toHaveBeenCalledWith('p1', 0);
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', engineMove, 0);
    expect(fill.onUserChoice).not.toHaveBeenCalled();
  });

  test('not shown for the engine\'s own mark, for a pick that equals the engine\'s, for a slot the fill chose nothing for, or for an empty slot', async () => {
    const marked = renderDock(kind, fillWith({ engine: { p1: slots(true).map(() => true), p2: opponent.map(() => false) } }), {}, state(userMove));
    await userEvent.click(chip(first));
    expect(back()).toBeNull();
    expect(marked.onSetChoice).not.toHaveBeenCalled();
    cleanup();
    renderDock(kind, fillWith(), {}, state(engineMove));
    await userEvent.click(chip(first));
    expect(back()).toBeNull();
    cleanup();
    renderDock(kind, fillWith({ picks: { p1: slots(null), p2: opponent } }), {}, state(userMove));
    await userEvent.click(chip(first));
    expect(back()).toBeNull();
    cleanup();
    renderDock(kind, fillWith(), {}, state(null));
    await userEvent.click(chip(first));
    expect(back()).toBeNull();
  });

  test('a forced replacement\'s tray (only the bench) has no such button, and neither does a dock without a fill', async () => {
    renderDock(kind, undefined as unknown as DockFillView, { fill: null }, state(userMove));
    await userEvent.click(chip(first));
    expect(back()).toBeNull();
  });

  test('doubles: each slot has its own button; the partner\'s engine pick does not show it on this slot', async () => {
    if (kind !== 'doubles') return;
    const partnerEngine = move('ragepowder', 'Rage Powder');
    const fill = fillWith({ picks: { p1: [engineMove, partnerEngine], p2: opponent }, restore: vi.fn((_side, slot) => (slot === 0 ? engineMove : partnerEngine)) });
    const props = renderDock(kind, fill, {}, simState('doubles', { p1Choices: [engineMove, move('protect', 'Protect')], p2Choices: opponent }));
    await userEvent.click(chip('P1A'));
    expect(back()).toBeNull();
    await userEvent.click(chip('P1B'));
    expect(back()).toBeInTheDocument();
    await userEvent.click(back()!);
    expect(fill.restore).toHaveBeenCalledWith('p1', 1);
    expect(props.onSetChoice).toHaveBeenCalledWith('p1', partnerEngine, 1);
  });

  test('a fill that has nothing to give back writes nothing', async () => {
    const fill = fillWith({ restore: vi.fn(() => null) });
    const props = renderDock(kind, fill, {}, state(userMove));
    await userEvent.click(chip(first));
    await userEvent.click(back()!);
    expect(props.onSetChoice).not.toHaveBeenCalled();
  });
});
