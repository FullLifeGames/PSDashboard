import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { delayFacts, LAST_FIELDS, readsCountExactly, readsOfBoard, readsOfEntry, type DelayReads, type EntryKind } from '../src/endgame/delay-facts';
import { RULES } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { mon } from './dice-fixtures';

await loadSimMods('gen9championsou');

const DEXES = RULES.map(rules => dexOfRules(rules));
const KINDS: EntryKind[] = ['move', 'ability', 'item', 'condition'];

function detected(flag: keyof DelayReads): string[] {
  const found = new Set<string>();
  for (const dex of DEXES) {
    const lists: Record<EntryKind, { id: string }[]> = {
      move: dex.moves.all(), ability: dex.abilities.all(), item: dex.items.all(), condition: Object.keys(dex.data.Conditions).map(id => ({ id })),
    };
    for (const kind of KINDS) for (const { id } of lists[kind]) if (readsOfEntry(dex, kind, id)[flag]) found.add(id);
  }
  return [...found].sort();
}

const words = (text: string): string[] => text.split(/\s+/);

describe('the Dex entries that read a dropped field (pinned per field over every rule set)', () => {
  const PINNED: Record<keyof DelayReads, string[]> = {
    pp: words('disable eeriespell encore gmaxdepletion grudge instruct leppaberry lunardance mimic mysteryberry pursuit sketch sleeptalk snatch spite trumpcard zacian zamazenta'),
    used: ['lastresort'],
    last: words('angershell assurance avalanche berserk bide bloodmoon choicelock comeuppance conversion2 copycat counter disable eeriespell encore frz gigatonhammer gmaxdepletion grudge healblock healingwish iceball instruct lockedmove lunardance metalburst metronome mimic mirrormove mirrorcoat mysteryberry partialtrappinglock ragefist revenge rollout sketch slp spite stompingtantrum substitute temperflare torment truant twoturnmove uproar'),
    calls: words('afteryou assist copycat custapberry firepledge grasspledge instruct magicbounce magiccoat mefirst metronome mirrormove naturepower pursuit quickclaw rebound round shelltrap sleeptalk snatch waterpledge'),
    turns: [],
    actions: ['skydrop'],
  };
  test.each(Object.keys(PINNED) as (keyof DelayReads)[])('%s', flag => expect(detected(flag)).toEqual([...PINNED[flag]].sort()));
});

describe('the counter reads that survive the clamp to 0 or 1', () => {
  test.each([
    'if (pokemon.activeTurns) {',
    'if (!defender.activeTurns) {',
    'if (pokemon.activeTurns && (pokemon.moveThisTurnResult !== undefined)) {',
    'if (source.activeMoveActions > 1) {',
    'if (pokemon.activeMoveActions) {',
  ])('%s is read by truth or by "more than 1"', text => {
    expect(readsCountExactly(text, text.includes('activeMoveActions') ? 'activeMoveActions' : 'activeTurns')).toBe(false);
  });
  test.each([
    ['attacker.activeMoveActions--;', 'activeMoveActions'],
    ['--attacker.activeMoveActions;', 'activeMoveActions'],
    ['if (pokemon.activeTurns === 1) {', 'activeTurns'],
    ['if (pokemon.activeTurns >= 2) {', 'activeTurns'],
    ['if (pokemon.activeTurns < 2) {', 'activeTurns'],
    ['pokemon.activeTurns = 0;', 'activeTurns'],
    ['return pokemon.activeTurns + 1;', 'activeTurns'],
  ] as const)('%s keeps the exact count', (text, field) => expect(readsCountExactly(text, field)).toBe(true));
});

describe('the simulator reads a dropped field only where the facts keep it (source scan)', () => {
  const require = createRequire(import.meta.url);
  const roots = ['@pkmn/sim', '@pkmn/mods'].map(name => {
    const entry = require.resolve(name).split('\\').join('/');
    const root = entry.slice(0, entry.indexOf(`/${name}/`) + name.length + 2);
    return { name, root: name === '@pkmn/sim' ? `${root}build/cjs/` : `${root}build/` };
  });
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? files(`${dir}/${item.name}`) : item.name.endsWith('.js') ? [`${dir}/${item.name}`] : []);
  const PLAYED = /^@pkmn\/sim:(data\/(?!mods\/)|data\/mods\/gen[1-8]\/|sim\/)|^@pkmn\/mods:champions\/index\.js$/;
  const NOT_TURN_CODE = /text|formats-data|pokedex|learnsets|aliases|tags|rulesets|natures|typechart|random|teams|tools|battle-stream|dex-|team-validator/;
  const sources = roots.flatMap(({ name, root }) => files(root.replace(/\/$/, '')).map(path => ({ file: `${name}:${path.slice(root.length)}`, lines: readFileSync(path, 'utf8').split('\n') })))
    .filter(source => PLAYED.test(source.file) && !NOT_TURN_CODE.test(source.file));

  const FIELD_TOKENS: Record<string, { token: RegExp; flag: keyof DelayReads | null; field?: 'activeTurns' | 'activeMoveActions' }> = {
    pp: { token: /\.pp\b|\bmaxpp\b|\b(?:deduct|restore|gain|set)PP\b/, flag: 'pp' },
    used: { token: /\.used\b/, flag: 'used' },
    last: { token: /\b(?:lastMove|lastMoveUsed|lastMoveEncore|lastMoveTargetLoc|moveLastTurnResult|moveThisTurnResult|attackedBy|lastDamage|hurtThisTurn|timesAttacked|getLastAttackedBy|getLastDamagedBy)\b/, flag: 'last' },
    speedOrder: { token: /\bspeedOrder\b/, flag: null },
    activeTurns: { token: /\bactiveTurns\b/, flag: 'turns', field: 'activeTurns' },
    activeMoveActions: { token: /\bactiveMoveActions\b/, flag: 'actions', field: 'activeMoveActions' },
    calls: { token: /\b(?:useMove|runMove|insertChoice|prioritizeAction)\b/, flag: 'calls' },
  };
  const ENTRY = /^( {2}| {4})"?([a-z0-9]+)"?: \{\s*$/;

  function remaining(name: string): Record<string, number> {
    const { token, flag, field } = FIELD_TOKENS[name];
    const flagged = flag ? new Set(detected(flag)) : new Set<string>();
    const count: Record<string, number> = {};
    for (const { file, lines } of sources) {
      const indent = file.startsWith('@pkmn/mods') ? 2 : 4;
      lines.forEach((line, index) => {
        const text = line.trim();
        if (!token.test(text) || /^(\/\/|\/\*|\*)/.test(text)) return;
        let id = '?';
        for (let up = index; up >= 0; up--) { const entry = ENTRY.exec(lines[up]); if (entry && entry[1].length === indent) { id = entry[2]; break; } }
        if (flagged.has(id) || (field && !readsCountExactly(text, field))) return;
        const key = file.replace(/^@pkmn\/(sim|mods):/, '').replace('data/', 'd/');
        count[key] = (count[key] ?? 0) + 1;
      });
    }
    return count;
  }

  // The simulator's own core reads of each dropped field, counted per file by hand: a changed count needs a new review.
  const PINNED_CORE: Record<string, Record<string, number>> = {
    pp: { 'champions/index.js': 3, 'd/mods/gen1/scripts.js': 9, 'd/mods/gen2/scripts.js': 1, 'd/mods/gen3/scripts.js': 2, 'sim/battle-actions.js': 5, 'sim/battle.js': 4, 'sim/pokemon.js': 13 },
    used: { 'd/mods/gen1/scripts.js': 1, 'sim/battle-actions.js': 1, 'sim/pokemon.js': 1 },
    last: { 'champions/index.js': 14, 'd/mods/gen1/scripts.js': 4, 'd/mods/gen2/scripts.js': 2, 'd/mods/gen3/scripts.js': 5, 'sim/battle-actions.js': 18, 'sim/battle.js': 17, 'sim/pokemon.js': 29, 'sim/side.js': 3 },
    speedOrder: { 'sim/battle-actions.js': 1, 'sim/battle.js': 3 },
    activeTurns: { 'sim/battle-actions.js': 1, 'sim/battle.js': 1, 'sim/pokemon.js': 1 },
    activeMoveActions: { 'sim/battle-actions.js': 2, 'sim/pokemon.js': 1 },
    calls: { 'd/mods/gen1/scripts.js': 3, 'd/mods/gen2/scripts.js': 2, 'sim/battle-actions.js': 5, 'sim/battle-queue.js': 4, 'sim/battle.js': 3 },
  };

  test.each(Object.keys(PINNED_CORE))('%s: every other read is a pinned core read', name => expect(remaining(name)).toEqual(PINNED_CORE[name]));

  test('the last-move group of the facts is the list the scan looks for', () => {
    expect([...LAST_FIELDS].sort()).toEqual(['attackedBy', 'hurtThisTurn', 'lastDamage', 'lastMove', 'lastMoveEncore', 'lastMoveTargetLoc', 'lastMoveUsed', 'moveLastTurnResult', 'moveThisTurnResult', 'timesAttacked']);
  });

  test('the switch-in order is written right before the one event that reads it', () => {
    const actions = sources.find(source => source.file === '@pkmn/sim:sim/battle-actions.js')!.lines.join('\n');
    expect(actions).toMatch(/speedOrder = [^;]+;\s*this\.battle\.fieldEvent\('SwitchIn'/);
    const battle = sources.find(source => source.file === '@pkmn/sim:sim/battle.js')!.lines.join('\n');
    expect(battle).toMatch(/callbackName\.endsWith\('SwitchIn'\)\) \{[^}]*speedOrder\.indexOf/);
  });

  test('the debug flag is read only at construction (EV balance check, forced chance), by `debug()` (a log line) and by the state copy', () => {
    const reads = sources.filter(source => source.file.startsWith('@pkmn/sim:sim/')).flatMap(source => source.lines.map(line => line.trim()).filter(line => /\bdebugMode\b/.test(line)).map(line => `${source.file.slice(10)}: ${line}`));
    expect(reads).toEqual([
      'sim/battle.js: this.debugMode = format.debug || !!options.debug;',
      "sim/battle.js: this.forceRandomChance = (this.debugMode && typeof options.forceRandomChance === 'boolean') ?",
      'sim/battle.js: if (this.debugMode) {',
      'sim/battle.js: if (this.debugMode) {',
      'sim/state.js: debug: state.debugMode,',
    ]);
  });

  test('the data and the mods read the turn count in three places: the future attack (rebased), Wish (resolves in the turn after) and Gen 3 Truant (a boolean)', () => {
    const reads = sources.filter(source => !source.file.startsWith('@pkmn/sim:sim/')).flatMap(source => source.lines.map(line => line.trim())
      .filter(line => /\bthis\.turn\b|\bgetOverflowedTurnCount\b|\b(?:ending|starting)Turn\b/.test(line) && !/^(\/\/|\/\*|\*)/.test(line)).map(line => `${source.file}: ${line}`));
    expect(reads).toEqual([
      '@pkmn/sim:data/conditions.js: this.effectState.endingTurn = (this.turn - 1) + 2;',
      '@pkmn/sim:data/conditions.js: if (this.gen >= 8 && this.effectState.endingTurn >= 256) {',
      '@pkmn/sim:data/conditions.js: if (this.gen >= 8 && this.effectState.endingTurn >= 256) {',
      '@pkmn/sim:data/conditions.js: if (this.getOverflowedTurnCount() < this.effectState.endingTurn)',
      '@pkmn/sim:data/mods/gen3/abilities.js: pokemon.truantTurn = this.turn !== 0;',
      '@pkmn/sim:data/moves.js: this.effectState.startingTurn = this.getOverflowedTurnCount();',
      '@pkmn/sim:data/moves.js: if (this.gen >= 8 && this.effectState.startingTurn === 255) {',
      '@pkmn/sim:data/moves.js: this.hint(`In Gen 8+, Wish will never resolve when used on the ${this.turn}th turn.`);',
      '@pkmn/sim:data/moves.js: if (this.gen >= 8 && this.effectState.startingTurn === 255) {',
      '@pkmn/sim:data/moves.js: if (this.getOverflowedTurnCount() <= this.effectState.startingTurn)',
    ]);
  });

  test.each(['pp', 'last', 'activeTurns', 'activeMoveActions'])('%s: no format rule reads it (the rule sets are no entry of the board)', name => {
    const rules = roots.flatMap(({ name: pkg, root }) => files(root.replace(/\/$/, '')).filter(path => /rulesets\.js$/.test(path) && PLAYED.test(`${pkg}:${path.slice(root.length)}`))
      .flatMap(path => readFileSync(path, 'utf8').split('\n')));
    expect(rules.filter(line => FIELD_TOKENS[name].token.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line))).toEqual([]);
  });
});

describe('an entry on the board keeps the field it reads', () => {
  function boardWith(rules: (typeof RULES)[number], kind: EntryKind, id: string): ReturnType<typeof battleOf> {
    const board = battleOf(rules.singles, [mon(rules, { species: 'Snorlax', moves: ['tackle', 'splash'] })], [mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
    const body = board.sides[0].active[0];
    if (kind === 'move') for (const slots of [body.moveSlots, body.baseMoveSlots]) slots.push({ ...slots[0], id } as never);
    if (kind === 'ability') body.ability = id as never;
    if (kind === 'item') body.item = id as never;
    if (kind === 'condition') body.volatiles[id] = { id } as never;
    board.turn = 5;
    body.activeMoveActions = 1;
    return board;
  }
  const CHANGES: Record<string, (board: ReturnType<typeof battleOf>) => void> = {
    pp: board => { board.sides[0].active[0].moveSlots[0].pp -= 1; },
    used: board => { board.sides[0].active[0].moveSlots[0].used = !board.sides[0].active[0].moveSlots[0].used; },
    last: board => { board.sides[0].active[0].lastDamage += 7; },
    actions: board => { board.sides[0].active[0].activeMoveActions += 3; },
  };

  describe.each(RULES)('$name', rules => {
    const dex = dexOfRules(rules);
    const entries: [EntryKind, string, DelayReads][] = KINDS.flatMap(kind => {
      const list: { id: string }[] = kind === 'move' ? dex.moves.all() : kind === 'ability' ? dex.abilities.all() : kind === 'item' ? dex.items.all() : Object.keys(dex.data.Conditions).map(id => ({ id }));
      return list.map((entry): [EntryKind, string, DelayReads] => [kind, entry.id, readsOfEntry(dex, kind, entry.id)]);
    }).filter(([, , reads]) => Object.values(reads).some(Boolean));

    test('a plain board drops them all (no entry reads: PP, used, the last-move group and the counters change nothing)', () => {
      for (const change of Object.values(CHANGES)) {
        const a = boardWith(rules, 'move', 'tackle');
        const b = boardWith(rules, 'move', 'tackle');
        change(b);
        expect(delayFacts(b, 'p2')).toBe(delayFacts(a, 'p2'));
      }
    });

    test(`every reader on the board moves the facts with its field (${entries.length} entries)`, () => {
      const missed: string[] = [];
      for (const [kind, id, reads] of entries) {
        for (const [field, change] of Object.entries(CHANGES)) {
          if (!(reads.calls || reads[field as keyof DelayReads])) continue;
          const a = boardWith(rules, kind, id);
          const b = boardWith(rules, kind, id);
          change(b);
          if (delayFacts(b, 'p2') === delayFacts(a, 'p2')) missed.push(`${kind} ${id} ${field}`);
        }
      }
      expect(missed).toEqual([]);
    });
  });
});

describe('a body that has fainted keeps no entry on the board unless a revive is possible', () => {
  describe.each(RULES.filter(rules => rules.generation >= 2))('$name', rules => {
    const dex = dexOfRules(rules);
    const playable = (move: ReturnType<typeof dex.moves.get>): boolean => move.exists && move.gen <= dex.gen && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past');
    const reader = dex.moves.all().filter(playable).sort((a, b) => (a.id < b.id ? -1 : 1)).find(move => readsOfEntry(dex, 'move', move.id).pp);
    const reviver = dex.moves.all().filter(playable).sort((a, b) => (a.id < b.id ? -1 : 1)).find(move => !!(move as { slotCondition?: string }).slotCondition);

    function board(revives: boolean): ReturnType<typeof battleOf> {
      const moves = revives && reviver ? ['tackle', reviver.id] : ['tackle', 'splash'];
      const battle = battleOf(rules.singles, [mon(rules, { species: 'Snorlax', moves })], [mon(rules, { species: 'Vaporeon', moves: ['splash'] }), mon(rules, { species: 'Blissey', moves: [reader!.id] })]);
      const fallen = battle.sides[1].pokemon[1];
      fallen.hp = 0;
      fallen.fainted = true;
      battle.turn = 5;
      return battle;
    }

    test('the rule set has a move that reads PP', () => expect(reader).toBeDefined());

    test('a fallen body\'s PP reader is no entry: the PP of the standing bodies stays out of the facts', () => {
      const a = board(false);
      const b = board(false);
      b.sides[0].active[0].moveSlots[0].pp -= 1;
      expect(readsOfBoard(a).pp).toBe(false);
      expect(delayFacts(b, 'p2')).toBe(delayFacts(a, 'p2'));
    });

    test.skipIf(!reviver)('a standing body with a move that sets a slot condition may revive it: the reader counts and the PP is a fact', () => {
      const a = board(true);
      const b = board(true);
      b.sides[0].active[0].moveSlots[0].pp -= 1;
      expect(readsOfBoard(a).pp).toBe(true);
      expect(delayFacts(b, 'p2')).not.toBe(delayFacts(a, 'p2'));
    });
  });
});

describe('the facts are a string, so they do not depend on the order of the state\'s keys', () => {
  // `EVAL_SIM_FAST=0` copies a battle through the simulator's own state, which lists volatile keys in another order.
  test.each(RULES.filter(rules => rules.generation >= 4))('$name: the same volatiles listed in the other order give equal facts', rules => {
    const board = (): ReturnType<typeof battleOf> => {
      const battle = battleOf(rules.singles, [mon(rules, { species: 'Snorlax', moves: ['tackle'] })], [mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
      battle.turn = 5;
      for (const id of ['focusenergy', 'torment']) battle.sides[0].active[0].addVolatile(id);
      return battle;
    };
    const a = board();
    const b = board();
    const body = b.sides[0].active[0];
    body.volatiles = Object.fromEntries(Object.entries(body.volatiles).reverse());
    expect(Object.keys(body.volatiles)).not.toEqual(Object.keys(a.sides[0].active[0].volatiles));
    expect(delayFacts(b, 'p2')).toBe(delayFacts(a, 'p2'));
  });
});
