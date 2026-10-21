import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Dex, Teams, type PokemonSet } from '@pkmn/sim';
import { buildChoiceLockContext } from '../src/choice-lock';
import { correctActivesFromProtocol } from '../src/branch/corrections';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 73 (T214): the rebuilt board holds the Sitrus Berry the game's HP proves it still holds. The simulator eats a
 * guessed berry at its own HP (a roll that differs from the game's leaves it under half); the protocol shows no item line
 * for the body and its HP stays above the berry's threshold, so the game's body kept the berry. A body whose HP the game
 * shows at or under the threshold without an eating line holds no berry (the game refutes the guess): it stays consumed.
 * The threshold is the Dex item's own (sitrusEatsAt, held against the simulator's displays in item-triggers.spec.ts).
 * The scenes of the backlog entry (939635 Sinistcha, 2660826377, 2660802611, 913990, 938638) no longer diverge on v1: the
 * census over the 129 bank games finds 82 active Sitrus bodies with a consumed board item and none without a protocol item
 * line, so the scenes here are built boards.
 */

const mon = (species: string, item = ''): PokemonSet => ({
  name: species, species, item, ability: 'No Ability', moves: ['Splash'], nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function board(format: string, kind: 'singles' | 'doubles'): LiveBattle {
  const p1 = [mon('Pikachu'), mon('Eevee')].slice(0, kind === 'doubles' ? 2 : 1);
  const p2 = [mon('Magikarp', 'Sitrus Berry'), mon('Ditto')].slice(0, kind === 'doubles' ? 2 : 1);
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** The protocol of the turn: the entries (no item line for Magikarp), the block's lines, the next boundary. */
function protocol(kind: 'singles' | 'doubles', block: string[]) {
  const entries = ['|switch|p1a: Pikachu|Pikachu, M|100/100', '|switch|p2a: Magikarp|Magikarp, M|100/100'];
  if (kind === 'doubles') entries.push('|switch|p1b: Eevee|Eevee, M|100/100', '|switch|p2b: Ditto|Ditto|100/100');
  const log = ['|player|p1|A|', '|player|p2|B|', '|gen|9', '|tier|[Gen 9] Custom Game', '|start', ...entries, '|turn|1', ...block, '|upkeep', '|turn|2'].join('\n');
  return { context: buildChoiceLockContext(log, { p1Team: [], p2Team: [] }, []), turn: 2 };
}

const FORMATS = { singles: 'gen9customgame', doubles: 'gen9doublescustomgame' } as const;

describe.each(['singles', 'doubles'] as const)('the Sitrus witness (%s)', kind => {
  const format = FORMATS[kind];
  const tick = (battle: LiveBattle) => battle.eachEvent('Update');
  const damage = (text: string) => ['|move|p1a: Pikachu|Splash|', `|-damage|p2a: Magikarp|${text}`];

  /** The simulator's own trigger ate the berry at a HP the game never had. */
  function simAte() {
    const battle = board(format, kind);
    const body = battle.sides[1].active[0]!;
    body.hp = Math.ceil(body.maxhp * 0.45);
    tick(battle);
    expect(body.item, 'the simulator ate its berry').toBe('');
    return { battle, body };
  }

  test('the game\'s HP stays above half and shows no item line: the berry is back', () => {
    const { battle, body } = simAte();
    correctActivesFromProtocol(battle as never, damage('55/100'), protocol(kind, damage('55/100')));
    expect(body.item).toBe('sitrusberry');
    expect(body.ateBerry).toBe(false);
    expect(body.lastItem).toBe('');
  });

  test('controls: the game\'s HP at or under half without an eating line refutes the berry; an item line, or no HP line, leaves the board alone', () => {
    for (const block of [damage('43/100'), damage('49/100'), [...damage('55/100'), '|-enditem|p2a: Magikarp|Sitrus Berry|[eat]'], ['|move|p1a: Pikachu|Splash|']]) {
      const { battle, body } = simAte();
      correctActivesFromProtocol(battle as never, block, protocol(kind, block));
      expect(body.item, block.join(' ')).toBe('');
    }
  });

  test('controls: a body without a Sitrus build, or still holding its item, is not touched', () => {
    const { battle, body } = simAte();
    body.set.item = 'Leftovers';
    correctActivesFromProtocol(battle as never, damage('55/100'), protocol(kind, damage('55/100')));
    expect(body.item).toBe('');
    const holding = board(format, kind);
    const holder = holding.sides[1].active[0]!;
    correctActivesFromProtocol(holding as never, damage('55/100'), protocol(kind, damage('55/100')));
    expect(holder.item).toBe('sitrusberry');
  });

  test('the door: a block with Windows line endings decides the same', () => {
    const { battle, body } = simAte();
    const block = damage('55/100').map(line => `${line}\r`);
    correctActivesFromProtocol(battle as never, block, protocol(kind, damage('55/100')));
    expect(body.item).toBe('sitrusberry');
  });
});

await loadSimMods('gen9championsou');

describe('the threshold is the simulator\'s: the rebuild restores the berry only where the simulator eats at no HP that shows the text, in every generation and the Champions mod', () => {
  const formats = [3, 4, 5, 6, 7, 8, 9].flatMap(gen => [`gen${gen}customgame`, `gen${gen}doublescustomgame`]).concat('gen9championscustomgame');
  const modes = [['percentages', true], ['pixels', false]] as const;
  for (const [format, [mode, percentages]] of formats.flatMap(format => modes.map(mode => [format, mode] as const))) {
    test(`${format} ${mode}`, () => {
      const kind = format.includes('doubles') ? 'doubles' : 'singles';
      if (!Dex.forFormat(format).items.get('sitrusberry').exists) return;
      const display = (b: LiveBattle) => { b.reportExactHP = false; b.reportPercentages = percentages; return b; };
      const battle = display(board(format, kind));
      const body = battle.sides[1].active[0]!;
      // The simulator, per HP: does its Update event eat the berry, and what does the log show for that HP?
      const byText = new Map<string, boolean[]>();
      for (let hp = Math.floor(body.maxhp * 0.3); hp <= Math.ceil(body.maxhp * 0.7); hp++) {
        body.setItem('sitrusberry');
        body.hp = hp;
        const text = body.getHealth().shared;
        battle.eachEvent('Update');
        (byText.get(text) ?? byText.set(text, []).get(text)!).push(body.item === '');
      }
      expect(byText.size).toBeGreaterThan(5);
      const inert = ![...byText.values()].some(ate => ate.some(Boolean));
      let restored = 0;
      for (const [text, ate] of byText) {
        const { battle: rebuilt, body: simBody } = (() => { const b = display(board(format, kind)); const s = b.sides[1].active[0]!; s.item = ''; return { battle: b, body: s }; })();
        const block = ['|move|p1a: Pikachu|Splash|', `|-damage|p2a: Magikarp|${text}`];
        correctActivesFromProtocol(rebuilt as never, block, protocol(kind, block));
        const back = simBody.item === 'sitrusberry';
        // Sound: the berry comes back only where the simulator eats at no HP that shows this text.
        if (back) expect(ate.some(Boolean), `${format} ${mode} ${text}`).toBe(false);
        if (back) restored++;
        // Useful: a text more than a display unit above the threshold (every HP of it keeps the berry) is restored.
        const [shownHp, shownMax] = text.split(' ')[0].split('/').map(Number);
        if (!inert && ate.every(value => !value) && shownHp / shownMax > 0.5 + 2 / shownMax) expect(back, `${format} ${mode} ${text}`).toBe(true);
      }
      // A generation whose Update event eats at no HP (gen 3 moves the berry to its residual) has no threshold to read: nothing comes back.
      if (inert) return expect(restored).toBe(0);
      expect(restored).toBeGreaterThan(0);
      expect(restored).toBeLessThan(byText.size);
    });
  }
});
