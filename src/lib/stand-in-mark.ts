import { createContext, useContext } from 'react';
import { speciesBaseId, type GameRules, type OpponentTeamInfo, type RevealedPokemonInfo } from '@fulllifegames/replay-core';
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

/**
 * Round 89 (lane B, #117): a Random Battle has no teammate statistics; its stand-ins come from the format's random-set data and say so
 * in the words of their mark. `RANDOM_SET_DETAIL` is the provenance replay-core's fill writes on the body's moves (a spec reads the fill's
 * output through this lookup, so the two strings cannot drift).
 */
export const RANDOM_SET_DETAIL = 'random-set data';
export const RANDOM_SET_MARK = 'Not revealed (guessed from random-set data)';
export const RANDOM_SET_TITLE = "The log never showed this Pokémon. The game draws its teams from random sets, so the engine plays one draw from the format's random-set data: species, level, role, moves, ability and item. Edit it or paste your team to replace the guess.";
const RANDOM_SET_BADGE_TITLE = `${RANDOM_SET_MARK}. ${RANDOM_SET_TITLE}`;

export type GuessedSide = 'p1' | 'p2';

/**
 * What a guessed body wears: the short word on a tile, the title that explains it, and the text of the All choices list. A teammate
 * stand-in (round 88) and a bring guess (round 89, #124) differ in where the guess comes from, so each has its own words.
 */
export interface StandInMark {
  badge: string;
  title: string;
  text: string;
  /** The sentence the stats panel shows beside the text (round 89: the title without the text it repeats). */
  explanation: string;
}

/** The mark of a body of this side and species, or null when the body is no guess. */
export type IsGuessed = (side: GuessedSide, species: string) => StandInMark | null;

const NONE: IsGuessed = () => null;

const STAND_IN: StandInMark = { badge: STAND_IN_BADGE, title: STAND_IN_BADGE_TITLE, text: STAND_IN_MARK, explanation: STAND_IN_TITLE };
const RANDOM_SET: StandInMark = { badge: STAND_IN_BADGE, title: RANDOM_SET_BADGE_TITLE, text: RANDOM_SET_MARK, explanation: RANDOM_SET_TITLE };

/** The mark of one body of the team infos: null for a body the log showed, the random-set words for a guess from the random-set data, else the teammate words. */
export function standInMarkOf(poke: RevealedPokemonInfo): StandInMark | null {
  if (!poke.standIn) return null;
  return poke.moves?.some(move => move.sourceDetail === RANDOM_SET_DETAIL) ? RANDOM_SET : STAND_IN;
}

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
  const marksOf = (info: OpponentTeamInfo | null) => new Map((info?.pokemon ?? []).flatMap(poke => {
    const mark = standInMarkOf(poke);
    return mark ? [[speciesBaseId(poke.species, rules), mark] as const] : [];
  }));
  const standIns = { p1: marksOf(p1), p2: marksOf(p2) };
  const bring = {
    p1: new Map(bringGuessesOf(worlds, 'p1').map(guess => [speciesBaseId(guess.species, rules), guess.title])),
    p2: new Map(bringGuessesOf(worlds, 'p2').map(guess => [speciesBaseId(guess.species, rules), guess.title])),
  };
  if (standIns.p1.size + standIns.p2.size + bring.p1.size + bring.p2.size === 0) return NONE;
  return (side, species) => {
    const base = speciesBaseId(species, rules);
    const title = bring[side].get(base);
    if (title !== undefined) return { badge: STAND_IN_BADGE, title, text: BRING_GUESS_TEXT, explanation: title };
    return standIns[side].get(base) ?? null;
  };
}

export const GuessedBodiesContext = createContext<IsGuessed>(NONE);

export const useIsGuessed = (): IsGuessed => useContext(GuessedBodiesContext);
