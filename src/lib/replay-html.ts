/**
 * Generates a standalone PS replay HTML page from a battle log string.
 * The generated HTML loads replay-embed.js from play.pokemonshowdown.com
 * which handles all rendering, animations, and playback controls.
 */

export function generateReplayHtml(opts: {
  log: string;
  format?: string;
  p1?: string;
  p2?: string;
  title?: string;
  seekTurn?: number;
  autoPlay?: boolean;
}): string {
  const { log, format = '', p1 = 'Player 1', p2 = 'Player 2', title, seekTurn, autoPlay = true } = opts;
  const displayTitle = title || `${format ? `[${format}] ` : ''}${p1} vs. ${p2}`;
  // Escape forward slashes for the script tag content (PS format)
  const escapedLog = log.replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<meta charset="utf-8" />
<title>${displayTitle}</title>
<style>
html,body {font-family:Verdana, sans-serif;font-size:10pt;margin:0;padding:0;}
body{padding:12px 0;background:#344b6c;}
.battle-log {font-family:Verdana, sans-serif;font-size:10pt;}
.battle-log-inline {border:1px solid #AAAAAA;background:#EEF2F5;color:black;max-width:640px;margin:0 auto 80px;padding-bottom:5px;}
.battle-log .inner {padding:4px 8px 0px 8px;}
.battle-log .inner-preempt {padding:0 8px 4px 8px;}
.battle-log .inner-after {margin-top:0.5em;}
.battle-log h2 {margin:0.5em -8px;padding:4px 8px;border:1px solid #AAAAAA;background:#E0E7EA;border-left:0;border-right:0;font-family:Verdana, sans-serif;font-size:13pt;}
.battle-log .chat {vertical-align:middle;padding:3px 0 3px 0;font-size:8pt;}
.battle-log .chat strong {color:#40576A;}
.battle-log .chat em {padding:1px 4px 1px 3px;color:#000000;font-style:normal;}
.spacer {margin-top:0.5em;}
.subtle {color:#3A4A66;}
.wrapper {max-width:1180px;margin:0 auto;}
</style>
<div class="wrapper replay-wrapper">
<input type="hidden" name="replayid" value="branch-sim" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<h1 style="font-weight:normal;text-align:center"><strong>${displayTitle}</strong></h1>
<script type="text/plain" class="battle-log-data">
${escapedLog}
</script>
</div>
<script>
let daily = Math.floor(Date.now()/1000/60/60/24);
document.write('<script src="https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'"></'+'script>');
</script>${seekTurn != null ? `
<script>
(function autoSeek() {
  if (typeof Replays === 'undefined' || !Replays.battle) {
    setTimeout(autoSeek, 150);
    return;
  }
  Replays.battle.seekTurn(${seekTurn});
  ${autoPlay ? 'Replays.battle.play();' : 'Replays.battle.pause();'}
})();
</script>` : ''}`;
}

/**
 * Creates a blob URL from HTML content for use in iframes.
 */
export function createBlobUrl(html: string): string {
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

/**
 * Revokes a previously created blob URL.
 */
export function revokeBlobUrl(url: string): void {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}
