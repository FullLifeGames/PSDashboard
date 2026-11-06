import { extractChannelMessages, type Battle, type PokemonSet } from '@pkmn/sim';
import { isScreen, SCREENS } from '../src/dex-facts/screens';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import type { OpponentTeamInfo } from '../src/types';
import { DOUBLES_VIEWS, SINGLES_VIEWS, battleIn, mon, type SimView } from './sim-views';
import { Dex } from '@pkmn/sim';

/**
 * Round 86 (T310, Light Clay from the screen turns): the scenes of `screen-evidence.spec.ts`. Every log comes from the
 * simulator (the spectator's view, as a replay holds it), so the simulator says how long a screen lasted and what the log
 * shows; the specs read the inference from the same log. Side p1 (Alpha) sets the screen, side p2 (Beta) faces it.
 */

/** `timed`: the log as the simulator and a server write it (a `|t:|` line after each header); `plain`: the same with those lines taken out (a reconstructed or older log). */
export type Style = 'timed' | 'plain';
export type Side = 'p1' | 'p2';

/** The screen's setter on side p1: its species, item and ability (the sets of the log's other bodies are fixed). */
export interface Holder { species: string; item?: string; ability?: string }

export interface SceneOptions {
  holder: Holder;
  /** The screen's move id. */
  screen: string;
  /** How many turns the log plays. */
  turns: number;
  /** The setter's slot in doubles (the ally takes the other). */
  slot?: 0 | 1;
  style?: Style;
  /** A move of the setter by turn (the setter uses the screen move on turn 1 and splashes otherwise). */
  setter?: Record<number, string>;
  /** The foe's species, item and ability (Beta's first body). */
  foe?: Holder;
  /** A move of the foe by turn (it splashes otherwise); the foe's first body knows every move it names. */
  foeMoves?: Record<number, string>;
  /** Bodies behind the setter that can be Illusion users (team of the setter's side). */
  bench?: Holder[];
}

const FOE_DEFAULT: Holder = { species: 'Abomasnow', ability: 'Snow Warning' };

/** A move that needs a target in doubles reads it from the Dex. */
const needsTarget = (view: SimView, id: string): boolean => ['normal', 'any', 'adjacentFoe'].includes(view.dex.moves.get(id).target);

const setOf = (holder: Holder, moves: string[]): PokemonSet =>
  mon(holder.species, moves, { item: holder.item ?? '', ability: holder.ability ?? 'No Ability' });

/** The spectator's view of the simulator's log: what a replay shows. */
export const spectatorLog = (battle: Battle): string => extractChannelMessages(battle.log.join('\n'), [0])[0].join('\n');

/** The log without its `|t:|` lines. */
export const plainStyle = (log: string): string => log.split('\n').filter(line => !line.startsWith('|t:|')).join('\n');

/** Plays the scene and returns the log of the setter's side p1 and the foe's side p2. */
export function playScene(view: SimView, options: SceneOptions): string {
  const { holder, screen, turns, slot = 0, style = 'timed', setter = {}, foeMoves = {}, bench = [] } = options;
  const foe = options.foe ?? FOE_DEFAULT;
  const knows = [screen, 'splash', ...Object.values(setter)];
  const foeKnows = ['splash', ...Object.values(foeMoves)];
  const p1: PokemonSet[] = [setOf(holder, knows)];
  const p2: PokemonSet[] = [setOf(foe, foeKnows)];
  if (view.doubles) {
    p1.splice(1 - slot, 0, mon('Blissey', ['splash']));
    p2.push(mon('Vaporeon', ['splash']));
  }
  p1.push(...bench.map(entry => setOf(entry, ['splash'])));
  const battle = battleIn(view, p1, p2);
  for (let turn = 1; turn <= turns; turn++) {
    const mine = setter[turn] ?? (turn === 1 ? screen : 'splash');
    const theirs = foeMoves[turn] ?? 'splash';
    const aim = view.doubles && needsTarget(view, theirs) ? ` ${slot + 1}` : '';
    battle.choose('p1', view.doubles ? [0, 1].map(index => `move ${index === slot ? mine : 'splash'}`).join(', ') : `move ${mine}`);
    battle.choose('p2', view.doubles ? `move ${theirs}${aim}, move splash` : `move ${theirs}`);
  }
  const log = spectatorLog(battle);
  return style === 'plain' ? plainStyle(log) : log;
}

/** The inferred info of one body of a side, read from the log by the inference. */
export function infoOf(log: string, side: Side, species: string): OpponentTeamInfo['pokemon'][number] {
  const info = inferOpponentTeam(log, side).pokemon.find(entry => entry.species === species);
  if (!info) throw new Error(`the inference found no ${species} on ${side}`);
  return info;
}

/** Light Clay's rule-out: the inference wrote the item into the body's ruled-out items. */
export const ruledOut = (log: string, side: Side, species: string, item = 'lightclay'): boolean =>
  (infoOf(log, side, species).ruledOut?.items ?? []).includes(item);

/** The item the log proves: the revealed field's value ('' while none; team preview's "(has item)" flag names no item). */
export function proven(log: string, side: Side, species: string): string {
  const field = infoOf(log, side, species).item;
  return field.source === 'revealed' && field.value !== '(has item)' ? field.value : '';
}

/** The screens' ends and starts in the log's lines, with the phase of the turn each stands in. */
export interface ScreenLine { kind: 'start' | 'end'; side: Side; screen: string; turn: number; phase: 'action' | 'residual' }

/** Reads the screen lines of a log: the turn comes from `|turn|N`; the first bare `|` after it is the header, the second opens the residual phase. */
export function screenLines(log: string): ScreenLine[] {
  const found: ScreenLine[] = [];
  let turn = 0;
  let bars = 0;
  for (const line of log.split('\n')) {
    if (line.startsWith('|turn|')) { turn = Number(line.split('|')[2]); bars = 0; continue; }
    if (line === '|') { bars++; continue; }
    const match = /^\|-side(start|end)\|(p[12]): [^|]*\|(?:move: )?([^|]+)/.exec(line);
    if (!match || !isScreen(match[3].toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    found.push({ kind: match[1] as 'start' | 'end', side: match[2] as Side, screen: match[3].toLowerCase().replace(/[^a-z0-9]/g, ''), turn, phase: bars >= 2 ? 'residual' : 'action' });
  }
  return found;
}

/**
 * Whether a side's screen ran out on its own side in the residual phase with no removal or move on the way: the one case a
 * verdict may rest on. A start without such an end (a removal, a Court Change, a log that stops first) gives none.
 */
export function endsCleanly(log: string, side: Side, screen: string): boolean {
  const lines = screenLines(log).filter(line => line.screen === screen);
  const started = lines.find(line => line.kind === 'start' && line.side === side);
  const ends = lines.filter(line => line.kind === 'end');
  return !!started && ends.some(line => line.side === side && line.phase === 'residual') && !ends.some(line => line.phase === 'action');
}

/** The screens a log of the simulator can show: the Dex lists a move that sets each, in the generation. */
export function screenMoves(view: SimView): string[] {
  const dex = view.dex;
  return SCREENS.filter(id => {
    const move = dex.moves.get(id);
    return move.exists && move.gen <= dex.gen && !!move.sideCondition;
  });
}

/** Singles in Generations 1 to 9 and the Champions mod, doubles in Generations 3 to 9 and the Champions mod: the rule sets the corpus plays. */
export const RULE_VIEWS: SimView[] = [
  ...SINGLES_VIEWS,
  ...[3, 4, 5, 6, 7, 8].map(gen => ({ name: `Gen ${gen} doubles`, format: `gen${gen}doublescustomgame`, doubles: true, dex: Dex.forGen(gen) })),
  ...DOUBLES_VIEWS,
];
