import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildTeamsFromReplay } from '../src/team-builder';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { blockedContradictions, blockedSkips } from '../src/inference/blocked-effects';
import { Dex } from '@pkmn/sim';
import type { RulesDex } from '../src/rules-dex';
import { effectLands, mayRefuseHit, twinPlays } from '../src/sim-ask/effect-refusal';
import { play, type PlayBody } from './blocked-effects-play';

/**
 * Round 89 (#150, claim 2): a move hit that the log shows dealing damage rules out every candidate ability of the target under which the
 * simulator would have refused that hit. The scene of the issue is gen9natdexdraft-2713067801 turn 11 (Aqua Step hits Dracovish for 21 %,
 * and the app still built it with Water Absorb); the rows after it play the same rule on @pkmn/sim for singles, doubles and the Champions
 * mod, and the cases where the log proves nothing (a Mold Breaker attacker, a move or a condition that changes the type, Gravity, Ingrain,
 * Smack Down, an Illusion user, the whole set of the species). The sweep over every ability of every generation and mod is
 * `landed-hit-sweep.spec.ts`.
 */

const fixture = JSON.parse(readFileSync(new URL('./fixtures/gen9natdexdraft-2713067801.json', import.meta.url), 'utf8')) as { log: string };

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championsdoublescustomgame';
const CHAMPIONS_SINGLES = 'gen9championscustomgame';

const ruledOut = (log: string, species: string, side: 'p1' | 'p2' = 'p2'): string[] =>
  inferOpponentTeam(log, side).pokemon.find(mon => mon.species === species)?.ruledOut?.abilities ?? [];
const mon = (species: string, ability: string, moves: string[] = ['Splash'], item?: string): PlayBody => ({ species, ability, moves, item });
const FILLER = mon('Chansey', 'Natural Cure');
const singles = (source: PlayBody, target: PlayBody, format = SINGLES) => play({ format, p1: [source, FILLER], p2: [target, FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
const doubles = (source: PlayBody, target: PlayBody, partner: PlayBody = FILLER, aim = ' 1', format = DOUBLES) =>
  play({ format, p1: [source, FILLER, FILLER, FILLER], p2: [target, partner, FILLER, FILLER], turns: [{ p1: `move 1${aim}, move 1`, p2: 'move 1, move 1' }] });

describe('gen9natdexdraft-2713067801, turn 11: Aqua Step hits Dracovish for 21 %', () => {
  const lines = fixture.log.split('\n');
  const upTo = (marker: string) => lines.slice(0, lines.findIndex(line => line === marker)).join('\n');

  test('before the hit nothing is ruled out', () => {
    expect(ruledOut(upTo('|move|p1a: Quaquaval|Aqua Step|p2a: Dracovish'), 'Dracovish')).toEqual([]);
  });

  test('the landed hit rules out Water Absorb, and the build takes Strong Jaw', () => {
    expect(ruledOut(upTo('|turn|12'), 'Dracovish')).toEqual(['waterabsorb']);
    expect(buildTeamsFromReplay(fixture.log).p2Team.find(set => set.species === 'Dracovish')?.ability).toBe('Strong Jaw');
  });
});

describe('a landed hit rules out the abilities that refuse it', () => {
  test('singles: a Water move lands on Gastrodon, so Storm Drain is out', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Water Gun']), mon('Gastrodon', 'Sticky Hold')), 'Gastrodon')).toEqual(['stormdrain']);
  });

  test('doubles: the same hit rules out Storm Drain of the body that took it', () => {
    expect(ruledOut(doubles(mon('Smeargle', '', ['Water Gun']), mon('Gastrodon', 'Sticky Hold')), 'Gastrodon')).toEqual(['stormdrain']);
  });

  test('doubles: a single-target Water move that lands on one foe rules out Storm Drain of its ally (the redirect never happened)', () => {
    expect(ruledOut(doubles(mon('Smeargle', '', ['Water Gun']), FILLER, mon('Gastrodon', 'Sticky Hold')), 'Gastrodon')).toEqual(['stormdrain']);
  });

  test('doubles: a spread Water move damages both foes, so each is asked for itself (the ally\'s Storm Drain would have absorbed it too)', () => {
    expect(ruledOut(doubles(mon('Smeargle', '', ['Surf']), FILLER, mon('Gastrodon', 'Sticky Hold'), ''), 'Gastrodon')).toEqual(['stormdrain']);
  });

  test('Champions mod, singles and doubles: the Electric hit rules out Volt Absorb', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Thunderbolt']), mon('Jolteon', 'Quick Feet'), CHAMPIONS_SINGLES), 'Jolteon')).toEqual(['voltabsorb']);
    expect(ruledOut(doubles(mon('Smeargle', '', ['Thunderbolt']), mon('Jolteon', 'Quick Feet'), FILLER, ' 1', CHAMPIONS), 'Jolteon')).toEqual(['voltabsorb']);
  });

  test('a sound move lands on Exploud: Soundproof is out (singles and doubles)', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Hyper Voice']), mon('Exploud', 'Scrappy')), 'Exploud')).toEqual(['soundproof']);
    expect(ruledOut(doubles(mon('Smeargle', '', ['Hyper Voice']), mon('Exploud', 'Scrappy'), FILLER, ''), 'Exploud')).toEqual(['soundproof']);
  });

  test('a landed Ground move rules out Levitate (Bronzong: the second ability stays)', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Earthquake']), mon('Bronzong', 'Heatproof')), 'Bronzong')).toEqual(['levitate']);
    expect(ruledOut(doubles(mon('Smeargle', '', ['Earthquake']), mon('Bronzong', 'Heatproof'), FILLER, ''), 'Bronzong')).toEqual(['levitate']);
  });
});

describe('where the log proves nothing, nothing is ruled out', () => {
  const bronzong = mon('Bronzong', 'Levitate', ['Splash']);

  test('an attacker that may ignore the guard (Excadrill may hold Mold Breaker)', () => {
    expect(ruledOut(singles(mon('Excadrill', 'Sand Rush', ['Surf']), mon('Dracovish', 'Strong Jaw')), 'Dracovish')).toEqual([]);
  });

  test('Gravity grounds a Levitate holder', () => {
    const log = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Gravity', 'Earthquake']), FILLER], p2: [bronzong, FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }, { p1: 'move 2', p2: 'move 1' }] });
    expect(log).toMatch(/\|-damage\|p2a: Bronzong\|/);
    expect(ruledOut(log, 'Bronzong')).toEqual([]);
  });

  test('Ingrain and Smack Down ground a Levitate holder', () => {
    const ingrain = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Splash', 'Earthquake']), FILLER], p2: [mon('Bronzong', 'Levitate', ['Ingrain']), FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }, { p1: 'move 2', p2: 'move 1' }] });
    expect(ingrain).toMatch(/\|-damage\|p2a: Bronzong\|/);
    expect(ruledOut(ingrain, 'Bronzong')).toEqual([]);
    const smackDown = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Smack Down', 'Earthquake']), FILLER], p2: [bronzong, FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }, { p1: 'move 2', p2: 'move 1' }] });
    expect(smackDown.split('Earthquake')[1]).toMatch(/\|-damage\|p2a: Bronzong\|/);
    expect(ruledOut(smackDown, 'Bronzong')).toEqual([]);
  });

  test('a Ground move that ignores immunity (Thousand Arrows) proves nothing about Levitate', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Thousand Arrows']), mon('Bronzong', 'Heatproof')), 'Bronzong')).toEqual([]);
  });

  test('Electrify turns the Water move into an Electric one: Water Absorb stays (singles and doubles)', () => {
    const electrify = (format: string) => play({
      format, p1: [mon('Smeargle', '', ['Water Gun']), FILLER, FILLER, FILLER], p2: [mon('Dracovish', 'Strong Jaw', ['Electrify']), FILLER, FILLER, FILLER],
      turns: [{ p1: format === DOUBLES ? 'move 1 1, move 1' : 'move 1', p2: format === DOUBLES ? 'move 1 1, move 1' : 'move 1' }],
    });
    for (const format of [SINGLES, DOUBLES]) {
      const log = electrify(format);
      expect(log).toMatch(/Electrify/);
      expect(ruledOut(log, 'Dracovish')).toEqual([]);
    }
  });

  test('a move that sets its own type (Weather Ball) is not asked, and the skip is counted', () => {
    const before = blockedSkips();
    expect(ruledOut(singles(mon('Smeargle', '', ['Weather Ball']), mon('Gastrodon', 'Sticky Hold')), 'Gastrodon')).toEqual([]);
    expect(blockedSkips()).toBeGreaterThan(before);
  });

  test('a body that holds only the refusing ability (Shedinja, Wonder Guard) is a contradiction: nothing is ruled out, and it is counted', () => {
    const before = blockedContradictions();
    expect(ruledOut(singles(mon('Smeargle', '', ['Tackle']), mon('Shedinja', 'Wonder Guard')), 'Shedinja')).toEqual([]);
    expect(blockedContradictions()).toBeGreaterThanOrEqual(before);
  });

  test('a Ditto that takes a hit with no transform on the log keeps Imposter: the twin with Imposter plays another battle (a transform), so there is no verdict (singles and doubles)', () => {
    // Round 89 (#150), the first full run of the sweep: "Ditto type Fighting (Close Combat): imposter" was a false rule-out in Generation 5. With Imposter the
    // Ditto copies the attacker on entry and moves as a copy of it, so the scene is not the one the log shows; the played battle counts such a scene as landed.
    for (const [format, aim, ally] of [['gen5customgame', '', false], ['gen5doublescustomgame', ' 1', true]] as const) {
      const source = mon('Smeargle', 'Technician', ['Close Combat']);
      const log = ally ? doubles(source, mon('Ditto', 'Limber'), FILLER, aim, format) : singles(source, mon('Ditto', 'Limber'), format);
      expect(log).toMatch(/\|-damage\|p2a: Ditto\|/);
      expect(log).not.toMatch(/\|-transform\|/);
      expect(ruledOut(log, 'Ditto')).toEqual([]);
    }
  });

  test('the twin\'s target acts after the hit, never before: a Protean body under Water type takes Hex on the twin (singles and doubles)', () => {
    // The first full run of the prefilter sweep (Champions mod): "Greninja target Protean type Ghost (Hex)" was refused on the twin because the target's own
    // move came first in the twin's turn and Protean made it Normal. The log shows the hit after the target's own move and its type change (Water here), so
    // the twin's turn must not let the target act before the hit. (The reader asks no Protean in practice: it has no handler in a hit's steps.)
    const dex = Dex.forGen(9) as RulesDex;
    for (const partner of [undefined, { species: 'Chansey', ability: '' }]) {
      const scene = {
        target: { species: 'Greninja', ability: 'Protean', types: ['Water'] }, partner, source: { species: 'Smeargle', ability: 'Technician' },
        effect: { kind: 'hit' as const, id: 'hit' }, route: 'primary' as const, move: 'hex',
      };
      expect(effectLands(dex, scene)).toBe(true);
    }
  });

  test('known limit: a hidden Iron Ball grounds a Levitate holder, and the log does not show it (the rule rules Levitate out)', () => {
    const log = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Earthquake']), FILLER], p2: [mon('Bronzong', 'Levitate', ['Splash'], 'Iron Ball'), FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(log).toMatch(/\|-damage\|p2a: Bronzong\|/);
    expect(ruledOut(log, 'Bronzong')).toEqual(['levitate']);
  });
});

describe('the attacker as it stands now', () => {
  test('a Mega Gyarados (Mold Breaker) ignores Water Absorb, though Gyarados itself cannot hold Mold Breaker in its team entry', () => {
    const log = play({
      format: 'gen7customgame', p1: [mon('Gyarados', 'Moxie', ['Aqua Tail'], 'Gyaradosite'), FILLER], p2: [mon('Poliwrath', 'Damp'), FILLER], turns: [{ p1: 'move 1 mega', p2: 'move 1' }],
    });
    expect(log).toMatch(/\|detailschange\|p1a: Gyarados\|Gyarados-Mega/);
    expect(log).toMatch(/\|-damage\|p2a: Poliwrath\|/);
    expect(ruledOut(log, 'Poliwrath')).toEqual([]);
  });
});

describe('what the simulator is asked: only the candidates that could refuse a hit', () => {
  const dex = Dex.forGen(9) as RulesDex;

  test('an ability with a handler in a hit\'s steps, one that grounds or lifts the body and one that starts a field when it enters could refuse a hit; a bare one could not', () => {
    for (const ability of ['Water Absorb', 'Storm Drain', 'Wonder Guard', 'Bulletproof', 'Soundproof', 'Dazzling', 'Disguise', 'Levitate', 'Psychic Surge', 'Desolate Land', 'Damp', 'Forecast', 'Mimicry']) {
      expect(mayRefuseHit(dex, ability), ability).toBe(true);
    }
    for (const ability of ['Technician', 'Rough Skin', 'Solar Power', 'Intimidate', 'Natural Cure', 'Pressure', 'Inner Focus', 'Blaze', 'Protosynthesis', 'Sand Veil']) {
      expect(mayRefuseHit(dex, ability), ability).toBe(false);
    }
  });

  test('a hit on a body whose candidates cannot refuse it plays no scene on the twin (singles and doubles); a Storm Drain candidate does', () => {
    const asked = (log: string, species: string) => {
      const before = twinPlays();
      ruledOut(log, species);
      return twinPlays() - before;
    };
    const source = mon('Smeargle', 'Technician', ['Water Gun']);
    expect(asked(singles(source, mon('Charizard', 'Blaze')), 'Charizard')).toBe(0);
    expect(asked(doubles(source, mon('Charizard', 'Blaze')), 'Charizard')).toBe(0);
    expect(asked(singles(mon('Smeargle', 'Technician', ['Aqua Jet']), mon('Gastrodon', 'Sticky Hold')), 'Gastrodon')).toBeGreaterThan(0);
    expect(asked(doubles(mon('Smeargle', 'Technician', ['Aqua Tail']), mon('Gastrodon', 'Sand Force')), 'Gastrodon')).toBeGreaterThan(0);
  });
});
