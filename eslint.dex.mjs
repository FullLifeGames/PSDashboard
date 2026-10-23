// Round 75 (T160): the rule dex/no-global-dex-read.
//
// AGENTS.md, Rules for the code: game rules come from the simulator and the Dex, and the Dex of a game is the Dex of its generation
// and mod. The global `Dex` of @pkmn/sim (and the one of @pkmn/dex) is Generation 9 on Scarlet/Violet: it knows neither the type
// chart of Gen 1 to 5, a species' older stats and abilities, nor the Pokémon Champions mod. A package reads rules only through
// replay-core's resolver (`rulesDex(gen, mod)` in packages/replay-core/src/rules-dex.ts) or a battle's own `battle.dex`.
// The rule reports every value reference to an imported `Dex`; the type `typeof Dex` is no read. The resolver's own file is
// exempt in eslint.config.js. It replaces the census spec of round 67 (no exceptions, user 23.10.2026).
const SOURCES = new Set(['@pkmn/sim', '@pkmn/dex']);

/** Whether a node sits inside a `typeof X` type query, which names the type of the Dex and reads nothing. */
function inTypeQuery(node) {
  for (let up = node.parent; up; up = up.parent) {
    if (up.type === 'TSTypeQuery') return true;
    if (/Statement|Declaration$|Expression$/.test(up.type) && up.type !== 'TSQualifiedName') return false;
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      globalDex:
        'Read rules through the resolver: rulesDex(gen, mod) from replay-core (or a battle\'s own dex), not the global Dex, which is Generation 9 '
        + 'on Scarlet/Violet. A format registry (Dex.formats) comes from simFormats().',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (!SOURCES.has(node.source.value) || node.importKind === 'type') return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier' || specifier.imported.name !== 'Dex' || specifier.importKind === 'type') continue;
          const [variable] = context.sourceCode.getDeclaredVariables(specifier);
          for (const reference of variable?.references ?? []) {
            if (!inTypeQuery(reference.identifier)) context.report({ node: reference.identifier, messageId: 'globalDex' });
          }
        }
      },
    };
  },
};

export default { rules: { 'no-global-dex-read': rule } };
