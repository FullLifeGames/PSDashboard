import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { enrichTeamInfos } from '../src/team/damage-ruleouts';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonSetAssumption, SetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * One decision for panel and build (round 67, T130, decision 18): the joint
 * enrichment judges each open item against the hits its holder dealt into
 * the other side as the panel builds it, adds the refuted candidates to the
 * rule-outs, and the build reads them from the same infos. Scene 938644 t14
 * (round 64, lane D): Gholdengo's Tera-Fairy Dazzling Gleam took a
 * Moltres-Galar built Modest 252/0/0/192/0/64 from 90 % to 24 %; Metal Coat
 * reaches at most 56 % on any spread, and the build played it as the second
 * option of the Nasty Plot set's item slot.
 */

const slot = (value: string, options?: string[]): SetAssumption => ({ value, sourceDetail: 's', ...(options ? { options } : {}) });
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
const publishedSet = (species: string, item: SetAssumption, moves: SetAssumption[], nature: string, spread: ReturnType<typeof evs>): PokemonSetAssumption => ({
  species, sourceDetail: 's', item, moves, spread: { value: '', sourceDetail: 's', nature, evs: spread },
});
const usage = (species: string, items: [string, number][], moves: [string, number][], spreads: [string, ReturnType<typeof evs>, number][] = []): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  spreads: spreads.map(([nature, value, probability]) => ({ value: nature, nature, evs: value, probability, sourceDetail: 'u' })),
});

const gholdengoSets = (): PokemonSetAssumption => ({
  ...publishedSet('Gholdengo', slot('Leftovers', ['Leftovers', 'Metal Coat']),
    [slot('Protect'), slot('Nasty Plot'), slot('Make It Rain'), slot('Shadow Ball', ['Shadow Ball', 'Dazzling Gleam'])], 'Modest', evs(248, 0, 40, 112, 24, 84)),
  alternatives: [
    publishedSet('Gholdengo', slot('Choice Specs'), [slot('Make It Rain'), slot('Shadow Ball'), slot('Power Gem', ['Power Gem', 'Focus Blast']), slot('Trick')], 'Modest', evs(100, 0, 44, 252, 0, 112)),
    publishedSet('Gholdengo', slot('Choice Scarf'), [slot('Make It Rain'), slot('Shadow Ball'), slot('Thunderbolt'), slot('Trick')], 'Timid', evs(0, 0, 0, 252, 4, 252)),
  ],
});
const moltresSet = () => publishedSet('Moltres-Galar', slot('Leftovers'),
  [slot('Fiery Wrath'), slot('Nasty Plot'), slot('Air Slash'), slot('Protect')], 'Modest', evs(252, 0, 0, 192, 0, 64));
const incineroarSet = () => publishedSet('Incineroar', slot('Sitrus Berry'),
  [slot('Fake Out'), slot('Knock Off'), slot('Parting Shot'), slot('Flare Blitz')], 'Careful', evs(252, 4, 0, 0, 252, 0));

const sets: SmogonSetAssumptions = {
  format: 'gen9doublesou', source: 's',
  pokemon: { gholdengo: gholdengoSets(), moltresgalar: moltresSet(), incineroar: incineroarSet() },
};
const usageStats: SmogonUsageStats = {
  format: 'gen9doublesou', month: 'm', source: 's', pokemon: Object.fromEntries([
    usage('Gholdengo',
      [['Choice Specs', 0.252], ['Leftovers', 0.189], ['Grassy Seed', 0.188], ['Choice Scarf', 0.106], ['Life Orb', 0.088], ['Shuca Berry', 0.042],
        ['Focus Sash', 0.038], ['Metal Coat', 0.035], ['Air Balloon', 0.019]],
      [['Make It Rain', 0.99], ['Shadow Ball', 0.9], ['Protect', 0.6], ['Nasty Plot', 0.55], ['Dazzling Gleam', 0.3], ['Trick', 0.27], ['Power Gem', 0.1]],
      [['Timid', evs(4, 0, 0, 252, 0, 252), 0.133]]),
  ].map(entry => [toId(entry.species), entry])),
};

/** Turn 2 of the excerpt is 938644's turn 14: Moltres-Galar 90 % to 24 % from a Tera-Fairy spread Dazzling Gleam. */
const scene = [
  '|player|p1|Alpha|', '|player|p2|Beta|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Incineroar, M|', '|poke|p1|Moltres-Galar|', '|poke|p1|Ursaluna, F|', '|poke|p1|Sinistcha|',
  '|poke|p2|Ursaluna, M|', '|poke|p2|Gholdengo|', '|poke|p2|Sinistcha|', '|poke|p2|Moltres-Galar|',
  '|teamsize|p1|4', '|teamsize|p2|4', '|start',
  '|switch|p1a: Ignis Flame|Incineroar, M|30/100', '|switch|p1b: Black Sun|Moltres-Galar|84/100',
  '|switch|p2a: Fearless|Ursaluna, M|100/100', '|switch|p2b: Cooldown|Gholdengo, tera:Fairy|22/100',
  '|turn|1',
  '|move|p1a: Ignis Flame|Fake Out|p2a: Fearless', '|-damage|p2a: Fearless|91/100',
  '|move|p1b: Black Sun|Nasty Plot|p1b: Black Sun', '|-boost|p1b: Black Sun|spa|2',
  '|', '|-heal|p1b: Black Sun|90/100|[from] item: Leftovers', '|upkeep',
  '|turn|2',
  '|move|p2b: Cooldown|Dazzling Gleam|p1a: Ignis Flame|[spread] p1a,p1b', '|-supereffective|p1b: Black Sun',
  '|-damage|p1a: Ignis Flame|0 fnt', '|-damage|p1b: Black Sun|24/100', '|faint|p1a: Ignis Flame',
  '|-ability|p1b: Black Sun|Berserk|boost', '|-boost|p1b: Black Sun|spa|1',
  '|', '|upkeep', '|turn|3',
].join('\n');

function chain(log: string, data: { usageStats: SmogonUsageStats; setAssumptions: SmogonSetAssumptions }, species: string) {
  const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
  const infos = enrichTeamInfos(raw, data.usageStats, data.setAssumptions, {}, judgeItemsByDamage);
  const team = buildTeamsFromReplay(log, { p1Info: infos.p1, p2Info: infos.p2, ...data }).p2Team;
  const mon = infos.p2.pokemon.find(entry => entry.species === species)!;
  return { panel: mon.item.value, built: team.find(entry => entry.species === species)!.item, ruledOut: mon.ruledOut?.items ?? [] };
}

describe('938644 t14: the logged hit rules Metal Coat out for panel and build (T130)', () => {
  test('doubles: today\'s per-side enrichment plays the Nasty Plot set\'s Metal Coat', () => {
    const p2Info = enrichTeamInfo(inferOpponentTeam(scene, 'p2'), usageStats, sets);
    expect(p2Info.pokemon.find(entry => entry.species === 'Gholdengo')!.item.value).toBe('Metal Coat');
  });

  test('doubles: the joint enrichment rules Metal Coat out, and panel and build play the usage majority Choice Specs', () => {
    const { panel, built, ruledOut } = chain(scene, { usageStats, setAssumptions: sets }, 'Gholdengo');
    expect(ruledOut).toContain('metalcoat');
    expect({ panel, built }).toEqual({ panel: 'Choice Specs', built: 'Choice Specs' });
  });

  test('without a judge the joint enrichment is the per-side enrichment', () => {
    const raw = { p1: inferOpponentTeam(scene, 'p1'), p2: inferOpponentTeam(scene, 'p2') };
    expect(enrichTeamInfos(raw, usageStats, sets, {})).toEqual({
      p1: enrichTeamInfo(raw.p1, usageStats, sets), p2: enrichTeamInfo(raw.p2, usageStats, sets),
    });
  });
});

describe('singles: the same decision from a simulated game (T130)', () => {
  const BULKY = { nature: 'Calm', evs: { hp: 252, spd: 252 } };
  const mon = (species: string, item: string, ability: string, moves: string[], spread: { nature: string; evs: object }, teraType?: string): PokemonSet => ({
    name: species, species, item, ability, moves, nature: spread.nature, level: 100, gender: '', teraType,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  } as PokemonSet);

  test('a Choice Specs Gholdengo that showed only Dazzling Gleam plays Choice Specs, not the slot\'s Metal Coat', () => {
    const battle = new Battle({
      formatid: toID('gen9ou'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([mon('Moltres-Galar', 'Leftovers', 'Berserk', ['Protect', 'Nasty Plot'], BULKY)]) },
      p2: { name: 'Beta', team: Teams.pack([mon('Gholdengo', 'Choice Specs', 'Good as Gold', ['Dazzling Gleam'], { nature: 'Modest', evs: { spa: 252, spe: 252, hp: 4 } }, 'Fairy')]) },
    });
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
    battle.choose('p1', 'move nastyplot');
    battle.choose('p2', 'move dazzlinggleam terastallize');
    const lines = battle.log;
    const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
    const singlesSets: SmogonSetAssumptions = {
      format: 'gen9ou', source: 's', pokemon: {
        gholdengo: gholdengoSets(),
        moltresgalar: publishedSet('Moltres-Galar', slot('Leftovers'), [slot('Nasty Plot'), slot('Protect'), slot('Fiery Wrath'), slot('Hurricane')], 'Calm', evs(252, 0, 0, 0, 252, 4)),
      },
    };
    const { panel, built, ruledOut } = chain(log, { usageStats, setAssumptions: singlesSets }, 'Gholdengo');
    expect(ruledOut).toContain('metalcoat');
    expect({ panel, built }).toEqual({ panel: 'Choice Specs', built: 'Choice Specs' });
  });
});
