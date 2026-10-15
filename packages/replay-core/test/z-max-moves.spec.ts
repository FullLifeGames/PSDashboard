import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildTeamsFromReplay } from '../src/team-builder';
import { toId } from '../src/ids';
import type { SmogonUsageStats } from '../src/smogon/stats-types';

/**
 * Round 70 (batch fix): a Z-move or Max move in the log is no move of the set. The log shows the powered move and never its base
 * move. The inference booked "Devastating Drake" as the only move of Garchomp in smogtours-gen7ou-450650, the simulator played a set
 * with one 1-PP move, and a branch after the Z-move offered only Struggle. The Dex tells what the log proves:
 * - A Z-move names its crystal (`isZ`), which the client already reads as the item. A species' own Z-move also names its base move
 *   (`zMoveFrom` of the crystal), and that move is revealed. A status Z-move prints "Z-" before its base move and names it in `[anim]`.
 * - Any other damaging Z-move and every damaging Max move (`isMax`, G-Max moves included) shows the type of a damaging base move,
 *   and Max Guard shows a base move of status category. The set keeps an open slot (`openMoves`) that the build fills from the
 *   chosen published set, the move guesses and the usage list, as it fills every unknown move.
 * Every log comes from @pkmn/sim. Each scene checks the lines the simulator writes, and each built set goes back into a battle of
 * the replay's format, where the simulator must offer the powered move again.
 */

type Format = 'singles' | 'doubles';
const FORMATS: Format[] = ['singles', 'doubles'];

function mon(species: string, item: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
  };
}

const SKARMORY = mon('Skarmory', 'Leftovers', 'Sturdy', ['Splash']);
const CHANSEY = mon('Chansey', 'Leftovers', 'Natural Cure', ['Splash']);
const GARCHOMP = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Outrage', 'Earthquake', 'Swords Dance', 'Stealth Rock']);
const CORVIKNIGHT = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Body Press', 'Roost', 'Iron Defense']);

const formatIdOf = (gen: 7 | 8, format: Format) => `gen${gen}${format === 'doubles' ? 'doublescustomgame' : 'customgame'}`;
const sides = (format: Format, tested: PokemonSet) => (format === 'doubles'
  ? { p1: [SKARMORY, CHANSEY], p2: [tested, CHANSEY] } : { p1: [SKARMORY], p2: [tested] });

function battleOf(formatid: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(formatid) as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** The log a viewer reads: the lines without the split markers and the private halves they announce. */
const publicLog = (battle: Battle): string => battle.log
  .filter((line, index, lines) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');

/**
 * The public log of a game in which p2's tested body clicks `clicks` (one per turn; `foe` is the target text a doubles click needs)
 * and everyone else splashes.
 */
function scene(gen: 7 | 8, format: Format, tested: PokemonSet, clicks: (foe: string) => string[]): { formatid: string; log: string } {
  const formatid = formatIdOf(gen, format);
  const { p1, p2 } = sides(format, tested);
  const battle = battleOf(formatid, p1, p2);
  const doubles = format === 'doubles';
  for (const click of clicks(doubles ? ' 1' : '')) {
    expect(battle.choose('p1', doubles ? 'move 1, move 1' : 'move 1'), `p1 choice before "${click}"`).toBe(true);
    expect(battle.choose('p2', doubles ? `${click}, move 1` : click), `p2 choice "${click}"`).toBe(true);
  }
  return { formatid, log: publicLog(battle) };
}

interface ActiveRequest {
  canZMove?: ({ move: string } | null)[];
  canDynamax?: boolean;
  maxMoves?: { maxMoves: { move: string }[]; gigantamax?: string };
}

/** What the simulator offers p2's tested body at the start of a game of the replay's format with the built set. */
function offered(formatid: string, format: Format, set: PokemonSet): ActiveRequest {
  const { p1, p2 } = sides(format, set);
  const battle = battleOf(formatid, p1, p2);
  return (battle.sides[1].activeRequest as { active: ActiveRequest[] }).active[0];
}

const infoOf = (log: string, species: string) => inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === species)!;
const movesOf = (log: string, species: string) => infoOf(log, species).moves.map(move => move.name);

/** A usage list: the moves in order, probabilities falling from .95. */
function usage(species: string, moves: string[], items: string[] = []): SmogonUsageStats {
  const entry = (value: string, index: number) => ({ value, probability: 0.95 - index * 0.07, sourceDetail: 'test' });
  return {
    format: 'gen7ou', month: '2026-09', source: 'test',
    pokemon: { [toId(species)]: { species, rawCount: 1000, abilities: [], items: items.map(entry), moves: moves.map(entry), spreads: [] } },
  };
}

const builtSet = (log: string, species: string, usageStats?: SmogonUsageStats): PokemonSet =>
  buildTeamsFromReplay(log, { usageStats }).p2Team.find(set => set.species === species)!;

/** The damaging moves of one type among a set's moves. */
const attacksOfType = (set: PokemonSet, type: string) =>
  set.moves.filter(name => { const move = Dex.moves.get(name); return move.exists && move.type === type && move.category !== 'Status'; });
const statusMoves = (set: PokemonSet) => set.moves.filter(name => Dex.moves.get(name).category === 'Status');

describe('a damaging Z-move: the crystal is the item, a damaging base move of its type is open (Gen 7)', () => {
  // Earthquake, Swords Dance, Stealth Rock and Toxic come first: the four best-used moves hold no Dragon attack.
  const GARCHOMP_USAGE = usage('Garchomp', ['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic', 'Outrage', 'Dragon Claw', 'Fire Fang'], ['Dragonium Z']);

  test.each(FORMATS)('%s: the log shows the Z-move by name, and the inference books the crystal and an open Dragon attack', format => {
    const { log } = scene(7, format, GARCHOMP, foe => [`move 1${foe} zmove`]);
    expect(log).toMatch(/\|-zpower\|p2a: Garchomp\n\|move\|p2a: Garchomp\|Devastating Drake\|p1a: Skarmory\|\[zeffect\]/);
    const info = infoOf(log, 'Garchomp');
    expect(info.item).toMatchObject({ value: 'Dragonium Z', source: 'revealed' });
    expect(info.moves).toEqual([]);
    expect(info.openMoves).toEqual([{ kind: 'attack', type: 'Dragon' }]);
  });

  test.each(FORMATS)('%s: the build fills the open slot from the usage list and the simulator offers the Z-move again', format => {
    const { log, formatid } = scene(7, format, GARCHOMP, foe => [`move 1${foe} zmove`]);
    const set = builtSet(log, 'Garchomp', GARCHOMP_USAGE);
    expect(set.item).toBe('Dragonium Z');
    expect(set.moves).not.toContain('Devastating Drake');
    expect(attacksOfType(set, 'Dragon')).toEqual(['Outrage']);
    expect(set.moves).toContain('Earthquake');
    expect(set.moves).toHaveLength(4);
    const zMoves = offered(formatid, format, set).canZMove?.map(option => option?.move ?? null);
    expect(zMoves?.[set.moves.indexOf('Outrage')]).toBe('Devastating Drake');
  });

  test.each(FORMATS)('%s: a best-used Dragon attack that the set\'s boost does not serve falls, the next one fills the slot', format => {
    const { log } = scene(7, format, GARCHOMP, foe => [`move 1${foe} zmove`]);
    const set = builtSet(log, 'Garchomp', usage('Garchomp', ['Swords Dance', 'Earthquake', 'Draco Meteor', 'Stealth Rock', 'Toxic', 'Outrage']));
    expect(attacksOfType(set, 'Dragon')).toEqual(['Outrage']);
  });

  test('without usage data the slot stays open: the Z-move is no move of the set, the crystal stays', () => {
    const { log } = scene(7, 'singles', GARCHOMP, foe => [`move 1${foe} zmove`]);
    const set = builtSet(log, 'Garchomp');
    expect(set.item).toBe('Dragonium Z');
    expect(set.moves).not.toContain('Devastating Drake');
  });

  test('a Dragon attack the log showed fills the slot: the build adds no second one', () => {
    const dragonClaw = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Dragon Claw', 'Earthquake', 'Swords Dance', 'Stealth Rock']);
    const { log } = scene(7, 'singles', dragonClaw, () => ['move 1', 'move 1 zmove']);
    expect(movesOf(log, 'Garchomp')).toEqual(['Dragon Claw']);
    const set = builtSet(log, 'Garchomp', GARCHOMP_USAGE);
    expect(attacksOfType(set, 'Dragon')).toEqual(['Dragon Claw']);
    expect(set.moves[0]).toBe('Dragon Claw');
  });
});

describe('a species\' own Z-move names its base move (Gen 7)', () => {
  const crystals = [...Dex.items.all()].filter(item => typeof item.zMove === 'string' && item.zMoveFrom);
  const users = crystals.map(item => ({
    item, species: (item.itemUser ?? []).find(name => !Dex.species.get(name).battleOnly),
  })).filter((entry): entry is typeof entry & { species: string } => !!entry.species);

  test('the Dex lists the species crystals this test walks (a guard against an empty table)', () => {
    expect(users.length).toBeGreaterThanOrEqual(15);
  });

  test.each(users.map(entry => [entry.item.name, entry] as const))('%s: the base move is revealed, the Z-move is not a move', (_name, { item, species }) => {
    const base = String(item.zMoveFrom);
    const ability = Dex.species.get(species).abilities[0];
    const tested = mon(species, item.name, ability, [base, 'Splash']);
    const { log, formatid } = scene(7, 'singles', tested, () => ['move 1 zmove']);
    expect(log).toContain(`|${item.zMove}|`);
    const entry = inferOpponentTeam(log, 'p2').pokemon[0];
    expect(entry.moves.map(move => move.name)).toEqual([base]);
    expect(entry.moves[0].source).toBe('revealed');
    expect(entry.item).toMatchObject({ value: item.name, source: 'revealed' });
    expect(entry.openMoves ?? []).toEqual([]);
    const set = buildTeamsFromReplay(log).p2Team[0];
    expect(set.moves).toEqual([base]);
    expect(offered(formatid, 'singles', set).canZMove?.[0]?.move).toBe(item.zMove);
  });

  test.each(FORMATS)('%s: Alolan Raichu\'s Stoked Sparksurfer books Thunderbolt', format => {
    const raichu = mon('Raichu-Alola', 'Aloraichium Z', 'Surge Surfer', ['Thunderbolt', 'Surf', 'Nasty Plot', 'Focus Blast']);
    const { log, formatid } = scene(7, format, raichu, foe => [`move 1${foe} zmove`]);
    expect(log).toContain('|move|p2a: Raichu|Stoked Sparksurfer|');
    expect(movesOf(log, 'Raichu-Alola')).toEqual(['Thunderbolt']);
    const set = builtSet(log, 'Raichu-Alola', usage('Raichu-Alola', ['Surf', 'Nasty Plot', 'Focus Blast', 'Thunderbolt']));
    expect(set.moves).toContain('Thunderbolt');
    expect(set.moves).not.toContain('Stoked Sparksurfer');
    expect(offered(formatid, format, set).canZMove?.[set.moves.indexOf('Thunderbolt')]?.move).toBe('Stoked Sparksurfer');
  });
});

describe('a status Z-move shows its base move after "Z-" (Gen 7)', () => {
  const dancer = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Dragon Dance', 'Outrage', 'Earthquake', 'Stealth Rock']);

  test.each(FORMATS)('%s: the base move is revealed, the crystal is the item, no slot is open', format => {
    const { log, formatid } = scene(7, format, dancer, () => ['move 1 zmove']);
    expect(log).toContain('|move|p2a: Garchomp|Z-Dragon Dance|p2a: Garchomp|[anim]Dragon Dance');
    const info = infoOf(log, 'Garchomp');
    expect(info.moves.map(move => move.name)).toEqual(['Dragon Dance']);
    expect(info.moves[0].source).toBe('revealed');
    expect(info.item).toMatchObject({ value: 'Dragonium Z', source: 'revealed' });
    expect(info.openMoves ?? []).toEqual([]);
    const set = builtSet(log, 'Garchomp');
    expect(set.moves).toEqual(['Dragon Dance']);
    // The simulator offers the status Z-move under the name the log prints.
    expect(offered(formatid, format, set).canZMove?.[0]?.move).toBe('Z-Dragon Dance');
  });

  test('an older log without the [anim] marker still names the base move after "Z-"', () => {
    const { log } = scene(7, 'singles', dancer, () => ['move 1 zmove']);
    const older = log.replace('|[anim]Dragon Dance', '');
    expect(older).toContain('|move|p2a: Garchomp|Z-Dragon Dance|p2a: Garchomp\n');
    expect(movesOf(older, 'Garchomp')).toEqual(['Dragon Dance']);
  });
});

describe('a Max move: the base move is open, nothing is an item (Gen 8)', () => {
  // The four best-used moves hold no Flying attack and no Roost: the open slots are what puts them in.
  const FLYING_USAGE = usage('Corviknight', ['U-turn', 'Body Press', 'Iron Head', 'Defog', 'Brave Bird', 'Roost', 'Hurricane']);
  const dynamaxTurn = (foe: string) => [`move 1${foe} dynamax`];

  test.each(FORMATS)('%s: Max Airstream books an open Flying attack and no item; the Dynamax is not a move', format => {
    const { log } = scene(8, format, CORVIKNIGHT, dynamaxTurn);
    expect(log).toContain('|-start|p2a: Corviknight|Dynamax|');
    expect(log).toMatch(/\|move\|p2a: Corviknight\|Max Airstream\|p1a: Skarmory/);
    const info = infoOf(log, 'Corviknight');
    expect(info.moves).toEqual([]);
    expect(info.openMoves).toEqual([{ kind: 'attack', type: 'Flying' }]);
    expect(info.item.value).not.toBe('Max Airstream');
  });

  test.each(FORMATS)('%s: the build puts a Flying attack in the set, and the Dynamaxed body offers Max Airstream for it', format => {
    const { log, formatid } = scene(8, format, CORVIKNIGHT, dynamaxTurn);
    const set = builtSet(log, 'Corviknight', FLYING_USAGE);
    expect(set.moves).not.toContain('Max Airstream');
    expect(attacksOfType(set, 'Flying')).toEqual(['Brave Bird']);
    const request = offered(formatid, format, set);
    expect(request.canDynamax).toBe(true);
    expect(request.maxMoves?.maxMoves[set.moves.indexOf('Brave Bird')].move).toBe('maxairstream');
  });

  test.each(FORMATS)('%s: Max Guard books an open status move, and the build fills it', format => {
    const { log, formatid } = scene(8, format, CORVIKNIGHT, foe => [`move 1${foe} dynamax`, 'move 3']);
    expect(log).toContain('|move|p2a: Corviknight|Max Guard|p2a: Corviknight');
    const info = infoOf(log, 'Corviknight');
    expect(info.moves).toEqual([]);
    expect(info.openMoves).toEqual([{ kind: 'attack', type: 'Flying' }, { kind: 'status' }]);
    const set = builtSet(log, 'Corviknight', FLYING_USAGE);
    expect(set.moves).not.toContain('Max Guard');
    expect(attacksOfType(set, 'Flying')).toEqual(['Brave Bird']);
    expect(statusMoves(set).length).toBeGreaterThanOrEqual(1);
    const maxMoves = offered(formatid, format, set).maxMoves?.maxMoves.map(entry => entry.move);
    expect(maxMoves?.[set.moves.indexOf(statusMoves(set)[0])]).toBe('maxguard');
  });

  test('a second Max move of the same type opens no second slot', () => {
    const { log } = scene(8, 'singles', CORVIKNIGHT, () => ['move 1 dynamax', 'move 1']);
    expect(infoOf(log, 'Corviknight').openMoves).toEqual([{ kind: 'attack', type: 'Flying' }]);
  });

  test.each(FORMATS)('%s: a G-Max move is a Max move of its type, and the Gigantamax shows', format => {
    const gmax = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Roost', 'Body Press', 'Iron Defense'], { gigantamax: true });
    const { log, formatid } = scene(8, format, gmax, foe => [`move 1${foe} dynamax`]);
    expect(log).toContain('|-start|p2a: Corviknight|Dynamax|Gmax');
    expect(log).toContain('|move|p2a: Corviknight|G-Max Wind Rage|');
    const info = infoOf(log, 'Corviknight');
    expect(info.moves).toEqual([]);
    expect(info.openMoves).toEqual([{ kind: 'attack', type: 'Flying' }]);
    const set = builtSet(log, 'Corviknight', FLYING_USAGE);
    expect(set.moves).not.toContain('G-Max Wind Rage');
    expect(attacksOfType(set, 'Flying')).toEqual(['Brave Bird']);
    expect(set.gigantamax).toBe(true);
    expect(offered(formatid, format, set).maxMoves?.maxMoves[set.moves.indexOf('Brave Bird')].move).toBe('gmaxwindrage');
  });

  test('a Dynamax without a G-Max move is no Gigantamax', () => {
    const { log } = scene(8, 'singles', CORVIKNIGHT, () => ['move 1 dynamax']);
    expect(builtSet(log, 'Corviknight', FLYING_USAGE).gigantamax).toBeUndefined();
  });
});

describe('a Dynamaxed body is free of its Choice lock: Max moves disprove no Choice item', () => {
  const banded = mon('Corviknight', 'Choice Band', 'Pressure', ['Brave Bird', 'Body Press', 'Roost', 'Iron Defense']);

  test.each(FORMATS)('%s: two different Max moves leave the Choice items open', format => {
    const { log } = scene(8, format, banded, foe => [`move 1${foe} dynamax`, `move 2${foe}`]);
    expect(log).toContain('|move|p2a: Corviknight|Max Knuckle|');
    expect(infoOf(log, 'Corviknight').ruledOut?.items ?? []).not.toContain('choiceband');
  });

  test.each(FORMATS)('%s: two different plain moves still disprove them', format => {
    const { log } = scene(8, format, mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Body Press', 'Roost', 'Iron Defense']),
      foe => [`move 1${foe}`, `move 2${foe}`]);
    expect(infoOf(log, 'Corviknight').ruledOut?.items).toEqual(expect.arrayContaining(['choiceband', 'choicespecs', 'choicescarf']));
  });

  test.each(FORMATS)('%s: Max Guard still disproves Assault Vest, as the simulator refuses a holder the status move behind it', format => {
    const { log } = scene(8, format, CORVIKNIGHT, foe => [`move 1${foe} dynamax`, 'move 3']);
    expect(log).toContain('|move|p2a: Corviknight|Max Guard|');
    expect(infoOf(log, 'Corviknight').ruledOut?.items).toContain('assaultvest');
    const { p1, p2 } = sides(format, mon('Corviknight', 'Assault Vest', 'Pressure', CORVIKNIGHT.moves));
    const battle = battleOf(formatIdOf(8, format), p1, p2);
    const [splash, partner] = format === 'doubles' ? ['move 1, move 1', ', move 1'] : ['move 1', ''];
    expect(battle.choose('p1', splash)).toBe(true);
    expect(battle.choose('p2', `move 1${format === 'doubles' ? ' 1' : ''} dynamax${partner}`)).toBe(true);
    expect(battle.choose('p1', splash)).toBe(true);
    expect(battle.choose('p2', `move 3${partner}`)).toBe(false);
  });
});

describe('smogtours-gen7ou-450650, the scene of the bug: p2\'s Garchomp uses a Dragon Z-move on turn 2', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/smogtours-gen7ou-450650.json', import.meta.url), 'utf-8')) as { log: string };
  const WORLD_USAGE = usage('Garchomp', ['Earthquake', 'Swords Dance', 'Stealth Rock', 'Toxic', 'Outrage', 'Dragon Claw']);

  test('the inference books the crystal and an open Dragon attack, and no move; the other bodies keep their moves', () => {
    const p2 = inferOpponentTeam(replay.log, 'p2').pokemon;
    const garchomp = p2.find(entry => entry.species === 'Garchomp')!;
    expect(garchomp.item).toMatchObject({ value: 'Dragonium Z', source: 'revealed' });
    expect(garchomp.moves).toEqual([]);
    expect(garchomp.openMoves).toEqual([{ kind: 'attack', type: 'Dragon' }]);
    expect(p2.find(entry => entry.species === 'Zapdos')!.moves.map(move => move.name)).toEqual(['Volt Switch', 'Heat Wave', 'Hidden Power', 'Roost']);
    expect(p2.filter(entry => entry.openMoves)).toHaveLength(1);
    expect(inferOpponentTeam(replay.log, 'p1').pokemon.filter(entry => entry.openMoves)).toHaveLength(0);
  });

  test('built with a usage list, the Garchomp holds a Dragon attack and its crystal, and the simulator offers the Z-move again', () => {
    const set = builtSet(replay.log, 'Garchomp', WORLD_USAGE);
    expect(set.item).toBe('Dragonium Z');
    expect(set.moves).not.toContain('Devastating Drake');
    expect(attacksOfType(set, 'Dragon')).toEqual(['Outrage']);
    expect(offered('gen7customgame', 'singles', set).canZMove?.[set.moves.indexOf('Outrage')]?.move).toBe('Devastating Drake');
  });
});

describe('doubles: a powered move of the second slot is read like one of the first', () => {
  test('a Z-move from slot b books the crystal and an open Dragon attack', () => {
    const battle = battleOf(formatIdOf(7, 'doubles'), [SKARMORY, CHANSEY], [CHANSEY, GARCHOMP]);
    expect(battle.choose('p1', 'move 1, move 1')).toBe(true);
    expect(battle.choose('p2', 'move 1, move 1 1 zmove')).toBe(true);
    const log = publicLog(battle);
    expect(log).toMatch(/\|-zpower\|p2b: Garchomp\n\|move\|p2b: Garchomp\|Devastating Drake\|/);
    const info = infoOf(log, 'Garchomp');
    expect(info.item).toMatchObject({ value: 'Dragonium Z', source: 'revealed' });
    expect(info.moves).toEqual([]);
    expect(info.openMoves).toEqual([{ kind: 'attack', type: 'Dragon' }]);
  });

  test('a Max move from slot b books an open Flying attack', () => {
    const battle = battleOf(formatIdOf(8, 'doubles'), [SKARMORY, CHANSEY], [CHANSEY, CORVIKNIGHT]);
    expect(battle.choose('p1', 'move 1, move 1')).toBe(true);
    expect(battle.choose('p2', 'move 1, move 1 1 dynamax')).toBe(true);
    const log = publicLog(battle);
    expect(log).toContain('|move|p2b: Corviknight|Max Airstream|');
    const info = infoOf(log, 'Corviknight');
    expect(info.moves).toEqual([]);
    expect(info.openMoves).toEqual([{ kind: 'attack', type: 'Flying' }]);
  });
});
