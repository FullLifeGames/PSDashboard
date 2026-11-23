// The rule prose/no-dash. The text the app shows is active and dash-free (AGENTS.md, Working with the user): the report's sentence frames
// (engine prose sources) and every label of src/components carry no em dash, no en dash and no entity of either. The rule reads string
// literals, template pieces and JSX text; comments are no text and stay out. A lone em dash is the app's empty value (a missing number):
// as a whole string or as the only child of a JSX element it passes with `emptyValue: true`. A dash piece between expressions in JSX is a
// sentence joint, not an empty value, and counts. The rule's rows are in test/regression/lint-rules.spec.ts.
const DASH = /[—–]|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;/i;
const EMPTY_VALUE = '—';

const hasContent = child => !(child.type === 'JSXText' && child.value.trim() === '');

const rule = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { emptyValue: { type: 'boolean' } }, additionalProperties: false }],
    messages: { dash: 'A dash separates nothing in text the app shows: write the sentence with a comma, a colon or two sentences (AGENTS.md, Working with the user).' },
  },
  create(context) {
    const emptyValue = context.options[0]?.emptyValue ?? false;
    const flag = node => context.report({ node, messageId: 'dash' });
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (emptyValue && node.value.trim() === EMPTY_VALUE) return;
        if (DASH.test(node.value) || DASH.test(node.raw)) flag(node);
      },
      TemplateElement(node) {
        if (DASH.test(node.value.cooked ?? '') || DASH.test(node.value.raw)) flag(node);
      },
      JSXText(node) {
        if (!DASH.test(node.value)) return;
        const parent = node.parent;
        const soleChild = parent.type === 'JSXElement' && parent.children.filter(hasContent).length === 1;
        if (!(emptyValue && soleChild && node.value.trim() === EMPTY_VALUE)) flag(node);
      },
    };
  },
};

export default { rules: { 'no-dash': rule } };
