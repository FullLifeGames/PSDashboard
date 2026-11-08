import { extractChannelMessages, type PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon } from './dice-fixtures';
import { SWEEP_CASES } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { playTurn, reconstruct } from './arrival-turn';

/**
 * Round 88 (T329, GitHub issue #65): a branch that starts in the middle of a weather or a terrain keeps it to its logged end. The
 * log shows the field's start and end but never the setter's item (Heat Rock, Terrain Extender), so the rebuild guessed the item
 * from usage; without the rock the simulator's sun lasts five turns and a branch from turn 3 dropped it at turn 5 where the game
 * kept it until turn 8. The inference now reads the item from the field's turns (`field-evidence.ts`); `syncWeather` and
 * `syncTerrain` already leave the simulator's own count in place where the snapshot's id matches, so the rebuilt holder's item
 * decides and the field code needs no change. Each row plays a simulator log of 9 turns (Generation 9, singles and doubles),
 * rebuilds it at turn 3 the way the app does and plays the logged turns through the branch's execution path: the field must
 * stand after every turn the log shows it standing and be gone after the turn the log ends it.
 */
await loadSimMods('gen9championsou');

interface Row { label: string; species: string; item: string; ability?: string; moves: string[]; first?: string }
const ROWS: Row[] = [
  { label: 'Sunny Day by Torkoal with Heat Rock', species: 'Torkoal', item: 'Heat Rock', moves: ['sunnyday', 'splash'], first: 'sunnyday' },
  { label: 'Drought by Torkoal with Heat Rock', species: 'Torkoal', item: 'Heat Rock', ability: 'Drought', moves: ['splash'] },
  { label: 'Grassy Surge by Rillaboom with Terrain Extender', species: 'Rillaboom', item: 'Terrain Extender', ability: 'Grassy Surge', moves: ['splash'] },
];
const TURNS = 9;

/** The turns after which the log's weather or terrain stands: a start before the turn's end, no end line up to it. */
function standingAfter(log: string): number[] {
  const turns: number[] = [];
  let turn = 0;
  let standing = false;
  for (const line of log.split('\n')) {
    if (line.startsWith('|turn|')) {
      if (standing && turn > 0) turns.push(turn);
      turn = Number(line.split('|')[2]);
    } else if (line.startsWith('|-weather|none') || line.startsWith('|-fieldend|')) standing = false;
    else if (/^\|-(weather|fieldstart)\|/.test(line) && !line.includes('[upkeep]')) standing = true;
  }
  if (standing && turn > 0) turns.push(turn);
  return turns;
}

describe.each(SWEEP_CASES.filter(entry => entry.rules.name === 'Gen 9'))('a branch from turn 3 keeps a field to its logged end: $name', ({ rules, mode }) => {
  test.each(ROWS)('$label', async row => {
    const setter: PokemonSet = { ...mon(rules, { species: row.species, moves: row.moves }), item: row.item, ability: row.ability ?? 'No Ability' };
    const foe = mon(rules, { species: 'Vaporeon', moves: ['splash'] });
    const doubles = mode === 'doubles';
    const battle = doubles
      ? battleOf(rules.doubles!, [setter, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Snorlax', moves: ['splash'] })])
      : battleOf(rules.singles, [setter], [foe]);
    for (let turn = 1; turn <= TURNS; turn++) {
      const mine = turn === 1 && row.first ? 'move 1' : `move ${row.moves.indexOf('splash') + 1}`;
      battle.choose('p1', doubles ? `${mine}, move 1` : mine);
      battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
    }
    const log = extractChannelMessages(battle.log.join('\n'), [0])[0].join('\n');
    const logged = standingAfter(log);
    expect(logged.length, 'the log shows the field standing, then ending').toBeGreaterThan(5);
    expect(logged.length, 'the field ends inside the log').toBeLessThan(TURNS);
    const replay = {
      id: 'x', format: '[Gen 9] Custom Game', formatid: doubles ? 'gen9doublescustomgame' : 'gen9customgame',
      players: ['Alpha', 'Beta'], log,
    } as unknown as ReplayData;
    const { runtime } = await reconstruct('gen9customgame', 3, replay);
    const rebuilt = runtime.battleStream.battle!;
    const after: number[] = [];
    for (let turn = 3; turn <= TURNS; turn++) {
      await playTurn(runtime, log, turn);
      if (rebuilt.field.weather || rebuilt.field.terrain) after.push(turn);
    }
    expect(after).toEqual(logged.filter(turn => turn >= 3));
  });
});
