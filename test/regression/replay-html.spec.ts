import { test, expect, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { REPLAY_FRAME_HEIGHT, generateReplayHtml } from '../../src/lib/replay-html';
import { EMBED_SCRIPT_ORDER_SCRIPT } from '../../src/lib/replay-compat';

const log = '|start\n|turn|1\n|turn|2';

describe('Replay iframe HTML', () => {
  test('accepts seek messages without autoplaying by default', () => {
    const html = generateReplayHtml({ log, seekTurn: 2 });

    expect(html).toContain("type === 'ps-seek-turn'");
    expect(html).toContain('var pendingSeek = { turn: 2, autoPlay: false };');
    expect(html).not.toContain('var pendingSeek = { turn: 2, autoPlay: true };');
  });

  test('seeks like the native player: rest state before the seek, never pause() after', () => {
    const html = generateReplayHtml({ log, seekTurn: 2 });

    // scene.pause() after the seek bumps interruptionCount, which cancels battle.js's seek chain: the frame hangs.
    expect(html).toContain('if (!seek.autoPlay && !battle.paused) battle.pause();');
    expect(html).toContain('battle.seekTurn(seek.turn)');
    expect(html).not.toContain('Replays.battle.pause()');
  });

  test('the turn tracker stays silent while a seek is scrubbing', () => {
    const html = generateReplayHtml({ log, reportTurn: true });

    // Mid-seek turns echoed to the parent come back as stale seeks and reset the scrub in a loop.
    expect(html).toContain('if (Replays.battle.seeking !== null) return;');
  });

  test('autoplay waits for the seek to land before playing', () => {
    const html = generateReplayHtml({ log, seekTurn: 2, autoPlay: true });

    expect(html).toContain('battle.seeking === null');
    expect(html).toContain('battle.play()');
  });

  describe('play seeks with an id', () => {
    const bridge = () => {
      const html = generateReplayHtml({ log });
      const body = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(text => text.includes('replayBridge'));
      const calls: string[] = [];
      const battle = {
        paused: false, seeking: null as number | null, turn: 5, sound: {},
        seekTurn(turn: number) { calls.push(`seek ${turn}`); battle.turn = turn; },
        play() { calls.push('play'); battle.paused = false; },
        pause() { calls.push('pause'); battle.paused = true; },
        setViewpoint() {},
      };
      let listener: (event: { data: unknown }) => void = () => {};
      const sandbox: Record<string, unknown> = {
        Replays: { battle }, setInterval: () => 0, setTimeout: () => 0, parent: { postMessage() {} },
        addEventListener: (type: string, fn: typeof listener) => { if (type === 'message') listener = fn; },
      };
      sandbox.window = sandbox;
      runInNewContext(body ?? '', sandbox);
      return { battle, calls, send: (data: Record<string, unknown>) => listener({ data: { type: 'ps-seek-turn', ...data } }) };
    };

    test('a frame that plays past the turn goes back to it once per id; the retries of that id change nothing', () => {
      const { battle, calls, send } = bridge();
      send({ turn: 3, autoPlay: true, id: 4 });
      expect(calls).toEqual(['seek 3', 'play']);
      battle.turn = 5;
      send({ turn: 3, autoPlay: true, id: 4 });
      send({ turn: 3, autoPlay: true, id: 4 });
      expect(calls).toEqual(['seek 3', 'play']);
      send({ turn: 3, autoPlay: true, id: 5 });
      expect(calls).toEqual(['seek 3', 'play', 'seek 3', 'play']);
    });

    test('seeks without an id keep the guards against the app\'s own retries', () => {
      const { calls, send } = bridge();
      send({ turn: 3, autoPlay: true });
      expect(calls).toEqual([]);
      send({ turn: 8, autoPlay: true });
      expect(calls).toEqual(['seek 8', 'play']);
    });
  });

  test('a p2 viewpoint request switches sides once the embed is ready', () => {
    const html = generateReplayHtml({ log, viewpoint: 'p2' });
    expect(html).toContain("var pendingViewpoint = 'p2';");
    expect(html).toContain('Replays.battle.setViewpoint(pendingViewpoint)');

    expect(generateReplayHtml({ log })).toContain('var pendingViewpoint = null;');
  });

  test('predefines Showdown\'s Config.routes so battledata.js survives loading before config.js', () => {
    // Scripts load in any order and battledata.js reads `Config.routes` at load: a Config without routes crashes it.
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
    const fresh = run({});
    expect(fresh.routes.client).toBe('play.pokemonshowdown.com');
    expect(fresh.routes.replays).toBe('replay.pokemonshowdown.com');
    expect(fresh.mute).toBe(true);
    const configured = run({ Config: { routes: { client: 'mirror.example', root: 'example' }, sound: true } });
    expect(configured.routes.client).toBe('mirror.example');
    expect(configured.sound).toBe(false);
  });

  test('relative effect sprites resolve against Showdown\'s fx folder', () => {
    // graphics.js prefixes BattleEffects with Dex.fxPrefix only when Dex exists; a blob document needs the base.
    const html = generateReplayHtml({ log });
    const head = html.slice(0, html.indexOf('<div class="wrapper replay-wrapper">'));
    expect(head).toContain('<base href="https://play.pokemonshowdown.com/fx/">');
    const resolved = new URL('rock1.png', 'https://play.pokemonshowdown.com/fx/').href;
    expect(resolved).toBe('https://play.pokemonshowdown.com/fx/rock1.png');
    const relative = [...html.matchAll(/\b(?:src|href)="(?!https:\/\/)([^"]+)"/g)].map(match => match[1]);
    expect(relative).toEqual([]);
  });

  test('the embed\'s scripts run in the order the embed appends them', () => {
    const html = generateReplayHtml({ log });
    expect(html.indexOf(EMBED_SCRIPT_ORDER_SCRIPT)).toBeGreaterThan(-1);
    expect(html.indexOf(EMBED_SCRIPT_ORDER_SCRIPT)).toBeLessThan(html.indexOf('replay-embed.js'));
    type Node = { tagName: string; src?: string; async?: boolean };
    const appended: Node[] = [];
    const head = { appendChild: (node: Node) => { appended.push({ ...node }); return node; } };
    const sandbox: Record<string, unknown> = { document: { head } };
    sandbox.window = sandbox;
    runInNewContext(EMBED_SCRIPT_ORDER_SCRIPT.replace(/<\/?script>/g, ''), sandbox);
    head.appendChild({ tagName: 'SCRIPT', src: 'https://play.pokemonshowdown.com/js/lib/jquery-1.11.0.min.js', async: true });
    head.appendChild({ tagName: 'LINK', async: true });
    expect(appended).toEqual([
      { tagName: 'SCRIPT', src: 'https://play.pokemonshowdown.com/js/lib/jquery-1.11.0.min.js', async: false },
      { tagName: 'LINK', async: true },
    ]);
  });

  test('the battle starts at the frame\'s top edge, and no title shows under the controls', () => {
    const html = generateReplayHtml({ log, title: 'Branch Simulation', format: 'gen9ou', p1: 'Alice', p2: 'Bob' });
    const styles = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(styles).toContain('body{padding:0 0 12px;background:#344b6c;}');
    expect(styles).toContain('.wrapper.replay-wrapper{margin-top:-9px;}');
    expect(html).not.toContain('<h1');
    expect(html.match(/Branch Simulation/g)).toEqual(['Branch Simulation']);
    expect(html).toContain('<title>Branch Simulation</title>');
  });

  test('the frame height in layout.css is REPLAY_FRAME_HEIGHT', () => {
    const css = readFileSync(fileURLToPath(new URL('../../src/styles/layout.css', import.meta.url)), 'utf8');
    const rule = /\.ps-iframe-wrap iframe \{[^}]*min-height: (\d+)px;/.exec(css);
    expect(Number(rule?.[1])).toBe(REPLAY_FRAME_HEIGHT);
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

    // The later @font-face wins for equal descriptors, and a rule in the body cascades after the embed's stylesheets.
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

    // Firefox logs a deprecation for the native accessor: the shim replaces it and keeps `=== 5` (no stray tooltip).
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
