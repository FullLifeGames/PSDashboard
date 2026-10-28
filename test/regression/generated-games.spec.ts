import { beforeAll, describe, expect, test } from 'vitest';
import { Battle } from '@pkmn/client';
import { BattleStreams, Dex, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { ExhaustiveRunner } from '@pkmn/sim/tools';
import { buildTeamsFromReplay, generationsFor, inferOpponentTeam, parseReplayLogWithObservations } from '@fulllifegames/replay-core';

/**
 * Round 72 (T237): the simulator's own game generator (@pkmn/sim/tools ExhaustiveRunner) as a ground truth for the inference.
 * The runner builds teams that cover every species, item, ability and move of a generation and plays them with two random AIs, so a
 * generated game has a known true team and a spectator log. Hand-picked replays hold some rules in 1 of 1,167 games (the Z-move
 * of smogtours-gen7ou-450650 was one: the build stored "Devastating Drake" as a move and a branch offered only Struggle); the
 * generator reaches every population of the Dex.
 *
 * One prefix of each format's cycle (all 16 formats of the runner: Gen 1 and 2 singles, Gen 3 to 9 singles and doubles; the
 * simulator has no Gen 1 and 2 doubles) with fixed seeds, so the games are the same on every machine for the pinned @pkmn/sim
 * (test/regression/pkmn-pins.spec.ts). Per game and per side the spec checks:
 *  - no throw: the inference, the parser and the team build run on the spectator log;
 *  - no impossible reveal: a move the inference books as `revealed` is in the Pokemon's true set (Hidden Power and Return fold);
 *  - a CRLF log gives the same inference, parse and build as its LF text;
 *  - one roster entry per body: the inferred team has as many Pokemon as the client's side has and names no species twice.
 *
 * A game whose move lines can show moves outside the set is left out of the reveal check: a move the Dex says calls another
 * move, a move line tagged `[from] move:` or `[from] ability:` (Metronome, Dancer), a transform, a copied move (Mimic, Sketch).
 * The log and the Dex decide, no list of names. A side whose generated team is illegal (a species twice, Illusion, a Z-move or Max
 * move in the set) is left out of the checks of its side.
 *
 * Limits, named: the generator's AI plays no Dynamax (0 of 76 Gen 8 games), and VGC (bring 4) is out because a Custom Game has no
 * bring rule; scripts/corpus-coverage.mjs counts both. The cycle of a format is cut to a prefix to keep the spec near a minute
 * (the full cycles are 1,316 games and about 90 s); the Gen 7 singles prefix reaches game 81, the first generated Z-move game
 * that the inference before 73d7cad read wrongly.
 */

/** Games per format: a prefix of the cycle. Gen 7 singles reaches the Z-move game 81 that the code before 73d7cad failed on. */
const PREFIX: Record<string, number> = { gen7customgame: 85 };
const DEFAULT_PREFIX = 40;

/**
 * Floors per format, 80 % of what the fixed seeds gave on 19.10.2026 (@pkmn/sim 0.10.11): sides with a legal team and revealed
 * moves in the games the reveal check reads. A simulator that changes the sequences turns a count below its floor red instead of
 * leaving the checks blind. Gen 7 and 8 teams are mostly illegal for the checks (Z-moves and Max moves in the sets).
 */
const FLOORS: Record<string, { sides: number; revealed: number }> = {
  gen9customgame: { sides: 62, revealed: 692 }, gen9doublescustomgame: { sides: 58, revealed: 619 },
  gen8customgame: { sides: 28, revealed: 157 }, gen8doublescustomgame: { sides: 28, revealed: 268 },
  gen7customgame: { sides: 37, revealed: 321 }, gen7doublescustomgame: { sides: 20, revealed: 189 },
  gen6customgame: { sides: 58, revealed: 269 }, gen6doublescustomgame: { sides: 57, revealed: 375 },
  gen5customgame: { sides: 60, revealed: 336 }, gen5doublescustomgame: { sides: 60, revealed: 339 },
  gen4customgame: { sides: 64, revealed: 365 }, gen4doublescustomgame: { sides: 63, revealed: 390 },
  gen3customgame: { sides: 64, revealed: 448 }, gen3doublescustomgame: { sides: 64, revealed: 543 },
  gen2customgame: { sides: 64, revealed: 426 }, gen1customgame: { sides: 40, revealed: 217 },
};
const floorOf = (format: string) => FLOORS[format] ?? { sides: 1, revealed: 1 };

type Teams2 = { p1: PokemonSet[]; p2: PokemonSet[] };
type Game = { log: string; teams: Teams2 };
type CreateAI = (stream: unknown, options: unknown) => { start(): Promise<void> };
type RunnerOptions = { prng: { random(n: number): number; getSeed(): [number, number, number, number] }; p1options: { team: PokemonSet[]; createAI: CreateAI }; p2options: { team: PokemonSet[]; createAI: CreateAI } };

const FORMATS = (ExhaustiveRunner as unknown as { FORMATS: string[] }).FORMATS;
const SIDES = ['p1', 'p2'] as const;

/** One generated game through the battle streams, as the simulator's own runner plays it, with the spectator log kept. */
async function play(o: RunnerOptions, format: string): Promise<Game> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const seedOf = () => [o.prng.random(0x10000), o.prng.random(0x10000), o.prng.random(0x10000), o.prng.random(0x10000)] as [number, number, number, number];
  const spec = { formatid: format, seed: o.prng.getSeed() };
  const p1 = o.p1options.createAI(streams.p1, { seed: seedOf(), ...o.p1options });
  const p2 = o.p2options.createAI(streams.p2, { seed: seedOf(), ...o.p2options });
  void p1.start();
  void p2.start();
  void streams.omniscient.write(`>start ${JSON.stringify(spec)}\n>player p1 ${JSON.stringify({ name: 'Bot 1', team: Teams.pack(o.p1options.team) })}\n>player p2 ${JSON.stringify({ name: 'Bot 2', team: Teams.pack(o.p2options.team) })}`);
  const spectator: string[] = [];
  const reading = (async () => { for await (const chunk of streams.spectator) spectator.push(String(chunk)); })();
  for await (const chunk of streams.omniscient) void chunk;
  await streams.omniscient.writeEnd();
  await reading;
  return { log: spectator.join('\n'), teams: { p1: o.p1options.team, p2: o.p2options.team } };
}

async function generate(format: string): Promise<Game[]> {
  const games: Game[] = [];
  const runner = new ExhaustiveRunner({
    format, maxGames: PREFIX[format] ?? DEFAULT_PREFIX, cycles: 1, prng: [1, 2, 3, 4], maxFailures: 3, log: false,
    runner: async (o: RunnerOptions) => { games.push(await play(o, format)); },
  } as unknown as ConstructorParameters<typeof ExhaustiveRunner>[0]);
  expect(await runner.run(), `${format}: the simulator's own runner failed on a generated game`).toBe(0);
  return games;
}

const norm = (move: string) => toID(move).replace(/^hiddenpower[a-z]+$/, 'hiddenpower').replace(/^return\d+$/, 'return');

/** A game whose move lines can show moves outside the sets, read from the log and the Dex. */
function copiesMoves(log: string): boolean {
  for (const line of log.split('\n')) {
    const p = line.split('|');
    if (p[1] === '-transform') return true;
    if (p[1] === '-activate' && Dex.moves.get(p[4] ?? '').exists) return true; // Sketch names the copied move
    if (p[1] === '-start' && Dex.moves.get(p[3] ?? '').exists && Dex.moves.get(p[4] ?? '').exists) return true; // Mimic names it too (Disable as well: a superset)
    if (p[1] === 'move' && (Dex.moves.get(p[3] ?? '').callsMove || p.some(field => /^\[from\]\s*(move|ability):/.test(field)))) return true;
  }
  return false;
}

/** The sides whose generated team the checks can read: the generator is a crash tester, not a legal team builder. */
function legalSides(format: string, game: Game): Array<(typeof SIDES)[number]> {
  const dex = Dex.forFormat(format);
  return SIDES.filter(side => {
    const sets = game.teams[side];
    const bases = sets.map(set => toID(dex.species.get(set.species).baseSpecies || set.species));
    if (new Set(bases).size !== bases.length) return false;
    if (sets.some(set => toID(set.ability) === 'illusion' || toID(set.species).startsWith('zoroark'))) return false;
    return !sets.some(set => set.moves.some(move => { const m = dex.moves.get(move); return !!(m.isZ || m.isMax); }));
  });
}

/** The client's roster of a side: one entry per body the log showed. */
function clientRoster(format: string, log: string, side: (typeof SIDES)[number]): string[] {
  const battle = new Battle(generationsFor(format));
  for (const line of log.split('\n')) if (line.startsWith('|')) battle.add(line);
  return battle[side].team.map(mon => mon.speciesForme);
}

/** The four readings of one log, each computed once for all the checks. */
type Readings = { p1: ReturnType<typeof inferOpponentTeam>; p2: ReturnType<typeof inferOpponentTeam>; parsed: ReturnType<typeof parseReplayLogWithObservations>; built: ReturnType<typeof buildTeamsFromReplay> };
const readings = new WeakMap<Game, Readings>();
function readingsOf(game: Game): Readings {
  let found = readings.get(game);
  if (!found) {
    found = { p1: inferOpponentTeam(game.log, 'p1'), p2: inferOpponentTeam(game.log, 'p2'), parsed: parseReplayLogWithObservations(game.log), built: buildTeamsFromReplay(game.log) };
    readings.set(game, found);
  }
  return found;
}

/** The CRLF check reads every CRLF_EVERY-th game: the readers fold line endings at their door, so the text does not matter to them. */
const CRLF_EVERY = 4;

const baseOf = (format: string, species: string) => toID(Dex.forFormat(format).species.get(species).baseSpecies || species);

describe.each(FORMATS)('generated games, %s', format => {
  let games: Game[] = [];
  beforeAll(async () => { games = await generate(format); }, 120_000);

  test('the cycle reaches the populations the checks need', () => {
    const wanted = PREFIX[format] ?? DEFAULT_PREFIX;
    expect(games.length, `${format}: games played`).toBeGreaterThanOrEqual(Math.min(wanted, 25));
    const sides = games.reduce((sum, game) => sum + legalSides(format, game).length, 0);
    expect(sides, `${format}: sides with a legal generated team`).toBeGreaterThanOrEqual(floorOf(format).sides);
    if (/^gen7(doubles)?customgame$/.test(format)) {
      expect(games.filter(game => game.log.includes('[zeffect]')).length, `${format}: the generator no longer reaches the Z-move population`).toBeGreaterThan(0);
    }
  });

  test('no throw: the inference, the parser and the build read every generated log', () => {
    const thrown: string[] = [];
    games.forEach((game, index) => {
      try { readingsOf(game); } catch (error) { thrown.push(`game ${index}: ${String(error).slice(0, 160)}`); }
    });
    expect(thrown).toEqual([]);
  });

  test('no impossible reveal: a revealed move is in the true set', () => {
    const impossible: string[] = [];
    let revealed = 0;
    games.forEach((game, index) => {
      if (copiesMoves(game.log)) return;
      for (const side of legalSides(format, game)) {
        for (const info of readingsOf(game)[side].pokemon) {
          const truth = game.teams[side].find(set => toID(set.species) === toID(info.species) || toID(set.name) === toID(info.species));
          if (!truth) continue;
          const known = new Set(truth.moves.map(norm));
          for (const move of info.moves.filter(m => m.source === 'revealed')) {
            revealed++;
            if (!known.has(norm(move.name))) impossible.push(`game ${index} ${side} ${info.species}: ${move.name} is revealed but not in the true set`);
          }
        }
      }
    });
    expect(revealed, `${format}: revealed moves checked`).toBeGreaterThanOrEqual(floorOf(format).revealed);
    expect(impossible).toEqual([]);
  });

  test('a CRLF log gives the same inference, parse and build as its LF text', () => {
    games.filter((_, index) => index % CRLF_EVERY === 0).forEach(game => {
      const lf = readingsOf(game);
      const crlf = game.log.replace(/\n/g, '\r\n');
      for (const side of SIDES) expect(inferOpponentTeam(crlf, side)).toEqual(lf[side]);
      expect(parseReplayLogWithObservations(crlf)).toEqual(lf.parsed);
      expect(buildTeamsFromReplay(crlf)).toEqual(lf.built);
    });
  });

  test('one roster entry per body: the inferred team matches the client\'s roster', () => {
    const wrong: string[] = [];
    games.forEach((game, index) => {
      for (const side of legalSides(format, game)) {
        const species = readingsOf(game)[side].pokemon.map(info => baseOf(format, info.species));
        const roster = clientRoster(format, game.log, side);
        if (species.length !== roster.length) wrong.push(`game ${index} ${side}: ${species.length} inferred, ${roster.length} in the client roster`);
        if (new Set(species).size !== species.length) wrong.push(`game ${index} ${side}: a species twice in ${species.join(',')}`);
      }
    });
    expect(wrong).toEqual([]);
  });
});
