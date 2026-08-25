import { test, expect } from '@playwright/test';
import { generateReplayHtml } from '../src/lib/replay-html';

const log = '|start\n|turn|1\n|turn|2';

test.describe('Replay iframe HTML', () => {
  test('accepts seek messages without autoplaying by default', () => {
    const html = generateReplayHtml({ log, seekTurn: 2 });

    expect(html).toContain("type === 'ps-seek-turn'");
    expect(html).toContain('var pendingSeek = { turn: 2, autoPlay: false };');
    expect(html).not.toContain('var pendingSeek = { turn: 2, autoPlay: true };');
  });

  test('seeks like the native player: rest state before the seek, never pause() after', () => {
    const html = generateReplayHtml({ log, seekTurn: 2 });

    // scene.pause() bumps interruptionCount, which cancels the async seek
    // chain battle.js schedules past 300ms of fast-forwarding — the old
    // post-seek pause() was one half of the "seeking..." hang.
    expect(html).toContain('if (!seek.autoPlay && !battle.paused) battle.pause();');
    expect(html).toContain('battle.seekTurn(seek.turn)');
    expect(html).not.toContain('Replays.battle.pause()');
  });

  test('the turn tracker stays silent while a seek is scrubbing', () => {
    const html = generateReplayHtml({ log, reportTurn: true });

    // Mid-seek turns echoed to the parent come back as stale seeks
    // (turn <= current resets the scrub) — the self-sustaining reset loop
    // that froze long jumps on "seeking..." forever.
    expect(html).toContain('if (Replays.battle.seeking !== null) return;');
  });

  test('autoplay waits for the seek to land before playing', () => {
    const html = generateReplayHtml({ log, seekTurn: 2, autoPlay: true });

    expect(html).toContain('battle.seeking === null');
    expect(html).toContain('battle.play()');
  });

  test('a p2 viewpoint request switches sides once the embed is ready', () => {
    const html = generateReplayHtml({ log, viewpoint: 'p2' });
    expect(html).toContain("var pendingViewpoint = 'p2';");
    expect(html).toContain('Replays.battle.setViewpoint(pendingViewpoint)');

    expect(generateReplayHtml({ log })).toContain('var pendingViewpoint = null;');
  });

  test('disables Showdown replay sound before embed code loads', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain('window.__psPatchBattleSound');
    expect(html).toContain('sound.loadBgm = function(){ return makeSilent(); };');
    expect(html).toContain('resume: function(){ return Promise.resolve(); }');
    expect(html).toContain('window.Config');
    expect(html).toContain('sound');
  });

  test('can append branch log lines without replacing the iframe document', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain("type === 'ps-append-log'");
    expect(html).toContain('Replays.battle.add(line)');
  });

  test('can play appended branch turns from the executed turn', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain('data.playFromTurn');
    expect(html).toContain('queueSeek(data.playFromTurn, true)');
  });

  test('announces readiness so the parent can replay missed seek commands', () => {
    const html = generateReplayHtml({ log });

    expect(html).toContain("type: 'ps-replay-ready'");
    expect(html).toContain('notifyReady');
  });
});
