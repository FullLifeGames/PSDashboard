import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { classifyChild, type CellEvent } from '../src/cell-blend';
import { advancePositionWithLog, createRootPosition } from '../src/forward-model';

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
