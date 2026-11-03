/**
 * Round 84 (T315, A7c, ruling 10a): the replay document on a phone. Showdown's embed lays the battle out at 640 px (642 with its
 * border) with the log beside it, so a frame narrower than that showed the left 366 px of the battle at 390 px and cut the opponent's
 * side, the log and the Music control. Where the frame is narrower than the battle, the document shrinks the scene to the frame's
 * width (a transform; the negative margin below it lets the height follow), and the controls and the log stand under it at their
 * own size. The document decides by its own width, so the exported page behaves the same in a phone browser; the app follows the
 * document's height with `followContentHeight` (replay-frame-height.ts).
 */

/** The battle's box in the embed: 640 x 360 plus the 1 px border on each side. */
export const PHONE_BATTLE = { width: 642, height: 362 } as const;

/**
 * Round 84 (A7d): the scene is scaled to the frame's width less this inset. The e2e run of A7c read the scene's right edge 1.1 px past
 * the frame's (372.125 against 371) at 390 px: the width the document reports and the frame's box differ by a pixel or two (the
 * frame's fractional width against the document's whole one), so a scene fitted to the last pixel overshoots. Two pixels keep the
 * scene's 1 px border inside the frame's rounded corner at every width.
 */
export const PHONE_INSET = 2;

/** A frame narrower than this is a phone frame. */
export const PHONE_BREAKPOINT = PHONE_BATTLE.width;

/** The class the document's root takes in phone mode, and the property that holds the scene's scale. */
export const PHONE_CLASS = 'ps-phone';
export const PHONE_SCALE_PROPERTY = '--ps-k';

export const PHONE_STYLES = `<style>
html.${PHONE_CLASS} .wrapper.replay-wrapper{display:flex;flex-direction:column;padding-top:0 !important;margin-top:0;}
html.${PHONE_CLASS} .battle{position:relative;top:0;left:0;flex:none;transform:scale(var(${PHONE_SCALE_PROPERTY},1));transform-origin:0 0;margin-bottom:calc((var(${PHONE_SCALE_PROPERTY},1) - 1) * ${PHONE_BATTLE.height}px);}
html.${PHONE_CLASS} .replay-controls,html.${PHONE_CLASS} .replay-controls-2{position:static;top:auto;left:auto;right:auto;padding:6px 5px 0;}
html.${PHONE_CLASS} .replay-controls{order:1;}
html.${PHONE_CLASS} .replay-controls-2{order:2;}
html.${PHONE_CLASS} .battle-log{position:static;order:3;left:auto;right:auto;top:auto;width:auto;height:360px;box-sizing:border-box;margin:8px 0 0;}
</style>`;

/** Runs in the replay document: sets the class and the scale from the document's own width, now and on every resize. */
export const PHONE_FIT_SCRIPT = `<script>
(function () {
  if (typeof document === 'undefined' || !document.documentElement) return;
  var root = document.documentElement;
  function fit() {
    var width = root.clientWidth;
    var narrow = width > 0 && width < ${PHONE_BREAKPOINT};
    root.classList.toggle('${PHONE_CLASS}', narrow);
    root.style.setProperty('${PHONE_SCALE_PROPERTY}', narrow ? String((width - ${PHONE_INSET}) / ${PHONE_BATTLE.width}) : '1');
  }
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
  fit();
})();
</script>`;
