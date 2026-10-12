import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Battle, type PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, parseReplayLog, type PokemonSnapshot, type TurnSnapshot } from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../src/lib/picker-state';

/**
 * Round 69 (T161, spec decision 31): the snapshot picker puts a percent sighting on the absolute HP the way the
 * correction does, in the middle of the HPs at which the simulator's own display shows that percent. A Gen 7+ game
 * rounds the percent up and Champions rounds it down, so `round(percent * maxhp / 100)` left the range (Champions:
 * always the low edge). The checker asks the simulator's getHealth on a body of the same set in the same format, for
 * every percent from 1 to 100, on the singles and the doubles (VGC) format of both rule sets.
 */
const replay = JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', 'gen9championsou-2693832490.json'), 'utf-8')) as { log: string };
const FORMATS = [
  { label: 'singles', format: 'gen9ou' },
  { label: 'doubles and VGC', format: 'gen9doublesou' },
  { label: 'Champions singles', format: 'gen9championsou' },
  { label: 'Champions doubles and VGC', format: 'gen9championsvgc2026regmbbo3' },
] as const;

/** The simulator's body for the set, in the replay's display mode (percent). */
function simulatedBody(format: string, set: PokemonSet) {
  const battle = new Battle({ formatid: format as never, seed: '1,2,3,4', p1: { name: 'A', team: [set] }, p2: { name: 'B', team: [set] } });
  battle.reportExactHP = false;
  const body = battle.sides[0].pokemon[0];
  const shownAt = (hp: number) => {
    body.hp = hp;
    return Number(/^(\d+)\//.exec(body.getHealth().shared)![1]);
  };
  return { maxhp: body.maxhp, shownAt };
}

describe('snapshot picker, absolute HP from a percent sighting', () => {
  for (const { label, format } of FORMATS) {
    test(`${label}: every percent from 1 to 100 shows as itself and stands in the middle of its range`, async () => {
      await loadSimMods(format);
      const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
      const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
      const base = snapshot.p1.pokemon.find(mon => !mon.fainted && p1Team.some(set => set.species === mon.speciesForme || set.name === mon.name))!;
      const set = p1Team.find(entry => entry.species === base.speciesForme || entry.name === base.name)!;
      const sim = simulatedBody(format, set);
      const wrong: string[] = [];
      for (let percent = 1; percent <= 100; percent++) {
        const mon: PokemonSnapshot = { ...base, hp: percent, maxhp: 100, hpPercent: percent, isActive: true };
        const lone = { ...snapshot, p1: { ...snapshot.p1, pokemon: [mon] }, p2: { ...snapshot.p2, pokemon: snapshot.p2.pokemon.slice(0, 1) } } as TurnSnapshot;
        const info = pickerStateFromSnapshot(lone, [set], p2Team, 9, null, { format }).p1Pokemon[0];
        expect(info.maxhp, `${format} max HP`).toBe(sim.maxhp);
        const hps = Array.from({ length: sim.maxhp }, (_, index) => index + 1).filter(hp => sim.shownAt(hp) === percent);
        const ok = hps.includes(info.hp) && Math.abs(2 * info.hp - (hps[0] + hps[hps.length - 1])) <= 1;
        if (!ok) wrong.push(`${percent}%: ${info.hp} of ${info.maxhp}, range ${hps[0]}-${hps[hps.length - 1]}`);
      }
      expect(wrong).toEqual([]);
    }, 120_000);
  }

  test('a fainted body stays at 0 HP and a never-revealed body reads full', async () => {
    const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const base = snapshot.p1.pokemon.find(mon => p1Team.some(set => set.species === mon.speciesForme || set.name === mon.name))!;
    const set = p1Team.find(entry => entry.species === base.speciesForme || entry.name === base.name)!;
    await loadSimMods('gen9championsou');
    const read = (mon: PokemonSnapshot) => pickerStateFromSnapshot(
      { ...snapshot, p1: { ...snapshot.p1, pokemon: [mon] }, p2: { ...snapshot.p2, pokemon: snapshot.p2.pokemon.slice(0, 1) } } as TurnSnapshot,
      [set], p2Team, 9, null, { format: 'gen9championsou' },
    ).p1Pokemon[0];
    expect(read({ ...base, fainted: true, hp: 0, maxhp: 100, hpPercent: 0, isActive: false }).hp).toBe(0);
    const unseen = read({ ...base, hp: 0, maxhp: 0, hpPercent: 0, fainted: false, isActive: false });
    expect(unseen.hp).toBe(unseen.maxhp);
  });
});
