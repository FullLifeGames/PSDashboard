import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { compareAlignment, extractProtocolEvents, scoreAlignment, type AlignmentScore } from '../src/hax-alignment';
import { loadSimMods } from '../src/forward/sim-mods';
import { loggedActions, loggedDice, mergeLoggedDice, type LoggedOptions } from '../src/dice/logged-results';
import { playForcedTurn } from '../src/dice/play';
import type { ForcedDie } from '../src/dice/types';
import {
  boardOf, clicksOf, PIKACHU, playClicks, RULES, seedOf, SNORLAX, type Mode, type Mon, type Rules, type Scene,
} from './dice-fixtures';
import { secondariesIn } from '../src/dice/secondaries';
import { dexOfRules } from './dice-sweep-support';

/**
 * Round 82 (forced dice), step A5: the simulator is the oracle of the log reader. A turn played on one seed writes a log;
 * its logged dice, forced on the same board under another seed, give a turn with the same accuracy, crits, secondaries,
 * hit counts, cants and move order. Every rule set the corpus plays, singles and doubles. The damage rolls stay with the
 * seed (the spec compares no HP).
 */
await loadSimMods('gen9championsou');

const par = (battle: Battle): void => void battle.sides[0].active[0]!.setStatus('par');
const confuse = (battle: Battle): void => void battle.sides[0].active[0]!.addVolatile('confusion');

interface RoundScene extends Scene { checks?: string[] }

/** Chansey, the foe: it survives every hit of the scenes (a faint changes the turn for a reason that is no die), and outspeeds Snorlax. */
const CHANSEY = (moves: string[]): Mon => ({ species: 'Chansey', moves });

const SCENES: RoundScene[] = [
  { id: 'tackle', a: SNORLAX(['tackle']), t: CHANSEY(['splash']) },
  { id: 'both sides attack', a: SNORLAX(['tackle']), t: CHANSEY(['tackle']), tMove: true },
  { id: 'headbutt before the foe moves', a: PIKACHU(['headbutt']), t: SNORLAX(['tackle']), tMove: true },
  { id: 'headbutt after the foe moved', a: SNORLAX(['headbutt']), t: CHANSEY(['tackle']), tMove: true },
  { id: 'flamethrower', a: SNORLAX(['flamethrower']), t: CHANSEY(['splash']) },
  { id: 'psychic', a: SNORLAX(['psychic']), t: CHANSEY(['splash']) },
  { id: 'fury attack', a: SNORLAX(['furyattack']), t: CHANSEY(['splash']) },
  { id: 'rock slide', a: SNORLAX(['rockslide']), t: CHANSEY(['splash']), spread: true },
  { id: 'ancient power', a: SNORLAX(['ancientpower']), t: CHANSEY(['splash']) },
  { id: 'a paralysed attacker', a: SNORLAX(['tackle']), t: CHANSEY(['splash']), setup: par, checks: ['par'] },
  { id: 'a confused attacker', a: SNORLAX(['tackle']), t: CHANSEY(['splash']), setup: confuse, checks: ['confusion'] },
];

function optionsOf(rules: Rules, scene: RoundScene, mode: Mode): LoggedOptions {
  const clicked = new Map([['p1a', scene.a.moves[0]], ['p2a', scene.tMove ? scene.t.moves[0] : 'splash']]);
  if (mode === 'doubles') for (const slot of ['p1b', 'p2b']) clicked.set(slot, 'splash');
  return { clicked, checks: scene.checks ? new Map([['p1a', scene.checks]]) : undefined, secondariesOf: secondariesIn(dexOfRules(rules)) };
}

const SEEDS = 6;

/** A multi-hit move whose hits crit unevenly: a die applies to every hit, so the log cannot be forced for it and the crits stay with the seed. */
const unevenCrits = (log: string[]): boolean =>
  loggedActions(log).some(action => Object.entries(action.crits).some(([slot, crits]) => crits < (action.damaged[slot] ?? 0)));
const PERFECT = (score: AlignmentScore): boolean => compareAlignment(score, { endedMismatch: false, faintMismatches: 0, softMismatches: 0 }) === 0;

function turnOf(battle: Battle, clicks: { p1: string; p2: string }, forced: readonly ForcedDie[]): string[] {
  const start = battle.log.length;
  playForcedTurn({ live: battle, forced, play: played => playClicks(played, clicks) });
  return battle.log.slice(start);
}

const cases = RULES.flatMap(rules => (['singles', 'doubles'] as Mode[]).filter(mode => mode === 'singles' || rules.doubles)
  .map(mode => ({ rules, mode, name: `${rules.name} ${mode}` })));

describe.each(cases)('the log of a turn, forced on another seed, gives the same turn: $name', ({ rules, mode }) => {
  test('every scene reproduces its log in accuracy, crits, secondaries, hit counts, cants and move order', () => {
    let played = 0;
    let moved = 0;
    const failures: string[] = [];
    for (const scene of SCENES) {
      const options = optionsOf(rules, scene, mode);
      for (let index = 0; index < SEEDS; index++) {
        const [source, target] = [boardOf(rules, scene, mode, seedOf(index)), boardOf(rules, scene, mode, seedOf(index + 40))];
        if (!source || !target) break;
        const clicks = clicksOf(scene, mode);
        const start = source.log.length;
        playClicks(source, clicks);
        const log = source.log.slice(start);
        const expected = extractProtocolEvents(log);
        const dice = loggedDice(log, options);
        if (dice.length === 0 || unevenCrits(log)) continue;
        played++;
        // the natural turn on the other seed: does it differ from the log at all?
        const natural = boardOf(rules, scene, mode, seedOf(index + 40))!;
        const naturalStart = natural.log.length;
        playClicks(natural, clicks);
        if (!PERFECT(scoreAlignment(expected, extractProtocolEvents(natural.log.slice(naturalStart))))) moved++;
        const merged = mergeLoggedDice({ logged: dice, forced: [dice[0]], changed: new Set() });
        const score = scoreAlignment(expected, extractProtocolEvents(turnOf(target, clicks, merged)));
        if (!PERFECT(score)) failures.push(`${scene.id} seed ${index}: ${JSON.stringify(score)}`);
      }
    }
    expect(played, 'the rule set plays turns').toBeGreaterThan(0);
    expect(moved, 'the other seed alone would not give the log').toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});
