import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { classifyChild, type CellEvent, planCellEvents, koOddsForOptions } from '../src/cell-blend';
import { advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { sampleCell } from '../src/search/cell-sampler';
import { classChildren } from '../src/search/outcome-children';
import { SEARCH_SEEDS } from './seed-streams';
import { anchorRoot, doublesRoot, pairSet, PLAYED } from './pair-battles';

/**
 * Round 69 (T146 part c1): a cell's kill window ends with the move phase. A defender that survives the hit and
 * faints at the turn's residual (poison, Leech Seed, Future Sight) is `hit-nokill`: the kill fraction the plan prices
 * is the move's own. The logs are the simulator's, played in singles and in doubles.
 */

const set = (species: string, moves: string[], item = '', level = 50): PokemonSet => ({
  name: species, species, item, ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});

const event = (side: 'p1' | 'p2', defenderIdent: string): CellEvent => ({
  side, moveId: 'testmove', defenderIdent,
  event: { accuracy: 1, killFraction: 0.5, pKill: 0.5, normalKillRolls: 8, critKillRolls: 8 },
});

type Setup = (battle: Battle) => void;

function playLog(formatid: string, teams: [PokemonSet[], PokemonSet[]], setup: Setup, p1Choice: string, p2Choice: string): string[] {
  const battle = new Battle({
    formatid: toID(formatid), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(teams[0]) }, p2: { name: 'Beta', team: Teams.pack(teams[1]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', formatid.includes('doubles') ? 'team 12' : 'team 1');
    battle.choose('p2', formatid.includes('doubles') ? 'team 12' : 'team 1');
  }
  setup(battle);
  const position = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
  return advancePositionWithLog(position, p1Choice, p2Choice, '1,2,3,4').log;
}

const singles = (setup: Setup, p1Choice = 'move tackle', p2Choice = 'move growl') => playLog(
  'gen9customgame',
  [[set('Pikachu', ['Tackle', 'Growl'])], [set('Snorlax', ['Tackle', 'Growl'], 'Leftovers')]],
  setup, p1Choice, p2Choice,
);

describe('classifyChild kill window (T146 c1)', () => {
  test('a defender that survives the move and faints at the poison tick is hit-nokill', () => {
    const log = singles(battle => { const mon = battle.sides[1].active[0]!; mon.setStatus('psn'); mon.hp = 30; });
    expect(log.some(line => line.startsWith('|faint|p2a: Snorlax'))).toBe(true); // the simulator does faint it, at the residual
    expect(classifyChild(log, [event('p1', 'p2a: Snorlax')])).toBe('hit-nokill');
  });

  test('the second mover window ends with the move phase too', () => {
    // Pikachu moves first; Snorlax's Growl is the second move and Pikachu, poisoned at 1 HP, faints at the tick.
    const log = singles(battle => { const mon = battle.sides[0].active[0]!; mon.setStatus('psn'); mon.hp = 1; });
    expect(log.some(line => line.startsWith('|faint|p1a: Pikachu'))).toBe(true);
    expect(classifyChild(log, [event('p1', 'p2a: Snorlax'), event('p2', 'p1a: Pikachu')])).toBe('hit-nokill|hit-nokill');
  });

  test('a Leech Seed tick after a surviving hit is no kill either', () => {
    const log = singles(battle => {
      const mon = battle.sides[1].active[0]!;
      mon.addVolatile('leechseed', battle.sides[0].active[0]!);
      mon.hp = 30;
    });
    expect(log.some(line => line.startsWith('|faint|p2a: Snorlax'))).toBe(true);
    expect(classifyChild(log, [event('p1', 'p2a: Snorlax')])).toBe('hit-nokill');
  });

  test('a real kill by the move stays hit-kill (control)', () => {
    const log = singles(battle => { const mon = battle.sides[1].active[0]!; mon.setStatus('psn'); mon.hp = 5; });
    expect(classifyChild(log, [event('p1', 'p2a: Snorlax')])).toBe('hit-kill');
  });

  test('the first mover kill truncates the second event as before (control)', () => {
    const log = singles(battle => { battle.sides[1].active[0]!.hp = 5; });
    expect(classifyChild(log, [event('p1', 'p2a: Snorlax'), event('p2', 'p1a: Pikachu')])).toBe('hit-kill|none');
  });

  test('doubles: a residual faint after the move phase is hit-nokill, a kill by the move is hit-kill', () => {
    const teams: [PokemonSet[], PokemonSet[]] = [
      [set('Pikachu', ['Tackle', 'Growl']), set('Raichu', ['Tackle', 'Growl'])],
      [set('Snorlax', ['Tackle', 'Growl'], 'Leftovers'), set('Blissey', ['Tackle', 'Growl'])],
    ];
    const events = [event('p1', 'p2a: Snorlax')];
    const slow = playLog('gen9doublescustomgame', teams, battle => {
      const mon = battle.sides[1].active[0]!;
      mon.setStatus('psn');
      mon.hp = 30;
    }, 'move tackle 1, move growl', 'move growl, move growl');
    expect(slow.some(line => line.startsWith('|faint|p2a: Snorlax'))).toBe(true);
    expect(classifyChild(slow, events)).toBe('hit-nokill');
    const kill = playLog('gen9doublescustomgame', teams, battle => {
      const mon = battle.sides[1].active[0]!;
      mon.setStatus('psn');
      mon.hp = 5;
    }, 'move tackle 1, move growl', 'move growl, move growl');
    expect(classifyChild(kill, events)).toBe('hit-kill');
  });
});

describe('cell-plan-immune', () => {
  const set = (species: string, moves: string[], ability = 'No Ability'): PokemonSet => ({
    name: species, species, item: '', ability, moves, nature: 'Hardy',
    evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
  });

  function scene(attacker: PokemonSet, defender: PokemonSet): SimPosition {
    const battle = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([attacker]) }, p2: { name: 'Beta', team: Teams.pack([defender]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
  }

  const P1 = 'move thunderwave';
  const P2 = 'move recover';

  /** Whether the simulator shows the attacker's miss line in any of 64 natural seeds. */
  function simulatorMisses(root: SimPosition, p1Choice: string): boolean {
    for (let k = 0; k < 64; k++) {
      const { log } = advancePositionWithLog(root, p1Choice, P2, `${1000 + k},${2000 + k},${3000 + k},${4000 + k}` as never);
      if (log.some(line => line.startsWith('|-miss|p1a:'))) return true;
    }
    return false;
  }

  const cases: { name: string; attacker: PokemonSet; defender: PokemonSet; p1: string }[] = [
    { name: 'Thunder Wave into a Ground type', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Garchomp', ['Recover']), p1: P1 },
    { name: 'Thunder Wave into a Volt Absorb holder', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Lanturn', ['Recover'], 'Volt Absorb'), p1: P1 },
    { name: 'Prankster Thunder Wave into a Dark type', attacker: set('Pikachu', ['Thunder Wave'], 'Prankster'), defender: set('Umbreon', ['Recover']), p1: P1 },
    { name: 'Sleep Powder into a Grass type', attacker: set('Pikachu', ['Sleep Powder']), defender: set('Venusaur', ['Recover']), p1: 'move sleeppowder' },
    { name: 'Thunder Wave into a Water type (control)', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Starmie', ['Recover']), p1: P1 },
    // The Electric type is immune to paralysis, but only after the accuracy roll: the miss class is real here.
    { name: 'Thunder Wave into an Electric type (control)', attacker: set('Pikachu', ['Thunder Wave']), defender: set('Jolteon', ['Recover']), p1: P1 },
  ];

  describe('status events whose accuracy roll is never reached (T146 c3)', () => {
    for (const { name, attacker, defender, p1 } of cases) {
      test(`${name}: a miss class exactly when the simulator can miss`, () => {
        const root = scene(attacker, defender);
        const reachable = simulatorMisses(root, p1);
        const plan = planCellEvents(positionBattle(root), p1, P2);
        expect(plan.kind).toBe(reachable ? 'events' : 'none');
        const sample = sampleCell(root, 0, p1, P2, 3, createMatchupCache(), true);
        // r89 A5 gate: was `expect(sample.diagnostic).toBeUndefined()` on the fixed seeds. A cell's own seeds can all hit a 90 percent
        // move (0.9^14 = 23 percent, the Water control reads 14 hits): the miss class is then unreached and booked as a diagnostic.
        if (reachable) expect(sample.diagnostic?.missing ?? ['miss']).toEqual(['miss']);
        else expect(sample.diagnostic).toBeUndefined();
        expect(sample.blend !== undefined).toBe(reachable);
        const children = classChildren(root, p1, P2, { baseSeeds: SEARCH_SEEDS.slice(0, 1), forcedCap: 4 });
        if (reachable) {
          expect(children?.children.some(child => child.key.endsWith(':miss'))).toBe(true);
        } else {
          expect(children === null || (children.missing.length === 0 && !children.children.some(child => child.key.endsWith(':miss')))).toBe(true);
        }
      });
    }

    test('the immune cases are in the table (the oracle sees no miss) and the controls miss', () => {
      const verdicts = cases.map(entry => simulatorMisses(scene(entry.attacker, entry.defender), entry.p1));
      expect(verdicts).toEqual([false, false, false, false, true, true]);
    });
  });
});

describe('KoOddsInfo.attacker', () => {
  test('doubles: the slot of the attacking move and its species, the second slot included', () => {
    const battle = positionBattle(anchorRoot());
    // PLAYED[0] is "move lifedew, move playrough 2": the second slot's Play Rough makes the odds.
    const slot = battle.sides[0].active.findIndex(mon => mon?.moves.includes('playrough'));
    expect(slot).toBe(1);
    const [odds] = koOddsForOptions(battle, 'p1', [PLAYED[0]]);
    expect(odds?.attacker).toEqual({ slot, species: battle.sides[0].active[slot]!.species.name });
  });

  test('doubles: the first slot too, on the other side', () => {
    const root = doublesRoot(
      [pairSet('Pikachu', 'Pikachu', ['Protect', 'Growl']), pairSet('Eevee', 'Eevee', ['Protect', 'Growl'])],
      [pairSet('Machamp', 'Machamp', ['Karate Chop', 'Rock Slide']), pairSet('Snorlax', 'Snorlax', ['Tackle', 'Protect'])],
      battle => { for (const mon of battle.sides[0].active) mon!.sethp(30); },
    );
    const battle = positionBattle(root);
    const [odds] = koOddsForOptions(battle, 'p2', ['move rockslide, move protect']);
    expect(odds).not.toBeNull();
    expect(odds?.attacker).toEqual({ slot: 0, species: battle.sides[1].active[0]!.species.name });
  });

  test('singles: slot 0 and the attacker species', () => {
    const sim = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'A', team: Teams.pack([pairSet('Jolt', 'Jolteon', ['Thunder'])]) },
      p2: { name: 'B', team: Teams.pack([pairSet('Champ', 'Machamp', ['Close Combat'])]) },
    });
    if (sim.sides.some(side => side.requestState === 'teampreview')) {
      sim.choose('p1', 'team 1');
      sim.choose('p2', 'team 1');
    }
    sim.sides[1].active[0]!.sethp(1);
    const battle = positionBattle(createRootPosition(JSON.stringify(State.serializeBattle(sim))));
    const [odds] = koOddsForOptions(battle, 'p1', ['move thunder']);
    expect(odds).toEqual({ accuracy: 0.7, killFraction: 1, attacker: { slot: 0, species: battle.sides[0].active[0]!.species.name } });
  });
});
