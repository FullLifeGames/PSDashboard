import { SCREENS, isScreen } from '../src/dex-facts/screens';
import { toId } from '../src/ids';
import { spectatorLog } from './screen-scenes';
import { battleIn, mon, type SimView } from './sim-views';

/**
 * Round 86 (T310), sweep S3: the moves of a rule set that end a screen outside the residual phase (removers) or change which
 * side holds a screen without a log line (silent movers), found by playing the move, never by its name. A board with Reflect
 * on p1's side and Light Screen on p2's (set by `addSideCondition`) plays one turn of the move by p1: a `-sideend` of a screen
 * before the residual marker is a removal, a screen that changed sides with no `-sidestart` or `-sideend` line is a silent
 * move. The plain run plays the moves whose Dex entry mentions a side condition (the handlers' source) and every tenth move;
 * `DICE_SWEEPS=full` plays them all.
 */
const FULL = process.env.DICE_SWEEPS === 'full';

/** The moves the scenes of the issue name: the sweep must find each of them in the rule sets that have them. */
const NAMED = ['brickbreak', 'psychicfangs', 'defog', 'ragingbull', 'courtchange'];

type DexMove = ReturnType<SimView['dex']['moves']['get']>;
export interface Found { id: string; kind: 'removal' | 'silent move' }
export interface Swept {
  played: number;
  /** The named moves the rule set has (the sweep must find them). */
  named: string[];
  moves: Found[];
  /** The log of a game where p1 plays the move on turn 5 (null: no move, the control). */
  log: (move: string | null) => string;
}

/** The target suffixes a click may need: none, a foe slot, the ally. */
const AIMS = ['', ' 1', ' 2', ' -2'];

const textOf = (move: DexMove): string => {
  try { return JSON.stringify(move, (_key, value) => (typeof value === 'function' ? String(value) : value)); } catch { return ''; }
};

function candidates(view: SimView): DexMove[] {
  const dex = view.dex;
  const all = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && !move.isZ && !move.isMax
    && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past'));
  if (FULL) return all;
  return all.filter((move, index) => index % 10 === 0 || /ideCondition/.test(textOf(move)));
}

const presence = (battle: ReturnType<typeof battleIn>): string => JSON.stringify(battle.sides.map(side => SCREENS.filter(id => side.sideConditions[id])));

/**
 * The screen lines of the lines one choice added, split by phase. The first bare `|` is the header of the turn (the simulator
 * writes it when the turn starts), the second opens the residual phase.
 */
function turnScreenLines(lines: string[]): { action: string[]; residual: string[] } {
  const screen = (line: string) => /^\|-side(?:start|end)\|/.test(line) && isScreen(toId(line.split('|')[3].replace(/^move: /, '')));
  const action: string[] = [];
  const residual: string[] = [];
  let bars = 0;
  for (const line of lines) {
    if (line === '|') bars++;
    else if (screen(line)) (bars <= 1 ? action : residual).push(line);
  }
  return { action, residual };
}

function classify(view: SimView, move: DexMove): Found['kind'] | null {
  const doubles = view.doubles;
  const battle = battleIn(view, [mon('Snorlax', [move.id]), ...(doubles ? [mon('Blissey', ['splash'])] : [])], [mon('Vaporeon', ['splash']), ...(doubles ? [mon('Vaporeon', ['splash'])] : [])]);
  const [mine, theirs] = battle.sides;
  mine.addSideCondition('reflect', mine.active[0]);
  theirs.addSideCondition('lightscreen', theirs.active[0]);
  const before = presence(battle);
  const from = battle.log.length;
  const aims = doubles ? AIMS : [''];
  if (!aims.some(aim => battle.choose('p1', `move ${move.id}${aim}${doubles ? ', move splash' : ''}`))) return null;
  battle.choose('p2', doubles ? 'move splash, move splash' : 'move splash');
  const { action, residual } = turnScreenLines(battle.log.slice(from));
  if (action.some(line => line.startsWith('|-sideend|'))) return 'removal';
  if (presence(battle) !== before && action.length + residual.length === 0) return 'silent move';
  return null;
}

/** Plays six turns: both screens go up on turn 1, p1 plays the move on turn 5 (the last plain turn), everything else splashes. */
function playSweepScene(view: SimView, moveId: string | null): string {
  const doubles = view.doubles;
  const battle = battleIn(view,
    [mon('Snorlax', ['reflect', 'splash', ...(moveId ? [moveId] : [])]), ...(doubles ? [mon('Blissey', ['splash'])] : [])],
    [mon('Vaporeon', ['lightscreen', 'splash']), ...(doubles ? [mon('Vaporeon', ['splash'])] : [])]);
  const pair = (first: string, second = 'splash') => (doubles ? `move ${first}, move ${second}` : `move ${first}`);
  for (let turn = 1; turn <= 6; turn++) {
    if (turn === 5 && moveId) {
      const aims = doubles ? AIMS : [''];
      if (!aims.some(aim => battle.choose('p1', `move ${moveId}${aim}${doubles ? ', move splash' : ''}`))) throw new Error(`${moveId} cannot be clicked on turn 5`);
    } else battle.choose('p1', pair(turn === 1 ? 'reflect' : 'splash'));
    battle.choose('p2', pair(turn === 1 ? 'lightscreen' : 'splash'));
  }
  return spectatorLog(battle);
}

const cache = new Map<string, Swept>();

export function swept(view: SimView): Swept {
  const cached = cache.get(view.name);
  if (cached) return cached;
  const list = candidates(view);
  const moves = list.flatMap(move => { const kind = classify(view, move); return kind ? [{ id: move.id, kind }] : []; });
  const named = NAMED.filter(id => list.some(move => move.id === id));
  const result: Swept = { played: list.length, named, moves, log: move => playSweepScene(view, move) };
  cache.set(view.name, result);
  return result;
}
