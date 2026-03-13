import { useState, useCallback } from 'react';

export function useTimeline(maxTurn: number) {
  const [currentTurn, setCurrentTurn] = useState(1);

  const goToTurn = useCallback((turn: number) => {
    setCurrentTurn(Math.max(1, Math.min(turn, maxTurn)));
  }, [maxTurn]);

  const nextTurn = useCallback(() => {
    setCurrentTurn(prev => Math.min(prev + 1, maxTurn));
  }, [maxTurn]);

  const prevTurn = useCallback(() => {
    setCurrentTurn(prev => Math.max(prev - 1, 1));
  }, []);

  return { currentTurn, goToTurn, nextTurn, prevTurn };
}
