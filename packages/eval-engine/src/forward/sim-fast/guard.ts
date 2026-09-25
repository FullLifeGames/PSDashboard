/**
 * Round 59 (T91): the hash gate. The pre-check and the rule-table lever rely
 * on these @pkmn/sim functions doing exactly what 0.10.11 does. Under Node
 * the layer hashes their source (FNV-1a over Function.prototype.toString:
 * synchronous, no node:crypto in engine code) at first use and steps back
 * (status hash-mismatch) when one changed; forced mode throws. A browser
 * bundle prints minified source, so there the pin and CI stand guard and the
 * host decides (state.ts).
 */
import { Battle, Dex, Pokemon, toID } from '@pkmn/sim';
import { breakSimFast, onNode } from './state.ts';

type HashTable = Readonly<Record<string, string>>;
export interface SimProtos { battle: object; pokemon: object; field: object; formats: object }

const FUNCTIONS: readonly [keyof SimProtos, string, readonly string[]][] = [
  ['battle', 'Battle', ['runEvent', 'findEventHandlers', 'findPokemonEventHandlers', 'findSideEventHandlers',
    'findFieldEventHandlers', 'findBattleEventHandlers', 'getCallback', 'modify']],
  ['pokemon', 'Pokemon', ['getStatus', 'getAbility', 'getItem']],
  ['field', 'Field', ['getWeather', 'getTerrain']],
  ['formats', 'DexFormats', ['getRuleTable']],
];

/** @pkmn/sim 0.10.11; the ESM and CJS builds print three of these functions differently. */
export const PINNED_SIM_HASHES: Readonly<Record<'esm' | 'cjs', HashTable>> = {
  esm: {
    'Battle.runEvent': '46869e91', 'Battle.findEventHandlers': 'a7e357a8', 'Battle.findPokemonEventHandlers': 'e6d2de11',
    'Battle.findSideEventHandlers': 'a46b9cf0', 'Battle.findFieldEventHandlers': 'a8542bd1',
    'Battle.findBattleEventHandlers': '12e97530', 'Battle.getCallback': '33f2c687', 'Battle.modify': 'db4b25ab',
    'Pokemon.getStatus': '63d4338d', 'Pokemon.getAbility': '48320f6f', 'Pokemon.getItem': '969bd06d',
    'Field.getWeather': '6cdee693', 'Field.getTerrain': '7c6d1d5d', 'DexFormats.getRuleTable': '5e3c222d',
  },
  cjs: {
    'Battle.runEvent': 'c72b7ce6', 'Battle.findEventHandlers': '791d0893', 'Battle.findPokemonEventHandlers': 'e6d2de11',
    'Battle.findSideEventHandlers': 'a46b9cf0', 'Battle.findFieldEventHandlers': 'a8542bd1',
    'Battle.findBattleEventHandlers': '12e97530', 'Battle.getCallback': '6012f4ce', 'Battle.modify': 'db4b25ab',
    'Pokemon.getStatus': '63d4338d', 'Pokemon.getAbility': '48320f6f', 'Pokemon.getItem': '969bd06d',
    'Field.getWeather': '6cdee693', 'Field.getTerrain': '7c6d1d5d', 'DexFormats.getRuleTable': '5e3c222d',
  },
};

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashSources(protos: SimProtos): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [key, owner, names] of FUNCTIONS) {
    const proto = protos[key] as Record<string, unknown>;
    for (const name of names) table[`${owner}.${name}`] = fnv1a(String(proto[name]));
  }
  return table;
}

let pinned: Readonly<Record<string, HashTable>> = PINNED_SIM_HASHES;
let verdict: boolean | null = null;

/** Test hook: another pin table (null restores the real one); the next use checks again. */
export function setPinnedHashes(table: Readonly<Record<string, HashTable>> | null): void {
  pinned = table ?? PINNED_SIM_HASHES;
  verdict = null;
}

function check(): boolean {
  const field = new Battle({ formatid: toID('gen9customgame') }).field;
  const actual = hashSources({
    battle: Battle.prototype, pokemon: Pokemon.prototype,
    field: Object.getPrototypeOf(field) as object, formats: Object.getPrototypeOf(Dex.formats) as object,
  });
  const tables = Object.values(pinned);
  const match = tables.some(table => Object.keys(table).every(key => table[key] === actual[key]));
  if (match) return true;
  const changed = Object.keys(actual).filter(key => tables.every(table => table[key] !== actual[key]));
  // No cached verdict before the break: forced mode throws there, and must throw again on the next use.
  breakSimFast('hash-mismatch', `changed: ${changed.join(', ')}`);
  return false;
}

/** True when the layer may run: in a browser always (the host decided), under Node when one build's pins match. */
export function guardPasses(): boolean {
  if (verdict === null) verdict = onNode() ? check() : true;
  return verdict;
}
