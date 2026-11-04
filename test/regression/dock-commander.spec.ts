import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle, searchPosition, serializeLiveBattle, type BranchSimState } from '@fulllifegames/eval-engine';
import { pickFill } from '../../src/lib/dock-fill';
import { panelFlags } from '../../src/lib/dock-panel';
import { EMPTY_SIDE_DAMAGE } from '../../src/lib/branch-damage';
import { buildDockModel } from '../../src/components/dock/dock-model';
import type { Gimmick } from '../../src/hooks/useSideControlsState';

/**
 * Round 85 (T320): the dock at a position where a Tatsugiri commands its Dondozo. The scene: Scarlet/Violet VGC 2556366252 turn 3,
 * Tatsugiri-Curly inside the opposing Dondozo; the dock filled P1, left both P2 chips at "choose", and Execute waited for a pick
 * in the commanding slot. Played here on the real simulator and the real search: the engine's best line fills the Dondozo's
 * chip, the Tatsugiri's chip takes no input and says why, and Execute is ready with the Dondozo's pick alone. The rule itself is
 * swept against the simulator in `packages/eval-engine/test/commander-slots.spec.ts`.
 */
const EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Hardy', evs: EVS, ivs: IVS, level: 50,
});
const COMMANDER = mon('Tatsugiri', 'Commander', ['Draco Meteor', 'Muddy Water', 'Icy Wind', 'Protect']);
const DONDOZO = mon('Dondozo', 'Unaware', ['Wave Crash', 'Earthquake', 'Order Up', 'Protect']);
const FOES = [mon('Pikachu', 'Static', ['Thunderbolt', 'Protect']), mon('Snorlax', 'Immunity', ['Body Slam', 'Protect'])];

function commanderBattle(format: string, commanderFirst: boolean): Battle {
  const own = [...(commanderFirst ? [COMMANDER, DONDOZO] : [DONDOZO, COMMANDER]), ...FOES];
  const battle = new Battle({
    formatid: toID(format) as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(FOES) }, p2: { name: 'Beta', team: Teams.pack(own) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'team 12');
    battle.choose('p2', 'team 1234');
  }
  return battle;
}

const NO_GIMMICK = (() => ({})) as unknown as (side: 'p1' | 'p2', slot: number) => Gimmick;

describe.each([
  { name: 'Tatsugiri in slot a', commanderFirst: true },
  { name: 'Tatsugiri in slot b', commanderFirst: false },
])('the dock where a Tatsugiri commands: $name', ({ commanderFirst }) => {
  const battle = commanderBattle('gen9doublescustomgame', commanderFirst);
  const tatsugiri = commanderFirst ? 0 : 1;
  const dondozo = 1 - tatsugiri;

  test('the scene: P2\'s Tatsugiri commands its Dondozo', () => {
    expect(battle.sides[1].active[tatsugiri].volatiles['commanding']).toBeDefined();
  });

  test('the engine fills the Dondozo\'s chip, the Tatsugiri\'s chip takes no input, and Execute is ready', () => {
    const state: BranchSimState = createBranchStateFromBattle(battle as never, [], {});
    const result = searchPosition(serializeLiveBattle(battle as never), { depth: 1, samples: 1, tera: false });
    const filled = pickFill('p2', result.perSide.p2, state, [null, null]);
    expect(filled[dondozo], 'the Dondozo\'s chip holds the engine\'s pick').toMatchObject({ kind: 'move' });
    expect(filled[tatsugiri], 'the Tatsugiri\'s chip stays empty').toBeNull();

    const p1Filled = pickFill('p1', result.perSide.p1, state, [null, null]);
    const withFill: BranchSimState = { ...state, p1Choices: p1Filled, p2Choices: filled };
    const flags = panelFlags(withFill, withFill.p1ActiveSlots, withFill.p2ActiveSlots);
    expect(flags.p2RequiredChoices[tatsugiri], 'the Tatsugiri\'s slot is not asked').toBe(false);
    expect(flags.bothChosen, 'Execute is ready').toBe(true);

    const model = buildDockModel({
      simState: withFill,
      slots: {
        p1ActiveSlots: withFill.p1ActiveSlots, p2ActiveSlots: withFill.p2ActiveSlots,
        p1MovesBySlot: withFill.p1MovesBySlot, p2MovesBySlot: withFill.p2MovesBySlot,
        p1SwitchesBySlot: withFill.p1SwitchesBySlot, p2SwitchesBySlot: withFill.p2SwitchesBySlot,
      },
      damageBySide: { p1: EMPTY_SIDE_DAMAGE, p2: EMPTY_SIDE_DAMAGE },
      gimmickFor: NO_GIMMICK,
    });
    const chip = model.p2[tatsugiri];
    expect(chip.waits, 'the chip takes no input').toBe(true);
    expect(chip.placeholder).toBe('commanding · no choice');
    expect(chip.wait, 'no engine shimmer on a slot the engine never fills').toBeNull();
    expect(model.p2[dondozo].waits).toBe(false);
  });
});
