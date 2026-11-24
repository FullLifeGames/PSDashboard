
/** The battle's box in the embed: 640 x 360 plus the 1 px border on each side. */
export const PHONE_BATTLE = { width: 642, height: 362 } as const;

export const PHONE_BREAKPOINT = PHONE_BATTLE.width;

export const PHONE_CLASS = 'ps-phone';
export const PHONE_SCALE_PROPERTY = '--ps-k';

// Battle.onResize (battle.js) writes an inline transform and margin-bottom under 640 px; an inline style beats a plain
// rule, so the two declarations below carry !important and `--ps-k` decides.
export const PHONE_STYLES = `<style>
html.${PHONE_CLASS} .wrapper.replay-wrapper{display:flex;flex-direction:column;padding-top:0 !important;margin-top:0;}
html.${PHONE_CLASS} .battle{position:relative;top:0;left:0;flex:none;transform:scale(var(${PHONE_SCALE_PROPERTY},1)) !important;transform-origin:0 0;margin-bottom:calc((var(${PHONE_SCALE_PROPERTY},1) - 1) * ${PHONE_BATTLE.height}px) !important;}
html.${PHONE_CLASS} .replay-controls,html.${PHONE_CLASS} .replay-controls-2{position:static;top:auto;left:auto;right:auto;padding:6px 5px 0;}
html.${PHONE_CLASS} .replay-controls{order:1;}
html.${PHONE_CLASS} .replay-controls-2{order:2;}
html.${PHONE_CLASS} .battle-log{position:static;order:3;left:auto;right:auto;top:auto;width:auto;height:360px;box-sizing:border-box;margin:8px 0 0;}
</style>`;

export const PHONE_FIT_SCRIPT = `<script>
(function () {
  if (typeof document === 'undefined' || !document.documentElement) return;
  var root = document.documentElement;
  function fit() {
    var width = root.clientWidth;
    var narrow = width > 0 && width < ${PHONE_BREAKPOINT};
    root.classList.toggle('${PHONE_CLASS}', narrow);
    root.style.setProperty('${PHONE_SCALE_PROPERTY}', narrow ? String(width / ${PHONE_BATTLE.width}) : '1');
  }
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
  fit();
})();
</script>`;
