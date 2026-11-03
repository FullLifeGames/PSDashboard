import { test } from '@playwright/test';
import { chromium, webkit, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';

/**
 * Round 84 (A7c, T315), item 1: how CSS `zoom` on the page's root behaves, in the browsers the tests run (Chromium, WebKit). A
 * probe, not a test: it runs only with PS_ZOOM_PROBE=1 and writes `test-results/zoom-probe-<browser>.json`. Each case sets `zoom: 1.5`
 * once on `html` and once on a wrapper div, and reads what the app depends on: viewport units, the geometry reads (rect, offset,
 * client, scroll, ResizeObserver), a fixed box, the nested replay frame (its viewport, its pixel ratio and its own boxes), the
 * media queries, and where a click lands on a range input and on an element that reads `clientX` against its rect.
 */
const ZOOM = 1.5;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; }
  #vh { height: 100vh; background: #234; }
  #vh-div { height: calc(100vh / ${ZOOM}); background: #432; }
  #box { width: 100px; height: 100px; background: #c33; }
  #scroller { width: 100px; height: 100px; overflow-y: auto; }
  #scroller > div { height: 300px; }
  #fixed { position: fixed; left: 0; bottom: 0; width: 60px; height: 50px; background: #3c3; }
  #range { width: 300px; display: block; }
  #bar { width: 400px; height: 20px; background: #888; }
  iframe { width: 400px; height: 300px; border: 0; display: block; }
</style></head><body><div id="host">
  <div id="vh"></div><div id="vh-div"></div><div id="box"></div>
  <div id="scroller"><div></div></div><div id="fixed"></div>
  <input id="range" type="range" min="0" max="100" value="0"><div id="bar"></div>
  <iframe id="frame" srcdoc="<!doctype html><html><body style='margin:0'><div id='inner' style='width:100px;height:100px'></div></body></html>"></iframe>
</div></body></html>`;

type Rect = { w: number; h: number; x: number; y: number };
const SCRIPT = `async (placement) => {
  const zoom = ${ZOOM};
  const target = placement === 'html' ? document.documentElement : document.getElementById('host');
  target.style.zoom = String(zoom);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top }; };
  const byId = (id) => document.getElementById(id);
  const out = { placement, zoom, innerWidth: innerWidth, innerHeight: innerHeight, devicePixelRatio, outerWidth };
  out.vh = { rect: rect(byId('vh')), offsetHeight: byId('vh').offsetHeight, clientHeight: byId('vh').clientHeight };
  out.vhDivided = { rect: rect(byId('vh-div')), offsetHeight: byId('vh-div').offsetHeight };
  const box = byId('box');
  out.box = { rect: rect(box), offsetWidth: box.offsetWidth, clientWidth: box.clientWidth, computedWidth: getComputedStyle(box).width };
  out.ro = await new Promise((resolve) => {
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      resolve({ contentRect: e.contentRect.width, borderBox: e.borderBoxSize[0].inlineSize, contentBox: e.contentBoxSize[0].inlineSize });
      ro.disconnect();
    });
    ro.observe(box);
  });
  const scroller = byId('scroller');
  scroller.scrollTop = 40;
  out.scroller = { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, offsetHeight: scroller.offsetHeight, scrollTopAfterSet40: scroller.scrollTop, rect: rect(scroller) };
  scroller.scrollTop = 99999;
  out.scroller.scrollTopAtEnd = scroller.scrollTop;
  out.fixed = { rect: rect(byId('fixed')), bottomGap: innerHeight - byId('fixed').getBoundingClientRect().bottom };
  out.mq = { max1050: matchMedia('(max-width: 1050px)').matches, widthPx: innerWidth, min1000: matchMedia('(min-width: 1000px)').matches };
  const frame = byId('frame');
  const win = frame.contentWindow;
  out.frame = {
    rect: rect(frame), offsetWidth: frame.offsetWidth, clientWidth: frame.clientWidth,
    inner: { innerWidth: win.innerWidth, innerHeight: win.innerHeight, devicePixelRatio: win.devicePixelRatio, docClientWidth: win.document.documentElement.clientWidth,
      box: (() => { const r = win.document.getElementById('inner').getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
      mq400: win.matchMedia('(min-width: 400px)').matches, mq300: win.matchMedia('(max-width: 300px)').matches },
  };
  const range = byId('range');
  const bar = byId('bar');
  window.__clicks = [];
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect();
    window.__clicks.push({ clientX: e.clientX, left: r.left, width: r.width, ratioFromRect: (e.clientX - r.left) / r.width, offsetX: e.offsetX, offsetWidth: bar.offsetWidth });
  });
  out.hit = (() => {
    const r = box.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { centerHitsBox: hit === box, hitId: hit && hit.id };
  })();
  out.rangeRect = rect(range);
  out.barRect = rect(bar);
  return out;
}`;

async function run(browser: Browser, placement: 'html' | 'wrapper'): Promise<unknown> {
  const page: Page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.setContent(PAGE);
  await page.waitForFunction(() => (document.getElementById('frame') as HTMLIFrameElement).contentDocument?.getElementById('inner'));
  const out = await page.evaluate(`(${SCRIPT})(${JSON.stringify(placement)})`) as { rangeRect: Rect; barRect: Rect };
  // A click at 75 % of the range's drawn width, and at 25 % of the bar's: what value and what ratio does the page read?
  const r = out.rangeRect;
  await page.mouse.click(r.x + r.w * 0.75, r.y + r.h / 2);
  const b = out.barRect;
  await page.mouse.click(b.x + b.w * 0.25, b.y + b.h / 2);
  const rangeValueAfter75 = await page.evaluate(() => Number((document.getElementById('range') as HTMLInputElement).value));
  const barClick = await page.evaluate('window.__clicks');
  const result = { ...out, rangeValueAfter75, barClick };
  await page.close();
  return result;
}

test('CSS zoom on the root: what the app reads (PS_ZOOM_PROBE=1)', async () => {
  test.skip(!process.env.PS_ZOOM_PROBE, 'a probe: set PS_ZOOM_PROBE=1');
  test.setTimeout(120_000);
  mkdirSync('test-results', { recursive: true });
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]] as const) {
    let report: unknown;
    try {
      const browser = await type.launch();
      try {
        report = { version: browser.version(), html: await run(browser, 'html'), wrapper: await run(browser, 'wrapper') };
      } finally {
        await browser.close();
      }
    } catch (error) {
      report = { error: String(error) };
    }
    writeFileSync(`test-results/zoom-probe-${name}.json`, JSON.stringify(report, null, 2));
  }
});
