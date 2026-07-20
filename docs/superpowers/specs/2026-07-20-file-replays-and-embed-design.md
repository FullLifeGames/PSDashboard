# Design: Custom Game defaults, exported replay files, and embed mode

Date: 2026-07-20
Status: implemented in this session (autonomous run — decisions documented here in lieu of the interactive review gate)

## Goals

1. Default replay becomes `https://replay.pokemonshowdown.com/gen3customgame-2115579570` (Gen 3 Custom Game).
2. Custom Game has no Smogon usage stats — stats/set assumptions fall back to that generation's OU when the format is not covered.
3. Users can drop or pick a locally exported replay HTML file (PS "Download replay" export) and use every feature on it.
4. The app can be embedded in another site's iframe and be handed a replay to render (stats + branching included).

## Verified facts

- The new default replay resolves: `formatid: gen3customgame`, players Bene vs Roy SPL, singles, no team preview.
- `@pkmn/sim` knows `gen3customgame`, so `getBranchSimulatorFormat` needs no change — only stats/sets lookups do.
- PS export HTML carries the raw log in `<script type="text/plain" class="battle-log-data">` with `/` escaped as `\/`, plus a hidden `replayid` input, `|player|`/`|tier|`/`|t:|` lines in the log.

## Decisions

### 1. Stats fallback ("assume OU if not defined")

- `getSmogonStatsFormat` maps `gen{N}customgame` → `gen{N}ou` outright (Custom Game is by definition absent from stats). Doubles custom games keep funnelling into the existing `doubles → gen9doublesou` branch.
- `buildSmogonStatsUrls` additionally appends the generation's OU as a second candidate whenever the primary stats format differs from it. `fetchSmogonUsageStats` already walks candidates on failure, so any format missing from data.pkmn.cc degrades to OU stats instead of "unavailable".
- `smogon-sets.ts` `normalizeFormat` gets the same customgame → OU mapping so `@pkmn/smogon` set assumptions resolve too.

### 2. Exported replay files

- New `src/lib/replay-file.ts` with `parseExportedReplay(content, fileName?) → ReplayData`:
  - PS export HTML: extract the `battle-log-data` script (attribute-order tolerant regex, no DOMParser so regression tests run in Node), unescape `\/`, read `replayid` from the hidden input, derive players from `|player|` lines, format from `|tier|`, formatid via `inferReplayFormatId`, uploadtime from the first `|t:|`.
  - Raw protocol logs (`|`-prefixed lines) are accepted too; the id derives from the file name.
  - Anything else throws a readable error surfaced by the existing loader alert.
- `useReplay` gains `loadReplayFile(content, fileName)`; the snapshot/inference pipeline is shared with `loadReplay`.
- `ReplayLoader` becomes a drop target (highlight on dragover) and gets a browse button wired to a hidden file input.

### 3. Embed mode

Same SPA, no separate build (Vite `base: "./"` already relocates freely):

- `?replay=<id|url>` auto-loads that replay once on startup (also useful as a standalone deep link). Skipped when a `#branch=` share hash is present — the share view wins.
- `?embed=1` hides the app header and the workflow guide; without a replay yet it shows a short "waiting for replay" hint instead of the full landing screen.
- Host postMessage API (new hook `src/hooks/useEmbedHost.ts`):
  - App → host on mount in embed mode: `{ type: 'ps-embed-ready' }`.
  - Host → app: `{ type: 'ps-load-replay', replay: string }` where the string may be a replay URL/id, a raw protocol log, or a full exported-HTML document (content is detected and routed to the file parser).
  - App → host after handling: `{ type: 'ps-replay-loaded', id, format }` or `{ type: 'ps-replay-error', message }`.
  - Message types are disjoint from the internal viewer-iframe protocol (`ps-turn`, `ps-seek-turn`, `ps-append-log`, `ps-replay-ready`), which keeps both listeners independent.

### Rejected alternatives

- Separate embed entry point/build: unnecessary — query params keep one deployable artifact.
- DOMParser for the export HTML: breaks Node-side regression tests for no gain.
- URL-encoding whole logs into `?replay=`: exceeds practical URL limits; postMessage covers content handoff.

## Testing

- Regression: new `replay-file.spec.ts` (HTML fixture incl. `\/` unescaping, raw log, error cases); `smogon-stats.spec.ts` gains customgame mapping + OU-fallback candidates + fallback fetch test; `smogon-sets.spec.ts` asserts customgame set assumptions resolve as OU.
- e2e: default input value, `?embed=1` chrome hiding, `?replay=` auto-load, file input upload of an exported fixture, and a host postMessage load.
