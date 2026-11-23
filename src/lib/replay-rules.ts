import { createContext, useContext } from 'react';
import { logRules, type GameRules } from '@fulllifegames/replay-core';

/** The generation and mod of the loaded replay's log (Generation 9 without a |gen| line), for components that read a species' data from the Dex. */
export const ReplayRulesContext = createContext<GameRules>(logRules(''));

export const useReplayRules = (): GameRules => useContext(ReplayRulesContext);
