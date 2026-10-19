import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Dex, State } from '@pkmn/sim';
import {
  buildTeamsFromReplay, formatEnforcesSleepClause, getBranchSimulatorFormat, inferOpponentTeam, parseReplayLogWithObservations,
  type ReplayData,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { searchPosition } from '../src/search';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { detectSacks, parsePlayedActions, turnEvents } from '../src/played';
import { resolveTeraPreference } from '../src/tera';

/**
 * Round 72, T238: a nickname or a shiny flag never reaches the engine's words or its numbers. The built sets carry the
 * replay's names now, so every `name` the simulator holds can be a nickname. The turn analysis of a position (the
 * search, the played actions, the tiers, the sentence) must read the same when every name is the species and no body is
 * shiny. The position comes from one reconstruction; the second reading rewrites it, text for text, to the names the
 * build gave before round 72 (the name of each nicknamed body becomes its base species, `shiny` goes), so the two
 * readings differ in nothing but the names. The failure names the first differing path: a body-name read that reaches a
 * report sentence stops this lane, and the reader of it is the file to name.
 *
 * The regular spec (`identity-blind.spec.ts`) reads four fixture replays; the full run over every fixture replay with a
 * nicknamed or shiny body is the lane probe `identity-blind-full.vt.ts` (about 80 s), run before a merge.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = ['packages/eval-engine/test/fixtures', 'packages/eval-engine/test/fixtures/champions', 'packages/replay-core/test/fixtures'];

export function replays(): Array<{ tag: string; replay: ReplayData }> {
  const found: Array<{ tag: string; replay: ReplayData }> = [];
  const seen = new Set<string>();
  for (const dir of FIXTURES) {
    if (!existsSync(`${root}${dir}`)) continue;
    for (const name of readdirSync(`${root}${dir}`)) {
      if (!name.endsWith('.json') || seen.has(name)) continue;
      const parsed = JSON.parse(readFileSync(`${root}${dir}/${name}`, 'utf8')) as Partial<ReplayData>;
      if (typeof parsed.log !== 'string' || !parsed.format) continue;
      seen.add(name);
      found.push({ tag: name.replace(/\.json$/, ''), replay: parsed as ReplayData });
    }
  }
  return found;
}

/** Whether the replay shows a nicknamed or a shiny body on either side (the others cannot differ). */
export function hasIdentity(replay: ReplayData): boolean {
  return (['p1', 'p2'] as const).some(side => inferOpponentTeam(replay.log, side).pokemon.some(mon => mon.nickname !== undefined || mon.shiny === true));
}

/** The first path at which two values differ, or null. */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

/** Reads the replay's positions at the given shares of its snapshots twice (as built, and with every name the species) and requires equal results. */
export async function expectNameBlind(replay: ReplayData, shares: readonly number[]): Promise<void> {
  const format = getBranchSimulatorFormat(replay);
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  // Each nicknamed body's name becomes the base species the simulator gave an unnamed body; a shiny flag goes.
  const renames = [...p1Team, ...p2Team].flatMap(set => {
    const base = Dex.species.get(set.species).baseSpecies;
    return set.name && set.name !== set.species && set.name !== base ? [[set.name, base] as const] : [];
  });
  const plainly = (text: string) => renames.reduce((acc, [from, to]) => acc.split(from).join(to), text).replaceAll(', shiny', '').replaceAll('"shiny":true', '"shiny":false');
  const tera = resolveTeraPreference('auto', replay.formatid ?? '', replay.log);
  const sleepClause = formatEnforcesSleepClause(format);
  const names: [string, string] = [replay.players[0] ?? 'p1', replay.players[1] ?? 'p2'];
  const turns = [...new Set(shares.map(share => Math.max(2, Math.floor(snapshots.length * share))))];

  for (const turn of turns) {
    const runtime = await reconstructBranchRuntime({
      format, p1Team, p2Team, replayLog: replay.log, targetTurn: turn,
      snapshot: snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
      capturePositions: { snapshotFor: t => snapshots[Math.min(t - 1, snapshots.length - 1)] ?? null, onPosition: () => {} },
    });
    const battle = runtime.battleStream.battle;
    if (!battle || battle.ended) continue;
    const named = JSON.stringify(State.serializeBattle(battle));
    const events = turnEvents(replay.log, turn);
    const read = (serialized: string) => {
      const result = searchPosition(serialized, { depth: 1, samples: 1, tera, sleepClause });
      const analysis = analyzeTurn({
        turn, result, played: parsePlayedActions(events), playedOutcome: null, scoreBefore: result.score, scoreAfter: null,
        sacks: detectSacks(events, snapshots[turn - 1] ?? null),
      });
      return { result, analysis, summary: summarizeTurn(analysis, names) };
    };
    const withNames = read(named);
    const plain = plainly(named);
    // The rewrite changes names only, and it finds a name to change: a nicknamed or shiny body stands in every position.
    expect(plain, `turn ${turn}: the rewrite found no name to change`).not.toBe(named);
    const without = read(plain);
    expect(firstDifference(withNames, without), `${replay.id ?? ''} turn ${turn}`).toBeNull();
  }
}
