import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { forkBattle } from '../src/forward/position';
import { applyChoice } from '../src/forward/switches';
import { serializeBattleStable } from '../src/forward/serialize';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/search';
import type { EvalResult, EvalSettings, RankedChoice } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

// Each cause that opens a switch request is found in the Dex by handler key, never by name.

await loadSimMods('gen9customgame');
await loadSimMods('gen9championsou');

const SEED = '1,2,3,4';
const SIDES = ['p1', 'p2'] as const;
const RULES = [
  { name: 'Generation 6', gen: 6, format: 'gen6' },
  { name: 'Generation 8', gen: 8, format: 'gen8' },
  { name: 'Generation 9', gen: 9, format: 'gen9' },
  { name: 'Champions', gen: 0, format: 'gen9champions' },
];
const GAME_TYPES = [{ type: 'singles', doubles: false }, { type: 'doubles', doubles: true }];

type Kind = 'pivot' | 'hazard' | 'held' | 'knock-out';
interface Entry { kind: Kind; name: string; id: string; item?: string; ability?: string }
type Dex = ReturnType<typeof rulesDex>;

const played = (isNonstandard: string | null | undefined): boolean => !isNonstandard || isNonstandard === 'Past';
const opensRequest = (data: object): boolean =>
  Object.entries(data).some(([key, value]) => /^on/.test(key) && typeof value === 'function' && String(value).includes('witchFlag'));

const KNOCK_OUTS: Entry[] = ['one body', 'every body of the foe', 'poison on every body'].map(name => ({ kind: 'knock-out', name, id: name }));

function entriesOf(dex: Dex): Entry[] {
  const moves = dex.moves.all().filter(move => played(move.isNonstandard));
  const pivots = moves.filter(move => move.selfSwitch || move.forceSwitch || move.slotCondition || opensRequest(move))
    .map((move): Entry => ({ kind: 'pivot', name: move.name, id: move.id }));
  const hazards = moves.filter(move => move.sideCondition && ['onSwitchIn', 'onEntryHazard'].some(key => key in dex.conditions.get(move.sideCondition!)))
    .map((move): Entry => ({ kind: 'hazard', name: move.name, id: move.sideCondition! }));
  const items = dex.items.all().filter(item => played(item.isNonstandard) && opensRequest(item))
    .map((item): Entry => ({ kind: 'held', name: item.name, id: item.id, item: item.name }));
  const abilities = dex.abilities.all().filter(ability => played(ability.isNonstandard) && opensRequest(ability))
    .map((ability): Entry => ({ kind: 'held', name: ability.name, id: ability.id, ability: ability.name }));
  return [...pivots, ...hazards, ...items, ...abilities, ...KNOCK_OUTS];
}

const body = (moves: string[], extra: Partial<PokemonSet> = {}, fast = false): PokemonSet => set('Snorlax', moves, {
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: fast ? 252 : 0 }, ...extra,
});

interface Scene { battle: Battle; tries: [string, string][] }

// p1 is faster and plays the entry's move; p2 plays Tackle; the replacement comes from the move, the hazard or the item
function sceneOf(format: string, entry: Entry, doubles: boolean, lethal: boolean): Scene {
  const filler = body(['Tackle', 'Splash']);
  const leadMoves = entry.kind === 'pivot' ? [entry.id, 'Splash'] : ['Tackle', 'Splash'];
  const p1 = [body(leadMoves, {}, true), ...(doubles ? [filler] : []), filler, filler];
  const heldOnLead = (base: PokemonSet): PokemonSet => ({ ...base, ...(entry.item ? { item: entry.item } : {}), ...(entry.ability ? { ability: entry.ability } : {}) });
  const p2 = [heldOnLead(body(['Tackle', 'Splash'])), ...(doubles ? [filler] : []), filler, filler];
  if (entry.kind === 'held') p1[0] = heldOnLead(p1[0]);
  const battle = battleOf(format, p1, p2);
  expect(battle.gameType).toBe(doubles ? 'doubles' : 'singles');
  const [first, second] = battle.sides;
  if (entry.kind === 'hazard') {
    second.addSideCondition(entry.id, first.active[0]);
    for (const mate of second.pokemon.filter(pokemon => !pokemon.isActive)) mate.hp = 1;
  }
  if (lethal) for (const target of [first.active[0], second.active[0]]) target.hp = entry.kind === 'held' ? Math.floor(target.maxhp * 0.4) : 1;
  if (entry.kind === 'hazard') second.active[0].hp = 1;
  if (entry.kind === 'knock-out') return knockOut(battle, entry.name, doubles);
  const targets = ['', ' 1', ' 2', ' -1', ' -2'];
  const tries: [string, string][] = doubles
    ? targets.map(target => [`move 1${target}, move 2`, 'move 1 1, move 2'])
    : [['move 1', 'move 1']];
  return { battle, tries };
}

function knockOut(battle: Battle, name: string, doubles: boolean): Scene {
  const [first, second] = battle.sides;
  const slots = doubles && name !== 'one body' ? [0, 1] : [0];
  if (name === 'poison on every body') {
    for (const active of [...first.active, ...second.active]) {
      active.hp = 1;
      active.setStatus('psn');
    }
    return { battle, tries: [[doubles ? 'move 2, move 2' : 'move 2', doubles ? 'move 2, move 2' : 'move 2']] };
  }
  for (const slot of slots) second.active[slot].hp = 1;
  const attacks = slots.map(slot => `move 1 ${slot + 1}`);
  return { battle, tries: [[doubles ? (slots.length === 2 ? attacks.join(', ') : 'move 1 1, move 2') : 'move 1', doubles ? 'move 2, move 2' : 'move 2']] };
}

const picksOf = (battle: Battle, tries: [string, string][]): { p1: string; p2: string } | null => {
  const position = createRootPosition(serializeBattleStable(battle));
  for (const [p1, p2] of tries) {
    try {
      applyChoice(forkBattle(position, SEED), 'p1', p1);
      applyChoice(forkBattle(position, SEED), 'p2', p2);
      return { p1, p2 };
    } catch { /* the next target */ }
  }
  return null;
};

const asks = (battle: Battle, side: 'p1' | 'p2'): boolean => {
  const request = battle.sides[side === 'p1' ? 0 : 1].activeRequest as { forceSwitch?: boolean[]; wait?: boolean } | null;
  return !!request?.forceSwitch?.some(Boolean);
};

const namesIn = (label: string): string[] => label.split(' + ').filter(part => part.startsWith('→ ')).map(part => part.slice(2));

function judge(scene: Scene): { problems: string[]; pending: boolean } | null {
  const choices = picksOf(scene.battle, scene.tries);
  if (!choices) return null;
  const root = createRootPosition(serializeBattleStable(scene.battle));
  const stop = advancePositionWithLog(root, choices.p1, choices.p2, SEED, { stopAtForcedSwitch: true });
  const full = advancePositionWithLog(root, choices.p1, choices.p2, SEED);
  const picks = full.child.staticPicks ?? [];
  const problems: string[] = [];
  const asked = SIDES.filter(side => asks(positionBattle(stop.child), side));
  if (stop.pendingSwitch !== (picks.length > 0)) problems.push(`pending ${stop.pendingSwitch}, picks ${JSON.stringify(picks)}`);
  if (picks.length === 0) return { problems, pending: false };
  if (JSON.stringify(Object.keys(picks[0]).sort()) !== JSON.stringify([...asked].sort())) problems.push(`asked ${asked}, picked ${Object.keys(picks[0])}`);
  for (const side of asked) {
    const label = picks[0][side];
    if (!legalChoices(stop.child, side).some(option => option.label === label)) problems.push(`${side} "${label}" is no option of the request`);
    if (picks.length === 1 && label) {
      const state = positionBattle(full.child).sides[side === 'p1' ? 0 : 1];
      const inFront = state.active.flatMap(active => (active ? [active.species.name, active.baseSpecies.name] : []));
      for (const name of namesIn(label)) if (!inFront.includes(name)) problems.push(`${side} "${label}" but ${inFront} stand there`);
    }
  }
  return { problems, pending: true };
}

describe.each(RULES)('$name: the static pick names every replacement the simulator asks for', rules => {
  const entries = entriesOf(rulesDex(rules.gen));

  describe.each(GAME_TYPES)('$type', ({ doubles }) => {
    const format = `${rules.format}${doubles ? 'doubles' : ''}customgame`;

    test('every body of the foe knocked out: a doubles side names both bodies at once, a singles side one', () => {
      const scene = sceneOf(format, KNOCK_OUTS[1], doubles, false);
      const choices = picksOf(scene.battle, scene.tries)!;
      const { child } = advancePositionWithLog(createRootPosition(serializeBattleStable(scene.battle)), choices.p1, choices.p2, SEED);
      expect(child.staticPicks).toHaveLength(1);
      expect(child.staticPicks![0].p1).toBeUndefined();
      expect(child.staticPicks![0].p2).toMatch(doubles ? /^→ Snorlax \+ → Snorlax$/ : /^→ Snorlax$/);
    });

    test.each(['pivot', 'hazard', 'held', 'knock-out'] as const)('every %s entry', kind => {
      const wrong: string[] = [];
      let scenes = 0;
      let pending = 0;
      for (const entry of entries.filter(candidate => candidate.kind === kind)) {
        for (const lethal of kind === 'knock-out' ? [false] : [false, true]) {
          const verdict = judge(sceneOf(format, entry, doubles, lethal));
          if (!verdict) continue;
          scenes += 1;
          if (verdict.pending) pending += 1;
          for (const problem of verdict.problems) wrong.push(`${entry.name}${lethal ? ' (low)' : ''}: ${problem}`);
        }
      }
      expect(wrong).toEqual([]);
      expect(scenes).toBeGreaterThan(0);
      expect(pending).toBeGreaterThan(0);
    });
  });
});

interface Fixture { settings: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; turn2: string }
const gholdengo = JSON.parse(readFileSync(new URL('./fixtures/sb-gholdengo.json', import.meta.url), 'utf-8')) as Fixture;

describe('a matrix line names the replacement its cell made', () => {
  const settings: EvalSettings = {
    depth: 2, samples: 3, mode: 'matrix', tera: gholdengo.settings.tera, sleepClause: gholdengo.settings.sleepClause, ruleset: gholdengo.settings.ruleset, prove: false,
  };
  const rowOf = (result: EvalResult, label: string): RankedChoice => result.perSide.p2.find(row => row.label === label)!;
  const expected = [{ p1: '(waiting)', p2: '→ Dragonite', replacement: 'p2' }, { p1: 'Power Gem', p2: 'Dragon Dance' }];

  test('singles: the row "→ Iron Valiant" of the shared Gholdengo game reads the sync and the orchestrated search alike', async () => {
    const sync = searchPosition(gholdengo.turn2, settings);
    const orchestrated = await searchOrchestrated(createLocalExecutor(gholdengo.turn2, gholdengo.settings.ruleset), settings);
    expect(rowOf(sync, '→ Iron Valiant').line).toEqual(expected);
    expect(rowOf(orchestrated, '→ Iron Valiant').line).toEqual(expected);
  }, 120_000);

  const residual = (format: string, doubles: boolean): string => {
    const lead = body(['Splash'], { level: 50 });
    const bench = body(['Splash'], { level: 50 });
    const team = [lead, ...(doubles ? [lead] : []), bench, bench];
    const battle = battleOf(format, team, team);
    for (const side of battle.sides) {
      for (const active of side.active) {
        active.hp = 1;
        active.setStatus('psn');
      }
    }
    return serializeBattleStable(battle);
  };
  const BOARDS = [
    { name: 'Scarlet/Violet singles', format: 'gen9customgame', doubles: false },
    { name: 'Scarlet/Violet VGC doubles', format: 'gen9doublescustomgame', doubles: true },
    { name: 'Champions VGC doubles', format: 'gen9championsdoublescustomgame', doubles: true },
  ];

  test.each(BOARDS)('$name: both sides lose their active to the poison and the line names both replacements', ({ format, doubles }) => {
    const result = searchPosition(residual(format, doubles), { depth: 2, samples: 1, mode: 'matrix', tera: false, prove: false });
    const lines = SIDES.flatMap(side => result.perSide[side].flatMap(row => (row.line ? [row.line] : [])));
    expect(lines.length).toBeGreaterThan(0);
    const both = lines.filter(line => line[0].replacement === 'both');
    expect(both.length).toBeGreaterThan(0);
    for (const line of both) {
      expect(line[0].p1).toMatch(/^→ /);
      expect(line[0].p2).toMatch(/^→ /);
    }
  });
});
