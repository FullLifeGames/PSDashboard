import { test, expect, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  dockChip, fixturePath, installReplayEmbedCache, moveTimeline, pickMove, routeOfflineFixtures, type ReplayWindow,
} from './helpers';

test.beforeAll(installReplayEmbedCache);

// Round 88 (T348, #84): a replacement on both sides is an interlude, not a turn. Every pointer turn inside a variation shows the
// bodies the branch frame shows at that turn, offers Execute Turn, and asks for no replacement; the slider and the turn counts
// count real turns. The rows compare the dock with the frame and never name a species: T314 will change which bodies a play-out
// fields. Doubles: the replay of GitHub issue #4 (gen9vgc2025regg-2335527677), played out by the engine with Fast play-out (the
// run is deterministic: a replacement on one side after turns 2, 4 to 8 and on both sides after turn 3). Singles: a Gen 9 OU
// game whose turn 29 is a double knockout (Close Combat and poison, smogtours-gen9ou-752301), played by hand.
const DOUBLES = 'interlude-vgc-2335527677.json';
const SINGLES = 'interlude-singles-752301.json';

async function load(page: Page, file: string) {
  const replay = JSON.parse(readFileSync(fixturePath(file), 'utf-8')) as { id: string };
  await routeOfflineFixtures(page);
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: readFileSync(fixturePath(file), 'utf-8'),
  }));
  await page.goto('/');
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).first().click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 60_000 });
}

/** The slider: its turn and its length (the label reads "End" at the end position of an ended game, the input does not). */
async function slider(page: Page): Promise<{ turn: number; max: number }> {
  const input = page.locator('.ps-branch-bar input[type="range"]');
  return { turn: Number(await input.inputValue()), max: Number(await input.getAttribute('max')) };
}

interface FrameBody { name: string; species: string }
/** The bodies on the branch frame's field once it stands at `turn`: Showdown's own battle object, side by side. */
async function frameField(page: Page, turn: number): Promise<{ p1: (FrameBody | null)[]; p2: (FrameBody | null)[] }> {
  const handle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 60_000 });
  const frame: Frame = (await handle!.contentFrame())!;
  const read = () => frame.evaluate(() => {
    const battle = (window as ReplayWindow).Replays?.battle as unknown as {
      turn: number; seeking: number | null; sides: { active: ({ name: string; speciesForme: string } | null)[] }[];
    } | undefined;
    if (!battle) return null;
    const side = (index: number) => battle.sides[index].active.map(body => (body ? { name: body.name, species: body.speciesForme } : null));
    return { turn: battle.turn, seeking: battle.seeking, p1: side(0), p2: side(1) };
  });
  await expect.poll(async () => {
    const state = await read();
    return state && state.seeking === null ? state.turn : -1;
  }, { timeout: 30_000, intervals: [250] }).toBe(turn);
  const state = (await read())!;
  return { p1: state.p1, p2: state.p2 };
}

/** The bodies the dock names, by slot ("P1A Ursaluna · 38% ..."). */
async function dockField(page: Page): Promise<Record<string, string>> {
  const chips = await page.locator('.ps-dock-chip').evaluateAll(elements => elements.map(element => ({
    slot: element.getAttribute('data-chip') ?? '', text: (element as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
  })));
  const bodies: Record<string, string> = {};
  for (const { slot, text } of chips) bodies[slot] = /^P\d[AB]\s+(.+?)\s+·/.exec(text)?.[1] ?? text;
  return bodies;
}

/**
 * Pins the dock against the frame at the pointer turn: every active slot of the frame is the body its chip names, no chip asks
 * for a replacement (the position holds them), and Execute Turn stands.
 */
async function expectDockMatchesFrame(page: Page, turn: number, label: string) {
  await moveTimeline(page, turn);
  await expect(page.getByText(`T${turn}/`)).toBeVisible();
  const field = await frameField(page, turn);
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const dock = await dockField(page);
    const rows: string[] = [];
    (['p1', 'p2'] as const).forEach((side, sideIndex) => field[side].forEach((body, slot) => {
      const chip = dock[`p${sideIndex + 1}${slot}`];
      if (body === null || chip === undefined) return;
      if (!chip.includes(body.name) && !chip.includes(body.species)) rows.push(`${side}${slot}: the dock names ${chip}, the frame ${body.name}`);
    }));
    return rows;
  }, { message: `${label}: dock and frame bodies at T${turn}`, timeout: 30_000, intervals: [500] }).toEqual([]);
  await expect(page.locator('.ps-dock-chip[data-forced="true"]'), `${label}: no replacement asked at T${turn}`).toHaveCount(0);
  await expect(page.locator('.ps-force-switch-note'), `${label}: no replacement note at T${turn}`).toHaveCount(0);
  await expect(page.locator('.ps-execute-btn'), `${label}: Execute Turn at T${turn}`).toBeVisible();
}

test.describe('the dock on the inner turns of a variation with a replacement on both sides', () => {
  test('doubles: a play-out of the issue replay, every inner turn shows the frame\'s bodies and the counts read real turns', async ({ page }) => {
    test.setTimeout(420_000);
    await load(page, DOUBLES);
    await moveTimeline(page, 1);
    await expect(page.locator('.ps-dock-status')).toContainText('Choices from the reconstructed position', { timeout: 120_000 });
    await page.getByLabel('Fast play-out').check();
    await page.locator('button', { hasText: 'Let it play out' }).click();
    const notice = page.getByText(/Play-out (finished|stopped)/);
    await expect(notice).toBeVisible({ timeout: 360_000 });

    // The notice, the slider and the history count the same real turns.
    const played = Number(/after (\d+) turns?/.exec(await notice.innerText())?.[1] ?? -1);
    const { max } = await slider(page);
    expect(played, 'the turns the notice names').toBeGreaterThan(3);
    expect(max, 'the slider ends at the start turn plus the real turns').toBe(1 + played);
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText(`${played} turns`);
    // The premise: the run holds a replacement on both sides (an entry of kind turn that makes no turn).
    await page.getByRole('button', { name: /Variation moves/ }).click();
    await expect(page.getByText(/forced replacement \(both sides\)/).first()).toBeVisible();

    // The inner turns (the tip is the live position, which was always right).
    for (let turn = 2; turn < max; turn++) await expectDockMatchesFrame(page, turn, 'issue replay');
  });

  test('singles: a double knockout of Close Combat and poison, played by hand, keeps the inner turn right', async ({ page }) => {
    test.setTimeout(300_000);
    await load(page, SINGLES);
    // Turn 29: Close Combat takes the foe down and poison takes Iron Valiant down, so both sides choose a replacement.
    await moveTimeline(page, 29);
    await expect(page.getByText('T29/')).toBeVisible();
    await expect(page.locator('.ps-dock-status')).toContainText('Choices from the reconstructed position', { timeout: 120_000 });
    await pickMove(page, 'p1a', /Close Combat/);
    await pickMove(page, 'p2a');
    await page.locator('.ps-execute-btn').click();
    await expect(page.locator('.ps-dock-chip[data-forced="true"]:not([inert])')).toHaveCount(2, { timeout: 60_000 });
    // Both sides pick; the second pick sends the turn's replacements as one entry of kind turn.
    for (const side of ['p1a', 'p2a'] as const) {
      await dockChip(page, side).click();
      await page.locator('.ps-tray .ps-switchbtn:enabled').first().click();
    }
    await expect(page.locator('.ps-dock-chip[data-forced="true"]')).toHaveCount(0, { timeout: 60_000 });
    // One more real turn, so the position after the interlude is an inner turn.
    await pickMove(page, 'p1a');
    await pickMove(page, 'p2a');
    await page.locator('.ps-execute-btn').click();
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('2 turns', { timeout: 60_000 });
    expect(await slider(page)).toMatchObject({ max: 29 + 2 });

    await expectDockMatchesFrame(page, 30, 'singles double knockout');
  });
});
