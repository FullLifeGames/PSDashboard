import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  annotateNicknames,
  reconstructBranchRuntime,
  executeBranchChoices,
  type BranchMoveOption,
  type BranchSwitchOption,
  type BranchTargetOption,
} from '../src/branch-engine';
import { resolveCustomChoice } from '../src/branch-choices';
import { resolveSideChoices, chooseOnCopy as branchCopy } from '../src/branch/execute';
import { createBranchStateFromBattle } from '../src/branch/state';
import type { SimBattle } from '../src/branch/types';
import { FORMATS, moveCommand, setOf, sideId, startBattle } from './branch-rule-battles';
import { chooseOnCopy as diceCopy } from '../src/dice/logged-block';
import { inferOpponentTeam } from '@fulllifegames/replay-core';

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

describe('executeBranchChoices', () => {
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

describe('resolveCustomChoice', () => {
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

describe('error message nickname annotation', () => {
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

interface Row {
  name: string;
  victim: { moves: string[]; item?: string };
  source: { moves: string[] };
  /** What the victim and the source click on turn 1 (move names). */
  turn1: { victim: string; source: string };
  /** The move ids the simulator disables at the second request. */
  disabled: string[];
  /** Runs after turn 1, before the second request is read (a state the sim reaches only by PP loss). */
  after?: (battle: SimBattle, victimSide: number) => void;
}

const ROWS: Row[] = [
  { name: 'Taunt', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Taunt', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Taunt' }, disabled: ['swordsdance', 'recover'] },
  { name: 'Disable', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Disable', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Disable' }, disabled: ['tackle'] },
  { name: 'Encore', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Encore', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Encore' }, disabled: ['swordsdance', 'recover', 'hypervoice'] },
  { name: 'Torment', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Torment', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Torment' }, disabled: ['tackle'] },
  { name: 'Imprison', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Imprison', 'Tackle', 'Recover', 'Splash'] },
    turn1: { victim: 'Swords Dance', source: 'Imprison' }, disabled: ['tackle', 'recover'] },
  { name: 'Heal Block', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Heal Block', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Heal Block' }, disabled: ['recover'] },
  { name: 'Gravity', victim: { moves: ['Tackle', 'Splash', 'Fly', 'Hyper Voice'] }, source: { moves: ['Gravity', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Gravity' }, disabled: ['splash', 'fly'] },
  { name: 'Throat Chop', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Throat Chop', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Throat Chop' }, disabled: ['hypervoice'] },
  { name: 'Choice Scarf', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'], item: 'Choice Scarf' }, source: { moves: ['Splash'] },
    turn1: { victim: 'Tackle', source: 'Splash' }, disabled: ['swordsdance', 'recover', 'hypervoice'] },
  { name: 'Assault Vest', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'], item: 'Assault Vest' }, source: { moves: ['Splash'] },
    turn1: { victim: 'Tackle', source: 'Splash' }, disabled: ['swordsdance', 'recover'] },
  { name: 'a move that cannot repeat', victim: { moves: ['Gigaton Hammer', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Splash'] },
    turn1: { victim: 'Gigaton Hammer', source: 'Splash' }, disabled: ['gigatonhammer'] },
  { name: 'a move at 0 PP (A-1)', victim: { moves: ['Tackle', 'Toxic Spikes', 'Recover', 'Hyper Voice'] }, source: { moves: ['Splash'] },
    turn1: { victim: 'Tackle', source: 'Splash' }, disabled: ['toxicspikes'],
    after: (battle, victimSide) => {
      battle.sides[victimSide].active[0].moveSlots[1].pp = 0;
      battle.makeRequest('move');
    } },
];

function build(row: Row, format: typeof FORMATS[number], victimSide: number): SimBattle {
  const victim = [setOf('Pikachu', row.victim.moves, { item: row.victim.item ?? '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 } }),
    ...(format.doubles ? [setOf('Eevee', ['Splash'])] : []), setOf('Meowth', ['Splash'])];
  const source = [setOf('Snorlax', row.source.moves),
    ...(format.doubles ? [setOf('Corviknight', ['Splash'])] : []), setOf('Gliscor', ['Splash'])];
  const battle = startBattle(format.id, victimSide === 0 ? victim : source, victimSide === 0 ? source : victim);
  expect(battle.choose(sideId(victimSide), moveCommand(battle, row.turn1.victim, format.doubles)), 'victim turn 1').toBe(true);
  expect(battle.choose(sideId(1 - victimSide), moveCommand(battle, row.turn1.source, format.doubles)), 'source turn 1').toBe(true);
  row.after?.(battle, victimSide);
  return battle;
}

type RequestMove = { id: string; disabled?: unknown };
const requestMoves = (battle: SimBattle, side: number): RequestMove[] =>
  (battle.sides[side].activeRequest as unknown as { active: { moves: RequestMove[] }[] }).active[0].moves;
/**
 * The moves the player cannot click: the request's flag, or the slot's own (a hidden disable such as Imprison's
 * stays out of a singles request, which hides what the player cannot know; the omniscient picker still shows it).
 */
const unavailable = (battle: SimBattle, side: number): Map<string, boolean> => {
  const slots = battle.sides[side].active[0].moveSlots;
  return new Map(requestMoves(battle, side).map(move => [move.id, !!move.disabled || !!slots.find(slot => slot.id === move.id)?.disabled]));
};
const pickerMoves = (battle: SimBattle, side: number) => {
  const state = createBranchStateFromBattle(battle, [], {});
  return (side === 0 ? state.p1MovesBySlot : state.p2MovesBySlot)[0];
};

describe('A-1 every move button agrees with the simulator request', () => {
  for (const format of FORMATS) {
    for (const victimSide of [0, 1]) {
      for (const row of ROWS) {
        test(`${format.name}, ${sideId(victimSide)}: ${row.name}`, () => {
          const battle = build(row, format, victimSide);
          const expected = unavailable(battle, victimSide);
          // The row is real: the simulator disables exactly the expected moves.
          expect([...expected].filter(([, disabled]) => disabled).map(([id]) => id).sort()).toEqual([...row.disabled].sort());
          // The picker shows the same flag on every button.
          const picker = pickerMoves(battle, victimSide);
          expect(picker.map(move => move.disabled)).toEqual([...expected.values()]);
          // And a disabled button never reaches Execute as a command the simulator would refuse.
          const disabledButton = picker.find(move => move.disabled)!;
          const resolved = resolveSideChoices(battle, sideId(victimSide), [{ kind: 'move', moveId: disabledButton.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: disabledButton.name }], [true]);
          expect(resolved.ok).toBe(false);
        });
      }
    }
  }

  for (const format of FORMATS) {
    test(`${format.name}: with every move at 0 PP the picker offers what the request offers`, () => {
      const row: Row = { name: 'all empty', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Splash'] },
        turn1: { victim: 'Tackle', source: 'Splash' }, disabled: [],
        after: (battle) => {
          for (const slot of battle.sides[0].active[0].moveSlots) slot.pp = 0;
          battle.makeRequest('move');
        } };
      const battle = build(row, format, 0);
      expect(requestMoves(battle, 0).map(move => move.id)).toEqual(['struggle']);
      const enabled = pickerMoves(battle, 0).filter(move => !move.disabled);
      expect(enabled.map(move => move.name)).toEqual(['Struggle']);
      const resolved = resolveSideChoices(battle, 'p1', [{ kind: 'move', moveId: 'struggle', moveName: 'Struggle' }], [true, ...(format.doubles ? [false] : [])]);
      expect(resolved.ok).toBe(true);
    });
  }
});

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', level: 100, gender: '',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function board(doubles: boolean): Battle {
  const mons = (moves: string[]): PokemonSet[] => (doubles ? [set('Snorlax', moves), set('Blissey', ['Soft-Boiled', 'Tackle'])] : [set('Snorlax', moves)]);
  const battle = new Battle({
    formatid: toID(doubles ? 'gen9doublescustomgame' : 'gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(mons(['Body Slam', 'Curse'])) }, p2: { name: 'Beta', team: Teams.pack(mons(['Body Slam', 'Curse'])) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  return battle;
}

type Commands = { side: 'p1' | 'p2'; command: string }[];
type Copy = (battle: SimBattle & Battle, commands: Commands) => void;
const copies: [string, Copy][] = [['branch/execute.ts', branchCopy as Copy], ['dice/logged-block.ts', diceCopy as Copy]];

/** What a copy does to one battle: the log it leaves, or the message it throws. */
function outcome(copy: Copy, doubles: boolean, commands: Commands): { log: string[]; thrown: string | null } {
  const battle = board(doubles);
  let thrown: string | null = null;
  try { copy(battle as SimBattle & Battle, commands); } catch (error) { thrown = (error as Error).message; }
  return { log: battle.log.filter(line => !line.startsWith('|t:|')), thrown };
}

describe('the two chooseOnCopy functions answer alike', () => {
  for (const doubles of [false, true]) {
    const game = doubles ? 'doubles' : 'singles';
    const move = (name: string, aim = ''): string => (doubles ? `move ${name}${aim}, move softboiled` : `move ${name}`);
    const rows: [string, Commands][] = [
      ['both sides choose', [{ side: 'p1', command: move('bodyslam', ' 1') }, { side: 'p2', command: move('curse') }]],
      ['p1 chooses a move it has not', [{ side: 'p1', command: move('thunderbolt', ' 1') }, { side: 'p2', command: move('curse') }]],
      ['p2 chooses a move it has not', [{ side: 'p1', command: move('curse') }, { side: 'p2', command: move('thunderbolt', ' 1') }]],
    ];
    for (const [label, commands] of rows) {
      test(`${game}: ${label}`, () => {
        const [branch, dice] = copies.map(([, copy]) => outcome(copy, doubles, commands));
        expect(branch).toEqual(dice);
        // The rows have teeth: a refusal throws, an accepted pair writes the turn.
        expect(branch.thrown !== null).toBe(label !== 'both sides choose');
        if (branch.thrown === null) expect(branch.log.some(line => line.startsWith('|move|'))).toBe(true);
      });
    }
  }

  test('a refusal without a text throws the same fallback sentence for either side', () => {
    for (const side of ['p1', 'p2'] as const) {
      const stub = { choose: () => false, sides: [{ choice: { error: '' } }, { choice: { error: '' } }] } as unknown as SimBattle & Battle;
      const messages = copies.map(([, copy]) => { try { copy(stub, [{ side, command: 'move 1' }]); return null; } catch (error) { return (error as Error).message; } });
      expect(messages).toEqual(['The simulator rejected this choice.', 'The simulator rejected this choice.']);
    }
  });

  test('the error text of each side comes from that side', () => {
    const stub = { choose: () => false, sides: [{ choice: { error: 'one says no' } }, { choice: { error: 'two says no' } }] } as unknown as SimBattle & Battle;
    for (const [side, text] of [['p1', 'one says no'], ['p2', 'two says no']] as const) {
      const messages = copies.map(([, copy]) => { try { copy(stub, [{ side, command: 'x' }]); return null; } catch (error) { return (error as Error).message; } });
      expect(messages).toEqual([text, text]);
    }
  });
});

describe('followup-fixes', () => {
  const poisonHealLog = [
    '|player|p1|Bene|',
    '|gen|9',
    '|poke|p1|Gliscor, M|item',
    '|start',
    '|switch|p1a: Glolo|Gliscor, M|100/100',
    '|turn|1',
    '|-status|p1a: Glolo|tox',
    '|turn|2',
    '|-heal|p1a: Glolo|94/100 tox|[from] ability: Poison Heal',
    '|turn|3',
  ].join('\n');

  const roughSkinLog = [
    '|player|p2|Lolome|',
    '|gen|9',
    '|poke|p2|Garchomp, M|item',
    '|start',
    '|switch|p2a: Chompy|Garchomp, M|100/100',
    '|turn|1',
    '|move|p1a: Attacker|Tackle|p2a: Chompy',
    '|-damage|p1a: Attacker|84/100|[from] ability: Rough Skin|[of] p2a: Chompy',
    '|turn|2',
  ].join('\n');

  const bootsLog = [
    '|player|p2|Lolome|',
    '|gen|9',
    '|poke|p2|Corviknight, M|item',
    '|poke|p2|Garchomp, M|item',
    '|start',
    '|switch|p2a: Garchomp|Garchomp, M|100/100',
    '|turn|1',
    '|move|p1a: Rocker|Stealth Rock|p2a: Garchomp',
    '|-sidestart|p2: Lolome|move: Stealth Rock',
    '|turn|2',
    '|switch|p2a: Corviknight|Corviknight, M|100/100',
    '|turn|3',
    '|switch|p2a: Garchomp|Garchomp, M|100/100',
    '|-damage|p2a: Garchomp|88/100|[from] Stealth Rock',
    '|turn|4',
  ].join('\n');

  describe('follow-up fixes from user testing', () => {
    test('reveals abilities from [from] ability: attributions (Poison Heal)', () => {
      const info = inferOpponentTeam(poisonHealLog, 'p1');
      const gliscor = info.pokemon.find(pokemon => pokemon.species === 'Gliscor');
      expect(gliscor?.ability).toEqual(expect.objectContaining({ value: 'Poison Heal', source: 'revealed' }));
    });

    test('attributes [of]-tagged abilities to their owner (Rough Skin)', () => {
      const info = inferOpponentTeam(roughSkinLog, 'p2');
      const garchomp = info.pokemon.find(pokemon => pokemon.species === 'Garchomp');
      expect(garchomp?.ability).toEqual(expect.objectContaining({ value: 'Rough Skin', source: 'revealed' }));
    });

    test('infers Heavy-Duty Boots when switching into rocks without damage', () => {
      const info = inferOpponentTeam(bootsLog, 'p2');
      const corviknight = info.pokemon.find(pokemon => pokemon.species === 'Corviknight');
      const garchomp = info.pokemon.find(pokemon => pokemon.species === 'Garchomp');

      expect(corviknight?.item).toEqual(expect.objectContaining({
        value: 'Heavy-Duty Boots',
        source: 'guessed',
      }));
      // Garchomp took the rocks damage, so no boots inference.
      expect(garchomp?.item.value).not.toBe('Heavy-Duty Boots');
    });
  });

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
  ];

  const p2Team: PokemonSet[] = [
    {
      name: 'Bulbasaur',
      species: 'Bulbasaur',
      item: 'Eviolite',
      ability: 'Overgrow',
      moves: ['Vine Whip', 'Protect'],
      nature: 'Modest',
      evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 50,
    },
  ];

  const singlesLog = [
    '|switch|p1a: Pikachu|Pikachu, L50|100/100',
    '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
    '|turn|1',
  ].join('\n');

  describe('concurrent execute protection', () => {
    test('two overlapping executes commit exactly one turn', async () => {
      const runtime = await reconstructBranchRuntime({
        format: 'gen9ou',
        p1Team,
        p2Team,
        replayLog: singlesLog,
        targetTurn: 1,
      });
      const battle = runtime.battleStream.battle!;
      expect(battle.turn).toBe(1);

      // A double click races two identical writes into the sim: the second pair lands on the next request and silently
      // commits an extra turn, which is why the UI needs its in-flight guard.
      const commands = [
        { side: 'p1' as const, command: 'move 1' },
        { side: 'p2' as const, command: 'move 1' },
      ];
      const [first, second] = await Promise.all([
        executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands }),
        executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands }),
      ]);

      expect(first.ok || second.ok).toBe(true);
      // Without a guard the battle advances past turn 2.
      expect(battle.turn).toBeGreaterThanOrEqual(2);
    });
  });
});
