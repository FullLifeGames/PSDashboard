import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PokemonSet } from '@pkmn/sim';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { AppController } from '../../../src/hooks/useAppController';
import { buildReplayTeams } from '../../../src/lib/eval-acquire';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
// The App owns its controller; the wrapper keeps the newest one so the test can read the settled state.
const captured = vi.hoisted(() => ({ app: null as unknown }));
vi.mock('../../../src/hooks/useAppController', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/hooks/useAppController')>();
  return { ...actual, useAppController: () => { const app = actual.useAppController(); captured.app = app; return app; } };
});
// The legal move pool is heavy dex data the what-if row loads lazily; a fixed pool keeps the workspace render cheap.
// The editor's pools read the rest of the module (prepareFormat), so the mock keeps it.
vi.mock('../../../src/lib/pokemon-options', async importOriginal => ({ ...(await importOriginal<typeof import('../../../src/lib/pokemon-options')>()), getMovePool: async () => ['Dragon Claw'] }));

const { default: App } = await import('../../../src/App');

/**
 * Round 70 (T205): the sets export reads the values the stats panel shows (the solved spreads, the sheet), so an
 * export followed by an import pins what the build already plays and changes no set. Before, the export read the
 * enriched infos: their EVs and natures are the usage guesses, their IVs the published set's, and the import took
 * all of them as the user's own input over the solver (2663093831's Sinistcha: the log refutes the published Speed
 * IV 0, the import brought it back). The scenes are real replays with their pinned Smogon data, a singles game
 * and a doubles game, built through the app's own chain (the real replay worker, the real spread solve).
 */
const SMOGON_HOSTS = /^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/;

/** The replay JSON by id, the Smogon data from the feedback corpus' pinned files, 404 for everything else. */
function stubNetwork(replay: ReplayData) {
  const replayFetch = stubReplayFetch([replay]);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!SMOGON_HOSTS.test(url)) return replayFetch(input);
    const file = `${join('test', 'e2e-feedback', 'fixtures', 'smogon', url.replace(SMOGON_HOSTS, '').replace(/\/{2,}/g, '/').replace(/[^a-z0-9.]+/gi, '_'))}.json`;
    return existsSync(file)
      ? new Response(readFileSync(file, 'utf-8'), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('', { status: 404 });
  }));
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++counter}`), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const app = () => captured.app as AppController;

/** Everything a set plays, one line each: the round trip must leave all of them as they were. */
const rowOf = (set: PokemonSet) => [
  set.species, set.item, set.ability, set.nature, JSON.stringify(set.evs), JSON.stringify(set.ivs),
  [...set.moves].join(','), set.teraType, set.level, set.gender,
].join(' | ');
const rowsOf = (teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }) => [
  ...teams.p1Team.map(set => `p1: ${rowOf(set)}`), ...teams.p2Team.map(set => `p2: ${rowOf(set)}`),
];

/** The replay loaded, the Smogon data in, the spread solve settled: the state a user reaches after a few seconds on a turn. */
async function mountSettled(replay: ReplayData) {
  stubNetwork(replay);
  render(<App />);
  await act(async () => { await app().ctx.replay.loadReplay(replay.id); });
  await waitFor(() => expect(app().engine.smogonPending).toBe(false), { timeout: 60_000 });
  await act(async () => { await app().ctx.knowledge.getInferredSpreads(); });
  await waitFor(() => expect(app().ctx.knowledge.solvedSpreads).not.toBeNull(), { timeout: 60_000 });
}

/** The team actions sit in the top bar's Setup menu (round 77, user request 28.10.2026). */
const fromSetup = async (name: string) => {
  await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
  await userEvent.click(screen.getByRole('button', { name }));
};
const openSets = () => fromSetup('Import/Export Sets');

describe('the sets export and import leave the inference where it was', () => {
  test.each([
    ['singles', 'smogtours-gen6ou-655336'],
    ['doubles', 'gen9doublesou-2663093831'],
    ['Champions singles, Stat Points', 'gen9championsou-2628340185'],
    // Round 76 (T234): the two sets the coherence veto swapped on a round trip (a guessed fourth move, once the solved item
    // is a Choice item), then the rest of the feedback fixtures: 144 sets in all.
    ['Champions VGC, Head Smash', 'gen9championsvgc2026regmc-2695803506'],
    ['singles, Body Press', 'smogtours-gen8ou-573756'],
    ['singles', 'smogtours-gen6ou-648453'],
    ['singles', 'smogtours-gen6ou-649664'],
    ['singles', 'smogtours-gen6ou-653785'],
    ['singles', 'smogtours-gen8ou-562428'],
    ['doubles', 'smogtours-gen9doublesou-912045'],
    ['VGC', 'gen9vgc2026regi-2629703929'],
    ['VGC', 'gen9vgc2026regi-2630685175'],
  ] as const)('%s (%s): export, import, and every set plays as before', async (_kind, id) => {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as ReplayData;
    await mountSettled(replay);
    const before = rowsOf(await buildReplayTeams(replay, app().ctx.teamSources));
    expect(before.length).toBeGreaterThan(0);

    await openSets();
    const dialog = await screen.findByRole('dialog', { name: 'Import / Export Sets' });
    const exported = (dialog.querySelector('textarea') as HTMLTextAreaElement).value;
    expect(exported).toContain('=== p1:');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import / Export Sets' })).toBeNull());

    const after = rowsOf(await buildReplayTeams(replay, app().ctx.teamSources));
    expect(after).toEqual(before);
  }, 240_000);

  test('doubles: the Sinistcha whose Speed IV the log refutes exports without it, the other one keeps its published IVs', async () => {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', 'gen9doublesou-2663093831.json'), 'utf-8')) as ReplayData;
    await mountSettled(replay);
    // p1's Sinistcha moved before Incineroar's Flare Blitz without Trick Room (turn 8): the build plays Speed 31.
    const teams = await buildReplayTeams(replay, app().ctx.teamSources);
    expect(teams.p1Team.find(set => set.species === 'Sinistcha')!.ivs).toMatchObject({ atk: 0, spe: 31 });
    expect(teams.p2Team.find(set => set.species === 'Sinistcha')!.ivs).toMatchObject({ atk: 0, spe: 0 });

    await openSets();
    const dialog = await screen.findByRole('dialog', { name: 'Import / Export Sets' });
    const exported = (dialog.querySelector('textarea') as HTMLTextAreaElement).value;
    const [p1Side, p2Side] = exported.split(/^=== p2:.*===$/m);
    const ivLine = (side: string) => side.split(/\n\n/).find(block => block.startsWith('Sinistcha'))!.split('\n').find(line => line.startsWith('IVs:'));
    expect(ivLine(p1Side)).toBe('IVs: 0 Atk');
    expect(ivLine(p2Side)).toBe('IVs: 0 Atk / 0 Spe');
  }, 240_000);
});

/** The replay loaded and the Smogon data in, no spread solve started: what a user sees who opens a panel at once. */
async function mountEarly(replay: ReplayData) {
  stubNetwork(replay);
  render(<App />);
  await act(async () => { await app().ctx.replay.loadReplay(replay.id); });
  await waitFor(() => expect(app().engine.smogonPending).toBe(false), { timeout: 60_000 });
}

/** The build a settled app plays for the replay, read in a fresh mount and torn down again. */
async function settledRows(replay: ReplayData) {
  await mountSettled(replay);
  const rows = rowsOf(await buildReplayTeams(replay, app().ctx.teamSources));
  cleanup();
  localStorage.clear();
  return rows;
}

/**
 * Round 76 (T234): the editor and the sets panel read the same solved values as the stats panel, and a panel opened
 * before the first spread solve waits for it. Before, the editor took the enriched infos (the usage guesses) and a
 * save pinned them; the early sets export wrote the guesses and the import took them as the user's own input.
 */
describe('the team editor and an early sets panel keep the inference', () => {
  test.each([
    ['singles', 'smogtours-gen6ou-655336'],
    ['doubles', 'gen9doublesou-2663093831'],
  ] as const)('%s (%s): saving each side in the editor without a change plays the same sets', async (_kind, id) => {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as ReplayData;
    await mountSettled(replay);
    const before = rowsOf(await buildReplayTeams(replay, app().ctx.teamSources));
    for (const [button, title] of [['Edit Player', 'Edit Player Team'], ['Edit Opp', 'Edit Opponent Team']] as const) {
      await fromSetup(button);
      await screen.findByRole('dialog', { name: title });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
    }
    expect(rowsOf(await buildReplayTeams(replay, app().ctx.teamSources))).toEqual(before);
  }, 240_000);

  test.each([
    ['singles', 'smogtours-gen6ou-655336'],
    ['doubles', 'gen9doublesou-2663093831'],
  ] as const)('%s (%s): opening the editor before any solve and saving plays the same sets', async (_kind, id) => {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as ReplayData;
    const reference = await settledRows(replay);
    await mountEarly(replay);
    await fromSetup('Edit Opp');
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }, { timeout: 60_000 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Opponent Team' })).toBeNull());
    expect(rowsOf(await buildReplayTeams(replay, app().ctx.teamSources))).toEqual(reference);
  }, 240_000);

  test.each([
    ['singles', 'smogtours-gen6ou-655336'],
    ['doubles', 'gen9doublesou-2663093831'],
  ] as const)('%s (%s): a sets round trip before the first solve plays the same sets', async (_kind, id) => {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as ReplayData;
    const reference = await settledRows(replay);
    await mountEarly(replay);
    await openSets();
    const dialog = await screen.findByRole('dialog', { name: 'Import / Export Sets' }, { timeout: 60_000 });
    expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toContain('=== p1:');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import / Export Sets' })).toBeNull());
    expect(rowsOf(await buildReplayTeams(replay, app().ctx.teamSources))).toEqual(reference);
  }, 240_000);
});
