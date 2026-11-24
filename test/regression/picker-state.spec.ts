import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, type TurnSnapshot } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '@fulllifegames/eval-engine';
import { pickerStateFromSerialized, pickerStateFromSnapshot, teraUsedSides } from '../../src/lib/picker-state';

function loadFixtureReplay() {
  return JSON.parse(readFileSync('test/e2e/fixtures/replay.json', 'utf-8')) as {
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
  const { serializeLiveBattle } = await import('@fulllifegames/eval-engine');
  const serialized = serializeLiveBattle(runtime.battleStream.battle!);

  const state = await pickerStateFromSerialized(serialized);
  expect(state.turnNumber).toBe(3);
  expect(state.p1MovesBySlot[0].length).toBeGreaterThan(0);
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
  expect(state.p1MovesBySlot[0][0].maxpp).toBe(0);
  expect(state.p2SwitchesBySlot[0].map(option => option.species)).toContain('Latios');
  expect(state.p2SwitchesBySlot[0].find(option => option.species === 'Latios')?.hpPercent).toBe(100);
  // Snapshots carry percent bars: HP is rebuilt on the absolute scale, as maxhp 100 inflated the shown percentages.
  expect(state.p1Active!.maxhp).toBeGreaterThan(200);
  expect(state.p1Active!.hp).toBe(state.p1Active!.maxhp);
});

test('pickerStateFromSnapshot fills move and species types from the dex', () => {
  const p1Team = [set('Heatran', ['Magma Storm', 'Earth Power', 'Taunt', 'Stealth Rock']), set('Rotom-Wash', ['Volt Switch'])];
  const p2Team = [set('Zapdos', ['Volt Switch', 'Heat Wave', 'Roost', 'Defog']), set('Ferrothorn', ['Leech Seed'])];
  const state = pickerStateFromSnapshot(makeSnapshot(), p1Team, p2Team);

  expect(state.p1MovesBySlot[0].map(move => move.type))
    .toEqual(['Fire', 'Ground', 'Dark', 'Rock']);
  expect(state.p2MovesBySlot[0].map(move => move.type))
    .toEqual(['Electric', 'Fire', 'Flying', 'Flying']);
  expect(state.p1Active?.types).toEqual(['Fire', 'Steel']);
  expect(state.p1Active?.moves.map(move => move.type)).toEqual(['Fire', 'Ground', 'Dark', 'Rock']);
});

function withActive(species: string, extra: Partial<TurnSnapshot['p1']['pokemon'][number]> = {}): TurnSnapshot {
  const snapshot = makeSnapshot();
  snapshot.p1.pokemon[0] = snapshotMon({ name: species, speciesForme: species, isActive: true, ...extra });
  return snapshot;
}

test('pickerStateFromSnapshot labels a move by its type at use', () => {
  const typesFor = (snapshot: TurnSnapshot, team: PokemonSet) =>
    pickerStateFromSnapshot(snapshot, [team], [set('Zapdos', ['Roost'])]).p1MovesBySlot[0].map(move => move.type);
  expect(typesFor(withActive('Ogerpon-Wellspring'), set('Ogerpon-Wellspring', ['Ivy Cudgel', 'Horn Leech']))).toEqual(['Water', 'Grass']);
  expect(typesFor(withActive('Sylveon', { ability: 'Pixilate' }), set('Sylveon', ['Hyper Voice', 'Shadow Ball']))).toEqual(['Fairy', 'Ghost']);
  expect(typesFor(withActive('Sylveon'), { ...set('Sylveon', ['Hyper Voice']), ability: 'Pixilate' })).toEqual(['Fairy']);
  expect(typesFor(withActive('Sylveon'), set('Sylveon', ['Hyper Voice']))).toEqual(['Normal']);
  expect(typesFor(withActive('Garchomp', { terastallized: 'Fairy' }), set('Garchomp', ['Tera Blast', 'Earthquake']))).toEqual(['Fairy', 'Ground']);
  expect(typesFor(withActive('Garchomp'), set('Garchomp', ['Tera Blast']))).toEqual(['Normal']);
});

test('pickerStateFromSnapshot labels both doubles slots at use', () => {
  const snapshot = makeSnapshot();
  snapshot.p1.pokemon = [
    snapshotMon({ name: 'Ogerpon-Hearthflame', speciesForme: 'Ogerpon-Hearthflame', isActive: true }),
    snapshotMon({ name: 'Primarina', speciesForme: 'Primarina', isActive: true, ability: 'Liquid Voice' }),
  ];
  const team = [set('Ogerpon-Hearthflame', ['Ivy Cudgel']), set('Primarina', ['Hyper Voice', 'Moonblast'])];
  const state = pickerStateFromSnapshot(snapshot, team, [set('Zapdos', ['Roost'])]);
  expect(state.p1MovesBySlot.map(moves => moves.map(move => move.type))).toEqual([['Fire'], ['Water', 'Fairy']]);
});

// `canTerastallize` on the snapshot's facts: gen 9, no spent Tera, no Z crystal or Mega Stone, no Terastal Clause.
test('pickerStateFromSnapshot offers the Tera type the battle will have', () => {
  const teraOf = (snapshot: TurnSnapshot, team: PokemonSet, gen = 9, format?: string) =>
    pickerStateFromSnapshot(snapshot, [team], [set('Zapdos', ['Roost'])], gen, null, { format }).p1ModifiersBySlot.map(slot => slot.teraType);
  const heatran = { ...set('Heatran', ['Magma Storm']), teraType: 'Fairy' };
  expect(teraOf(makeSnapshot(), heatran)).toEqual(['Fairy']);
  expect(teraOf(makeSnapshot(), set('Heatran', ['Magma Storm']))).toEqual(['Fire']);
  const spent = makeSnapshot();
  spent.p1.pokemon[1] = { ...spent.p1.pokemon[1], terastallized: 'Water' };
  expect(teraOf(spent, heatran)).toEqual([null]);
  expect(teraOf(makeSnapshot(), heatran, 8)).toEqual([null]);
  expect(teraOf(makeSnapshot(), heatran, 9, 'gen9monotype')).toEqual([null]);
  expect(teraOf(makeSnapshot(), heatran, 9, 'gen9ou')).toEqual(['Fairy']);
  expect(teraOf(withActive('Charizard'), { ...set('Charizard', ['Flamethrower']), item: 'Charizardite X' }, 9, 'gen9customgame')).toEqual([null]);
  expect(teraOf(withActive('Garchomp'), { ...set('Garchomp', ['Earthquake']), item: 'Charizardite X' }, 9, 'gen9customgame')).toEqual(['Dragon']);
});

test('a side whose terastallized Pokémon fainted has spent its Tera', () => {
  const earlier = makeSnapshot();
  earlier.log = ['|move|p1a: Heatran|Magma Storm|p2a: Zapdos', '|-terastallize|p1a: Rotom-Wash|Water'];
  const now = makeSnapshot();
  now.p1.pokemon[1] = { ...now.p1.pokemon[1], fainted: true, hp: 0, hpPercent: 0 };
  const teraUsed = teraUsedSides([earlier, now]);
  expect(teraUsed).toEqual({ p1: true, p2: false });
  const state = pickerStateFromSnapshot(now, [{ ...set('Heatran', ['Magma Storm']), teraType: 'Fairy' }], [set('Zapdos', ['Roost'])], 9, null, { teraUsed });
  expect(state.p1ModifiersBySlot[0].teraType).toBeNull();
  expect(state.p2ModifiersBySlot[0].teraType).toBe('Electric');
});

// pokemon.js transformInto bars a body transformed into Ogerpon or Terapagos from Tera.
test('a body transformed into Ogerpon offers no Tera, like the simulator', async () => {
  const { Battle, Teams } = await import('@pkmn/sim');
  const ogerpon = { ...set('Ogerpon-Wellspring', ['Ivy Cudgel']), item: 'Wellspring Mask', teraType: 'Water' };
  const ditto = { ...set('Ditto', ['Transform']), ability: 'Imposter', teraType: 'Normal' };
  const battle = new Battle({ formatid: 'gen9customgame' as never, seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack([ogerpon]) }, p2: { name: 'B', team: Teams.pack([ditto]) } });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  const { serializeLiveBattle } = await import('@fulllifegames/eval-engine');
  const stored = await pickerStateFromSerialized(serializeLiveBattle(battle));
  expect(stored.p2ActiveSlots[0].species).toBe('Ogerpon-Wellspring');
  expect(stored.p2ModifiersBySlot[0].teraType).toBeNull();
  expect(stored.p1ModifiersBySlot[0].teraType).toBe('Water');

  const snapshot = makeSnapshot();
  snapshot.p1.pokemon = [snapshotMon({ name: 'Ogerpon-Wellspring', speciesForme: 'Ogerpon-Wellspring', isActive: true })];
  snapshot.p2.pokemon = [snapshotMon({ name: 'Ditto', speciesForme: 'Ogerpon-Wellspring', isActive: true })];
  const fast = pickerStateFromSnapshot(snapshot, [ogerpon], [ditto], 9, null, { format: 'gen9customgame' });
  expect(fast.p2ModifiersBySlot[0].teraType).toBe(stored.p2ModifiersBySlot[0].teraType);
  expect(fast.p1ModifiersBySlot[0].teraType).toBe(stored.p1ModifiersBySlot[0].teraType);
});

test('pickerStateFromSnapshot offers each doubles slot its own Tera type', () => {
  const snapshot = makeSnapshot();
  snapshot.p1.pokemon = [
    snapshotMon({ name: 'Heatran', speciesForme: 'Heatran', isActive: true }),
    snapshotMon({ name: 'Rotom-Wash', speciesForme: 'Rotom-Wash', isActive: true }),
  ];
  const team = [{ ...set('Heatran', ['Magma Storm']), teraType: 'Grass' }, set('Rotom-Wash', ['Hydro Pump'])];
  expect(pickerStateFromSnapshot(snapshot, team, [set('Zapdos', ['Roost'])]).p1ModifiersBySlot.map(slot => slot.teraType)).toEqual(['Grass', 'Electric']);
});

test('the snapshot picker offers the Tera types of the stored picker', async () => {
  const doubles = JSON.parse(readFileSync('test/e2e-feedback/fixtures/gen9doublesou-2663093831.json', 'utf-8')) as { formatid: string; log: string };
  for (const fixture of [loadFixtureReplay(), doubles]) {
    const snapshots = parseReplayLog(fixture.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(fixture.log);
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(fixture), p1Team, p2Team, replayLog: fixture.log, targetTurn: 3,
      snapshot: snapshots.find(entry => entry.turn === 3) ?? null,
    });
    const { serializeLiveBattle } = await import('@fulllifegames/eval-engine');
    const stored = await pickerStateFromSerialized(serializeLiveBattle(runtime.battleStream.battle!));
    const at = snapshots.findIndex(entry => entry.turn === 3);
    const fast = pickerStateFromSnapshot(snapshots[at], p1Team, p2Team, 9, null, { format: getBranchSimulatorFormat(fixture), teraUsed: teraUsedSides(snapshots.slice(0, at + 1)) });
    for (const side of ['p1', 'p2'] as const) {
      const bySpecies = (state: typeof stored) => Object.fromEntries(state[`${side}ActiveSlots`].map((info, slot) =>
        [info.species, state[`${side}ModifiersBySlot`][slot]?.teraType ?? null]));
      expect(bySpecies(fast), `${fixture.formatid} ${side}`).toEqual(bySpecies(stored));
    }
  }
}, 120_000);

test('pickerStateFromSnapshot carries the Tera type of a terastallized body', () => {
  const snapshot = makeSnapshot();
  snapshot.p1.pokemon[0] = { ...snapshot.p1.pokemon[0], terastallized: 'Grass' };
  const state = pickerStateFromSnapshot(snapshot, [set('Heatran', ['Magma Storm'])], [set('Zapdos', ['Roost'])]);
  expect(state.p1Active?.teraType).toBe('Grass');
  expect(state.p2Active?.teraType).toBe('');
});
