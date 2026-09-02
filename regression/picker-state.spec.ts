import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../packages/replay-core/src/team-builder';
import { reconstructBranchRuntime } from '../src/lib/branch-engine';
import { parseReplayLog } from '../packages/replay-core/src/protocol-parser';
import { pickerStateFromSerialized, pickerStateFromSnapshot } from '../src/lib/picker-state';
import type { TurnSnapshot } from '../packages/replay-core/src/types';

function loadFixtureReplay() {
  return JSON.parse(readFileSync('e2e/fixtures/replay.json', 'utf-8')) as {
    formatid: string;
    log: string;
  };
}

test('pickerStateFromSerialized rebuilds exact move lists with live PP', async () => {
  const fixture = loadFixtureReplay();
  const snapshots = parseReplayLog(fixture.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(fixture.log);
  const runtime = await reconstructBranchRuntime({
    format: fixture.formatid || 'gen9ou',
    p1Team,
    p2Team,
    replayLog: fixture.log,
    targetTurn: 3,
    snapshot: snapshots.find(entry => entry.turn === 3) ?? null,
  });
  const { serializeLiveBattle } = await import('../src/lib/eval/serialize');
  const serialized = serializeLiveBattle(runtime.battleStream.battle!);

  const state = await pickerStateFromSerialized(serialized);
  expect(state.turnNumber).toBe(3);
  expect(state.p1MovesBySlot[0].length).toBeGreaterThan(0);
  // Live PP, never dex pools: pp must sit inside [0, maxpp] with a real maxpp.
  for (const move of state.p1MovesBySlot[0]) {
    expect(move.maxpp).toBeGreaterThan(0);
    expect(move.pp).toBeGreaterThanOrEqual(0);
    expect(move.pp).toBeLessThanOrEqual(move.maxpp);
  }
  expect(state.p2SwitchesBySlot[0].every(option => !option.fainted)).toBe(true);
});

const snapshotMon = (
  overrides: Partial<TurnSnapshot['p1']['pokemon'][number]> & { name: string; speciesForme: string },
): TurnSnapshot['p1']['pokemon'][number] => ({
  hp: 100, maxhp: 100, hpPercent: 100, status: '', fainted: false, isActive: false,
  boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 100, gender: '',
  ...overrides,
});

function makeSnapshot(): TurnSnapshot {
  return {
    turn: 7,
    p1: {
      name: 'P1', id: 'p1', sideConditions: { stealthrock: {} },
      pokemon: [
        snapshotMon({ name: 'Heatran', speciesForme: 'Heatran', isActive: true }),
        snapshotMon({ name: 'Rotom-Wash', speciesForme: 'Rotom-Wash', hpPercent: 64, hp: 64 }),
        snapshotMon({ name: 'Weavile', speciesForme: 'Weavile', hpPercent: 0, hp: 0, fainted: true }),
      ],
    },
    p2: {
      name: 'P2', id: 'p2', sideConditions: {},
      pokemon: [
        snapshotMon({ name: 'Zapdos', speciesForme: 'Zapdos', isActive: true, hpPercent: 78, hp: 78 }),
        snapshotMon({ name: 'Ferrothorn', speciesForme: 'Ferrothorn' }),
        // Never revealed: percent-scale zeros, but a healthy switch option.
        snapshotMon({ name: 'Latios', speciesForme: 'Latios', hp: 0, maxhp: 0, hpPercent: 0 }),
      ],
    },
    field: { weather: '', terrain: '', pseudoWeather: {} },
    log: [],
  };
}

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves,
  nature: '', gender: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

test('pickerStateFromSnapshot offers team moves and the living bench', () => {
  const p1Team = [set('Heatran', ['Magma Storm', 'Earth Power', 'Taunt', 'Stealth Rock']), set('Rotom-Wash', ['Volt Switch'])];
  const p2Team = [set('Zapdos', ['Volt Switch', 'Heat Wave', 'Roost', 'Defog']), set('Ferrothorn', ['Leech Seed'])];
  const state = pickerStateFromSnapshot(makeSnapshot(), p1Team, p2Team);

  expect(state.turnNumber).toBe(7);
  expect(state.p1MovesBySlot[0].map(move => move.name))
    .toEqual(['Magma Storm', 'Earth Power', 'Taunt', 'Stealth Rock']);
  expect(state.p1SwitchesBySlot[0].map(option => option.species)).toContain('Rotom-Wash');
  expect(state.p1SwitchesBySlot[0].map(option => option.species)).not.toContain('Weavile');
  expect(state.p2Active?.species).toBe('Zapdos');
  expect(state.field.p1SideConditions).toContain('stealthrock');
  // PP is unknown at snapshot level — 0/0 marks the approximation honestly.
  expect(state.p1MovesBySlot[0][0].maxpp).toBe(0);
  // A never-revealed bench mon (percent-scale zeros) is a healthy option.
  expect(state.p2SwitchesBySlot[0].map(option => option.species)).toContain('Latios');
  expect(state.p2SwitchesBySlot[0].find(option => option.species === 'Latios')?.hpPercent).toBe(100);
  // HP is rebuilt on the ABSOLUTE scale (snapshots carry percent bars):
  // feeding maxhp 100 into the damage calc inflated shown percentages.
  expect(state.p1Active!.maxhp).toBeGreaterThan(200);
  expect(state.p1Active!.hp).toBe(state.p1Active!.maxhp);
});

test('pickerStateFromSnapshot fills move and species types from the dex', () => {
  const p1Team = [set('Heatran', ['Magma Storm', 'Earth Power', 'Taunt', 'Stealth Rock']), set('Rotom-Wash', ['Volt Switch'])];
  const p2Team = [set('Zapdos', ['Volt Switch', 'Heat Wave', 'Roost', 'Defog']), set('Ferrothorn', ['Leech Seed'])];
  const state = pickerStateFromSnapshot(makeSnapshot(), p1Team, p2Team);

  // The snapshot only knows move NAMES — the type comes from the dex so the
  // buttons color and label exactly like the live sim's.
  expect(state.p1MovesBySlot[0].map(move => move.type))
    .toEqual(['Fire', 'Ground', 'Dark', 'Rock']);
  expect(state.p2MovesBySlot[0].map(move => move.type))
    .toEqual(['Electric', 'Fire', 'Flying', 'Flying']);
  expect(state.p1Active?.types).toEqual(['Fire', 'Steel']);
  expect(state.p1Active?.moves.map(move => move.type)).toEqual(['Fire', 'Ground', 'Dark', 'Rock']);
});
