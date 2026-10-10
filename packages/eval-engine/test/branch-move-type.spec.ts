import { describe, expect, test } from 'vitest';
import { BattleStreams, Teams } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createBranchState, createBranchStateFromBattle } from '../src/branch/state';
import { clickTera, set, singles } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 67 (T85): a move button carries the type the move lands with, asked
 * from the simulator on the active body (the move's own ModifyType, then
 * everyone's, the order of battle-actions useMoveInner), never the catalog
 * type: Ivy Cudgel follows the mask, Tera Blast the Tera type after the
 * click, the -ate family and Liquid Voice their abilities. Live and stored
 * positions share the code (createBranchState hands its stream's battle on).
 */
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

const typesOf = (battle: Battle, side: 'p1' | 'p2' = 'p1', slot = 0) =>
  Object.fromEntries(createBranchStateFromBattle(battle, [], {})[`${side}MovesBySlot`][slot].map(move => [move.name, move.type]));

async function liveSingles(p1: PokemonSet[], p2: PokemonSet[]): Promise<BattleStreams.BattleStream> {
  const stream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(stream);
  void (async () => {
    for await (const chunk of streams.omniscient) void chunk;
  })();
  void streams.omniscient.write([
    '>start {"formatid":"gen9customgame"}',
    `>player p1 {"name":"Alpha","team":"${Teams.pack(p1)}"}`,
    `>player p2 {"name":"Beta","team":"${Teams.pack(p2)}"}`,
  ].join('\n'));
  const startedAt = Date.now();
  while (!stream.battle?.sides[1]?.active[0] && Date.now() - startedAt < 1500) await new Promise(resolve => setTimeout(resolve, 10));
  if (stream.battle?.requestState === 'teampreview') void streams.omniscient.write('>p1 default\n>p2 default');
  while (stream.battle?.requestState !== 'move' && Date.now() - startedAt < 3000) await new Promise(resolve => setTimeout(resolve, 10));
  return stream;
}

describe('move buttons show the type at use (T85)', () => {
  test('singles: Ivy Cudgel follows the mask; Pixilate and Liquid Voice follow the ability', () => {
    const battle = singles('gen9customgame',
      [set('Ogerpon-Wellspring', ['ivycudgel', 'hornleech'], { item: 'Wellspring Mask' })],
      [set('Sylveon', ['hypervoice', 'shadowball', 'protect'], { ability: 'Pixilate' })]);
    expect(typesOf(battle)).toEqual({ 'Ivy Cudgel': 'Water', 'Horn Leech': 'Grass' });
    // Pixilate turns every Normal move Fairy, a status move like Protect included.
    expect(typesOf(battle, 'p2')).toEqual({ 'Hyper Voice': 'Fairy', 'Shadow Ball': 'Ghost', Protect: 'Fairy' });
  });

  test('Tera Blast reads Normal before the click and the Tera type after it', () => {
    const battle = singles('gen9customgame', [set('Garchomp', ['splash', 'terablast'], { teraType: 'Fairy' })], [splash('Snorlax')]);
    expect(typesOf(battle)['Tera Blast']).toBe('Normal');
    clickTera(battle, 0);
    expect(typesOf(battle)['Tera Blast']).toBe('Fairy');
  });

  test('doubles: each slot list carries its own body\'s types', () => {
    const battle = battleOf('gen9doublescustomgame',
      [set('Ogerpon-Hearthflame', ['ivycudgel'], { item: 'Hearthflame Mask' }), set('Primarina', ['hypervoice', 'moonblast'], { ability: 'Liquid Voice' })],
      [splash('Snorlax'), splash('Blissey')]);
    expect(typesOf(battle, 'p1', 0)).toEqual({ 'Ivy Cudgel': 'Fire' });
    expect(typesOf(battle, 'p1', 1)).toEqual({ 'Hyper Voice': 'Water', Moonblast: 'Fairy' });
  });

  test('the live path labels like the stored path', async () => {
    const stream = await liveSingles([set('Ogerpon-Cornerstone', ['ivycudgel'], { item: 'Cornerstone Mask' })], [splash('Snorlax')]);
    const live = createBranchState(stream, [], {});
    expect(live.p1MovesBySlot[0].map(move => move.type)).toEqual(['Rock']);
    expect(live.p1MovesBySlot[0]).toEqual(createBranchStateFromBattle(stream.battle, [], {}).p1MovesBySlot[0]);
  });

  test('asking the simulator writes nothing to the log of a custom game, which runs in debug mode', () => {
    const battle = singles('gen9customgame', [set('Garchomp', ['earthquake', 'tackle'])], [splash('Snorlax')]);
    // Electrify's handler retypes the move and writes a debug line when asked.
    battle.sides[0].active[0].addVolatile('electrify');
    const before = battle.log.length;
    expect(typesOf(battle)).toEqual({ Earthquake: 'Electric', Tackle: 'Electric' });
    expect(battle.log.length).toBe(before);
  });
});
