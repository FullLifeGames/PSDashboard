import path from 'node:path';
import { historyHits, shapeHits } from './scripts/comment-lib.mjs';
import { commentBaseline, ROOT } from './scripts/comment-counts.mjs';

let shipped;

const shippedBaseline = () => (shipped ??= commentBaseline().history);

const rule = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { baseline: { type: 'object' } }, additionalProperties: false }],
    messages: {
      history:
        'This comment carries history ({{pattern}}); {{count}} such lines in this file, {{allowed}} allowed by comment-ratchet.json. '
        + 'History lives in docs/completed/ and the commit log (AGENTS.md, Rules for the code, comments).',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? shippedBaseline();
    const file = path.relative(ROOT, path.resolve(ROOT, context.filename)).split(path.sep).join('/');
    const sourceCode = context.sourceCode;
    return {
      'Program:exit'() {
        const found = [];
        for (const comment of sourceCode.getAllComments()) {
          for (const hit of historyHits(sourceCode.getText(comment))) {
            found.push({ line: comment.loc.start.line + hit.line, pattern: hit.pattern });
          }
        }
        const allowed = baseline[file] ?? 0;
        if (found.length <= allowed) return;
        for (const { line, pattern } of found) {
          context.report({ loc: { start: { line, column: 0 }, end: { line, column: 1 } }, messageId: 'history', data: { pattern, count: found.length, allowed } });
        }
      },
    };
  },
};

const shape = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 40 },
          lines: { type: 'integer', minimum: 1 },
          exportLines: { type: 'integer', minimum: 1 },
          localDoc: { enum: ['allow', 'forbid'] },
        },
        additionalProperties: false,
      },
    ],
    messages: { shape: '{{rule}}: {{detail}} (AGENTS.md, Rules for the code, comments).' },
  },
  create(context) {
    const options = context.options[0] ?? {};
    return {
      'Program:exit'() {
        for (const hit of shapeHits(context.sourceCode.text, context.filename, options)) {
          context.report({
            loc: { start: { line: hit.line, column: 0 }, end: { line: hit.line, column: 1 } },
            messageId: 'shape',
            data: { rule: hit.rule, detail: hit.message },
            fix: hit.fix ? fixer => fixer.replaceTextRange([hit.fix.start, hit.fix.end], hit.fix.text) : null,
          });
        }
      },
    };
  },
};

export default { rules: { 'no-history': rule, shape } };
