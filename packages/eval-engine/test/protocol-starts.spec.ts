import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Dex, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { correctActivesFromProtocol } from '../src/branch/corrections';
import { playProtocolStarts } from '../src/branch/entry-effects';
import { parseTurnBlocks } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 73 (T212): a `|-start|` line the block shows and the rebuilt board lacks is played through the simulator's own
 * addVolatile on the body, without a list of effects. The scene: smogtours-gen9ou-752733 turn 14, where the game's
 * Garganacl survives Moonblast at 5 % and starts Salt Cure on Iron Valiant; a simulator that K.O.s the Garganacl first
 * (as in the bank's rounds before the dice alignment found a seed for it) leaves the board without Salt Cure for turns 15
 * to 17, and Iron Valiant takes none of its residual damage.
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
type Teams = ReturnType<typeof buildTeamsFromReplay>;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

/** `teams`: the build the bank made for the replay (the Smogon fills of .smogon-cache, saved as a fixture), else the naked build. */
async function boundaries<T>(replay: Replay, turns: number[], read: (battle: Battle) => T, teams?: Teams) {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = teams ?? buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn, snapshot: snapshotFor(targetTurn),
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor,
      onPosition: (turn, battle) => {
        if (turns.includes(turn) && !seen.has(turn)) seen.set(turn, read(battle as never));
      },
    },
  });
  return seen;
}

describe('the scene: smogtours-gen9ou-752733 turns 15 to 17 (singles)', () => {
  const replay = fixture('smogtours-gen9ou-752733.json');
  const teams = JSON.parse(readFileSync(new URL('./fixtures/smogtours-gen9ou-752733.bank-teams.json', import.meta.url), 'utf-8')) as Teams;
  const block14 = parseTurnBlocks(replay.log).turns.find(turn => turn.turn === 14)!;
  const lines = [...block14.preUpkeep, ...block14.postUpkeep];

  test('the block shows Salt Cure starting on Iron Valiant', () => {
    expect(lines).toContain('|-start|p2a: Iron Valiant|Salt Cure');
  });

  test('a board that lacks Salt Cure after the block takes it back from the block\'s start line; a board that has it keeps its own', { timeout: 240000 }, async () => {
    const seen = await boundaries(replay, [15], battle => {
      const body = battle.sides[1].active[0]!;
      const own = body.volatiles['saltcure'];
      correctActivesFromProtocol(battle as never, lines, undefined, block14.preUpkeep.length);
      const kept = body.volatiles['saltcure'] === own;
      delete body.volatiles['saltcure'];
      const hp = body.hp;
      correctActivesFromProtocol(battle as never, lines, undefined, block14.preUpkeep.length);
      return { name: body.species.name, ownBefore: !!own, kept, saltcure: !!body.volatiles['saltcure'], hpKept: body.hp === hp };
    }, teams);
    expect(seen.get(15)).toEqual({ name: 'Iron Valiant', ownBefore: true, kept: true, saltcure: true, hpKept: true });
  });
});

const mon = (species: string, ability: string, moves: string[], item = ''): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function board(format: string, p1: PokemonSet[], p2: PokemonSet[]): LiveBattle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const FORMATS = { singles: 'gen9customgame', doubles: 'gen9doublescustomgame' } as const;
const filler = (species: string, ability: string) => mon(species, ability, ['Splash']);
/** p1's first body uses the move on p2's first body, everybody else splashes. */
function duel(kind: 'singles' | 'doubles', attacker: PokemonSet) {
  const p1 = kind === 'singles' ? [attacker] : [attacker, filler('Eevee', 'Run Away')];
  const p2 = kind === 'singles' ? [filler('Magikarp', 'Swift Swim')] : [filler('Magikarp', 'Swift Swim'), filler('Ditto', 'Limber')];
  return {
    p1, p2,
    play: (battle: LiveBattle, p1Choice: string) => {
      battle.choose('p1', kind === 'singles' ? p1Choice : `${p1Choice}, move 1`);
      battle.choose('p2', kind === 'singles' ? 'move 1' : 'move 1, move 1');
    },
  };
}

const startLine = (effect: string, ident = 'p2a: Magikarp') => `|-start|${ident}|${effect}`;

describe.each(['singles', 'doubles'] as const)('the start lines against the simulator (%s)', kind => {
  const format = FORMATS[kind];
  const saltCure = () => mon('Garganacl', 'Sturdy', ['Salt Cure', 'Splash']);
  const fresh = (attacker: PokemonSet) => { const duelists = duel(kind, attacker); return { duelists, battle: board(format, duelists.p1, duelists.p2) }; };

  test('Salt Cure: the replayed line leaves the same volatile and the same residual damage as the real move; hp, log and dice stay', () => {
    const real = fresh(saltCure());
    real.duelists.play(real.battle, 'move 1 1');
    expect(real.battle.sides[1].active[0]!.volatiles['saltcure']).toBeTruthy();
    const afterFirstA = real.battle.sides[1].active[0]!.hp;
    real.duelists.play(real.battle, 'move 2');
    const lossA = afterFirstA - real.battle.sides[1].active[0]!.hp;

    const replayed = fresh(saltCure());
    const b = replayed.battle;
    replayed.duelists.play(b, 'move 2');
    const body = b.sides[1].active[0]!;
    const [hp, maxhp, logLength, seed] = [body.hp, body.maxhp, b.log.length, b.prng.getSeed()];
    expect(body.volatiles['saltcure']).toBeUndefined();
    expect(playProtocolStarts(b as never, [startLine('Salt Cure')])).toBe(true);
    expect(body.volatiles['saltcure']).toBeTruthy();
    expect([body.hp, body.maxhp, b.log.length, b.prng.getSeed()]).toEqual([hp, maxhp, logLength, seed]);
    const afterFirstB = body.hp;
    replayed.duelists.play(b, 'move 2');
    expect(afterFirstB - body.hp).toBe(lossA);
    expect(lossA).toBeGreaterThan(0);
  });

  test('Protosynthesis and Quark Drive: the protocol\'s stat decides, on a missing volatile and on one with another stat', () => {
    for (const [ability, effect] of [['Protosynthesis', 'protosynthesisatk'], ['Quark Drive', 'quarkdrivespe']] as const) {
      const id = Dex.conditions.get(ability).id;
      const lacking = fresh(filler('Pikachu', 'Static')).battle;
      expect(playProtocolStarts(lacking as never, [startLine(effect)])).toBe(true);
      expect(lacking.sides[1].active[0]!.volatiles[id]?.['bestStat'], `${ability} added`).toBe(effect.slice(-3));
      const other = fresh(filler('Pikachu', 'Static')).battle;
      const holder = other.sides[1].active[0]!;
      holder.addVolatile(id);
      holder.volatiles[id]!['bestStat'] = effect.endsWith('atk') ? 'def' : 'atk';
      expect(playProtocolStarts(other as never, [startLine(effect)])).toBe(true);
      expect(holder.volatiles[id]?.['bestStat'], `${ability} corrected`).toBe(effect.slice(-3));
    }
  });

  test('Taunt: a start before the residual round of the block ticks once, as the simulator does after the real move; a start after it does not', () => {
    // Magikarp is faster and has moved when the Taunt lands, which is how the simulator reads a start outside a move (an empty queue).
    const real = fresh(mon('Sableye', 'Keen Eye', ['Taunt', 'Splash']));
    real.duelists.play(real.battle, 'move 1 1');
    const realDuration = real.battle.sides[1].active[0]!.volatiles['taunt']!.duration!;
    expect(realDuration).toBeGreaterThan(0);
    for (const [residualAt, want] of [[1, realDuration], [0, realDuration + 1], [undefined, realDuration + 1]] as const) {
      const { battle } = fresh(filler('Sableye', 'Keen Eye'));
      playProtocolStarts(battle as never, [startLine('move: Taunt')], residualAt);
      expect(battle.sides[1].active[0]!.volatiles['taunt']!.duration, `residualAt ${residualAt}`).toBe(want);
    }
  });

  test('controls: nothing starts for a start that ended in the block, for a body that left the field or fainted, for a token no Dex condition names, or for a volatile the board has', () => {
    const cases: [string, string[]][] = [
      ['ended in the block', [startLine('Salt Cure'), '|-end|p2a: Magikarp|Salt Cure']],
      ['the slot switched after', [startLine('Salt Cure'), '|switch|p2a: Ditto|Ditto|100/100']],
      ['the body fainted after', [startLine('Salt Cure'), '|faint|p2a: Magikarp']],
      ['a count token', [startLine('perish3')]],
      ['a type change', [startLine('typechange|Fire')]],
      ['a status token', [startLine('brn')]],
    ];
    for (const [label, lines] of cases) {
      const { battle } = fresh(filler('Pikachu', 'Static'));
      const logLength = battle.log.length;
      expect(playProtocolStarts(battle as never, lines), label).toBe(false);
      expect(Object.keys(battle.sides[1].active[0]!.volatiles), label).toEqual([]);
      expect(battle.log.length, label).toBe(logLength);
    }
    const fainted = fresh(filler('Pikachu', 'Static')).battle;
    const body = fainted.sides[1].active[0]!;
    body.hp = 0;
    body.fainted = true;
    expect(playProtocolStarts(fainted as never, [startLine('Salt Cure')])).toBe(false);
    expect(body.volatiles['saltcure']).toBeUndefined();
    const had = fresh(filler('Pikachu', 'Static')).battle;
    const holder = had.sides[1].active[0]!;
    holder.addVolatile('saltcure');
    const state = holder.volatiles['saltcure'];
    expect(playProtocolStarts(had as never, [startLine('Salt Cure')])).toBe(false);
    expect(holder.volatiles['saltcure']).toBe(state);
  });

  test('the door: a block with Windows line endings starts the same volatile through correctActivesFromProtocol', () => {
    const { battle } = fresh(filler('Pikachu', 'Static'));
    correctActivesFromProtocol(battle as never, [`${startLine('Salt Cure')}\r`]);
    expect(battle.sides[1].active[0]!.volatiles['saltcure']).toBeTruthy();
  });
});

await loadSimMods('gen9championsou');

/**
 * The sweep: every Dex condition a volatile status can name, in every generation the corpus plays and in the Champions mod,
 * singles and doubles. The simulator starts the condition on a body and writes its `-start` lines; the same lines fed to a
 * second identical board must leave the same volatile with the same duration. What the rule cannot reproduce is counted
 * (not named): a handler that reads the move in progress or needs a source the line does not carry.
 */
describe('the sweep: the lines the simulator writes for a started volatile start it again on a second board', () => {
  const formats = [3, 4, 5, 6, 7, 8, 9].flatMap(gen => [`gen${gen}customgame`, `gen${gen}doublescustomgame`]).concat('gen9championscustomgame', 'gen9championsdoublescustomgame');
  const conditionIds = (dex: typeof Dex) => {
    const ids = new Set<string>();
    for (const move of dex.moves.all()) {
      if (move.volatileStatus) ids.add(move.volatileStatus);
      if ((move as { condition?: unknown }).condition) ids.add(move.id);
    }
    for (const entry of [...dex.abilities.all(), ...dex.items.all()]) if ((entry as { condition?: unknown }).condition) ids.add(entry.id);
    return [...ids].filter(id => dex.conditions.get(id).exists && dex.conditions.get(id).effectType === 'Condition').sort();
  };
  const size = (format: string) => (format.includes('doubles') ? 2 : 1);
  const bodies = (format: string) =>
    board(format, [filler('Pikachu', 'Static'), filler('Eevee', 'Run Away')].slice(0, size(format)), [filler('Eevee', 'Run Away'), filler('Pikachu', 'Static')].slice(0, size(format)));
  const tally = { checked: 0, ok: 0, notAdded: 0, noStartLine: 0, notReproduced: [] as string[], differs: [] as string[] };
  /**
   * Measured when the rule was written: two conditions per format. Stockpile writes a count (`stockpile1`), a token no
   * condition names; Attract checks the genders of the body and a source its line does not carry.
   */
  const KNOWN_NOT_REPRODUCED = 32;

  for (const format of formats) {
    test(format, () => {
      const dex = Dex.forFormat(format);
      if (!dex.formats.get(format).exists) return;
      for (const id of conditionIds(dex)) {
        const a = bodies(format);
        const body = a.sides[1].active[0]!;
        const logLength = a.log.length;
        let added: boolean;
        try { added = !!body.addVolatile(id, a.sides[0].active[0]!) && !!body.volatiles[id]; } catch { added = false; }
        tally.checked++;
        if (!added) { tally.notAdded++; continue; }
        const lines = a.log.slice(logLength).filter(line => line.startsWith('|-start|p2a'));
        if (lines.length === 0) { tally.noStartLine++; continue; }
        const b = bodies(format);
        const second = b.sides[1].active[0]!;
        const [hp, maxhp, length] = [second.hp, second.maxhp, b.log.length];
        try { playProtocolStarts(b as never, lines); } catch { /* counted below */ }
        if (!second.volatiles[id]) { tally.notReproduced.push(`${format}:${id}`); continue; }
        const same = second.volatiles[id]!.duration === body.volatiles[id]!.duration && second.hp === hp && second.maxhp === maxhp && b.log.length === length;
        if (same) tally.ok++; else tally.differs.push(`${format}:${id}`);
      }
    });
  }

  test('what the rule cannot reproduce is counted, and the rest is exact', () => {
    expect(tally.checked).toBeGreaterThan(1000);
    expect(tally.ok).toBeGreaterThan(300);
    expect(tally.differs, tally.differs.join(' ')).toEqual([]);
    expect(tally.notReproduced.length, tally.notReproduced.join(' ')).toBe(KNOWN_NOT_REPRODUCED);
  });
});
