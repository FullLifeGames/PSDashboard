import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { setAskCheck } from '../src/sim-ask';
import { CHAMPIONS, mon, RULES, RULES_WITH_DOUBLES, standing, sweepSelection, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { battleOf } from './power-oracle';

// The log hides the target of a move that fails before it animates: `|move|p2b: Sableye|Disable||[still]`.
// The rebuild asks the simulator on a copy which aim makes the move fail as the log shows (`sim-ask/hidden-aim.ts`).
await loadSimMods('gen9championsou');

beforeAll(() => setAskCheck(true));
afterAll(() => setAskCheck(null));

const publicLines = (battle: Battle): string[] => {
  const out: string[] = [];
  for (let index = 0; index < battle.log.length; index++) {
    if (battle.log[index].startsWith('|split|')) index++; else out.push(battle.log[index]);
  }
  return out;
};

const body = (rules: Rules, species: string, moves: string[]): PokemonSet => mon(rules, { species, moves, gender: 'M' });

function teams(rules: Rules, probe: string[]): { p1: PokemonSet[]; p2: PokemonSet[] } {
  return {
    p1: [body(rules, 'Pikachu', ['splash']), body(rules, 'Blissey', ['splash']), body(rules, 'Chansey', ['splash']), body(rules, 'Raichu', ['splash'])],
    p2: [body(rules, 'Vaporeon', ['splash']), body(rules, 'Snorlax', [...probe, 'splash'])],
  };
}

function boardAtTurn2(rules: Rules, probe: string[], singles = false): Battle {
  const { p1, p2 } = teams(rules, probe);
  const battle = singles
    ? battleOf(rules.singles, [p1[0], p1[2]], [p2[1]])
    : battleOf(rules.doubles!, p1, p2);
  const turn1 = singles ? { p1: 'move 1', p2: 'move 2' } : { p1: 'move 1, move 1', p2: 'move 1, move 2' };
  if (!battle.choose('p1', turn1.p1) || !battle.choose('p2', turn1.p2)) throw new Error('turn 1 refused');
  return battle;
}

const locOf = (battle: Battle, slot: number): number => battle.sides[1].active[1].getLocOf(battle.sides[0].active[slot]);

interface Played { events: string[]; log: string[]; line: string }

function playTurn2(battle: Battle, p1Click: string, aim: number | null, singles = false): Played {
  const p2Click = singles ? 'move 1' : `move 1, move 1${aim === null ? '' : ` ${aim > 0 ? `+${aim}` : aim}`}`;
  if (!battle.choose('p1', p1Click) || !battle.choose('p2', p2Click)) throw new Error(`refused ${p1Click} / ${p2Click}`);
  const lines = publicLines(battle);
  const events = parseTurnBlocks(lines.join('\n')).turns.find(turn => turn.turn === 2)!.preUpkeep;
  return { events, log: lines, line: events.find(line => /^\|move\|p2[ab]: Snorlax/.test(line)) ?? '' };
}

const PROBES = [
  { name: 'Disable', id: 'disable' },
  { name: 'Encore', id: 'encore' },
];

describe('the aim of a failed move whose target the protocol hides', () => {
  for (const rules of [RULES[8], CHAMPIONS]) {
    for (const probe of PROBES) {
      test(`${rules.name} doubles: ${probe.name} fails on the body that switched in; the rebuild aims at it`, () => {
        const twin = boardAtTurn2(rules, [probe.id]);
        const aimAtFresh = locOf(twin, 1);
        const played = playTurn2(twin, 'move 1, switch 3', aimAtFresh);
        expect(played.line, 'the game hides the target').toMatch(/\|move\|p2b: Snorlax\|[A-Za-z ]+\|\|\[still\]/);

        const board = boardAtTurn2(rules, [probe.id]);
        const before = standing(board);
        const choice = getMainChoice(played.events, 'p2', board as never);
        expect(standing(board), 'the question leaves the live battle as it was').toBe(before);
        expect(choice).toBe(`move 1, move 1 +${aimAtFresh}`);

        const again = boardAtTurn2(rules, [probe.id]);
        const replay = playTurn2(again, 'move 1, switch 3', Number(choice.split(' ').pop()));
        expect(replay.line).toBe(played.line);
        expect(Object.keys(again.sides[0].active[0].volatiles)).toEqual([]);
      });

      test(`${rules.name} doubles: ${probe.name} lands on the body that moved; the log's target stays`, () => {
        const twin = boardAtTurn2(rules, [probe.id]);
        const aimAtVeteran = locOf(twin, 0);
        const played = playTurn2(twin, 'move 1, switch 3', aimAtVeteran);
        expect(played.line, 'the game shows the target').toMatch(/\|move\|p2b: Snorlax\|[A-Za-z ]+\|p1a: Pikachu$/);
        const board = boardAtTurn2(rules, [probe.id]);
        expect(getMainChoice(played.events, 'p2', board as never)).toBe(`move 1, move 1 +${aimAtVeteran}`);
      });

      test(`${rules.name} doubles: both foes switched in, both aims fail the same way; the default aim stays`, () => {
        const twin = boardAtTurn2(rules, [probe.id]);
        const played = playTurn2(twin, 'switch 3, switch 4', locOf(twin, 1));
        expect(played.line).toMatch(/\[still\]$/);
        const board = boardAtTurn2(rules, [probe.id]);
        const choice = getMainChoice(played.events, 'p2', board as never);
        const again = boardAtTurn2(rules, [probe.id]);
        expect(playTurn2(again, 'switch 3, switch 4', Number(choice.split(' ').pop())).line).toBe(played.line);
        expect(choice).toBe('move 1, move 1 +1');
      });
    }

    test(`${rules.name} singles: one foe, no aim to ask`, () => {
      const twin = boardAtTurn2(rules, ['disable'], true);
      const played = playTurn2(twin, 'switch 2', null, true);
      expect(played.line).toMatch(/\|\|\[still\]$/);
      const board = boardAtTurn2(rules, ['disable'], true);
      expect(getMainChoice(played.events, 'p2', board as never)).toBe('move 1');
    });
  }
});

// A run without `DICE_SWEEPS=full` plays a fixed sample of the moves plus every move that reads the target's last move.
type Dex = ReturnType<typeof dexOfRules>;
type Move = ReturnType<Dex['moves']['get']>;

interface Situation { id: string; p1: string; inject?: (target: Battle['sides'][number]['active'][number]) => void }

function situationsOf(move: Move): Situation[] {
  const keep = 'move 1, move 1';
  const out: Situation[] = [{ id: 'switch-in', p1: 'move 1, switch 3' }];
  if (move.volatileStatus) out.push({ id: `volatile ${move.volatileStatus}`, p1: keep, inject: target => { target.addVolatile(move.volatileStatus!); } });
  if (move.status) out.push({ id: `status ${move.status}`, p1: keep, inject: target => { target.setStatus(move.status!); } });
  if (move.boosts) {
    const boosts = move.boosts;
    out.push({ id: 'boost limit', p1: keep, inject: target => {
      for (const [stat, change] of Object.entries(boosts)) (target.boosts as Record<string, number>)[stat] = change > 0 ? 6 : -6;
    } });
  }
  return out;
}

const handlerText = (entry: object): string =>
  Object.values(entry).filter((value): value is () => unknown => typeof value === 'function').map(String).join('\n');
const readsLastMove = (move: Move): boolean => /lastMove/.test(handlerText(move) + handlerText((move as unknown as { condition?: object }).condition ?? {}));

const aimToken = (aim: number): string => (aim > 0 ? `+${aim}` : `${aim}`);

describe('the sweep: every single-target move, played where it fails at one foe and lands at the other', () => {
  for (const rules of RULES_WITH_DOUBLES) {
    test(rules.name, () => {
      const dex = dexOfRules(rules);
      const probeBoard = boardAtTurn2(rules, ['splash']);
      const aimed = dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
        && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past')
        && probeBoard.actions.targetTypeChoices(move.target) && move.id !== 'splash');
      const chosen = new Set(sweepSelection(aimed, 'pool').map(move => move.id));
      for (const move of aimed) if (readsLastMove(move)) chosen.add(move.id);
      const seen = { situations: 0, asymmetric: 0, hiddenRows: 0, moves: new Set<string>() };

      for (const move of aimed.filter(entry => chosen.has(entry.id))) {
        for (const situation of situationsOf(move)) {
          const make = (): Battle | null => {
            try {
              const board = boardAtTurn2(rules, [move.id]);
              situation.inject?.(board.sides[0].active[1]);
              return board;
            } catch { return null; }
          };
          const first = make();
          if (!first) continue;
          const aims = [1, -1, 2, -2].filter(aim => first.validTargetLoc(aim, first.sides[1].active[1], first.actions.targetTypeChoices(move.target) ? move.target : ''));
          if (aims.length < 2) continue;
          seen.situations++;
          const rows: { aim: number; played: Played | null }[] = aims.map(aim => {
            const twin = make();
            if (!twin) return { aim, played: null };
            try { return { aim, played: playTurn2(twin, situation.p1, aim) }; } catch { return { aim, played: null }; }
          });
          const hiding = rows.filter(row => row.played && hidesLine(row.played.line));
          const showing = rows.filter(row => row.played && row.played.line !== '' && !hidesLine(row.played.line));
          if (hiding.length && showing.length) seen.asymmetric++;
          for (const row of hiding) {
            const label = `${rules.name} ${move.id} ${situation.id} aim ${aimToken(row.aim)}`;
            const board = make()!;
            const before = standing(board);
            const choice = getMainChoice(row.played!.events, 'p2', board as never);
            expect(standing(board), `${label}: the live battle`).toBe(before);
            const aim = Number(choice.split(', ')[1].split(' ').pop());
            const replay = playTurn2(make()!, situation.p1, aim);
            expect(replay.line, `${label}: the choice "${choice}" hides the target as the log does`).toBe(row.played!.line);
            expect(showing.some(other => other.aim === aim), `${label}: "${choice}" aims where the move shows its target`).toBe(false);
            seen.hiddenRows++;
            seen.moves.add(move.id);
          }
        }
      }
      if (process.env.HIDDEN_AIM_CENSUS) appendFileSync(process.env.HIDDEN_AIM_CENSUS, `${rules.name}: moves ${chosen.size}, situations ${seen.situations}, asymmetric ${seen.asymmetric}, hidden rows ${seen.hiddenRows}, moves with a hidden row ${[...seen.moves].join(' ')}\n`);
      expect(seen.situations, `${rules.name}: situations played`).toBeGreaterThan(0);
      expect(seen.asymmetric, `${rules.name}: situations where one aim hides and another shows (${[...seen.moves]})`).toBeGreaterThan(0);
    }, 600_000);
  }
});

const hidesLine = (line: string): boolean => /\|\|\[still\]/.test(line) && line.split('|')[4] === '';
