import { test, expect, describe } from 'vitest';
import type { PokemonSet, Battle } from '@pkmn/sim';
import { reconstructBranchRuntime, executeBranchChoices, correctActivesFromProtocol } from '../src/branch-engine';
import { buildChoiceLockContext } from '../src/choice-lock';
import { createRootPosition, legalChoices, serializeBattleStable } from '../src/forward-model';
import {
  parseReplayLogWithObservations,
  parseReplayLog,
  resolveHiddenPowerType,
  withHiddenPowerType,
  type SmogonUsageStats,
  type HiddenPowerEvidence,
} from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { matchPlayedChoice } from '../src/analysis';
import type { EvalResult } from '../src/analysis';

function makeSet(name: string, species: string, moves: string[]): PokemonSet {
  return {
    name,
    species,
    item: '',
    ability: 'No Ability',
    moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    gender: '',
  };
}

const p1Team = [
  makeSet('Pika', 'Pikachu', ['Thunderbolt', 'Protect']),
  makeSet('Eve', 'Eevee', ['Tackle', 'Protect']),
  makeSet('Squirt', 'Squirtle', ['Water Gun', 'Protect']),
];

const p2Team = [makeSet('Bulba', 'Bulbasaur', ['Vine Whip', 'Protect'])];

const singlesLog = [
  '|switch|p1a: Pika|Pikachu, L50|100/100',
  '|switch|p2a: Bulba|Bulbasaur, L50|100/100',
  '|turn|1',
].join('\n');

describe('correctActivesFromProtocol', () => {
  test('keeps side.pokemon aligned when repointing an active slot', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const side = runtime.battleStream.battle!.sides[0];

    correctActivesFromProtocol(runtime.battleStream.battle!, [
      '|drag|p1a: Eve|Eevee, L50|100/100',
    ]);

    expect(side.active[0]?.name).toBe('Eve');
    expect(side.pokemon[0]?.name).toBe('Eve');
    expect(side.pokemon.map(pokemon => pokemon.name).sort()).toEqual(['Eve', 'Pika', 'Squirt']);
    side.pokemon.forEach((pokemon, index) => expect(pokemon.position).toBe(index));
  });

  test('a repointed Pokémon enters fresh — no inherited choice lock (GPL t38)', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    const side = battle.sides[0];
    const eve = side.pokemon.find(pokemon => pokemon.name === 'Eve')!;
    eve.volatiles['choicelock'] = { id: 'choicelock', move: 'tackle' } as never;
    eve.moveSlots.forEach(slot => { slot.disabled = true; });

    correctActivesFromProtocol(battle, ['|switch|p1a: Eve|Eevee, L50|100/100']);

    expect(side.active[0]?.name).toBe('Eve');
    expect('choicelock' in eve.volatiles).toBe(false);
    expect(eve.lastMove).toBeNull();
    eve.moveSlots.forEach(slot => expect(slot.disabled).toBe(false));
  });

  test('the request regenerates after a correction — options follow the corrected active', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;

    correctActivesFromProtocol(battle, ['|drag|p1a: Eve|Eevee, L50|100/100']);

    const request = battle.sides[0].activeRequest as {
      active?: ({ moves?: { move: string }[] } | null)[];
    } | null;
    expect(request?.active?.[0]?.moves?.map(move => move.move)).toEqual(['Tackle', 'Protect']);
  });

  test('a repointed mon entering beside a standing Imprison gets recomputed disable flags', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    const bulba = battle.sides[1].active[0]!;
    bulba.addVolatile('imprison', bulba);

    correctActivesFromProtocol(battle, ['|switch|p1a: Eve|Eevee, L50|100/100']);

    const eve = battle.sides[0].active[0]!;
    expect(eve.moveSlots.find(slot => slot.id === 'protect')?.disabled).toBeTruthy();
    expect(eve.moveSlots.find(slot => slot.id === 'tackle')?.disabled).toBeFalsy();
  });

  test('a real switch after a correction neither duplicates nor loses team members', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: singlesLog,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    const side = battle.sides[0];

    correctActivesFromProtocol(battle, ['|drag|p1a: Eve|Eevee, L50|100/100']);

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'switch 3' },
        { side: 'p2', command: 'move 1' },
      ],
    });
    expect(result.ok).toBe(true);

    const names = side.pokemon.map(pokemon => pokemon.name);
    expect(new Set(names).size).toBe(3);
    expect(names.sort()).toEqual(['Eve', 'Pika', 'Squirt']);
    expect(side.pokemon.filter(pokemon => pokemon.isActive)).toHaveLength(1);
  });
});

describe('protocol lock restamp after correction', () => {
  const keldeoLog = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
    '|poke|p1|Keldeo|', '|poke|p2|Chansey|',
    '|start',
    '|switch|p1a: Keldeo|Keldeo|100/100',
    '|switch|p2a: Blissey|Blissey|100/100',
    '|turn|1',
    '|move|p1a: Keldeo|Hydro Pump|p2a: Blissey',
    '|turn|2',
  ].join('\n');
  const specsKeldeo = makeSet('Keldeo', 'Keldeo', ['Hydro Pump', 'Secret Sword', 'Icy Wind', 'Rest']);
  specsKeldeo.item = 'Choice Specs';
  const specsTeams = {
    p1Team: [specsKeldeo],
    p2Team: [makeSet('Blissey', 'Blissey', ['Protect']), makeSet('Chansey', 'Chansey', ['Protect'])],
  };

  test('repointing ONTO the locked mon restores its protocol lock; the request disables the rest', async () => {
    const divergedLog = [
      '|switch|p1a: Filler|Blissey|100/100',
      '|switch|p2a: Blissey|Blissey|100/100',
      '|turn|1',
    ].join('\n');
    const p1Team = [makeSet('Filler', 'Blissey', ['Protect']), specsKeldeo];
    const runtime = await reconstructBranchRuntime({
      format: 'gen6ou', p1Team, p2Team: specsTeams.p2Team,
      replayLog: divergedLog, targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;
    const context = buildChoiceLockContext(keldeoLog, { p1Team, p2Team: specsTeams.p2Team }, []);
    correctActivesFromProtocol(battle, ['|switch|p1a: Keldeo|Keldeo|100/100'], { context, turn: 2 });
    const keldeo = battle.sides[0].active[0]!;
    expect(keldeo.species.name).toBe('Keldeo');
    const volatile = keldeo.volatiles['choicelock'] as { move?: string } | undefined;
    expect(volatile?.move).toBe('hydropump');
    const root = createRootPosition(serializeBattleStable(battle));
    const moveChoices = legalChoices(root, 'p1').map(option => option.choice).filter(choice => choice.startsWith('move '));
    expect(moveChoices).toEqual(['move hydropump']);
  });

  test('without eligibility (non-choice item) nothing is stamped', async () => {
    const freeTeams = {
      p1Team: [makeSet('Keldeo', 'Keldeo', ['Hydro Pump', 'Secret Sword'])],
      p2Team: specsTeams.p2Team,
    };
    const runtime = await reconstructBranchRuntime({
      format: 'gen6ou', p1Team: freeTeams.p1Team, p2Team: freeTeams.p2Team,
      replayLog: keldeoLog, targetTurn: 2,
    });
    const battle = runtime.battleStream.battle!;
    const context = buildChoiceLockContext(keldeoLog, freeTeams, []);
    correctActivesFromProtocol(battle, ['|drag|p2a: Chansey|Chansey|100/100'], { context, turn: 2 });
    expect(battle.sides[0].active[0]!.volatiles['choicelock']).toBeFalsy();
  });
});

await loadSimMods('gen9championsou');

const RULES = [
  { name: 'Scarlet/Violet', doubles: 'gen9doublescustomgame', singles: 'gen9customgame', level: 100 },
  { name: 'Pokémon Champions', doubles: 'gen9championsdoublescustomgame', singles: 'gen9championscustomgame', level: 50 },
];
const COMMANDERS: { label: string; commanders: ('p1' | 'p2')[] }[] = [
  { label: 'p1', commanders: ['p1'] },
  { label: 'p2', commanders: ['p2'] },
  { label: 'both sides', commanders: ['p1', 'p2'] },
];
const SLOTS = [{ label: 'a', tatsugiriFirst: true }, { label: 'b', tatsugiriFirst: false }];
const TARGET_TURN = 3;

const publicLog = (battle: Battle): string =>
  battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|')).join('\n');

const moveLines = (lines: readonly string[]): string[] =>
  lines.filter(line => line.startsWith('|move|')).map(line => line.split('|').slice(2, 4).join('|'));
const pendingActions = (battle: Battle): number[] => battle.sides.slice(0, 2).map(side => side.choice.actions.length);

interface Scene { format: string; p1: PokemonSet[]; p2: PokemonSet[]; turns: [string, string][] }

async function rebuild(scene: Scene, log: string, withSnapshot: boolean) {
  const { snapshots } = parseReplayLogWithObservations(log);
  const runtime = await reconstructBranchRuntime({
    format: scene.format, p1Team: scene.p1, p2Team: scene.p2, replayLog: log, targetTurn: TARGET_TURN,
    snapshot: withSnapshot ? snapshots[TARGET_TURN - 1] ?? null : null,
  });
  return { runtime, battle: runtime.battleStream.battle! };
}

function playGame(scene: Scene): { battle: Battle; log: string } {
  const battle = battleOf(scene.format, scene.p1, scene.p2);
  for (const [p1, p2] of scene.turns) {
    battle.choose('p1', p1);
    battle.choose('p2', p2);
  }
  return { battle, log: publicLog(battle) };
}

describe.each(RULES)('$name: a rebuilt Commander turn commits and leaves a clean root', rules => {
  const mon = (species: string, ability: string, moves: string[]): PokemonSet => set(species, moves, { ability, level: rules.level });
  const tatsugiri = mon('Tatsugiri', 'Commander', ['Draco Meteor', 'Muddy Water', 'Icy Wind', 'Protect']);
  const dondozo = mon('Dondozo', 'Unaware', ['Wave Crash', 'Earthquake', 'Order Up', 'Protect']);
  const fillers = [mon('Pikachu', 'Static', ['Thunderbolt', 'Protect']), mon('Snorlax', 'Immunity', ['Body Slam', 'Protect'])];
  const plain = [fillers[0], fillers[1], mon('Rillaboom', 'Grassy Surge', ['Grassy Glide', 'Protect']), mon('Incineroar', 'Intimidate', ['Fake Out', 'Protect'])];
  const team = (tatsugiriFirst: boolean, commands: boolean): PokemonSet[] =>
    commands ? [...(tatsugiriFirst ? [tatsugiri, dondozo] : [dondozo, tatsugiri]), ...fillers] : plain;

  describe.each(COMMANDERS)('Commander on $label', ({ commanders }) => {
    describe.each(SLOTS)('Tatsugiri in slot $label', ({ tatsugiriFirst }) => {
      const turnOne = (side: 'p1' | 'p2') => commanders.includes(side) ? 'move protect' : 'move protect, move protect';
      const turnTwo = (side: 'p1' | 'p2') => commanders.includes(side) ? 'move earthquake' : 'switch 3, switch 4';
      const scene: Scene = {
        format: rules.doubles, p1: team(tatsugiriFirst, commanders.includes('p1')), p2: team(tatsugiriFirst, commanders.includes('p2')),
        turns: [[turnOne('p1'), turnOne('p2')], [turnTwo('p1'), turnTwo('p2')]],
      };
      const game = playGame(scene);

      test('the board is what it says: the Tatsugiri commands on the sides named and the Dondozo moves for it', () => {
        expect(game.battle.turn).toBe(TARGET_TURN);
        for (const side of ['p1', 'p2'] as const) {
          const actives = game.battle.sides[side === 'p1' ? 0 : 1].active;
          const commanding = actives.filter(active => active.volatiles['commanding']).map(active => active.species.name);
          expect(commanding, side).toEqual(commanders.includes(side) ? ['Tatsugiri'] : []);
        }
        const dondozoMoves = moveLines(game.log.split('\n')).filter(line => line.includes('Dondozo|'));
        expect(dondozoMoves.length).toBe(2 * commanders.length);
      });

      test('the rebuild commits both turns by itself: the turn counter moves without the snapshot, no choice is rejected', async () => {
        const { runtime, battle } = await rebuild(scene, game.log, false);
        expect(runtime.choiceErrors.last).toBeNull();
        expect(runtime.choiceErrors.count).toBe(0);
        expect(battle.turn).toBe(TARGET_TURN);
        expect(moveLines(runtime.log)).toEqual(moveLines(game.log.split('\n')));
      });

      test('the root the search gets holds the pending choices the played game holds', async () => {
        const { battle } = await rebuild(scene, game.log, true);
        expect(battle.turn).toBe(TARGET_TURN);
        expect(battle.requestState).toBe(game.battle.requestState);
        expect(pendingActions(battle)).toEqual(pendingActions(game.battle));
      });
    });
  });

  test('singles is not affected: the Tatsugiri keeps its own moves and the rebuild commits', async () => {
    const scene: Scene = {
      format: rules.singles, p1: [tatsugiri, dondozo], p2: [dondozo, tatsugiri],
      turns: [['move protect', 'move protect'], ['move icywind', 'move earthquake']],
    };
    const game = playGame(scene);
    const { runtime, battle } = await rebuild(scene, game.log, false);
    expect(runtime.choiceErrors.count).toBe(0);
    expect(battle.turn).toBe(TARGET_TURN);
    expect(moveLines(runtime.log)).toEqual(moveLines(game.log.split('\n')));
    expect((await rebuild(scene, game.log, true)).battle.sides.slice(0, 2).map(side => side.choice.actions.length)).toEqual(pendingActions(game.battle));
  });
});

describe('encore-click', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const mon = (species: string, ability: string, moves: string[], spe: number): PokemonSet => ({
    name: species, species, item: '', ability, moves, nature: 'Serious',
    evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs, level: 100, teraType: 'Normal',
  });

  function rebuild(log: string, p1Team: PokemonSet[], p2Team: PokemonSet[], format: string, targetTurn: number) {
    const snapshots = parseReplayLog(log);
    return reconstructBranchRuntime({
      format, p1Team, p2Team, replayLog: log, targetTurn,
      snapshot: snapshots.find(entry => entry.turn === targetTurn) ?? null,
    });
  }

  const encoreTurns = (target: string, user: string) => [
    '|turn|1',
    `|move|${target}: Snorlax|Protect|${target}: Snorlax`,
    `|-singleturn|${target}: Snorlax|Protect`,
    `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`,
    `|-boost|${user}: Whimsicott|def|3`,
    '|upkeep', '|turn|2',
    `|move|${user}: Whimsicott|Encore|${target}: Snorlax`,
    `|-start|${target}: Snorlax|Encore`,
    `|move|${target}: Snorlax|Protect||[still]`,
    `|-fail|${target}: Snorlax`,
    '|upkeep', '|turn|3',
    `|move|${target}: Snorlax|Protect|${target}: Snorlax`,
    `|-singleturn|${target}: Snorlax|Protect`,
    `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`,
    `|-boost|${user}: Whimsicott|def|3`,
    '|upkeep', '|turn|4',
    `|move|${target}: Snorlax|Protect||[still]`,
    `|-fail|${target}: Snorlax`,
    `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`,
    `|-boost|${user}: Whimsicott|def|0`,
    `|-end|${target}: Snorlax|Encore`,
    '|upkeep', '|turn|5',
  ];

  const snorlax = mon('Snorlax', 'Immunity', ['Tackle', 'Protect'], 0);
  const whimsicott = mon('Whimsicott', 'Infiltrator', ['Encore', 'Cotton Guard'], 252);

  describe('an Encore that lands before its target moves', () => {
    test('singles: the lock ends with the protocol, not a turn late', async () => {
      const log = [
        '|gametype|singles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] OU',
        '|poke|p1|Snorlax, M|', '|poke|p2|Whimsicott, F|', '|start',
        '|switch|p1a: Snorlax|Snorlax, M|100/100',
        '|switch|p2a: Whimsicott|Whimsicott, F|100/100',
        ...encoreTurns('p1a', 'p2a'),
      ].join('\n');

      const locked = await rebuild(log, [snorlax], [whimsicott], 'gen9ou', 4);
      const lockedBody = locked.battleStream.battle!.sides[0].active[0]!;
      expect(lockedBody.volatiles['encore']?.move).toBe('protect');
      expect(lockedBody.getMoveRequestData().moves.filter(move => !move.disabled).map(move => move.id)).toEqual(['protect']);

      const free = await rebuild(log, [snorlax], [whimsicott], 'gen9ou', 5);
      const freeBody = free.battleStream.battle!.sides[0].active[0]!;
      expect(!!freeBody.volatiles['encore']).toBe(false);
      expect(freeBody.getMoveRequestData().moves.filter(move => !move.disabled).map(move => move.id)).toEqual(['tackle', 'protect']);
    });

    test('doubles: the same lock on the second slot', async () => {
      const log = [
        '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
        '|poke|p1|Blissey, F|', '|poke|p1|Snorlax, M|', '|poke|p2|Chansey, F|', '|poke|p2|Whimsicott, F|', '|start',
        '|switch|p1a: Blissey|Blissey, F|100/100',
        '|switch|p1b: Snorlax|Snorlax, M|100/100',
        '|switch|p2a: Chansey|Chansey, F|100/100',
        '|switch|p2b: Whimsicott|Whimsicott, F|100/100',
        ...encoreTurns('p1b', 'p2b'),
      ].join('\n');
      const p1Team = [mon('Blissey', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss'], 0), snorlax];
      const p2Team = [mon('Chansey', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss'], 0), whimsicott];

      const locked = await rebuild(log, p1Team, p2Team, 'gen9doublesou', 4);
      expect(locked.battleStream.battle!.sides[0].active[1]!.volatiles['encore']?.move).toBe('protect');

      const free = await rebuild(log, p1Team, p2Team, 'gen9doublesou', 5);
      expect(!!free.battleStream.battle!.sides[0].active[1]!.volatiles['encore']).toBe(false);
      expect(free.choiceErrors.count).toBe(0);
    });
  });
});

const usage: SmogonUsageStats = {
  format: 'gen6ou',
  month: 'test',
  source: 'https://www.smogon.com/stats/test/chaos/gen6ou-0.json',
  pokemon: {
    manectric: {
      species: 'Manectric',
      rawCount: 100,
      abilities: [],
      items: [],
      moves: [
        { value: 'thunderbolt', probability: 0.9, sourceDetail: 'Smogon gen6ou test' },
        { value: 'hiddenpowerice', probability: 0.6, sourceDetail: 'Smogon gen6ou test' },
        { value: 'hiddenpowergrass', probability: 0.3, sourceDetail: 'Smogon gen6ou test' },
      ],
      spreads: [],
    },
  },
};

const ev = (defender: string, marker: HiddenPowerEvidence['marker']): HiddenPowerEvidence =>
  ({ attackerSide: 'p1', attackerSpecies: 'Manectric', defenderSpecies: defender, marker });

describe('hidden-power type resolution', () => {
  test('usage alone picks the top variant', () => {
    expect(resolveHiddenPowerType([], usage, 'Manectric', { gen: 6, mod: undefined })).toBe('Hidden Power Ice');
  });
  test('evidence filters: a NEUTRAL hit on Skarmory keeps Ice (0.5 x 2 = x1), cuts Grass (x0.25)', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'neutral')], usage, 'Manectric', { gen: 6, mod: undefined })).toBe('Hidden Power Ice');
  });
  test('evidence overrides usage rank: a RESISTED hit on Skarmory cuts Ice, survivor Grass wins', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'resisted')], usage, 'Manectric', { gen: 6, mod: undefined })).toBe('Hidden Power Grass');
  });
  test('empty intersection falls back to usage-top (SUPER on Skarmory: no usage variant fits)', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'super')], usage, 'Manectric', { gen: 6, mod: undefined })).toBe('Hidden Power Ice');
  });
  test('contradictory evidence (super + immune) also falls back to usage-top', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'super'), ev('Skarmory', 'immune')], usage, 'Manectric', { gen: 6, mod: undefined }))
      .toBe('Hidden Power Ice');
  });
  test('no usage variant leaves null', () => {
    expect(resolveHiddenPowerType([], usage, 'Skarmory', { gen: 6, mod: undefined })).toBeNull();
  });
});

describe('set substitution', () => {
  const baseSet: PokemonSet = {
    name: 'Manectric', species: 'Manectric', item: '', ability: 'Static',
    moves: ['Thunderbolt', 'Hidden Power', 'Volt Switch', 'Overheat'],
    nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  };
  test('typeless HP is substituted; explicit knowledge is not', () => {
    const substituted = withHiddenPowerType(baseSet, [], usage, { gen: 6, mod: undefined });
    expect(substituted.moves).toContain('Hidden Power Ice');
    expect(substituted.moves).not.toContain('Hidden Power');
    const explicit = withHiddenPowerType({ ...baseSet, hpType: 'Grass' }, [], usage, { gen: 6, mod: undefined });
    expect(explicit.moves).toContain('Hidden Power');
    const customIvs = withHiddenPowerType(
      { ...baseSet, ivs: { ...baseSet.ivs, atk: 0, def: 30 } }, [], usage, { gen: 6, mod: undefined });
    expect(customIvs.moves).toContain('Hidden Power');
  });
});

describe('generic protocol Hidden Power against a typed set', () => {
  test('the choice replay maps Hidden Power onto the typed slot (no rejects, no divergence)', async () => {
    const typedSet: PokemonSet = {
      name: 'Manectric', species: 'Manectric', item: '', ability: 'Static',
      moves: ['Hidden Power Ice', 'Thunderbolt'],
      nature: 'Timid', evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: '',
    };
    const wall: PokemonSet = {
      name: 'Chansey', species: 'Chansey', item: '', ability: 'Natural Cure',
      moves: ['Soft-Boiled'],
      nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: '',
    };
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
      '|start',
      '|switch|p1a: Manectric|Manectric|100/100',
      '|switch|p2a: Chansey|Chansey|100/100',
      '|turn|1',
      '|move|p1a: Manectric|Hidden Power|p2a: Chansey',
      '|move|p2a: Chansey|Soft-Boiled|p2a: Chansey',
      '|turn|2',
      '|move|p1a: Manectric|Hidden Power|p2a: Chansey',
      '|move|p2a: Chansey|Soft-Boiled|p2a: Chansey',
      '|turn|3',
    ].join('\n');
    const runtime = await reconstructBranchRuntime({
      format: 'gen6ou', p1Team: [typedSet], p2Team: [wall],
      replayLog: log, targetTurn: 3,
    });
    expect(runtime.choiceErrors.count).toBe(0);
    expect(runtime.battleStream.battle!.turn).toBe(3);
  });

  test('the sim keeps the generic id for a typed set, so the played match holds', () => {
    // This row assumes @pkmn/sim keeps the request id 'hiddenpower' for "Hidden Power Ice" (the type lives in hpType).
    const option = {
      choice: 'move hiddenpower', label: 'Hidden Power Ice',
      worstCase: 0, expected: 0, ev: 0,
    };
    const result = { perSide: { p1: [option], p2: [] } } as unknown as EvalResult;
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Hidden Power' })).toBe(option);
  });
});
