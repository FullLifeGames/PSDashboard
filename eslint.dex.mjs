// The global Dex is Generation 9 without a mod: read rules through rulesDex(gen, mod) or battle.dex instead.
const SOURCES = new Set(['@pkmn/sim', '@pkmn/dex']);

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
