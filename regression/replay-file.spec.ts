import { test, expect } from '@playwright/test';
import { looksLikeReplayFileContent, parseExportedReplay } from '../src/lib/replay-file';

// Mirrors the structure of a real "Download replay" export from
// replay.pokemonshowdown.com: hidden replayid input plus a text/plain script
// holding the protocol log with `/` escaped as `\/`.
const exportedHtml = `<!DOCTYPE html>
<meta charset="utf-8" />
<!-- version 1 -->
<title>[Gen 9] Draft replay: Alpha vs. Beta</title>
<style>
html,body {font-family:Verdana, sans-serif;}
</style>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<input type="hidden" name="replayid" value="gen9draft-2513274807" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div>
<h1 style="font-weight:normal;text-align:center"><strong>[Gen 9] Draft</strong><br /><a href="http://pokemonshowdown.com/users/alpha" class="subtle" target="_blank">Alpha</a> vs. <a href="http://pokemonshowdown.com/users/beta" class="subtle" target="_blank">Beta</a></h1>
<script type="text/plain" class="battle-log-data">
|j|☆Alpha
|j|☆Beta
|t:|1767717812
|gametype|singles
|player|p1|Alpha|selene|
|player|p2|Beta|giovanni|
|gen|9
|tier|[Gen 9] Draft
|rule|Sleep Clause Mod: Limit one foe put to sleep
|raw|<div class="infobox"><details><summary><strong>Custom rules<\\/strong><\\/summary><\\/details><\\/div>
|clearpoke
|poke|p1|Deoxys-Speed|
|poke|p2|Jolteon, M|
|teampreview
|
|t:|1767717887
|start
|switch|p1a: Deoxys|Deoxys-Speed|100\\/100
|switch|p2a: Jolteon|Jolteon, M|100\\/100
|turn|1
</script>
`;

const rawLog = [
  '|j|PlayerOne',
  '|t:|1714577777',
  '|gametype|singles',
  '|player|p1|PlayerOne|101|',
  '|player|p2|PlayerTwo|li|',
  '|gen|3',
  '|tier|[Gen 3] Custom Game',
  '|start',
  '|switch|p1a: Metagross|Metagross|319/319',
  '|switch|p2a: Arcanine|Arcanine, M|341/341',
  '|turn|1',
].join('\n');

test.describe('exported replay file parsing', () => {
  test('parses a downloaded replay HTML export into ReplayData', () => {
    const replay = parseExportedReplay(exportedHtml, 'Gen9Draft-2026-01-06-alpha-beta.html');

    expect(replay.id).toBe('gen9draft-2513274807');
    expect(replay.players).toEqual(['Alpha', 'Beta']);
    expect(replay.format).toBe('[Gen 9] Draft');
    expect(replay.formatid).toBe('gen9draft');
    expect(replay.uploadtime).toBe(1767717812);
    // The export escapes `/` as `\/`; the parsed log must be unescaped.
    expect(replay.log).toContain('|switch|p1a: Deoxys|Deoxys-Speed|100/100');
    expect(replay.log).toContain('</strong></summary></details></div>');
    expect(replay.log).not.toContain('\\/');
    expect(replay.log.startsWith('|j|')).toBe(true);
  });

  test('derives the id from the file name when the export lacks a replayid', () => {
    const withoutId = exportedHtml.replace(/<input type="hidden"[^>]*\/>\n/, '');
    const replay = parseExportedReplay(withoutId, 'Gen9Draft-2026-01-06-alpha-beta.html');

    expect(replay.id).toBe('gen9draft-2026-01-06-alpha-beta');
    // A file-name id must never pollute format inference.
    expect(replay.formatid).toBe('gen9draft');
  });

  test('accepts a raw protocol log file', () => {
    const replay = parseExportedReplay(rawLog, 'Bene vs Roy.log');

    expect(replay.players).toEqual(['PlayerOne', 'PlayerTwo']);
    expect(replay.format).toBe('[Gen 3] Custom Game');
    expect(replay.formatid).toBe('gen3customgame');
    expect(replay.id).toBe('bene-vs-roy');
    expect(replay.log).toBe(rawLog);
  });

  test('rejects files that are neither replay exports nor protocol logs', () => {
    expect(() => parseExportedReplay('hello world', 'notes.txt'))
      .toThrow(/exported replay/i);
    expect(() => parseExportedReplay('<html><body>nothing here</body></html>', 'page.html'))
      .toThrow(/exported replay/i);
  });

  test('looksLikeReplayFileContent separates file content from replay ids', () => {
    expect(looksLikeReplayFileContent(exportedHtml)).toBe(true);
    expect(looksLikeReplayFileContent(rawLog)).toBe(true);

    expect(looksLikeReplayFileContent('gen9ou-123456')).toBe(false);
    expect(looksLikeReplayFileContent('https://replay.pokemonshowdown.com/gen9ou-123456')).toBe(false);
    expect(looksLikeReplayFileContent('')).toBe(false);
  });
});
