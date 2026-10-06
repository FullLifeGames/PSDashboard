# Next Steps (Stand 06.10.2026, nach Runde 63)

Nur offene Schritte, als priorisierte Checkliste: Die oberste Welle ist die nächste Runde; ihre Spuren laufen parallel, je Spur zuerst das oberste offene Kästchen (Abschnitt „Parallel arbeiten“). Jedes TODO nennt das Problem an einer Spielszene und das Erfolgsmaß. Die Umsetzungsschritte jedes TODOs stehen als Checkliste im Backlog-Plan unter derselben Nummer; beim Start einer Welle schreibt ihre Spec die Schritte neu; unter „Runde 62 (neu gefasst)“ sind die alten Kästchen dort nur Hintergrund.

- **Iterationen** bündeln die TODOs einer Sitzung. Eine Iteration wird beim Start zur Runde mit der nächsten freien Rundennummer: Iteration 1 war Runde 46, Iteration 2 war Runde 47, Iteration 2a war Runde 48, Iteration 2b war Runde 49, Iteration 3 war Runde 50, Iteration 4 war Runde 51, Iteration 4a war Runde 52, Iteration 4d war Runde 53, Iteration 4b war Runde 54, Iteration 4e war Runde 55, Iteration 4c war Runde 56, Iteration 4f war Runde 57. Runde 58 war die Sichtung „Was bauen wir nach?“ außer der Reihe; seit ihrem Gate stehen die Iterationen S1 bis S3 des Programms „Mehr Simulation“ oben, vorgesehen als Runden 59 bis 62; Iteration S1 war Runde 59, Iteration S1a war Runde 60, Iteration S2 war Runde 61, Iteration S3 war Runde 62 (Triage). Seit Runde 62 heißen die Bündel Wellen: Eine Welle ist eine Runde, ihre Spuren laufen parallel mit je einem Sub-Agent; Welle 1 war Runde 63; ihr Gate (06.10.) zog die Reste als Welle 1.5 vor Welle 2, Welle 1.5 wird Runde 64. Score-berührende TODOs bekommen je ihre eigene Messung (D3), nie eine gemeinsame.
- **T-Nummern** (T01 bis T45) sind feste Namen, vergeben am 18.09. in Prioritäts-Reihenfolge. Wandert ein TODO in der Liste, behält es seine Nummer; ein neues TODO bekommt die nächste freie (ab T128; T46 kam am 18.09. in Runde 46 dazu, T47 bis T51 in Runde 47, T52 und T53 in Runde 48, T54 in Runde 49, T55 in Runde 50, T56 bis T64 in Runde 51, T65 am 19.09. nach deren Gate, T66 bis T68 am 20.09. in Runde 52, T69 am 20.09. in Runde 53, T70 bis T74 am 21.09. in Runde 54, T75 am 21.09. in Runde 55, T76 am 23.09. am Gate der Runde 56, T77 bis T80 am 23.09. in Runde 56, T81 am 23.09. am Gate der Runde 57, T82 am 23.09. in ihrer Spec, T83 bis T90 am 24.09. in Runde 57, T91 bis T102 am 24.09. am Gate der Runde 58, T103 am 01.10. in Runde 59, T104 am 02.10. in Runde 60 vergeben und dort erledigt, T105 bis T107 am 02.10. in Runde 60, T108 am 02.10. nach ihrem Gate, T109 bis T111 am 04.10. in Runde 61, T112 bis T116 am 05.10. in Runde 62, T117 am 05.10. aus den Experten-Urteilen zu T45, T118 bis T127 am 06.10. in Runde 63). Seit Runde 62 sind 36 Nummern stillgelegt; sie stehen mit Beleg und altem Text in `docs/completed/triage.md`. „braucht T01“ heißt: T01 muss vorher gelaufen sein.
- **Backlog-Plan** (je TODO: Idee, Schritte mit Dateien, volles Gate, Doubles-Abdeckung, offene Entscheidungen, Zahlen, Code-Belege): `docs/superpowers/plans/2026-09-18-backlog-plans.md`.
- **Erledigtes**: `docs/completed/` nach Gebiet (Index, Eintragsformat und Prozess in `docs/completed/README.md`).
- **Maschinen-Quellen**: Ledger in `regression/eval-calibration.spec.ts`, Pins in `e2e-feedback/corpus.ts`, Memory-Notizen.
- Diese Datei liegt seit 06.09. im Repository; `docs/` bleibt gitignored.

Die Schritte stammen aus dem Entwurf vom 18.09. (Code-Stand dcf9526); Runde 62 hat jedes TODO gegen den Stand 5d428b2 neu gelesen, und Texte mit „Runde 62 neu gefasst“ im Backlog-Plan gehen den alten Schritten vor. Jede Runde bekommt vor dem Bau weiterhin ihr Brainstorming und ihre Spec; die Schritte hier sind deren Startpunkt, und die Spec darf sie ersetzen. Ältere Dokumente nennen Q6 und Q4 gemeinsam „Runde 46“; hier sind es T06 und T09 in den Iterationen 2 und 3.

Hinter jedem Titel stehen Thema, Art, Größe (mini, klein, mittel, groß), Gate (score-berührend = D3, verlustfrei = D4, sonst ausgeschrieben) und „braucht“ = muss vorher gelaufen sein. Seit Runde 62 trägt jedes TODO einen *Nutzen:*-Satz: was es der Engine (Bank, Pins, Feedback) oder der App (sichtbar, Tempo) bringt.

## Programm · Mehr Simulation (Runden 59 bis 62, abgeschlossen)

Das Programm ist mit Runde 62 abgeschlossen: Tempo-Schicht (Runde 59), Regelfehler am Simulator-Übergang (Runde 60), Baum ab dem ersten Zug (Runde 61) und die Triage aller übrigen TODOs (Runde 62, 36 geschlossen, 39 behalten, T112 bis T116 neu). Begründung und Ergebnisse stehen in `MoreSimulation.md`, im Programm-Plan `docs/superpowers/plans/2026-09-24-program-more-simulation.md` und in `docs/completed/eval-quality.md`. Gate der Runde 62 (05.10.2026, „1a / parallel / 3a“): `r59` geht per Fast-Forward in `v1` und `v1` wird gepusht, master bleibt auf 94c88d9.

## Parallel arbeiten: Wellen und Spuren

Gate der Runde 62 (05.10.2026): Die nächsten Schritte laufen mit mehreren Sub-Agents parallel. Die Liste ist deshalb in 3 Wellen geteilt; eine Welle ist eine Runde, jede Spur einer Welle ist die Arbeit eines Sub-Agents. Die Spuren einer Welle teilen keine Datei, Abhängigkeiten liegen zwischen den Wellen. Jede Spur nennt ihre Dateien und ihr Tor. Welle 1 war Runde 63 (06.10.); ihr Gate („7a“) stellt die neuen TODOs aus den Spuren und Reviews als Welle 1.5 vor Welle 2.

| Welle | Spur | TODOs | Tor |
| --- | --- | --- | --- |
| 1.5 | A · Doubles-Beweiser | T118 | Bank gepaart, Feedback 3×, Zählung der Doubles-Beweise vorher und nachher; der Pin 2630685175 Zug 8 bleibt ok. |
| 1.5 | B · Statik: Präzision und Re-Fit | T125 (Punkte 1 bis 3), T127 | roter Test je Punkt; Fit-Korpus out-of-sample in allen Seeds; Bank mit beiden Tabellen, Doubles getrennt; Feedback 3× mit Tier-Zählung; Golden 655336 zuerst. |
| 1.5 | C · Nachprüfung: Längen und Streuung | T119 | MC-Orakel an den Szenen und über alle Korpus-Züge mit Nachprüfung; Doubles-Baumzeit im Zeitfenster; Bank gepaart, jede bewegte Zeile gelesen; Feedback 3×. |
| 1.5 | D · Veto-Regel und Items | T120, T125 (Punkt 4) | Set-Diff auf Bank und Feedback; Bank gepaart ohne gepoolten Doubles-Schaden; Feedback 3×. |
| 1.5 | E · Bericht: Satz-Reste | T123 | Engine-Zahlen der Dumps byte-gleich, Prosa-Pins, UI-Tests. |
| 1.5 | F · Vorschau: Reste | T124 | UI-Tests und e2e; Bank und Feedback unberührt. |
| 1.5 | G · Nachbau: Items und Wechsel | T121 | Zählung Brett-Item gegen Protokoll auf 0; Bank gepaart, Feedback 3×. |
| 1.5 | H · Tempo-Löser: Reste | T122 | gebrochene Reihenfolgen bleiben 0, die strenge Zählung sinkt; Set-Diff; Bank gepaart, Feedback 3×. |
| 2 | A · Rechner-Eingaben | T83, T72, T76, T100, T84 | Zählung je TODO auf 0, Dumps (Quoten, Zeilen), jede bewegte Bank-Zeile gelesen. |
| 2 | B · Wahlen, Wurzelwert, Tiefer denken | T113, T114, T109, T111 | Prüfstände, Bank-Lauf mit dem Spielwert der Wurzel neben dem Score (das Bank-Feld baut der Integrator), Feedback 3×, UI-Tests und e2e für T109, Score-Frage von T114 am User-Gate. |
| 2 | C · Gegner-Inferenz | T108 | Zählung Client gegen Inferenz gelesen, Bank gepaart, Feedback 3×. |
| 2 | D · Bericht, zweiter Teil | T22, T59, T64 | Engine-Zahlen unberührt, Dumps und Prosa-Pins, chance-Pins 573756 t73 und 649664 t23 stehen. |
| 2 | E · Panel und Knöpfe | T85, T69 | UI-Tests und e2e, Set-Diff 0. |
| 2 | F · Doubles-K am Blatt | T52 | Bank mit K der Bank und eigenem K je Phase, Doubles-Tier-Zählung. |
| 3 | A · Fitter und Doubles-Schaden | T31, T26, T86 | Set-Diff, Fit-Fehler je Familie, Bank mit frischer Basis, Feedback 3×. |
| 3 | B · Statik-Gewichte | T42, T49, T102, T39 | Bank mit beiden K-Lesungen, Fit-Korpus mit Kreuzprüfung, Feedback 3× mit Tier-Zählung. |
| 3 | C · Prozent-Anzeige | T51 | Anzeige-Kalibrierung, Re-Pins der Prosa am User-Gate, kein Urteil bewegt sich. |

T126 (vier Tests ohne Biss) läuft verteilt: Jeder Test geht an die Spur der Welle 1.5, der seine Datei gehört (B, C, F).

**Regeln für parallele Spuren.**

- Eine Welle ist eine Runde. Jede Spur ist ein Sub-Agent auf einem eigenen Branch und Worktree vom Stand bei Wellen-Start; die Hauptsitzung ist Integrator. Die Spuren einer Welle teilen keine Datei (Runde 62 am Code geprüft); Abhängigkeiten liegen zwischen den Wellen.
- Datei-Hoheit: Eine Spur ändert nur die Dateien ihrer Liste. Braucht sie eine fremde Datei, meldet sie das dem Integrator und ändert sie nicht selbst.
- Nur der Integrator ändert: NextSteps.md, docs/completed/, den Ledger-Block und das Sample-Format in regression/eval-calibration.spec.ts, die Mess-Skripte (scripts/run-calibration.mjs, scripts/paired-calibration.mjs), e2e-feedback/corpus.ts, Fixtures und den Feedback-Harness (Pins, Re-Pins nur am User-Gate), EVAL_ENGINE_CACHE_VERSION in src/lib/eval-cache-store.ts (ein Bump je Welle) und eslint.ratchet.mjs.
- Barrels und API-Snapshot: Die Barrels packages/*/src/index.ts und der Snapshot in regression/fixtures/api/*.txt sind gemeinsame Dateien. Eine Spur, die einen Export ändert, schreibt den Snapshot in ihrem Branch mit UPDATE_API_SNAPSHOT=1 neu und nennt den Diff im Bericht; der Integrator führt Barrels und Snapshot beim Merge zusammen.
- Messungen: eine schwere Messung zur Zeit auf der Maschine (Bank, Feedback, e2e, volle Regression), über die Warteschlange des Integrators; ein Bank-Lauf dauert rund 13 Minuten (r61-t98b 794 s), ein Feedback-Lauf rund 5. Während einer Wanduhr-Messung (Zeit-Tore von T110, T81, T112, T16, T78, T113) ruhen alle Spuren: keine Sonde, kein Test, kein Build; Zeit-Tore laufen gebündelt in einem Fenster und messen gegen einen festen Commit (den Wellen-Start), nie gegen einen Branch-Namen: Der Branch wandert mit dem Merge (Runde 63, erstes Fenster ungültig). Sonst dürfen Sonden auf einzelnen Stellungen parallel laufen, je höchstens 5 Minuten.
- Git-Stopp und Absturz-Schutz: Alle Worktrees teilen ein .git. Vor jedem schweren Lauf meldet der Integrator einen Git-Stopp; alle Spuren committen und flushen vorher (D23), bis zum Ende des Laufs schreibt niemand in .git. Der Smogon-Cache ist vor Wellen-Start warm und gilt während der Welle als nur lesbar.
- Messungs-Worktree: Messungen laufen in einem eigenen Worktree des Integrators, der die Spur-Commits nacheinander auscheckt. Jede Spur misst gegen dieselbe Basis vom Wellen-Start (eine neue Basis, sobald ein neuer Tag beginnt) und liest gepaart mit dem K der Bank und mit eigenem K je Phase.
- Sonden in Worktrees: docs/ ist gitignored und fehlt in jedem Worktree. Plan, Spec und Sonden liest eine Spur im Haupt-Checkout, nur lesend; docs/ kommt nie als Junction in einen Worktree. Sonden-Configs nehmen ihre Wurzel aus PROBE_ROOT und importieren Repo-Code nur über Aliase (@engine, @replaycore, @regression, die Paketnamen), damit eine Sonde mit PROBE_ROOT=<eigener Worktree> den Code der Spur rechnet. Vor Welle 1 prüft der Integrator das in einem Worktree an einer Sonde mit bekanntem Ergebnis.
- Worktrees: nie git worktree remove auf einem Worktree mit Junctions; Junctions (.calibration, .smogon-cache, .fit-corpus, node_modules) vorher mit [System.IO.Directory]::Delete lösen. Keine automatische Worktree-Isolation des Agent-Werkzeugs, weil sie Worktrees ohne getrackte Änderung selbst entfernt und dabei Junctions folgen würde.
- Merge: Der Integrator merged die Spuren in der Reihenfolge der Liste, jede Spur vorher auf den Wellen-Stand rebased; Konflikte löst er nur, nachdem er die Konflikt-Marker gezählt hat. Danach rechnet er den Wellen-Lauf (Bank gegen die Basis, Feedback 3×); zeigt der Lauf einen Schaden, den keine Spur allein zeigte, rechnet er Spur für Spur zurück.
- Ein User-Gate je Welle mit einer Tabelle über alle Spuren. Commits englisch und ohne Attribution, kein Push ohne Okay, Singles und Doubles gleichrangig, keine Spiellogik hart kodieren.
- Schritt 1 von T52 (eigenes K je Phase in scripts/paired-calibration.mjs) und die Sonden-Config mit PROBE_ROOT stehen seit Runde 63 (888cd12; PROBE_ROOT in einem Worktree an einer Sonde mit bekanntem Ergebnis geprüft). Die Kästchen unter „Runde 62 (neu gefasst)“ im Backlog-Plan sind Hintergrund; die Spec der Welle schreibt die Schritte jeder Spur neu.

## Welle 1.5 · Spur A · Doubles-Beweiser

Dringend vor allen anderen: Der Beweiser prüft in Doubles nur die Antworten, die der Baum der Gegenseite behält, und findet so einen Scheinsieg direkt vor dem ersten Doubles-Pin.

*Dateien:* packages/eval-engine/src/search/forced-win.ts, search/forced-win-apply.ts, endgame/prover.ts.

*Tor:* Bank gepaart, Feedback 3×, Zählung der Doubles-Beweise vorher und nachher; der Pin 2630685175 Zug 8 bleibt ok.

- [ ] **T118 · Der Doubles-Beweiser prüft jede Antwort der verteidigenden Seite** (Endspiel, Mini-Runde, klein, score-berührend D3)

  VGC 2630685175 Zug 7: Der Beweiser findet einen Zwangssieg für p1 (Masse 1, ein Zug) und macht p1s gespieltes U-turn + Tera Starstorm zum Fehler (Regret 1,233). Er prüft die Linie Wood Hammer → Calyrex-Shadow + Earth Power → Zamazenta-Crowned nur gegen die 12 Kombinationen, die p2s Baum behält, von 36 erlaubten. Keine der 12 enthält Protect auf Zamazenta. Im Simulator gewinnt die Linie gegen 30 der 36 Antworten und verliert gegen alle sechs mit Protect (Beleg: `docs/perf/probes/2026-10-05-r63/lanes/B/proof-2630685175.vt.ts`). T81 hat den Fehler freigelegt, nicht verursacht: Body Press zählt jetzt Zamazentas Verteidigung und drängt die Protect-Kombinationen aus der Rangliste. Zug 8 ist der erste Doubles-Pin (T45).

  *Nutzen:* Engine und App: kein Scheinsieg und keine Fehler-Note mehr aus einer gekürzten Antwortliste in Doubles; schützt den ersten Doubles-Pin.

  *Erfolg:* 2630685175 Zug 7 ohne Zwangssieg; der Beweiser prüft alle erlaubten Antworten oder mindestens jede mit Protect; Zählung über die Doubles-Beweise der Bank und der vier Doubles-Dumps vorher und nachher; Bank gepaart, Feedback 3×.

## Welle 1.5 · Spur B · Statik: Präzision und Re-Fit

STAB nach den Spielregeln bleibt in der Statik (Gate der Runde 63: was richtig ist, bleibt; falsch sind die Gewichte). Die Spur macht zuerst die Statik genau und fittet dann ihre Gewichte neu, auf dem Statik-Stand der Spur. Die breitere Modellform fittet T102 in Welle 3 noch einmal.

*Dateien:* packages/eval-engine/src/score/threat.ts, score/matchup.ts, score/weights.ts, search/hints.ts, regression/eval-fit.spec.ts (Fit-Werkzeug); dazu aus T126 packages/eval-engine/test/tera-hints.spec.ts und hint-memo.spec.ts.

*Tor:* je Punkt von T125 ein roter Test aus dem Simulator; Fit-Korpus out-of-sample in allen Seeds; Bank gepaart mit beiden Tabellen, Doubles getrennt; Feedback 3× mit Tier-Zählung; Golden 655336 zuerst.

- [ ] **T125 · Statik: kleine Präzisionsfehler** (Statik, Mini-Runde, klein, score-berührend D3; Punkte 1 bis 3, Punkt 4 liegt in Spur D)

  Aus den Reviews der Runde 63: (1) der Merkzettel der Statik (`threat.ts:128`) führt für Body Press die Verteidigung des Angreifers und für Foul Play den Angriff des Ziels nicht im Schlüssel (nach Guard Split oder Power Split antwortet er mit dem alten Wert, je nach Reihenfolge der Abfragen); (2) `setupEquity` (`hints.ts:43`) zählt die Boosts jedes Status-Zugs als eigene (Swagger, Coaching) und lässt spe, accuracy und evasion aus, die Stored Power zählt; (3) der Vergleich „ohne Boosts“ in `matchup.ts:55` setzt nur atk und spa zurück; (4) `item-evidence.ts`: Ally Switch lässt die Slot-Karte veralten (ein Leftovers-Ausschluss trifft ein Pokémon auf der Bank), Life Orb zeigt in Gen 4 bei festem Schaden keinen Rückstoß, und in Formaten mit freien Fähigkeiten gilt die Fähigkeitsliste der Art nicht.

  *Nutzen:* Engine: der Merkzettel antwortet unabhängig von der Reihenfolge, und Item-Ausschlüsse irren in seltenen Fällen nicht mehr.

  *Erfolg:* je Punkt ein roter Test aus dem Simulator; Bank gepaart (erwartet fast unbewegt), Feedback 3×.

- [ ] **T127 · Re-Fit der Statik-Gewichte mit STAB nach den Regeln und dem neuen Zugkern** (Re-Fit, Runde, mittel, score-berührend D3)

  Gate der Runde 63: STAB nach den Spielregeln (Tera-Typ, alte Typen, 2,0 bei gleichem Typ, Adaptability) bleibt in der Statik, weil er richtig ist. Die Bank las ihn allein rund 14 bp schlechter (eigenes K je Phase, aufgelöst, fast ganz Doubles), weil die Gewichte auf die Tera-blinde Regel gefittet sind. Zugleich rechnet die Statik seit T81 Züge, wie sie landen (Low Kick, Heat Crash, Mehrfachtreffer, Body Press). Weg: die Gewichte auf dem Fit-Korpus neu fitten, mit der heutigen Statik, gelesen mit beiden Bank-Tabellen; die Modellform bleibt.

  *Nutzen:* Engine: die richtige STAB-Regel ohne Bank-Kosten, Gewichte passend zum neuen Zugkern.

  *Erfolg:* Fit-Korpus out-of-sample besser in allen Seeds; Bank gepaart gegen die Basis der Welle ohne gepoolten Schaden in beiden Tabellen, Doubles getrennt; Feedback 3× mit Tier-Zählung; Golden 655336 zuerst.

## Welle 1.5 · Spur C · Nachprüfung: Längen und Streuung

Seit T16 vertieft die Nachprüfung je Klasse über einen Vertreter. Wo ein Vertreter die Klasse nicht trägt, entstehen falsche Noten.

*Dateien:* wie Spur 1C (packages/eval-engine/src/tree-orchestrator.ts, mcts-merge.ts, search/cell-sampler.ts, search/verify-cell.ts, verify-select.ts, pair/sampler.ts, cell-blend.ts); dazu aus T126 packages/eval-engine/test/tree-orchestrator.spec.ts.

*Tor:* MC-Orakel an den genannten Szenen und über alle Korpus-Züge mit Nachprüfung; Doubles-Baumzeit im gemeinsamen Zeitfenster; Bank gepaart, jede bewegte Zeile gelesen; Feedback 3×; Golden 655336 zuerst (D7).

- [ ] **T119 · Nachprüfung: verborgene Längen und Streuung in einer Klasse** (Zufall preisen, Runde, mittel, score-berührend D3)

  Seit T16 vertieft die Nachprüfung je Klasse über einen Vertreter. Zwei Fälle trägt ein Vertreter nicht: (1) verborgene Längen, die keine Log-Zeile teilt. VGC 2629703929 Zug 8: Die Treffer-Klasse von Sleep Powder vertieft über eine Ziehung zu −0,479, das Mittel der Klasse liegt bei −0,018, p1 bekommt einen falschen Fehler (0,227 gegen MC keine Note). (2) Streuung in einer Klasse: 648453 Zug 2 p2 (Steam Eruptions 30-%-Verbrennung in einer Klasse, Vertreter 0,18 gegen MC 0,11, die Note geht verloren) und 653785 Zug 15 p1 (falsche Ungenauigkeit 0,124 gegen MC 0,089 und 0,068). Dazu der Doubles-Preis der Vertiefung: eine Doubles-Teilsuche kostet rund 0,25 s, darum vertieft Doubles nur den schwersten Ausgang (912045 Zug 8: Rückfall-Zelle −0,97 gegen MC −0,45). Belege: `docs/perf/probes/2026-10-05-r63/lanes/C/ledger.md`, MC-Orakel `lanes/C/mc-oracle.vt.ts`.

  *Nutzen:* App: weniger falsche Noten auf Zügen mit Schlaf, Verwirrung und Verbrennung, in beiden Spielarten.

  *Erfolg:* die genannten Szenen stimmen mit dem MC-Orakel überein; MC-Zählung über alle Korpus-Züge mit Nachprüfung nicht schlechter (heute Singles 144 von 148, Doubles 49 von 54); Doubles-Baumzeit im Rahmen (heute +19 % gegen 888cd12).

## Welle 1.5 · Spur D · Veto-Regel und Items nach einem Ausschluss

Gate der Runde 63: Die Smogon-Sets gelten wie veröffentlicht. Die Veto-Regel sollte nur Paare verhindern, die sich widersprechen; heute streicht sie mehr.

*Dateien:* wie Spur 1D für Sets (packages/replay-core/src/set-coherence.ts, team/set-resolvers.ts, team-builder.ts, smogon/sets-lookup.ts), dazu packages/replay-core/src/inference/item-evidence.ts für T125 Punkt 4.

*Tor:* Set-Diff auf Bank und Feedback (D8); Bank gepaart, Doubles getrennt, ohne gepoolten Doubles-Schaden gegen die Basis der Welle; Feedback 3×; je Punkt ein roter Test.

- [ ] **T120 · Veto-Regel nur für widersprüchliche Paare, und das Item nach einem Ausschluss** (Sets und Spreads, Runde, mittel, score-berührend D3)

  Gate der Runde 63: Die Smogon-Sets gelten wie veröffentlicht (d2, Rillaboom mit Grassy Glide neben Wood Hammer, Kyurem mit Ice Beam neben Freeze-Dry). Veto-Zeile 2 sollte ursprünglich Paare verhindern, die sich widersprechen, etwa Close Combat neben Body Press; heute streicht sie jeden zweiten geratenen Angriff desselben Typs. Weg: die Regel auf Paare verengen, die sich nach den Daten des Dex widersprechen (Body Press liest die Verteidigung, Close Combat senkt sie; keine Handliste), und die drei Doubles-Spiele lesen, die mit den vollen Sets schlechter lesen als ohne (937928, 938640, 2663102863; d2 gegen r63-base +59 bp fest und +43 eigenes K in Doubles, aufgelöst). Dazu (2) das Item nach einem bewiesenen Ausschluss ist geraten: 2663102863 Gholdengo, Leftovers ausgeschlossen, der Bau nimmt Choice Specs (+19 bis +21 bp der Doubles-Zeilen); Rocky Helmet ab Gen 7 (braucht das Item des Angreifers, 16 Gen-9-Bank-Sets) und Shell Bell (noch keine Regel).

  *Nutzen:* App: Sets wie veröffentlicht, ohne widersprüchliche geratene Paare; Engine: die Doubles-Lesung der drei Spiele erklärt, weniger geratene Items nach einem Ausschluss.

  *Erfolg:* die Regel trifft nur widersprüchliche Paare, abgeleitet aus dem Dex; reine Slot-Fälle bleiben bei 2; für jedes der drei Doubles-Spiele eine Lesung, und kein gepoolter Doubles-Schaden gegen die Basis der Welle; jedes Ersatz-Item mit Beleg oder als Nutzungs-Mehrheit markiert; Bank gepaart, Feedback 3×.

- T125 Punkt 4 (`item-evidence.ts`: Ally Switch, Life Orb in Gen 4, freie Fähigkeiten) läuft in dieser Spur; Text unter Spur B.

## Welle 1.5 · Spur E · Bericht: Satz-Reste

Rund ein Dutzend Sätze lesen falsch oder in Doubles unehrlich. Engine-Zahlen bleiben unberührt.

*Dateien:* wie Spur 1E (packages/eval-engine/src/turn-analysis/, summary.ts, report.ts, win-reason.ts, played.ts, prose/, src/components/EvalGameReport.tsx, src/components/EvalTurnAnalysis.tsx, src/components/eval/SideRow.tsx, src/components/eval/analysis-bits.tsx, src/components/eval/EvalResultBlock.tsx, src/lib/analysis-context.ts).

*Tor:* Engine-Zahlen der Dumps byte-gleich (Score, Tiers, Bank ohne Lauf), Feedback-Dumps und Prosa-Pins, UI-Tests.

- [ ] **T123 · Bericht: Satz-Vorlagen, Einheiten und Doubles-Lücken** (Bericht, Mini-Runde, klein, verlustfrei D4)

  Aus Spur 1E und dem Review: (1) die Read-Vorlage schreibt „played switching to Lopunny-Mega … over the safe switching to Bisharp“ (648453 Zug 13), in Doubles „the safe switching to Chi-Yu + Solar Beam→Groudon“ (2629703929 Zug 1); (2) „wins in 5 against every reply“ ohne Einheit; (3) „one 100% roll“ kann in `EvalGameReport.tsx:173` noch stehen, `summary.ts:86` nennt 99,5 % „sure KO“; (4) „the next turns paid it back“ für ein nicht verifiziertes Opfer (`SideRow.tsx:104`); (5) die Doubles-T0-Karte zeigt „✓ the engine's leads“ trotz T116; (6) der Read-Gutschrift fehlt in Doubles der Hinweis auf einen verdeckten Slot; (7) der Nenner der Fast-Sieg-Phase zählt in VGC sechs statt vier gebrachte Pokémon (`analysis-context.ts:26`); (8) ein Regret über 1 (912045 Zug 9: 1,737 und 1,406) steht auf der Skala [−1, 1] und braucht eine eigene Darstellung; (9) der Entschieden-Satz spricht je Seite einmal, 2630685175 Zug 9 bleibt nach Zug 6 still; (10) ein Opfer zählt nur ab dem ersten Faint einer Seite (4 Korpus-Züge mit zwei Faints, 3 in Doubles).

  *Nutzen:* App: rund ein Dutzend Sätze lesen richtig und in Doubles ehrlich.

  *Erfolg:* jede Stelle mit Szene und rotem Test; Engine-Zahlen der Dumps byte-gleich.

## Welle 1.5 · Spur F · Vorschau: Reste

Die Vorschau zeigt in einigen Fällen Zahlen, die das Spiel nicht erlaubt.

*Dateien:* wie Spur 1F (src/lib/branch-damage.ts, packages/eval-engine/src/damage-calc.ts, src/components/BranchPanel.tsx, src/components/branch/SideControls.tsx, src/components/branch/FightSection.tsx, src/hooks/useSideControlsState.ts), dazu src/components/ReplayWorkspace.tsx; aus T126 ui/components/BranchPanel.spec.tsx.

*Tor:* UI-Tests und e2e; Bank und Feedback unberührt.

- [ ] **T124 · Vorschau: Doubles-Tera, Mehrfachtreffer und Toggles** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  Aus Spur 1F und dem Review: (1) beide Doubles-Slots einer Seite können Tera scharf schalten, die Vorschau zeigt zwei terastallisierte Pokémon, Execute scheitert; (2) scharfe Toggles bleiben über die Navigation stehen und ändern still die Zahlen (`ReplayWorkspace.tsx:129`); (3) 2–5-Treffer zeigen fest 3 Treffer, Loaded Dice fehlt; (4) Protect auf dem Dragon-Darts-Partner sieht die Vorschau nicht; (5) der Stellar-Erstboost fehlt; (6) der Test „Mega Evolve stays out of the preview“ kann nicht scheitern.

  *Nutzen:* App: die Vorschau zeigt nur Zahlen, die das Spiel erlaubt, in beiden Spielarten.

  *Erfolg:* je Punkt ein roter Test; Bank und Feedback unberührt.

## Welle 1.5 · Spur G · Nachbau: Items und Wechsel

Das Brett soll die Items und Pokémon tragen, die das Spiel zeigt.

*Dateien:* wie Spur 1G (packages/eval-engine/src/choice-lock.ts, branch/corrections.ts); den Ort des Eject-Pack-Wechsels bestimmt die Spec.

*Tor:* Zählung Brett-Item gegen Protokoll auf 0, auch für Fähigkeiten und Eject Pack; Bank gepaart, Feedback 3×.

- [ ] **T121 · Nachbau: Items und Wechsel, die das Protokoll nicht zeigt** (Nachbau, Mini-Runde, klein, score-berührend D3)

  Aus Spur 1G: (1) `buildChoiceLockContext` liest die Vorschau-Marke „(has item)“ als enthülltes Item, so bekommt ein geratenes Choice-Item in Gen 6 nie die Schadens-Prüfung (649664 Keldeo). (2) Eject-Pack-Einwechsel wählt das falsche Pokémon: 751407 Zug 1 bringt der Simulator Gholdengo statt Dragonite, dessen Knock Off nimmt Gholdengos Scarf, den das echte Spiel bis Zug 16 behielt. (3) Item-Wechsel, die der Simulator macht und das Protokoll nie zeigt, bleiben auf dem Brett. (4) Übergaben über eine Fähigkeit (Pickpocket, Magician) fallen aus der Regel (2 Zeilen in den Daten).

  *Nutzen:* Engine und App: das Brett trägt die Items und Pokémon, die das Spiel zeigt.

  *Erfolg:* Zählung Brett-Item gegen Protokoll nach jeder Item-Zeile (heute 0 für Züge-Zeilen) auch für Fähigkeiten und Eject Pack auf 0; 751407 Zug 1 bringt Dragonite; Bank gepaart, Feedback 3×.

## Welle 1.5 · Spur H · Tempo-Löser: Reste

Reste der Zugreihenfolge aus Spur 1H und dem Review. Die gebrochenen Reihenfolgen stehen auf 0; die Spur senkt die strenge Zählung und die leeren Budgets.

*Dateien:* wie Spur 1H (packages/replay-core/src/spreads/ (fit.ts, ladder.ts, scarf.ts, order-limit.ts), spread-inference.ts, protocol/speed-evidence.ts); Punkt 4 (IV 0 im Bau) berührt team-builder.ts aus Spur D, die Spec legt die Datei fest.

*Tor:* Zählung der gebrochenen Reihenfolgen bleibt 0, strenge Zählung der Runde 53 sinkt; Set-Diff auf Bank und Feedback; Bank gepaart, Feedback 3×.

- [ ] **T122 · Tempo-Löser: Reste der Zugreihenfolge** (Sets und Spreads, Runde, mittel, score-berührend D3)

  Aus Spur 1H und dem Review: (1) Pfad-Abhängigkeit: Nach dem Settle-Schritt gibt die Vorlösung frei gewordene Tempo-EVs in die KP, und die Volllösung behält sie, wo die Schadenszeilen beide Spreads tragen (gepinnt in `two-stage-carry.spec.ts`: zwei Stufen KP 60, eine Stufe KP 0). (2) Zyklus-Rückfall: Kann ein Rennen nicht strikt werden, darf heute die ganze Komponente gleich schnell sein. (3) Scarf-Tempo ohne Abrunden (`order-limit.ts`, `fit.ts`: 201 × 1,5 = 301, nicht 301,5), so wird eine „strikte“ Reparatur ein echter Gleichstand. (4) IV 0 für Trick-Room-Sets im Bau (2663093831 Sinistcha, 751283 Alomomola). (5) Kampfformen mit eigenem Tempo (Mega nach der Entwicklung, Terapagos-Terastal; 3 Bank-, 8 Feedback-Reihenfolgen). (6) Transform: ein verwandelter Ditto zählt als Ditto (2660802611 Zug 4). (7) Ungenutzte EV-Budgets: 78 von 1548 Bank-Sets lassen das halbe Budget liegen (Volcanion Hardy 0/0/0/0/0/0).

  *Nutzen:* Engine: Spreads ohne Gleichstände, die das Spiel widerlegt, und ohne leere Budgets; App: plausiblere Spreads im Panel.

  *Erfolg:* Zählung der gebrochenen Reihenfolgen bleibt 0, die strenge Zählung der Runde 53 sinkt; leere Budgets unter 10; Bank gepaart, Feedback 3×.

## Welle 1.5 · Tests ohne Biss (verteilt auf die Spuren)

- [ ] **T126 · Tests, die nicht scheitern können** (Werkzeug, Mini-Runde, mini, verlustfrei D4)

  Aus den Reviews der Runde 63: `tera-hints.spec.ts:44` (Doubles; ohne STAB war das Verhältnis mit und ohne Tera-Pfad 1, mit STAB prüft Spur B, ob der Test wieder fängt), `hint-memo.spec.ts:52` (beide Seiten laufen durch den Merkzettel), `tree-orchestrator.spec.ts:21` (`handPipeline` kopiert den Orchestrator), `BranchPanel.spec.tsx:178` (das `waitFor` greift vor der Neuberechnung). Jeder Test geht an die Spur, der seine Datei gehört: die ersten beiden an B, der dritte an C, der vierte an F.

  *Nutzen:* Engine und App: diese vier Tests fangen wieder, was ihr Name verspricht.

  *Erfolg:* jeder Test scheitert gegen eine absichtliche Verschlechterung (Gegenprobe im Ledger).

## Welle 2 · Spur A · Rechner-Eingaben

Fünf kleine Fehler an derselben Stelle: Der Rechner bekommt Namen, Formen, Boosts, Gefallene und Tera-Körper nicht so, wie der Simulator sie kennt. Sichtbar an Quoten und Vorschau. Die Aufrufstelle in spreads/fit.ts (T72) folgt in Spur 3A.

*Dateien:* packages/eval-engine/src/ko-odds.ts, damage-calc.ts, pair/kill-table.ts, pair/snapshot.ts, pair/odds.ts, choice-lock.ts (nur der Rechner-Aufruf), Hidden-Power-Brücke, cell-blend.ts (Tera-Körper der Quoten).

*Tor:* Zählung je TODO auf 0, Dumps (Quoten, Zeilen), jede bewegte Bank-Zeile gelesen.

- [ ] **T83 · Hidden Power geht als nackter Name an den Rechner** (Rechner-Treue, Mini-Runde, mini, score-berührend D3)

  smogtours-gen6ou-648453 Zug 13 (offener Pin) und Zug 23, gelesen auf 5d428b2: Die App schreibt "(True odds: Hidden Power Ice kills ~6% of the time; ...)". Landorus-T steht auf 83 von 319 KP, Hidden Power Ice macht 224 bis 268 Schaden, der K.-o. ist sicher. Die Quote kommt aus @smogon/calc, der den Slot-Namen "Hidden Power" als Normal-Zug mit Stärke 60 liest (Gen 2 bis 5: Stärke 0, dort fehlt die Quote ganz). Betroffen: `ko-odds.ts` (Quoten an den Zeilen, Klassen der Nachprüfung, Reihenfolge im Beweiser, Fast-entschieden-Stufe), `damage-calc.ts` (Vorschau), `pair/kill-table.ts` (Doubles bis Gen 7). Den Wert heilt die Nachprüfung selbst, falsch bleibt der Satz.

  Fix: `typedHiddenPowerId` bzw. `Hidden Power <hpType>` an den drei Stellen, vor Gen 6 mit Stärke aus `hpPower`. Gleiche Ursache wie T72 (Name an den Rechner); zusammen in Welle 2, Spur A.

  *Nutzen:* App: Der falsche Satz "Hidden Power Ice kills ~6%" verschwindet aus 648453 Zug 13 (gap-Pin) und Zug 23, Hidden Power bekommt in Gen 2 bis 7 echte Quoten (176 von 2122 Fit-Korpus-Spielen nutzen den Zug); Bank ohne Hebel (eine Zeile in Gen 3).

  *Erfolg:* 648453 Zug 13 und 23 tragen für Hidden Power Ice keine Quote mehr (sicherer K.-o.), die Vorschau zeigt den Eis-Schaden; Bank und Dumps bewegen sich nur in Spielen mit Hidden Power. *Plan T83:* Backlog-Plan, Abschnitt T83 (Runde 62 neu gefasst).

- [ ] **T72 · Der Rechner kennt Gastrodon-East und Aegislash nicht** (Rechner-Treue, Mini-Runde, mini, score-berührend D3)

  @smogon/calc wirft bei Formen, deren Namen er nicht führt, und die Engine fängt das still ab. Gezählt in Runde 62 (`docs/perf/probes/2026-10-04-r62/groups/rechner/census.vt.ts`): Auf der Bank ist es nur Gastrodon-East, in 14 von 837 Stellungen (3 Doubles-Spiele, 6 Stellungen mit ihm auf dem Feld). Im Fit-Korpus kommen Aegislash dazu (34 Spiele in Gen 8 und 9: der Simulator nennt die Schild-Form "Aegislash", der Rechner kennt nur "Aegislash-Shield"), Gastrodon-East (42 Spiele) und Farb-Formen von Florges, Alcremie und Vivillon (4). Szene: Im Branch-Panel zeigt jede Schadensvorschau von und gegen Gastrodon-East "-" (mit "Gastrodon": Earth Power 56,8 bis 67,2 %), die K.-o.-Quote der Zeile fehlt.

  Fix: vor dem Rechner die Art auf die Form abbilden, die er kennt, wenn Basiswerte und Typen gleich sind; die Prüfung liest Dex und Rechner-Daten, keine feste Liste. An allen Aufrufstellen: `ko-odds.ts`, `damage-calc.ts`, `pair/kill-table.ts`, `choice-lock.ts`, `spreads/fit.ts`. Läuft mit T83, T76, T100 und T84 in Welle 2, Spur A (gleiche Funktionen).

  *Nutzen:* App: Schadensvorschau und K.-o.-Quoten für Gastrodon-East (Doubles-Standard) und Aegislash statt "-"; Bank unter der Auflösung (höchstens 14 Zeilen in 3 Spielen).

  *Erfolg:* Die Zählung meldet 0 Arten, die der Rechner ablehnt, auf Bank und Fit-Korpus; die Vorschau zeigt für Gastrodon-East und Aegislash Zahlen; Bank und Dumps bewegen sich nur in den 3 Spielen mit Gastrodon-East. *Plan T72:* Backlog-Plan, Abschnitt T72 (Runde 62 neu gefasst).

- [ ] **T76 · Rechner-Treue: Quark Drive, Protosynthesis, Supreme Overlord, Last Respects** (Rechner-Treue, Mini-Runde, klein, score-berührend D3)

  Der Rechner bekommt den Boost von Quark Drive und Protosynthesis (boostedStat) und die Zahl der Gefallenen für Supreme Overlord und Last Respects (alliesFainted) nie. Szene smogtours-gen9ou-752068 Zug 14: Kingambit mit fünf Gefallenen, Iron Head zeigt Quote 0,64, der Simulator tötet 14 von 14; in Doubles gen9vgc2026regi-2629731825 Zug 6 wechselt die beste Zeile beider Seiten. Bank: 30 falsche K.-o.-Anteile in Singles, 6 in Doubles; Last Respects in 111 Doubles-Spielen des Fit-Korpus. Fix: boostedStat aus dem Volatile des Simulators, alliesFainted aus abilityState, in ko-odds.ts (toCalcPokemon), im Doubles-Snapshot für pair/kill-table.ts und in der Vorschau (damage-calc.ts:62); nichts ableiten.

  *Nutzen:* App: richtige K.-o.-Quoten und beste Zeilen an Paradox-, Kingambit- und Last-Respects-Stellungen (36 Bank-Anteile, 111 VGC-Spiele im Fit-Korpus); Engine: weniger leere Ziehungen in der Nachprüfung.

  *Erfolg:* die Zählung (groups/rechner/census.vt.ts) meldet 0 geänderte K.-o.-Anteile; 752068 Zug 14 ohne Quote für Iron Head und ohne fehlende Klasse; Tor an Zeilen, Quoten und Dumps, jede bewegte Bank-Zeile gelesen. *Plan T76:* Backlog-Plan, Abschnitt T76 (Runde 62 neu gefasst).

- [ ] **T100 · Ein Aufbau Simulator → Rechner** (Rechner-Treue, Mini-Runde, klein, score-berührend D3)

  ko-odds.ts und damage-calc.ts geben dem Rechner die Stufen des Simulators, in denen Einwechsel-Boosts schon stecken; der Rechner addiert Dauntless Shield, Intrepid Sword, Download und Embody Aspect selbst noch einmal, auch ohne genannte Fähigkeit. Szene gen9doublesou-2660802611 Zug 12: Ogerpon-Hearthflame-Tera mit Horn Leech gegen Ogerpon-Wellspring zeigt „100 % OHKO“, richtig ist „possible 2HKO“. Fix: beide Stellen über einen gemeinsamen Aufbau, der Boosts nur einmal zählt (Vorbild laut Inventur pair/kill-table.ts mit pair/snapshot.ts).

  *Nutzen:* App: die Schadensvorschau zählt Einwechsel-Boosts einmal (heute falsche K.-o.-Aussagen bei Ogerpon-Tera und Zamazenta); Engine: die K.-o.-Quoten von Statik und Beweiser lesen dasselbe, Bank-Wirkung klein (74 Stellungen).

  *Erfolg:* die Sonde panel-boost.vt.ts zeigt auf den fünf Stellungen keinen Unterschied mehr zur Rechnung mit neutraler Fähigkeit; Bank gepoolt nicht schlechter. Die übrigen Zusammenlegungen entfallen. *Plan T100:* Backlog-Plan, Abschnitt T100 (Runde 62 neu gefasst).

- [ ] **T84 · Kill-Quoten der Tera-Optionen rechnen mit dem Tera-Körper** (Rechner-Treue, Mini-Runde, klein, score-berührend D3)

  gen9doublesou-2660818097 Zug 2: 'Horn Leech + Heat Wave mit Tera' gegen Zapdos zeigt 4 % statt 100 %, weil der Rechner den Körper vor dem Klick liest (ko-odds.ts:87; Zellenplan cell-blend.ts:142; pair/odds.ts). Auf der Bank ändern sich 152 von 380 Singles- und 90 von 243 Doubles-Tera-Zeilen mit Quote.

  *Nutzen:* App: richtige Kill-Quote auf rund 40 % der Tera-Zeilen mit Quote (Singles 152 von 380, Doubles 90 von 243); Engine: richtige Klassen-Gewichte der Tera-Zellen.

  *Erfolg:* die Zählung (groups/endspiel/census.vt.ts) meldet 0 geänderte Zeilen; Bank und Dumps bewegen sich nur in Stellungen mit Tera-Option, jede bewegte Zeile gelesen. *Plan T84:* Backlog-Plan, Abschnitt T84 (Runde 62 neu gefasst).

## Welle 2 · Spur B · Wahlen, Wurzelwert, Tiefer denken

Doubles-Züge ohne Urteil (Pollen Puff auf den Partner), ein Wurzel-Score weit vom Spielwert in kleinen Endspielen (doubles-spread-2v1 liest 0,355 statt 1,0), dann die tiefere Stufe auf Baum-Zügen und die Restposten der Runde 61. Nach Spur 1C, weil T114, T109 und T111 dieselben Dateien des Baums ändern. T111 Punkt 1 (den Budget-Schalter schon in Node parsen) liegt im Feedback-Harness: die Spur liefert ihn als Patch, der Integrator übernimmt ihn.

*Dateien:* packages/eval-engine/src/forward/choices.ts, search/options.ts (nur Wurzel), mcts-merge.ts, mcts.ts, endgame/prover.ts, src/lib/eval/worker-client.ts, src/hooks/useEvalView.ts, src/components/eval/ (ThinkDeeperButton.tsx, EvalControls.tsx), src/components/PlayOutBar.tsx, src/lib/play-out.ts, regression/endgame-truth.spec.ts, regression/decided-held-positions.spec.ts, EVALUATION.md, packages/eval-engine/README.md.

*Tor:* Prüfstände, Bank-Lauf mit dem Spielwert der Wurzel neben dem Score (das Bank-Feld baut der Integrator), Feedback 3×, UI-Tests und e2e für T109, Score-Frage von T114 am User-Gate.

- [ ] **T113 · Züge auf den Partner als Option** (Simulation und Suche, Mini-Runde, klein, score-berührend D3)

  Die Zählung der Runde 61 (78 von 238) lief ohne keepPlayed. Mit keepPlayed fehlt die gespielte Kombination nur an einer echten Stelle: bei Zügen auf den eigenen Partner. VGC 2630685175 Zug 7 heilt p2 den Partner mit Pollen Puff; die Engine kennt diese Wahl nicht, weil forward/choices.ts bei Ziel normal und any nur Gegner-Slots aufzählt (choices.ts:15, :65 bis :75). Der Zug bekommt kein Urteil, ebenso Bank 938276 Zug 10 p1. Partner-Ziele überall würden die rohe Kombinationszahl je Knoten um das 1,55-Fache vergrößern; darum zuerst nur die gespielte Wahl an der Wurzel.

  *Nutzen:* App: zwei Züge in Korpus und Bank bekommen ein Urteil; Heilen oder Instruct auf den Partner wird in VGC bewertbar.

  *Erfolg:* 2630685175 Zug 7 p2 und 938276 Zug 10 p1 finden ihre Option und tragen ein Urteil; das Ziel kommt aus dem Request des Simulators, keine eigene Liste; Doubles-Baumzeit unverändert; Singles byte-gleich. *Plan T113:* 3 Schritte im Backlog-Plan.

- [ ] **T114 · Wurzel-Score gegen Spielwert** (Simulation und Suche, Runde, mittel, score-berührend D3)

  Auf Baum-Zügen ist der Score das Mittel über die Besuche, nicht der Spielwert (mcts-merge.ts:272, :292). In kleinen Endspielen liegen beide weit auseinander: Der Prüfstand doubles-spread-2v1 liest in der App 0,355 bei Spielwert 0,849, ein Einzelbaum 0,999, Wahrheit 1,0 (docs/perf/probes/2026-10-04-r62/groups/endspiel/spread2v1-doubles-spread-2v1.json). Auf den Dumps weichen 13 von 329 Zügen um mehr als 0,15 ab, in beiden Spielarten (2629703929 Zug 13 −0,83 gegen −0,64, 649664 Zug 22, 648453 Zug 35, 573756 Zug 135). doubles-ohko-tie liest 1,0 über einen falschen Beweis mit Masse 1. Der Prüfstand misst in seiner Baum-Spalte nur mctsSearch, nicht den App-Pfad (regression/endgame-truth.spec.ts:69).

  *Nutzen:* Engine und App: die Bar trifft kleine Endspiele (heute 13 von 329 Korpus-Zügen um mehr als 0,15 daneben), die Bank zeigt, ob Score oder Spielwert besser kalibriert, und zwei Prüfstände prüfen den Weg, den die App rechnet (aus T111 Punkt 9).

  *Erfolg:* Prüfstand über searchTreesOrchestrated; doubles-spread-2v1 näher an 1,0, doubles-ohko-tie ohne falschen Beweis; ein Bank-Lauf mit gameValue neben dem Score entscheidet, welcher den Brier besser trifft; auf den Dumps sinkt die Zahl der Züge mit Abstand über 0,15. *Plan T114:* 4 Schritte im Backlog-Plan.

- [ ] **T109 · Tiefer denken auf Baum-Zügen** (Simulation und Suche, Mini-Runde, klein, render-nah)

  Seit Runde 61 verschwindet 'Think deeper' in Auto ab Zug 1. Die Stufe ist gemessen: vierfache Durchläufe je Baum (Bank −15 bp gepoolt, Doubles −38), Wartezeit eines Klicks rund 3- bis 4-mal ein Baum-Zug (Node: Singles 2 → 7 s, Doubles 6 → 17 s). Rest: am Gate entscheiden, ob ein Baum-Zug diese Stufe anbietet; dann TurnEvalSettings mit Budget-Stufe, Cache-Schlüssel, Knopf-Text, UI-Test und e2e.

  *Nutzen:* App: ein Klick rechnet einen Zug in der besten gemessenen Tiefe (Bank −15 bp gepoolt, Doubles −38), sichtbar als Knopf in Auto, für etwa 3- bis 4-mal die Zeit eines Baum-Zugs.

  *Erfolg:* Ein Baum-Zug bietet die Stufe mit 2400 Durchläufen an und nennt die Wartezeit, oder der Knopf entfällt bewusst mit Text. *Plan T109:* Backlog-Plan, Abschnitt T109 (Runde 62 neu gefasst).

- [ ] **T111 · Restposten aus Runde 61** (Werkzeug, Mini-Runde, klein, je Punkt verlustfrei oder mit eigenem Beleg)

  Restposten aus Runde 61, gekürzt. (11) Wartezeit eines Einzelklicks an Zug 2 im Worker-Pool messen (Singles, Doubles, VGC; Einzelprozess heute 3,25, 7,3 und 5,5 s), Ergebnis ins Ledger. (7)+(8) Texte zu Auto angleichen (PlayOutBar.tsx, EvalControls.tsx, EVALUATION.md, README des Engine-Pakets, Kommentare in play-out.ts und prefs.ts). (1) FEEDBACK_SEARCH_BUDGET schon in Node parsen. (3) MCTS_TREES neben dem Budget klären (Tests lesen ihn). Verworfen: (2), (4), (5), (6), (10); (9) geht in T114.

  *Nutzen:* App: Wartezeit eines Klicks an frühen Zügen gemessen (Einzelprozess bis 7,3 s in Doubles) und Texte, die sagen, was Auto tut.

  *Erfolg:* je Punkt roter Test oder Textänderung mit e2e-Abgleich, (11) im Ledger. *Plan T111:* Backlog-Plan, Abschnitt T111 (Runde 62 neu gefasst).

## Welle 2 · Spur C · Gegner-Inferenz

Die Inferenz verliert gegessene Items (649664 Zug 8 empfiehlt Mega) und liest das Log mit eigenen Regex, wo @pkmn/client den Zustand schon führt.

*Dateien:* packages/replay-core/src/inference/handlers.ts, packages/replay-core/src/opponent-inferrer.ts.

*Tor:* Zählung Client gegen Inferenz gelesen, Bank gepaart, Feedback 3×.

- [ ] **T108 · Die Gegner-Inferenz liest, was die Bibliothek schon weiß** (Werkzeug, Runde, mittel, score-berührend D3)

  (1) recordConsumedItem schreibt einen Platzhalter statt des gegessenen Items (inference/handlers.ts:258): 649664 Tyranitar verliert die Chople Berry, bekommt Tyranitarite, und die App empfiehlt in Zug 8 'Mega + Crunch'. Ein-Zeilen-Fix mit rotem Test. (2) Die Inferenz liest das Log an 44 Stellen mit eigenen Regex; elf Handler halten fest, was @pkmn/client beim selben Log ohnehin führt (Form, Züge, Items, Fähigkeiten, Tera, Mega). Schritt 1 schickt jede Zeile durch Protocol.parseBattleLine, Schritt 2 liest die elf Fakten aus dem Zustand des Clients; eigene Beweise (Ausschlüsse aus Schaden und Immunität, widerlegte Choice-Locks) bleiben bei uns. Dazu die Taunt-Fälle aus T75 (752301 Zug 2 und 3, 751543 Zug 20), wo der Nachbau Züge aus cant-Zeilen liest.

  *Nutzen:* App: keine Mega-Empfehlung mehr für ein Pokémon, das sein Item schon gegessen hat (649664 Zug 8), dazu weniger falsch gelesene Gegner-Items.

  *Erfolg:* 649664 Zug 8 empfiehlt kein Mega mehr; die Inferenz liest Zeilen nur noch über @pkmn/protocol und die elf Fakten aus @pkmn/client; die Zählung Client gegen Inferenz ist gelesen; Bank und Dumps bewegen sich nur in Spielen, die die Zählung nennt. *Plan T108:* Backlog-Plan, Abschnitt T108 (Runde 62 neu gefasst).

## Welle 2 · Spur D · Bericht, zweiter Teil

Glück ohne Würfel, Lob auf einem verlorenen Zug, Reue gegen den echten Klick. Nach dem Hybrid aus Spur 1A (Glückskonten in Singles), nach Spur 1C (T64 liest 912045 Zug 8, den T16 ändert) und nach Spur 1E (dieselben Dateien).

*Dateien:* wie Spur 1.5E, dazu packages/eval-engine/src/dice-events.ts und turn-analysis/signals.ts.

*Tor:* Engine-Zahlen unberührt, Dumps und Prosa-Pins, chance-Pins 573756 t73 und 649664 t23 stehen.

- [ ] **T22 · Chance ohne Würfel als eigene Klasse ausweisen** (Bericht, Runde, mittel, verlustfrei D4, braucht T110)

  Seit dem Baum ab Zug 1 wächst das Glückskonto ohne Würfel: 649664 sagt 'The rolls decided it (+104%)' bei 17 % Würfel-Deckung (Konto +2,085, vor dem Umbau +0,584), 653785 bei 6 %; die Karten 649664 t9 und t12 sagen 'how the turn rolled' (+28 %, +32 %), obwohl der einzige Wurf gegen BKC lief.

  *Nutzen:* Der Spielbericht erzählt kein Glück mehr, wo die Engine umbewertet hat; heute betrifft das 3 von 6 Singles- und 1 von 4 Doubles-Berichten im Korpus.

  *Erfolg:* 649664 und 653785 sprechen 'The rolls decided it' nur, wenn Würfel in derselben Richtung mindestens die Hälfte des Kontos tragen; Karten ohne Würfel in Richtung des Rests sagen nicht 'how the turn rolled'; die chance-Pins 573756 t73 und 649664 t23 stehen; gemessen an den zehn Dumps, Singles und Doubles. *Plan T22:* Backlog-Plan, Abschnitt T22 (Runde 62 neu gefasst).

- [ ] **T59 · Kein Lob auf einem verlorenen Zug** (Bericht, Mini-Runde, klein, verlustfrei D4, braucht T110 und T22)

  653785 Zug 10: 'BKC played Hydro Pump, a read that paid off', obwohl Hydro Pump ins Leere ging (31 auf 44 % für 3d). Das Lob rechnet aus der gespielten Zelle; mit dem Wert der Folgewurzel wäre der Payoff −0,296. Erst nach T110 und T22 neu lesen; bleibt der Fall, prüft das Lob die Folgewurzel.

  *Nutzen:* App: kein Lob mehr für einen Zug, der ins Leere ging (ein Satz im Korpus); klein.

  *Erfolg:* 653785 Zug 10 ohne Lob, 2663093831 Zug 1 behält sein Fenster-Lob, kein anderer Prosa-Pin bewegt sich. *Plan T59:* Backlog-Plan, Abschnitt T59 (Runde 62 neu gefasst).

- [ ] **T64 · Reue gegen den wirklich geklickten Gegenzug zeigen** (Bericht, Mini-Runde, klein, verlustfrei D4)

  Die Zahl rechnet hindsightReadFor schon (signals.ts:140), sie spricht aber nur im shift-Satz und erscheint nie an der Seiten-Zeile; in Doubles fehlt sie ganz, weil opponentColumn den Doubles-Klick nicht findet (signals.ts:112). Zeigen nur, wenn sie ein Band weiter liegt als die Reue und die Zelle der besten Zeile mindestens 8 Besuche hat oder nachgeprüft ist.

  *Nutzen:* App: der User sieht neben der Note, was der Zug gegen den echten Gegenklick kostete; heute auf 46 Singles-Seiten berechnet und unsichtbar, in Doubles gar nicht.

  *Erfolg:* auf den zehn Dumps zeigt die Seiten-Zeile die Zahl genau dort, in Singles und Doubles; 912045 Zug 8 zeigt keine Zahl aus Zellen mit 1 bis 2 Besuchen; kein Tier und keine Summe bewegt sich; die Prosa-Pins stehen. *Plan T64:* Backlog-Plan, Abschnitt T64 (Runde 62 neu gefasst).

## Welle 2 · Spur E · Panel und Knöpfe

Zug-Knöpfe mit dem Typ beim Einsatz und ein Panel, das die Herkunft eines Spreads nennt. Nach Welle 1, weil Spur 1B den Zugkern und Spur 1D den Team-Bau ändert.

*Dateien:* src/lib/picker-state.ts, packages/eval-engine/src/branch/state.ts, packages/replay-core/src/team-info.ts, src/lib/provenance-labels.ts.

*Tor:* UI-Tests und e2e, Set-Diff 0.

- [ ] **T85 · Zug-Knöpfe zeigen den Typ beim Einsatz** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  gen9ou-2658659909 Zug 37, der Knopf Ivy Cudgel von Ogerpon-Wellspring ist Grass, der Zug landet als Water; auf 11 Bank-Stellungen 9 falsche Knöpfe auf 6 Stellungen, Singles und Doubles (Sonde t85-type). Weg: auf den Pfaden live und stored den Simulator fragen (ModifyType-Handler wie in useMoveInner), nur der Pfad snapshot ohne Kampf nimmt moveAtUse oder den Katalog.

  *Nutzen:* App: Farbe und Beschriftung der Zug-Knöpfe stimmen; auf den geprüften Stellungen sind es 9 falsche Knöpfe auf 6 von 11, ohne dass eine Engine-Zahl sich bewegt.

  *Erfolg:* Die Sonde zeigt 0 Abweichungen, Tera Blast nach dem Klick eingeschlossen; keine Engine-Zahl bewegt sich. Läuft nach Spur 1B, weil die den Zugkern ändert. *Plan T85:* Backlog-Plan, Abschnitt T85 (Runde 62 neu gefasst).

- [ ] **T69 · Das Panel nennt die Herkunft eines Spreads** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  gen9ou-2658659909, alle 12 Körper tragen fitted; 6 kommen aus der Vorlösung zurück, nachdem die volle Lösung ihre Schadenszeilen verworfen hat, alle mit den EVs des Schätzwerts (Tyranitar Adamant 0/252/0/0/4/252), 4 weitere aus der vollen Lösung ebenfalls unverändert (Sonde t69-split).

  *Nutzen:* App: Das Etikett sagt, wer geprüft hat; in der Szene fallen 10 falsche fitted-Stempel von 12 weg, bei Set-Diff 0.

  *Erfolg:* Ein Eintrag mit EVs und Natur des Schätzwerts behält dessen Etikett, ein Eintrag aus Zugreihenfolge oder Übertrag sagt das, fitted steht nur an Spreads mit tragender Schadenszeile; Set-Diff 0 auf Bank und Feedback-Harness; Zählung über Bank und Feedback getrennt nach Singles und Doubles. Kommt T26 vorher, braucht es ein Etikett für aufgefüllte Spreads. *Plan T69:* Backlog-Plan, Abschnitt T69 (Runde 62 neu gefasst).

## Welle 2 · Spur F · Doubles-K am Blatt

Das Doubles-K am Blatt, gelesen mit dem Bank-Instrument, das Skala von Gewinn trennt (Schritt 1 von T52 steht seit Runde 63).

*Dateien:* packages/eval-engine/src/winprob.ts (nur das K am Blatt), packages/eval-engine/src/search/leaf.ts.

*Tor:* Bank mit K der Bank und eigenem K je Phase, Doubles-Tier-Zählung.

- [ ] **T52 · Doubles-K am Blatt, gelesen gegen die Skala** (Re-Fit, Mini-Runde, klein, score-berührend D3)

  Doubles-K am Blatt als billiger Kandidat (1,987 + 3,666 × Anteil gefallener Pokémon). Schritt 1 ist seit Runde 63 erledigt (888cd12): scripts/paired-calibration.mjs druckt neben der Tabelle mit dem K der Bank eine mit eigenem K je Phase (D25), weil ein reines Umskalieren je Phase in Doubles schon −35 bp bringt. Offen ist der Kandidat, zweifach gelesen, dazu die Doubles-Tier-Zählung.

  *Nutzen:* Engine: ein billiger Doubles-Hebel am Blatt (bis −20 bp je Stellung, unaufgelöst) und ein Bank-Instrument, das Skala von Gewinn trennt.

  *Erfolg:* Doubles-Zeile mit eigenem K je Phase aufgelöst besser, kein gepoolter Schaden; Doubles-Noten bewegen sich nur mit Lesung. Der Singles-Teil (gedeckeltes K) entfällt. *Plan T52:* Backlog-Plan, Abschnitt T52 (Runde 62 neu gefasst).

## Welle 3 · Spur A · Fitter und Doubles-Schaden

Der Spread-Löser: Doubles-Schaden messen (T31), Angreifer ohne Angriff (T26), ein Fit-Feld wie der Simulator (T86). Sichtbar im Panel, groß im Aufwand. Nach Spur 2A, weil T31 und T86 dieselben Rechner-Eingaben lesen; die Aufrufstelle aus T72 kommt hier dazu.

*Dateien:* packages/replay-core/src/spreads/ (fit.ts, ladder.ts), spread-inference.ts, protocol-parser.ts.

*Tor:* Set-Diff, Fit-Fehler je Familie, Bank mit frischer Basis, Feedback 3×.

- [ ] **T31 · Doubles: Schaden messen** (Sets und Spreads, Runde, groß, score-berührend D3)

  Der Parser liest in Doubles keine Schadenszeile (protocol-parser.ts:32): 788 direkte Schadenszeilen in den 46 Doubles-Spielen der Bank geben 0 Beobachtungen, die Doubles-Sets sind reine Nutzungs-Prioren, und Zugreihenfolgen ohne Schadensbeleg nehmen der Offensive das Budget (2663100395 Latios Timid 4/0/252/0/0/252 mit Choice Scarf, 0 SpA). Der Fit-Rechner bekommt die Spielart nicht (fit.ts:152).

  *Nutzen:* Bewegt die Sets aller 46 Doubles-Spiele der Bank (252 Zeilen); ein Gewinn in der Größe der Runde 37 ist möglich, aber ungemessen.

  *Erfolg:* Doubles-Beobachtungen über 0, fünf davon von Hand gegen das Log geprüft; Singles-Sets byte-gleich; die 252 Doubles-Zeilen der Bank getrennt ausgewiesen und nicht schlechter; Set-Diffs der vier Doubles-Spiele im Feedback-Korpus vorgelegt. *Plan T31:* Backlog-Plan, Abschnitt T31 (Runde 62 neu gefasst).

- [ ] **T26 · Angreifer ohne Angriff** (Sets und Spreads, Runde, mittel, score-berührend D3)

  (nimmt T25 und die weiche Richtung von T32 auf). Der Löser lässt Offensive oder Budget leer, wenn Tempo gehalten wird oder Bulk als gemessen gilt, und ein geratenes Boost-Item bleibt stehen, obwohl die Treffer ohne es mit Offensive erklärbar sind. Szenen: 750267 Weavile Jolly 0/0/0/0/0/252; 2658660641 Kyurem Timid 0/0/0/0/0/252 mit Choice Specs (Draco Meteor 28 % auf Ting-Lu passt nur ohne Item); 751533 Kyurem Specs, 751382 Weavile Band, 750953 Walking Wake Specs. Weg: Budget auffüllen auch unter gemessenen Stats, Offensive gegen gehaltenes Tempo, geratenes Boost-Item weicht, wenn ein Körper ohne es die Treffer erklärt.

  *Nutzen:* App: plausible Angreifer im Team-Panel und in simulierten Linien (17 Boost-Item-Körper ohne Offensive, über 100 Körper mit Offensiv-Natur und 0 Offensive); Bank klein, Vorzeichen offen.

  *Erfolg:* von 17 Körpern mit Boost-Item und 0 Offensive bleiben höchstens die 4 mit verratenem Item; deutlich weniger Körper mit Offensiv-Natur und 0 Offensive; Handprüfung von fünf Item-Wechseln; der Fit-Fehler steigt bei keinem Set; Bank hq spät nicht schlechter als +9 bp. Doubles-Teil nach T31. *Plan T26:* Backlog-Plan, Abschnitt T26 (Runde 62 neu gefasst).

- [ ] **T86 · Fit-Feld wie der Simulator** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T31 und T26)

  Der Spread-Löser (spreads/fit.ts:125 und :152) gibt dem Rechner Kennungen statt Zugnamen (Weather Ball, Terrain Pulse und Co. rechnen als Normal-Zug, Terrain fehlt) und kennt Boosts, Gefallene, Fähigkeiten, Tera und aktuelle KP nicht. Szenen: gen9ou-2658663604 Kingdra (Weather Ball im Regen wird nicht gefittet); 131 Bank-Treffer in 51 Spielen ohne Boost gelesen; 653785 Dragonite, Multiscale gilt auch unter vollen KP nicht; Kingambit mit Supreme Overlord, Booster-Energy-Pokémon. Jeder solche Treffer verbiegt den Körper.

  *Nutzen:* Engine und App: plausiblere Körper überall dort, wo ein Treffer heute ohne Boost, Fähigkeit oder Zugnamen gelesen wird (131 Bank-Treffer in 51 Spielen); Bank-Wirkung offen, Maß ist der Fit-Fehler.

  *Erfolg:* der Beobachtungsfehler sinkt je Familie (Zugname, Boost, Fähigkeit, KP), der Fehler aller übrigen Treffer steigt nicht; die geänderten Körper lassen kein Budget liegen (nach T26); Bank mit frischer Basis gelesen, beide Spielarten. *Plan T86:* Backlog-Plan, Abschnitt T86 (Runde 62 neu gefasst).

## Welle 3 · Spur B · Statik-Gewichte

Hinweis-Terme und Feld-Paar für Doubles früh, dann der Re-Fit der Statik (Modellform, Status-Faktor, Boost-Gewicht) und zuletzt die Q5-Sichtung. Eine Spur, weil alle vier dieselben Gewichte fitten; nach Spur 1B, weil der Fit auf dem neuen Zugkern laufen muss, und nach T127 (Welle 1.5, Spur B), der die Gewichte mit STAB nach den Regeln schon einmal in der heutigen Modellform fittet.

*Dateien:* packages/eval-engine/src/score/ (weights.ts, features.ts, matchup.ts), eval-function.ts, search/hints.ts, search/options.ts, Fit-Werkzeug.

*Tor:* Bank mit beiden K-Lesungen, Fit-Korpus mit Kreuzprüfung, Feedback 3× mit Tier-Zählung.

- [ ] **T42 · Q7 · Doubles-Hinweise und Feld-Paar** (Q-Runden, Runde, mittel, score-berührend D3, braucht T81)

  Erst die Hinweise: An jedem Doubles-Knoten bleiben 16 Kombinationen (search/hints.ts, search/options.ts:23); die gespielte Kombination bleibt ohne keepPlayed nur in 80 von 241 Listen. Szene 912045 Zug 1: mit der Fake-Out-Linie steigt p2s Bedauern über die Fehler-Schwelle und der Score geht zum Sieger. Dann der Feld-Paar-Term (score/weights.ts:177) mit Fit-Plan. Läuft nach T81, weil T81 dieselben Hinweise ändert; 912045 Zug 1 erst danach neu lesen. Erster Schritt: Messung der Hinweis-Terme bei gleicher Kappe (nicht Kappe 32, die halbiert die Besuche).

  *Nutzen:* Engine: Doubles früh ist die schwächste Zeile der Bank (Brier wie ein Münzwurf); ein Treffer dort ist der größte offene Doubles-Hebel nach T81.

  *Erfolg:* Doubles früh gepaart aufgelöst besser, mit eigenem K je Phase gelesen; Doubles-Baumzeit im Rahmen; Singles byte-gleich. *Plan T42:* Backlog-Plan, Abschnitt T42 (Runde 62 neu gefasst).

- [ ] **T49 · Boost-Gewicht, das weiß, ob der Boost beißt** (Re-Fit, Runde, mittel, score-berührend D3, braucht T81)

  573756 Zug 20: LordEnz' Toxapex klickt Knock Off in die verbrannte Clefable, ein PP-Krieg. Mit dem gefitteten Boost-Gewicht 39 (heute 12) nennt die Engine das einen Fehler („safer was switching to Landorus-Therian“) und wiederholt das Urteil über vierzig Züge: 573756 geht von 14 Ungenauigkeiten und 0 Fehlern auf 40 und 7, die fünf anderen Korpus-Spiele bleiben ruhig. Die Bank mag das Gewicht (hq Singles −4/−27/−5 bp, Singles Mitte voll −43 bp mit Band [−74, −12], im Fit-Korpus außerhalb der Stichprobe bestätigt). Ein stehender Boost ist im Schnitt viel wert, aber die statische Bewertung fragt nicht, ob er gegen die Wand gegenüber etwas bringt (Unaware, Haze, Phazer, ein Wall, der den geboosteten Treffer trotzdem hält).

  *Nutzen:* Bank Singles hochgerechnet etwa −18 bp der Singles-Zeilen (Mitte und spät), wenn die Dämpfung die Urteile hält.

  *Erfolg:* Mit dem gedämpften, neu gefitteten Gewicht liest die Bank die Singles-Zeile aufgelöst besser (Sonde mit reinem 39 auf 5d428b2: etwa −18 bp der Singles-Zeilen, Mitte und spät), und die Tier-Zählung der sechs Singles-Dumps bleibt bei höchstens 29 Ungenauigkeiten und 4 Fehlern (Stand 22 und 3). *Plan T49:* 7 Schritte, 3 offene Entscheidungen.

- [ ] **T102 · Die Modellform der Statik** (Re-Fit, Runde, mittel, score-berührend D3, braucht T81)

  Die Modellform der Statik mit Re-Fit: Phasen-Terme, Status-Faktor (Poison Heal, Guts, Quick Feet, Marvel Scale werden heute bestraft; Korrektur ohne Re-Fit schadet, Singles-Bewegung 0,085), Boost-Gewicht (T49). Braucht T81 (neuer Zugkern), nicht T52. Fittet nach T127 die breitere Modellform noch einmal (Gate der Runde 63: „kann auch nochmal in 3 kommen“).

  *Nutzen:* Engine: die Decke der Statik liegt bei +16 bp (mit Modellform +32), und seit Runde 61 ist die Statik Blattwert jedes Baums; der Re-Fit ist der Weg dorthin.

  *Erfolg:* Fit-Korpus-Gewinn wie Runde 58 (+16,8 bp) bestätigt auf der Bank, gelesen mit eigenem K je Phase; Singles und Doubles getrennt. *Plan T102:* Backlog-Plan, Abschnitt T102 (Runde 62 neu gefasst).

- [ ] **T39 · Q5 · Redundanz und Optionswert, Sichtung zuerst** (Q-Runden, Runde, groß, score-berührend D3, braucht T81)

  Früh im Spiel liegt die Engine bei vielen Singles-Stellungen falsch und ist sich dabei sicher: Bei 82 von 193 frühen Singles-Stellungen der Bank liegen beide Zweige falsch. Muster: ein Material-Vorsprung, während die Seite nur noch eine einzige Antwort auf den gegnerischen Sweeper hat. 655336 Zug 23: Die Engine wählt den schnellen Kill und gibt die HP-Marge des letzten Mons auf. Ein Feature zählt, wie viele Antworten eine Seite je Bedrohung übrig hat. Vorher zehn Fehlstellungen von Hand sichten; sagen weniger als sechs „ja, fehlende Antwort“, endet die Runde dort.

  *Nutzen:* Bei Erfolg besserer früher Singles-Brier auf 193 Bank-Zeilen mit heute 50 % Vorzeichen; Erwartung klein (acht Boost-Anläufe verloren), die Sichtung von zehn Stellungen entscheidet für rund eine Stunde.

  *Erfolg:* Erst Held-out-Gewinn in der CV (mindestens 16 von 20 Seeds), dann früher Brier (Stand 0,2562) und frühe Sign-Accuracy (54 %) besser bei unveränderter später Zeile. *Plan T39:* 9 Schritte, 3 offene Entscheidungen.

## Welle 3 · Spur C · Prozent-Anzeige

Eine Prozent-Anzeige, die mit dem Spielverlauf sicherer wird. Sie braucht den Anteil gefallener Pokémon an jeder Aufrufstelle der Anzeige (Bericht, Zusammenfassung, Ergebnis-Block), darum nach den Bericht-Spuren 1E und 2D und nach Spur 2F (winprob.ts).

*Dateien:* packages/eval-engine/src/winprob.ts (Anzeige), report.ts, summary.ts, win-reason.ts, src/components/eval/EvalResultBlock.tsx.

*Tor:* Anzeige-Kalibrierung, Re-Pins der Prosa am User-Gate, kein Urteil bewegt sich.

- [ ] **T51 · Prozent-Anzeige, die mit dem Spielverlauf sicherer wird** (Bericht, Runde, klein, verlustfrei D4 mit Re-Pins)

  Die Prozent-Anzeige (DISPLAY_K 1,85, winprob.ts:72 und :85) zeigt späte Stellungen zu zaghaft: spät angezeigt 76 %, gewonnen 88 bis 91 % (Singles), Doubles noch mehr. Weg: Phasen-Form der Anzeige, VGC-K getrennt prüfen.

  *Nutzen:* App: die Prozentzahl, die der User sieht, trifft späte und Doubles-Stellungen besser (rund −60 bp Anzeige-Kalibrierung); kein Urteil bewegt sich.

  *Erfolg:* Anzeige-Kalibrierung spät und Doubles besser (rund −60 bp auf allen Basen), Mitte nicht schlechter; bewiesene Wurzeln mit Masse unter 1 werden nicht übertrieben (649664 Zug 24 zeigt nicht 98 %, solange ein 20-%-Fehlschuss offen ist); kein Urteil bewegt sich. *Plan T51:* Backlog-Plan, Abschnitt T51 (Runde 62 neu gefasst).

## Außer der Reihe (am nächsten Release-Tag)

Fällig am nächsten Release-Tag, unabhängig von den Wellen.

- [ ] **T43 · Release-Check vor jedem Paket-Release** (Werkzeug, Mini-Runde, mini, kein Score-Touch)

  Beide Pakete stehen auf npm (0.7.0 und 0.7.1). Der lokale Checkout kennt den Tag v0.7.1 nicht, weil CI ihn auf seiner Kopie setzt: Ein lokaler Probelauf des Publish-Skripts vergleicht gegen v0.7.0 und würde ein unverändertes Paket veröffentlichen. Dazu gehören die Barrel-Pins (`regression/fixtures/api/`), `pack:smoke` und eine neue Chunk-Karte (das alte Skript lag im Scratchpad und ist weg). Fällig am Release-Tag.

  Dazu: Das Engine-Paket pinnt @pkmn/sim exakt (heute ^0.10.11 in packages/eval-engine/package.json:52, die App pinnt 0.10.11), weil die Tempo-Schicht an genau diese Version gebunden ist und im Browser keinen Hash prüft.

  *Nutzen:* App und Paket-Nutzer: ein Release zieht keine ungeprüfte Simulator-Version, an der die Tempo-Schicht still falsch rechnen könnte.

  *Erfolg:* Der lokale Probelauf nennt denselben Vorgänger-Tag wie CI, die published-Spalte deckt sich mit `npm view`, die Barrel-Pins zeigen keinen unbeabsichtigten Diff. npm view zeigt die exakte Simulator-Version als Abhängigkeit. *Plan T43:* 7 Schritte, 2 offene Entscheidungen.

## Geparkt (mit Auslöser)

- [ ] **T103 · Tempo-Schicht härten, bevor der Simulator wechselt** (Werkzeug, Mini-Runde, klein bis mittel, verlustfrei D4)

  Die Tempo-Schicht der Runde 59 hat auf `@pkmn/sim` 0.10.11 alle Tore der Runde bestanden (Bank in Gen 9 und Gen 3, Zensus über Gen 1 bis 9). Hash-Tor und Guard-Spec decken aber nicht alles ab, worauf die Schicht baut; dort kann ein neuer Simulator etwas ändern, ohne dass ein Test rot wird. Offen aus den Reviews der Runde: Das Hash-Tor prüft nicht den Quelltext der Klassen, den die Kopie nachbildet, und eine Abweichung schaltet immer die ganze Schicht ab, nicht nur den betroffenen Hebel. Die Vorprüfung baut auf Helfer ohne Hash (`alliesAndSelf`, `foes`, `allies`, `activeTeam`, `speedSort`). Schlüssel mit `undefined` unterhalb von Battle, Field, Side und Pokemon (Felder eines ActiveMove, Volatiles, Wahl, Warteschlange) fallen nicht unter die Regel aus 4aaad44, und die verschachtelten Daten der ActiveMoves in der Historie teilt die Kopie ohne Wert-Regeln. `check()` ist nicht ausnahmesicher: Wirft ein künftiger Simulator schon beim Bau des Probe-Kampfs, bricht `prepareFormat` im Standardmodus mit einer Ausnahme ab, statt `hash-mismatch` zu melden. Die Schlüssel der Konstruktoren gelten als unabhängig vom Team (in 0.10.11 wahr, nur `modifiedStats` in Gen 1 hängt davon ab); zur Laufzeit prüft das niemand. Dazu fehlen Test-Pins: der übernommene Standard (ein Rückbau auf `[]` bestünde CI), das Zwischenspeichern der Vorlagen, die Doubles-Matrix in der Suche mit eingefrorenen Vorlagen, der Schnappschuss mitten im Zug durch `adoptTemplate`, die Einordnung der Antworten im Build-Smoke und der Stempel von `runTree`. Und ein unbekannter Wert im Notaus der App (etwa `off` statt `0` in `localStorage`) fällt auf den Standard, die Schicht bleibt also an. Geparkt, bis das erste Upgrade von `@pkmn/sim` ansteht (D24) oder die C-Zeile eine neue Version meldet.

  Stand 05.10.: Seit Runde 61 trägt die Schicht das Zeit-Tor, und im Browser läuft keine Hash-Prüfung (guard.ts:85-88); beim Upgrade läuft T103 als Erstes.

  *Nutzen:* Beim Simulator-Upgrade bleiben Identität (0 Abweichungen) und Tempo der App (Baum 2,35× und 1,81×, Matrix 2,39×) geschützt.

  *Erfolg:* Jede Lücke oben ist geschlossen oder trägt einen Test, der bei einem Simulator-Wechsel rot wird; jeder neue Test ist ohne seinen Fix rot gezeigt; Engine-Suite im Standard, erzwungen an und mit `EVAL_SIM_FAST=0` grün; die Identitäts-Tore der Runde 59 bleiben bei 0 Abweichungen. *Plan T103:* 4 Schritte, 2 offene Entscheidungen.

  *Auslöser:* Der nächste Wechsel der @pkmn/sim-Version: Upgrade (D24) oder eine neue Version im wöchentlichen Versions-Check (Abschnitt C). Stand 05.10.2026: 0.10.11 ist die neueste.

## Themen-Übersicht

Wer an einem Thema arbeitet, findet hier die verwandten TODOs.

| Thema | TODOs |
| --- | --- |
| Simulation und Suche | T109, T113, T114 |
| Endspiel | T118 |
| Statik | T125 |
| Zufall preisen | T119 |
| Sets und Spreads | T26, T31, T86, T120, T122 |
| Werkzeug | T43, T103, T108, T111, T126 |
| Bericht | T22, T51, T59, T64, T123 |
| Oberfläche | T69, T85, T124 |
| Nachbau | T121 |
| Rechner-Treue | T72, T76, T83, T84, T100 |
| Re-Fit | T49, T52, T102, T127 |
| Q-Runden | T39, T42 |

## Der große Schritt danach · Showdown Companion (Programm, erst nach der Stabilisierung)

Voraussetzung (User-Reihung 04.09. 11:08): erst die kleinen Runden aus der Liste oben zu Ende bringen, bis das Dashboard als Produkt rund ist (die Runden nach Wahl, ein sauberes Release; die App-Testsuite und die Paket-Reste sind seit Runde 39 erledigt, `docs/completed/test-infrastructure.md`; der erste npm-Publish ist seit 06.09. erledigt, beide Pakete stehen in 0.7.0 und 0.7.1 auf npm, `docs/completed/architecture-refactor.md`). Dann beginnt das Programm; nichts davon läuft neben einer Engine-Runde, weil Schritt 0 jeden Pfad im Repo bewegt und die Feedback-Gates gegen die heutigen Pfade kalibriert sind.

Was gebaut wird (Exploration `docs/superpowers/specs/2026-09-04-player-evaluation-brainstorm.md`, Spec `docs/superpowers/specs/2026-09-04-showdown-companion-design.md`, Plan `docs/superpowers/plans/2026-09-04-showdown-companion-plan.md`, Exploration-Seite <https://claude.ai/code/artifact/66add92b-95be-40dd-b0ee-b6f1049ad63c>, Design-Canvas im Dashboard-Skin mit neun Screens <https://claude.ai/code/artifact/8f53a60d-2d50-4ba5-81fa-57c0f3cfaa39>):

- **Companion** an der Site-Wurzel: ein Eingabefeld plus Format-Auswahl. Replay-Link oder Datei rein, und sofort läuft die Analyse wie heute im Dashboard (eingebettet, volle Höhe). Username rein (meist mit Format), und der Companion sammelt alle öffentlichen Replays des Spielers (`search.json`, 51 je Seite, `before`-Paging, `user2` für Head-to-Head, private Links und Dateien dazu), legt sie in einer IndexedDB-Bibliothek ab, poolt die Teams (Identität = sortierte Artenliste, wie im alten Scouter, Formen-Dedupe) und das über Spiele hinweg Offenbarte (Züge mit Zähler und Datum, Items, Fähigkeiten, Tera, Schadensbeobachtungen für den Spread-Fit), und zeigt Profil, Teams, Spiele und Protokoll-Fakten (Ergebnisse, Leads, Wechselrate, Tera-Zug, Denkzeit aus `|t:|`, Doubles-Fakten je Slot).
- **Engine-Grades in der Bibliothek**: die Grading-Pipeline wandert aus den Dashboard-Hooks in ein Paket `eval-runtime` (Worker-Pool mit Browser- und `worker_threads`-Adapter, Team-Wissen mit den Smogon-Fetchern, Positions-Pipeline, Ganzspiel-Sweep, Cache-Stores), byte-identisch gegated wie die Refactor-Phasen. Companion, Bot und Live-Assistent rufen sie direkt; das iframe dient nur dem Anschauen. Darauf das Paket `player-insights`: Accuracy, Verlust je Entscheidung, Blunder-Rate und -Häufung, Engine-Übereinstimmung, Safe-Line-Anteil, Conversion, Opportunismus und Glück (Lichess-Paar), Netto-Glück, Konstanz und Tilt, Pokémon in der Hand; Pivot Metrik × Dimension; Baselines aus einem Offline-Sweep des Fit-Korpus je Engine-Version; Stil-Wörter nur über festen Perzentil-Regeln; Stärke-Band als „experimental“ mit `n` und Held-out-Fehler, unter zehn Spielen keins.
- **Gegnermodell**: bedingte Tendenzen („wechselt in 14 von 17 Situationen mit langsamerem Aktiven im KO-Bereich“), der Read-Lens mit Spieler-Prior (RNR-Anker bleibt, Grading bleibt Equilibrium), später ein gelerntes Choice-Modell mit Populations-Prior und Shrinkage, vorregistriert gegen Held-out-Log-Loss. Dazu die Prepare-Ansicht `/player/<name>/vs/<opponent>`.
- **Zwei Oberflächen** (User 04.09. 11:48): die öffentliche Site (Companion und Dashboard, läuft im Browser, hält nie einen Showdown-Account) und die lokale App (`apps/local`, Node auf dem eigenen Rechner mit Konsole auf localhost im selben Skin, goldene Kopfleiste): Bot, Live-Assistent, Guardrail-Schalter, Account; Bibliothek per Export/Import zwischen beiden, kein Server dazwischen.
- **Backup** (User 05.09.): „Alle Replays sichern“ in den Settings (und je Spieler): eine JSON-Bibliotheksdatei (jedes Replay mit Log, Index-Zeile, Fakten, Grades; dasselbe Format wie der Austausch mit der lokalen App) und eine ZIP mit je einer Replay-.html im Showdown-„Download replay“-Format (Parser wandert nach replay-core, Export ist seine exakte Umkehrung); Wiederherstellen per Drop auf den Einstieg, löscht nie.
- **Battle-Bot** (in der lokalen App, Node): loggt sich per `@pkmn/login` ein, spielt mit der Engine auf dem Node-Executor (eigenes Team exakt aus dem Request, Gegner per Inferenz plus Bibliothek), sampelt die Equilibrium-Mischung oder spielt den Read, wählt Teams aus dem Smogon-Dump und aus gescouteten Open Team Sheets (Champions VGC hat keinen Dump und ein eigenes EV-System), schreibt jedes Spiel in die Bibliothek. Nie auf smogtours; Ladder erst mit von PS-Staff markiertem Account; auf einem selbst gehosteten Server ohne Erlaubnis.
- **Live-Assistent** zuletzt, mit Guardrails: keine Hilfe auf dem smogtours-Host, in Turnier-Battles (`|rated|` mit Nachricht), in Turnier-Räumen; Ladder-rated standardmäßig aus, per Setting mit klarer Bestätigung; Spectator-Overlay für öffentliche Battles.
- **Team-Picker** (`team-picker`): Dump und Sheets parsen, mit `TeamValidator` prüfen, Format-Fitness gegen aktuelle Usage-Stats (Usage-Rang, Set-Übereinstimmung, Threat-Coverage per KO-Odds, Alters-Abschlag), Rang = normalisierter Quell-Score × Fitness, Top 10 im Round-Robin, optional gegen den konkreten Gegner.

Entscheidungen vom 04.09. (User): Zielgruppe Turnierspieler, Gegner-Scouting zuerst; Messformate `gen9ou` und Champions VGC 2026 (`gen9championsvgc2026regma/regmb` + Bo3), alle anderen laufen mit; Compute im Browser; Stärke-Band experimental; Scouter-Regeln nach TS portieren und verbessern, der alte Replay Scouter bleibt unverändert; Gegner-Grades hinter Setting; Monorepo in DIESEM Repo mit `apps/dashboard` und `apps/companion`; Companion an der Wurzel MIT `/latest/`, `/v<version>/`, `/versions/` (Tags `companion-v*`, Start 1.0.0), Dashboard unter `/dashboard/` mit seinen vier Kanälen, alte `/v0.x/`-Pfade als Redirect-Stubs, `?replay=`-Deep-Links an der Wurzel werden weitergeleitet.

Reihenfolge und Gates (Spec §2): 0 Monorepo → 1 Scouting-Kern und Companion → 2a `eval-runtime` → 2b Grades und Profile / 4a Bot ohne Modell (beliebige Reihenfolge) → 3 Gegnermodell → 4b Bot mit Modell → 6 Team-Pipeline → 5 Live-Assistent. Jeder Schritt hat Brainstorming-Feinschliff, Spec-Abschnitt, Plan-Phase und Gate (Lint, knip, Paket-Suiten, e2e beider Apps, API-Snapshot; drei byte-identische Feedback-Läufe, sobald ein geteiltes Paket oder die Pipeline berührt ist; Kalibrierung gepaart, sobald Scores berührt sind). Phase 0 des Plans steht auf Schritt-Ebene bereit (acht Tasks: Baseline-Capture, `git mv`, Suiten mit dateirelativen Fixtures, Zonen und Ratchet-Pfad-Rewrite, Companion-Scaffold mit Weiterleitung, `assemble-site.mjs` mit zwei Release-Linien und `ci.yml`, Docs, Gate); die Phasen 1 bis 6 werden je zu Beginn auf Schritt-Ebene ausgeschrieben.

Erster Handgriff, wenn es losgeht: Plan Task 0.1 (Branch `monorepo`, Feedback-Baseline mit `FEEDBACK_DUMP=1` sichern), Ausführung nach Wahl subagent-getrieben oder inline.

## B. Offene Korpus-Gaps

Jeder Gap hat sein TODO. Die Pins selbst stehen in `e2e-feedback/corpus.ts`; Re-Pins nur am User-Gate.

| Gap | Stand 19.09. | Bearbeitet in |
| --- | --- | --- |
| 573756 t73 (seit Runde 32) | chance und Key Moment sind seit Runde 40 gepinnt (dbffb5f). Stand 06.10. (nach Runde 63): Der Satz „one 95% roll from clearing the rest“ steht, die Bar geht von 24 auf 33 % für SOULWIND, Body Press liest inaccuracy (Regret 0,12, Defog knapp besser); die Note ist nach der Monte-Carlo-Sonde der Runde 62 echt. Ob der Pin auf truth geht, entscheidet ein späteres Gate mit Re-Pins. | Re-Pin-Frage am Gate |
| 649664 t23 | observed steht seit Runde 42 auf chance. Die Bar liest 0,79 statt 0,92, weil der Beweis den nächsten 80-%-Hydro-Pump offen lässt, keinen Crit (Runde 62). Seit Runde 63 nennt die Karte Zug 24 den offenen 80-%-Hydro-Pump (T19) und sagt in Zug 23, dass das Urteil am Item von Keldeo hängt (Choice Scarf: fine, Mystic Water: blunder); der Nachbau gibt einem geratenen Choice-Item in Gen 6 nie die Schadens-Prüfung (T121 Punkt 1). | T121 |
| Draft-Spiel t48, 573756 t70 | Chance-Buchung ohne Würfel: Der Read-Payoff verpufft (t48), die Setup-Auszahlung kommt eine Bewertung zu spät (t70, liest heute quiet mit −0,145). | T22 |
| GPL DzBQ5azlO5l t13 | Heavy Slam liest ohne Fehler-Band. Stone Edge fehlt im Set (gen9ou 0,35 %, eine Grenze der Rekonstruktion); mit von Hand nachgetragenem Stone Edge entschied bis Runde 62 die Vertiefung aus der ersten Ziehung die Zelle Air Slash gegen Stone Edge; seit Runde 63 vertieft die Nachprüfung je Klasse (T16), die Zelle ist nicht nachgelesen. t15 liest in Auto richtig (Vileplume-Reue 0 bis 0,018 in drei Seed-Sätzen, Runde 62) und ist erledigt. Fixture `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | T119 |
| smogtours-gen9ou-750267 Weavile | Steht mit Jolly 0/0/0/0/0/252 bei 41 Schadens-Beobachtungen und 11 Zugreihenfolgen: Die erfüllte Reihenfolge hält das Tempo, das Budget zahlt es aus dem Angriff. Bank-Bau und App-Bau gleich. | T26 |
| smogtours-gen9ou-751207 t6, VGC 2629703929 t10 | Tera in der Statik: Ceruledge (Tera Kampf) galt als immun gegen Body Press; Koraidon (Tera Feuer) las −0,645 statt −0,396. Der Träger T57 ist seit Runde 54 erledigt, T81 (Statik fragt den Simulator, STAB nach den Spielregeln) seit Runde 63; die Szenen hat noch niemand nachgelesen. | T127 |

## C. Beobachten (Signal → wann handeln)

Oberfläche und Tempo:

- [ ] Replay-iframe: Seeks und Log-Anhänge kosten je 200 bis 350 ms, die letzte Long-Task-Quelle (Play-out: 8 Tasks, 1,8 s über 4 Züge) → handeln, wenn das Battle-Fenster beim Play-out sichtbar ruckelt; Hebel: `hold` ohne Vorparsen oder Anhänge in Paketen.
- [ ] Eval-Panel während der Suche: jedes Render unter 50 ms (Drossel: 10 Fortschritte, 4 Partials je Sekunde) → wenn die Sonde wieder Busy-Segmente über 30 % zeigt: `React.memo` an `GameGraphSection` und `EvalResultBlock`, `variation` per useMemo.
- [ ] Erster Worker-Spawn: 12 Eval-Worker plus Replay-Worker parsen je 7 MB gleichzeitig → progressiver Spawn oder Pool-Warmup, wenn es beim ersten Evaluate ruckelt (`src/lib/eval/worker-client.ts`, `pool-size.ts`).
- [ ] `pre`-Task vor dem Laden 200 bis 290 ms gegen 130 bis 150 ms, unter Fremdlast gemessen (Eintritts-Chunk 8,7 MB) → leer nachmessen, bevor daraus ein Befund wird.

Bericht und Buchung:

- [ ] Lob und Ungenauigkeit auf demselben Klick (VGC Bo3 2634199230 Zug 5, aus Abschnitt B): Seit Runde 56 lobt die Karte wb_vg als p1-read (+0,33) und nennt denselben Klick eine Ungenauigkeit (−9 %) → handeln, wenn ein Korpus-Spiel den Fall zeigt.
- [ ] Doubles-Zeilen der App zeigen die K.-o.-Quote seit Runde 56 („· 90% KO“), aber ohne Slot und Ziel: `KoSuffix` (`src/components/eval/analysis-bits.tsx`) liest `koOdds.label` nicht, der Tooltip sagt „vs the standing active“ → handeln, wenn jemand die Quote einer Doubles-Zeile dem falschen Pokémon zuordnet; Hebel: Label in Suffix oder Tooltip.
- [ ] Doubles-K.-o.-Angaben sind Wurzel-Quoten (Runde 56, wie in Singles): Howl, ein Pollen-Puff-Kratzer oder ein Tera-Klick im selben Zug fehlen darin (2663093831 Zug 4, 2629703929 Zug 1); die Zellen preisen es → handeln, wenn eine Prosa-Zahl oder die Sack-Regel daran falsch wird.
- [ ] In 2663093831 Zug 7 steht p1s gespielte Kombination (Orthworm greift an, Dragonite schützt sich) nicht unter den 12 Optionen; der Teil-Abgleich füllt den verdeckten Slot mit „→ Ting-Lu“, einem Wechsel, den das Log ausschließt (ein Wechsel ginge vor Flare Blitz) → zusammen mit dem Options-Deckel lesen.
- [ ] Favor-Grenze prüft nur das Vorzeichen (655336 bucht heute +0,274 als Resolution, Stand 05.10.) → Größen-Bedingung nachrüsten, sobald ein echtes Glücksereignis eines Start-Ziel-Siegers als Resolution gebucht wird (`report.ts`: `favorBoundary`, `resolutionTurns`).
- [ ] Setup-Züge ohne Feed bleiben bewusst unentlastet (573756 t70, zweiter Schwerttanz: heute Regret 0,075, kein Tier) → handeln, falls der Experte solche Spots reklamiert; Gutschrift nur mit Floor-Anker, sonst Ergebnis-Wäsche.

Engine und Messung:

- [ ] Der Set-Rückfall für Doubles und VGC ist fest auf Gen 9 verdrahtet (`src/lib/smogon/format-fallback.ts`): Ein Doubles-Replay vor Gen 9 bekäme Gen-9-Sets. Heute ist jedes Doubles-Replay in Bank, Fit-Korpus und Feedback-Lauf Gen 9 → handeln, bevor ein älteres Doubles-Spiel in eine Messung kommt.
- [ ] Ein neuer Live-Zugriff in `pairThreat` oder `singleMoveFraction` braucht seinen Schlüssel-Term in `pairKey` (Runde 49: HP, Typen und Basiswerte fehlten, Doubles-Zellen wichen von Lauf zu Lauf ab) → bei jeder Änderung an `score/threat.ts` (als Nächstes T125 Punkt 1: Body Press und Foul Play) den Test `threat-memo.spec.ts` um den neuen Zugriff erweitern. Seit Runde 54 trägt der Schlüssel den Tera-Typ neben den rohen Typen, für Angreifer und Verteidiger (be95961); ein Blatt, das die lebenden Typen liest, ist damit gedeckt, der Fall steht in `threat-memo.spec.ts`.
- [ ] Das Gegnermodell liest eine Doubles-Paar-Zeile nur am ersten Slot (`isSwitchChoice` in `opponent-model.ts`); in Doubles wird es deshalb selten sicher (Favorit ab 0,6 auf 10 von 496 Seiten) → handeln, wenn der Read in Doubles gebraucht wird (T42).
- [ ] 573756 Zug 134 bis 136: Die Decided-Erkennung nennt seit Zug 92 die richtige Seite, der Balken steht bei 0,33 bis 0,60, weil die Suche den Struggle-Plan über zwölf Plies nicht ausrechnet. Seit Runde 50 schweigt der Satz dort bis Zug 137 → mit T109 messen (2400 Durchläufe; T33 ist in Runde 62 geschlossen): Steht der Balken ab Zug 134 bei 0,7, spricht der Satz von selbst früher.
- [ ] 2663093831 Zug 10: p2s Ungenauigkeit verschwindet mit T81 (Runde 63, Spur B), obwohl ihr Regret von 0,152 auf 0,276 steigt; die Ursache ist ungelesen → lesen, wenn T127 die Statik-Gewichte neu fittet.
- [ ] Gen-2-Logs zeigen Leftovers-Träger unter vollen KP ohne Heilung (684843 Zug 34; 72 Züge in 30 Gen-2-Spielen; Runde 63, Spur D) → handeln, bevor ein Gen-2-Spiel in eine Messung kommt, deren Urteil an einem Leftovers-Ausschluss hängt.
- [ ] Doubles mit verdecktem Slot: Die gespielte Kombination wird vor der Nachprüfung gewählt, die Note kann auf einer anderen Kombination landen (`tree-orchestrator.ts:104`, Review der Runde 63) → handeln, wenn eine Doubles-Note an einem teilweise gesehenen Zug falsch liegt; T119 liest mit.
- [ ] Rage Fist, Last Respects und Retaliate rechnen in der Statik mit Katalog-Stärke (0 Träger auf der Bank; Runde 63, Spur B) → handeln, sobald ein Träger auf der Bank oder im Korpus steht.

- [ ] Der Spread-Löser gibt GPL-Cobalion Timid bei 252 Angriffs-EVs: Natur und EVs stammen aus unvereinbaren Vorlagen. Der beobachtete Treffer (106) beweist den Fehler nicht, er bindet Cobalions Angriff und Noiverns Verteidigung gemeinsam → handeln, wenn eine Fitter-Runde denselben Widerspruch an weiteren Sets zeigt.
- [ ] Die Bring-Beschränkung fällt in kurzen VGC-Spielen still weg: `replayBringOnly` liefert null, sobald eine Seite weniger Arten zeigt als die Bring-Zahl (2634199230: 3 von 4 nach sechs Zügen). `|teamsize|` nennt nur die Zahl 4, nicht die vier Arten → handeln, wenn ein gemessenes Urteil daran hängt.
- [ ] Die Harness-Fixtures tragen einen älteren Datenstand als `.smogon-cache` (gen6ou: 292 gegen 297 Arten, Datei vom 14.08.) und bewegen 4 von 72 Singles-Sets in 649664 und 655336 → beim nächsten Neu-Aufzeichnen der Fixtures mit bewegten Pins in genau diesen beiden Spielen rechnen.
- [ ] Doubles-Urteile springen zwischen zwei Zuständen einer Runde (Runde 54, VGC 2629703929): Mit dem lebenden Verteidiger-Typ entsteht in Zug 11 ein Blunder (Reue 0,00 auf 0,51), mit der STAB-Regel verschwindet er wieder (0,01), und in Zug 9 entsteht ein anderer (0,12 auf 0,48). Seit Runde 56 (T58) ist eine Doubles-Wurzelzelle der Matrix mit Würfel-Ereignis die Mischung ihrer Klassen oder das Mittel von acht Ziehungen. Die Frage beantwortet das nicht: Zug 9 bis 11 laufen über MCTS (Fainted-Anteil 0,50 bis 0,63), der Paar-Plan erreicht sie nur über Verify-Zellen, und ihre Reuen stehen in Runde 55 und 56 gleich (p2 0,1043, 0,1022, 0,0437) → beim nächsten Wechsel der Doubles-Statik dieselben Züge vergleichen; springen sie dann, liegt es nicht an der Matrix-Zelle (beim Doubles-Teil von T81 lesen; Stand 05.10.: p2 0,104, 0,102, 0,044 wie in Runde 55).
- [ ] Warnung der Runde 54 auf der Bank: Doubles Mitte hq +96 bp [+8, +198] auf 49 Stellungen (mit der STAB-Regel +98 [+11, +196]); drei Stellungen tragen 92 davon (smogtours-gen9doublesou-937928 Zug 6, -913993 Zug 6, -939625 Zug 8, alle lesen nach der Korrektur freundlicher für den späteren Verlierer) → Runde 56 hat sie kaum bewegt (937928 Zug 6: 0,4718 auf 0,4719, 913993 Zug 6: 0,05266 auf 0,05272; 939625 Zug 8 läuft über MCTS und ist byte-gleich), gelesen hat sie noch niemand → bei T31 zuerst lesen.
- [ ] `gimmickSuffixForSlot` (`branch/protocol-choices.ts`) prüft den Slot, nicht den Körper hinter dem Doppelpunkt: Steht im Nachbau ein anderer Körper im Slot, terastallisiert der falsche (gemessen am Simulator in der Vorbereitung der Runde 54, `docs/perf/probes/2026-09-20-r54/T57/wf1/check-teraloss.md`). Ein Namensvergleich trägt nicht, weil die gebauten Sets die Art als Namen führen und das Protokoll den Spitznamen. Wie oft der Nachbau dort abweicht, ist ungemessen → zählen, wenn eine Runde den Nachbau ohnehin durchläuft.
- [ ] Ein K. o., der nur im Nachbau passiert, kostet mehr als die Tera-Markierung (Runde 54): Der Simulator räumt alle Volatiles ab (Substitute, Leech Seed, Encore), setzt `isStarted` und `lastMove` zurück; die Korrektur stellt nur KP, Status, Boosts und seit Runde 54 die Markierung her. Eine vom Simulator abgelehnte Wahl beantwortet der Nachbau mit `default`, und der terastallisiert nie (die Markierung kommt an der nächsten Grenze zurück, der Zug selbst bleibt untreu) → handeln, wenn eine Stellung mit verlorenem Substitute in einem Dump oder einer Bank-Spitze auffällt.
- [ ] `parsePlayedActions` (`played.ts`) führt auf einem Zug mit `|cant|` keine Aktion, also auch kein Tera: Der Abgleich „gespielt gegen Optionen“ sieht den Tera-Klick eines zurückgezuckten Körpers nicht → mitnehmen, wenn T59 oder T64 an `played.ts` bauen.
- [ ] `carryPreSolve` (`team-builder.ts`, bis Runde 53 `carryItemDecisions`) gibt einem Pokémon, das die Volllösung verwirft und aus ihrem Ergebnis streicht, den Eintrag der Tempo-Vorlösung zurück. Ohne Item sind das 165 Einträge auf den 129 Bank-Replays, 9 davon bewegen ein Set (8 Replays); wie oft der mittlere Zweig greift (verworfen, aber vom Log mit festen KP im Ergebnis gehalten), ist ungezählt. Die Aussage zum Item-Zweig (kein Treffer in den 139 gemessenen Replays) stammt unverändert aus Runde 52 → wer die App auf eine Lösung zurückbauen will, braucht zuerst einen Fall für den Item-Zweig.

- [ ] Ein Play-out verheizt eine Win-Condition in falscher Reihenfolge (Draft t56 bis t62). Seit Runde 63 prüft der e2e-Pin die Absicht (Heatran nie vor Muk-Alola): Mit T16 folgt der Play-out der Monte-Carlo-Rangfolge und gewinnt in Zug 62, ohne einen der beiden zu schicken → bei einem weiteren Fall Q5 (T39) vorziehen.
- [ ] Früher Brier: Runde 40 kostete früh 28 bp hq (0,2569 → 0,2597), spät gewann sie 84 bp; Verdacht: exakte HP-Körper geben früh zu extreme Balken → bei jeder Fitter-Runde die frühe hq-Spalte vorregistrieren; handeln, wenn zwei Runden hintereinander früh verlieren.
- [ ] hq-Tranche: n=560 (r61-t98b; smogtours plus Ladder ab Rating 1700) → Tranche neu schneiden, wenn n unter 500 fällt oder eine neue Tranche das Verhältnis kippt.
- [ ] Premature-End-Rest: heute nur 2663093831 Zug 14 (1 von 320 Blöcken der Dumps; 648453 hat keinen Rest mehr) → Backstop nur, falls die Rate mit dem Korpus wächst.

- [ ] Bewegte MCTS-Züge, deren Urteil nicht am umgepreisten Zug hängt (Runde 57, 648453): Neue Hinweise an der Wurzel (Hidden Power Ice in Zug 23: 0,21 → 0,85) ordnen die Baum-Expansion um, ziehen den einen Zufallsausgang jeder Wurzelzelle neu (Chance-Knoten aus) und ändern, welche Zellen die Nachprüfung neu preist (Zug 24 und 33; Zug 31 eine neu gezogene 70-%-Zelle). Fast jede Zelle eines MCTS-Zugs bewegt sich (Zug 23: 26 von 28 Zellen), obwohl kein Urteil am Wurzelpreis von Hidden Power Ice hängt → handeln, wenn ein Pin nur an so einer Verschiebung hängt; Hebel: Baum-Varianz messen (mehr Bäume oder Iterationen), bevor ein Urteil gelesen wird.
- [ ] Golden 655336 driftet seit Runde 63 in zehn Kanälen (Gate 06.10.: der Trick in Zug 5 ist kein unbedingter Fehler, Fehlzug 5:p2 ist aus der Golden): fehlende Schlüsselmomente Zug 5, 6 und 26, zusätzliche Schlüsselmomente Zug 18, 22 und 27, fehlender Fehlzug 26:p2, zusätzlicher Fehlzug 22:p1, zusätzlicher Read 27:p1, kein Wendepunkt statt 4. Zug 13 ist mit T16 geheilt → beim nächsten Golden-Refresh am User-Gate gesammelt lesen; T119 und T127 messen zuerst an der Golden (D7).
- [ ] 20 falsche Treffer außerhalb aller Familien (Schiedsrichter der Runde 57, Zeile „ohne Familie“: Air Balloon, Psychic Terrain, Armor Tail gegen Priorität) → handeln, wenn einer davon ein Urteil trägt; Hebel: Familien im Schiedsrichter anlegen und zählen.
- [ ] Der Pin 653785 Zug 19 ist seit Runde 63 truth (Hazard-Sack-Satz, kein Tier, played → Weavile) und hängt an wackeligen Zahlen: Weavile liegt 0,004 hinter der besten Zeile (Stand 06.10.), der Satz am Payoff der Folgezüge, und der Gewinn lehnt sich an Tornadus-T als Antwort auf Dragonite. Das Spiel widerlegt das in Zug 24: Die vierfach effektive Hidden Power löst Dragonites Weakness Policy aus, die die Engine nicht kennt → handeln, wenn der Pin kippt oder ein Weakness-Policy-Term gebaut wird; Hebel: Pins auf gameValue statt Score lesen, Weakness Policy in der Statik.

Umgebung:

- [ ] e2e „branch replay play controls stay muted without audio errors“ sah in Runde 50 zwei Seitenfehler aus dem Replay-iframe (`$ is not defined`, danach `reading 'length'`): 1 von 2 vollen Läufen rot, einzeln 10 von 12 grün auf dem Branch und 6 von 6 auf der Basis. Ein Showdown-Skript läuft, bevor jQuery geladen ist (dieselbe Familie wie der Config-Routes-Fix e019a73) → handeln, wenn der Test ein zweites Mal ein Gate kippt; Hebel: Ladereihenfolge der dynamischen Skripte im Embed, oder der Test wartet auf `window.$` im iframe, bevor er Fehler zählt.
- [ ] e2e „a long forward slider jump lands the scene instead of hanging on "seeking..."“ (`e2e/timeline.spec.ts:49`) wartete im Wellen-Lauf 3 der Runde 63 30 s vergeblich auf `Replays.battle` im Replay-iframe (1 von 75 Tests in einem vollen Lauf; einzeln 4 von 4 grün, in den Wellen-Läufen 1 und 2 grün) → handeln, wenn der Test ein zweites Mal ein Gate kippt; vermutlich dieselbe Familie wie die Ladereihenfolge im Embed.
- [ ] Browser-Build ist Teil des Feedback-Ankers: Ein Chromium-Wechsel verschiebt die letzte Gleitkomma-Stelle (573756 t81 Verify-Auswahl) → jedes Playwright-Upgrade ist eine Re-Verankerung mit `FEEDBACK_DUMP=1`; Stand `@playwright/test ^1.62.1`.
- [ ] TypeScript bleibt auf 6.x, bis typescript-eslint den nativen Compiler parst; `@types/node` folgt dem CI-Node-Major (24) → Peer-Range beobachten.
- [ ] Wöchentlicher Versions-Check von `@pkmn/sim` (ab der Übernahme am 26.09., Pin 0.10.11) → bei neuer Version ein Upgrade-PR nach D24.
- [ ] Screenshot-Sonde `docs/probes/2026-09-03-css/` (32 Tests, 34 Screens, 0 Pixel Toleranz; Start über `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`; ihre baseURL steht fest auf Port 5174, `--dev-port` erreicht sie nicht) → als Pixel-Gate für jede UI-Runde wiederverwenden; Baseline mit `--update-snapshots` neu aufnehmen, wenn Copy oder Layout sich bewusst ändern.

Geparkte Branches:

- Aufgeräumt am 06.10. nach Runde 63: `r54-stab` (252ade4, steckt in master und v1), `r57-power` (34f84b9) und `r57-with-power` (66ba26f) sind gelöscht, weil STAB und die Stärke beim Einsatz seit Runde 63 über den Simulator im Code stehen; ebenso die Runden-Branches `r59` und `r63` (in `v1`) und die Spur-Branches `w1-a` bis `w1-h` samt `w1-d-fix`, `w1-e-fix`, `w1-f-fix` (jeder Commit per Cherry-Pick in `v1`). Hashes in `docs/perf/probes/2026-10-05-r63/gate/deleted-branches.txt`; solange Git die Objekte hält, holt `git branch <name> <hash>` einen zurück. Bank-Ordner `.calibration/r54-review`, `r54-stab`, `r57-power` bleiben.
- `r58-oracle` (33c93c5, auf 85eb5ad): der Wegwerf-Branch der Sichtung der Runde 58: `score/oracle.ts` rechnet den Schaden der Statik wahlweise mit @smogon/calc oder einem angepassten `getDamage` des Simulators (`EVAL_STATIC_ORACLE=calc|sim`); die Commit-Nachricht trägt die vorregistrierten Schwellen. Nie mergen; Schiedsrichter. Sonden unter `docs/perf/probes/2026-09-24-r58/`; Runde 61 (T97) hat seinen Code per `git archive` nach `docs/perf/probes/2026-10-02-r61/static/src` entpackt und dort um den Modus `mean` ergänzt, ohne Worktree.
- `r41-wide` (163efcc): weite Lesart der Tempo-Freigabe, Referenz für T26. Der Bank-Ordner ist gelöscht, die Zahlen stehen in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.

## D. Standing Rules

- **D1** Kein Push ohne Ansage. Stand 24.09. (Verdikt der Runde 57): origin/master steht auf e7f618f (Runde 55), origin/v1 auf dem master-Stand nach Runde 57. Zuletzt gingen `v1` und master am 21.09. um 17:18 gemeinsam zu origin (Runde 55); seither folgt nur `v1`. Seit dem 20.09. trägt der Branch `v1` bei origin den master-Stand: nach Runde 52 (User-Freigabe 14:50: „auf einen v1 branch, den du pushen darfst“), nach Runde 53 (User-Gate 16:22, „3a“), nach Runde 54 (User-Gate 21.09. 16:21, „4a“), nach Runde 55 (User-Gate 21.09. 17:18), nach Runde 56 (User-Gate 23.09. 17:18, „2a“) und nach Runde 57 (User-Gate 24.09. 12:13, „1a“). Die Gates der Runden 56 und 57 bestätigen die Regel: Nur `v1` folgt dem master-Stand, origin/master bleibt auf e7f618f. Jede Freigabe gilt für `v1` und für den genannten Stand. Seit dem User-Gate der Runde 59 (01.10.2026) blieb das Programm „Mehr Simulation“ auf Branch `r59` bis Runde 62; danach ging es in `v1`, und `v1` wurde gepusht. Seit Runde 63 (Gate 06.10., „8a“) steht origin/v1 auf f4fee1b; gearbeitet wird auf `v1`, jede Runde auf ihrem eigenen Branch ab `v1`, der nach dem Push gelöscht wird.
- **D2** Vor jedem Push `npm run lint` lokal (der Pages-Workflow hat ein eigenes Lint-Gate) und `npx tsc -b` (`tsc --noEmit` prüft in diesem Solution-Setup nichts).
- **D3** Score-berührend = Cache-Bump + gepaarter Bank-Bench gegen eine frische Basis vom selben Tag + drei byte-identische Feedback-Läufe (seit Runde 49 zehn Dumps: sechs Singles, vier Doubles). Das Bank-Verdikt liest die Tabelle mit Fehlerbalken aus `scripts/paired-calibration.mjs` (seit Runde 48: 90-%-Band aus einem gepaarten Bootstrap über Replays, Sichten full, hq und glücksbereinigt): **Gepoolte Zeilen entscheiden, Phasen-Zellen warnen.** Ein Kandidat besteht, wenn (1) sein Gewinn dort belegt ist, wo die Messung scharf genug ist (eine gepoolte Bank-Zeile ganz im Guten ODER der Fit-Korpus out-of-sample in allen Seeds), (2) keine gepoolte Bank-Zeile Schaden zeigt und (3) die Tier-Zählung der Feedback-Dumps hält (D21). **Schaden braucht Größe** (User-Gate 19.09., Runde 49): Eine gepoolte Zeile ist Schaden und eine Phasen-Zelle eine Warnung, wenn ihr Band ganz im Schlechten liegt UND ihr Mittel mindestens 5 bp beträgt; kleinere aufgelöste Verschiebungen druckt das Skript als Hinweis hinter dem Verdikt (eine Änderung, die wenige Stellungen bewegt, löst ein einzelnes bp auf). Warnungen und Hinweise gehen mit ihrer Größe ans Gate. Eine Korrektur mit Zweck außerhalb der Bank (Korpus-Gap, Korrektheitsfehler) braucht (2) und (3) und ihren eigenen Beleg. Auflösung der Bank (kleinster wahrer Effekt, den eine Zeile in vier von fünf Fällen sieht, Median über die Kandidaten der Runde 47): gepoolt gesamt 23 bp, gepoolt Singles 24, gepoolt Doubles 58, Singles-Phasen-Zelle 33, Doubles-Phasen-Zelle 72; eine K-Abbildung löst feiner auf (gepoolt 10 bp) als ein Gewicht, das wenige Stellungen stark bewegt. Punktwerte ohne Band sind kein Verdikt. Corpus-Re-Pins und Golden-Refreshes nur nach User-Gate.
- **D4** Verlustfrei oder render-only = drei byte-identische Feedback-Läufe + Kalibrierung ziffern-gleich + `npm run test:regression`, e2e, lint, `tsc -b`.
- **D5** Messen vor Bauen: Spike oder Sonde vor dem Design-Gate, Messkette vor Pins, roter Test vor dem Umbau. Jede Runde bekommt vor dem Bau Brainstorming und Spec.
- **D6** Byte-Vergleiche nur mit `FEEDBACK_DUMP=1` und frischen Dumps (mtime prüfen). Wanduhr-Gates und Perf-Sonden nur verschränkt mit der Basis auf einem Maschinenzustand (Runde 43: +18 % Drift bei unverändertem Code innerhalb eines Vormittags; 573756 unter Fremdlast 101 bis 440 s).
- **D7** Baum-, Wurzel- und Ziehungs-Änderungen: zuerst den Play-out-Pin einzeln fahren (Draft t56, Muk-Alola vor Heatran, `e2e/branch.spec.ts`, 34 s). Er kippt früher als die Bank (Runde 43, Runde 45). Verify- und Merge-Änderungen zuerst an der Golden 655336 messen (`docs/perf/probes/2026-09-03-r32/verify-check.spec.ts`, 34 s, billigstes Orakel).
- **D8** Fitter- und Set-Runden: Set-Diffs auf allen Bau-Wegen VOR der Bank. Bewegt sich auf dem Bank-Weg kein Set, misst die Bank blind (Runde 41). Es gibt vier Bau-Wege (Runde 51, T12): nackt (nur Beobachtungen und Zugreihenfolgen), alter Bank-Bau (rohe Team-Infos plus Nutzungs-Fills, eine Lösung; seit Runde 52 nur noch hinter `EVAL_CALIBRATION_RAWBUILD=1`), App-Bau (angereicherte Infos, `solveReplaySpreads` mit Tempo-Vorlösung) und Feedback-Harness (derselbe Code wie die App, aber Daten aus `e2e-feedback/fixtures`). Seit Runde 52 baut die Bank über `buildAppTeams` (`src/lib/app-team-build.ts`) wie die App: Set-Diff Bank gegen App 0 von 1549 über die 129 Replays. Eine Runde, die den App-Bau ändert, ändert damit auch die Bank; `regression/app-build-parity.spec.ts` und `ui/hooks/appBuildParity.spec.tsx` halten Hook-Kette, Worker-Lösung und `buildAppTeams` zusammen. Die zwei Options-Blöcke in `src/lib/team-build-options.ts` lesen App und Bank gemeinsam: Eine Änderung dort bewegt beide und fällt den Pins nicht auf. Seit Runde 53 (T66) behält ein Pokémon, das die Volllösung verwirft, den Eintrag der Tempo-Vorlösung (`carryPreSolve`); vorher fiel es auf die Nutzungsstatistik zurück und brach 13 Zugreihenfolgen, die die Vorlösung hielt. Wer an der Übergabe zwischen den zwei Stufen baut, zählt die Zugreihenfolgen je Stufe (`docs/perf/probes/2026-09-20-r53/T66/stage-trace.vt.ts`: der Nachbau der Kette besteht zuerst den Identitäts-Test gegen `solveReplaySpreads`). Der alte Satz „Set-Annahmen 404 im Harness“ war falsch: Die Fixtures tragen die Set-Dateien, nur `sets/gen9doublesubers` fehlt, und die fehlt auch im Cache. Jede Sonde nennt ihren Bau-Weg UND ihre Datenquelle. Fit-Korpus und Bank teilen kein einziges Replay: Ein Fit-Korpus-Diff sagt nie voraus, ob die Bank etwas sieht. Ein Diff gegen eine gespeicherte alte Liste zeigt nur, was die letzten Runden geändert haben; wer wissen will, was der Löser tut, misst gegen den Prior desselben Laufs (gegen die Liste vom 11.09. bewegt sich 1 Doubles-Set, gegen den Prior sind es 43).
- **D9** Sonden nie unter `regression/` ablegen (die Suite sammelt sie ein; zweimal je eine Stunde verloren), sondern als `.vt.ts` unter `docs/perf/probes/<datum>/` mit eigener Vitest-Config (Vorbild `docs/perf/probes/2026-09-12-r45/vitest.probe.config.ts`). Sonden auf das Bank-Universum begrenzen (neun Minuten); den Fit-Korpus nur parser-seitig anfassen (mit Fills und Löser über eine Stunde).
- **D10** Diagnosen am Battle-State über den echten App-Pfad (Browser-Probe mit debug-Feld plus `FEEDBACK_DUMP`); nackte node-Rekonstruktion ist nicht harness-treu; `graph.results[]` hat kein turn-Feld (Index i = Turn i+1).
- **D11** Während Feedback-, e2e- und Kalibrierungsläufen nichts im Repo anfassen, auch keine Root-Markdown-Dateien (Vite reloadet, HMR zerschießt den Lauf); das gilt, bis Port 5176 leer ist. Browser-Messungen im eigenen Worktree, wenn eine zweite Session aktiv ist. Läufe über zehn Minuten abgekoppelt starten (nohup plus Marker-Datei), das Hintergrund-Tool endet sonst.
- **D12** Feedback-Läufe: `npm run test:feedback` startet seit Runde 46 über `scripts/run-e2e.mjs --dev-port 5176` (wartet auf Vites Abhängigkeits-Cache, verweigert einen belegten Port, räumt den Server am Ende ab). Weiter von Hand: drift-json vorher löschen (ein roter Lauf schreibt den Bericht zweimal, die zweite Fassung ist unvollständig), Läufe über zehn Minuten detached starten. Meldet der Starter „Port busy“, den Besitzer per `netstat` suchen und seine Kommandozeile prüfen, bevor etwas beendet wird.
- **D13** Bank: `node scripts/run-calibration.mjs --slices 6 --out .calibration/<name>` (volle Bank 200 bis 410 s; Runde 55 lief in 201 s, am 23.09. dieselbe master-Bank in 336 s und die Bank mit dem Paar-Plan in 407 s, rund 20 % mehr, weil er die 129 Doubles-Matrix-Stellungen verteuert; seit Runde 46 misst sie mit den Parametern der App, also mit Abgleich an jeder Zug-Grenze; `--env EVAL_CALIBRATION_RAW=1` ist das Instrument von vor Runde 46, `EVAL_CALIBRATION_LEGACY=1` ein Lauf je Stichprobe mit den heutigen Parametern; Basis `.calibration/base-20260918-live`, 833 Stellungen; seit Runde 47 (Bank-HP, Cache v47) ist `.calibration/r47-t46` die Basis des Code-Stands, 833 Stellungen, Brier 0,2565/0,2196/0,1222, hq 0,2468/0,1916/0,1227. Seit Runde 49 (vollständiger Merkzettel-Schlüssel, Cache v48) ist `.calibration/r49-fullkey` die Basis des Code-Stands: 833 Stellungen, Brier 0,2565/0,2196/0,1223, hq 0,2469/0,1918/0,1228; 45 Stellungen liegen anders als in `r47-t46`. Seit Runde 50 trägt jede Dump-Zeile `decidedHeld`, und die Zusammenfassung endet mit der Quote der Decided-Erkennung, roh und vom Balken gehalten (`.calibration/r50-held`: 76,7 % von 103, gehalten 94,7 % von 57; sonst ziffern-gleich zu `r49-fullkey`); `scripts/dossier-decided-losses.mjs --held` listet die Verluste unter den gehaltenen. Seit Runde 52 (20.09.) baut die Bank ihre Teams über die Kette der App (angereicherte Infos, zweistufige Lösung, HP-Evidenz); `--env EVAL_CALIBRATION_RAWBUILD=1` ist der Bau von vor Runde 52 und byte-gleich zu `base-20260920` und `r50-held`. Basis des Code-Stands ist `.calibration/r52-appbuild` (als Instrument übernommen am User-Gate 20.09. 14:50): 833 Stellungen (dieselben), Brier 0,2564/0,2197/0,1255, hq 0,2429/0,1941/0,1278, glücksbereinigt 0,2333/0,1950/0,1204, K gepoolt 2,24, Decided 76,7 % von 103 und gehalten 93,1 % von 58. Gegen den alten Bau liest sie gepoolt +11 bp [+1, +28] und in Singles +15 [+1, +39], hq +4 [+0, +7], Doubles unbewegt; 8 der 11 bp trägt eine Stellung (2658663776 Zug 86, T66). Seit Runde 53 (T66, Cache v49) ist `.calibration/r53-carry` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2566/0,2197/0,1232, hq 0,2431/0,1937/0,1275, glücksbereinigt 0,2330/0,1948/0,1177, K gepoolt 2,28, Decided 76,7 % von 103 und gehalten 94,7 % von 57; gegen `r52-appbuild` gepoolt −7 bp [−21, +0] und Singles −10 [−29, +0], 39 Stellungen in 8 Replays bewegt, Doubles ziffern-gleich; gegen den alten Bau bleiben gepoolt +4 bp [+0, +7] und Singles +5 [+0, +10], und das Skript druckt auf dieser Paarung weiter „HARM on full singles (+5)“ (die Instrumentzeile aus Runde 52, nicht das Gate der Runde 53). Seit Runde 54 (T57, Cache v50) ist `.calibration/r54-nostab` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2540/0,2207/0,1193, hq 0,2429/0,1956/0,1226, glücksbereinigt 0,2272/0,1940/0,1131, K gepoolt 2,34 (Singles 2,22, Doubles 2,55), Decided 75,9 % von 108 und gehalten 94,6 % von 56; gegen `r53-carry` Gewinn glücksbereinigt gesamt −22 bp und Singles −13 [−26, −2], Singles voll −6 [−15, +0], Doubles voll −46 [−113, +14] nicht aufgelöst, kein Schaden, eine Warnung (Doubles Mitte hq +96 [+8, +198], drei Stellungen tragen 92 davon); gemessen unter dem ersten Hash 8a0b790 des Park-Commits c910b91 (gleicher Baum); 297 Stellungen in 98 Replays liegen anders als in `r53-carry` (151 Singles, 146 Doubles): 293 tragen einen lebenden Tera-Körper, die 4 übrigen sind das Singles-Spiel gen9ou-2663110678 mit einem Soundproof-Träger. Die Zwischenstände der Runde liegen als `.calibration/r54-clickA`, `-markB`, `-key`, `-def`, `-stab`, `-flags`, `-review`. Seit Runde 55 (T74 und T70, Cache v51) ist `.calibration/r55-rebuild` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2537/0,2230/0,1195, hq 0,2428/0,1957/0,1229, glücksbereinigt 0,2272/0,1943/0,1134, K gepoolt 2,31 (Singles 2,22, Doubles 2,48), Decided 75,9 % von 108 und gehalten 94,7 % von 57; gegen `r54-nostab` 5 Stellungen bewegt, alle Doubles in den drei Encore-Replays. Seit Runde 56 (T58, Cache v52) ist `.calibration/r56-shortcut` die Basis des Code-Stands (`r56-fixodds` byte-gleich): 833 Stellungen (dieselben), Brier 0,2546/0,2231/0,1197, hq 0,2444/0,1960/0,1234, glücksbereinigt 0,2290/0,1947/0,1136 (503 statt 501 Stellungen gezählt), K gepoolt 2,31 (Singles 2,22, Doubles 2,46), Decided 75,9 % von 108 und gehalten 94,7 % von 57; gegen `r55-rebuild` gepoolt +4 bp [−4, +12] und Doubles +12 [−11, +41] nicht aufgelöst, kein Schaden, eine Warnung (hq Doubles spät +15 [+1, +35]) und ein Hinweis unter 5 bp (hq gesamt spät +4 [+0, +8], dieselben 45 Doubles-Stellungen); 115 der 129 Doubles-Matrix-Stellungen bewegt, alle Singles-Zeilen und alle Doubles-Stellungen ab Fainted-Anteil 0,25 byte-gleich (die Bank rechnet diese über `mctsSearch` ohne Verify). Die Zwischenstände der Runde liegen als `.calibration/r56-base` (byte-gleich zu `r55-rebuild`), `-pattern`, `-sampler` und `-odds` (Stand 9404ccf, vor dem finalen Review; gegen ihn liest `r56-shortcut` 42 Stellungen bewegt und glücksbereinigt −1 bp). Seit Runde 57 (T73, Cache v53) ist `.calibration/r57-timing` die Basis des Code-Stands (byte-gleich zu `r57-hp` und `r57-sentence2`): 833 Stellungen (dieselben), Brier 0,2543/0,2237/0,1193, hq 0,2441/0,1967/0,1227, glücksbereinigt 0,2301/0,1957/0,1136, K gepoolt 2,30 (Singles 2,24, Doubles 2,42), Decided 78,5 % von 107 und gehalten 94,9 % von 59; gegen `r56-shortcut` Singles voll −8 bp [−18, +1] (nicht aufgelöst) und glücksbereinigt −9 [−20, +0] (aufgelöst), Doubles +18 und +24 nicht aufgelöst, kein Schaden, eine Warnung (Doubles früh glücksbereinigt +59, auf hq +78); 157 Singles- und 108 Doubles-Stellungen in 60 Replays bewegt. Die Zwischenstände der Runde liegen als `.calibration/r57-base` (byte-gleich zu `r56-shortcut`), `-body`, `-field`, `-tera`, `-hp`, `-power` (T81, geparkt) und `-sentence2`; die Bank-Läufe der Kette liefen ab `field` mit `--slices 4` (nach Bauart gleich zu 6, weil der Merge sortiert, am selben Code aber nicht nachgemessen; 417 bis 460 s, mit sechs Slices 281 bis 304 s). Seit Runde 61 (T98, Cache v56) ist `.calibration/r61-t98b` die Basis des Code-Stands (byte-gleich zu `r61-early-tree`): 837 Stellungen; die Bank rechnet über `regression/bank-search.ts` wie die App (Bäume über `searchTreesOrchestrated`, Tera der App, gespielte Doubles-Kombination), Auto-Züge ab dem ersten mit dem Baum; gegen `r61-app` gepoolt −23 bp [−45, −2], Doubles −70; ein Lauf mit `--slices 4` braucht rund 800 s. Seit Runde 63 (Welle 1, Cache v57) ist `.calibration/r63-wave3` die Basis des Code-Stands (Gate-Stand 7db8a8c): 837 Stellungen, Brier 0,2543/0,2272/0,1113, hq 0,2466/0,2006/0,1062, K gepoolt 2,41; gegen die Tagesbasis `r63-base-1006` kein Schaden in beiden Tabellen, 805 Stellungen bewegt; vier Slices brauchten 694 bis 945 s. Seit Runde 63 liest `scripts/paired-calibration.mjs` jede Paarung zweimal: mit dem K der A-Seite und mit eigenem K je Spielart und Phase, in jeder Bootstrap-Ziehung neu gefittet (D25); jede Welle misst gegen eine Basis vom selben Tag. `--env EVAL_SEARCH_BUDGET=<Form>` misst eine Budget-Form (`tree-from=0.25` ist die Auflösung vor Runde 61), `--env EVAL_CALIBRATION_EXPORT_ALL=1` exportiert jede Stellung mit Tera und Sleep Clause. Bank-Zahlen vor dem 20.09. stehen auf dem alten Bau und gelten nur als Vergleich innerhalb ihrer Runde oder gegen einen Lauf mit `RAWBUILD=1`; das gilt auch für fit-seitige Dumps (`EVAL_CALIBRATION_SOURCE=fit` läuft durch dieselbe Schleife, während `regression/eval-fit.spec.ts` weiter nackt trainiert). Alle Bank-Zahlen in dieser Datei und im Backlog-Plan, die älter sind als der 18.09., stammen vom alten Instrument und gelten nur als Vergleich innerhalb ihrer Runde; weitere Flags `--env KEY=VALUE` und `--tranche`). A/B = zwei Ausgabeordner, dazwischen `scripts/paired-calibration.mjs` (dort `--quality hq|std`). Positions-Export über `--env EVAL_CALIBRATION_POSITIONS=<dir>`. Ist ein Slice-Lauf ungleich einem Ein-Prozess-Lauf, zuerst die mtimes von `.smogon-cache` prüfen.
- **D14** Perf-Umbauten an der Engine tragen ihre Identität dreifach: Fixture `fork-identity.json` (neu aufnehmen nur mit `PERF_IDENTITY_RECORD=1` auf dem Vorher-Code), Engine-Suite, Kalibrierung A/B ziffern-gleich. Die A-Seite einer A/B-Messung läuft auf dem Vorher-Code (Stash oder Worktree), nie auf einer Mischung. Perf-Sonde vor und nach am selben Tag: `PERF_PROBE=1 PERF_PROBE_LABEL=before|after npx playwright test -c docs/perf/probes/2026-09-03/probe.config.ts`.
- **D15** Worktree-Abbau (Vorfall 12.09. 15:25): Junctions (node_modules, .calibration, .smogon-cache, .fit-corpus) VOR `git worktree remove` einzeln und nicht-rekursiv löschen (PowerShell `[System.IO.Directory]::Delete('<worktree>\<junction>')`), dann per Reparse-Point-Scan prüfen, dass keine mehr existiert. `git worktree remove --force` folgt Junctions und löscht ihre Ziele. Seither: jede Bank-A/B mit frischer Basis am selben Tag; Vergleiche mit Ledger-Zahlen vor dem 12.09. nur mit diesem Vorbehalt. Memory `worktree-junction-removal`.
- **D16** `ALIGNMENT_SEEDS[0]` bleibt `'1,2,3,4'`; jede Listen-Änderung ist ein Cache-Version-Event. Runde 49 hat v48 genommen (Merkzettel-Schlüssel), Runde 53 v49 (Übergabe der Tempo-Vorlösung), Runde 54 v50 (Tera im Nachbau und in der Statik), Runde 55 v51 (Encore und gesperrte Slots im Nachbau), Runde 56 v52 (Doubles-Zellenplan), Runde 57 v53 (Züge beim Einsatz), Runde 60 v54 (Regelfehler am Simulator-Übergang), Runde 61 v55 und v56 (Baum ab dem ersten Zug), Runde 63 v57 (Welle 1: ein Bump für alle Spuren, nach dem Merge).
- **D17** Gates nie durch eine Pipe leiten (Exit-Code direkt lesen); PP immer live aus `moveSlots.pp`; Commits englisch im Release-Stil, ohne Attribution.
- **D18** Design-Gates und Erklärungen in einfacher Sprache (User-Vorgabe 25.08.). Doubles und Singles sind First-Class: Neue Features decken beide von Anfang an ab (User-Vorgabe 28.08.). Die Experten-Evidenz des Feedback-Korpus ist rein Singles. Seit Runde 49 laufen vier Doubles-Spiele ohne Pins im Feedback-Lauf mit (`FEEDBACK_CENSUS_REPLAYS`): Sie liefern Dumps für die Tier-Zählung und den Byte-Gleichheits-Test, aber kein Experten-Urteil. Doubles-Änderungen brauchen weiter die Bank, das VGC-Replay oder die Doubles-Fixtures als Orakel.
- **D19** `docs/` bleibt gitignored; `FeedbackEval.xlsx` und `deploy.ps1` untracked lassen (deploy.ps1 = lokales Server-Deploy via `Host vserver`, nicht pushen). `NextSteps.md` ist getrackt.
- **D21** Jede score-berührende Änderung liest neben der gepaarten Bank die Tier-Zählung der Feedback-Dumps: `node scripts/tier-census.mjs <ordner>...` zählt Ungenauigkeiten, Fehler und Blunder je Seiten-Zug, getrennt nach Singles und Doubles, mit nicht zugeordneten und nur teilweise gesehenen Seiten daneben; `--moved <basis> <neu>` nennt jeden Zug, dessen Einordnung, Tier oder Zuordnung gewechselt hat. Stand nach Runde 49 (Ordner `docs/perf/probes/2026-09-19-r49/feedback/fullkey-run1`): Singles 38 / 2 / 0 auf 558 Seiten-Zügen (39 nicht zugeordnet), Doubles 7 / 5 / 0 auf 88 Seiten-Zügen (3 nicht zugeordnet, 11 teilweise). Die Bank benotet den Balken, nicht die Zug-Urteile (Runde 47: Boosts 39 gewann auf der Bank und gab 573756 sieben neue Fehlerzüge). Die Summe allein genügt nicht: die bewegten Züge lesen, in Singles vor allem die Golden 655336 (Runde 48: Summe 38/2/0 → 32/2/1, aber ein neuer Blunder auf dem Experten-Spiel), in Doubles das VGC-Spiel 2629703929 mit Team-Auswahl. Doubles liest gröber und nie allein als Spielart: Bewertet werden 16 ausgewählte Zug-Paare, ein nie gesehener Slot macht das Regret zur Untergrenze (teilweise), und die vier Spiele sind Gen 9 mit Tera (VGC Level 50) gegen Gen 6 und 8 im Singles-Korpus; ein bewegtes Doubles-Urteil ist ein Anlass nachzusehen, kein Beweis. Ein neues K verschiebt jede Schwelle in Gewinnprozent mit (T52).
- **D20** Jede Barrel-Änderung erscheint als Fixture-Diff unter `regression/fixtures/api/` (`UPDATE_API_SNAPSHOT=1` nur bewusst; der Diff ist das API-Review); nach Paket-Änderungen `npm run pack:smoke`.
- **D22** Set-Sonden (Runde 51): Set-Listen nach Replay, Seite und Art paaren, nie nach Index (der Formen-Marker-Fix hat 492 Sets entfernt, die alten Skripte zählen sonst 1582 statt 977). Jeder Nachbau (Leiter, Sweep, Engine-Kopie) besteht vor der ersten Zahl einen Identitäts-Test gegen das heutige Ergebnis (der erste Leiter-Nachbau der Runde traf 595 von 977 Zeilen, der treue 960). Seit Runde 52 (T61) führt der Merkzettel der Nutzungsstatistik seine Datenquelle im Schlüssel: Zwei Quellen in einem Prozess liefern zwei Antworten (Gegenprobe `docs/perf/probes/2026-09-20-r52/T61/two-sources.vt.ts`, 4 von 120). Für Builder-Zählungen in Doubles die vier echten Spiele aus `e2e-feedback/fixtures` nehmen (die synthetischen Doubles-Fixtures stehen in keiner Nutzungsdatei), und den Platzhalter `Tackle` aus `team-builder.ts` nicht als gesehenen Zug zählen. Der Positions-Export der Bank trägt nur die 110 kleinen entschiedenen Endspiele, nicht die 833 Stellungen.
- **D23** Absturz-Schutz (Vorfall 20.09. 12:48: Bluescreen 30 s nach dem Start eines Bank-Laufs, der zweite harte Absturz in zwei Tagen). Danach standen alle in den letzten Sekunden geschriebenen Dateien in voller Länge aus Null-Bytes da, darunter `.git/HEAD`, `.git/config` und der frische Branch-Ref (`fatal: not a git repository`). Vor jedem schweren Lauf (Bank, Feedback, e2e): erst committen, dann die frisch geschriebenen Dateien auf die Platte zwingen (`powershell -File docs/perf/probes/2026-09-20-r52/flush-recent.ps1`), und unmittelbar vor dem Start kein Git-Schreibvorgang. Ketten flushen nach jeder Stufe (Vorbild `docs/perf/probes/2026-09-20-r52/gates-chain.sh`). Nach einem Absturz: genullte Dateien unter `.git` suchen und aus dem Reflog wiederherstellen, halbe `.calibration`-Ordner löschen, den Lauf neu fahren, mtimes der Caches prüfen. Rezept samt `config`-Inhalt in der Memory-Notiz `machine-crash-zeroed-git-files`. Dritter Absturz 23.09. gegen 21:16, wieder während eines Bank-Laufs mit sechs Slices; diesmal nichts genullt. Seither ist die Kette wiederaufnehmbar (`SKIP_BASE`, `STATES_FILE`, `PREV_BANK`, `PREV_PROBE`, `PREV_DUMPS` in `docs/perf/probes/2026-09-23-r57/gates-chain.sh`), und ihre Bank-Läufe fuhren ab der Wiederaufnahme mit `BANK_ARGS="--slices 4"` (`bank-run.sh` setzt ohne `BANK_ARGS` weiter sechs).
- **D24** Ein Upgrade von `@pkmn/sim` ist ein eigener PR mit allen Identitäts-Toren der Runde 59 (Kette `docs/perf/probes/2026-09-24-r59/gate/`), der Guard-Spec samt dynamischem Zensus über alle Generationen und dem grep nach Laufzeit-Handlern; T103 ist vorher erledigt.
- **D25** Parallele Spuren (seit Runde 62): Regeln im Abschnitt „Parallel arbeiten“. Score-berührende Messungen lesen die gepaarte Bank zusätzlich mit eigenem K je Phase, Doubles getrennt (Runde 62: ein reines Umskalieren je Phase bringt in Doubles schon −35 bp). Änderungen an Nachprüfung, Kill-Quoten und Bericht sieht die Bank kaum, weil der Score auf Baum-Zügen das Mittel der Besuche ist (`packages/eval-engine/src/mcts-merge.ts:272`); ihr Tor sind Dumps, Pins und Zählungen, und jede bewegte Bank-Zeile wird gelesen.

## E. Prozess: abhaken und überführen

Kurzfassung; vollständig in `docs/completed/README.md`.

1. Die Reihenfolge der Liste ist die Priorität: Die oberste Iteration ist die nächste Sitzung. Beim Start bekommt sie die nächste freie Rundennummer in ihre Überschrift, und ihre TODOs bekommen, falls sie sie noch nicht tragen, die Schritte aus dem Backlog-Plan als Unterpunkte. Schritte abhaken (Kästchen ankreuzen, Commit-Hash dazu), nicht löschen. Die Spec der Runde darf die Schritte ersetzen.
2. Am Rundenende (Teil des Abschluss-Tasks): den Block als Eintrag (Ziel / Geliefert / Gates / Lehren / Reste) an `docs/completed/<gebiet>.md` anhängen, eine Zeile in dessen Inhaltsliste, und den Abschnitt im Backlog-Plan streichen.
3. Reste einsortieren: Ein offener Rest wird ein neues TODO mit der nächsten freien T-Nummer in der passenden Iteration (samt Abschnitt im Backlog-Plan) oder eine Zeile in B; Signale → C, Regeln → D, dauerhafte Lehren → Memory-Notiz der Runde.
4. Die erledigte Iteration hier löschen und die Kopfzeile „Stand …, nach Runde N“ setzen. T-Nummern und Iterations-Nummern der übrigen bleiben stehen; Lücken in der Zählung sind gewollt.
5. Prüfen: `grep -c '\[x\]' NextSteps.md` ist 0; `grep -rc '\[ \]' docs/completed/ --exclude=README.md | grep -v ':0$'` ist leer.
