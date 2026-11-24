import type { Battle, PokemonSet } from '@pkmn/sim';
import { spectatorLog, plainStyle, type Holder, type Side, type Style } from './screen-scenes';
import { battleIn, mon, type SimView } from './sim-views';

export interface FieldSceneOptions {
  p1: Holder;
  p2?: Holder;
  moves1?: Record<number, string>;
  moves2?: Record<number, string>;
  turns: number;
  slot?: 0 | 1;
  style?: Style;
  bench?: Holder[];
}

const AIMS = ['', ' 1', ' 2', ' -2'];
const FOE: Holder = { species: 'Vaporeon' };

const setOf = (holder: Holder, moves: string[]): PokemonSet =>
  mon(holder.species, [...new Set(['splash', ...moves])], { item: holder.item ?? '', ability: holder.ability ?? 'No Ability' });

function click(battle: Battle, view: SimView, side: Side, move: string, slot: number, aimed: string): boolean {
  if (!view.doubles) return battle.choose(side, `move ${move}`);
  return [aimed, ...AIMS].some(aim => battle.choose(side, [0, 1].map(index => (index === slot ? `move ${move}${aim}` : 'move splash')).join(', ')));
}

export function playField(view: SimView, options: FieldSceneOptions): string | null {
  const { p1, p2 = FOE, moves1 = {}, moves2 = {}, turns, slot = 0, style = 'timed', bench = [] } = options;
  const one: PokemonSet[] = [setOf(p1, Object.values(moves1))];
  const two: PokemonSet[] = [setOf(p2, Object.values(moves2))];
  if (view.doubles) {
    one.splice(1 - slot, 0, mon('Blissey', ['splash']));
    two.push(mon('Blissey', ['splash']));
  }
  one.push(...bench.map(entry => setOf(entry, ['splash'])));
  const battle = battleIn(view, one, two);
  for (let turn = 1; turn <= turns; turn++) {
    if (!click(battle, view, 'p1', moves1[turn] ?? 'splash', slot, ' 1') || !click(battle, view, 'p2', moves2[turn] ?? 'splash', 0, ` ${slot + 1}`)) return null;
  }
  const log = spectatorLog(battle);
  return style === 'plain' ? plainStyle(log) : log;
}

export interface FieldLine {
  kind: 'weather' | 'terrain';
  op: 'start' | 'end';
  id: string;
  /** The side of the `[of]` body of an ability's start; '' for a move's start and for every end. */
  side: Side | '';
  turn: number;
  phase: 'action' | 'residual';
}

const idOf = (text: string): string => text.replace(/^move: /, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function fieldLines(log: string, isTerrain: (id: string) => boolean): FieldLine[] {
  const found: FieldLine[] = [];
  let turn = 0;
  let bars = 0;
  for (const line of log.split('\n')) {
    if (line.startsWith('|turn|')) { turn = Number(line.split('|')[2]); bars = 0; continue; }
    if (line === '|') { bars++; continue; }
    const parts = line.split('|');
    const phase = bars >= 2 ? 'residual' : 'action';
    const side = (/\[of\] (p[12])/.exec(line)?.[1] ?? '') as Side | '';
    if (parts[1] === '-weather' && !line.includes('[upkeep]')) {
      const none = parts[2] === 'none';
      found.push({ kind: 'weather', op: none ? 'end' : 'start', id: none ? '' : idOf(parts[2]), side: none ? '' : side, turn, phase });
    } else if (parts[1] === '-fieldstart' || parts[1] === '-fieldend') {
      const id = idOf(parts[2]);
      if (isTerrain(id)) found.push({ kind: 'terrain', op: parts[1] === '-fieldstart' ? 'start' : 'end', id, side: parts[1] === '-fieldstart' ? side : '', turn, phase });
    }
  }
  return found;
}

/** `moveSide` stands in for `setter` where a move's start carries no side. */
export function cleanEnd(lines: FieldLine[], kind: FieldLine['kind'], setter: Side, moveSide: Side): { start: number; end: number } | null {
  const own = lines.filter(line => line.kind === kind);
  const start = own.findIndex(line => line.op === 'start' && (line.side || moveSide) === setter);
  if (start < 0) return null;
  const next = own[start + 1];
  if (!next || next.op !== 'end' || next.phase !== 'residual') return null;
  return { start: own[start].turn, end: next.turn };
}
