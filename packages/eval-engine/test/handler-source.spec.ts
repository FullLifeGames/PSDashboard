import { describe, expect, test } from 'vitest';
import { idsOfStrings, lex, readsOfCode } from '../src/dex-facts/handler-source';
import { tokensOf } from '../src/dex-facts/state-readers';

/**
 * Round 89 (#149): the five ways the first scan of a handler's source read what the handler does not read, each found by
 * packages/eval-engine/test/state-readers-built.spec.ts (the Dex built with the app's Vite settings against the Dex in Node: 5,547 rows
 * differed). The rows here pin each one on its own source, and the same source written the way a production build writes it.
 */
const reads = (source: string): string[] => [...tokensOf(source)].sort();

describe('the scan reads the code of a handler and nothing else', () => {
  test('a write is no read, and the name of the written property is not cut short', () => {
    expect(reads('function (pokemon) { pokemon.duration = 3; pokemon.hp -= 1; return pokemon.status; }')).toEqual(['status']);
  });

  test('a comment names no property', () => {
    expect(reads('function (a) { // e.g. Disguise\n return a.hp; /* see a.speed */ }')).toEqual(['hp']);
  });

  test('the dots of a spread are no property read, whatever the operand is called', () => {
    expect(reads('function (target) { return [...target.side.pokemon]; }')).toEqual(['pokemon', 'side']);
    expect(reads('function (e) { return [...e.side.pokemon]; }')).toEqual(['pokemon', 'side']);
  });

  test('the text of a string and the receiver of a string method are no reads; the code of a template is', () => {
    expect(reads('function (a) { return `acupressure.afteryou.roar`.split(`.`).includes(a.id); }')).toEqual(['id', 'includes']);
    expect(reads("function (a) { this.add('-activate', a, 'move: Aromatherapy [of] e.g.'); return `${a.hp}${a.maxhp < 6 ? `` : a.status}`; }")).toEqual(['add', 'hp', 'maxhp', 'status']);
  });

  test('a bracket access with a string key reads the key, in any quote a build writes', () => {
    for (const quote of ["'", '"', '`']) expect(reads(`function (a) { return a.volatiles[${quote}substitute${quote}] && b[${quote}atk${quote}]; }`)).toEqual(['atk', 'substitute', 'volatiles']);
    expect(reads("function (a) { a.boosts['atk'] = 0; return ['Normal']; }")).toEqual(['boosts']);
  });

  test('a regular expression with a quote in it does not open a string', () => {
    expect(reads('function (a) { return /[\'"]/.test(a.name) && a.hp; }')).toEqual(['hp', 'name']);
  });
});

describe('the ids a handler names', () => {
  const ids = (source: string): string[] => [...idsOfStrings(lex(source).strings)].sort();

  test('a string that is one id, and a list a build joined into one string', () => {
    expect(ids("function (a) { a.addVolatile('substitute'); return ['roar', 'copycat'].includes(a.id); }")).toEqual(['copycat', 'roar', 'substitute']);
    expect(ids('function (a) { a.addVolatile(`substitute`); return `roar.copycat`.split(`.`).includes(a.id); }')).toEqual(['copycat', 'roar', 'substitute']);
  });

  test('a message, a bracket key and an object key are no ids', () => {
    expect(ids("function (a) { this.add('-activate', a, 'move: Roar'); a.volatiles['leechseed']; return { 'mist': 1 }; }")).toEqual([]);
  });

  test('the code of a source keeps its template expressions', () => {
    expect(readsOfCode(lex('function () { return `${this.hpPower}`; }').code)).toEqual(new Set(['hpPower']));
  });
});
