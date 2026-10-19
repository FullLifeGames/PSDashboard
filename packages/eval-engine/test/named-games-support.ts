import { BattleStreams, Dex, Teams, type PokemonSet } from '@pkmn/sim';
import { getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';

/**
 * Round 72, T238: games the simulator plays itself with named bodies, and the same game rebuilt by the app's
 * reconstruction. Shared by the specs that put a name the id function cannot tell apart into the simulator.
 */

export const set = (name: string, species: string, extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name, species, item: '', ability: 'No Ability', moves: ['Tackle', 'Dragon Tail', 'Protect'], nature: 'Serious', gender: 'F', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});

/** The spectator log of a scripted game, as a replay holds it. */
export async function play(format: string, p1: PokemonSet[], p2: PokemonSet[], commands: string[]): Promise<string> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const chunks: string[] = [];
  const reader = (async () => { for await (const chunk of streams.spectator) chunks.push(chunk); })();
  void streams.omniscient.write(`>start ${JSON.stringify({ formatid: format, seed: [1, 2, 3, 4] })}\n` +
    `>player p1 ${JSON.stringify({ name: 'A', team: Teams.pack(p1) })}\n>player p2 ${JSON.stringify({ name: 'B', team: Teams.pack(p2) })}`);
  for (const command of commands) void streams.omniscient.write(command);
  void streams.omniscient.writeEnd();
  await reader;
  return chunks.join('\n');
}

const ENTRY = /^\|(switch|drag|replace)\|(p[12][a-d]?: [^|]*)\|([^|]*)/;

/** Every body entry of a log in order: the command, the ident and the details without the HP; a name in `left` reads as its species. */
export function entries(lines: string, left: readonly string[] = []): string[] {
  return lines.split('\n').map(line => ENTRY.exec(line.replace(/\r$/, ''))).filter(match => match !== null)
    .map(match => {
      const split = match[2].indexOf(': ');
      const name = match[2].slice(split + 2);
      const shown = left.includes(name) ? Dex.species.get(match[3].split(', ')[0]).baseSpecies : name;
      return `${match[1]} ${match[2].slice(0, split)}: ${shown} | ${match[3]}`;
    });
}

export function lastTurn(log: string): number {
  return Number([...log.matchAll(/^\|turn\|(\d+)$/gm)].at(-1)?.[1]);
}

/** The entries the simulator writes when the reconstruction replays `log` with the given teams, and the turn it stands at. */
export async function rebuiltWith(
  format: string, log: string, p1Team: PokemonSet[], p2Team: PokemonSet[],
): Promise<{ entries: string[]; turn: number | undefined; errors: number }> {
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat({ format, formatid: format } as never), p1Team, p2Team, replayLog: log, targetTurn: lastTurn(log), deadlineMs: 30_000,
  });
  return { entries: entries(runtime.log.join('\n')), turn: runtime.battleStream.battle?.turn, errors: runtime.choiceErrors.count };
}
