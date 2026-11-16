import { describe, expect, test } from 'vitest';
import { summarizeTurn } from '../src/summary';
import { buildScene, GAMES, READERS, type Scene } from './read-against-click-builder';

/**
 * Round 89 (user ruling B6a, wording G-Q1 a and G-Q2 b of the plan): what the card says when a side's play cleared the payoff
 * margin but did not beat the safe line against the reply that came, and what a read that did beat it adds. The scenes are the
 * corpus turns of read-against-click.spec.ts. Singles and doubles share every sentence; the labels come from the shared builder.
 */

interface Words {
  played: string;
  punisher: string;
  click: string;
  safe: string;
  /** The verb phrase the card uses after the name: "played" plus the played label. */
  verbPlayed: string;
}

const WORDS: Record<string, Words> = {
  singles: {
    played: 'U-turn', punisher: 'Taunt', click: 'Protect', safe: 'Recover', verbPlayed: 'played U-turn',
  },
  doubles: {
    played: 'U-turn→Zamazenta-Crowned + Earth Power→Zamazenta-Crowned',
    punisher: 'Pollen Puff→Zamazenta-Crowned + Wide Guard',
    click: 'Icy Wind + Protect',
    safe: 'Grassy Glide→Calyrex-Shadow and Earth Power→Calyrex-Shadow',
    verbPlayed: 'played U-turn→Zamazenta-Crowned and Earth Power→Zamazenta-Crowned',
  },
};

describe.each(GAMES)('%s', (game, make) => {
  const words = WORDS[game];
  describe.each(READERS)('read by %s', reader => {
    const build = (scene: Pick<Scene, 'kind' | 'playedCell' | 'safeCell'> & Partial<Scene>) => {
      const built = buildScene(make, { reader, ...scene });
      const name = built.names[reader === 'p1' ? 0 : 1];
      return { ...built, name, text: summarizeTurn(built.analysis, built.names) };
    };
    const risk = (name: string, gap: string) =>
      `${name} ${words.verbPlayed}: a risk that went unpunished. The floor priced in ${words.punisher}; ${words.click} came instead. ` +
      `Against it the safe ${words.safe} ${gap}`;

    test('a mistake paid three turns later reads as a risk that went unpunished, with the gap to the safe line (2663093831 t8)', () => {
      const { name, text } = build({ kind: 'mistake', playedCell: 0.072, safeCell: 0.327, window: true });
      expect(text).toContain(risk(name, 'was worth +13% more.'));
      expect(text).not.toContain('a read that paid off');
      expect(text).not.toContain('as a read: its floor risked');
    });

    test('an inaccuracy risk that kept ground says it in the inaccuracy slot, and no inaccuracy note follows (2663093831 t6)', () => {
      const { name, text } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454 });
      expect(text).toContain(risk(name, 'was worth +6% more.'));
      expect(text).not.toContain('was an inaccuracy');
    });

    test('a gamble whose safe line did as well reads "did as well" (648453 t8)', () => {
      const { name, text } = build({ kind: 'gamble', playedCell: 0.189, safeCell: 0.19 });
      expect(text).toContain(risk(name, 'did as well.'));
    });

    test('a failing side that lost ground keeps the card it had: neither the risk sentence nor the inaccuracy note (2663093831 t1, t2)', () => {
      const { text } = build({ kind: 'inaccuracy', playedCell: 0.325, safeCell: 0.454, lostGround: 0.1 });
      expect(text).not.toContain('a risk that went unpunished');
      expect(text).not.toContain('was an inaccuracy');
    });

    test('a read that beat the safe line names both numbers of the fair test (562428 t12 shape)', () => {
      const { name, text } = build({ kind: 'gamble', playedCell: 0.4, safeCell: 0.22 });
      expect(text).toContain(`${name} ${words.verbPlayed}: a read that paid off, +13% over the safe ${words.safe} (54% guaranteed).`);
      expect(text).toContain(`${words.click} came instead, and against it the play beat the safe line by +9%.`);
      expect(text).not.toContain('a risk that went unpunished');
    });

    test('a read without a matrix keeps today\'s sentence: no cell, no comparison clause', () => {
      const { text } = build({ kind: 'gamble', playedCell: 0.4, safeCell: 0.22, noMatrix: true });
      expect(text).toContain('a read that paid off');
      expect(text).not.toContain('beat the safe line');
    });
  });
});
