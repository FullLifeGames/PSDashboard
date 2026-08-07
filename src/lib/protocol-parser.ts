import { Battle } from '@pkmn/client';
import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { TurnSnapshot, PokemonSnapshot, SideSnapshot, FieldSnapshot } from '../types';
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
  const battle = new Battle(gens);
  const lines = log.split('\n');
  const snapshots: TurnSnapshot[] = [];
  let currentTurnLines: string[] = [];

  // Take initial snapshot at turn 0 (before any turns)
  let capturedInitial = false;

  for (const line of lines) {
    currentTurnLines.push(line);

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

  return snapshots;
}
