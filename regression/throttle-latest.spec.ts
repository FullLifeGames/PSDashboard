import { test, expect, describe } from 'vitest';
import { throttleLatest } from '../src/lib/eval/throttle-latest';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('throttleLatest', () => {
  test('delivers the first value at once and only the LATEST held value after the interval', async () => {
    const seen: number[] = [];
    const throttle = throttleLatest<number>(value => seen.push(value), 40);
    throttle.push(1);
    expect(seen).toEqual([1]);
    throttle.push(2);
    throttle.push(3);
    throttle.push(4);
    expect(seen).toEqual([1]);
    await wait(70);
    expect(seen).toEqual([1, 4]);
  });

  test('flush delivers the held value immediately and the timer does not deliver it again', async () => {
    const seen: number[] = [];
    const throttle = throttleLatest<number>(value => seen.push(value), 40);
    throttle.push(1);
    throttle.push(2);
    throttle.flush();
    expect(seen).toEqual([1, 2]);
    await wait(70);
    expect(seen).toEqual([1, 2]);
  });

  test('cancel drops the held value', async () => {
    const seen: number[] = [];
    const throttle = throttleLatest<number>(value => seen.push(value), 40);
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    await wait(70);
    expect(seen).toEqual([1]);
    throttle.flush();
    expect(seen).toEqual([1]);
  });

  test('after a quiet interval the next value is immediate again', async () => {
    const seen: number[] = [];
    const throttle = throttleLatest<number>(value => seen.push(value), 30);
    throttle.push(1);
    await wait(50);
    throttle.push(2);
    expect(seen).toEqual([1, 2]);
  });

  test('a burst never delivers more often than the interval allows', async () => {
    const stamps: number[] = [];
    const throttle = throttleLatest<number>(() => stamps.push(Date.now()), 30);
    for (let index = 0; index < 20; index++) {
      throttle.push(index);
      await wait(4);
    }
    await wait(50);
    for (let index = 1; index < stamps.length; index++) {
      // Timer granularity on a loaded machine: allow a few milliseconds of slack.
      expect(stamps[index] - stamps[index - 1]).toBeGreaterThanOrEqual(25);
    }
    expect(stamps.length).toBeLessThan(20);
  });
});
