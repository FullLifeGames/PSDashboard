import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { singleMoveFraction } from '../src/score/threat';
import { combinedOptionHints, shieldsSide, sideProtectorStops } from '../src/search/hints';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * Round 70: a side protector in a doubles option. Wide Guard, Quick Guard, Crafty Shield and Mat Block stop a class of hits on
 * the user's whole side, so they carry a side condition instead of a volatile and no `stallingMove` flag, and the Protect
 * reading of the hints (T42: a self-targeted stalling move) never saw them: every one of them was the 0.25 support floor,
 * 16th to 42nd of the 42 legal combos of VGC 2630685175 turn 7, where Wide Guard turned Tera Starstorm away. The reading
 * comes from the Dex (an allySide move whose side condition has an onTryHit); which hits the condition stops comes from the
 * simulator's own handler, held here against real turns. The hint earns the damage the protector denies, up to the flinch-sized
 * ceiling of T42's pair term. Both rule sets run it, Scarlet/Violet and Pokémon Champions (the Champions mod has its own Dex).
 * Singles keep their path (every base move survives the singles cap).
 */

await loadSimMods('gen9championsou');

interface Rules {
  name: string;
  format: string;
  level: number;
  /** Champions reads the sets' evs as Stat Points. */
  evs?: PokemonSet['evs'];
  /** The side moves whose condition has a hit handler in this rule set's Dex. */
  claimed: string[];
}

const RULES: Rules[] = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', level: 100, claimed: ['craftyshield', 'matblock', 'quickguard', 'wideguard'] },
  {
    name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50,
    evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 }, claimed: ['craftyshield', 'matblock', 'quickguard', 'wideguard'],
  },
];

const SUPPORT_FLOOR = 0.25;
/** The flinch-sized ceiling of a protector's tempo (hints.ts FLINCH_BONUS, the T42 pair term). */
const CEILING = 0.3;
const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const option = (choice: string) => ({ choice, label: choice });
const hintOf = (battle: Battle, side: 'p1' | 'p2', choice: string) => combinedOptionHints(rootOf(battle), side, [option(choice)])[0];
/** The tempo a protector part earns over the idle pair: the hint of `<protector>, splash` minus the two support floors. */
const tempoOf = (battle: Battle, side: 'p1' | 'p2', choice: string) => hintOf(battle, side, choice) - 2 * SUPPORT_FLOOR;
/** A move a battle can use: real, not a Max or Z move, not from a later game. */
const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown }) => move.exists && move.gen <= 9 && !move.isMax && !move.isZ;
const aimedAt = (battle: Battle, moveId: string) => (['normal', 'any', 'adjacentFoe'].includes(battle.dex.moves.get(moveId).target) ? ' 1' : '');

describe.each(RULES)('$name: side protectors in the hints (round 70)', rules => {
  const mon = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) =>
    set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...extra });
  const splash = (species: string, extra: Partial<PokemonSet> = {}) => mon(species, ['splash'], extra);
  const battleWith = (p1: PokemonSet[], p2: PokemonSet[]) => battleOf(rules.format, p1, p2);

  /** A slow foe uses `moveId` on a Blissey that opened with `protector`. */
  const slowFoeBoard = (protector: string, moveId: string) =>
    battleWith([mon('Blissey', [protector, 'splash']), splash('Blissey')], [mon('Shuckle', [moveId, 'splash']), splash('Shuckle')]);
  /** The simulator's own answer (the log's "move: <name>" activation). */
  function stoppedInSim(protector: string, moveId: string): boolean {
    const battle = slowFoeBoard(protector, moveId);
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', `move 1${aimedAt(battle, moveId)}, move 1`);
    const name = battle.dex.moves.get(protector).name;
    return battle.log.some(line => line.startsWith('|-activate|p1') && line.includes(`move: ${name}`));
  }
  /** The reading's answer for the same two moves: the protector's own handler asked from stand-ins. */
  function readStops(protector: string, moveId: string): boolean {
    const battle = slowFoeBoard(protector, moveId);
    const dex = battle.dex;
    return sideProtectorStops(battle, dex.moves.get(protector), dex.getActiveMove(moveId), battle.sides[1].active[0]!, battle.sides[0].active[0]!);
  }

  describe('the Dex reading', () => {
    const dex = battleWith([splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]).dex;
    const sideMoves = dex.moves.all().filter(move => playable(move) && move.target === 'allySide');

    test('the side moves with a hit handler are the protectors, and no volatile Protect reading covers them', () => {
      expect(dex.currentMod).toBe(rules.format.includes('champions') ? 'champions' : 'base');
      expect(sideMoves.length).toBeGreaterThan(8);
      expect(sideMoves.filter(move => shieldsSide(dex, move)).map(move => move.id).sort()).toEqual(rules.claimed);
    });

    const PROBES = ['tackle', 'surf', 'rockslide', 'aquajet', 'fakeout', 'thunderwave'];
    test.each(['craftyshield', 'matblock', 'quickguard', 'wideguard'])('%s: the hits its handler stops are the hits the simulator stops (damaging, spread, priority and status probes)', protector => {
      // A move of higher priority than the protector lands before it stands (Mat Block, priority 0, against Aqua Jet): no handler runs then.
      const probes = PROBES.filter(probe => dex.moves.get(probe).priority <= dex.moves.get(protector).priority);
      expect(probes.length).toBeGreaterThanOrEqual(4);
      const seen = probes.map(probe => `${probe} ${stoppedInSim(protector, probe)}`);
      expect(probes.map(probe => `${probe} ${readStops(protector, probe)}`)).toEqual(seen);
      // The class is real: each protector stops something and lets something through.
      expect(seen.some(line => line.endsWith('true'))).toBe(true);
      expect(seen.some(line => line.endsWith('false'))).toBe(true);
    });

    test('the side moves without a hit handler stop no damaging probe in the simulator', () => {
      for (const move of sideMoves.filter(each => !shieldsSide(dex, each))) {
        for (const probe of ['tackle', 'surf', 'aquajet']) expect(`${move.id} ${probe} ${stoppedInSim(move.id, probe)}`).toBe(`${move.id} ${probe} false`);
      }
    });
  });

  /** p1's Blissey pair, slot 1 holding `protector`; p2's Garchomp holds `attack` (and Splash). `hp` sets slot 1's HP. */
  function board(protector: string, attack: string, hp?: number): Battle {
    const battle = battleWith(
      [mon('Blissey', [protector, 'splash']), splash('Blissey')],
      [mon('Garchomp', [attack, 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')]);
    if (hp !== undefined) battle.sides[0].active[0]!.sethp(hp);
    return battle;
  }
  /** Whether p1's slot 1 faints when p1 opens with `protector` and p2's Garchomp uses `attack` at a 1-HP body. */
  function faintsInSim(protector: string, attack: string): boolean {
    const battle = board(protector, attack, 1);
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', `move 1${aimedAt(battle, attack)}, move 1`);
    return battle.sides[0].active[0]!.fainted;
  }
  /** What the engine's own damage fractions say the protector denies: each body's hit, capped at its HP (the sum for a spread hit). */
  function deniedBy(battle: Battle, attack: string, spread: boolean): number {
    const foe = battle.sides[1].active[0]!;
    const parts = battle.sides[0].active.map(body => Math.min(singleMoveFraction(foe, body!, attack, battle) * (spread ? 0.75 : 1), body!.hp / body!.maxhp));
    return spread ? parts[0] + parts[1] : Math.max(...parts);
  }
  const choice = (protector: string) => `move ${protector}, move splash`;

  describe('a side protector earns the damage it denies, up to a flinch (extends T42)', () => {
    test('Wide Guard against a spread attacker: the simulator turns it away, the hint earns the ceiling', () => {
      // From the simulator: at 1 HP a Rock Slide KOs slot 1, Wide Guard turns it away, a Dragon Claw still KOs through it.
      expect(faintsInSim('splash', 'rockslide')).toBe(true);
      expect(faintsInSim('wideguard', 'rockslide')).toBe(false);
      expect(faintsInSim('wideguard', 'dragonclaw')).toBe(true);
      const battle = board('wideguard', 'rockslide', 1);
      expect(deniedBy(battle, 'rockslide', true)).toBeGreaterThan(CEILING);
      expect(tempoOf(battle, 'p1', choice('wideguard'))).toBeCloseTo(CEILING, 10);
    });

    test('a hit worth less than a flinch earns what it is worth, and a single-target attack earns nothing', () => {
      // Electro Web (a weak spread move) against Blissey's bulk: the tempo is the damage itself, from the engine's fractions.
      const weak = battleWith([mon('Blissey', ['wideguard', 'splash']), splash('Blissey')], [mon('Pikachu', ['electroweb', 'splash']), splash('Pikachu')]);
      const denied = deniedBy(weak, 'electroweb', true);
      expect(denied).toBeGreaterThan(0);
      expect(denied).toBeLessThan(CEILING);
      expect(tempoOf(weak, 'p1', choice('wideguard'))).toBeCloseTo(denied, 10);
      // From the simulator: Wide Guard lets a Dragon Claw through, so the hint reads no tempo.
      expect(tempoOf(board('wideguard', 'dragonclaw'), 'p1', choice('wideguard'))).toBeCloseTo(0, 10);
    });

    test('Wide Guard in the second slot, and for p2 against a p1 spread attacker', () => {
      const second = battleWith(
        [splash('Blissey'), mon('Blissey', ['wideguard', 'splash'])],
        [mon('Garchomp', ['rockslide', 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')]);
      expect(hintOf(second, 'p1', 'move splash, move wideguard') - 2 * SUPPORT_FLOOR).toBeCloseTo(CEILING, 10);
      const mirror = battleWith(
        [mon('Garchomp', ['rockslide', 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')],
        [mon('Blissey', ['wideguard', 'splash']), splash('Blissey')]);
      expect(tempoOf(mirror, 'p2', choice('wideguard'))).toBeCloseTo(CEILING, 10);
    });

    test('Quick Guard against a priority attack, not a plain one', () => {
      expect(faintsInSim('splash', 'machpunch')).toBe(true);
      expect(faintsInSim('quickguard', 'machpunch')).toBe(false);
      expect(faintsInSim('quickguard', 'dragonclaw')).toBe(true);
      const priority = board('quickguard', 'machpunch', 1);
      expect(tempoOf(priority, 'p1', choice('quickguard'))).toBeCloseTo(Math.min(CEILING, deniedBy(priority, 'machpunch', false)), 10);
      expect(tempoOf(priority, 'p1', choice('quickguard'))).toBeGreaterThan(0);
      expect(tempoOf(board('quickguard', 'dragonclaw', 1), 'p1', choice('quickguard'))).toBeCloseTo(0, 10);
    });

    test('Crafty Shield stops no damage, so it stays the support floor', () => {
      expect(faintsInSim('craftyshield', 'rockslide')).toBe(true);
      expect(tempoOf(board('craftyshield', 'rockslide', 1), 'p1', choice('craftyshield'))).toBeCloseTo(0, 10);
    });

    test('asking the handler leaves the battle, the dice and both bodies as they were, and an Outrage lock stays', () => {
      const battle = board('wideguard', 'rockslide', 1);
      const [source, target] = [battle.sides[1].active[0]!, battle.sides[0].active[0]!];
      source.volatiles['lockedmove'] = { id: 'lockedmove', duration: 2 } as unknown as typeof source.volatiles[string];
      const before = fingerprint(battle, [source, target], 'rockslide');
      const wide = battle.dex.moves.get('wideguard');
      expect(sideProtectorStops(battle, wide, battle.dex.getActiveMove('rockslide'), source, target)).toBe(true);
      expect(fingerprint(battle, [source, target], 'rockslide')).toBe(before);
      expect(source.volatiles['lockedmove']).toBeDefined();
    });

    // Terastallization is a Scarlet/Violet rule: Pokémon Champions has none.
    test.skipIf(rules.format.includes('champions'))('a Tera Starstorm of Terapagos-Stellar is a spread hit for the reading (the move at use, not the Dex target)', () => {
      // The Dex lists Tera Starstorm as a single-target move; the simulator's ModifyMove makes it hit both foes from the Stellar forme.
      const stellar = (): Battle => battleWith(
        [mon('Blissey', ['wideguard', 'splash']), splash('Blissey')],
        [mon('Terapagos-Stellar', ['terastarstorm', 'splash'], { ability: 'Teraform Zero', teraType: 'Stellar' }), splash('Pikachu')]);
      expect(stellar().dex.moves.get('terastarstorm').target).toBe('normal');
      const played = stellar();
      played.sides[0].active[0]!.sethp(1);
      played.choose('p1', 'move 1, move 1');
      played.choose('p2', 'move 1, move 1');
      expect(played.sides[0].active[0]!.fainted).toBe(false);
      expect(played.log.some(line => line.startsWith('|-activate|p1') && line.includes('move: Wide Guard'))).toBe(true);
      // Read as a single-target move it would earn nothing; read as the spread hit it is, it earns the damage on both bodies.
      const tempo = tempoOf(stellar(), 'p1', choice('wideguard'));
      expect(tempo).toBeGreaterThan(0.1);
      expect(tempo).toBeCloseTo(deniedBy(stellar(), 'terastarstorm', true), 10);
    });
  });
});
