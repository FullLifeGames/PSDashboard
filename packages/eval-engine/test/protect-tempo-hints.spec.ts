import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { singleMoveFraction } from '../src/score/threat';
import { combinedOptionHints, protectorStops, shieldsFromHits, shieldsSide } from '../src/search/hints';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * Round 70 (gate of 13.10.2026 20:26, 3a): Protect and its kin earn the damage they deny, up to the flinch-sized ceiling of
 * T42's pair term, the way the side protectors do. T42 gave a Protect a tempo only where the foes KO its user together and
 * neither alone; a Protect in front of a lone heavy hit stayed the 0.25 support floor, 16th to 42nd of 42 legal combos in
 * VGC 2630685175 turn 7 (where it was one of the four answers the equilibrium wall stood on). The reading comes from the
 * simulator the same way: the shield's own onTryHit, asked from stand-ins that leave the battle alone. The Protect covers its
 * user only (the partner stands outside it), so only the user's share of a spread hit counts. Both rule sets run it,
 * Scarlet/Violet and Pokémon Champions.
 */

await loadSimMods('gen9championsou');

interface Rules {
  name: string;
  format: string;
  level: number;
  /** Champions reads the sets' evs as Stat Points. */
  evs?: PokemonSet['evs'];
}

const RULES: Rules[] = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', level: 100 },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 } },
];

const SUPPORT_FLOOR = 0.25;
/** The flinch-sized ceiling of a protector's tempo (hints.ts FLINCH_BONUS, the T42 pair term). */
const CEILING = 0.3;
const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const option = (choice: string) => ({ choice, label: choice });
const hintOf = (battle: Battle, side: 'p1' | 'p2', choice: string) => combinedOptionHints(rootOf(battle), side, [option(choice)])[0];
/** The tempo a Protect part earns over the idle pair: the hint of `<protector>, splash` minus the two support floors. */
const tempoOf = (battle: Battle, side: 'p1' | 'p2', choice: string) => hintOf(battle, side, choice) - 2 * SUPPORT_FLOOR;
const aimedAt = (battle: Battle, moveId: string) => (['normal', 'any', 'adjacentFoe'].includes(battle.dex.moves.get(moveId).target) ? ' 1' : '');
/** A move a battle can use: real, not a Max or Z move, not from a later game. */
const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown }) => move.exists && move.gen <= 9 && !move.isMax && !move.isZ;

describe.each(RULES)('$name: Protect in the hints (round 70, 3a)', rules => {
  const mon = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) =>
    set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...extra });
  const splash = (species: string, extra: Partial<PokemonSet> = {}) => mon(species, ['splash'], extra);
  const battleWith = (p1: PokemonSet[], p2: PokemonSet[]) => battleOf(rules.format, p1, p2);

  /** p1's slot 1 holds `shield` (and Splash) on `userSpecies`, slot 2 a Blissey; p2's Garchomp holds `attack`. `hp` sets slot 1's HP. */
  function board(shield: string, attack: string, hp?: number, userSpecies = 'Blissey'): Battle {
    const battle = battleWith(
      [mon(userSpecies, [shield, 'splash']), splash('Blissey')],
      [mon('Garchomp', [attack, 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')]);
    if (hp !== undefined) battle.sides[0].active[0]!.sethp(hp);
    return battle;
  }
  /** Whether p1's slot 1 faints when p1 opens with `shield` and p2's Garchomp uses `attack` at a 1-HP body. */
  function faintsInSim(shield: string, attack: string): boolean {
    const battle = board(shield, attack, 1);
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', `move 1${aimedAt(battle, attack)}, move 1`);
    return battle.sides[0].active[0]!.fainted;
  }
  /** What the engine's own damage fractions say Protect denies its user: the hit as it lands, capped at the user's HP. */
  function deniedBy(battle: Battle, attack: string, spread: boolean): number {
    const user = battle.sides[0].active[0]!;
    return Math.min(singleMoveFraction(battle.sides[1].active[0]!, user, attack, battle) * (spread ? 0.75 : 1), user.hp / user.maxhp);
  }
  const choice = (shield: string) => `move ${shield}, move splash`;

  describe('Protect earns the damage it denies, up to a flinch (extends T42)', () => {
    test('a heavy single-target hit: the simulator turns it away, the hint earns the ceiling', () => {
      // From the simulator: at 1 HP a Dragon Claw KOs the user, a Protect turns it away.
      expect(faintsInSim('splash', 'dragonclaw')).toBe(true);
      expect(faintsInSim('protect', 'dragonclaw')).toBe(false);
      const battle = board('protect', 'dragonclaw', undefined, 'Pikachu');
      expect(deniedBy(battle, 'dragonclaw', false)).toBeGreaterThan(CEILING);
      expect(tempoOf(battle, 'p1', choice('protect'))).toBeCloseTo(CEILING, 10);
    });

    test('a hit worth less than a flinch earns what it is worth', () => {
      const weak = battleWith([mon('Blissey', ['protect', 'splash']), splash('Blissey')], [mon('Pikachu', ['tackle', 'splash']), splash('Pikachu')]);
      const denied = deniedBy(weak, 'tackle', false);
      expect(denied).toBeGreaterThan(0);
      expect(denied).toBeLessThan(CEILING);
      expect(tempoOf(weak, 'p1', choice('protect'))).toBeCloseTo(denied, 10);
    });

    test('a hit capped by the user\'s HP earns the HP it has left', () => {
      const low = board('protect', 'dragonclaw', 3, 'Pikachu');
      const user = low.sides[0].active[0]!;
      const left = user.hp / user.maxhp;
      expect(left).toBeLessThan(CEILING);
      expect(tempoOf(low, 'p1', choice('protect'))).toBeCloseTo(left, 10);
    });

    test('a spread hit counts the user\'s share at the spread factor, not the partner\'s', () => {
      expect(faintsInSim('splash', 'rockslide')).toBe(true);
      expect(faintsInSim('protect', 'rockslide')).toBe(false);
      const battle = battleWith(
        [mon('Blissey', ['protect', 'splash']), splash('Pikachu')],
        [mon('Garchomp', ['rockslide', 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')]);
      const denied = deniedBy(battle, 'rockslide', true);
      expect(denied).toBeGreaterThan(0);
      expect(tempoOf(battle, 'p1', choice('protect'))).toBeCloseTo(Math.min(CEILING, denied), 10);
      // The partner's far larger share (a Pikachu under the same hit) stays outside the shield.
      const partner = battle.sides[0].active[1]!;
      const partnerShare = Math.min(singleMoveFraction(battle.sides[1].active[0]!, partner, 'rockslide', battle) * 0.75, partner.hp / partner.maxhp);
      expect(partnerShare).toBeGreaterThan(denied);
    });

    test('a foe with nothing to deny leaves the Protect at the support floor', () => {
      const idle = battleWith([mon('Blissey', ['protect', 'splash']), splash('Blissey')], [splash('Garchomp'), splash('Pikachu')]);
      expect(tempoOf(idle, 'p1', choice('protect'))).toBeCloseTo(0, 10);
    });

    test('a hit the shield lets through earns nothing (Feint breaks Protect in the simulator)', () => {
      expect(faintsInSim('protect', 'feint')).toBe(true);
      expect(tempoOf(board('protect', 'feint', 1, 'Pikachu'), 'p1', choice('protect'))).toBeCloseTo(0, 10);
      expect(tempoOf(board('protect', 'feint'), 'p1', choice('protect'))).toBeCloseTo(0, 10);
    });

    test('the second slot, and p2 against a p1 attacker', () => {
      const second = battleWith(
        [splash('Blissey'), mon('Pikachu', ['protect', 'splash'])],
        [mon('Garchomp', ['dragonclaw', 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')]);
      expect(hintOf(second, 'p1', 'move splash, move protect') - 2 * SUPPORT_FLOOR).toBeCloseTo(CEILING, 10);
      const mirror = battleWith(
        [mon('Garchomp', ['dragonclaw', 'splash'], { ability: 'Sand Veil' }), splash('Pikachu')],
        [mon('Pikachu', ['protect', 'splash']), splash('Blissey')]);
      expect(tempoOf(mirror, 'p2', choice('protect'))).toBeCloseTo(CEILING, 10);
    });

    test('T42\'s pair-only KO keeps its full tempo, whatever one hit is worth', () => {
      // Two Garchomps: each Dragon Claw leaves a high-HP Snorlax standing, together they KO it.
      const pair = battleWith(
        [mon('Snorlax', ['protect', 'splash']), splash('Blissey')],
        [mon('Garchomp', ['dragonclaw', 'splash'], { ability: 'Sand Veil' }), mon('Garchomp', ['dragonclaw', 'splash'], { ability: 'Sand Veil' })]);
      const snorlax = pair.sides[0].active[0]!;
      const hit = singleMoveFraction(pair.sides[1].active[0]!, snorlax, 'dragonclaw', pair);
      expect(hit).toBeGreaterThan(0);
      // Set the HP just under two hits and over one.
      snorlax.sethp(Math.floor(snorlax.maxhp * hit * 1.35));
      expect(tempoOf(pair, 'p1', choice('protect'))).toBeCloseTo(CEILING, 10);
    });
  });

  describe('the reading comes from the simulator\'s own handler', () => {
    const dex = battleWith([splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]).dex;
    const shields = dex.moves.all().filter(move => playable(move) && shieldsFromHits(dex, move)).map(move => move.id);
    const PROBES = ['tackle', 'surf', 'rockslide', 'aquajet', 'fakeout', 'feint', 'thunderwave'];

    /** A Blissey that opened with `shield` meets a slow foe's `probe` (a probe of higher priority than the shield lands first: no handler runs). */
    const slowFoeBoard = (shield: string, probe: string) =>
      battleWith([mon('Blissey', [shield, 'splash']), splash('Blissey')], [mon('Shuckle', [probe, 'splash']), splash('Shuckle')]);
    function stoppedInSim(shield: string, probe: string): boolean {
      const battle = slowFoeBoard(shield, probe);
      const user = battle.sides[0].active[0]!;
      battle.choose('p1', 'move 1, move 1');
      battle.choose('p2', `move 1${aimedAt(battle, probe)}, move 1`);
      // The shields of the Protect family log "move: Protect"; a stopped hit leaves the user untouched. Feint logs an activation
      // of its own when it breaks the shield and then hurts the user, so the activation alone is not the answer.
      const activated = battle.log.some(line => /^\|-activate\|p1a: .*\|move: /.test(line));
      return activated && user.hp === user.maxhp && !user.status;
    }
    function readStops(shield: string, probe: string): boolean {
      const battle = slowFoeBoard(shield, probe);
      return protectorStops(battle, battle.dex.moves.get(shield), battle.dex.getActiveMove(probe), battle.sides[1].active[0]!, battle.sides[0].active[0]!);
    }

    test('the shields are the self-targeted stalling moves whose volatile has a hit handler (a Dex sweep, no names)', () => {
      expect(shields.length).toBeGreaterThanOrEqual(4);
      expect(shields).toContain('protect');
      expect(shields).not.toContain('endure');
    });

    test.each(['protect', 'spikyshield', 'kingsshield'])('%s: the hits its handler stops are the hits the simulator stops (damaging, spread, priority, status and breaker probes)', shield => {
      expect(shields).toContain(shield);
      const probes = PROBES.filter(probe => dex.moves.get(probe).priority <= dex.moves.get(shield).priority && dex.moves.get(probe).exists);
      expect(probes.length).toBeGreaterThanOrEqual(5);
      const seen = probes.map(probe => `${probe} ${stoppedInSim(shield, probe)}`);
      expect(probes.map(probe => `${probe} ${readStops(shield, probe)}`)).toEqual(seen);
      // The class is real: each shield stops something and lets something through.
      expect(seen.some(line => line.endsWith('true'))).toBe(true);
      expect(seen.some(line => line.endsWith('false'))).toBe(true);
    });

    // The shields that punish a contact hit do it in the handler asked here: King's Shield, Obstruct and Silk Trap lower a stage of the
    // attacker (a nested object a shallow stand-in shares with the live body), Baneful Bunker and Burning Bulwark try a status through
    // the live battle (a log line and the effect counter). A leak would sit in the root battle every later hint and every child reads.
    const protectors = dex.moves.all().filter(move => playable(move) && (shieldsFromHits(dex, move) || shieldsSide(dex, move))).map(move => move.id);

    test('the sweep holds the Protect family, its contact punishers and the side protectors', () => {
      for (const id of ['protect', 'detect', 'spikyshield', 'kingsshield', 'banefulbunker', 'obstruct', 'silktrap', 'burningbulwark', 'wideguard', 'quickguard', 'matblock', 'craftyshield']) {
        if (dex.moves.get(id).exists && playable(dex.moves.get(id))) expect(protectors, id).toContain(id);
      }
      expect(protectors.length).toBeGreaterThanOrEqual(8);
    });

    test.each(protectors)('%s: asking the handler leaves the battle, the dice and both bodies as they were, against a contact and a non-contact hit', protector => {
      for (const attack of ['tackle', 'surf']) {
        const battle = slowFoeBoard(protector, attack);
        const [source, target] = [battle.sides[1].active[0]!, battle.sides[0].active[0]!];
        const before = fingerprint(battle, [source, target], attack);
        protectorStops(battle, battle.dex.moves.get(protector), battle.dex.getActiveMove(attack), source, target);
        expect(fingerprint(battle, [source, target], attack), `${protector} against ${attack}`).toBe(before);
      }
    });

    test('asking the handler leaves the battle, the dice and both bodies as they were, and an Outrage lock stays', () => {
      const battle = board('protect', 'dragonclaw', 1);
      const [source, target] = [battle.sides[1].active[0]!, battle.sides[0].active[0]!];
      source.volatiles['lockedmove'] = { id: 'lockedmove', duration: 2 } as unknown as typeof source.volatiles[string];
      const before = fingerprint(battle, [source, target], 'dragonclaw');
      expect(protectorStops(battle, battle.dex.moves.get('protect'), battle.dex.getActiveMove('dragonclaw'), source, target)).toBe(true);
      expect(fingerprint(battle, [source, target], 'dragonclaw')).toBe(before);
      expect(source.volatiles['lockedmove']).toBeDefined();
    });
  });
});
