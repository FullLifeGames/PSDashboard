import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { singleMoveFraction, pairThreat as pairThreatFromThreatRetype } from '../src/score/threat';
import { landedMove } from '../src/score/move-facts';
import { ScriptedPRNG } from '../src/forward/scripted-prng';
import { active, set, clickTera, singles } from './move-oracle';
import { battleOf } from './power-oracle';
import { createMatchupCache, evaluatePosition, type StaticRuleset, pairThreat, unansweredMons } from '../src/eval-function';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * STAB by the game's rules after a Tera click, held against the damage the simulator deals (modifyDamage: an old type or the Tera type 1.5, both 2.0, Stellar 2.0 on an
 * old type and 1.2 elsewhere on the first use of a type, Adaptability through its own handler; getDamage: a Tera-typed move under 60 power hits as 60).
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

/**
 * Plays the turns (p1's choices; p2 Splashes), the roll of p1's move pinned to the maximum, a sure hit and no
 * crit, and before each turn reads our fraction of that move in HP. Returns [ours, the simulator's damage].
 */
function turns(format: string, attacker: PokemonSet, defender: PokemonSet, id: string, choices: string[]): [number, number][] {
  const battle = battleOf(format, [attacker], [defender]);
  const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([[`p1:${id}`, { hit: true, crit: false, roll: 0 }]]));
  prng.attach(battle);
  battle.prng = prng;
  return choices.map(choice => {
    const [user, target] = [active(battle, 0), active(battle, 1)];
    if (choice.endsWith('terastallize')) user.terastallized = user.teraType;
    const ours = singleMoveFraction(user, target, id, battle) * target.maxhp;
    if (choice.endsWith('terastallize')) user.terastallized = undefined as never;
    const before = target.hp;
    battle.choose('p1', choice);
    battle.choose('p2', 'move 1');
    const dealt = before - target.hp;
    target.hp = target.maxhp;
    return [ours, dealt];
  });
}

function expectNear([ours, sim]: [number, number], label: string) {
  expect(Math.abs(ours - sim) / sim, `${label}: ours ${ours.toFixed(1)} against the sim's ${sim}`).toBeLessThan(0.03);
}

// Level 50: Blissey survives every hit, so the HP it loses is the whole damage.
const chomp = (teraType: string, move: string) => set('Garchomp', [move], { teraType, level: 50 });

describe('STAB by the rules after a Tera click (round 63, T81)', () => {
  test.each([
    ['Ground', 'earthquake', 'an old type that is also the Tera type: 2.0'],
    ['Fire', 'firefang', 'the Tera type alone: 1.5'],
    ['Fire', 'earthquake', 'an old type under another Tera type: 1.5'],
    ['Fire', 'icefang', 'neither: 1.0'],
  ])('Tera %s, %s (%s)', (teraType, move, label) => {
    for (const row of turns('gen9customgame', chomp(teraType, move), splash('Blissey'), move, ['move 1', 'move 1 terastallize', 'move 1'])) {
      expectNear(row, label);
    }
  });

  test('Stellar: 2.0 on an old type and 1.2 elsewhere on the first use of a type, the plain rate after it', () => {
    for (const move of ['earthquake', 'firefang']) {
      for (const row of turns('gen9customgame', chomp('Stellar', move), splash('Blissey'), move, ['move 1 terastallize', 'move 1'])) {
        expectNear(row, `Stellar ${move}`);
      }
    }
  });

  test('Adaptability asks its own handler: 2.0, 2.25 on the Tera type, nothing for an old type under another Tera type', () => {
    // Toxapex takes Normal and Ghost moves neutrally and survives them from a level-50 Porygon-Z.
    const zee = (teraType: string, move: string) => set('Porygon-Z', [move], { ability: 'Adaptability', teraType, level: 50 });
    for (const [teraType, move] of [['Normal', 'hypervoice'], ['Ghost', 'hypervoice'], ['Ghost', 'shadowball']]) {
      for (const row of turns('gen9customgame', zee(teraType, move), splash('Toxapex'), move, ['move 1', 'move 1 terastallize'])) {
        expectNear(row, `Adaptability Tera ${teraType} ${move}`);
      }
    }
  });

  test('a Tera-typed move under 60 power hits as 60 after the click, not a priority or multi-hit move', () => {
    for (const [teraType, move] of [['Fire', 'flamecharge'], ['Normal', 'quickattack']]) {
      const rows = turns('gen9customgame', chomp(teraType, move), splash('Blissey'), move, ['move 1', 'move 1 terastallize']);
      rows.forEach(row => expectNear(row, `Tera ${teraType} ${move}`));
    }
    // A multi-hit move: the first hit's damage (its roll pinned) against ours per hit.
    const battle = battleOf('gen9customgame', [chomp('Water', 'watershuriken')], [splash('Blissey')]);
    const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([['p1:watershuriken', { hit: true, crit: false, roll: 0 }]]));
    prng.attach(battle);
    battle.prng = prng;
    const [user, target] = [active(battle, 0), active(battle, 1)];
    user.terastallized = user.teraType;
    const perHit = singleMoveFraction(user, target, 'watershuriken', battle) * target.maxhp /
      landedHits(battle, user, target, 'watershuriken');
    user.terastallized = undefined as never;
    const from = battle.log.length;
    battle.choose('p1', 'move 1 terastallize');
    battle.choose('p2', 'move 1');
    const firstHit = battle.log.slice(from).find(line => line.startsWith('|-damage|p2a'))!;
    // A hit of a few HP: the sim's integer steps weigh more than 3 %, the 60 floor would read four times as much.
    expect(Math.abs(perHit - (target.maxhp - Number(firstHit.split('|')[3].split('/')[0])))).toBeLessThan(2);
  });

  test('doubles: Tera Ground High Horsepower into one foe of two', () => {
    const battle = battleOf('gen9doublescustomgame',
      [set('Garchomp', ['highhorsepower'], { teraType: 'Ground', level: 50 }), splash('Pikachu')], [splash('Blissey'), splash('Chansey')]);
    const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([['p1:highhorsepower', { hit: true, crit: false, roll: 0 }]]));
    prng.attach(battle);
    battle.prng = prng;
    const [user, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    user.terastallized = user.teraType;
    const ours = singleMoveFraction(user, target, 'highhorsepower', battle) * target.maxhp;
    user.terastallized = undefined as never;
    const before = target.hp;
    battle.choose('p1', 'move 1 1 terastallize, move 1');
    battle.choose('p2', 'move 1, move 1');
    expectNear([ours, before - target.hp], 'doubles Tera Ground High Horsepower');
  });
});

function landedHits(battle: Battle, user: Pokemon, target: Pokemon, id: string): number {
  return landedMove(user, target, battle.dex.moves.get(id), battle).landing ?? 1;
}

await loadSimMods('gen9championscustomgame');

const JUMP = 1e-3;

interface Mode { name: string; format: string; ruleset: StaticRuleset; doubles: boolean }
const MODES: Mode[] = [
  { name: 'Gen 9 singles', format: 'gen9customgame', ruleset: 'standard', doubles: false },
  { name: 'Champions singles', format: 'gen9championscustomgame', ruleset: 'champions', doubles: false },
  { name: 'VGC doubles', format: 'gen9doublescustomgame', ruleset: 'vgc', doubles: true },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', ruleset: 'champions', doubles: true },
];

interface Board { battle: Battle; holder: Pokemon; foe: Pokemon }

/** A Choice Scarf Garchomp (it moves first) against a Snorlax; in doubles each side brings a Splashing partner. */
function board(mode: Mode, foeMoves: string[]): Board {
  const mine = [set('Garchomp', ['crunch', 'splash'], { item: 'Choice Scarf' }), ...(mode.doubles ? [splash('Clefable')] : [])];
  const theirs = [set('Snorlax', [...foeMoves, 'splash']), ...(mode.doubles ? [splash('Clefable')] : [])];
  const battle = battleOf(mode.format, mine, theirs);
  return { battle, holder: battle.sides[0].active[0]!, foe: battle.sides[1].active[0]! };
}

/** The largest step the wrong way when the body goes down one HP point at a time from its maximum: p1's score rises as p1's body loses HP (`own`), or falls as p2's body loses HP. */
function worstStep(mode: Mode, battle: Battle, body: Pokemon, own: boolean): { size: number; at: number } {
  const scoreAt = (hp: number): number => {
    body.sethp(hp);
    return evaluatePosition(battle, createMatchupCache(mode.ruleset));
  };
  let previous = scoreAt(body.maxhp);
  let worst = { size: 0, at: body.maxhp };
  for (let hp = body.maxhp - 1; hp >= 1; hp--) {
    const score = scoreAt(hp);
    const size = own ? score - previous : previous - score;
    if (size > worst.size) worst = { size, at: hp };
    previous = score;
  }
  return worst;
}

describe.each(MODES)('$name', mode => {
  /** +2 Defense on the holder against a Snorlax whose Crunch it lives through for a while: the stage decides the race in a range of HP only. */
  function defense(): Board {
    const made = board(mode, ['crunch']);
    made.holder.boosts.def = 2;
    made.foe.sethp(Math.floor(made.foe.maxhp * 0.3));
    return made;
  }

  /** +2 Attack on the holder against a Snorlax that only splashes: the stage shortens the Crunch's clock while the Snorlax stands high. */
  function attack(): Board {
    const made = board(mode, []);
    made.holder.boosts.atk = 2;
    return made;
  }

  test('the simulator: the staged Crunch takes a part of the holder, so there is a range of HP in which the stage decides', () => {
    const { battle, holder } = defense();
    const doubles = battle.gameType === 'doubles';
    battle.choose('p1', doubles ? 'move 2, move 1' : 'move 2');
    battle.choose('p2', doubles ? 'move 1 1, move 1' : 'move 1');
    const taken = holder.maxhp - holder.hp;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(holder.maxhp / 2);
  });

  test('own HP down never raises the score by more than 1e-3, one HP point at a time (the stage that decides the race)', () => {
    const { battle, holder } = defense();
    expect(worstStep(mode, battle, holder, true).size).toBeLessThanOrEqual(JUMP);
  });

  test('foe HP down never lowers the score by more than 1e-3, one HP point at a time (the stage that shortens the clock)', () => {
    const { battle, foe } = attack();
    expect(worstStep(mode, battle, foe, false).size).toBeLessThanOrEqual(JUMP);
  });
});

describe('matchup-helpless-healer', () => {


  const JUMP = 1e-3;

  /** `attack` and `strikerHp` set the striker so that its hit stays under the healer's HP: the Champions stat table hits harder. */
  interface Mode { name: string; format: string; ruleset: StaticRuleset; doubles: boolean; attack: number; strikerHp: number }
  const MODES: Mode[] = [
    { name: 'Gen 9 singles', format: 'gen9customgame', ruleset: 'standard', doubles: false, attack: 0, strikerHp: 0.5 },
    { name: 'Champions singles', format: 'gen9championscustomgame', ruleset: 'champions', doubles: false, attack: -2, strikerHp: 0.9 },
    { name: 'VGC doubles', format: 'gen9doublescustomgame', ruleset: 'vgc', doubles: true, attack: 0, strikerHp: 0.5 },
    { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', ruleset: 'champions', doubles: true, attack: -2, strikerHp: 0.9 },
  ];

  const healer = () => set('Toxapex', ['recover', 'slackoff', 'scald', 'splash']);
  /** A Choice Scarf Garchomp: it moves first and takes most of a Toxapex with its High Horsepower. */
  const striker = () => set('Garchomp', ['highhorsepower', 'splash'], { item: 'Choice Scarf' });
  const partner = () => set('Clefable', ['splash']);

  interface Board { battle: Battle; healer: Pokemon; striker: Pokemon }

  /**
   * The healer on side `healerSide` against the striker, a poisoned Garchomp (at half HP in Scarlet/Violet: the healer's Scald and the poison
   * finish it in two turns while the healer holds, in four when it only takes the poison). Every other mon Splashes: a
   * Clefable beside them in doubles. `benched` puts the healer behind fillers, so it fights from the bench.
   */
  function board(mode: Mode, healerSide: 0 | 1, benched = false): Board {
    const fillers = Array.from({ length: (mode.doubles ? 2 : 1) - (benched ? 0 : 1) }, partner);
    const withHealer = benched ? [...fillers, healer()] : [healer(), ...fillers];
    const withStriker = [striker(), ...(mode.doubles ? [partner()] : [])];
    const battle = battleOf(mode.format, healerSide === 0 ? withHealer : withStriker, healerSide === 0 ? withStriker : withHealer);
    const found = (side: 0 | 1, species: string) => battle.sides[side].pokemon.find(mon => mon.species.name === species)!;
    const made = { battle, healer: found(healerSide, 'Toxapex'), striker: found(1 - healerSide as 0 | 1, 'Garchomp') };
    made.striker.sethp(Math.floor(made.striker.maxhp * mode.strikerHp));
    made.striker.setStatus('psn');
    made.striker.boosts.atk = mode.attack;
    return made;
  }

  /** The largest step the wrong way when the body goes down one HP point at a time from its maximum to a fifth of it: p1's score rises as p1's body loses HP (`own`), or falls as p2's body loses HP. */
  function worstStep(mode: Mode, battle: Battle, body: Pokemon, own: boolean): number {
    const scoreAt = (hp: number): number => {
      body.sethp(hp);
      return evaluatePosition(battle, createMatchupCache(mode.ruleset));
    };
    let previous = scoreAt(body.maxhp);
    let worst = 0;
    for (let hp = body.maxhp - 1; hp >= Math.ceil(body.maxhp / 5); hp--) {
      const score = scoreAt(hp);
      worst = Math.max(worst, own ? score - previous : previous - score);
      previous = score;
    }
    return worst;
  }

  describe.each(MODES)('$name', mode => {
    test('the simulator: the striker takes most of the healer in one hit, so there is a KO threshold inside its HP', () => {
      const { battle, healer: toxapex } = board(mode, 0);
      battle.choose('p1', mode.doubles ? 'move 4, move 1' : 'move 4');
      battle.choose('p2', mode.doubles ? 'move 1 1, move 1' : 'move 1');
      const taken = toxapex.maxhp - toxapex.hp;
      expect(taken).toBeGreaterThan(toxapex.maxhp / 2);
      expect(taken).toBeLessThan(toxapex.maxhp);
    });

    describe.each([{ place: 'in front', benched: false }, { place: 'on the bench', benched: true }])('the healer $place', ({ benched }) => {
      test('own HP down never raises the score by more than 1e-3, one HP point at a time', () => {
        const { battle, healer: toxapex } = board(mode, 0, benched);
        expect(worstStep(mode, battle, toxapex, true)).toBeLessThanOrEqual(JUMP);
      });

      test('foe HP down never lowers the score by more than 1e-3, one HP point at a time', () => {
        const { battle, healer: toxapex } = board(mode, 1, benched);
        expect(worstStep(mode, battle, toxapex, false)).toBeLessThanOrEqual(JUMP);
      });
    });
  });
});

await loadSimMods('gen9championsou');

// Every generation the profile reads (boundaryEvent returns nothing for generations 1 and 2) and the Champions mod.
const RULES = [
  { name: 'Generation 3', format: 'gen3customgame' },
  { name: 'Generation 4', format: 'gen4customgame' },
  { name: 'Generation 5', format: 'gen5customgame' },
  { name: 'Generation 6', format: 'gen6customgame' },
  { name: 'Generation 7', format: 'gen7customgame' },
  { name: 'Generation 8', format: 'gen8customgame' },
  { name: 'Scarlet/Violet', format: 'gen9customgame' },
  { name: 'Pokémon Champions', format: 'gen9championscustomgame' },
];
const STATUSES = ['brn', 'psn', 'tox'] as const;

describe.each(RULES)('$name: a finite tie by a status tick (T283)', rules => {
  // Seismic Toss deals the attacker's level (100) whatever the foe's stats: the hit is exact.
  const board = (status: (typeof STATUSES)[number], foeHp: number, bench: PokemonSet[] = []): Battle => {
    const battle = battleOf(rules.format,
      [set('Jolteon', ['seismictoss'], { level: 100 }), ...bench],
      [set('Swampert', ['earthquake'], { level: 100 })]);
    const attacker = battle.sides[0].active[0]!;
    const foe = battle.sides[1].active[0]!;
    attacker.sethp(1);
    foe.setStatus(status);
    foe.sethp(foeHp);
    return battle;
  };

  test.each(STATUSES)('%s: the simulator lets the slower foe act before its tick takes it', status => {
    // A bench keeps the game going when the Earthquake takes the attacker: the end of turn then still runs.
    const battle = board(status, 110, [set('Blissey', ['splash'], { level: 100 })]);
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    // Generation 3 asks for the replacement before the end of the turn: answer it, the tick comes after.
    if (!battle.log.some(line => line.startsWith('|faint|p2a'))) battle.choose('p1', 'switch 2');
    const log = battle.log;
    const foeMoved = log.findIndex(line => line.startsWith('|move|p2a'));
    const foeFell = log.findIndex(line => line.startsWith('|faint|p2a'));
    expect(foeMoved).toBeGreaterThan(-1);
    expect(foeFell).toBeGreaterThan(foeMoved);
  });

  test.each(STATUSES)('%s: a hit that leaves the foe on the tick is no won pair, a hit that finishes it is', status => {
    const left = unansweredMons(board(status, 110));
    expect(left.decided?.side).not.toBe('p1');
    expect(left.p1).toEqual([]);
    const finished = unansweredMons(board(status, 90));
    expect(finished.p1).toEqual(['Jolteon']);
    expect(finished.decided?.side).toBe('p1');
  });
});

describe('573756 turn 71: Magnezone against the poisoned Landorus-Therian (T283)', () => {
  const board = (tickGap: number): Battle => {
    const battle = battleOf('gen8customgame',
      [set('Magnezone', ['flashcannon', 'thunderbolt'], { level: 100, item: 'choicescarf' })],
      [set('Landorus-Therian', ['earthquake'], { level: 100 })]);
    const foe = battle.sides[1].active[0]!;
    const hit = Math.round(pairThreat(battle.sides[0].active[0]!, foe, battle).special * foe.maxhp);
    foe.setStatus('tox');
    foe.sethp(hit + tickGap);
    return battle;
  };

  test('a Flash Cannon that leaves the foe a few HP is no clean-up; one that finishes it is', () => {
    const left = unansweredMons(board(3));
    expect(left.p1).toEqual([]);
    expect(left.decided?.side).not.toBe('p1');
    expect(unansweredMons(board(-3)).p1).toEqual(['Magnezone']);
  });
});

describe('threat-retype', () => {
  const pairThreat = pairThreatFromThreatRetype;
  describe('body retypes in the static (round 57)', () => {
    test('Liquid Voice Hyper Voice hits a Tera-Ghost Sneasler', () => {
      const battle = singles('gen9customgame',
        [set('Sneasler', ['splash'], { teraType: 'Ghost' })],
        [set('Primarina', ['splash', 'hypervoice'], { ability: 'Liquid Voice' })]);
      clickTera(battle, 0);
      expect(singleMoveFraction(active(battle, 1), active(battle, 0), 'hypervoice', battle)).toBeGreaterThan(0.2);
    });

    test('Wellspring Ivy Cudgel is absorbed by Water Absorb', () => {
      const battle = singles('gen9customgame',
        [set('Ogerpon-Wellspring', ['ivycudgel'], { item: 'Wellspring Mask', ability: 'Water Absorb' })],
        [set('Vaporeon', ['splash'], { ability: 'Water Absorb' })]);
      expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'ivycudgel', battle)).toBe(0);
    });

    test('Pixilate Hyper Voice hits a Ghost and lands in the special bucket', () => {
      const battle = singles('gen9customgame', [set('Sylveon', ['hypervoice'], { ability: 'Pixilate' })], [set('Gengar', ['splash'])]);
      expect(pairThreat(active(battle, 0), active(battle, 1), battle).special).toBeGreaterThan(0.2);
    });

    test("Scrappy and Mind's Eye hit Ghosts with Normal and Fighting moves", () => {
      const scrappy = singles('gen9customgame', [set('Kangaskhan', ['doubleedge', 'drainpunch'], { ability: 'Scrappy' })], [set('Gengar', ['splash'])]);
      expect(singleMoveFraction(active(scrappy, 0), active(scrappy, 1), 'doubleedge', scrappy)).toBeGreaterThan(0.2);
      expect(singleMoveFraction(active(scrappy, 0), active(scrappy, 1), 'drainpunch', scrappy)).toBeGreaterThan(0.05);
      const eye = singles('gen9customgame', [set('Ursaluna-Bloodmoon', ['bloodmoon'], { ability: "Mind's Eye" })], [set('Gengar', ['splash'])]);
      expect(singleMoveFraction(active(eye, 0), active(eye, 1), 'bloodmoon', eye)).toBeGreaterThan(0.2);
      const plain = singles('gen9customgame', [set('Kangaskhan', ['doubleedge'], { ability: 'Early Bird' })], [set('Gengar', ['splash'])]);
      expect(singleMoveFraction(active(plain, 0), active(plain, 1), 'doubleedge', plain)).toBe(0);
    });
  });

  describe('field retypes in the static (round 57)', () => {
    test('Weather Ball in rain hits a Ghost (gen9ou-2658663604 turn 11)', () => {
      const battle = singles('gen9customgame', [set('Pelipper', ['weatherball'], { ability: 'Drizzle' })], [set('Gengar', ['splash'])]);
      expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'weatherball', battle)).toBeGreaterThan(0.2);
    });
  });

  describe('Tera retypes in the static (round 57)', () => {
    test('Tera-Fairy Tera Blast lands in the physical bucket against a Dragon', () => {
      const battle = singles('gen9customgame', [set('Dragonite', ['splash', 'terablast'], { teraType: 'Fairy', nature: 'Adamant' })], [set('Garchomp', ['splash'])]);
      const before = pairThreat(active(battle, 0), active(battle, 1), battle);
      clickTera(battle, 0);
      const after = pairThreat(active(battle, 0), active(battle, 1), battle);
      expect(after.physical).toBeGreaterThan(before.special * 2);
    });

    test('a Stellar Tera Blast hits a terastallized target twice as hard', () => {
      const battle = singles('gen9customgame', [set('Garchomp', ['splash', 'terablast'], { teraType: 'Stellar' })], [set('Snorlax', ['splash'], { teraType: 'Normal' })]);
      clickTera(battle, 0);
      const plain = singleMoveFraction(active(battle, 0), active(battle, 1), 'terablast', battle);
      clickTera(battle, 1);
      expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'terablast', battle)).toBeCloseTo(plain * 2, 5);
    });
  });

  describe('Hidden Power in the static (round 57)', () => {
    test('gen 6 Hidden Power Ice is four times effective on Landorus-Therian (648453 turn 13)', () => {
      const battle = singles('gen6customgame', [set('Tornadus-Therian', ['hiddenpowerice', 'icebeam'])], [set('Landorus-Therian', ['splash'])]);
      const [tornadus, lando] = [active(battle, 0), active(battle, 1)];
      const hp = singleMoveFraction(tornadus, lando, 'hiddenpower', battle);
      const beam = singleMoveFraction(tornadus, lando, 'icebeam', battle);
      expect(hp).toBeGreaterThan(beam * 0.6);
      expect(hp).toBeLessThan(beam * 0.75);
    });

    test('gen 3 Hidden Power is priced, not 0', () => {
      const battle = singles('gen3customgame', [set('Arcanine', ['hiddenpowerelectric'])], [set('Charizard', ['splash'])]);
      expect(pairThreat(active(battle, 0), active(battle, 1), battle).special).toBeGreaterThan(0.2);
    });

    test('gen 7 Hidden Power Fire hits a Ghost', () => {
      const battle = singles('gen7customgame', [set('Magnezone', ['hiddenpowerfire'])], [set('Gengar', ['splash'])]);
      expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'hiddenpower', battle)).toBeGreaterThan(0.1);
    });
  });
});
