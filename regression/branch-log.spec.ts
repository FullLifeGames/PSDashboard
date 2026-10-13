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
 * player's nickname, the game's level, gender and shiny flags); the simulator
 * spells them with the name of its built set (the base species) and the flags
 * of that set. A simulator switch-in therefore met no roster entry: the body
 * became a second entry, the second entry fainted, and the sidebar (one icon
 * per species, the first entry wins) kept showing the first one alive.
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
    frameLog: branchFrameLog(state.log, replay.log, { p1: state.p1Pokemon, p2: state.p2Pokemon }),
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

/** A replay of two players, one nicknamed body each on the field at its turn 2, and two more that come in after it. */
const REPLAY = [
  '|player|p1|Alice|1|', '|player|p2|Bob|2|', '|teamsize|p1|2', '|teamsize|p2|2', '|gametype|singles', '|gen|9',
  '|poke|p1|Landorus-Therian, M|', '|poke|p1|Rotom-Wash|', '|poke|p2|Garchomp, F, shiny|', '|poke|p2|Mawile, F|',
  '|start',
  '|switch|p1a: NOT ICT|Landorus-Therian, M|100/100', '|switch|p2a: Chomp|Garchomp, F, shiny|100/100', '|turn|1',
  '|move|p1a: NOT ICT|Earthquake|p2a: Chomp', '|-damage|p2a: Chomp|40/100', '|move|p2a: Chomp|Earthquake|p1a: NOT ICT',
  '|-damage|p1a: NOT ICT|60/100', '|upkeep', '|turn|2',
  '|switch|p1a: LUSCH|Rotom-Wash|100/100', '|switch|p2a: Mawile Man|Mawile-Mega, F|100/100', '|turn|3',
].join('\n');
/** The simulator's bodies: named for their base species, as the team builder's sets are. */
const BODIES = {
  p1: [{ name: 'Landorus', species: 'Landorus-Therian' }, { name: 'Rotom', species: 'Rotom-Wash' }],
  p2: [{ name: 'Garchomp', species: 'Garchomp' }, { name: 'Mawile', species: 'Mawile' }],
};

/** The frame lines of a branch from turn 2 whose simulator appended these lines. */
function frame(appended: string[], bodies = BODIES, replay = REPLAY): string[] {
  const lines = replay.split('\n');
  const prefix = lines.slice(0, lines.indexOf('|turn|2') + 1);
  return branchFrameLog([...prefix, ...appended], replay, bodies).split('\n').slice(prefix.length);
}

describe('branchFrameLog', () => {
  test('puts the replay nickname on every ident of the simulator lines, in every field', () => {
    expect(frame([
      '|switch|p1a: Rotom|Rotom-Wash|90/100',
      '|move|p1a: Rotom|Hydro Pump|p2a: Garchomp',
      '|-damage|p2a: Garchomp|0 fnt|[from] item: Rocky Helmet|[of] p1a: Rotom',
      '|faint|p2a: Garchomp',
    ])).toEqual([
      '|switch|p1a: LUSCH|Rotom-Wash|90/100',
      '|move|p1a: LUSCH|Hydro Pump|p2a: Chomp',
      '|-damage|p2a: Chomp|0 fnt|[from] item: Rocky Helmet|[of] p1a: LUSCH',
      '|faint|p2a: Chomp',
    ]);
  });

  test('leaves the replay own lines, the player idents and unknown names alone', () => {
    expect(branchFrameLog(REPLAY.split('\n'), REPLAY, BODIES)).toBe(REPLAY);
    const lines = ['|-sidestart|p1: Landorus|move: Stealth Rock', '|-damage|p1a: Gliscor|50/100', '|-fieldstart|move: Misty Terrain'];
    expect(frame(lines)).toEqual(lines);
  });

  test('names a body that is not on the field: a revival heal and the Wish healer', () => {
    expect(frame([
      '|-heal|p1: Rotom|50/100|[from] move: Revival Blessing',
      '|-heal|p2a: Garchomp|100/100|[from] move: Wish|[wisher] Garchomp',
    ])).toEqual([
      '|-heal|p1: LUSCH|50/100|[from] move: Revival Blessing',
      '|-heal|p2a: Chomp|100/100|[from] move: Wish|[wisher] Chomp',
    ]);
  });

  test('gives a switch-in and a forme change the replay level, gender and shiny flags', () => {
    expect(frame([
      '|switch|p2a: Garchomp|Garchomp, M|100/100',
      '|detailschange|p2a: Mawile|Mawile-Mega, M',
      '|switch|p2a: Mawile|Mawile-Mega, L50, M, tera:Steel|100/100',
    ])).toEqual([
      '|switch|p2a: Chomp|Garchomp, F, shiny|100/100',
      '|detailschange|p2a: Mawile Man|Mawile-Mega, F',
      '|switch|p2a: Mawile Man|Mawile-Mega, F, tera:Steel|100/100',
    ]);
  });

  test('speaks the replay flags where the simulator name already is the nickname', () => {
    const replay = REPLAY.replaceAll('p2a: Chomp', 'p2a: Garchomp');
    expect(frame(['|switch|p2a: Garchomp|Garchomp, M|100/100'], BODIES, replay)).toEqual(['|switch|p2a: Garchomp|Garchomp, F, shiny|100/100']);
  });

  test('keeps the simulator name where the line cannot say which body it means', () => {
    // Two nicknames for one species (a Custom Game with a pair), and a body no switch line ever showed.
    const pair = REPLAY.replace('|turn|3', '|switch|p1a: LUSCH 2|Rotom-Wash|100/100\n|turn|3');
    expect(frame(['|move|p1a: Rotom|Hydro Pump|p2a: Garchomp'], BODIES, pair)).toEqual(['|move|p1a: Rotom|Hydro Pump|p2a: Chomp']);
    const unseen = { ...BODIES, p1: [...BODIES.p1, { name: 'Gliscor', species: 'Gliscor' }] };
    expect(frame(['|move|p1a: Gliscor|Earthquake|p2a: Garchomp'], unseen)).toEqual(['|move|p1a: Gliscor|Earthquake|p2a: Chomp']);
  });

  test('renames in one pass: two bodies whose nicknames are each other simulator names', () => {
    const swapped = REPLAY.replaceAll('NOT ICT', 'Rotom').replaceAll('LUSCH', 'Landorus');
    expect(frame(['|move|p1a: Landorus|Earthquake|p2a: Garchomp', '|move|p1a: Rotom|Hydro Pump|p2a: Garchomp'], BODIES, swapped))
      .toEqual(['|move|p1a: Rotom|Earthquake|p2a: Chomp', '|move|p1a: Landorus|Hydro Pump|p2a: Chomp']);
  });

  test('names doubles slots by their own letters and still drops chat, splits and debug lines', () => {
    const doubles = REPLAY.replace('|gametype|singles', '|gametype|doubles').replace('|switch|p1a: LUSCH|', '|switch|p1b: LUSCH|');
    expect(frame([
      '|c|Alice|gg', '|split|p1', '|debug|noise', '|switch|p1b: Rotom|Rotom-Wash|50/100', '|-boost|p1b: Rotom|spa|1',
    ], BODIES, doubles)).toEqual(['|switch|p1b: LUSCH|Rotom-Wash|50/100', '|-boost|p1b: LUSCH|spa|1']);
  });
});
