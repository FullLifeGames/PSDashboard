import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';

/**
 * Round 67 (T108 point 3): a move the rebuild reads from a `|cant|` line is
 * played as the protocol shows it. The move never ran: when the body's built
 * set lacks it, the click goes out as one of the body's own moves that the
 * same blocker stops (Dex category and priority of the shown move), so the
 * side's choice is not rejected. Before, `move <id>` was rejected and the
 * side played its default (752301 t1: Landorus's U-turn brought Samurott,
 * which took the Taunt meant for Landorus). A `|cant|` that carries `[of]` is
 * the blocker's line (Dazzling, Queenly Majesty, Armor Tail): its move is the
 * foe's, not the subject's click.
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function make(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** Plays turn 1 and returns its public lines as the rebuild reads them, with a fresh board at the boundary. */
function readTurn(format: string, p1: PokemonSet[], p2: PokemonSet[], choices: [string, string]) {
  const played = make(format, p1, p2);
  played.choose('p1', choices[0]);
  played.choose('p2', choices[1]);
  const lines = played.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
  return parseTurnBlocks(lines.join('\n')).turns.find(entry => entry.turn === 1)!.preUpkeep;
}

const landorus = (moves: string[]) => mon('Landorus-Therian', 'Leftovers', 'Intimidate', moves);
const taunter = mon('Landorus-Therian', 'Leftovers', 'Intimidate', ['Taunt', 'Stealth Rock'], 252);
const tauntTurn = ['|move|p2a: Landorus|Taunt|p1a: Landorus', '|-start|p1a: Landorus|move: Taunt', '|cant|p1a: Landorus|move: Taunt|Taunt'];

describe('a |cant| move the body lacks goes out as a move the same blocker stops', () => {
  test('singles: the body\'s status move stands in for the blocked Taunt', () => {
    const board = make('gen9customgame', [landorus(['U-turn', 'Earthquake', 'Stealth Rock', 'Stone Edge'])], [taunter]);
    expect(getMainChoice(tauntTurn, 'p1', board as never)).toBe('move 3');
  });

  test('singles: without a move of that category the slowest move stands in', () => {
    const board = make('gen9customgame', [landorus(['U-turn', 'Earthquake', 'Stone Edge'])], [taunter]);
    expect(getMainChoice(tauntTurn, 'p1', board as never)).toMatch(/^move [1-3]$/);
  });

  test('doubles: the partner keeps its protocol move; neither fragment is rejected', () => {
    const board = make('gen9doublescustomgame',
      [landorus(['U-turn', 'Earthquake', 'Stealth Rock', 'Stone Edge']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Spore', 'Protect'])],
      [taunter, mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])]);
    const events = [...tauntTurn, '|move|p1b: Amoonguss|Protect|p1b: Amoonguss'];
    expect(getMainChoice(events, 'p1', board as never)).toBe('move 3, move 2');
  });
});

describe('a |cant| with [of] names the blocker, not the slot\'s click', () => {
  test('singles: Bruxish\'s Dazzling stops Sucker Punch; Bruxish\'s own move is its choice', () => {
    const p1 = [mon('Bruxish', 'Leftovers', 'Dazzling', ['Psychic Fangs'])];
    const p2 = [mon('Kingambit', 'Leftovers', 'Defiant', ['Sucker Punch'], 252)];
    const events = readTurn('gen9customgame', p1, p2, ['move psychicfangs', 'move suckerpunch']);
    expect(events.some(line => line.startsWith('|cant|p1a: Bruxish|ability: Dazzling|Sucker Punch|[of]'))).toBe(true);
    expect(getMainChoice(events, 'p1', make('gen9customgame', p1, p2) as never)).toBe('move 1');
  });

  test('doubles: Farigiraf\'s Armor Tail stops Fake Out on its partner; Farigiraf\'s own move is its choice', () => {
    const p1 = [mon('Farigiraf', 'Leftovers', 'Armor Tail', ['Protect', 'Hyper Voice']), mon('Amoonguss', 'Leftovers', 'Regenerator', ['Spore'])];
    const p2 = [mon('Incineroar', 'Leftovers', 'Blaze', ['Fake Out'], 252), mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])];
    const events = readTurn('gen9doublescustomgame', p1, p2, ['move hypervoice, move spore 1', 'move fakeout 2, move softboiled']);
    expect(events.some(line => line.startsWith('|cant|p1a: Farigiraf|ability: Armor Tail|Fake Out|[of]'))).toBe(true);
    expect(getMainChoice(events, 'p1', make('gen9doublescustomgame', p1, p2) as never)).toBe('move 2, move 1 +1');
  });

  test('a blocker\'s |cant| line is no action of its slot: a later switch there stays the side\'s choice', () => {
    const events = ['|cant|p1a: Farigiraf|ability: Armor Tail|Fake Out|[of] p2a: Incineroar', '|switch|p1a: Corviknight|Corviknight|100/100'];
    expect(collectForcedSwitchSpecies(events, [], 'p1')).toEqual([]);
  });
});

describe('scene: 752301, Landorus\'s Taunt shows only in a |cant| line', () => {
  test('Landorus is taunted at boundary 2, Samurott enters untaunted at boundary 3, no choice is rejected', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9ou-752301.json');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    // The bank's set for p1's Landorus: the inference does not read the Taunt of the cant line (lane C's T108).
    p1Team.find(set => set.species === 'Landorus-Therian')!.moves = ['U-turn', 'Earthquake', 'Stealth Rock', 'Stone Edge'];
    const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
    const seen = new Map<number, { active: string; taunted: boolean }>();
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      targetTurn: 4, snapshot: snapshotFor(4),
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      capturePositions: {
        snapshotFor,
        onPosition: (turn, battle) => {
          const active = battle.sides[0].active[0]!;
          if (!seen.has(turn)) seen.set(turn, { active: active.species.name, taunted: 'taunt' in active.volatiles });
        },
      },
    });
    expect(runtime.choiceErrors.count).toBe(0);
    expect(seen.get(2)).toEqual({ active: 'Landorus-Therian', taunted: true });
    expect(seen.get(3)).toEqual({ active: 'Samurott-Hisui', taunted: false });
  });
});
