import { test, expect, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { Battle } from '@pkmn/sim';
import {
  formatEnforcesSleepClause,
  replayRuleset,
  getBranchSimulatorFormat,
  getReplayGameType,
  inferReplayFormatId,
  splitReplayPassword,
} from '../src/replay-format';

const vgcReplay = {
  id: 'gen9championsvgc2026regmb-2639020147',
  format: '[Gen 9 Champions] VGC 2026 Reg M-B',
  players: ['Lacksatives', 'PleaseRememberMe'],
  log: [
    '|j|Lacksatives',
    '|j|PleaseRememberMe',
    '|gametype|doubles',
    '|player|p1|Lacksatives|swimmer-masters|1179',
    '|player|p2|PleaseRememberMe|266|1183',
    '|gen|9',
    '|tier|[Gen 9 Champions] VGC 2026 Reg M-B',
    '|clearpoke',
    '|poke|p1|Scizor, L50, F|',
    '|poke|p1|Rotom-Wash, L50|',
    '|poke|p1|Sneasler, L50, M|',
    '|poke|p1|Tyranitar, L50, M|',
    '|poke|p2|Eelektross, L50, M|',
    '|poke|p2|Annihilape, L50, F|',
    '|poke|p2|Grimmsnarl, L50, M|',
    '|poke|p2|Politoed, L50, M|',
    '|teampreview|4',
    '|start',
    '|switch|p1a: Scizor|Scizor, L50, F|100/100',
    '|switch|p1b: Sneasler|Sneasler, L50, M|100/100',
    '|switch|p2a: Eelektross|Eelektross, L50, M|100/100',
    '|switch|p2b: Annihilape|Annihilape, L50, F|100/100',
    '|turn|1',
  ].join('\n'),
  uploadtime: 1782410309,
  views: 0,
};

describe('replay format inference', () => {
  test('infers missing Showdown format ids from replay ids', () => {
    expect(inferReplayFormatId(vgcReplay)).toBe('gen9championsvgc2026regmb');
    expect(getReplayGameType(vgcReplay.log)).toBe('doubles');
  });

  test('normalizes smogtours replay ids to real format ids (B13)', () => {
    expect(inferReplayFormatId({
      id: 'smogtours-gen3ou-56583',
      log: '|gen|3\n|tier|[Gen 3] OU',
    })).toBe('gen3ou');

    // Smogtours ids can omit the generation entirely — it comes from the log.
    expect(inferReplayFormatId({
      id: 'smogtours-ubers-54583',
      log: '|gen|6\n|tier|[Gen 6] Ubers',
    })).toBe('gen6ubers');

    expect(getBranchSimulatorFormat({
      id: 'smogtours-gen3ou-56583',
      log: '|gametype|singles\n|gen|3\n|tier|[Gen 3] OU',
    })).toBe('gen3ou');
  });

  test('maps VGC replay formats to a supported doubles simulator format', () => {
    expect(getBranchSimulatorFormat({ id: 'gen9vgc2026regi-2630181744', log: '|gametype|doubles\n|gen|9\n|tier|[Gen 9] VGC 2026 Reg I' })).toBe('gen9doublesou');
    expect(getBranchSimulatorFormat({ id: 'gen9vgc2024regh-2160552710', log: '|gametype|doubles\n|gen|9' })).toBe('gen9doublesou');
  });

  // Round 67 (T145): Pokémon Champions branches on the Champions mod of @pkmn/mods. Singles play the mod's OU, doubles
  // its Doubles Custom Game, which brings the whole team as Doubles OU does (the reconstruction trims to the brought
  // Pokémon itself; a VGC format's team preview would keep the first four). The regulation (M-A, M-B, M-C) changes only
  // legality, and a mod format takes no custom-rule suffix.
  test('round 67 (T145): Champions replays branch on the Champions mod\'s formats', () => {
    expect(getBranchSimulatorFormat(vgcReplay)).toBe('gen9championsdoublescustomgame');
    for (const id of ['gen9championsvgc2026regma-2604410427', 'gen9championsvgc2026regmabo3-2603652560', 'gen9championsvgc2026regmc-2695803506',
      'gen9championsvgc2026regmbbo3-2634199230']) {
      expect(getBranchSimulatorFormat({ id, log: '|gametype|doubles\n|gen|9' }), id).toBe('gen9championsdoublescustomgame');
    }
    expect(getBranchSimulatorFormat({ id: 'gen9championsou-2628340185', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9 Champions] OU' }))
      .toBe('gen9championsou');
    // A Champions OU log declares Sleep Moves Clause, never Sleep Clause Mod; a rule-less one still gets no suffix.
    expect(getBranchSimulatorFormat({ id: 'gen9championsou-1', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9 Champions] OU\n|rule|Sleep Clause Mod: Limit one foe put to sleep' }))
      .toBe('gen9championsou');
    expect(getBranchSimulatorFormat({ id: 'gen9championsou-2', log: '|gametype|singles\n|gen|9' })).toBe('gen9championsou');
  });

  test('preserves standard singles simulator formats', () => {
    expect(getBranchSimulatorFormat({
      ...vgcReplay,
      id: 'gen9ou-123',
      format: '[Gen 9] OU',
      formatid: 'gen9ou',
      log: vgcReplay.log.replace('|gametype|doubles', '|gametype|singles'),
    })).toBe('gen9ou');
  });

  test('unknown singles formats run as custom games with Sleep Clause resolved from the log', () => {
    // Declared |rule| line → the clause rides the format as a custom rule.
    expect(getBranchSimulatorFormat({
      id: 'gen9draft-123',
      log: '|gametype|singles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // Rules declared but no sleep clause among them → none injected.
    expect(getBranchSimulatorFormat({
      id: 'gen9draft-123',
      log: '|gametype|singles\n|gen|9\n|rule|OHKO Clause: OHKO moves are banned',
    })).toBe('gen9customgame');

    // A colon-less |rule| line is a pipeline watermark, not a ruleset —
    // the singles default still applies (GPL video reconstructions).
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: '|gametype|singles\n|gen|9\n|rule|Reconstructed from video by gpl-pipeline - best effort',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // NO rule lines at all (video pipelines): singles-standard default.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] Custom Game',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // …unless the log itself shows a second simultaneous sleep.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: [
        '|gametype|singles', '|gen|9', '|tier|[Gen 9] Custom Game',
        '|move|p1a: A|Spore|p2a: X', '|-status|p2a: X|slp',
        '|move|p1a: A|Spore|p2a: Y', '|-status|p2a: Y|slp',
      ].join('\n'),
    })).toBe('gen9customgame');

    // Rest sleeps never count against the clause detection.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: [
        '|gametype|singles', '|gen|9', '|tier|[Gen 9] Custom Game',
        '|move|p1a: A|Spore|p2a: X', '|-status|p2a: X|slp',
        '|move|p2a: Y|Rest|p2a: Y', '|-status|p2a: Y|slp|[from] move: Rest',
      ].join('\n'),
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // Real formats are their own rule authority and never get suffixed:
    // gen3ou carries the clause natively; gen9 OU bans sleep moves instead.
    expect(getBranchSimulatorFormat({
      id: 'gen9ou-123',
      log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU',
    })).toBe('gen9ou');
    expect(formatEnforcesSleepClause('gen3ou')).toBe(true);
    expect(formatEnforcesSleepClause('gen9ou')).toBe(false);
    expect(formatEnforcesSleepClause('gen9customgame')).toBe(false);
    expect(formatEnforcesSleepClause('gen9customgame@@@Sleep Clause Mod')).toBe(true);
  });

  // Round 89 (FB-1): a draft game that declares "Terastal Clause" ran as a Custom Game that offered Tera (forum replay
  // gen9natdexdraft-2713067801: "Tera (Psychic)" in the tray, Execute Turn terastallized). The clause rides the branch format like
  // Sleep Clause, in singles and in doubles; the simulator is the oracle for what the format then offers.
  describe('Terastal Clause from the log (round 89, FB-1)', () => {
    const rules = '|rule|Sleep Clause Mod: Limit one foe put to sleep\n|rule|Terastal Clause: You cannot Terastallize';
    const mon = {
      name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Hardy', gender: '', level: 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, teraType: 'Steel',
    };
    const offersTera = (formatid: string) => {
      const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team: [mon] }, p2: { name: 'B', team: [mon] } });
      return battle.sides[0].pokemon[0].canTerastallize !== null;
    };

    test('singles draft: the Custom Game carries both clauses, and the simulator offers no Tera', () => {
      const withClause = getBranchSimulatorFormat({ id: 'gen9natdexdraft-1', log: `|gametype|singles\n|gen|9\n${rules}` });
      expect(withClause).toBe('gen9customgame@@@Sleep Clause Mod,Terastal Clause');
      expect(offersTera(withClause)).toBe(false);
      // Without the line the same game keeps Tera (the control), and the clause alone rides without Sleep Clause.
      const without = getBranchSimulatorFormat({ id: 'gen9natdexdraft-2', log: '|gametype|singles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep' });
      expect(without).toBe('gen9customgame@@@Sleep Clause Mod');
      expect(offersTera(without)).toBe(true);
      expect(getBranchSimulatorFormat({ id: 'gen9natdexdraft-3', log: '|gametype|singles\n|gen|9\n|rule|Terastal Clause: You cannot Terastallize' }))
        .toBe('gen9customgame@@@Terastal Clause');
    });

    test('the forum replay itself (gen9natdexdraft-2713067801) declares the clause and reads as a Custom Game with both', () => {
      const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9natdexdraft-2713067801.json', import.meta.url), 'utf8')) as { id: string; log: string };
      expect(getBranchSimulatorFormat(replay)).toBe('gen9customgame@@@Sleep Clause Mod,Terastal Clause');
    });

    test('doubles draft: Doubles OU carries the clause, and the simulator offers no Tera', () => {
      const withClause = getBranchSimulatorFormat({ id: 'gen9natdexdraft-4', log: `|gametype|doubles\n|gen|9\n${rules}` });
      expect(withClause).toBe('gen9doublesou@@@Terastal Clause');
      expect(offersTera(withClause)).toBe(false);
      const without = getBranchSimulatorFormat({ id: 'gen9natdexdraft-5', log: '|gametype|doubles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep' });
      expect(without).toBe('gen9doublesou');
      expect(offersTera(without)).toBe(true);
    });

    test('a real singles format and a CRLF log keep their own reading', () => {
      expect(getBranchSimulatorFormat({ id: 'gen9ou-1', log: `|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n${rules}` })).toBe('gen9ou');
      expect(getBranchSimulatorFormat({ id: 'gen9natdexdraft-6', log: `|gametype|singles\r\n|gen|9\r\n${rules.replace(/\n/g, '\r\n')}` }))
        .toBe('gen9customgame@@@Sleep Clause Mod,Terastal Clause');
    });
  });

  // Round 65: the static weighs a replay by the tables of its rule set, named
  // from the replay's own format: Pokémon Champions (singles and doubles, on
  // the Champions mod since round 67), VGC outside Champions, and every other
  // format.
  test('a replay names its rule set from its own format', () => {
    expect(replayRuleset(vgcReplay)).toBe('champions');
    expect(replayRuleset({ id: 'gen9championsvgc2026regmabo3-2603652560', log: '|gametype|doubles\n|gen|9' })).toBe('champions');
    expect(replayRuleset({ id: 'gen9championsou-2695399689', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9 Champions] OU' })).toBe('champions');
    expect(replayRuleset({ id: 'gen9vgc2026regi-2630181744', log: '|gametype|doubles\n|gen|9\n|tier|[Gen 9] VGC 2026 Reg I' })).toBe('vgc');
    expect(replayRuleset({ id: 'gen9vgc2024regh-2160552710', log: '|gametype|doubles\n|gen|9' })).toBe('vgc');
    expect(replayRuleset({ id: 'gen9ou-123', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU' })).toBe('standard');
    expect(replayRuleset({ id: 'gen9doublesou-2663093831', log: '|gametype|doubles\n|gen|9\n|tier|[Gen 9] Doubles OU' })).toBe('standard');
  });

  // A private replay link carries a 31-character password as a `-{password}pw`
  // suffix on the id. The suffix belongs in the fetched id and nowhere else:
  // read as part of the format it produced `gen9ou2632003305e10u...pw`, so an
  // ordinary private OU replay branched as a rule-less custom game (G22).
  const privateId = 'gen9ou-2632003305-e10u50b7xrkmn0w7j5q2bac68relhlwpw';
  const privateLog = '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n|turn|1';

  test('splitReplayPassword parses the private-replay suffix (G22)', () => {
    expect(splitReplayPassword(privateId))
      .toEqual(['gen9ou-2632003305', 'e10u50b7xrkmn0w7j5q2bac68relhlw']);
    expect(splitReplayPassword('gen9ou-2632003305')).toEqual(['gen9ou-2632003305', null]);
    expect(splitReplayPassword('smogtours-gen3ou-56583')).toEqual(['smogtours-gen3ou-56583', null]);
  });

  test('a private replay id infers its real format, not its password (G22)', () => {
    expect(inferReplayFormatId({ id: privateId, log: privateLog })).toBe('gen9ou');
    expect(getBranchSimulatorFormat({ id: privateId, log: privateLog })).toBe('gen9ou');
  });
});
