/**
 * Renders the /versions/ index for the deployed Pages site.
 *
 * The Pages workflow unpacks each release's `ps-dashboard-<version>.zip` into
 * `site/<tag>/` and writes a manifest of what it kept; this turns that manifest
 * into a browsable page. Kept as a script rather than a heredoc in the workflow
 * so the markup can be rendered and eyeballed locally:
 *
 *   node scripts/build-versions-index.mjs site .versions-tmp/manifest.tsv owner/repo abc1234 2026-08-17
 *
 * Manifest format is one release per line, newest first — the first line is the
 * one mirrored at /latest/:
 *   <tag>\t<publishedAt ISO>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [siteDir, manifestPath, repoSlug, nightlySha, nightlyDate] =
  process.argv.slice(2);

if (!siteDir || !manifestPath || !repoSlug) {
  console.error(
    'usage: build-versions-index.mjs <site-dir> <manifest.tsv> <owner/repo> [sha] [date]',
  );
  process.exit(1);
}

/** Tags and dates come from the GitHub API, but they land in markup — escape. */
const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let manifest = '';
try {
  manifest = readFileSync(manifestPath, 'utf8');
} catch {
  // No manifest means no release carried a build asset. Render the empty state
  // rather than failing the deploy — the nightly itself is still fine.
}

const releases = manifest
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    const [tag, publishedAt] = line.split('\t');
    return {
      tag,
      // ISO prefix, not toLocaleDateString: the output has to be identical on
      // every runner so redeploys don't churn the page.
      date: (publishedAt ?? '').slice(0, 10),
      // The workflow mirrors the newest release that carried a build to
      // /latest/, and that is the first manifest line by construction.
      isLatest: index === 0,
    };
  });

const rows = releases
  .map((release) => {
    const badge = release.isLatest
      ? '<span class="badge badge-latest">latest official</span>'
      : '<span class="badge">frozen</span>';
    return `          <li class="row${release.isLatest ? ' row-latest' : ''}">
            <span class="node" aria-hidden="true"></span>
            <span class="version">${esc(release.tag)}</span>
            ${badge}
            <time datetime="${esc(release.date)}">${esc(release.date)}</time>
            <span class="links">
              <a class="open" href="../${esc(release.tag)}/">Open this build</a>
              <a href="https://github.com/${esc(repoSlug)}/releases/tag/${esc(release.tag)}">Release notes</a>
            </span>
          </li>`;
  })
  .join('\n');

const list = releases.length
  ? `        <ol class="rail">\n${rows}\n        </ol>`
  : `        <p class="empty">No official builds yet. The next release will appear here.</p>`;

const stableNote = releases.length
  ? `        <p class="note">
          <a href="../latest/">../latest/</a> always mirrors the newest official build
          — link to that when you want a stable address rather than a pinned version.
        </p>`
  : '';

const nightlyMeta = [nightlySha, nightlyDate].filter(Boolean).map(esc);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="../favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PS Dashboard — versions</title>
    <style>
      :root {
        --ps-bg-deep: #18243a;
        --ps-bg: #344b6c;
        --ps-bg-soft: #415f88;
        --ps-border: rgba(183, 216, 255, 0.16);
        --ps-text: #eef6ff;
        --ps-muted: #9fb2cc;
        --ps-accent: #7cb7e8;
        --ps-accent-warm: #f0c76b;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 15% 0%, rgba(119, 171, 219, 0.22), transparent 34rem),
          radial-gradient(circle at 85% 6%, rgba(245, 200, 106, 0.11), transparent 28rem),
          linear-gradient(180deg, var(--ps-bg-soft) 0%, var(--ps-bg) 38%, var(--ps-bg-deep) 100%);
        background-attachment: fixed;
        color: var(--ps-text);
        font-family: Verdana, Geneva, sans-serif;
        font-size: 13px;
        line-height: 1.5;
      }

      .wrap { max-width: 760px; margin: 0 auto; padding: 0 10px; }
      main.wrap { padding-bottom: 40px; }

      header {
        background: linear-gradient(180deg, rgba(84, 119, 169, 0.96) 0%, rgba(50, 73, 111, 0.96) 100%);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-top: none;
        box-shadow: 0 10px 26px rgba(7, 15, 30, 0.22);
        padding: 14px 0;
        margin-bottom: 14px;
      }
      header h1 {
        margin: 0;
        font-size: 17px;
        letter-spacing: -0.01em;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      }
      header p { margin: 4px 0 0; color: #cfe0f5; font-size: 11px; max-width: 58ch; }

      .panel {
        background: linear-gradient(180deg, rgba(33, 50, 82, 0.92) 0%, rgba(24, 37, 62, 0.92) 100%);
        border: 1px solid var(--ps-border);
        border-radius: 7px;
        padding: 13px 16px 15px;
        box-shadow: 0 8px 22px rgba(6, 12, 24, 0.18);
      }
      .panel + .panel { margin-top: 10px; }

      /* Two channels, two accents: the nightly moves, the official line is
         pinned. The left edge is the only thing that says which is which. */
      .panel-nightly { border-left: 2px solid var(--ps-accent); }
      .panel-official { border-left: 2px solid var(--ps-accent-warm); }

      .channel {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 11px;
        padding-bottom: 7px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .channel h2 {
        margin: 0;
        font-size: 12px;
        color: #cde;
        letter-spacing: 0.02em;
      }
      .channel span { color: var(--ps-muted); font-size: 10px; }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .head small { color: var(--ps-muted); font-size: 11px; display: block; margin-top: 3px; }
      .meta {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 12px;
        font-weight: bold;
        color: #fff;
      }
      .meta em { color: var(--ps-muted); font-style: normal; font-weight: normal; }

      .btn {
        background: linear-gradient(180deg, #75a8d5 0%, #567fa7 100%);
        border: 1px solid rgba(190, 222, 255, 0.26);
        border-radius: 5px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 3px 8px rgba(0, 0, 0, 0.16);
        color: #fff;
        font-size: 12px;
        font-weight: bold;
        padding: 7px 16px;
        text-decoration: none;
        white-space: nowrap;
      }
      .btn:hover { filter: brightness(1.12); }

      /* The rail is the release order made visible: newest at the top, one
         node per hosted build. */
      .rail { list-style: none; margin: 0; padding: 0 0 0 20px; position: relative; }
      .rail::before {
        content: '';
        position: absolute;
        left: 3px;
        top: 12px;
        bottom: 12px;
        width: 1px;
        background: linear-gradient(180deg, var(--ps-accent-warm), rgba(124, 183, 232, 0.3) 24%, rgba(124, 183, 232, 0.05));
      }

      .row {
        display: flex;
        align-items: baseline;
        gap: 9px;
        flex-wrap: wrap;
        padding: 9px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        position: relative;
      }
      .row:last-child { border-bottom: none; }

      .node {
        position: absolute;
        left: -20px;
        top: 15px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #35507a;
        border: 1px solid rgba(183, 216, 255, 0.4);
      }
      .row-latest .node { background: var(--ps-accent-warm); border-color: #ffe8a3; }

      .version {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 13px;
        font-weight: bold;
        color: #fff;
        min-width: 5.5em;
      }

      .badge {
        font-size: 9px;
        font-weight: bold;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 1px 7px;
        border-radius: 999px;
        background: rgba(100, 140, 200, 0.25);
        color: #a9bdd8;
        border: 1px solid rgba(183, 216, 255, 0.14);
      }
      .badge-latest {
        background: rgba(240, 199, 107, 0.14);
        color: #ffdc80;
        border-color: rgba(240, 199, 107, 0.4);
      }
      .badge-nightly {
        background: rgba(124, 183, 232, 0.16);
        color: #bfe0ff;
        border-color: rgba(124, 183, 232, 0.42);
      }

      time { color: var(--ps-muted); font-size: 11px; }

      .links { margin-left: auto; display: flex; gap: 12px; }
      a { color: var(--ps-accent); text-decoration: none; font-size: 11px; }
      a:hover { text-decoration: underline; }
      a.open { font-weight: bold; }
      a:focus-visible, .btn:focus-visible {
        outline: 2px solid var(--ps-accent-warm);
        outline-offset: 2px;
        border-radius: 3px;
      }

      .note { color: var(--ps-muted); font-size: 10px; margin: 11px 0 0; line-height: 1.6; }
      .note a { font-family: 'Consolas', 'Courier New', monospace; font-size: 10px; }
      .empty { color: var(--ps-muted); margin: 0; font-size: 12px; }

      footer { color: #8296b0; font-size: 10px; margin-top: 14px; padding: 0 2px; line-height: 1.6; }
      footer code { font-family: 'Consolas', 'Courier New', monospace; color: #9fb2cc; }

      @media (max-width: 560px) {
        .links { margin-left: 0; width: 100%; }
        .version { min-width: 0; }
        .head .btn { width: 100%; text-align: center; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap">
        <h1>PS Dashboard — versions</h1>
        <p>
          Two channels: the nightly follows master, and every official release keeps a frozen
          copy at its own address — so you can reopen a replay exactly as that build analyzed it.
        </p>
      </div>
    </header>

    <main class="wrap">
      <section class="panel panel-nightly">
        <div class="channel">
          <h2>Nightly</h2>
          <span>rebuilt on every push to master</span>
        </div>
        <div class="head">
          <div>
            <span class="meta">${nightlyMeta.length ? nightlyMeta.join(' <em>·</em> ') : 'current master build'}</span>
            <small>Unreleased work in progress. Expect it to be ahead of the official line.</small>
          </div>
          <a class="btn" href="../">Open the nightly</a>
        </div>
      </section>

      <section class="panel panel-official">
        <div class="channel">
          <h2>Official releases</h2>
          <span>frozen at the commit they were cut from</span>
        </div>
${list}
${stableNote}
      </section>

      <footer>
        Frozen builds are unpacked from each release's <code>ps-dashboard-&lt;version&gt;.zip</code>.
        The ${releases.length === 1 ? 'most recent release is' : `${releases.length} most recent releases are`} hosted here;
        older builds stay downloadable from their release page.
      </footer>
    </main>
  </body>
</html>
`;

mkdirSync(join(siteDir, 'versions'), { recursive: true });
writeFileSync(join(siteDir, 'versions', 'index.html'), html);
console.log(
  `versions/index.html: nightly + ${releases.length} official build${releases.length === 1 ? '' : 's'}`,
);
