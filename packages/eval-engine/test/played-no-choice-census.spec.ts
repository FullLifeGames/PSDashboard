import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay, formatEnforcesSleepClause, getBranchSimulatorFormat, inferReplayFormatId, parseReplayLog,
  parseReplayLogWithObservations, replayBringOnly, replayRuleset, toId, type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeLiveBattle } from '../src/serialize';
import { searchPosition } from '../src/search';
import { analyzeTurn } from '../src/analysis';
import { allTurnEvents, parsePlayedActionsDoubles, turnEvents } from '../src/played';
import { resolveTeraPreference } from '../src/tera';

const FEEDBACK = new URL('../../../test/e2e-feedback/fixtures/', import.meta.url);
const ENGINE = new URL('./fixtures/', import.meta.url);

type Game = 'Doubles OU' | 'VGC' | 'Champions VGC';
const gameOf = (formatid: string): Game | null =>
  formatid.includes('championsvgc') ? 'Champions VGC' : formatid.includes('vgc') ? 'VGC' : formatid.includes('doublesou') ? 'Doubles OU' : null;

const replays = [FEEDBACK, ENGINE].flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
  const replay = JSON.parse(readFileSync(new URL(name, dir), 'utf-8')) as ReplayData & { formatid?: string };
  const game = gameOf(replay.formatid ?? '');
  return game && /\|gametype\|doubles/.test(replay.log) ? [{ game, replay }] : [];
}));

function firstLineOf(events: string[], ref: string): string | null {
  const own = events.find(line => new RegExp(`^\\|(move|switch|cant|faint)\\|${ref}:`).test(line));
  return own ? own.split('|')[1] : null;
}

describe('the slots of Doubles OU, VGC and Champions VGC that show no choice, read from the logs of the corpus', () => {
  test.each(['Doubles OU', 'VGC', 'Champions VGC'] as Game[])('%s: every slot that fell before it acted or never came is marked as the log shows it', game => {
    const counts = { fell: 0, ended: 0 };
    for (const { replay } of replays.filter(entry => entry.game === game)) {
      allTurnEvents(replay.log).forEach(events => {
        if (!events) return;
        const played = parsePlayedActionsDoubles(events);
        const over = events.some(line => line.startsWith('|win|') || line.startsWith('|tie'));
        for (const side of ['p1', 'p2'] as const) {
          (['a', 'b'] as const).forEach((letter, slot) => {
            const first = firstLineOf(events, `${side}${letter}`);
            const fell = first === 'faint';
            const ended = first === null && over;
            expect(played.fell?.[side]?.[slot] != null, `${replay.id} ${side}${letter} fell`).toBe(fell);
            expect(played.ended?.[side]?.[slot] ?? false, `${replay.id} ${side}${letter} ended`).toBe(ended);
            counts.fell += fell ? 1 : 0;
            counts.ended += ended ? 1 : 0;
          });
        }
      });
    }
    expect(counts.fell).toBeGreaterThan(0);
    expect(counts.ended).toBeGreaterThan(0);
  });
});

interface SideExpect { side: 'p1' | 'p2'; named: { slot: number; reason: 'fell' | 'ended' }[]; mover?: number }
const SCENES: { game: Game; id: string; turn: number; file: URL; sides: SideExpect[] }[] = [
  {
    game: 'Doubles OU', id: '2663093831 t7: Orthworm fell before it moved, Dragonite used Protect', turn: 7,
    file: new URL('gen9doublesou-2663093831.json', FEEDBACK), sides: [{ side: 'p1', named: [{ slot: 0, reason: 'fell' }], mover: 1 }],
  },
  {
    game: 'VGC', id: '2630685175 t9: a body fell before it moved, High Horsepower came out', turn: 9,
    file: new URL('gen9vgc2026regi-2630685175.json', FEEDBACK), sides: [{ side: 'p1', named: [{ slot: 1, reason: 'fell' }], mover: 0 }],
  },
  {
    game: 'Champions VGC', id: '2682637901 t6: Raichu (alone) fell, the game ended before Volcarona moved', turn: 6,
    file: new URL('gen9championsvgc2026regmbbo3-2682637901.json', ENGINE),
    sides: [{ side: 'p1', named: [{ slot: 0, reason: 'ended' }], mover: 1 }, { side: 'p2', named: [{ slot: 0, reason: 'fell' }] }],
  },
];

describe('the searched turn of a slot that showed no choice reads the log on the slot that moved', () => {
  test.each(SCENES)('$game, $id', async ({ turn, file, sides }) => {
    const replay = JSON.parse(readFileSync(file, 'utf-8')) as ReplayData;
    const format = getBranchSimulatorFormat(replay);
    await loadSimMods(format);
    const parsed = parseReplayLogWithObservations(replay.log);
    const { snapshots, observations, speedOrders } = parsed;
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const runtime = await reconstructBranchRuntime({
      format, p1Team, p2Team, replayLog: replay.log, targetTurn: turn, snapshot: snapshots[turn - 1] ?? null,
      playerNames: [replay.players[0], replay.players[1]],
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      deadlineMs: 120_000,
    });
    const played = parsePlayedActionsDoubles(turnEvents(replay.log, turn));
    const result = searchPosition(serializeLiveBattle(runtime.battleStream.battle!), {
      depth: 1, samples: 1, tera: resolveTeraPreference('auto', inferReplayFormatId(replay), replay.log),
      sleepClause: formatEnforcesSleepClause(format), keepPlayed: played, ruleset: replayRuleset(replay),
    });
    const analysis = analyzeTurn({
      turn, result, played, playedOutcome: null, scoreBefore: result.score, scoreAfter: null, playedTracking: true,
      actives: { p1: null, p2: null, gen: 9 },
    });

    for (const { side, named, mover } of sides) {
      const record = analysis[side];
      expect(record.noChoiceSlots).toEqual(named);
      expect(record.neverActed).toBeUndefined();
      if (mover === undefined) {
        expect(record.played).toBeNull();
        continue;
      }
      const moved = record.playedSlots![mover]!;
      expect(record.played?.choice.split(',')[mover].trim().split(' ')[1]).toBe(toId(moved.name));
    }
  }, 300_000);
});
