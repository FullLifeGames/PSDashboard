import { createContext, useContext } from 'react';
import { logRules, type GameRules } from '@fulllifegames/replay-core';

export const ReplayRulesContext = createContext<GameRules>(logRules(''));

export const useReplayRules = (): GameRules => useContext(ReplayRulesContext);
