import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import type { ReplayData } from '@fulllifegames/replay-core';
import { extractProtocolEvents } from '../src/hax-alignment';
import { parseTurnBlocks } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { loggedDice, mergeLoggedDice } from '../src/dice/logged-results';
import { playForcedTurn } from '../src/dice/play';
import { dieKey, type ForcedDie } from '../src/dice/types';
import { loggedClicks, reconstruct } from './arrival-turn';
import { secondariesIn } from '../src/dice/secondaries';

/**
 * Round 82 (forced dice), step A5, gate answer 19a, on the app's own reconstruction of real games: once the user forces any die
 * on the first turn of a branch, the module forces the other logged results too, so the turn differs from the log only in the
 * user's die, even where the 16-seed search found no perfect seed. Each scene plays the turn twice from the same arrival: with
 * the user's die alone (today's reading of a forced turn) and with the logged dice joined to it.
 */
await loadSimMods('gen9championsou');

const feedback = (name: string): ReplayData =>
  JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

interface Scene {
  label: string;
  fixture: string;
  source?: ReplayData;
  turn: number;
}

const GPL = { label: 'singles (GPL DzBQ5azlO5l)', fixture: 'gpl-replay', turn: 13 };
const FIRE_FANG = { label: 'singles (smogtours-gen8ou-573756)', fixture: 'smogtours-gen8ou-573756', source: feedback('smogtours-gen8ou-573756'), turn: 73 };
const FIRE_BLAST = {
  label: 'Champions singles (Champions OU 2628340185)', fixture: 'champions/gen9championsou-2628340185', source: feedback('gen9championsou-2628340185'), turn: 4,
};
const DOUBLES = { label: 'doubles (Doubles OU 2663093831)', fixture: 'gen9doublesou-2663093831', source: feedback('gen9doublesou-2663093831'), turn: 8 };
const VGC = { label: 'VGC (Regulation I 2630685175)', fixture: 'gen9vgc2026regi-2630685175', source: feedback('gen9vgc2026regi-2630685175'), turn: 9 };

/**
 * The first turn played with the dice module. `user` is the user's dice; `joined` adds the dice the log shows (19a).
 * Returns the turn's lines, the report and the discrete events of the log for comparison.
 */
async function firstTurn(scene: Scene, user: ForcedDie[], joined: boolean) {
  const { replay, runtime } = await reconstruct(scene.fixture, scene.turn, scene.source);
  const battle = runtime.battleStream.battle!;
  const block = parseTurnBlocks(replay.log).turns.find(entry => entry.turn === scene.turn)!;
  const logLines = [...block.preUpkeep, ...block.postUpkeep];
  const logged = loggedDice(logLines, { secondariesOf: secondariesIn(battle.dex) });
  const forced = joined ? mergeLoggedDice({ logged, forced: user, changed: new Set() }) : user;
  const start = battle.log.length;
  const report = playForcedTurn({ live: battle, forced, play: loggedClicks(replay.log, scene.turn) });
  const lines = battle.log.slice(start);
  return { lines, report, logged, expected: extractProtocolEvents(logLines), events: extractProtocolEvents(lines) };
}

const die = (slot: string, moveId: string, targetSlot: string, kind: ForcedDie['name']['kind'], result: ForcedDie['result'], effectId?: string): ForcedDie =>
  ({ name: { slot, moveId, targetSlot, kind, ...(effectId ? { effectId } : {}) }, result });
const tookOf = (report: { forced: { die: ForcedDie; took: string }[] }, wanted: ForcedDie): string | undefined =>
  report.forced.find(entry => dieKey(entry.die.name) === dieKey(wanted.name))?.took;
const has = (lines: string[], prefix: string): boolean => lines.some(line => line.startsWith(prefix));

describe('a die the log does not show: the flinch Air Slash never had', () => {
  // GPL turn 13: Air Slash against Heavy Slam, no flinch in the game (Cobalion moves after it). The user forces the flinch.
  const flinch = die('p1a', 'airslash', 'p2a', 'secondary', { happens: true }, 'flinch');

  test(`${GPL.label}: Air Slash flinches Cobalion and keeps its logged hit; nothing else of the log moves`, { timeout: 300000 }, async () => {
    const { lines, report, events, logged } = await firstTurn(GPL, [flinch], true);
    expect(tookOf(report, flinch)).toBe('applied');
    expect(has(lines, '|cant|p2a: King Bradley|flinch')).toBe(true);
    expect(has(lines, '|move|p2a: King Bradley|Heavy Slam')).toBe(false);
    // the logged hit of Air Slash: no miss, no crit, the damage the logged turn plays
    const asLogged = await firstTurn(GPL, [], false);
    const hit = (turn: string[]) => turn.filter(line => line.startsWith('|-damage|p2a')).slice(0, 2);
    expect(hit(lines)).toEqual(hit(asLogged.lines));
    expect(hit(lines).length).toBe(2);
    expect([...events.crits.keys(), ...events.misses.keys()]).toEqual([]);
    expect(logged.some(entry => entry.name.kind === 'accuracy' && entry.name.slot === 'p1a')).toBe(true);
  });
});

// Round 86 (T306): these four turns were the ones the sixteen-seed search could not make match the log, so the arrival's turn alone showed another
// result than the log and only the joined list repaired it. The arrival now carries the draws of the turn the log's dice force, so the turn alone
// already shows the log's results and the user\'s die joins them: the `alone` rows moved from "differs from the log" to "shows the log", the joined rows stay.
describe('a turn the search once missed: the logged results stand beside the user\'s die', () => {
  test(`${FIRE_FANG.label}: forcing the crit of Body Press keeps the Fire Fang miss of the log`, { timeout: 300000 }, async () => {
    const crit = die('p1a', 'bodypress', 'p2a', 'crit', { happens: true });
    const alone = await firstTurn(FIRE_FANG, [crit], false);
    // before round 86 the arrival's seed hit with Fire Fang (the turn the search could not make match the log); its logged draws now miss as the log does
    expect(has(alone.lines, '|move|p2a: Penal Battalion|Fire Fang|p1a: Corviknight|[miss]')).toBe(true);
    const joined = await firstTurn(FIRE_FANG, [crit], true);
    expect(tookOf(joined.report, crit)).toBe('applied');
    expect(has(joined.lines, '|move|p2a: Penal Battalion|Fire Fang|p1a: Corviknight|[miss]')).toBe(true);
    expect(has(joined.lines, '|-crit|p2a: Penal Battalion')).toBe(true);
    expect(joined.events.faints).toEqual(joined.expected.faints);
  });

  test(`${FIRE_FANG.label}: forcing Fire Fang to hit wins over the logged miss; the rest follows from it`, { timeout: 300000 }, async () => {
    const hit = die('p2a', 'firefang', 'p1a', 'accuracy', { happens: true });
    const joined = await firstTurn(FIRE_FANG, [hit], true);
    expect(tookOf(joined.report, hit)).toBe('applied');
    expect(has(joined.lines, '|move|p2a: Penal Battalion|Fire Fang|p1a: Corviknight|[miss]')).toBe(false);
    expect(has(joined.lines, '|-miss|')).toBe(false);
    // Corviknight faints to the hit: the logged Body Press has no body left to be played
    expect(has(joined.lines, '|move|p1a: Corviknight|Body Press')).toBe(false);
  });

  test(`${FIRE_BLAST.label}: forcing the crit of Fire Blast keeps the burn the log shows`, { timeout: 300000 }, async () => {
    const crit = die('p1a', 'fireblast', 'p2a', 'crit', { happens: true });
    const alone = await firstTurn(FIRE_BLAST, [crit], false);
    expect(has(alone.lines, '|-status|p2a: Corviknight|brn')).toBe(true);
    const joined = await firstTurn(FIRE_BLAST, [crit], true);
    expect(tookOf(joined.report, crit)).toBe('applied');
    expect(has(joined.lines, '|-crit|p2a: Corviknight')).toBe(true);
    expect(has(joined.lines, '|-status|p2a: Corviknight|brn')).toBe(true);
  });

  test(`${DOUBLES.label}: forcing no burn from Matcha Gotcha keeps Scale Shot at the four hits and the no crit of the log`, { timeout: 300000 }, async () => {
    const noBurn = die('p1a', 'matchagotcha', 'p2b', 'secondary', { happens: false }, 'brn');
    const alone = await firstTurn(DOUBLES, [noBurn], false);
    expect([...alone.events.hitCounts]).toEqual([...alone.expected.hitCounts]);
    const joined = await firstTurn(DOUBLES, [noBurn], true);
    expect(tookOf(joined.report, noBurn)).toBe('applied');
    expect([...joined.events.hitCounts]).toEqual([...joined.expected.hitCounts]);
    expect([...joined.events.crits]).toEqual([...joined.expected.crits]);
    expect(has(joined.lines, '|-status|p2b: tea pot|brn')).toBe(false);
    expect(joined.events.cants.size).toBe(0);
  });

  test(`${VGC.label}: forcing the crit of Body Press keeps the crit High Horsepower rolled in the log`, { timeout: 300000 }, async () => {
    const crit = die('p2b', 'bodypress', 'p1b', 'crit', { happens: true });
    const alone = await firstTurn(VGC, [crit], false);
    expect(has(alone.lines, '|-crit|p2b: Zamazenta')).toBe(true);
    const joined = await firstTurn(VGC, [crit], true);
    expect(tookOf(joined.report, crit)).toBe('applied');
    expect(has(joined.lines, '|-crit|p1b: TeraTurtle')).toBe(true);
    expect(has(joined.lines, '|-crit|p2b: Zamazenta')).toBe(true);
    expect(joined.events.misses.size).toBe(0);
  });
});
