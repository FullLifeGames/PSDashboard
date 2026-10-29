import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { calculate, Field, Move, Pokemon } from '@smogon/calc';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { calcGenerationFor, calcModOf } from '../src/calc-gen';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { guessedEvs, guessedField, revealedField, unknownField } from '../src/team-info';
import type { DamageObservation, LoggedHit, PokemonEvs, RevealedPokemonInfo } from '../src/types';

/**
 * Round 68 (T159, spec decision 7): the damage judge reads a Champions game again (ruling R10, taken back in c81ef04 because
 * replay-core could not read the mod's moves). The calculator's own generation 0 carries the Champions moves and items, so the
 * judge prices a hit with the game's own values: a Wyrdeer without a boost item hits Garchomp with Psyshield Bash at the mod's
 * power 90 (the base game's 70), and the judge must not take that for a boost. Every hit is a real battle of the Champions mod,
 * on the singles format and on the doubles format, so the simulator is the oracle; the judge sees only the log.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

type Kind = 'singles' | 'doubles';
const FORMAT: Record<Kind, string> = { singles: 'gen9championsou', doubles: 'gen9championsdoublescustomgame' };
const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
  name: species, species, item, ability, moves, nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 50, gender: '',
});

const WYRDEER_SPREAD = sp({ hp: 2, atk: 32, spe: 32 });
const GARCHOMP_SPREAD = sp({ hp: 32, def: 32, spe: 2 });
const wyrdeer = (item: string) => set('Wyrdeer', item, 'Sap Sipper', ['Psyshield Bash'], 'Adamant', WYRDEER_SPREAD);
const garchomp = () => set('Garchomp', 'Leftovers', 'Sand Veil', ['Swords Dance'], 'Impish', GARCHOMP_SPREAD);
const blissey = () => set('Blissey', 'Leftovers', 'Natural Cure', ['Protect'], 'Calm', { hp: 32, spd: 32 });

/** The spectators' log of one turn: Wyrdeer (p2) hits Garchomp (p1) with Psyshield Bash; null when the roll crit or the simulator drew no clean hit. */
function turnLog(kind: Kind, item: string, seed: number): string | null {
  const doubles = kind === 'doubles';
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [garchomp(), blissey()] : [garchomp()]) },
    p2: { name: 'Beta', team: Teams.pack(doubles ? [wyrdeer(item), blissey()] : [wyrdeer(item)]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  battle.choose('p1', doubles ? 'move swordsdance, move protect' : 'move swordsdance');
  battle.choose('p2', doubles ? 'move psyshieldbash 1, move protect' : 'move psyshieldbash');
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return /\|-crit\|/.test(log) || !/\|move\|p2a: Wyrdeer\|Psyshield Bash/.test(log) ? null : log;
}

/** The clean log with the highest roll of the scene (a weak roll cannot tell an item from the defender as built); the hit the judge reads is the simulator's own. */
function sceneOf(kind: Kind, item: string): { log: string; attacker: RevealedPokemonInfo } {
  let best: { log: string; attacker: RevealedPokemonInfo } | null = null;
  for (let seed = 1; seed <= 120; seed++) {
    const log = turnLog(kind, item, seed);
    if (!log) continue;
    const attacker = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === 'Wyrdeer');
    if (attacker?.hits?.length && (!best || attacker.hits[0].observed > best.attacker.hits![0].observed)) best = { log, attacker };
  }
  if (!best) throw new Error('no clean Psyshield Bash in 120 seeds');
  return best;
}

const garchompInfo = (): RevealedPokemonInfo => ({
  species: 'Garchomp', moves: [], ability: revealedField('Sand Veil'), item: revealedField('Leftovers'), teraType: unknownField(),
  evs: guessedEvs(GARCHOMP_SPREAD), nature: guessedField('Impish'), level: 50, gender: '',
});
const teamsOf = () => ({ p1: { pokemon: [garchompInfo()] }, p2: { pokemon: [] as RevealedPokemonInfo[] } });
const CANDIDATES = ['Life Orb', 'Leftovers', 'Sitrus Berry', 'Focus Sash'];
const hitOf = (attacker: RevealedPokemonInfo): LoggedHit => attacker.hits![0];

describe('the damage judge on a Champions game (T159, R10)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the log of a Champions game names its format and its hit`, () => {
      const { attacker } = sceneOf(kind, '');
      expect(hitOf(attacker)).toMatchObject({ move: 'psyshieldbash', gen: 9, doubles: kind === 'doubles', attacker: { species: 'Wyrdeer' }, defender: { species: 'Garchomp', side: 'p1' } });
      // The hit carries the log's tier name ('[Gen 9 Champions] OU'), not a format id: it must still price on generation 0.
      expect(hitOf(attacker).format).toMatch(/champions/i);
      expect(calcGenerationFor(hitOf(attacker).gen, calcModOf(hitOf(attacker).format)).num).toBe(0);
    });

    test(`${kind}: Wyrdeer without a boost item hits at the mod's power 90 and the judge rules out no item`, () => {
      const { attacker } = sceneOf(kind, '');
      // The scene is a scene only if the base game's power would have read as a boost: priced at the base Dex's
      // Psyshield Bash, the hit lies above the strongest unboosted spread.
      const hit = hitOf(attacker);
      const gen = calcGenerationFor(9, 'champions');
      const basePower = Dex.forGen(9).moves.get('psyshieldbash').basePower;
      const modPower = Dex.dexes.champions.moves.get('psyshieldbash').basePower;
      expect(modPower).toBeGreaterThan(basePower);
      const body = (species: string, options: ConstructorParameters<typeof Pokemon>[2]) => new Pokemon(gen, species, { level: 50, ...options });
      const defender = body('Garchomp', { nature: 'Impish', ability: 'Sand Veil', item: 'Leftovers', evs: GARCHOMP_SPREAD });
      const strong = body('Wyrdeer', { nature: 'Adamant', ability: 'Sap Sipper', evs: { atk: 32 } });
      const reread = calculate(gen, strong, defender, new Move(gen, 'Psyshield Bash', { overrides: { basePower } }), new Field()).damage as number[];
      expect(hit.observed - 0.02).toBeGreaterThan(Math.max(...reread) / defender.maxHP());
      expect(judgeItemsByDamage(attacker, CANDIDATES, teamsOf())).toEqual([]);
    });

    test(`${kind}: a hit only Life Orb explains rules out Leftovers, Sitrus Berry and Focus Sash`, () => {
      const { attacker } = sceneOf(kind, 'Life Orb');
      expect(judgeItemsByDamage(attacker, CANDIDATES, teamsOf()).sort()).toEqual(['focussash', 'leftovers', 'sitrusberry']);
    });

    test(`${kind}: a Choice Band hit, which the Champions mod marks Past, is explained by no item that exists there`, () => {
      // The simulator still plays Choice Band; the calculator's generation 0 lists neither Band nor Specs, so no candidate
      // reaches a x1.5 hit and the judge drops the hit rather than refute what the holder may carry.
      const { attacker } = sceneOf(kind, 'Choice Band');
      expect(judgeItemsByDamage(attacker, CANDIDATES, teamsOf())).toEqual([]);
    });
  }
});

describe('the spread solver reads the same Champions hit on Stat Points (T159, decision 7)', () => {
  const SOLVER_FORMAT: Record<Kind, string> = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmcbo3' };
  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: the spread the simulator played fits the hit at the mod's power, a weaker one does not`, () => {
      const { attacker } = sceneOf(kind, '');
      const hit = hitOf(attacker);
      const observation: DamageObservation = {
        attackerSpecies: 'Wyrdeer', defenderSpecies: 'Garchomp', attackerSide: 'p2', moveId: 'psyshieldbash', observedFraction: hit.observed,
        lethal: false, attackerBoosts: {}, defenderBoosts: hit.defender.boosts, attackerStatus: '', screens: [], weather: '',
      };
      const sets = { p1: [garchomp()], p2: [wyrdeer('')] };
      const ctx = buildSolveContext([observation], sets, SOLVER_FORMAT[kind], []);
      expect(observationError(ctx, observation, 'p2:wyrdeer', { evs: WYRDEER_SPREAD, nature: 'Adamant' })).toBe(0);
      expect(observationError(ctx, observation, 'p2:wyrdeer', { evs: sp({ spe: 32 }), nature: 'Hardy' })).toBeGreaterThan(0);
    });
  }
});
