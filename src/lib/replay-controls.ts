/**
 * Round 88 (T316, #56): the controls of the workspace's replay frames. Color scheme and Music go (Music does nothing in our frame,
 * which silences every sound, and the OS setting picks light or dark). Play, Last turn, Next turn, Go to turn..., Reset, Speed and
 * Switch sides stay; T316 had hidden the three turn buttons, and the gate of 08.11.2026 brought them back. The embed shows its sound
 * chooser with an inline `display`, so the rule needs `!important`.
 */

/** The style of a frame that hides the two choosers (`hideChoosers`). */
export const APP_CONTROLS_STYLES = `<style>
.replay-controls-2 .colorchooser,.replay-controls-2 .soundchooser{display:none !important;}
</style>`;

/** The style of a frame that hides the two choosers, with its line break; empty for the other frames. */
export function appControlsStyles(hide: boolean): string {
  return hide ? `${APP_CONTROLS_STYLES}\n` : '';
}

/**
 * Reports the side the frame shows near (`battle.nearSide`, set by Switch sides and by the `?p2` flag) to the app, which puts that
 * side's dock row on top. It reads state and counts no clicks, so a new document reports its own side. The bridge applies `?p2` a
 * tick after `Replays.battle` exists, so the tracker stays silent until it has seen the document's own side once: a p2 document
 * would otherwise report p1 first and the dock would flip twice. Empty when the frame reports nothing.
 */
export function sideTrackerScript(report: boolean, viewpoint: 'p1' | 'p2'): string {
  if (!report) return '';
  return `
<script>
(function trackSide() {
  var ownSide = '${viewpoint}';
  var seenOwn = false;
  var lastSide = null;
  setInterval(function() {
    if (typeof Replays === 'undefined' || !Replays.battle || !Replays.battle.nearSide) return;
    var side = Replays.battle.nearSide.sideid;
    if (side !== 'p1' && side !== 'p2') return;
    if (!seenOwn) {
      if (side !== ownSide) return;
      seenOwn = true;
    }
    if (side !== lastSide) {
      lastSide = side;
      parent.postMessage({ type: 'ps-side', side: side }, '*');
    }
  }, 200);
})();
</script>`;
}
