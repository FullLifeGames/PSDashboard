import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import { slotMoveKey } from '../src/team/move-slots';
import type { OpponentTeamInfo } from '../src/types';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * Set fidelity of the build (round 63, T89 with T28, spec decisions 11 and
 * 12): the chosen Smogon set's moves enter the pool before any guess, a
 * filled slot drops its other options, a short pool reaches deeper into
 * usage, and the panel's enrichment shows the set the simulator plays.
 */

const usage = (species: string, moves: [string, number][], items: [string, number][] = []): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});
const smogonSet = (species: string, moves: (string | string[])[], item: string): PokemonSetAssumption => ({
  species, sourceDetail: 's', item: { value: item, sourceDetail: 's' },
  moves: moves.map(slot => Array.isArray(slot)
    ? { value: slot[0], sourceDetail: 's', options: slot }
    : { value: slot, sourceDetail: 's' }),
});
const sets = (...entries: PokemonSetAssumption[]): SmogonSetAssumptions => ({
  format: 'test', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});

/** The app's chain without a spread solve: inferred infos, the enrichment, then the build. */
function build(log: string, species: string, usageStats: SmogonUsageStats, setAssumptions: SmogonSetAssumptions | null, info?: OpponentTeamInfo) {
  const p2Info = info ?? enrichTeamInfo(inferOpponentTeam(log, 'p2'), usageStats, setAssumptions);
  const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions }).p2Team;
  const keys = (moves: string[]) => moves.map(slotMoveKey).sort();
  return {
    built: keys(team.find(set => set.species === species)!.moves),
    panel: keys(p2Info.pokemon.find(mon => mon.species === species)!.moves.map(move => move.name)),
  };
}
const keysOf = (...moves: string[]) => moves.map(slotMoveKey).sort();

const singles = (gen: number, species: string, moves: string[], extra: string[] = []) => [
  '|player|p1|Alice|', '|player|p2|Bob|', `|gen|${gen}`, '|tier|test',
  '|poke|p1|Skarmory|item', `|poke|p2|${species}|item`, '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', `|switch|p2a: Mon|${species}|100/100`, ...extra,
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');
const doubles = (species: string, moves: string[], extra: string[] = []) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', `|poke|p2|${species}|item`, '|poke|p2|Incineroar|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  `|switch|p2a: Mon|${species}|100/100`, '|switch|p2b: Cat|Incineroar|100/100', ...extra,
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');

describe('the chosen set before every guess (T89, T28)', () => {
  test('singles, 648453: Tornadus-T builds Knock Off, not the second option Heat Wave', () => {
    const log = singles(6, 'Tornadus-Therian', ['U-turn', 'Hidden Power', 'Hurricane']);
    const usageStats = stats(usage('Tornadus-Therian', [['U-turn', 0.9], ['Hurricane', 0.9], ['Heat Wave', 0.5], ['Knock Off', 0.45], ['Hidden Power Ice', 0.4]]));
    const setAssumptions = sets(smogonSet('Tornadus-Therian', ['Hurricane', ['Heat Wave', 'Hidden Power Ice'], 'Knock Off', 'U-turn'], 'Assault Vest'));
    const { built, panel } = build(log, 'Tornadus-Therian', usageStats, setAssumptions);
    expect(built).toEqual(keysOf('U-turn', 'Hidden Power', 'Hurricane', 'Knock Off'));
    expect(panel).toEqual(built);
  });

  test('doubles: Tornadus with Rain Dance seen keeps the fixed Protect, not Taunt', () => {
    const log = doubles('Tornadus', ['Bleakwind Storm', 'Tailwind', 'Rain Dance']);
    const usageStats = stats(usage('Tornadus', [['Bleakwind Storm', 0.9], ['Tailwind', 0.9], ['Taunt', 0.6], ['Protect', 0.5], ['Rain Dance', 0.3]]));
    const setAssumptions = sets(smogonSet('Tornadus', ['Bleakwind Storm', 'Tailwind', ['Taunt', 'Rain Dance', 'Sunny Day'], 'Protect'], 'Covert Cloak'));
    const { built, panel } = build(log, 'Tornadus', usageStats, setAssumptions);
    expect(built).toEqual(keysOf('Bleakwind Storm', 'Tailwind', 'Rain Dance', 'Protect'));
    expect(panel).toEqual(built);
  });

  test('singles: the chosen set\'s second Dark attack survives row 2 in the panel and the build (Samurott-Hisui)', () => {
    const log = singles(9, 'Samurott-Hisui', ['Ceaseless Edge']);
    const usageStats = stats(usage('Samurott-Hisui', [['Ceaseless Edge', 0.9], ['Razor Shell', 0.7], ['Sacred Sword', 0.5], ['Sucker Punch', 0.45], ['Knock Off', 0.4]]));
    const setAssumptions = sets(smogonSet('Samurott-Hisui', ['Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Knock Off'], 'Assault Vest'));
    const { built, panel } = build(log, 'Samurott-Hisui', usageStats, setAssumptions);
    expect(built).toEqual(keysOf('Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Knock Off'));
    expect(panel).toEqual(built);
  });

  test('singles: a guess the enrichment left in the info stands behind the chosen set (Kyurem with Specs)', () => {
    const log = singles(9, 'Kyurem', []);
    const usageStats = stats(usage('Kyurem', [['Icicle Spear', 0.19], ['Dragon Dance', 0.16]]));
    const setAssumptions = sets(smogonSet('Kyurem', ['Ice Beam', 'Freeze-Dry', 'Earth Power', 'Draco Meteor'], 'Choice Specs'));
    const info = inferOpponentTeam(log, 'p2');
    info.pokemon[0].moves.push({ name: 'Icicle Spear', source: 'guessed' });
    const { built } = build(log, 'Kyurem', usageStats, setAssumptions, info);
    expect(built).toEqual(keysOf('Ice Beam', 'Freeze-Dry', 'Earth Power', 'Draco Meteor'));
  });

  test('doubles: a short pool reaches past the first ten usage moves (Latios with Choice Scarf)', () => {
    const log = doubles('Latios', ['Draco Meteor', 'Ice Beam'], ['|-item|p2a: Mon|Choice Scarf|[from] ability: Frisk|[of] p1a: Skarmory']);
    const usageStats = stats(usage('Latios', [
      ['Heal Pulse', 0.7], ['Simple Beam', 0.62], ['Ally Switch', 0.61], ['Dragon Cheer', 0.49], ['Luster Purge', 0.32],
      ['Draco Meteor', 0.2], ['Dragon Pulse', 0.19], ['Protect', 0.15], ['Tailwind', 0.11], ['Icy Wind', 0.09],
      ['Psyshock', 0.08], ['Thunderbolt', 0.07],
    ]));
    const { built, panel } = build(log, 'Latios', usageStats, null);
    expect(built).toEqual(keysOf('Draco Meteor', 'Ice Beam', 'Luster Purge', 'Thunderbolt'));
    expect(panel).toEqual(built);
  });

  test('singles: an item knocked off or consumed still picks its set (Dragonite\'s Choice Band keeps Outrage)', () => {
    // Gen 9 previews carry no item marker.
    const log = singles(9, 'Dragonite', ['Ice Spinner'], ['|-enditem|p2a: Mon|Choice Band|[from] move: Knock Off|[of] p1a: Skarmory'])
      .replace('|poke|p2|Dragonite|item', '|poke|p2|Dragonite|');
    const usageStats = stats(usage('Dragonite', [['Earthquake', 0.77], ['Dragon Dance', 0.75], ['Extreme Speed', 0.67], ['Roost', 0.56], ['Ice Spinner', 0.33], ['Fire Punch', 0.21], ['Outrage', 0.14]]));
    const setAssumptions = sets({
      ...smogonSet('Dragonite', ['Dragon Dance', ['Extreme Speed', 'Ice Spinner'], 'Earthquake', ['Ice Spinner', 'Roost', 'Encore']], 'Heavy-Duty Boots'),
      alternatives: [smogonSet('Dragonite', ['Outrage', 'Extreme Speed', ['Earthquake', 'Ice Spinner'], ['Fire Punch', 'Ice Spinner']], 'Choice Band')],
    });
    const { built, panel } = build(log, 'Dragonite', usageStats, setAssumptions);
    expect(built).toEqual(keysOf('Ice Spinner', 'Outrage', 'Extreme Speed', 'Fire Punch'));
    expect(panel).toEqual(built);
  });

  test('doubles: a forme without its own usage entry reads its base when the Dex says they battle alike (Gastrodon-East)', () => {
    const log = doubles('Gastrodon-East', ['Ice Beam', 'Earth Power']);
    const usageStats = stats(usage('Gastrodon', [['Recover', 0.8], ['Earth Power', 0.7], ['Ice Beam', 0.6], ['Clear Smog', 0.5], ['Protect', 0.4]]));
    const { built, panel } = build(log, 'Gastrodon-East', usageStats, null);
    expect(built).toEqual(keysOf('Ice Beam', 'Earth Power', 'Recover', 'Clear Smog'));
    expect(panel).toEqual(built);
  });

  test('singles: Maushold-Four reads Maushold\'s usage; Rotom-Wash never reads Rotom\'s', () => {
    const maushold = build(singles(9, 'Maushold-Four', ['Tidy Up']), 'Maushold-Four',
      stats(usage('Maushold', [['Population Bomb', 0.9], ['Tidy Up', 0.8], ['Bite', 0.6], ['Protect', 0.5], ['Encore', 0.3]])), null);
    expect(maushold.built).toEqual(keysOf('Tidy Up', 'Population Bomb', 'Bite', 'Protect'));
    // Rotom-Wash differs from Rotom in type and stats: Rotom's moves would be a different Pokémon's.
    const rotom = build(singles(9, 'Rotom-Wash', ['Hydro Pump']), 'Rotom-Wash',
      stats(usage('Rotom', [['Shadow Ball', 0.9], ['Thunderbolt', 0.8], ['Will-O-Wisp', 0.6], ['Nasty Plot', 0.5]])), null);
    expect(rotom.built).toEqual(keysOf('Hydro Pump'));
  });

  // Review of round 63: the usage tail joined row 1's boost context, so a
  // boost at a fraction of a percent struck the guessed special attacks of
  // every set no chosen Smogon set covered.
  const tail = (top: [string, number][]): [string, number][] => [...top, ['Dragon Dance', 0.002], ['Swords Dance', 0.001]];

  test('singles: a boost in the usage tail leaves Kingdra its special attacks', () => {
    const log = singles(9, 'Kingdra', ['Hydro Pump']);
    const usageStats = stats(usage('Kingdra', tail([
      ['Hydro Pump', 0.9], ['Draco Meteor', 0.8], ['Weather Ball', 0.6], ['Hurricane', 0.5], ['Rain Dance', 0.3],
      ['Protect', 0.2], ['Surf', 0.15], ['Ice Beam', 0.1], ['Flip Turn', 0.08], ['Focus Energy', 0.05],
    ]), [['Life Orb', 0.6]]));
    const { built, panel } = build(log, 'Kingdra', usageStats, null);
    expect(built).toEqual(keysOf('Hydro Pump', 'Draco Meteor', 'Weather Ball', 'Hurricane'));
    expect(panel).toEqual(built);
  });

  test('doubles: a boost in the usage tail leaves Kyurem with Life Orb its special attacks', () => {
    const log = doubles('Kyurem', ['Freeze-Dry']);
    const usageStats = stats(usage('Kyurem', tail([
      ['Freeze-Dry', 0.9], ['Earth Power', 0.8], ['Draco Meteor', 0.7], ['Flash Cannon', 0.5], ['Protect', 0.4],
      ['Icy Wind', 0.3], ['Blizzard', 0.2], ['Glaciate', 0.1], ['Ice Beam', 0.08], ['Substitute', 0.05],
    ]), [['Life Orb', 0.6]]));
    const { built, panel } = build(log, 'Kyurem', usageStats, null);
    expect(built).toEqual(keysOf('Freeze-Dry', 'Earth Power', 'Draco Meteor', 'Flash Cannon'));
    expect(panel).toEqual(built);
  });

  test('fewer than four moves only when the pool holds fewer than four allowed ones (no usage, no set)', () => {
    const log = singles(9, 'Decidueye', ['Shadow Sneak', 'Swords Dance']);
    const { built } = build(log, 'Decidueye', stats(), null);
    expect(built).toEqual(keysOf('Shadow Sneak', 'Swords Dance'));
  });
});
