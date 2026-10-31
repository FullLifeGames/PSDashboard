import { dieLabel, type DiceReport, type DieReport, type DieWords, type LiveHit } from '@fulllifegames/eval-engine';
import { resultWord, wordsOf } from './branch-dice';

/**
 * Round 82 (forced dice), step A7b, decision 6a: the lines the frame shows for the dice the user forced. A line before the event a
 * forced die decided ("Forced: Air Slash flinch, 60 %", the chance the simulator used, decision 14a) and, for a forced die that took
 * no effect, a line at the end of its action ("Forced burn had no effect", with the report's reason). The lines live in the display
 * of the branch log, never in the battle's log: `branchFrameLog` puts them in. The replay client prints a `|-message|` line as it
 * is, and the frozen `/v1.0.2/` viewer plays the same client, so a shared branch shows the marks as well.
 */

/** The protocol line the replay client renders as plain text in the battle log. */
export const DIE_LINE = '|-message|';

/** A display line and the place it goes: before the line at index `at` of the shown log. */
export interface DieLine { at: number; text: string }

/**
 * Where a turn's lines stand. The report's `logIndex` counts the battle's own log, which writes a `|split|` line and both versions
 * of a line the players see differently; the shown log (what the stream gave the app) has one line there. `battleStart` and
 * `shownStart` are the two lengths before the turn's real play; `complete` is false while the turn waits for a switch.
 */
export interface TurnWindow {
  battleLog: readonly string[];
  battleStart: number;
  shownLog: readonly string[];
  shownStart: number;
  complete: boolean;
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** The chance the simulator used, as a percent with up to one decimal. */
const percent = (chance: number): string => `${Math.round(chance * 1000) / 10} %`;

/** "Forced: Air Slash flinch, 60 %": the subject and the result of the die's label, then the chance of the draw when it has one. */
export function dieText(report: DieReport, words: DieWords): string {
  const label = dieLabel(report.die, words);
  const cut = label.lastIndexOf(': ');
  const subject = label.slice(0, cut);
  const result = label.slice(cut + 2);
  const named = 'first' in report.die.result;
  const text = `Forced: ${subject}${named ? ', ' : ' '}${named ? result : lowerFirst(result)}`;
  return report.chance === undefined ? text : `${text}, ${percent(report.chance)}`;
}

/** What the die decided, as a noun for "Forced ... had no effect". */
function noun(report: DieReport, words: DieWords): string {
  const { name, result } = report.die;
  if (name.kind === 'accuracy' && 'happens' in result) return result.happens ? 'hit' : 'miss';
  if (name.kind === 'speed-tie') return 'speed tie';
  return lowerFirst(resultWord(report.die, words));
}

const noEffectText = (report: DieReport, words: DieWords): string =>
  `Forced ${noun(report, words)} had no effect${report.reason ? `: ${report.reason}` : ''}`;

/** The lines that open the next action or end the turn (the simulator's protocol; the dice module's reports read the same ones). */
function startsAction(line: string): boolean {
  const type = line.split('|')[1];
  if (line === '|') return true;
  if (type === 'move') return !line.includes('|[from]');
  return type === 'cant' || type === 'switch' || type === 'drag' || type === 'upkeep' || type === 'turn' || type === 'win' || type === 'tie';
}

const endsTurn = (line: string): boolean => ['upkeep', 'turn', 'win', 'tie'].includes(line.split('|')[1]);

/** The shown-log index of a battle-log index inside the turn: one line for each split triple and each plain line before it. */
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

/**
 * The display lines of one executed turn, from the report of the user's dice. A die drawn before this part of the turn (a turn that
 * paused for a switch reports every die in its last part) has its lines from the part that drew it; a die the simulator never
 * drew gets its line only once the turn is complete, since the rest of the turn may still draw it.
 */
export function dieLines(report: DiceReport, window: TurnWindow, words: DieWords): DieLine[] {
  const lines: DieLine[] = [];
  for (const entry of report.forced) {
    const drawn = entry.logIndex !== undefined;
    if (drawn && entry.logIndex! < window.battleStart) continue;
    const at = drawn ? shownIndex(window, entry.logIndex!) : undefined;
    if (at !== undefined && (entry.took === 'applied' || entry.took === 'blocked')) lines.push({ at, text: dieText(entry, words) });
    if (entry.took === 'applied') continue;
    if (!drawn && !window.complete) continue;
    const end = at === undefined ? firstFrom(window.shownLog, window.shownStart, endsTurn) : firstFrom(window.shownLog, at, startsAction);
    lines.push({ at: end, text: noEffectText(entry, words) });
  }
  return lines;
}

/** The shown log with the display lines in it, each before the line at its index (several lines at one index keep their order). */
export function withDieLines(log: readonly string[], lines: readonly DieLine[]): readonly string[] {
  if (lines.length === 0) return log;
  const sorted = lines.map((line, order) => ({ ...line, order })).sort((a, b) => a.at - b.at || a.order - b.order);
  const out: string[] = [];
  let next = 0;
  log.forEach((line, index) => {
    while (next < sorted.length && sorted[next].at <= index) out.push(`${DIE_LINE}${sorted[next++].text}`);
    out.push(line);
  });
  while (next < sorted.length) out.push(`${DIE_LINE}${sorted[next++].text}`);
  return out;
}

type Battle = LiveHit['battle'];

/** What the executor reads before it plays the turn: the lengths of both logs and the names of the bodies that stand there. */
export interface TurnStart { battleStart: number; shownStart: number; words: DieWords }

/** Read before the turn plays: the dice report counts the battle's log from here, and the names belong to the bodies at the turn's start. */
export const turnStart = (battle: Battle, shown: readonly string[]): TurnStart =>
  ({ battleStart: battle.log.length, shownStart: shown.length, words: wordsOf(battle) });

/**
 * The part of a history entry that holds the dice of the turn just played, the report and its display lines: empty for a turn
 * without a forced die, so the entry keeps today's shape. `waiting` is true while a forced replacement is pending; the turn is still complete when its actions
 * are over (the `|upkeep` line shows it): a body that fainted at the end of the turn asks for a replacement after the last
 * action drew its dice. A switch in the middle of the turn (a pivot move) leaves the rest of the actions to play.
 */
export function entryDice(
  report: DiceReport | undefined, start: TurnStart, battle: Battle, shown: readonly string[], waiting: boolean,
): { diceReport?: DiceReport; dieLines?: DieLine[] } {
  if (!report) return {};
  const complete = !waiting || shown.some((line, index) => index >= start.shownStart && line.startsWith('|upkeep'));
  const lines = dieLines(report, { battleLog: battle.log, battleStart: start.battleStart, shownLog: shown, shownStart: start.shownStart, complete }, start.words);
  return lines.length > 0 ? { diceReport: report, dieLines: lines } : { diceReport: report };
}
