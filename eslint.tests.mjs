// A template title is read by its static parts: a number from test.each data or `${...}` is not seen.
import path from 'node:path';
import { TITLE_HISTORY_PATTERNS } from './scripts/comment-lib.mjs';

const ROW_ROOTS = new Set(['test', 'it', 'describe', 'suite']);
const MODIFIERS = new Set(['skip', 'only', 'fails', 'concurrent', 'sequential', 'todo', 'describe', 'serial', 'parallel', 'fixme', 'shuffle']);
const CURRIED = new Set(['each', 'for', 'skipIf', 'runIf']);

const FILE_HISTORY = /(?:^|[-.])(?:t\d{2,3}[a-z]?|r\d{2,3}[a-z]?|round-?\d+|issue-?\d+)(?=[-.])/;

const variableOf = (scope, name) => {
  for (let s = scope; s; s = s.upper) {
    const variable = s.set.get(name);
    if (variable) return variable;
  }
  return null;
};

function chainOf(node, scope, depth = 0) {
  const props = [];
  let curried = false;
  let at = node;
  for (;;) {
    if (at.type === 'MemberExpression' && !at.computed && at.property.type === 'Identifier') {
      props.unshift(at.property.name);
      at = at.object;
    } else if (at.type === 'CallExpression') {
      curried = true;
      at = at.callee;
    } else if (at.type === 'ChainExpression' || at.type === 'TSNonNullExpression' || at.type === 'TSAsExpression') {
      at = at.expression;
    } else if (at.type === 'ConditionalExpression') {
      const base = chainOf(at.consequent, scope, depth + 1) ?? chainOf(at.alternate, scope, depth + 1);
      return base && { root: base.root, props: [...base.props, ...props], curried: curried || base.curried };
    } else break;
  }
  if (at.type !== 'Identifier') return null;
  if (ROW_ROOTS.has(at.name)) return { root: at.name, props, curried };
  if (depth >= 4) return null;
  const init = variableOf(scope, at.name)?.defs[0]?.node?.init;
  const base = init && chainOf(init, scope, depth + 1);
  return base && { root: base.root, props: [...base.props, ...props], curried: curried || base.curried };
}

function isRowCall(call, scope) {
  const chain = chainOf(call.callee, scope);
  if (!chain || chain.props.some(prop => !MODIFIERS.has(prop) && !CURRIED.has(prop))) return false;
  const last = chain.props.at(-1);
  return !(last && CURRIED.has(last) && !chain.curried);
}

const staticParts = arg => (arg.type === 'Literal' ? [arg.value] : arg.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw));

const patternOf = text => TITLE_HISTORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];

const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      title:
        'This test title carries history ({{pattern}}). Name the behaviour; the round, the ticket and the ruling live in docs/completed/ '
        + 'and the commit log (AGENTS.md, "What earns a test", rule 3).',
      file:
        'This spec file name carries history ({{pattern}}). Name the module, with `<module>.<topic>.spec.ts` for a second file '
        + '(AGENTS.md, "What earns a test", rules 3 and 5).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const base = path.basename(context.filename);
    return {
      Program() {
        const match = /\.spec\.tsx?$/.test(base) ? base.match(FILE_HISTORY)?.[0] : undefined;
        if (!match) return;
        context.report({ loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }, messageId: 'file', data: { pattern: match.replace(/^[-.]/, '') } });
      },
      CallExpression(call) {
        const arg = call.arguments[0];
        const isString = arg?.type === 'Literal' && typeof arg.value === 'string';
        if (!isString && arg?.type !== 'TemplateLiteral') return;
        if (!isRowCall(call, sourceCode.getScope(call))) return;
        const pattern = staticParts(arg).map(patternOf).find(Boolean);
        if (pattern) context.report({ node: arg, messageId: 'title', data: { pattern } });
      },
    };
  },
};

export default { rules: { 'no-history': rule } };
