import { test, expect, describe, vi } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import { correctActivesFromProtocol } from '../src/branch/corrections';
import { serializeBattleStable } from '../src/forward-model';

const seen = vi.hoisted(() => ({ exitEvents: [] as string[][], entryEvents: [] as string[][] }));
vi.mock('../src/branch/exit-volatiles.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../src/branch/exit-volatiles.ts')>();
  return {
    ...original,
    restoreAfterProtocolEntry: (battle: never, body: never, ident: string, events: readonly string[]) => {
      seen.exitEvents.push([...events]);
      return original.restoreAfterProtocolEntry(battle, body, ident, events);
    },
  };
});
vi.mock('../src/branch/entry-effects.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../src/branch/entry-effects.ts')>();
  return {
    ...original,
    playProtocolEntries: (battle: never, before: never, events: string[]) => {
      seen.entryEvents.push([...events]);
      return original.playProtocolEntries(battle, before, events);
    },
  };
});

/**
 * Round 73 (T230, the door of T206 for the correction): correctActivesFromProtocol takes the lines of a block, and a caller that
 * cut a CRLF log at '\n' hands it lines that end in '\r'. The readers behind the door see LF only. Today every reader happens
 * to trim or to match through toId, so the board comes out the same; the door keeps that true for the next reader that anchors
 * a pattern at the line end.
 */

const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function make(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  battle.choose('p1', 'move 1');
  return battle;
}

function singles(): Battle {
  const battle = make('gen9customgame',
    [mon('Gholdengo', 'Leftovers', 'Good as Gold', ['Nasty Plot']), mon('Kingambit', 'Booster Energy', 'Supreme Overlord', ['Swords Dance']),
      mon('Roaring Moon', 'Booster Energy', 'Protosynthesis', ['Dragon Dance'], 252)],
    [mon('Great Tusk', 'Leftovers', 'Protosynthesis', ['Bulk Up'])]);
  battle.choose('p2', 'move 1');
  return battle;
}

function doubles(): Battle {
  const battle = new LiveBattle({
    formatid: 'gen9doublescustomgame' as never, seed: [1, 2, 3, 4],
    p1: { name: 'A', team: Teams.pack([
      mon('Amoonguss', 'Leftovers', 'Regenerator', ['Protect']), mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']),
      mon('Landorus-Therian', 'Leftovers', 'Intimidate', ['Earthquake']), mon('Iron Valiant', 'Booster Energy', 'Quark Drive', ['Moonblast'], 252),
    ]) },
    p2: { name: 'B', team: Teams.pack([mon('Garchomp', 'Leftovers', 'Rough Skin', ['Protect']), mon('Dragonite', 'Leftovers', 'Multiscale', ['Protect'])]) },
  });
  battle.choose('p1', 'move protect, move softboiled');
  battle.choose('p2', 'move protect, move protect');
  return battle;
}

const scenes: { name: string; board: () => Battle; events: string[] }[] = [
  { name: 'singles: a faint, then a switch-in with Booster Energy', board: singles, events: [
    '|move|p2a: Great Tusk|Headlong Rush|p1a: Gholdengo', '|-damage|p1a: Gholdengo|0 fnt', '|faint|p1a: Gholdengo',
    '|switch|p1a: Roaring Moon|Roaring Moon|100/100',
  ] },
  { name: 'singles: a drag with no HP field', board: singles, events: ['|drag|p1a: Kingambit|Kingambit'] },
  { name: 'doubles: two faints, two replacements, an Intimidate and a Quark Drive entry', board: doubles, events: [
    '|faint|p1a: Amoonguss', '|faint|p1b: Blissey',
    '|switch|p1a: Landorus|Landorus-Therian|100/100', '|switch|p1b: Iron Valiant|Iron Valiant|100/100',
    '|-end|p1b: Iron Valiant|Substitute',
  ] },
];

const withCrlf = (lines: string[]) => lines.map(line => `${line}\r`);

describe('correctActivesFromProtocol reads a block with Windows line endings like the same block with LF (T230, T206)', () => {
  for (const scene of scenes) {
    test(`${scene.name}: the board after a CRLF block equals the board after the LF block`, () => {
      const lf = scene.board();
      const crlf = scene.board();
      correctActivesFromProtocol(lf as never, [...scene.events]);
      correctActivesFromProtocol(crlf as never, withCrlf(scene.events));
      expect(JSON.stringify(serializeBattleStable(crlf as never))).toBe(JSON.stringify(serializeBattleStable(lf as never)));
    });

    test(`${scene.name}: the readers behind the door see no '\\r'`, () => {
      seen.exitEvents.length = 0;
      seen.entryEvents.length = 0;
      correctActivesFromProtocol(scene.board() as never, withCrlf(scene.events));
      const readers = [...seen.exitEvents, ...seen.entryEvents];
      expect(readers.length).toBeGreaterThan(0);
      for (const lines of readers) expect(lines.filter(line => line.includes('\r'))).toEqual([]);
    });
  }

  test('the caller\'s array stays as it was: the door copies, it does not cut the lines in place', () => {
    const events = withCrlf(scenes[0].events);
    correctActivesFromProtocol(scenes[0].board() as never, events);
    expect(events).toEqual(withCrlf(scenes[0].events));
  });
});
