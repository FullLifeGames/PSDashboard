import { readFileSync } from 'node:fs';
import { test, expect, describe } from 'vitest';
import { createBranchState, reconstructBranchRuntime, serializePreviewPosition } from '../src/branch-engine';
import { trimTeamToBring, trimTeamsToBring } from '../src/branch/team-order';
import { BRING_WORLD_CAP, bringWorlds, type BringWorld } from '../src/branch/bring-worlds';
import { loadSimMods } from '../src/forward/sim-mods';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, getReplayBringCount, parseReplayLog, replayBringList, replayBringOnly, replayRules,
  parseReplayLogWithObservations, speciesBaseId, type ReplayData, type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import type { PokemonSet } from '@pkmn/sim';

function mon(name: string, move: string): PokemonSet {
  return {
    name,
    species: name,
    item: '',
    ability: '',
    moves: [move, 'Protect'],
    nature: 'Serious',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  };
}

const p1Team: PokemonSet[] = [
  mon('Pikachu', 'Thunderbolt'), mon('Eevee', 'Tackle'), mon('Raichu', 'Thunderbolt'),
  mon('Jolteon', 'Thunderbolt'), mon('Flareon', 'Ember'), mon('Vaporeon', 'Water Gun'),
];
const p2Team: PokemonSet[] = [
  mon('Bulbasaur', 'Vine Whip'), mon('Charmander', 'Ember'), mon('Squirtle', 'Water Gun'),
  mon('Ivysaur', 'Vine Whip'), mon('Charmeleon', 'Ember'), mon('Wartortle', 'Water Gun'),
];

const vgcLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|teampreview',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
].join('\n');

describe('bring-limited team preview (VGC 4 of 6)', () => {
  test('getReplayBringCount answers from the rule table and the format-id heuristic', () => {
    // Regulations newer than the bundled sim resolve via the heuristic.
    expect(getReplayBringCount({ formatid: 'gen9vgc2026regi' })).toBe(4);
    // A regulation the Dex knows answers from its own rule table.
    expect(getReplayBringCount({ formatid: 'gen9vgc2025regi' })).toBe(4);
    expect(getReplayBringCount({ formatid: 'gen9battlestadiumsinglesregi' })).toBe(3);
    // Bring-all formats have no limit.
    expect(getReplayBringCount({ formatid: 'gen9ou' })).toBe(null);
    expect(getReplayBringCount({ formatid: 'gen9doublesou' })).toBe(null);
  });

  test('bringOnly fields exactly the brought four with the chosen leads first', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      onLogLines: lines => logLines.push(...lines),
      leadOverride: { p1: ['Raichu', 'Jolteon'], p2: ['Squirtle', 'Ivysaur'] },
      bringOnly: {
        p1: ['Raichu', 'Jolteon', 'Pikachu', 'Eevee'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(4);
    expect(battle.sides[1].pokemon).toHaveLength(4);
    expect(battle.sides[0].pokemon.map(pokemon => pokemon.species.name)).not.toContain('Flareon');

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });
    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Raichu', 'Jolteon']);
    expect(state.p2ActiveSlots.map(active => active?.species)).toEqual(['Squirtle', 'Ivysaur']);
    // The bench holds ONLY the rest of the brought four.
    expect(state.p1SwitchesBySlot[0].map(option => option.species).sort()).toEqual(['Eevee', 'Pikachu']);
  });

  test('a bring list the team cannot satisfy fails open to the whole team', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Raichu', 'Jolteon', 'Pikachu', 'Mewtwo'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });

    // Round 89 (#124): both sides trim or neither. P1's list does not resolve, so P2's four does not trim alone either
    // (was 6 v 4: a pinned four against an open six, the asymmetry that flipped game 452654 in the A.3c gate).
    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(6);
    expect(battle.sides[1].pokemon).toHaveLength(6);
  });

  test('replayBringOnly pins both sides or neither and dedupes battle formes', () => {
    // A forme change mid-game (Terapagos-Terastal → -Stellar) is ONE brought
    // body (the VGC-tranche sighting caught it counted twice). A side whose
    // fourth never entered leaves the WHOLE replay unpinned: the A/B gate
    // showed a pinned four against an unpinned six flips games (452654).
    const log = [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|gametype|doubles',
      '|gen|9',
      '|tier|[Gen 9] VGC 2026 Regulation I',
      '|poke|p1|Terapagos, L50|',
      '|poke|p1|Pikachu, L50|',
      '|poke|p1|Eevee, L50|',
      '|poke|p1|Raichu, L50|',
      '|poke|p1|Jolteon, L50|',
      '|poke|p1|Flareon, L50|',
      '|poke|p2|Bulbasaur, L50|',
      '|poke|p2|Charmander, L50|',
      '|poke|p2|Squirtle, L50|',
      '|poke|p2|Ivysaur, L50|',
      '|poke|p2|Charmeleon, L50|',
      '|poke|p2|Wartortle, L50|',
      '|teampreview',
      '|start',
      '|switch|p1a: Terapagos|Terapagos-Terastal, L50|100/100',
      '|switch|p1b: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
      '|switch|p2b: Charmander|Charmander, L50|100/100',
      '|turn|1',
      '|switch|p1a: Terapagos|Terapagos-Stellar, L50|100/100',
      '|switch|p1b: Eevee|Eevee, L50|100/100',
      '|switch|p2a: Squirtle|Squirtle, L50|100/100',
      '|turn|2',
      '|switch|p1a: Raichu|Raichu, L50|100/100',
      '|turn|3',
    ].join('\n');
    const { snapshots } = parseReplayLogWithObservations(log);
    // p2's fourth never entered — the whole replay stays unpinned.
    expect(replayBringOnly({ formatid: 'gen9vgc2026regi', log }, snapshots)).toBeNull();

    // With p2's fourth revealed, both sides pin — and Terapagos counts once
    // (first-seen forme name) despite entering as two formes.
    const fullLog = `${log}\n|switch|p2b: Ivysaur|Ivysaur, L50|100/100\n|turn|4`;
    const fullSnapshots = parseReplayLogWithObservations(fullLog).snapshots;
    const brought = replayBringOnly({ formatid: 'gen9vgc2026regi', log: fullLog }, fullSnapshots);
    expect(brought).not.toBeNull();
    expect([...brought!.p1].sort()).toEqual(['Eevee', 'Pikachu', 'Raichu', 'Terapagos-Terastal']);
    expect([...brought!.p2].sort()).toEqual(['Bulbasaur', 'Charmander', 'Ivysaur', 'Squirtle']);
    // Bring-all formats never produce a bring list.
    expect(replayBringOnly({ formatid: 'gen9doublesou', log: fullLog }, fullSnapshots)).toBeNull();
  });

  test('brought forme names resolve onto their base-species sets, exact match first', async () => {
    // The protocol reveals the ACTIVE forme (Zamazenta-Crowned) while the
    // built set may carry the base name — the unique base match resolves
    // it. A team holding BOTH forme siblings as separate sets keeps the
    // exact match only (the sighting found 7-8-set VGC teams).
    const withBase = [mon('Zamazenta', 'Iron Head'), ...p1Team.slice(1)];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: withBase,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Eevee', 'Raichu', 'Zamazenta-Crowned', 'Jolteon'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });
    const names = runtime.battleStream.battle!.sides[0].pokemon.map(pokemon => pokemon.species.name);
    expect(names).toHaveLength(4);
    expect(names).toContain('Zamazenta');

    const withSiblings = [...p1Team.slice(0, 5), mon('Zamazenta', 'Iron Head'), mon('Zamazenta-Crowned', 'Behemoth Bash')];
    const siblingRuntime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: withSiblings,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Pikachu', 'Eevee', 'Zamazenta-Crowned', 'Raichu'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });
    const siblingNames = siblingRuntime.battleStream.battle!.sides[0].pokemon.map(pokemon => pokemon.species.name);
    expect(siblingNames).toHaveLength(4);
    expect(siblingNames).toContain('Zamazenta-Crowned');
    expect(siblingNames).not.toContain('Zamazenta');
  });

  test('the team-preview position honors the bring limit for the lead analysis', async () => {
    const { createRootPosition, legalChoices } = await import('../src/forward-model');
    const serialized = serializePreviewPosition('gen9doublesou', p1Team, p2Team, {
      p1: ['Pikachu', 'Eevee', 'Raichu', 'Jolteon'],
      p2: ['Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur'],
    });
    expect(serialized).not.toBeNull();
    const root = createRootPosition(serialized!);
    // Four brought per side: the lead enumeration prices real pairs only.
    const options = legalChoices(root, 'p1');
    expect(options).toHaveLength(6);
    expect(options.every(option => !option.label.includes('Flareon'))).toBe(true);
    // An unpinned side ([]) keeps its whole pool.
    const open = serializePreviewPosition('gen9doublesou', p1Team, p2Team, {
      p1: ['Pikachu', 'Eevee', 'Raichu', 'Jolteon'],
      p2: [],
    });
    expect(open).not.toBeNull();
    expect(legalChoices(createRootPosition(open!), 'p2')).toHaveLength(15);
  });
});

/**
 * Round 89 (#116): a Ditto that copied a foe stands in the snapshot as the foe's species, and the bring list named the copy.
 * The list names the body's own species (the client's `baseSpeciesForme` of a transformed body), so the trim keeps the Ditto
 * and drops the unbrought body of the copied species. VGC (doubles, bring four) and Battle Stadium Singles (bring three).
 */
const baseNames = (sets: PokemonSet[]) => sets.map(set => set.species).sort();

describe('a transformed body keeps its own species on the bring list (#116)', () => {
  test('VGC 2565721987: P1 brought Iron Bundle, Grimmsnarl, Ditto and Miraidon, and the rebuild fields four against four', async () => {
    const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9vgc2026regi-2565721987.json', import.meta.url), 'utf-8')) as ReplayData;
    const brought = replayBringOnly(replay, parseReplayLog(replay.log));
    expect(brought).not.toBeNull();
    expect([...brought!.p1].sort()).toEqual(['Ditto', 'Grimmsnarl', 'Iron Bundle', 'Miraidon']);
    expect(brought!.p2).toHaveLength(4);

    const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const rules = replayRules(replay);
    const trimmed = trimTeamToBring(p1Team, brought!.p1, rules);
    expect(trimmed).toHaveLength(4);
    expect(trimmed.map(set => set.species)).toContain('Ditto');

    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: 1,
      playerNames: [replay.players[0], replay.players[1]], bringOnly: brought!, deadlineMs: 120_000,
    });
    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(4);
    expect(battle.sides[1].pokemon).toHaveLength(4);
    expect(battle.sides[0].pokemon.map(body => body.species.name)).toContain('Ditto');
  }, 240_000);

  /** Game 2382086291's shape: the side holds its own foe-species body in the preview, leaves it at home and brings a Ditto that copies the foe's. */
  const COPIED = 'Tornadus';
  const homeSet = (names: string[]) => names.map(name => mon(name, 'Tackle'));
  const SHAPES = {
    singles: {
      formatid: 'gen9battlestadiumsinglesregi', count: 3, gametype: 'singles',
      p1: [COPIED, 'Ditto', 'Pikachu', 'Eevee', 'Raichu', 'Jolteon'], p1Brought: ['Ditto', 'Pikachu', 'Eevee'],
      p2: [COPIED, 'Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur', 'Charmeleon'],
      play: [
        '|switch|p1a: Ditto|Ditto, L50|100/100', '|switch|p2a: Tornadus|Tornadus, L50, M|100/100',
        '|-transform|p1a: Ditto|p2a: Tornadus|[from] ability: Imposter', '|turn|1',
        '|switch|p1a: Pikachu|Pikachu, L50|100/100', '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100', '|turn|2',
        '|switch|p1a: Eevee|Eevee, L50|100/100', '|switch|p2a: Charmander|Charmander, L50|100/100', '|turn|3',
      ],
    },
    doubles: {
      formatid: 'gen9vgc2026regi', count: 4, gametype: 'doubles',
      p1: [COPIED, 'Ditto', 'Pikachu', 'Eevee', 'Raichu', 'Jolteon'], p1Brought: ['Ditto', 'Pikachu', 'Eevee', 'Raichu'],
      p2: [COPIED, 'Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur', 'Charmeleon'],
      play: [
        '|switch|p1a: Ditto|Ditto, L50|100/100', '|switch|p1b: Pikachu|Pikachu, L50|100/100',
        '|switch|p2a: Tornadus|Tornadus, L50, M|100/100', '|switch|p2b: Bulbasaur|Bulbasaur, L50|100/100',
        '|-transform|p1a: Ditto|p2a: Tornadus|[from] ability: Imposter', '|turn|1',
        '|switch|p1b: Eevee|Eevee, L50|100/100', '|switch|p2b: Charmander|Charmander, L50|100/100', '|turn|2',
        '|switch|p1b: Raichu|Raichu, L50|100/100', '|switch|p2a: Squirtle|Squirtle, L50|100/100', '|turn|3',
      ],
    },
  } as const;

  for (const [kind, shape] of Object.entries(SHAPES)) {
    test(`${kind}: the trimmed team holds the Ditto, not the unbrought ${COPIED}`, () => {
      const log = [
        '|player|p1|Alice|', '|player|p2|Bob|', `|gametype|${shape.gametype}`, '|gen|9',
        ...shape.p1.map(name => `|poke|p1|${name}, L50|`), ...shape.p2.map(name => `|poke|p2|${name}, L50|`),
        '|teampreview', '|start', ...shape.play,
      ].join('\n');
      const source = { formatid: shape.formatid, log };
      expect(getReplayBringCount(source)).toBe(shape.count);
      const brought = replayBringOnly(source, parseReplayLog(log));
      expect(brought).not.toBeNull();
      expect([...brought!.p1].sort()).toEqual([...shape.p1Brought].sort());

      const trimmed = trimTeamToBring(homeSet(shape.p1), brought!.p1, replayRules(source));
      expect(baseNames(trimmed)).toEqual([...shape.p1Brought].sort());
      expect(baseNames(trimmed)).not.toContain(COPIED);
    });
  }
});

/**
 * Round 89 (#124, stage 1): a side that never fielded its whole selection plays its fielded bodies plus one guess for each
 * missing body, taken from its team preview. The rebuild of every world fields the count on both sides, the guess takes the last
 * party slot, and every known body keeps one party index in all worlds, so a choice string names the same body in each world.
 */
const SCENES = [
  {
    label: 'Champions VGC 2625939941 (doubles; P1 short, candidates Ceruledge, Ninetales-Alola, Kingambit)',
    file: 'gen9championsvgc2026regma-2625939941.json', short: 'p1' as const,
    fielded: ['Farigiraf', 'Basculegion', 'Lopunny'], candidates: ['Ceruledge', 'Ninetales', 'Kingambit'], noBody: ['Kangaskhan', 'Torkoal'],
    lastBoundaryDiverges: false,
  },
  {
    // Round 89 (#124, B5b): 2630452654 was the VGC row until its P2 read as short by mistake (Farigiraf entered on Volt Switch and
    // fainted in the same turn, so P2 fielded all four); 2630181744 is short by the log: P1 never fielded its fourth body.
    label: 'VGC 2630181744 (doubles; P1 short, candidates Incineroar, Grimmsnarl, Amoonguss)',
    file: 'gen9vgc2026regi-2630181744.json', short: 'p1' as const,
    fielded: ['Calyrex-Shadow', 'Solgaleo', 'Rillaboom'], candidates: ['Incineroar', 'Grimmsnarl', 'Amoonguss'], noBody: ['Incineroar', 'Rillaboom'],
    // The sim loses a P1 body at turn 6 that the log keeps, and its forced switch brings the guess in: the last boundary reads
    // a replay divergence of the sim, not the list, so the party checks stop one boundary short.
    lastBoundaryDiverges: true,
  },
];

interface Boundaries { sizes: [number, number]; parties: Record<number, [string[], string[]]> }

/** One world's rebuild through the whole log: the party of both sides (base species, by party index) at every raw boundary. */
async function rebuildWorld(replay: ReplayData, world: BringWorld, teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }): Promise<Boundaries> {
  const format = getBranchSimulatorFormat(replay);
  await loadSimMods(format);
  const rules = replayRules(replay);
  const snapshots = parseReplayLog(replay.log);
  const parties: Boundaries['parties'] = {};
  const runtime = await reconstructBranchRuntime({
    format, ...teams, replayLog: replay.log, targetTurn: snapshots.length, snapshot: snapshots[snapshots.length - 1],
    bringOnly: { p1: world.p1, p2: world.p2, guessed: world.guessed }, deadlineMs: 120_000,
    onRawBoundary: (turn, battle) => {
      parties[turn] = [0, 1].map(index => battle.sides[index].pokemon.map(body => speciesBaseId(body.baseSpecies.name, rules))) as [string[], string[]];
    },
  });
  const battle = runtime.battleStream.battle!;
  return { sizes: [battle.sides[0].pokemon.length, battle.sides[1].pokemon.length], parties };
}

const entry = (species: string, rawCount: number) =>
  [species.toLowerCase().replace(/[^a-z0-9]/g, ''), { species, rawCount, abilities: [], items: [], moves: [], spreads: [] }] as const;
const statsOf = (counts: [string, number][]): SmogonUsageStats => ({
  format: 'test', month: '2026-10', source: 'test', pokemon: Object.fromEntries(counts.map(([species, rawCount]) => entry(species, rawCount))),
});
const guessedOf = (short: 'p1' | 'p2') => (short === 'p1' ? { p1: 1, p2: 0 } : { p1: 0, p2: 1 });
const fixture = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8')) as ReplayData;

describe('#124: the worlds of a short side', () => {
  for (const scene of SCENES) {
    test(`${scene.label}: replayBringList names the fielded bodies and the candidates, and every world rebuilds the count against the count`, async () => {
      const replay = fixture(scene.file);
      await loadSimMods(getBranchSimulatorFormat(replay));
      const rules = replayRules(replay);
      const list = replayBringList(replay, parseReplayLog(replay.log))!;
      expect(list).not.toBeNull();
      expect(list.count).toBe(4);
      const other = scene.short === 'p1' ? 'p2' : 'p1';
      const shortSide = list[scene.short];
      expect(shortSide.fielded).toHaveLength(3);
      expect(shortSide.open).toBe(1);
      expect(shortSide.candidates).toHaveLength(3);
      expect(shortSide.candidates.every(candidate => Math.abs(candidate.weight - 1 / 3) < 1e-9)).toBe(true);
      expect(list[other].open).toBe(0);
      expect(list[other].candidates).toEqual([]);
      if (scene.fielded) {
        expect(shortSide.fielded.map(name => speciesBaseId(name, rules)).sort()).toEqual(scene.fielded.map(name => speciesBaseId(name, rules)).sort());
        expect(shortSide.candidates.map(candidate => speciesBaseId(candidate.species, rules))).toEqual(scene.candidates!.map(name => speciesBaseId(name, rules)));
      }

      const worlds = bringWorlds(list, BRING_WORLD_CAP)!;
      expect(worlds).toHaveLength(3);
      expect(worlds.map(world => world.guessed)).toEqual(Array(3).fill(guessedOf(scene.short)));

      const teams = buildTeamsFromReplay(replay.log);
      const shortIndex = scene.short === 'p1' ? 0 : 1;
      const checkedParties = (boundaries: Boundaries) => {
        const turnsOf = Object.keys(boundaries.parties).map(Number).sort((a, b) => a - b);
        return (scene.lastBoundaryDiverges ? turnsOf.slice(0, -1) : turnsOf).map(turn => boundaries.parties[turn]);
      };
      const rebuilt: Boundaries[] = [];
      for (const world of worlds) rebuilt.push(await rebuildWorld(replay, world, teams));
      worlds.forEach((world, index) => {
        expect(rebuilt[index].sizes).toEqual([4, 4]);
        const guess = speciesBaseId(world[scene.short][3], rules);
        for (const party of checkedParties(rebuilt[index])) {
          expect(party[shortIndex][3], 'the guess of the world is the last slot').toBe(guess);
          for (const name of scene.noBody) expect(party[1 - shortIndex]).not.toContain(speciesBaseId(name, rules));
        }
      });
      const turns = Object.keys(rebuilt[0].parties).map(Number).sort((a, b) => a - b).slice(0, scene.lastBoundaryDiverges ? -1 : undefined);
      expect(turns.length).toBeGreaterThan(3);
      for (const turn of turns) {
        for (const next of rebuilt.slice(1)) {
          expect(next.parties[turn][1 - shortIndex], `turn ${turn}: the full side is one body list`).toEqual(rebuilt[0].parties[turn][1 - shortIndex]);
          expect(next.parties[turn][shortIndex].slice(0, 3), `turn ${turn}: the known bodies keep their party index`).toEqual(rebuilt[0].parties[turn][shortIndex].slice(0, 3));
        }
      }
    }, 240_000);
  }

  test('VGC 2630181744: the usage counts weigh the candidates and the heaviest one comes first', () => {
    const replay = fixture('gen9vgc2026regi-2630181744.json');
    const stats = statsOf([['Incineroar', 4000], ['Amoonguss', 2000], ['Grimmsnarl', 500]]);
    const worlds = bringWorlds(replayBringList(replay, parseReplayLog(replay.log), stats), BRING_WORLD_CAP)!;
    expect(worlds.map(world => world.weight)).toEqual([4000 / 6500, 2000 / 6500, 500 / 6500].map(weight => expect.closeTo(weight, 9)));
    expect(worlds.map(world => world.p1[3])).toEqual(['Incineroar', 'Amoonguss', 'Grimmsnarl']);
    expect(worlds.reduce((sum, world) => sum + world.weight, 0)).toBeCloseTo(1, 9);
  });

  test('VGC 2630452654 is not short: P2\'s Farigiraf entered on Volt Switch and fainted the same turn, so both sides fielded four', () => {
    const replay = fixture('gen9vgc2026regi-2630452654.json');
    const list = replayBringList(replay, parseReplayLog(replay.log))!;
    expect([list.p1.open, list.p2.open]).toEqual([0, 0]);
    expect(bringWorlds(list, BRING_WORLD_CAP)).toHaveLength(1);
    expect(replayBringOnly(replay, parseReplayLog(replay.log))!.p2).toContain('Farigiraf');
  });

  test('Battle Stadium Singles: four candidates, the three heaviest keep their share renormalized, every world rebuilds three against three', async () => {
    const preview = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|singles', '|gen|9', '|tier|[Gen 9] Battle Stadium Singles Regulation H',
      ...preview.map(name => `|poke|p1|${name}, L50|`), ...preview.map(name => `|poke|p2|${name}, L50|`), '|teampreview|3', '|start',
      '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|switch|p2a: Kingambit|Kingambit, L50|100/100', '|turn|1',
      '|switch|p1a: Gholdengo|Gholdengo, L50|100/100', '|switch|p2a: Dragonite|Dragonite, L50|100/100', '|turn|2',
      '|switch|p2a: Corviknight|Corviknight, L50|100/100', '|turn|3',
      '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|turn|4',
    ].join('\n');
    const replay = { id: 'synthetic-bss-worlds', formatid: 'gen9battlestadiumsinglesregh', format: '[Gen 9] Battle Stadium Singles Regulation H', players: ['Alice', 'Bob'], log } as ReplayData;
    const stats = statsOf([['Kingambit', 500], ['Dragonite', 300], ['Corviknight', 150], ['Glimmora', 50]]);
    const list = replayBringList(replay, parseReplayLog(log), stats)!;
    expect(list.p1.candidates).toHaveLength(4);
    const worlds = bringWorlds(list, BRING_WORLD_CAP)!;
    expect(worlds.map(world => world.p1[2])).toEqual(['Kingambit', 'Dragonite', 'Corviknight']);
    expect(worlds.map(world => world.weight)).toEqual([500 / 950, 300 / 950, 150 / 950].map(weight => expect.closeTo(weight, 9)));
    expect(worlds.map(world => world.p2)).toEqual(Array(3).fill(['Kingambit', 'Dragonite', 'Corviknight']));
    const teams = { p1Team: preview.map(name => mon(name, 'Tackle')), p2Team: preview.map(name => mon(name, 'Tackle')) };
    const rules = replayRules(replay);
    for (const world of worlds) {
      const rebuilt = await rebuildWorld(replay, world, teams);
      expect(rebuilt.sizes).toEqual([3, 3]);
      for (const party of Object.values(rebuilt.parties)) expect(party[0][2]).toBe(speciesBaseId(world.p1[2], rules));
    }
  }, 240_000);

  test('doubles with both sides short: nine worlds cap at three, each one rebuilds four against four with both guesses last', async () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2026 Regulation I',
      ...p1Team.map(set => `|poke|p1|${set.species}, L50|`), ...p2Team.map(set => `|poke|p2|${set.species}, L50|`), '|teampreview', '|start',
      '|switch|p1a: Pikachu|Pikachu, L50|100/100', '|switch|p1b: Eevee|Eevee, L50|100/100',
      '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100', '|switch|p2b: Charmander|Charmander, L50|100/100', '|turn|1',
      '|switch|p1b: Raichu|Raichu, L50|100/100', '|switch|p2b: Squirtle|Squirtle, L50|100/100', '|turn|2',
      '|turn|3',
    ].join('\n');
    const replay = { id: 'synthetic-vgc-both-short', formatid: 'gen9vgc2026regi', format: '[Gen 9] VGC 2026 Regulation I', players: ['Alice', 'Bob'], log } as ReplayData;
    const stats = statsOf([['Jolteon', 50], ['Flareon', 30], ['Vaporeon', 20], ['Ivysaur', 60], ['Charmeleon', 25], ['Wartortle', 15]]);
    const list = replayBringList(replay, parseReplayLog(log), stats)!;
    expect(list.p1.open).toBe(1);
    expect(list.p2.open).toBe(1);
    expect(bringWorlds(list, 100)!).toHaveLength(9);
    const worlds = bringWorlds(list, BRING_WORLD_CAP)!;
    expect(worlds).toHaveLength(3);
    // 0.50*0.60, 0.30*0.60 and 0.50*0.25 over their sum 0.605.
    expect(worlds.map(world => `${world.p1[3]}/${world.p2[3]}`)).toEqual(['Jolteon/Ivysaur', 'Flareon/Ivysaur', 'Jolteon/Charmeleon']);
    expect(worlds.map(world => world.weight)).toEqual([0.3 / 0.605, 0.18 / 0.605, 0.125 / 0.605].map(weight => expect.closeTo(weight, 9)));
    const rules = replayRules(replay);
    for (const world of worlds) {
      const rebuilt = await rebuildWorld(replay, world, { p1Team, p2Team });
      expect(rebuilt.sizes).toEqual([4, 4]);
      for (const party of Object.values(rebuilt.parties)) {
        expect(party[0][3]).toBe(speciesBaseId(world.p1[3], rules));
        expect(party[1][3]).toBe(speciesBaseId(world.p2[3], rules));
      }
    }
  }, 240_000);
});

describe('#124: trimTeamsToBring trims both teams or neither', () => {
  const rules = { gen: 9, mod: undefined };
  const names = (team: PokemonSet[]) => team.map(set => set.name);
  const p2Four = ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'];

  test('the guessed set moves behind the known bodies, which keep team order', () => {
    // Team order: Pikachu, Eevee, Raichu, Jolteon. The guess is Eevee, which sits before two known non-leads.
    const { p1, p2 } = trimTeamsToBring(p1Team, p2Team, { p1: ['Pikachu', 'Raichu', 'Jolteon', 'Eevee'], p2: p2Four, guessed: { p1: 1, p2: 0 } }, rules);
    expect(names(p1)).toEqual(['Pikachu', 'Raichu', 'Jolteon', 'Eevee']);
    expect(names(p2)).toEqual(['Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur']);
  });

  test('two guessed sets take the last two slots in list order', () => {
    const { p1 } = trimTeamsToBring(p1Team, p2Team, { p1: ['Pikachu', 'Raichu', 'Vaporeon', 'Eevee'], p2: p2Four, guessed: { p1: 2, p2: 0 } }, rules);
    expect(names(p1)).toEqual(['Pikachu', 'Raichu', 'Vaporeon', 'Eevee']);
  });

  test('a list without guesses trims each side as trimTeamToBring does', () => {
    const list = { p1: ['Jolteon', 'Pikachu', 'Eevee', 'Raichu'], p2: p2Four };
    const { p1, p2 } = trimTeamsToBring(p1Team, p2Team, list, rules);
    expect(p1).toEqual(trimTeamToBring(p1Team, list.p1, rules));
    expect(p2).toEqual(trimTeamToBring(p2Team, list.p2, rules));
  });

  test('a side whose list names a stranger, is empty or is missing keeps both teams whole', () => {
    const good = ['Pikachu', 'Eevee', 'Raichu', 'Jolteon'];
    for (const bad of [['Raichu', 'Jolteon', 'Pikachu', 'Mewtwo'], [], undefined]) {
      const first = trimTeamsToBring(p1Team, p2Team, { p1: bad as string[], p2: p2Four }, rules);
      expect([first.p1.length, first.p2.length]).toEqual([6, 6]);
      const second = trimTeamsToBring(p1Team, p2Team, { p1: good, p2: bad as string[] }, rules);
      expect([second.p1.length, second.p2.length]).toEqual([6, 6]);
    }
    expect(trimTeamsToBring(p1Team, p2Team, null, rules)).toEqual({ p1: p1Team, p2: p2Team });
    expect(trimTeamsToBring(p1Team, p2Team, undefined, rules)).toEqual({ p1: p1Team, p2: p2Team });
  });
});
