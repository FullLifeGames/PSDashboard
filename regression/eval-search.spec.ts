import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
type DeserializeFn = typeof State.deserializeBattle;
import type { PokemonSet } from '@pkmn/sim';
import { searchOptions, searchPosition, subSearchDepth1 } from '../src/lib/eval/search';
import { createRootPosition } from '../src/lib/eval/forward-model';
import { boostedFraction, pairThreat } from '../src/lib/eval/eval-function';
import type { EvalResult, SearchProgress } from '../src/lib/eval/types';

function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  // Custom Game opens at team preview — commit the default order so the
  // leads are actually on the field.
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

function makeDoublesBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9doublescustomgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const doublesRoot = () => serialize(makeDoublesBattle(
  [
    makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
    makeSet('Snorlax', 'Snorlax', ['Tackle', 'Protect']),
    makeSet('Chansey', 'Chansey', ['Protect']),
  ],
  [
    makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
    makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
    makeSet('Vulpix', 'Vulpix', ['Protect'], 30),
  ],
));

// Level-100 Machamp: Seismic Toss does a flat 100. Level-30 Pikachu has < 100 max HP.
test.describe('depth-1 search', () => {
  test('a guaranteed KO into a win ranks first with a winning score', () => {
    const root = serialize(makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30)],
    ));
    const result = searchPosition(root, { depth: 1, samples: 1 });
    expect(result.perSide.p1[0].choice).toBe('move seismictoss');
    expect(result.perSide.p1[0].worstCase).toBe(1);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.depthCompleted).toBe(1);
    // A dominant winning line has no prediction uncertainty.
    expect(result.interval).toBe(0);
  });

  test('when staying in dies, the saving switch ranks first', () => {
    // p1 active: level-30 Pikachu (dies to the toss); bench: level-100 Blissey
    // (survives it easily). p2: level-100 Machamp, Seismic Toss only.
    const battle = makeBattle(
      [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Blissey', 'Blissey', ['Protect'], 100)],
      [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
    );
    const result = searchPosition(serialize(battle), { depth: 1, samples: 1 });
    expect(result.perSide.p1[0].choice).toBe('switch 2');
  });

  test('worst case, expected, and punishedBy are populated and own-perspective', () => {
    const root = serialize(makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
      [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100)],
    ));
    const result = searchPosition(root, { depth: 1, samples: 1 });
    for (const side of ['p1', 'p2'] as const) {
      expect(result.perSide[side].length).toBeGreaterThan(0);
      for (const ranked of result.perSide[side]) {
        expect(ranked.punishedBy).not.toBeNull();
        expect(ranked.worstCase).toBeLessThanOrEqual(ranked.expected + 1e-9);
      }
    }
  });

  test('tera can be excluded from the search', () => {
    const root = serialize(makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
      [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100)],
    ));
    const result = searchPosition(root, { depth: 1, samples: 1, tera: false });
    for (const side of ['p1', 'p2'] as const) {
      expect(result.perSide[side].length).toBeGreaterThan(0);
      expect(result.perSide[side].some(choice => choice.choice.includes('terastallize'))).toBe(false);
    }
  });

  test('roll grouping: quiet cells sample once, KO cells get the seed spread', () => {
    const original = State.deserializeBattle;
    let forks = 0;
    State.deserializeBattle = ((serialized: Parameters<DeserializeFn>[0]) => {
      forks += 1;
      return original.call(State, serialized);
    }) as DeserializeFn;
    try {
      // 2x2 all-quiet matrix (Protect/Substitute): every cell needs one sim.
      const quiet = serialize(makeBattle(
        [makeSet('A', 'Snorlax', ['Protect', 'Substitute'])],
        [makeSet('B', 'Chansey', ['Protect', 'Substitute'])],
      ));
      forks = 0;
      searchPosition(quiet, { depth: 1, samples: 3, tera: false });
      expect(forks).toBe(1 + 4); // root + 4 cells x 1 draw

      // Toss KOs Pikachu (bench Eevee continues the game): those cells are
      // roll-sensitive and take the full spread; quiet cells still take one.
      const violent = serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
        [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30)],
      ));
      forks = 0;
      searchPosition(violent, { depth: 1, samples: 3, tera: false });
      const cells = 2 * 3; // 2 p1 options x 3 p2 options
      expect(forks).toBeGreaterThan(1 + cells);       // some cells multi-sampled
      expect(forks).toBeLessThan(1 + cells * 3);      // but not all of them
    } finally {
      State.deserializeBattle = original;
    }
  });

  test('the score-focused depth-1 sub-search matches the full search exactly', () => {
    const fixtures = [
      serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect', 'Growl'], 100)],
        [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100), makeSet('Eevee', 'Eevee', ['Protect'], 100)],
      )),
      serialize(makeBattle(
        [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Blissey', 'Blissey', ['Protect'], 100)],
        [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
      )),
    ];
    for (const root of fixtures) {
      const full = searchPosition(root, { depth: 1, samples: 1, tera: false });
      const focused = subSearchDepth1(root, { depth: 1, samples: 1, tera: false });
      expect(focused.score).toBe(full.score);
      expect(focused.interval).toBe(full.interval);
      expect(focused.perSide.p1[0].choice).toBe(full.perSide.p1[0].choice);
      expect(focused.perSide.p1[0].worstCase).toBe(full.perSide.p1[0].worstCase);
      expect(focused.perSide.p1[0].punishedBy).toBe(full.perSide.p1[0].punishedBy);
      expect(focused.perSide.p2[0].choice).toBe(full.perSide.p2[0].choice);
      expect(focused.perSide.p2[0].worstCase).toBe(full.perSide.p2[0].worstCase);
    }
  });

  test('the score-focused sub-search prunes dominated rows', () => {
    const original = State.deserializeBattle;
    let forks = 0;
    State.deserializeBattle = ((serialized: Parameters<DeserializeFn>[0]) => {
      forks += 1;
      return original.call(State, serialized);
    }) as DeserializeFn;
    try {
      const root = serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect', 'Growl'], 100)],
        [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100), makeSet('Eevee', 'Eevee', ['Protect'], 100)],
      ));
      forks = 0;
      searchPosition(root, { depth: 1, samples: 1, tera: false });
      const fullForks = forks;
      forks = 0;
      subSearchDepth1(root, { depth: 1, samples: 1, tera: false });
      expect(forks).toBeLessThan(fullForks);
    } finally {
      State.deserializeBattle = original;
    }
  });

  test('candidate restriction caps wide sub-matrices but keeps every base move', () => {
    const battle = makeBattle(
      [
        makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Close Combat', 'Protect', 'Growl'], 100),
        makeSet('B', 'Snorlax', ['Protect'], 100),
        makeSet('C', 'Chansey', ['Protect'], 100),
      ],
      [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Eevee', 'Eevee', ['Tackle'], 30)],
    );
    const root = serialize(battle);
    // Unrestricted: 4 moves + 4 tera variants + 2 switches = 10 p1 options.
    const full = searchPosition(root, { depth: 1, samples: 1 });
    expect(full.perSide.p1.length).toBeGreaterThan(8);

    const restricted = searchPosition(root, { depth: 1, samples: 1 }, undefined, undefined, true);
    expect(restricted.perSide.p1.length).toBeLessThanOrEqual(8);
    // Every base move survives — restriction only trims tera variants/switches.
    for (const move of ['move seismictoss', 'move closecombat', 'move protect', 'move growl']) {
      expect(restricted.perSide.p1.map(choice => choice.choice)).toContain(move);
    }
    // The maximin guarantee is preserved on this fixture.
    expect(restricted.perSide.p1[0].worstCase).toBe(full.perSide.p1[0].worstCase);
  });

  test('progress covers the full matrix and results are deterministic', () => {
    const root = serialize(makeBattle(
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
      [makeSet('Chansey', 'Chansey', ['Protect', 'Substitute'])],
    ));
    const progress: SearchProgress[] = [];
    const first = searchPosition(root, { depth: 1, samples: 3 }, { onProgress: p => progress.push(p) });
    const second = searchPosition(root, { depth: 1, samples: 3 });
    expect(first).toEqual(second);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last.done).toBe(last.total);
  });
});

test.describe('iterative deepening', () => {
  // p2 has two level-30 Pokémon, each KO'd by one level-100 Seismic Toss.
  // Depth 1 sees one KO; depth 2 sees the full win and must raise the score.
  const twoTurnWin = () => serialize(makeBattle(
    [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30)],
  ));

  test('depth 2 refines the score above depth 1', () => {
    const depth1 = searchPosition(twoTurnWin(), { depth: 1, samples: 1 });
    const depth2 = searchPosition(twoTurnWin(), { depth: 2, samples: 1 });
    expect(depth2.depthCompleted).toBe(2);
    expect(depth2.score).toBeGreaterThan(depth1.score);
    expect(depth2.perSide.p1[0].choice).toBe('move seismictoss');
  });

  test('one partial result per completed depth, deterministic', () => {
    const partials: EvalResult[] = [];
    const first = searchPosition(twoTurnWin(), { depth: 3, samples: 1 }, { onPartial: r => partials.push(r) });
    expect(partials.map(partial => partial.depthCompleted)).toEqual([1, 2, 3]);
    expect(first.depthCompleted).toBe(3);
    const second = searchPosition(twoTurnWin(), { depth: 3, samples: 1 });
    expect(first).toEqual(second);
  });

  test('shouldStop halts deepening but returns the depth-1 result', () => {
    const result = searchPosition(twoTurnWin(), { depth: 3, samples: 1 }, { shouldStop: () => true });
    expect(result.depthCompleted).toBe(1);
    expect(result.perSide.p1.length).toBeGreaterThan(0);
  });

  // Three fodder mons: the win is three tosses deep, so followup lines can
  // extend beyond one step without hitting a terminal child.
  const threeTurnWin = () => serialize(makeBattle(
    [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
    [
      makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
      makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
      makeSet('Vulpix', 'Vulpix', ['Tackle', 'Growl'], 30),
    ],
  ));

  test('followup lines surface on expanded top choices', () => {
    // tera:false keeps each row narrow enough for the expansion budget to
    // chase the shifting worst-case cell to convergence — the draft-league
    // shape this feature exists for.
    const depth1 = searchPosition(threeTurnWin(), { depth: 1, samples: 1, tera: false });
    expect(depth1.perSide.p1[0].line).toBeUndefined();

    const depth2 = searchPosition(threeTurnWin(), { depth: 2, samples: 1, tera: false });
    expect(depth2.perSide.p1[0].line).toHaveLength(1);

    const depth3 = searchPosition(threeTurnWin(), { depth: 3, samples: 1, tera: false });
    expect(depth3.perSide.p1[0].line).toHaveLength(2);

    const again = searchPosition(threeTurnWin(), { depth: 3, samples: 1, tera: false });
    expect(again.perSide.p1[0].line).toEqual(depth3.perSide.p1[0].line);
  });
});

test.describe('doubles search', () => {
  test('the root is restricted to a tractable option list and stays deterministic', () => {
    const root = doublesRoot();
    const result = searchPosition(root, { depth: 1, samples: 1, tera: false });
    // Mandatory doubles restriction: at most 12 combined options per side.
    expect(result.perSide.p1.length).toBeLessThanOrEqual(12);
    expect(result.perSide.p2.length).toBeLessThanOrEqual(12);
    expect(result.perSide.p1[0].choice).toContain(','); // combined two-slot choice
    expect(result.score).toBeGreaterThan(0); // the level-50 side bullies the level-30s
    expect(searchPosition(root, { depth: 1, samples: 1, tera: false })).toEqual(result);
  });

  test('deepening runs doubles sub-searches to completion', () => {
    const deep = searchPosition(doublesRoot(), { depth: 2, samples: 1, tera: false });
    expect(deep.depthCompleted).toBe(2);
    expect(deep.perSide.p1.length).toBeGreaterThan(0);
  });
});

test.describe('doubles candidate hints', () => {
  const vgcSet = (species: string, moves: string[], item = ''): PokemonSet => ({
    name: species, species, item, ability: 'No Ability', moves,
    nature: 'Adamant',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '',
  });
  // A realistic VGC turn 1: ~180 legal combos per side — far over the cap,
  // so only hint-favored combos survive. The regression this pins: setup,
  // Protect, Fake Out, and spread moves must stay recommendable.
  const vgcRoot = () => createRootPosition(serialize(makeDoublesBattle(
    [
      vgcSet('Scizor', ['Swords Dance', 'Bullet Punch', 'Bug Bite', 'Protect'], 'Life Orb'),
      vgcSet('Sneasler', ['Fake Out', 'Dire Claw', 'Close Combat', 'Protect'], 'Focus Sash'),
      vgcSet('Eelektross', ['Thunderbolt', 'Protect'], 'Leftovers'),
      vgcSet('Sinistcha', ['Matcha Gotcha', 'Protect'], 'Sitrus Berry'),
    ],
    [
      vgcSet('Grimmsnarl', ['Spirit Break', 'Reflect', 'Light Screen', 'Thunder Wave'], 'Light Clay'),
      vgcSet('Annihilape', ['Rock Slide', 'Drain Punch', 'Rage Fist', 'Protect'], 'Leftovers'),
      vgcSet('Politoed', ['Surf', 'Protect'], 'Sitrus Berry'),
      vgcSet('Pelipper', ['Hurricane', 'Protect'], 'Life Orb'),
    ],
  )));

  // fixme until the core-dedup selection lands: gimmick duplicates of the top
  // damage pairs still crowd Protect out of the 12-slot cap.
  test.fixme('setup, Protect, Fake Out, and spread moves survive the doubles restriction', () => {
    const root = vgcRoot();
    const labels = searchOptions(root, 'p1', { tera: true }).map(option => option.label);
    expect(labels.some(label => label.includes('Swords Dance'))).toBe(true);
    expect(labels.some(label => label.includes('Protect'))).toBe(true);
    expect(labels.some(label => label.includes('Fake Out'))).toBe(true);
    const p2Labels = searchOptions(root, 'p2', { tera: true }).map(option => option.label);
    expect(p2Labels.some(label => label.includes('Rock Slide'))).toBe(true);
  });

  test('boostedFraction accepts hypothetical attacker stages', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Karate Chop'], 100)],
      [makeSet('Chansey', 'Chansey', ['Protect'], 100)],
    );
    const attacker = battle.sides[0].active[0]!;
    const defender = battle.sides[1].active[0]!;
    const threat = pairThreat(attacker, defender, battle);
    const base = boostedFraction(threat, attacker, defender);
    expect(base).toBeGreaterThan(0);
    const hypothetical = boostedFraction(threat, attacker, defender, { atk: 2 });
    expect(hypothetical).toBeCloseTo(base * 2, 10);
    // The override must equal actually holding the boost.
    attacker.boosts.atk = 2;
    expect(boostedFraction(threat, attacker, defender)).toBeCloseTo(hypothetical, 10);
  });
});

test.describe('doubles keepPlayed', () => {
  test('the played combo survives the restriction and gets ranked', () => {
    const keepPlayed = {
      p1Slots: [
        { kind: 'switch' as const, name: 'Chansey', species: 'Chansey' },
        { kind: 'move' as const, name: 'Protect', tera: false, targetLoc: null },
      ],
    };
    const without = searchPosition(doublesRoot(), { depth: 1, samples: 1, tera: false });
    const withKeep = searchPosition(doublesRoot(), { depth: 1, samples: 1, tera: false, keepPlayed });
    // The zero-hint combo is exactly what the restriction drops…
    expect(without.perSide.p1.some(option => option.choice === 'switch 3, move protect')).toBe(false);
    // …and exactly what keepPlayed forces back in, ranked like any option.
    const kept = withKeep.perSide.p1.find(option => option.choice === 'switch 3, move protect');
    expect(kept).toBeTruthy();
    expect(Number.isFinite(kept!.worstCase)).toBe(true);
    expect(withKeep.perSide.p1.length).toBeLessThanOrEqual(13);
  });
});
