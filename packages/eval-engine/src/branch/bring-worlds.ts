import type { BringList, BringSide } from '@fulllifegames/replay-core';
import type { EvalLine, EvalMatrix, EvalResult, MatrixCell, RankedChoice } from '../types.ts';

/**
 * Round 89 (#124): the worlds of a bring-limited game. A side that brought more bodies than it fielded still holds unknown
 * bodies: each choice of them from its team preview is one guess. A world is one set of guesses for both sides: its lists are the
 * fielded bodies plus the guesses (last), `guessed` counts the trailing guesses per side, `weight` is the world's share of the
 * game (the product of the sides' shares, renormalized over the worlds that stay). `trimTeamsToBring` fields exactly these lists.
 */
export interface BringWorld {
  p1: string[];
  p2: string[];
  /** How many trailing names of each list are guesses. */
  guessed: { p1: number; p2: number };
  weight: number;
}

/** The most worlds one game plays (ruling 15 of round 89: the three heaviest by usage weight, renormalized). */
export const BRING_WORLD_CAP = 3;

/** Two weights this close are one weight: the products of equal shares differ in the last bits by the order of the factors. */
const TIE = 1e-12;

interface SideWorld { guess: string[]; weight: number }

/** Every way a side's `open` bodies come from its candidates, in preview order, weighted by the product of the shares. */
function sideWorlds(side: BringSide): SideWorld[] {
  const worlds: SideWorld[] = [];
  const pick = (from: number, guess: string[], weight: number) => {
    if (guess.length === side.open) {
      worlds.push({ guess, weight });
      return;
    }
    for (let index = from; index < side.candidates.length; index++) {
      const candidate = side.candidates[index];
      pick(index + 1, [...guess, candidate.species], weight * candidate.weight);
    }
  };
  pick(0, [], 1);
  const total = worlds.reduce((sum, world) => sum + world.weight, 0);
  return worlds.map(world => ({ guess: world.guess, weight: total > 0 ? world.weight / total : 1 / worlds.length }));
}

/**
 * The worlds of a game, the heaviest first (ties by preview order), at most `cap` of them with their weights renormalized to
 * sum 1. Null for a bring-all game (no list). A game that pins both sides gives one world of weight 1 whose lists equal
 * `replayBringOnly`'s. Built once per game: in the app, in the bank and in a spec, from the list and the format's usage stats.
 */
export function bringWorlds(list: BringList | null | undefined, cap: number): BringWorld[] | null {
  if (!list) return null;
  const p1Worlds = sideWorlds(list.p1);
  const p2Worlds = sideWorlds(list.p2);
  const all: BringWorld[] = [];
  for (const first of p1Worlds) {
    for (const second of p2Worlds) {
      all.push({
        p1: [...list.p1.fielded, ...first.guess],
        p2: [...list.p2.fielded, ...second.guess],
        guessed: { p1: first.guess.length, p2: second.guess.length },
        weight: first.weight * second.weight,
      });
    }
  }
  if (all.length === 0) return null;
  all.sort((a, b) => (Math.abs(a.weight - b.weight) < TIE ? 0 : b.weight - a.weight));
  const kept = all.slice(0, Math.max(1, cap));
  const total = kept.reduce((sum, world) => sum + world.weight, 0);
  return kept.map(world => ({ ...world, weight: world.weight / total }));
}

/**
 * The weighted mean of `values` under `weights`, normalized by the weights present (a world that dropped out at a turn leaves its
 * weight out). One value comes back as it is, so a pinned game's number never takes a round trip through a division.
 */
export function blendValues(values: number[], weights: number[]): number {
  if (values.length === 1) return values[0];
  let sum = 0;
  let total = 0;
  values.forEach((value, index) => {
    sum += value * weights[index];
    total += weights[index];
  });
  return sum / total;
}

/** The weighted mean of `pick(entry)` over the entries that hold a value, or undefined when none does. */
function blendHeld<T>(entries: { entry: T; weight: number }[], pick: (entry: T) => number | undefined): number | undefined {
  const held = entries.filter(({ entry }) => pick(entry) !== undefined);
  if (held.length === 0) return undefined;
  return blendValues(held.map(({ entry }) => pick(entry) as number), held.map(({ weight }) => weight));
}

/**
 * The blended rows of one side: the frame's rows (the first entry), each with the weighted mean of its numbers over the worlds
 * that hold its choice. A row only a lighter world ranks is dropped: its label names that world's unknown body, and the frame
 * did not rank it.
 */
function blendRows(sides: { rows: RankedChoice[]; weight: number }[]): RankedChoice[] {
  const [frame, ...others] = sides;
  const blended = frame.rows.map(base => {
    const held = [{ entry: base, weight: frame.weight }];
    for (const { rows, weight } of others) {
      const match = rows.find(entry => entry.choice === base.choice);
      if (match) held.push({ entry: match, weight });
    }
    return {
      ...base,
      worstCase: blendHeld(held, entry => entry.worstCase)!,
      expected: blendHeld(held, entry => entry.expected)!,
      ev: blendHeld(held, entry => entry.ev)!,
    };
  });
  // Array.prototype.sort is stable: equal evs stay in the order the heaviest world listed them.
  return blended.sort((a, b) => b.ev - a.ev);
}

/** The frame's matrix with each cell the weighted mean over the worlds that hold both ids; null when the frame carries no ids. */
function blendMatrix(frame: EvalMatrix, others: { matrix: EvalMatrix | undefined; weight: number }[]): EvalMatrix {
  const rowIds = frame.p1Choices;
  const columnIds = frame.p2Choices;
  if (!rowIds || !columnIds) return frame;
  const holders = others.filter((holder): holder is { matrix: EvalMatrix; weight: number } => !!holder.matrix?.p1Choices && !!holder.matrix.p2Choices);
  const indexOf = (ids: string[]) => new Map(ids.map((id, index) => [id, index]));
  const lookups = holders.map(({ matrix }) => ({ ...matrix, rows: indexOf(matrix.p1Choices!), columns: indexOf(matrix.p2Choices!) }));
  const values = rowIds.map((rowId, i) => columnIds.map((columnId, j) => {
    const held = lookups.flatMap((world, index) => {
      const row = world.rows.get(rowId);
      const column = world.columns.get(columnId);
      return row === undefined || column === undefined ? [] : [{ value: world.values[row][column], weight: holders[index].weight }];
    });
    return held.length === 0 ? frame.values[i][j] : blendValues(held.map(entry => entry.value), held.map(entry => entry.weight));
  }));
  const cells = frame.cells && rowIds.map((rowId, i) => columnIds.map((columnId, j): MatrixCell => {
    const held = lookups.flatMap(world => {
      const row = world.rows.get(rowId);
      const column = world.columns.get(columnId);
      const cell = row === undefined || column === undefined ? undefined : world.cells?.[row]?.[column];
      return cell ? [cell] : [];
    });
    if (held.length === 0) return frame.cells![i][j];
    return { ...frame.cells![i][j], visits: held.reduce((sum, cell) => sum + cell.visits, 0), verified: held.every(cell => cell.verified) };
  }));
  const mix = (ids: string[], side: 'p1' | 'p2') => {
    const raw = ids.map(id => {
      const held = lookups.flatMap((world, index) => {
        const position = (side === 'p1' ? world.rows : world.columns).get(id);
        return position === undefined ? [] : [{ share: world.mixes[side][position], weight: holders[index].weight }];
      });
      return blendValues(held.map(entry => entry.share), held.map(entry => entry.weight));
    });
    const total = raw.reduce((sum, share) => sum + share, 0);
    return total > 0 ? raw.map(share => share / total) : raw;
  };
  return { ...frame, values, ...(cells ? { cells } : {}), mixes: { p1: mix(rowIds, 'p1'), p2: mix(columnIds, 'p2') } };
}

/**
 * Round 89 (#104): the lines of a blended result. Every world's search kept the line of its own best row and of the played row, but
 * the blend ranks the frame's rows again, so its best row need not be the frame's. A line is the engine's when its row is the blend's
 * best row of its side, whichever world holds it (the heaviest first); a played line stays, and a line that is neither goes.
 * Nothing reads `lines` to score or rank.
 */
function blendLines(entries: { entry: EvalResult }[], perSide: EvalResult['perSide']): EvalLine[] | undefined {
  const merged = new Map<string, EvalLine>();
  for (const { entry } of entries) {
    for (const line of entry.lines ?? []) {
      const roles = line.for.filter(role => role === 'played' || line.label === perSide[line.side][0]?.label);
      if (roles.length === 0) continue;
      const key = `${line.side}\u0000${line.label}`;
      const held = merged.get(key);
      if (!held) merged.set(key, roles.length === line.for.length ? line : { ...line, for: roles });
      else if (roles.some(role => !held.for.includes(role))) merged.set(key, { ...held, for: [...held.for, ...roles.filter(role => !held.for.includes(role))] });
    }
  }
  return merged.size === 0 ? undefined : [...merged.values()];
}

/**
 * Round 89 (#124): one result for a game with several worlds. Each world is solved under perfect information (ADR 0013); the
 * blend is the weighted mean over them. One world returns its result as it came (pinned and bring-all games stay byte-identical).
 * Several: the heaviest world's result is the frame (labels, punishers, kill odds, unanswered bodies, diagnostics, engine);
 * score, interval and, when every world has them, gameValue and trend are weighted means; depthCompleted is the minimum; the frame's rows
 * take the weighted mean of their numbers over the worlds that hold their choice and sort by blended ev; the matrix keeps the frame's
 * rows and columns with cells blended by choice id; a forced win stays only when every world proves one for the same side; the lines follow
 * the blended best row (`blendLines`).
 * `results` and `weights` are index-aligned.
 */
export function blendWorlds(results: EvalResult[], weights: number[]): EvalResult {
  if (results.length === 1) return results[0];
  // The heaviest world first (a tie keeps the earlier world): its rows come first, so a tie in the blended ev keeps its order.
  const order = results.map((_, index) => index).sort((a, b) => weights[b] - weights[a]);
  const frame = results[order[0]];
  const entries = order.map(index => ({ entry: results[index], weight: weights[index] }));
  const blended: EvalResult = {
    ...frame,
    score: blendValues(results.map(result => result.score), weights),
    interval: blendValues(results.map(result => result.interval), weights),
    depthCompleted: Math.min(...results.map(result => result.depthCompleted)),
    perSide: {
      p1: blendRows(entries.map(({ entry, weight }) => ({ rows: entry.perSide.p1, weight }))),
      p2: blendRows(entries.map(({ entry, weight }) => ({ rows: entry.perSide.p2, weight }))),
    },
  };
  delete blended.gameValue;
  delete blended.trend;
  delete blended.lines;
  const lines = blendLines(entries, blended.perSide);
  if (lines) blended.lines = lines;
  if (results.every(result => result.gameValue !== undefined)) blended.gameValue = blendValues(results.map(result => result.gameValue!), weights);
  if (results.every(result => result.trend !== undefined)) blended.trend = blendValues(results.map(result => result.trend!), weights);
  if (frame.matrix) blended.matrix = blendMatrix(frame.matrix, entries.map(({ entry, weight }) => ({ matrix: entry.matrix, weight })));
  const proven = results.map(result => result.forcedWin);
  if (!proven.every(win => win && win.side === frame.forcedWin?.side)) delete blended.forcedWin;
  return blended;
}
