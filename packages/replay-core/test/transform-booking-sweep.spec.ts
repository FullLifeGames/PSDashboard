import { describe, expect, test } from 'vitest';
import { Battle as ClientBattle } from '@pkmn/client';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { CHAMPIONS_MOD, dexOf, generationsFor, inferOpponentTeam } from '../src/index';
import type { GameRules } from '../src/index';

/**
 * Round 89 (#139): a body under Transform uses the moves of its target, so a move line of the copy shows that the TARGET knows the
 * move. @pkmn/client books such a move to the target (`rememberMove` recurses into `volatiles.transform.pokemon`, and again for a copy
 * of a copy); the inference dropped the line (an early return for a subject on the other side, and `ownMove` read nothing for a
 * transformed body), so the built target lacked a move the game had shown and the rebuilt copy could not play it.
 *
 * The sweep reads the Dex for every entry that transforms a body (a move, an ability or an item whose handlers call `transformInto`;
 * the simulator's own transformation) and plays each of them on @pkmn/sim in every generation the corpus plays (1 to 9) and the
 * Champions mod, singles and, from Generation 3, doubles. The copy uses the target's moves; the inference must book each to the
 * target and nothing to the copy, and its booking must equal the client's non-virtual move slots of the target. Doubles plays
 * both foes as the target and an ally as the target (a same-side Transform), and singles a copy of a copy where the generation lets
 * one transform a transformed body. No species or move name stands in the code that is under test.
 */
Dex.mod(CHAMPIONS_MOD, championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
Dex.formats.extend(championsMod.Formats);

type Kind = 'singles' | 'doubles';
interface Scene { label: string; gen: number; champions: boolean; rules: GameRules }

const SCENES: Scene[] = [
  ...Array.from({ length: 9 }, (_, index) => ({ label: `Generation ${index + 1}`, gen: index + 1, champions: false, rules: { gen: index + 1, mod: undefined } as GameRules })),
  { label: 'Champions', gen: 9, champions: true, rules: { gen: 9, mod: CHAMPIONS_MOD } as GameRules },
];
const kindsOf = (scene: Scene): Kind[] => (scene.gen >= 3 ? ['singles', 'doubles'] : ['singles']);
const formatOf = (scene: Scene, kind: Kind) => `gen${scene.gen}${scene.champions ? 'champions' : ''}${kind === 'doubles' ? 'doubles' : ''}customgame`;

type Dexish = ReturnType<typeof dexOf>;

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const body = (species: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Hardy', evs, ivs, level: 100, gender: '',
});
const publicLog = (battle: Battle) => battle.log.filter((line, index) => !line.startsWith('|split|') && !battle.log[index - 1]?.startsWith('|split|')).join('\n');

/** The text of an entry's handlers (the entry and what it holds), read from the Dex's functions. */
function handlerText(entry: object): string {
  const seen = new Set<unknown>();
  const texts: string[] = [];
  const read = (value: unknown) => {
    if (typeof value === 'function') texts.push(String(value));
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      Object.values(value).forEach(read);
    }
  };
  read({ ...entry });
  return texts.join('\n');
}

interface Transformer { kind: 'move' | 'ability' | 'item'; id: string }

/** Every entry of the generation's Dex whose handlers transform the user into another body. */
function transformersOf(dex: Dexish, scene: Scene): Transformer[] {
  const live = (entry: { exists: boolean; gen: number; isNonstandard?: string | null }) => entry.exists && entry.gen <= scene.gen && entry.isNonstandard !== 'Future';
  const found: Transformer[] = [];
  for (const move of dex.moves.all()) if (live(move) && /transformInto/.test(handlerText(move))) found.push({ kind: 'move', id: move.id });
  for (const ability of dex.abilities.all()) if (live(ability) && /transformInto/.test(handlerText(ability))) found.push({ kind: 'ability', id: ability.id });
  for (const item of dex.items.all()) if (live(item) && /transformInto/.test(handlerText(item))) found.push({ kind: 'item', id: item.id });
  return found;
}

/** Plain species of the scene: a base species of the generation with no forme of its own and no transformation. */
function fillersOf(dex: Dexish, scene: Scene, count: number): string[] {
  return dex.species.all()
    .filter(species => species.exists && species.gen <= scene.gen && !species.isNonstandard && species.num > 0 && species.baseSpecies === species.name && !species.otherFormes)
    .slice(0, count).map(species => species.name);
}

/** The target's own move and three moves that only the copy uses (no damage, no target: they play in every format). */
const OWN = 'splash';
const COPIED = ['harden', 'withdraw', 'defensecurl'];

interface Played { log: string; battle: Battle; unplayable: string[]; label: string }

/** Which body the Transform move names in doubles (the `-N` form is the partner). */
type Aim = '1' | '2' | '-2';

/**
 * Plays one scene. A move transformer uses Transform in turn 1 and the copy uses the three copied moves in turns 2 to 4; an
 * ability transformer copies at the lead and the copy uses them in turns 1 to 3. Both foes hold the full set in doubles (and the
 * ally the same), so the log names the body that was copied; the other bodies must book nothing from the copy.
 */
function play(scene: Scene, kind: Kind, entry: Transformer, aim: Aim): Played {
  const dex = dexOf(scene.rules);
  const fillers = fillersOf(dex, scene, 8);
  const width = kind === 'doubles' ? 2 : 1;
  const full = [OWN, ...COPIED];
  const transformer = (species: string) => body(species, entry.kind === 'ability' ? entry.id : 'No Ability',
    [OWN, ...(entry.kind === 'move' ? [entry.id] : [])]);
  const p1 = [transformer(fillers[0]), ...(width === 2 ? [body(fillers[1], 'No Ability', full)] : []), body(fillers[2], 'No Ability', [OWN])];
  const p2 = [body(fillers[3], 'No Ability', full), ...(width === 2 ? [body(fillers[4], 'No Ability', full)] : []), body(fillers[5], 'No Ability', [OWN])];
  const battle = new Battle({
    formatid: toID(formatOf(scene, kind)) as never, seed: [3, 1, 4, 1],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  const unplayable: string[] = [];
  if (battle.requestState === 'teampreview') { battle.choose('p1', 'team 123'); battle.choose('p2', 'team 123'); }
  const slotOf = (sideId: 'p1' | 'p2', slot: number, id: string) => (battle.sides[sideId === 'p1' ? 0 : 1].active[slot]?.moveSlots.findIndex(entry => entry.id === id) ?? -1) + 1;
  const choose = (sideId: 'p1' | 'p2', picks: string[]) => { if (!battle.choose(sideId, picks.join(', '))) unplayable.push(`${sideId}: ${picks.join(', ')}`); };
  const turn = (copy: string, other: string) => {
    const first = slotOf('p1', 0, copy);
    choose('p1', [`move ${first}${copy === 'transform' && kind === 'doubles' ? ` ${aim}` : ''}`, ...(width === 2 ? [`move ${slotOf('p1', 1, other)}`] : [])]);
    choose('p2', Array.from({ length: width }, (_, slot) => `move ${slotOf('p2', slot, OWN)}`));
  };
  if (entry.kind === 'move') turn('transform', OWN);
  // The copy keeps the Transform move's own slot order only in the generations that copy slots in order: ask the body by id.
  for (const move of COPIED) turn(move, OWN);
  return { log: publicLog(battle), battle, unplayable, label: `${kind} ${entry.kind} ${entry.id} aim ${aim}` };
}

/** The same log, read by a fresh @pkmn/client battle (the oracle of the booking). */
function clientOf(log: string): ClientBattle {
  const tier = log.split('\n').find(line => line.startsWith('|tier|'))?.split('|')[2] ?? '';
  const client = new ClientBattle(generationsFor(tier));
  for (const line of log.split('\n')) if (line.trim()) { try { client.add(line); } catch { /* a line the client cannot apply, as the inference skips it */ } }
  return client;
}

/** The client's body of a side by its nickname (a bench body has no position in its ident). */
const clientBody = (client: ClientBattle, side: string, name: string) => (side === 'p1' ? client.p1 : client.p2).team.find(mon => mon.name === name);

interface Booking { side: string; species: string; booked: string[] }

/** What each side's inference books on every body (the revealed moves, as move ids). */
function bookings(log: string): Booking[] {
  return (['p1', 'p2'] as const).flatMap(side => inferOpponentTeam(log, side).pokemon.map(entry => ({
    side, species: entry.species, booked: entry.moves.filter(move => move.source === 'revealed').map(move => toID(move.name)).sort(),
  })));
}

const identOfName = (ident: string) => ident.replace(/^p[1-4][a-d]?: /, '');
const sideOfIdent = (ident: string) => ident.slice(0, 2);

/**
 * The checks of one played scene. `target` is the body a `-transform` line names; the copy used COPIED after it. The inference of the
 * target's side books them on the target and on no other body; no inference books them on the copy; and the booking of the target is the
 * client's non-virtual move slots of it.
 */
function check(played: Played): string[] {
  const problems: string[] = [];
  const lines = played.log.split('\n');
  const transforms = lines.filter(line => line.startsWith('|-transform|')).map(line => line.split('|'));
  if (!transforms.length) return [`${played.label}: the simulator wrote no -transform line`];
  const book = bookings(played.log);
  const client = clientOf(played.log);
  for (const [, , copyIdent, targetIdent] of transforms) {
    const target = identOfName(targetIdent);
    const copy = identOfName(copyIdent);
    const targetBooked = book.find(entry => entry.side === sideOfIdent(targetIdent) && entry.species === target);
    const used = [...new Set(lines.filter(line => line.startsWith('|move|') && !line.includes('[from]') && line.split('|')[2].endsWith(`: ${copy}`)).map(line => toID(line.split('|')[3])))];
    const copied = used.filter(move => COPIED.includes(move));
    if (!copied.length) problems.push(`${played.label}: the copy used none of the copied moves`);
    for (const move of copied) {
      if (!targetBooked?.booked.includes(move)) problems.push(`${played.label}: ${target} lacks ${move} that its copy ${copy} used`);
      // No other body of the target's side, and not the copy itself, books a move of the target's.
      for (const entry of book) {
        if (entry.species !== target && entry.booked.includes(move) && entry.species === copy) problems.push(`${played.label}: the copy ${copy} books ${move} on ${entry.side}`);
        if (entry.species !== target && entry.species !== copy && entry.booked.includes(move)) problems.push(`${played.label}: ${entry.species} books ${move} (copied from ${target})`);
      }
    }
    // The client's own booking of the target, non-virtual slots only.
    const mon = clientBody(client, sideOfIdent(targetIdent), target);
    const clientMoves = (mon?.moveSlots ?? []).filter(slot => !slot.virtual).map(slot => toID(slot.name)).sort();
    if (targetBooked && JSON.stringify(targetBooked.booked) !== JSON.stringify(clientMoves)) {
      problems.push(`${played.label}: ${target} books ${targetBooked.booked.join(',')} and the client ${clientMoves.join(',')}`);
    }
  }
  return problems;
}

describe.each(SCENES)('$label', scene => {
  const dex = dexOf(scene.rules);
  const transformers = transformersOf(dex, scene);

  test('the Dex lists what transforms a body in this generation', () => {
    // The move in every generation, the ability from Generation 5 (the simulator's own transformation, read from the handlers).
    expect(transformers.map(entry => `${entry.kind}:${entry.id}`).sort()).toEqual(scene.gen >= 5 ? ['ability:imposter', 'move:transform'] : ['move:transform']);
  });

  for (const kind of kindsOf(scene)) {
    test(`${kind}: the target books every move its copy uses, and the client agrees`, () => {
      const problems: string[] = [];
      let transforming = 0;
      for (const entry of transformers) {
        // Doubles: the foe in slot 1, the foe in slot 2 and the partner (a move aims; an ability copies the foe across by itself).
        for (const aim of (kind === 'doubles' && entry.kind === 'move' ? ['1', '2', '-2'] : ['1']) as Aim[]) {
          const played = play(scene, kind, entry, aim);
          problems.push(...played.unplayable.map(choice => `${played.label}: the simulator refused ${choice}`));
          const found = check(played);
          if (!found.some(text => /wrote no -transform/.test(text))) transforming++;
          problems.push(...found);
        }
      }
      expect(transforming, 'scenes in which a body transformed').toBeGreaterThan(0);
      expect(problems).toEqual([]);
    }, 600_000);
  }
});

/**
 * A copy of a copy: Generation 1 lets a body transform into a transformed body; from Generation 2 the simulator fails the move. The
 * client books the copy's move through both bodies to the original, and so must the inference.
 */
describe.each(SCENES)('$label', scene => {
  const dex = dexOf(scene.rules);
  const entry = transformersOf(dex, scene).find(candidate => candidate.kind === 'move');
  test('singles: a copy of a copy books to the original body, where the generation allows it', () => {
    const fillers = fillersOf(dex, scene, 8);
    const full = [OWN, ...COPIED];
    const battle = new Battle({
      formatid: toID(formatOf(scene, 'singles')) as never, seed: [3, 1, 4, 1],
      p1: { name: 'Alpha', team: Teams.pack([body(fillers[0], 'No Ability', [OWN, entry!.id])]) },
      p2: { name: 'Beta', team: Teams.pack([body(fillers[3], 'No Ability', full), body(fillers[4], 'No Ability', [OWN, entry!.id])]) },
    });
    if (battle.requestState === 'teampreview') { battle.choose('p1', 'default'); battle.choose('p2', 'default'); }
    const slot = (side: 0 | 1, id: string) => battle.sides[side].active[0].moveSlots.findIndex(move => move.id === id) + 1;
    const refused: string[] = [];
    const go = (p1: string | null, p2: string | null) => {
      if (p1 && !battle.choose('p1', p1)) refused.push(`p1 ${p1}`);
      if (p2 && !battle.choose('p2', p2)) refused.push(`p2 ${p2}`);
    };
    go(`move ${slot(0, entry!.id)}`, `move ${slot(1, OWN)}`);
    go(`move ${slot(0, OWN)}`, 'switch 2');
    go(`move ${slot(0, OWN)}`, `move ${slot(1, entry!.id)}`);
    go(`move ${slot(0, OWN)}`, `move ${slot(1, COPIED[0])}`);
    go(`move ${slot(0, COPIED[1])}`, `move ${slot(1, OWN)}`);
    const log = publicLog(battle);
    const transforms = log.split('\n').filter(line => line.startsWith('|-transform|')).length;
    // The simulator decides whether a transformed body can be copied; no generation name stands here.
    expect(transforms === 2, 'a copy of a copy exists in the simulator').toBe(scene.gen === 1);
    if (transforms < 2) return;
    expect(refused).toEqual([]);
    const original = bookings(log).find(entry => entry.side === 'p2' && entry.species === fillers[3]);
    expect(original?.booked, 'the original books what both copies used').toEqual(expect.arrayContaining([toID(COPIED[0]), toID(COPIED[1])]));
    const copyOfCopy = bookings(log).find(entry => entry.side === 'p2' && entry.species === fillers[4]);
    expect(copyOfCopy?.booked, 'the second copy books only its own moves').toEqual([toID(entry!.id)].sort());
    const client = clientOf(log);
    const mon = clientBody(client, 'p2', fillers[3]);
    // The client agrees but for one slot it invents: the second copy takes over the first copy's own Transform slot as a real slot
    // (`-transform` calls `rememberMove` after it added the volatile, so the move is handed on to the original, which never knew it).
    // The simulator's own body is the oracle for that slot: the original has no such move.
    const known = battle.sides[1].pokemon.find(mon => mon.baseSpecies.name === fillers[3])!.baseMoveSlots.map(move => move.id);
    expect(original?.booked.every(move => known.includes(move)), 'the original books only moves it knows').toBe(true);
    expect(original?.booked).toEqual((mon?.moveSlots ?? []).filter(move => !move.virtual && toID(move.name) !== entry!.id).map(move => toID(move.name)).sort());
  });
});
