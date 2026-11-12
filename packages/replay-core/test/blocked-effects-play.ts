import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex } from '../src/rules-dex';

/** Round 89 (#110): plays whole battles on @pkmn/sim for blocked-effects.spec.ts and blocked-effects-sweep.spec.ts. */

if (!Dex.formats.get('gen9championscustomgame').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

export interface PlayBody { species: string; ability: string; moves?: string[]; level?: number; /** The nickname the log shows (the species by default). */ name?: string }

export const setOf = (body: PlayBody): PokemonSet => ({
  name: body.name ?? body.species, species: body.species, item: '', ability: body.ability, moves: body.moves ?? ['Splash'], nature: 'Hardy', gender: '',
  level: body.level ?? 100, evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

export interface PlayOptions {
  format: string;
  /** Each side's bodies in team order; in doubles the first two lead. */
  p1: PlayBody[];
  p2: PlayBody[];
  /** One entry per turn: the raw `choose` text of each side. */
  turns: { p1: string; p2: string }[];
  seed?: string;
}

/** The public log of a battle played through `choose` (the `|split|` pairs reduced to the spectator's line). */
export function play(options: PlayOptions): string {
  const teams = { p1: options.p1.map(setOf), p2: options.p2.map(setOf) };
  const battle = new Battle({
    formatid: toID(options.format), seed: (options.seed ?? '1,2,3,4') as never,
    p1: { name: 'Alpha', team: Teams.pack(teams.p1) }, p2: { name: 'Beta', team: Teams.pack(teams.p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${teams.p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${teams.p2.map((_, index) => index + 1).join('')}`);
  }
  for (const turn of options.turns) {
    battle.choose('p1', turn.p1);
    battle.choose('p2', turn.p2);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}
