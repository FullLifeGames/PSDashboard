import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { inferOpponentTeam, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import { useTeamKnowledge, type TeamKnowledgeInputs } from '../../../src/hooks/useTeamKnowledge';
import { teamEditsKey } from '../../../src/lib/team-edits-store';
import { replayFixture, type ReplayKind } from '../fixtures/replay';
import { fakeReplayWorkerClient } from '../fixtures/worker';

/**
 * Round 89 (T9c, Q-A1): an edit saved in the team editor is written per replay and read back whole on the next load, before any
 * stored import text. The five orders of edit (E) and import (I) must reload to what the session showed.
 */

function scene(kind: ReplayKind, replayId?: string) {
  const fixture = replayFixture(kind);
  const replayData = replayId ? { ...fixture.replayData, id: replayId } : fixture.replayData;
  const p1Info = inferOpponentTeam(replayData.log, 'p1');
  const opponentInfo = inferOpponentTeam(replayData.log, 'p2');
  const inputs = (): TeamKnowledgeInputs => ({
    replayData, p1Info, opponentInfo, observations: fixture.observations, speedOrders: fixture.speedOrders, hpEvidence: fixture.hpEvidence,
    usageStats: { stats: null, loading: false, error: null }, setAssumptions: { assumptions: null, loading: false, error: null },
    onTeamsEdited: vi.fn(), replayWorker: fakeReplayWorkerClient(() => []).client,
  });
  const lead = p1Info.pokemon[0].species;
  const importText = (item: string) => [
    `=== p1: ${replayData.players[0]} ===`, '', `${lead} @ ${item}`, 'Ability: Rough Skin', '- Earthquake', '',
    `=== p2: ${replayData.players[1]} ===`, '',
  ].join('\n');
  return { replayData, inputs, importText };
}

const withItem = (info: OpponentTeamInfo, item: string): OpponentTeamInfo => ({
  pokemon: info.pokemon.map((mon, index) => (index === 0 ? { ...mon, item: { value: item, source: 'manual' as const } } : mon)),
});

type Session = ReturnType<typeof mountSession>;
function mountSession(make: () => TeamKnowledgeInputs) {
  const hook = renderHook(() => useTeamKnowledge(make()));
  return {
    ...hook,
    /** The teams the stats panel and the build read. */
    shown: () => ({ p1: hook.result.current.effectiveP1Info, p2: hook.result.current.effectiveP2Info }),
    edit: (side: 'p1' | 'p2', item: string) => act(() => {
      const current = side === 'p1' ? hook.result.current.effectiveP1Info : hook.result.current.effectiveP2Info;
      hook.result.current.saveTeam(side, withItem(current!, item));
    }),
    importText: (text: string) => act(() => { expect(hook.result.current.applySetsText(text)).toBeNull(); }),
  };
}

const reload = (session: Session, make: () => TeamKnowledgeInputs) => { session.unmount(); return mountSession(make); };

describe.each(['singles', 'doubles'] as const)('an edited set survives a reload (%s)', kind => {
  const { replayData, inputs, importText } = scene(kind);
  const leadOf = (session: Session, side: 'p1' | 'p2') => session.shown()[side]!.pokemon[0];

  test('E: an edit made in the editor reloads whole', () => {
    const first = mountSession(inputs);
    first.edit('p2', 'Safety Goggles');
    const showed = first.shown();
    expect(localStorage.getItem(teamEditsKey(replayData.id))).not.toBeNull();
    const second = reload(first, inputs);
    expect(second.shown()).toEqual(showed);
    expect(leadOf(second, 'p2').item).toMatchObject({ value: 'Safety Goggles', source: 'manual' });
    expect(second.result.current.editedP2Info).not.toBeNull();
    expect(second.result.current.setsFingerprint).toBe(first.result.current.setsFingerprint);
  });

  test('E+I: an import after an edit lands on top of it and both reload', () => {
    const first = mountSession(inputs);
    first.edit('p2', 'Safety Goggles');
    first.importText(importText('Choice Band'));
    const showed = first.shown();
    expect(leadOf(first, 'p1').item.value).toBe('Choice Band');
    expect(leadOf(first, 'p2').item.value).toBe('Safety Goggles');
    const second = reload(first, inputs);
    expect(second.shown()).toEqual(showed);
  });

  test('I+E: an edit after an import holds the import and reloads without the stored text', () => {
    const first = mountSession(inputs);
    first.importText(importText('Choice Band'));
    first.edit('p2', 'Safety Goggles');
    const showed = first.shown();
    expect(localStorage.getItem(`ps-replay-interceptor:sets:${replayData.id}`)).toBeNull();
    const second = reload(first, inputs);
    expect(second.shown()).toEqual(showed);
    expect(leadOf(second, 'p1').item.value).toBe('Choice Band');
  });

  test('I+E+I2: a second import after both reloads as the session showed', () => {
    const first = mountSession(inputs);
    first.importText(importText('Choice Band'));
    first.edit('p2', 'Safety Goggles');
    first.importText(importText('Life Orb'));
    const showed = first.shown();
    expect(leadOf(first, 'p1').item.value).toBe('Life Orb');
    const second = reload(first, inputs);
    expect(second.shown()).toEqual(showed);
    expect(leadOf(second, 'p2').item.value).toBe('Safety Goggles');
  });

  test('E+I+E2: a later edit replaces the import text and the first edit', () => {
    const first = mountSession(inputs);
    first.edit('p2', 'Safety Goggles');
    first.importText(importText('Choice Band'));
    first.edit('p1', 'Leftovers');
    const showed = first.shown();
    expect(localStorage.getItem(`ps-replay-interceptor:sets:${replayData.id}`)).toBeNull();
    const second = reload(first, inputs);
    expect(second.shown()).toEqual(showed);
    expect(leadOf(second, 'p1').item.value).toBe('Leftovers');
    expect(leadOf(second, 'p2').item.value).toBe('Safety Goggles');
  });

  test('a replay with no saved edit loads as before, and another replay id starts clean', () => {
    const plain = mountSession(inputs);
    expect(plain.result.current.editedP1Info).toBeNull();
    expect(plain.result.current.editedP2Info).toBeNull();
    plain.edit('p2', 'Safety Goggles');
    const other = scene(kind, 'another-replay');
    const fresh = reload(plain, other.inputs);
    expect(fresh.result.current.editedP2Info).toBeNull();
    expect(leadOf(fresh, 'p2').item.value).not.toBe('Safety Goggles');
  });

  test('the editor starts from the restored edit, and the edit is not re-written by a plain mount', () => {
    const first = mountSession(inputs);
    first.edit('p2', 'Safety Goggles');
    const stored = localStorage.getItem(teamEditsKey(replayData.id));
    const second = reload(first, inputs);
    expect(localStorage.getItem(teamEditsKey(replayData.id))).toBe(stored);
    expect(second.result.current.effectiveP2Info).toBe(second.result.current.editedP2Info);
  });

  test('a record of another team is ignored and an import text still applies', () => {
    localStorage.setItem(teamEditsKey(replayData.id), JSON.stringify({ version: 1, p1: null, p2: { pokemon: [{ species: 'Magikarp' }] } }));
    localStorage.setItem(`ps-replay-interceptor:sets:${replayData.id}`, importText('Choice Band'));
    const session = mountSession(inputs);
    expect(session.shown().p2!.pokemon.map(mon => mon.species)).not.toContain('Magikarp');
    expect(leadOf(session, 'p1').item.value).toBe('Choice Band');
  });
});

describe('a browser storage that throws', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  // The records of this feature are the ones under test: other stores of the app (the team paste) read storage on their own terms.
  test('the app still loads, edits and saves for the session', () => {
    const { inputs, replayData } = scene('singles');
    const mine = (key: string) => key === teamEditsKey(replayData.id) || key === `ps-replay-interceptor:sets:${replayData.id}`;
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    const realRemove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (mine(key)) throw new Error('SecurityError');
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (mine(key)) throw new Error('QuotaExceededError');
      realSet.call(this, key, value);
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (mine(key)) throw new Error('SecurityError');
      realRemove.call(this, key);
    });
    const session = mountSession(inputs);
    expect(session.result.current.editedP2Info).toBeNull();
    session.edit('p2', 'Safety Goggles');
    expect(session.result.current.editedP2Info).not.toBeNull();
    expect(session.result.current.editorSide).toBeNull();
    session.importText(scene('singles').importText('Choice Band'));
    expect(session.shown().p1!.pokemon[0].item.value).toBe('Choice Band');
  });
});
