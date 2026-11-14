import { describe, expect, test } from 'vitest';
import { DIE_KINDS, type EvalLine, type ForcedDie, type LineDie, type LineStep } from '@fulllifegames/eval-engine';
import { lineBlocks, type LineViewContext } from '../../../src/lib/line-view';
import { bothRolesLine, doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/**
 * Round 89 (#104), step G3: the data under the Lines section. Ruling 33: per player the engine's line and the played line (one
 * line for a player who played the engine's move); chips only for dice that could have gone the other way (question 3a); the
 * tooltip of ▶ Play lists every forced die.
 */
const singles: LineViewContext = { turn: 20, playerNames: SINGLES_NAMES, doubles: false, rules: { gen: 9, mod: undefined } };
const doubles: LineViewContext = {
  turn: 4, playerNames: DOUBLES_NAMES, doubles: true, rules: { gen: 9, mod: undefined },
  actives: { p1: ['Incineroar', 'Amoonguss'], p2: ['Urshifu', 'Rillaboom'] },
};

describe('lineBlocks', () => {
  test('a singles line is one row per step with both players, numbered from the graded turn', () => {
    const [block] = lineBlocks([singlesLine], singles);
    expect(block.player).toBe('Pepitopalotin');
    expect(block.role).toBe('engine: Hydro Pump');
    expect(block.rows.map(row => [row.turn, row.sides.map(side => `${side.player} ${side.text}`)])).toEqual([
      ['T20', ['Tzon Draining Kiss', 'Pepitopalotin Hydro Pump']],
      ['T21', ['Tzon → Corviknight', 'Pepitopalotin Moonblast']],
      ['T22', ['Tzon Brave Bird', 'Pepitopalotin Moonblast']],
    ]);
  });

  test('chips name the dice that could have gone the other way and nothing quiet (3a)', () => {
    const [block] = lineBlocks([singlesLine], singles);
    const chips = block.rows.map(row => row.sides.map(side => side.chips));
    // Hydro Pump hits at 80 percent shows; its crit that does not come and Moonblast's unlanded drop stay quiet
    expect(chips[0]).toEqual([[], ['Hydro Pump: hits (80%)']]);
    expect(chips[1]).toEqual([[], []]);
    // the knock-out that depends on the roll shows, with the rolls that hold it, on the player who rolls it
    expect(chips[2]).toEqual([['Brave Bird: KO (10 of 16 rolls)'], []]);
  });

  test('the tooltip of the play button lists every forced die, the quiet ones too', () => {
    const [block] = lineBlocks([singlesLine], singles);
    expect(block.tooltip).toContain('Play this line as a variation');
    expect(block.tooltip.split('\n').slice(1)).toEqual([
      'T20: Hydro Pump: hits (80%)',
      'T20: Hydro Pump: no crit (96%)',
      'T21: Moonblast: no Special Attack change (70%)',
      'T22: Brave Bird: damage roll 8 (KO in 10 of 16 rolls)',
    ]);
  });

  test('a line that forces no die says so in its tooltip', () => {
    expect(lineBlocks([playedLine], singles)[0].tooltip).toBe('Play this line as a variation, with these dice: none to force.');
  });

  test('the end value reads as the turn card writes a win chance, for the line\'s own player', () => {
    expect(lineBlocks([singlesLine], singles)[0].end).toMatch(/^ends at \d+% for Pepitopalotin$/);
    expect(lineBlocks([bothRolesLine], singles)[0].end).toMatch(/ for Tzon$/);
  });

  test('player 1 first, each player\'s engine line before the played line; a player who played the engine\'s move has one line', () => {
    const blocks = lineBlocks([playedLine, singlesLine, bothRolesLine], singles);
    expect(blocks.map(block => `${block.player} · ${block.role}`)).toEqual([
      'Tzon · played the engine\'s move: Draining Kiss',
      'Pepitopalotin · engine: Hydro Pump',
      'Pepitopalotin · played: Hyper Voice',
    ]);
  });

  test('doubles: one row per player and step, the turn number on the first row of a step, a replacement as its own row', () => {
    const [block] = lineBlocks([doublesLine], doubles);
    expect(block.rows.map(row => [row.turn, row.sides.map(side => `${side.player} ${side.text}`)])).toEqual([
      ['T4', ['pixelfrost Fake Out → Rillaboom + Spore → Zamazenta']],
      ['', ['Mstr_Hawk Sucker Punch → Terapagos + Protect']],
      ['', ['Mstr_Hawk replaces: → Zamazenta-Crowned']],
      ['T5', ['pixelfrost Fake Out → Zamazenta-Crowned + Protect']],
      ['', ['Mstr_Hawk Behemoth Bash → Rillaboom + Protect']],
    ]);
  });

  test('doubles chips ride on the player whose slot holds the die: a speed tie by the name of the body, a roll by the move', () => {
    const [block] = lineBlocks([doublesLine], doubles);
    expect(block.rows[0].sides[0].chips).toEqual(['Speed tie: Urshifu first (50%)', 'Spore: hits (75%)']);
    expect(block.rows[1].sides[0].chips).toEqual([]);
    expect(block.rows[4].sides[0].chips).toEqual(['Behemoth Bash: KO (12 of 16 rolls)']);
  });

  test('a line that leaves a draw to the seed says what the click cannot force', () => {
    const [block] = lineBlocks([{ ...singlesLine, unforced: ['hit-count', 'unnamed draw'] }], singles);
    expect(block.note).toBe('The click cannot force the number of hits of a multi-hit move, sleep turns, random targets and similar draws. The seed decides them.');
    expect(lineBlocks([singlesLine], singles)[0].note).toBeNull();
  });
});

/** Round 89 (#104), step G4b: the smaller faults of the first tester pass. */
describe('lineBlocks: the tester\'s smaller items', () => {
  const hitDie = (slot: string, moveId: string, targetSlot: string): ForcedDie => ({ name: { slot, moveId, targetSlot, kind: 'accuracy' }, result: { happens: true } });
  const shown = (die: ForcedDie, chance: number): LineDie => ({ die, chance, shown: true });
  const stepWith = (dice: LineDie[], over: Partial<LineStep> = {}): LineStep => ({
    p1: { choice: 'move 1, move 2', label: 'Rock Slide + Protect', slots: [{ kind: 'move', moveId: 'rockslide', moveName: 'Rock Slide', dice: dice.map(entry => entry.die) }, { kind: 'move', moveId: 'protect', moveName: 'Protect' }] },
    p2: { choice: 'move 1, move 2', label: 'Protect + Protect', slots: [{ kind: 'move', moveId: 'protect', moveName: 'Protect' }, { kind: 'move', moveId: 'protect', moveName: 'Protect' }] },
    dice, ...over,
  });
  const lineOf = (steps: LineStep[], over: Partial<EvalLine> = {}): EvalLine => ({ ...doublesLine, steps, ...over });

  test('a spread move\'s one die per target names its target, in the chips and in the tooltip (Rock Slide hits twice)', () => {
    const dice = [shown(hitDie('p1a', 'rockslide', 'p2a'), 0.9), shown(hitDie('p1a', 'rockslide', 'p2b'), 0.9)];
    const [block] = lineBlocks([lineOf([stepWith(dice)])], doubles);
    expect(block.rows[0].sides[0].chips).toEqual(['Rock Slide → Urshifu: hits (90%)', 'Rock Slide → Rillaboom: hits (90%)']);
    expect(block.tooltip.split('\n').slice(1)).toEqual(['T4: Rock Slide → Urshifu: hits (90%)', 'T4: Rock Slide → Rillaboom: hits (90%)']);
    // a move with one target keeps its plain subject
    const single = lineBlocks([lineOf([stepWith([dice[0]])])], doubles)[0];
    expect(single.rows[0].sides[0].chips).toEqual(['Rock Slide: hits (90%)']);
  });

  test('the dice of a replacement inside a turn are filed under that turn, not under "Replacement:"', () => {
    const roll = shown({ name: { slot: 'p1a', moveId: 'woodhammer', targetSlot: 'p2a', kind: 'crit' }, result: { happens: false } }, 0.96);
    const pivot = stepWith([]);
    const replacement: LineStep = { ...stepWith([roll]), replacement: 'p1' };
    const [block] = lineBlocks([lineOf([pivot, replacement])], doubles);
    expect(block.tooltip.split('\n').slice(1)).toEqual(['T4: Wood Hammer: no crit (96%)']);
    // a line that opens with a replacement files it under the graded turn
    const [opening] = lineBlocks([lineOf([replacement])], doubles);
    expect(opening.tooltip.split('\n').slice(1)).toEqual(['T4: Wood Hammer: no crit (96%)']);
  });

  test('a damage roll that decides a knock-out says its chance once: the rolls say the same thing', () => {
    const roll: ForcedDie = { name: { slot: 'p1a', moveId: 'weatherball', targetSlot: 'p2a', kind: 'damage-roll' }, result: { step: 8 } };
    const [block] = lineBlocks([lineOf([stepWith([{ die: roll, chance: 0.5625, shown: true, ko: { rolls: 9, of: 16 } }])])], doubles);
    expect(block.tooltip.split('\n')[1]).toBe('T4: Weather Ball: damage roll 9 (KO in 9 of 16 rolls)');
  });

  test('the note\'s last sentence agrees with its noun: one hit count is "it", draws are "them"', () => {
    expect(lineBlocks([{ ...singlesLine, unforced: ['hit-count'] }], singles)[0].note).toMatch(/The seed decides it\.$/);
    expect(lineBlocks([{ ...singlesLine, unforced: ['unnamed draw'] }], singles)[0].note).toMatch(/The seed decides them\.$/);
  });
});

describe('the note under a line names what the click cannot force', () => {
  const noteOf = (...unforced: string[]) => lineBlocks([{ ...singlesLine, unforced }], singles)[0].note;

  test('a random target reads as plain English, with its article and its plural (tester, round 89 G4c)', () => {
    expect(noteOf('random-target')).toBe('The click cannot force random targets. The seed decides them.');
    expect(noteOf('hit-count', 'random-target')).toBe('The click cannot force the number of hits of a multi-hit move, random targets. The seed decides them.');
  });

  test.each([...DIE_KINDS, 'unnamed draw'])('the kind "%s" has words of its own, not its name with the hyphens taken out', kind => {
    const note = noteOf(kind)!;
    const slug = `The click cannot force ${kind.replace(/-/g, ' ')}. The seed decides it.`;
    expect(note).toMatch(/^The click cannot force .+\. The seed decides (it|them)\.$/);
    expect(note, kind).not.toBe(slug);
    expect(note.slice('The click cannot force '.length), kind).not.toContain(':');
  });

  test('every kind reads differently from every other', () => {
    const notes = [...DIE_KINDS, 'unnamed draw'].map(kind => noteOf(kind));
    expect(new Set(notes).size).toBe(notes.length);
  });
});

describe('why a line ends', () => {
  test('a line whose last position asks a player who to send in says so, with the player\'s name (singles and doubles)', () => {
    const [single] = lineBlocks([{ ...singlesLine, awaits: 'p1' }], singles);
    expect(single.endNote).toBe(`The line ends where ${SINGLES_NAMES[0]} must choose who to send in; the search made no choice there.`);
    const [pair] = lineBlocks([{ ...doublesLine, awaits: 'p2' }], doubles);
    expect(pair.endNote).toBe(`The line ends where ${DOUBLES_NAMES[1]} must choose who to send in; the search made no choice there.`);
    expect(lineBlocks([{ ...singlesLine, awaits: 'both' }], singles)[0].endNote).toBe(`The line ends where ${SINGLES_NAMES[0]} and ${SINGLES_NAMES[1]} must choose who to send in; the search made no choice there.`);
  });

  test('a line that ends for another reason has no such note', () => {
    expect(lineBlocks([singlesLine], singles)[0].endNote).toBeNull();
    expect(lineBlocks([doublesLine], doubles)[0].endNote).toBeNull();
  });
});
