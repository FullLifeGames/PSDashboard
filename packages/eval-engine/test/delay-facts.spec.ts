import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { delayFacts, LAST_FIELDS, readsCountExactly, readsOfBoard, readsOfEntry, type DelayReads, type EntryKind } from '../src/endgame/delay-facts';
import { RULES } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { mon } from './dice-fixtures';

/**
 * Round 89 (P1): the readers of the delay facts. The facts (`endgame/delay-facts.ts`) drop the PP of every slot, a slot's `used` flag,
 * the last-move group, the entry counters' exact values and the switch-in order, because a held turn writes them and no later turn
 * reads them, unless an entry on the board reads them. This file holds that claim against the installed @pkmn/sim and @pkmn/mods:
 *  1. Which Dex entries read each dropped field, per rule set (Gens 1 to 9 and the Champions mod), pinned as lists: a new reader in an
 *     updated simulator fails here and has to be classified before the facts may drop its field.
 *  2. Every line of the played builds that reads a dropped field belongs to a detected entry, or is a core read pinned below with its reason.
 *  3. The reads that survive the clamp of the two counters.
 *  4. A fallen body's entries are no entry of the board (round 89, P2), unless a standing body may revive it.
 * The sweep rows over the rule sets are in `delay-facts-sweep.spec.ts`.
 */
await loadSimMods('gen9championsou');

const DEXES = RULES.map(rules => dexOfRules(rules));
const KINDS: EntryKind[] = ['move', 'ability', 'item', 'condition'];

/** Every entry id of every rule set that the reader of the module flags for `flag`. */
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

/**
 * The source scan. `FIELD_TOKENS` is this spec's own list of what to look for (independent of the module's patterns): a mention that is no
 * comment and no plain assignment. A line sits in the handler of a Dex entry when the entry it is inside is detected for that field;
 * every other line is core code of the simulator (the move runner, the Pokemon class, the Gen 1 to 3 scripts, the Champions mod's
 * Pokemon) and is pinned by file with its count.
 */
describe('the simulator reads a dropped field only where the facts keep it (source scan)', () => {
  const require = createRequire(import.meta.url);
  const roots = ['@pkmn/sim', '@pkmn/mods'].map(name => {
    const entry = require.resolve(name).split('\\').join('/');
    const root = entry.slice(0, entry.indexOf(`/${name}/`) + name.length + 2);
    return { name, root: name === '@pkmn/sim' ? `${root}build/cjs/` : `${root}build/` };
  });
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? files(`${dir}/${item.name}`) : item.name.endsWith('.js') ? [`${dir}/${item.name}`] : []);
  /** The builds the corpus plays: the base data, the mods of Gens 1 to 8, the simulator's core and the Champions mod (the Let's Go, Stadium and BDSP mods are not played). */
  const PLAYED = /^@pkmn\/sim:(data\/(?!mods\/)|data\/mods\/gen[1-8]\/|sim\/)|^@pkmn\/mods:champions\/index\.js$/;
  /** Text, the species data, the team tools and the stream's protocol input: no code of a played turn. */
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

  /** The core lines of one field, by file: the lines whose entry is not flagged (or no entry), with the reads the clamp keeps counted out. */
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

  /**
   * What the pinned core reads are (reviewed in P1 against the installed 0.10.15 builds):
   *  - pp: `Pokemon.deductPP`, the Gen 1 and Gen 3 PP scripts and the move runner's `deductPP` call; the reads of "no PP left" (`pp <= 0`
   *    disables a move, Struggle follows) in `getMoves`, the Z-move request, the stalemate test of Gen 1 and `calculatePP`. The margin
   *    (`stallMargin`) keeps the own clicks above zero, and a foe slot that reaches zero only takes an option from the foe. The Champions
   *    lines are the mod's own PP table at load.
   *  - used: `Pokemon.deductPP` and `clearVolatile`/switch-in writing the flag (Last Resort is the one reader, flagged above).
   *  - last: the writers of the group (`moveUsed`, `gotAttacked`, `clearVolatile`, the damage bookkeeping of `spreadDamage`/`damage`), the
   *    move runner's `cantusetwice` test and `endTurn`'s disable of it (entries with that flag are treated as readers), `getLockedMove`'s
   *    target location (entries with `onLockMove` are treated as readers), `getLastAttackedBy`/`getLastDamagedBy` themselves (their
   *    callers are flagged by name), Gen 1's `useMove` (Mirror Move is flagged), `EmergencyExit`'s `hurtThisTurn` (reset every turn),
   *    and the Gen 4 switch-in that copies the last move to the new body (the same group).
   *  - speedOrder: written in `runSwitch` right before the SwitchIn event, the one event that reads it (row below).
   *  - activeTurns, activeMoveActions: the resets and increments only (every read is flagged safe by the clamp or an entry).
   *  - calls: the move runner, the queue and the Gen 1 and 2 scripts: the machinery that entries with `useMove` and `insertChoice` reach.
   */
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

  test.each(['pp', 'last', 'activeTurns', 'activeMoveActions'])('%s: no format rule reads it (the rule sets are no entry of the board)', name => {
    const rules = roots.flatMap(({ name: pkg, root }) => files(root.replace(/\/$/, '')).filter(path => /rulesets\.js$/.test(path) && PLAYED.test(`${pkg}:${path.slice(root.length)}`))
      .flatMap(path => readFileSync(path, 'utf8').split('\n')));
    expect(rules.filter(line => FIELD_TOKENS[name].token.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line))).toEqual([]);
  });
});

describe('an entry on the board keeps the field it reads', () => {
  /** One board per rule set, a body of each side, and the entry put on the first body in the place its kind lives in. */
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
  // Champions VGC 2682637901 turn 6 (P2): the foe's fallen Whimsicott carries Encore, a reader of PP and of the last move; counted as an entry
  // on the board it kept the PP of every standing body a fact, and no held Protect was ever a delay there
  describe.each(RULES.filter(rules => rules.generation >= 2))('$name', rules => {
    const dex = dexOfRules(rules);
    const playable = (move: ReturnType<typeof dex.moves.get>): boolean => move.exists && move.gen <= dex.gen && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past');
    const reader = dex.moves.all().filter(playable).sort((a, b) => (a.id < b.id ? -1 : 1)).find(move => readsOfEntry(dex, 'move', move.id).pp);
    const reviver = dex.moves.all().filter(playable).sort((a, b) => (a.id < b.id ? -1 : 1)).find(move => !!(move as { slotCondition?: string }).slotCondition);

    /** A fallen second body of side p2 that knows `reader`, and a first body of side p1 that knows `tackle` and, with `revives`, a move that sets a slot condition. */
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
