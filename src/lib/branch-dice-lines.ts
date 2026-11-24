import { dieLabel, type DiceReport, type DieName, type DieReport, type DieWords, type LiveHit } from '@fulllifegames/eval-engine';
import { foldHitReports, resultWord, wordsOf } from './branch-dice';
import { diceMarksOf, type DiceMarks } from './branch-dice-marks';

/** Forced-die display lines are `|-message|` lines: the replay client and the `/v1.0.2/` viewer print them as is. */

export const DIE_LINE = '|-message|';

export interface DieLine { at: number; text: string }

/** Where a turn's lines stand: `logIndex` counts the battle's log (`|split|` doubles lines), the shown log has one. */
export interface TurnWindow {
  battleLog: readonly string[];
  battleStart: number;
  shownLog: readonly string[];
  shownStart: number;
  complete: boolean;
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

const percent = (chance: number): string => `${Math.round(chance * 1000) / 10} %`;

// The simulator's chance is the die's "happens" (a 95 % move hits at 0.95); a forced non-event has the complement.
const resultChance = (report: DieReport): number | undefined =>
  report.chance !== undefined && 'happens' in report.die.result && !report.die.result.happens ? 1 - report.chance : report.chance;

/** "Forced: Air Slash flinch, 60 %": subject and result of the die's label, then the chance when the die has one. */
export function dieText(report: DieReport, words: DieWords): string {
  const label = dieLabel(report.die, words);
  const cut = label.lastIndexOf(': ');
  const subject = label.slice(0, cut);
  const result = label.slice(cut + 2);
  const named = 'first' in report.die.result;
  const text = `Forced: ${subject}${named ? ', ' : ' '}${named ? result : lowerFirst(result)}`;
  const chance = resultChance(report);
  return chance === undefined ? text : `${text}, ${percent(chance)}`;
}

function noun(report: DieReport, words: DieWords): string {
  const { name, result } = report.die;
  if (name.kind === 'accuracy' && 'happens' in result) return result.happens ? 'hit' : 'miss';
  if (name.kind === 'speed-tie') return 'speed tie';
  return lowerFirst(resultWord(report.die, words));
}

const noEffectText = (report: DieReport, words: DieWords): string =>
  `Forced ${noun(report, words)}${report.landed === undefined ? ' had no effect' : `, ${report.landed} landed`}${report.reason ? `: ${report.reason}` : ''}`;

function startsAction(line: string): boolean {
  const type = line.split('|')[1];
  if (line === '|') return true;
  if (type === 'move') return !line.includes('|[from]');
  return type === 'cant' || type === 'switch' || type === 'drag' || type === 'upkeep' || type === 'turn' || type === 'win' || type === 'tie';
}

const endsTurn = (line: string): boolean => ['upkeep', 'turn', 'win', 'tie'].includes(line.split('|')[1]);

function shownIndex(window: TurnWindow, battleIndex: number): number {
  let count = 0;
  for (let index = window.battleStart; index < battleIndex; count++) {
    index += window.battleLog[index]?.startsWith('|split|') ? 3 : 1;
  }
  return window.shownStart + count;
}

function firstFrom(log: readonly string[], from: number, match: (line: string) => boolean): number {
  const found = log.findIndex((line, index) => index >= from && match(line));
  return found < 0 ? log.length : found;
}

// A count the game cut short is read next to "The Pokémon was hit 1 time!", not behind the end-of-turn lines.
function afterHitCount(window: TurnWindow, name: DieName): number | undefined {
  if (name.kind !== 'hit-count') return undefined;
  const { shownLog, shownStart } = window;
  const idOf = (text: string | undefined): string => (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const move = shownLog.findIndex((line, index) => {
    const fields = line.split('|');
    return index >= shownStart && fields[1] === 'move' && !line.includes('|[from]') && (fields[2] ?? '').split(':')[0] === name.slot && idOf(fields[3]) === name.moveId;
  });
  if (move < 0) return undefined;
  for (let index = move + 1; index < shownLog.length && !startsAction(shownLog[index]); index++) {
    if (shownLog[index].split('|')[1] === '-hitcount') return index + 1;
  }
  return undefined;
}

/** The display lines of one executed turn; a die the simulator never drew gets its line once the turn completes. */
export function dieLines(report: DiceReport, window: TurnWindow, words: DieWords): DieLine[] {
  const lines: DieLine[] = [];
  for (const entry of foldHitReports(report.forced)) {
    const drawn = entry.logIndex !== undefined;
    if (drawn && entry.logIndex! < window.battleStart) continue;
    const at = drawn ? shownIndex(window, entry.logIndex!) : undefined;
    if (at !== undefined && (entry.took === 'applied' || entry.took === 'blocked')) lines.push({ at, text: dieText(entry, words) });
    if (entry.took === 'applied') continue;
    if (!drawn && !window.complete) continue;
    const end = at === undefined ? (afterHitCount(window, entry.die.name) ?? firstFrom(window.shownLog, window.shownStart, endsTurn)) : firstFrom(window.shownLog, at, startsAction);
    lines.push({ at: end, text: noEffectText(entry, words) });
  }
  return lines;
}

// The client splits a line at every pipe and prints the first field: a broken bar (U+00A6) stands in for a quoted pipe.
const asField = (text: string): string => text.replaceAll('|', '\u00a6');

export function withDieLines(log: readonly string[], lines: readonly DieLine[]): readonly string[] {
  if (lines.length === 0) return log;
  const sorted = lines.map((line, order) => ({ ...line, order })).sort((a, b) => a.at - b.at || a.order - b.order);
  const out: string[] = [];
  let next = 0;
  log.forEach((line, index) => {
    while (next < sorted.length && sorted[next].at <= index) out.push(`${DIE_LINE}${asField(sorted[next++].text)}`);
    out.push(line);
  });
  while (next < sorted.length) out.push(`${DIE_LINE}${asField(sorted[next++].text)}`);
  return out;
}

type Battle = LiveHit['battle'];

export interface TurnStart { battleStart: number; shownStart: number; words: DieWords }

export const turnStart = (battle: Battle, shown: readonly string[]): TurnStart =>
  ({ battleStart: battle.log.length, shownStart: shown.length, words: wordsOf(battle) });

/** The report, display lines and marks of the turn just played; the turn is complete once `|upkeep` shows. */
export function entryDice(
  report: DiceReport | undefined, start: TurnStart, battle: Battle, shown: readonly string[], waiting: boolean,
): { diceReport?: DiceReport; dieLines?: DieLine[]; diceMarks?: DiceMarks } {
  if (!report) return {};
  const complete = !waiting || shown.some((line, index) => index >= start.shownStart && line.startsWith('|upkeep'));
  const lines = dieLines(report, { battleLog: battle.log, battleStart: start.battleStart, shownLog: shown, shownStart: start.shownStart, complete }, start.words);
  const marks = diceMarksOf(report, start.words);
  return { diceReport: report, ...(lines.length > 0 ? { dieLines: lines } : {}), ...(marks ? { diceMarks: marks } : {}) };
}
