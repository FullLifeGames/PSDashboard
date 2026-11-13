import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { registerChampionsDex } from '../src/rules-dex';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * Round 89 (#132): a Pokémon that spends a move's last PP and shows no item line held no Leppa Berry. The simulator's Leppa
 * Berry eats in `onUpdate` the moment any slot sits at 0 PP and its holder has HP, so a log that shows the 0-PP use without
 * the berry's line rules the berry out. Every log comes from @pkmn/sim: each scene plays once with a neutral item (what the
 * inference reads) and once with a Leppa Berry (what a real holder shows), and the two must agree. A guard is a scene where
 * the real holder shows nothing although the move ran out, or where the log cannot tell: the inference rules nothing out.
 * The sweep that holds the rule to every Dex item and the PP read to the simulator is `pp-trigger-sweep.spec.ts`; the corpus
 * rows (Champions OU 2692599072 and the games of the issue) are `test/regression/leppa-refuted-corpus.spec.ts`.
 */

if (!Dex.formats.get('gen9championsou').exists) registerChampionsDex(championsMod as never, championsMod.Formats as never);

interface Format { name: string; id: string; doubles: boolean; revival: boolean }
// Revival Blessing (1 PP, so 1 PP at the maximum too) exists from Generation 9; the other rows spend the PP of a repeated move.
const FORMATS: Format[] = [
  { name: 'Gen 9 OU (singles)', id: 'gen9ou', doubles: false, revival: true },
  { name: 'Gen 9 Doubles OU', id: 'gen9doublesou', doubles: true, revival: true },
  { name: 'Champions OU (singles)', id: 'gen9championsou', doubles: false, revival: true },
  { name: 'Champions VGC (doubles)', id: 'gen9championsvgc2026regmc', doubles: true, revival: true },
  { name: 'Gen 4 OU (singles)', id: 'gen4ou', doubles: false, revival: false },
  { name: 'Gen 5 Doubles OU', id: 'gen5doublesou', doubles: true, revival: false },
];

const set = (species: string, item: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', level: 100, gender: '',
  evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

/** An item that shows nothing in a log, so the holder stays unknown. */
const NEUTRAL = 'Mystic Water';
const LEPPA = 'Leppa Berry';

interface Scene {
  /** What the holder does each turn (a move id; the foe's target is chosen by the harness). */
  turns: string[];
  holder: (item: string) => PokemonSet;
  foe?: PokemonSet;
  /** The p1 move of the turn, by index (default Splash). */
  foeTurns?: string[];
  /** Whether a real Leppa Berry holder eats. */
  shown: boolean;
  /** A line spliced into the neutral log after the holder's last move line (a faint, a transform). */
  splice?: (log: string) => string;
}

/** The format's own maximum PP of a move (the simulator builds every move with three PP Ups; Champions computes PP its own way). */
function maxPpIn(format: Format, move: string): number {
  const holder = set('Blissey', '', 'Natural Cure', [move]);
  const battle = new Battle({ formatid: toID(format.id), seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack([holder]) }, p2: { name: 'B', team: Teams.pack([holder]) } });
  return battle.p1.pokemon[0].moveSlots.find(slot => slot.id === toID(move))!.maxpp;
}

function play(format: Format, scene: Scene, item: string): string {
  const mate = set('Chansey', 'Leftovers', 'Natural Cure', ['Splash']);
  const bench = set('Heatran', 'Leftovers', 'Flash Fire', ['Splash']);
  const foe = scene.foe ?? set('Chansey', 'Leftovers', 'Natural Cure', ['Splash']);
  const p1 = format.doubles ? [foe, set('Skarmory', 'Leftovers', 'Sturdy', ['Splash']), mate, bench] : [foe, mate];
  const p2 = format.doubles ? [scene.holder(item), set('Skarmory', 'Leftovers', 'Sturdy', ['Splash']), mate, bench] : [scene.holder(item), bench];
  const battle = new Battle({
    formatid: toID(format.id), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  const holderSet = scene.holder(item);
  scene.turns.forEach((move, index) => {
    const aim = (id: string) => (['normal', 'any', 'adjacentFoe'].includes(Dex.moves.get(id).target) && format.doubles ? ' 1' : '');
    const own = `move ${holderSet.moves.map(toID).indexOf(toID(move)) + 1}${aim(move)}`;
    const foeMove = scene.foeTurns?.[index];
    const theirs = foeMove ? `move ${foe.moves.map(toID).indexOf(toID(foeMove)) + 1}${aim(foeMove)}` : 'move 1';
    battle.choose('p1', format.doubles ? `${theirs}, move 1` : theirs);
    battle.choose('p2', format.doubles ? `${own}, move 1` : own);
  });
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  return item === NEUTRAL && scene.splice ? scene.splice(log) : log;
}

const ruledOut = (log: string, species: string) => inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species)?.ruledOut?.items ?? [];

function read(format: Format, scene: Scene, species = 'Pawmot') {
  const real = play(format, scene, LEPPA);
  const shown = new RegExp(`\\|-enditem\\|p2a: ${species}\\|${LEPPA}`).test(real);
  return { shown, out: ruledOut(play(format, scene, NEUTRAL), species).includes('leppaberry'), real };
}

const revival = (extra: Partial<Scene> = {}): Scene => ({
  turns: ['revivalblessing'], holder: item => set('Pawmot', item, 'Natural Cure', ['Revival Blessing', 'Splash']), shown: true, ...extra,
});
/** After the holder's move line: the line a scene needs between its action and the next boundary. */
const afterHolderMove = (line: string) => (log: string) => log.replace(/(\|move\|p2a: Pawmot\|Revival Blessing[^\n]*\n)/, `$1${line}\n`);

describe('a move that ran out of PP with no Leppa Berry line rules the berry out (#132)', () => {
  for (const format of FORMATS.filter(entry => entry.revival)) {
    test(`${format.name}: Revival Blessing, a 1 PP move, spent in its first use`, () => {
      const result = read(format, revival());
      expect({ shown: result.shown, out: result.out }).toEqual({ shown: true, out: true });
    });
  }

  test.each(FORMATS.map(format => [format.name, format] as const))('%s: a move used to its maximum PP rules the berry out, one use fewer rules nothing out', (_name, format) => {
    const max = maxPpIn(format, 'toxic');
    const scene = (uses: number): Scene => ({ turns: Array(uses).fill('toxic'), holder: item => set('Blissey', item, 'Natural Cure', ['Toxic', 'Splash']), foe: set('Heatran', 'Leftovers', 'Flash Fire', ['Splash']), shown: uses === max });
    expect(read(format, scene(max), 'Blissey').out).toBe(true);
    expect(read(format, scene(max), 'Blissey').shown).toBe(true);
    const fewer = read(format, scene(max - 1), 'Blissey');
    expect({ shown: fewer.shown, out: fewer.out }).toEqual({ shown: false, out: false });
  });

  test.each(FORMATS.map(format => [format.name, format] as const))('%s: Pressure counts twice, so the berry is ruled out at the use where the simulator eats it', (_name, format) => {
    const toxic = (uses: number): Scene => ({
      turns: Array(uses).fill('toxic'), holder: item => set('Blissey', item, 'Natural Cure', ['Toxic', 'Splash']), shown: true,
      foe: set('Heatran', 'Leftovers', 'Pressure', ['Splash']),
    });
    const max = maxPpIn(format, 'toxic');
    // The simulator names the use: the first turn after which a real Leppa Berry holder eats.
    let eaten = 0;
    for (let uses = 1; uses <= max && !eaten; uses++) if (read(format, toxic(uses), 'Blissey').shown) eaten = uses;
    expect(eaten, 'a use below the plain maximum eats').toBeGreaterThan(0);
    expect(eaten, 'Pressure spends more than one PP per use').toBeLessThan(max);
    expect(read(format, toxic(eaten), 'Blissey').out).toBe(true);
    expect(read(format, toxic(eaten - 1), 'Blissey').out).toBe(false);
  });

  test.each(FORMATS.filter(entry => entry.revival).map(format => [format.name, format] as const))('%s: the Leppa Berry line of a real holder is the evidence, and nothing is ruled out then', (_name, format) => {
    const real = play(format, revival(), LEPPA);
    expect(real).toMatch(/\|-enditem\|p2a: Pawmot\|Leppa Berry/);
    expect(ruledOut(real, 'Pawmot')).not.toContain('leppaberry');
  });
});

describe('guards: the log cannot tell, so nothing is ruled out (#132)', () => {
  const guards: [string, Partial<Scene>, string?][] = [
    ['a foe with Unnerve stops the berry', { foe: set('Tyranitar', 'Leftovers', 'Unnerve', ['Splash']), shown: false }, undefined],
    ['a holder that may have Klutz ignores its item', { holder: item => set('Lopunny', item, 'Klutz', ['Revival Blessing', 'Splash']), shown: false }, 'Lopunny'],
    ['a holder that faints in the same action', { shown: false, splice: afterHolderMove('|faint|p2a: Pawmot') }, undefined],
  ];
  const revivalFormats = FORMATS.filter(entry => entry.revival);
  test.each(revivalFormats.flatMap(format => guards.map(guard => [format.name, ...guard, format] as const)))('%s: %s', (_name, _what, extra, species, format) => {
    const result = read(format, revival(extra), species);
    // A spliced line (a faint) exists only in the inferred log: the real holder's log cannot say what it would have shown.
    if (!extra.splice) expect(result.shown).toBe(false);
    expect(result.out).toBe(false);
  });

  test.each(revivalFormats.map(format => [format.name, format] as const))('%s: a transformed holder is read for nothing', (_name, format) => {
    // Ditto copies a foe that knows Revival Blessing; the copy's slots hold 5 PP, and the client books them as the target's, not the holder's.
    const scene: Scene = {
      turns: ['transform', 'revivalblessing'], foeTurns: ['revivalblessing', 'revivalblessing'], shown: false,
      holder: item => set('Ditto', item, 'Limber', ['Transform']),
      foe: set('Pawmot', 'Leftovers', 'Natural Cure', ['Revival Blessing', 'Splash']),
    };
    expect(read(format, scene, 'Ditto')).toMatchObject({ shown: false, out: false });
  });

  test.each(revivalFormats.map(format => [format.name, format] as const))('%s: Embargo on the holder keeps the item from working', (_name, format) => {
    // The foe embargoes in turn 1, the holder uses Revival Blessing in turn 2.
    const scene: Scene = {
      turns: ['splash', 'revivalblessing'], foeTurns: ['embargo', 'splash'], shown: false, holder: item => set('Pawmot', item, 'Natural Cure', ['Revival Blessing', 'Splash']),
      foe: set('Chansey', 'Leftovers', 'Natural Cure', ['Embargo', 'Splash']),
    };
    const result = read(format, scene);
    expect({ shown: result.shown, out: result.out }).toEqual({ shown: false, out: false });
  });

  test.each(revivalFormats.map(format => [format.name, format] as const))('%s: Magic Room keeps the item from working', (_name, format) => {
    const scene: Scene = {
      turns: ['splash', 'revivalblessing'], foeTurns: ['magicroom', 'splash'], shown: false, holder: item => set('Pawmot', item, 'Natural Cure', ['Revival Blessing', 'Splash']),
      foe: set('Chansey', 'Leftovers', 'Natural Cure', ['Magic Room', 'Splash']),
    };
    const result = read(format, scene);
    expect({ shown: result.shown, out: result.out }).toEqual({ shown: false, out: false });
  });
});
