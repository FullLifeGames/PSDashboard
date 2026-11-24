import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { getMainChoice } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf, FixedDice } from '../src/sim-ask/copy';
import { CHAMPIONS, mon, playClicks, RULES, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championsou');

type Kind = 'singles' | 'doubles' | 'VGC';
interface Row {
  name: string;
  scene: string;
  kind: Kind;
  rules: Rules;
  body: { species: string; ability: string; item: string; moves: string[] };
  /** `fast`: 252 EVs and a Speed nature on the foe, where the plain spread would put the body ahead. */
  foe: { species: string; move: string; fast?: boolean };
  base: string;
  expected: string;
  grassy?: boolean;
}

const GEN9 = RULES.find(rules => rules.generation === 9 && rules !== CHAMPIONS)!;

const ROWS: Row[] = [
  { name: 'singles, Prankster Parting Shot', scene: 'smogtours-gen9ou-671362 turn 9 p2a', kind: 'singles', rules: GEN9,
    body: { species: 'Grafaiai', ability: 'prankster', item: 'choiceband', moves: ['partingshot', 'lowkick', 'foulplay', 'gunkshot'] },
    foe: { species: 'Iron Valiant', move: 'psyshock' }, base: 'partingshot', expected: 'lowkick' },
  { name: 'Champions singles, Grassy Glide in Grassy Terrain', scene: 'gen9championsou-2691527224 turn 14 p2a', kind: 'singles', rules: CHAMPIONS,
    body: { species: 'Rillaboom', ability: 'grassysurge', item: 'rockyhelmet', moves: ['grassyglide', 'uturn', 'knockoff', 'swordsdance'] },
    foe: { species: 'Meowscarada', move: 'uturn' }, base: 'grassyglide', expected: 'uturn', grassy: true },
  { name: 'Doubles OU, Prankster Tailwind before a Thunderclap', scene: 'gen9doublesou-2693479621 turn 11 p1a', kind: 'doubles', rules: GEN9,
    body: { species: 'Tornadus', ability: 'prankster', item: 'covertcloak', moves: ['tailwind', 'bleakwindstorm', 'protect', 'taunt'] },
    foe: { species: 'Raging Bolt', move: 'thunderclap' }, base: 'tailwind', expected: 'bleakwindstorm' },
  { name: 'VGC, Prankster Tailwind', scene: 'gen9vgc2024regh-2248454196 turn 6 p1b', kind: 'VGC', rules: GEN9,
    body: { species: 'Whimsicott', ability: 'prankster', item: 'covertcloak', moves: ['tailwind', 'sunnyday', 'moonblast', 'faketears'] },
    foe: { species: 'Delphox', move: 'heatwave', fast: true }, base: 'tailwind', expected: 'moonblast' },
  { name: 'Champions VGC, Prankster Parting Shot', scene: 'gen9championsvgc2026regmbbo3-2684368511 turn 11 p1a', kind: 'VGC', rules: CHAMPIONS,
    body: { species: 'Grimmsnarl', ability: 'prankster', item: 'lightclay', moves: ['partingshot', 'playrough', 'reflect'] },
    foe: { species: 'Aerodactyl', move: 'rockslide' }, base: 'partingshot', expected: 'playrough' },
];

const BENCH = ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'];

function boardOf(row: Row): Battle {
  const { rules } = row;
  const splash = (species: string) => mon(rules, { species, moves: ['splash'] });
  const body = { ...mon(rules, { species: row.body.species, moves: row.body.moves, gender: 'M' }), ability: row.body.ability, item: row.body.item };
  const plain = mon(rules, { species: row.foe.species, moves: [row.foe.move], gender: 'M' });
  const foe = row.foe.fast ? { ...plain, nature: 'Timid', evs: { ...plain.evs, spe: 252 } } : plain;
  const bench = row.kind === 'VGC' ? BENCH.map(splash) : [];
  const [p1, p2] = row.kind === 'singles' ? [[body], [foe]] : [[body, splash('Blissey'), ...bench], [foe, splash('Vaporeon'), ...bench]];
  const board = battleOf(row.kind === 'singles' ? rules.singles : rules.doubles!, p1, p2);
  if (row.grassy) board.field.setTerrain('grassyterrain', board.sides[0].active[0]);
  return board;
}

function clickOf(row: Row, board: Battle, moveId: string, side: 0 | 1): string {
  const moves = board.sides[side].active[0]!.getMoveRequestData().moves;
  const slot = moves.findIndex(move => move.id === moveId) + 1;
  if (slot === 0) throw new Error(`${moveId} is not a move of the body`);
  const target = board.dex.moves.get(moveId).target;
  const aim = row.kind !== 'singles' && ['normal', 'any', 'adjacentFoe'].includes(target) ? ' 1' : '';
  return row.kind === 'singles' ? `move ${slot}` : `move ${slot}${aim}, move 1`;
}

const unseen = (row: Row): string[] =>
  row.kind === 'singles' ? [] : ['|move|p1b: Blissey|Splash|p1b: Blissey', '|move|p2b: Vaporeon|Splash|p2b: Vaporeon'];

function actsFirst(row: Row, board: Battle, bodyMove: string, chance: boolean): boolean {
  const copy = copyOf(board);
  copy.prng = new FixedDice({ chance });
  const start = copy.log.length;
  playClicks(copy, { p1: clickOf(row, board, bodyMove, 0), p2: clickOf(row, board, row.foe.move, 1) });
  const lines = copy.log.slice(start);
  const own = lines.findIndex(line => line.startsWith('|move|p1a'));
  const foe = lines.findIndex(line => line.startsWith('|move|p2a'));
  return own >= 0 && (foe < 0 || own < foe);
}

describe('the never-acted conflicts of the corpus count', () => {
  test('the rows name the bodies the Dex lets carry them', () => {
    for (const row of ROWS) {
      const dex = dexOfRules(row.rules);
      const species = dex.species.get(row.body.species);
      expect([row.name, species.exists && Object.values(species.abilities).some(name => dex.abilities.get(name).id === row.body.ability)]).toEqual([row.name, true]);
      expect(dex.moves.get(row.foe.move).exists).toBe(true);
    }
  });

  test.each(ROWS)('the stand-in of $name moves behind the foe the log shows first ($scene)', row => {
    const board = boardOf(row);
    const foeName = dexOfRules(row.rules).moves.get(row.foe.move).name;
    const events = [`|move|p2a: ${row.foe.species}|${foeName}|p1a: ${row.body.species}`, ...unseen(row)];
    const choice = getMainChoice(events, 'p1', board as never);
    const slot = Number(/^move (\d+)/.exec(choice)![1]);
    const standIn = board.sides[0].active[0]!.getMoveRequestData().moves[slot - 1].id;
    expect(standIn).toBe(row.expected);
    for (const chance of [false, true]) {
      expect([row.name, 'base pick', chance, actsFirst(row, board, row.base, chance)]).toEqual([row.name, 'base pick', chance, true]);
      expect([row.name, 'stand-in', chance, actsFirst(row, board, standIn, chance)]).toEqual([row.name, 'stand-in', chance, false]);
    }
  });
});
