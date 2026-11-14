/** "Main line" of the Line selector, and the way back from a variation's panel (round 89, G4d): the same turn on the main line, at most its last. */
export const mainLineTarget = (viewTurn: number, maxTurn: number) => ({ turn: Math.min(viewTurn, maxTurn), line: 'main' as const });
