import './champions-mod';
import * as pkmnClient from '@pkmn/client';
import { describe, expect, test, afterEach, vi } from 'vitest';
import { Battle, Teams, toID, type PokemonSet, Dex } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/index';
import { readFileSync } from 'node:fs';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { parseReplayLog } from '../src/protocol-parser';
import {
  ATTACK_BOOSTED,
  INTIMIDATE_BEFORE_ACTIVATION,
  KINDS,
  PARADOX_DEFENDER,
  QUARK_DRIVE,
  SWORDS_AFTER_ACTIVATION,
  scenesOf,
  type Kind,
  type SceneSpec,
} from './paradox-scenes';

/**
 * Round 69, T187 and T151 (spec decisions 29 and 30): the snapshot carries what
 * @pkmn/client counts for a sleeping body (statusState.sleepTurns, one per
 * |cant|..|slp| line) and the slot of every active body (side.active). Every
 * log comes from @pkmn/sim; the expected numbers come from that log.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100,
});

function play(format: string, p1: PokemonSet[], p2: PokemonSet[], turns: string[][], seed: number): string {
  const battle = new Battle({
    formatid: toID(format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  for (const [p1Choice, p2Choice] of turns) {
    battle.choose('p1', p1Choice);
    battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const SINGLES = {
  format: 'gen9customgame',
  p1: [set('Parasect', ['Spore', 'Splash'])],
  p2: [set('Snorlax', ['Splash'])],
  turns: [['move 1', 'move 1'], ...Array.from({ length: 5 }, () => ['move 2', 'move 1'])],
};
const DOUBLES = {
  format: 'gen9doublescustomgame',
  p1: [set('Parasect', ['Spore', 'Splash']), set('Gliscor', ['Splash']), set('Rillaboom', ['Splash'])],
  p2: [set('Snorlax', ['Splash']), set('Corviknight', ['Splash']), set('Amoonguss', ['Splash'])],
  // Spore on the target in p2a, the slot the others keep naming through the sleep.
  turns: [['move 1 1, move 1', 'move 1, move 1'], ...Array.from({ length: 5 }, () => ['move 2, move 1', 'move 1, move 1'])],
};

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('snapshot fields (%s)', (_label, scene) => {
  test('sleepTurns counts the cant lines while the body sleeps and is absent otherwise', () => {
    let longest = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const log = play(scene.format, scene.p1, scene.p2, scene.turns, seed);
      const { snapshots } = parseReplayLogWithObservations(log);
      for (const snapshot of snapshots) {
        const upTo = log.split('\n');
        upTo.length = upTo.lastIndexOf(`|turn|${snapshot.turn}`) + 1;
        const cants = upTo.filter(line => /^\|cant\|p2a: Snorlax\|slp/.test(line)).length;
        const sleeper = snapshot.p2.pokemon.find(pokemon => pokemon.name === 'Snorlax')!;
        if (sleeper.status === 'slp') {
          expect(sleeper.sleepTurns).toBe(cants);
          longest = Math.max(longest, cants);
        } else {
          expect(sleeper.sleepTurns).toBeUndefined();
        }
        for (const other of snapshot.p1.pokemon) expect(other.sleepTurns).toBeUndefined();
      }
    }
    expect(longest).toBeGreaterThanOrEqual(2);
  });

  test('slot is the index in side.active for an active body and absent on the bench', () => {
    const log = play(scene.format, scene.p1, scene.p2, scene.turns.slice(0, 1), 1);
    const { snapshots } = parseReplayLogWithObservations(log);
    const snapshot = snapshots[snapshots.length - 1];
    const actives = log.split('\n').filter(line => /^\|switch\|/.test(line));
    for (const sideSnapshot of [snapshot.p1, snapshot.p2]) {
      for (const pokemon of sideSnapshot.pokemon) {
        if (!pokemon.isActive) { expect(pokemon.slot).toBeUndefined(); continue; }
        const line = actives.find(entry => entry.split('|')[3].startsWith(pokemon.speciesForme) && entry.split('|')[2].startsWith(sideSnapshot.id))!;
        expect(pokemon.slot).toBe(line.split('|')[2][2].charCodeAt(0) - 'a'.charCodeAt(0));
      }
    }
  });
});

/**
 * Round 69, T158 (spec decision 32): the quick picker needs the facts the simulator's body keeps for the calc:
 * the stat Protosynthesis or Quark Drive raised (the client's `protosynthesis` and `quarkdrive` volatile names it)
 * and the fallen allies of Supreme Overlord (the client's `fallenN` volatile). Battle B is the simulator's own;
 * the expected values come from its body, not from the log.
 */
type SimBattle = InstanceType<typeof Battle>;
function playSteps(format: string, p1: PokemonSet[], p2: PokemonSet[], steps: [string, string][][], seed = 1): { battle: SimBattle; log: string } {
  const battle = new Battle({
    formatid: toID(format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  for (const step of steps) for (const [side, choice] of step) battle.choose(side as 'p1' | 'p2', choice);
  const lines = battle.log;
  return { battle, log: lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n') };
}
const withAbility = (species: string, ability: string, moves: string[], level = 100): PokemonSet => ({ ...set(species, moves), ability, level });
const lastSnapshot = (log: string) => parseReplayLogWithObservations(log).snapshots.at(-1)!;

describe.each([['singles', 'gen9customgame', ''], ['doubles', 'gen9doublescustomgame', ', move 1']] as const)('T158 snapshot facts (%s)', (label, format, partner) => {
  const filler = label === 'singles' ? [] : [set('Gliscor', ['Splash'])];
  const foeFiller = label === 'singles' ? [] : [set('Corviknight', ['Splash'])];

  test('boostedStat is the stat the Protosynthesis and Quark Drive volatile names, and absent without the boost', () => {
    const holders = [
      { ability: 'Protosynthesis', species: 'Roaring Moon', starter: withAbility('Torkoal', 'Drought', ['Splash']), volatile: 'protosynthesis' },
      { ability: 'Quark Drive', species: 'Iron Valiant', starter: withAbility('Pikachu', 'Electric Surge', ['Splash']), volatile: 'quarkdrive' },
    ];
    for (const holder of holders) {
      const { battle, log } = playSteps(format, [withAbility(holder.species, holder.ability, ['Splash']), ...filler], [holder.starter, ...foeFiller], [[['p1', `move 1${partner}`], ['p2', `move 1${partner}`]]]);
      const body = battle.sides[0].pokemon[0];
      const bestStat = (body.volatiles[holder.volatile] as { bestStat?: string } | undefined)?.bestStat;
      expect(bestStat, `${holder.ability} did not start`).toBeTruthy();
      const snapshot = lastSnapshot(log);
      expect(snapshot.p1.pokemon.find(pokemon => pokemon.name === holder.species)!.boostedStat).toBe(bestStat);
      for (const other of [...snapshot.p1.pokemon, ...snapshot.p2.pokemon]) if (other.name !== holder.species) expect(other.boostedStat, other.name).toBeUndefined();
    }
    const quiet = playSteps(format, [withAbility('Roaring Moon', 'Protosynthesis', ['Splash']), ...filler], [set('Snorlax', ['Splash']), ...foeFiller], [[['p1', `move 1${partner}`], ['p2', `move 1${partner}`]]]);
    for (const pokemon of lastSnapshot(quiet.log).p1.pokemon) expect(pokemon.boostedStat).toBeUndefined();
  });

  test('fallen is the count the Supreme Overlord state keeps, and absent for the others', () => {
    // The first body faints to a Psychic and Kingambit comes in from the bench: one fallen ally.
    const p1 = label === 'singles'
      ? [withAbility('Magikarp', 'No Ability', ['Splash'], 5), withAbility('Kingambit', 'Supreme Overlord', ['Splash'])]
      : [withAbility('Magikarp', 'No Ability', ['Splash'], 5), set('Gliscor', ['Splash']), withAbility('Kingambit', 'Supreme Overlord', ['Splash'])];
    const p2 = [set('Mew', ['Psychic', 'Splash']), ...foeFiller];
    const attack = label === 'singles' ? 'move 1' : 'move 1 1, move 1';
    const comeIn = label === 'singles' ? 'switch 2' : 'switch 3';
    const { battle, log } = playSteps(format, p1, p2, [[['p1', `move 1${partner}`], ['p2', attack]], [['p1', comeIn]]]);
    const kingambit = battle.sides[0].pokemon.find(pokemon => pokemon.name === 'Kingambit')!;
    const fallen = (kingambit.abilityState as { fallen?: number }).fallen;
    expect(fallen).toBe(1);
    const snapshot = lastSnapshot(log);
    expect(snapshot.p1.pokemon.find(pokemon => pokemon.name === 'Kingambit')!.fallen).toBe(fallen);
    for (const other of [...snapshot.p1.pokemon, ...snapshot.p2.pokemon]) if (other.name !== 'Kingambit') expect(other.fallen, other.name).toBeUndefined();
  });
});

describe('champions-parser-species', () => {
  const { Battle } = pkmnClient;
  type Battle = pkmnClient.Battle;
  const read = (path: string): string => (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { log: string }).log;
  const LOGS = {
    'singles (Meganium-Mega, Absol-Mega-Z)': read('../../eval-engine/test/fixtures/champions/gen9championsou-2693832490.json'),
    'singles (Mega formes)': read('../../../test/e2e-feedback/fixtures/gen9championsou-2628340185.json'),
    'doubles (VGC Reg M-B, no Mega on the field)': read('../../eval-engine/test/fixtures/champions/gen9championsvgc2026regmbbo3-2679053861.json'),
    'doubles (VGC Reg M-B, Scovillain-Mega and Meganium-Mega)': read('./fixtures/champions-vgc-2679899667.json'),
  } as const;

  afterEach(() => vi.restoreAllMocks());

  describe('a Champions log parses without a skipped line', () => {
    for (const [name, log] of Object.entries(LOGS)) {
      test(name, () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        parseReplayLogWithObservations(log);
        const skipped = warn.mock.calls.map(call => String(call[0]) + String(call[1])).filter(text => text.includes('skipping unparseable'));
        expect(skipped).toEqual([]);
      });
    }
  });

  describe('the inference walk applies the lines the parser applies', () => {
    for (const [name, log] of Object.entries(LOGS)) {
      test(`${name}: the client battle of the hits walk throws on no line, from either side`, () => {
        const original = Battle.prototype.add;
        const thrown: string[] = [];
        Battle.prototype.add = function (this: Battle, ...args: Parameters<Battle['add']>) {
          try {
            return original.apply(this, args);
          } catch (error) {
            thrown.push(`${String(args[0])}: ${(error as Error).message}`);
            throw error;
          }
        } as typeof original;
        try {
          for (const side of ['p1', 'p2'] as const) inferOpponentTeam(log, side);
        } finally {
          Battle.prototype.add = original;
        }
        expect(thrown).toEqual([]);
      });
    }

    test('a hit into a Mega target is recorded (singles, Absol-Mega-Z hits Meganium-Mega)', () => {
      const info = inferOpponentTeam(LOGS['singles (Meganium-Mega, Absol-Mega-Z)'], 'p2');
      const absol = info.pokemon.find(mon => /^Absol/.test(mon.species));
      expect(absol?.hits?.some(hit => hit.defender.species === 'Meganium-Mega')).toBe(true);
    });
  });
});

const mega = Dex.dexes.champions.species.get('Swampert-Mega');
const swiftSwim = Dex.dexes.champions.species.get('Kingdra');
const FORMATS = { singles: '[Gen 9 Champions] OU', doubles: '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)' } as const;

function log(kind: 'singles' | 'doubles', first: string, weather: string): string {
  const doubles = kind === 'doubles';
  return [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', `|gametype|${kind}`, `|tier|${FORMATS[kind]}`, '|start',
    `|switch|p1a: A|${first}, L50, M|100/100`, `|switch|p2a: B|Garchomp, L50, M|100/100`,
    ...(doubles ? ['|switch|p1b: C|Incineroar, L50, M|100/100', '|switch|p2b: D|Rotom-Wash, L50|100/100'] : []),
    ...(first === 'Swampert' ? ['|detailschange|p1a: A|Swampert-Mega, L50, M', '|-mega|p1a: A|Swampert|Swampertite'] : []),
    ...(weather ? [`|-weather|${weather}`] : []),
    '|turn|1',
    '|move|p1a: A|Waterfall|p2a: B', '|-damage|p2a: B|70/100',
    '|move|p2a: B|Earthquake|p1a: A', '|-damage|p1a: A|80/100',
    ...(doubles ? ['|move|p1b: C|Flare Blitz|p2b: D', '|-damage|p2b: D|60/100', '|move|p2b: D|Hydro Pump|p1b: C', '|-damage|p1b: C|60/100'] : []),
    '|turn|2',
  ].join('\n');
}
const orders = (text: string) => parseReplayLogWithObservations(text).speedOrders.map(order => `${order.firstSpecies}>${order.secondSpecies}`);

describe('the mod\'s Swift Swim Mega', () => {
  test('the mod gives Swampert-Mega Swift Swim and Kingdra the same ability', () => {
    expect(Object.values(mega.abilities)).toContain('Swift Swim');
    expect(Object.values(swiftSwim.abilities)).toContain('Swift Swim');
  });

  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: Swampert-Mega first in rain gives no order, in clear weather it does`, () => {
      expect(orders(log(kind, 'Swampert', 'RainDance')).filter(order => order.startsWith('Swampert-Mega'))).toEqual([]);
      expect(orders(log(kind, 'Swampert', '')).filter(order => order.startsWith('Swampert-Mega'))).toContain('Swampert-Mega>Garchomp');
    });

    test(`${kind}: a plain Swift Swim holder in rain gives no order, as before`, () => {
      expect(orders(log(kind, 'Kingdra', 'RainDance')).filter(order => order.startsWith('Kingdra'))).toEqual([]);
      expect(orders(log(kind, 'Kingdra', '')).filter(order => order.startsWith('Kingdra'))).toContain('Kingdra>Garchomp');
    });
  }
});

describe('field durations in the snapshot (round 60, T92)', () => {
  test('weather and terrain carry the client\'s remaining turns', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|1', '|teamsize|p2|1', '|gen|9',
      '|tier|[Gen 9] Custom Game', '|start',
      '|switch|p1a: Pelipper|Pelipper, F|100/100', '|-weather|RainDance|[from] ability: Drizzle|[of] p1a: Pelipper',
      '|switch|p2a: Rillaboom|Rillaboom, M|100/100', '|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p2a: Rillaboom',
      '|turn|1',
      '|move|p1a: Pelipper|Protect|p1a: Pelipper', '|-singleturn|p1a: Pelipper|Protect',
      '|move|p2a: Rillaboom|Protect|p2a: Rillaboom', '|-singleturn|p2a: Rillaboom|Protect',
      '|-weather|RainDance|[upkeep]', '|upkeep',
      '|turn|2',
    ].join('\n');
    const snapshots = parseReplayLog(log);
    const turn2 = snapshots.find(snapshot => snapshot.turn === 2)!;
    expect(turn2.field.weatherState).toEqual({ minDuration: 4, maxDuration: 7 });
    expect(turn2.field.terrainState).toEqual({ minDuration: 4, maxDuration: 7 });
  });
});

const first = (kind: Kind, spec: SceneSpec) => {
  const scene = scenesOf(kind, spec, 1)[0];
  expect(scene).toBeDefined();
  return parseReplayLogWithObservations(scene.log).observations;
};

for (const kind of KINDS) {
  describe(`${kind}: the observation carries the paradox reading`, () => {
    test('a stat raised by Protosynthesis is named with the stages at the activation, not the stages of the hit', () => {
      const observations = first(kind, SWORDS_AFTER_ACTIVATION);
      expect(observations).toHaveLength(2);
      for (const obs of observations) {
        // The sun came with the first lines (Drought), before Swords Dance: Speed was the best stat, with no stage.
        expect(obs.attackerParadox).toMatchObject({ stat: 'spe' });
        expect(obs.attackerParadox?.stages.atk ?? 0).toBe(0);
        expect(obs.attackerBoosts.atk).toBe(2);
        expect(obs.defenderParadox).toBeUndefined();
      }
    });

    test('an Attack boost names atk', () => {
      for (const obs of first(kind, ATTACK_BOOSTED)) expect(obs.attackerParadox?.stat).toBe('atk');
    });

    test('an Intimidate that came before the activation is in the stages', () => {
      const observations = first(kind, INTIMIDATE_BEFORE_ACTIVATION);
      expect(observations).toHaveLength(2);
      for (const obs of observations) {
        expect(obs.attackerParadox).toMatchObject({ stat: 'spe', stages: { atk: -1 } });
        expect(obs.attackerBoosts.atk).toBe(-1);
      }
    });

    test('Quark Drive in an Electric Terrain', () => {
      for (const obs of first(kind, QUARK_DRIVE)) expect(obs.attackerParadox).toMatchObject({ stat: 'atk' });
    });

    test('the Pokémon that is hit carries its reading on the defender side', () => {
      const observations = first(kind, PARADOX_DEFENDER);
      expect(observations.length).toBeGreaterThan(0);
      for (const obs of observations) {
        expect(obs.defenderParadox).toMatchObject({ stat: 'atk' });
        expect(obs.attackerParadox).toBeUndefined();
      }
    });
  });
}

describe('a Pokémon without the ability reads nothing', () => {
  for (const kind of KINDS) {
    test(`${kind}: no fields on a plain hit`, () => {
      const spec: SceneSpec = {
        ...ATTACK_BOOSTED,
        attacker: { ...ATTACK_BOOSTED.attacker, species: 'Garchomp', name: 'Garchomp', ability: 'Rough Skin' },
        lead: { ...ATTACK_BOOSTED.lead, ability: 'Pressure' },
      };
      for (const obs of first(kind, spec)) {
        expect(obs.attackerParadox).toBeUndefined();
        expect(obs.defenderParadox).toBeUndefined();
      }
    });
  }
});
