// The embed shows its sound chooser with an inline `display`, so hiding it needs `!important`.

export const APP_CONTROLS_STYLES = `<style>
.replay-controls-2 .colorchooser,.replay-controls-2 .soundchooser{display:none !important;}
</style>`;

export function appControlsStyles(hide: boolean): string {
  return hide ? `${APP_CONTROLS_STYLES}\n` : '';
}

/** Reports the side the frame shows near (`battle.nearSide`) to the dock; empty when not reporting. */
// `?p2` lands a tick after `Replays.battle` exists: stay silent until the own side was seen, or the dock flips twice.
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
