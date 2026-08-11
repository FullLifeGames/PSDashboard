import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
type DeserializeFn = typeof State.deserializeBattle;
import type { PokemonSet } from '@pkmn/sim';
import { battleFaintedFraction, optionHints, searchOptions, searchPosition, subSearchDepth1 } from '../src/lib/eval/search';
import { mctsSearch, mctsTreeSearch, wideningWindow, WIDENING_BASE, WIDENING_VISITS_PER_SLOT } from '../src/lib/eval/mcts';
import { mergeMctsTrees } from '../src/lib/eval/mcts-merge';
import type { MctsTreeStats } from '../src/lib/eval/types';
import { advancePosition, createRootPosition, legalChoices, positionBattle } from '../src/lib/eval/forward-model';
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
    makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop', 'Bulldoze']),
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
      // The trend tiebreak's probe forks are the same in both runs, so the
      // s3−s1 delta isolates the sampling behavior.
      const violent = serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
        [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30), makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30)],
      ));
      forks = 0;
      searchPosition(violent, { depth: 1, samples: 1, tera: false });
      const forksSingle = forks;
      forks = 0;
      searchPosition(violent, { depth: 1, samples: 3, tera: false });
      const extraDraws = forks - forksSingle;
      const cells = 2 * 3; // 2 p1 options x 3 p2 options
      expect(extraDraws).toBeGreaterThan(0);           // some cells multi-sampled
      expect(extraDraws).toBeLessThan(cells * 2);      // but not all of them
    } finally {
      State.deserializeBattle = original;
    }
  });

  test('the score-focused depth-1 sub-search matches the full search exactly', () => {
    // Boost-free fixtures: with the corpus-fitted boost weight, a Growl row's
    // ev-vs-floor gap grows enough to flip top picks between the ev-sorted
    // full search and the floor-sorted sub-search — the parity contract here
    // is about intervals and floors, not boost valuation. Tie-free tops too:
    // the full search corrects EV-tied leading rows by their probe trends
    // (2b), which the pruned path deliberately lacks — a tied fixture (two
    // fixed-damage moves) would measure that layer, not the pruning.
    const fixtures = [
      serialize(makeBattle(
        [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
        [makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Protect'], 100), makeSet('Eevee', 'Eevee', ['Protect'], 100)],
      )),
      serialize(makeBattle(
        [makeSet('Pikachu', 'Pikachu', ['Night Shade'], 30), makeSet('Blissey', 'Blissey', ['Seismic Toss'], 100)],
        [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
      )),
    ];
    for (const root of fixtures) {
      const full = searchPosition(root, { depth: 1, samples: 1, tera: false });
      const focused = subSearchDepth1(root, { depth: 1, samples: 1, tera: false });
      // The full search scores at the solved game value, the pruned sub-search
      // at the maximin midpoint — both live inside the same [v1, v2] interval.
      expect(Math.abs(focused.score - full.score)).toBeLessThanOrEqual(full.interval + 1e-9);
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
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect', 'Night Shade'], 100)],
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
    // Mandatory doubles restriction: at most 16 combined options per side.
    expect(result.perSide.p1.length).toBeLessThanOrEqual(16);
    expect(result.perSide.p2.length).toBeLessThanOrEqual(16);
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

  test('setup, Protect, Fake Out, and spread moves survive the doubles restriction', () => {
    const root = vgcRoot();
    const labels = searchOptions(root, 'p1', { tera: true }).map(option => option.label);
    expect(labels.some(label => label.includes('Swords Dance'))).toBe(true);
    expect(labels.some(label => label.includes('Protect'))).toBe(true);
    expect(labels.some(label => label.includes('Fake Out'))).toBe(true);
    const p2Labels = searchOptions(root, 'p2', { tera: true }).map(option => option.label);
    expect(p2Labels.some(label => label.includes('Rock Slide'))).toBe(true);
  });

  test('the restriction spends its slots on distinct cores, not gimmick duplicates', () => {
    const kept = searchOptions(vgcRoot(), 'p1', { tera: true });
    const gimmickTokens = ['terastallize', 'mega', 'ultra'];
    const coreOf = (choice: string) => choice.split(',').map(part =>
      part.trim().split(' ').filter(token => !gimmickTokens.includes(token)).join(' ')).join(', ');
    const cores = new Set(kept.map(option => coreOf(option.choice)));
    // Before the core budget, 12 slots held ~4 distinct pairs × 3 gimmick variants.
    expect(cores.size).toBeGreaterThanOrEqual(10);
    expect(kept.length).toBeLessThanOrEqual(20);
  });

  test('the played combo and its gimmick variants are always rankable', () => {
    const keep = [
      { kind: 'move' as const, name: 'Swords Dance', tera: false, targetLoc: null },
      { kind: 'move' as const, name: 'Fake Out', tera: false, targetLoc: 1 },
    ];
    const kept = searchOptions(vgcRoot(), 'p1', { tera: true, keep });
    const choices = kept.map(option => option.choice);
    expect(choices).toContain('move swordsdance, move fakeout 1');
    // The same core with the gimmick attached is what "played, but with Tera"
    // comparisons need — it must be ranked alongside the played combo.
    expect(choices).toContain('move swordsdance terastallize, move fakeout 1');
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

test.describe('mcts hint-ordered expansion with progressive widening', () => {
  const wideSet = (species: string, moves: string[], item = ''): PokemonSet => ({
    name: species, species, item, ability: 'No Ability', moves,
    nature: 'Adamant',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '',
  });
  // Same shape as the VGC restriction fixture: a wide combined root where
  // the 16-option cap binds — exactly where the old forced full sweep
  // starved the 600 iterations.
  const wideSerialized = () => serialize(makeDoublesBattle(
    [
      wideSet('Scizor', ['Swords Dance', 'Bullet Punch', 'Bug Bite', 'Protect'], 'Life Orb'),
      wideSet('Sneasler', ['Fake Out', 'Dire Claw', 'Close Combat', 'Protect'], 'Focus Sash'),
      wideSet('Eelektross', ['Thunderbolt', 'Protect'], 'Leftovers'),
      wideSet('Sinistcha', ['Matcha Gotcha', 'Protect'], 'Sitrus Berry'),
    ],
    [
      wideSet('Grimmsnarl', ['Spirit Break', 'Reflect', 'Light Screen', 'Thunder Wave'], 'Light Clay'),
      wideSet('Annihilape', ['Rock Slide', 'Drain Punch', 'Rage Fist', 'Protect'], 'Leftovers'),
      wideSet('Politoed', ['Surf', 'Protect'], 'Sitrus Berry'),
      wideSet('Pelipper', ['Hurricane', 'Protect'], 'Life Orb'),
    ],
  ));

  test('optionHints scores every option and favors damage over double-support', () => {
    const root = createRootPosition(wideSerialized());
    const options = searchOptions(root, 'p1', { tera: false });
    const hints = optionHints(root, 'p1', options);
    expect(hints.length).toBe(options.length);
    const best = options[hints.indexOf(Math.max(...hints))];
    // The top-hinted combo carries at least one damaging move.
    expect(/Fake Out|Bullet Punch|Bug Bite|Dire Claw|Close Combat|Thunderbolt|Matcha Gotcha/
      .test(best.label)).toBe(true);
    // Hints are deterministic.
    expect(optionHints(root, 'p1', options)).toEqual(hints);
  });

  test('the widening window starts at the floor and grows with visits', () => {
    expect(wideningWindow(16, 0)).toBe(WIDENING_BASE);
    expect(wideningWindow(16, WIDENING_VISITS_PER_SLOT)).toBe(WIDENING_BASE + 1);
    expect(wideningWindow(16, 200)).toBe(16);
    expect(wideningWindow(3, 0)).toBe(3);
  });

  test('early iterations open only hint-favored root options (no forced full sweep)', () => {
    const serialized = wideSerialized();
    const root = createRootPosition(serialized);
    const options = searchOptions(root, 'p1', { tera: false });
    let done = 0;
    const stats = mctsTreeSearch(serialized, { depth: 1, samples: 1, tera: false }, 0, {
      onProgress: progress => { done = progress.done; },
      shouldStop: () => done >= 30,
    });
    expect(stats.p1Options.length).toBeGreaterThan(WIDENING_BASE);
    // The old pick() forced every option through a visit first — after 30
    // iterations on a 16-wide root nothing was unvisited. With widening,
    // weak options stay closed…
    expect(stats.p1N.filter(n => n === 0).length).toBeGreaterThan(0);
    // …and every opened option sits inside the hint-order window reachable
    // by the visits so far. (The node's options come from the same
    // searchOptions call, so the index spaces align.)
    expect(stats.p1Options.length).toBe(options.length);
    const hints = optionHints(root, 'p1', options);
    const order = hints.map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .map(entry => entry.index);
    const window = wideningWindow(stats.p1Options.length, stats.visits);
    for (let rank = 0; rank < order.length; rank++) {
      if (stats.p1N[order[rank]] > 0) expect(rank).toBeLessThan(window);
    }
  });

  test('the tree search stays bit-deterministic with ordering and widening', () => {
    const serialized = wideSerialized();
    const first = mctsSearch(serialized, { depth: 1, samples: 1, tera: false });
    const second = mctsSearch(serialized, { depth: 1, samples: 1, tera: false });
    expect(second).toEqual(first);
  });

  test('rankings come from the equilibrium over tree-informed cells, not visit order', () => {
    // Visit counts allocate search effort; they are not the verdict. A
    // hint-anchored move can stay most-visited while the tree's own cell
    // values refute it (draft t58: Knock Off most-visited, → Kyurem better)
    // — so the published ranking must be the SAME equilibrium solve the
    // matrix mode runs, over cells informed by the tree's backed-up means.
    const result = mctsSearch(wideSerialized(), { depth: 1, samples: 1, tera: false });
    expect(result.matrix).toBeTruthy();
    const matrix = result.matrix!;
    const evOf = new Map(matrix.p1Labels.map((labelText, i) => [labelText,
      matrix.values[i].reduce((sum, cell, j) => sum + cell * matrix.mixes!.p2[j], 0)]));
    for (const choice of result.perSide.p1) {
      expect(choice.ev).toBeCloseTo(evOf.get(choice.label)!, 10);
    }
    const sorted = [...result.perSide.p1].every((choice, index, list) =>
      index === 0 || list[index - 1].ev >= choice.ev - 1e-12);
    expect(sorted).toBe(true);
    // Every root option is ranked — visit starvation no longer hides rows.
    expect(result.perSide.p1.length).toBe(matrix.p1Labels.length);
    // HYBRID: the SCORE stays the visit-mean formulation (bit-comparable
    // with the standing records) even though the rankings are solved.
    const stats = mctsTreeSearch(wideSerialized(), { depth: 1, samples: 1, tera: false }, 0);
    const topMean = (n: number[], w: number[]) => {
      let bestIndex = -1;
      let bestN = 0;
      n.forEach((visits, index) => { if (visits > bestN) { bestN = visits; bestIndex = index; } });
      return w[bestIndex] / n[bestIndex];
    };
    expect(stats.result.score).toBeCloseTo(
      (topMean(stats.p1N, stats.p1W) + topMean(stats.p2N, stats.p2W)) / 2, 10);
  });
});

test.describe('mcts merge pools tree-informed cells', () => {
  const options = (labels: string[]) => labels.map(labelText => ({ choice: labelText, label: labelText }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
  test('the merged ranking solves the pooled matrix', () => {
    const mk = (marginals: Pick<MctsTreeStats, 'p1N' | 'p1W' | 'p2N' | 'p2W'>, cells: MctsTreeStats['cells']): MctsTreeStats => ({
      p1Options: options(['A', 'B']), p2Options: options(['X', 'Y']),
      ...marginals, visits: 10, depth: 2,
      rootValue: 0.1, cells, result: emptyResult,
    });
    const t1 = mk({ p1N: [10, 0], p1W: [6, 0], p2N: [10, 0], p2W: [6, 0] }, [
      { key: 0, visits: 8, total: 4.8, value: 0.5, ended: false },
      { key: 1, visits: 2, total: 0.4, value: 0.2, ended: false },
    ]);
    const t2 = mk({ p1N: [0, 5], p1W: [0, -2], p2N: [5, 0], p2W: [-2, 0] }, [
      { key: 0, visits: 2, total: 1.0, value: 0.5, ended: false },
      { key: 10_000, visits: 3, total: -0.9, value: -0.4, ended: false },
    ]);
    const merged = mergeMctsTrees([t1, t2]);
    expect(merged.matrix).toBeTruthy();
    // Pooled cell means with ONE static prior: (Σtotal + value)/(Σvisits + 1);
    // the (B,Y) cell no tree expanded falls back to the root static.
    expect(merged.matrix!.values[0][0]).toBeCloseTo((4.8 + 1.0 + 0.5) / 11, 10);
    expect(merged.matrix!.values[0][1]).toBeCloseTo((0.4 + 0.2) / 3, 10);
    expect(merged.matrix!.values[1][0]).toBeCloseTo((-0.9 - 0.4) / 4, 10);
    expect(merged.matrix!.values[1][1]).toBeCloseTo(0.1, 10);
    // Row A dominates the pooled game — the equilibrium ranking says so.
    expect(merged.perSide.p1[0].label).toBe('A');
    expect(merged.perSide.p1.length).toBe(2);
    // HYBRID: the merged score is the summed-marginal visit-mean formula —
    // top-visited p1 mean 6/10, top-visited p2 mean (6−2)/15.
    expect(merged.score).toBeCloseTo((6 / 10 + 4 / 15) / 2, 10);
    expect(merged.interval).toBeCloseTo(Math.abs(4 / 15 - 6 / 10), 10);
  });
});

test.describe('team preview search (turn 0)', () => {
  test('the engine ranks lead pairs and favors the pressuring lead', () => {
    // Machamp is the only mon that wins pairs — with the active-pair
    // emphasis, cells where it leads score higher, so every top lead
    // includes it. Passive mons carry Growl only.
    const preview = new Battle({
      formatid: toID('gen9doublescustomgame'),
      seed: '1,2,3,4',
      p1: {
        name: 'Alpha',
        team: Teams.pack([
          makeSet('Machamp', 'Machamp', ['Karate Chop'], 100),
          makeSet('A2', 'Chansey', ['Growl'], 100),
          makeSet('A3', 'Blissey', ['Growl'], 100),
          makeSet('A4', 'Snorlax', ['Growl'], 100),
        ]),
      },
      p2: {
        name: 'Beta',
        team: Teams.pack([
          makeSet('B1', 'Chansey', ['Tackle'], 100),
          makeSet('B2', 'Blissey', ['Tackle'], 100),
          makeSet('B3', 'Snorlax', ['Tackle'], 100),
          makeSet('B4', 'Pikachu', ['Tackle'], 100),
        ]),
      },
    });
    const root = serialize(preview);
    const result = searchPosition(root, { depth: 1, samples: 1, tera: false });
    expect(result.perSide.p1).toHaveLength(6);
    expect(result.perSide.p1[0].label).toContain('Machamp');
    expect(result.perSide.p1[0].label).toMatch(/^Lead /);
    expect(searchPosition(root, { depth: 1, samples: 1, tera: false })).toEqual(result);
  });
});

test.describe('no-op candidate filter', () => {
  test('guaranteed-failing field moves are dropped from the option list', () => {
    // GPL T25: Stealth Rock with rocks already up is a guaranteed |-fail|
    // — its cell equals a pass, yet it ranked with a real-looking ev.
    const battle = makeBattle(
      [makeSet('U', 'Uxie', ['Stealth Rock', 'Tackle', 'Reflect'], 100)],
      [makeSet('S', 'Snorlax', ['Protect', 'Tackle'], 100)],
    );
    battle.sides[1].addSideCondition('stealthrock', battle.sides[0].active[0]!);
    battle.sides[0].addSideCondition('reflect', battle.sides[0].active[0]!);
    const options = searchOptions(createRootPosition(serialize(battle)), 'p1');
    const choices = options.map(option => option.choice);
    expect(choices).not.toContain('move stealthrock');
    expect(choices).not.toContain('move reflect');
    expect(choices).toContain('move tackle');

    // Without the standing conditions both moves are real candidates.
    const clean = makeBattle(
      [makeSet('U', 'Uxie', ['Stealth Rock', 'Tackle', 'Reflect'], 100)],
      [makeSet('S', 'Snorlax', ['Protect', 'Tackle'], 100)],
    );
    const cleanChoices = searchOptions(createRootPosition(serialize(clean)), 'p1').map(option => option.choice);
    expect(cleanChoices).toContain('move stealthrock');
    expect(cleanChoices).toContain('move reflect');
  });

  test('sleep moves drop under Sleep Clause while a foe already sleeps (GPL T11)', () => {
    const sleeping = () => {
      const battle = makeBattle(
        [makeSet('V', 'Vileplume', ['Sleep Powder', 'Giga Drain', 'Sludge Bomb'], 100)],
        [makeSet('J', 'Iron Jugulis', ['Dark Pulse', 'Taunt'], 100), makeSet('R', 'Rhydon', ['Earthquake'], 100)],
      );
      battle.sides[1].active[0]!.setStatus('slp');
      return serialize(battle);
    };

    // Clause flagged (custom-game reconstructions lose the rule in
    // serialization): re-sleeping is a guaranteed no-op — dropped.
    const clause = searchOptions(createRootPosition(sleeping()), 'p1', { tera: false, sleepClause: true })
      .map(option => option.choice);
    expect(clause).not.toContain('move sleeppowder');
    expect(clause).toContain('move gigadrain');

    // No clause: double sleep is legal — the candidate stays.
    const noClause = searchOptions(createRootPosition(sleeping()), 'p1', { tera: false })
      .map(option => option.choice);
    expect(noClause).toContain('move sleeppowder');

    // Clause active but nobody sleeps: the candidate stays.
    const awake = makeBattle(
      [makeSet('V', 'Vileplume', ['Sleep Powder', 'Giga Drain', 'Sludge Bomb'], 100)],
      [makeSet('J', 'Iron Jugulis', ['Dark Pulse', 'Taunt'], 100)],
    );
    const awakeChoices = searchOptions(createRootPosition(serialize(awake)), 'p1', { tera: false, sleepClause: true })
      .map(option => option.choice);
    expect(awakeChoices).toContain('move sleeppowder');
  });
});

test.describe('accuracy and random-call roll sensitivity', () => {
  test('a game-ending cell behind an accuracy roll is never priced as certain (draft T64)', () => {
    // Machamp's Dynamic Punch (50%) KOs the last foe when it hits: one seed
    // that hit once priced the win as a CERTAIN +1.00 — the seed spread
    // prices the miss even in single-sample sweeps.
    const risky = makeBattle(
      [makeSet('M', 'Machamp', ['Dynamic Punch'], 100)],
      [makeSet('P', 'Pikachu', ['Growl'], 5)],
    );
    const result = searchPosition(serialize(risky), { depth: 1, samples: 1, tera: false });
    expect(result.score).toBeGreaterThan(0.2);
    expect(result.score).toBeLessThan(0.999);

    // The same KO behind a sure move stays exact.
    const sure = makeBattle(
      [makeSet('M', 'Machamp', ['Seismic Toss'], 100)],
      [makeSet('P', 'Pikachu', ['Growl'], 5)],
    );
    const sureResult = searchPosition(serialize(sure), { depth: 1, samples: 1, tera: false });
    expect(sureResult.score).toBeCloseTo(1, 5);
  });

  test('Sleep Talk cells take the seed spread even without a KO (GPL T25)', () => {
    const original = State.deserializeBattle;
    let forks = 0;
    State.deserializeBattle = ((serialized: Parameters<DeserializeFn>[0]) => {
      forks += 1;
      return original.call(State, serialized);
    }) as DeserializeFn;
    try {
      // A sleeping Sleep Talker: which move comes out is pure seed — the
      // cell must not be judged off a single called move.
      const sleeper = () => {
        const battle = makeBattle(
          [makeSet('S', 'Snorlax', ['Sleep Talk', 'Protect'], 100)],
          [makeSet('C', 'Chansey', ['Protect', 'Substitute'], 100)],
        );
        battle.sides[0].active[0]!.setStatus('slp');
        return serialize(battle);
      };
      forks = 0;
      searchPosition(sleeper(), { depth: 1, samples: 1, tera: false });
      const single = forks;
      forks = 0;
      searchPosition(sleeper(), { depth: 1, samples: 3, tera: false });
      expect(forks).toBeGreaterThan(single);
    } finally {
      State.deserializeBattle = original;
    }
  });
});

test.describe('battleFaintedFraction', () => {
  test('counts both sides against the full roster', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', ['Tackle']), makeSet('A2', 'Chansey', ['Tackle'])],
      [makeSet('B', 'Dragapult', ['Tackle']), makeSet('B2', 'Volcarona', ['Tackle'])],
    );
    expect(battleFaintedFraction(battle)).toBe(0);
    battle.sides[0].pokemon[1].faint();
    battle.sides[0].pokemon[1].hp = 0;
    expect(battleFaintedFraction(battle)).toBeCloseTo(0.25, 8);
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
    expect(withKeep.perSide.p1.length).toBeLessThanOrEqual(20);
  });
});

test.describe('pivot pairs', () => {
  const pivotBattle = () => makeBattle(
    [
      makeSet('Mien', 'Mienshao', ['U-turn', 'Close Combat']),
      makeSet('Clef', 'Clefable', ['Moonblast']),
      makeSet('Tran', 'Heatran', ['Lava Plume']),
    ],
    // Seismic Toss cannot KO the incoming mon — the pair's follow-up is what
    // the child position shows (an Earthquake foe KO'd the entering Heatran
    // and the greedy replacement masked the follow-up in an earlier fixture).
    [makeSet('Bliss', 'Blissey', ['Seismic Toss'])],
  );

  test('the root matrix enumerates the pivot over the live bench', () => {
    const result = searchPosition(serialize(pivotBattle()), { depth: 1, samples: 1, tera: false });
    const choices = result.perSide.p1.map(option => option.choice);
    // The bare row is replaced by one pair per healthy bench mon…
    expect(choices).not.toContain('move uturn');
    expect(choices).toContain('move uturn > switch 2');
    expect(choices).toContain('move uturn > switch 3');
    // …with labels naming the incoming Pokémon; plain moves stay plain.
    const pair = result.perSide.p1.find(option => option.choice === 'move uturn > switch 2')!;
    expect(pair.label).toBe('U-turn → Clefable');
    expect(choices).toContain('move closecombat');
  });

  test('sub-searches keep the greedy resolution (no pair rows)', () => {
    const result = subSearchDepth1(serialize(pivotBattle()), { depth: 1, samples: 1, tera: false });
    expect(result.perSide.p1[0]).toBeTruthy();
    // The pruned path reports bare choices only.
    expect(result.perSide.p1[0].choice.includes(' > ')).toBe(false);
  });

  test('the advance honors the declared follow-up', () => {
    const battle = pivotBattle();
    const root = createRootPosition(serialize(battle));
    const child = advancePosition(root, 'move uturn > switch 3', 'move seismictoss', '1,2,3,4');
    const after = positionBattle(child);
    // Mienshao pivoted and HEATRAN (slot 3) came in — not the greedy pick.
    expect(after.sides[0].active[0]?.species.name).toBe('Heatran');
  });

  test('a fainted follow-up target falls back to the greedy resolution', () => {
    const battle = pivotBattle();
    const clef = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Clefable')!;
    clef.faint();
    clef.hp = 0;
    const root = createRootPosition(serialize(battle));
    const child = advancePosition(root, 'move uturn > switch 2', 'move seismictoss', '1,2,3,4');
    const after = positionBattle(child);
    // Slot 2 (Clefable) is gone — the greedy resolver brings in the only
    // healthy bench mon instead.
    expect(after.sides[0].active[0]?.species.name).toBe('Heatran');
  });
});

test.describe('hidden-disable candidate filter', () => {
  test('Taunt-disabled moves stay out of the candidates (visible-disable family)', () => {
    // Taunt/Encore/Disable/choice locks disable VISIBLY (request carries the
    // flag) — pinned here so the Imprison concealment fix is never mistaken
    // for the general case.
    const battle = makeBattle(
      [makeSet('Mew', 'Mew', ['Taunt', 'Confusion'])],
      [makeSet('Rat', 'Raticate', ['Toxic', 'Quick Attack'])],
    );
    battle.choose('p1', 'move taunt');
    battle.choose('p2', 'move quickattack');
    const choices = searchOptions(createRootPosition(serialize(battle)), 'p2')
      .map(option => option.choice);
    expect(choices).not.toContain('move toxic');
    expect(choices).toContain('move quickattack');
  });

  test('an Encore lock leaves only the encored move in the candidates', () => {
    const battle = makeBattle(
      [makeSet('Mew', 'Mew', ['Encore', 'Splash'])],
      [makeSet('Rat', 'Raticate', ['Quick Attack', 'Toxic'])],
    );
    battle.choose('p1', 'move splash');
    battle.choose('p2', 'move quickattack');
    battle.choose('p1', 'move encore');
    battle.choose('p2', 'move quickattack');
    const choices = searchOptions(createRootPosition(serialize(battle)), 'p2')
      .map(option => option.choice);
    expect(choices).not.toContain('move toxic');
    expect(choices).toContain('move quickattack');
  });

  test('an Imprison-concealed move never enters the candidate list', () => {
    // The request reports Imprison-disabled foe moves as ENABLED (the sim
    // hides them until the click bounces) — offering one guarantees a choice
    // reject that aborts the whole search (gen9doublesou-2660802611 turn 2).
    const battle = makeBattle(
      [makeSet('Mew', 'Mew', ['Imprison', 'Confusion'])],
      [makeSet('Rat', 'Raticate', ['Confusion', 'Quick Attack'])],
    );
    battle.choose('p1', 'move imprison');
    battle.choose('p2', 'move quickattack');
    const rat = battle.sides[1].active[0]!;
    expect(rat.moveSlots.find(slot => slot.id === 'confusion')?.disabled).toBeTruthy();

    const choices = searchOptions(createRootPosition(serialize(battle)), 'p2')
      .map(option => option.choice);
    expect(choices).not.toContain('move confusion');
    expect(choices).toContain('move quickattack');
  });
});

test.describe('serialized-state round-trip repair', () => {
  test('a transformed mon with fewer copied moves than base moves still deserializes', () => {
    // Transform copies the TARGET's moveSlots; a reconstructed target with
    // only 2 revealed moves leaves the transformed mon with moveSlots shorter
    // than its own baseMoveSlots — a legal state @pkmn/sim's deserializer
    // crashes on ("reading 'id'"; Imprison-Transform Mew in the calibration
    // corpus, gen9doublesou-2660802611 turns 4-10).
    const battle = makeBattle(
      [makeSet('Mew', 'Mew', ['Imprison', 'Knock Off', 'Transform', 'Ice Beam'])],
      [makeSet('Blissey', 'Blissey', ['Seismic Toss'])],
    );
    const state = State.serializeBattle(battle) as unknown as {
      sides: { pokemon: { moveSlots: unknown[]; baseMoveSlots?: unknown[] }[] }[];
    };
    const mew = state.sides[0].pokemon[0];
    // The sim omits baseMoveSlots when identical to moveSlots — restore the
    // transform shape explicitly: full base, shortened copied slots.
    mew.baseMoveSlots = mew.moveSlots;
    mew.moveSlots = mew.moveSlots.slice(0, 2);

    const live = positionBattle(createRootPosition(JSON.stringify(state)));
    const repaired = live.sides[0].pokemon[0];
    expect(repaired.moveSlots.map(slot => slot.id)).toEqual(['imprison', 'knockoff']);
    expect(repaired.baseMoveSlots).toHaveLength(4);
  });
});

test.describe('mid-charge candidates', () => {
  test('a singles mid-charge active offers exactly the locked release, and it applies', () => {
    const battle = makeBattle(
      [makeSet('Beamer', 'Nihilego', ['Meteor Beam', 'Power Gem'], 100)],
      [makeSet('Wall', 'Blissey', ['Seismic Toss'], 100)],
    );
    battle.choose('p1', 'move meteorbeam');
    battle.choose('p2', 'move seismictoss');
    const position = createRootPosition(serialize(battle));
    const candidates = legalChoices(position, 'p1');
    expect(candidates.map(candidate => candidate.choice)).toEqual(['move meteorbeam']);
    expect(() => advancePosition(position, 'move meteorbeam', 'move seismictoss', [1, 2, 3, 4])).not.toThrow();
  });

  test('a doubles mid-charge release carries a target the deserialized sim accepts', () => {
    // gen9doublesou-2660809089 t6/t8: serialization drops the locked-request
    // shape, and the round-tripped sim demands a target for the release —
    // every bare "move phantomforce" candidate was a guaranteed reject.
    const battle = makeDoublesBattle(
      [
        makeSet('Ghost', 'Dragapult', ['Phantom Force', 'Dragon Darts'], 100),
        makeSet('Tree', 'Trevenant', ['Wood Hammer', 'Protect'], 100),
        makeSet('Bird', 'Talonflame', ['Air Slash', 'Protect'], 100),
      ],
      [
        makeSet('Wall', 'Blissey', ['Seismic Toss', 'Protect'], 100),
        makeSet('Wall2', 'Chansey', ['Seismic Toss', 'Protect'], 100),
      ],
    );
    battle.choose('p1', 'move phantomforce 1, move protect');
    battle.choose('p2', 'move protect, move protect');
    const position = createRootPosition(serialize(battle));
    const candidates = legalChoices(position, 'p1');
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const [slotA] = candidate.choice.split(', ');
      expect(slotA).toMatch(/^move phantomforce \d/);
    }
    expect(() => advancePosition(position, candidates[0].choice, 'move seismictoss 1, move seismictoss 1', [1, 2, 3, 4])).not.toThrow();
  });

  test('a locked random-target move stays bare (Outrage needs no slot)', () => {
    const battle = makeDoublesBattle(
      [
        makeSet('Dragon', 'Garchomp', ['Outrage', 'Earthquake'], 100),
        makeSet('Tree', 'Trevenant', ['Wood Hammer', 'Protect'], 100),
      ],
      [
        makeSet('Wall', 'Blissey', ['Seismic Toss', 'Protect'], 100),
        makeSet('Wall2', 'Chansey', ['Seismic Toss', 'Protect'], 100),
      ],
    );
    battle.choose('p1', 'move outrage 1, move woodhammer 1');
    battle.choose('p2', 'move seismictoss 1, move seismictoss 1');
    const position = createRootPosition(serialize(battle));
    const locked = positionBattle(position).sides[0].active[0]!.volatiles['lockedmove'];
    // Outrage locks via lockedmove, not twoturnmove — only assert when the
    // sim actually locked (rampage may end early on some rolls).
    if (!locked) return;
    const candidates = legalChoices(position, 'p1');
    for (const candidate of candidates) {
      const [slotA] = candidate.choice.split(', ');
      expect(slotA).toBe('move outrage');
    }
    expect(() => advancePosition(position, candidates[0].choice, 'move seismictoss 1, move seismictoss 1', [1, 2, 3, 4])).not.toThrow();
  });
});

test.describe('side-invariant repair on deserialize', () => {
  test('pokemonLeft and isActive restore from ground truth (GPL T38/T39)', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30)],
    );
    const state = JSON.parse(serialize(battle)) as {
      sides: { pokemonLeft: number; pokemon: { isActive: boolean }[] }[];
    };
    // Correction-era drift: the win-check counter reads high and the
    // active's flag reads false.
    state.sides[1].pokemonLeft = 3;
    state.sides[1].pokemon[0].isActive = false;
    const position = createRootPosition(JSON.stringify(state));
    // A stale-false isActive must not surface a switch onto the field.
    expect(legalChoices(position, 'p2').some(choice => choice.choice.startsWith('switch'))).toBe(false);
    // The KO of the last body ends the game — a wiped side never plays on
    // behind a stale request.
    const child = advancePosition(position, 'move seismictoss', 'move tackle', [1, 2, 3, 4]);
    expect(positionBattle(child).ended).toBe(true);
  });
});
