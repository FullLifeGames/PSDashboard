import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildTeamsFromReplay } from '../src/team-builder';
import { enrichTeamInfo } from '../src/team-info';
import { fillsOpenMove, settleOpenMoves, unfilledOpenMoves } from '../src/team/open-moves';
import { toId } from '../src/ids';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';

/**
 * Round 70 (batch fix), the set side of Z-moves and Max moves: how the open slot of a hidden base move settles (team/open-moves.ts)
 * in the choice of a published set, in the build, in the panel's enrichment and next to a team sheet. The log scenes come from
 * @pkmn/sim, as in z-max-moves.spec.ts.
 */

const mon = (species: string, item: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});
const SKARMORY = mon('Skarmory', 'Leftovers', 'Sturdy', ['Splash']);

/** The public log of a Gen 7 singles game in which p2's body clicks `clicks` and p1 splashes. */
function zGame(tested: PokemonSet, clicks: string[]): string {
  const battle = new Battle({
    formatid: toID('gen7customgame') as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([SKARMORY]) }, p2: { name: 'Beta', team: Teams.pack([tested]) },
  });
  if (battle.requestState === 'teampreview') { battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1'); }
  for (const click of clicks) {
    expect(battle.choose('p1', 'move 1')).toBe(true);
    expect(battle.choose('p2', click)).toBe(true);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const GARCHOMP = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Outrage', 'Earthquake', 'Swords Dance', 'Stealth Rock']);
const Z_LOG = zGame(GARCHOMP, ['move 1 zmove']);

function usage(species: string, moves: string[], items: string[] = []): SmogonUsageStats {
  const entry = (value: string, index: number) => ({ value, probability: 0.95 - index * 0.07, sourceDetail: 'test' });
  return {
    format: 'gen7ou', month: '2026-09', source: 'test',
    pokemon: { [toId(species)]: { species, rawCount: 1000, abilities: [], items: items.map(entry), moves: moves.map(entry), spreads: [] } },
  };
}
const USAGE = usage('Garchomp', ['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic', 'Outrage', 'Dragon Claw']);

const built = (log: string, options: Parameters<typeof buildTeamsFromReplay>[1] = {}) =>
  buildTeamsFromReplay(log, options).p2Team.find(set => set.species === 'Garchomp')!;

const published = (sourceDetail: string, item: string, moves: string[]): PokemonSetAssumption => ({
  species: 'Garchomp', sourceDetail,
  ability: { value: 'Rough Skin', sourceDetail }, item: { value: item, sourceDetail },
  moves: moves.map(value => ({ value, sourceDetail })),
});

describe('which published set a Z-move or Max move points to', () => {
  const SET_A = published('A', 'Rocky Helmet', ['Earthquake', 'Stealth Rock', 'Toxic', 'Roar']);
  const SET_B = published('B', 'Life Orb', ['Swords Dance', 'Outrage', 'Earthquake', 'Fire Fang']);
  const sets: SmogonSetAssumptions = { format: 'gen7ou', source: 'test', pokemon: { garchomp: { ...SET_A, alternatives: [SET_B] } } };
  // Set A's moves are the better used: with nothing else to go on, A is the pick.
  const usageForA = usage('Garchomp', ['Earthquake', 'Stealth Rock', 'Toxic', 'Roar', 'Swords Dance', 'Outrage', 'Fire Fang']);

  test('control: a plain Earthquake fits both sets, and the better used set A wins', () => {
    const log = zGame(mon('Garchomp', 'Leftovers', 'Rough Skin', ['Earthquake', 'Toxic']), ['move 1']);
    expect(built(log, { usageStats: usageForA, setAssumptions: sets }).moves).toEqual(['Earthquake', 'Stealth Rock', 'Toxic', 'Roar']);
  });

  test('a Dragon Z-move fits only set B, which lists a Dragon attack: B is played as published', () => {
    const set = built(Z_LOG, { usageStats: usageForA, setAssumptions: sets });
    expect(set.moves).toEqual(['Swords Dance', 'Outrage', 'Earthquake', 'Fire Fang']);
    expect(set.item).toBe('Dragonium Z');
  });
});

describe('the panel shows the moves the build plays', () => {
  test('the enrichment fills the open slot as the build does, and the Z-move is not among the moves', () => {
    const raw = inferOpponentTeam(Z_LOG, 'p2');
    const enriched = enrichTeamInfo(raw, USAGE);
    const shown = enriched.pokemon.find(entry => entry.species === 'Garchomp')!.moves;
    expect(shown.map(move => move.name)).toContain('Outrage');
    expect(shown.find(move => move.name === 'Outrage')?.source).toBe('guessed');
    expect(shown.map(move => move.name)).not.toContain('Devastating Drake');
    const played = built(Z_LOG, { usageStats: USAGE, p2Info: enriched }).moves;
    expect([...played].sort()).toEqual(shown.map(move => move.name).sort());
    expect([...played].sort()).toEqual([...built(Z_LOG, { usageStats: USAGE }).moves].sort());
    // Enriching the enriched info again changes nothing.
    const again = enrichTeamInfo(enriched, USAGE).pokemon.find(entry => entry.species === 'Garchomp')!.moves;
    expect(again.map(move => move.name)).toEqual(shown.map(move => move.name));
  });
});

describe('a team sheet names the moves: the sheet fills the slot', () => {
  test('the sheet\'s Outrage is the base move; no usage guess joins it', () => {
    const sheet = '|showteam|p2|Garchomp||DragoniumZ|RoughSkin|Outrage,Earthquake,SwordsDance,StealthRock|Adamant||M|||100|';
    const log = `${Z_LOG}\n${sheet}`;
    const info = inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === 'Garchomp')!;
    expect(info.moves.map(move => move.name)).toEqual(['Outrage', 'Earthquake', 'Swords Dance', 'Stealth Rock']);
    expect(unfilledOpenMoves(info.openMoves, info.moves.map(move => move.name))).toEqual([]);
    expect(built(log, { usageStats: usage('Garchomp', ['Toxic', 'Dragon Claw', 'Roar']) }).moves)
      .toEqual(['Outrage', 'Earthquake', 'Swords Dance', 'Stealth Rock']);
  });
});

describe('an open slot no guess can fill stays open', () => {
  test('a usage list without a Dragon attack leaves the moves as they were; the Z-move is still no move', () => {
    const set = built(Z_LOG, { usageStats: usage('Garchomp', ['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic', 'Roar']) });
    expect(set.moves).toEqual(['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic']);
  });

  test('three proven moves keep their places: the guess that fills the slot takes the fourth, not a proven move\'s', () => {
    const log = zGame(GARCHOMP, ['move 2', 'move 3', 'move 4', 'move 1 zmove']);
    expect(inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === 'Garchomp')!.moves.map(move => move.name))
      .toEqual(['Earthquake', 'Swords Dance', 'Stealth Rock']);
    expect(built(log, { usageStats: USAGE }).moves).toEqual(['Earthquake', 'Swords Dance', 'Stealth Rock', 'Outrage']);
  });
});

describe('open moves against the Dex', () => {
  test('a damaging slot takes the moves of its type that deal damage, a status slot every status move', () => {
    const dragon = { kind: 'attack', type: 'Dragon' } as const;
    expect(fillsOpenMove(dragon, 'Outrage')).toBe(true);
    expect(fillsOpenMove(dragon, 'Draco Meteor')).toBe(true);
    expect(fillsOpenMove(dragon, 'Dragon Dance')).toBe(false);
    expect(fillsOpenMove(dragon, 'Earthquake')).toBe(false);
    expect(fillsOpenMove(dragon, 'Not A Move')).toBe(false);
    expect(fillsOpenMove({ kind: 'status' }, 'Roost')).toBe(true);
    expect(fillsOpenMove({ kind: 'status' }, 'Dragon Dance')).toBe(true);
    expect(fillsOpenMove({ kind: 'status' }, 'Brave Bird')).toBe(false);
  });

  test('every Dex move is filled by exactly one kind of slot of the Dex\'s own types, so no move fills two slots', () => {
    const types = [...new Set([...Dex.moves.all()].map(move => move.type))];
    for (const move of Dex.moves.all()) {
      if (!move.exists) continue;
      const fills = [{ kind: 'status' } as const, ...types.map(type => ({ kind: 'attack', type }) as const)]
        .filter(slot => fillsOpenMove(slot, move.name));
      expect(fills, move.name).toHaveLength(1);
    }
  });

  test('a generic crystal\'s zMoveType is the type of the Z-move it names (the open slot reads the crystal)', () => {
    const generic = [...Dex.moves.all()].filter(move => move.isZ && !Dex.items.get(String(move.isZ)).zMoveFrom);
    expect(generic.length).toBeGreaterThanOrEqual(18);
    for (const move of generic) expect(Dex.items.get(String(move.isZ)).zMoveType, move.name).toBe(move.type);
  });

  test('settling is a no-op without open moves: the assembly\'s own result comes back', () => {
    const pool = [{ name: 'Earthquake', guessed: false }, { name: 'Outrage', guessed: true }, { name: 'Toxic', guessed: true }];
    const assemble = (candidates: typeof pool) => candidates.slice(0, 2);
    expect(settleOpenMoves(pool, undefined, assemble).map(entry => entry.name)).toEqual(['Earthquake', 'Outrage']);
    expect(settleOpenMoves(pool, [], assemble).map(entry => entry.name)).toEqual(['Earthquake', 'Outrage']);
  });

  test('a pin that pushes out the move filling another slot does not leave that slot open', () => {
    const pool = ['Earthquake', 'Rock Slide', 'Fire Blast', 'Brave Bird', 'Roost', 'Toxic'].map(name => ({ name, guessed: true }));
    const assemble = (candidates: typeof pool) => candidates.slice(0, 4);
    // The four first guesses fill the Flying slot (Brave Bird, fourth) and not the status slot, which is asked first.
    const open = [{ kind: 'status' }, { kind: 'attack', type: 'Flying' }] as const;
    expect(settleOpenMoves(pool, open, assemble).map(entry => entry.name)).toEqual(['Roost', 'Brave Bird', 'Earthquake', 'Rock Slide']);
  });

  test('a slot that the proven moves leave no room for stays open', () => {
    const pool = [
      ...['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic'].map(name => ({ name, guessed: false })), { name: 'Outrage', guessed: true },
    ];
    const assemble = (candidates: typeof pool) => candidates.slice(0, 4);
    expect(settleOpenMoves(pool, [{ kind: 'attack', type: 'Dragon' }], assemble).map(entry => entry.name))
      .toEqual(['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic']);
  });

  test('a slot a kept move fills is left alone; otherwise the first fitting guess moves behind the proven moves', () => {
    const pool = [
      { name: 'Earthquake', guessed: false }, { name: 'Swords Dance', guessed: true }, { name: 'Toxic', guessed: true },
      { name: 'Outrage', guessed: true }, { name: 'Dragon Claw', guessed: true },
    ];
    const assemble = (candidates: typeof pool) => candidates.slice(0, 3);
    const dragon = [{ kind: 'attack', type: 'Dragon' } as const];
    expect(settleOpenMoves(pool, dragon, assemble).map(entry => entry.name)).toEqual(['Earthquake', 'Outrage', 'Swords Dance']);
    const filled = [...pool.slice(0, 2), pool[3], pool[2]];
    expect(settleOpenMoves(filled, dragon, assemble).map(entry => entry.name)).toEqual(['Earthquake', 'Swords Dance', 'Outrage']);
  });
});
