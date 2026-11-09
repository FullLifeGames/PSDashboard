import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { refreshRequestsFromLiveState } from '../src/branch/corrections';
import { getMainChoice } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, RULES_WITH_DOUBLES, standing, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#143): a move the simulator refuses turned the whole side to `default`. The simulator refuses a move the body lacks and a
 * move its request marks disabled (`side.js` chooseMove); the rebuild sent the move the log shows. VGC 2318522075 turn 7: Disable stops
 * Dragonite's Extreme Speed, and the log shows `-activate|p2b: Dragonite|move: Struggle`; the rebuild sends `move struggle`, the simulator
 * refuses, the side plays `default`, and the partner loses its action. The click now falls back to a stand-in of the request: the first
 * enabled move with the shown move's Dex category and the simulator's `actionPriority`, else the slowest request move. The target and the
 * partner's action stay. A Z-move or Max move that the request offers stays as the log shows it (the simulator maps it onto its base move).
 *
 * The sweep: every Dex condition with an `onDisableMove` handler is put on the body as a volatile (with its `move` in each of the four
 * moves' places), against every shown move. When the request disables the shown move, the choice is another enabled request move and the
 * simulator accepts it; when it does not, the choice is the shown move as before. The rows run in every rule set the corpus plays (Gens 1
 * to 9, Champions), singles and doubles (the partner's switch stays), and prove the live battle unchanged (`standing`).
 */
await loadSimMods('gen9championsou');

const MOVES = ['Tackle', 'Ember', 'Splash', 'Quick Attack'];

function board(rules: Rules, mode: Mode, items: { a?: string } = {}): Battle {
  const side = (first: string) => [
    mon(rules, { species: first, moves: MOVES, gender: 'M' }), mon(rules, { species: 'Chansey', moves: ['Splash'] }),
    mon(rules, { species: 'Pikachu', moves: ['Splash'] }), mon(rules, { species: 'Raichu', moves: ['Splash'] }),
  ];
  const p1 = side('Snorlax');
  if (items.a) p1[0].item = items.a;
  return battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, side('Dragonite').map(set => ({ ...set, name: set.species })));
}

/** The Dex conditions with an `onDisableMove` handler: the volatiles that can disable a move. */
function disablers(battle: Battle): string[] {
  const dex = battle.dex;
  const ids = new Set(Object.keys((dex.data as unknown as { Conditions: object }).Conditions));
  for (const move of dex.moves.all()) {
    if (move.volatileStatus) ids.add(move.volatileStatus);
    if ((move as unknown as { condition?: object }).condition) ids.add(move.id);
  }
  return [...ids].filter(id => 'onDisableMove' in (dex.conditions.get(id) as object));
}

const eventsOf = (mode: Mode, shown: string): string[] => [
  `|move|p1a: Snorlax|${shown}|p2a: Dragonite`,
  ...(mode === 'doubles' ? ['|switch|p1b: Raichu|Raichu, F|100/100'] : []),
];

/** The simulator takes the choice for p1 (the side's whole choice, as the rebuild sends it), and the choice is taken back. */
function accepted(battle: Battle, choice: string): boolean {
  const took = battle.choose('p1', choice);
  battle.undoChoice('p1');
  return took;
}

const requestOf = (battle: Battle) => battle.sides[0].active[0].getMoveRequestData();

describe('the rule on the simulator', () => {
  test('a move the request lacks falls back to an enabled request move of its kind, and the partner keeps its switch (doubles)', () => {
    for (const mode of ['singles', 'doubles'] as const) {
      const battle = board(RULES[8], mode);
      const body = battle.sides[0].active[0];
      body.moveSlots = body.moveSlots.filter(slot => slot.id !== 'ember');
      body.baseMoveSlots = body.moveSlots.slice();
      refreshRequestsFromLiveState(battle);
      const choice = getMainChoice(eventsOf(mode, 'Ember'), 'p1', battle);
      expect(accepted(battle, choice), `${mode}: ${choice}`).toBe(true);
      if (mode === 'doubles') expect(choice.split(', ')[1]).toBe('switch 4');
    }
  });

  test('a body whose every move is blocked sends the move the request offers (Struggle)', () => {
    for (const mode of ['singles', 'doubles'] as const) {
      const battle = board(RULES[8], mode);
      const body = battle.sides[0].active[0];
      for (const slot of body.moveSlots) slot.pp = 0;
      refreshRequestsFromLiveState(battle);
      expect(requestOf(battle).moves.map(move => move.id)).toEqual(['struggle']);
      const choice = getMainChoice(eventsOf(mode, 'Tackle'), 'p1', battle);
      expect(choice.split(', ')[0]).toMatch(/^move 1/);
      expect(accepted(battle, choice), `${mode}: ${choice}`).toBe(true);
    }
  });

  test.each([['singles'], ['doubles']] as const)('a Z-move the request offers stays as the log shows it (Gen 7 %s)', mode => {
    const battle = board(RULES[6], mode, { a: 'Normalium Z' });
    const choice = getMainChoice(eventsOf(mode, 'Breakneck Blitz'), 'p1', battle);
    expect(choice.split(', ')[0]).toMatch(/^move breakneckblitz/);
    expect(accepted(battle, choice), `${mode}: ${choice}`).toBe(true);
  });
});

interface Row { rules: Rules; mode: Mode }
const ROWS: Row[] = [
  ...RULES.map((rules): Row => ({ rules, mode: 'singles' })),
  ...RULES_WITH_DOUBLES.map((rules): Row => ({ rules, mode: 'doubles' })),
];

describe('the sweep: every disabling condition of the Dex', () => {
  test.each(ROWS.map(row => [`${row.rules.name} ${row.mode}`, row] as const))('%s', (_label, { rules, mode }) => {
    const battle = board(rules, mode);
    const body = battle.sides[0].active[0];
    const ids = disablers(battle);
    expect(ids.length).toBeGreaterThan(3);
    let stoodIn = 0;
    let kept = 0;
    for (const id of ids) {
      for (const owner of MOVES) {
        for (const shown of MOVES) {
          body.volatiles = {};
          body.volatiles[id] = battle.initEffectState({ id, target: body, move: owner.toLowerCase().replace(/ /g, ''), duration: 3 });
          // The simulator's disable pass of a request: the handlers set the moves' flags, and the request reads them.
          refreshRequestsFromLiveState(battle);
          const request = requestOf(battle);
          const entry = request.moves.find(move => move.move === shown);
          const events = eventsOf(mode, shown);
          const before = standing(battle);
          const choice = getMainChoice(events, 'p1', battle);
          expect(standing(battle), `${id} ${owner} ${shown}: the live battle is unchanged`).toBe(before);
          const label = `${id} (move ${owner}) shown ${shown}: ${choice}`;
          const slotChoice = choice.split(', ')[0];
          const index = Number(slotChoice.match(/^move (\d+)/)?.[1]);
          expect(accepted(battle, choice), label).toBe(true);
          const chosen = request.moves[index - 1];
          expect(chosen && !chosen.disabled, `${label}: an enabled request move`).toBe(true);
          if (mode === 'doubles') expect(choice.split(', ')[1], label).toBe('switch 4');
          if (entry && !entry.disabled) {
            expect(chosen.move, `${label}: an enabled shown move stays`).toBe(shown);
            kept++;
          } else {
            expect(chosen.move, label).not.toBe(shown);
            stoodIn++;
          }
        }
      }
    }
    body.volatiles = {};
    expect(stoodIn, 'some condition disables a shown move').toBeGreaterThan(0);
    expect(kept, 'some condition leaves a shown move enabled').toBeGreaterThan(0);
  });
});
