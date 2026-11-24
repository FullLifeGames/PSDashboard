import { describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { parseRequestedTurn, useRequestedTurn } from '../../../src/hooks/useRequestedTurn';

describe('parseRequestedTurn', () => {
  test('reads a whole number and ignores everything else', () => {
    expect(parseRequestedTurn('7')).toBe(7);
    expect(parseRequestedTurn('1')).toBe(1);
    expect(parseRequestedTurn('0')).toBe(0);
    expect(parseRequestedTurn('-3')).toBe(-3);
    for (const bad of [null, '', ' ', 'abc', '7abc', '7.5', '1e3', 'NaN', 'Infinity', '--1']) expect(parseRequestedTurn(bad), String(bad)).toBeNull();
  });
});

interface Inputs {
  requestedReplay: string | null;
  requestedTurn: number | null;
  replayId: string | null;
  maxTurn: number;
}

function setup(initial: Inputs) {
  const landOnTurn = vi.fn();
  const hook = renderHook((inputs: Inputs) => useRequestedTurn({ ...inputs, landOnTurn }), { initialProps: initial });
  return { ...hook, landOnTurn };
}

describe('useRequestedTurn', () => {
  test('lands on the turn once the replay the address named has opened, and never again', () => {
    const { rerender, landOnTurn } = setup({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: null, maxTurn: 1 });
    expect(landOnTurn).not.toHaveBeenCalled();
    rerender({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: 'gen9ou-123', maxTurn: 5 });
    expect(landOnTurn).toHaveBeenCalledExactlyOnceWith(3);
    rerender({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: 'gen9ou-123', maxTurn: 6 });
    rerender({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: 'gen9ou-456', maxTurn: 6 });
    rerender({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: 'gen9ou-123', maxTurn: 6 });
    expect(landOnTurn).toHaveBeenCalledTimes(1);
  });

  test('a doubles replay lands the same way (the id has the doubles format)', () => {
    const { landOnTurn } = setup({ requestedReplay: 'gen9doublesou-2693620934', requestedTurn: 5, replayId: 'gen9doublesou-2693620934', maxTurn: 9 });
    expect(landOnTurn).toHaveBeenCalledExactlyOnceWith(5);
  });

  test('a turn outside the replay clamps to its range', () => {
    expect(setup({ requestedReplay: 'gen9ou-1', requestedTurn: 99, replayId: 'gen9ou-1', maxTurn: 4 }).landOnTurn).toHaveBeenCalledExactlyOnceWith(4);
    expect(setup({ requestedReplay: 'gen9ou-1', requestedTurn: 0, replayId: 'gen9ou-1', maxTurn: 4 }).landOnTurn).toHaveBeenCalledExactlyOnceWith(1);
    expect(setup({ requestedReplay: 'gen9ou-1', requestedTurn: -5, replayId: 'gen9ou-1', maxTurn: 4 }).landOnTurn).toHaveBeenCalledExactlyOnceWith(1);
  });

  test('without a turn, or without a replay link, the app stays where a load puts it', () => {
    expect(setup({ requestedReplay: 'gen9ou-1', requestedTurn: null, replayId: 'gen9ou-1', maxTurn: 4 }).landOnTurn).not.toHaveBeenCalled();
    expect(setup({ requestedReplay: null, requestedTurn: 3, replayId: 'gen9ou-1', maxTurn: 4 }).landOnTurn).not.toHaveBeenCalled();
  });

  test('a link in any written form names the same replay (URL, short link, ?p2, capitals)', () => {
    for (const written of ['https://replay.pokemonshowdown.com/Gen9OU-123?p2', 'https://psim.us/r/gen9ou-123', 'gen9ou-123?p2', 'GEN9OU-123']) {
      expect(setup({ requestedReplay: written, requestedTurn: 2, replayId: 'gen9ou-123', maxTurn: 4 }).landOnTurn, written).toHaveBeenCalledExactlyOnceWith(2);
    }
  });

  test('another replay that opens first (a file, a host message) takes the turn with it: it belongs to the link only', () => {
    const { rerender, landOnTurn } = setup({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: 'gen9ou-999', maxTurn: 5 });
    rerender({ requestedReplay: 'gen9ou-123', requestedTurn: 3, replayId: 'gen9ou-123', maxTurn: 5 });
    expect(landOnTurn).not.toHaveBeenCalled();
  });
});
