import { test, expect } from '@playwright/test';
import { runInNewContext } from 'node:vm';
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

  test('predefines Showdown\'s Config.routes so battledata.js survives loading before config.js', () => {
    // replay-embed.js appends its dependencies as dynamic scripts, which the
    // browser may execute in any order. battledata.js (client 0.11.2) reads
    // `window.Config ? Config.routes.client : default` at load time: a
    // predefined Config WITHOUT routes crashes it, and Dex never exists.
    const html = generateReplayHtml({ log, seekTurn: 2, viewpoint: 'p2', reportTurn: true });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
      .filter(body => !body.includes('replay-embed.js'));
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    const run = (window: Record<string, unknown>) => {
      const sandbox: Record<string, unknown> = {
        ...window, setInterval: () => 0, setTimeout: () => 0, parent: { postMessage() {} }, addEventListener() {},
      };
      sandbox.window = sandbox;
      for (const body of scripts) runInNewContext(body, sandbox);
      return sandbox.Config as { routes: Record<string, string>; sound: boolean; mute: boolean };
    };
    // A page that predefines nothing: our stub carries Showdown's own route table.
    const fresh = run({});
    expect(fresh.routes.client).toBe('play.pokemonshowdown.com');
    expect(fresh.routes.replays).toBe('replay.pokemonshowdown.com');
    expect(fresh.mute).toBe(true);
    // config.js already ran: its routes win over our defaults, the mute stays.
    const configured = run({ Config: { routes: { client: 'mirror.example', root: 'example' }, sound: true } });
    expect(configured.routes.client).toBe('mirror.example');
    expect(configured.sound).toBe(false);
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

  test('replaces the embed FontAwesome face with the given woff2 behind the loader', () => {
    const html = generateReplayHtml({ log, fontAwesomeWoff2Url: 'https://host.test/fonts/fa.woff2' });

    // Same family/weight/style as font-awesome.css: for duplicate @font-face
    // descriptors the later rule wins, and the embed appends its stylesheets
    // to <head> — a rule in the body always cascades after them. The upstream
    // woff2 (stale glyph bboxes, one Firefox sanitizer warning per glyph) is
    // then never fetched.
    expect(html).toContain("font-family: 'FontAwesome'");
    expect(html).toContain("src: url('https://host.test/fonts/fa.woff2') format('woff2')");
    expect(html).toContain('font-weight: normal');
    expect(html).toContain('font-style: normal');
    expect(html.indexOf('@font-face')).toBeGreaterThan(html.indexOf('replay-embed.js'));
  });

  test('leaves the embed fonts alone when no replacement woff2 is given', () => {
    expect(generateReplayHtml({ log })).not.toContain('@font-face');
  });

  test('answers mozInputSource reads from pointer events instead of the deprecated getter', () => {
    const html = generateReplayHtml({ log });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
      .filter(body => !body.includes('replay-embed.js'));
    expect(html.indexOf('mozInputSource')).toBeLessThan(html.indexOf('replay-embed.js'));

    // A Gecko-like prototype: reading the native accessor is what Firefox
    // logs its deprecation for — the shim must replace it, keeping the
    // touch semantics battle-tooltips.ts relies on (=== 5 suppresses the
    // tooltip a stray tap would open).
    const proto: Record<string, unknown> = {};
    Object.defineProperty(proto, 'mozInputSource', {
      configurable: true,
      get() { throw new Error('deprecated native getter invoked'); },
    });
    const listeners: Record<string, (e: unknown) => void> = {};
    const sandbox: Record<string, unknown> = {
      MouseEvent: Object.assign(() => {}, { prototype: proto }),
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
      setInterval: () => 0, setTimeout: () => 0, parent: { postMessage() {} },
    };
    sandbox.window = sandbox;
    for (const body of scripts) runInNewContext(body, sandbox);

    const get = Object.getOwnPropertyDescriptor(proto, 'mozInputSource')?.get as
      (this: { pointerType?: string }) => number;
    expect(get.call({ pointerType: 'touch' })).toBe(5);
    expect(get.call({ pointerType: 'pen' })).toBe(2);
    expect(get.call({ pointerType: 'mouse' })).toBe(1);
    // Firefox fires compat mouseover as a plain MouseEvent; the preceding
    // pointerover carries the source that the getter must remember.
    listeners['pointerover']({ pointerType: 'touch' });
    expect(get.call({})).toBe(5);
  });

  test('does not invent mozInputSource where the platform has none', () => {
    const html = generateReplayHtml({ log });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
      .filter(body => !body.includes('replay-embed.js'));

    const proto: Record<string, unknown> = {};
    const sandbox: Record<string, unknown> = {
      MouseEvent: Object.assign(() => {}, { prototype: proto }),
      addEventListener() {}, setInterval: () => 0, setTimeout: () => 0, parent: { postMessage() {} },
    };
    sandbox.window = sandbox;
    for (const body of scripts) runInNewContext(body, sandbox);

    expect(Object.getOwnPropertyDescriptor(proto, 'mozInputSource')).toBeUndefined();
  });
});
