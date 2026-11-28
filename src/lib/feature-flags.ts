// Off in every build unless a Vite env variable turns it on; a function, so a spec can switch it with `vi.stubEnv`.
const on = (value: unknown): boolean => value === '1' || value === 'true';

/** The "Opponent reads my move" checkbox and `hardMode`; off, a stored `hardMode: true` reads as unset. */
export const opponentReadsEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_OPPONENT_READS);
