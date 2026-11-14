import { Dex, TeamValidator } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';

/**
 * Round 89 (lane H, #105): a legal team for any format of the simulator's registry, found the way the simulator itself judges
 * one: a species is a candidate when its own learnset gives four moves of the format's generation and the validator accepts
 * the set alone; a prefix of candidates is kept while the validator accepts the whole team (Monotype, Species Clause and the
 * like are team rules). The helper holds no species or move names: it reads the Dex as the oracle (a spec may).
 */

/** Formats the sweep plays: a user's own team, singles or doubles, no generated team. */
export function playableFormatIds(): string[] {
  return Dex.formats.all()
    .filter(format => format.effectType === 'Format' && !format.team && (format.gameType === 'singles' || format.gameType === 'doubles'))
    .map(format => format.id);
}

function candidateSet(dex: ReturnType<typeof Dex.forFormat>, speciesId: string, generation: number, level: number): PokemonSet | null {
  const species = dex.species.get(speciesId);
  if (!species.exists || species.battleOnly || species.isNonstandard === 'CAP' || species.gen > generation) return null;
  const learnset = dex.species.getLearnsetData(species.id).learnset;
  if (!learnset) return null;
  const moves: string[] = [];
  for (const [moveId, sources] of Object.entries(learnset)) {
    const move = dex.moves.get(moveId);
    if (!move.exists || move.isNonstandard || move.isZ || move.isMax) continue;
    if (!sources.some(source => source.startsWith(`${generation}`))) continue;
    moves.push(move.name);
    if (moves.length === 4) break;
  }
  if (moves.length === 0) return null;
  const ability = generation >= 3 ? species.abilities['0'] : '';
  return {
    name: species.baseSpecies, species: species.name, item: '', ability, moves, nature: generation >= 3 ? 'Hardy' : '', gender: '',
    evs: { hp: 1, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level,
  };
}

/** Two legal teams for the format (the sides play different bodies), or the problems of the closest attempt. */
export function legalTeams(formatId: string): { p1: PokemonSet[]; p2: PokemonSet[] } | { problems: string[] } {
  const plain = legalTeamsOf(formatId, null);
  if (!('problems' in plain)) return plain;
  // A team rule that shares a type (Monotype): the same search over the bodies of one type, each type in turn.
  for (const type of Dex.forFormat(Dex.formats.get(formatId)).types.names()) {
    const typed = legalTeamsOf(formatId, type);
    if (!('problems' in typed)) return typed;
  }
  return plain;
}

function legalTeamsOf(formatId: string, type: string | null): { p1: PokemonSet[]; p2: PokemonSet[] } | { problems: string[] } {
  const format = Dex.formats.get(formatId);
  const dex = Dex.forFormat(format);
  const ruleTable = Dex.formats.getRuleTable(format);
  const generation = dex.gen;
  const level = Math.max(1, Math.min(ruleTable.defaultLevel, ruleTable.maxLevel));
  const size = Math.min(6, Math.max(ruleTable.maxTeamSize, 1), Math.max(ruleTable.minTeamSize, 6));
  const validator = TeamValidator.get(formatId);
  const clone = (team: PokemonSet[]) => JSON.parse(JSON.stringify(team)) as PokemonSet[];
  const candidates: PokemonSet[] = [];
  let problems: string[] = [];
  for (const species of dex.species.all()) {
    if (type && !species.types.includes(type)) continue;
    const set = candidateSet(dex, species.id, generation, level);
    if (!set) continue;
    const alone = validator.validateSet(clone([set])[0], {});
    if (alone) { problems = alone; continue; }
    candidates.push(set);
    if (candidates.length === 80) break;
  }
  // Team rules (Monotype, Species Clause): grow a team one body at a time while the whole team stays legal.
  const teams: PokemonSet[][] = [];
  const used = new Set<PokemonSet>();
  for (let attempt = 0; attempt < 2; attempt++) {
    let team: PokemonSet[] = [];
    for (const set of candidates) {
      if (used.has(set)) continue;
      const next = [...team, set];
      const whole = validator.validateTeam(clone(next));
      // A team below the format's size reports the missing bodies only; any other problem drops the candidate.
      if (whole && next.length >= size) { problems = whole; continue; }
      if (whole && whole.some(problem => !/(at least|must bring|have|bring) /i.test(problem))) { problems = whole; continue; }
      team = next;
      if (team.length === size) break;
    }
    if (team.length < size || validator.validateTeam(clone(team))) return { problems };
    team.forEach(set => used.add(set));
    teams.push(team);
  }
  return { p1: teams[0], p2: teams[1] };
}
