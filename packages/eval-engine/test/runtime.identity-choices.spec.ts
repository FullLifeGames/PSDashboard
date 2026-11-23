import { test, expect, describe } from 'vitest';
import type { PokemonSet, Battle } from '@pkmn/sim';
import { reconstructBranchRuntime, resolveSideChoices, validateBranchRuntime, executeBranchChoices } from '../src/branch-engine';
import type { BranchSlotChoice } from '../src/branch-choices';
import { readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { cloneBattle } from '../src/forward/sim-fast/clone';
import { loadSimMods } from '../src/forward/sim-mods';

function pikachu(moves: string[]): PokemonSet {
  return {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves,
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  };
}

const eevee: PokemonSet = {
  name: 'Eevee',
  species: 'Eevee',
  item: 'Eviolite',
  ability: 'Adaptability',
  moves: ['Tackle', 'Protect'],
  nature: 'Jolly',
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50,
};

const bulbasaur: PokemonSet = {
  name: 'Bulbasaur',
  species: 'Bulbasaur',
  item: 'Eviolite',
  ability: 'Overgrow',
  moves: ['Vine Whip', 'Protect'],
  nature: 'Modest',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50,
};

const singlesLog = [
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
].join('\n');

const protectChoice: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };

async function makeSinglesRuntime(p1Moves: string[]) {
  return reconstructBranchRuntime({
    format: 'gen9ou',
    p1Team: [pikachu(p1Moves), eevee],
    p2Team: [bulbasaur],
    replayLog: singlesLog,
    targetTurn: 1,
  });
}

describe('identity-based choice resolution (B1)', () => {
  test('resolves the same move id to different slots depending on the current moveset', async () => {
    const original = await makeSinglesRuntime(['Thunderbolt', 'Protect']);
    const resolvedOriginal = resolveSideChoices(original.battleStream.battle!, 'p1', [protectChoice], [true]);
    expect(resolvedOriginal).toEqual({ ok: true, command: 'move 2' });

    // Same stored choice after a team edit shuffled the move order (B1b core):
    const edited = await makeSinglesRuntime(['Protect', 'Thunderbolt']);
    const resolvedEdited = resolveSideChoices(edited.battleStream.battle!, 'p1', [protectChoice], [true]);
    expect(resolvedEdited).toEqual({ ok: true, command: 'move 1' });
  });

  test('fails loudly when the stored move no longer exists after a team edit', async () => {
    const runtime = await makeSinglesRuntime(['Thunderbolt', 'Quick Attack']);
    const resolved = resolveSideChoices(runtime.battleStream.battle!, 'p1', [protectChoice], [true]);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('Protect');
  });

  test('resolves switches by identity and rejects unavailable Pokémon', async () => {
    const runtime = await makeSinglesRuntime(['Thunderbolt', 'Protect']);
    const battle = runtime.battleStream.battle!;

    const eeveeSwitch: BranchSlotChoice = { kind: 'switch', speciesId: 'eevee', pokemonName: 'Eevee' };
    expect(resolveSideChoices(battle, 'p1', [eeveeSwitch], [true]))
      .toEqual({ ok: true, command: 'switch 2' });

    const activeSwitch: BranchSlotChoice = { kind: 'switch', speciesId: 'pikachu', pokemonName: 'Pikachu' };
    const resolved = resolveSideChoices(battle, 'p1', [activeSwitch], [true]);
    expect(resolved.ok).toBe(false);
  });

  test('keeps explicit doubles targets when resolving move identities', async () => {
    const { default: doublesTeams } = await import('./fixtures/doubles-identity-fixture');
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: doublesTeams.p1Team,
      p2Team: doublesTeams.p2Team,
      replayLog: doublesTeams.log,
      targetTurn: 1,
    });
    const battle = runtime.battleStream.battle!;

    const targeted: BranchSlotChoice = { kind: 'move', moveId: 'thunderbolt', moveName: 'Thunderbolt', targetLoc: 2 };
    const passive: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };
    const resolved = resolveSideChoices(battle, 'p1', [targeted, passive], [true, true]);
    expect(resolved).toEqual({ ok: true, command: 'move 1 +2, move 2' });
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

const twoTurnLog = [
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
  '|move|p1a: Pikachu|Thunderbolt|p2a: Bulbasaur',
  '|-damage|p2a: Bulbasaur|60/100',
  '|move|p2a: Bulbasaur|Vine Whip|p1a: Pikachu',
  '|-damage|p1a: Pikachu|80/100',
  '|upkeep',
  '|turn|2',
].join('\n');

describe('branch runtime validation (B7/B17)', () => {
  test('accepts a healthy reconstruction', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 1,
    });
    expect(validateBranchRuntime(runtime)).toBeNull();
  });

  test('flags reconstructions that hit the overall deadline', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 2,
      deadlineMs: 0,
    });
    expect(runtime.timedOut).toBe(true);
    expect(validateBranchRuntime(runtime)).toContain('timed out');
  });

  test('reports progress while replaying towards the target turn', async () => {
    const progress: [number, number][] = [];
    await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 2,
      onProgress: (turn, targetTurn) => progress.push([turn, targetTurn]),
    });
    expect(progress).toContainEqual([1, 2]);
  });

  test('stops replaying when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 2,
      abort: controller.signal,
    });
    // The replay loop never ran, so the battle is still on turn 1.
    expect(runtime.battleStream.battle?.turn).toBe(1);
  });
});

describe('random-format', () => {
  const p1Team: PokemonSet[] = [
    {
      name: 'Pikachu',
      species: 'Pikachu',
      item: 'Light Ball',
      ability: 'Static',
      moves: ['Thunderbolt', 'Protect'],
      nature: 'Timid',
      evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 84,
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
      evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 84,
    },
  ];

  const randomBattleLog = [
    '|player|p1|Alice|',
    '|player|p2|Bob|',
    '|gametype|singles',
    '|gen|9',
    '|tier|[Gen 9] Random Battle',
    '|',
    '|start',
    '|switch|p1a: Pikachu|Pikachu, L84|100/100',
    '|switch|p2a: Bulbasaur|Bulbasaur, L84|100/100',
    '|turn|1',
  ].join('\n');

  describe('random battle branching (B2)', () => {
    test('starts a gen9randombattle branch with reconstructed teams and executes turns', async () => {
      const runtime = await reconstructBranchRuntime({
        format: 'gen9randombattle',
        p1Team,
        p2Team,
        replayLog: randomBattleLog,
        targetTurn: 1,
      });

      const battle = runtime.battleStream.battle;
      expect(battle).toBeTruthy();
      expect(battle!.turn).toBe(1);
      // The supplied teams must be used instead of generated random teams.
      expect(battle!.sides[0].active[0]?.name).toBe('Pikachu');
      expect(battle!.sides[1].active[0]?.name).toBe('Bulbasaur');

      const result = await executeBranchChoices({
        streams: runtime.streams,
        log: runtime.log,
        choiceErrors: runtime.choiceErrors,
        commands: [
          { side: 'p1', command: 'move 1' },
          { side: 'p2', command: 'move 1' },
        ],
      });
      expect(result.ok).toBe(true);

      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && battle!.turn < 2) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(battle!.turn).toBe(2);
    });
  });
});

await loadSimMods('gen9championsou');

type Replay = { id: string; format: string; players: string[]; log: string };
const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmbbo3-2634204248.json', import.meta.url), 'utf-8')) as Replay;

async function boundary<T>(turn: number, read: (battle: Battle) => T): Promise<T | null> {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotFor = (t: number) => snapshots[Math.min(t - 1, snapshots.length - 1)] ?? null;
  let seen: { value: T } | null = null;
  await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn: turn + 1, snapshot: snapshotFor(turn + 1),
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: { snapshotFor, onPosition: (t, battle) => { if (t === turn && !seen) seen = { value: read(battle as never) }; } },
  });
  return seen ? (seen as { value: T }).value : null;
}

describe('the sheet\'s Mawile (doubles, Champions VGC)', () => {
  test('turn 11: about 151 HP, and 15 of the 16 Flare Blitz rolls leave it alive', { timeout: 240000 }, async () => {
    const seen = await boundary(11, battle => {
      const copy = cloneBattle(battle) as Battle;
      const [attacker, defender] = [copy.sides[1].active[0], copy.sides[0].active[0]];
      const rolls: number[] = [];
      copy.randomChance = () => false;
      for (let roll = 0; roll < 16; roll++) {
        copy.random = (n?: number) => (n === 16 ? roll : 0);
        rolls.push(copy.actions.getDamage(attacker, defender, copy.dex.getActiveMove('flareblitz')) as number);
      }
      return { name: defender.species.name, hp: defender.hp, alive: rolls.filter(damage => damage < defender.hp).length };
    });
    expect(seen).not.toBeNull();
    expect(seen!.name).toBe('Mawile-Mega');
    expect(seen!.hp).toBeGreaterThanOrEqual(145);
    expect(seen!.alive).toBe(15);
  });

  test('the rebuilt game reaches turn 12 (the bank row returns)', { timeout: 240000 }, async () => {
    const seen = await boundary(12, battle => ({ ended: battle.ended }));
    expect(seen).toEqual({ ended: false });
  });
});

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

const replayLog = [
  '|j|Alpha',
  '|j|Beta',
  '|gametype|singles',
  '|player|p1|Alpha|1|',
  '|player|p2|Beta|2|',
  '|teamsize|p1|1',
  '|teamsize|p2|2',
  '|gen|9',
  '|tier|[Gen 9] Custom Game',
  '|rule|HP Percentage Mod: HP is shown in percentages',
  '|',
  '|start',
  '|switch|p1a: Snorlax|Snorlax, F|100/100',
  '|switch|p2a: Pikachu|Pikachu, F|100/100',
  '|turn|1',
  '|',
  // The real game: p2 switches to Eevee, p1 sets up with Curse. The teams
  // handed to the branch have Curse edited away, so the replayed p1 choice
  // is rejected while p2's switch is accepted and left pending.
  '|switch|p2a: Eevee|Eevee, F|100/100',
  '|move|p1a: Snorlax|Curse|p1a: Snorlax',
  '|-boost|p1a: Snorlax|atk|1',
  '|-boost|p1a: Snorlax|def|1',
  '|-unboost|p1a: Snorlax|spe|1',
  '|',
  '|upkeep',
  '|turn|2',
].join('\n');

describe('rejected replay choices', () => {
  test('a rejected protocol choice does not leave the other side\'s choice pending', async () => {
    const snapshots = parseReplayLog(replayLog);
    const snapshot = snapshots.find(entry => entry.turn === 2);
    expect(snapshot).toBeTruthy();

    // The "edited" p1 team no longer knows Curse — the move the protocol used.
    const p1Team = [makeSet('Snorlax', 'Snorlax', ['Amnesia', 'Protect'])];
    const p2Team = [
      makeSet('Pikachu', 'Pikachu', ['Protect', 'Substitute']),
      makeSet('Eevee', 'Eevee', ['Protect', 'Substitute']),
    ];

    const runtime = await reconstructBranchRuntime({
      format: 'gen9customgame',
      p1Team,
      p2Team,
      replayLog,
      targetTurn: 2,
      snapshot,
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[1].active[0]?.name).toBe('Eevee');
    // No side may enter the branch with a locked leftover choice.
    for (const side of battle.sides) {
      expect(side.isChoiceDone(), `${side.id} entered the branch with a pending choice`).toBe(false);
    }

    // The user's turn: p1 sets up, p2 switches back to Pikachu.
    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move amnesia' },
        { side: 'p2', command: 'switch 2' },
      ],
    });
    expect(result.ok).toBe(true);

    const executedTurn = runtime.log.join('\n');
    expect(executedTurn).not.toContain('already in');
    expect(executedTurn).toContain('|switch|p2a: Pikachu');
    expect(battle.sides[1].active[0]?.name).toBe('Pikachu');
  });
});

const toxicReplayLog = [
  '|j|Alpha',
  '|j|Beta',
  '|gametype|singles',
  '|player|p1|Alpha|1|',
  '|player|p2|Beta|2|',
  '|teamsize|p1|2',
  '|teamsize|p2|2',
  '|gen|3',
  '|tier|[Gen 3] Custom Game',
  '|rule|HP Percentage Mod: HP is shown in percentages',
  '|',
  '|start',
  '|switch|p1a: Machoke|Machoke, F|100/100',
  '|switch|p2a: Skarmory|Skarmory, M|100/100',
  '|turn|1',
  '|',
  '|move|p1a: Machoke|Bulk Up|p1a: Machoke',
  '|-boost|p1a: Machoke|atk|1',
  '|-boost|p1a: Machoke|def|1',
  '|move|p2a: Skarmory|Spikes|p1a: Machoke',
  '|-sidestart|p1: Alpha|Spikes',
  '|-status|p1a: Machoke|tox',
  '|',
  '|-damage|p1a: Machoke|94/100 tox|[from] psn',
  '|upkeep',
  '|turn|2',
].join('\n');

describe('status snapshot correction', () => {
  test('corrected Toxic keeps dealing residual damage in the branch', async () => {
    const snapshots = parseReplayLog(toxicReplayLog);
    const snapshot = snapshots.find(entry => entry.turn === 2);
    expect(snapshot).toBeTruthy();
    expect(snapshot!.p1.pokemon.find(pokemon => pokemon.isActive)?.status).toBe('tox');

    const { p1Team, p2Team } = buildTeamsFromReplay(toxicReplayLog);
    const runtime = await reconstructBranchRuntime({
      format: 'gen3customgame',
      p1Team,
      p2Team,
      replayLog: toxicReplayLog,
      targetTurn: 2,
      snapshot,
    });

    const machoke = runtime.battleStream.battle!.sides[0].pokemon
      .find(pokemon => pokemon.species.name === 'Machoke')!;
    expect(machoke.status).toBe('tox');
    expect(machoke.statusState.id).toBe('tox');

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move bulkup' },
        { side: 'p2', command: 'move spikes' },
      ],
    });
    expect(result.ok).toBe(true);

    const executedTurn = runtime.log.join('\n');
    expect(executedTurn).toMatch(/\|-damage\|p1a: Machoke\|\d+\/\d+ tox\|\[from\] psn/);
  });
});

const sandstormReplayLog = [
  '|j|Alpha',
  '|j|Beta',
  '|gametype|singles',
  '|player|p1|Alpha|1|',
  '|player|p2|Beta|2|',
  '|teamsize|p1|2',
  '|teamsize|p2|2',
  '|gen|3',
  '|tier|[Gen 3] Custom Game',
  '|rule|HP Percentage Mod: HP is shown in percentages',
  '|',
  '|start',
  '|switch|p1a: Machoke|Machoke, F|100/100',
  '|switch|p2a: Tyranitar|Tyranitar, M|100/100',
  '|-weather|Sandstorm|[from] ability: Sand Stream|[of] p2a: Tyranitar',
  '|turn|1',
  '|',
  // Deterministic turn 1: self-targeting moves cannot miss or KO, so the
  // sim's own damage rolls can never diverge into a forced switch here.
  '|move|p1a: Machoke|Bulk Up|p1a: Machoke',
  '|-boost|p1a: Machoke|atk|1',
  '|-boost|p1a: Machoke|def|1',
  '|move|p2a: Tyranitar|Substitute|p2a: Tyranitar',
  '|-start|p2a: Tyranitar|Substitute',
  '|-damage|p2a: Tyranitar|75/100',
  '|',
  '|-weather|Sandstorm|[upkeep]',
  '|-damage|p1a: Machoke|94/100|[from] Sandstorm',
  '|upkeep',
  '|turn|2',
].join('\n');

describe('weather snapshot correction', () => {
  test('keeps ability weather intact through branch reconstruction and residuals', async () => {
    const snapshots = parseReplayLog(sandstormReplayLog);
    const snapshot = snapshots.find(entry => entry.turn === 2);
    expect(snapshot).toBeTruthy();
    // Precondition for the whole scenario: the client snapshot uses the
    // display name, which the sim does not know as a condition.
    expect(snapshot!.field.weather).toBe('Sand');

    const { p1Team, p2Team } = buildTeamsFromReplay(sandstormReplayLog);
    const runtime = await reconstructBranchRuntime({
      format: 'gen3customgame',
      p1Team,
      p2Team,
      replayLog: sandstormReplayLog,
      targetTurn: 2,
      snapshot,
    });

    const field = runtime.battleStream.battle!.field;
    expect(field.weather).toBe('sandstorm');
    expect(field.weatherState.id).toBe('sandstorm');

    const result = await executeBranchChoices({
      streams: runtime.streams,
      log: runtime.log,
      choiceErrors: runtime.choiceErrors,
      commands: [
        { side: 'p1', command: 'move bulkup' },
        { side: 'p2', command: 'move substitute' },
      ],
    });
    expect(result.ok).toBe(true);

    const executedTurn = runtime.log.join('\n');
    expect(executedTurn).toContain('|-weather|Sandstorm|[upkeep]');
    expect(executedTurn).toMatch(/\|-damage\|p1a: Machoke\|\d+\/\d+\|\[from\] Sandstorm/);
  });
});
