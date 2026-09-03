import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FEEDBACK_CORPUS, FEEDBACK_REPLAYS } from '../e2e-feedback/corpus';
import { validateCorpus } from '../e2e-feedback/claims';
import { parseReplayLogWithObservations } from '../packages/replay-core/src/protocol-parser';
import { finalPlayedTurn } from '../packages/replay-core/src/replay-turns';
import { buildTeamsFromReplay } from '../packages/replay-core/src/team-builder';

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
