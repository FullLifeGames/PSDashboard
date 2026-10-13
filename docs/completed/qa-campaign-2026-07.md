# QA-Kampagne 07/2026: Fix-Plan (Archiv)

Was: der Abarbeitungsplan zu allen 45 Befunden der QA-Kampagne vom 09. bis 10.07.2026 (20 Bugs, 25 Gaps; Bericht: https://claude.ai/code/artifact/23cf3402-abd8-495e-a060-ee066e92db9e) in 17 Arbeitspaketen, dazu die Nachtest-Runden 2 bis 7 (10.07. bis 31.07.2026). Alles erledigt. Die einzige bewusst offen gelassene Lücke (WP16: die Schadensvorschau rechnet einen gesetzten Tera-Toggle nicht vorab ein) steht seit 11.09.2026 als Beobachtung in `NextSteps.md`, Abschnitt C.
Zeitraum: Juli 2026, vor der Rundenzählung der Eval-Runden (ab August). Pfadangaben (`src/lib/…`, `file:line`) gelten für `master @ e52c38d` vom 09.07.; seit dem Architektur-Refactor (Runden 22 bis 30) liegen die Engine-Module unter `packages/` und die Branch-Oberfläche unter `src/components/branch/`.
Aufgeräumt am 11.09.2026: Datei umbenannt (vorher `FIXPLAN.md`, zuerst im Repo-Root, dann hier), die vier offenen Kästchen geschlossen, Runden 3 bis 7 aus der Memory-Notiz `qa-campaign-2026-07` mit ihren Commits ergänzt, der Planungsabschnitt „Empfohlene Reihenfolge“ entfernt.

**Arbeitsweise pro Arbeitspaket (WP):**

1. Schritte des WP implementieren.
2. `npm run lint` && `npm run build` && `npm run test:regression` && `npm run test:e2e` grün.
3. Die im WP genannten Repro-Szenarien im Browser nachstellen (Dev-Server `npm run dev`, http://localhost:5173).
4. Wo sinnvoll: Regression-/E2E-Test ergänzen, der den Bug dauerhaft abdeckt.
5. Checkboxen im WP **und** in der Rückverfolgungs-Tabelle unten abhaken.

**Test-Replays** (dieselben wie in der Kampagne):

| Kürzel | URL | Zweck |
|---|---|---|
| randbats | https://replay.pokemonshowdown.com/gen9randombattle-2646621749 | Random Battle, global-Shim |
| natdex | https://replay.pokemonshowdown.com/gen9natdexdraft-2646619908 | NatDex/Mega |
| ru | https://replay.pokemonshowdown.com/gen9ru-2646619325 | Singles-Branching |
| ou | https://replay.pokemonshowdown.com/gen9ou-2646618643 | Singles-Branching, Referenz-Checkpoint T8 |
| custom | https://replay.pokemonshowdown.com/gen9customgame-2646622580 | Calc-Kontrollfall (Calc-Set = Sim-Set) |
| vgc | https://replay.pokemonshowdown.com/gen9championsvgc2026regmbbo3-2646618972 | Doubles, OTS/`\|showteam\|`, Forced Switch |
| gen3 | https://replay.pokemonshowdown.com/gen3ou-2646621651 | Gen-Pin, Deadlock T10/T11/T13 |
| gen7 | https://replay.pokemonshowdown.com/gen7ou-2647005695 | Z-Move-Toggle (WP16) |
| smog3 | https://replay.pokemonshowdown.com/smogtours-gen3ou-56583 | smogtours-Format-Inferenz |
| smogub | https://replay.pokemonshowdown.com/smogtours-ubers-54583 | Gen-6-Inferenz, „Ubers"-Tag |

---

## Phase 1 — Verlässlichkeit der Zug-Ausführung & Zahlen (Bugs hoch)

### WP1 · Identitätsbasierte Choices (behebt B1, B15) — Aufwand: L

Der schwerste Bug-Komplex: Choices sind Grid-Positions-Indizes (`move 2`), der Rebuild
replayt Roh-Strings → nach Forced-Switch-Zwischenschritt oder Team-Edit wird ein
**anderer Move ausgeführt als geklickt**.

Betroffen: `src/components/BranchPanel.tsx:429` (`moveChoice`), `src/hooks/useBranch.ts:252-256`
(`startBranch`-Replay), `src/hooks/useBranch.ts:178-187` (`executeForcedSide`).

- [x] Choice-Datenmodell umstellen: `BranchSlotChoice` (`{kind:'move', moveId, moveName,
      targetLoc?}` / `{kind:'switch', speciesId, pokemonName}`) in `branch-choices.ts`;
      UI, Hook-Refs und `BranchSimState` durchgängig strukturiert.
- [x] Beim Senden an die Sim gegen den aktuellen Request auflösen:
      `resolveSideChoices` in `branch-engine.ts` — Positions-Index entsteht erst dort.
- [x] History-Einträge speichern strukturierte Choices (`p1SlotChoices`/`p2SlotChoices`);
      `startBranch`-Replay löst sie pro Turn neu auf (`replayHistoryEntry`) und bricht
      bei fehlendem Move mit sichtbarer Meldung ab („Rebuild stopped before branch turn X").
- [x] `executeForcedSide` schreibt History-Einträge (`kind: 'forced'`, B15); Replay wendet
      sie einzeln an; `BranchHistoryPanel` richtet den Original-Vergleich an Turn-Einträgen
      aus, Forced-Einträge erscheinen als eigene schmale Zeile.
- [x] `setTimeout(…, 200)` in `executeForcedSide` durch deterministisches Warten auf die
      Sim-Response ersetzen (in WP2 miterledigt: `executeForcedSide` nutzt jetzt
      `executeBranchChoices` und aktualisiert den State erst nach der Sim-Antwort).
- [x] Kompatibilität: Share/localStorage-Payloads (`version: 1`) enthalten weiterhin die
      tatsächlich gesendeten Kommando-Strings (`p1Choice`/`p2Choice`) — sie werden nur zur
      Anzeige verwendet, nie replayed → keine Migration nötig. Der Rebuild nutzt die
      In-Memory-History; Alt-Einträge ohne Slot-Choices fallen auf Verbatim-Replay zurück.
- [x] Regression-Tests: `regression/identity-choices.spec.ts` (Move-ID → wechselnde Slots,
      Fehler bei entferntem Move, Switch-Identität, Doubles-Target-Erhalt) + aktualisierte
      Helper-Tests in `branch-choices.spec.ts`.

**Verifikation:**
- [x] vgc (Browser, 10.07.): Branch T3 → Faint → Forced-Switch-Zwischenschritt (Swampert
      rein) → Blizzard geklickt → Log beweist `|move|p2a: Froslass|Blizzard|…` — exakt
      der geklickte Move (der QA-Bug hätte Shadow Ball gespielt).
- [x] Team-Edit-Rebuild: Regression `identity-choices.spec.ts` + E2E „saving player
      edits mid-branch preserves branch progress and pending choices" (grün).

### WP2 · Execute-Fehlerpfad + Custom-Choice-Validierung (behebt B8) — Aufwand: S/M

Ungültige Choices scheitern still, löschen alle Eingaben und erzeugen Geister-History.
Betroffen: `src/hooks/useBranch.ts:151-176` (`executeTurn`), `src/components/BranchPanel.tsx:319-332`.

- [x] Sim-Antwort auf `|error|` auswerten; `clearChoices()` **nur bei Erfolg** aufrufen.
      (`|error|` kommt als sideupdate nur auf den Player-Streams an — neue Collector-Loops
      in `reconstructBranchRuntime` + `executeBranchChoices`-Primitive in `branch-engine.ts`.)
- [x] History-Eintrag nur bei erfolgreichem Turn anhängen.
- [x] Bei Fehler: Choices behalten, sichtbare Fehlermeldung im Panel anzeigen
      (`executeError` in `useBranch`, Banner in `BranchPanel`).
- [x] Custom-Choice-Eingabe vorab gegen das aktuelle Request-Objekt validieren
      (`resolveCustomChoice` in `branch-choices.ts`; unvalidierter Raw-Pfad entfernt).
- [x] Regression-Test: `move 99` → Sim lehnt ab, Battle unverändert; Custom-Choice-Resolver
      (`regression/branch-execute.spec.ts`, 7 neue Tests).

**Verifikation:**
- [x] Browser (10.07., randbats Singles-Branch): `move 99` → „No move in slot 99 — this
      Pokémon has 2 moves.", kein Pending-Choice, History unverändert. Sim-seitige
      Ablehnungen erscheinen als Banner (gen3-Beleg: „Can't switch: …" statt Silent Fail).

### WP3 · `|showteam|` (Open Team Sheets) parsen (behebt B3, entschärft B6) — Aufwand: M

Betroffen: `src/lib/team-builder.ts:158-187` (`extractEmbeddedShowteamExports`).

- [x] Parser für `|showteam|`-Protokollzeilen: `Teams.unpack` in `team-builder.ts`
      (volle Sets inkl. Natur) + leichter Parser ohne @pkmn/sim in `opponent-inferrer.ts`
      (`parseShowteamSheet`, CamelCase-Namen werden lesbar aufgetrennt).
- [x] Quellen-Priorität: User-Paste > `|showteam|` > „View team"-Chat > revealed > guessed;
      OTS-Daten erscheinen im Stats-Panel als „revealed" (Team Sheets sind öffentlich).
- [x] Branch-Team-Builder nutzt OTS-Sets; fehlende EVs/Natur (OTS blendet sie aus) fallen
      auf Usage-Spreads zurück statt auf 0-EV-Spreads.
- [x] Regression-Tests: `regression/showteam.spec.ts` (4 Tests, echtes Payload-Format aus
      dem VGC-Referenz-Replay).

**Verifikation:**
- [x] vgc (Browser, 10.07.): Stats-Panel zeigt Swampert Damp/Swampertite, Hydreigon
      Choice Scarf, Froslass Aurora Veil — alte Guesses (Torrent) verschwunden; die
      Branch-Grids zeigen die echten Sheet-Moves (Froslass Blizzard/Shadow Ball, Mawile
      Play Rough) statt erfundener.

### WP4 · Damage-Calc an die Sim angleichen (behebt B5, B6, G6) — Aufwand: M/L

Betroffen: `src/lib/damage-calc.ts:4` und die Aufrufer im BranchPanel.

- [x] `Generations.get(9)` ersetzt: `DamageCalcContext.gen` aus dem Replay
      (`getReplayGeneration` in `replay-format.ts`, App → BranchPanel-Prop).
- [x] Sets angeglichen — Root Cause von B6 gefunden: `makePokemonInfo` lieferte Sim-**IDs**
      (`technician`, `lifeorb`), @smogon/calc matcht aber Display-Namen → alle
      Ability-/Item-Modifikatoren waren stumm. Jetzt Dex-Display-Namen im State.
- [x] Feldbedingungen: `BranchSimState.field` (Wetter/Terrain/Side-Conditions aus der Sim)
      → Calc-`Field` inkl. Reflect/Light Screen/Aurora Veil und Wetter-Mapping.
- [x] G6: Spread-/ungetargetete Moves rechnen pro lebendem Gegner-Slot; Anzeige
      „P2A x% · P2B y%"; Default-Range = bestes Ziel (nicht mehr stur Slot A);
      gefallene Ziele fallen automatisch raus.
- [x] KO-Labels und „Use Recommended" nutzen die korrigierten Zahlen (gleiche Pipeline).
- [x] Regression-Tests: `regression/damage-gen.spec.ts` — Gen-3-Explosion, Gen-3
      Dragon Claw speziell, Technician ×1,5, Life Orb ×1,3, Reflect, Regen.

**Verifikation:**
- [x] gen3-Beweise als Regression-Tests: Explosion mit Def-Halbierung (≈2× Gen-9-Wert),
      Dragon Claw speziell statt physisch (`damage-gen.spec.ts`).
- [x] Technician ×1,5 und Life Orb ×1,3 als Regression-Tests (Root Cause ID-vs-Name
      behoben — Modifikatoren greifen jetzt).
- [x] Kontrollfall Calc-Set = Sim-Set bleibt exakt: bestehende `damage-preview.spec.ts`
      („uses branch simulator EVs, IVs, and nature") weiterhin grün.

### WP5 · Random Battle absichern (behebt B2) — Aufwand: S/M

Betroffen: `src/lib/branch-engine.ts:669` (`reconstructBranchRuntime`), ggf. `vite.config.ts`.

- [x] `global`-Shim gesetzt (branch-engine.ts Modulkopf: `globalThis.global = globalThis`,
      Ursache: `global.Config?.potd` in @pkmn/sim rulesets); Regression-Test
      `regression/random-format.spec.ts` startet `gen9randombattle` mit rekonstruierten
      Teams und führt einen Turn aus.
- [x] Deaktivierungs-Fallback nicht nötig — Format läuft mit Shim (Browser-Bestätigung im
      Verifikationspass).
- [x] Sim-Fehler werden nicht mehr verschluckt: Execute-Pfad meldet über `executeError`
      (WP2), Replay-Abbrüche über die Rebuild-Meldung (WP1).

**Verifikation:**
- [x] randbats (Browser, 10.07.): Branch T1 zeigt „What will **Skarmory** do?" mit echten
      Moves/PP/Ranges; Execute läuft (Turn 1 → 2, Log/HP ändern sich).
- [x] Konsole frei von `ReferenceError: global is not defined` (nur bekannte
      CORS-Meldungen der Stats-Pipeline, B14/WP9).

### WP6 · „Use Recommended": eigene Slots ausschließen (behebt B4) — Aufwand: S

Betroffen: `src/components/BranchPanel.tsx:38-70` (`pickRecommendedMove`).

Gegenstandslos seit dem 29.08.2026: „Use Recommended“ wurde mit f805b5f aus der App entfernt (Timeline-UX, Runden 17 bis 21). Die drei Schritte bleiben als Historie stehen; die Browser-Verifikation vom 10.07. hatte den gemeldeten Fall bereits abgedeckt.

- [x] Bei der `maxPercent`-Maximierung über `targetOptions` alle verbündeten Slots
      ausschließen (außer der Move kann ausschließlich Verbündete anvisieren, z. B.
      Helping Hand — dann explizit erlauben). (entfallen mit dem Feature)
- [x] Optional: Spread-Moves über die Summe der Gegner-Schäden bewerten. (entfallen mit dem Feature)
- [x] Regression-Test: Szenario, in dem der Partner das rechnerisch beste Ziel wäre →
      Empfehlung zeigt auf einen Gegner. (entfallen mit dem Feature)

**Verifikation:**
- [x] vgc (Browser, 10.07., Branch T3): alle vier „Use Recommended"-Klicks targeten
      ausschließlich Gegner (P1A→P2A, P1B→P2B, P2A→P1B, P2B→P1A) — inkl. der
      QA-Problemfälle Froslass und Play Rough.

### WP7 · Branch-Rekonstruktion robust machen (behebt B7, B17) — Aufwand: M

Betroffen: `reconstructBranchRuntime` (`src/lib/branch-engine.ts`), `src/hooks/useBranch.ts`.

- [x] Deadlock-Erkennung: `validateBranchRuntime` in `branch-engine.ts` prüft nach der
      Rekonstruktion auf (a) fehlenden Request bei laufendem Battle, (b) Force-Switch ohne
      verfügbare Bench, (c) Timeout — Meldung erscheint im Panel-Fehlerbanner, „Back"
      bleibt verfügbar. Ungültige Switch-Klicks scheitern seit WP2 ohnehin laut.
- [x] „Preparing branch…": Fortschritt „(turn x/y)" via `onProgress`, Cancel-Button
      (AbortSignal bricht den Replay-Loop ab, Branch startet dann nicht), Gesamtdeadline
      60 s (`deadlineMs`) statt unbegrenztem Hängen.
- [x] **Browser-Nachtest gen3 (10.07.):** Ursache gefunden — nach den Snapshot-/Active-
      Korrekturen blieb ein **staler Force-Switch-Request** stehen (Request verlangt
      Switch, aber kein `switchFlag` mehr gesetzt). Reparatur:
      `repairStaleForcedSwitchRequest` regeneriert den Request via
      `battle.makeRequest('move')`; zusätzlich Error-Wake-up in den Rekonstruktions-
      Waits (abgelehnte Choices brennen nicht mehr 1,5 s pro Retry).

**Verifikation:**
- [x] gen3 (Browser, 10.07.): T10 und T13 sind jetzt **spielbar** (Move-Grids beider
      Seiten, Turn 10 → 11 ausgeführt, History korrekt); Restfälle melden sauber
      („Reconstruction timed out…" / Deadlock-Meldung) statt toten Zustands.
- [x] Preparing-Anzeige zeigt Fortschritt („(turn 9/13)" beobachtet); Cancel-Button
      vorhanden, Abort-Verhalten durch Regression-Test abgedeckt.

---

## Phase 2 — Viewer-State & Stats-Pipeline (Bugs mittel)

### WP8 · Slider-/Seek-/Snapshot-Hygiene (behebt B9a, B10, B11, B12, G23) — Aufwand: M

Betroffen: `src/components/PSReplayFrame.tsx:100-122`, `src/App.tsx:120` (`branchTurn`),
Slider-/Topbar-Komponenten.

- [x] B9a: Echo-Seeks unterdrückt — `lastReportedTurnRef` in `PSReplayFrame` merkt den
      letzten iframe-Turn; Echo-`seekTurn`-Änderungen senden kein `ps-seek-turn` mehr.
- [x] B11: `branchTurn` wird bei `replayData.id`-Wechsel auf 1 zurückgesetzt.
- [x] B12: End-Position bleibt stabil — `handleReplayTurn` ignoriert das Embed-Echo
      (letzter echter Turn), solange die End-Position gewählt ist.
- [x] B10: „Branch Here" am End-Snapshot gesperrt (disabled + Tooltip „The battle is
      already over at the end position…").
- [x] G23: Max-Position zeigt „End"; echte Turns zählen als „T{n}/{letzter echter Turn}"
      (End-Snapshot-Erkennung: letzter Snapshot ohne eigene `|turn|`-Zeile).

**Verifikation:**
- [x] ou (Browser, 10.07.): Play lief Turn 5→9 durch (`paused: false` durchgehend);
      Slider-Max → „End", Branch disabled, Position nach 3 s stabil (kein Knock-back);
      Replay-Wechsel (ou → ru) startet bei T1/9. E2E 39/39 grün.

### WP9 · Stats-Pipeline aufräumen (behebt B13, B14) — Aufwand: S/M

Betroffen: `src/lib/replay-format.ts:36-40`, `src/lib/smogon-stats.ts:305`,
`src/hooks/useSmogonUsageStats.ts:28-31`.

- [x] `smogtours-`-Präfix gestrippt: `normalizeInferredFormatId` in `replay-format.ts`
      (inkl. Gen-Präfix aus `|gen|`, z. B. `smogtours-ubers` → `gen6ubers` — der Branch-
      Simulator bekommt damit ebenfalls das echte Format) + Defensiv-Strip in
      `getSmogonStatsFormat`.
- [x] Toter www.smogon.com-Fallback-Loop entfernt — `buildSmogonStatsUrls` liefert nur
      noch den CORS-fähigen data.pkmn.cc-Endpoint.
- [x] Fehler propagiert: `useSmogonUsageStats` setzt `error`, wenn keine Quelle Daten
      liefert → Badge erreichbar.

**Verifikation:**
- [x] smog3 (Browser, 10.07.): Topbar zeigt „Smogon gen3ou latest" — Usage-Stats laden
      (vorher nie); Konsole 0 Fehler.
- [x] randbats (Browser, 10.07.): Badge „Smogon stats unavailable" erscheint; nur noch
      1 Konsolenfehler (Sets-404) statt 17.

---

## Phase 3 — UX, Mobile, Teams, Save/Share

### WP10 · Mobile & Responsive (behebt B9b, B18, B20, G22) — Aufwand: M

Betroffen: `src/index.css` (Media Queries 900/640), BranchPanel-/TeamEditor-Markup.

- [x] B18: Branch-Leiste bricht unter 640 px um — Slider auf eigener Zeile in voller
      Breite (Inline-`flex:1` ins CSS verschoben, war vorher nicht überstimmbar);
      Pfeile/„Branch Here"/Modal-× ≥ 40 px.
- [x] B20: EV-Grid (`ps-ev-grid`) schaltet unter 640 px auf 3×2 — Felder 85 px breit.
- [x] B9b: `.ps-iframe-wrap` ist auf Mobile horizontal scrollbar mit `min-width: 640px`
      fürs Embed — das Battle-Log ist per Wisch erreichbar, die Seite selbst scrollt
      weiterhin nicht horizontal.
- [x] G22: Breakpoint von 900 px auf 1050 px angehoben (901–1050 stackt jetzt einspaltig).

**Verifikation:**
- [x] Browser 390×844 (10.07.): Slider 340×28 auf eigener Zeile, ◀/▶ 40×40,
      „Branch Here" 102×40, Modal-× 40×40, EV-Felder 85×23 in 3 Spalten,
      iframe-Container scrollbar (Embed 640 px), **kein** horizontales Seiten-Scrollen.
      E2E 39/39 (inkl. Mobile-Layout-Test) grün.

### WP11 · Stats-Panel-Qualität (behebt B16, B19, G12, G19, G21) — Aufwand: M

Betroffen: Team-/Stats-Aufbau in `src/lib/team-builder.ts` u. Stats-Panel-Komponenten.

- [x] B16: Battle-only-Formes mergen — Suffix-Liste in `opponent-inferrer.ts` um
      `-Mega(-X/-Y)`, `-Primal`, `-Ultra`, `-Gmax` erweitert.
- [x] B19: `-*`-Suffix und Trailing-Hyphens werden vor der Sprite-URL gestrippt
      (`BattleStatsPanel.spriteUrl`).
- [x] G12: `moveDedupKey` in `team-info.ts` — getypte Hidden-Power-Guesses treten nicht
      mehr neben ein revealed generisches „Hidden Power".
- [x] G19: `|-heal|…[from] item:` und `|-mega|…|Stein` werden als revealed Items
      übernommen (der `|-mega|`-Protokollzeile liegt der Stein direkt bei).
- [x] G21: Random-Formate zeigen „85 EVs each (random set)" statt „0 EVs"; unbekannte
      Spreads „EVs ?"; unaufgedeckte Randbats-Slots erscheinen als „Not yet revealed"-
      Platzhalter (6er-Team).

**Verifikation:**
- [x] Regression: `regression/stats-panel-quality.spec.ts` (Mega-Merge, Stein-Reveal,
      Leftovers-Reveal, Hidden-Power-Dedupe).
- [x] Browser (10.07., randbats): „85 EVs each (random set)" sichtbar, kein „0 EVs",
      1 „Not yet revealed"-Platzhalter (11/12 Mons aufgedeckt).

### WP12 · Loader-UX (behebt G1–G5) — Aufwand: S/M

Betroffen: `src/lib/replay-fetcher.ts`, Loader-Bereich in `src/App.tsx`.

- [x] G2: `parseReplayUrl` validiert (URL-Extraktion, `.json`-Strip, `^[a-z0-9-]+$`) und
      liefert `null` für leeres Feld/Fremd-URLs → verständliche Meldung statt `/.json`-Fetch.
- [x] G1: Fehlermeldungen differenziert („Could not load … does not exist or the network
      request failed" für den CORS-undifferenzierbaren Fall; HTTP-Status wenn verfügbar).
- [x] G3: `<form>`-Submit (Enter) für das Replay-Feld; Team-Paste speichert mit
      Ctrl/Cmd+Enter.
- [x] G4: Fehlerbox direkt unter der Eingabezeile, 12 px, `role="alert"`.
- [x] G5: `fetchReplay` präfixt die Generation im Anzeigeformat („Ubers" → „[Gen 6] Ubers").

**Verifikation:**
- [x] Regression: `parseReplayUrl`-Matrix (bare ID, `.json`, Whitespace, Query-Params,
      leer, Fremd-URL) + Fehlermeldungs- und `[Gen 6]`-Tests in `replay-format.spec.ts`.
- [x] Browser (10.07.): Fremd-URL + Enter → Meldung direkt unter der Zeile;
      `smogtours-ubers-54583` → Tag „[Gen 6] Ubers" (und bekommt jetzt sogar
      gen6ubers-Usage-Stats).

### WP13 · Save/Share ausbauen (behebt G16, G17, G18) — Aufwand: M

Betroffen: `src/App.tsx:163-178` (Hash-Effekt), Save-/Share-Komponenten.

- [x] G17: `hashchange`-Listener in App — Share-Links wirken im offenen Tab; die
      SharedBranchView hat Vorrang vor dem geladenen Replay („New Replay" kehrt zurück).
- [x] G16: Gespeicherte Branches sind nutzbar: „Open" (setzt den Hash → Read-only-View),
      „Delete" (`deleteSavedBranch`), vollständige scrollbare Liste statt Top 5.
- [x] G18: Malformed Hash → „This share link is invalid or damaged…" (statt rohem
      JSON-Fehler), kaputter Hash wird aus der URL entfernt; Banner erscheint auch bei
      geladenem Replay.
- [x] Serialisierung: unverändert `version: 1` (Payload-Felder sind Display-Strings,
      siehe WP1-Kompatibilitätsnotiz).

**Verifikation:**
- [x] Browser (10.07.): Save→Open (hashchange, ohne F5)→New Replay→Delete-Roundtrip
      (localStorage 1→0); kaputter Hash zeigt die freundliche Meldung und verschwindet
      aus der URL. Regression: `deleteSavedBranch`-Test in `branch-share.spec.ts`.

### WP14 · Branch-UX-Details (behebt G8, G9, G10, G11, G13, G14) — Aufwand: S/M

- [x] G14: `.ps-execute-wrap` ist `position: sticky; bottom: 8px` — der CTA bleibt im
      Viewport, auch im hohen Doubles-Layout.
- [x] G10: `reconstructBranchRuntime` erhält `playerNames` aus dem Replay — Sim-Seiten,
      Raw-Log und Winner-Zeile nennen die echten Spieler.
- [x] G11: History zeigt „Nickname (Spezies)" in Original- und Branch-Spalte
      (`displayName` in `BranchHistoryPanel`).
- [x] G9: Forced-Switch-Texte kontextabhängig — Faint: „X fainted! Choose who to send
      in:", Pivot: „X is switching out — choose who to send in:"; Header sagt „Choose a
      replacement" statt „What will X do?".
- [x] G8: Blockierte Switch-Buttons erklären sich per `title`/`aria-disabled`
      („… already chosen as the switch-in for your other slot").
- [x] G13: `|debug|`-Zeilen werden aus dem sichtbaren Embed-Log gefiltert (Raw Protocol
      Log zeigt sie weiterhin — dort gehören sie hin).

**Verifikation:**
- [x] Regression 84/84 + E2E 39/39 grün (Execute-im-Viewport- und Duplicate-Block-Tests
      decken Sticky-CTA und Tooltip-Pfad ab); Textänderungen sind statisch.

### WP15 · Team-Paste & TeamEditor (behebt G15, G20) — Aufwand: M

- [x] G15: Neue Paste-Pipeline (`team-paste.ts`, dependency-frei): Showdown-Export-Parser
      → Overlay als „manual" (grün) auf die P1-Seite des Stats-Panels; Müll-Pastes
      („asdf asdf") werden abgelehnt; Mismatch-Pastes zeigen Warnung + Match-Zähler
      („Team loaded (N Pokémon, M match this replay)"); Paste liegt in localStorage
      (`ps-replay-interceptor:team-paste`) und übersteht Reloads.
- [x] G20: TeamEditor-Modal nach WAI-ARIA-Dialog-Pattern (in WP10 miterledigt):
      Escape schließt, Backdrop-Klick schließt, Fokus wandert beim Öffnen in den Dialog
      (Tab-Trap) und kehrt beim Schließen zum Auslöser zurück — Browser-verifiziert.

**Verifikation:**
- [x] Regression `regression/team-paste.spec.ts`: Showdown-Export inkl. Nickname/EVs,
      deutsche Labels via `parseTeamText`, Müll-Ablehnung, manual-Overlay + Match-Zähler;
      Modal-A11y bereits in WP10 browser-verifiziert.

---

## Phase 4 — Feature-Lücke & Infrastruktur

### WP16 · Tera-/Mega-/Z-Move-Toggle im Branch (behebt G7) — Aufwand: L

Setzt das WP1-Choice-Datenmodell voraus.

- [x] UI-Toggles im Fight-Panel (`ps-modifier-row`): „Tera (Typ)", „Mega Evolve",
      „Ultra Burst", „Z-Move" — Verfügbarkeit kommt aus der Sim
      (`BranchSlotModifiers` via `pokemon.canTerastallize/canMegaEvo/canUltraBurst` +
      `actions.canZMove`), daher automatisch format-/gen-korrekt (Gen 3: keine Toggles,
      per Test belegt) und once-per-battle (verbrauchte Gimmicks verschwinden).
- [x] Choice-Serialisierung: `BranchSlotChoice.modifier`
      (`terastallize`/`mega`/`zmove`/`ultra`) → Resolver hängt den Sim-Suffix an
      (`move 1 terastallize`); Chips zeigen „(Tera)/(Mega)/(Z)/(Ultra)".
- [x] Z-Move: Toggle nur bei vorhandener Z-Option; bei aktivem Toggle zeigt das Grid den
      Z-Namen („→ Black Hole Eclipse"); Z gilt nur für Moves mit Z-Option.
- [x] History/Share: Modifier steckt in den strukturierten Slot-Choices und im
      gesendeten Kommando-String — kein Formatbruch (weiterhin `version: 1`).
- [x] Bewusst offen gelassen, seit 11.09.2026 als Beobachtung in `NextSteps.md` Abschnitt C: Damage-Preview rechnet den Toggle nicht vorab ein (Tera-Typ wird
      erst nach Ausführung im Calc berücksichtigt, da `SimPokemonInfo.teraType` dann
      gesetzt ist) — Anzeige vor der Ausführung bleibt der Nicht-Tera-Wert. Stand 11.09.: unverändert (die Fight-Sektion setzt den Toggle, `branch-damage.ts` kennt ihn nicht).

**Verifikation:**
- [x] Regression `regression/modifier-choices.spec.ts`: Tera-Verfügbarkeit, Kommando
      `move 1 terastallize`, `|-terastallize|` im Log, Verfügbarkeit danach weg,
      Gen 3 ohne Gimmicks.
- [x] gen7 (Browser, 10.07., gen7ou-2647005695): Hydreigon mit Darkinium Z →
      Z-Move-Toggle, Grid zeigt „→ Black Hole Eclipse", Chip `[move Dark Pulse (Z)]`,
      Sim-Log `|-zpower|p2a: Hydreigon`, Toggle danach verbraucht. (Hinweis: Toggles
      erscheinen nur, wenn das rekonstruierte Set einen Z-Kristall/Stein trägt —
      revealed oder Usage-Guess.)

### WP17 · Doku & Test-Stabilität (behebt G24, G25) — Aufwand: S

- [x] G24: Sandbox-Entscheidung in ARCHITECTURE.md dokumentiert („iframe sandbox":
      allow-scripts+allow-same-origin bewusst, Trust-Boundary = replay-embed.js).
- [x] G25: `expectReplayTurn` wartet jetzt zweistufig — erst bis `Replays.battle`
      existiert (30 s, CDN-Latenz), dann auf den Turn. Der Flaky-Modus (turn bleibt −1
      unter Last) betraf drei verschiedene Tests mit derselben Ursache.
- [x] Mobile-iframe-Verhalten (scrollbarer Container, 640 px Mindestbreite) in
      ARCHITECTURE.md dokumentiert.

**Verifikation:**
- [x] E2E-Vollauf nach dem Fix grün (39/39, finaler Lauf); die zuvor flakenden Tests
      liefen in dieser Session mehrfach durch.

---

## Rückverfolgung — jeder Befund → Arbeitspaket

### Bugs (20)

| # | Befund (Kurzform) | Sev. | WP | Erledigt |
|---|---|---|---|---|
| B1 | Move-Index-Mismatch: geklickter Move ≠ ausgeführter Move | hoch | WP1 | [x] |
| B2 | Random Battle: Branching komplett funktionslos (`global is not defined`) | hoch | WP5 | [x] |
| B3 | Open Team Sheets (`\|showteam\|`) werden ignoriert | hoch | WP3 | [x] |
| B4 | „Use Recommended" targetet eigenen Doubles-Partner | hoch | WP6 | [x] |
| B5 | Damage-Calc hart auf Gen 9 gepinnt | hoch | WP4 | [x] |
| B6 | Calc ignoriert Ability-/Item-Modifikatoren der Sim | hoch | WP4 | [x] |
| B7 | Gen 3: Branch-Deadlock durch Phantom-Forced-Switch | hoch | WP7 | [x] |
| B8 | Ungültige Custom-Choice: Silent Fail + Geister-History | hoch | WP2 | [x] |
| B9a | Replay-Playback stoppt nach genau einem Turn | hoch | WP8 | [x] |
| B9b | Mobile: Battle-Log außerhalb des iframe-Viewports | hoch | WP10 | [x] |
| B10 | Branch am End-Snapshot: Phantom-Switches / „Wiederbelebung" | mittel | WP8 | [x] |
| B11 | Neues Replay startet an alter Slider-Position (Spoiler) | mittel | WP8 | [x] |
| B12 | End-Snapshot per Slider-Sprung unerreichbar | mittel | WP8 | [x] |
| B13 | Smogtours-Replays bekommen nie Usage-Stats | mittel | WP9 | [x] |
| B14 | „unavailable"-Badge unerreichbar + CORS-Fehlerflut | mittel | WP9 | [x] |
| B15 | Team-Edit-Rebuild verwirft Forced-Switch-Entscheidungen | mittel | WP1 | [x] |
| B16 | Mega erzeugt doppelten Team-Eintrag (7 Karten) | mittel | WP11 | [x] |
| B17 | „Preparing branch…" 30–60 s ohne Feedback/Abbruch | mittel | WP7 | [x] |
| B18 | Mobile-Touch-Targets weit unter Minimum | mittel | WP10 | [x] |
| B19 | Kaputtes Sprite für „Greninja-*" (404) | niedrig | WP11 | [x] |
| B20 | EV-Felder clippen 3-stellige Werte bei 390 px | niedrig | WP10 | [x] |

### Gaps & Verbesserungen (25)

| # | Befund (Kurzform) | WP | Erledigt |
|---|---|---|---|
| G1 | Jeder Fehlerfall zeigt nur „Failed to fetch" | WP12 | [x] |
| G2 | Keine Eingabevalidierung im Loader | WP12 | [x] |
| G3 | Enter lädt nicht (kein Form-Submit) | WP12 | [x] |
| G4 | Fehlerbox ~300 px unter dem Eingabefeld | WP12 | [x] |
| G5 | „Ubers" ohne Gen-Angabe im Format-Tag | WP12 | [x] |
| G6 | Spread-Move-Range nur gegen Gegner-Slot A | WP4 | [x] |
| G7 | Kein Tera-/Mega-/Z-Toggle im Branch | WP16 | [x] |
| G8 | Duplicate-Switch-Block ohne Begründung | WP14 | [x] |
| G9 | Forced-Switch-Texte irreführend (Pivot ≠ Faint) | WP14 | [x] |
| G10 | Branch-Winner heißt „Player 1" statt Spielername | WP14 | [x] |
| G11 | History mischt Nicknames und Spezies | WP14 | [x] |
| G12 | Hidden-Power-Doppeltags (revealed + guessed) | WP11 | [x] |
| G13 | „[DEBUG] BP: 30." im sichtbaren Battle-Log | WP14 | [x] |
| G14 | Execute-Button unter dem Fold (1440×900) | WP14 | [x] |
| G15 | Team-Paste unsichtbar & ungeprüft, nicht persistent | WP15 | [x] |
| G16 | Gespeicherte Branches sind tote Textzeilen | WP13 | [x] |
| G17 | Kein hashchange-Handling für Share-Links | WP13 | [x] |
| G18 | Malformed-Hash: roher JSON-Fehler mit Mojibake | WP13 | [x] |
| G19 | Item-Reveals aus Heal-Messages/Mega fehlen | WP11 | [x] |
| G20 | TeamEditor-Modal: kein Escape/Backdrop/Fokus-Mgmt | WP15 | [x] |
| G21 | Randbats: „0 EVs unknown" als Dauer-Tag | WP11 | [x] |
| G22 | 901–1000 px sehr gedrängt (Breakpoint zu niedrig) | WP10 | [x] |
| G23 | Slider-Readout „T17/17" für End-Snapshot | WP8 | [x] |
| G24 | iframe-Sandbox-Entscheidung undokumentiert | WP17 | [x] |
| G25 | E2E-Test flaky unter Last | WP17 | [x] |

---

## Runde 2 — Befunde aus Benes Nachtest (10.07.2026)

Nach Abschluss der 17 WPs gemeldet; alle behoben und am Draft-Replay
(gen9draft-2298735122) browser-verifiziert.

| # | Befund | Fix | Erledigt |
|---|---|---|---|
| N1 | Poison Heal wird nicht erkannt | `[from] ability: X`-Attributionen (Heal/Damage-Zeilen) werden als revealed Ability übernommen; `[of]`-Fälle (z. B. Rough Skin) dem Besitzer zugeordnet (`opponent-inferrer.ts`) | [x] |
| N2 | Heavy-Duty-Boots-Erkennung bei liegenden Hazards | Switch-in bei liegendem Stealth Rock ohne Rocks-Schaden → guessed „Heavy-Duty Boots" (nur Gen 8+, Magic Guard ausgenommen, Schaden-Genommene ausgeschlossen) | [x] |
| N3 | „Thundurus can't Terastallize" nach fremdem Tera + Wechsel | Der Toggle-State war lokales Component-State und klebte an allen Folge-Moves; jetzt Reset per Effekt, sobald das Gimmick nicht mehr verfügbar ist, plus Verfügbarkeits-Doppelcheck in `withModifier` | [x] |
| N4 | Screenshot „Selection got broken" (No active Pokémon in P2A…) | Ursache = N6 | [x] |
| N5 | Custom-Eingabe unverständlich | Freitext-Feld durch Dropdown ersetzt: alle legalen Choices (Moves inkl. Doubles-Ziele, Switches mit HP), Auswahl wird direkt übernommen; blockierte Switches disabled | [x] |
| N6 | „Cannot switch"/Konsistenzprobleme bei langem Spielen | **Root Cause:** kein In-Flight-Schutz — Doppelklicks/schnelle Klicks feuerten überlappende Sim-Writes, der zweite committete einen ungewollten Extra-Turn → UI/Sim-Desync. Fix: `executing`-Guard in `useBranch` (Execute-Button disabled + „Executing…", setChoice geblockt während des Laufs); zusätzlich wartet `executeBranchChoices` nach Erfolg auf Log-Ruhe (End-of-Turn-Residuals wie Gift-Faints vollständig im Snapshot) | [x] |
| — | E2E-Flaky (Rest von G25) | Embed-Skript wird pro Testlauf einmal geholt und aus dem Speicher ausgeliefert (CDN-Stalls raus) | [x] |

**Verifikation Runde 2:**
- [x] Regression `regression/followup-fixes.spec.ts` (Poison Heal, Rough Skin via `[of]`,
      Boots-Inferenz inkl. Negativfall, Doppel-Execute-Engine-Verhalten dokumentiert).
- [x] Browser Long-Play am Draft-Replay: Branch T5 → 15 Runden (13 Executes **mit
      absichtlichen Doppelklicks**, 2 Forced-Switches) bis Turn 18 — null Fehler,
      History lückenlos, je Doppelklick genau ein Turn.
- [x] Browser: Tera-Chip `[move Protect (Tera)]` → `|-terastallize|` → Folge-Chip ohne
      „(Tera)"; Dropdown zeigt „All choices… / Moves / Switch to (HP)".
- [x] Suiten: Regression 96 passed / 2 skipped, E2E 39/39, Build/Lint grün.

## Runden 3 bis 7 — Nachtest-Befunde nach Release 0.2.0 (17.07. bis 31.07.2026)

Je ein Befund pro Runde (Runde 6 zwei), alle behoben, mit Regressionstest und Commit; Diagnosen in der Memory-Notiz `qa-campaign-2026-07`.

| Runde | # | Befund | Fix | Commit |
|---|---|---|---|---|
| 3 (17.07.) | N7 | „Cannot switch to Metagross“ (gen9draft-2298735122, Branch ab Turn 16) | `correctActivesFromProtocol` spiegelt den Array-Swap von `BattleActions#switchIn`: vorher wurden `side.active` und `position` umgehängt, `side.pokemon` nicht, und der nächste Sim-Switch duplizierte ein Teammitglied; `regression/active-correction.spec.ts` | 8339b5d |
| 4 (20.07.) | N8 | Sandstorm-Schaden fehlt im Gen-3-Branch (gen3customgame-2115579570, ab Turn 20) | Der Client meldet Wetter per Display-Name („Sand“); Rückübersetzung `CLIENT_WEATHER_IDS` in branch-engine, `weatherState`-Sync nur bei Abweichung; `regression/weather-correction.spec.ts` | a6e111e, ead5130 |
| 5 (30.07.) | N9 | Gift wirkt im Gen-3-Branch nicht richtig (Toxic-Residual 0) | `correctStatusFromSnapshot` spiegelt `Pokemon#setStatus` (statusState, Toxic-Stufe, Schlaf-Zähler); `regression/status-correction.spec.ts`; Default-Replay wird gen9draft-2058494320 | ec6b1cd, 73f60fc |
| 6 (31.07.) | N10 | „(consumed)“-Tag leckt in Import, Export und Editor | geteilter `itemSetValue`-Helfer an allen Set-Grenzen, das Stats-Panel behält die Annotation | 3b7ddbb |
| 6 (31.07.) | N11 | Kyurem-Edit auf Draco Meteor erscheint nicht, weil das eingebettete Team-Sheet Vorrang hatte | manuelle Moves sind primär, das Sheet füllt nur auf (`mergeMoveLists`); die „What if“-Zeile teilt sich die Picker-Zeile mit Execute | c85b348 |
| 7 (31.07.) | N12 | Switch zu Dragapult wird nicht ausgeführt, Cryogonal stirbt („already in“) | `commitRejectedChoicesWithDefaults` in `reconstructBranchRuntime`: abgelehnte Protokoll-Choices antworten mit `default`, die Rekonstruktion bleibt im Lockstep; `regression/stale-choice-correction.spec.ts` | 12f8e3d |
