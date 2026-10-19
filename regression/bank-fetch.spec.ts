import { describe, expect, test } from 'vitest';
import { fetchBankReplay } from './bank-fetch';

/**
 * Round 71: the bank's replay fetch tries again after a network error, a server error or a rate limit, and returns at
 * once on a client error; a replay that never arrives comes back as its status, which the harness logs as a skip.
 */

type Step = Error | { status: number; body?: unknown; brokenBody?: boolean };

/** A fetch that answers the scripted steps in order and counts its calls. */
function scripted(steps: Step[]) {
  let calls = 0;
  const fetcher = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    if (step instanceof Error) throw step;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => {
        if (step.brokenBody) throw new Error('terminated');
        return step.body;
      },
    };
  };
  return { fetcher, calls: () => calls };
}

const options = (fetcher: ReturnType<typeof scripted>['fetcher']) => ({ fetcher, pauses: [0] });
const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

describe('the bank fetches its replays with further attempts', () => {
  test('a reset connection and a server error heal on a later attempt', async () => {
    const run = scripted([reset(), { status: 503 }, { status: 200, body: { id: 'gen9ou-1' } }]);
    expect(await fetchBankReplay('gen9ou-1', options(run.fetcher))).toEqual({ replay: { id: 'gen9ou-1' } });
    expect(run.calls()).toBe(3);
  });

  test('a body that breaks off is fetched again', async () => {
    const run = scripted([{ status: 200, brokenBody: true }, { status: 200, body: { id: 'gen9ou-2' } }]);
    expect(await fetchBankReplay('gen9ou-2', options(run.fetcher))).toEqual({ replay: { id: 'gen9ou-2' } });
    expect(run.calls()).toBe(2);
  });

  test('a missing replay returns its status at once', async () => {
    const run = scripted([{ status: 404 }]);
    expect(await fetchBankReplay('gen9ou-3', options(run.fetcher))).toEqual({ status: 404 });
    expect(run.calls()).toBe(1);
  });

  test('a network that stays down gives status 0 after every attempt, a rate limit its last status', async () => {
    const down = scripted([reset()]);
    expect(await fetchBankReplay('gen9ou-4', { ...options(down.fetcher), attempts: 3 })).toEqual({ status: 0 });
    expect(down.calls()).toBe(3);
    const limited = scripted([{ status: 429 }]);
    expect(await fetchBankReplay('gen9ou-5', { ...options(limited.fetcher), attempts: 2 })).toEqual({ status: 429 });
    expect(limited.calls()).toBe(2);
  });
});
