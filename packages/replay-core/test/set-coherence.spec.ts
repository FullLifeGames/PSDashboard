import { test, expect, describe } from 'vitest';
import { applyCoherenceVetoes, selectCuratedSet, type CuratedEvidence, type MoveCandidate } from '../src/set-coherence';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import { rulesDex } from '../src/rules-dex';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

/**
 * Pairwise coherence vetoes: guessed sets are assembled from independent marginals (top usage moves + top usage item), so the
 * combination is often incoherent (SD Cobalion carrying Body Press, Noivern with both Air Slash and Hurricane). Vetoes apply only
 * to GUESSED entries; revealed/manual knowledge is never second-guessed.
 */

const guessed = (name: string): MoveCandidate => ({ name, guessed: true });
const revealed = (name: string): MoveCandidate => ({ name, guessed: false });
const names = (list: MoveCandidate[]) => list.map(entry => entry.name);

describe('set-coherence vetoes', () => {
  test('a guessed attack the boost does not serve falls (SD Cobalion + Body Press)', () => {
    // Body Press deals physical damage with the DEFENSE stat — Swords Dance
    // does not serve it; the archetypes are disjoint.
    const kept = applyCoherenceVetoes([
      revealed('Swords Dance'), revealed('Iron Head'), guessed('Body Press'), guessed('Stone Edge'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Iron Head', 'Stone Edge']);
  });

  test('a revealed off-stat attack always survives', () => {
    const kept = applyCoherenceVetoes([
      revealed('Swords Dance'), revealed('Body Press'), guessed('Stone Edge'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Body Press', 'Stone Edge']);
  });

  test('an orphaned defense-boost fill falls with its vetoed payoff (Iron Defense)', () => {
    // GPL Cobalion: usage ranks Iron Defense high BECAUSE of Body Press.
    // Row 1 already drops Body Press next to the revealed Swords Dance —
    // the enabler must not stay behind without any Defense-scaling attack.
    const kept = applyCoherenceVetoes([
      revealed('Swords Dance'), revealed('Heavy Slam'),
      guessed('Body Press'), guessed('Iron Defense'), guessed('Thunder Wave'), guessed('Stone Edge'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Heavy Slam', 'Thunder Wave', 'Stone Edge']);
  });

  test('a defense-boost with its payoff attack survives', () => {
    const kept = applyCoherenceVetoes([
      revealed('Body Press'), guessed('Iron Defense'), guessed('Stone Edge'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Body Press', 'Iron Defense', 'Stone Edge']);
  });

  test('a revealed defense-boost is never second-guessed', () => {
    const kept = applyCoherenceVetoes([
      revealed('Iron Defense'), guessed('Stone Edge'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Iron Defense', 'Stone Edge']);
  });

  test('Nasty Plot vetoes big guessed physical attacks but spares utility and pivots', () => {
    const kept = applyCoherenceVetoes([
      guessed('Nasty Plot'), guessed('Play Rough'), guessed('Knock Off'), guessed('U-turn'), guessed('Shadow Ball'),
    ], { dex: rulesDex(9), itemId: '' });
    // Play Rough (90 BP physical) contradicts the special boost; Knock Off is
    // sub-70-BP utility and U-turn is a pivot — both stay.
    expect(names(kept)).toEqual(['Nasty Plot', 'Knock Off', 'U-turn', 'Shadow Ball']);
  });

  test('a guessed damaging move sharing a type with the set is redundant (Noivern)', () => {
    const kept = applyCoherenceVetoes([
      revealed('Hurricane'), guessed('Air Slash'), guessed('Boomburst'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Hurricane', 'Boomburst']);
  });

  test('two guessed same-type attacks keep the higher-usage first', () => {
    const kept = applyCoherenceVetoes([
      guessed('Air Slash'), guessed('Hurricane'), guessed('Draco Meteor'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Air Slash', 'Draco Meteor']);
  });

  test('typed STATUS moves never block a same-type attack', () => {
    const kept = applyCoherenceVetoes([
      revealed('Roost'), guessed('Air Slash'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Roost', 'Air Slash']);
  });

  test('a choice item vetoes guessed status moves except the Trick family', () => {
    const kept = applyCoherenceVetoes([
      guessed('Draco Meteor'), guessed('Protect'), guessed('Trick'), guessed('Roost'),
    ], { dex: rulesDex(9), itemId: 'choicescarf' });
    expect(names(kept)).toEqual(['Draco Meteor', 'Trick']);
  });

  test('revealed status moves survive a guessed choice item', () => {
    // The guessed ITEM is the weaker knowledge — proof beats fills.
    const kept = applyCoherenceVetoes([
      revealed('Protect'), guessed('Draco Meteor'),
    ], { dex: rulesDex(9), itemId: 'choicescarf' });
    expect(names(kept)).toEqual(['Protect', 'Draco Meteor']);
  });

  test('Assault Vest vetoes every guessed status move including Trick', () => {
    const kept = applyCoherenceVetoes([
      guessed('Knock Off'), guessed('Trick'), guessed('Substitute'),
    ], { dex: rulesDex(9), itemId: 'assaultvest' });
    expect(names(kept)).toEqual(['Knock Off']);
  });

  test('no boosts, no restrictive item — nothing vetoed', () => {
    const pool = [revealed('Tackle'), guessed('Protect'), guessed('Shadow Ball')];
    expect(names(applyCoherenceVetoes(pool, { dex: rulesDex(9), itemId: 'leftovers' }))).toEqual([
      'Tackle', 'Protect', 'Shadow Ball',
    ]);
  });

  // Rows 1 and 2 must not throw whole movesets away: a Kyurem with Choice Specs kept only Icicle Spear, because a usage Dragon Dance
  // that the Specs strike anyway still "served" Attack and vetoed every special move.
  const fromSet = (name: string): MoveCandidate => ({ name, guessed: true, fromSet: true });

  test('a guessed boost the Choice item strikes serves nothing (Kyurem with Specs, T28)', () => {
    const kept = applyCoherenceVetoes([
      guessed('Earth Power'), guessed('Draco Meteor'), guessed('Dragon Dance'), guessed('Icicle Spear'),
    ], { dex: rulesDex(9), itemId: 'choicespecs' });
    expect(names(kept)).toEqual(['Earth Power', 'Draco Meteor', 'Icicle Spear']);
  });

  test('a guessed boost the Vest strikes serves nothing (T28)', () => {
    const kept = applyCoherenceVetoes([
      guessed('Calm Mind'), guessed('Close Combat'), guessed('Moonblast'),
    ], { dex: rulesDex(9), itemId: 'assaultvest' });
    expect(names(kept)).toEqual(['Close Combat', 'Moonblast']);
  });

  test('a revealed boost still serves under a guessed Choice item (T28)', () => {
    const kept = applyCoherenceVetoes([
      revealed('Dragon Dance'), guessed('Earth Power'), guessed('Icicle Spear'),
    ], { dex: rulesDex(9), itemId: 'choicespecs' });
    expect(names(kept)).toEqual(['Dragon Dance', 'Icicle Spear']);
  });

  test('row 2 spares a priority move, and a priority move blocks no main attack (Weavile, T28)', () => {
    expect(names(applyCoherenceVetoes([
      revealed('Triple Axel'), guessed('Ice Shard'), guessed('Icicle Crash'),
    ], { dex: rulesDex(9), itemId: 'choiceband' }))).toEqual(['Triple Axel', 'Ice Shard']);
    expect(names(applyCoherenceVetoes([
      guessed('Ice Shard'), guessed('Icicle Crash'), guessed('Knock Off'),
    ], { dex: rulesDex(9), itemId: 'choiceband' }))).toEqual(['Ice Shard', 'Icicle Crash', 'Knock Off']);
  });

  test('rows 1 and 2 spare the chosen set\'s own moves (Samurott-Hisui with the Vest, T28)', () => {
    const kept = applyCoherenceVetoes([
      revealed('Ceaseless Edge'), fromSet('Razor Shell'), fromSet('Sucker Punch'), fromSet('Knock Off'), guessed('Night Slash'),
    ], { dex: rulesDex(9), itemId: 'assaultvest' });
    expect(names(kept)).toEqual(['Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Knock Off']);
    expect(names(applyCoherenceVetoes([guessed('Swords Dance'), fromSet('Body Press')], { dex: rulesDex(9), itemId: '' })))
      .toEqual(['Swords Dance', 'Body Press']);
  });

  test('a revealed same-type pair is never vetoed, and the chosen set keeps its own pair (round 63)', () => {
    // A published set is read as published: row 2 spares the chosen set's moves.
    expect(names(applyCoherenceVetoes([
      revealed('Headlong Rush'), revealed('Earthquake'), fromSet('Stomping Tantrum'),
    ], { dex: rulesDex(9), itemId: '' }))).toEqual(['Headlong Rush', 'Earthquake', 'Stomping Tantrum']);
    expect(names(applyCoherenceVetoes([
      revealed('Headlong Rush'), revealed('Earthquake'), guessed('Stomping Tantrum'),
    ], { dex: rulesDex(9), itemId: '' }))).toEqual(['Headlong Rush', 'Earthquake']);
  });

  test('a boost from the usage tail serves nothing (Kingdra with Life Orb, review of round 63)', () => {
    // The tail past the top ten usage moves only refills slots; a Dragon
    // Dance at 0.1 % must not decide what the set's attacks scale with.
    const kept = applyCoherenceVetoes([
      revealed('Hydro Pump'), guessed('Draco Meteor'), guessed('Weather Ball'), guessed('Hurricane'),
      { name: 'Dragon Dance', guessed: true, tail: true },
    ], { dex: rulesDex(9), itemId: 'lifeorb' });
    expect(names(kept)).toEqual(['Hydro Pump', 'Draco Meteor', 'Weather Ball', 'Hurricane', 'Dragon Dance']);
  });

  test('the item rows still strike a chosen-set status move (an inferred Scarf, T28)', () => {
    expect(names(applyCoherenceVetoes([fromSet('Volt Switch'), fromSet('Toxic')], { dex: rulesDex(9), itemId: 'choicescarf' })))
      .toEqual(['Volt Switch']);
  });

  test('a boost later in the pool still vetoes an earlier off-stat guess', () => {
    // Usage order can list the attack first; the veto scans the whole pool
    // for boost context before deciding.
    const kept = applyCoherenceVetoes([
      guessed('Body Press'), revealed('Swords Dance'), guessed('Iron Head'),
    ], { dex: rulesDex(9), itemId: '' });
    expect(names(kept)).toEqual(['Swords Dance', 'Iron Head']);
  });
});

describe('coherent-set selection', () => {
  const set = (moves: string[], item?: string): PokemonSetAssumption => ({
    species: 'Noivern', sourceDetail: 't',
    moves: moves.map(value => ({ value, sourceDetail: 't' })),
    ...(item ? { item: { value: item, sourceDetail: 't' } } : {}),
  });
  const evidence = (over: Partial<CuratedEvidence>): CuratedEvidence => ({
    dex: rulesDex(9),
    revealedMoves: [], revealedItem: '', revealedAbility: '',
    ruledOutItems: [], ruledOutAbilities: [],
    usageProbability: () => 0.5,
    ...over,
  });
  const specs = () => set(['Draco Meteor', 'Hurricane', 'Flamethrower', 'U-turn'], 'Choice Specs');
  const utility = () => set(['Super Fang', 'Taunt', 'Roost', 'Hurricane'], 'Heavy-Duty Boots');

  test('a revealed move picks the matching set over the first-listed one', () => {
    const boots = utility();
    expect(selectCuratedSet([specs(), boots], evidence({ revealedMoves: ['superfang'] }))).toBe(boots);
  });

  test('a rule-out disqualifies the set outright', () => {
    const boots = utility();
    expect(selectCuratedSet([specs(), boots], evidence({ ruledOutItems: ['choicespecs'] }))).toBe(boots);
  });

  test('sets contradicting the revealed moves fall below the floor', () => {
    expect(selectCuratedSet([specs(), utility()], evidence({
      revealedMoves: ['tackle', 'protect'],
    }))).toBeNull();
  });

  test('with no evidence the usage marginals break the tie', () => {
    const first = specs();
    const second = utility();
    const picked = selectCuratedSet([first, second], evidence({
      usageProbability: moveId => (moveId === 'superfang' || moveId === 'taunt' || moveId === 'roost' ? 0.9 : 0.05),
    }));
    expect(picked).toBe(second);
  });

  // Smogon publishes slots with alternatives; the build must read a slot as filled once one option is seen, and never trade a fixed
  // move for a second option of a filled slot (648453 Tornadus-T).
  const slotted = (moves: (string | string[])[], item?: string): PokemonSetAssumption => ({
    species: 'Tornadus-Therian', sourceDetail: 't',
    moves: moves.map(slot => Array.isArray(slot)
      ? { value: slot[0], sourceDetail: 't', options: slot }
      : { value: slot, sourceDetail: 't' }),
    ...(item ? { item: { value: item, sourceDetail: 't' } } : {}),
  });
  const pivot = () => slotted(['Hurricane', ['Heat Wave', 'Hidden Power Ice'], 'Knock Off', 'U-turn'], 'Assault Vest');
  const values = (picked: PokemonSetAssumption | null) => picked?.moves.map(move => move.value);

  test('a revealed option fills its slot: the fixed Knock Off stays, Heat Wave goes (T89)', () => {
    const picked = selectCuratedSet([pivot()], evidence({ revealedMoves: ['uturn', 'hiddenpowerice', 'hurricane'] }));
    expect(values(picked)).toEqual(['Hurricane', 'Knock Off', 'U-turn']);
  });

  test('a revealed second option counts toward the fit like a first option (T89)', () => {
    const scarf = slotted(['Hurricane', 'U-turn', 'Taunt', 'Superpower'], 'Choice Scarf');
    const picked = selectCuratedSet([scarf, pivot()], evidence({ revealedMoves: ['uturn', 'hiddenpowerice', 'hurricane'] }));
    expect(picked?.item?.value).toBe('Assault Vest');
  });

  test('a revealed typeless Hidden Power fills a typed Hidden Power option (T89)', () => {
    // Logs before gen 8 show "Hidden Power" without its type.
    const picked = selectCuratedSet([pivot()], evidence({ revealedMoves: ['hiddenpower'] }));
    expect(values(picked)).toEqual(['Hurricane', 'Knock Off', 'U-turn']);
  });

  test('fixed moves come before the open slots, first options before the others (T89)', () => {
    const picked = selectCuratedSet([pivot()], evidence({ revealedMoves: ['hurricane'] }));
    expect(values(picked)).toEqual(['Hurricane', 'Knock Off', 'U-turn', 'Heat Wave', 'Hidden Power Ice']);
  });

  test('two revealed options of one slot fill it once (573756 Toxapex: "The Pex" cannot hold both Toxic and Haze, T89)', () => {
    const toxapex = (moves: (string | string[])[], item: string) => ({ ...slotted(moves, item), species: 'Toxapex' });
    const pex = toxapex([['Light Screen', 'Knock Off', 'Scald'], ['Knock Off', 'Scald', 'Poison Jab'], ['Toxic', 'Haze'], 'Recover'], 'Shed Shell');
    const spdef = toxapex([['Knock Off', 'Scald', 'Poison Jab'], ['Toxic', 'Knock Off'], ['Haze', 'Light Screen'], 'Recover'], 'Black Sludge');
    const picked = selectCuratedSet([pex, spdef], evidence({ revealedMoves: ['toxic', 'knockoff', 'haze', 'recover'] }));
    expect(picked?.item?.value).toBe('Black Sludge');
    expect(values(picked)).toEqual(['Recover']);
    // One Knock Off fills one slot: the other slot stays open and offers its other options.
    expect(values(selectCuratedSet([pex], evidence({ revealedMoves: ['knockoff'] }))))
      .toEqual(['Recover', 'Scald', 'Toxic', 'Poison Jab', 'Haze']);
  });

  test('a set without slot options comes back as published (T89)', () => {
    const boots = utility();
    expect(selectCuratedSet([boots], evidence({ revealedMoves: ['roost'] }))).toBe(boots);
  });

  test('a revealed item counts toward the fit', () => {
    const boots = utility();
    // Hurricane matches both sets; the revealed Boots break the tie by fit.
    expect(selectCuratedSet([specs(), boots], evidence({
      revealedMoves: ['hurricane'], revealedItem: 'heavydutyboots',
    }))).toBe(boots);
  });
});

const curated = (moves: string[], nature: string, evs: Record<string, number>): PokemonSetAssumption => ({
  species: 'Iron Valiant', sourceDetail: 's', ability: { value: 'Quark Drive', sourceDetail: 's' },
  item: { value: 'Booster Energy', sourceDetail: 's' },
  moves: moves.map(value => ({ value, sourceDetail: 's' })),
  spread: { nature, evs, sourceDetail: 's' } as PokemonSetAssumption['spread'],
});
const physical = () => curated(['Swords Dance', 'Spirit Break', 'Close Combat', 'Shadow Sneak'], 'Jolly', { atk: 252, spe: 252, spd: 4 });
const special = () => curated(['Calm Mind', 'Moonblast', 'Focus Blast', 'Thunderbolt'], 'Timid', { spa: 252, spe: 252, spd: 4 });
const usageOf: Record<string, number> = { moonblast: 0.9, closecombat: 0.7, spiritbreak: 0.5, swordsdance: 0.4, shadowsneak: 0.2, calmmind: 0.3 };
const evidence = (over: Partial<CuratedEvidence>): CuratedEvidence => ({
  dex: rulesDex(9),
  revealedMoves: ['swordsdance', 'spiritbreak', 'shadowsneak'], revealedItem: '', revealedAbility: '',
  ruledOutItems: ['boosterenergy'], ruledOutAbilities: [], usageProbability: moveId => usageOf[moveId] ?? 0, ...over,
});

describe('selectCuratedSet: every item of every published set is ruled out', () => {
  test('the set that fits the moves stays the pick, with the most used allowed item, marked as a guess', () => {
    const picked = selectCuratedSet([special(), physical()], evidence({ usageItem: 'Leftovers' }));
    expect(picked?.moves.map(move => move.value)).toEqual(['Swords Dance', 'Spirit Break', 'Close Combat', 'Shadow Sneak']);
    expect(picked?.spread?.nature).toBe('Jolly');
    expect(picked?.item).toMatchObject({ value: 'Leftovers', sourceDetail: 'Booster Energy ruled out, most used other item' });
    expect(picked?.itemReplaced).toBe(true);
  });

  test('a guess the log supports comes before the usage majority', () => {
    const picked = selectCuratedSet([physical()], evidence({ guessedItem: 'Covert Cloak', usageItem: 'Leftovers' }));
    expect(picked?.item).toMatchObject({ value: 'Covert Cloak', sourceDetail: 'Booster Energy ruled out, Covert Cloak guessed from the log' });
  });

  test('a set that contradicts the moves still gives way: no candidate fits, no pick', () => {
    expect(selectCuratedSet([special()], evidence({ usageItem: 'Leftovers' }))).toBeNull();
  });

  test('without any replacement item there is no pick (the marginal assembly decides, as before)', () => {
    expect(selectCuratedSet([physical()], evidence({}))).toBeNull();
  });

  test('a replacement the log rules out is none', () => {
    expect(selectCuratedSet([physical()], evidence({ ruledOutItems: ['boosterenergy', 'leftovers'], usageItem: 'Leftovers' }))).toBeNull();
  });

  test('a set with an allowed item is still preferred and returned as published (the same object)', () => {
    const allowedItem = { ...physical(), item: { value: 'Leftovers', sourceDetail: 's' } };
    expect(selectCuratedSet([special(), allowedItem], evidence({ usageItem: 'Choice Band' }))).toBe(allowedItem);
  });
});

const usage = (): PokemonUsageStats => ({
  species: 'Iron Valiant', rawCount: 1000, abilities: [],
  spreads: [{ value: { nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } }, probability: 0.6, sourceDetail: 'u' }] as PokemonUsageStats['spreads'],
  items: [{ value: 'Booster Energy', probability: 0.6, sourceDetail: 'u' }, { value: 'Leftovers', probability: 0.2, sourceDetail: 'u' }],
  moves: Object.entries({ Moonblast: 0.9, 'Close Combat': 0.7, 'Spirit Break': 0.5, 'Swords Dance': 0.4, 'Shadow Sneak': 0.2, 'Calm Mind': 0.3 })
    .map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
});
const stats = (): SmogonUsageStats => ({ format: 'test', month: 'm', source: 's', pokemon: { [toId('Iron Valiant')]: usage() } });
const setAssumptions = (): SmogonSetAssumptions => ({ format: 'test', source: 's', pokemon: { ironvaliant: { ...special(), alternatives: [physical()] } } });

const singles = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|test', '|poke|p1|Skarmory|item', '|poke|p2|Iron Valiant|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p2a: Mon|Iron Valiant|100/100',
  ...['Swords Dance', 'Spirit Break', 'Shadow Sneak'].flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');
const doubles = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|test',
  '|poke|p1|Skarmory|item', '|poke|p1|Blissey|item', '|poke|p2|Iron Valiant|item', '|poke|p2|Incineroar|item', '|start',
  '|switch|p1a: Skarmory|Skarmory|100/100', '|switch|p1b: Blissey|Blissey|100/100',
  '|switch|p2a: Mon|Iron Valiant|100/100', '|switch|p2b: Cat|Incineroar|100/100',
  ...['Swords Dance', 'Spirit Break', 'Shadow Sneak'].flatMap((move, index) => [`|turn|${index + 1}`, `|move|p2a: Mon|${move}|p1a: Skarmory`]),
].join('\n');

function build(log: string) {
  const raw = inferOpponentTeam(log, 'p2');
  raw.pokemon.find(mon => mon.species === 'Iron Valiant')!.ruledOut = { items: ['boosterenergy'], abilities: [] };
  const p2Info = enrichTeamInfo(raw, stats(), setAssumptions());
  const team = buildTeamsFromReplay(log, { p2Info, usageStats: stats(), setAssumptions: setAssumptions() }).p2Team;
  return { built: team.find(set => set.species === 'Iron Valiant')!, panel: p2Info.pokemon.find(mon => mon.species === 'Iron Valiant')! };
}

describe('752839: the build and the panel keep the physical set', () => {
  for (const [kind, log] of [['singles', singles], ['doubles', doubles]] as const) {
    test(`${kind}: a physical nature, the shown moves and a replacement item`, () => {
      const { built, panel } = build(log);
      expect(built.nature).toBe('Jolly');
      expect(built.evs).toMatchObject({ atk: 252, spe: 252 });
      expect(built.moves).toEqual(expect.arrayContaining(['Swords Dance', 'Spirit Break', 'Shadow Sneak']));
      expect(built.item).toBe('Leftovers');
      expect(panel.item).toMatchObject({ value: 'Leftovers', source: 'guessed', sourceDetail: 'Booster Energy ruled out, most used other item' });
    });
  }
});

describe('set-provenance', () => {
  const fromSet = (name: string): MoveCandidate => ({ name, guessed: true, fromSet: true });
  const names = (moves: MoveCandidate[]) => moves.map(move => move.name);

  describe('the item rows spare the chosen set\'s moves under its own item', () => {
    test('singles: Ditto\'s Choice Scarf set keeps Transform, Jirachi\'s keeps Healing Wish', () => {
      expect(names(applyCoherenceVetoes([fromSet('Transform')], { dex: rulesDex(9), itemId: 'choicescarf', itemFromSet: true }))).toEqual(['Transform']);
      expect(names(applyCoherenceVetoes([fromSet('Iron Head'), fromSet('U-turn'), fromSet('Healing Wish'), fromSet('Trick')], { dex: rulesDex(9), itemId: 'choicescarf', itemFromSet: true })))
        .toEqual(['Iron Head', 'U-turn', 'Healing Wish', 'Trick']);
    });

    test('doubles: Zapdos-Galar\'s Choice Scarf set keeps Coaching, an Assault Vest set its status move', () => {
      expect(names(applyCoherenceVetoes([fromSet('Thunderous Kick'), fromSet('Brave Bird'), fromSet('Coaching')], { dex: rulesDex(9), itemId: 'choicescarf', itemFromSet: true })))
        .toEqual(['Thunderous Kick', 'Brave Bird', 'Coaching']);
      expect(names(applyCoherenceVetoes([fromSet('Fake Out'), fromSet('Taunt')], { dex: rulesDex(9), itemId: 'assaultvest', itemFromSet: true }))).toEqual(['Fake Out', 'Taunt']);
    });

    test('an item from elsewhere still strikes: the set\'s status move falls under an inferred Scarf', () => {
      expect(names(applyCoherenceVetoes([fromSet('Iron Head'), fromSet('Healing Wish')], { dex: rulesDex(9), itemId: 'choicescarf', itemFromSet: false }))).toEqual(['Iron Head']);
      expect(names(applyCoherenceVetoes([fromSet('Iron Head'), fromSet('Healing Wish')], { dex: rulesDex(9), itemId: 'choicescarf' }))).toEqual(['Iron Head']);
    });

    test('a guessed status move outside the set still falls under the set\'s own Choice item', () => {
      const usageFill: MoveCandidate = { name: 'Calm Mind', guessed: true };
      expect(names(applyCoherenceVetoes([fromSet('Iron Head'), usageFill], { dex: rulesDex(9), itemId: 'choicescarf', itemFromSet: true }))).toEqual(['Iron Head']);
    });
  });

  const usage = (species: string, items: [string, number][], moves: [string, number][]): PokemonUsageStats => ({
    species, rawCount: 1000, abilities: [], spreads: [],
    items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
    moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  });
  const published = (species: string, item: string, moves: string[]): PokemonSetAssumption => ({
    species, sourceDetail: 's', item: { value: item, sourceDetail: 's' }, moves: moves.map(value => ({ value, sourceDetail: 's' })),
  });
  const jirachiStats: SmogonUsageStats = {
    format: 'gen6ou', month: 'm', source: 's', pokemon: Object.fromEntries([
      usage('Jirachi', [['Leftovers', 0.6], ['Choice Scarf', 0.3]], [['Iron Head', 0.9], ['U-turn', 0.8], ['Healing Wish', 0.5], ['Trick', 0.4], ['Stealth Rock', 0.4]]),
    ].map(entry => [toId(entry.species), entry])),
  };

  /** A Jirachi that only showed Iron Head (a second move would disprove the Choice lock): the published Choice Scarf set is the evidence's pick. */
  const jirachiLog = (doubles: boolean) => [
    '|player|p1|Alpha|', '|player|p2|Beta|', ...(doubles ? ['|gametype|doubles'] : []), '|gen|6', `|tier|[Gen 6] ${doubles ? 'Doubles OU' : 'OU'}`,
    '|poke|p1|Blissey, F|', '|poke|p1|Chansey, F|', '|poke|p2|Jirachi|', '|poke|p2|Skarmory, F|', '|start',
    '|switch|p1a: Blissey|Blissey, F|100/100', ...(doubles ? ['|switch|p1b: Chansey|Chansey, F|100/100'] : []),
    '|switch|p2a: Jirachi|Jirachi|100/100', ...(doubles ? ['|switch|p2b: Skarmory|Skarmory, F|100/100'] : []),
    '|turn|1', '|move|p2a: Jirachi|Iron Head|p1a: Blissey', '|-damage|p1a: Blissey|80/100',
    '|turn|2', '|move|p2a: Jirachi|Iron Head|p1a: Blissey', '|-damage|p1a: Blissey|60/100', '|turn|3',
  ].join('\n');

  describe('build and panel pass the item\'s provenance (T131)', () => {
    const sets = (item: string): SmogonSetAssumptions => ({
      format: 'gen6ou', source: 's', pokemon: { jirachi: published('Jirachi', item, ['Iron Head', 'U-turn', 'Healing Wish', 'Trick']) },
    });

    test.each([['singles', false], ['doubles', true]])('%s: the Choice Scarf set plays Healing Wish in the panel and the build', (_, doubles) => {
      const log = jirachiLog(doubles as boolean);
      const p2Info = enrichTeamInfo(inferOpponentTeam(log, 'p2'), jirachiStats, sets('Choice Scarf'));
      const panel = p2Info.pokemon.find(mon => mon.species === 'Jirachi')!;
      expect(panel.item.value).toBe('Choice Scarf');
      expect(panel.moves.map(move => move.name)).toContain('Healing Wish');
      const built = buildTeamsFromReplay(log, { p2Info, usageStats: jirachiStats, setAssumptions: sets('Choice Scarf') }).p2Team;
      expect(built.find(set => set.species === 'Jirachi')!.moves).toContain('Healing Wish');
    });
  });
});
