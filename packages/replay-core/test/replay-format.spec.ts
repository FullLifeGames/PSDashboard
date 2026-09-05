import { test, expect, describe } from 'vitest';
import {
  formatEnforcesSleepClause,
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

  test('maps custom VGC replay formats to a supported doubles simulator format', () => {
    expect(getBranchSimulatorFormat(vgcReplay)).toBe('gen9doublesou');
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
