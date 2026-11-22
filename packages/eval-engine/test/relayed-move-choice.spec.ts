import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { isRelayedMoveLine, moveLineSource } from '../src/branch/relayed-move';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, stableLog, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#135): a `|move|` line that another effect wrote for a body is not the body's click. The simulator writes it with
 * `|[from] <effect>` when a move runs with a source effect: Magic Bounce and Dancer (an Ability), Magic Coat and Snatch (the volatile
 * of a move that relays another body's move). The rebuild read the first move line of a slot as the click and sent a move the body lacks;
 * the simulator refused the choice and the side played `default`. A lock continuation (`lockedmove`) and a move that runs early under its
 * own click (Pursuit) also write a `[from]`, and their lines are the body's click.
 *
 * Rows: the rule on written lines (every shape of the effect, old formats included); the four mechanisms played on the simulator in
 * singles and doubles; then a sweep over the rule sets the corpus plays (Gens 1 to 9, Champions), singles and doubles. The sweep's oracle
 * is the simulator: the turn's public lines go through `getMainChoice`, and the choice it writes, played on a fresh copy of the board
 * with the foe's click, makes the same battle log. It plays every Dex ability as the holder against a move to reflect, a dance, a move to
 * snatch and a switch; every Dex move with a condition as the holder's click against the same probes; and every move that locks its user
 * into a second turn. The sweep also lists the effects the rule skipped and kept, and holds that list to the Dex.
 */
await loadSimMods('gen9championsou');

const DEX = rulesDex(9);

describe('the rule on written lines', () => {
  const line = (from: string, move = 'Taunt') => `|move|p2b: Hatterene|${move}|p1a: markiplier|${from}`;

  test('an Ability is another effect\'s line, with or without the prefix and the space', () => {
    for (const from of ['[from] ability: Magic Bounce', '[from]ability: Magic Bounce', '[from] Magic Bounce', '[from]Magic Bounce', '[from] ability: Dancer']) {
      expect(isRelayedMoveLine(line(from), DEX), from).toBe(true);
    }
    expect(isRelayedMoveLine(`${line('[from] ability: Magic Bounce')}|[still]`, DEX)).toBe(true);
  });

  test('the volatile of a move that relays another body\'s move is another effect\'s line', () => {
    for (const from of ['[from] Magic Coat', '[from]Snatch']) expect(isRelayedMoveLine(line(from), DEX), from).toBe(true);
  });

  test('a lock continuation, a move the body clicked, a bare move name and a line without a source are the body\'s own', () => {
    for (const from of ['[from] lockedmove', '[from]lockedmove', '[from] Pursuit', '[from] move: Pursuit', '[from] move: Round', '[from]move: Sleep Talk',
      '[from]Sleep Talk', '[from] move: Grass Pledge', '[from]Grass Pledge', '[from] item: Leppa Berry']) {
      expect(isRelayedMoveLine(line(from), DEX), from).toBe(false);
    }
    expect(isRelayedMoveLine('|move|p1a: Snorlax|Splash|p1a: Snorlax', DEX)).toBe(false);
    expect(moveLineSource('|move|p1a: Snorlax|Splash|p1a: Snorlax')).toBeUndefined();
    expect(moveLineSource(line('[from] ability: Dancer'))).toBe('ability: Dancer');
  });
});

/** The simulator's public lines: each private line is written twice (`|split|pN`, the owner's line, the spectator's line). */
const publicLines = (battle: Battle): string[] => {
  const out: string[] = [];
  for (let index = 0; index < battle.log.length; index++) {
    if (battle.log[index].startsWith('|split|')) index++; else out.push(battle.log[index]);
  }
  return out;
};

interface Clicks { p1: string; p2: string }
interface Scene { rules: Rules; mode: Mode; p1: PokemonSet[]; p2: PokemonSet[]; turns: Clicks[] }

const build = ({ rules, mode, p1, p2 }: Scene): Battle => battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, p2);

function play(battle: Battle, clicks: Clicks): void {
  if (!battle.choose('p1', clicks.p1) || !battle.choose('p2', clicks.p2)) throw new Error(`refused "${clicks.p1}" / "${clicks.p2}"`);
}

interface Played { events: string[]; choice: string; accepted: boolean; same: boolean; relayed: string[]; kept: string[] }

/**
 * Plays the scene, reads the last turn's public lines the way the rebuild does, and asks `getMainChoice` for side p2. The choice is played
 * on a fresh board (the same turns before it) with p1's click: it is accepted and makes the same battle log, line for line.
 */
function roundTrip(scene: Scene): Played | null {
  const dex = dexOfRules(scene.rules);
  const original = build(scene);
  // a click the simulator refuses on this board (a trapped switch, a move whose condition is not met) is no row
  if (!scene.turns.every(clicks => original.choose('p1', clicks.p1) && original.choose('p2', clicks.p2))) return null;
  const last = scene.turns.length;
  const events = parseTurnBlocks(publicLines(original).join('\n')).turns.find(turn => turn.turn === last)!.preUpkeep;
  const board = build(scene);
  scene.turns.slice(0, -1).forEach(clicks => play(board, clicks));
  const choice = getMainChoice(events, 'p2', board as never);
  const accepted = board.choose('p2', choice) && board.choose('p1', scene.turns[last - 1].p1);
  const sourced = events.filter(entry => entry.startsWith('|move|p2') && moveLineSource(entry));
  return {
    events, choice, accepted, same: accepted && stableLog(board) === stableLog(original),
    relayed: sourced.filter(entry => isRelayedMoveLine(entry, dex)).map(entry => moveLineSource(entry)!),
    kept: sourced.filter(entry => !isRelayedMoveLine(entry, dex)).map(entry => moveLineSource(entry)!),
  };
}

/** The holder: Snorlax is the slow body, so the probe user (Pikachu) acts first and the line it causes comes before the holder's own line. */
const holderOf = (rules: Rules, moves: string[], ability?: string): PokemonSet => ({
  ...mon(rules, { species: 'Snorlax', moves, gender: 'M' }), ...(ability && rules.generation >= 3 ? { ability } : {}),
});

/** The sides of a case: p1 leads with the probe user (Pikachu) and has a body to switch to; p2 leads with the holder (a splashing partner in doubles). */
function scene(rules: Rules, mode: Mode, probe: string[], holder: PokemonSet, turns: Clicks[]): Scene {
  const body = (species: string, moves: string[]) => mon(rules, { species, moves, gender: 'M' });
  const p1 = mode === 'singles'
    ? [body('Pikachu', probe), body('Blissey', ['splash'])]
    : [body('Pikachu', probe), body('Blissey', ['splash']), body('Chansey', ['splash'])];
  const p2 = mode === 'singles' ? [holder] : [holder, body('Vaporeon', ['splash'])];
  return { rules, mode, p1, p2, turns };
}

const AIMED = new Set(['normal', 'any', 'adjacentFoe']);
const clickOf = (mode: Mode, aimed: boolean): string => (mode === 'singles' ? 'move 1' : `move 1${aimed ? ' 1' : ''}, move 1`);
const holderClick = (mode: Mode, aimed = false): string => (mode === 'singles' ? 'move 1' : `move 1${aimed ? ' 1' : ''}, move 1`);
const switchClick = (mode: Mode): string => (mode === 'singles' ? 'switch 2' : 'switch 3, move 1');

describe('the four mechanisms on the simulator, singles and doubles', () => {
  const rules = RULES[8];
  const taunt = (mode: Mode): Clicks => ({ p1: clickOf(mode, true), p2: holderClick(mode) });

  for (const mode of ['singles', 'doubles'] as const) {
    test(`${mode}: Magic Bounce sends Taunt back; the holder's own click is its own move`, () => {
      const result = roundTrip(scene(rules, mode, ['taunt'], holderOf(rules, ['splash'], 'Magic Bounce'), [taunt(mode)]))!;
      expect(result.relayed).toEqual(['ability: Magic Bounce']);
      expect(result.events.some(entry => entry.includes('|Taunt|') && entry.includes('[from] ability: Magic Bounce'))).toBe(true);
      expect(result.choice.startsWith('move 1')).toBe(true);
      expect(result.same, result.choice).toBe(true);
    });

    test(`${mode}: Dancer copies Dragon Dance; the holder's own click is its own move`, () => {
      const result = roundTrip(scene(rules, mode, ['dragondance'], holderOf(rules, ['splash'], 'Dancer'), [{ p1: clickOf(mode, false), p2: holderClick(mode) }]))!;
      expect(result.relayed).toEqual(['ability: Dancer']);
      expect(result.same, result.choice).toBe(true);
    });

    // The body's own line (Magic Coat, Snatch) comes before the relayed line, so these two read right on the base too: guard rows.
    test(`${mode}: Magic Coat sends Taunt back`, () => {
      const result = roundTrip(scene(rules, mode, ['taunt'], holderOf(rules, ['magiccoat', 'splash']), [taunt(mode)]))!;
      expect(result.relayed).toEqual(['Magic Coat']);
      expect(result.same, result.choice).toBe(true);
    });

    test(`${mode}: Snatch takes Dragon Dance`, () => {
      const result = roundTrip(scene(rules, mode, ['dragondance'], holderOf(rules, ['snatch', 'splash']), [{ p1: clickOf(mode, false), p2: holderClick(mode) }]))!;
      expect(result.relayed).toEqual(['Snatch']);
      expect(result.same, result.choice).toBe(true);
    });
  }
});

/** The first `count` Dex moves of the rule set that the predicate keeps and that never miss (a miss ends the move before Magic Coat or Snatch). */
const firstOf = (rules: Rules, keep: (move: DexMove) => boolean, count = 1): DexMove[] => {
  const dex = dexOfRules(rules);
  return dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen && move.accuracy === true
    && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past') && keep(move)).slice(0, count);
};

/** What the Dex says about the volatile a move sets on its user: the move locks its user into its next turns (`onLockMove`). */
const locksUser = (rules: Rules, move: DexMove): boolean => {
  const dex = dexOfRules(rules);
  const volatile = move.volatileStatus ?? move.self?.volatileStatus;
  return !!move.flags.charge || (!!volatile && 'onLockMove' in dex.conditions.get(volatile));
};

/** Source text of every function in an entry: a handler that makes its holder or its user run another move names `useMove` or `runMove`. */
const handlerSource = (entry: object): string =>
  Object.values(entry).filter((value): value is () => unknown => typeof value === 'function').map(String).join('\n');
const dispatches = (entry: object | undefined): boolean => !!entry && /useMove\(|runMove\(|useMoveInner\(/.test(handlerSource(entry));

describe('the sweep: every Dex ability and move that can write a move line for a body', () => {
  for (const { rules, mode, name } of SWEEP_CASES) {
    test(name, () => {
      const dex = dexOfRules(rules);
      const clicks = (aimed: boolean): Clicks => ({ p1: clickOf(mode, aimed), p2: holderClick(mode) });
      const probes: { label: string; p1: string[]; click: Clicks }[] = [
        ...firstOf(rules, move => move.category === 'Status' && !!move.flags.reflectable && AIMED.has(move.target), 3)
          .map(move => ({ label: `reflect ${move.id}`, p1: [move.id], click: clicks(true) })),
        ...firstOf(rules, move => !!move.flags.dance && move.target === 'self' && !move.selfdestruct)
          .map(move => ({ label: `dance ${move.id}`, p1: [move.id], click: clicks(false) })),
        ...firstOf(rules, move => !!move.flags.snatch && move.target === 'self' && move.category === 'Status' && !!move.boosts, 2)
          .map(move => ({ label: `snatch ${move.id}`, p1: [move.id], click: clicks(false) })),
        { label: 'switch', p1: ['splash'], click: { p1: switchClick(mode), p2: holderClick(mode) } },
      ];
      const seen = { relayed: new Set<string>(), kept: new Set<string>() };
      const check = (label: string, holder: PokemonSet, probe: typeof probes[number]) => {
        const result = roundTrip(scene(rules, mode, probe.p1, holder, [probe.click]));
        if (!result) return;
        expect(result.same, `${name} ${label} vs ${probe.label}: "${result.choice}" for ${result.events.filter(entry => entry.startsWith('|move|p2')).join(' ; ')}`).toBe(true);
        result.relayed.forEach(source => seen.relayed.add(dex.abilities.get(source.replace(/^ability: /, '')).exists ? 'ability' : source));
        result.kept.forEach(source => seen.kept.add(source));
      };

      // every Dex ability, as the holder whose click is Splash (a sample of the list plus every ability whose handler dispatches a move)
      const abilities = rules.generation >= 3 ? dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen
        && (ability.isNonstandard === null || ability.isNonstandard === undefined || ability.isNonstandard === 'Past')) : [];
      const chosen = new Set(sweepSelection(abilities, 'moves').map(ability => ability.id));
      for (const ability of abilities) if (dispatches(ability)) chosen.add(ability.id);
      for (const id of ['magicbounce', 'dancer']) if (dex.abilities.get(id).exists) chosen.add(id);
      for (const ability of abilities.filter(entry => chosen.has(entry.id))) {
        for (const probe of probes) check(`ability ${ability.id}`, holderOf(rules, ['splash'], ability.name), probe);
      }

      // every Dex move with a condition, as the holder's click (a sample of the list plus every move whose condition dispatches a move)
      const withCondition = dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
        && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past') && !!move.condition);
      const picked = new Set(sweepSelection(withCondition, 'moves').map(move => move.id));
      for (const move of withCondition) if (dispatches(move.condition)) picked.add(move.id);
      for (const move of withCondition.filter(entry => picked.has(entry.id))) {
        for (const probe of probes) check(`move ${move.id}`, holderOf(rules, [move.id, 'splash']), { ...probe, click: { ...probe.click, p2: holderClick(mode, AIMED.has(move.target)) } });
      }

      // every move that locks its user in: the second turn's line is `[from] lockedmove` or a charge line, and it stays the body's click
      const locking = dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
        && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past') && locksUser(rules, move) && !move.flags.futuremove);
      const lockedIn = locking.filter(move => !move.flags.charge);
      for (const move of [...lockedIn, ...sweepSelection(locking.filter(move => !!move.flags.charge), 'moves')]) {
        const turn = { p1: clickOf(mode, false), p2: holderClick(mode, AIMED.has(move.target)) };
        const sceneOf = scene(rules, mode, ['splash'], holderOf(rules, [move.id, 'splash']), [turn, turn]);
        const result = roundTrip(sceneOf);
        if (!result) continue;
        expect(result.same, `${name} lock ${move.id}: "${result.choice}" for ${result.events.filter(entry => entry.startsWith('|move|p2')).join(' ; ')}`).toBe(true);
        result.kept.forEach(source => seen.kept.add(source));
        result.relayed.forEach(source => seen.relayed.add(source));
      }

      // the list of what the rule skipped holds the entries the Dex has: an ability, Magic Coat, Snatch; a lock continuation and Pursuit stay
      if (rules.generation >= 3) expect([...seen.kept].some(source => /Pursuit$/.test(source)), `${name}: Pursuit's own line was played and kept, seen ${[...seen.relayed]} / ${[...seen.kept]}`).toBe(true);
      if (rules.generation >= 5) expect(seen.relayed.has('ability'), `${name}: an Ability line was played`).toBe(true);
      if (rules.generation >= 3) {
        expect(seen.relayed.has('Magic Coat'), `${name}: Magic Coat was played, seen ${[...seen.relayed]} / ${[...seen.kept]}`).toBe(true);
        expect(seen.relayed.has('Snatch'), `${name}: Snatch was played, seen ${[...seen.relayed]} / ${[...seen.kept]}`).toBe(true);
      }
      expect([...seen.relayed].filter(source => source !== 'ability' && source !== 'Magic Coat' && source !== 'Snatch'), `${name}: nothing else is skipped`).toEqual([]);
      if (rules.generation >= 3) expect(seen.kept.has('lockedmove'), `${name}: a lock continuation was played and kept, seen ${[...seen.relayed]} / ${[...seen.kept]}`).toBe(lockedIn.length > 0);
    }, 300_000);
  }
});
