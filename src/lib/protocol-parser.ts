import { Battle } from '@pkmn/client';
import { Generations, type GenerationNum } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { DamageObservation, HiddenPowerEvidence, SpeedOrderObservation, TurnSnapshot, PokemonSnapshot, SideSnapshot, FieldSnapshot } from '../types';
import type { Pokemon, Side, Field } from '@pkmn/client';

const gens = new Generations(Dex);

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

export function parseReplayLog(log: string): TurnSnapshot[] {
  return parseReplayLogWithObservations(log).snapshots;
}

const SCREEN_IDS = ['reflect', 'lightscreen', 'auroraveil'];

function hpFractionOf(text: string): number | null {
  if (!text) return null;
  if (text.startsWith('0')) return 0;
  const match = text.match(/^(\d+)\/(\d+)/);
  if (!match) return null;
  const denom = parseInt(match[2], 10);
  return denom > 0 ? parseInt(match[1], 10) / denom : null;
}

export function parseReplayLogWithObservations(log: string): {
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
} {
  const battle = new Battle(gens);
  const lines = log.split('\n');
  const snapshots: TurnSnapshot[] = [];
  const observations: DamageObservation[] = [];
  const speedOrders: SpeedOrderObservation[] = [];
  const hpEvidence: HiddenPowerEvidence[] = [];
  let currentTurnLines: string[] = [];
  let singles = true;
  let genNum: GenerationNum = 9;
  // Speed-order evidence: the first two |move| lines of a singles turn prove
  // effective speed order — but only when nothing else could explain it.
  let speedTurn = 0;
  let turnMovers: { side: 'p1' | 'p2'; species: string; cleanFirst: boolean; cleanSecond: boolean }[] = [];
  let switchedThisTurn = new Set<string>();
  let actedThisTurn = new Set<string>();
  // DIRECTIONAL contamination, read at decision time: an observation drops
  // only when the factor could EXPLAIN the observed order — a speed-RAISING
  // factor (Tailwind, +spe stages, paradox boosters) on the FIRST mover, or
  // a speed-LOWERING factor (paralysis, −spe stages) on the SECOND. The
  // kept directions are IMPLIED constraints: outrunning a Tailwind-doubled
  // opponent outruns its base speed a fortiori, and a paralyzed mon moving
  // first won the race at a quarter of its speed. Trick Room inverts order
  // outright and same-turn entries are unknowable at order time — both
  // stay bilateral. (Paradox boosters are VOLATILES, not stat stages; any
  // variant counts as a raiser and none as a lowerer.)
  type ClientIdent = Parameters<Battle['getPokemon']>[0];
  const speedContaminatedAt = (ident: string, role: 'first' | 'second'): boolean => {
    const mon = battle.getPokemon(ident as ClientIdent);
    if (!mon) return true;
    if ((battle.field.pseudoWeather as Record<string, unknown>)['trickroom']) return true;
    if (switchedThisTurn.has(ident)) return true;
    if (role === 'first') {
      const side = ident.startsWith('p1') ? battle.p1 : battle.p2;
      const paradox = Object.keys((mon.volatiles ?? {}) as Record<string, unknown>)
        .some(key => /^(protosynthesis|quarkdrive)/.test(key));
      return paradox || (mon.boosts.spe ?? 0) > 0 ||
        !!(side.sideConditions as Record<string, unknown>)['tailwind'];
    }
    return mon.status === 'par' || (mon.boosts.spe ?? 0) < 0;
  };
  const flushSpeedOrder = () => {
    const [first, second] = turnMovers;
    if (first && second && first.cleanFirst && second.cleanSecond &&
      first.side !== second.side && first.species && second.species) {
      speedOrders.push({
        firstSide: first.side, firstSpecies: first.species,
        secondSide: second.side, secondSpecies: second.species,
        turn: speedTurn,
      });
    }
    turnMovers = [];
    switchedThisTurn = new Set();
    actedThisTurn = new Set();
  };
  // The pending move context: crits and multi-hits disqualify its damage.
  let lastMove: {
    attacker: string; target: string; moveId: string;
    crit: boolean; observationIndex: number | null; damageCount: number;
    /** The attacker's speed-evidence cleanliness at move time. */
    speedClean: boolean;
    attackerSide: 'p1' | 'p2';
    attackerSpecies: string;
    /** Effectiveness marker seen for this move (HP-type evidence, ⑤). */
    effectiveness?: 'super' | 'resisted';
  } | null = null;

  // Take initial snapshot at turn 0 (before any turns)
  let capturedInitial = false;

  for (const line of lines) {
    currentTurnLines.push(line);

    if (line.startsWith('|gametype|')) {
      singles = line.split('|')[2]?.trim() === 'singles';
    } else if (line.startsWith('|gen|')) {
      const parsed = parseInt(line.split('|')[2] ?? '9', 10);
      if (parsed >= 1 && parsed <= 9) genNum = parsed as GenerationNum;
    } else if (line.startsWith('|move|')) {
      const parts = line.split('|');
      // Read the mover BEFORE battle.add — status/boosts at decision time.
      const ident = parts[2] ?? '';
      const side: 'p1' | 'p2' = ident.startsWith('p1') ? 'p1' : 'p2';
      const mover = ident ? battle.getPokemon(ident as ClientIdent) : undefined;
      const moveId = (parts[3] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const priority = gens.get(genNum).moves.get(moveId)?.priority ?? 0;
      // Nonzero priority breaks the race premise in EITHER role — order
      // across priority brackets says nothing about speed.
      const cleanFirst = priority === 0 && !speedContaminatedAt(ident, 'first');
      const cleanSecond = priority === 0 && !speedContaminatedAt(ident, 'second');
      lastMove = parts[2] && parts[4]
        ? {
          attacker: parts[2], target: parts[4], moveId,
          crit: false, observationIndex: null, damageCount: 0,
          speedClean: cleanFirst, attackerSide: side, attackerSpecies: mover?.speciesForme ?? '',
        }
        : null;
      if (singles && ident) {
        actedThisTurn.add(ident);
        turnMovers.push({ side, species: mover?.speciesForme ?? '', cleanFirst, cleanSecond });
      }
    } else if (line.startsWith('|-supereffective|')) {
      if (lastMove && (line.split('|')[2] ?? '') === lastMove.target) lastMove.effectiveness = 'super';
    } else if (line.startsWith('|-resisted|')) {
      if (lastMove && (line.split('|')[2] ?? '') === lastMove.target) lastMove.effectiveness = 'resisted';
    } else if (line.startsWith('|-crit|')) {
      if (lastMove) lastMove.crit = true;
    } else if (
      /^\|(?:-miss|-immune|-fail|-end|switch|drag|turn|upkeep|cant|faint)\|/.test(line) ||
      (line.startsWith('|-activate|') && line.includes('confusion'))
    ) {
      // KO before the victim ever acted: a chosen switch would have resolved
      // BEFORE the attack and left a line, so the victim chose a move and
      // lost the speed race — the attacker was faster (GPL T36: Noivern KO'd
      // Iron Valiant before it moved; two-move-line extraction cannot see
      // this, yet it is how players actually read speed).
      if (singles && line.startsWith('|faint|') && lastMove) {
        const victim = line.split('|')[2] ?? '';
        if (victim === lastMove.target && victim !== lastMove.attacker &&
          lastMove.speedClean && !actedThisTurn.has(victim) &&
          !speedContaminatedAt(victim, 'second')) {
          const victimMon = battle.getPokemon(victim as ClientIdent);
          if (victimMon) {
            speedOrders.push({
              firstSide: lastMove.attackerSide, firstSpecies: lastMove.attackerSpecies,
              secondSide: victim.startsWith('p1') ? 'p1' : 'p2',
              secondSpecies: victimMon.speciesForme,
              turn: speedTurn,
            });
          }
        }
      }
      // A typeless Hidden Power that bounced off an immunity is type
      // evidence — capture it before the context dies (spec ⑤ 2a).
      if (line.startsWith('|-immune|') && lastMove && lastMove.moveId === 'hiddenpower' &&
        (line.split('|')[2] ?? '') === lastMove.target) {
        const defender = battle.getPokemon(lastMove.target as ClientIdent);
        if (defender) {
          hpEvidence.push({
            attackerSide: lastMove.attackerSide, attackerSpecies: lastMove.attackerSpecies,
            defenderSpecies: defender.speciesForme, marker: 'immune',
          });
        }
      }
      // Action boundary: a bare |-damage| after any of these (confusion
      // self-hit, Future Sight resolution, residuals) belongs to no pending
      // move — attributing it fabricates observations.
      lastMove = null;
      if (/^\|(?:switch|drag)\|/.test(line)) {
        switchedThisTurn.add(line.split('|')[2] ?? '');
      }
      if (/^\|(?:switch|drag|cant)\|/.test(line)) {
        actedThisTurn.add(line.split('|')[2] ?? '');
      }
    } else if (singles && line.startsWith('|-damage|') && !line.includes('[from]') && lastMove) {
      // Read the defender BEFORE battle.add applies the line — its current
      // client HP is the pre-hit value.
      const parts = line.split('|');
      const defenderIdent = parts[2] ?? '';
      // Self-targeting damage (Substitute/Belly Drum cost) is not a hit.
      if (defenderIdent === lastMove.target && lastMove.target !== lastMove.attacker) {
        lastMove.damageCount += 1;
        // HP-type evidence is effectiveness-only, so crits and multi-hits do
        // not disqualify it — but only the FIRST damage line of the move
        // counts (spec ⑤ 2a).
        if (lastMove.damageCount === 1 && lastMove.moveId === 'hiddenpower') {
          const defender = battle.getPokemon(defenderIdent as ClientIdent);
          if (defender) {
            hpEvidence.push({
              attackerSide: lastMove.attackerSide, attackerSpecies: lastMove.attackerSpecies,
              defenderSpecies: defender.speciesForme, marker: lastMove.effectiveness ?? 'neutral',
            });
          }
        }
        if (lastMove.damageCount > 1) {
          // Multi-hit: per-hit rolls are not individually solvable — drop
          // the first hit's observation too.
          if (lastMove.observationIndex !== null) {
            observations.splice(lastMove.observationIndex, 1);
            lastMove.observationIndex = null;
          }
        } else if (!lastMove.crit) {
          type Ident = Parameters<Battle['getPokemon']>[0];
          const defender = battle.getPokemon(defenderIdent as Ident);
          const attacker = battle.getPokemon(lastMove.attacker as Ident);
          const newFraction = hpFractionOf(parts[3] ?? '');
          if (defender && attacker && newFraction !== null && defender.maxhp > 0) {
            const preFraction = defender.hp / defender.maxhp;
            const observedFraction = preFraction - newFraction;
            if (observedFraction > 0) {
              const defenderSide = defenderIdent.startsWith('p1') ? battle.p1 : battle.p2;
              lastMove.observationIndex = observations.length;
              observations.push({
                attackerSpecies: attacker.speciesForme,
                defenderSpecies: defender.speciesForme,
                attackerSide: lastMove.attacker.startsWith('p1') ? 'p1' : 'p2',
                moveId: lastMove.moveId,
                observedFraction,
                attackerBoosts: { ...attacker.boosts },
                defenderBoosts: { ...defender.boosts },
                attackerStatus: attacker.status || '',
                screens: SCREEN_IDS.filter(id => (defenderSide.sideConditions as Record<string, unknown>)[id]),
                weather: battle.field.weather || '',
              });
            }
          }
        }
      }
    }

    // Feed line to battle client. Synthetic logs (file drop-ins written by
    // external tools, e.g. video reconstructions) can carry impossible
    // orderings — an event targeting a mon that already fainted, idents that
    // never switched in. One bad line must not kill the whole replay: skip
    // it and keep parsing.
    try {
      battle.add(line);
    } catch (error) {
      console.warn(`protocol-parser: skipping unparseable line "${line}":`,
        error instanceof Error ? error.message : error);
    }

    // Capture turn 0 snapshot on the first |start| or |turn|
    if (!capturedInitial && (line.startsWith('|start') || line.startsWith('|turn|'))) {
      if (line.startsWith('|start')) {
        capturedInitial = true;
        // Don't snapshot yet, wait for initial switches
        continue;
      }
    }

    if (line.startsWith('|turn|')) {
      const turnNum = parseInt(line.split('|')[2], 10);

      // If this is turn 1 and we haven't captured initial, do it now
      if (!capturedInitial) {
        capturedInitial = true;
      }

      // Snapshot the state at the START of this turn (after all previous actions resolved)
      snapshots.push({
        turn: turnNum,
        p1: snapshotSide(battle.p1),
        p2: snapshotSide(battle.p2),
        field: snapshotField(battle.field),
        log: [...currentTurnLines],
      });
      currentTurnLines = [];
      flushSpeedOrder();
      speedTurn = turnNum;
    }
  }
  flushSpeedOrder();

  // Capture final state after last turn (end of battle): the POST-GAME
  // end entry, stamped lastTurn + 1. Consumers deriving turn counts from
  // the snapshot list must not read it as a turn — see
  // replay-turns.finalPlayedTurn.
  if (currentTurnLines.length > 0) {
    snapshots.push({
      turn: (snapshots.length > 0 ? snapshots[snapshots.length - 1].turn + 1 : 0),
      p1: snapshotSide(battle.p1),
      p2: snapshotSide(battle.p2),
      field: snapshotField(battle.field),
      log: currentTurnLines,
    });
  }

  return { snapshots, observations, speedOrders, hpEvidence };
}
