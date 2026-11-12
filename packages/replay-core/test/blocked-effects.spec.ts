import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { play, type PlayBody } from './blocked-effects-play';

/**
 * Round 89 (#110): a landed effect rules out the abilities that would have refused it. Rows on written and played logs: the scene
 * of the issue (Doubles OU 2663093831: Intimidate and a Rock Slide flinch land on Dragonite, so it holds no Inner Focus), the
 * same effects in singles, in doubles and under the Champions mod, the ally's guard (Flower Veil, Sweet Veil), and every case where
 * the log proves nothing: an attacker that may ignore the target's ability, Neutralizing Gas, an Illusion user on the team, an
 * effect the body dealt itself, a reflected drop, a swapped ability, the last ability the species has. Every log except the
 * fixture's comes from @pkmn/sim. The sweep over every ability of every generation and mod is `blocked-effects-sweep.spec.ts`.
 */

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championsdoublescustomgame';

const ruledOut = (log: string, side: 'p1' | 'p2', species: string): string[] =>
  inferOpponentTeam(log, side).pokemon.find(mon => mon.species === species)?.ruledOut?.abilities ?? [];

const mon = (species: string, ability: string, moves: string[] = ['Splash']): PlayBody => ({ species, ability, moves });
const FILLER = mon('Chansey', 'Natural Cure');

/** A singles scene: p1 uses its first move into p2's lead on turn 1, p2 splashes. */
const singles = (source: PlayBody, target: PlayBody) => play({ format: SINGLES, p1: [source, FILLER], p2: [target, FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
/** A doubles scene: p1's first body uses its first move at p2's first body (a spread move needs no aim), the rest splash. */
const doubles = (source: PlayBody, target: PlayBody, partner: PlayBody = FILLER, aim = ' 1', format = DOUBLES) =>
  play({ format, p1: [source, FILLER, FILLER, FILLER], p2: [target, partner, FILLER, FILLER], turns: [{ p1: `move 1${aim}, move 1`, p2: 'move 1, move 1' }] });

describe('Doubles OU 2663093831: the Intimidate and the Rock Slide flinch rule out Dragonite\'s Inner Focus', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../test/e2e-feedback/fixtures/gen9doublesou-2663093831.json', import.meta.url), 'utf8')) as { log: string };
  const lines = fixture.log.split('\n');
  const upTo = (stop: (line: string) => boolean) => lines.slice(0, lines.findIndex(stop)).join('\n');
  const intimidate = lines.findIndex(line => line.startsWith('|-ability|p2a: terrorist|Intimidate'));

  test('turn 8: the Intimidate drop lands on Dragonite (the ability of the top usage stats blocks it)', () => {
    const log = upTo(line => line.startsWith('|turn|9'));
    expect(ruledOut(log, 'p1', 'Dragonite')).toEqual(['innerfocus']);
  });

  test('turn 9: the flinch alone says the same, with the Intimidate line cut away', () => {
    const log = [...lines.slice(0, intimidate - 1), ...lines.slice(intimidate + 3)].join('\n');
    expect(ruledOut(log, 'p1', 'Dragonite')).toEqual(['innerfocus']);
  });

  test('before the Intimidate nothing is ruled out', () => {
    expect(ruledOut(lines.slice(0, intimidate - 1).join('\n'), 'p1', 'Dragonite')).toEqual([]);
  });

  test('Sinistcha took the same drop and flinch and holds no ability they refuse: it keeps the two rule-outs it had (Ground and indirect damage)', () => {
    expect(ruledOut(fixture.log, 'p1', 'Sinistcha')).toEqual(['levitate', 'magicguard']);
  });
});

describe('an Intimidate that a Transform copied: the log names the ability, so the drop still rules out the guards', () => {
  // Doubles OU 2543203909 turn 5: Mew transforms into Incineroar and Intimidate lowers the Attack of Dragonite.
  const copied = (target: PlayBody, format = DOUBLES) => play({
    format, p1: [mon('Mew', 'Synchronize', ['Transform']), FILLER, FILLER, FILLER], p2: [mon('Incineroar', 'Intimidate'), target, FILLER, FILLER],
    turns: [{ p1: 'move 1 1, move 1', p2: 'move 1, move 1' }],
  });

  test('Mew copies Intimidate and lowers Dragonite: Inner Focus is out (Doubles OU, VGC SV)', () => {
    const log = copied(mon('Dragonite', 'Multiscale'));
    expect(log).toContain('|-ability|p1a: Mew|Intimidate|boost');
    expect(log).toContain('|-unboost|p2b: Dragonite|atk|1');
    expect(ruledOut(log, 'p2', 'Dragonite')).toEqual(['innerfocus']);
  });

  test('the same copy under the Champions mod (Champions VGC)', () => {
    expect(ruledOut(copied(mon('Dragonite', 'Multiscale'), CHAMPIONS), 'p2', 'Dragonite')).toEqual(['innerfocus']);
  });

  test('Trace copies Intimidate from a foe: the same drop on the foe\'s partner (the source is no Intimidate species)', () => {
    const log = play({
      format: DOUBLES, p1: [mon('Gardevoir', 'Trace'), FILLER, FILLER, FILLER], p2: [mon('Incineroar', 'Intimidate'), mon('Dragonite', 'Multiscale'), FILLER, FILLER],
      turns: [{ p1: 'move 1, move 1', p2: 'move 1, move 1' }],
    });
    expect(log).toContain('|-unboost|p2b: Dragonite|atk|1');
    expect(ruledOut(log, 'p2', 'Dragonite')).toEqual(['innerfocus']);
  });

  // Singles has no row: the foe of the copier is the body it copied from, and that body's Intimidate is on the log already.
});

describe('a landed flinch rules out the ability that refuses it', () => {
  test('singles: Mienshao keeps Regenerator and Reckless, loses Inner Focus', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Fake Out']), mon('Mienshao', 'Regenerator')), 'p1', 'Mienshao')).toEqual([]);
    expect(ruledOut(singles(mon('Smeargle', '', ['Fake Out']), mon('Mienshao', 'Regenerator')), 'p2', 'Mienshao')).toEqual(['innerfocus']);
  });

  test('doubles (Doubles OU, VGC SV): Dragonite loses Inner Focus', () => {
    expect(ruledOut(doubles(mon('Smeargle', '', ['Fake Out']), mon('Dragonite', 'Multiscale')), 'p2', 'Dragonite')).toEqual(['innerfocus']);
  });

  test('doubles under the Champions mod (Champions VGC): Dragonite loses Inner Focus', () => {
    expect(ruledOut(doubles(mon('Smeargle', '', ['Fake Out']), mon('Dragonite', 'Multiscale'), FILLER, ' 1', CHAMPIONS), 'p2', 'Dragonite')).toEqual(['innerfocus']);
  });

  test('a spread flinch (Rock Slide) hits both bodies and rules out each one\'s own guard', () => {
    const log = doubles(mon('Smeargle', '', ['Fake Out']), mon('Dragonite', 'Multiscale'), mon('Hypno', 'Forewarn'));
    expect(ruledOut(log, 'p2', 'Dragonite')).toEqual(['innerfocus']);
  });
});

describe('a landed stat drop, status, confusion or Taunt rules out the guard against it', () => {
  test('Intimidate lowers Metagross: Clear Body is out, Light Metal stays (singles)', () => {
    expect(ruledOut(singles(mon('Gyarados', 'Intimidate'), mon('Metagross', 'Light Metal')), 'p2', 'Metagross')).toEqual(['clearbody']);
  });

  test('a primary drop (Growl) lowers Metagross in doubles: Clear Body is out; Scrappy refuses Intimidate only, so Kangaskhan keeps all three', () => {
    expect(ruledOut(doubles(mon('Smeargle', '', ['Growl']), mon('Metagross', 'Light Metal'), FILLER, ''), 'p2', 'Metagross')).toEqual(['clearbody']);
    expect(ruledOut(doubles(mon('Smeargle', '', ['Growl']), mon('Kangaskhan', 'Early Bird'), FILLER, ''), 'p2', 'Kangaskhan')).toEqual([]);
  });

  test('Intimidate lowers Kangaskhan: Scrappy and Inner Focus refuse Intimidate, so they are out (Champions)', () => {
    const log = play({ format: CHAMPIONS, p1: [mon('Gyarados', 'Intimidate'), FILLER], p2: [mon('Kangaskhan', 'Early Bird'), FILLER], turns: [{ p1: 'move 1, move 1', p2: 'move 1, move 1' }] });
    expect(ruledOut(log, 'p2', 'Kangaskhan').sort()).toEqual(['innerfocus', 'scrappy']);
  });

  test('a secondary drop (Mud-Slap, accuracy) rules out Keen Eye (and Levitate, which the Ground hit refuted before this round)', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Mud-Slap']), mon('Sneasel', 'Pickpocket')), 'p2', 'Sneasel').sort()).toEqual(['keeneye', 'levitate']);
  });

  test('sleep lands on Hypno: Insomnia is out (singles)', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Spore']), mon('Hypno', 'Forewarn')), 'p2', 'Hypno')).toEqual(['insomnia']);
  });

  test('confusion lands on Slowbro: Own Tempo is out', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Confuse Ray']), mon('Slowbro', 'Regenerator')), 'p2', 'Slowbro')).toEqual(['owntempo']);
  });

  test('Taunt lands on Slowbro: Oblivious is out', () => {
    expect(ruledOut(singles(mon('Smeargle', '', ['Taunt']), mon('Slowbro', 'Regenerator')), 'p2', 'Slowbro')).toEqual(['oblivious']);
  });
});

describe('the ally\'s guard is ruled out in doubles', () => {
  test('Charm lowers a Grass ally of Florges: Flower Veil is out, Symbiosis stays', () => {
    const log = doubles(mon('Smeargle', '', ['Charm']), mon('Sceptile', 'Overgrow'), mon('Florges', 'Symbiosis'));
    expect(ruledOut(log, 'p2', 'Florges')).toEqual(['flowerveil']);
    expect(ruledOut(log, 'p2', 'Sceptile')).toEqual([]);
  });

  test('Spore puts a body to sleep next to a Slurpuff: Sweet Veil is out', () => {
    const log = doubles(mon('Smeargle', '', ['Spore']), mon('Pikachu', 'Static'), mon('Slurpuff', 'Unburden'));
    expect(ruledOut(log, 'p2', 'Slurpuff')).toEqual(['sweetveil']);
  });

  test('Flower Veil guards Grass allies only: a non-Grass target proves nothing about the partner', () => {
    const log = doubles(mon('Smeargle', '', ['Charm']), mon('Pikachu', 'Static'), mon('Florges', 'Symbiosis'));
    expect(ruledOut(log, 'p2', 'Florges')).toEqual([]);
  });

  test('singles has no ally: the same drop rules out nothing for a body on the bench', () => {
    const log = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Charm']), FILLER], p2: [mon('Sceptile', 'Overgrow'), mon('Florges', 'Symbiosis')], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(ruledOut(log, 'p2', 'Florges')).toEqual([]);
  });
});

describe('the log proves nothing', () => {
  test('a Mold Breaker kin ignores Inner Focus: the flinch rules nothing out', () => {
    expect(ruledOut(singles(mon('Excadrill', 'Mold Breaker', ['Fake Out']), mon('Dragonite', 'Inner Focus')), 'p2', 'Dragonite')).toEqual([]);
  });

  test('an attacker of a species that may hold Mold Breaker ignores nothing for certain, and the flinch rules nothing out', () => {
    expect(ruledOut(singles(mon('Excadrill', 'Sand Rush', ['Fake Out']), mon('Dragonite', 'Multiscale')), 'p2', 'Dragonite')).toEqual([]);
  });

  test('doubles: the same Mold Breaker attacker, the same silence', () => {
    expect(ruledOut(doubles(mon('Excadrill', 'Mold Breaker', ['Fake Out']), mon('Dragonite', 'Inner Focus')), 'p2', 'Dragonite')).toEqual([]);
    expect(ruledOut(doubles(mon('Excadrill', 'Sand Rush', ['Fake Out']), mon('Dragonite', 'Multiscale')), 'p2', 'Dragonite')).toEqual([]);
  });

  test('Neutralizing Gas on the field turns every ability off', () => {
    const log = play({ format: SINGLES, p1: [mon('Weezing-Galar', 'Neutralizing Gas', ['Fake Out']), FILLER], p2: [mon('Dragonite', 'Inner Focus'), FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(log).toContain('Neutralizing Gas');
    expect(ruledOut(log, 'p2', 'Dragonite')).toEqual([]);
  });

  test('an Illusion user on the team makes every line suspect', () => {
    const log = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Fake Out']), FILLER], p2: [mon('Dragonite', 'Multiscale'), mon('Zoroark', 'Illusion')], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(ruledOut(log, 'p2', 'Dragonite')).toEqual([]);
  });

  test('a drop the body dealt itself (Close Combat) says nothing about Clear Body', () => {
    const log = play({ format: SINGLES, p1: [FILLER, FILLER], p2: [mon('Metagross', 'Clear Body', ['Close Combat']), FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(log).toContain('|-unboost|p2a: Metagross|def|1');
    expect(ruledOut(log, 'p2', 'Metagross')).toEqual([]);
  });

  test('a Growl that Mirror Armor reflects drops the user\'s own Attack: Clear Body stays possible', () => {
    const log = play({ format: SINGLES, p1: [mon('Corviknight', 'Mirror Armor'), FILLER], p2: [mon('Metagross', 'Light Metal', ['Growl']), FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(log).toContain('|-unboost|p2a: Metagross|atk|1');
    expect(ruledOut(log, 'p2', 'Metagross')).toEqual([]);
  });

  test('a Skill Swap before the drop: the body holds another ability now, and the log shows it', () => {
    const log = play({
      format: SINGLES, p1: [mon('Smeargle', 'Technician', ['Skill Swap', 'Charm']), FILLER], p2: [mon('Metagross', 'Clear Body'), FILLER],
      turns: [{ p1: 'move 1', p2: 'move 1' }, { p1: 'move 2', p2: 'move 1' }],
    });
    expect(ruledOut(log, 'p2', 'Metagross')).toEqual([]);
  });

  test('the same flinch next to a body that is no longer the one on the log (the ability suppressed by Gastro Acid)', () => {
    const log = play({
      format: SINGLES, p1: [mon('Smeargle', '', ['Gastro Acid', 'Fake Out']), FILLER], p2: [mon('Dragonite', 'Inner Focus'), FILLER],
      turns: [{ p1: 'move 1', p2: 'move 1' }, { p1: 'move 2', p2: 'move 1' }],
    });
    expect(ruledOut(log, 'p2', 'Dragonite')).toEqual([]);
  });

  test('a body that is transformed holds the target\'s ability: nothing is ruled out', () => {
    const log = play({ format: SINGLES, p1: [mon('Smeargle', '', ['Fake Out']), FILLER], p2: [mon('Ditto', 'Imposter', ['Transform']), FILLER], turns: [{ p1: 'move 1', p2: 'move 1' }] });
    expect(ruledOut(log, 'p2', 'Ditto')).toEqual([]);
  });
});
