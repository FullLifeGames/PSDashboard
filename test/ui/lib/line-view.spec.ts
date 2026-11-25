import { describe, expect, test } from 'vitest';
import { DIE_KINDS, winPctText, type EvalLine, type ForcedDie, type LineDie, type LineStep } from '@fulllifegames/eval-engine';
import { LINE_DIFFERS_SENTENCE, LINE_PROVEN_SENTENCE, differsSentences, lineBlocks, replacementWords, type LineViewContext } from '../../../src/lib/line-view';
import { bothRolesLine, doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

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

  test('the head of a line of a body knocked out before it moved says staying in, never that it was played', () => {
    const asNever = { ...singles, neverActed: { p2: true } };
    expect(lineBlocks([playedLine], asNever)[0].role).toBe('staying in: Hyper Voice');
    expect(lineBlocks([{ ...playedLine, for: ['engine', 'played'] }], asNever)[0].role).toBe('engine: Hyper Voice');
    expect(lineBlocks([singlesLine], asNever)[0].role).toBe('engine: Hydro Pump');
    expect(lineBlocks([bothRolesLine], asNever)[0].role).toBe('played the engine\'s move: Draining Kiss');
  });

  test('chips name the dice that could have gone the other way and nothing quiet (3a)', () => {
    const [block] = lineBlocks([singlesLine], singles);
    const chips = block.rows.map(row => row.sides.map(side => side.chips));
    expect(chips[0]).toEqual([[], ['Hydro Pump: hits (80%)']]);
    expect(chips[1]).toEqual([[], []]);
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
    const single = lineBlocks([lineOf([stepWith([dice[0]])])], doubles)[0];
    expect(single.rows[0].sides[0].chips).toEqual(['Rock Slide: hits (90%)']);
  });

  const stallOn = (line: EvalLine, side: 'p1' | 'p2', at: number, slot: string): EvalLine => {
    const die: ForcedDie = { name: { slot, moveId: 'protect', kind: 'stalling', effectId: 'protect' }, result: { happens: false } };
    const [first, ...later] = line.steps;
    const choice = first[side];
    const slots = choice.slots.map((entry, index) => (index === at && entry?.kind === 'move' ? { ...entry, moveId: 'protect', moveName: 'Protect', dice: [die] } : entry));
    return { ...line, steps: [{ ...first, [side]: { ...choice, slots }, dice: [{ die, chance: 2 / 3, shown: true }] }, ...later] };
  };
  test.each([
    ['singles', singles, stallOn(singlesLine, 'p2', 0, 'p2a')],
    ['doubles', doubles, stallOn(doublesLine, 'p2', 1, 'p2b')],
  ] as const)('a stalling move that fails shows its chip, %s', (_kind, ctx, line) => {
    const [block] = lineBlocks([line], ctx);
    expect(block.rows.flatMap(row => row.sides.flatMap(side => side.chips))).toContain('Protect: fails (67%)');
  });

  test('the dice of a replacement inside a turn are filed under that turn, not under "Replacement:"', () => {
    const roll = shown({ name: { slot: 'p1a', moveId: 'woodhammer', targetSlot: 'p2a', kind: 'crit' }, result: { happens: false } }, 0.96);
    const pivot = stepWith([]);
    const replacement: LineStep = { ...stepWith([roll]), replacement: 'p1' };
    const [block] = lineBlocks([lineOf([pivot, replacement])], doubles);
    expect(block.tooltip.split('\n').slice(1)).toEqual(['T4: Wood Hammer: no crit (96%)']);
    const [opening] = lineBlocks([lineOf([replacement])], doubles);
    expect(opening.tooltip.split('\n').slice(1)).toEqual(['T4: Wood Hammer: no crit (96%)']);
  });

  test('a damage roll that decides a knock-out says its chance once: the rolls say the same thing', () => {
    const roll: ForcedDie = { name: { slot: 'p1a', moveId: 'weatherball', targetSlot: 'p2a', kind: 'damage-roll' }, result: { step: 8 } };
    const [block] = lineBlocks([lineOf([stepWith([{ die: roll, chance: 0.5625, shown: true, ko: { rolls: 9, of: 16 } }])])], doubles);
    expect(block.tooltip.split('\n')[1]).toBe('T4: Weather Ball: damage roll 9 (KO in 9 of 16 rolls)');
  });

  // Rolls from `of - rolls` up knock out, read against the boundary the simulator found (`ko`).
  test.each([
    ['roll 9 of a move that knocks out in 1 of 16 rolls', 8, 1, 'Vacuum Wave: no KO (15 of 16 rolls)', 'T4: Vacuum Wave: damage roll 9 (no KO in 15 of 16 rolls)'],
    ['the highest roll of that move', 15, 1, 'Vacuum Wave: KO (1 of 16 rolls)', 'T4: Vacuum Wave: damage roll 16 (KO in 1 of 16 rolls)'],
    ['the lowest roll that knocks out', 6, 10, 'Vacuum Wave: KO (10 of 16 rolls)', 'T4: Vacuum Wave: damage roll 7 (KO in 10 of 16 rolls)'],
    ['the roll just under the boundary', 5, 10, 'Vacuum Wave: no KO (6 of 16 rolls)', 'T4: Vacuum Wave: damage roll 6 (no KO in 6 of 16 rolls)'],
  ])('%s: the chip and the tooltip say what the forced roll does', (_name, step, rolls, chip, tooltip) => {
    for (const ctx of [singles, doubles]) {
      const roll: ForcedDie = { name: { slot: 'p1a', moveId: 'vacuumwave', targetSlot: 'p2a', kind: 'damage-roll' }, result: { step } };
      const [block] = lineBlocks([lineOf([stepWith([{ die: roll, chance: step >= 16 - rolls ? rolls / 16 : (16 - rolls) / 16, shown: true, ko: { rolls, of: 16 } }])])], { ...ctx, turn: 4 });
      expect(block.rows[0].sides.flatMap(side => side.chips)).toEqual([chip]);
      expect(block.tooltip.split('\n')[1]).toBe(tooltip);
    }
  });

  test('the note\'s last sentence agrees with its noun: one hit count is "it", draws are "them"', () => {
    expect(lineBlocks([{ ...singlesLine, unforced: ['hit-count'] }], singles)[0].note).toMatch(/The seed decides it\.$/);
    expect(lineBlocks([{ ...singlesLine, unforced: ['unnamed draw'] }], singles)[0].note).toMatch(/The seed decides them\.$/);
  });
});

describe('the note under a line names what the click cannot force', () => {
  const noteOf = (...unforced: string[]) => lineBlocks([{ ...singlesLine, unforced }], singles)[0].note;

  test('a random target reads as plain English, with its article and its plural', () => {
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
  test('a line that stops at an open replacement says so and names its end, with the player\'s name (singles and doubles)', () => {
    const [single] = lineBlocks([{ ...singlesLine, awaits: 'p1' }], singles);
    expect(single.endNote).toBe(`The line stops before ${SINGLES_NAMES[0]} sends in a replacement. Its end is the board before the switch-in.`);
    const [pair] = lineBlocks([{ ...doublesLine, awaits: 'p2' }], doubles);
    expect(pair.endNote).toBe(`The line stops before ${DOUBLES_NAMES[1]} sends in a replacement. Its end is the board before the switch-in.`);
    expect(lineBlocks([{ ...singlesLine, awaits: 'both' }], singles)[0].endNote).toBe(`The line stops before ${SINGLES_NAMES[0]} and ${SINGLES_NAMES[1]} send in their replacements. Its end is the board before the switch-in.`);
  });

  test('a line that ends for another reason has no such note', () => {
    expect(lineBlocks([singlesLine], singles)[0].endNote).toBeNull();
    expect(lineBlocks([doublesLine], doubles)[0].endNote).toBeNull();
  });
});

describe('both numbers on a line', () => {
  const endOf = (line: EvalLine) => winPctText(line.end, line.endFainted);

  test('singles: the engine line carries its row value and the end value, and differs when the two print differently', () => {
    expect(endOf(singlesLine)).not.toBe('23%');
    const [block] = lineBlocks([singlesLine], { ...singles, rowValues: { p2: { engine: '23%', played: '40%' } } });
    expect(block.row).toBe('23%');
    expect(block.end).toBe(`row 23%, this line ends at ${endOf(singlesLine)}`);
    expect(block.differs).toBe(true);
    const [played] = lineBlocks([playedLine], { ...singles, rowValues: { p2: { engine: '23%', played: '40%' } } });
    expect(played.row).toBe('40%');
    expect(played.end).toBe(`row 40%, this line ends at ${endOf(playedLine)}`);
    const [both] = lineBlocks([bothRolesLine], { ...singles, rowValues: { p1: { engine: '11%', played: '12%' } } });
    expect(both.row).toBe('11%');
  });

  test('doubles: the pair\'s line reads its side\'s row value', () => {
    const [block] = lineBlocks([doublesLine], { ...doubles, rowValues: { p1: { engine: '61%' }, p2: { engine: '5%' } } });
    expect(block.end).toBe(`row 61%, this line ends at ${endOf(doublesLine)}`);
    expect(block.differs).toBe(true);
  });

  test('a line whose end prints as its row has both numbers and no difference to explain', () => {
    const [block] = lineBlocks([singlesLine], { ...singles, rowValues: { p2: { engine: endOf(singlesLine) } } });
    expect(block.end).toBe(`row ${endOf(singlesLine)}, this line ends at ${endOf(singlesLine)}`);
    expect(block.differs).toBe(false);
  });

  test('without a row value the block keeps today\'s words and never differs (the win-path lines have none)', () => {
    for (const rowValues of [undefined, {}, { p1: { engine: '50%' } }]) {
      const [block] = lineBlocks([singlesLine], { ...singles, ...(rowValues ? { rowValues } : {}) });
      expect(block.end).toBe(`ends at ${endOf(singlesLine)} for Pepitopalotin`);
      expect(block.row).toBeNull();
      expect(block.differs).toBe(false);
    }
  });

  test('the end value alone is on the block, for the Game review', () => {
    expect(lineBlocks([singlesLine], singles)[0].endPct).toBe(endOf(singlesLine));
  });
});

// `winPercent` shows exactly 100 only for an ended evaluation; a line stops before the game ends.
describe('the sentences under a section of lines', () => {
  const block = (row: string | null, endPct: string) => lineBlocks([singlesLine], { ...singles, ...(row ? { rowValues: { p2: { engine: row } } } : {}) })
    .map(item => ({ ...item, endPct }))[0];
  const rowOf = (row: string) => { const item = block(row, '50%'); return { differs: item.differs, row: item.row }; };

  test.each([['singles', singles], ['doubles', doubles]])('%s: a differing row gets the averages sentence, and a proven row the second one too', (_kind, ctx) => {
    const line = ctx === singles ? singlesLine : doublesLine;
    const at = (row: string) => lineBlocks([line], { ...ctx, rowValues: { p1: { engine: row }, p2: { engine: row } } });
    const rows = (blocks: ReturnType<typeof at>) => differsSentences(blocks);
    expect(rows(at('23%'))).toEqual([LINE_DIFFERS_SENTENCE]);
    expect(rows(at('100%'))).toEqual([LINE_DIFFERS_SENTENCE, LINE_PROVEN_SENTENCE]);
    expect(rows(at('0%'))).toEqual([LINE_DIFFERS_SENTENCE, LINE_PROVEN_SENTENCE]);
    const same = lineBlocks([line], { ...ctx, rowValues: { p1: { engine: lineBlocks([line], ctx)[0].endPct }, p2: { engine: lineBlocks([line], ctx)[0].endPct } } });
    expect(rows(same)).toEqual([]);
  });

  test('the proven sentence says what the row is and why the line differs, with no dash', () => {
    expect(LINE_PROVEN_SENTENCE).toBe('A row at 100% (or 0%) is one where every answer and die ends the game; its line stops before the game ends, so its end is the estimate of the position it stops at.');
    expect(rowOf('100%').row).toBe('100%');
  });
});

describe('the answer a line meets', () => {
  const ranked = (...p1: string[]) => ({ p1, p2: ['Hydro Pump', 'Hyper Voice'] });

  test('singles: the first answer reads as the opponent\'s top, second or third choice, or by its number', () => {
    const replyOf = (...order: string[]) => lineBlocks([singlesLine], { ...singles, ranks: ranked(...order) })[0].reply;
    expect(replyOf('Draining Kiss', 'Surf')).toEqual({ label: 'Draining Kiss', rank: "Tzon's top choice", off: false });
    expect(replyOf('Surf', 'Draining Kiss')).toEqual({ label: 'Draining Kiss', rank: "Tzon's second choice in this search", off: true });
    expect(replyOf('Surf', 'Earthquake', 'Draining Kiss')).toEqual({ label: 'Draining Kiss', rank: "Tzon's third choice in this search", off: true });
    expect(replyOf('A', 'B', 'C', 'Draining Kiss')).toEqual({ label: 'Draining Kiss', rank: "Tzon's fourth choice in this search", off: true });
    expect(replyOf('A', 'B', 'C', 'D', 'Draining Kiss')).toEqual({ label: 'Draining Kiss', rank: "Tzon's fifth choice in this search", off: true });
    expect(replyOf('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'Draining Kiss')?.rank).toBe("Tzon's 12th choice in this search");
  });

  test('a pivot\'s pair rows stand for the bare move a line names', () => {
    expect(lineBlocks([singlesLine], { ...singles, ranks: ranked('Surf', 'Draining Kiss → Mew', 'Draining Kiss → Corviknight') })[0].reply)
      .toEqual({ label: 'Draining Kiss', rank: "Tzon's second choice in this search", off: true });
    expect(lineBlocks([singlesLine], { ...singles, ranks: ranked('Draining Kiss → Mew', 'Surf') })[0].reply)
      .toEqual({ label: 'Draining Kiss', rank: "Tzon's top choice", off: false });
  });

  test('a doubles joint choice with a switch part is never cut at its arrow', () => {
    const joint = 'Protect + → Basculegion';
    const line = { ...doublesLine, steps: [{ ...doublesLine.steps[0], p2: { ...doublesLine.steps[0].p2, label: 'Protect' } }, ...doublesLine.steps.slice(1)] };
    expect(lineBlocks([line], { turn: 4, playerNames: DOUBLES_NAMES, doubles: true, rules: { gen: 9, mod: undefined }, ranks: { p1: [], p2: [joint] } })[0].reply?.rank)
      .toBe("not among Mstr_Hawk's ranked choices");
  });

  test('an answer the ranking does not hold is named as such', () => {
    expect(lineBlocks([singlesLine], { ...singles, ranks: ranked('Surf') })[0].reply).toEqual({ label: 'Draining Kiss', rank: "not among Tzon's ranked choices", off: true });
  });

  test('the answer of the other side is read for either side\'s line: player 1\'s line meets player 2\'s answer', () => {
    expect(lineBlocks([bothRolesLine], { ...singles, ranks: ranked('Surf') })[0].reply).toEqual({ label: 'Hydro Pump', rank: "Pepitopalotin's top choice", off: false });
    expect(lineBlocks([bothRolesLine], { ...singles, ranks: { p1: [], p2: ['Surf', 'Hydro Pump'] } })[0].reply?.rank).toBe("Pepitopalotin's second choice in this search");
  });

  test('doubles: the pair of the other player is the answer, ranked by its combined label', () => {
    const pair = 'Sucker Punch → Terapagos + Protect';
    const [top] = lineBlocks([doublesLine], { ...doubles, ranks: { p1: [], p2: [pair, 'Other'] } });
    expect(top.reply).toEqual({ label: pair, rank: "Mstr_Hawk's top choice", off: false });
    const [second] = lineBlocks([doublesLine], { ...doubles, ranks: { p1: [], p2: ['Other', pair] } });
    expect(second.reply).toEqual({ label: pair, rank: "Mstr_Hawk's second choice in this search", off: true });
    expect(lineBlocks([doublesLine], { ...doubles, ranks: { p1: [], p2: ['Other'] } })[0].reply?.rank).toBe("not among Mstr_Hawk's ranked choices");
  });

  test('a line that opens with a replacement meets no answer, and a context without ranks names none', () => {
    const opening: EvalLine = { ...doublesLine, steps: [doublesLine.steps[1], ...doublesLine.steps.slice(2)] };
    expect(lineBlocks([opening], { ...doubles, ranks: { p1: [], p2: ['x'] } })[0].reply).toBeNull();
    expect(lineBlocks([singlesLine], singles)[0].reply).toBeNull();
    expect(lineBlocks([doublesLine], doubles)[0].reply).toBeNull();
  });
});

describe('the reply the search rates lowest, in the bracket', () => {
  const ranks = { p1: ['Draining Kiss', 'Surf'], p2: ['Hydro Pump', 'Hyper Voice'] };
  const worst = (label: string, basis: 'cell' | 'punisher' = 'cell', cell: string | null = basis === 'cell' ? '49%' : null) => () => ({ label, basis, cell });

  test('singles: a move, a switch and a thin cell', () => {
    expect(lineBlocks([bothRolesLine], { ...singles, ranks, worst: worst('Hydro Pump') })[0].reply)
      .toEqual({ label: 'Hydro Pump', rank: 'the reply the search rates lowest for this choice, 49% in its cell', off: false });
    expect(lineBlocks([bothRolesLine], { ...singles, ranks, worst: worst('Hydro Pump', 'punisher') })[0].reply?.rank)
      .toBe('the reply the search rates lowest for this choice, from a thinly searched cell');
  });

  test('a cell the matrix cannot price leaves the value out of the bracket', () => {
    expect(lineBlocks([bothRolesLine], { ...singles, ranks, worst: worst('Hydro Pump', 'cell', null) })[0].reply?.rank).toBe('the reply the search rates lowest for this choice');
  });

  test('a pair row of the card is the bare move the line meets: no "No line against" sentence, the bracket names the reply', () => {
    const [block] = lineBlocks([bothRolesLine], { ...singles, ranks, worst: worst('Hydro Pump → Mew') });
    expect(block.reply).toEqual({ label: 'Hydro Pump', rank: 'the reply the search rates lowest for this choice, 49% in its cell', off: false });
    expect(block.worstNote).toBeNull();
  });

  test('a line that meets another reply keeps its rank words and gets the sentence, which names the choice by those words too', () => {
    const [block] = lineBlocks([bothRolesLine], { ...singles, ranks, worst: worst('Hyper Voice') });
    expect(block.reply?.rank).toBe("Pepitopalotin's top choice");
    expect(block.worstNote).toBe('No line against Hyper Voice, the reply the search rates lowest for this choice. This line meets Hydro Pump.');
  });

  test('doubles: the joint choice is not repeated', () => {
    const joint = 'Sucker Punch → Terapagos + Protect';
    const [block] = lineBlocks([doublesLine], { turn: 4, playerNames: DOUBLES_NAMES, doubles: true, rules: { gen: 9, mod: undefined }, ranks: { p1: [], p2: [joint] }, worst: worst(joint) });
    expect(block.reply?.rank).toBe('the reply the search rates lowest for this choice, 49% in its cell');
  });
});

describe('a replacement names the bodies that come in, not the slot that passes', () => {
  const withPass: typeof doublesLine = {
    ...doublesLine,
    steps: doublesLine.steps.map(step => (step.replacement ? { ...step, p2: { ...step.p2, label: '→ Zamazenta-Crowned + pass' } } : step)),
  };

  test('the row of the Lines section', () => {
    const [block] = lineBlocks([withPass], doubles);
    expect(block.rows[2].sides[0].text).toBe('replaces: → Zamazenta-Crowned');
  });

  test('both orders, and a label with no pass is unchanged', () => {
    expect(replacementWords('pass + → Zamazenta-Crowned')).toBe('→ Zamazenta-Crowned');
    expect(replacementWords('→ A + → B')).toBe('→ A + → B');
  });
});
