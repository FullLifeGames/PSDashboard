import { beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import type { Battle } from '@pkmn/sim';
import { chainResults, createBranchStateFromBattle, loadSimMods, type BranchSlotChoice, type ForcedDie } from '@fulllifegames/eval-engine';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { diceBattle, setOf } from '../../fixtures/dice-battle';

/**
 * Round 89 (#114, F3; the user's ruling 31): the dock on a live battle for a move whose later hits roll accuracy. The engine's offer
 * (F1) names a die per hit; the table folds them into one "Hits" row of the counts 1 to N under "Hit", and a click on the count k
 * sets the first hit, hits 2 to k and the miss of hit k + 1 (`chainResults`), the way the engine plays them. Scarlet/Violet and
 * Champions, singles and doubles (a body on slot b in the four-slot dock). The panel reads the move's hits from the Dex through the
 * offer, so a team of six (VGC) shows the same row; the sweeps of the engine play VGC.
 */
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => [] }));
const shown = vi.hoisted(() => ({ logged: [] as unknown[] }));
vi.mock('../../../../src/lib/lazy/branch-engine', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../src/lib/lazy/branch-engine')>()),
  loggedTurnDice: () => shown.logged,
}));

beforeAll(async () => {
  await loadSimMods('gen9championsou');
});

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

function renderDock(battle: Battle, first: Picks = { p1: [], p2: [] }) {
  const latest: { picks: Picks } = { picks: first };
  function Host() {
    const [picks, setPicks] = useState<Picks>(latest.picks);
    const simState = useMemo(() => createBranchStateFromBattle(battle as never, [], { p1Choices: picks.p1, p2Choices: picks.p2 }), [picks]);
    return (
      <TurnDock
        simState={simState} executeError={null} executing={false} gen={9} positionKey="hits"
        onSetChoice={(side, choice, slot = 0) => setPicks(held => {
          const next = { ...held, [side]: [...held[side]] };
          next[side][slot] = choice;
          latest.picks = next;
          return next;
        })}
        onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()} getBattle={() => battle as never}
      />
    );
  }
  render(<Host />);
  return latest;
}

const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);
async function pick(chip: string, move: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${chip}\\b`) }));
  await userEvent.click(tray().getByRole('button', { name: /Dice · What if/ }));
  await userEvent.click(tray().getByRole('button', { name: move }));
  return screen.findByRole('group', { name: new RegExp(`^Dice for ${chip}`) });
}

const CHAMPIONS_EVS = { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 };
const mon = (champions: boolean, moves: string[], name?: string) => setOf('Snorlax', moves, { ...(name ? { name } : {}), ...(champions ? { level: 50, evs: CHAMPIONS_EVS } : {}) });
const board = (format: string, champions: boolean, doubles: boolean): Battle => diceBattle({
  format,
  p1: doubles ? [mon(champions, ['splash']), mon(champions, ['tripleaxel', 'populationbomb'], 'Bomber')] : [mon(champions, ['tripleaxel', 'populationbomb'], 'Bomber')],
  p2: doubles ? [mon(champions, ['splash']), mon(champions, ['splash'])] : [mon(champions, ['splash'])],
});

const CASES = [
  ['Scarlet/Violet singles', 'gen9customgame', false, false],
  ['Scarlet/Violet doubles', 'gen9doublescustomgame', false, true],
  ['Champions singles', 'gen9championscustomgame', true, false],
  ['Champions doubles (VGC)', 'gen9championsdoublescustomgame', true, true],
] as const;

describe.each(CASES)('the dock Hits row: %s', (_label, format, champions, doubles) => {
  const chip = doubles ? 'P1B' : 'P1';
  const slot = doubles ? 'p1b' : 'p1a';
  const index = doubles ? 1 : 0;
  const diceOf = (picks: Picks) => picks.p1[index]?.dice ?? [];
  const tags = (dice: readonly ForcedDie[]) => dice.map(die => `${die.name.hit ?? 1}:${'happens' in die.result ? die.result.happens : die.result}`);

  test.each([{ move: 'Triple Axel', id: 'tripleaxel', hits: 3 }, { move: 'Population Bomb', id: 'populationbomb', hits: 10 }])('$move offers the counts 1 to $hits under Hit, and a count sets the per-hit dice', async ({ move, id, hits }) => {
    const latest = renderDock(board(format, champions, doubles));
    const dice = await pick(chip, new RegExp(move));
    const row = await within(dice).findByRole('group', { name: 'Hits' });
    expect(within(row).getAllByRole('button').map(button => button.textContent)).toEqual(Array.from({ length: hits }, (_, count) => `${count + 1} ${count === 0 ? 'hit' : 'hits'}`));
    expect([...dice.querySelectorAll('.ps-dice-caption')].map(caption => caption.textContent).slice(0, 2)).toEqual(['Hit', 'Hits']);
    // no row per hit: only the plain Hit row has the chips "Hits" and "Misses"
    expect(within(dice).getAllByRole('button', { name: 'Misses' })).toHaveLength(1);

    const count = Math.min(hits, 2);
    await userEvent.click(within(row).getByRole('button', { name: `${count} hits` }));
    expect(tags(diceOf(latest.picks))).toEqual(['1:true', ...chainResults(count, hits).map(({ hit, happens }) => `${hit}:${happens}`)]);
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Hits' })).getByRole('button', { name: `${count} hits` })).toHaveAttribute('aria-pressed', 'true'));

    // a second click on the same count gives the hit dice back, the first hit stays set
    await userEvent.click(within(screen.getByRole('group', { name: 'Hits' })).getByRole('button', { name: `${count} hits` }));
    expect(tags(diceOf(latest.picks))).toEqual(['1:true']);
    expect(diceOf(latest.picks)[0].name).toEqual({ slot, moveId: id, targetSlot: 'p2a', kind: 'accuracy' });
  });

  test('the last count is all landing, and a miss of the first hit takes the chain back', async () => {
    const latest = renderDock(board(format, champions, doubles));
    const dice = await pick(chip, /Triple Axel/);
    await userEvent.click(within(await within(dice).findByRole('group', { name: 'Hits' })).getByRole('button', { name: '3 hits' }));
    expect(tags(diceOf(latest.picks))).toEqual(['1:true', '2:true', '3:true']);
    await userEvent.click(within(screen.getByRole('group', { name: 'Hit' })).getByRole('button', { name: 'Misses' }));
    expect(tags(diceOf(latest.picks))).toEqual(['1:false']);
  });

  test('a crit sets the first hit only, so no count reads pressed', async () => {
    const latest = renderDock(board(format, champions, doubles));
    const dice = await pick(chip, /Triple Axel/);
    await userEvent.click(within(await within(dice).findByRole('group', { name: 'Crit' })).getByRole('button', { name: 'Crit' }));
    expect(diceOf(latest.picks).map(die => die.name.kind)).toEqual(['crit', 'accuracy']);
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Crit' })).getByRole('button', { name: 'Crit' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(screen.getByRole('group', { name: 'Hits' })).getAllByRole('button').filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
  });

  test('the count the log shows reads "2 hits · log" and a click on another count forces it', async () => {
    const name = (hit: number) => ({ slot, moveId: 'tripleaxel', targetSlot: 'p2a', kind: 'accuracy', hit });
    shown.logged = [{ name: name(2), result: { happens: true } }, { name: name(3), result: { happens: false } }];
    try {
      const axe: BranchSlotChoice = { kind: 'move', moveId: 'tripleaxel', moveName: 'Triple Axel' };
      renderDock(board(format, champions, doubles), { p1: doubles ? [null, axe] : [axe], p2: [] });
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${chip}\\b`) }));
      await userEvent.click(tray().getByRole('button', { name: /Dice · What if/ }));
      const row = await screen.findByRole('group', { name: 'Hits' });
      expect(within(row).getAllByRole('button').map(button => button.textContent)).toEqual(['1 hit', '2 hits · log', '3 hits']);
      expect(within(row).getByRole('button', { name: /^2 hits/ })).toHaveAttribute('aria-pressed', 'false');
    } finally {
      shown.logged = [];
    }
  });
});

// Round 89 (ruling 34 F4a): a holder whose ability or item fixes the count gets one row without a choice, "Hits: 5 (Skill Link)".
describe.each(CASES)('the dock Hits row of a holder that fixes the count: %s', (_label, format, champions, doubles) => {
  const chip = doubles ? 'P1B' : 'P1';
  const holderBoard = (extra: { ability?: string; item?: string }): Battle => diceBattle({
    format,
    p1: doubles
      ? [mon(champions, ['splash']), setOf('Snorlax', ['tripleaxel', 'populationbomb', 'bulletseed'], { name: 'Bomber', ...(champions ? { level: 50, evs: CHAMPIONS_EVS } : {}), ...extra })]
      : [setOf('Snorlax', ['tripleaxel', 'populationbomb', 'bulletseed'], { name: 'Bomber', ...(champions ? { level: 50, evs: CHAMPIONS_EVS } : {}), ...extra })],
    p2: doubles ? [mon(champions, ['splash']), mon(champions, ['splash'])] : [mon(champions, ['splash'])],
  });
  const rowOf = async (battle: Battle, move: RegExp) => {
    renderDock(battle);
    const dice = await pick(chip, move);
    return { dice };
  };

  test.each([{ move: 'Triple Axel', hits: 3 }, { move: 'Population Bomb', hits: 10 }, { move: 'Bullet Seed', hits: 5 }])('Skill Link on $move reads "$hits (Skill Link)" with no chip', async ({ move, hits }) => {
    const { dice } = await rowOf(holderBoard({ ability: 'Skill Link' }), new RegExp(move));
    await waitFor(() => expect(within(dice).getByRole('group', { name: 'Hits' })).toHaveTextContent(`${hits} (Skill Link)`));
    expect(within(within(dice).getByRole('group', { name: 'Hits' })).queryAllByRole('button')).toEqual([]);
    expect([...dice.querySelectorAll('.ps-dice-caption')].map(caption => caption.textContent).slice(0, 2)).toEqual(['Hit', 'Hits']);
  });

  test('Loaded Dice reads "3 (Loaded Dice)" on Triple Axel and shows no fixed row on Population Bomb, whose count the game still draws', async () => {
    const axe = await rowOf(holderBoard({ item: 'Loaded Dice' }), /Triple Axel/);
    await waitFor(() => expect(within(axe.dice).getByRole('group', { name: 'Hits' })).toHaveTextContent('3 (Loaded Dice)'));
    cleanup();
    const bomb = await rowOf(holderBoard({ item: 'Loaded Dice' }), /Population Bomb/);
    expect(within(bomb.dice).queryAllByRole('group').map(group => group.getAttribute('aria-label'))).not.toContain('Hits');
  });
});
