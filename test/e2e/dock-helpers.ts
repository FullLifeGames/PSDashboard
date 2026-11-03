import { expect, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { dockChip, dockTray, expectReplaySettled, waitForExactPickers, type DockSlotKey } from './helpers';

/**
 * Round 84 (turn dock), step A6c: what the dock's task specs share. A click counter (the spec holds each task to the clicks the
 * spec names), the layout rules that hold throughout, the chip boxes, the engine gate that holds the evaluation workers' messages
 * until the spec lets them go, and the reader of a logged turn that the seeded Execute is compared with.
 */

/** Counts the clicks of a task. Loading the fixture, waiting for the exact pickers and reading do not count; typing into a field does not either. */
export class Clicks {
  count = 0;

  async click(target: Locator): Promise<void> {
    await target.click();
    this.count += 1;
  }
}

/** The viewport the tasks are counted at (the spec's success criteria: 1366 x 768). */
export const TASK_VIEWPORT = { width: 1366, height: 768 };

/** Loads a dock fixture by its id and waits for the exact pickers at `turn`. */
export async function loadDockReplay(page: Page, id: string, turn: number): Promise<void> {
  await page.locator('input[type="text"]').fill(id);
  await page.locator('button', { hasText: 'Load' }).click();
  await waitForExactPickers(page, turn);
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 30_000 });
}

const replayFrame = (page: Page): Locator => page.locator('.ps-iframe-wrap iframe').first();

/**
 * The layout rules that hold at every moment of a task at 1366 x 768: the left column never scrolls, the replay frame keeps its
 * 456 px, an open tray stays at 256 px with the dice closed (at 560 px with "Dice · What if" open), and a closed tray leaves the
 * frame in the viewport with the frame, not the dock, under its centre.
 */
export async function expectDockLayout(page: Page): Promise<void> {
  expect(await page.locator('.ps-main-left').evaluate(element => element.scrollTop), 'scrollTop of .ps-main-left').toBe(0);
  const box = (await replayFrame(page).boundingBox())!;
  expect(Math.round(box.height), 'height of the replay frame').toBe(456);
  const tray = dockTray(page);
  if (await tray.count() > 0) {
    const more = await tray.getByRole('button', { name: /Dice · What if/ }).getAttribute('aria-expanded');
    expect((await tray.boundingBox())!.height, 'height of the open tray').toBeLessThanOrEqual((more === 'true' ? 560 : 256) + 1);
    return;
  }
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(under, 'the element under the frame\'s centre').toBe('IFRAME');
}

export interface Box { x: number; y: number; width: number; height: number }

/** The boxes of the dock's chips, by slot. */
export async function chipBoxes(page: Page, slots: DockSlotKey[]): Promise<Record<string, Box>> {
  const boxes: Record<string, Box> = {};
  for (const slot of slots) boxes[slot] = (await dockChip(page, slot).boundingBox())!;
  return boxes;
}

/** No chip moved or changed its size (half a pixel of rounding is allowed). */
export function expectSameBoxes(actual: Record<string, Box>, expected: Record<string, Box>, when: string): void {
  for (const [slot, box] of Object.entries(expected)) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(actual[slot][key] - box[key]), `${when}: ${slot} ${key}`).toBeLessThanOrEqual(0.5);
    }
  }
}

/** The slots a game type has. */
export const DOUBLES_SLOTS: DockSlotKey[] = ['p1a', 'p1b', 'p2a', 'p2b'];

export interface EvalGate { hold(): void; release(): void; held(): number }
type GateWindow = Window & { __evalGate?: EvalGate };

/**
 * Wraps the evaluation pool's workers (the pool and the replay-jobs worker run one script, `eval-worker`; the replay-jobs worker
 * is left alone) so that a spec can hold their messages: while the gate holds, `postMessage` queues, and `release` sends the
 * queue in order. No production code is involved; Playwright's init script runs before the page's own. Call it before `page.goto`.
 */
export async function installEvalGate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const gated = new WeakSet<object>();
    const queue: Array<() => void> = [];
    let holding = false;
    const NativeWorker = window.Worker;
    const nativePost = NativeWorker.prototype.postMessage;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        const worker = Reflect.construct(target, args) as Worker;
        // The replay-jobs worker (reconstruction, spread solving) runs the same script; its jobs stay free, so a held evaluation
        // still gets its position and Execute still rebuilds. Only the pool of `lib/eval/worker-client` is gated.
        if (String(args[0]).includes('eval-worker') && !String(new Error().stack).includes('replay-jobs')) gated.add(worker);
        return worker;
      },
    });
    NativeWorker.prototype.postMessage = function postMessage(this: Worker, ...args: unknown[]) {
      const send = () => nativePost.apply(this, args as Parameters<Worker['postMessage']>);
      if (holding && gated.has(this)) queue.push(send);
      else send();
    } as Worker['postMessage'];
    (window as GateWindow).__evalGate = {
      hold: () => { holding = true; },
      release: () => {
        holding = false;
        for (const send of queue.splice(0)) send();
      },
      held: () => queue.length,
    };
  });
}

export const holdEval = (page: Page) => page.evaluate(() => (window as GateWindow).__evalGate?.hold());
export const releaseEval = (page: Page) => page.evaluate(() => (window as GateWindow).__evalGate?.release());
export const heldEvalMessages = (page: Page): Promise<number> => page.evaluate(() => (window as GateWindow).__evalGate?.held() ?? -1);

/** Light evaluation settings, as `eval.spec` sets them: a 2-worker pool, depth 1, one sample, no auto. Call it before `page.goto`. */
export async function lightEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
  });
}

/** What the log shows one slot doing in a turn. */
export interface LoggedAction {
  slot: DockSlotKey;
  kind: 'move' | 'switch';
  /** The move, or the species the slot switched to. */
  name: string;
  /** The slot a single-target move names, when it is another slot's; null for a self-target, a spread move or no target. */
  target: DockSlotKey | null;
  tera: boolean;
  mega: boolean;
}

const SLOT = /^(p[12])([ab])/;
const asSlot = (ref: string | undefined): DockSlotKey | null => {
  const match = SLOT.exec(ref ?? '');
  return match ? `${match[1]}${match[2]}` as DockSlotKey : null;
};

/** The actions of the active slots in one turn of a log (the lines after `|turn|N`), read apart from the app: a slot that only flinched, was blocked or fainted before it moved has none. */
export function loggedTurn(replay: ReplayData, turn: number): LoggedAction[] {
  const lines = replay.log.split('\n');
  const start = lines.findIndex(line => line === `|turn|${turn}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('|turn|'));
  const doubles = replay.log.includes('|gametype|doubles');
  const actions = new Map<DockSlotKey, LoggedAction>();
  const fainted = new Set<DockSlotKey>();
  const gimmick = new Map<DockSlotKey, 'tera' | 'mega'>();
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const parts = line.split('|');
    const slot = asSlot(parts[2]);
    if (!slot) continue;
    if (parts[1] === 'faint') fainted.add(slot);
    else if (parts[1] === '-terastallize') gimmick.set(slot, 'tera');
    else if (parts[1] === '-mega') gimmick.set(slot, 'mega');
    else if (actions.has(slot) || fainted.has(slot)) continue;
    else if (parts[1] === 'move' && !line.includes('[from]')) {
      const target = asSlot(parts[4]);
      // A singles move names no target on its chip; a spread move takes none; a move on its own slot is a self-target.
      const single = doubles && target !== null && target !== slot && !line.includes('[spread]');
      actions.set(slot, { slot, kind: 'move', name: parts[3], target: single ? target : null, tera: gimmick.get(slot) === 'tera', mega: gimmick.get(slot) === 'mega' });
    } else if (parts[1] === 'switch' && !line.includes('[from]')) {
      actions.set(slot, { slot, kind: 'switch', name: parts[3].split(',')[0], target: null, tera: false, mega: false });
    }
  }
  return [...actions.values()];
}

/** The slots that were active at the start of the turn and acted: every one of them, or the turn does not belong to the seeded-Execute checks. */
export function expectEverySlotActed(actions: LoggedAction[], slots: DockSlotKey[], where: string): void {
  expect(actions.map(action => action.slot).sort(), `${where}: slots with a logged action`).toEqual([...slots].sort());
}

/** The chips of the dock read the logged turn: the move or the body, the target label of a single-target move, and the gimmick. Each slot is marked as the played choice. */
export async function expectChipsShowLoggedTurn(page: Page, actions: LoggedAction[]): Promise<void> {
  for (const action of actions) {
    const chip = dockChip(page, action.slot);
    await expect(chip, `${action.slot} chip`).toContainText(action.kind === 'switch' ? `→ ${action.name}` : action.name);
    if (action.target) await expect(chip, `${action.slot} target`).toContainText(`→ ${action.target.toUpperCase()}`);
    if (action.tera) await expect(chip, `${action.slot} Tera`).toContainText('· Tera');
    if (action.mega) await expect(chip, `${action.slot} Mega`).toContainText('· Mega');
    await expect(chip, `${action.slot} origin`).toHaveAttribute('data-origin', 'played');
  }
}

/** The log lines the branch frame shows, once the frame has played everything it holds. */
export async function branchFrameEntries(page: Page): Promise<() => Promise<string[]>> {
  const frame = await (await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 30_000 }))?.contentFrame();
  expect(frame).toBeTruthy();
  await expectReplaySettled(frame!);
  return () => frame!.evaluate(() => [...document.querySelectorAll('.battle-log .battle-history')].map(entry => entry.textContent ?? ''));
}

/** The history panel of a variation. */
export const variationPanel = (page: Page): Locator => page.locator('.ps-panel', { hasText: 'Variation moves' });

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Criterion 5: after Execute without a change, the history row names what the log shows (moves, bodies switched to, "(Tera)" and
 * "(Mega)"), and the branch frame played the moves: each move shows at least as often as the log shows it up to the end of the
 * turn (the frame's log starts with the same turns).
 */
export async function expectExecutedLoggedTurn(page: Page, replay: ReplayData, turn: number, actions: LoggedAction[]): Promise<void> {
  await expect(variationPanel(page)).toContainText(`Turn ${turn}`, { timeout: 90_000 });
  for (const action of actions) {
    await expect(variationPanel(page), `${action.slot} in the history row`).toContainText(action.kind === 'switch' ? `→ ${action.name}` : action.name);
  }
  const tera = actions.filter(action => action.tera).length;
  const mega = actions.filter(action => action.mega).length;
  if (tera > 0) await expect(variationPanel(page)).toContainText('(Tera)');
  if (mega > 0) await expect(variationPanel(page)).toContainText('(Mega)');

  const entries = await branchFrameEntries(page);
  const logLines = replay.log.split('\n');
  const through = logLines.findIndex(line => line === `|turn|${turn + 1}`);
  const played = logLines.slice(0, through < 0 ? undefined : through);
  for (const action of actions.filter(item => item.kind === 'move')) {
    const wanted = played.filter(line => line.startsWith('|move|') && line.split('|')[3] === action.name && !line.includes('[still]')).length;
    const used = new RegExp(`used ${escapeRegExp(action.name)}!`);
    await expect.poll(async () => (await entries()).filter(entry => used.test(entry)).length, { message: `"used ${action.name}!" in the frame`, timeout: 60_000 })
      .toBeGreaterThanOrEqual(wanted);
  }
  if (tera > 0) await expect.poll(async () => (await entries()).filter(entry => /terastallized/i.test(entry)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(tera);
  if (mega > 0) await expect.poll(async () => (await entries()).filter(entry => /Mega Evolved/i.test(entry)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(mega);
}

const resizeLoops = new WeakMap<Page, string[]>();

/**
 * Round 84 (A7d): a spec that calls this fails when its page raises "ResizeObserver loop completed with undelivered notifications".
 * The A7c run raised it 15 times in 19 tests and nothing failed, because the browser reports it as an uncaught error that no
 * assertion read. Call it once at the top of the spec file, with the file's `test`.
 */
export function failOnResizeLoops(spec: typeof import('@playwright/test').test): void {
  spec.beforeEach(({ page }) => {
    const found: string[] = [];
    resizeLoops.set(page, found);
    page.on('pageerror', error => {
      if (/ResizeObserver loop/.test(error.message)) found.push(error.message);
    });
  });
  spec.afterEach(({ page }) => {
    expect(resizeLoops.get(page) ?? [], 'ResizeObserver loop errors raised by the page').toEqual([]);
  });
}
