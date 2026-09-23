import { describe, expect, test } from 'vitest';
import { createMatchupCache } from '../src/eval-function';
import { legalChoices, positionBattle } from '../src/forward-model';
import { drawPair } from '../src/pair/draw';
import { parsePairChoice, planTimeFallback } from '../src/pair/guards';
import { killTable } from '../src/pair/kill-table';
import { readPattern, type Pattern, type PatternRead } from '../src/pair/pattern';
import type { PairScripts } from '../src/pair/prng';
import { anchorRoot, doublesRoot, pairSet, PLAYED, QUIET } from './pair-battles';

function read(root: ReturnType<typeof anchorRoot>, p1: string, p2: string, scripts: PairScripts = new Map(), table = killTable): PatternRead {
  const drawn = drawPair(root, p1, p2, '1,2,3,4', scripts, createMatchupCache());
  return readPattern(drawn.records, drawn.log, positionBattle(root).dex, table);
}

const pattern = (value: PatternRead): Pattern => {
  expect(value.kind).toBe('pattern');
  return value as Pattern;
};

describe('a draw read as a class of the pair plan (round 56)', () => {
  test('the played cell: the Play Rough miss at 10 %, the Matcha Gotcha hit at 90 %, the sure Flare Blitz kill is no event', () => {
    const read1 = pattern(read(anchorRoot(), ...PLAYED));
    expect(read1.key).toBe('p1b:playrough>p2b=miss|p2a:matchagotcha>p1b=hit-nokill');
    expect(read1.weight).toBeCloseTo(0.09, 9);
    const [playRough] = read1.events;
    expect(playRough.alternatives).toEqual([
      { outcome: 'hit-kill', probability: expect.closeTo(0.9, 9), script: { hit: true, crit: false, roll: 7 } },
    ]);
  });

  test('the forced Play Rough kill: the 90 % class, Flare Blitz never comes, Matcha Gotcha rolls on both targets', () => {
    const forced = pattern(read(anchorRoot(), ...PLAYED, new Map([['p1b:playrough>p2b', { hit: true, crit: false, roll: 7 }]])));
    expect(forced.events[0]).toMatchObject({ key: 'p1b:playrough>p2b', outcome: 'hit-kill' });
    expect(forced.events[0].probability).toBeCloseTo(0.9, 9);
    const keys = forced.events.map(event => event.key);
    expect(keys).toContain('p2a:matchagotcha>p1a');
    expect(keys).toContain('p2a:matchagotcha>p1b');
    expect(keys.some(key => key.startsWith('p2b:flareblitz'))).toBe(false);
  });

  test('a quiet cell has no events and weight 1', () => {
    const quiet = pattern(read(anchorRoot(), ...QUIET));
    expect(quiet.events).toEqual([]);
    expect(quiet.weight).toBe(1);
  });

  test('a calc that misses the drawn damage sends the read to the fallback', () => {
    const wrong = () => ({ normal: Array(16).fill(1), crit: Array(16).fill(1) });
    expect(read(anchorRoot(), ...PLAYED, new Map(), wrong)).toEqual({ kind: 'fallback', reason: 'calc-mismatch' });
  });

  test('a speed tie among move actions sends the read to the fallback', () => {
    const pika = (name: string) => pairSet(name, 'Pikachu', ['Thunderbolt', 'Protect'], {
      nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    });
    const blissey = (name: string) => pairSet(name, 'Blissey', ['Soft-Boiled', 'Protect']);
    const root = doublesRoot([pika('A'), blissey('B')], [pika('C'), blissey('D')]);
    expect(read(root, 'move thunderbolt 1, move softboiled', 'move thunderbolt 1, move softboiled')).toEqual({ kind: 'fallback', reason: 'tie' });
  });

  // In the built battles below every acting body has its own speed: two equal bodies on one priority are a
  // speed tie, and the tie rule answers before the rule a test is about.
  test('a flinch-capable hit on a target that moves later sends the read to the fallback', () => {
    // Extrasensory flinches one time in ten and not in this draw, so the rule on the chance answers
    // (Rock Slide's two 30 % rolls flinched here, and a real flinch answers as cant:flinch).
    const root = doublesRoot(
      [pairSet('Fast', 'Aerodactyl', ['Extrasensory', 'Protect'], { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('Slow1', 'Snorlax', ['Body Slam', 'Protect']), pairSet('Slow2', 'Munchlax', ['Body Slam', 'Protect'])],
    );
    expect(read(root, 'move extrasensory 1, move softboiled', 'move bodyslam 1, move bodyslam 1')).toEqual({ kind: 'fallback', reason: 'flinch-chance' });
  });

  test('a Focus Sash on full HP sends the read to the fallback', () => {
    const root = doublesRoot(
      [pairSet('Hit', 'Garchomp', ['Dragon Claw', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('Sash', 'Pikachu', ['Protect', 'Thunderbolt'], { item: 'Focus Sash' }), pairSet('Wall2', 'Chansey', ['Soft-Boiled', 'Protect'])],
    );
    expect(read(root, 'move dragonclaw 1, move softboiled', 'move thunderbolt 1, move softboiled')).toEqual({ kind: 'fallback', reason: 'shielded:sash' });
  });

  test('a second roll on one target (a multi-hit the rules before the dice let through) sends the read to the fallback', () => {
    const root = doublesRoot(
      [pairSet('Kick', 'Hitmonlee', ['Double Kick', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('C', 'Chansey', ['Soft-Boiled', 'Protect']), pairSet('D', 'Snorlax', ['Soft-Boiled', 'Protect'])],
    );
    expect(read(root, 'move doublekick 1, move softboiled', 'move softboiled, move softboiled')).toEqual({ kind: 'fallback', reason: 'multi-roll' });
  });

  test('a random drag-in sends the read to the fallback', () => {
    const root = doublesRoot(
      [pairSet('Blow', 'Pidgeot', ['Whirlwind', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('Front', 'Snorlax', ['Rest', 'Protect']), pairSet('Front2', 'Munchlax', ['Rest', 'Protect']), pairSet('Back', 'Blissey', ['Soft-Boiled']), pairSet('Back2', 'Chansey', ['Soft-Boiled'])],
    );
    expect(read(root, 'move whirlwind 1, move softboiled', 'move rest, move rest')).toEqual({ kind: 'fallback', reason: 'drag' });
  });
});

describe('pair choices and the rules before the dice (round 56)', () => {
  test('a lone body in slot b owns the single part of its side\'s choice', () => {
    const root = doublesRoot(
      [pairSet('Gone', 'Pikachu', ['Protect']), pairSet('Rock', 'Tyranitar', ['Rock Slide', 'Protect'])],
      [pairSet('A', 'Snorlax', ['Rest', 'Protect']), pairSet('B', 'Snorlax', ['Rest', 'Protect'])],
      battle => {
        battle.sides[0].active[0]!.faint();
        battle.faintMessages();
      },
    );
    const battle = positionBattle(root);
    const choice = legalChoices(root, 'p1', { tera: false }).find(option => option.choice.startsWith('move rockslide'))!.choice;
    expect(parsePairChoice(battle, 0, choice)).toEqual([{ kind: 'move', slot: 1, moveId: 'rockslide', loc: null }]);
  });

  test('team preview and wait are not pair choices', () => {
    const battle = positionBattle(anchorRoot());
    expect(parsePairChoice(battle, 0, 'team 12')).toBeNull();
    expect(parsePairChoice(battle, 0, 'wait')).toBeNull();
    expect(parsePairChoice(battle, 0, PLAYED[0])).toEqual([
      { kind: 'move', slot: 0, moveId: 'lifedew', loc: null },
      { kind: 'move', slot: 1, moveId: 'playrough', loc: 2 },
    ]);
  });

  test('paralysis, multi-hit moves, random targets and random calls go to the fallback before any draw', () => {
    const rules = (p1Moves: string[], choice: string, setup?: Parameters<typeof doublesRoot>[2]) => {
      const p2 = [pairSet('A', 'Snorlax', ['Rest', 'Protect']), pairSet('B', 'Snorlax', ['Rest', 'Protect'])];
      const root = doublesRoot([pairSet('Act', 'Dragonite', p1Moves), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], p2, setup);
      const battle = positionBattle(root);
      return planTimeFallback(battle, [parsePairChoice(battle, 0, choice)!, parsePairChoice(battle, 1, 'move rest, move rest')!]);
    };
    expect(rules(['Dragon Claw'], 'move dragonclaw 1, move softboiled', battle => { battle.sides[0].active[0]!.setStatus('par'); })).toBe('prevented:par');
    expect(rules(['Dual Wingbeat'], 'move dualwingbeat 1, move softboiled')).toBe('multi-hit');
    expect(rules(['Outrage'], 'move outrage, move softboiled')).toBe('random-target');
    expect(rules(['Metronome'], 'move metronome, move softboiled')).toBe('random-call');
    expect(rules(['Dragon Claw'], 'move dragonclaw 1, move softboiled')).toBeNull();
  });
});
