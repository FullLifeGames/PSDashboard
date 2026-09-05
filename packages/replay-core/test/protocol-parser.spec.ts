import { test, expect, describe } from 'vitest';
import { parseReplayLog, parseReplayLogWithObservations } from '../src/protocol-parser';

const obsHeader = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|teamsize|p1|1',
  '|teamsize|p2|1',
  '|gen|9',
  '|tier|[Gen 9] Custom Game',
  '|start',
  '|switch|p1a: Lax|Snorlax, M|100/100',
  '|switch|p2a: Chomp|Garchomp, F|100/100',
  '|turn|1',
];

describe('protocol parser fault tolerance', () => {
  test('a malformed event after a faint does not kill the whole parse', () => {
    // The gpl-pipeline shape: video-reconstructed logs can emit impossible
    // orderings — here a |-fail| targeting a mon that just fainted, which
    // @pkmn/client resolves to null and crashes on. One bad line must not
    // take down the whole replay.
    const log = [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|teamsize|p1|1',
      '|teamsize|p2|1',
      '|gen|9',
      '|tier|[Gen 9] Custom Game',
      '|start',
      '|switch|p1a: Uxie|Uxie, L50|182/182',
      '|switch|p2a: Sig|Iron Jugulis, L50|100/100',
      '|turn|1',
      '|move|p1a: Uxie|Moonblast|p2a: Sig',
      '|-damage|p2a: Sig|0 fnt',
      '|faint|p2a: Sig',
      // Unresolvable ident — @pkmn/client returns null and its |-fail|
      // handler dereferences it unconditionally.
      '|-fail|p2a: Someone Else',
      '|turn|2',
    ].join('\n');
    const snapshots = parseReplayLog(log);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    // Everything around the skipped line still applied.
    const last = snapshots[snapshots.length - 1];
    const sig = last.p2.pokemon.find(mon => mon.speciesForme.startsWith('Iron Jugulis'));
    expect(sig?.fainted).toBe(true);
  });
});

describe('damage observations', () => {
  test('a clean singles hit yields one observation with its context', () => {
    const log = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-damage|p2a: Chomp|76/100',
      '|turn|2',
    ].join('\n');
    const { observations } = parseReplayLogWithObservations(log);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      attackerSpecies: 'Snorlax',
      defenderSpecies: 'Garchomp',
      attackerSide: 'p1',
      moveId: 'tackle',
      attackerStatus: '',
      lethal: false,
    });
    expect(observations[0].observedFraction).toBeCloseTo(0.24, 5);
  });

  test('a knock-out hit is recorded as a lethal lower bound', () => {
    // The line only says the hit took everything that was left: the
    // recorded fraction is the remaining HP, the flag tells the fitter to
    // read it as a lower bound rather than a damage reading.
    const log = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-damage|p2a: Chomp|0 fnt',
      '|faint|p2a: Chomp',
      '|turn|2',
    ].join('\n');
    const { observations } = parseReplayLogWithObservations(log);
    expect(observations).toHaveLength(1);
    expect(observations[0].lethal).toBe(true);
    expect(observations[0].observedFraction).toBeCloseTo(1, 5);
  });

  test('crits, [from] damage, multi-hits, and doubles yield no observations', () => {
    const crit = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-crit|p2a: Chomp',
      '|-damage|p2a: Chomp|64/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(crit).observations).toHaveLength(0);

    const attributed = [
      ...obsHeader,
      '|-damage|p2a: Chomp|88/100|[from] Stealth Rock',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(attributed).observations).toHaveLength(0);

    const multiHit = [
      ...obsHeader,
      '|move|p1a: Lax|Double Kick|p2a: Chomp',
      '|-damage|p2a: Chomp|90/100',
      '|-damage|p2a: Chomp|80/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(multiHit).observations).toHaveLength(0);

    const doubles = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9',
      '|tier|[Gen 9] VGC', '|start',
      '|switch|p1a: Lax|Snorlax, M|100/100',
      '|switch|p2a: Chomp|Garchomp, F|100/100',
      '|turn|1',
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-damage|p2a: Chomp|76/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(doubles).observations).toHaveLength(0);
  });

  test('unattributed damage outside the move action window yields no observation', () => {
    // A miss ends the action: the confusion self-hit that follows must not be
    // recorded as Tackle damage (the stale-attribution bug class).
    const confusionAfterMiss = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-miss|p1a: Lax|p2a: Chomp',
      '|-activate|p2a: Chomp|confusion',
      '|-damage|p2a: Chomp|90/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(confusionAfterMiss).observations).toHaveLength(0);

    // Future Sight resolves at end of turn with a bare |-damage| after |-end|;
    // it must not be attributed to an earlier move that targeted the same mon.
    const futureSight = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-immune|p2a: Chomp',
      '|-end|p2a: Chomp|move: Future Sight',
      '|-damage|p2a: Chomp|55/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(futureSight).observations).toHaveLength(0);
  });

  test('self-targeting damage (Substitute cost) yields no observation', () => {
    const log = [
      ...obsHeader,
      '|move|p2a: Chomp|Substitute|p2a: Chomp',
      '|-start|p2a: Chomp|Substitute',
      '|-damage|p2a: Chomp|75/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(log).observations).toHaveLength(0);
  });
});

describe('speed-order evidence', () => {
  const speedLog = (body: string[]) => [
    '|player|p1|Alice|', '|player|p2|Bob|',
    '|teamsize|p1|2', '|teamsize|p2|2',
    '|gen|9', '|gametype|singles', '|tier|[Gen 9] OU',
    '|start',
    '|switch|p1a: Fast|Noivern, F|100/100',
    '|switch|p2a: Val|Iron Valiant|100/100',
    '|turn|1',
    ...body,
  ].join('\n');

  test('a clean same-turn move pair proves the order', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern',
      secondSide: 'p2', secondSpecies: 'Iron Valiant',
      turn: 1,
    }]);
  });

  test('a priority move explains the order — no constraint', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p2a: Val|Sucker Punch|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([]);
  });

  test('Tailwind spans exclude later turns but not the turn it went up', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Tailwind|p1a: Fast',
      '|-sidestart|p1: Alice|move: Tailwind',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|3',
    ]));
    // Turn 1's order predates the Tailwind; turn 2's is explained by it.
    expect(speedOrders).toHaveLength(1);
    expect(speedOrders[0].turn).toBe(1);
  });

  test('paralysis is directional: it excuses the slow, never the fast', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Thunder Wave|p2a: Val',
      '|-status|p2a: Val|par',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|turn|3',
    ]));
    // Turn 1: Val moved second AND is paralyzed by move time — the para
    // explains the slowness, no constraint. Turn 2: the paralyzed Val
    // moving FIRST is STRONGER evidence (its quartered speed still won —
    // the base-speed conclusion follows a fortiori).
    expect(speedOrders).toEqual([{
      firstSide: 'p2', firstSpecies: 'Iron Valiant',
      secondSide: 'p1', secondSpecies: 'Noivern',
      turn: 2,
    }]);
  });

  test('Tailwind on the SECOND mover keeps the evidence (it only strengthens)', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p2a: Val|Tailwind|p2a: Val',
      '|-sidestart|p2: Bob|move: Tailwind',
      '|turn|2',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|3',
    ]));
    // Val moved second DESPITE doubled speed — Noivern outruns even the
    // doubled value, so it outruns the base speed a fortiori.
    expect(speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern',
      secondSide: 'p2', secondSpecies: 'Iron Valiant',
      turn: 2,
    }]);
  });

  test('a speed drop on the first mover keeps the evidence', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Icy Wind|p2a: Val',
      '|-unboost|p2a: Val|spe|1',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|turn|3',
    ]));
    // Turn 1: Val moved second at −1 Speed — explained, dropped. Turn 2:
    // Val moved FIRST at −1 Speed — stronger than a clean read.
    expect(speedOrders).toEqual([{
      firstSide: 'p2', firstSpecies: 'Iron Valiant',
      secondSide: 'p1', secondSpecies: 'Noivern',
      turn: 2,
    }]);
  });

  test('Trick Room turns prove nothing (and the setup move has priority)', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Trick Room|p1a: Fast',
      '|-fieldstart|move: Trick Room',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|turn|3',
    ]));
    expect(speedOrders).toEqual([]);
  });

  test('speed stages void the evidence', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Dragon Dance|p1a: Fast',
      '|-boost|p1a: Fast|atk|1',
      '|-boost|p1a: Fast|spe|1',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|3',
    ]));
    // Turn 1 pair is clean (the boost lands after the move); turn 2's first
    // mover carries +1 Speed — excluded.
    expect(speedOrders).toHaveLength(1);
    expect(speedOrders[0].turn).toBe(1);
  });

  test('a Sleep Talk follow-up line is the same action, not a second mover', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|Sleep Talk|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val|[from]Sleep Talk',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern', secondSide: 'p2', secondSpecies: 'Iron Valiant', turn: 1,
    }]);
  });

  test('a Sleep Talk after the sleep line is still the mover\'s action', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|cant|p1a: Fast|slp',
      '|move|p1a: Fast|Sleep Talk|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val|[from] move: Sleep Talk',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([{
      firstSide: 'p2', firstSpecies: 'Iron Valiant', secondSide: 'p1', secondSpecies: 'Noivern', turn: 1,
    }]);
  });

  test('a Pursuit on a U-turn user moved second: the U-turn won the race', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|move|p1a: Fast|U-turn|p2a: Val',
      '|-damage|p2a: Val|80/100',
      '|-activate|p1a: Fast|move: Pursuit',
      '|move|p2a: Val|Pursuit|p1a: Fast|[from]Pursuit',
      '|-damage|p1a: Fast|50/100',
      '|switch|p1a: Wall|Corviknight, M|100/100',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern', secondSide: 'p2', secondSpecies: 'Iron Valiant', turn: 1,
    }]);
  });

  test('a Pursuit knock-out on a switching target is no race', () => {
    const { speedOrders } = parseReplayLogWithObservations(speedLog([
      '|-activate|p1a: Fast|move: Pursuit',
      '|move|p2a: Val|Pursuit|p1a: Fast|[from]Pursuit',
      '|-damage|p1a: Fast|0 fnt',
      '|faint|p1a: Fast',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([]);
  });

  // Round 37: doubles turns prove every opposite-side pair, copied actions
  // and rearranged slots do not.
  const doublesLog = (body: string[]) => [
    '|player|p1|Alice|', '|player|p2|Bob|',
    '|teamsize|p1|4', '|teamsize|p2|4',
    '|gen|9', '|gametype|doubles', '|tier|[Gen 9] VGC 2026',
    '|start',
    '|switch|p1a: Fast|Noivern, F|100/100',
    '|switch|p1b: Slow|Snorlax, M|100/100',
    '|switch|p2a: Val|Iron Valiant|100/100',
    '|switch|p2b: Ori|Oricorio|100/100',
    '|turn|1',
    ...body,
  ].join('\n');
  const pairs = (log: string) => parseReplayLogWithObservations(log).speedOrders.map(o => `${o.firstSpecies}>${o.secondSpecies}`);

  test('a doubles turn proves every opposite-side pair in action order', () => {
    // Fast > Val, Fast > Ori, Val > Slow, Ori > Slow; Fast > Slow and Val > Ori are same-side.
    expect(pairs(doublesLog([
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|move|p2b: Ori|Revelation Dance|p1b: Slow',
      '|move|p1b: Slow|Body Slam|p2b: Ori',
      '|turn|2',
    ]))).toEqual(['Noivern>Iron Valiant', 'Noivern>Oricorio', 'Iron Valiant>Snorlax', 'Oricorio>Snorlax']);
  });

  test('a partner knocked out by a spread move is no speed evidence', () => {
    expect(pairs(doublesLog([
      '|move|p1a: Fast|Earthquake|p1b: Slow|[spread] p1b,p2a,p2b',
      '|-damage|p1b: Slow|0 fnt',
      '|faint|p1b: Slow',
      '|turn|2',
    ]))).toEqual([]);
  });

  test('a knock-out across the field before the victim acted proves the order in doubles', () => {
    expect(pairs(doublesLog([
      '|move|p1a: Fast|Draco Meteor|p2b: Ori',
      '|-damage|p2b: Ori|0 fnt',
      '|faint|p2b: Ori',
      '|turn|2',
    ]))).toEqual(['Noivern>Oricorio']);
  });

  test('a Dancer copy is not the copier\'s action', () => {
    const { speedOrders } = parseReplayLogWithObservations(doublesLog([
      '|move|p1a: Fast|Fiery Dance|p2a: Val',
      '|move|p2b: Ori|Fiery Dance|p1a: Fast|[from] ability: Dancer',
      '|move|p2b: Ori|Revelation Dance|p1a: Fast',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern', secondSide: 'p2', secondSpecies: 'Oricorio', turn: 1,
    }]);
  });

  test('a Pursuit on a switching target moved at the switch, not at its Speed', () => {
    expect(pairs(doublesLog([
      '|-activate|p1a: Fast|move: Pursuit',
      '|move|p2a: Val|Pursuit|p1a: Fast|[from]Pursuit',
      '|-damage|p1a: Fast|40/100',
      '|switch|p1a: Wall|Corviknight, M|100/100',
      '|move|p1b: Slow|Body Slam|p2b: Ori',
      '|move|p2b: Ori|Revelation Dance|p1b: Slow',
      '|turn|2',
    ]))).toEqual(['Snorlax>Oricorio']);
  });

  test('After You moves the target out of the race', () => {
    // Val > Fast stands; Ori's position was arranged, so no pair with Ori.
    expect(pairs(doublesLog([
      '|move|p2a: Val|After You|p2b: Ori',
      '|-activate|p2b: Ori|move: After You',
      '|move|p2b: Ori|Revelation Dance|p1a: Fast',
      '|move|p1a: Fast|Air Slash|p2a: Val',
      '|turn|2',
    ]))).toEqual(['Iron Valiant>Noivern']);
  });

});

// Round 37: conditional priority, quick items, field speed, always-last
// abilities, and a Scarf that changed hands explain an order without Speed.
test.describe('speed-order cleanliness', () => {
  const singlesLog = (mons: [string, string], body: string[], pre: string[] = []) => [
    '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|2', '|teamsize|p2|2',
    '|gen|9', '|gametype|singles', '|tier|[Gen 9] OU', '|start',
    `|switch|p1a: A|${mons[0]}|100/100`, `|switch|p2a: B|${mons[1]}|100/100`,
    ...pre, '|turn|1', ...body, '|turn|2',
  ].join('\n');
  const orders = (log: string) => parseReplayLogWithObservations(log).speedOrders.map(o => `${o.firstSpecies}>${o.secondSpecies}`);
  const firstThenDraco = (move: string) => [`|move|p1a: A|${move}|p2a: B`, '|move|p2a: B|Draco Meteor|p1a: A'];

  test('a Prankster status move first proves nothing', () => {
    expect(orders(singlesLog(['Grimmsnarl, M', 'Dragapult, F'], [
      '|move|p1a: A|Reflect|p1a: A', '|-sidestart|p1: Alice|Reflect', '|move|p2a: B|Draco Meteor|p1a: A',
    ]))).toEqual([]);
  });

  test('a Prankster attack first is a race', () => {
    expect(orders(singlesLog(['Grimmsnarl, M', 'Snorlax, M'], [
      '|move|p1a: A|Spirit Break|p2a: B', '|move|p2a: B|Body Slam|p1a: A',
    ]))).toEqual(['Grimmsnarl>Snorlax']);
  });

  test('Gale Wings excuses a Flying move first at full HP, not below it', () => {
    expect(orders(singlesLog(['Talonflame, M', 'Dragapult, F'], firstThenDraco('Brave Bird')))).toEqual([]);
    expect(orders(singlesLog(['Talonflame, M', 'Dragapult, F'], firstThenDraco('Brave Bird'), ['|-damage|p1a: A|50/100']))).toEqual(['Talonflame>Dragapult']);
  });

  test('Grassy Glide under Grassy Terrain excuses the order, without the terrain it is a race', () => {
    const terrain = ['|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p1a: A'];
    expect(orders(singlesLog(['Rillaboom, M', 'Dragapult, F'], firstThenDraco('Grassy Glide'), terrain))).toEqual([]);
    expect(orders(singlesLog(['Rillaboom, M', 'Dragapult, F'], firstThenDraco('Grassy Glide')))).toEqual(['Rillaboom>Dragapult']);
  });

  test('a Quick Claw activation excuses the order', () => {
    expect(orders(singlesLog(['Snorlax, M', 'Dragapult, F'], [
      '|-activate|p1a: A|item: Quick Claw', '|move|p1a: A|Body Slam|p2a: B', '|move|p2a: B|Draco Meteor|p1a: A',
    ]))).toEqual([]);
  });

  test('a Custap Berry excuses the order', () => {
    expect(orders(singlesLog(['Snorlax, M', 'Dragapult, F'], [
      '|-enditem|p1a: A|Custap Berry|[eat]', '|move|p1a: A|Body Slam|p2a: B', '|move|p2a: B|Draco Meteor|p1a: A',
    ]))).toEqual([]);
  });

  test('a Swift Swim species moving first in rain proves nothing, out of rain it does', () => {
    expect(orders(singlesLog(['Kingdra, M', 'Dragapult, F'], firstThenDraco('Waterfall'), ['|-weather|RainDance']))).toEqual([]);
    expect(orders(singlesLog(['Kingdra, M', 'Dragapult, F'], firstThenDraco('Waterfall')))).toEqual(['Kingdra>Dragapult']);
  });

  test('a revealed other ability lifts the weather suspicion', () => {
    expect(orders(singlesLog(['Kingdra, M', 'Dragapult, F'], firstThenDraco('Waterfall'), [
      '|-weather|RainDance', '|-ability|p1a: A|Sniper',
    ]))).toEqual(['Kingdra>Dragapult']);
  });

  test('a Stall species moving second proves nothing', () => {
    expect(orders(singlesLog(['Snorlax, M', 'Sableye, F'], [
      '|move|p1a: A|Body Slam|p2a: B', '|move|p2a: B|Knock Off|p1a: A',
    ]))).toEqual([]);
  });

  test('Mycelium Might slows a status move, not an attack', () => {
    expect(orders(singlesLog(['Snorlax, M', 'Toedscruel, F'], [
      '|move|p1a: A|Body Slam|p2a: B', '|move|p2a: B|Spore|p1a: A',
    ]))).toEqual([]);
    expect(orders(singlesLog(['Snorlax, M', 'Toedscruel, F'], [
      '|move|p1a: A|Body Slam|p2a: B', '|move|p2a: B|Earth Power|p1a: A',
    ]))).toEqual(['Snorlax>Toedscruel']);
  });

  test('an Unburden species that lost its item proves nothing', () => {
    expect(orders(singlesLog(['Hawlucha, M', 'Dragapult, F'], firstThenDraco('Acrobatics'), ['|-enditem|p1a: A|Grassy Seed']))).toEqual([]);
  });

  test('a Choice Scarf that changed hands voids the races that ran with an item the set does not carry', () => {
    const mons: [string, string] = ['Snorlax, M', 'Dragapult, F'];
    const race = ['|move|p1a: A|Body Slam|p2a: B', '|move|p2a: B|Draco Meteor|p1a: A'];
    const turns = (log: string) => parseReplayLogWithObservations(log).speedOrders.map(o => o.turn);
    // Knocked off at turn 2: the race of turn 1 ran with the Scarf the set carries, the race of turn 3 without it.
    expect(turns(singlesLog(mons, [
      ...race, '|turn|2', '|-enditem|p2a: B|Choice Scarf|[from] move: Knock Off|[of] p1a: A', '|turn|3', ...race,
    ]))).toEqual([1]);
    // Knocked off before any race: nothing stands.
    expect(orders(singlesLog(mons, race, ['|-enditem|p2a: B|Choice Scarf|[from] move: Knock Off|[of] p1a: A']))).toEqual([]);
    // Tricked onto the first mover at turn 2: the race of turn 1 ran without the Scarf the set now carries.
    expect(turns(singlesLog(mons, [
      ...race, '|turn|2', '|-item|p1a: A|Choice Scarf|[from] move: Trick', '|turn|3', ...race,
    ]))).toEqual([3]);
    // Given away: which item the set carries is open, so no race of the giver counts.
    expect(orders(singlesLog(mons, race, [
      '|-item|p2a: B|Choice Scarf|[from] ability: Frisk|[of] p1a: A', '|-item|p2a: B|Leftovers|[from] move: Trick',
    ]))).toEqual([]);
    // Frisk only reveals the Scarf: the race stands.
    expect(orders(singlesLog(mons, race, ['|-item|p2a: B|Choice Scarf|[from] ability: Frisk|[of] p1a: A']))).toEqual(['Snorlax>Dragapult']);
  });
});

describe('KO-before-acting speed evidence', () => {
  const koLog = (body: string[]) => [
    '|player|p1|Alice|', '|player|p2|Bob|',
    '|teamsize|p1|2', '|teamsize|p2|2',
    '|gen|9', '|gametype|singles', '|tier|[Gen 9] OU',
    '|start',
    '|switch|p1a: Fast|Noivern, F|100/100',
    '|switch|p2a: Val|Iron Valiant|100/100',
    '|turn|1',
    ...body,
  ].join('\n');

  test('a KO before the victim ever acted proves the attacker was faster', () => {
    // The victim chose a move (a chosen switch would have resolved BEFORE
    // the attack and left a line) and died before executing it.
    const { speedOrders } = parseReplayLogWithObservations(koLog([
      '|move|p1a: Fast|Draco Meteor|p2a: Val',
      '|-damage|p2a: Val|0 fnt',
      '|faint|p2a: Val',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern',
      secondSide: 'p2', secondSpecies: 'Iron Valiant',
      turn: 1,
    }]);
  });

  test('a victim that already acted this turn yields no KO evidence', () => {
    // The victim's switch resolved first — its speed never raced the attack.
    const { speedOrders } = parseReplayLogWithObservations(koLog([
      '|switch|p2a: Val2|Garchomp, F|100/100',
      '|move|p1a: Fast|Draco Meteor|p2a: Val2',
      '|-damage|p2a: Val2|0 fnt',
      '|faint|p2a: Val2',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([]);
  });

  test('a priority KO proves nothing about speed', () => {
    const { speedOrders } = parseReplayLogWithObservations(koLog([
      '|move|p1a: Fast|Sucker Punch|p2a: Val',
      '|-damage|p2a: Val|0 fnt',
      '|faint|p2a: Val',
      '|turn|2',
    ]));
    expect(speedOrders).toEqual([]);
  });

  test('residual faints after the action boundary are not KO evidence', () => {
    const { speedOrders } = parseReplayLogWithObservations(koLog([
      '|move|p1a: Fast|Draco Meteor|p2a: Val',
      '|-damage|p2a: Val|5/100',
      '|move|p2a: Val|Moonblast|p1a: Fast',
      '|upkeep',
      '|-damage|p2a: Val|0 fnt|[from] item: Life Orb',
      '|faint|p2a: Val',
      '|turn|2',
    ]));
    // Both moved — the ordinary pair evidence stands; the residual faint
    // adds nothing (the victim acted).
    expect(speedOrders).toHaveLength(1);
    expect(speedOrders[0].turn).toBe(1);
  });

  test('a paradox booster is directional: it voids the fast, not the outrun', () => {
    // Booster on the VICTIM: the attacker outran a Quark-Drive-boosted
    // speed — outrunning the base speed follows a fortiori. Keep.
    const boostedVictim = parseReplayLogWithObservations(koLog([
      '|-activate|p2a: Val|ability: Quark Drive',
      '|-start|p2a: Val|quarkdrivespe',
      '|move|p1a: Fast|Draco Meteor|p2a: Val',
      '|-damage|p2a: Val|0 fnt',
      '|faint|p2a: Val',
      '|turn|2',
    ]));
    expect(boostedVictim.speedOrders).toEqual([{
      firstSide: 'p1', firstSpecies: 'Noivern',
      secondSide: 'p2', secondSpecies: 'Iron Valiant',
      turn: 1,
    }]);
    // Booster on the ATTACKER: the boosted speed explains the race. Drop.
    const boostedAttacker = parseReplayLogWithObservations(koLog([
      '|-activate|p1a: Fast|ability: Protosynthesis',
      '|-start|p1a: Fast|protosynthesisspe',
      '|move|p1a: Fast|Draco Meteor|p2a: Val',
      '|-damage|p2a: Val|0 fnt',
      '|faint|p2a: Val',
      '|turn|2',
    ]));
    expect(boostedAttacker.speedOrders).toEqual([]);
  });
});

describe('hidden-power evidence', () => {
  const base = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|gametype|singles',
    '|poke|p1|Manectric|', '|poke|p2|Skarmory|',
    '|start',
    '|switch|p1a: Manectric|Manectric|100/100',
    '|switch|p2a: Skarmory|Skarmory|100/100',
    '|turn|1',
  ];
  test('markers map to evidence; typed HP emits nothing', () => {
    const { hpEvidence } = parseReplayLogWithObservations([
      ...base,
      '|move|p1a: Manectric|Hidden Power|p2a: Skarmory',
      '|-supereffective|p2a: Skarmory',
      '|-damage|p2a: Skarmory|60/100',
      '|turn|2',
      '|move|p1a: Manectric|Hidden Power|p2a: Skarmory',
      '|-damage|p2a: Skarmory|40/100',
      '|turn|3',
      '|move|p1a: Manectric|Hidden Power Ice|p2a: Skarmory',
      '|-damage|p2a: Skarmory|20/100',
      '|turn|4',
    ].join('\n'));
    expect(hpEvidence).toEqual([
      { attackerSide: 'p1', attackerSpecies: 'Manectric', defenderSpecies: 'Skarmory', marker: 'super' },
      { attackerSide: 'p1', attackerSpecies: 'Manectric', defenderSpecies: 'Skarmory', marker: 'neutral' },
    ]);
  });
  test('immunity emits before the context resets', () => {
    const { hpEvidence } = parseReplayLogWithObservations([
      ...base,
      '|move|p1a: Manectric|Hidden Power|p2a: Skarmory',
      '|-immune|p2a: Skarmory',
      '|turn|2',
    ].join('\n'));
    expect(hpEvidence).toEqual([
      { attackerSide: 'p1', attackerSpecies: 'Manectric', defenderSpecies: 'Skarmory', marker: 'immune' },
    ]);
  });
  test('resisted marks; a miss emits nothing', () => {
    const { hpEvidence } = parseReplayLogWithObservations([
      ...base,
      '|move|p1a: Manectric|Hidden Power|p2a: Skarmory',
      '|-resisted|p2a: Skarmory',
      '|-damage|p2a: Skarmory|85/100',
      '|turn|2',
      '|move|p1a: Manectric|Hidden Power|p2a: Skarmory',
      '|-miss|p1a: Manectric|p2a: Skarmory',
      '|turn|3',
    ].join('\n'));
    expect(hpEvidence.map(entry => entry.marker)).toEqual(['resisted']);
  });
});
