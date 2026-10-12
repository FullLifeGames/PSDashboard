import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calculate, Field, Move } from '@smogon/calc';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { guessedEvs, guessedField, revealedField, unknownField } from '../src/team-info';
import type { DamageObservation, PokemonEvs, RevealedPokemonInfo } from '../src/types';

/**
 * Round 68 (T186 guard, diagnosis of measure m1): an entry stage the log already shows counts once. Zamazenta's Dauntless
 * Shield prints `|-ability|...|Dauntless Shield|boost` and `|-boost|...|def|1`, and the protocol parser copies the client
 * battle's boosts (def +1) into the damage observation that the spread solver and the item judge hand to the calculator.
 * Calculator 0.11 added Dauntless Shield's Defense stage itself on every calculation, so a Zamazenta hit was priced at the
 * logged stage plus one more (Def +2); 0.12 adds it only for `abilityOn`, as the simulator gives it once per Pokémon.
 * The oracle is the simulator: a real Gen 9 battle where Zamazenta enters with Dauntless Shield and takes a Garchomp hit.
 *
 * Singles and doubles: the spread solver reads both since round 69 (T31: the parser records a damage observation under
 * `|gametype|doubles` as well; in m1 it read singles only, which is why the doubles bank did not move), so the solver test runs
 * on both. The item judge reads the hits of both game types with the same boosts (the `LoggedHit` party boosts), so the
 * calculator-level reading and the judge scene run on both. The doubles hit is Stomping Tantrum, a single-target move
 * without a secondary effect: Earthquake is a spread move there, and Fire Fang's burn would add end-of-turn damage to the
 * HP the scene reads. On calculator 0.11 (steps/vitest.r68-calc011.config.ts) the rolls tests and the solver test are red;
 * the judge scene stays green there (its margin absorbs the old double stage on this hit) and guards the boosts it hands on.
 */

type Kind = 'singles' | 'doubles';
const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };
const MOVE: Record<Kind, string> = { singles: 'Earthquake', doubles: 'Stomping Tantrum' };
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const set = (species: string, item: string, ability: string, moves: string[], nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
  name: species, species, item, ability, moves, nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 100, gender: '',
});
const GARCHOMP_SPREAD = sp({ atk: 252, spe: 252 });
const garchomp = (move: string) => set('Garchomp', '', 'Rough Skin', [move], 'Jolly', GARCHOMP_SPREAD);
// No item: nothing heals Zamazenta between the hit and the end of the turn, so its HP loss is the hit.
const zamazenta = () => set('Zamazenta', '', 'Dauntless Shield', ['Splash'], 'Jolly', {});
const blissey = () => set('Blissey', '', 'Natural Cure', ['Protect'], 'Calm', { hp: 252 });

interface Scene {
  log: string;
  /** The simulator's own damage: Zamazenta's HP before and after the hit. */
  damage: number;
  maxHp: number;
}

/** One turn: Garchomp (p1) hits Zamazenta (p2); null when the roll crit (the parser records no crit) or the simulator drew no hit. */
function sceneOf(kind: Kind, seed: number): Scene | null {
  const doubles = kind === 'doubles';
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [garchomp(MOVE[kind]), blissey()] : [garchomp(MOVE[kind])]) },
    p2: { name: 'Beta', team: Teams.pack(doubles ? [zamazenta(), blissey()] : [zamazenta()]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const target = battle.p2.active[0];
  const maxHp = target.maxhp;
  battle.choose('p1', doubles ? `move ${toID(MOVE[kind])} 1, move protect` : `move ${toID(MOVE[kind])}`);
  battle.choose('p2', doubles ? 'move splash, move protect' : 'move splash');
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  if (/\|-crit\|/.test(log) || target.hp >= maxHp) return null;
  return { log, damage: maxHp - target.hp, maxHp };
}

/** Up to `count` clean scenes of different rolls. */
function scenesOf(kind: Kind, count: number): Scene[] {
  const scenes: Scene[] = [];
  for (let seed = 1; scenes.length < count && seed <= 200; seed++) {
    const scene = sceneOf(kind, seed);
    if (scene && !scenes.some(known => known.damage === scene.damage)) scenes.push(scene);
  }
  return scenes;
}

/** The observation of the hit into Zamazenta, as the solver reads it from the log. */
function hitObservation(log: string): DamageObservation {
  const { observations } = parseReplayLogWithObservations(log);
  const found = observations.filter(obs => obs.defenderSpecies === 'Zamazenta');
  expect(found).toHaveLength(1);
  return found[0];
}

/** The calculator's rolls of the hit for a defender carrying the given boosts, built as the solver builds it. */
function rollsOf(defenderBoosts: Record<string, number>, kind: Kind): number[] {
  const gen = calcGenerationFor(9);
  const attacker = buildCalcPokemon(gen, 'Garchomp', { level: 100, ability: 'Rough Skin', nature: 'Jolly', evs: GARCHOMP_SPREAD, boosts: {} });
  const defender = buildCalcPokemon(gen, 'Zamazenta', { level: 100, ability: 'Dauntless Shield', nature: 'Jolly', evs: sp({}), boosts: defenderBoosts });
  const result = calculate(gen, attacker, defender, new Move(gen, MOVE[kind]), new Field({ gameType: kind === 'doubles' ? 'Doubles' : 'Singles' }));
  return (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
}

const zamazentaInfo = (): RevealedPokemonInfo => ({
  species: 'Zamazenta', moves: [], ability: revealedField('Dauntless Shield'), item: revealedField(''), teraType: unknownField(),
  evs: guessedEvs(sp({})), nature: guessedField('Jolly'), level: 100, gender: '',
});
const teamsOf = () => ({ p1: { pokemon: [] as RevealedPokemonInfo[] }, p2: { pokemon: [zamazentaInfo()] } });

describe('a Dauntless Shield stage the log shows is priced once (T186 guard)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the log shows the entry stage once`, () => {
      const scene = scenesOf(kind, 1)[0];
      expect(scene.log).toMatch(/\|-ability\|p2a: Zamazenta\|Dauntless Shield\|boost/);
      expect(scene.log.match(/\|-boost\|p2a: Zamazenta\|def\|/g)).toHaveLength(1);
      expect(scene.log).toMatch(/\|-boost\|p2a: Zamazenta\|def\|1/);
    });

    test(`${kind}: the calculator's rolls at the logged boosts contain the simulator's damage, a second stage does not`, () => {
      const scenes = scenesOf(kind, 6);
      expect(scenes.length).toBeGreaterThanOrEqual(4);
      for (const scene of scenes) {
        // The boosts the solver (singles observation) and the judge (the logged hit, both game types) hand the calculator.
        const hit = inferOpponentTeam(scene.log, 'p1').pokemon.find(mon => mon.species === 'Garchomp')?.hits?.[0];
        expect(hit?.defender.boosts).toEqual({ def: 1 });
        expect(hitObservation(scene.log).defenderBoosts).toEqual(hit?.defender.boosts);
        const once = rollsOf(hit!.defender.boosts, kind);
        expect(once).toContain(scene.damage);
        // The double count of calculator 0.11: Def +1 from the log plus the calculator's own +1.
        const twice = rollsOf({ def: 2 }, kind);
        expect(twice).not.toContain(scene.damage);
        expect(Math.max(...twice)).toBeLessThan(Math.min(...once));
      }
    });

    test(`${kind}: the item judge reads the hit at the logged stage and rules out no item that explains it`, () => {
      for (const scene of scenesOf(kind, 4)) {
        const attacker = inferOpponentTeam(scene.log, 'p1').pokemon.find(mon => mon.species === 'Garchomp');
        const hit = attacker?.hits?.[0];
        expect(hit?.defender.boosts).toEqual({ def: 1 });
        expect(hit?.doubles).toBe(kind === 'doubles');
        // Garchomp holds nothing: the hit is explained bare and by Leftovers, so the judge rules out none of the candidates.
        expect(judgeItemsByDamage(attacker!, ['Life Orb', 'Choice Band', 'Leftovers', 'Sitrus Berry'], teamsOf())).toEqual([]);
      }
    });
  }

  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the solver reads the played spread of the hit with no error, one with the stage counted twice with some`, () => {
      for (const scene of scenesOf(kind, 4)) {
        const obs = hitObservation(scene.log);
        expect(obs.doubles).toBe(kind === 'doubles');
        expect(Math.abs(obs.observedFraction - scene.damage / scene.maxHp)).toBeLessThan(0.01);
        const sets = { p1: [garchomp(MOVE[kind])], p2: [zamazenta()] };
        const ctx = buildSolveContext([obs], sets, FORMAT[kind], []);
        expect(observationError(ctx, obs, 'p2:zamazenta', { evs: sp({}), nature: 'Jolly' })).toBe(0);
        // The same hit read as a defender with Def +2: what a double count makes of the played spread.
        const doubled: DamageObservation = { ...obs, defenderBoosts: { def: 2 } };
        expect(observationError(ctx, doubled, 'p2:zamazenta', { evs: sp({}), nature: 'Jolly' })).toBeGreaterThan(0);
      }
    });
  }
});
