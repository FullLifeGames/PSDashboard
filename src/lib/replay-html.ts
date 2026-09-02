/**
 * Generates a standalone PS replay HTML page from a battle log string.
 * The generated HTML loads replay-embed.js from play.pokemonshowdown.com
 * which handles all rendering, animations, and playback controls.
 */

const REPLAY_STYLES = `<style>
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
</style>`;

/** Mutes the embed before it loads: every media handle it can reach becomes a silent stub. */
const SILENT_AUDIO_SCRIPT = `<script>
window.Config = Object.assign({}, window.Config || {}, {sound: false, mute: true});
window.__psMakeSilentMedia = function makeSilentMediaHandle() {
  return {
    autoplay: false,
    loop: false,
    muted: true,
    paused: true,
    volume: 0,
    pause: function(){},
    play: function(){ return Promise.resolve(); },
    resume: function(){ return Promise.resolve(); },
    stop: function(){},
    destroy: function(){},
    setVolume: function(){},
    addEventListener: function(){},
    removeEventListener: function(){},
  };
};
window.__psPatchBattleSound = function patchBattleSound() {
  var makeSilent = window.__psMakeSilentMedia;
  var sound = (window.BattleSound && typeof window.BattleSound === 'object') ? window.BattleSound : {};
  sound.muted = true;
  sound.disabled = true;
  if (!sound.bgm || typeof sound.bgm !== 'object') sound.bgm = makeSilent();
  if (typeof sound.bgm.resume !== 'function') sound.bgm.resume = function(){ return Promise.resolve(); };
  sound.loadBgm = function(){ return makeSilent(); };
  sound.playBgm = function(){};
  sound.pauseBgm = function(){};
  sound.stopBgm = function(){};
  sound.setMute = function(){};
  sound.setVolume = function(){};
  window.BattleSound = sound;
};
window.__psPatchBattleSound();
window.Audio = function SilentAudio() {
  return window.__psMakeSilentMedia();
};
if (window.HTMLMediaElement && window.HTMLMediaElement.prototype) {
  window.HTMLMediaElement.prototype.play = function silentPlay() {
    this.muted = true;
    this.pause();
    return Promise.resolve();
  };
}
</script>`;

const EMBED_LOADER_SCRIPT = `<script>
let daily = Math.floor(Date.now()/1000/60/60/24);
document.write('<script src="https://play.pokemonshowdown.com/js/replay-embed.js?version'+daily+'"></'+'script>');
</script>`;

/** The parent bridge: seek and append messages in, ready and turn reports out. */
const REPLAY_BRIDGE_BODY = `
  function silenceAudio() {
    window.Config = Object.assign({}, window.Config || {}, {sound: false, mute: true});
    if (window.__psPatchBattleSound) window.__psPatchBattleSound();
    if (typeof Replays !== 'undefined' && Replays.battle && Replays.battle.sound) {
      Replays.battle.sound.muted = true;
      if (Replays.battle.sound.pause) Replays.battle.sound.pause();
    }
    if (typeof Replays !== 'undefined' && Replays.battle && Replays.battle.scene && Replays.battle.scene.bgm) {
      Replays.battle.scene.bgm.muted = true;
      if (Replays.battle.scene.bgm.pause) Replays.battle.scene.bgm.pause();
    }
  }

  function applyViewpoint() {
    if (!pendingViewpoint) return;
    if (typeof Replays === 'undefined' || !Replays.battle) return;
    Replays.battle.setViewpoint(pendingViewpoint);
    pendingViewpoint = null;
  }

  function waitSeekEnd(battle) {
    if (battle.seeking === null) {
      battle.play();
      silenceAudio();
      return;
    }
    setTimeout(function() { waitSeekEnd(battle); }, 100);
  }

  function applySeek() {
    silenceAudio();
    if (!pendingSeek) return;
    if (typeof Replays === 'undefined' || !Replays.battle) {
      setTimeout(applySeek, 150);
      return;
    }
    applyViewpoint();
    var battle = Replays.battle;
    var seek = pendingSeek;
    pendingSeek = null;
    // Parent-side retries land here after the seek finished — or while the
    // very same seek is still scrubbing: nothing to do either way.
    if (battle.seeking === null && battle.turn === seek.turn && !seek.autoPlay) return;
    if (battle.seeking !== null && battle.seeking === seek.turn && !seek.autoPlay) return;
    // Same for play-seeks: a retry while the battle already plays at/past the
    // requested turn (or is still scrubbing toward it — the first application
    // armed waitSeekEnd) would restart playback mid-watch.
    if (seek.autoPlay && !battle.paused && battle.seeking === null && battle.turn >= seek.turn) return;
    if (seek.autoPlay && battle.seeking !== null && battle.seeking === seek.turn) return;
    // The native "Go to turn" flow: establish the rest state BEFORE the
    // seek and never touch playback after it. battle.js fast-forwards long
    // jumps in >300ms chunks chained via setTimeout, and each continuation
    // runs only while scene.interruptionCount is unchanged — scene.pause()
    // bumps that counter, so the old post-seek pause() froze the chain and
    // left the embed on its "seeking..." overlay forever.
    if (!seek.autoPlay && !battle.paused) battle.pause();
    battle.seekTurn(seek.turn);
    if (seek.autoPlay) waitSeekEnd(battle);
  }

  function queueSeek(turn, shouldPlay) {
    pendingSeek = { turn: turn, autoPlay: !!shouldPlay };
    applySeek();
  }

  function appendLogLines(lines) {
    if (!Array.isArray(lines)) return false;
    if (typeof Replays === 'undefined' || !Replays.battle) return false;
    lines.forEach(function(line) {
      if (line) Replays.battle.add(line);
    });
    silenceAudio();
    return true;
  }

  function appendAndFollow(data) {
    if (!appendLogLines(data.lines)) {
      setTimeout(function() { appendAndFollow(data); }, 150);
      return;
    }
    if (typeof data.playFromTurn === 'number') {
      queueSeek(data.playFromTurn, true);
    } else if (data.followEnd) {
      queueSeek(Infinity, false);
    } else if (typeof data.seekTurn === 'number') {
      queueSeek(data.seekTurn, false);
    }
  }

  window.addEventListener('message', function(event) {
    var data = event.data || {};
    if (data.type === 'ps-seek-turn' && typeof data.turn === 'number') {
      queueSeek(data.turn, !!data.autoPlay);
    } else if (data.type === 'ps-append-log') {
      appendAndFollow(data);
    }
  });

  setInterval(silenceAudio, 500);
  applySeek();
  (function notifyReady() {
    silenceAudio();
    if (typeof Replays === 'undefined' || !Replays.battle) {
      setTimeout(notifyReady, 150);
      return;
    }
    applyViewpoint();
    parent.postMessage({ type: 'ps-replay-ready' }, '*');
    applySeek();
  })();
})();
</script>`;

function replayBridgeScript(seekTurn: number | undefined, autoPlay: boolean, viewpoint: 'p1' | 'p2'): string {
  const pendingSeek = seekTurn != null ? `{ turn: ${seekTurn}, autoPlay: ${autoPlay ? 'true' : 'false'} }` : 'null';
  const pendingViewpoint = viewpoint === 'p2' ? "'p2'" : 'null';
  return `<script>
(function replayBridge() {
  var pendingSeek = ${pendingSeek};
  var pendingViewpoint = ${pendingViewpoint};
${REPLAY_BRIDGE_BODY}`;
}

/** Reports landed turns to the parent (never mid-seek scrub positions). */
const TURN_TRACKER_SCRIPT = `
<script>
(function trackTurn() {
  var lastTurn = -1;
  setInterval(function() {
    if (typeof Replays === 'undefined' || !Replays.battle) {
      return;
    }
    // Mid-seek turns are transient scrub positions, not the viewer's turn.
    // Reporting them lets the parent echo a STALE turn back as a fresh seek
    // (turn <= current resets the whole scrub), which self-sustains into an
    // endless reset loop on any jump longer than one tracker tick — the
    // permanent "seeking..." freeze. Report only landed turns.
    if (Replays.battle.seeking !== null) return;
    var t = Replays.battle.turn;
    if (t !== lastTurn) {
      lastTurn = t;
      parent.postMessage({ type: 'ps-turn', turn: t }, '*');
    }
  }, 200);
})();
</script>`;

export function generateReplayHtml(opts: {
  log: string;
  format?: string;
  p1?: string;
  p2?: string;
  title?: string;
  seekTurn?: number;
  autoPlay?: boolean;
  reportTurn?: boolean;
  /** Viewer perspective — 'p2' renders the battle from player 2's side (the ?p2 replay-URL flag). */
  viewpoint?: 'p1' | 'p2';
}): string {
  const { log, format = '', p1 = 'Player 1', p2 = 'Player 2', title, seekTurn, autoPlay = false, reportTurn = false, viewpoint = 'p1' } = opts;
  const displayTitle = title || `${format ? `[${format}] ` : ''}${p1} vs. ${p2}`;
  // Escape forward slashes for the script tag content (PS format)
  const escapedLog = log.replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<meta charset="utf-8" />
<title>${displayTitle}</title>
${REPLAY_STYLES}
${SILENT_AUDIO_SCRIPT}
<div class="wrapper replay-wrapper">
<input type="hidden" name="replayid" value="branch-sim" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<h1 style="font-weight:normal;text-align:center"><strong>${displayTitle}</strong></h1>
<script type="text/plain" class="battle-log-data">
${escapedLog}
</script>
</div>
${EMBED_LOADER_SCRIPT}
${replayBridgeScript(seekTurn, autoPlay, viewpoint)}${reportTurn ? TURN_TRACKER_SCRIPT : ''}`;
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
