import { test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { FEEDBACK_CORPUS, FEEDBACK_REPLAYS } from '../e2e-feedback/corpus';
import { validateCorpus } from '../e2e-feedback/claims';
import { parseReplayLogWithObservations } from '../packages/replay-core/src/protocol-parser';
import { finalPlayedTurn } from '../packages/replay-core/src/replay-turns';
import { buildTeamsFromReplay } from '../packages/replay-core/src/team-builder';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';

/**
 * The committed feedback fixtures must stay parseable and long enough for
 * every corpus turn — the cheap, always-on half of the drift harness.
 */
test('feedback fixtures parse and cover every corpus turn', () => {
  const turnsByReplay: Record<string, number> = {};
  for (const id of FEEDBACK_REPLAYS) {
    const replay = JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as { id: string; log: string; players: string[] };
    expect(replay.id).toBe(id);
    expect(replay.players.length).toBeGreaterThanOrEqual(2);
    const { snapshots } = parseReplayLogWithObservations(replay.log);
    expect(snapshots.length).toBeGreaterThan(0);
    turnsByReplay[id] = finalPlayedTurn(snapshots);
    expect(turnsByReplay[id]).toBeGreaterThanOrEqual(10);
  }
  expect(validateCorpus(FEEDBACK_CORPUS, turnsByReplay, false)).toEqual([]);
});

/**
 * 573756: p1's Toxapex died to a Stomping Tantrum with 23% left. Read as a
 * damage reading, that knock-out hit made every rung whose weakest roll
 * exceeds 23% look wrong and solved a physically defensive Toxapex (Bold
 * 252 Def, Tantrum 45% where the real hit did 59%) over the specially
 * defensive prior; read as a lower bound, the physical hits settle Def at
 * 0. The mirror image on the attacker side: Melmetal's knock-outs read as
 * small hits had solved it to 0 Atk. (Without Smogon fills the special
 * side stays at the base guess: no special hit measured it.)
 */
test('573756: the lethal-aware fit drops the knock-out bias on both sides', () => {
  const replay = JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', 'smogtours-gen8ou-573756.json'), 'utf-8')) as { log: string };
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const toxapex = p1Team.find(set => set.species === 'Toxapex');
  expect(toxapex).toBeTruthy();
  expect(toxapex!.evs.def).toBe(0);
  const melmetal = p2Team.find(set => set.species === 'Melmetal');
  expect(melmetal).toBeTruthy();
  expect(melmetal!.evs.atk).toBe(252);
});

/** The harness's set fixtures, served the way hermetic.ts serves them. */
const fixtureFetcher = async (url: string) => {
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const file = join('e2e-feedback', 'fixtures', 'smogon', `${path.replace(/[^a-z0-9.]+/gi, '_')}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf-8')) } as unknown as Response;
};

/**
 * Round 33: the corpus runs with the published sets the app now loads.
 * 573756 under gen8ou sets: p1's Toxapex takes the specially defensive
 * curated set (SpD 252, Def 0 fitted from the physical knock-outs), and
 * Corviknight the curated 248/136/124 spread.
 */
test('573756: the set fixtures feed the curated Toxapex and Corviknight sets', async () => {
  for (const name of ['_sets_gen6ou.json.json', '_sets_gen8ou.json.json']) {
    expect(existsSync(join('e2e-feedback', 'fixtures', 'smogon', name))).toBe(true);
  }
  const replay = JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', 'smogtours-gen8ou-573756.json'), 'utf-8')) as { log: string };
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const setAssumptions = await fetchSmogonSetAssumptions({ formatId: 'gen8ou', species: ['Toxapex', 'Corviknight'], fetcher: fixtureFetcher as never });
  const { p1Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, setAssumptions });
  const toxapex = p1Team.find(set => set.species === 'Toxapex')!;
  expect(toxapex.evs.spd).toBe(252);
  expect(toxapex.evs.def).toBe(0);
  const corviknight = p1Team.find(set => set.species === 'Corviknight')!;
  expect([corviknight.evs.hp, corviknight.evs.def, corviknight.evs.spd]).toEqual([248, 136, 124]);
});
