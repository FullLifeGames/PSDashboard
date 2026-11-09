import { createContext, useContext } from 'react';
import { speciesBaseId, type GameRules, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import type { BringWorld } from '@fulllifegames/eval-engine';

/**
 * Round 88 (F, #101): the marker of a stand-in, a body the log never showed that the format's teammate statistics name. The stats panel,
 * the switch tiles of the turn dock, its "All choices" list and the lead picker read these words from here.
 */
export const STAND_IN_MARK = 'Not revealed (guessed from teammate usage)';
export const STAND_IN_TITLE = 'The log never showed this Pokémon. The statistics of the format name it as a likely teammate, so the engine plays with it. Edit it or paste your team to replace the guess.';

/** The short word on a tile; its title carries the panel's full wording. */
export const STAND_IN_BADGE = 'guessed';
export const STAND_IN_BADGE_TITLE = `${STAND_IN_MARK}. ${STAND_IN_TITLE}`;

export type GuessedSide = 'p1' | 'p2';

/**
 * What a guessed body wears: the short word on a tile, the title that explains it, and the text of the All choices list. A teammate
 * stand-in (round 88) and a bring guess (round 89, #124) differ in where the guess comes from, so each has its own words.
 */
export interface StandInMark {
  badge: string;
  title: string;
  text: string;
}

/** The mark of a body of this side and species, or null when the body is no guess. */
export type IsGuessed = (side: GuessedSide, species: string) => StandInMark | null;

const NONE: IsGuessed = () => null;

const STAND_IN: StandInMark = { badge: STAND_IN_BADGE, title: STAND_IN_BADGE_TITLE, text: STAND_IN_MARK };

/** Round 89 (#124): the text of a bring guess in the All choices list. */
export const BRING_GUESS_TEXT = 'Not fielded (guessed from usage)';

/** Round 89 (#124): the title of a bring guess: what the log lacks, who the engine plays, who else it could be. */
export function bringGuessTitle(species: string, others: string[], count: number): string {
  const lacking = count === 1 ? "this player's last Pokémon" : `${count} of this player's Pokémon`;
  const lead = `The log never showed ${lacking}. The engine plays ${species}`;
  if (others.length === 0) return `${lead}, the only body the team preview leaves.`;
  return `${lead}, the likeliest by usage (also possible: ${others.join(', ')}), and blends the other cases into its values.`;
}

/**
 * The bring guesses of one side: the trailing names of the heaviest world's list, each with the guesses the lighter worlds make
 * instead. Empty when the side fielded all it brought.
 */
function bringGuessesOf(worlds: readonly BringWorld[] | null | undefined, side: GuessedSide): { species: string; title: string }[] {
  const heaviest = worlds?.[0];
  const count = heaviest?.guessed[side] ?? 0;
  if (!worlds || !heaviest || count === 0) return [];
  const guesses = heaviest[side].slice(-count);
  const others = [...new Set(worlds.slice(1).flatMap(world => world[side].slice(-world.guessed[side])))].filter(name => !guesses.includes(name));
  return guesses.map(species => ({ species, title: bringGuessTitle(species, others, count) }));
}

/**
 * The guessed bodies of both sides as a lookup by side and species: the stand-ins of the team infos (a body the log never showed)
 * and, in a short-side game, the heaviest world's bring guesses. Species match by the game's own Dex (`speciesBaseId` with the
 * replay's rules), as the bench does, never by a display name. Returns the shared "none" lookup when no body is a guess.
 */
export function guessedBodies(
  p1: OpponentTeamInfo | null, p2: OpponentTeamInfo | null, rules: GameRules, worlds?: readonly BringWorld[] | null,
): IsGuessed {
  const basesOf = (info: OpponentTeamInfo | null) =>
    new Set((info?.pokemon ?? []).filter(poke => poke.standIn).map(poke => speciesBaseId(poke.species, rules)));
  const standIns = { p1: basesOf(p1), p2: basesOf(p2) };
  const bring = {
    p1: new Map(bringGuessesOf(worlds, 'p1').map(guess => [speciesBaseId(guess.species, rules), guess.title])),
    p2: new Map(bringGuessesOf(worlds, 'p2').map(guess => [speciesBaseId(guess.species, rules), guess.title])),
  };
  if (standIns.p1.size + standIns.p2.size + bring.p1.size + bring.p2.size === 0) return NONE;
  return (side, species) => {
    const base = speciesBaseId(species, rules);
    const title = bring[side].get(base);
    if (title !== undefined) return { badge: STAND_IN_BADGE, title, text: BRING_GUESS_TEXT };
    return standIns[side].has(base) ? STAND_IN : null;
  };
}

export const GuessedBodiesContext = createContext<IsGuessed>(NONE);

export const useIsGuessed = (): IsGuessed => useContext(GuessedBodiesContext);
