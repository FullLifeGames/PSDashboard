import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { createBranchState, reconstructBranchRuntime } from '../src/lib/branch-engine';
import { inferOpponentTeam } from '../src/lib/opponent-inferrer';
import type { OpponentTeamInfo } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureReplay = JSON.parse(
  readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'replay.json'), 'utf-8'),
);

const baseLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gen|9',
  '|tier|[Gen 9] OU',
  '|poke|p1|Garchomp, M|item',
  '|poke|p2|Kingambit, M|item',
  '|start',
  '|switch|p1a: Garchomp|Garchomp, M|100/100',
  '|switch|p2a: Kingambit|Kingambit, M|100/100',
  '|turn|1',
].join('\n');

test.describe('team builder edited assumptions', () => {
  test('uses manually edited EVs when building branch simulator teams', () => {
    const p1Info = {
      pokemon: [{
        species: 'Garchomp',
        moves: [{ name: 'Earthquake', source: 'revealed' }],
        ability: { value: 'Rough Skin', source: 'manual' },
        item: { value: 'Rocky Helmet', source: 'manual' },
        teraType: { value: '', source: 'unknown' },
        level: 100,
        gender: 'M',
        evs: {
          value: { hp: 12, atk: 244, def: 4, spa: 0, spd: 0, spe: 248 },
          source: 'manual',
        },
      }],
    } as OpponentTeamInfo;

    const { p1Team } = buildTeamsFromReplay(baseLog, { p1Info });

    expect(p1Team[0].evs).toEqual({ hp: 12, atk: 244, def: 4, spa: 0, spd: 0, spe: 248 });
  });

  test('rebuilt branch simulator teams use manually edited moves immediately', async () => {
    const p1Info = inferOpponentTeam(baseLog, 'p1');
    const p2Info = inferOpponentTeam(baseLog, 'p2');
    p1Info.pokemon[0] = {
      ...p1Info.pokemon[0],
      moves: [
        { name: 'Swords Dance', source: 'revealed' },
        { name: 'Scale Shot', source: 'revealed' },
        { name: 'Dragon Claw', source: 'manual' },
      ],
    };

    const { p1Team, p2Team } = buildTeamsFromReplay(baseLog, { p1Info, p2Info });
    expect(p1Team[0].moves).toEqual(['Swords Dance', 'Scale Shot', 'Dragon Claw']);

    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: baseLog,
      targetTurn: 1,
    });
    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });

    expect(state.p1Moves.map(move => move.name)).toEqual(['Swords Dance', 'Scale Shot', 'Dragon Claw']);
  });

  test('full replay branch rebuild uses manually edited moves immediately', async () => {
    const p1Info = inferOpponentTeam(fixtureReplay.log, 'p1');
    const p2Info = inferOpponentTeam(fixtureReplay.log, 'p2');
    p1Info.pokemon[0] = {
      ...p1Info.pokemon[0],
      moves: [
        { name: 'Swords Dance', source: 'revealed' },
        { name: 'Scale Shot', source: 'revealed' },
        { name: 'Dragon Claw', source: 'manual' },
      ],
    };

    const { p1Team, p2Team } = buildTeamsFromReplay(fixtureReplay.log, { p1Info, p2Info });
    expect(p1Team[0].moves).toEqual(['Swords Dance', 'Scale Shot', 'Dragon Claw']);

    const runtime = await reconstructBranchRuntime({
      format: fixtureReplay.formatid,
      p1Team,
      p2Team,
      replayLog: fixtureReplay.log,
      targetTurn: 1,
    });
    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });

    expect(state.p1Moves.map(move => move.name)).toEqual(['Swords Dance', 'Scale Shot', 'Dragon Claw']);
  });
});
