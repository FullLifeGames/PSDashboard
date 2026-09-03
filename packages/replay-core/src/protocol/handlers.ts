import type { Battle, Pokemon, Side, Field } from '@pkmn/client';
import type { GenerationNum } from '@pkmn/data';
import type { PokemonSnapshot, SideSnapshot, FieldSnapshot } from '../types.ts';
import { flushSpeedOrder, gens, speedContaminatedAt, type ClientIdent, type ParserState, type PendingMove } from './parser-state.ts';
import { toId } from '../ids.ts';

const SCREEN_IDS = ['reflect', 'lightscreen', 'auroraveil'];

function hpFractionOf(text: string): number | null {
  if (!text) return null;
  if (text.startsWith('0')) return 0;
  const match = text.match(/^(\d+)\/(\d+)/);
  if (!match) return null;
  const denom = parseInt(match[2], 10);
  return denom > 0 ? parseInt(match[1], 10) / denom : null;
}

function snapshotPokemon(mon: Pokemon): PokemonSnapshot {
  return {
    name: mon.name,
    speciesForme: mon.speciesForme,
    hp: mon.hp,
    maxhp: mon.maxhp,
    hpPercent: mon.maxhp > 0 ? Math.round((mon.hp / mon.maxhp) * 100) : 0,
    status: mon.status || '',
    fainted: mon.fainted,
    isActive: mon.isActive(),
    boosts: { ...mon.boosts },
    moves: mon.moveSlots.map(m => m.name),
    ability: mon.ability || '',
    item: mon.item || '',
    terastallized: mon.terastallized || '',
    level: mon.level,
    gender: mon.gender || '',
  };
}

function snapshotSide(side: Side): SideSnapshot {
  return {
    name: side.name as string,
    id: side.n === 0 ? 'p1' : 'p2',
    pokemon: side.team.map(snapshotPokemon),
    sideConditions: JSON.parse(JSON.stringify(side.sideConditions)),
  };
}

function snapshotField(field: Field): FieldSnapshot {
  return {
    weather: field.weather || '',
    terrain: field.terrain || '',
    pseudoWeather: JSON.parse(JSON.stringify(field.pseudoWeather)),
  };
}

export function handleGametype(state: ParserState, line: string) {
  state.singles = line.split('|')[2]?.trim() === 'singles';
}

export function handleGen(state: ParserState, line: string) {
  const parsed = parseInt(line.split('|')[2] ?? '9', 10);
  if (parsed >= 1 && parsed <= 9) state.genNum = parsed as GenerationNum;
}

/**
 * Nonzero priority breaks the race premise in EITHER role — order
 * across priority brackets says nothing about speed.
 */
function speedCleanliness(state: ParserState, ident: string, moveId: string): { cleanFirst: boolean; cleanSecond: boolean } {
  const priority = gens.get(state.genNum).moves.get(moveId)?.priority ?? 0;
  const cleanFirst = priority === 0 && !speedContaminatedAt(state, ident, 'first');
  const cleanSecond = priority === 0 && !speedContaminatedAt(state, ident, 'second');
  return { cleanFirst, cleanSecond };
}

function pendingMoveFor(
  parts: string[], moveId: string, side: 'p1' | 'p2', speciesForme: string, cleanFirst: boolean,
): PendingMove | null {
  return parts[2] && parts[4]
    ? {
      attacker: parts[2], target: parts[4], moveId,
      crit: false, observationIndex: null, damageCount: 0,
      speedClean: cleanFirst, attackerSide: side, attackerSpecies: speciesForme,
    }
    : null;
}

export function handleMove(state: ParserState, line: string) {
  const { battle } = state;
  const parts = line.split('|');
  // Read the mover BEFORE battle.add — status/boosts at decision time.
  const ident = parts[2] ?? '';
  const side: 'p1' | 'p2' = ident.startsWith('p1') ? 'p1' : 'p2';
  const mover = ident ? battle.getPokemon(ident as ClientIdent) : undefined;
  const moveId = toId(parts[3] ?? '');
  const { cleanFirst, cleanSecond } = speedCleanliness(state, ident, moveId);
  const speciesForme = mover?.speciesForme ?? '';
  state.lastMove = pendingMoveFor(parts, moveId, side, speciesForme, cleanFirst);
  if (state.singles && ident) {
    state.actedThisTurn.add(ident);
    state.turnMovers.push({ side, species: speciesForme, cleanFirst, cleanSecond });
  }
}

export function handleSuperEffective(state: ParserState, line: string) {
  if (state.lastMove && (line.split('|')[2] ?? '') === state.lastMove.target) state.lastMove.effectiveness = 'super';
}

export function handleResisted(state: ParserState, line: string) {
  if (state.lastMove && (line.split('|')[2] ?? '') === state.lastMove.target) state.lastMove.effectiveness = 'resisted';
}

export function handleCrit(state: ParserState) {
  if (state.lastMove) state.lastMove.crit = true;
}

export function isActionBoundary(line: string): boolean {
  return /^\|(?:-miss|-immune|-fail|-end|switch|drag|turn|upkeep|cant|faint)\|/.test(line) ||
    (line.startsWith('|-activate|') && line.includes('confusion'));
}

/**
 * KO before the victim ever acted: a chosen switch would have resolved
 * BEFORE the attack and left a line, so the victim chose a move and
 * lost the speed race — the attacker was faster (GPL T36: Noivern KO'd
 * Iron Valiant before it moved; two-move-line extraction cannot see
 * this, yet it is how players actually read speed).
 */
function recordFaintSpeedEvidence(state: ParserState, line: string) {
  const { lastMove, battle } = state;
  if (!(state.singles && line.startsWith('|faint|') && lastMove)) return;
  const victim = line.split('|')[2] ?? '';
  if (victim === lastMove.target && victim !== lastMove.attacker &&
    lastMove.speedClean && !state.actedThisTurn.has(victim) &&
    !speedContaminatedAt(state, victim, 'second')) {
    const victimMon = battle.getPokemon(victim as ClientIdent);
    if (victimMon) {
      state.speedOrders.push({
        firstSide: lastMove.attackerSide, firstSpecies: lastMove.attackerSpecies,
        secondSide: victim.startsWith('p1') ? 'p1' : 'p2',
        secondSpecies: victimMon.speciesForme,
        turn: state.speedTurn,
      });
    }
  }
}

/** A typeless Hidden Power that bounced off an immunity is type
 *  evidence — capture it before the context dies (spec ⑤ 2a). */
function recordImmuneHiddenPower(state: ParserState, line: string) {
  const { lastMove, battle } = state;
  if (line.startsWith('|-immune|') && lastMove && lastMove.moveId === 'hiddenpower' &&
    (line.split('|')[2] ?? '') === lastMove.target) {
    const defender = battle.getPokemon(lastMove.target as ClientIdent);
    if (defender) {
      state.hpEvidence.push({
        attackerSide: lastMove.attackerSide, attackerSpecies: lastMove.attackerSpecies,
        defenderSpecies: defender.speciesForme, marker: 'immune',
      });
    }
  }
}

/**
 * Action boundary: a bare |-damage| after any of these (confusion
 * self-hit, Future Sight resolution, residuals) belongs to no pending
 * move — attributing it fabricates observations.
 */
export function handleActionBoundary(state: ParserState, line: string) {
  recordFaintSpeedEvidence(state, line);
  recordImmuneHiddenPower(state, line);
  state.lastMove = null;
  if (/^\|(?:switch|drag)\|/.test(line)) {
    state.switchedThisTurn.add(line.split('|')[2] ?? '');
  }
  if (/^\|(?:switch|drag|cant)\|/.test(line)) {
    state.actedThisTurn.add(line.split('|')[2] ?? '');
  }
}

/** HP-type evidence is effectiveness-only, so crits and multi-hits do
 *  not disqualify it — but only the FIRST damage line of the move
 *  counts (spec ⑤ 2a). */
function recordHiddenPowerHit(state: ParserState, defenderIdent: string) {
  const { lastMove, battle } = state;
  if (!lastMove) return;
  if (lastMove.damageCount === 1 && lastMove.moveId === 'hiddenpower') {
    const defender = battle.getPokemon(defenderIdent as ClientIdent);
    if (defender) {
      state.hpEvidence.push({
        attackerSide: lastMove.attackerSide, attackerSpecies: lastMove.attackerSpecies,
        defenderSpecies: defender.speciesForme, marker: lastMove.effectiveness ?? 'neutral',
      });
    }
  }
}

/** Read the defender BEFORE battle.add applies the line — its current
 *  client HP is the pre-hit value. */
function recordDamageObservation(state: ParserState, parts: string[], defenderIdent: string) {
  const { lastMove, battle } = state;
  if (!lastMove) return;
  type Ident = Parameters<Battle['getPokemon']>[0];
  const defender = battle.getPokemon(defenderIdent as Ident);
  const attacker = battle.getPokemon(lastMove.attacker as Ident);
  const newFraction = hpFractionOf(parts[3] ?? '');
  if (defender && attacker && newFraction !== null && defender.maxhp > 0) {
    const preFraction = defender.hp / defender.maxhp;
    const observedFraction = preFraction - newFraction;
    if (observedFraction > 0) {
      const defenderSide = defenderIdent.startsWith('p1') ? battle.p1 : battle.p2;
      lastMove.observationIndex = state.observations.length;
      state.observations.push({
        attackerSpecies: attacker.speciesForme,
        defenderSpecies: defender.speciesForme,
        attackerSide: lastMove.attacker.startsWith('p1') ? 'p1' : 'p2',
        moveId: lastMove.moveId,
        observedFraction,
        lethal: newFraction === 0,
        attackerBoosts: { ...attacker.boosts },
        defenderBoosts: { ...defender.boosts },
        attackerStatus: attacker.status || '',
        screens: SCREEN_IDS.filter(id => (defenderSide.sideConditions as Record<string, unknown>)[id]),
        weather: battle.field.weather || '',
      });
    }
  }
}

export function handleDamage(state: ParserState, line: string) {
  const { lastMove } = state;
  if (!lastMove) return;
  const parts = line.split('|');
  const defenderIdent = parts[2] ?? '';
  // Self-targeting damage (Substitute/Belly Drum cost) is not a hit.
  if (defenderIdent === lastMove.target && lastMove.target !== lastMove.attacker) {
    lastMove.damageCount += 1;
    recordHiddenPowerHit(state, defenderIdent);
    if (lastMove.damageCount > 1) {
      // Multi-hit: per-hit rolls are not individually solvable — drop
      // the first hit's observation too.
      if (lastMove.observationIndex !== null) {
        state.observations.splice(lastMove.observationIndex, 1);
        lastMove.observationIndex = null;
      }
    } else if (!lastMove.crit) {
      recordDamageObservation(state, parts, defenderIdent);
    }
  }
}

/**
 * Feed line to battle client. Synthetic logs (file drop-ins written by
 * external tools, e.g. video reconstructions) can carry impossible
 * orderings — an event targeting a mon that already fainted, idents that
 * never switched in. One bad line must not kill the whole replay: skip
 * it and keep parsing. Then capture the turn snapshot on |turn| lines.
 */
export function feedLine(state: ParserState, line: string) {
  const { battle } = state;
  try {
    battle.add(line);
  } catch (error) {
    console.warn(`protocol-parser: skipping unparseable line "${line}":`,
      error instanceof Error ? error.message : error);
  }

  // Capture turn 0 snapshot on the first |start| or |turn|
  if (!state.capturedInitial && (line.startsWith('|start') || line.startsWith('|turn|'))) {
    if (line.startsWith('|start')) {
      state.capturedInitial = true;
      // Don't snapshot yet, wait for initial switches
      return;
    }
  }

  if (line.startsWith('|turn|')) {
    const turnNum = parseInt(line.split('|')[2], 10);

    // If this is turn 1 and we haven't captured initial, do it now
    if (!state.capturedInitial) {
      state.capturedInitial = true;
    }

    // Snapshot the state at the START of this turn (after all previous actions resolved)
    state.snapshots.push({
      turn: turnNum,
      p1: snapshotSide(battle.p1),
      p2: snapshotSide(battle.p2),
      field: snapshotField(battle.field),
      log: [...state.currentTurnLines],
    });
    state.currentTurnLines = [];
    flushSpeedOrder(state);
    state.speedTurn = turnNum;
  }
}

/**
 * Capture final state after last turn (end of battle): the POST-GAME
 * end entry, stamped lastTurn + 1. Consumers deriving turn counts from
 * the snapshot list must not read it as a turn — see
 * replay-turns.finalPlayedTurn.
 */
export function appendFinalSnapshot(state: ParserState) {
  const { battle, snapshots, currentTurnLines } = state;
  if (currentTurnLines.length > 0) {
    snapshots.push({
      turn: (snapshots.length > 0 ? snapshots[snapshots.length - 1].turn + 1 : 0),
      p1: snapshotSide(battle.p1),
      p2: snapshotSide(battle.p2),
      field: snapshotField(battle.field),
      log: currentTurnLines,
    });
  }
}
