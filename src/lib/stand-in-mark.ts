import { createContext, useContext } from 'react';
import { speciesBaseId, type GameRules, type OpponentTeamInfo } from '@fulllifegames/replay-core';

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

/** Whether a side's body of this species is a stand-in. */
export type IsGuessed = (side: GuessedSide, species: string) => boolean;

const NONE: IsGuessed = () => false;

/**
 * The stand-ins of both sides' team infos as a lookup by side and species. Species match by the game's own Dex (`speciesBaseId` with
 * the replay's rules), as the bench does, never by a display name. Returns the shared "none" lookup when no body is a guess.
 */
export function guessedBodies(p1: OpponentTeamInfo | null, p2: OpponentTeamInfo | null, rules: GameRules): IsGuessed {
  const basesOf = (info: OpponentTeamInfo | null) =>
    new Set((info?.pokemon ?? []).filter(poke => poke.standIn).map(poke => speciesBaseId(poke.species, rules)));
  const sets = { p1: basesOf(p1), p2: basesOf(p2) };
  if (sets.p1.size === 0 && sets.p2.size === 0) return NONE;
  return (side, species) => sets[side].has(speciesBaseId(species, rules));
}

export const GuessedBodiesContext = createContext<IsGuessed>(NONE);

export const useIsGuessed = (): IsGuessed => useContext(GuessedBodiesContext);
