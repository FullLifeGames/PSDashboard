import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  annotateNicknames,
  reconstructBranchRuntime,
  executeBranchChoices,
  type BranchMoveOption,
  type BranchSwitchOption,
  type BranchTargetOption,
} from '../packages/eval-engine/src/branch-engine';
import { resolveCustomChoice } from '../packages/eval-engine/src/branch-choices';

const p1Team: PokemonSet[] = [
  {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Eevee',
    species: 'Eevee',
    item: 'Eviolite',
    ability: 'Adaptability',
    moves: ['Tackle', 'Protect'],
    nature: 'Jolly',
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const p2Team: PokemonSet[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    item: 'Eviolite',
    ability: 'Overgrow',
    moves: ['Vine Whip', 'Protect'],
    nature: 'Modest',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
  {
    name: 'Charmander',
    species: 'Charmander',
    item: 'Eviolite',
    ability: 'Blaze',
    moves: ['Ember', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const singlesLog = [
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
].join('\n');

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test.describe('executeBranchChoices', () => {
  test('rejects an invalid choice without advancing the battle', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });

    const battle = runtime.battleStream.battle!;
    const turnBefore = battle.turn;
    const logLengthBefore = runtime.log.length;

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move 99' },
        { side: 'p2', command: 'move 1' },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/can't move/i);
    }
    expect(runtime.battleStream.battle!.turn).toBe(turnBefore);
    expect(runtime.log.length).toBe(logLengthBefore);
  });

  test('executes a valid turn after a rejected attempt', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });

    const invalid = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move 99' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(invalid.ok).toBe(false);

    const valid = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move 1' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(valid.ok).toBe(true);

    await waitFor(() => runtime.log.some(line => line === '|turn|2'));
    expect(runtime.battleStream.battle!.turn).toBe(2);
    expect(runtime.log).toContain('|turn|2');
  });
});

function makeMove(overrides: Partial<BranchMoveOption> & { name: string; slot: number }): BranchMoveOption {
  return {
    activeSlot: 0,
    pp: 16,
    maxpp: 16,
    disabled: false,
    type: 'Normal',
    targetType: 'normal',
    requiresTarget: false,
    targetOptions: [],
    ...overrides,
  };
}

function makeTarget(targetLoc: number, name: string): BranchTargetOption {
  return {
    label: targetLoc > 0 ? `P2${targetLoc === 1 ? 'A' : 'B'}` : 'P1B',
    targetLoc,
    side: targetLoc > 0 ? 'p2' : 'p1',
    activeSlot: Math.abs(targetLoc) - 1,
    name,
    species: name,
    hpPercent: 100,
  };
}

function makeSwitch(slot: number, name: string): BranchSwitchOption {
  return {
    name,
    species: name,
    activeSlot: 0,
    slot,
    hp: '100%',
    hpPercent: 100,
    fainted: false,
  };
}

test.describe('resolveCustomChoice', () => {
  const moves = [
    makeMove({ name: 'Thunderbolt', slot: 1 }),
    makeMove({ name: 'Volt Switch', slot: 2 }),
    makeMove({ name: 'Protect', slot: 3, disabled: true }),
  ];
  const switches = [makeSwitch(2, 'Eevee'), makeSwitch(3, 'Raichu')];

  test('resolves slot-based and name-based move choices to move identities', () => {
    expect(resolveCustomChoice('move 2', moves, switches))
      .toEqual({ ok: true, choice: { kind: 'move', moveId: 'voltswitch', moveName: 'Volt Switch' } });
    expect(resolveCustomChoice('move thunderbolt', moves, switches))
      .toEqual({ ok: true, choice: { kind: 'move', moveId: 'thunderbolt', moveName: 'Thunderbolt' } });
    expect(resolveCustomChoice('move Volt Switch', moves, switches))
      .toEqual({ ok: true, choice: { kind: 'move', moveId: 'voltswitch', moveName: 'Volt Switch' } });
  });

  test('rejects out-of-range slots, unknown moves, and disabled moves', () => {
    const outOfRange = resolveCustomChoice('move 99', moves, switches);
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.error).toContain('99');

    const unknown = resolveCustomChoice('move flamethrower', moves, switches);
    expect(unknown.ok).toBe(false);

    const disabled = resolveCustomChoice('move protect', moves, switches);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error).toContain('disabled');
  });

  test('validates explicit targets against the move target options', () => {
    const targeted = [
      makeMove({
        name: 'Icy Wind',
        slot: 1,
        requiresTarget: true,
        targetOptions: [makeTarget(1, 'Bulbasaur'), makeTarget(2, 'Charmander')],
      }),
    ];

    expect(resolveCustomChoice('move 1 +2', targeted, []))
      .toEqual({ ok: true, choice: { kind: 'move', moveId: 'icywind', moveName: 'Icy Wind', targetLoc: 2 } });
    expect(resolveCustomChoice('move 1', targeted, []))
      .toEqual({ ok: true, choice: { kind: 'move', moveId: 'icywind', moveName: 'Icy Wind', targetLoc: 1 } });

    const badTarget = resolveCustomChoice('move 1 -1', targeted, []);
    expect(badTarget.ok).toBe(false);
    if (!badTarget.ok) expect(badTarget.error).toContain('Invalid target');
  });

  test('resolves switches by slot and name and rejects unavailable ones', () => {
    expect(resolveCustomChoice('switch 3', moves, switches))
      .toEqual({ ok: true, choice: { kind: 'switch', speciesId: 'raichu', pokemonName: 'Raichu' } });
    expect(resolveCustomChoice('switch eevee', moves, switches))
      .toEqual({ ok: true, choice: { kind: 'switch', speciesId: 'eevee', pokemonName: 'Eevee' } });

    const badSlot = resolveCustomChoice('switch 9', moves, switches);
    expect(badSlot.ok).toBe(false);

    const badName = resolveCustomChoice('switch mewtwo', moves, switches);
    expect(badName.ok).toBe(false);
  });

  test('rejects unrecognized syntax with guidance', () => {
    const garbage = resolveCustomChoice('attack now', moves, switches);
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error).toContain('Supported');
  });
});

test.describe('error message nickname annotation', () => {
  test('annotates nicknames with species in simulator error messages', () => {
    const battle = new Battle({
      formatid: toID('gen9customgame'),
      seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([{ ...p1Team[0], name: 'Sludge Shadow', species: 'Muk-Alola' }]) },
      p2: { name: 'Beta', team: Teams.pack([p2Team[0]]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    expect(annotateNicknames("Can't switch: Sludge Shadow is already in.", battle))
      .toBe("Can't switch: Sludge Shadow (Muk-Alola) is already in.");
    // Non-nicknamed Pokémon and already-annotated messages pass through.
    expect(annotateNicknames('Bulbasaur is trapped.', battle)).toBe('Bulbasaur is trapped.');
    expect(annotateNicknames('Sludge Shadow (Muk-Alola) fainted.', battle))
      .toBe('Sludge Shadow (Muk-Alola) fainted.');
  });
});
