import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Battle } from '@pkmn/client';
import {
  buildChoiceLockContext, createBranchState, executeBranchChoices, reconstructBranchRuntime,
  requiredChoicesForActiveSlots, resolveSideChoices, type BranchRuntime, type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import {
  buildTeamsFromReplay, generationsFor, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations,
  replayBringOnly, speciesBaseId, toId, type ReplayData,
} from '@fulllifegames/replay-core';
import { branchFrameLog } from '../src/lib/branch-log';

/**
 * The replay iframe's sidebar icons in a branch. The embed keeps one roster
 * entry per Pokémon and finds it again by ident (`p1: <name>`) plus details
 * (`Landorus-Therian, M, shiny`). The replay spells both its own way (the
 * player's nickname, the game's level, gender and shiny flags), and since
 * round 72 (T238) the built sets carry them, so the simulator writes the
 * replay's own switch lines and the frame needs no translation. Before, a
 * simulator switch-in met no roster entry: the body became a second entry,
 * the second entry fainted, and the sidebar (one icon per species, the first
 * entry wins) kept showing the first one alive.
 * The scene of the report is smogtours-gen7ou-450650: branch at turn 17 with
 * Stone Edge for Landorus-Therian, played to the end.
 */

const fixture = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf-8')) as ReplayData;

type LiveBattle = NonNullable<BranchRuntime['battleStream']['battle']>;
type BranchSide = 'p1' | 'p2';

/** One side's plain choices: a forced replacement takes the next healthy bench body, else the strongest enabled move. */
function sideCommand(battle: LiveBattle, side: BranchSide, opening: BranchSlotChoice | null): string | null {
  const state = battle.sides[side === 'p1' ? 0 : 1];
  const forced = state.active.map((_, slot) => state.activeRequest?.forceSwitch?.[slot] ?? false);
  const required = requiredChoicesForActiveSlots(state.active, forced);
  if (!required.some(Boolean)) return null;
  const taken = new Set<number>();
  const choices = state.active.map((active, slot): BranchSlotChoice | null => {
    if (!required[slot] || !active) return null;
    if (forced[slot]) {
      const benchIndex = state.pokemon.findIndex((body, index) => !body.isActive && !body.fainted && !taken.has(index));
      if (benchIndex < 0) {
        required[slot] = false; // fewer bench bodies than fainted slots: the sim takes a pass
        return null;
      }
      taken.add(benchIndex);
      const bench = state.pokemon[benchIndex];
      return { kind: 'switch', speciesId: toId(bench.species.name), pokemonName: bench.name };
    }
    if (opening && slot === 0) return opening;
    const moves = active.getMoveRequestData().moves.filter(move => !move.disabled);
    const strongest = moves.reduce((best, move) =>
      battle.dex.moves.get(move.id).basePower > battle.dex.moves.get(best.id).basePower ? move : best, moves[0]);
    return { kind: 'move', moveId: strongest.id, moveName: strongest.move };
  });
  const resolved = resolveSideChoices(battle, side, choices, required);
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.command;
}

interface PlayedBranch {
  frameLog: string;
  /** The simulator's bodies at the end of the line, as the pickers read them. */
  bodies: Record<BranchSide, { name: string; species: string; fainted: boolean }[]>;
  fainted: { atStart: number; atEnd: number };
}

/** The app's branch path in Node: reconstruct to the turn, play both sides with a plain policy, hand the log to the frame. */
async function playBranch(
  replay: ReplayData, branchTurn: number,
  options: { edit?: (p1Team: ReturnType<typeof buildTeamsFromReplay>['p1Team']) => void; opening?: BranchSlotChoice } = {},
): Promise<PlayedBranch> {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  options.edit?.(p1Team);
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn: branchTurn, snapshot: snapshotFor(branchTurn), playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: { snapshotFor, onPosition: () => {} },
  });
  const battle = runtime.battleStream.battle!;
  const faintedCount = () => battle.sides.reduce((sum, side) => sum + side.pokemon.filter(body => body.fainted).length, 0);
  const atStart = faintedCount();
  for (let executed = 0; !battle.ended && executed < 80; executed++) {
    // A forced replacement is answered alone (the app's forced interlude); otherwise both sides move.
    const replacing = (['p1', 'p2'] as const).filter(side =>
      battle.sides[side === 'p1' ? 0 : 1].activeRequest?.forceSwitch?.some(Boolean));
    const commands = (replacing.length > 0 ? replacing : (['p1', 'p2'] as const)).flatMap(side => {
      const command = sideCommand(battle, side, executed === 0 && side === 'p1' ? options.opening ?? null : null);
      return command ? [{ side, command }] : [];
    });
    expect(commands.length, `a choice is open at turn ${battle.turn}`).toBeGreaterThan(0);
    const result = await executeBranchChoices({ streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands });
    expect(result.ok, `turn ${battle.turn}: ${commands.map(c => `${c.side} ${c.command}`).join(' | ')}`).toBe(true);
  }
  const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
  return {
    frameLog: branchFrameLog(state.log),
    bodies: { p1: state.p1Pokemon, p2: state.p2Pokemon },
    fainted: { atStart, atEnd: faintedCount() },
  };
}

/** The embed's roster per side after it has read the log (@pkmn/client ports the embed's Side and Pokemon). */
function embedRoster(replay: ReplayData, frameLog: string) {
  const battle = new Battle(generationsFor(replay.format));
  for (const line of frameLog.split('\n')) battle.add(line);
  return [battle.p1, battle.p2].map(side => side.team.map(body => ({
    ident: body.ident, base: speciesBaseId(body.speciesForme), fainted: body.fainted,
  })));
}

/** One roster entry per species, and every body the line fainted is fainted in the roster. */
function expectRosterMatchesLine(replay: ReplayData, played: PlayedBranch) {
  const rosters = embedRoster(replay, played.frameLog);
  (['p1', 'p2'] as const).forEach((side, index) => {
    const roster = rosters[index];
    const bases = roster.map(entry => entry.base);
    expect(bases.length, `${side} roster ${roster.map(entry => entry.ident).join(', ')}`).toBe(new Set(bases).size);
    for (const body of played.bodies[side]) {
      const entry = roster.find(candidate => candidate.base === speciesBaseId(body.species));
      if (entry) expect(entry.fainted, `${side} ${entry.ident} (sim: ${body.name})`).toBe(body.fainted);
    }
  });
}

describe('the sidebar of a played-out branch', () => {
  test('450650 turn 17, Stone Edge for Landorus-Therian (the report): every fainted body is fainted in the roster', { timeout: 120000 }, async () => {
    const replay = fixture('./fixtures/smogtours-gen7ou-450650.json');
    const played = await playBranch(replay, 17, {
      // The guessed fourth move (Stealth Rock) makes room for the user's Stone Edge.
      edit: p1Team => {
        const lando = p1Team.find(set => set.species === 'Landorus-Therian')!;
        lando.moves = [...lando.moves.filter(move => move !== 'Stealth Rock').slice(0, 3), 'Stone Edge'];
      },
      opening: { kind: 'move', moveId: 'stoneedge', moveName: 'Stone Edge' },
    });
    // The scene needs bodies that fainted in the branch, nicknamed ones among them.
    expect(played.fainted.atEnd - played.fainted.atStart).toBeGreaterThanOrEqual(3);
    expectRosterMatchesLine(replay, played);
  });

  test.each([
    ['gen 6 OU 653785 turn 10, shiny bodies (the log says "Klefki, M, shiny", the simulator "Klefki, M")', '../packages/eval-engine/test/fixtures/smogtours-gen6ou-653785.json', 10],
    ['draft league gpl turn 15, nicknames and level 50 (the log shows no gender, the simulator one)', '../packages/eval-engine/test/fixtures/gpl-replay.json', 15],
    ['doubles OU 912884 turn 6, nicknames and a shiny', '../packages/eval-engine/test/fixtures/smogtours-gen9doublesou-912884.json', 6],
    ['doubles OU 2663093831 turn 6, nicknames', '../e2e-feedback/fixtures/gen9doublesou-2663093831.json', 6],
    ['VGC 2630685175 turn 5, nicknames and shiny, level 50 with four brought', '../e2e-feedback/fixtures/gen9vgc2026regi-2630685175.json', 5],
    ['Champions VGC 2695803506 turn 2, shiny, level 50 with four brought', '../e2e-feedback/fixtures/gen9championsvgc2026regmc-2695803506.json', 2],
  ] as const)('%s', { timeout: 120000 }, async (_scene, path, turn) => {
    const replay = fixture(path);
    const played = await playBranch(replay, turn);
    expect(played.fainted.atEnd - played.fainted.atStart).toBeGreaterThanOrEqual(2);
    expectRosterMatchesLine(replay, played);
  });
});

describe('branchFrameLog', () => {
  test('drops what the embed must not show: chat, spectator splits and the simulator debug lines', () => {
    const lines = ['|switch|p1a: NOT ICT|Landorus-Therian, M, shiny|100/100', '|c|Alice|gg', '|split|p1', '|debug|noise', '', '|move|p1a: NOT ICT|Earthquake|p2a: Chomp'];
    expect(branchFrameLog(lines)).toBe('|switch|p1a: NOT ICT|Landorus-Therian, M, shiny|100/100\n|move|p1a: NOT ICT|Earthquake|p2a: Chomp');
  });

  test('plays every other line as the simulator wrote it: the built sets carry the replay names and flags', () => {
    const lines = ['|-heal|p1: Rotom|50/100|[from] move: Revival Blessing', '|-damage|p2a: Chomp|0 fnt|[from] item: Rocky Helmet|[of] p1a: LUSCH', '|-sidestart|p1: Alice|move: Stealth Rock'];
    expect(branchFrameLog(lines)).toBe(lines.join('\n'));
  });
});
