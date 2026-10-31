import type { Battle } from '@pkmn/sim';
import { monOf } from './dice-sweep-support';

/**
 * Round 82 (forced dice), lane A3b: the status checks the status sweep and the offer spec play. One check is a condition put on
 * the attacker (side p1, slot p1a) and the protocol lines that show the body going on (`yes`) or being stopped (`no`).
 */

/** A move of each kind the check precedes: physical, spread, a status move, a move that thaws its user (read from the Dex flag). */
export const CHECK_MOVES = ['tackle', 'rockslide', 'splash', 'flamewheel'];

export interface Check {
  /** The condition's id, as the die names it. */
  id: string;
  /** The first generation whose simulator draws this check in the turn. */
  from: number;
  start(battle: Battle): void;
  /** The protocol line of the body going on (yes) or being stopped (no). */
  yes: RegExp;
  no: RegExp;
}

export const attacker = (battle: Battle) => monOf(battle, 'p1a');
export const started = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`${what} did not start`);
};

export const CHECKS: Check[] = [
  { id: 'par', from: 1, start: b => started(attacker(b).setStatus('par'), 'paralysis'), yes: /^\|move\|p1a: /, no: /^\|cant\|p1a: [^|]*\|par/ },
  { id: 'frz', from: 3, start: b => started(attacker(b).setStatus('frz'), 'freeze'), yes: /^\|-curestatus\|p1a: [^|]*\|frz/, no: /^\|cant\|p1a: [^|]*\|frz/ },
  {
    id: 'attract', from: 2, start: b => started(attacker(b).addVolatile('attract', monOf(b, 'p2a')), 'infatuation'),
    yes: /^\|move\|p1a: /, no: /^\|cant\|p1a: [^|]*\|Attract/,
  },
  {
    id: 'confusion', from: 1, start: b => started(attacker(b).addVolatile('confusion'), 'confusion'),
    yes: /^\|move\|p1a: /, no: /^\|-damage\|p1a: [^|]*\|[^|]*\|\[from\] confusion/,
  },
];
