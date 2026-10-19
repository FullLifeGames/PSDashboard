import { describe, expect, test } from 'vitest';
import { Battle, BattleStreams, Teams, type PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay } from '@fulllifegames/replay-core';

/**
 * Round 72, T238: scenes the simulator writes itself. A game of the simulator, played through its battle stream, yields
 * the spectator log (the log a replay holds: no `shiny` on `|poke|` lines, the disguise of an Illusion on the field).
 * The teams built from that log must switch in with the lines the game wrote: the body that entered as
 * `|switch|p1a: NOT ICT|Landorus-Therian, L50, M, shiny|` exists in the branch battle with that name and those details,
 * for singles and for doubles, from a switch, a drag and a replace, through an Illusion, a Transform and a team preview
 * that leaves two bodies out. A body the log never shows keeps the species as its name and no shiny: the line a replay
 * would have written for it.
 */

const set = (name: string, species: string, extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name, species, item: '', ability: 'No Ability', moves: ['Tackle', 'Dragon Tail', 'Transform'], nature: 'Serious', gender: '', level: 100,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});

/** The spectator log of a scripted game: each command line is written to the omniscient stream in order. */
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

const ENTRY = /^\|(?:switch|drag|replace)\|(p[12])[a-d]?: ([^|]*)\|([^|]*)/;

/** The entry lines the game wrote that no body of the branch battle reproduces by name and details. */
function unreproduced(log: string, format: string): string[] {
  const { p1Team, p2Team } = buildTeamsFromReplay(log);
  const battle = new Battle({
    formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1Team) }, p2: { name: 'B', team: Teams.pack(p2Team) },
  });
  const missing: string[] = [];
  for (const raw of log.split('\n')) {
    const entry = ENTRY.exec(raw);
    if (!entry) continue;
    const details = entry[3].replace(/, tera:\w+/, '');
    if (!battle.sides[entry[1] === 'p1' ? 0 : 1].pokemon.some(body => body.name === entry[2] && body.details === details)) missing.push(raw);
  }
  return missing;
}

/** The sets the build made for one side, by species. */
function builtSide(log: string, side: 'p1' | 'p2'): Record<string, { name: string; shiny: boolean }> {
  const built = buildTeamsFromReplay(log);
  return Object.fromEntries((side === 'p1' ? built.p1Team : built.p2Team).map(mon => [mon.species, { name: mon.name, shiny: !!mon.shiny }]));
}

describe('scenes the simulator wrote: the built sets switch in with the same lines', () => {
  test('singles: a lead, a switch and a drag, nickname, shiny, gender and level 50', async () => {
    const format = 'gen9customgame';
    const log = await play(format,
      [set('NOT ICT', 'Landorus-Therian', { level: 50, shiny: true, gender: 'M' }), set('Mouse', 'Pikachu', { gender: 'F' })],
      [set('Bitey', 'Garchomp', { level: 50, gender: 'F', shiny: true }), set('Clef', 'Clefable', { gender: 'F', level: 50 })],
      ['>p1 team 12', '>p2 team 12', '>p1 move 1\n>p2 move 2', '>p1 switch 2\n>p2 move 1', '>p1 move 1\n>p2 move 1']);
    expect(log).toMatch(/\|switch\|p1a: NOT ICT\|Landorus-Therian, L50, M, shiny\|/);
    expect(log).toMatch(/\|drag\|p1a: Mouse\|Pikachu, F\|/);
    expect(unreproduced(log, format)).toEqual([]);
    expect(builtSide(log, 'p1')['Landorus-Therian']).toEqual({ name: 'NOT ICT', shiny: true });
    expect(builtSide(log, 'p2').Garchomp).toEqual({ name: 'Bitey', shiny: true });
  });

  test('doubles: four bodies on a side, a switch from the bench and a drag', async () => {
    const format = 'gen9doublescustomgame';
    const log = await play(format,
      [set('Blossom', 'Amoonguss', { level: 50, gender: 'F', shiny: true }), set('Mouse', 'Pikachu', { gender: 'M', level: 50 }),
        set('Sir Bench', 'Incineroar', { level: 50, gender: 'M' }), set('Thrower', 'Whimsicott', { level: 50, gender: 'F', shiny: true })],
      [set('Bitey', 'Garchomp', { level: 50, gender: 'F' }), set('Fox', 'Zorua', { level: 50, gender: 'M', shiny: true }),
        set('Heavy', 'Snorlax', { level: 50, gender: 'F' }), set('Jelly', 'Tentacruel', { level: 50, gender: 'M' })],
      ['>p1 team 1234', '>p2 team 1234', '>p1 move 1 1, move 1 1\n>p2 move 2 1, move 1 1', '>p1 switch 3, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1']);
    expect(log).toMatch(/\|switch\|p1a: Blossom\|Amoonguss, L50, F, shiny\|/);
    expect(unreproduced(log, format)).toEqual([]);
    expect(builtSide(log, 'p1').Incineroar).toEqual({ name: 'Sir Bench', shiny: false });
    // Whimsicott stayed on the bench: no line shows it, so its set keeps the species and no shiny flag.
    expect(builtSide(log, 'p1').Whimsicott).toEqual({ name: 'Whimsicott', shiny: false });
    expect(builtSide(log, 'p2').Zorua).toEqual({ name: 'Fox', shiny: true });
  });

  test('Illusion: the disguise books to the body it shows, the replace line gives the Zoroark its own name', async () => {
    const format = 'gen9customgame';
    const log = await play(format,
      [set('Mouse', 'Pikachu', { gender: 'F', level: 50 }), set('Fox', 'Zoroark', { gender: 'F', level: 50, shiny: true, ability: 'Illusion' }), set('Clef', 'Clefable', { gender: 'F', level: 50 })],
      [set('Bitey', 'Garchomp', { level: 50, gender: 'M', moves: ['Tackle', 'Dragon Claw'] })],
      ['>p1 team 123', '>p2 team 1', '>p1 move 1\n>p2 move 1', '>p1 switch 2\n>p2 move 1', '>p1 move 1\n>p2 move 2']);
    expect(log).toMatch(/\|switch\|p1a: Clef\|Clefable, L50, F\|/);
    expect(log).toMatch(/\|replace\|p1a: Fox\|Zoroark, L50, F, shiny$/m);
    expect(unreproduced(log, format)).toEqual([]);
    expect(builtSide(log, 'p1').Zoroark).toEqual({ name: 'Fox', shiny: true });
  });

  test('Transform: Ditto keeps its ident and details, and the target keeps its own', async () => {
    const format = 'gen9doublescustomgame';
    const log = await play(format,
      [set('Blob', 'Ditto', { level: 50, shiny: true }), set('Mouse', 'Pikachu', { gender: 'F', level: 50 })],
      [set('Bitey', 'Garchomp', { level: 50, gender: 'M' }), set('Clef', 'Clefable', { gender: 'F', level: 50 })],
      ['>p1 team 12', '>p2 team 12', '>p1 move 3 1, move 1 1\n>p2 move 1 1, move 1 1']);
    expect(log).toMatch(/\|-transform\|p1a: Blob\|/);
    expect(unreproduced(log, format)).toEqual([]);
    expect(builtSide(log, 'p1').Ditto).toEqual({ name: 'Blob', shiny: true });
  });

  test('team preview: four of six brought, the two left out keep the species and no shiny', async () => {
    const format = 'gen9doublescustomgame@@@Picked Team Size = 4';
    const team = (prefix: string, species: string[]) => species.map((one, index) => set(`${prefix} ${index}`, one, { level: 50, gender: 'F', shiny: index % 2 === 0 }));
    const log = await play(format,
      team('Mine', ['Amoonguss', 'Pikachu', 'Incineroar', 'Whimsicott', 'Rillaboom', 'Gholdengo']),
      team('Their', ['Garchomp', 'Zorua', 'Snorlax', 'Tentacruel', 'Clefable', 'Dragapult']),
      ['>p1 team 1234', '>p2 team 1234', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1']);
    expect(log.match(/^\|poke\|p1\|/gm)).toHaveLength(6);
    expect(unreproduced(log, format)).toEqual([]);
    const mine = builtSide(log, 'p1');
    expect(mine.Amoonguss).toEqual({ name: 'Mine 0', shiny: true });
    // Rillaboom (index 4) and Gholdengo (index 5) never entered: the preview line carries no name and no shiny flag.
    expect(mine.Rillaboom).toEqual({ name: 'Rillaboom', shiny: false });
    expect(mine.Gholdengo).toEqual({ name: 'Gholdengo', shiny: false });
  });
});
