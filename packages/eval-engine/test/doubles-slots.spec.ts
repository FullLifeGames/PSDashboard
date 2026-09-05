import { test, expect, describe } from 'vitest';
import { BattleStreams, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchState } from '../src/branch-engine';

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

describe('usage stats and doubles support', () => {
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
