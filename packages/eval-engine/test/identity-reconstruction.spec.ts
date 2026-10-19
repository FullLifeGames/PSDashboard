import { describe, expect, test } from 'vitest';
import { BattleStreams, Dex, Teams, type PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';

/**
 * Round 72, T238: names the id function cannot tell apart. `toId` keeps letters and digits, so a Chinese or Japanese
 * name has the id "" and a decorated name loses its decoration; two such bodies of one side would share an id, and a
 * quote or a backslash in a name would break the team in the stream's JSON line. The holdouts of the merged wave lost
 * positions in six games of exactly these names (gen9doublesou-2693607366, gen9doublesou-2695281966,
 * gen9vgc2025regh-2437382000, gen9vgc2026regi-2574882651, gen9vgc2026regi-2575764780 and one more): the lead was
 * another body than the replay's, or the reconstruction died before the first turn.
 *
 * The oracle is the replay's own log: a game the simulator plays itself (team preview picks the leads, a body comes in
 * from the bench) is rebuilt from its spectator log as the app does, and every body the simulator brings in must come in
 * with the details the game wrote, in the same order, on the same turn, under the game's name where a lookup can use
 * that name and under the species where the build leaves it out (team-identity.ts, dropAmbiguousNicknames).
 * Singles and doubles.
 */

const set = (name: string, species: string, extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name, species, item: '', ability: 'No Ability', moves: ['Tackle', 'Dragon Tail', 'Protect'], nature: 'Serious', gender: 'F', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});

/** The spectator log of a scripted game, as a replay holds it. */
async function play(format: string, p1: PokemonSet[], p2: PokemonSet[], commands: string[]): Promise<string> {
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
function entries(lines: string, left: readonly string[] = []): string[] {
  return lines.split('\n').map(line => ENTRY.exec(line.replace(/\r$/, ''))).filter(match => match !== null)
    .map(match => {
      const split = match[2].indexOf(': ');
      const name = match[2].slice(split + 2);
      const shown = left.includes(name) ? Dex.species.get(match[3].split(', ')[0]).baseSpecies : name;
      return `${match[1]} ${match[2].slice(0, split)}: ${shown} | ${match[3]}`;
    });
}

/** The entries the simulator writes when the app rebuilds the game from its log, and the turn it stands at. */
async function rebuilt(format: string, log: string): Promise<{ entries: string[]; turn: number | undefined; errors: number }> {
  const { p1Team, p2Team } = buildTeamsFromReplay(log);
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat({ format, formatid: format } as never), p1Team, p2Team, replayLog: log, targetTurn: lastTurn(log), deadlineMs: 30_000,
  });
  return { entries: entries(runtime.log.join('\n')), turn: runtime.battleStream.battle?.turn, errors: runtime.choiceErrors.count };
}

function lastTurn(log: string): number {
  return Number([...log.matchAll(/^\|turn\|(\d+)$/gm)].at(-1)?.[1]);
}

describe('a body whose name has no id or shares it, or breaks a JSON line, comes in as the replay shows it', () => {
  test('doubles: four Japanese names, the leads are the third and the fourth, a bench body comes in', async () => {
    const format = 'gen9doublescustomgame';
    const log = await play(format,
      [set('Blossom', 'Amoonguss'), set('Mouse', 'Pikachu'), set('Sir Bench', 'Incineroar'), set('Thrower', 'Whimsicott')],
      [set('グレンタウン', 'Armarouge'), set('チョコクロワ', 'Indeedee-F'), set('うみのうた', 'Primarina'), set('ワスレイヌ', 'Houndstone')],
      ['>p1 team 1234', '>p2 team 3412', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: うみのうた\|Primarina/);
    const again = await rebuilt(format, log);
    expect(again.entries).toEqual(entries(log, ['グレンタウン', 'チョコクロワ', 'うみのうた', 'ワスレイヌ']));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);

  test('singles: Chinese names and two decorated names of one id, the lead is the fourth, three switches, one name stays', async () => {
    const format = 'gen9customgame';
    const log = await play(format,
      [set('Mouse', 'Pikachu'), set('Clef', 'Clefable')],
      [set('我大哥', 'Garchomp'), set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax'), set('Akeno【‿♥‿】', 'Clefable')],
      ['>p1 team 12', '>p2 team 4231', '>p1 move 1\n>p2 move 1', '>p1 move 1\n>p2 switch 2', '>p1 move 1\n>p2 switch 3', '>p1 move 1\n>p2 switch 4']);
    expect(log).toMatch(/\|switch\|p2a: Akeno【‿♥‿】\|Clefable/);
    const again = await rebuilt(format, log);
    expect(again.entries).toEqual(entries(log, ['我大哥', 'Rias!', 'Rias?']));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);

  test('doubles: a backslash and a quote in a name reach the simulator as written', async () => {
    const format = 'gen9doublescustomgame';
    const log = await play(format,
      [set('Blossom', 'Amoonguss'), set('Mouse', 'Pikachu')],
      [set('J36Venom/⌵\\', 'Garchomp'), set('Say "hi"', 'Dragapult'), set('Plain', 'Snorlax')],
      ['>p1 team 12', '>p2 team 123', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: J36Venom\/⌵\\\|Garchomp/);
    const again = await rebuilt(format, log);
    expect(again.entries).toEqual(entries(log, ['J36Venom/⌵\\', 'Say "hi"']));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);
});
