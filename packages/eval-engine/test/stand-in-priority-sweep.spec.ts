import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { getMainChoice } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf, FixedDice } from '../src/sim-ask/copy';
import { queuePlace, actionPriority, activated } from '../src/sim-ask/action-order';
import { fingerprint, setAskCheck } from '../src/sim-ask/guard';
import { CHAMPIONS, mon, playClicks, RULES, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { rulesDex } from '@fulllifegames/replay-core';

/**
 * Round 89 (#111), lane C, step C2: the stand-in move and the cant order read the simulator's priority, not the Dex's. A body
 * whose ability, item or move changes its action's priority (Prankster, Gale Wings, Triage and Grassy Glide through ModifyPriority;
 * Stall, Lagging Tail, Full Incense, Custap Berry, Quick Claw, Quick Draw and Mycelium Might through FractionalPriority; a Generation 4
 * Quick Claw through its `onBeforeTurn` event and a Generation 3 one through the battle's speed roll) moves its stand-in ahead of or behind a
 * foe's logged action in the simulator, where the Dex bracket says it stays. The census finds every such entry in the Dex of each rule
 * set the corpus plays (Gens 1 to 9 and the Champions mod); no name stands in this file. The oracle is the simulator: one turn played on
 * a copy with the dice answering the chance (no, or yes when the log shows the activation), singles and doubles in every rule set
 * (VGC plays the doubles rows, its bench of four does not reach the queue; the reported rows below run it apart):
 * - `actionPriority` and `queuePlace` equal the simulator's order of a move against a foe at each priority bracket, for every entry,
 *   every probe move (a plain move of each category, flying, draining or healing group of the Dex), and both answers of the dice; and the
 *   live battle comes out of every question as it went in (`fingerprint`, with the ask check on);
 * - `activated` reads the chance answer from the lines and the Dex entry, and answers no without an activation of the body's own item or ability;
 * - the stand-in of a body whose log shows no action takes the move that is last in the simulator's order, with no cut at 0 (a body of
 *   priority moves only takes its slowest of them), whichever side holds the entry; the Encore stand-in keeps its cut at 0 by the simulator's
 *   priority; the cant stand-in stays ahead of every logged action after the line and behind those before it, by the simulator's order,
 *   with the entry on the body or on the foe whose action the log shows.
 * A plain run plays every entry; the probe moves and the Dex census of moves read a fixed sample, `DICE_SWEEPS=full` every one.
 */
await loadSimMods('gen9championsou');
vi.setConfig({ testTimeout: 600_000 });

const summaries: string[] = [];
afterAll(() => {
  setAskCheck(null);
  if (process.env.DICE_SWEEP_LOG) writeFileSync(process.env.DICE_SWEEP_LOG, summaries.join('\n') + '\n', 'utf8');
});

/** The targets whose click needs no more than `move N` (or `move N 1` at a foe in doubles) and whose move the simulator announces. */
const AIMED = new Set(['normal']);
const CLICKABLE = new Set(['normal', 'self', 'all', 'allAdjacentFoes', 'allAdjacent', 'scripted']);

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = RULES.flatMap(rules => [
  { rules, mode: 'singles' as const, vgc: false, name: `${rules.name} singles` },
  ...(rules.doubles ? [{ rules, mode: 'doubles' as const, vgc: false, name: `${rules.name} doubles` }] : []),
]);
type Case = typeof CASES[number];

type Dex = ReturnType<typeof dexOfRules>;
type Kind = 'ability' | 'item' | 'move';
interface Entry { kind: Kind; id: string }
type Variant = 'plain' | 'low' | 'grassy';
type Holder = 'body' | 'foe';
interface Scene { entry: Entry | null; holder: Holder; variant: Variant }

const reachesOrder = (entry: { onModifyPriority?: unknown; onFractionalPriority?: unknown; onCustap?: unknown }): boolean =>
  entry.onModifyPriority !== undefined || entry.onFractionalPriority !== undefined || entry.onCustap !== undefined;
type Listed = { exists: boolean; id: string; gen: number; isNonstandard?: string | null };
const listed = (dex: Dex, entry: Listed): boolean => entry.exists && entry.gen <= dex.gen && (entry.isNonstandard == null || entry.isNonstandard === 'Past');

/**
 * Every ability, item and move of the rule set's Dex with a handler the queue reads for the order. Generation 3's Quick Claw has none (the
 * battle's speed roll is read in `getActionSpeed`): the items that the Generation 4 Dex gives an `onCustap` event are added for the rule sets before it.
 */
function entriesOf(rules: Rules): Entry[] {
  const dex = dexOfRules(rules);
  const out: Entry[] = [];
  for (const ability of dex.abilities.all()) if (listed(dex, ability) && reachesOrder(ability as never)) out.push({ kind: 'ability', id: ability.id });
  for (const item of dex.items.all()) if (listed(dex, item) && reachesOrder(item as never)) out.push({ kind: 'item', id: item.id });
  for (const move of dex.moves.all()) if (listed(dex, move) && reachesOrder(move as never)) out.push({ kind: 'move', id: move.id });
  if (rules.generation < 4) {
    for (const item of rulesDex(4).items.all()) {
      const own = dex.items.get(item.id);
      if (listed(rulesDex(4), item) && (item as never as { onCustap?: unknown }).onCustap !== undefined && listed(dex, own) && !out.some(entry => entry.id === own.id)) out.push({ kind: 'item', id: own.id });
    }
  }
  return out;
}

const clickOf = (c: Case, target: string, aim: number): string =>
  c.mode === 'singles' ? 'move 1' : `move 1${AIMED.has(target) ? ` ${aim}` : ''}, move 1`;

const clickable = (dex: Dex): DexMove[] => dex.moves.all().filter((move: DexMove) => move.exists && !move.isZ && !move.isMax
  && move.gen <= dex.gen && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past')
  && CLICKABLE.has(move.target) && !move.flags.charge && !move.flags.futuremove);

/**
 * The board: Snorlax (or `bodySpecies`) with `moves` against Pikachu (or `foeSpecies`) with `foeMoves`; the scene's entry sits on the holder;
 * doubles add two splashers. Round 89 (#111): a row that names a species whose own abilities carry the entry (Comfey and Triage) passes it.
 */
function boardOf(c: Case, moves: string[], foeMoves: string[], scene: Scene, foeSpecies = 'Pikachu', bodySpecies = 'Snorlax'): Battle {
  const splash = (species: string) => mon(c.rules, { species, moves: ['splash'] });
  const worn = (holder: Holder): { ability?: string; item?: string } => {
    if (scene.holder !== holder || !scene.entry) return {};
    return scene.entry.kind === 'ability' ? { ability: scene.entry.id } : scene.entry.kind === 'item' ? { item: scene.entry.id } : {};
  };
  const body = { ...mon(c.rules, { species: bodySpecies, moves, gender: 'M' }), ...worn('body') };
  const foe = { ...mon(c.rules, { species: foeSpecies, moves: foeMoves }), ...worn('foe') };
  const bench = c.vgc ? ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'].map(splash) : [];
  const p1 = c.mode === 'singles' ? [body] : [body, splash('Blissey'), ...bench];
  const p2 = c.mode === 'singles' ? [foe] : [foe, splash('Vaporeon'), ...bench];
  const board = battleOf(c.mode === 'doubles' ? c.rules.doubles! : c.rules.singles, p1, p2);
  const holder = board.sides[scene.holder === 'body' ? 0 : 1].active[0];
  if (scene.variant === 'low') holder.hp = Math.floor(holder.maxhp / 4);
  if (scene.variant === 'grassy') board.field.setTerrain('grassyterrain', holder);
  return board;
}

/** The dice the question plays under: every chance answers `chance`; Generation 3's speed roll too. */
function playsAs(board: Battle, chance: boolean): Battle {
  const copy = copyOf(board);
  copy.prng = new FixedDice({ chance });
  if (copy.gen === 3) copy.quickClawRoll = chance;
  return copy;
}

/**
 * One turn on a copy under the answer of the dice: whether the body's action line (its move, or the `|cant|` that stops it) stands before
 * the foe's in the log, and whether the scene's holder shows an activation of its item or ability (`|-activate|` with `item:` or `ability:`).
 */
function playedTurn(c: Case, scene: Scene, bodyMove: string, foeMove: string, chance: boolean, foeSpecies = 'Pikachu'): { before: boolean; activation: boolean } {
  const board = boardOf(c, [bodyMove], [foeMove], scene, foeSpecies);
  const copy = playsAs(board, chance);
  const start = copy.log.length;
  const dex = board.dex;
  playClicks(copy, { p1: clickOf(c, dex.moves.get(bodyMove).target, 1), p2: clickOf(c, dex.moves.get(foeMove).target, 1) });
  const lines = copy.log.slice(start);
  const own = lines.findIndex(line => /^\|(move|cant)\|p1a/.test(line));
  const foe = lines.findIndex(line => /^\|(move|cant)\|p2a/.test(line));
  const side = scene.holder === 'body' ? 'p1a' : 'p2a';
  return { before: own >= 0 && (foe < 0 || own < foe), activation: lines.some(line => line.startsWith(`|-activate|${side}:`) && /\|(item|ability): /.test(line)) };
}

/** Whether the simulator takes the move as the body's click. */
function accepted(c: Case, move: DexMove): boolean {
  const board = boardOf(c, [move.id], ['splash'], { entry: null, holder: 'body', variant: 'plain' });
  const probe = copyOf(board);
  probe.prng ??= board.prng.clone();
  // a move that is disabled alone (Belch before a berry) leaves Struggle as the request's only click: the simulator takes `move 1`, but the body cannot use the move
  if (board.sides[0].active[0].getMoveRequestData().moves[0]?.id !== move.id) return false;
  return probe.choose('p1', clickOf(c, move.target, 1)) && probe.choose('p2', c.mode === 'singles' ? 'move 1' : 'move 1, move 1');
}

/** The first move of each Dex priority bracket of the rule set that the simulator takes as a click. */
function bracketsOf(c: Case): Map<number, string> {
  const out = new Map<number, string>();
  for (const move of clickable(dexOfRules(c.rules))) {
    if (!out.has(move.priority) && accepted(c, move)) out.set(move.priority, move.id);
  }
  return out;
}

/**
 * The probe moves: the first move at priority 0 that the simulator takes, of each group of category, flying type and drain or heal.
 * The groups are the Dex's own: Prankster reaches the status group, Gale Wings the flying group, Triage the draining and healing ones.
 */
function probesOf(c: Case): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const move of clickable(dexOfRules(c.rules))) {
    if (move.priority !== 0) continue;
    const group = `${move.category}|${move.type === 'Flying'}|${!!move.drain}|${!!move.flags.heal}`;
    if (seen.has(group) || !accepted(c, move)) continue;
    seen.add(group);
    out.push(move.id);
  }
  return out;
}

const SCENES = (entry: Entry): { variant: Variant; label: string }[] =>
  entry.kind === 'move' ? [{ variant: 'plain', label: 'no terrain' }, { variant: 'grassy', label: 'Grassy Terrain' }]
    : [{ variant: 'plain', label: 'full HP' }, { variant: 'low', label: 'a quarter HP' }];

const WINDOW = (priorities: number[]): number[] => priorities.filter(q => q >= -1 && q <= 4);
const CANT = '|cant|p1a: Snorlax|flinch';
const foeLine = (species: string, moveName: string, from = 'p1a: Snorlax'): string => `|move|p2a: ${species}|${moveName}|${from}`;
const NAMES = rulesDex(9);
const activation = (side: 'p1a' | 'p2a', name: string, entry: Entry): string =>
  `|-activate|${side}: ${name}|${entry.kind}: ${(entry.kind === 'item' ? NAMES.items : NAMES.abilities).get(entry.id).name}`;
const PLAIN: Scene = { entry: null, holder: 'body', variant: 'plain' };

describe.each(CASES)('the priority a stand-in reads: $name', c => {
  const entries = entriesOf(c.rules);
  const dex = dexOfRules(c.rules);
  const brackets = bracketsOf(c);
  const priorities = [...brackets.keys()].sort((a, b) => b - a);
  const rep = (priority: number): string => brackets.get(priority)!;
  const probes = probesOf(c);
  const table = new Map<string, { before: boolean; activation: boolean }>();
  const played = (scene: Scene, bodyMove: string, foeMove: string, chance: boolean, foeSpecies = 'Pikachu') => {
    const key = `${scene.entry?.id}|${scene.holder}|${scene.variant}|${bodyMove}>${foeMove}>${foeSpecies}>${chance}`;
    if (!table.has(key)) table.set(key, playedTurn(c, scene, bodyMove, foeMove, chance, foeSpecies));
    return table.get(key)!;
  };
  /** Does the body's `bodyMove` stand before the foe's `foeMove` in the simulator's turn (the scene's entry on its holder, the dice answering `chance`)? */
  const before = (scene: Scene, bodyMove: string, foeMove: string, chance: boolean, foeSpecies = 'Pikachu'): boolean =>
    played(scene, bodyMove, foeMove, chance, foeSpecies).before;
  /**
   * Can a log show this answer? The activation lines of the log are the simulator's own: a turn with the answer yes shows an activation of the holder's
   * item or ability (a Quick Claw, a Quick Draw, a Custap Berry, which fires by the holder's HP and not by the dice), a turn with the answer no shows none.
   * Generation 3's Quick Claw writes no line in the simulator (the speed roll sits in `getActionSpeed`; the game's log shows one), so both answers stand.
   */
  const consistent = (scene: Scene, bodyMove: string, foeMove: string, chance: boolean, foeSpecies = 'Pikachu'): boolean =>
    c.rules.generation === 3 || played(scene, bodyMove, foeMove, chance, foeSpecies).activation === chance;
  const sceneOf = (entry: Entry, variant: Variant, holder: Holder = 'body'): Scene => ({ entry, holder, variant });
  /** The rank of a move of the body: the number of brackets of a plain foe it stands ahead of (the foe is faster at a tie). Higher is earlier. */
  const rankOf = (scene: Scene, move: string, chance: boolean, foeSpecies = 'Pikachu'): number =>
    priorities.filter(q => before(scene, move, rep(q), chance, foeSpecies)).length;

  test('the Dex census finds the entries the queue reads', () => {
    summaries.push(`${c.name}: ${entries.length} entries ${entries.map(entry => `${entry.kind}:${entry.id}`).join(' ')}; probes ${probes.join(' ')}`);
    if (c.rules.generation >= 5) expect(entries.length, 'a rule set from Generation 5 has handlers').toBeGreaterThan(3);
    expect(entries.every(entry => dex[entry.kind === 'ability' ? 'abilities' : entry.kind === 'item' ? 'items' : 'moves'].get(entry.id).exists)).toBe(true);
  });

  test('actionPriority and queuePlace equal the simulator against every bracket, and the live battle comes out unchanged', () => {
    setAskCheck(true);
    const problems: string[] = [];
    let rows = 0;
    let moved = 0;
    try {
      for (const entry of entries) {
        for (const { variant, label } of SCENES(entry)) {
          const scene = sceneOf(entry, variant);
          for (const move of entry.kind === 'move' ? [entry.id] : sweepSelection(probes, 'rows')) {
            const board = boardOf(c, [move], ['splash'], scene);
            const body = board.sides[0].active[0];
            const live = fingerprint(board);
            const foeSpeed = board.sides[1].active[0].getActionSpeed();
            const speeds = new Set<number>();
            for (const chance of [false, true]) {
              if (!consistent(scene, move, rep(0), chance)) continue;
              const order = queuePlace(board, body, move, chance);
              speeds.add(order.speed);
              if (actionPriority(board, body, move, chance) !== order.priority) problems.push(`${entry.id} ${move}: actionPriority differs from queuePlace`);
              if (order.priority !== dex.moves.get(move).priority) moved++;
              for (const q of WINDOW(priorities)) {
                const expected = order.priority > q || (order.priority === q && order.speed > foeSpeed);
                const got = before(scene, move, rep(q), chance);
                rows++;
                if (got !== expected) problems.push(`${entry.id} (${label}) ${move}, dice ${chance}, against ${rep(q)} (${q}): the simulator ${got}, queuePlace ${expected} (${order.priority}, ${order.speed} against ${foeSpeed})`);
              }
            }
            if (speeds.size > 1) moved++;
            if (fingerprint(board) !== live) problems.push(`${entry.id} ${move}: the live battle changed`);
          }
        }
      }
    } finally {
      setAskCheck(null);
    }
    summaries.push(`${c.name}: ${rows} order rows over ${entries.length} entries, ${moved} answers off the Dex priority`);
    if (c.rules.generation >= 3) expect(moved, 'the sweep has rows where the entry moves the order').toBeGreaterThan(0);
    expect(problems.slice(0, 12)).toEqual([]);
  });

  test('activated reads the answer from the body\'s own line and the Dex: yes where the dice move the action, no without a line', () => {
    const problems: string[] = [];
    let yes = 0;
    for (const entry of entries.filter(each => each.kind !== 'move')) {
      const scene = sceneOf(entry, 'low');
      const board = boardOf(c, [probes[0]], ['splash'], scene);
      const body = board.sides[0].active[0];
      const says = activated(board, body, [activation('p1a', 'Snorlax', entry)]);
      const diceMove = probes.some(move => {
        const probe = boardOf(c, [move], ['splash'], scene);
        const holder = probe.sides[0].active[0];
        const [no, maybe] = [queuePlace(probe, holder, move, false), queuePlace(probe, holder, move, true)];
        return no.priority !== maybe.priority || no.speed !== maybe.speed;
      });
      if (says) yes++;
      if (diceMove && !says) problems.push(`${entry.id}: the dice move the action and activated says no to its line`);
      if (activated(board, body, [])) problems.push(`${entry.id}: yes without an activation line`);
      if (activated(board, body, [activation('p2a', 'Pikachu', entry)])) problems.push(`${entry.id}: yes for the foe's activation line`);
    }
    summaries.push(`${c.name}: ${yes} entries answer yes from their line`);
    expect(problems).toEqual([]);
  });

  /** Bodies for the rows: the first four probe moves (with the entry's own move first), and the first of them with the positive brackets only. */
  const bodySets = (entry: Entry): string[][] => {
    const first = [...new Set(entry.kind === 'move' ? [entry.id, ...probes] : probes)].slice(0, 4);
    const positives = priorities.filter(p => p > 0).map(rep).slice(0, 3);
    return [first, [...new Set([first[0], ...positives])]];
  };

  const standInOf = (scene: Scene, body: string[], events: string[], foeMoves = ['splash'], species = 'Pikachu'): string => {
    const board = boardOf(c, body, foeMoves, scene, species);
    const choice = getMainChoice(events, 'p1', board as never);
    const index = Number(/^move (\d+)/.exec(choice)![1]);
    return board.sides[0].active[0].getMoveRequestData().moves[index - 1].id;
  };

  test('the stand-in of a body the log never shows acting is the last move in the simulator\'s order, with no cut at 0', () => {
    const problems: string[] = [];
    let rows = 0;
    const doubles = c.mode === 'doubles' ? ['|move|p1b: Blissey|Splash|p1b: Blissey', '|move|p2b: Vaporeon|Splash|p2b: Vaporeon'] : [];
    for (const entry of entries) {
      for (const { variant, label } of SCENES(entry)) {
        const scene = sceneOf(entry, variant);
        for (const body of bodySets(entry)) {
          if (!body.every(move => consistent(scene, move, rep(0), false))) continue;
          const stand = standInOf(scene, body, [foeLine('Pikachu', dex.moves.get(rep(0)).name), ...doubles], [rep(0)]);
          const ranks = body.map(move => rankOf(scene, move, false));
          rows++;
          const slowest = Math.min(...ranks);
          if (ranks[body.indexOf(stand)] !== slowest) problems.push(`${entry.id} (${label}) ${body.join(',')}: stand-in ${stand} stands at rank ${ranks[body.indexOf(stand)]}, the slowest at ${slowest}`);
        }
      }
    }
    summaries.push(`${c.name}: ${rows} stand-in rows`);
    expect(problems.slice(0, 12)).toEqual([]);
  });

  test('the Encore stand-in keeps its cut at 0 by the simulator\'s priority', () => {
    const problems: string[] = [];
    let rows = 0;
    for (const entry of entries.filter(each => each.kind !== 'move')) {
      for (const { variant, label } of SCENES(entry)) {
        const scene = sceneOf(entry, variant);
        const shown = probes[0];
        const others = [...new Set([...probes.slice(1, 4), rep(0), ...priorities.filter(p => p > 0).map(rep).slice(0, 2)])].filter(move => move !== shown);
        const body = [shown, ...others];
        if (!body.every(move => consistent(scene, move, rep(0), false))) continue;
        const events = ['|-start|p1a: Snorlax|Encore', `|move|p1a: Snorlax|${dex.moves.get(shown).name}|p2a: Pikachu`];
        const stand = standInOf(scene, body, events);
        rows++;
        // a slower foe at bracket 1 loses a tie: only a move of bracket 1 or above (the simulator's, fractions apart) moves before it
        const allowed = others.filter(move => !before(scene, move, rep(1), false, 'Shuckle'));
        if (allowed.length === 0) {
          if (stand !== shown) problems.push(`${entry.id} (${label}) ${body.join(',')}: every other move is above 0, the stand-in ${stand} is not the shown move`);
          continue;
        }
        const lowest = Math.min(...allowed.map(move => rankOf(scene, move, false)));
        if (!allowed.includes(stand) || rankOf(scene, stand, false) !== lowest) problems.push(`${entry.id} (${label}) ${body.join(',')}: the Encore stand-in ${stand}, allowed ${allowed.join(',')}`);
      }
    }
    summaries.push(`${c.name}: ${rows} Encore rows`);
    expect(problems.slice(0, 12)).toEqual([]);
  });

  /**
   * The cant stand-in: a body whose line is `|cant|` takes the slowest move that stays ahead of the action the log shows after it, by the
   * simulator's order, with the entry on the body (its own activation line before the cant when the dice answer yes) or on the foe whose
   * action the log shows (its line before the move).
   */
  interface CantRow { entry: Entry; label: string; scene: Scene; body: string[]; foeMove: string; species: string; chance: boolean; holder: Holder }

  function* cantCandidates(holder: Holder): Generator<CantRow> {
    for (const entry of entries) {
      for (const { variant, label } of SCENES(entry)) {
        const scene = sceneOf(entry, variant, holder);
        const foeMoves = holder === 'foe' ? (entry.kind === 'move' ? [entry.id] : sweepSelection(probes, 'rows')) : WINDOW(priorities).map(rep);
        const bodies = holder === 'body' ? bodySets(entry) : [[...new Set(WINDOW(priorities).map(rep))]];
        for (const body of bodies) {
          for (const foeMove of foeMoves) {
            for (const species of ['Pikachu', 'Shuckle']) {
              for (const chance of entry.kind === 'move' ? [false] : [false, true]) yield { entry, label, scene, body, foeMove, species, chance, holder };
            }
          }
        }
      }
    }
  }

  /** The activation line the log shows when the dice answer yes. */
  const shownLines = (row: CantRow): string[] =>
    row.chance ? [activation(row.holder === 'body' ? 'p1a' : 'p2a', row.holder === 'body' ? 'Snorlax' : row.species, row.entry)] : [];

  const cantEvents = (row: CantRow): string[] => {
    const foe = foeLine(row.species, dex.moves.get(row.foeMove).name);
    return row.holder === 'body' ? [...shownLines(row), CANT, foe] : [CANT, ...shownLines(row), foe];
  };

  /** Can a log show the row: the line is one `activated` reads, and the simulator's own activation agrees with the answer. */
  function cantLogged(row: CantRow): boolean {
    const board = boardOf(c, row.body, [row.foeMove], row.scene, row.species);
    if (row.chance && !activated(board, board.sides[row.holder === 'body' ? 0 : 1].active[0], shownLines(row))) return false;
    return row.holder === 'body'
      ? row.body.every(move => consistent(row.scene, move, rep(0), row.chance))
      : consistent(row.scene, rep(0), row.foeMove, row.chance, row.species);
  }

  /** The stand-in's miss against the simulator's order, or null: among the moves that stay ahead (else among all) it has the lowest rank. */
  function cantProblem(row: CantRow, ahead: string[], stand: string): string | null {
    const ranker = row.holder === 'body' ? row.scene : PLAIN;
    const dice = row.holder === 'body' && row.chance;
    const pool = ahead.length > 0 ? ahead : row.body;
    const lowest = Math.min(...pool.map(move => rankOf(ranker, move, dice, row.species)));
    if (pool.includes(stand) && rankOf(ranker, stand, dice, row.species) === lowest) return null;
    return `${row.entry.id} (${row.label}, dice ${row.chance}) ${row.body.join(',')} against ${row.species} ${row.foeMove}: stand-in ${stand}, ahead ${ahead.join(',') || 'none'}`;
  }

  function cantRows(holder: Holder): string[] {
    const problems: string[] = [];
    let rows = 0;
    let shifted = 0;
    for (const row of cantCandidates(holder)) {
      if (!cantLogged(row)) continue;
      const stand = standInOf(row.scene, row.body, cantEvents(row), [row.foeMove], row.species);
      const ahead = row.body.filter(move => before(row.scene, move, row.foeMove, row.chance, row.species));
      rows++;
      if (ahead.length > 0 && ahead.length < row.body.length) shifted++;
      const problem = cantProblem(row, ahead, stand);
      if (problem) problems.push(problem);
    }
    summaries.push(`${c.name}: ${rows} cant rows with the entry on the ${holder}, ${shifted} where only some moves stay ahead`);
    return problems;
  }

  test('the cant stand-in with the entry on the body stays ahead of the action after the line by the simulator\'s order', () => {
    expect(cantRows('body').slice(0, 12)).toEqual([]);
  });

  test('the cant stand-in with the entry on the foe whose action the log shows', () => {
    expect(cantRows('foe').slice(0, 12)).toEqual([]);
  });
});

describe('the reported rows', () => {
  const GEN9 = RULES.find(rules => rules.generation === 9 && rules !== CHAMPIONS)!;
  const REPORTED: { name: string; c: Case }[] = [
    { name: 'singles', c: { rules: GEN9, mode: 'singles', vgc: false, name: 'singles' } },
    { name: 'doubles', c: { rules: GEN9, mode: 'doubles', vgc: false, name: 'doubles' } },
    { name: 'VGC', c: { rules: GEN9, mode: 'doubles', vgc: true, name: 'VGC' } },
    { name: 'Champions VGC', c: { rules: CHAMPIONS, mode: 'doubles', vgc: true, name: 'Champions VGC' } },
  ];
  const standIn = (c: Case, scene: Scene, body: string[], events: string[], foeMoves: string[], species = 'Pikachu', bodySpecies = 'Snorlax'): string => {
    const board = boardOf(c, body, foeMoves, scene, species, bodySpecies);
    const index = Number(/^move (\d+)/.exec(getMainChoice(events, 'p1', board as never))![1]);
    return board.sides[0].active[0].getMoveRequestData().moves[index - 1].id;
  };
  const worn = (kind: Kind, id: string, variant: Variant = 'plain', holder: Holder = 'body'): Scene => ({ entry: { kind, id }, holder, variant });
  const unseen = (c: Case): string[] => c.mode === 'doubles' ? ['|move|p1b: Blissey|Splash|p1b: Blissey', '|move|p2b: Vaporeon|Splash|p2b: Vaporeon'] : [];

  // 2694081754 turn 9 (Doubles OU, Gen 9): Comfey with Triage never acts; the Draining Kiss stand-in ran at +3 ahead of the Grassy Glide (+1 in
  // Grassy Terrain) of Rillaboom that knocked it out. Comfey carries Triage as its own ability in the Gen 9 Dex, so the row runs in the Gen 9
  // rule sets (singles, doubles, VGC); the Champions Dex lists no species with Triage (Comfey is Past there), see the row below.
  const TRIAGE_ROWS = REPORTED.filter(row => row.c.rules === GEN9);
  test.each(TRIAGE_ROWS)('Triage: the draining move of Comfey is no stand-in behind the Grassy Glide the log shows first ($name)', ({ c }) => {
    const events = [foeLine('Rillaboom', 'Grassy Glide', 'p1a: Comfey'), ...unseen(c)];
    const scene = worn('ability', 'triage', 'grassy', 'body');
    expect(standIn(c, scene, ['drainingkiss', 'leechseed'], events, ['grassyglide'], 'Rillaboom', 'Comfey')).toBe('leechseed');
    // the move order of the request does not decide it
    expect(standIn(c, scene, ['leechseed', 'drainingkiss'], events, ['grassyglide'], 'Rillaboom', 'Comfey')).toBe('leechseed');
  });

  test('Triage: Comfey has it as its own ability in the Gen 9 Dex, and no species of the Champions Dex has it (the Champions VGC row is dropped)', () => {
    const carriers = (rules: Rules) => {
      const dex = dexOfRules(rules);
      return dex.species.all().filter(species => species.exists && !species.isNonstandard
        && Object.values(species.abilities).some(name => dex.abilities.get(name).id === 'triage')).map(species => species.name);
    };
    expect(carriers(GEN9)).toEqual(['Comfey']);
    expect(carriers(CHAMPIONS)).toEqual([]);
  });

  // a Prankster body whose stand-in is a status move moves ahead of a foe at priority 0 that the log shows first
  test.each(REPORTED)('Prankster: the status move is no stand-in behind a foe the log shows first ($name)', ({ c }) => {
    expect(standIn(c, worn('ability', 'prankster'), ['thunderwave', 'tackle'], [foeLine('Pikachu', 'Quick Attack'), ...unseen(c)], ['quickattack'])).toBe('tackle');
  });

  // a body that knows only moves above 0 takes the slowest of them (the old rule kept its first move)
  test.each(REPORTED)('a body of priority moves only takes the slowest of them ($name)', ({ c }) => {
    expect(standIn(c, { entry: null, holder: 'body', variant: 'plain' }, ['fakeout', 'protect', 'quickattack'], [foeLine('Pikachu', 'Quick Attack'), ...unseen(c)], ['quickattack'])).toBe('quickattack');
  });

  // Gale Wings at full HP lifts a Flying move to +1 and no further: Brave Bird at +1 is behind a Fake Out, so the stand-in holds the log's order
  test.each(REPORTED)('Gale Wings at full HP: the Flying move is no stand-in behind a priority move of the log, the slow move is ($name)', ({ c }) => {
    expect(standIn(c, worn('ability', 'galewings'), ['bravebird', 'earthquake'], [foeLine('Pikachu', 'Quick Attack'), ...unseen(c)], ['quickattack'])).toBe('earthquake');
  });

  // the cant order reads the foe's priority too: a Prankster Thunder Wave of the log after the flinch stands at +1, so a slower body at the same Dex bracket is behind it
  test.each(REPORTED)('the flinch stands before a Prankster status move of a slower foe: only a move above +1 stays ahead ($name)', ({ c }) => {
    const events = [CANT, foeLine('Shuckle', 'Thunder Wave'), ...unseen(c)];
    expect(standIn(c, worn('ability', 'prankster', 'plain', 'foe'), ['tackle', 'protect'], events, ['thunderwave'], 'Shuckle')).toBe('protect');
  });

  // Quick Claw: the log shows its activation, so the chance answer is yes and the holder stands ahead of a faster foe's move at the same bracket
  test.each(REPORTED)('Quick Claw: the activation line of the log answers the dice ($name)', ({ c }) => {
    const board = boardOf(c, ['tackle'], ['quickattack'], worn('item', 'quickclaw'));
    const body = board.sides[0].active[0];
    const line = '|-activate|p1a: Snorlax|item: Quick Claw';
    expect(activated(board, body, [line])).toBe(true);
    expect(activated(board, body, [])).toBe(false);
    expect(queuePlace(board, body, 'tackle', true).priority).toBeGreaterThan(queuePlace(board, body, 'tackle', false).priority);
  });
});
