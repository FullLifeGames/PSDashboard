import { Battle } from '@pkmn/client';
import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { DamageObservation, TurnSnapshot, PokemonSnapshot, SideSnapshot, FieldSnapshot } from '../types';
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
} {
  const battle = new Battle(gens);
  const lines = log.split('\n');
  const snapshots: TurnSnapshot[] = [];
  const observations: DamageObservation[] = [];
  let currentTurnLines: string[] = [];
  let singles = true;
  // The pending move context: crits and multi-hits disqualify its damage.
  let lastMove: {
    attacker: string; target: string; moveId: string;
    crit: boolean; observationIndex: number | null; damageCount: number;
  } | null = null;

  // Take initial snapshot at turn 0 (before any turns)
  let capturedInitial = false;

  for (const line of lines) {
    currentTurnLines.push(line);

    if (line.startsWith('|gametype|')) {
      singles = line.split('|')[2]?.trim() === 'singles';
    } else if (line.startsWith('|move|')) {
      const parts = line.split('|');
      lastMove = parts[2] && parts[4]
        ? {
          attacker: parts[2], target: parts[4],
          moveId: (parts[3] ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
          crit: false, observationIndex: null, damageCount: 0,
        }
        : null;
    } else if (line.startsWith('|-crit|')) {
      if (lastMove) lastMove.crit = true;
    } else if (
      /^\|(?:-miss|-immune|-fail|-end|switch|drag|turn|upkeep|cant|faint)\|/.test(line) ||
      (line.startsWith('|-activate|') && line.includes('confusion'))
    ) {
      // Action boundary: a bare |-damage| after any of these (confusion
      // self-hit, Future Sight resolution, residuals) belongs to no pending
      // move — attributing it fabricates observations.
      lastMove = null;
    } else if (singles && line.startsWith('|-damage|') && !line.includes('[from]') && lastMove) {
      // Read the defender BEFORE battle.add applies the line — its current
      // client HP is the pre-hit value.
      const parts = line.split('|');
      const defenderIdent = parts[2] ?? '';
      // Self-targeting damage (Substitute/Belly Drum cost) is not a hit.
      if (defenderIdent === lastMove.target && lastMove.target !== lastMove.attacker) {
        lastMove.damageCount += 1;
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
    }
  }

  // Capture final state after last turn (end of battle)
  if (currentTurnLines.length > 0) {
    snapshots.push({
      turn: (snapshots.length > 0 ? snapshots[snapshots.length - 1].turn + 1 : 0),
      p1: snapshotSide(battle.p1),
      p2: snapshotSide(battle.p2),
      field: snapshotField(battle.field),
      log: currentTurnLines,
    });
  }

  return { snapshots, observations };
}
