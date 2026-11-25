// The one reader of Dex name literals in the sources; the name ratchet, the twin detector and their specs import it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Dex } from '@pkmn/dex';
import tseslint from 'typescript-eslint';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_LENGTH = 4;
const MAX_LENGTH = 40;

const toID = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Display names and ids of the four Dex kinds of the default generation; types, natures and stats stay out. */
export function loadUniverse() {
  const kinds = [['species', Dex.species], ['move', Dex.moves], ['item', Dex.items], ['ability', Dex.abilities]];
  const vocabulary = new Set();
  for (const type of Dex.types.all()) vocabulary.add(type.id);
  for (const nature of Dex.natures.all()) vocabulary.add(nature.id);
  for (const stat of Dex.stats.ids()) vocabulary.add(stat);
  for (const table of [Dex.stats.names, Dex.stats.shortNames, Dex.stats.mediumNames]) {
    for (const label of Object.values(table)) vocabulary.add(toID(label));
  }
  const byText = new Map();
  for (const [kind, table] of kinds) {
    for (const entry of table.all()) {
      if (!entry.exists || vocabulary.has(entry.id)) continue;
      const found = { id: entry.id, kind };
      if (!byText.has(entry.id)) byText.set(entry.id, found);
      if (!byText.has(entry.name)) byText.set(entry.name, found);
    }
  }
  return {
    size: byText.size,
    /** `{ id, kind }` of an exact display name or id of 4 to 40 characters, otherwise null. */
    kindOf(text) {
      if (typeof text !== 'string' || text.length < MIN_LENGTH || text.length > MAX_LENGTH) return null;
      return byText.get(text) ?? null;
    },
  };
}

const MODULE_SOURCE_PARENTS = new Set(['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression', 'TSExternalModuleReference']);

/** The text of a node when it is a plain string, else null. A module specifier is no name. */
export function plainText(node) {
  const parent = node.parent;
  if (node.type === 'Literal') {
    if (typeof node.value !== 'string') return null;
    if (parent && MODULE_SOURCE_PARENTS.has(parent.type)) return null;
    if (parent?.type === 'TSLiteralType' && parent.parent?.type === 'TSImportType') return null;
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

export function literalName(node, universe) {
  const text = plainText(node);
  if (text === null) return null;
  const found = universe.kindOf(text);
  return found ? { ...found, text } : null;
}

function* nodesOf(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    yield node;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range' || value === null || typeof value !== 'object') continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string') {
          child.parent = node;
          stack.push(child);
        }
      }
    }
  }
}

export function parseSource(text, file) {
  return tseslint.parser.parseForESLint(text, { ecmaFeatures: { jsx: file.endsWith('.tsx') }, filePath: file }).ast;
}

export function namePairs(ast, universe) {
  const found = [];
  for (const node of nodesOf(ast)) {
    const name = literalName(node, universe);
    if (name) found.push({ ...name, line: node.loc.start.line });
  }
  return found.sort((a, b) => a.line - b.line);
}

const REVIEWED = /eslint-disable-(next-)?line\b.*\bnames\/no-new-dex-name\b/;

/** The lines a reviewed exception covers, which the census leaves out as the rule does. */
export function reviewedLines(ast) {
  const lines = new Set();
  for (const comment of ast.comments ?? []) {
    const match = REVIEWED.exec(comment.value);
    if (match) lines.add(match[1] ? comment.loc.end.line + 1 : comment.loc.start.line);
  }
  return lines;
}

export function filePairs(text, file, universe) {
  const ast = parseSource(text, file);
  const reviewed = reviewedLines(ast);
  return namePairs(ast, universe).filter(pair => !reviewed.has(pair.line));
}

/** Posix paths relative to `root` of every .ts and .tsx file under the folders (a folder may hold a `*`). */
export function sourceFiles(root, folders) {
  const out = [];
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(child);
    }
  };
  for (const folder of folders) {
    const star = folder.indexOf('*');
    if (star < 0) {
      walk(path.join(root, folder), folder);
      continue;
    }
    const head = folder.slice(0, star);
    const tail = folder.slice(star + 1);
    if (!existsSync(path.join(root, head))) continue;
    for (const entry of readdirSync(path.join(root, head), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(root, head, entry.name, tail), `${head}${entry.name}${tail}`);
    }
  }
  return out.sort();
}

export const NAME_FOLDERS = ['packages/*/src'];

/** `{ "<file>": ["<id>", ...] }`: the sorted distinct ids per file, files without a name left out. */
export function censusOf(root, universe) {
  const census = {};
  for (const file of sourceFiles(root, NAME_FOLDERS)) {
    const ids = new Set(filePairs(readFileSync(path.join(root, file), 'utf8'), file, universe).map(pair => pair.id));
    if (ids.size) census[file] = [...ids].sort();
  }
  return census;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const universe = loadUniverse();
  const census = censusOf(ROOT, universe);
  const pairs = Object.values(census).reduce((sum, ids) => sum + ids.length, 0);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ files: census }, null, 2));
  } else {
    const rows = Object.entries(census).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [file, ids] of rows) console.log(`${String(ids.length).padStart(4)}  ${file}  ${ids.slice(0, 6).join(',')}${ids.length > 6 ? ',...' : ''}`);
    console.log(`\n${pairs} (file, id) pairs in ${rows.length} files of ${NAME_FOLDERS.join(', ')}; universe ${universe.size} names and ids`);
  }
}
