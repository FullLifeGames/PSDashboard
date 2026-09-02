/** Standard stage multiplier: +1 → 1.5x, −1 → 0.67x. */
export const stageMultiplier = (stage: number) => (stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage));
