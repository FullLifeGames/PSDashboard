import { test, expect } from '@playwright/test';
import { parseReplayLog, parseReplayLogWithObservations } from '../src/lib/protocol-parser';

const obsHeader = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|teamsize|p1|1',
  '|teamsize|p2|1',
  '|gen|9',
  '|tier|[Gen 9] Custom Game',
  '|start',
  '|switch|p1a: Lax|Snorlax, M|100/100',
  '|switch|p2a: Chomp|Garchomp, F|100/100',
  '|turn|1',
];

test.describe('protocol parser fault tolerance', () => {
  test('a malformed event after a faint does not kill the whole parse', () => {
    // The gpl-pipeline shape: video-reconstructed logs can emit impossible
    // orderings — here a |-fail| targeting a mon that just fainted, which
    // @pkmn/client resolves to null and crashes on. One bad line must not
    // take down the whole replay.
    const log = [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|teamsize|p1|1',
      '|teamsize|p2|1',
      '|gen|9',
      '|tier|[Gen 9] Custom Game',
      '|start',
      '|switch|p1a: Uxie|Uxie, L50|182/182',
      '|switch|p2a: Sig|Iron Jugulis, L50|100/100',
      '|turn|1',
      '|move|p1a: Uxie|Moonblast|p2a: Sig',
      '|-damage|p2a: Sig|0 fnt',
      '|faint|p2a: Sig',
      // Unresolvable ident — @pkmn/client returns null and its |-fail|
      // handler dereferences it unconditionally.
      '|-fail|p2a: Someone Else',
      '|turn|2',
    ].join('\n');
    const snapshots = parseReplayLog(log);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    // Everything around the skipped line still applied.
    const last = snapshots[snapshots.length - 1];
    const sig = last.p2.pokemon.find(mon => mon.speciesForme.startsWith('Iron Jugulis'));
    expect(sig?.fainted).toBe(true);
  });
});

test.describe('damage observations', () => {
  test('a clean singles hit yields one observation with its context', () => {
    const log = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-damage|p2a: Chomp|76/100',
      '|turn|2',
    ].join('\n');
    const { observations } = parseReplayLogWithObservations(log);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      attackerSpecies: 'Snorlax',
      defenderSpecies: 'Garchomp',
      attackerSide: 'p1',
      moveId: 'tackle',
      attackerStatus: '',
    });
    expect(observations[0].observedFraction).toBeCloseTo(0.24, 5);
  });

  test('crits, [from] damage, multi-hits, and doubles yield no observations', () => {
    const crit = [
      ...obsHeader,
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-crit|p2a: Chomp',
      '|-damage|p2a: Chomp|64/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(crit).observations).toHaveLength(0);

    const attributed = [
      ...obsHeader,
      '|-damage|p2a: Chomp|88/100|[from] Stealth Rock',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(attributed).observations).toHaveLength(0);

    const multiHit = [
      ...obsHeader,
      '|move|p1a: Lax|Double Kick|p2a: Chomp',
      '|-damage|p2a: Chomp|90/100',
      '|-damage|p2a: Chomp|80/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(multiHit).observations).toHaveLength(0);

    const doubles = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9',
      '|tier|[Gen 9] VGC', '|start',
      '|switch|p1a: Lax|Snorlax, M|100/100',
      '|switch|p2a: Chomp|Garchomp, F|100/100',
      '|turn|1',
      '|move|p1a: Lax|Tackle|p2a: Chomp',
      '|-damage|p2a: Chomp|76/100',
      '|turn|2',
    ].join('\n');
    expect(parseReplayLogWithObservations(doubles).observations).toHaveLength(0);
  });
});
