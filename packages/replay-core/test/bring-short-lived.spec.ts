import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import * as championsMod from '@pkmn/mods/champions';
import {
  broughtSpeciesFor, getReplayBringCount, parseReplayLog, replayBringList, replayBringOnly, replayRules, speciesBaseId,
  registerChampionsDex, type ReplayData,
} from '../src/index';

registerChampionsDex(championsMod as never, (championsMod as unknown as { Formats: never }).Formats);

/**
 * Round 89 (#124): a body that enters and leaves within one turn is a brought body. The turn snapshots show the bodies on the
 * field at the turn's end, so a Pokémon that enters on a switch, a U-turn or Volt Switch, a drag or an Illusion break and
 * faints before the turn ends never stood active in a snapshot. The bring list read it as an unfielded candidate: 131 games of
 * the holdouts and the bank (VGC 2630452654 among them, P2's Farigiraf) counted as short while the log shows every brought body.
 *
 * The rows play every line kind that puts a body on the field, in singles (Battle Stadium Singles, bring 3) and doubles (VGC,
 * bring 4), through `parseReplayLog`; the protocol is the oracle, no species name stands in the code. The corpus row reads every
 * bring-limited replay of the fit corpus and holds the list to the log's own `switch` and `drag` lines.
 */

type Kind = 'switch' | 'switch after a U-turn' | 'switch after Volt Switch' | 'drag' | 'Illusion break';
const KINDS: Kind[] = ['switch', 'switch after a U-turn', 'switch after Volt Switch', 'drag', 'Illusion break'];

const detail = (name: string) => `${name}, L50`;
const hp = (value: string) => `|${value}`;

/** One short-lived body of p1: it enters through `kind`, takes a hit and faints; the forced replacement stays on the field. */
function scene(kind: Kind, game: 'singles' | 'doubles') {
  const doubles = game === 'doubles';
  const shortLived = kind === 'Illusion break' ? 'Zoroark' : 'Jolteon';
  const disguise = 'Flareon';
  const p1Preview = ['Pikachu', 'Eevee', 'Raichu', shortLived, disguise, 'Vaporeon'];
  const p2Preview = ['Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur', 'Charmeleon', 'Wartortle'];
  const mover = doubles ? 'p1b' : 'p1a';
  const foe = 'p2a';
  const foeName = doubles ? 'Bulbasaur' : 'Squirtle';
  const occupant = doubles ? 'Eevee' : 'Raichu';
  const entry: string[] = (() => {
    switch (kind) {
      case 'switch': return [`|switch|${mover}: ${shortLived}|${detail(shortLived)}${hp('100/100')}`];
      case 'switch after a U-turn': return [`|move|${mover}: ${occupant}|U-turn|${foe}: ${foeName}`, `|switch|${mover}: ${shortLived}|${detail(shortLived)}${hp('100/100')}|[from] U-turn`];
      case 'switch after Volt Switch': return [`|move|${mover}: ${occupant}|Volt Switch|${foe}: ${foeName}`, `|switch|${mover}: ${shortLived}|${detail(shortLived)}${hp('100/100')}|[from] Volt Switch`];
      case 'drag': return [`|move|${foe}: ${foeName}|Roar|${mover}: ${occupant}`, `|drag|${mover}: ${shortLived}|${detail(shortLived)}${hp('100/100')}`];
      case 'Illusion break': return [`|switch|${mover}: ${disguise}|${detail(disguise)}${hp('100/100')}`, `|move|${foe}: ${foeName}|Tackle|${mover}: ${disguise}`, `|replace|${mover}: ${shortLived}|${detail(shortLived)}`];
    }
  })();
  const hitAndFaint = [`|move|${foe}: ${foeName}|Tackle|${mover}: ${shortLived}`, `|-damage|${mover}: ${shortLived}|0 fnt`, `|faint|${mover}: ${shortLived}`, '|upkeep'];
  const lead = (side: 'p1' | 'p2', names: string[]) => names.map((name, index) => `|switch|${side}${'ab'[index]}: ${name}|${detail(name)}${hp('100/100')}`);
  const lines = [
    '|player|p1|Alice|', '|player|p2|Bob|', `|gametype|${game}`, '|gen|9',
    `|tier|${doubles ? '[Gen 9] VGC 2026 Regulation I' : '[Gen 9] Battle Stadium Singles Regulation H'}`,
    ...p1Preview.map(name => `|poke|p1|${detail(name)}|`), ...p2Preview.map(name => `|poke|p2|${detail(name)}|`),
    doubles ? '|teampreview|4' : '|teampreview|3', '|start',
    ...lead('p1', doubles ? ['Pikachu', 'Eevee'] : ['Pikachu']),
    ...lead('p2', doubles ? ['Bulbasaur', 'Charmander'] : ['Bulbasaur']),
    '|turn|1',
    // The side's second body stays on the field from turn 1.
    `|switch|p1a: Raichu|${detail('Raichu')}${hp('100/100')}`, `|switch|${doubles ? 'p2b' : 'p2a'}: Squirtle|${detail('Squirtle')}${hp('100/100')}`, '|turn|2',
    // Turn 2: the short-lived body enters, faints, and the replacement stays.
    ...entry, ...hitAndFaint, `|switch|${mover}: ${doubles ? 'Eevee' : 'Pikachu'}|${detail(doubles ? 'Eevee' : 'Pikachu')}${hp('100/100')}`,
    `|switch|${doubles ? 'p2b' : 'p2a'}: Ivysaur|${detail('Ivysaur')}${hp('100/100')}`, '|turn|3',
    '|turn|4',
  ];
  // Bring 3 (singles): Pikachu, Raichu, the short-lived one. Bring 4 (doubles): Pikachu, Eevee, Raichu, the short-lived one.
  const p1Brought = doubles ? ['Pikachu', 'Eevee', 'Raichu', shortLived] : ['Pikachu', 'Raichu', shortLived];
  const p2Brought = doubles ? ['Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur'] : ['Bulbasaur', 'Squirtle', 'Ivysaur'];
  const formatid = doubles ? 'gen9vgc2026regi' : 'gen9battlestadiumsinglesregh';
  const replay = { id: `synthetic-${game}`, formatid, format: formatid, players: ['Alice', 'Bob'], log: lines.join('\n') } as ReplayData;
  return { replay, p1Brought, p2Brought, shortLived, disguise };
}

describe('a body that enters and faints within one turn is fielded', () => {
  for (const game of ['singles', 'doubles'] as const) {
    for (const kind of KINDS) {
      test(`${game}: ${kind}`, () => {
        const { replay, p1Brought, p2Brought, shortLived, disguise } = scene(kind, game);
        const snapshots = parseReplayLog(replay.log);
        const rules = replayRules(replay);
        const count = getReplayBringCount(replay);
        expect(count).toBe(game === 'doubles' ? 4 : 3);
        const bases = (names: string[]) => names.map(name => speciesBaseId(name, rules)).sort();
        expect(bases(broughtSpeciesFor(snapshots, 'p1', rules))).toEqual(bases(p1Brought));
        expect(bases(broughtSpeciesFor(snapshots, 'p2', rules))).toEqual(bases(p2Brought));
        if (kind === 'Illusion break') expect(broughtSpeciesFor(snapshots, 'p1', rules)).not.toContain(disguise);
        // Both sides fielded their whole selection: a pinned list and a list with nothing open.
        const pinned = replayBringOnly(replay, snapshots);
        expect(pinned).not.toBeNull();
        expect(pinned!.p1).toContain(shortLived);
        const list = replayBringList(replay, snapshots)!;
        expect(list.p1.open).toBe(0);
        expect(list.p2.open).toBe(0);
        expect(list.p1.candidates).toEqual([]);
      });
    }
  }
});

const FIXTURE = join(__dirname, '../../eval-engine/test/fixtures/gen9vgc2026regi-2630452654.json');

describe('VGC 2630452654 (the A.3c gate game)', () => {
  test('P2 fielded four bodies: Farigiraf entered on Volt Switch and fainted the same turn', () => {
    const replay = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ReplayData;
    const snapshots = parseReplayLog(replay.log);
    const rules = replayRules(replay);
    const p2 = broughtSpeciesFor(snapshots, 'p2', rules);
    expect(p2).toHaveLength(4);
    expect(p2).toContain('Farigiraf');
    const list = replayBringList(replay, snapshots)!;
    expect(list.p2).toMatchObject({ open: 0, candidates: [] });
    expect(list.p1.open).toBe(0);
    expect(replayBringOnly(replay, snapshots)).not.toBeNull();
  });
});

const FIT = join(__dirname, '../../../.fit-corpus');

describe.skipIf(!existsSync(FIT))('the fit corpus: the list holds every body the log switches in', () => {
  test('every switch or drag line names a body of the side\'s list (games without an Illusion break)', () => {
    let games = 0;
    let full = 0;
    const wrong: string[] = [];
    for (const name of readdirSync(FIT)) {
      if (!name.endsWith('.json')) continue;
      const json = JSON.parse(readFileSync(join(FIT, name), 'utf8')) as ReplayData;
      if (typeof json.log !== 'string' || /^\|replace\|/m.test(json.log)) continue;
      const id = json.id ?? name.replace(/\.json$/, '');
      const source = { ...json, id, formatid: json.formatid ?? id.replace(/-\d.*$/, '') };
      const count = getReplayBringCount(source);
      if (count === null) continue;
      games += 1;
      const rules = replayRules(source);
      const snapshots = parseReplayLog(json.log);
      for (const side of ['p1', 'p2'] as const) {
        const listed = new Set(broughtSpeciesFor(snapshots, side, rules).map(species => speciesBaseId(species, rules)));
        const logged = new Set<string>();
        for (const line of json.log.matchAll(new RegExp(`^\\|(?:switch|drag)\\|${side}[a-d]: [^|]*\\|([^|,]+)`, 'gm'))) logged.add(speciesBaseId(line[1], rules));
        if (![...logged].every(base => listed.has(base))) wrong.push(`${id} ${side}`);
      }
      const list = replayBringList(source, snapshots);
      if (list && list.p1.open === 0 && list.p2.open === 0) full += 1;
    }
    expect(games).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
    expect(full).toBeGreaterThan(0);
  }, 300_000);
});
