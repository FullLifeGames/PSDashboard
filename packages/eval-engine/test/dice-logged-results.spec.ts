import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { toId } from '@fulllifegames/replay-core';
import { extractProtocolEvents } from '../src/hax-alignment';
import { parseTurnBlocks } from '../src/branch/protocol-choices';
import { loggedActions, loggedDice, mergeLoggedDice } from '../src/dice/logged-results';
import { dieKey, type ForcedDie } from '../src/dice/types';

/**
 * Round 82 (forced dice), step A5, gate answer 19a: what the log rolled, read per action as forced dice. The reader is free of
 * simulator imports (it sits in the main bundle beside `hax-alignment.ts`), so this file holds it to the lines the simulator
 * and the replays write, and to the reader of the protocol's dice witnesses on every turn of the fixtures.
 */

const show = (dice: readonly ForcedDie[]): string[] => dice.map(die => `${dieKey(die.name)} ${JSON.stringify(die.result)}`);
const lines = (text: string): string[] => text.trim().split('\n');

// GPL DzBQ5azlO5l turn 13: Air Slash, then Heavy Slam; the log shows no flinch and no crit.
const GPL13 = lines(`
|move|p1a: Steve|Air Slash|p2a: King Bradley
|-damage|p2a: King Bradley|36/100
|move|p2a: King Bradley|Heavy Slam|p1a: Steve
|-damage|p1a: Steve|55/161
`);

// smogtours-gen8ou-573756 turn 73: the 95 percent Fire Fang misses.
const FIRE_FANG = lines(`
|move|p2a: Penal Battalion|Fire Fang|p1a: Corviknight|[miss]
|-miss|p2a: Penal Battalion|p1a: Corviknight
|move|p1a: Corviknight|Body Press|p2a: Penal Battalion
|-damage|p2a: Penal Battalion|0 fnt
|-damage|p1a: Corviknight|10/399|[from] ability: Rough Skin|[of] p2a: Penal Battalion
|faint|p2a: Penal Battalion
`);

// Doubles OU 912045 turn 5: Heat Wave misses the first foe and hits the second.
const HEAT_WAVE = lines(`
|move|p2a: Chi-Yu|Heat Wave|p1a: Incineroar|[spread] p1b
|-miss|p2a: Chi-Yu|p1a: Incineroar
|-damage|p1b: Volcarona|41/100
`);

// Doubles OU 2663093831 turn 8: Scale Shot hits four times, Matcha Gotcha burns the second foe.
const SCALE_SHOT = lines(`
|move|p1b: Dragonite|Scale Shot|p2a: kanye
|-damage|p2a: kanye|281/394
|-damage|p2a: kanye|247/394
|-damage|p2a: kanye|211/394
|-damage|p2a: kanye|172/394
|-hitcount|p2a: kanye|4
|-unboost|p1b: Dragonite|def|1
|-boost|p1b: Dragonite|spe|1
|move|p1a: Sinistcha|Matcha Gotcha|p2a: kanye|[spread] p2a,p2b
|-resisted|p2a: kanye
|-resisted|p2b: tea pot
|-damage|p2a: kanye|99/394
|-heal|p1a: Sinistcha|278/346 psn|[from] drain|[of] p2a: kanye
|-damage|p2b: tea pot|312/346
|-heal|p1a: Sinistcha|295/346 psn|[from] drain|[of] p2b: tea pot
|-status|p2b: tea pot|brn
`);

describe('the dice a log shows, action by action', () => {
  test('a turn of two plain hits: both land, none crits, and a flinch the second mover disproves is forced off when the move can flinch', () => {
    expect(show(loggedDice(GPL13))).toEqual([
      'p1a:airslash:p2a:accuracy {"happens":true}', 'p1a:airslash:p2a:crit {"happens":false}',
      'p2a:heavyslam:p1a:accuracy {"happens":true}', 'p2a:heavyslam:p1a:crit {"happens":false}',
      'p1a::p2a:speed-tie {"first":"p1a"}',
    ]);
    const withFlinch = loggedDice(GPL13, { secondariesOf: move => (move === 'airslash' ? ['flinch'] : []) });
    expect(show(withFlinch)).toContain('p1a:airslash:p2a:secondary:flinch {"happens":false}');
  });

  test('a miss shows no crit and no secondary of its move; the move after it reads on', () => {
    expect(show(loggedDice(FIRE_FANG, { secondariesOf: move => (move === 'firefang' ? ['brn', 'flinch'] : []) }))).toEqual([
      'p2a:firefang:p1a:accuracy {"happens":false}',
      'p1a:bodypress:p2a:accuracy {"happens":true}', 'p1a:bodypress:p2a:crit {"happens":false}',
      'p1a::p2a:speed-tie {"first":"p2a"}',
    ]);
  });

  test('a spread move reads each target on its own', () => {
    expect(show(loggedDice(HEAT_WAVE))).toEqual([
      'p2a:heatwave:p1a:accuracy {"happens":false}',
      'p2a:heatwave:p1b:accuracy {"happens":true}', 'p2a:heatwave:p1b:crit {"happens":false}',
    ]);
  });

  test('a crit and a status line read as a crit and a secondary', () => {
    const turn = lines(`
|move|p1a: A|Fire Blast|p2a: B
|-crit|p2a: B
|-damage|p2a: B|50/100
|-status|p2a: B|brn
`);
    expect(show(loggedDice(turn))).toEqual([
      'p1a:fireblast:p2a:accuracy {"happens":true}', 'p1a:fireblast:p2a:crit {"happens":true}', 'p1a:fireblast:p2a:secondary:brn {"happens":true}',
    ]);
  });

  test('a secondary the move could have fired and did not shows as a no, in the order of the move\'s entries', () => {
    const turn = lines(`
|move|p1a: A|Fire Blast|p2a: B
|-damage|p2a: B|50/100
`);
    expect(show(loggedDice(turn, { secondariesOf: () => ['brn'] }))).toContain('p1a:fireblast:p2a:secondary:brn {"happens":false}');
  });

  test('a hit count, and the crit of a multi-hit move only when every hit agrees', () => {
    const dice = show(loggedDice(SCALE_SHOT));
    expect(dice).toContain('p1b:scaleshot::hit-count {"hits":4}');
    expect(dice).toContain('p1b:scaleshot:p2a:crit {"happens":false}');
    const mixed = lines(`
|move|p1a: A|Fury Attack|p2a: B
|-damage|p2a: B|90/100
|-crit|p2a: B
|-damage|p2a: B|70/100
|-hitcount|p2a: B|2
`);
    expect(show(loggedDice(mixed)).filter(entry => entry.includes(':crit '))).toEqual([]);
  });

  test('a burn on the second target of a spread move is that target\'s secondary, and a drain is no secondary', () => {
    const dice = show(loggedDice(SCALE_SHOT));
    expect(dice).toContain('p1a:matchagotcha:p2b:secondary:brn {"happens":true}');
    expect(dice.filter(entry => entry.startsWith('p1a:matchagotcha:p2a:secondary'))).toEqual([]);
  });

  test('a move that boosts its user reads as a self effect and the stats it moved', () => {
    const dice = show(loggedDice(SCALE_SHOT));
    expect(dice).toContain('p1b:scaleshot:p2a:secondary:self:def+spe {"happens":true}');
    expect(dice).toContain('p1b:scaleshot::self-effect {"happens":true}');
    const selfOnly = lines(`
|move|p1a: A|Swords Dance|p1a: A
|-boost|p1a: A|atk|2
`);
    expect(loggedDice(selfOnly)).toEqual([]);
  });

  test('a flinch is the secondary of the move before it', () => {
    const turn = lines(`
|move|p1a: A|Air Slash|p2a: B
|-damage|p2a: B|50/100
|cant|p2a: B|flinch
`);
    expect(show(loggedDice(turn))).toContain('p1a:airslash:p2a:secondary:flinch {"happens":true}');
    // a move that missed flinches nobody
    const missed = lines(`
|move|p1a: A|Air Slash|p2a: B|[miss]
|-miss|p1a: A|p2a: B
|cant|p2a: B|flinch
`);
    expect(show(loggedDice(missed)).filter(entry => entry.includes('flinch'))).toEqual([]);
  });

  test('a full paralysis names the move the body clicked; without the click there is no name to give', () => {
    const turn = lines(`
|cant|p1a: A|par
|move|p2a: B|Tackle|p1a: A
|-damage|p1a: A|90/100
`);
    expect(show(loggedDice(turn, { clicked: new Map([['p1a', 'tackle']]) }))).toContain('p1a:tackle::status-check:par {"happens":false}');
    expect(show(loggedDice(turn)).filter(entry => entry.includes('status-check'))).toEqual([]);
  });

  test('a check the body passed shows as a yes when the caller names the checks it stood under', () => {
    const turn = lines(`
|move|p1a: A|Tackle|p2a: B
|-damage|p2a: B|90/100
`);
    expect(show(loggedDice(turn, { checks: new Map([['p1a', ['par']]]) }))).toContain('p1a:tackle::status-check:par {"happens":true}');
    // a body that never acted passed nothing
    expect(show(loggedDice(turn, { checks: new Map([['p2a', ['par']]]) })).filter(entry => entry.includes('status-check'))).toEqual([]);
  });

  test('a confusion that hit its holder is a no; one that let the holder through is a yes', () => {
    const hit = lines(`
|-activate|p1a: A|confusion
|-damage|p1a: A|80/100|[from] confusion
|move|p2a: B|Tackle|p1a: A
|-damage|p1a: A|70/100
`);
    const through = lines(`
|-activate|p1a: A|confusion
|move|p1a: A|Tackle|p2a: B
|-damage|p2a: B|70/100
`);
    const options = { clicked: new Map([['p1a', 'tackle']]), checks: new Map([['p1a', ['confusion']]]) };
    expect(show(loggedDice(hit, options)).filter(entry => entry.includes('status-check'))).toEqual(['p1a:tackle::status-check:confusion {"happens":false}']);
    expect(show(loggedDice(through, options)).filter(entry => entry.includes('status-check'))).toEqual(['p1a:tackle::status-check:confusion {"happens":true}']);
  });

  test('the order of the moves is a die for every two bodies; a copy of a move and a repeat by one body are none', () => {
    const turn = lines(`
|move|p1a: A|Tackle|p2a: C
|move|p2b: D|Tackle|p1b: B
|move|p2a: C|Swords Dance|p2a: C|[from] ability: Dancer
|move|p1b: B|Tackle|p2b: D
`);
    const ties = show(loggedDice(turn)).filter(entry => entry.includes('speed-tie'));
    expect(ties).toEqual([
      'p1a::p2b:speed-tie {"first":"p1a"}', 'p1a::p1b:speed-tie {"first":"p1a"}', 'p1b::p2b:speed-tie {"first":"p2b"}',
    ]);
  });

  test('the split lines of a simulator log read as the public lines do', () => {
    const turn = lines(`
|move|p1a: A|Tackle|p2a: B
|split|p2
|-damage|p2a: B|44/251
|-damage|p2a: B|18/100
`);
    expect(show(loggedDice(turn))).toEqual(show(loggedDice(['|move|p1a: A|Tackle|p2a: B', '|-damage|p2a: B|18/100'])));
  });
});

describe('the logged dice join the forced dice of a turn (19a)', () => {
  const logged = loggedDice(FIRE_FANG);
  const accuracyOf = (slot: string, moveId: string, targetSlot: string, happens: boolean): ForcedDie =>
    ({ name: { slot, moveId, targetSlot, kind: 'accuracy' }, result: { happens } });

  test('a turn with no forced die stays a turn with none', () => {
    expect(mergeLoggedDice({ logged, forced: [], changed: new Set() })).toEqual([]);
  });

  test('the user\'s die wins where both name the same die, and the other logged results follow', () => {
    const forced = [accuracyOf('p2a', 'firefang', 'p1a', true)];
    const merged = mergeLoggedDice({ logged, forced, changed: new Set() });
    expect(show(merged)).toEqual([
      'p2a:firefang:p1a:accuracy {"happens":true}',
      'p1a:bodypress:p2a:accuracy {"happens":true}', 'p1a:bodypress:p2a:crit {"happens":false}',
      'p1a::p2a:speed-tie {"first":"p2a"}',
    ]);
  });

  test('an action the user changed loses its logged dice, and the order it was part of; the body it switched out loses the dice aimed at it', () => {
    const forced = [accuracyOf('p1a', 'tackle', 'p2a', false)];
    expect(show(mergeLoggedDice({ logged, forced, changed: new Set(['p1a']) })).filter(entry => entry.startsWith('p1a:bodypress'))).toEqual([]);
    const switched = mergeLoggedDice({ logged, forced, changed: new Set(['p1a']), switched: new Set(['p1a']) });
    expect(show(switched).filter(entry => entry.includes('firefang'))).toEqual([]);
    const moved = mergeLoggedDice({ logged, forced, changed: new Set(['p1a']) });
    expect(show(moved).filter(entry => entry.includes('firefang'))).toEqual(['p2a:firefang:p1a:accuracy {"happens":false}']);
    expect(show(moved).filter(entry => entry.includes('speed-tie'))).toEqual([]);
  });
});

// The two readers of the protocol's dice witnesses hold each other: the same counts on every turn of the fixtures.
const normalize = (raw: string): string => {
  const match = raw.match(/^(p[12])[a-d]?:\s*(.*)$/);
  return match ? `${match[1]}:${toId(match[2])}` : toId(raw);
};
const bump = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const sorted = (map: Map<string, number>): [string, number][] => [...map].sort(([a], [b]) => a.localeCompare(b));

const FIXTURES = [
  'gpl-replay', 'smogtours-gen6ou-649664', 'smogtours-gen6ou-653785', 'smogtours-gen6ou-655336', 'smogtours-gen7ou-450650',
  'smogtours-gen9doublesou-912884', 'smogtours-gen9doublesou-938276', 'smogtours-gen9doublesou-938640', 'gen9vgc2026regi-2630181744',
  'smogtours-gen9ou-749828', 'smogtours-gen9ou-752733', 'gen9doublesou-2694811367', 'gen3customgame-2115579570',
  'gen9championsvgc2026regmbbo3-2634204248', 'gen9championsou-2691703002',
];
const FEEDBACK = ['smogtours-gen8ou-573756', 'gen9doublesou-2663093831', 'gen9vgc2026regi-2630685175', 'smogtours-gen9doublesou-912045'];

describe.each([
  ...FIXTURES.map(name => ({ name, url: new URL(`./fixtures/${name}.json`, import.meta.url) })),
  ...FEEDBACK.map(name => ({ name, url: new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url) })),
])('the reader of the log and the reader of the alignment witnesses agree: $name', ({ url }) => {
  const { log } = JSON.parse(readFileSync(url, 'utf-8')) as { log: string };
  const turns = parseTurnBlocks(log).turns;

  test('misses, crits, hit counts, cants and confusion self-hits match on every turn', () => {
    expect(turns.length).toBeGreaterThan(0);
    for (const block of turns) {
      const turnLines = [...block.preUpkeep, ...block.postUpkeep];
      const expected = extractProtocolEvents(turnLines);
      const misses = new Map<string, number>();
      const crits = new Map<string, number>();
      const hitCounts = new Map<string, number>();
      const cants = new Map<string, number>();
      const selfHits = new Map<string, number>();
      for (const action of loggedActions(turnLines)) {
        const ident = normalize(action.ident);
        if (action.misses > 0) bump(misses, `${ident}:${action.moveId}`, action.misses);
        for (const [slot, count] of Object.entries(action.crits)) bump(crits, normalize(action.idents[slot]), count);
        for (const [slot, count] of Object.entries(action.hitCounts)) bump(hitCounts, `${normalize(action.idents[slot])}:${count}`);
        if (action.type === 'cant' && action.reason) bump(cants, `${ident}:${action.reason}`);
        for (const [slot, count] of Object.entries(action.selfHits)) bump(selfHits, normalize(action.idents[slot]), count);
      }
      const context = `turn ${block.turn}`;
      expect([context, sorted(misses)]).toEqual([context, sorted(expected.misses)]);
      expect([context, sorted(crits)]).toEqual([context, sorted(expected.crits)]);
      expect([context, sorted(hitCounts)]).toEqual([context, sorted(expected.hitCounts)]);
      expect([context, sorted(cants)]).toEqual([context, sorted(expected.cants)]);
      expect([context, sorted(selfHits)]).toEqual([context, sorted(expected.confusionSelfHits)]);
    }
  });
});
