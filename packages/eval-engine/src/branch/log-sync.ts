import type { SimBattle, SimPokemon } from './types.ts';
import { normalizeBattleOnlyFormeId, slotLetter } from './team-order.ts';
import { toId } from '@fulllifegames/replay-core';

function replayLogPrefixThroughTurn(replayLog: string, targetTurn: number): string[] {
  const prefix: string[] = [];
  let foundTargetTurn = false;

  for (const rawLine of replayLog.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    prefix.push(line);
    if (line === `|turn|${targetTurn}`) {
      foundTargetTurn = true;
      break;
    }
  }

  if (!foundTargetTurn) prefix.push(`|turn|${targetTurn}`);
  return prefix;
}

export function replaceLogWithReplayPrefix(log: string[], replayLog: string, targetTurn: number) {
  log.splice(0, log.length, ...replayLogPrefixThroughTurn(replayLog, targetTurn));
}

interface LoggedActive {
  side: 'p1' | 'p2';
  activeSlot: number;
  nameId: string;
  speciesId: string;
}

function parseLoggedActive(line: string): LoggedActive | null {
  const match = line.match(/^\|(switch|drag|replace)\|(p[12])([a-d]):\s*([^|]*)\|([^|]*)\|/);
  if (!match) return null;

  return {
    side: match[2] as 'p1' | 'p2',
    activeSlot: match[3].charCodeAt(0) - 'a'.charCodeAt(0),
    nameId: toId(match[4]),
    speciesId: normalizeBattleOnlyFormeId(toId(match[5].split(',')[0] || '')),
  };
}

function activeMatchesLog(pokemon: SimPokemon, logged: LoggedActive | undefined): boolean {
  if (!logged) return false;
  const speciesId = normalizeBattleOnlyFormeId(toId(pokemon.species?.name || ''));
  return logged.nameId === toId(pokemon.name || '') || logged.speciesId === speciesId;
}

function formatPokemonDetails(pokemon: SimPokemon): string {
  const details = [pokemon.species.name];
  if (pokemon.gender === 'M' || pokemon.gender === 'F') details.push(pokemon.gender);
  if (pokemon.level && pokemon.level !== 100) details.push(`L${pokemon.level}`);
  return details.join(', ');
}

function formatPokemonHpStatus(pokemon: SimPokemon): string {
  if (pokemon.fainted || pokemon.hp <= 0) return '0 fnt';
  const hp = pokemon.maxhp > 0 ? `${pokemon.hp}/${pokemon.maxhp}` : '100/100';
  return pokemon.status ? `${hp} ${pokemon.status}` : hp;
}

function activeSwitchLine(side: 'p1' | 'p2', activeSlot: number, pokemon: SimPokemon): string {
  return `|switch|${side}${slotLetter(activeSlot)}: ${pokemon.name}|${formatPokemonDetails(pokemon)}|${formatPokemonHpStatus(pokemon)}`;
}

function insertBeforeTurn(log: string[], targetTurn: number, lines: string[]) {
  if (lines.length === 0) return;

  let turnIndex = -1;
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index] === `|turn|${targetTurn}`) {
      turnIndex = index;
      break;
    }
  }

  if (turnIndex >= 0) {
    log.splice(turnIndex, 0, ...lines);
  } else {
    log.push(...lines);
  }
}

export function syncLogActivesFromBattle(log: string[], battle: SimBattle, targetTurn: number): string[] {
  const latestLogged = new Map<string, LoggedActive>();
  for (const line of log) {
    const logged = parseLoggedActive(line);
    if (!logged) continue;
    latestLogged.set(`${logged.side}:${logged.activeSlot}`, logged);
  }

  const corrections: string[] = [];
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex === 0 ? 'p1' : 'p2';
    for (const [activeSlot, pokemon] of battle.sides[sideIndex].active.entries()) {
      if (!pokemon || pokemon.fainted) continue;
      const logged = latestLogged.get(`${side}:${activeSlot}`);
      if (activeMatchesLog(pokemon, logged)) continue;
      corrections.push(activeSwitchLine(side, activeSlot, pokemon));
    }
  }

  insertBeforeTurn(log, targetTurn, corrections);
  return corrections;
}
