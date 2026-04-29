import { test, expect } from '@playwright/test';
import { generateReplayHtml } from '../src/lib/replay-html';

const log = '|start\n|turn|1\n|turn|2';

test.describe('Replay iframe HTML', () => {
  test('accepts seek messages without autoplaying by default', () => {
    const html = generateReplayHtml({ log, seekTurn: 2 });

    expect(html).toContain("type === 'ps-seek-turn'");
    expect(html).toContain('var pendingSeek = { turn: 2, autoPlay: false };');
    expect(html).toContain('Replays.battle.pause()');
    expect(html).not.toContain('var pendingSeek = { turn: 2, autoPlay: true };');
  });

  test('disables Showdown replay sound before embed code loads', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain('window.__psPatchBattleSound');
    expect(html).toContain('sound.loadBgm = function(){ return makeSilent(); };');
    expect(html).toContain('window.Config');
    expect(html).toContain('sound');
  });

  test('can append branch log lines without replacing the iframe document', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain("type === 'ps-append-log'");
    expect(html).toContain('Replays.battle.add(line)');
  });

  test('announces readiness so the parent can replay missed seek commands', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain("type: 'ps-replay-ready'");
    expect(html).toContain('notifyReady');
  });
});
