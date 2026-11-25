import { describe, expect, test, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  broughtSpeciesFor, buildTeamsFromReplay, getBranchSimulatorFormat, getReplayBringCount, parseReplayLog, replayBringList, replayBringOnly,
  replayRules, speciesBaseId, type ReplayData, type TurnSnapshot,
} from '@fulllifegames/replay-core';
import {
  BRING_WORLD_CAP, bringWorlds, createBranchStateFromBattle, loadSimMods, reconstructBranchRuntime, serializeLiveBattle, type BringWorld,
} from '@fulllifegames/eval-engine';
import type { BranchSimState, BranchSwitchOption } from '@fulllifegames/eval-engine';
import { pickerStateFromSerialized, pickerStateFromSnapshot } from '../../src/lib/picker-state';
import { limitBench, replayBench, type Bench } from '../../src/lib/bench';
import { dockReplays } from '../e2e/helpers';

// Oracle: the log. A full side offers its fielded bodies, a short side those plus the heaviest world's guess.
// The corpus rows skip without `.fit-corpus` and `.calibration/replays`.

const ROOT = process.cwd();
const FIT = join(ROOT, '.fit-corpus');
const CAL = join(ROOT, '.calibration', 'replays');
const HAVE_CORPUS = existsSync(FIT) && existsSync(CAL);

type Family = 'Champions VGC bo1' | 'Champions VGC bo3' | 'VGC SV' | 'BSS';
const familyOf = (formatid: string): Family | null => {
  if (/championsvgc/.test(formatid)) return /bo3/.test(formatid) ? 'Champions VGC bo3' : 'Champions VGC bo1';
  if (/vgc/.test(formatid)) return 'VGC SV';
  if (/battlestadium/.test(formatid)) return 'BSS';
  return null;
};

const baseIds = (names: string[], rules: ReturnType<typeof replayRules>) => new Set(names.map(name => speciesBaseId(name, rules)));

interface Game { id: string; source: ReplayData; family: Family; snapshots: TurnSnapshot[]; fielded: { p1: string[]; p2: string[] }; count: number }

function readGame(source: ReplayData): Game | null {
  const family = familyOf(source.formatid ?? source.id);
  if (!family) return null;
  const count = getReplayBringCount(source);
  if (count === null) return null;
  const snapshots = parseReplayLog(source.log);
  const rules = replayRules(source);
  return { id: source.id, source, family, snapshots, count, fielded: { p1: broughtSpeciesFor(snapshots, 'p1', rules), p2: broughtSpeciesFor(snapshots, 'p2', rules) } };
}

function appReading(game: Game): { world: BringWorld | undefined; bringOnly: { p1: string[]; p2: string[]; guessed?: BringWorld['guessed'] } | null } {
  const list = replayBringList(game.source, game.snapshots);
  const short = !!list && (list.p1.open > 0 || list.p2.open > 0);
  const world = short ? bringWorlds(list, BRING_WORLD_CAP)?.[0] : undefined;
  return { world, bringOnly: world ? { p1: world.p1, p2: world.p2, guessed: world.guessed } : replayBringOnly(game.source, game.snapshots) };
}

const fullSides = (game: Game) => (['p1', 'p2'] as const).filter(side => game.fielded[side].length === game.count);
const isOpen = (game: Game) => fullSides(game).length < 2;

function loadGames(): Game[] {
  const games: Game[] = [];
  const read = (dir: string, name: string) => {
    const json = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ReplayData;
    if (typeof json?.log !== 'string') return;
    const id = String(json.id ?? name.replace(/\.json$/, ''));
    const formatid = json.formatid ?? id.replace(/-\d.*$/, '');
    const game = readGame({ ...json, id, formatid });
    if (game) games.push(game);
  };
  for (const name of readdirSync(FIT)) if (/(vgc|battlestadium).*\.json$/.test(name) && !name.startsWith('samples-cache')) read(FIT, name);
  for (const name of readdirSync(CAL)) if (/(vgc|battlestadium).*\.json$/.test(name)) read(CAL, name);
  return games;
}

const BSS_MONS = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];
const BSS_LOG = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|singles', '|gen|9', '|tier|[Gen 9] Battle Stadium Singles Regulation H',
  ...BSS_MONS.map(mon => `|poke|p1|${mon}, L50|`), ...BSS_MONS.map(mon => `|poke|p2|${mon}, L50|`), '|teampreview|3', '|start',
  '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|switch|p2a: Kingambit|Kingambit, L50|100/100', '|turn|1',
  '|switch|p1a: Gholdengo|Gholdengo, L50|100/100', '|switch|p2a: Dragonite|Dragonite, L50|100/100', '|turn|2',
  '|switch|p2a: Corviknight|Corviknight, L50|100/100', '|turn|3', '|win|Alice',
].join('\n');
const BSS = { id: 'synthetic-bss', formatid: 'gen9battlestadiumsinglesregh', format: '[Gen 9] Battle Stadium Singles Regulation H', players: ['Alice', 'Bob'], log: BSS_LOG } as ReplayData;

const switchSpecies = (state: BranchSimState, side: 'p1' | 'p2') =>
  (side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot).flat().map(option => option.species);

function benchProblems(game: Game, label: string, shown: BranchSimState, world: BringWorld | undefined): string[] {
  const problems: string[] = [];
  const rules = replayRules(game.source);
  for (const side of ['p1', 'p2'] as const) {
    const allowed = baseIds(world ? world[side] : game.fielded[side], rules);
    if (game.fielded[side].length !== game.count && !world) continue;
    const stray = switchSpecies(shown, side).filter(species => !allowed.has(speciesBaseId(species, rules)));
    if (stray.length > 0) problems.push(`${game.id} ${label} ${side}: bench offers ${[...new Set(stray)].join(', ')}`);
  }
  return problems;
}

function snapshotPicker(game: Game, snapshot: TurnSnapshot, bench: Bench | null) {
  return pickerStateFromSnapshot(snapshot, [], [], 9, bench?.lists ?? null, { format: getBranchSimulatorFormat(game.source) });
}

function snapshotProblems(game: Game): string[] {
  const { world } = appReading(game);
  const bench = replayBench(game.source, game.snapshots, world);
  const problems: string[] = [];
  for (let index = 0; index < game.snapshots.length; index += Math.max(1, Math.floor(game.snapshots.length / 4))) {
    const snapshot = game.snapshots[index];
    problems.push(...benchProblems(game, `snapshot t${snapshot.turn}`, snapshotPicker(game, snapshot, bench), world));
  }
  return problems;
}

async function battleProblems(game: Game, targetTurn: number): Promise<string[]> {
  await loadSimMods(getBranchSimulatorFormat(game.source));
  const { p1Team, p2Team } = buildTeamsFromReplay(game.source.log);
  const { world, bringOnly } = appReading(game);
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(game.source), p1Team, p2Team, replayLog: game.source.log, targetTurn,
    snapshot: game.snapshots[Math.min(targetTurn - 1, game.snapshots.length - 1)] ?? null,
    bringOnly: bringOnly ?? undefined,
  });
  const battle = runtime.battleStream.battle!;
  const bench = replayBench(game.source, game.snapshots, world);
  const live = createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
  const problems = benchProblems(game, `live t${targetTurn}`, limitBench(live, bench), world);
  const serialized = serializeLiveBattle(battle);
  problems.push(...benchProblems(game, `stored t${targetTurn}`, await pickerStateFromSerialized(serialized, bench), world));
  return problems;
}

beforeAll(async () => {
  await loadSimMods('gen9championsvgc2026regma');
});

describe('the scenes of the issue', () => {
  const byId = (id: string) => dockReplays.find(replay => replay.id === id)!;

  test('Champions VGC 2625939941: P1 fielded three bodies, so it offers them and the guess, and P2 offers its four', () => {
    const replay = byId('gen9championsvgc2026regma-2625939941');
    const game = readGame(replay)!;
    const snapshots = game.snapshots;
    expect(replayBringOnly(replay, snapshots)).toBeNull();
    const { world } = appReading(game);
    expect(world?.guessed).toEqual({ p1: 1, p2: 0 });
    const bench = replayBench(replay, snapshots, world);
    expect(bench?.lists.p1).toEqual(world!.p1);
    expect(bench?.lists.p1.slice(0, 3).sort()).toEqual(['Basculegion', 'Farigiraf', 'Lopunny']);
    expect(['Ceruledge', 'Kingambit', 'Ninetales-Alola']).toContain(bench?.lists.p1[3]);
    expect([...(bench?.lists.p2 ?? [])].sort()).toEqual(['Aerodactyl', 'Farigiraf', 'Kingambit', 'Sylveon']);
    const picker = snapshotPicker(game, snapshots[0], bench);
    expect([...new Set(picker.p2SwitchesBySlot.flat().map(option => option.species))].sort()).toEqual(['Farigiraf', 'Sylveon']);
    const offered = new Set(picker.p1SwitchesBySlot.flat().map(option => option.species));
    for (const species of offered) expect(world!.p1, species).toContain(species);
  });

  test('a game that pins both sides keeps the lists of replayBringOnly', () => {
    const replay = byId('gen9championsvgc2026regma-2623421463');
    const snapshots = parseReplayLog(replay.log);
    expect(replayBench(replay, snapshots)?.lists).toEqual(replayBringOnly(replay, snapshots));
  });

  test('a game of a bring-all format has no bench lists', () => {
    const replay = dockReplays.find(entry => /doublesou/.test(entry.id))!;
    expect(replayBench(replay, parseReplayLog(replay.log))).toBeNull();
  });

  test('Battle Stadium Singles: P1 fielded two of three, so it offers them and the guess, and P2 offers its three', async () => {
    const game = readGame(BSS)!;
    expect(game.fielded.p1).toHaveLength(2);
    const { world } = appReading(game);
    expect(world?.guessed).toEqual({ p1: 1, p2: 0 });
    const bench = replayBench(BSS, game.snapshots, world);
    expect(bench?.lists.p1).toEqual(['Garchomp', 'Gholdengo', 'Kingambit']);
    expect([...(bench?.lists.p2 ?? [])].sort()).toEqual(['Corviknight', 'Dragonite', 'Kingambit']);
    expect(snapshotProblems(game)).toEqual([]);
    expect(await battleProblems(game, 1)).toEqual([]);
    expect(await battleProblems(game, 3)).toEqual([]);
  });
});

describe.skipIf(!HAVE_CORPUS)('every bring-limited game of the corpus', () => {
  let games: Game[] = [];
  beforeAll(() => {
    games = loadGames();
  }, 120_000);
  const FAMILIES: Family[] = ['Champions VGC bo1', 'Champions VGC bo3', 'VGC SV'];
  const open = (family: Family) => games.filter(game => game.family === family && isOpen(game) && fullSides(game).length === 1);

  test('the sweep reads each family and finds open games with one full side', () => {
    for (const family of FAMILIES) expect(open(family).length, family).toBeGreaterThan(20);
    expect(games.find(game => game.id.includes('2630452654'))).toBeDefined();
  });

  test('the lists equal replayBringOnly wherever it pins, and name the fielded bodies and the guess elsewhere', () => {
    const problems: string[] = [];
    for (const game of games) {
      const { world } = appReading(game);
      const bench = replayBench(game.source, game.snapshots, world);
      const pinned = replayBringOnly(game.source, game.snapshots);
      if (pinned) {
        if (JSON.stringify(bench?.lists) !== JSON.stringify(pinned)) problems.push(`${game.id}: pinned lists differ`);
        continue;
      }
      if (!world) continue;
      for (const side of ['p1', 'p2'] as const) {
        const want = world[side].slice(0, game.fielded[side].length);
        if (JSON.stringify(want) !== JSON.stringify(game.fielded[side])) problems.push(`${game.id} ${side}: world ${JSON.stringify(world[side])} lacks the fielded bodies`);
        if (JSON.stringify(bench?.lists[side]) !== JSON.stringify(world[side])) problems.push(`${game.id} ${side}: list ${JSON.stringify(bench?.lists[side])}`);
        if (world[side].length !== game.count) problems.push(`${game.id} ${side}: ${world[side].length} bodies of ${game.count}`);
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  for (const family of FAMILIES) {
    test(`${family}: the snapshot pickers of every open game with a full side offer no unbrought body`, () => {
      const problems: string[] = [];
      const sample = open(family).filter((_, index) => index % 4 === 0);
      for (const game of sample) problems.push(...snapshotProblems(game));
      expect(problems.slice(0, 10)).toEqual([]);
    }, 240_000);

    test(`${family}: the live What-if and the stored positions of open games offer no unbrought body`, async () => {
      const problems: string[] = [];
      const wanted = open(family).filter((_, index) => index % 12 === 0).slice(0, 14);
      const named = games.filter(game => game.family === family && /2625939941|2630452654/.test(game.id));
      for (const game of [...new Set([...named, ...wanted])]) {
        problems.push(...await battleProblems(game, 1));
        problems.push(...await battleProblems(game, Math.max(2, Math.ceil(game.snapshots.length / 2))));
      }
      expect(problems.slice(0, 10)).toEqual([]);
    }, 280_000);
  }
});

const option = (species: string, slot: number): BranchSwitchOption => ({ name: species, species, activeSlot: 0, slot, hp: '100/100', hpPercent: 100, fainted: false });

function stateWith(bench: BranchSwitchOption[], slots: number, forced: boolean[] = []): BranchSimState {
  const bySlot = Array.from({ length: slots }, () => bench.map(entry => ({ ...entry })));
  return {
    p1Switches: bySlot[0], p1SwitchesBySlot: bySlot, p2Switches: bySlot[0], p2SwitchesBySlot: bySlot,
    p1ForceSwitch: forced.some(Boolean), p1ForceSwitches: forced, p2ForceSwitch: false, p2ForceSwitches: [],
  } as unknown as BranchSimState;
}

describe('limitBench on a state', () => {
  const rules = { gen: 9 };
  const bench: Bench = { lists: { p1: ['Garchomp', 'Gholdengo'], p2: [] }, rules };
  const options = [option('Garchomp', 2), option('Kingambit', 3), option('Gholdengo', 4), option('Dragonite', 5)];

  test.each([['singles', 1], ['doubles', 2]])('%s: drops the unbrought options of a full side, keeps the slot numbers, leaves a short side whole', (_, slots) => {
    const state = limitBench(stateWith(options, slots), bench);
    expect(state.p1SwitchesBySlot).toHaveLength(slots);
    for (const list of state.p1SwitchesBySlot) expect(list.map(entry => [entry.species, entry.slot])).toEqual([['Garchomp', 2], ['Gholdengo', 4]]);
    expect(state.p1Switches).toEqual(state.p1SwitchesBySlot[0]);
    expect(state.p2SwitchesBySlot.flat()).toHaveLength(4 * slots);
  });

  test('a null bench and a state with nothing to drop come back as the same object', () => {
    const state = stateWith(options, 2);
    expect(limitBench(state, null)).toBe(state);
    const brought = stateWith([option('Garchomp', 2), option('Gholdengo', 3)], 2);
    expect(limitBench(brought, bench)).toBe(brought);
  });

  test('a forced replacement that would be left with no body keeps its options, so the game does not stall', () => {
    const unbrought = [option('Kingambit', 3), option('Dragonite', 5)];
    const state = limitBench(stateWith(unbrought, 2, [true, false]), bench);
    expect(state.p1SwitchesBySlot[0].map(entry => entry.species)).toEqual(['Kingambit', 'Dragonite']);
    expect(state.p1SwitchesBySlot[1]).toEqual([]);
  });
});
