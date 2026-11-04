import { describe, expect, test } from 'vitest';
import { toId } from '@fulllifegames/replay-core';
import type { Battle, PokemonSet, Species } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { legalChoices } from '../src/forward/choices';
import { createRootPosition } from '../src/forward/position';
import { serializeBattleStable } from '../src/forward/serialize';
import { evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSlotChoice } from '../src/branch-choices';
import { resolveSideChoices } from '../src/branch/execute';
import { createBranchStateFromBattle } from '../src/branch/state';
import type { SimBattle } from '../src/branch/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 85 (T320): a Tatsugiri that commands a Dondozo passes its slot (side.js getChoiceIndex skips fainted and commanding
 * actives), and the simulator's request marks the body (`side.pokemon[i].commanding`, pokemon.js getSwitchRequestData). The branch layer
 * counted every living active as a slot that must choose, so the dock waited for a pick in the commanding slot, mapped no engine
 * line onto the side (one part for two slots), and a pick there went to the Dondozo and made the simulator refuse the side's
 * choice. The scene: Scarlet/Violet VGC 2556366252 turn 3, Tatsugiri-Curly inside the opposing Dondozo.
 *
 * Held against the simulator for every species the battle's Dex gives Commander, in both rule sets, with Commander on either
 * side or both and the Tatsugiri in slot a and in slot b: the required slots equal the slots the request asks, the engine's best
 * line maps onto them, and the command built from one pick per required slot is accepted with each move on its own body.
 */

await loadSimMods('gen9championsou');

const RULES = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', level: 100 },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50 },
];
const SIDES = ['p1', 'p2'] as const;
const COMMANDERS: { label: string; commanders: ('p1' | 'p2')[] }[] = [
  { label: 'p1', commanders: ['p1'] },
  { label: 'p2', commanders: ['p2'] },
  { label: 'both sides', commanders: ['p1', 'p2'] },
];
const SLOTS = [{ label: 'a', commanderFirst: true }, { label: 'b', commanderFirst: false }];

/** The species of the battle's own Dex that can have Commander and take the field as they are (no forme that needs an item or a battle). */
function commanderSpecies(format: string): Species[] {
  const pair = [set('Pikachu', ['Splash']), set('Snorlax', ['Splash'])];
  const probe = battleOf(format, pair, pair);
  return probe.dex.species.all().filter(species =>
    species.exists && Object.values(species.abilities).includes('Commander') && !species.battleOnly && !species.requiredItem);
}

const sideIndex = (side: 'p1' | 'p2') => (side === 'p1' ? 0 : 1);

/** What the simulator's request asks of each active slot: true where the slot chooses (not fainted, not commanding). */
function askedSlots(battle: Battle, side: 'p1' | 'p2'): boolean[] {
  // The request lists the side's bodies in party order, the actives first (side.js getRequestData).
  const request = battle.sides[sideIndex(side)].activeRequest as { side?: { pokemon?: { commanding?: boolean }[] } } | null;
  return battle.sides[sideIndex(side)].active.map((pokemon, slot) => !!pokemon && !pokemon.fainted && !request?.side?.pokemon?.[slot]?.commanding);
}

describe.each(RULES)('$name: the branch layer asks only the slots the simulator asks (round 85, T320)', rules => {
  const species = commanderSpecies(rules.format);

  test('the Dex gives at least one species Commander', () => {
    expect(species.length).toBeGreaterThan(0);
  });

  describe.each(species.map(entry => ({ name: entry.name })))('$name', ({ name }) => {
    const mon = (id: string, ability: string, moves: string[]): PokemonSet => set(id, moves, { ability, level: rules.level });
    const commander = mon(name, 'Commander', ['Draco Meteor', 'Muddy Water', 'Icy Wind', 'Protect']);
    const dondozo = mon('Dondozo', 'Unaware', ['Wave Crash', 'Earthquake', 'Order Up', 'Protect']);
    const fillers = [mon('Pikachu', 'Static', ['Thunderbolt', 'Protect']), mon('Snorlax', 'Immunity', ['Body Slam', 'Protect'])];
    const plain = [fillers[0], fillers[1], mon('Rillaboom', 'Grassy Surge', ['Grassy Glide', 'Protect']), mon('Incineroar', 'Intimidate', ['Fake Out', 'Protect'])];
    const team = (commanderFirst: boolean, commands: boolean): PokemonSet[] =>
      commands ? [...(commanderFirst ? [commander, dondozo] : [dondozo, commander]), ...fillers] : plain;
    const board = (commanders: ('p1' | 'p2')[], commanderFirst: boolean): Battle =>
      battleOf(rules.format, team(commanderFirst, commanders.includes('p1')), team(commanderFirst, commanders.includes('p2')));

    describe.each(COMMANDERS)('Commander on $label', ({ commanders }) => {
      test.each(SLOTS)('in slot $label: required slots, the engine line and the command agree with the simulator', ({ commanderFirst }) => {
        for (const side of SIDES) {
          const battle = board(commanders, commanderFirst);
          const asked = askedSlots(battle, side);
          expect(asked.filter(Boolean).length, 'the scene: a commanding side chooses for one slot').toBe(commanders.includes(side) ? 1 : 2);

          const state = createBranchStateFromBattle(battle as unknown as SimBattle, [], {});
          const actives = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
          const forced = side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches;
          const movesBySlot = side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot;
          const switchesBySlot = side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot;
          const required = requiredChoicesForActiveSlots(actives, forced);
          expect(required, `${side}: the slots that must choose`).toEqual(asked);

          // The engine's best line (one part per slot the simulator asks) maps onto the asked slots.
          const best = legalChoices(createRootPosition(serializeBattleStable(battle)), side)[0];
          const mapped = evalChoiceToSlotChoices(best.choice, movesBySlot, switchesBySlot, best.label, required);
          expect(mapped, `${side}: the engine line "${best.choice}" maps onto the slots`).not.toBeNull();
          asked.forEach((asks, slot) => expect(!!mapped?.[slot], `${side} slot ${slot} holds a part of the line`).toBe(asks));

          // One pick per required slot (its first move, at its first target) builds a command the simulator accepts.
          const picks = required.map((needs, slot): BranchSlotChoice | null => {
            const move = movesBySlot[slot]?.[0];
            if (!needs || !move) return null;
            return { kind: 'move', moveId: toId(move.name), moveName: move.name, targetLoc: move.targetOptions[0]?.targetLoc };
          });
          const resolved = resolveSideChoices(battle as unknown as SimBattle, side, picks, required);
          expect(resolved.ok, `${side}: ${resolved.ok ? '' : resolved.error}`).toBe(true);
          if (!resolved.ok) continue;
          const own = battle.sides[sideIndex(side)];
          expect(battle.choose(side, resolved.command), `${side}: "${resolved.command}" ${own.choice.error}`).toBe(true);
          // Each move lands on the body whose slot picked it.
          const movers = own.choice.actions.filter(action => action.choice === 'move').map(action => action.pokemon?.position);
          expect(movers).toEqual(required.flatMap((needs, slot) => (needs ? [slot] : [])));
        }
      });
    });
  });
});
