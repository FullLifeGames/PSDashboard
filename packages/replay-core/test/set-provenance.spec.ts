import { test, expect, describe } from 'vitest';
import { applyCoherenceVetoes, type MoveCandidate } from '../src/set-coherence';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * Published sets as published (round 67, T131, decision 20): the veto rule's
 * item rows strike guessed status moves under a Choice item or Assault Vest,
 * because the item may come from elsewhere (an inferred Scarf). When the item
 * is the chosen set's own, the set's moves stand: Ditto's Choice Scarf set
 * keeps Transform, Jirachi's Healing Wish. Build and panel both pass where
 * the item came from.
 */

const fromSet = (name: string): MoveCandidate => ({ name, guessed: true, fromSet: true });
const names = (moves: MoveCandidate[]) => moves.map(move => move.name);

describe('the item rows spare the chosen set\'s moves under its own item', () => {
  test('singles: Ditto\'s Choice Scarf set keeps Transform, Jirachi\'s keeps Healing Wish', () => {
    expect(names(applyCoherenceVetoes([fromSet('Transform')], { itemId: 'choicescarf', itemFromSet: true }))).toEqual(['Transform']);
    expect(names(applyCoherenceVetoes([fromSet('Iron Head'), fromSet('U-turn'), fromSet('Healing Wish'), fromSet('Trick')], { itemId: 'choicescarf', itemFromSet: true })))
      .toEqual(['Iron Head', 'U-turn', 'Healing Wish', 'Trick']);
  });

  test('doubles: Zapdos-Galar\'s Choice Scarf set keeps Coaching, an Assault Vest set its status move', () => {
    expect(names(applyCoherenceVetoes([fromSet('Thunderous Kick'), fromSet('Brave Bird'), fromSet('Coaching')], { itemId: 'choicescarf', itemFromSet: true })))
      .toEqual(['Thunderous Kick', 'Brave Bird', 'Coaching']);
    expect(names(applyCoherenceVetoes([fromSet('Fake Out'), fromSet('Taunt')], { itemId: 'assaultvest', itemFromSet: true }))).toEqual(['Fake Out', 'Taunt']);
  });

  test('an item from elsewhere still strikes: the set\'s status move falls under an inferred Scarf', () => {
    expect(names(applyCoherenceVetoes([fromSet('Iron Head'), fromSet('Healing Wish')], { itemId: 'choicescarf', itemFromSet: false }))).toEqual(['Iron Head']);
    expect(names(applyCoherenceVetoes([fromSet('Iron Head'), fromSet('Healing Wish')], { itemId: 'choicescarf' }))).toEqual(['Iron Head']);
  });

  test('a guessed status move outside the set still falls under the set\'s own Choice item', () => {
    const usageFill: MoveCandidate = { name: 'Calm Mind', guessed: true };
    expect(names(applyCoherenceVetoes([fromSet('Iron Head'), usageFill], { itemId: 'choicescarf', itemFromSet: true }))).toEqual(['Iron Head']);
  });
});

const usage = (species: string, items: [string, number][], moves: [string, number][]): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [], spreads: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const published = (species: string, item: string, moves: string[]): PokemonSetAssumption => ({
  species, sourceDetail: 's', item: { value: item, sourceDetail: 's' }, moves: moves.map(value => ({ value, sourceDetail: 's' })),
});
const jirachiStats: SmogonUsageStats = {
  format: 'gen6ou', month: 'm', source: 's', pokemon: Object.fromEntries([
    usage('Jirachi', [['Leftovers', 0.6], ['Choice Scarf', 0.3]], [['Iron Head', 0.9], ['U-turn', 0.8], ['Healing Wish', 0.5], ['Trick', 0.4], ['Stealth Rock', 0.4]]),
  ].map(entry => [toId(entry.species), entry])),
};

/** A Jirachi that only showed Iron Head (a second move would disprove the Choice lock): the published Choice Scarf set is the evidence's pick. */
const jirachiLog = (doubles: boolean) => [
  '|player|p1|Alpha|', '|player|p2|Beta|', ...(doubles ? ['|gametype|doubles'] : []), '|gen|6', `|tier|[Gen 6] ${doubles ? 'Doubles OU' : 'OU'}`,
  '|poke|p1|Blissey, F|', '|poke|p1|Chansey, F|', '|poke|p2|Jirachi|', '|poke|p2|Skarmory, F|', '|start',
  '|switch|p1a: Blissey|Blissey, F|100/100', ...(doubles ? ['|switch|p1b: Chansey|Chansey, F|100/100'] : []),
  '|switch|p2a: Jirachi|Jirachi|100/100', ...(doubles ? ['|switch|p2b: Skarmory|Skarmory, F|100/100'] : []),
  '|turn|1', '|move|p2a: Jirachi|Iron Head|p1a: Blissey', '|-damage|p1a: Blissey|80/100',
  '|turn|2', '|move|p2a: Jirachi|Iron Head|p1a: Blissey', '|-damage|p1a: Blissey|60/100', '|turn|3',
].join('\n');

describe('build and panel pass the item\'s provenance (T131)', () => {
  const sets = (item: string): SmogonSetAssumptions => ({
    format: 'gen6ou', source: 's', pokemon: { jirachi: published('Jirachi', item, ['Iron Head', 'U-turn', 'Healing Wish', 'Trick']) },
  });

  test.each([['singles', false], ['doubles', true]])('%s: the Choice Scarf set plays Healing Wish in the panel and the build', (_, doubles) => {
    const log = jirachiLog(doubles as boolean);
    const p2Info = enrichTeamInfo(inferOpponentTeam(log, 'p2'), jirachiStats, sets('Choice Scarf'));
    const panel = p2Info.pokemon.find(mon => mon.species === 'Jirachi')!;
    expect(panel.item.value).toBe('Choice Scarf');
    expect(panel.moves.map(move => move.name)).toContain('Healing Wish');
    const built = buildTeamsFromReplay(log, { p2Info, usageStats: jirachiStats, setAssumptions: sets('Choice Scarf') }).p2Team;
    expect(built.find(set => set.species === 'Jirachi')!.moves).toContain('Healing Wish');
  });
});
