import { test, expect } from '@playwright/test';
import { BattleStreams, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchState } from '../packages/eval-engine/src/branch-engine';
import {
  fillUsageMoves,
  getSpeciesUsageSet,
  parseSmogonChaosStats,
} from '../src/lib/smogon-stats';

const SAMPLE_CHAOS = {
  info: {
    metagame: 'gen9ou',
    cutoff: 0,
    'cutoff deviation': 0,
  },
  data: {
    'Great Tusk': {
      'Raw count': 100,
      Abilities: {
        Protosynthesis: 100,
      },
      Items: {
        'Booster Energy': 70,
        Leftovers: 30,
      },
      Moves: {
        'Headlong Rush': 90,
        'Rapid Spin': 80,
        'Ice Spinner': 40,
        'Close Combat': 30,
        Earthquake: 10,
      },
      Spreads: {
        'Jolly:0/252/4/0/0/252': 60,
        'Impish:252/0/252/0/4/0': 40,
      },
    },
  },
};

async function waitForBattle(
  stream: BattleStreams.BattleStream,
  predicate: (battle: NonNullable<BattleStreams.BattleStream['battle']>) => boolean,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1500) {
    if (stream.battle && predicate(stream.battle)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for battle state');
}

async function createDoublesBattle() {
  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const log: string[] = [];

  void (async () => {
    for await (const chunk of streams.omniscient) {
      log.push(...chunk.split('\n').filter(line => line.trim()));
    }
  })();

  const p1Team: PokemonSet[] = [
    {
      name: 'Amoonguss',
      species: 'Amoonguss',
      ability: 'Regenerator',
      item: 'Sitrus Berry',
      moves: ['Spore', 'Pollen Puff', 'Rage Powder', 'Protect'],
      nature: 'Calm',
      evs: { hp: 252, atk: 0, def: 0, spa: 4, spd: 252, spe: 0 },
      gender: '',
      level: 100,
    },
    {
      name: 'Incineroar',
      species: 'Incineroar',
      ability: 'Intimidate',
      item: 'Safety Goggles',
      moves: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Protect'],
      nature: 'Careful',
      evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 252, spe: 0 },
      gender: '',
      level: 100,
    },
    {
      name: 'Rillaboom',
      species: 'Rillaboom',
      ability: 'Grassy Surge',
      item: 'Assault Vest',
      moves: ['Fake Out', 'Wood Hammer', 'Grassy Glide', 'U-turn'],
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      gender: '',
      level: 100,
    },
    {
      name: 'Flutter Mane',
      species: 'Flutter Mane',
      ability: 'Protosynthesis',
      item: 'Booster Energy',
      moves: ['Moonblast', 'Shadow Ball', 'Dazzling Gleam', 'Protect'],
      nature: 'Timid',
      evs: { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 },
      gender: '',
      level: 100,
    },
  ];
  const p2Team = p1Team.map(set => ({ ...set, name: `${set.name} 2` }));

  const command = [
    '>start {"formatid":"gen9doublesou"}',
    `>player p1 {"name":"Player 1","team":"${Teams.pack(p1Team)}"}`,
    `>player p2 {"name":"Player 2","team":"${Teams.pack(p2Team)}"}`,
  ].join('\n');

  void streams.omniscient.write(command);
  await waitForBattle(battleStream, battle => !!battle.sides[0] && !!battle.sides[1]);
  void streams.omniscient.write('>p1 default\n>p2 default');
  await waitForBattle(battleStream, battle => battle.requestState === 'move');

  return { battleStream, log };
}

test.describe('usage stats and doubles support', () => {
  test('parses Smogon chaos stats into probability-backed guesses', () => {
    const stats = parseSmogonChaosStats(SAMPLE_CHAOS, {
      format: 'gen9ou',
      month: '2026-03',
    });

    const usageSet = getSpeciesUsageSet(stats, 'Great Tusk');

    expect(usageSet?.ability).toMatchObject({
      value: 'Protosynthesis',
      probability: 1,
    });
    expect(usageSet?.item).toMatchObject({
      value: 'Booster Energy',
      probability: 0.7,
    });
    expect(fillUsageMoves('Great Tusk', [{ name: 'Rapid Spin', source: 'revealed' }], stats))
      .toEqual([
        { name: 'Rapid Spin', source: 'revealed' },
        { name: 'Headlong Rush', source: 'guessed', probability: 0.9, sourceDetail: 'Smogon gen9ou 2026-03' },
        { name: 'Ice Spinner', source: 'guessed', probability: 0.4, sourceDetail: 'Smogon gen9ou 2026-03' },
        { name: 'Close Combat', source: 'guessed', probability: 0.3, sourceDetail: 'Smogon gen9ou 2026-03' },
      ]);
  });

  test('exposes doubles active slots and slot-specific choices', async () => {
    const { battleStream, log } = await createDoublesBattle();
    const state = createBranchState(battleStream, log, {
      p1Choice: null,
      p2Choice: null,
    });

    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Amoonguss', 'Incineroar']);
    expect(state.p2ActiveSlots.map(active => active?.species)).toEqual(['Amoonguss', 'Incineroar']);
    expect(state.p1MovesBySlot).toHaveLength(2);
    expect(state.p2MovesBySlot).toHaveLength(2);
    expect(state.p1MovesBySlot[0][0]).toMatchObject({ name: 'Spore', activeSlot: 0, slot: 1 });
    expect(state.p1MovesBySlot[1][0]).toMatchObject({ name: 'Fake Out', activeSlot: 1, slot: 1 });
    expect(state.p1Choices).toEqual([null, null]);
    expect(state.p2Choices).toEqual([null, null]);
  });
});
