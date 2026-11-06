import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { conditionTurns } from '../src/dex-facts/screen-turns';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { RulesDex } from '../src/rules-dex';
import {
  RULE_VIEWS, endsCleanly, playScene, proven, ruledOut, screenLines, screenMoves, plainStyle, type Holder, type SceneOptions, type Style,
} from './screen-scenes';
import { swept } from './screen-sweep-moves';
import type { SimView } from './sim-views';

/**
 * Round 86 (T310, GitHub issue #3): the turns of a screen name the item that held it. Reflect, Light Screen and Aurora Veil last
 * five turns, eight with Light Clay; the log shows the start and the end of a screen but never the item. The inference reads
 * the screen's lifetime from the log (a start in the action phase, an end in the residual phase of a later turn) and holds it
 * to the Dex's own turns (`conditionTurns`, held to the simulator by `screen-turns-sweep.spec.ts`):
 *  - the lifetime of the plain turns rules Light Clay out for the setter, the lifetime of Light Clay's turns proves it;
 *  - nothing is read when the turns prove nothing: a removal (the screen ends in the action phase), a screen moved by Court
 *    Change, a screen still standing at the log's end, an item that did not count (Klutz, Embargo, Magic Room), an item the
 *    log showed change, an Illusion team, a generation without the item (Generations 1 to 3).
 * These rows were red before the reader (step C2 of lane C, `test.fails`); step C3 built the reader and flipped them to `test`.
 * The rows that read nothing pass both before and after; they guard the cases a careless reader would get wrong.
 * Every log below comes from the simulator, in singles and in doubles (the setter in either slot), in the simulator's own style
 * and with the log's `|t:|` lines taken out (a reconstructed log).
 */
const red = test;

const SCENE_FILES = {
  vgc: new URL('../../eval-engine/test/fixtures/gen9vgc2026regi-2630181744.json', import.meta.url),
  draft: new URL('./fixtures/gen9terapreviewdraft-2182991758.json', import.meta.url),
};
const replayOf = (file: URL) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { log: string };

const asRulesDex = (view: SimView): RulesDex => view.dex as unknown as RulesDex;
const LIGHT_CLAY = 'Light Clay';
const STYLES: Style[] = ['timed', 'plain'];
const slotsOf = (view: SimView): (0 | 1)[] => (view.doubles ? [0, 1] : [0]);

describe('the two scenes of the issue', () => {
  const vgc = replayOf(SCENE_FILES.vgc).log;
  const draft = replayOf(SCENE_FILES.draft);

  test('the draft fixture is the log alone: no built sets and no knowledge of the reporter\'s paste', () => {
    expect(Object.keys(draft).sort()).toEqual(['format', 'formatid', 'id', 'log', 'players']);
  });

  test('2630181744 (VGC): the screens of the log, by turn and phase', () => {
    const lines = screenLines(vgc);
    const veil = lines.filter(line => line.screen === 'auroraveil' && line.side === 'p2');
    expect(veil.map(line => `${line.kind} T${line.turn} ${line.phase}`)).toEqual(['start T1 action', 'end T5 residual']);
  });

  test('2182991758 (draft): the screens of the log, by turn and phase', () => {
    const rows = screenLines(draft.log).map(line => `${line.side} ${line.screen} ${line.kind} T${line.turn} ${line.phase}`);
    expect(rows).toEqual([
      'p2 lightscreen start T1 action', 'p2 lightscreen end T8 residual',
      'p1 auroraveil start T11 action', 'p1 auroraveil end T14 action',
      'p2 lightscreen start T25 action', 'p2 reflect start T26 action',
      'p2 lightscreen end T32 residual', 'p2 reflect end T33 residual',
      'p2 lightscreen start T34 action', 'p1 auroraveil start T34 action', 'p2 reflect start T35 action',
    ]);
  });

  red('2630181744 (VGC): Ninetales-Alola\'s Aurora Veil ran five turns, so its item is not Light Clay', () => {
    expect(ruledOut(vgc, 'p2', 'Ninetales-Alola')).toBe(true);
    expect(proven(vgc, 'p2', 'Ninetales-Alola')).toBe('');
  });

  red('2182991758 (draft): Latias\' Light Screen and Reflect ran eight turns, so it holds Light Clay', () => {
    expect(proven(draft.log, 'p2', 'Latias')).toBe(LIGHT_CLAY);
    expect(ruledOut(draft.log, 'p2', 'Latias')).toBe(false);
  });

  red('2182991758 (draft): the naked build gives Latias Light Clay', () => {
    const teams = buildTeamsFromReplay(draft.log, {});
    expect(teams.p2Team.find(set => set.species === 'Latias')?.item).toBe(LIGHT_CLAY);
  });

  test('2182991758 (draft): p1\'s Aurora Veil ended by a removal, so Ninetales-Alola reads nothing', () => {
    expect(proven(draft.log, 'p1', 'Ninetales-Alola')).toBe('');
    expect(ruledOut(draft.log, 'p1', 'Ninetales-Alola')).toBe(false);
  });
});

/** The scene of a holder: Alpha's setter uses the screen on turn 1 and the log runs ten turns (a plain screen ended on turn 5, Light Clay's on turn 8). */
const scene = (screen: string, holder: Holder, extra: Partial<SceneOptions> = {}): SceneOptions =>
  ({ holder, screen, turns: 10, ...extra });
const SNORLAX = 'Snorlax';

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4))('S4, the setter\'s item from the turns: $name', view => {
  const dex = asRulesDex(view);
  for (const screen of screenMoves(view)) {
    const items = [...(conditionTurns(dex, screen)?.byItem ?? [])];
    for (const style of STYLES) {
      for (const slot of slotsOf(view)) {
        const label = `${screen}, ${style} log${view.doubles ? `, setter in slot ${slot + 1}` : ''}`;
        const options = { style, slot };
        red(`${label}: no item, five turns, Light Clay ruled out`, () => {
          const log = playScene(view, scene(screen, { species: SNORLAX }, options));
          expect(endsCleanly(log, 'p1', screen), 'the log shows the screen ending cleanly on its own side').toBe(true);
          expect(ruledOut(log, 'p1', SNORLAX)).toBe(true);
        });
        for (const [id, turns] of items) {
          const name = dex.items.get(id).name;
          red(`${label}: ${name}, ${turns} turns, item proven`, () => {
            const log = playScene(view, scene(screen, { species: SNORLAX, item: name }, options));
            expect(endsCleanly(log, 'p1', screen), 'the log shows the screen ending cleanly on its own side').toBe(true);
            expect(proven(log, 'p1', SNORLAX)).toBe(name);
          });
        }
      }
    }
  }
});

/** The rows where the turns prove nothing: each plays the control (the verdict the reader gives without the cause) and then the cause. */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4))('the turns prove nothing: $name', view => {
  const screen = 'reflect';
  const slot = view.doubles ? 1 : 0;
  const control = (holder: Holder, extra: Partial<SceneOptions> = {}) => playScene(view, scene(screen, holder, { slot, ...extra }));
  const at = (turn: number, move: string): Record<number, string> => ({ 1: 'splash', [turn]: move });
  const clayAt = (extra: Partial<SceneOptions>) => control({ species: SNORLAX, item: LIGHT_CLAY }, extra);

  test.each([
    ['Klutz', { species: 'Lopunny', item: LIGHT_CLAY, ability: 'Klutz' }, {}, 'Lopunny', 4],
    ['Embargo', { species: SNORLAX, item: LIGHT_CLAY }, { setter: at(2, screen), foeMoves: { 1: 'embargo' } }, SNORLAX, 4],
    ['Magic Room', { species: SNORLAX, item: LIGHT_CLAY }, { setter: at(2, screen), foeMoves: { 1: 'magicroom' } }, SNORLAX, 5],
  ] as [string, Holder, Partial<SceneOptions>, string, number][])('%s makes the item count for nothing: five turns with Light Clay in hand, no verdict', (_name, holder, extra, species, since) => {
    if (view.dex.gen < since) return;
    const blocked = control(holder, extra);
    expect(endsCleanly(blocked, 'p1', screen), 'the log shows the screen ending cleanly on its own side').toBe(true);
    expect(ruledOut(blocked, 'p1', species)).toBe(false);
    expect(proven(blocked, 'p1', species)).toBe('');
  });

  red('the control of a blocked holder: Light Clay\'s eight turns prove it, with no cause in the way', () => {
    expect(proven(clayAt({}), 'p1', SNORLAX)).toBe(LIGHT_CLAY);
  });

  red('Court Change moves the screen to the other side: no end on the setter\'s side, no verdict', () => {
    expect(ruledOut(control({ species: SNORLAX }), 'p1', SNORLAX)).toBe(true);
    const moved = control({ species: SNORLAX }, { foeMoves: { 2: 'courtchange' } });
    expect(endsCleanly(moved, 'p1', screen), 'the log shows the screen ending cleanly on its own side').toBe(false);
    expect(ruledOut(moved, 'p1', SNORLAX)).toBe(false);
  });

  red('a screen still standing at the log\'s end proves nothing', () => {
    expect(ruledOut(control({ species: SNORLAX }), 'p1', SNORLAX)).toBe(true);
    const standing = control({ species: SNORLAX }, { turns: 3 });
    expect(endsCleanly(standing, 'p1', screen), 'the log shows the screen ending cleanly on its own side').toBe(false);
    expect(ruledOut(standing, 'p1', SNORLAX)).toBe(false);
  });

  red('an Illusion user on the team: the setter may be the user\'s disguise, no verdict (where the generation has Illusion)', () => {
    expect(ruledOut(control({ species: SNORLAX }), 'p1', SNORLAX)).toBe(true);
    // Round 86 (C3): the generation decides, read from the Dex. Where the ability does not exist, a bench the log never shows holds no disguise.
    const illusion = view.dex.abilities.get('illusion');
    const hasIllusion = illusion.exists && illusion.gen <= view.dex.gen;
    expect(ruledOut(control({ species: SNORLAX }, { bench: [{ species: 'Zoroark', ability: 'Illusion' }] }), 'p1', SNORLAX)).toBe(!hasIllusion);
  });

  test('an item knocked off before the screen: the log showed it, the rule-out stays off', () => {
    const log = control({ species: SNORLAX, item: LIGHT_CLAY }, { setter: at(2, screen), foeMoves: { 1: 'knockoff' } });
    expect(ruledOut(log, 'p1', SNORLAX)).toBe(false);
  });

  test('an item swapped by Trick before the screen: the log showed the swap, the rule-out stays off', () => {
    const log = control({ species: SNORLAX, item: LIGHT_CLAY }, { setter: at(2, screen), foeMoves: { 1: 'trick' }, foe: { species: 'Abomasnow', ability: 'Snow Warning', item: 'Choice Scarf' } });
    expect(ruledOut(log, 'p1', SNORLAX)).toBe(false);
  });
});

/**
 * The ruling after C1: a start whose move line carries `[from]` (a Snatch that steals the screen, a move called by Copycat) is
 * set by the body that line names, and that body's item decides the turns. A reader that credits the body of the earlier
 * `|move|` line instead gets a wrong verdict: these rows hold the scenes where it would. They pass today and must keep passing.
 * The Snatch rows come from the Dex's `snatch` flag, the Copycat row from the Dex's move.
 */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 4))('a screen set through another move: $name', view => {
  const snatchable = screenMoves(view).filter(id => view.dex.moves.get(id).flags.snatch);

  test.each(snatchable)('Snatch steals %s: the stolen screen is the snatcher\'s, the original setter reads nothing', screen => {
    const options = { screen, turns: 10, foeMoves: { 1: 'snatch' } };
    // the setter holds Light Clay and the snatcher nothing: five turns on the snatcher's side, no rule-out for the setter
    const plain = playScene(view, { ...options, holder: { species: SNORLAX, item: LIGHT_CLAY }, foe: { species: 'Abomasnow', ability: 'Snow Warning' } });
    expect(screenLines(plain).filter(line => line.kind === 'start').map(line => line.side), 'the stolen screen stands on the snatcher side').toEqual(['p2']);
    expect(plain).toContain('[from] Snatch');
    expect(ruledOut(plain, 'p1', SNORLAX)).toBe(false);
    // the snatcher holds Light Clay and the setter nothing: eight turns on the snatcher's side, no proof for the setter
    const clay = playScene(view, { ...options, holder: { species: SNORLAX }, foe: { species: 'Abomasnow', ability: 'Snow Warning', item: LIGHT_CLAY } });
    expect(proven(clay, 'p1', SNORLAX)).toBe('');
    expect(ruledOut(clay, 'p2', 'Abomasnow')).toBe(false);
  });

  test('Copycat sets the screen: the copier\'s item decides, so the verdict names the copier or nothing', () => {
    // Singles only: in doubles the ally and the foe's partner move between the copied Reflect and the copy, so Copycat repeats
    // their Splash; the Snatch rows above hold the `[from]` rule in doubles.
    const copycat = view.dex.moves.get('copycat');
    if (view.doubles || !copycat.exists || copycat.gen > view.dex.gen) return;
    const log = playScene(view, {
      screen: 'reflect', turns: 10, holder: { species: SNORLAX, item: LIGHT_CLAY }, setter: { 1: 'splash', 2: 'copycat' },
      foeMoves: { 1: 'reflect', 2: 'reflect' }, foe: { species: 'Abomasnow', ability: 'Snow Warning' },
    });
    expect(log).toContain('[from] move: Copycat');
    expect(screenLines(log).filter(line => line.kind === 'start' && line.side === 'p1').length, 'the copy set a screen on the copier side').toBe(1);
    expect(ruledOut(log, 'p1', SNORLAX)).toBe(false);
    expect(['', LIGHT_CLAY]).toContain(proven(log, 'p1', SNORLAX));
  });
});

describe.each(RULE_VIEWS.filter(view => view.dex.gen < 4))('no table before Light Clay exists: $name', view => {
  test('a plain screen of five turns rules nothing out and proves nothing', () => {
    for (const screen of screenMoves(view)) {
      const log = playScene(view, { holder: { species: SNORLAX }, screen, turns: 10 });
      expect(ruledOut(log, 'p1', SNORLAX), screen).toBe(false);
      expect(proven(log, 'p1', SNORLAX), screen).toBe('');
    }
  });
});

/**
 * S3, the removers and the silent movers, found by playing every move of the rule set against a board with a screen on each
 * side (Reflect on p1's, Light Screen on p2's, set by `addSideCondition`): a move that ends a screen in the action phase is a
 * remover, a move that changes which side holds a screen with no line is a silent mover. For each found move the log of a
 * game where p1 plays it on the screen's plain last turn must give a verdict to a side only when its screen ran out on its own
 * side in the residual phase, and the control without the move gives both sides their verdict.
 */
describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 2 && screenMoves(view).length >= 2))('S3, removers and movers of screens: $name', view => {
  const found = swept(view);
  const both = (log: string): [boolean, boolean] => [ruledOut(log, 'p1', SNORLAX), ruledOut(log, 'p2', 'Vaporeon')];
  // Round 86 (C3): before Generation 4 no item changes a screen's turns (Light Clay debuts there), so no screen gives a verdict.
  const verdicts = (clean: [boolean, boolean]): [boolean, boolean] => (view.dex.gen >= 4 ? clean : [false, false]);

  test('the sweep found the removers and movers the rule set has', () => {
    expect(found.played).toBeGreaterThan(0);
    for (const named of found.named) expect(found.moves.map(move => move.id), named).toContain(named);
  });

  red('the control: with no move on the last plain turn both screens ran out on their own sides', () => {
    expect(both(found.log(null))).toEqual(verdicts([true, true]));
  });

  for (const move of found.moves) {
    red(`${move.id} (${move.kind}) on turn 5: a side reads a verdict only if its screen ran out on its own side`, () => {
      const log = found.log(move.id);
      expect(both(found.log(null))).toEqual(verdicts([true, true]));
      expect(both(log)).toEqual(verdicts([endsCleanly(log, 'p1', 'reflect'), endsCleanly(log, 'p2', 'lightscreen')]));
    });
  }
});

describe('the logs of both styles read the same', () => {
  test('the plain style takes out the `|t:|` lines and nothing else', () => {
    const view = RULE_VIEWS.find(entry => entry.name === 'Gen 9')!;
    const log = playScene(view, { holder: { species: SNORLAX }, screen: 'reflect', turns: 3 });
    const plain = plainStyle(log);
    const lines = log.split('\n');
    expect(lines.filter(line => !line.startsWith('|t:|')).join('\n')).toBe(plain);
    expect(lines.filter(line => line.startsWith('|t:|')).length).toBeGreaterThanOrEqual(3);
    expect(plain).not.toContain('|t:|');
    expect(screenLines(plain)).toEqual(screenLines(log));
  });
});
