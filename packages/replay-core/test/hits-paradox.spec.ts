import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import type { LoggedHit } from '../src/types';

/**
 * Round 69 (hits-paradox): the hit walk records the stat a Protosynthesis or Quark Drive holder has raised at the hit, so the
 * item judge prices the boost. The client keeps the stat on the volatile ('protosynthesis' or 'quarkdrive' with a `stat`), not
 * in the volatile's key. Every battle is played by @pkmn/sim in singles and doubles; the expected stat is the one the
 * simulator's own `-start` line names. Pokemon Champions has no legal species with either ability (the mod's species list
 * carries none), so there is no Champions case.
 */
type Kind = 'singles' | 'doubles';
const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

interface Build { species: string; item?: string; ability: string; moves: string[]; nature?: string; evs?: Partial<typeof ALL_31> }
const set = (build: Build): PokemonSet => ({
  name: build.species, species: build.species, item: build.item ?? 'Leftovers', ability: build.ability, moves: build.moves,
  nature: build.nature ?? 'Hardy', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...build.evs }, ivs: ALL_31, level: 100, gender: '',
}) as PokemonSet;

const torkoal = () => set({ species: 'Torkoal', ability: 'Drought', moves: ['Flamethrower', 'Protect'], evs: { hp: 252 } });
const koko = () => set({ species: 'Tapu Koko', ability: 'Electric Surge', moves: ['Dazzling Gleam', 'Protect'], evs: { hp: 252 } });
const garchomp = () => set({ species: 'Garchomp', ability: 'Rough Skin', moves: ['Dragon Claw', 'Protect'], evs: { hp: 252 } });
const tusk = (item: string) => set({ species: 'Great Tusk', item, ability: 'Protosynthesis', moves: ['Rapid Spin', 'Protect'] });
const treads = () => set({ species: 'Iron Treads', item: 'Leftovers', ability: 'Quark Drive', moves: ['Earthquake', 'Protect'] });
const blissey = () => set({ species: 'Blissey', ability: 'Natural Cure', moves: ['Soft-Boiled'], evs: { hp: 252 } });
const chansey = () => set({ species: 'Chansey', ability: 'Natural Cure', moves: ['Soft-Boiled'], evs: { hp: 252 } });

/** One turn of a real battle for a seed, p1 attacking `p1Move`, p2 `p2Move`; the log has no crit. */
function turnLog(kind: Kind, p1: PokemonSet, p2: PokemonSet, moves: [string, string], seed: number): string | null {
  const doubles = kind === 'doubles';
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [p1, blissey()] : [p1]) },
    p2: { name: 'Beta', team: Teams.pack(doubles ? [p2, chansey()] : [p2]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  // A move that names its target needs one in doubles; a spread move (Earthquake, Dazzling Gleam) takes none.
  const choice = (move: string) => (doubles ? `move ${move}${['normal', 'any', 'adjacentFoe'].includes(Dex.moves.get(move).target) ? ' 1' : ''}, move softboiled` : `move ${move}`);
  battle.choose('p1', choice(moves[0]));
  battle.choose('p2', choice(moves[1]));
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return /\|-crit\|/.test(log) ? null : log;
}

interface Scene { log: string; stat: string; tuskHits: LoggedHit[]; foeHits: LoggedHit[] }

/** The first crit-free log in which both leads hit: the Paradox holder is on p2 (its hits) and the foe on p1 (hits into the holder). */
function sceneOf(kind: Kind, foe: PokemonSet, holder: PokemonSet, moves: [string, string]): Scene {
  for (let seed = 1; seed <= 80; seed++) {
    const log = turnLog(kind, foe, holder, moves, seed);
    if (!log) continue;
    const stat = /\|-start\|p2a: [^|]+\|(?:protosynthesis|quarkdrive)(atk|def|spa|spd|spe)/.exec(log)?.[1];
    const tuskHits = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === holder.species)?.hits ?? [];
    const foeHits = inferOpponentTeam(log, 'p1').pokemon.find(mon => mon.species === foe.species)?.hits ?? [];
    if (stat && tuskHits.length > 0 && foeHits.length > 0) return { log, stat, tuskHits, foeHits };
  }
  throw new Error('no clean scene in 80 seeds');
}

describe('the stat a Protosynthesis or Quark Drive holder has raised, read at the hit', () => {
  const holders: Array<[string, () => PokemonSet, () => PokemonSet, [string, string]]> = [
    ['Protosynthesis from Sun', torkoal, () => tusk('Leftovers'), ['flamethrower', 'rapidspin']],
    ['Protosynthesis from Booster Energy', garchomp, () => tusk('Booster Energy'), ['dragonclaw', 'rapidspin']],
    ['Quark Drive from Electric Terrain', koko, treads, ['dazzlinggleam', 'earthquake']],
  ];
  for (const kind of ['singles', 'doubles'] as const) {
    for (const [name, foe, holder, moves] of holders) {
      test(`${kind}: ${name}`, () => {
        const scene = sceneOf(kind, foe(), holder(), moves);
        // The holder as attacker and as defender both carry the stat of the simulator's -start line.
        expect(scene.tuskHits[0]!.attacker.boostedStat).toBe(scene.stat);
        expect(scene.foeHits[0]!.defender.boostedStat).toBe(scene.stat);
        // The foe has no such ability.
        expect(scene.tuskHits[0]!.defender.boostedStat).toBe('');
        expect(scene.foeHits[0]!.attacker.boostedStat).toBe('');
      });
    }
    test(`${kind}: no boost without Sun or Booster Energy reads ''`, () => {
      const log = turnLog(kind, garchomp(), tusk('Leftovers'), ['dragonclaw', 'rapidspin'], 7) ?? turnLog(kind, garchomp(), tusk('Leftovers'), ['dragonclaw', 'rapidspin'], 8)!;
      expect(log).not.toMatch(/protosynthesis/);
      const hits = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === 'Great Tusk')?.hits ?? [];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(hit => hit.attacker.boostedStat === '')).toBe(true);
    });
  }
});
