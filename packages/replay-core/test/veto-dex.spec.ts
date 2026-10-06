import { test, expect, describe } from 'vitest';
import { applyCoherenceVetoes, type MoveCandidate } from '../src/set-coherence';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import { slotMoveKey } from '../src/team/move-slots';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * Veto row 4 (round 64, T120, spec decision 15): a guessed move that
 * contradicts another move of the set by the Dex falls. Body Press reads
 * the user's Defense (`overrideOffensiveStat`), Close Combat, Superpower,
 * Headlong Rush or Clanging Scales lower it (`self.boosts`, `selfBoost`).
 * A seen move and a move of the chosen Smogon set never fall (the user gate
 * of round 63: sets as published). Row 2 (a second guessed attack of one
 * type) still runs on usage fillers only (decision 16).
 */

const guessed = (name: string): MoveCandidate => ({ name, guessed: true });
const revealed = (name: string): MoveCandidate => ({ name, guessed: false });
const fromSet = (name: string): MoveCandidate => ({ name, guessed: true, fromSet: true });
const names = (list: MoveCandidate[]) => list.map(entry => entry.name);

describe('row 4: pairs the Dex calls contradicting', () => {
  test('a guessed move that lowers the Defense a kept Body Press reads falls (Clanging Scales, Kommo-o)', () => {
    expect(names(applyCoherenceVetoes([
      revealed('Iron Defense'), guessed('Body Press'), guessed('Clanging Scales'), guessed('Protect'),
    ], { itemId: '' }))).toEqual(['Iron Defense', 'Body Press', 'Protect']);
  });

  test('of two guessed moves that contradict, the one kept first stays', () => {
    expect(names(applyCoherenceVetoes([
      guessed('Clanging Scales'), guessed('Body Press'), guessed('Protect'),
    ], { itemId: '' }))).toEqual(['Clanging Scales', 'Protect']);
  });

  test('a guessed Body Press falls beside a revealed Headlong Rush (Ursaluna)', () => {
    expect(names(applyCoherenceVetoes([
      revealed('Headlong Rush'), guessed('Body Press'), guessed('Facade'),
    ], { itemId: '' }))).toEqual(['Headlong Rush', 'Facade']);
  });

  test('a guessed Body Press falls beside a chosen-set Superpower, wherever the pool lists it', () => {
    expect(names(applyCoherenceVetoes([
      guessed('Body Press'), fromSet('Superpower'), guessed('Iron Head'),
    ], { itemId: '' }))).toEqual(['Superpower', 'Iron Head']);
  });

  test('a seen move and a chosen-set move never fall', () => {
    expect(names(applyCoherenceVetoes([revealed('Clanging Scales'), fromSet('Body Press')], { itemId: '' })))
      .toEqual(['Clanging Scales', 'Body Press']);
    expect(names(applyCoherenceVetoes([fromSet('Close Combat'), fromSet('Body Press')], { itemId: '' })))
      .toEqual(['Close Combat', 'Body Press']);
  });
});

describe('row 2 runs on usage fillers only (decision 16)', () => {
  test('two usage fillers Close Combat and Body Press keep the first', () => {
    expect(names(applyCoherenceVetoes([guessed('Close Combat'), guessed('Body Press')], { itemId: '' })))
      .toEqual(['Close Combat']);
  });

  test('the chosen set keeps Grassy Glide beside Wood Hammer, a usage Horn Leech falls (Rillaboom)', () => {
    expect(names(applyCoherenceVetoes([
      revealed('Fake Out'), fromSet('Wood Hammer'), fromSet('Grassy Glide'), guessed('Horn Leech'), guessed('U-turn'),
    ], { itemId: '' }))).toEqual(['Fake Out', 'Wood Hammer', 'Grassy Glide', 'U-turn']);
  });
});

const usage = (species: string, moves: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [], items: [],
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (...entries: PokemonUsageStats[]): SmogonUsageStats => ({
  format: 'test', month: 'm', source: 's', pokemon: Object.fromEntries(entries.map(entry => [toId(entry.species), entry])),
});

/** The app's chain without a spread solve: inferred infos, the enrichment, then the build. */
function build(log: string, species: string, usageStats: SmogonUsageStats) {
  const p2Info = enrichTeamInfo(inferOpponentTeam(log, 'p2'), usageStats, null);
  const team = buildTeamsFromReplay(log, { p2Info, usageStats, setAssumptions: null }).p2Team;
  const keys = (moves: string[]) => moves.map(slotMoveKey).sort();
  return {
    built: keys(team.find(set => set.species === species)!.moves),
    panel: keys(p2Info.pokemon.find(mon => mon.species === species)!.moves.map(move => move.name)),
  };
}
const keysOf = (...moves: string[]) => moves.map(slotMoveKey).sort();

const singles = (species: string, moves: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', `|poke|p2|${species}|item`, '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', `|switch|p2a: Mon|${species}|100/100`,
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p2a: Mon`]),
].join('\n');
const doubles = (species: string, moves: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', `|poke|p2|${species}|item`, '|poke|p2|Incineroar|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  `|switch|p2a: Mon|${species}|100/100`, '|switch|p2b: Cat|Incineroar|100/100',
  ...moves.flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p2a: Mon`]),
].join('\n');

describe('the panel and the build drop the same contradicting guess', () => {
  const kommoo = stats(usage('Kommo-o', [
    ['Body Press', 0.8], ['Clanging Scales', 0.7], ['Drain Punch', 0.6], ['Protect', 0.5], ['Taunt', 0.4],
  ]));

  test('singles: Kommo-o with Iron Defense seen keeps Body Press and loses the guessed Clanging Scales', () => {
    const { built, panel } = build(singles('Kommo-o', ['Iron Defense']), 'Kommo-o', kommoo);
    expect(built).toEqual(keysOf('Iron Defense', 'Body Press', 'Protect', 'Taunt'));
    expect(panel).toEqual(built);
  });

  test('doubles: Kommo-o with Iron Defense seen keeps Body Press and loses the guessed Clanging Scales', () => {
    const { built, panel } = build(doubles('Kommo-o', ['Iron Defense']), 'Kommo-o', kommoo);
    expect(built).toEqual(keysOf('Iron Defense', 'Body Press', 'Protect', 'Taunt'));
    expect(panel).toEqual(built);
  });
});

describe('the veto rows read their lists from the Dex (decision 17)', () => {
  test('a Choice item is what the Dex marks isChoice', () => {
    for (const itemId of ['choiceband', 'choicespecs', 'choicescarf']) {
      expect(names(applyCoherenceVetoes([guessed('Volt Switch'), guessed('Toxic')], { itemId }))).toEqual(['Volt Switch']);
    }
    expect(names(applyCoherenceVetoes([guessed('Volt Switch'), guessed('Toxic')], { itemId: 'lifeorb' })))
      .toEqual(['Volt Switch', 'Toxic']);
  });
});
