import { describe, expect, test } from 'vitest';
import { Battle as LiveBattle, Teams, toID, type Battle, type PokemonSet } from '@pkmn/sim';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';

/**
 * Round 70 (batch fix): the rebuild plays a Z-move or Max move line as the game did, once the set holds the base move. The log shows
 * the powered move ("Devastating Drake", "Z-Dragon Dance", "Max Airstream") and the rebuild clicks it by that name. The simulator
 * reads the name as the slot of the base move with its marker (`zmove`, and the Dynamax on its first turn). That behavior belongs to
 * the simulator, and the rebuild relies on it, so these tests pin it: each click must be accepted, and the turn it plays must show
 * the lines the game showed (the Z-power, the Dynamax, the powered move).
 */

type Format = 'singles' | 'doubles';
const FORMATS: Format[] = ['singles', 'doubles'];

const mon = (species: string, item: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});
const SKARMORY = mon('Skarmory', 'Leftovers', 'Sturdy', ['Splash']);
const CHANSEY = mon('Chansey', 'Leftovers', 'Natural Cure', ['Splash']);

function make(gen: 7 | 8, format: Format, tested: PokemonSet): Battle {
  const doubles = format === 'doubles';
  const p1 = doubles ? [SKARMORY, CHANSEY] : [SKARMORY];
  const p2 = doubles ? [tested, CHANSEY] : [tested];
  const battle = new LiveBattle({
    formatid: toID(`gen${gen}${doubles ? 'doublescustomgame' : 'customgame'}`) as never, seed: [1, 2, 3, 4],
    p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const fragment = (format: Format, tested: string) => (format === 'doubles' ? `${tested}, move 1` : tested);
const splash = (format: Format) => (format === 'doubles' ? 'move 1, move 1' : 'move 1');
const foe = (format: Format) => (format === 'doubles' ? ' 1' : '');

/** The public lines of a battle's log. */
const publicLines = (battle: Battle) =>
  battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|'));

/** The lines of p2's tested body that mark a Z-move or a Dynamax. */
const powerLines = (events: string[]) => events.filter(line => /^\|(-zpower\||-start\|p2a: [^|]*\|Dynamax|move\|p2a)/.test(line));

/**
 * Plays `clicks` for p2's tested body (p1 splashes), then has the rebuild choose the last click again on a board that stands at the
 * start of that turn. Returns what the game showed, what the rebuild's turn showed, and whether the simulator took the click.
 */
function replayLastTurn(gen: 7 | 8, format: Format, tested: PokemonSet, clicks: string[]) {
  const played = make(gen, format, tested);
  const board = make(gen, format, tested);
  clicks.forEach((click, index) => {
    expect(played.choose('p1', splash(format))).toBe(true);
    expect(played.choose('p2', fragment(format, click))).toBe(true);
    if (index < clicks.length - 1) {
      expect(board.choose('p1', splash(format))).toBe(true);
      expect(board.choose('p2', fragment(format, click))).toBe(true);
    }
  });
  const turnOf = (battle: Battle) => parseTurnBlocks(publicLines(battle).join('\n')).turns.find(entry => entry.turn === clicks.length)!.preUpkeep;
  const game = turnOf(played);
  const choice = getMainChoice(game, 'p2', board as never);
  const accepted = board.choose('p2', choice) && board.choose('p1', splash(format));
  return { game: powerLines(game), rebuilt: accepted ? powerLines(turnOf(board)) : [], accepted, choice };
}

const GARCHOMP = mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Dragon Dance', 'Outrage', 'Earthquake', 'Stealth Rock']);
const CORVIKNIGHT = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Roost', 'Body Press', 'Iron Defense']);

/** The rebuilt turn shows the Z-power, the Dynamax and the powered move the game showed. */
function expectSameTurn(gen: 7 | 8, format: Format, tested: PokemonSet, clicks: string[], powered: string) {
  const result = replayLastTurn(gen, format, tested, clicks);
  expect(result.accepted, `the simulator takes "${result.choice}"`).toBe(true);
  expect(result.game.some(line => line.includes(`|${powered}|`))).toBe(true);
  expect(result.rebuilt).toEqual(result.game);
}

describe('a Z-move line is rebuilt as the same Z-move (Gen 7)', () => {
  test.each(FORMATS)('%s: a Dragon Z-move of the Dragon attack in the set', format => {
    expectSameTurn(7, format, GARCHOMP, [`move 2${foe(format)} zmove`], 'Devastating Drake');
  });

  test.each(FORMATS)('%s: a status Z-move of the status move in the set', format => {
    expectSameTurn(7, format, GARCHOMP, ['move 1 zmove'], 'Z-Dragon Dance');
  });

  test.each(FORMATS)('%s: a species\' own Z-move of its base move', format => {
    const raichu = mon('Raichu-Alola', 'Aloraichium Z', 'Surge Surfer', ['Surf', 'Thunderbolt', 'Nasty Plot', 'Focus Blast']);
    expectSameTurn(7, format, raichu, [`move 2${foe(format)} zmove`], 'Stoked Sparksurfer');
  });

  test('a body whose set lacks the base move gets a click the simulator rejects: that is why the build must hold the base move', () => {
    const { game } = replayLastTurn(7, 'singles', GARCHOMP, ['move 2 zmove']);
    expect(game.some(line => line.includes('|Devastating Drake|'))).toBe(true);
    const bare = make(7, 'singles', mon('Garchomp', 'Dragonium Z', 'Rough Skin', ['Tackle']));
    expect(bare.choose('p2', 'move devastatingdrake')).toBe(false);
  });
});

describe('a Max move line is rebuilt as the same Max move, Dynamax included (Gen 8)', () => {
  test.each(FORMATS)('%s: the first Max move starts the Dynamax', format => {
    expectSameTurn(8, format, CORVIKNIGHT, [`move 1${foe(format)} dynamax`], 'Max Airstream');
  });

  test.each(FORMATS)('%s: a later Max move and Max Guard', format => {
    const first = `move 1${foe(format)} dynamax`;
    expectSameTurn(8, format, CORVIKNIGHT, [first, `move 3${foe(format)}`], 'Max Knuckle');
    expectSameTurn(8, format, CORVIKNIGHT, [first, 'move 2'], 'Max Guard');
  });

  test.each(FORMATS)('%s: a G-Max move', format => {
    const gmax = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird', 'Roost'], { gigantamax: true });
    expectSameTurn(8, format, gmax, [`move 1${foe(format)} dynamax`], 'G-Max Wind Rage');
  });
});
