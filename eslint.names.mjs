// Round 72 (T236): the name ratchet, the rule names/no-new-dex-name.
//
// AGENTS.md, Rules for the code: game rules come from the simulator and the Dex; our code never reads species or move names.
// The rule counts the Dex name literals per file in packages/*/src against scripts/name-baseline.json, which only shrinks
// (scripts/update-name-baseline.mjs rewrites it). A pair that is not in the baseline fails; a pair that left the code does not.
// The reader is scripts/name-census.mjs. Its limit: it sees a new name per file, so a second `reflect` in a file that has one
// passes; scripts/twin-lists.mjs sees a new copy of a list across files.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadUniverse, literalName, ROOT } from './scripts/name-census.mjs';

let universe;
let shipped;

/** The baseline the repository ships, read once per process. */
function shippedBaseline() {
  shipped ??= JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'name-baseline.json'), 'utf8'));
  return shipped;
}

const rule = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { baseline: { type: 'object' } }, additionalProperties: false }],
    messages: {
      newName:
        'Dex name "{{text}}" ({{kind}}) is new in this file. Read the rule from the Dex or the simulator (AGENTS.md, Rules for the code), '
        + 'or hold the list to the Dex with a spec. A reviewed exception: eslint-disable-next-line names/no-new-dex-name -- reason',
    },
  },
  create(context) {
    universe ??= loadUniverse();
    const baseline = context.options[0]?.baseline ?? shippedBaseline();
    const file = path.relative(ROOT, path.resolve(ROOT, context.filename)).split(path.sep).join('/');
    const known = new Set(baseline.files?.[file] ?? []);
    const check = node => {
      const name = literalName(node, universe);
      if (name && !known.has(name.id)) {
        context.report({ node, messageId: 'newName', data: { text: name.text, kind: name.kind } });
      }
    };
    return { Literal: check, TemplateLiteral: check };
  },
};

export default { rules: { 'no-new-dex-name': rule } };
