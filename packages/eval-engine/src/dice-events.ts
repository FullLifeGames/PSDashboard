/**
 * Protocol-visible dice events, per turn — the anchor that keeps the
 * report's luck claims honest. The chance ledger (chanceDelta) is a
 * RESIDUAL: rolls, crits, reveals, and model error all land in it, so its
 * net can point away from the dice a player actually saw (the draft game:
 * net chance toward the winner while both crits and both Flame Body burns
 * hit the winner). These turns carry an event the protocol itself shows to
 * be rolled; summing the ledger over them grounds or contradicts the claim.
 *
 * Deliberately coarse: damage rolls emit no protocol marker (a max-roll
 * game shows no event here), and a bare |-status| can come from a
 * deterministic source the line does not name. The report therefore treats
 * the anchor asymmetrically — only an ACTIVE contradiction demotes a luck
 * claim; a weak or empty anchor changes nothing. Extensible with confusion
 * self-hits and OHKO moves if a game ever needs them.
 */

/** |cant| reasons that are dice: full paralysis, flinch, freeze, sleep.
 * (Rest sleep is fixed-length — a documented over-inclusion.) */
const CHANCE_CANT = new Set(['slp', 'par', 'frz', 'flinch']);

function diceLine(line: string): boolean {
  if (line.startsWith('|-crit|') || line.startsWith('|-miss|')) return true;
  if (line.startsWith('|move|') && line.includes('|[miss]')) return true;
  if (line.startsWith('|cant|')) return CHANCE_CANT.has(line.split('|')[3] ?? '');
  if (line.startsWith('|-status|')) {
    // A named non-ability source (move: Rest, item: Flame Orb, hazards) is
    // deterministic; a bare status (move secondary, direct status move) and
    // an ability source (Flame Body, Static) are rolled.
    const from = line.split('|').find(part => part.startsWith('[from]'));
    return from === undefined || from.startsWith('[from] ability:');
  }
  return false;
}

/** Turns whose protocol carries at least one visible dice event; the index is by turn (entry 0 stays empty). */
export function diceEventTurns(turnEventsIndex: readonly (readonly string[])[]): Set<number> {
  const turns = new Set<number>();
  turnEventsIndex.forEach((lines, turn) => {
    if (turn >= 1 && lines.some(diceLine)) turns.add(turn);
  });
  return turns;
}
