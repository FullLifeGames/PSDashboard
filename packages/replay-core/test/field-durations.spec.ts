import { describe, expect, test } from 'vitest';
import { parseReplayLog } from '../src/protocol-parser';

describe('field durations in the snapshot (round 60, T92)', () => {
  test('weather and terrain carry the client\'s remaining turns', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|1', '|teamsize|p2|1', '|gen|9',
      '|tier|[Gen 9] Custom Game', '|start',
      '|switch|p1a: Pelipper|Pelipper, F|100/100', '|-weather|RainDance|[from] ability: Drizzle|[of] p1a: Pelipper',
      '|switch|p2a: Rillaboom|Rillaboom, M|100/100', '|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p2a: Rillaboom',
      '|turn|1',
      '|move|p1a: Pelipper|Protect|p1a: Pelipper', '|-singleturn|p1a: Pelipper|Protect',
      '|move|p2a: Rillaboom|Protect|p2a: Rillaboom', '|-singleturn|p2a: Rillaboom|Protect',
      '|-weather|RainDance|[upkeep]', '|upkeep',
      '|turn|2',
    ].join('\n');
    const snapshots = parseReplayLog(log);
    const turn2 = snapshots.find(snapshot => snapshot.turn === 2)!;
    expect(turn2.field.weatherState).toEqual({ minDuration: 4, maxDuration: 7 });
    expect(turn2.field.terrainState).toEqual({ minDuration: 4, maxDuration: 7 });
  });
});
