
/** A later @font-face of the family replaces FA 4.7's woff2, whose stale glyph boxes make Firefox warn per glyph. */
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

export function localFontAwesomeUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return new URL('fonts/fontawesome-webfont.woff2', document.baseURI).href;
}

/** Runs before the embed loader: async = false keeps its scripts in order (graphics.js before jQuery: no battle). */
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

/** Replaces the deprecated mozInputSource accessor; compat mouseovers get the source of the pointerover before them. */
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
