import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PokemonSet } from '@pkmn/sim';
import { ExhaustiveRunner } from '@pkmn/sim/tools';

/** Team texts for team-text.spec.ts and sheet-text.spec.ts (round 72, T241): the fixtures' own, and the simulator's generated teams. */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE_DIRS = [
  'packages/replay-core/test/fixtures',
  'test/regression/fixtures',
  'packages/eval-engine/test/fixtures',
  'packages/eval-engine/test/fixtures/champions',
  'test/e2e/fixtures',
];

const decodeEntities = (text: string) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
  .replace(/&#(\d+);/g, (_, value: string) => String.fromCharCode(parseInt(value, 10)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The "View team" exports and the `|showteam|` sides of every fixture replay. */
export function fixtureTexts(): { exports: Array<{ tag: string; text: string }>; sheets: Array<{ tag: string; log: string; side: 'p1' | 'p2' }> } {
  const exports: Array<{ tag: string; text: string }> = [];
  const sheets: Array<{ tag: string; log: string; side: 'p1' | 'p2' }> = [];
  for (const dir of FIXTURE_DIRS) {
    if (!existsSync(`${root}${dir}`)) continue;
    for (const name of readdirSync(`${root}${dir}`)) {
      if (!name.endsWith('.json')) continue;
      let parsed: { log?: unknown };
      try { parsed = JSON.parse(readFileSync(`${root}${dir}/${name}`, 'utf8')); } catch { continue; }
      if (typeof parsed.log !== 'string') continue;
      const log = parsed.log.replace(/\r\n?/g, '\n');
      for (const line of log.split('\n')) {
        const chat = line.match(/^\|c\|([^|]+)\|\/raw\s+([\s\S]+)$/);
        if (!chat || !chat[2].includes('<summary>View team</summary>')) continue;
        const body = chat[2].match(/<summary>View team<\/summary>([\s\S]*?)<\/details>/i)?.[1] ?? chat[2];
        exports.push({ tag: `${dir}/${name}`, text: decodeEntities(body).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(new RegExp(String.fromCharCode(160), 'g'), ' ').trim() });
      }
      for (const side of ['p1', 'p2'] as const) if (log.includes(`|showteam|${side}|`)) sheets.push({ tag: `${dir}/${name}`, log, side });
    }
  }
  return { exports, sheets };
}

/** The simulator's own team generator (ExhaustiveRunner), per generation: nicknames are absent, everything else is random. */
export async function generatedTeams(gen: number, games: number): Promise<PokemonSet[][]> {
  const teams: PokemonSet[][] = [];
  const runner = new ExhaustiveRunner({
    format: `gen${gen}customgame`, maxGames: games, cycles: 1, prng: [1, 2, 3, gen], maxFailures: 3, log: false,
    runner: async (options: { p1options: { team: PokemonSet[] }; p2options: { team: PokemonSet[] } }) => {
      teams.push(options.p1options.team, options.p2options.team);
    },
  } as ConstructorParameters<typeof ExhaustiveRunner>[0]);
  await runner.run();
  return teams;
}

/** A team with the awkward corners a generator leaves out: nickname, gender, shiny, level, Tera type, typed Hidden Power, no EVs. */
export function withCorners(team: PokemonSet[]): PokemonSet[] {
  return team.map((set, i) => {
    const copy: PokemonSet = { ...set, moves: [...set.moves] };
    if (i % 2 === 0) Object.assign(copy, { name: `Nick ${i}`, gender: i % 4 === 0 ? 'F' : 'M', shiny: true, level: 50 + i });
    if (i === 1) copy.teraType = 'Fairy';
    if (i === 2) copy.moves = ['Hidden Power Ice', ...copy.moves.slice(1)];
    if (i === 3) { delete (copy as Partial<PokemonSet>).evs; delete (copy as Partial<PokemonSet>).ivs; }
    return copy;
  });
}

export const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
