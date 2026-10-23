import { createContext, useContext } from 'react';
import { logRules, type GameRules } from '@fulllifegames/replay-core';

/**
 * Round 75 (T160): the generation and mod of the loaded replay, for the components that read a species' data from the Dex
 * (a sprite's file name). The workspace provides the rules of its replay's log; the default is a log without a |gen| line (Generation 9).
 */
export const ReplayRulesContext = createContext<GameRules>(logRules(''));

export const useReplayRules = (): GameRules => useContext(ReplayRulesContext);
