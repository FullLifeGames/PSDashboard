import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commentBaseline, commentLineCount, filesUnder, historyCounts, lineCounts, overBaseline, overLines, ROOT, shapeReport, shapeSources, workflowHistoryCounts } from '../../scripts/comment-counts.mjs';
import { historyLinesOf } from '../../scripts/comment-lib.mjs';

/**
 * The comment ratchets (scripts/comment-counts.mjs, scripts/comment-lib.mjs, AGENTS.md "Rules for the code", comments): the baselines
 * in comment-ratchet.json only fall. `npm run lint` holds the history baseline through the rule comments/no-history (its rows are in
 * lint-rules.spec.ts); `node scripts/update-lint-ratchet.mjs` lowers the baselines after a clean-up and `--allow-raise` raises one.
 * The line ratchet counts the lines that hold only a comment per project; `npm run lint` runs `node scripts/comment-counts.mjs`.
 * The tools read syntax, so no game type enters.
 */

/** A scratch repository layout with the given files (path from the root to text). */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'comment-counts-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('overBaseline', () => {
  test('a key above its baseline is listed, a key at or below it is not, a missing key counts from zero', () => {
    expect(overBaseline({ a: 3, b: 2 }, { a: 4, b: 2 })).toEqual([{ key: 'a', baseline: 3, count: 4 }]);
    expect(overBaseline({ a: 3 }, { a: 1 })).toEqual([]);
    expect(overBaseline({}, { c: 1 })).toEqual([{ key: 'c', baseline: 0, count: 1 }]);
  });
});

describe('historyLinesOf', () => {
  test('counts the comment lines that carry history, with their line numbers, and leaves strings and the comments code reads out', () => {
    const text = [
      '// since round 70 the cap is 40',
      "const a = 'round 74';",
      '/**',
      ' * A plain line.',
      ' * Fixed 13.10.2026.',
      ' */',
      '// eslint-disable-next-line no-console -- T163',
      'export const b = `#145`;',
    ].join('\n');
    expect(historyLinesOf(text, 'x.ts')).toEqual([{ line: 1, pattern: 'round' }, { line: 5, pattern: 'date' }]);
  });
});

describe('historyCounts', () => {
  test('counts per source file of the package and app folders, leaves clean files, tests and node_modules out', () => {
    const root = tree({
      'packages/eval-engine/src/a.ts': '// round 74\n// round 75\nexport const a = 1;\n',
      'packages/eval-engine/src/clean.ts': '// a game rule from the simulator\nexport const c = 1;\n',
      'packages/replay-core/src/deep/b.ts': '/* ruling 4 */\nexport const b = 1;\n',
      'src/ui.tsx': 'export const U = () => <p>{/* user gate */}</p>;\n',
      'src/note.css': '/* round 1 */\n',
      'packages/eval-engine/test/t.ts': '// round 9\n',
      'packages/eval-engine/src/node_modules/x.ts': '// round 9\n',
    });
    try {
      expect(historyCounts(root)).toEqual({
        'packages/eval-engine/src/a.ts': 2,
        'packages/replay-core/src/deep/b.ts': 1,
        'src/ui.tsx': 1,
      });
      expect(filesUnder(root, 'src', file => file.endsWith('.css'))).toEqual(['src/note.css']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('workflow comments', () => {
  const yaml = [
    '# one',
    'on: push # trailing, no',
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: |',
    '          echo "a # b" ${x#y}',
    '          # shell comment',
    '      - name: "quoted # not a comment"',
    '  # two',
  ].join('\n');

  test('counts the lines that hold only a # comment, a shell comment in a run block included; quotes and ${x#y} are no comment', () => {
    expect(commentLineCount(yaml, 'w.yml')).toBe(3);
  });

  test('reads history in a # comment, in a whole line and after a key', () => {
    const text = '# Round 90 (step E6, #222): three parts\non: push # since round 70\njobs: {}\n# a limit at twice the healthy time\n';
    expect(historyLinesOf(text, 'w.yml')).toEqual([{ line: 1, pattern: 'round' }, { line: 2, pattern: 'round' }]);
  });

  test('history is counted per workflow file under .github/workflows, and the repository holds it at zero', () => {
    const root = tree({
      '.github/workflows/a.yml': '# gate 31.10.2026\n# fine\non: push\n',
      '.github/workflows/b.yml': '# fine\non: push\n',
      'src/other.yml': '# round 1\n',
    });
    try {
      expect(workflowHistoryCounts(root)).toEqual({ '.github/workflows/a.yml': 1 });
      expect(historyCounts(root)).toEqual({ '.github/workflows/a.yml': 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(workflowHistoryCounts()).toEqual({});
  });
});

describe('shape of workflows and stylesheets', () => {
  const files = {
    '.github/workflows/three.yml': '# one\n# two\n# three\non: push\n',
    '.github/workflows/two.yml': '# one\n# two\n\n# three\non: push\n',
    'src/wide.css': `/* ${'x'.repeat(130)} */\n.a { color: red; }\n`,
    'src/fine.css': '/* one */\n.a { color: red; }\n',
    'src/app.tsx': '// not read here\n',
  };

  test('a run of three # lines and a 130-column stylesheet comment report; a run of two does not', () => {
    const root = tree(files);
    try {
      expect(shapeSources(root)).toEqual(['.github/workflows/three.yml', '.github/workflows/two.yml', 'src/fine.css', 'src/wide.css']);
      expect(shapeReport(root, shapeSources(root)).map(hit => `${hit.file}:${hit.line}:${hit.rule}`)).toEqual([
        '.github/workflows/three.yml:1:lines',
        'src/wide.css:1:wide',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--shape with files prints the hits and exits 1; a clean file exits 0', () => {
    const root = tree(files);
    const run = (file: string) =>
      spawnSync(process.execPath, [path.join(ROOT, 'scripts/comment-counts.mjs'), '--shape', path.join(root, file)], { encoding: 'utf8' });
    try {
      const bad = run('src/wide.css');
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('wide.css:1');
      expect(run('src/fine.css').status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('commentBaseline', () => {
  test('a missing file reads as empty baselines', () => {
    expect(commentBaseline('/nonexistent/comment-ratchet.json')).toEqual({ history: {} });
  });
});

describe('commentLineCount', () => {
  test('counts the non-blank lines that hold only a comment: line comments, block lines, JSX comment children; not a comment after code', () => {
    const text = [
      '// one',                                   // 1
      'const a = 1; // trailing, no',
      '',
      '/**',                                      // 2
      ' * three',                                 // 3
      '',
      ' */',                                      // 4
      "const b = '// not a comment';",
      'const c = `',
      '// inside a template',
      '`;',
      'const d = /\\/\\/ x/;',
      'const e = <p>',
      '  {/* a jsx comment */}',                  // 5
      '</p>;',
      '/* trailing block */ const f = 1;',
      '/* opens here',                            // 6, the next line is 7
      '   and ends here */',
    ].join('\n');
    expect(commentLineCount(text, 'x.tsx')).toBe(7);
  });

  test('a stylesheet counts the lines of its block comments', () => {
    expect(commentLineCount('/* a\n   b */\n.a { color: red; } /* c */\n.b {\n  /* d */\n}\n', 'x.css')).toBe(3);
  });
});

describe('lineCounts', () => {
  test('counts per project, keeps the app stylesheets apart and leaves the calibration ledger out', () => {
    const root = tree({
      'packages/eval-engine/src/a.ts': '// one\n// two\nexport const a = 1;\n',
      'src/app.tsx': '// three\nexport const b = 1;\n',
      'src/app.css': '/* four */\n.a {}\n',
      'test/regression/a.spec.ts': '// five\n',
      'test/regression/eval-calibration.spec.ts': '// ledger\n// ledger\n',
      'test/ui/u.spec.tsx': '// six\n',
    });
    try {
      expect(lineCounts(root)).toMatchObject({
        'source:eval-engine': 2,
        'source:replay-core': 0,
        'source:app': 1,
        'source:app-css': 1,
        'test:app': 1,
        'test:ui': 1,
        'test:e2e': 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('counts the workflows, the scripts and the root config files as projects of their own', () => {
    const root = tree({
      '.github/workflows/a.yml': '# one\non: push\n',
      '.github/workflows/b.yaml': '# two\n# three\n',
      'scripts/deep/s.mjs': '// four\nexport const s = 1;\n',
      'scripts/note.json': '{}\n',
      'vite.config.ts': '// five\n// six\nexport default {};\n',
      'eslint.config.js': '// seven\n',
      'src/app.tsx': '// eight\n',
      'packages/x/vite.config.ts': '// nine\n',
    });
    try {
      expect(lineCounts(root)).toMatchObject({ workflows: 3, scripts: 1, config: 3, 'source:app': 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a project above its line baseline is listed, one at or below it is not', () => {
    expect(overLines({ lines: { 'source:app': 5, 'test:ui': 3 } }, { 'source:app': 6, 'test:ui': 3 })).toEqual([{ key: 'source:app', baseline: 5, count: 6 }]);
    expect(overLines({ history: {} }, { 'source:app': 1 })).toEqual([{ key: 'source:app', baseline: 0, count: 1 }]);
  });
});
