import { readFileSync } from 'node:fs';
import { test, expect, describe } from 'vitest';
import {
  rulesDex,
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
  type RevealedPokemonInfo,
  type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet, Dex } from '@pkmn/sim';
import { buildChoiceLockContext, buildChoiceLockTrails, corroborateChoiceItem, protocolChoiceLock } from '../src/choice-lock';
import { correctActivesFromProtocol, reconstructBranchRuntime } from '../src/branch-engine';
import { serializeBattleStable } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * The board holds the items the protocol shows. Every item line makes a body's item known (a move's, an ability's, the item's own); an
 * item the sim's move or ability took from a body the protocol never touched comes back; and the team preview's "(has item)" marker
 * says only that a body holds something, so a guessed Choice item behind it still has to survive the damage check.
 */

const log = (lines: string[]) => lines.join('\n');

const set = (species: string, item: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability: 'No Ability', moves,
  nature: 'Hardy',
  evs: { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 4 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

describe('the preview marker is no reveal (point 1)', () => {
  // The 0.55 Hydro Pump fraction sits inside the unboosted band and outside the Choice Specs band (choice-lock.spec.ts measures the bands).
  const teams = {
    p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
    p2Team: [set('Mew', '', ['Protect'])],
  };
  const observations = [{
    attackerSpecies: 'Keldeo', defenderSpecies: 'Mew', attackerSide: 'p1' as const,
    moveId: 'hydropump', observedFraction: 0.55, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }];
  const gen6Log = (extra: string[]) => log([
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
    '|poke|p1|Keldeo|item', '|poke|p2|Mew|item',
    '|start',
    '|switch|p1a: Keldeo|Keldeo|100/100',
    '|switch|p2a: Mew|Mew|100/100',
    '|turn|1',
    ...extra,
  ]);

  test('a contradicted guessed Choice item behind the marker loses eligibility', () => {
    const context = buildChoiceLockContext(gen6Log([]), teams, observations);
    expect(context.eligibility.p1['keldeo']).toBe(false);
  });

  test('a Choice item the log shows stays eligible against the same damage record', () => {
    const context = buildChoiceLockContext(gen6Log([
      '|move|p2a: Mew|Knock Off|p1a: Keldeo',
      '|-enditem|p1a: Keldeo|Choice Specs|[from] move: Knock Off|[of] p2a: Mew',
      '|turn|2',
    ]), teams, observations);
    expect(context.eligibility.p1['keldeo']).toBe(true);
  });

  test('649664: Keldeo\'s guessed Choice Specs gets the damage check', () => {
    const replay = JSON.parse(readFileSync(new URL('./fixtures/smogtours-gen6ou-649664.json', import.meta.url), 'utf-8')) as { log: string };
    const { observations: seen, speedOrders } = parseReplayLogWithObservations(replay.log);
    const usageStats = JSON.parse(readFileSync(new URL('./fixtures/usage-gen6ou-649664.json', import.meta.url), 'utf-8')) as SmogonUsageStats;
    const built = buildTeamsFromReplay(replay.log, { observations: seen, speedOrders, usageStats });
    const keldeo = built.p1Team.find(entry => entry.species === 'Keldeo')!;
    expect(keldeo.item).toBe('Choice Specs');
    // The team preview marks Keldeo as holding something; the build guessed Choice Specs. Its 60% Hydro Pump into Tornadus-Therian fits
    // Specs only if Tornadus holds the Assault Vest the build guessed for it, so the record is ambiguous; where the log rules that Vest
    // out, the damage record contradicts the Specs.
    const tornadus = built.p2Team.find(entry => entry.species === 'Tornadus-Therian')!;
    expect(tornadus.item).toBe('Assault Vest');
    const field = (value: string) => ({ value, source: 'unknown', probability: 1 }) as RevealedPokemonInfo['item'];
    const noVest = { p1: { pokemon: [] }, p2: { pokemon: [{
      species: 'Tornadus-Therian', moves: [], ability: field(''), item: field(''), teraType: field(''),
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, level: 100, gender: '', ruledOut: { abilities: [], items: ['assaultvest'] },
    } as unknown as RevealedPokemonInfo] } };
    expect(corroborateChoiceItem('p1', 'Keldeo', keldeo.item, built, seen, 6)).toBe('ambiguous');
    expect(corroborateChoiceItem('p1', 'Keldeo', keldeo.item, built, seen, 6, undefined, noVest)).toBe('contradicted');
    expect(buildChoiceLockContext(replay.log, built, seen).eligibility.p1['keldeo']).toBe(true);
  });
});

describe('the walk knows every item line (points 3 and 4)', () => {
  const heldAt = (lines: string[], turn: number) => buildChoiceLockContext(log(lines), { p1Team: [], p2Team: [] }, []).heldItems.get(turn);
  const start = ['|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU', '|start'];

  test('a balloon announcement, a popped balloon and an eaten berry make the items known', () => {
    const lines = [
      ...start,
      '|switch|p1a: Bal|Heatran, M|100/100',
      '|-item|p1a: Bal|Air Balloon',
      '|switch|p2a: Pao|Chien-Pao|100/100',
      '|turn|1',
      '|move|p2a: Pao|Sacred Sword|p1a: Bal',
      '|-damage|p1a: Bal|60/100',
      '|-enditem|p1a: Bal|Air Balloon',
      '|move|p1a: Bal|Magma Storm|p2a: Pao',
      '|-damage|p2a: Pao|40/100',
      '|-enditem|p2a: Pao|Sitrus Berry|[eat]',
      '|upkeep',
      '|turn|2',
    ];
    expect(heldAt(lines, 1)).toEqual([
      { side: 'p1', species: 'Heatran', item: 'airballoon', firstMove: null, touched: true },
      { side: 'p2', species: 'Chien-Pao', item: null, firstMove: null, touched: false },
    ]);
    expect(heldAt(lines, 2)).toEqual([
      { side: 'p1', species: 'Heatran', item: '', firstMove: 'magmastorm', touched: true },
      { side: 'p2', species: 'Chien-Pao', item: '', firstMove: 'sacredsword', touched: true },
    ]);
  });

  test('Pickpocket and Magician hand an item over: the receiver starts a new trail, the giver holds nothing', () => {
    const lines = [
      ...start,
      '|switch|p1a: Thief|Weavile, M|100/100',
      '|switch|p2a: Wall|Ferrothorn, M|100/100',
      '|turn|1',
      '|move|p1a: Thief|Ice Shard|p2a: Wall',
      '|move|p2a: Wall|Power Whip|p1a: Thief',
      '|-enditem|p2a: Wall|Choice Band|[silent]|[from] ability: Pickpocket|[of] p2a: Wall',
      '|-item|p1a: Thief|Choice Band|[from] ability: Pickpocket|[of] p2a: Wall',
      '|upkeep',
      '|turn|2',
      '|switch|p1a: Key|Klefki, F|100/100',
      '|move|p1a: Key|Flash Cannon|p2a: Wall',
      '|-item|p1a: Key|Choice Scarf|[from] ability: Magician|[of] p2a: Wall',
      '|upkeep',
      '|turn|3',
      '|switch|p1a: Thief|Weavile, M|100/100',
      '|move|p1a: Thief|Knock Off|p2a: Wall',
      '|upkeep',
      '|turn|4',
    ];
    expect(heldAt(lines, 2)).toEqual([
      { side: 'p1', species: 'Weavile', item: 'choiceband', firstMove: null, touched: true },
      { side: 'p2', species: 'Ferrothorn', item: '', firstMove: 'powerwhip', touched: true },
    ]);
    // Magician writes no line for the giver; the [of] body loses the Scarf it
    // never showed (the walk had it empty already, so it stays untouched).
    expect(heldAt(lines, 3)).toEqual([
      { side: 'p1', species: 'Weavile', item: 'choiceband', firstMove: null, touched: false },
      { side: 'p2', species: 'Ferrothorn', item: '', firstMove: 'powerwhip', touched: false },
      { side: 'p1', species: 'Klefki', item: 'choicescarf', firstMove: null, touched: true },
    ]);
    const trails = buildChoiceLockTrails(log(lines));
    expect(trails.p1.get(2)).toMatchObject({ handedItem: 'choiceband', moves: [] });
    expect(heldAt(lines, 4)?.[0]).toEqual({ side: 'p1', species: 'Weavile', item: 'choiceband', firstMove: 'knockoff', touched: false });
  });

  test('a Pickpocket-handed Choice item locks the receiver\'s next move like a Trick', () => {
    const trails = buildChoiceLockTrails(log([
      ...start,
      '|switch|p1a: Thief|Weavile, M|100/100',
      '|switch|p2a: Wall|Ferrothorn, M|100/100',
      '|turn|1',
      '|move|p1a: Thief|Ice Shard|p2a: Wall',
      '|move|p2a: Wall|Power Whip|p1a: Thief',
      '|-enditem|p2a: Wall|Choice Band|[silent]|[from] ability: Pickpocket|[of] p2a: Wall',
      '|-item|p1a: Thief|Choice Band|[from] ability: Pickpocket|[of] p2a: Wall',
      '|upkeep',
      '|turn|2',
      '|move|p1a: Thief|Knock Off|p2a: Wall',
      '|upkeep',
      '|turn|3',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 3, rulesDex(9))).toEqual({ species: 'Weavile', moveId: 'knockoff', handedOver: true });
  });

  test('a Frisk reveal keeps the holder\'s trail and leaves the frisker\'s item alone', () => {
    // Gourgeist can have Frisk too: the line still names Spy's Frisk, not a hand-over to Gourgeist.
    const lines = [
      ...start,
      '|switch|p1a: Pump|Gourgeist, M|100/100',
      '|switch|p2a: Doll|Banette, F|100/100',
      '|turn|1',
      '|move|p1a: Pump|Poltergeist|p2a: Doll',
      '|-damage|p2a: Doll|10/100',
      '|move|p2a: Doll|Shadow Sneak|p1a: Pump',
      '|-damage|p1a: Pump|90/100',
      '|upkeep',
      '|turn|2',
      '|',
      '|switch|p2a: Spy|Banette, M|100/100',
      '|-item|p1a: Pump|Choice Scarf|[from] ability: Frisk|[of] p2a: Spy',
      '|upkeep',
      '|turn|3',
    ];
    expect(heldAt(lines, 3)).toEqual([
      { side: 'p1', species: 'Gourgeist', item: 'choicescarf', firstMove: 'poltergeist', touched: true },
      { side: 'p2', species: 'Banette', item: null, firstMove: 'shadowsneak', touched: false },
      { side: 'p2', species: 'Banette', item: null, firstMove: null, touched: false },
    ]);
    expect(protocolChoiceLock(buildChoiceLockTrails(log(lines)), 'p1', 3, rulesDex(9))).toEqual({ species: 'Gourgeist', moveId: 'poltergeist' });
  });
});

function simLog(format: string, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][] = []): string {
  const battle = new LiveBattle({
    formatid: format as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alice', team: Teams.pack(p1) }, p2: { name: 'Bob', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  for (const [p1Choice, p2Choice] of turns) {
    battle.choose('p1', p1Choice);
    battle.choose('p2', p2Choice);
  }
  return battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|')).join('\n');
}

const simSet = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', gender: '', level: 100,
  evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

describe('a Frisk the simulator writes leaves the frisker\'s item alone (round 64 review)', () => {
  const eligibility = { p1: {}, p2: {} };

  test('singles: Dusknoir frisks a Gourgeist that could have Frisk itself and keeps its Leftovers', () => {
    const p1 = [simSet('Dusknoir', 'Leftovers', 'Frisk', ['Shadow Sneak'])];
    const p2 = [simSet('Gourgeist', 'Sitrus Berry', 'Insomnia', ['Shadow Sneak'])];
    const replayLog = simLog('gen9customgame', p1, p2);
    expect(replayLog).toContain('|-item|p2a: Gourgeist|Sitrus Berry|[from] ability: Frisk|[of] p1a: Dusknoir');
    const context = { ...buildChoiceLockContext(replayLog, { p1Team: [], p2Team: [] }, []), eligibility };
    expect(context.heldItems.get(1)).toEqual([
      { side: 'p1', species: 'Dusknoir', item: null, firstMove: null, touched: false },
      { side: 'p2', species: 'Gourgeist', item: 'sitrusberry', firstMove: null, touched: true },
    ]);
    const board = new LiveBattle({ formatid: 'gen9customgame' as never, p1: { name: 'Alice', team: Teams.pack(p1) }, p2: { name: 'Bob', team: Teams.pack(p2) } });
    correctActivesFromProtocol(board as never, [], { context, turn: 1 });
    expect([board.sides[0].pokemon[0].item, board.sides[1].pokemon[0].item]).toEqual(['leftovers', 'sitrusberry']);
  });

  test('Magician and Pickpocket lines the simulator writes still hand the item over', () => {
    const magician = simLog('gen9customgame',
      [simSet('Klefki', '', 'Magician', ['Flash Cannon'])], [simSet('Chansey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'])],
      [['move flashcannon', 'move softboiled']]);
    expect(magician).toContain('|-item|p1a: Klefki|Leftovers|[from] ability: Magician|[of] p2a: Chansey');
    expect(buildChoiceLockContext(magician, { p1Team: [], p2Team: [] }, []).heldItems.get(2)!.map(entry => [entry.species, entry.item, entry.firstMove]))
      .toEqual([['Klefki', 'leftovers', null], ['Chansey', '', 'softboiled']]);
    const pickpocket = simLog('gen9customgame',
      [simSet('Weavile', '', 'Pickpocket', ['Swords Dance'])], [simSet('Chansey', 'Leftovers', 'Natural Cure', ['Pound'])],
      [['move swordsdance', 'move pound']]);
    expect(pickpocket).toContain('|-item|p1a: Weavile|Leftovers|[from] ability: Pickpocket|[of] p2a: Chansey');
    expect(buildChoiceLockContext(pickpocket, { p1Team: [], p2Team: [] }, []).heldItems.get(2)!.map(entry => [entry.species, entry.item, entry.firstMove]))
      .toEqual([['Weavile', 'leftovers', null], ['Chansey', '', 'pound']]);
  });

  test('doubles: one Frisk shows both foes\' items and empties neither the frisker nor its partner', () => {
    const p1 = [simSet('Dusknoir', 'Leftovers', 'Frisk', ['Shadow Sneak']), simSet('Blissey', 'Heavy-Duty Boots', 'Natural Cure', ['Soft-Boiled'])];
    const p2 = [simSet('Gourgeist', 'Sitrus Berry', 'Insomnia', ['Shadow Sneak']), simSet('Noivern', 'Heavy-Duty Boots', 'Infiltrator', ['Hurricane'])];
    const replayLog = simLog('gen9doublescustomgame', p1, p2);
    expect(replayLog.split('\n').filter(line => line.includes('ability: Frisk'))).toHaveLength(2);
    const held = buildChoiceLockContext(replayLog, { p1Team: [], p2Team: [] }, []).heldItems.get(1)!;
    expect(held.map(entry => [entry.species, entry.item])).toEqual([
      ['Dusknoir', null], ['Blissey', null], ['Gourgeist', 'sitrusberry'], ['Noivern', 'heavydutyboots'],
    ]);
  });
});

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

/** The live pass the app and the bank run (boundary capture with snapshot correction, choice locks on unless `locks` is false); `read` sees each listed boundary's board. */
async function boundaries<T>(
  replay: Replay, teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }, turns: number[], read: (battle: Battle) => T, locks = true,
) {
  const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), ...teams, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn, snapshot: snapshotFor(targetTurn),
    choiceLocks: locks ? buildChoiceLockContext(replay.log, teams, observations) : undefined,
    capturePositions: {
      snapshotFor,
      onPosition: (turn, battle) => {
        if (turns.includes(turn) && !seen.has(turn)) seen.set(turn, read(battle));
      },
    },
  });
  return { runtime, seen };
}

function pinnedTeams(replay: Replay, pins: [side: 'p1' | 'p2', species: string, item: string][]) {
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const teams = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  for (const [side, species, item] of pins) {
    (side === 'p1' ? teams.p1Team : teams.p2Team).find(entry => entry.species === species)!.item = item;
  }
  return teams;
}

const bodyOf = (battle: Battle, side: 0 | 1, species: string) => battle.sides[side].pokemon.find(entry => entry.species.name === species);
const itemOf = (battle: Battle, side: 0 | 1, species: string) => bodyOf(battle, side, species)?.item ?? null;
const lockOf = (battle: Battle, side: 0 | 1, species: string) =>
  (bodyOf(battle, side, species)?.volatiles['choicelock'] as { move?: string } | undefined)?.move ?? null;

describe('the board holds the items the protocol shows (round 64, T121)', () => {
  test('751505: Kingambit keeps the Air Balloon the protocol announced and never popped', { timeout: 240000 }, async () => {
    // The balloon is announced as Kingambit enters at t21; at t22 Kingambit only takes Rocky Helmet chip. The sim popped it.
    const replay = fixture('smogtours-gen9ou-751505.json');
    const teams = pinnedTeams(replay, [['p1', 'Kingambit', 'Air Balloon']]);
    const { seen } = await boundaries(replay, teams, [22, 23], battle => itemOf(battle, 0, 'Kingambit'));
    expect([seen.get(22), seen.get(23)]).toEqual(['airballoon', 'airballoon']);
  });

  test('751536: Pickpocket hands Dragapult\'s Heavy-Duty Boots to Tinkaton', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9ou-751536.json');
    const teams = pinnedTeams(replay, [['p1', 'Tinkaton', 'Eject Button'], ['p2', 'Dragapult', 'Heavy-Duty Boots']]);
    const { seen } = await boundaries(replay, teams, [11], battle => ({
      tinkaton: itemOf(battle, 0, 'Tinkaton'), dragapult: itemOf(battle, 1, 'Dragapult'),
    }));
    expect(seen.get(11)).toEqual({ tinkaton: 'heavydutyboots', dragapult: '' });
  });

  test('doubles 938276: Amoonguss holds nothing after the Sitrus Berry it ate at turn 1', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9doublesou-938276.json');
    const teams = pinnedTeams(replay, [['p1', 'Amoonguss', 'Sitrus Berry']]);
    const { seen } = await boundaries(replay, teams, [2, 9], battle => itemOf(battle, 0, 'Amoonguss'));
    expect([seen.get(2), seen.get(9)]).toEqual(['', '']);
  });

  test('doubles 938640: p2 Incineroar keeps the Heavy-Duty Boots the sim\'s Knock Off took', { timeout: 240000 }, async () => {
    // In the sim, p1 Incineroar's turn-2 Knock Off lands on p2 Incineroar before its Parting Shot; in the game it hits Sinistcha.
    const replay = fixture('smogtours-gen9doublesou-938640.json');
    const teams = pinnedTeams(replay, [['p2', 'Incineroar', 'Heavy-Duty Boots'], ['p2', 'Sinistcha', 'Sitrus Berry']]);
    const { seen } = await boundaries(replay, teams, [3, 5], battle => itemOf(battle, 1, 'Incineroar'));
    expect([seen.get(3), seen.get(5)]).toEqual(['heavydutyboots', 'heavydutyboots']);
  });
});

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', evs: { ...evs, spe }, ivs, level: 100, teraType: 'Normal',
});

describe('ability hand-overs and sim-only changes on synthetic boards (round 64, T121)', () => {
  const magicianLog = log([
    '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
    '|poke|p1|Blissey, F|', '|poke|p1|Klefki, F|', '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
    '|switch|p1a: Blissey|Blissey, F|100/100',
    '|switch|p1b: Klefki|Klefki, F|100/100',
    '|switch|p2a: Chansey|Chansey, F|100/100',
    '|switch|p2b: Happiny|Happiny, F|100/100',
    '|turn|1',
    '|move|p1b: Klefki|Flash Cannon|p2a: Chansey',
    '|-damage|p2a: Chansey|90/100',
    '|-item|p1b: Klefki|Choice Scarf|[from] ability: Magician|[of] p2a: Chansey',
    '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
    '|-damage|p2b: Happiny|80/100',
    '|move|p2a: Chansey|Seismic Toss|p1a: Blissey',
    '|-damage|p1a: Blissey|85/100',
    '|move|p2b: Happiny|Pound|p1a: Blissey',
    '|-damage|p1a: Blissey|84/100',
    '|upkeep',
    '|turn|2',
  ]);
  const magicianReplay = { id: 'synthetic-doubles-magician', format: 'gen9doublesou', formatid: 'gen9doublesou', players: ['Alice', 'Bob'], log: magicianLog };
  const magicianTeams = (chanseyItem: string) => ({
    p1Team: [mon('Blissey', '', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled']), mon('Klefki', '', 'Magician', ['Flash Cannon', 'Protect'], 252)],
    p2Team: [mon('Chansey', chanseyItem, 'Natural Cure', ['Seismic Toss', 'Soft-Boiled']), mon('Happiny', '', 'Natural Cure', ['Pound', 'Seismic Toss'])],
  });

  test('doubles: Magician takes a Choice Scarf mid-turn; the thief holds it unlocked, the victim holds nothing', async () => {
    // The build guessed Leftovers for Chansey, so the sim's Magician took Leftovers.
    const { runtime } = await boundaries(magicianReplay, magicianTeams('Leftovers'), [1], () => null);
    expect(runtime.choiceErrors.count).toBe(0);
    const battle = runtime.battleStream.battle!;
    expect({ klefki: itemOf(battle, 0, 'Klefki'), lock: lockOf(battle, 0, 'Klefki'), chansey: itemOf(battle, 1, 'Chansey') })
      .toEqual({ klefki: 'choicescarf', lock: null, chansey: '' });
    expect(battle.sides[0].activeRequest!.active!.map(slot => slot.moves.filter(move => !move.disabled).map(move => move.id)))
      .toEqual([['seismictoss', 'softboiled'], ['flashcannon', 'protect']]);
  });

  test('a board that already holds the protocol\'s items is left exactly as the sim built it', async () => {
    const stable = (battle: Battle) => serializeBattleStable(battle).replace(/\|t:\|\d+/g, '|t:|');
    const withLocks = await boundaries(magicianReplay, magicianTeams('Choice Scarf'), [1], () => null);
    const plain = await boundaries(magicianReplay, magicianTeams('Choice Scarf'), [1], () => null, false);
    expect(itemOf(withLocks.runtime.battleStream.battle!, 0, 'Klefki')).toBe('choicescarf');
    expect(stable(withLocks.runtime.battleStream.battle!)).toBe(stable(plain.runtime.battleStream.battle!));
  });

  test('a sim Knock Off on a body the protocol never touched gives the build item back; a guess the sim ate stays eaten', async () => {
    const singlesLog = log([
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU', '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p2a: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|move|p1a: Blissey|Seismic Toss|p2a: Chansey',
      '|-damage|p2a: Chansey|80/100',
      '|move|p2a: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|85/100',
      '|upkeep',
      '|turn|2',
    ]);
    const teams = {
      p1Team: [
        mon('Blissey', '', 'Natural Cure', ['Seismic Toss']), mon('Snorlax', 'Leftovers', 'Immunity', ['Body Slam']),
        mon('Toxapex', 'Sitrus Berry', 'Regenerator', ['Recover']),
      ],
      p2Team: [mon('Chansey', '', 'Natural Cure', ['Seismic Toss'])],
    };
    const runtime = await reconstructBranchRuntime({ format: 'gen9ou', ...teams, replayLog: singlesLog, targetTurn: 2 });
    const battle = runtime.battleStream.battle!;
    const snorlax = bodyOf(battle, 0, 'Snorlax')!;
    const toxapex = bodyOf(battle, 0, 'Toxapex')!;
    snorlax.item = '';
    battle.log.push('|-enditem|p1: Snorlax|Leftovers|[from] move: Knock Off|[of] p2a: Chansey');
    toxapex.item = '';
    battle.log.push('|-enditem|p1: Toxapex|Sitrus Berry|[eat]');
    correctActivesFromProtocol(battle, [], { context: buildChoiceLockContext(singlesLog, teams, []), turn: 2 });
    expect({ snorlax: snorlax.item, toxapex: toxapex.item }).toEqual({ snorlax: 'leftovers', toxapex: '' });
  });
});

describe('item lines a disguised Zoroark writes belong to the Zoroark (round 64 review)', () => {
  // The 681568 shape: Zoroark-Hisui enters as Volcarona (the last party member), Sucker Punch breaks its Focus Sash and its Illusion in one hit.
  const singlesLines = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU', '|start',
    '|switch|p1a: Gamb|Kingambit, M|100/100',
    '|switch|p2a: Glim|Glimmora, M|100/100',
    '|turn|1',
    '|',
    '|switch|p2a: Volcarona|Volcarona, F|100/100',
    '|move|p1a: Gamb|Iron Head|p2a: Volcarona',
    '|-damage|p2a: Volcarona|60/100',
    '|upkeep',
    '|turn|2',
    '|',
    '|move|p2a: Volcarona|Shadow Ball|p1a: Gamb',
    '|-damage|p1a: Gamb|80/100',
    '|upkeep',
    '|turn|3',
    '|',
    '|move|p1a: Gamb|Sucker Punch|p2a: Volcarona',
    '|-supereffective|p2a: Volcarona',
    '|-enditem|p2a: Volcarona|Focus Sash',
    '|-damage|p2a: Volcarona|1/100',
    '|replace|p2a: Imposter|Zoroark-Hisui, M',
    '|-end|p2a: Imposter|Illusion',
    '|move|p2a: Imposter|Shadow Ball|p1a: Gamb',
    '|-damage|p1a: Gamb|60/100',
    '|upkeep',
    '|turn|4',
  ];

  test('singles: the Focus Sash breaks on the Zoroark, the real Volcarona keeps its item', () => {
    const held = buildChoiceLockContext(log(singlesLines), { p1Team: [], p2Team: [] }, []).heldItems.get(4)!;
    expect(held.map(entry => [entry.species, entry.item, entry.firstMove, entry.touched])).toEqual([
      ['Kingambit', null, 'ironhead', false],
      ['Glimmora', null, null, false],
      ['Volcarona', null, null, false],
      ['Zoroark-Hisui', '', 'shadowball', true],
    ]);
    const mon = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
      name: species, species, item, ability, moves, nature: 'Hardy', level: 100,
      evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    });
    const board = new LiveBattle({
      formatid: 'gen9customgame' as never,
      p1: { name: 'Alice', team: Teams.pack([mon('Kingambit', 'Leftovers', 'Supreme Overlord', ['Iron Head'])]) },
      p2: { name: 'Bob', team: Teams.pack([
        mon('Glimmora', 'Focus Sash', 'Toxic Debris', ['Power Gem']), mon('Volcarona', 'Heavy-Duty Boots', 'Flame Body', ['Fiery Dance']),
        mon('Zoroark-Hisui', 'Focus Sash', 'Illusion', ['Shadow Ball']),
      ]) },
    });
    const context = buildChoiceLockContext(log(singlesLines), { p1Team: [], p2Team: [] }, []);
    correctActivesFromProtocol(board as never, [], { context, turn: 4 });
    expect(board.sides[1].pokemon.map(body => body.item)).toEqual(['focussash', 'heavydutyboots', '']);
  });

  test('doubles: a Throat Spray used under a disguise on p1b goes to the Zoroark, not to the imitated Kingdra', () => {
    const lines = [
      '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU', '|start',
      '|switch|p1a: Masq|Masquerain, F|100/100',
      '|switch|p1b: Kingdra|Kingdra, M|100/100',
      '|switch|p2a: Ursa|Ursaluna, M|100/100',
      '|switch|p2b: Cress|Cresselia, F|100/100',
      '|turn|1',
      '|',
      '|move|p1b: Kingdra|Snarl|p2a: Ursa|[spread] p2a,p2b',
      '|-damage|p2a: Ursa|90/100',
      '|-damage|p2b: Cress|95/100',
      '|-enditem|p1b: Kingdra|Throat Spray',
      '|-boost|p1b: Kingdra|spa|1|[from] item: Throat Spray',
      '|move|p2a: Ursa|Facade|p1b: Kingdra',
      '|-damage|p1b: Kingdra|40/100',
      '|replace|p1b: Zorua|Zoroark-Hisui, F',
      '|-end|p1b: Zorua|Illusion',
      '|upkeep',
      '|turn|2',
    ];
    const held = buildChoiceLockContext(log(lines), { p1Team: [], p2Team: [] }, []).heldItems.get(2)!;
    expect(held.filter(entry => entry.side === 'p1').map(entry => [entry.species, entry.item, entry.firstMove])).toEqual([
      ['Masquerain', null, null],
      ['Kingdra', null, null],
      ['Zoroark-Hisui', '', 'snarl'],
    ]);
  });
});

await loadSimMods('gen9championsou');

describe('sitrus-witness', () => {
  const mon = (species: string, item = ''): PokemonSet => ({
    name: species, species, item, ability: 'No Ability', moves: ['Splash'], nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });

  function board(format: string, kind: 'singles' | 'doubles'): LiveBattle {
    const p1 = [mon('Pikachu'), mon('Eevee')].slice(0, kind === 'doubles' ? 2 : 1);
    const p2 = [mon('Magikarp', 'Sitrus Berry'), mon('Ditto')].slice(0, kind === 'doubles' ? 2 : 1);
    const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
      battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
    }
    return battle;
  }

  function protocol(kind: 'singles' | 'doubles', block: string[]) {
    const entries = ['|switch|p1a: Pikachu|Pikachu, M|100/100', '|switch|p2a: Magikarp|Magikarp, M|100/100'];
    if (kind === 'doubles') entries.push('|switch|p1b: Eevee|Eevee, M|100/100', '|switch|p2b: Ditto|Ditto|100/100');
    const log = ['|player|p1|A|', '|player|p2|B|', '|gen|9', '|tier|[Gen 9] Custom Game', '|start', ...entries, '|turn|1', ...block, '|upkeep', '|turn|2'].join('\n');
    return { context: buildChoiceLockContext(log, { p1Team: [], p2Team: [] }, []), turn: 2 };
  }

  const FORMATS = { singles: 'gen9customgame', doubles: 'gen9doublescustomgame' } as const;

  describe.each(['singles', 'doubles'] as const)('the Sitrus witness (%s)', kind => {
    const format = FORMATS[kind];
    const tick = (battle: LiveBattle) => battle.eachEvent('Update');
    const damage = (text: string) => ['|move|p1a: Pikachu|Splash|', `|-damage|p2a: Magikarp|${text}`];

    function simAte() {
      const battle = board(format, kind);
      const body = battle.sides[1].active[0]!;
      body.hp = Math.ceil(body.maxhp * 0.45);
      tick(battle);
      expect(body.item, 'the simulator ate its berry').toBe('');
      return { battle, body };
    }

    test('the game\'s HP stays above half and shows no item line: the berry is back', () => {
      const { battle, body } = simAte();
      correctActivesFromProtocol(battle as never, damage('55/100'), protocol(kind, damage('55/100')));
      expect(body.item).toBe('sitrusberry');
      expect(body.ateBerry).toBe(false);
      expect(body.lastItem).toBe('');
    });

    test('controls: the game\'s HP at or under half without an eating line refutes the berry; an item line, or no HP line, leaves the board alone', () => {
      for (const block of [damage('43/100'), damage('49/100'), [...damage('55/100'), '|-enditem|p2a: Magikarp|Sitrus Berry|[eat]'], ['|move|p1a: Pikachu|Splash|']]) {
        const { battle, body } = simAte();
        correctActivesFromProtocol(battle as never, block, protocol(kind, block));
        expect(body.item, block.join(' ')).toBe('');
      }
    });

    test('controls: a body without a Sitrus build, or still holding its item, is not touched', () => {
      const { battle, body } = simAte();
      body.set.item = 'Leftovers';
      correctActivesFromProtocol(battle as never, damage('55/100'), protocol(kind, damage('55/100')));
      expect(body.item).toBe('');
      const holding = board(format, kind);
      const holder = holding.sides[1].active[0]!;
      correctActivesFromProtocol(holding as never, damage('55/100'), protocol(kind, damage('55/100')));
      expect(holder.item).toBe('sitrusberry');
    });

    test('the door: a block with Windows line endings decides the same', () => {
      const { battle, body } = simAte();
      const block = damage('55/100').map(line => `${line}\r`);
      correctActivesFromProtocol(battle as never, block, protocol(kind, damage('55/100')));
      expect(body.item).toBe('sitrusberry');
    });
  });

  describe('the threshold is the simulator\'s: the rebuild restores the berry only where the simulator eats at no HP that shows the text, in every generation and the Champions mod', () => {
    const formats = [3, 4, 5, 6, 7, 8, 9].flatMap(gen => [`gen${gen}customgame`, `gen${gen}doublescustomgame`]).concat('gen9championscustomgame');
    const modes = [['percentages', true], ['pixels', false]] as const;
    for (const [format, [mode, percentages]] of formats.flatMap(format => modes.map(mode => [format, mode] as const))) {
      test(`${format} ${mode}`, () => {
        const kind = format.includes('doubles') ? 'doubles' : 'singles';
        if (!Dex.forFormat(format).items.get('sitrusberry').exists) return;
        const display = (b: LiveBattle) => { b.reportExactHP = false; b.reportPercentages = percentages; return b; };
        const battle = display(board(format, kind));
        const body = battle.sides[1].active[0]!;
        const byText = new Map<string, boolean[]>();
        for (let hp = Math.floor(body.maxhp * 0.3); hp <= Math.ceil(body.maxhp * 0.7); hp++) {
          body.setItem('sitrusberry');
          body.hp = hp;
          const text = body.getHealth().shared;
          battle.eachEvent('Update');
          (byText.get(text) ?? byText.set(text, []).get(text)!).push(body.item === '');
        }
        expect(byText.size).toBeGreaterThan(5);
        const inert = ![...byText.values()].some(ate => ate.some(Boolean));
        let restored = 0;
        for (const [text, ate] of byText) {
          const { battle: rebuilt, body: simBody } = (() => { const b = display(board(format, kind)); const s = b.sides[1].active[0]!; s.item = ''; return { battle: b, body: s }; })();
          const block = ['|move|p1a: Pikachu|Splash|', `|-damage|p2a: Magikarp|${text}`];
          correctActivesFromProtocol(rebuilt as never, block, protocol(kind, block));
          const back = simBody.item === 'sitrusberry';
          // Sound: the berry comes back only where the simulator eats at no HP that shows this text.
          if (back) expect(ate.some(Boolean), `${format} ${mode} ${text}`).toBe(false);
          if (back) restored++;
          // Useful: a text more than a display unit above the threshold (every HP of it keeps the berry) is restored.
          const [shownHp, shownMax] = text.split(' ')[0].split('/').map(Number);
          if (!inert && ate.every(value => !value) && shownHp / shownMax > 0.5 + 2 / shownMax) expect(back, `${format} ${mode} ${text}`).toBe(true);
        }
        // A generation whose Update event eats at no HP (gen 3 moves the berry to its residual) has no threshold to read: nothing comes back.
        if (inert) return expect(restored).toBe(0);
        expect(restored).toBeGreaterThan(0);
        expect(restored).toBeLessThan(byText.size);
      });
    }
  });
});
