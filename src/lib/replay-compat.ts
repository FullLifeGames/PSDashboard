/**
 * Compatibility patches for the Showdown embed document: keeps upstream
 * client behavior intact while silencing the console noise its assets and
 * legacy API reads produce in the host browser.
 */

/**
 * The upstream fontawesome-webfont.woff2 (FA 4.7) stores stale glyph
 * bounding boxes, and Firefox's font sanitizer logs one "Glyph bbox was
 * incorrect; adjusting" warning per affected glyph — the replay controls
 * (play, forward, backward) are among them. This face carries the same
 * family/weight/style as the one in font-awesome.css, and for duplicate
 * @font-face descriptors the later rule wins: the embed appends its
 * stylesheets to <head>, so a rule in the body always cascades after
 * them, and the upstream woff2 is never fetched.
 */
export function fontAwesomeOverrideStyle(woff2Url: string): string {
  const url = woff2Url.replace(/'/g, '%27');
  return `<style>
@font-face {
  font-family: 'FontAwesome';
  src: url('${url}') format('woff2');
  font-weight: normal;
  font-style: normal;
}
</style>`;
}

/** The repaired copy of the embed's icon font served from public/. */
export function localFontAwesomeUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return new URL('fonts/fontawesome-webfont.woff2', document.baseURI).href;
}

/**
 * replay-embed.js appends its sixteen dependencies to <head> as dynamic
 * scripts, and a dynamic script runs as soon as it arrives. graphics.js
 * extends $.easing at load time: when jQuery arrives later, graphics.js
 * stops halfway, BattleBackdrops stays undefined, and the battle never
 * builds (round 77, an empty frame on a cold first load). A dynamic script
 * with async = false runs in the order it was appended, the order the embed
 * lists them; the downloads still run in parallel. Must run before the
 * embed loader; left alone where no document head exists.
 */
export const EMBED_SCRIPT_ORDER_SCRIPT = `<script>
(function () {
  var head = window.document && document.head;
  if (!head) return;
  var append = head.appendChild;
  head.appendChild = function (node) {
    if (node && node.tagName === 'SCRIPT' && node.src) node.async = false;
    return append.call(head, node);
  };
})();
</script>`;

/**
 * battle-tooltips.ts reads MouseEvent.mozInputSource on every hover (its
 * guard against Firefox firing mouseover for a stray tap), and Firefox
 * logs a deprecation for each page that touches the native accessor.
 * Replacing the accessor keeps the guard's meaning — touch stays 5 — while
 * the deprecated getter is never invoked. Compat mouseover events are
 * plain MouseEvents, so the source is remembered from the pointerover
 * that precedes them. Left alone on platforms without the property.
 */
export const POINTER_SOURCE_SHIM_SCRIPT = `<script>
(function () {
  var proto = window.MouseEvent && window.MouseEvent.prototype;
  if (!proto || !('mozInputSource' in proto)) return;
  var desc = Object.getOwnPropertyDescriptor(proto, 'mozInputSource');
  if (!desc || !desc.configurable) return;
  var lastPointerType = '';
  window.addEventListener('pointerover', function (event) {
    lastPointerType = event.pointerType || '';
  }, true);
  Object.defineProperty(proto, 'mozInputSource', {
    configurable: true,
    get: function () {
      var type = this.pointerType || lastPointerType;
      if (type === 'touch') return 5;
      if (type === 'pen') return 2;
      return 1;
    },
  });
})();
</script>`;
