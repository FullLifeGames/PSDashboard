import { test, expect } from '@playwright/test';

test.describe('species-shaped default spreads', () => {
  test('the last-resort spread follows base stats, not a flat physical template', () => {
    // No usage stats, no sheets, no damage observations: the default must
    // still make species sense — special attackers get SpA, fast species
    // get Speed (base-123 Noivern was outsped by everything on 0 EVs), and
    // slow bulky species keep HP.
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|gametype|singles',
      '|poke|p2|Noivern, F|', '|poke|p2|Snorlax, M|',
      '|start',
      '|switch|p2a: Noivern|Noivern, F|100/100',
      '|turn|1',
    ].join('\n');
    const { p2Team } = buildTeamsFromReplay(log);
    const noivern = p2Team.find(set => set.species === 'Noivern')!;
    expect(noivern.evs.spa).toBe(252);
    expect(noivern.evs.spe).toBe(252);
    expect(noivern.evs.atk).toBe(0);
    const snorlax = p2Team.find(set => set.species === 'Snorlax')!;
    expect(snorlax.evs.atk).toBe(252);
    expect(snorlax.evs.hp).toBe(252);
    expect(snorlax.evs.spe).toBe(0);
  });
});
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { createBranchState, reconstructBranchRuntime } from '../src/lib/branch-engine';
import { inferOpponentTeam } from '../src/lib/opponent-inferrer';
import { parseExportedReplay } from '../src/lib/replay-file';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { enrichTeamInfo } from '../src/lib/team-info';
import type { SmogonUsageStats } from '../src/lib/smogon-stats';
import type { SmogonSetAssumptions } from '../src/lib/smogon-sets';
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
  test('a usage-guessed item never overrides the team sheet', () => {
    // The chat-posted sheet says Choice Scarf; an enriched info carries a
    // usage GUESS (Leftovers) in value. Sheet must win; a revealed item must
    // still beat the sheet.
    const sheetLog = [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|gen|9',
      '|tier|[Gen 9] Draft',
      '|poke|p1|Heatran, M|item',
      '|poke|p2|Kingambit, M|item',
      '|c| Alice|/raw <div class="infobox"><details><summary>View team</summary>Heatran (M) @ Choice Scarf  <br />Ability: Flash Fire  <br />EVs: 252 SpA &#x2f; 4 SpD &#x2f; 252 Spe  <br />Timid Nature  <br />- Magma Storm  <br />- Earth Power  <br />- Flash Cannon  <br />- Stealth Rock  <br /></details></div>',
      '|start',
      '|switch|p1a: Heatran|Heatran, M|100/100',
      '|switch|p2a: Kingambit|Kingambit, M|100/100',
      '|turn|1',
    ].join('\n');
    const infoWith = (item: { value: string; source: 'guessed' | 'revealed' }): OpponentTeamInfo => ({
      pokemon: [{
        species: 'Heatran',
        moves: [{ name: 'Magma Storm', source: 'revealed' }],
        ability: { value: '', source: 'unknown' },
        item: { ...item, probability: 0.58 },
        teraType: { value: '', source: 'unknown' },
        evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
        nature: { value: 'Modest', source: 'guessed' },
        ivs: { value: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, source: 'unknown' },
        level: 100,
        gender: 'M',
      }],
    });

    const guessed = buildTeamsFromReplay(sheetLog, { p1Info: infoWith({ value: 'Leftovers', source: 'guessed' }) });
    expect(guessed.p1Team[0].item).toBe('Choice Scarf');
    expect(guessed.p1Team[0].nature).toBe('Timid'); // guessed nature loses to the sheet too

    const revealed = buildTeamsFromReplay(sheetLog, { p1Info: infoWith({ value: 'Leftovers', source: 'revealed' }) });
    expect(revealed.p1Team[0].item).toBe('Leftovers');
  });

  test('ruled-out abilities are skipped by guesses and the slot default', () => {
    const log = [
      '|player|p1|Alice|', '|gen|9', '|tier|[Gen 9] Custom Game',
      '|poke|p1|Uxie, L50|', '|poke|p2|Clefable, F|',
      '|start', '|switch|p1a: Uxie|Uxie, L50|100/100',
      '|switch|p2a: Clef|Clefable, F|100/100', '|turn|1',
      '|-damage|p2a: Clef|88/100|[from] Stealth Rock', '|turn|2',
    ].join('\n');
    const { p2Team } = buildTeamsFromReplay(log);
    const clef = p2Team.find(set => set.species === 'Clefable');
    expect(clef?.ability).not.toBe('Magic Guard');
    expect(clef?.ability).toBeTruthy(); // falls to another real Clefable ability
  });

  test('a ruled-out slot-0 ability falls to the next species slot', () => {
    // Bronzong's slot 0 IS Levitate — a landed Earthquake must walk past it.
    const log = [
      '|player|p1|Alice|', '|gen|9', '|tier|[Gen 9] Custom Game',
      '|poke|p1|Garchomp, M|', '|poke|p2|Bronzong|',
      '|start', '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Bell|Bronzong|100/100', '|turn|1',
      '|move|p1a: Chomp|Earthquake|p2a: Bell',
      '|-damage|p2a: Bell|60/100', '|turn|2',
    ].join('\n');
    const { p2Team } = buildTeamsFromReplay(log);
    const bronzong = p2Team.find(set => set.species === 'Bronzong');
    expect(bronzong?.ability).toBe('Heatproof');
  });

  test('defaults an unrevealed ability to the species slot-0 ability', () => {
    // A packed set with an empty ability gives the sim Pokémon NO ability at
    // all (custom games skip validation) — the GPL reconstruction's Uxie
    // died to an Earthquake it should have been immune to.
    const log = [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|gen|9',
      '|tier|[Gen 9] Custom Game',
      '|poke|p1|Uxie, L50|',
      '|poke|p2|Landorus-Therian, L50|',
      '|start',
      '|switch|p1a: Uxie|Uxie, L50|100/100',
      '|switch|p2a: Lando|Landorus-Therian, L50|100/100',
      '|turn|1',
    ].join('\n');

    const { p1Team, p2Team } = buildTeamsFromReplay(log);
    expect(p1Team[0].ability).toBe('Levitate');
    expect(p2Team[0].ability).toBe('Intimidate');
  });

  test('inferred spreads overlay guessed EVs but never manual ones', () => {
    const log = [
      '|player|p1|Alice|', '|gen|9', '|tier|[Gen 9] Custom Game',
      '|poke|p1|Uxie, L50|', '|poke|p2|Landorus-Therian, L50|',
      '|start', '|switch|p1a: Uxie|Uxie, L50|100/100',
      '|switch|p2a: Lando|Landorus-Therian, L50|100/100', '|turn|1',
    ].join('\n');
    const inferredSpreads = new Map([
      ['p1:uxie', { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 }, nature: 'Bold' }],
    ]);

    const { p1Team } = buildTeamsFromReplay(log, { inferredSpreads });
    const uxie = p1Team.find(set => set.species === 'Uxie');
    expect(uxie?.evs.def).toBe(252);
    expect(uxie?.nature).toBe('Bold');

    // Manually edited EVs always beat the inference.
    const manualInfo = inferOpponentTeam(log, 'p1');
    const uxieInfo = manualInfo.pokemon.find(p => p.species === 'Uxie')!;
    uxieInfo.evs = { value: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 }, source: 'manual' };
    const manual = buildTeamsFromReplay(log, { p1Info: manualInfo, inferredSpreads });
    expect(manual.p1Team.find(set => set.species === 'Uxie')?.evs.spa).toBe(252);
    expect(manual.p1Team.find(set => set.species === 'Uxie')?.evs.def).toBe(0);
  });

  test('observations drive the overlay end-to-end on the GPL replay', () => {
    const replay = parseExportedReplay(readFileSync('e2e/fixtures/gpl-replay.html', 'utf-8'), 'gpl-replay.html');
    const { observations } = parseReplayLogWithObservations(replay.log);
    expect(observations.length).toBeGreaterThan(5);

    const teams = buildTeamsFromReplay(replay.log, { observations });
    const uxie = teams.p1Team.find(set => set.species === 'Uxie');
    // The solver recovers Uxie's HP investment (its real 182 max HP). With
    // one observation per direction, "bulkier defender" vs "weaker attacker"
    // is underdetermined — but the PAIR becomes replay-consistent either way:
    // the eval's branches stop killing Uxie with hits it visibly survived.
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.hp).toBe(252);
    const lando = teams.p2Team.find(set => set.species === 'Landorus-Therian')!;
    const landoAtk = lando.evs.atk ?? 0;
    const uxieBulk = (uxie!.evs.hp ?? 0) + (uxie!.evs.def ?? 0);
    // At least one side of the U-turn pair moved to explain the observed 31%.
    expect(landoAtk === 0 || uxieBulk > 252).toBe(true);
  });

  test('coherence vetoes drop a boost-contradicting usage fill and refill from the pool', () => {
    // GPL finding: SD Cobalion assembled with Body Press — marginally popular,
    // jointly incoherent. The veto drops it and the NEXT usage move fills in.
    const p1Info = {
      pokemon: [{
        species: 'Cobalion',
        moves: [{ name: 'Swords Dance', source: 'revealed' }],
        ability: { value: '', source: 'unknown' },
        item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' },
        level: 100,
        gender: '',
      }],
    } as OpponentTeamInfo;
    const usageStats = {
      format: 'gen9ou', month: '2026-07', source: 'test',
      pokemon: {
        cobalion: {
          species: 'Cobalion', rawCount: 100,
          abilities: [{ value: 'Justified', probability: 1, sourceDetail: 't' }],
          items: [{ value: 'Leftovers', probability: 0.5, sourceDetail: 't' }],
          moves: [
            { value: 'Iron Head', probability: 0.8, sourceDetail: 't' },
            { value: 'Body Press', probability: 0.7, sourceDetail: 't' },
            { value: 'Stone Edge', probability: 0.5, sourceDetail: 't' },
            { value: 'Close Combat', probability: 0.4, sourceDetail: 't' },
          ],
          spreads: [],
        },
      },
    } as unknown as SmogonUsageStats;

    const { p1Team } = buildTeamsFromReplay(baseLog, { p1Info, usageStats });

    expect(p1Team[0].moves).toEqual(['Swords Dance', 'Iron Head', 'Stone Edge', 'Close Combat']);
  });

  test('the displayed enrichment and the built set agree on the guessed moves', () => {
    // The app builds teams from ENRICHED infos — what the stats panel shows
    // must be what the simulator plays (the GPL Body Press split).
    const p1Info = {
      pokemon: [{
        species: 'Cobalion',
        moves: [
          { name: 'Swords Dance', source: 'revealed' },
          { name: 'Heavy Slam', source: 'revealed' },
        ],
        ability: { value: '', source: 'unknown' },
        item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' },
        level: 100,
        gender: '',
      }],
    } as OpponentTeamInfo;
    const usageStats = {
      format: 'gen9ou', month: '2026-07', source: 'test',
      pokemon: {
        cobalion: {
          species: 'Cobalion', rawCount: 100,
          abilities: [{ value: 'Justified', probability: 1, sourceDetail: 't' }],
          items: [{ value: 'Leftovers', probability: 0.5, sourceDetail: 't' }],
          moves: [
            { value: 'Iron Head', probability: 0.8, sourceDetail: 't' },
            { value: 'Body Press', probability: 0.7, sourceDetail: 't' },
            { value: 'Stone Edge', probability: 0.5, sourceDetail: 't' },
            { value: 'Close Combat', probability: 0.4, sourceDetail: 't' },
          ],
          spreads: [],
        },
      },
    } as unknown as SmogonUsageStats;

    const enriched = enrichTeamInfo(p1Info, usageStats);
    const displayed = enriched.pokemon[0].moves.map(move => move.name);
    expect(displayed).toEqual(['Swords Dance', 'Heavy Slam', 'Stone Edge', 'Close Combat']);

    const { p1Team } = buildTeamsFromReplay(baseLog, { p1Info: enriched, usageStats });
    expect(p1Team[0].moves).toEqual(displayed);
  });

  test('a revealed move selects the coherent curated set and fills from it', () => {
    const p1Info = {
      pokemon: [{
        species: 'Noivern',
        moves: [{ name: 'Super Fang', source: 'revealed' }],
        ability: { value: '', source: 'unknown' },
        item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' },
        level: 100,
        gender: '',
      }],
    } as OpponentTeamInfo;
    const setAssumptions = {
      format: 'gen9ou', source: 'test',
      pokemon: {
        noivern: {
          species: 'Noivern', sourceDetail: 't',
          item: { value: 'Choice Specs', sourceDetail: 't' },
          moves: ['Draco Meteor', 'Hurricane', 'Flamethrower', 'U-turn'].map(value => ({ value, sourceDetail: 't' })),
          alternatives: [{
            species: 'Noivern', sourceDetail: 't',
            item: { value: 'Heavy-Duty Boots', sourceDetail: 't' },
            moves: ['Super Fang', 'Taunt', 'Roost', 'Hurricane'].map(value => ({ value, sourceDetail: 't' })),
          }],
        },
      },
    } as unknown as SmogonSetAssumptions;

    const { p1Team } = buildTeamsFromReplay(baseLog, { p1Info, setAssumptions });

    // The revealed Super Fang contradicts the Specs set — the Boots set wins
    // and fills item + unrevealed moves as one coherent unit.
    expect(p1Team[0].moves).toEqual(['Super Fang', 'Taunt', 'Roost', 'Hurricane']);
    expect(p1Team[0].item).toBe('Heavy-Duty Boots');
  });

  test('revealed moves contradicting every curated set fall back to marginal assembly', () => {
    const p1Info = {
      pokemon: [{
        species: 'Noivern',
        moves: [{ name: 'Boomburst', source: 'revealed' }, { name: 'Shadow Ball', source: 'revealed' }],
        ability: { value: '', source: 'unknown' },
        item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' },
        level: 100,
        gender: '',
      }],
    } as OpponentTeamInfo;
    const setAssumptions = {
      format: 'gen9ou', source: 'test',
      pokemon: {
        noivern: {
          species: 'Noivern', sourceDetail: 't',
          item: { value: 'Choice Specs', sourceDetail: 't' },
          moves: ['Draco Meteor', 'Hurricane', 'Flamethrower', 'U-turn'].map(value => ({ value, sourceDetail: 't' })),
        },
      },
    } as unknown as SmogonSetAssumptions;

    const { p1Team } = buildTeamsFromReplay(baseLog, { p1Info, setAssumptions });

    // Below the floor: the set is not adopted as a unit — revealed moves lead
    // and its moves serve only as ordinary marginal fills (today's assembly),
    // exactly the pre-selection behavior.
    expect(p1Team[0].moves).toEqual(['Boomburst', 'Shadow Ball', 'Draco Meteor', 'Hurricane']);
  });

  test('manual nature and IVs reach the simulator set', () => {
    const p1Info: OpponentTeamInfo = {
      pokemon: [{
        species: 'Garchomp',
        moves: [{ name: 'Earthquake', source: 'revealed' }],
        ability: { value: 'Rough Skin', source: 'revealed' },
        item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' },
        evs: { value: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, source: 'manual' },
        nature: { value: 'Jolly', source: 'manual' },
        ivs: { value: { hp: 31, atk: 31, def: 31, spa: 0, spd: 31, spe: 31 }, source: 'manual' },
        level: 100,
        gender: 'M',
      }],
    };

    const { p1Team } = buildTeamsFromReplay(baseLog, { p1Info });

    expect(p1Team[0].nature).toBe('Jolly');
    expect(p1Team[0].ivs.spa).toBe(0);
  });

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

test.describe('team sheet display overlay', () => {
  test('fills unproven fields from the sheet, never overriding proof or edits', async () => {
    const { applyTeamSheetToInfo } = await import('../src/lib/team-sheets');
    const field = (value: string, source: 'revealed' | 'guessed' | 'unknown') => ({ value, source } as const);
    const info = {
      pokemon: [{
        species: 'Heatran',
        moves: [
          { name: 'Overheat', source: 'revealed' as const },
          { name: 'Earth Power', source: 'guessed' as const, probability: 0.5 },
        ],
        ability: field('', 'unknown'),
        item: field('Leftovers', 'guessed'),
        teraType: field('', 'unknown'),
        evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' as const },
        level: 100,
        gender: 'M',
      }],
    };
    const sheet = [{
      name: 'Fire Shadow', species: 'Heatran', item: 'Choice Scarf', ability: 'Flash Fire',
      moves: ['Power Gem', 'Overheat', 'Flamethrower', 'Steel Beam'], nature: 'Modest',
      evs: { hp: 80, atk: 0, def: 0, spa: 252, spd: 0, spe: 176 },
      ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: 'M', teraType: 'Fire',
    }];

    // The "(has item)" team-preview placeholder loses to the sheet's name.
    const withPlaceholder = {
      pokemon: [{
        ...info.pokemon[0],
        item: { value: '(has item)', source: 'revealed' as const },
      }],
    };
    expect(applyTeamSheetToInfo(withPlaceholder, sheet).pokemon[0].item.value).toBe('Choice Scarf');

    const out = applyTeamSheetToInfo(info, sheet).pokemon[0];
    // The usage guess loses to the sheet; the revealed move survives.
    expect(out.item).toEqual({ value: 'Choice Scarf', source: 'sheet', sourceDetail: expect.stringContaining('team sheet') });
    expect(out.ability.value).toBe('Flash Fire');
    expect(out.evs.source).toBe('sheet');
    expect(out.evs.value.spe).toBe(176);
    expect(out.moves.map(move => `${move.name}:${move.source}`)).toEqual([
      'Overheat:revealed', 'Power Gem:sheet', 'Flamethrower:sheet', 'Steel Beam:sheet',
    ]);
    // No sheet -> untouched.
    expect(applyTeamSheetToInfo(info, null)).toBe(info);
  });

  test('chat-posted sheets feed the BUILT teams, not just the display', () => {
    // Draft T14 root cause: Talonflame's Heavy-Duty Boots (and Defog) sat in
    // the chat-posted sheet, but the builder only consumed |showteam| embeds
    // — the simulated Talonflame paid Stealth Rock entries it never takes.
    const log = [
      '|player|p1|Alice|1|',
      '|player|p2|Bob|2|',
      '|gen|9',
      '|poke|p1|Talonflame, F|item',
      '|start',
      '|switch|p1a: Talon|Talonflame, F|100/100',
      '|turn|1',
      '|c| Alice|/raw <div class="infobox"><details><summary>View team</summary>Talon (Talonflame) (F) @ Heavy-Duty Boots  <br />Ability: Flame Body  <br />- Roost  <br />- Defog  <br />- Brave Bird  <br /></details></div>',
    ].join('\n');
    const { p1Team } = buildTeamsFromReplay(log);
    const talon = p1Team.find(set => set.species === 'Talonflame');
    expect(talon?.item).toBe('Heavy-Duty Boots');
    expect(talon?.ability).toBe('Flame Body');
    expect(talon?.moves).toEqual(expect.arrayContaining(['Roost', 'Defog', 'Brave Bird']));
  });

  test('Champions replays build with the 32/66 EV budget', () => {
    const champLog = [
      '|player|p1|Alice|1|',
      '|player|p2|Bob|2|',
      '|gen|9',
      '|tier|[Gen 9] Champions VGC 2026 Reg M-A (Bo3)',
      '|poke|p1|Garchomp, M|',
      '|poke|p2|Kingambit, M|',
      '|start',
      '|switch|p1a: Garchomp|Garchomp, M|100/100',
      '|switch|p2a: Kingambit|Kingambit, M|100/100',
      '|turn|1',
    ].join('\n');
    const { p1Team } = buildTeamsFromReplay(champLog);
    const chomp = p1Team[0];
    const values = Object.values(chomp.evs ?? {});
    for (const value of values) expect(value).toBeLessThanOrEqual(32);
    expect(values.reduce((sum, value) => sum + (value ?? 0), 0)).toBeLessThanOrEqual(66);
  });

  test('extractTeamSheets finds the chat-posted infobox sheets', async () => {
    const { extractTeamSheets } = await import('../src/lib/team-builder');
    const log = [
      '|player|p1|Alice|1|',
      '|player|p2|Bob|2|',
      '|c| Bob|/raw <div class="infobox"><details><summary>View team</summary>Fire Shadow (Heatran) (M) @ Choice Scarf  <br />Ability: Flash Fire  <br />- Overheat  <br /></details></div>',
    ].join('\n');
    const sheets = extractTeamSheets(log);
    expect(sheets.p1).toBeNull();
    expect(sheets.p2?.[0].species).toBe('Heatran');
    expect(sheets.p2?.[0].item).toBe('Choice Scarf');
  });
});

test.describe('happiness assumption for guessed sets', () => {
  // Showdown's teambuilder assumption: Frustration users run 0 happiness
  // (BP 102). Nothing set `happiness` at all, so the sim default 255 made
  // every guessed Frustration hit at BP 1. Return needs no action — the
  // default 255 IS max happiness (BP 102).
  const gen6Log = (moveLine: string) => [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
    '|poke|p1|Lopunny, F|', '|poke|p2|Chansey, F|',
    '|start',
    '|switch|p1a: Lopunny|Lopunny, F|100/100',
    '|switch|p2a: Chansey|Chansey, F|100/100',
    '|turn|1',
    moveLine,
    '|turn|2',
  ].join('\n');

  test('a revealed Frustration forces happiness 0; Return stays untouched', () => {
    const frustrated = buildTeamsFromReplay(gen6Log('|move|p1a: Lopunny|Frustration|p2a: Chansey')).p1Team;
    expect(frustrated.find(set => set.species === 'Lopunny')!.happiness).toBe(0);
    const returning = buildTeamsFromReplay(gen6Log('|move|p1a: Lopunny|Return|p2a: Chansey')).p1Team;
    expect(returning.find(set => set.species === 'Lopunny')!.happiness).toBeUndefined();
  });

  test('an explicit happiness from an imported team wins', () => {
    const { p1Team } = buildTeamsFromReplay(gen6Log('|move|p1a: Lopunny|Frustration|p2a: Chansey'), {
      userTeamText: 'Lopunny\nHappiness: 128\n- Frustration\n- Protect\n',
    });
    expect(p1Team.find(set => set.species === 'Lopunny')!.happiness).toBe(128);
  });
});
