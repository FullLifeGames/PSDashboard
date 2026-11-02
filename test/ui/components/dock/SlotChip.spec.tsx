import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { SlotChip } from '../../../../src/components/dock/SlotChip';
import type { DockSlotModel } from '../../../../src/components/dock/dock-model';
import { moveOption, switchOption } from '../../fixtures/sim-state';

/**
 * Round 84 (turn dock), A7b, ruling 8a (variant A of the chip page): the chip takes the tile's type edge on the left (the same
 * `typeTileVars` source) and, at its right across both lines, the chosen move's type tag or the incoming body's sprite. An empty
 * chip has neither. The chip's box does not depend on the state (the CSS side is `dock-css.spec.ts`).
 */
function slot(over: Partial<DockSlotModel>): DockSlotModel {
  return {
    side: 'p1', slot: 0, label: 'P1A', name: 'Greninja', species: 'Greninja', hpPercent: 80, fainted: false, moves: [], switches: [],
    forceSwitch: false, nobodyLeft: false, waits: false, pending: null, blockedSwitchKeys: new Set(), gimmick: { modifier: null },
    played: null, pickText: '', placeholder: 'choose', wait: null, origin: null, deferred: null, ...over,
  } as unknown as DockSlotModel;
}
const chipOf = (model: DockSlotModel) => render(<SlotChip slot={model} open={false} onToggle={() => undefined} />).container.querySelector('.ps-dock-chip') as HTMLElement;
const moveSlot = (move = moveOption('Ice Beam', { type: 'Ice' }), over: Partial<DockSlotModel> = {}) =>
  slot({ moves: [move], pending: { kind: 'move', moveId: 'icebeam', moveName: 'Ice Beam' }, pickText: 'Ice Beam', ...over });
const switchSlot = () =>
  slot({
    switches: [switchOption('Heatran', { slot: 3 })],
    pending: { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' }, pickText: '→ Heatran',
  });

describe('the chip of a move', () => {
  test("takes the tile's type colors and shows the type tag at its right", () => {
    const chip = chipOf(moveSlot());
    expect(chip.style.getPropertyValue('--type')).not.toBe('');
    const aside = chip.querySelector('.ps-dock-aside');
    expect(aside).not.toBeNull();
    expect(aside!.querySelector('.ps-type-tag')).toHaveTextContent('Ice');
    expect(aside!.querySelector('img')).toBeNull();
    expect(chip).toHaveAttribute('data-aside', 'true');
  });

  test('shows the type the tile shows: Tera Blast under the Tera toggle reads its Tera type', () => {
    const blast = moveOption('Tera Blast', { type: 'Normal', typeUnderTera: 'Water' });
    const plain = chipOf(moveSlot(blast, { pending: { kind: 'move', moveId: 'terablast', moveName: 'Tera Blast' } }));
    expect(plain.querySelector('.ps-type-tag')).toHaveTextContent('Normal');
    const armed = chipOf(moveSlot(blast, {
      pending: { kind: 'move', moveId: 'terablast', moveName: 'Tera Blast', modifier: 'terastallize' },
      gimmick: { modifier: 'terastallize' } as DockSlotModel['gimmick'],
    }));
    expect(armed.querySelector('.ps-type-tag')).toHaveTextContent('Water');
    expect(armed.style.getPropertyValue('--type')).not.toBe(plain.style.getPropertyValue('--type'));
  });

  test('the pick line stays in the middle column and the label stays first', () => {
    const chip = chipOf(moveSlot());
    expect([...chip.children].map(child => child.className)).toEqual(['ps-dock-label', 'ps-dock-mon', 'ps-dock-pick', 'ps-dock-aside']);
  });
});

describe('the chip of a switch', () => {
  test("shows the incoming body's sprite at its right and no type edge", () => {
    const chip = chipOf(switchSlot());
    const sprite = chip.querySelector('.ps-dock-aside img');
    expect(sprite).not.toBeNull();
    expect(sprite).toHaveAttribute('src', expect.stringContaining('heatran'));
    expect(sprite).toHaveAttribute('alt', '');
    expect(chip.querySelector('.ps-type-tag')).toBeNull();
    expect(chip.style.getPropertyValue('--type')).toBe('');
  });
});

describe('the empty chip', () => {
  test('has neither a tag nor a sprite, and its edge stays the plain border', () => {
    const chip = chipOf(slot({}));
    expect(chip.querySelector('.ps-dock-aside')).toBeNull();
    expect(chip).not.toHaveAttribute('data-aside');
    expect(chip.style.getPropertyValue('--type')).toBe('');
    expect(chip).toHaveAttribute('data-empty', 'true');
  });
});
