import { test, expect } from '@playwright/test';
import { parsePlayedActions, parsePlayedActionsDoubles } from '../src/lib/eval/played';

test.describe('played-action parsing', () => {
  test('both sides move', () => {
    const played = parsePlayedActions([
      '|move|p1a: Kyurem|Draco Meteor|p2a: Cryogonal',
      '|-damage|p2a: Cryogonal|12/100',
      '|move|p2a: Cryogonal|Recover|p2a: Cryogonal',
      '|-heal|p2a: Cryogonal|62/100',
      '|upkeep',
      '|turn|5',
    ]);
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: false });
    expect(played.p2).toEqual({ kind: 'move', name: 'Recover', tera: false });
  });

  test('a chosen switch is the first action; the attack lands on the incomer', () => {
    const played = parsePlayedActions([
      '|switch|p2a: Dragapult|Dragapult, F|100/100',
      '|move|p1a: Kyurem|Draco Meteor|p2a: Dragapult',
      '|-supereffective|p2a: Dragapult',
      '|-damage|p2a: Dragapult|0 fnt',
      '|faint|p2a: Dragapult',
      '|switch|p2a: Cobalion|Cobalion|100/100',
      '|turn|6',
    ]);
    expect(played.p2).toEqual({ kind: 'switch', name: 'Dragapult', species: 'Dragapult' });
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: false });
  });

  test('a faint replacement is not a chosen action', () => {
    const played = parsePlayedActions([
      '|move|p1a: Kyurem|Draco Meteor|p2a: Cryogonal',
      '|-damage|p2a: Cryogonal|0 fnt',
      '|faint|p2a: Cryogonal',
      '|switch|p2a: Cobalion|Cobalion|100/100',
      '|turn|7',
    ]);
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: false });
    // Cryogonal died before acting — p2's chosen action never surfaced.
    expect(played.p2).toBeNull();
  });

  test('a pivot switch after U-turn is not a chosen switch', () => {
    const played = parsePlayedActions([
      '|move|p1a: Dragapult|U-turn|p2a: Snorlax',
      '|-damage|p2a: Snorlax|80/100',
      '|switch|p1a: Corviknight|Corviknight|100/100|[from] U-turn',
      '|move|p2a: Snorlax|Body Slam|p1a: Corviknight',
      '|turn|9',
    ]);
    expect(played.p1).toEqual({ kind: 'move', name: 'U-turn', tera: false });
    expect(played.p2).toEqual({ kind: 'move', name: 'Body Slam', tera: false });
  });

  test('terastallizing marks the move', () => {
    const played = parsePlayedActions([
      '|-terastallize|p1a: Kyurem|Dragon',
      '|move|p1a: Kyurem|Draco Meteor|p2a: Snorlax',
      '|move|p2a: Snorlax|Body Slam|p1a: Kyurem',
      '|turn|12',
    ]);
    expect(played.p1).toEqual({ kind: 'move', name: 'Draco Meteor', tera: true });
    expect(played.p2).toEqual({ kind: 'move', name: 'Body Slam', tera: false });
  });

  test('a fully prevented side (sleep, flinch) stays unknown; drags are ignored', () => {
    const played = parsePlayedActions([
      '|cant|p2a: Snorlax|slp',
      '|move|p1a: Skarmory|Whirlwind|p2a: Snorlax',
      '|drag|p2a: Chansey|Chansey, F|100/100',
      '|turn|15',
    ]);
    expect(played.p1).toEqual({ kind: 'move', name: 'Whirlwind', tera: false });
    expect(played.p2).toBeNull();
  });
});

test.describe('doubles played-action parsing', () => {
  test('per-slot actions with foe/ally target locations', () => {
    const played = parsePlayedActionsDoubles([
      '|move|p1a: Flutter Mane|Moonblast|p2b: Chien-Pao',
      '|-damage|p2b: Chien-Pao|10/100',
      '|move|p2a: Incineroar|Fake Out|p1a: Flutter Mane',
      '|move|p1b: Rillaboom|Fake Out|p2a: Incineroar',
      '|switch|p2b: Urshifu|Urshifu, M|100/100',
      '|turn|4',
    ]);
    expect(played.p1Slots?.[0]).toEqual({ kind: 'move', name: 'Moonblast', tera: false, targetLoc: 2 });
    expect(played.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 });
    expect(played.p2Slots?.[0]).toEqual({ kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 });
    // Chien-Pao took damage but never acted — the switch is its chosen action.
    expect(played.p2Slots?.[1]).toEqual({ kind: 'switch', name: 'Urshifu', species: 'Urshifu' });
  });

  test('tera marks the slot, faint/cant settle only that slot', () => {
    const played = parsePlayedActionsDoubles([
      '|-terastallize|p1b: Rillaboom|Grass',
      '|move|p2a: Incineroar|Fake Out|p1a: Flutter Mane',
      '|cant|p1a: Flutter Mane|flinch',
      '|move|p1b: Rillaboom|Wood Hammer|p2a: Incineroar',
      '|-damage|p2a: Incineroar|0 fnt',
      '|faint|p2a: Incineroar',
      '|switch|p2a: Amoonguss|Amoonguss, F|100/100',
      '|move|p2b: Urshifu|Protect|',
      '|turn|9',
    ]);
    expect(played.p1Slots?.[0]).toBeNull(); // flinched — choice never surfaced
    expect(played.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Wood Hammer', tera: true, targetLoc: 1 });
    expect(played.p2Slots?.[0]).toEqual({ kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 });
    expect(played.p2Slots?.[1]).toEqual({ kind: 'move', name: 'Protect', tera: false, targetLoc: null });
  });

  test('ally-targeted moves get negative locations', () => {
    const played = parsePlayedActionsDoubles([
      '|move|p1a: Clefairy|Follow Me|p1a: Clefairy',
      '|move|p1b: Kingambit|Sucker Punch|p2a: Urshifu',
      '|turn|3',
    ]);
    expect(played.p1Slots?.[0]).toEqual({ kind: 'move', name: 'Follow Me', tera: false, targetLoc: -1 });
    expect(played.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Sucker Punch', tera: false, targetLoc: 1 });
  });
});
