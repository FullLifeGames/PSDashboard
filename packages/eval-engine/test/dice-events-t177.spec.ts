import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { detectRolls, diceEventTurns } from '../src/dice-events';
import { rolledSides, type LuckSplit } from '../src/turn-analysis/luck';
import { luckSentence } from '../src/win-reason';
import { buildGameReport } from '../src/report';
import { winDeltaText } from '../src/winprob';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import type { KoOddsInfo, RankedChoice } from '../src/types';

/**
 * Round 69 (T177, decision 21): the dice markers of a turn count a roll only where the move rolled. The oracle is the
 * simulator (real logs of real battles) and its Dex: a sure crit (`willCrit`), a status from a move whose accuracy and
 * status chance are 100 (Thunder Wave in Gen 6) and a hazard status on a switch-in are no roll; Hypnosis, Scald's burn
 * and an ability status still are. The replay's generation reaches detectRolls and diceEventTurns as an optional
 * parameter; without it the markers read as they did in round 67.
 */

type Kind = 'singles' | 'doubles';
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, moves: string[], ability = 'Pressure'): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Hardy', evs: {}, ivs: ALL_31, level: 100, gender: '',
} as PokemonSet);

/** The whole protocol of a battle after the given turn choices, without the split lines. */
function playedLog(format: string, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], seed: number): string[] {
  const battle = new Battle({
    formatid: toID(format), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  for (const [first, second] of turns) {
    battle.choose('p1', first);
    battle.choose('p2', second);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|'));
}

/** The lines of one turn: after its `|turn|n` marker up to the next one. */
function turnLines(lines: string[], turn: number): string[] {
  const from = lines.findIndex(line => line === `|turn|${turn}`);
  const to = lines.findIndex(line => line === `|turn|${turn + 1}`);
  return lines.slice(from + 1, to === -1 ? undefined : to);
}

const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };
const blissey = (move = 'Splash') => set('Blissey', [move], 'Natural Cure');

/** One attacking move on Blissey, in singles (Garchomp alone) or doubles (Garchomp beside a Protecting Blissey). */
function attackLog(kind: Kind, move: string, seed: number, format = FORMAT[kind]): string[] {
  const id = toID(move);
  return kind === 'singles'
    ? playedLog(format, [set('Garchomp', [move])], [blissey()], [[`move ${id}`, 'move splash']], seed)
    : playedLog(format, [set('Garchomp', [move]), blissey('Protect')], [blissey(), blissey()],
      [[`move ${id} 1, move protect`, 'move splash, move splash']], seed);
}

/** Dice the premise must not carry besides its own (a full paralysis after the status would be a roll of its own). */
const OTHER_DICE = /^\|(cant|-miss)\|/;

/** The first seed whose battle prints a line the premise needs (a crit, a status) and no other dice; null when none does. */
function logWith(make: (seed: number) => string[], marker: RegExp, seeds = 400, reject = OTHER_DICE): string[] | null {
  for (let seed = 1; seed <= seeds; seed++) {
    const lines = make(seed);
    if (lines.some(line => marker.test(line)) && !lines.some(line => reject.test(line))) return lines;
  }
  return null;
}

const rolled = (lines: string[], generation?: number) => {
  const { favored } = detectRolls(lines, null, generation);
  return favored.p1 || favored.p2;
};

/** The simulator's own Dex says whether the move cannot miss and cannot fail to inflict its status. */
const sureStatus = (generation: number, move: string): boolean => {
  const data = Dex.forGen(generation).moves.get(move);
  return (data.accuracy === true || data.accuracy >= 100) && !(data.secondaries ?? []).some(s => (s.chance ?? 100) < 100);
};

describe.each<Kind>(['singles', 'doubles'])('T177 sure crit, %s', kind => {
  const sureMoves = Dex.moves.all().filter(move => move.willCrit && !move.isNonstandard && move.basePower > 0 && move.target === 'normal');

  test('every move the Dex marks as always crit prints |-crit| and is no roll with the generation', () => {
    expect(sureMoves.map(move => move.id)).toEqual(expect.arrayContaining(['wickedblow', 'surgingstrikes', 'flowertrick', 'frostbreath']));
    for (const move of sureMoves) {
      const lines = logWith(seed => attackLog(kind, move.name, seed), /^\|-crit\|/, 60);
      expect(lines, move.name).not.toBeNull();
      expect(rolled(lines!, 9), move.name).toBe(false);
      expect(diceEventTurns([[], lines!], 9).has(1), move.name).toBe(false);
      // Without the generation the marker reads as before.
      expect(rolled(lines!), move.name).toBe(true);
    }
  });

  test('a normal crit (Scald) is still a roll, and favors the attacker', () => {
    const lines = logWith(seed => attackLog(kind, 'Scald', seed), /^\|-crit\|/, 600);
    expect(lines).not.toBeNull();
    expect(detectRolls(lines!, null, 9).favored).toEqual({ p1: true, p2: false });
    expect(diceEventTurns([[], lines!], 9).has(1)).toBe(true);
  });
});

describe.each<Kind>(['singles', 'doubles'])('T177 status, %s', kind => {
  /** A status move on Blissey (singles: the lone Garchomp; doubles: Garchomp beside a Protecting Blissey). */
  const statusLog = (format: string, move: string, seed: number): string[] => {
    const id = toID(move);
    return kind === 'singles'
      ? playedLog(format, [set('Garchomp', [move])], [blissey()], [[`move ${id}`, 'move splash']], seed)
      : playedLog(format, [set('Garchomp', [move]), blissey('Protect')], [blissey(), blissey()],
        [[`move ${id} 1, move protect`, 'move splash, move splash']], seed);
  };
  const gen = (format: string) => Number(/^gen(\d)/.exec(format)![1]);
  const forms = kind === 'singles' ? ['gen6ou', 'gen9ou'] : ['gen6doublesou', 'gen9doublesou'];

  test('Thunder Wave rolls exactly where the Dex gives it an accuracy under 100 (Gen 6: sure; Gen 9: 90)', () => {
    for (const format of forms) {
      const lines = logWith(seed => statusLog(format, 'Thunder Wave', seed), /^\|-status\|p2a: Blissey\|par/, 80);
      expect(lines, format).not.toBeNull();
      expect(rolled(lines!, gen(format)), format).toBe(!sureStatus(gen(format), 'thunderwave'));
      expect(diceEventTurns([[], lines!], gen(format)).has(1), format).toBe(!sureStatus(gen(format), 'thunderwave'));
    }
    // The two generations differ, so both answers are exercised.
    expect(sureStatus(6, 'thunderwave')).not.toBe(sureStatus(9, 'thunderwave'));
  });

  test('Hypnosis (accuracy under 100) and Scald\'s burn (30%) still roll; the status lands on the target, so the user is favored', () => {
    // The sleeper's own |cant| is a marker of its own, so the status line is read alone.
    const sleep = logWith(seed => statusLog(FORMAT[kind], 'Hypnosis', seed), /^\|-status\|p2a: Blissey\|slp/, 200, /^\|-miss\|/);
    expect(sleep).not.toBeNull();
    expect(detectRolls(sleep!.filter(line => !line.startsWith('|cant|')), null, 9).favored).toEqual({ p1: true, p2: false });
    const burn = logWith(seed => statusLog(FORMAT[kind], 'Scald', seed), /^\|-status\|p2a: Blissey\|brn/, 400);
    expect(burn).not.toBeNull();
    expect(detectRolls(burn!, null, 9).favored).toEqual({ p1: true, p2: false });
  });

  test('Toxic Spikes poisoning a switch-in is a hazard, no roll with the generation', () => {
    const turns: [string, string][] = kind === 'singles'
      ? [['move toxicspikes', 'move splash'], ['move toxicspikes', 'switch 2']]
      : [['move toxicspikes, move protect', 'move splash, move splash'], ['move toxicspikes, move protect', 'switch 3, move splash']];
    const p2 = kind === 'singles' ? [blissey(), set('Garchomp', ['Splash'])] : [blissey(), blissey(), set('Garchomp', ['Splash'])];
    const p1 = kind === 'singles' ? [set('Garchomp', ['Toxic Spikes'])] : [set('Garchomp', ['Toxic Spikes']), blissey('Protect')];
    const lines = turnLines(playedLog(FORMAT[kind], p1, p2, turns, 1), 2);
    expect(lines.some(line => /^\|-status\|p2a: Garchomp\|psn/.test(line))).toBe(true);
    expect(rolled(lines, 9)).toBe(false);
    expect(diceEventTurns([[], lines], 9).has(1)).toBe(false);
    expect(rolled(lines)).toBe(true);
  });

  test('ability statuses roll, Rest and a Flame Orb do not (literal lines of the protocol)', () => {
    expect(detectRolls(['|-status|p1a: Keldeo|brn|[from] ability: Flame Body|[of] p2a: Rotom'], null, 9).favored).toEqual({ p1: false, p2: true });
    expect(rolled(['|-status|p1a: Keldeo|slp|[from] move: Rest'], 9)).toBe(false);
    expect(rolled(['|-status|p2a: Medicham|tox|[from] item: Toxic Orb'], 9)).toBe(false);
  });
});

describe('T177 the whole ledger, the variance sentence quotes the rolled part', () => {
  const sideOf = (): SideAnalysis => ({ playedRaw: null, played: null, best: null, safe: null, regret: 0 });
  const mk = (turn: number, scoreBefore: number, scoreAfter: number, over: Partial<TurnAnalysis>): TurnAnalysis => ({
    turn, scoreBefore, scoreAfter, swing: scoreAfter - scoreBefore, playedOutcome: null, decisionDelta: null, chanceDelta: null,
    attribution: 'quiet', p1: sideOf(), p2: sideOf(), ...over,
  });
  const names: [string, string] = ['Alpha', 'Beta'];

  test('562428 shape: the rolls carry the ledger, the sentence names the rolled part, not the total', () => {
    const report = buildGameReport([
      mk(1, 0.1, -0.25, { attribution: 'chance', chanceDelta: -0.35, rolledFor: { p1: false, p2: true } }),
      mk(2, -0.25, -0.45, { chanceDelta: -0.15, rolledFor: { p1: false, p2: false } }),
      mk(3, -0.45, -0.75, { rolledFor: { p1: false, p2: false } }),
    ], names, 'p2');
    expect(report.chanceSplit?.rolled).toBeCloseTo(-0.35);
    expect(report.summary).toContain(`The rolls decided it: luck ran Beta's way (${winDeltaText(0.35)} from the rolls).`);
    expect(report.summary).not.toContain(winDeltaText(0.5));
  });

  test('the luck line of a ledger the rolls carry quotes the rolled part too (singles and doubles alike: it reads the ledger)', () => {
    const split: LuckSplit = { rolled: -0.3, reRead: -0.08 };
    const sentence = luckSentence(-0.38, null, names, split);
    expect(sentence).toBe(`Luck ran against Alpha (${winDeltaText(-0.3)} from the rolls).`);
    expect(sentence).not.toContain(winDeltaText(-0.38));
    // Without the split the sentence keeps the whole ledger.
    expect(luckSentence(-0.38, null, names)).toBe(`Luck ran against Alpha overall (${winDeltaText(-0.38)}).`);
  });
});

describe.each<Kind>(['singles', 'doubles'])('T177 survival, %s', kind => {
  const ranked = (choice: string, label: string, koOdds: KoOddsInfo): RankedChoice =>
    ({ choice, label, worstCase: 0, expected: 0, ev: 0, punishedBy: null, koOdds });
  const played = (odds: KoOddsInfo): SideAnalysis => {
    const choice = ranked(kind === 'singles' ? 'move hydropump' : 'move hydropump 1, move protect', 'Hydro Pump', odds);
    return { playedRaw: null, played: choice, best: choice, safe: choice, regret: 0 };
  };
  const quiet: SideAnalysis = { playedRaw: null, played: null, best: null, safe: null, regret: 0 };
  const label = kind === 'doubles' ? { label: 'Hydro Pump→Medicham' } : {};
  const hit = (ko: boolean) => ({
    hits: [{ side: 'p1' as const, move: 'hydropump', target: 'Medicham', ko, slot: 'p1a' }],
    favored: { p1: false, p2: false },
  });
  const actives = { p1: 'Keldeo', p2: 'Medicham', gen: 9 };

  test('a hit priced as sure lethal that the body survives (Focus Sash, Sturdy, a bulkier set) is a roll for the body\'s side', () => {
    for (const accuracy of [1, 0.8]) {
      const odds = { accuracy, killFraction: 1, ...label };
      expect(rolledSides(hit(false), played(odds), quiet, actives), `accuracy ${accuracy}`).toEqual({ p1: false, p2: true });
    }
  });

  test('the same hit that knocks out is no roll when it cannot miss', () => {
    const odds = { accuracy: 1, killFraction: 1, ...label };
    expect(rolledSides(hit(true), played(odds), quiet, actives)).toEqual({ p1: false, p2: false });
  });
});

describe.each<Kind>(['singles', 'doubles'])('T177 attacker slot, %s', kind => {
  test('a hit carries the slot and the species of the mon that used the move', () => {
    const lines = kind === 'singles'
      ? playedLog('gen9ou', [set('Garchomp', ['Dragon Claw'])], [blissey()], [['move dragonclaw', 'move splash']], 3)
      : playedLog('gen9doublesou', [blissey('Protect'), set('Garchomp', ['Dragon Claw'])], [blissey(), blissey()],
        [['move protect, move dragonclaw 1', 'move splash, move splash']], 3);
    const { hits } = detectRolls(lines, null, 9);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      side: 'p1', move: 'dragonclaw', target: 'Blissey', slot: kind === 'singles' ? 'p1a' : 'p1b', attacker: 'Garchomp',
    });
  });

  test('two attackers of one side keep their own slot (a spread move hits twice from different slots)', () => {
    if (kind === 'singles') return;
    const lines = playedLog('gen9doublesou', [set('Garchomp', ['Dragon Claw']), set('Dragonite', ['Dragon Claw'])], [blissey(), blissey()],
      [['move dragonclaw 1, move dragonclaw 1', 'move splash, move splash']], 3);
    const hits = detectRolls(lines, null, 9).hits;
    expect(hits.map(entry => [entry.slot, entry.attacker])).toEqual([['p1a', 'Garchomp'], ['p1b', 'Dragonite']]);
  });
});

/**
 * Round 69 (T177 review, item 7): a move whose secondary names only its chance picks the status in a handler (Tri Attack,
 * Dire Claw; the Dex of Generation 9 holds `{ chance: 20 }`), so it is a dice source like a secondary with a status. The
 * oracle is the Dex entry of each move: its accuracy and its secondaries.
 */
describe('T177 a status a handler picks is a roll', () => {
  const gen9 = Dex.forGen(9);
  const secondariesOf = (id: string) => {
    const move = gen9.moves.get(id);
    return move.secondaries ?? (move.secondary ? [move.secondary] : []);
  };
  /** One action with its status line, in the slot letters of each game type. */
  const statusTurn = (move: string, kind: Kind): string[][] => [[], kind === 'singles'
    ? [`|move|p1a: Garchomp|${move}|p2a: Blissey`, '|-status|p2a: Blissey|brn']
    : [`|move|p1a: Garchomp|${move}|p2b: Blissey`, '|-status|p2b: Blissey|brn']];
  const rolls = (move: string, kind: Kind, generation: number | undefined) => diceEventTurns(statusTurn(move, kind), generation).has(1);

  test.each(['singles', 'doubles'] as const)('%s: Tri Attack and Dire Claw (a chance without a status field) roll, with and without a generation', kind => {
    for (const id of ['triattack', 'direclaw']) {
      const move = gen9.moves.get(id);
      expect(typeof move.accuracy === 'number' ? move.accuracy : 100).toBeGreaterThanOrEqual(100);
      expect(secondariesOf(id).some(effect => effect.status !== undefined)).toBe(false);
      expect(secondariesOf(id).some(effect => (effect.chance ?? 100) < 100)).toBe(true);
      expect(rolls(move.name, kind, 9)).toBe(true);
      expect(rolls(move.name, kind, undefined)).toBe(true);
    }
  });

  test.each(['singles', 'doubles'] as const)('%s: a fixed secondary status still rolls, a sure effect of a sure move does not', kind => {
    const scald = gen9.moves.get('scald');
    expect(secondariesOf('scald').some(effect => effect.status !== undefined && (effect.chance ?? 100) < 100)).toBe(true);
    expect(rolls(scald.name, kind, 9)).toBe(true);
    // The Dex holds a damaging move that always lands a status: accuracy sure and the secondary at 100 %.
    const sure = gen9.moves.all().find(move => (move.accuracy === true || move.accuracy >= 100)
      && secondariesOf(move.id).length > 0 && secondariesOf(move.id).every(effect => effect.status !== undefined && effect.chance === 100));
    expect(sure).toBeDefined();
    expect(rolls(sure!.name, kind, 9)).toBe(false);
  });
});
