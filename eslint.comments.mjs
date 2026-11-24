// The rule comments/no-history. AGENTS.md, Rules for the code: a comment never carries history (a round, a ruling, a gate, a date, a
// T-number, an issue number, "used to"); history lives in docs/completed/ and the commit log. The patterns are in
// scripts/comment-lib.mjs (HISTORY_PATTERNS). Comments that code reads are never history: an eslint directive, a `// oracle:` marker
// line, a TypeScript or test-runner pragma, a reference, a shebang, a legal header.
//
// The rule counts per file against comment-ratchet.json, which only falls
// (scripts/update-lint-ratchet.mjs rewrites it): a file with more history lines than its baseline reports every one of them, a file at
// or below it reports none. The rule's rows are in test/regression/lint-rules.spec.ts.
import path from 'node:path';
import { historyHits } from './scripts/comment-lib.mjs';
import { commentBaseline, ROOT } from './scripts/comment-counts.mjs';

let shipped;

/** The history baseline the repository ships, read once per process. */
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

export default { rules: { 'no-history': rule } };
