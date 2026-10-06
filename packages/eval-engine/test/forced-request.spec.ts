import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { collectForcedSwitchSpecies, parseTurnBlocks } from '../src/branch/protocol-choices';

/**
 * Round 64 (T121, step G4): every switch the protocol shows that answers a
 * forced request goes to the sim as that answer. Older logs (gen 6 and 8,
 * 2022) write a U-turn's, Volt Switch's or Flip Turn's switch without
 * `[from]`, after the slot's own move; gens 1 to 4 replace a fainted body
 * before upkeep. Before, the forced list skipped both and the sim brought
 * its first free body (653785 t5: Weavile instead of Excadrill, so Bisharp's
 * Knock Off took Weavile's Choice Band), and a body knocked out before it
 * acted had its replacement sent as the turn's choice (gen 3: Gengar came
 * in at turn start and took the Hidden Power meant for Blastoise).
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;
const block = (replay: Replay, turn: number) => parseTurnBlocks(replay.log).turns.find(entry => entry.turn === turn)!;

describe('the forced list reads every answered request', () => {
  test('an old-protocol pivot and a gen 3 faint replacement join the forced list', () => {
    const pivot = block(fixture('smogtours-gen6ou-653785.json'), 5);
    expect(collectForcedSwitchSpecies(pivot.preUpkeep, pivot.postUpkeep, 'p1')).toEqual(['Excadrill']);
    const explosion = block(fixture('gen3customgame-2115579570.json'), 8);
    expect(collectForcedSwitchSpecies(explosion.preUpkeep, explosion.postUpkeep, 'p1')).toEqual(['Charizard']);
    expect(collectForcedSwitchSpecies(explosion.preUpkeep, explosion.postUpkeep, 'p2')).toEqual(['Electabuzz']);
    const knockedOut = block(fixture('gen3customgame-2115579570.json'), 4);
    expect(collectForcedSwitchSpecies(knockedOut.preUpkeep, knockedOut.postUpkeep, 'p1')).toEqual(['Gengar']);
  });

  test('doubles: a pivot on one slot leaves the partner\'s chosen switch alone', () => {
    const lines = [
      '|switch|p1a: Ferrothorn|Ferrothorn, M|100/100',
      '|move|p1b: Scizor|U-turn|p2a: Snorlax',
      '|-damage|p2a: Snorlax|80/100',
      '|switch|p1b: Heatran|Heatran, M|100/100',
    ];
    expect(collectForcedSwitchSpecies(lines, [], 'p1')).toEqual(['Heatran']);
  });

  test('a chosen switch that Pursuit hits on the way out stays the side\'s choice', () => {
    const lines = [
      '|-activate|p1a: Latias|move: Pursuit',
      '|move|p2a: Weavile|Pursuit|p1a: Latias|[from]Pursuit',
      '|-damage|p1a: Latias|60/100',
      '|switch|p1a: Ferrothorn|Ferrothorn, M|352/352',
    ];
    expect(collectForcedSwitchSpecies(lines, [], 'p1')).toEqual([]);
  });
});

/** The sim's own public log of the block that ends at `|turn|boundary`. */
function simBlock(battle: Battle, boundary: number): string[] {
  const log = battle.log;
  const end = log.lastIndexOf(`|turn|${boundary}`);
  const start = log.lastIndexOf(`|turn|${boundary - 1}`, end);
  return log.slice(start + 1, end).filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));
}

/** Species of every switch-in on `slot` in the block, in order. */
const switchIns = (lines: string[], slot: string) =>
  lines.filter(line => line.startsWith(`|switch|${slot}:`)).map(line => line.split('|')[3].split(',')[0].trim());

async function boundaries<T>(replay: Replay, teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }, turns: number[], read: (battle: Battle) => T) {
  const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), ...teams, replayLog: replay.log,
    targetTurn, snapshot: snapshotFor(targetTurn),
    choiceLocks: buildChoiceLockContext(replay.log, teams, observations),
    capturePositions: {
      snapshotFor,
      onPosition: (turn, battle) => {
        if (turns.includes(turn) && !seen.has(turn)) seen.set(turn, read(battle));
      },
    },
  });
  return { runtime, seen };
}

function builtTeams(replay: Replay) {
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  return buildTeamsFromReplay(replay.log, { observations, speedOrders });
}

describe('the sim brings the body the protocol shows (round 64, T121 step G4)', () => {
  test('653785: Tornadus\'s U-turn brings Excadrill, and the Knock Off lands on Excadrill', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen6ou-653785.json');
    const { seen } = await boundaries(replay, builtTeams(replay), [6], battle => {
      const lines = simBlock(battle, 6);
      return {
        pivot: switchIns(lines, 'p1a'),
        knocked: lines.find(line => line.includes('[from] move: Knock Off'))?.split('|')[2].split(': ')[1] ?? null,
      };
    });
    expect(seen.get(6)?.pivot).toEqual(['Excadrill']);
    expect(seen.get(6)?.knocked).toBe(builtTeams(replay).p1Team.find(set => set.species === 'Excadrill')!.name);
  });

  test('gen 3: a body knocked out before it acts is replaced before upkeep, not at turn start', { timeout: 240000 }, async () => {
    // Turn 4: Hidden Power knocks Blastoise out, Gengar replaces it. Turn 8:
    // Explosion takes both actives, Charizard and Electabuzz replace them.
    const replay = fixture('gen3customgame-2115579570.json');
    const { seen } = await boundaries(replay, builtTeams(replay), [5, 9], battle => {
      const lines = simBlock(battle, battle.turn);
      return { p1: switchIns(lines, 'p1a'), p2: switchIns(lines, 'p2a'), fainted: lines.filter(line => line.startsWith('|faint|')).length };
    });
    expect(seen.get(5)).toEqual({ p1: ['Gengar'], p2: [], fainted: 1 });
    expect(seen.get(9)).toEqual({ p1: ['Charizard'], p2: ['Electabuzz'], fainted: 2 });
  });

  test('doubles: an old-protocol U-turn on p1b brings the body the protocol names, not the first free one', async () => {
    const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    const mon = (species: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
      name: species, species, item: '', ability, moves, nature: 'Serious',
      evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs, level: 100,
    });
    const lines = [
      '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|8', '|tier|[Gen 8] Doubles OU',
      '|poke|p1|Blissey, F|', '|poke|p1|Scizor, M|', '|poke|p1|Snorlax, M|', '|poke|p1|Heatran, M|',
      '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p1b: Scizor|Scizor, M|100/100',
      '|switch|p2a: Chansey|Chansey, F|100/100',
      '|switch|p2b: Happiny|Happiny, F|100/100',
      '|turn|1',
      '|move|p1b: Scizor|U-turn|p2a: Chansey',
      '|-damage|p2a: Chansey|90/100',
      '|switch|p1b: Heatran|Heatran, M|100/100',
      '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
      '|-damage|p2b: Happiny|80/100',
      '|move|p2a: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|85/100',
      '|move|p2b: Happiny|Pound|p1a: Blissey',
      '|-damage|p1a: Blissey|84/100',
      '|upkeep',
      '|turn|2',
    ];
    const replay = { id: 'synthetic-gen8-doubles-pivot', format: 'gen8doublesou', formatid: 'gen8doublesou', players: ['Alice', 'Bob'], log: lines.join('\n') };
    const teams = {
      p1Team: [
        mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled']), mon('Scizor', 'Technician', ['U-turn', 'Bullet Punch'], 252),
        mon('Snorlax', 'Immunity', ['Body Slam']), mon('Heatran', 'Flash Fire', ['Lava Plume']),
      ],
      p2Team: [mon('Chansey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled']), mon('Happiny', 'Natural Cure', ['Pound', 'Seismic Toss'])],
    };
    const { runtime, seen } = await boundaries(replay, teams, [2], battle => switchIns(simBlock(battle, 2), 'p1b'));
    expect(runtime.choiceErrors.count).toBe(0);
    expect(seen.get(2)).toEqual(['Heatran']);
  });
});
