# Next Steps (Stand 09.10.2026, nach Runde 66)

Nur offene Schritte, als priorisierte Checkliste: Die oberste Welle ist die nächste Runde; ihre Spuren laufen parallel, je Spur zuerst das oberste offene Kästchen (Abschnitt „Parallel arbeiten“). Jedes TODO nennt das Problem an einer Spielszene und das Erfolgsmaß. Die Umsetzungsschritte jedes TODOs stehen als Checkliste im Backlog-Plan unter derselben Nummer; beim Start einer Welle schreibt ihre Spec die Schritte neu; unter „Runde 62 (neu gefasst)“ sind die alten Kästchen dort nur Hintergrund.

- **Iterationen** bündeln die TODOs einer Sitzung. Eine Iteration wird beim Start zur Runde mit der nächsten freien Rundennummer: Iteration 1 war Runde 46, Iteration 2 war Runde 47, Iteration 2a war Runde 48, Iteration 2b war Runde 49, Iteration 3 war Runde 50, Iteration 4 war Runde 51, Iteration 4a war Runde 52, Iteration 4d war Runde 53, Iteration 4b war Runde 54, Iteration 4e war Runde 55, Iteration 4c war Runde 56, Iteration 4f war Runde 57. Runde 58 war die Sichtung „Was bauen wir nach?“ außer der Reihe; seit ihrem Gate stehen die Iterationen S1 bis S3 des Programms „Mehr Simulation“ oben, vorgesehen als Runden 59 bis 62; Iteration S1 war Runde 59, Iteration S1a war Runde 60, Iteration S2 war Runde 61, Iteration S3 war Runde 62 (Triage). Seit Runde 62 heißen die Bündel Wellen: Eine Welle ist eine Runde, ihre Spuren laufen parallel mit je einem Sub-Agent; Welle 1 war Runde 63; ihr Gate (06.10.) zog die Reste als Welle 1.5 vor Welle 2. Welle 1.5 war Runde 64; ihr Gate (08.10., „1b“) zog T127 als eigene Runde 65 vor Welle 2. Runde 65 war T127 (der Doubles-Fit); ihr Gate (09.10., „2b“) zog T137 (mehr VGC-Spiele und eigene VGC-Gewichte) als Runde 66 vor Welle 2. Runde 66 war T137 mit den Funden T141 und T142; ihr Gate (09.10. 19:40, „1a 2a 3a 4b 5a“) stellt T145 und T143 in Welle 2, Spur F, und T144 in Welle 3, Spur B; die nächste Runde ist Welle 2. Score-berührende TODOs bekommen je ihre eigene Messung (D3), nie eine gemeinsame.
- **T-Nummern** (T01 bis T45) sind feste Namen, vergeben am 18.09. in Prioritäts-Reihenfolge. Wandert ein TODO in der Liste, behält es seine Nummer; ein neues TODO bekommt die nächste freie (ab T146; T46 kam am 18.09. in Runde 46 dazu, T47 bis T51 in Runde 47, T52 und T53 in Runde 48, T54 in Runde 49, T55 in Runde 50, T56 bis T64 in Runde 51, T65 am 19.09. nach deren Gate, T66 bis T68 am 20.09. in Runde 52, T69 am 20.09. in Runde 53, T70 bis T74 am 21.09. in Runde 54, T75 am 21.09. in Runde 55, T76 am 23.09. am Gate der Runde 56, T77 bis T80 am 23.09. in Runde 56, T81 am 23.09. am Gate der Runde 57, T82 am 23.09. in ihrer Spec, T83 bis T90 am 24.09. in Runde 57, T91 bis T102 am 24.09. am Gate der Runde 58, T103 am 01.10. in Runde 59, T104 am 02.10. in Runde 60 vergeben und dort erledigt, T105 bis T107 am 02.10. in Runde 60, T108 am 02.10. nach ihrem Gate, T109 bis T111 am 04.10. in Runde 61, T112 bis T116 am 05.10. in Runde 62, T117 am 05.10. aus den Experten-Urteilen zu T45, T118 bis T127 am 06.10. in Runde 63, T128 bis T136 am 08.10. in Runde 64, T137 bis T140 am 09.10. in Runde 65, T141 und T142 am 09.10. in Runde 66 vergeben und dort erledigt, T143 bis T145 am 09.10. in Runde 66). Seit Runde 62 sind 36 Nummern stillgelegt; sie stehen mit Beleg und altem Text in `docs/completed/triage.md`. „braucht T01“ heißt: T01 muss vorher gelaufen sein.
- **Backlog-Plan** (je TODO: Idee, Schritte mit Dateien, volles Gate, Doubles-Abdeckung, offene Entscheidungen, Zahlen, Code-Belege): `docs/superpowers/plans/2026-09-18-backlog-plans.md`.
- **Erledigtes**: `docs/completed/` nach Gebiet (Index, Eintragsformat und Prozess in `docs/completed/README.md`).
- **Maschinen-Quellen**: Ledger in `regression/eval-calibration.spec.ts`, Pins in `e2e-feedback/corpus.ts`, Memory-Notizen.
- Diese Datei liegt seit 06.09. im Repository; `docs/` bleibt gitignored.

Die Schritte stammen aus dem Entwurf vom 18.09. (Code-Stand dcf9526); Runde 62 hat jedes TODO gegen den Stand 5d428b2 neu gelesen, und Texte mit „Runde 62 neu gefasst“ im Backlog-Plan gehen den alten Schritten vor. Jede Runde bekommt vor dem Bau weiterhin ihr Brainstorming und ihre Spec; die Schritte hier sind deren Startpunkt, und die Spec darf sie ersetzen. Ältere Dokumente nennen Q6 und Q4 gemeinsam „Runde 46“; hier sind es T06 und T09 in den Iterationen 2 und 3.

Hinter jedem Titel stehen Thema, Art, Größe (mini, klein, mittel, groß), Gate (score-berührend = D3, verlustfrei = D4, sonst ausgeschrieben) und „braucht“ = muss vorher gelaufen sein. Seit Runde 62 trägt jedes TODO einen *Nutzen:*-Satz: was es der Engine (Bank, Pins, Feedback) oder der App (sichtbar, Tempo) bringt.

## Programm · Mehr Simulation (Runden 59 bis 62, abgeschlossen)

Das Programm ist mit Runde 62 abgeschlossen: Tempo-Schicht (Runde 59), Regelfehler am Simulator-Übergang (Runde 60), Baum ab dem ersten Zug (Runde 61) und die Triage aller übrigen TODOs (Runde 62, 36 geschlossen, 39 behalten, T112 bis T116 neu). Begründung und Ergebnisse stehen in `MoreSimulation.md`, im Programm-Plan `docs/superpowers/plans/2026-09-24-program-more-simulation.md` und in `docs/completed/eval-quality.md`. Gate der Runde 62 (05.10.2026, „1a / parallel / 3a“): `r59` geht per Fast-Forward in `v1` und `v1` wird gepusht, master bleibt auf 94c88d9.

## Parallel arbeiten: Wellen und Spuren

Gate der Runde 62 (05.10.2026): Die nächsten Schritte laufen mit mehreren Sub-Agents parallel. Die Liste ist deshalb in 3 Wellen geteilt; eine Welle ist eine Runde, jede Spur einer Welle ist die Arbeit eines Sub-Agents. Die Spuren einer Welle teilen keine Datei, Abhängigkeiten liegen zwischen den Wellen. Jede Spur nennt ihre Dateien und ihr Tor. Welle 1 war Runde 63 (06.10.); ihr Gate („7a“) stellte die neuen TODOs aus den Spuren und Reviews als Welle 1.5 vor Welle 2. Welle 1.5 war Runde 64 (06. bis 08.10.); ihr Gate stellt T127 als eigene Runde 65 vor Welle 2 („1b“: STAB bleibt, der Re-Fit misst sich an der Bank) und sortiert die neuen TODOs T128 bis T136 in die Spuren von Welle 2 („5a“, T129 und T130 jeweils zuerst; T129 und T133 bekommen die neue Spur G). Runde 65 (09.10.) lief T127 als eigene Runde; ihr Gate („1a / 2b / 3a / 4a“) übernimmt eigene Gewichte für Champions OU und Doubles OU, gibt VGC ein eigenes Regelwerk mit den Handgewichten, liest Doubles-Urteile auf Bank plus Prüfbank (D26) und stellt T137 als Runde 66 vor Welle 2; T138 geht in Spur F, T139 und T140 in Spur B. Runde 66 (09.10.) lief T137 als eigene Runde; ihr Gate („1a 2a 3a 4b 5a“) übernimmt T141 und T142 (jedes VGC-Format baut aus den Daten seines Spiels und Jahres) und die Champions-VGC-Gewichte, Scarlet/Violet-VGC behält die Handtabelle; T145 (Champions-Stat-Points im Nachbau) und T143 (Champions-OU-Sets) gehen in Spur F vor T52 und T138, T144 (Tailwind und Coverage in SV VGC) in Welle 3, Spur B.

| Welle | Spur | TODOs | Tor |
| --- | --- | --- | --- |
| 2 | A · Rechner-Eingaben | T83, T72, T76, T100, T84 | Zählung je TODO auf 0, Dumps (Quoten, Zeilen), jede bewegte Bank-Zeile gelesen. |
| 2 | B · Wahlen, Wurzelwert, Tiefer denken | T113, T128, T114, T109, T111, T134, T139, T140 | Zählung der Doubles-Antwortlisten (T128), MC-Orakel der Doubles-Nachprüfung (T134), Regelwerk je Weg mit rotem Test (T139), Prüfstände, Bank-Lauf mit dem Spielwert der Wurzel neben dem Score (das Bank-Feld baut der Integrator), Feedback 3×, UI-Tests und e2e für T109, Score-Frage von T114 am User-Gate. |
| 2 | C · Gegner-Inferenz, Sets und Spreads | T130, T108, T131, T132 | Zählung „Item vom Schaden widerlegt“ auf 0 (T130), Zählung Client gegen Inferenz gelesen, Set-Diff (D8), gebrochene Reihenfolgen bleiben 0, Bank gepaart (Doubles spät zuerst), Feedback 3×. |
| 2 | D · Bericht, zweiter Teil | T22, T59, T64, T135 | Engine-Zahlen unberührt, Dumps und Prosa-Pins, chance-Pins 573756 t73 und 649664 t23 stehen. |
| 2 | E · Panel und Knöpfe | T85, T69, T136 | UI-Tests und e2e, Set-Diff 0. |
| 2 | F · Doubles-K am Blatt und Champions-Treue | T145, T143, T52, T138 | Champions-Werte gegen die Server-Formel (T145), Teamlisten-Sonde für die Champions-Sets (T143), Champions-Prüfbänke (OU und VGC) mit Suche ohne gepoolten Schaden; Bank mit K der Bank und eigenem K je Phase, Doubles-Tier-Zählung; Champions-OU-Prüfbank mit Suche ohne Warnung (T138). |
| 2 | G · Reihenfolge und Nachbau | T129, T133 | derselbe Zustand in zwei Bank-Reihenfolgen liest dieselbe Rangliste (T129), Zählung Einwechsel-Effekt im Protokoll gegen Brett auf 0 (T133), Bank gepaart, Feedback 3×. |
| 3 | A · Fitter und Doubles-Schaden | T31, T26, T86 | Set-Diff, Fit-Fehler je Familie, Bank mit frischer Basis, Feedback 3×. |
| 3 | B · Statik-Gewichte | T42, T49, T102, T39, T144 | Bank mit beiden K-Lesungen, Fit-Korpus mit Kreuzprüfung, Feedback 3× mit Tier-Zählung; SV-VGC-Fit nach den Regeln der Runde 65 (T144). |
| 3 | C · Prozent-Anzeige | T51 | Anzeige-Kalibrierung, Re-Pins der Prosa am User-Gate, kein Urteil bewegt sich. |

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

## Welle 2 · Spur A · Rechner-Eingaben

Fünf kleine Fehler an derselben Stelle: Der Rechner bekommt Namen, Formen, Boosts, Gefallene und Tera-Körper nicht so, wie der Simulator sie kennt. Sichtbar an Quoten und Vorschau. Die Aufrufstelle in spreads/fit.ts (T72) folgt in Spur 3A.

*Dateien:* packages/eval-engine/src/ko-odds.ts, damage-calc.ts, pair/kill-table.ts, pair/snapshot.ts, pair/odds.ts, choice-lock.ts (nur der Rechner-Aufruf), Hidden-Power-Brücke, cell-blend.ts (Tera-Körper der Quoten), score/move-facts.ts (nur die Trefferzahl).

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

  ko-odds.ts und damage-calc.ts geben dem Rechner die Stufen des Simulators, in denen Einwechsel-Boosts schon stecken; der Rechner addiert Dauntless Shield, Intrepid Sword, Download und Embody Aspect selbst noch einmal, auch ohne genannte Fähigkeit. Szene gen9doublesou-2660802611 Zug 12: Ogerpon-Hearthflame-Tera mit Horn Leech gegen Ogerpon-Wellspring zeigt „100 % OHKO“, richtig ist „possible 2HKO“. Fix: beide Stellen über einen gemeinsamen Aufbau, der Boosts nur einmal zählt (Vorbild laut Inventur pair/kill-table.ts mit pair/snapshot.ts). Dazu aus Runde 64 (Spur F): Terapagos-Terastal mit scharfem Tera rechnet in der Vorschau mit den Terastal-Werten, der Simulator macht daraus Terapagos-Stellar (gen9vgc2026regi-2630110359 Zug 2, Tera Starstorm 184,7 bis 218,2 % statt 246,6 bis 290,9 %); und `score/move-facts.ts` (expectedHits) und `damage-calc.ts` (hitCounts) spiegeln dieselben Regeln zur Trefferzahl mit zwei Prüfern, ein gemeinsamer Helfer genügt.

  *Nutzen:* App: die Schadensvorschau zählt Einwechsel-Boosts einmal (heute falsche K.-o.-Aussagen bei Ogerpon-Tera und Zamazenta); Engine: die K.-o.-Quoten von Statik und Beweiser lesen dasselbe, Bank-Wirkung klein (74 Stellungen).

  *Erfolg:* die Sonde panel-boost.vt.ts zeigt auf den fünf Stellungen keinen Unterschied mehr zur Rechnung mit neutraler Fähigkeit; Bank gepoolt nicht schlechter. Die übrigen Zusammenlegungen entfallen. *Plan T100:* Backlog-Plan, Abschnitt T100 (Runde 62 neu gefasst).

- [ ] **T84 · Kill-Quoten der Tera-Optionen rechnen mit dem Tera-Körper** (Rechner-Treue, Mini-Runde, klein, score-berührend D3)

  gen9doublesou-2660818097 Zug 2: 'Horn Leech + Heat Wave mit Tera' gegen Zapdos zeigt 4 % statt 100 %, weil der Rechner den Körper vor dem Klick liest (ko-odds.ts:87; Zellenplan cell-blend.ts:142; pair/odds.ts). Auf der Bank ändern sich 152 von 380 Singles- und 90 von 243 Doubles-Tera-Zeilen mit Quote.

  *Nutzen:* App: richtige Kill-Quote auf rund 40 % der Tera-Zeilen mit Quote (Singles 152 von 380, Doubles 90 von 243); Engine: richtige Klassen-Gewichte der Tera-Zellen.

  *Erfolg:* die Zählung (groups/endspiel/census.vt.ts) meldet 0 geänderte Zeilen; Bank und Dumps bewegen sich nur in Stellungen mit Tera-Option, jede bewegte Zeile gelesen. *Plan T84:* Backlog-Plan, Abschnitt T84 (Runde 62 neu gefasst).

## Welle 2 · Spur B · Wahlen, Wurzelwert, Tiefer denken

Doubles-Züge ohne Urteil (Pollen Puff auf den Partner), eine Doubles-Matrix, die nur die gekürzte Antwortliste der Gegenseite prüft (T128), ein Wurzel-Score weit vom Spielwert in kleinen Endspielen (doubles-spread-2v1 liest 0,355 statt 1,0), dann die tiefere Stufe auf Baum-Zügen, die Restposten der Runde 61 und die Doubles-Nachprüfung (T134). Nach Spur 1C, weil T114, T109 und T111 dieselben Dateien des Baums ändern. T111 Punkt 1 (den Budget-Schalter schon in Node parsen) liegt im Feedback-Harness: die Spur liefert ihn als Patch, der Integrator übernimmt ihn.

*Dateien:* packages/eval-engine/src/forward/choices.ts, search/options.ts, search/verify-cell.ts, search/cell-sampler.ts, pair/sampler.ts, tree-orchestrator.ts, mcts-merge.ts, mcts.ts, endgame/prover.ts, src/lib/eval/worker-client.ts, src/hooks/useEvalView.ts, src/components/eval/ (ThinkDeeperButton.tsx, EvalControls.tsx), src/components/PlayOutBar.tsx, src/lib/play-out.ts, regression/endgame-truth.spec.ts, regression/decided-held-positions.spec.ts, EVALUATION.md, packages/eval-engine/README.md.

*Tor:* Prüfstände, Bank-Lauf mit dem Spielwert der Wurzel neben dem Score (das Bank-Feld baut der Integrator), Feedback 3×, UI-Tests und e2e für T109, Score-Frage von T114 am User-Gate.

- [ ] **T113 · Züge auf den Partner als Option** (Simulation und Suche, Mini-Runde, klein, score-berührend D3)

  Die Zählung der Runde 61 (78 von 238) lief ohne keepPlayed. Mit keepPlayed fehlt die gespielte Kombination nur an einer echten Stelle: bei Zügen auf den eigenen Partner. VGC 2630685175 Zug 7 heilt p2 den Partner mit Pollen Puff; die Engine kennt diese Wahl nicht, weil forward/choices.ts bei Ziel normal und any nur Gegner-Slots aufzählt (choices.ts:15, :65 bis :75). Der Zug bekommt kein Urteil, ebenso Bank 938276 Zug 10 p1. Partner-Ziele überall würden die rohe Kombinationszahl je Knoten um das 1,55-Fache vergrößern; darum zuerst nur die gespielte Wahl an der Wurzel.

  *Nutzen:* App: zwei Züge in Korpus und Bank bekommen ein Urteil; Heilen oder Instruct auf den Partner wird in VGC bewertbar.

  *Erfolg:* 2630685175 Zug 7 p2 und 938276 Zug 10 p1 finden ihre Option und tragen ein Urteil; das Ziel kommt aus dem Request des Simulators, keine eigene Liste; Doubles-Baumzeit unverändert; Singles byte-gleich. *Plan T113:* 3 Schritte im Backlog-Plan.

- [ ] **T128 · Doubles: die Matrix prüft jede Antwort der Gegenseite** (Simulation und Suche, Runde, mittel, score-berührend D3)

  VGC 2630685175 Zug 7 (Runde 64, Spur A): Die Suchmatrix führt für p2 nur die 12 Kombinationen, die die Hinweis-Kürzung behält (`searchOptions` mit `restrictCombined`), von 36 erlaubten; keine enthält Protect auf Zamazenta. Die Zeile Wood Hammer → Calyrex-Shadow + Earth Power → Zamazenta liest darum in jeder Spalte 1,00, und p1s gespieltes U-turn + Tera Starstorm bekommt einen Fehler mit Regret 1,233. Über alle 36 Antworten läge die Zeile bei 0,751 (jede der sechs Protect-Antworten 0,75) und der Regret bei rund 0,98 (Sonde `docs/perf/probes/2026-10-06-r64/lanes/A/column-cut.vt.ts`). Der Beweiser prüft seit T118 jede Antwort, die Matrix nicht. Weg: die Antwortliste der verteidigenden Seite an der Wurzel aus den erlaubten Wahlen des Simulators, oder mindestens jede Antwort, die sich gegen die beste Zeile schützt, gefunden über den Simulator und keine Handliste; Kosten im Zeitfenster. Läuft mit T113 (dieselbe Datei search/options.ts).

  *Nutzen:* App: Doubles-Noten hängen nicht mehr an einer gekürzten Antwortliste; der Fehler in 2630685175 Zug 7 bekommt seine richtige Größe.

  *Erfolg:* 2630685175 Zug 7 liest p1s Regret aus allen erlaubten Antworten; Zählung der Doubles-Wurzeln, deren beste Zeile eine nicht geführte Antwort widerlegt, vorher und nachher; Doubles-Baumzeit im Zeitfenster; Bank gepaart, Doubles getrennt; Feedback 3×; Singles byte-gleich. *Plan T128:* Backlog-Plan.

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

- [ ] **T134 · Doubles-Nachprüfung: sichtbare Streuung in der schwersten Klasse** (Zufall preisen, Runde, mittel, score-berührend D3)

  Seit Runde 64 (T119) teilt die Nachprüfung eine Klasse nach den Zuständen, die ihre Ziehungen hinterlassen. Doubles teilt nur nach den Zählern des Simulators (Schlaf, Verwirrung, Fesseln, Lock, Protect, Encore) aus einem Pool von 8 Ziehungen, um im Zeit-Tor zu bleiben (+5 %; nach jedem Zustand teilen kostete +15 bis +20 % und senkte den Fehler zur Referenz nur von 0,058 auf 0,053). Verbrennung, Stat-Senkung und KP-Streuung der schwersten Klasse laufen weiter über ein Kind: 35 von 218 Doubles-Zellen liegen außerhalb des MC-Bands, 912045 Zug 9 liest Rückfall-Zellen 0,41 gegen MC −0,63. Dazu: Die Kandidaten-Reihenfolge des Beweisers kippt an Fast-Gleichständen (653785 Zug 24: die Referenz gibt einen Blunder, weil der Beweiser auf der umgeordneten Wurzel einen Sieg beweist).

  *Nutzen:* App: weniger falsche Doubles-Noten bei Verbrennung und Stat-Senkung; ein Beweis, der nicht an der Reihenfolge fast gleicher Kandidaten hängt.

  *Erfolg:* MC-Orakel-Zählung Doubles besser als 35 von 218 Zellen außerhalb; Doubles-Baumzeit im Zeitfenster; 912045 Zug 9 im Band; 653785 Zug 24 ohne Beweis aus der Umordnung; Bank gepaart, Feedback 3×. *Plan T134:* Backlog-Plan.

- [ ] **T139 · Das Regelwerk an jeder Stelle** (Werkzeug, Mini-Runde, klein, verlustfrei D4)

  Seit Runde 65 rechnet jede Suche von App und Bank mit dem Regelwerk ihres Replays (standard, vgc, champions). Drei Wege lesen es noch nicht: Der Positions-Export der Bank (`exportPosition` in regression/eval-calibration.spec.ts, nur der Integrator) und der Endspiel-Prüfstand (regression/endgame-truth.spec.ts) rechnen Champions- und VGC-Stellungen mit der Standard-Tabelle, und die Aufrufer von `solveEndgame` reichen kein Regelwerk weiter. `MatchupCache.ruleset` ist optional; als Pflichtfeld fände der Compiler jeden vergessenen Weg (Review der Runde 65).

  *Nutzen:* Engine: kein Weg rechnet eine Champions- oder VGC-Stellung still mit fremden Gewichten.

  *Erfolg:* Jeder Weg trägt das Regelwerk, ein Test je Weg wird ohne seine Übergabe rot; Standard-Stellungen byte-gleich (Bank 0 bewegt, Feedback byte-gleich). *Plan T139:* Backlog-Plan.

- [ ] **T140 · Sleep Clause in der Nachrechnung des gespielten Zugs** (Simulation und Suche, Mini-Runde, mini, score-berührend D3)

  Die Nachrechnung des gespielten Paars (`playedOutcomeSettings` in src/lib/eval/worker-client.ts) reicht Tera, Modus und Regelwerk weiter, die Sleep Clause nicht. In Formaten mit Sleep Clause, etwa den Gen-6- und Gen-8-Spielen des Feedback-Korpus, rechnet sie den gespielten Zug so, als dürfte ein zweites Pokémon einschlafen, während die Suche um sie herum die Klausel kennt. Älter als Runde 65, gefunden in ihrem Review.

  *Nutzen:* App: Das Urteil über den gespielten Zug folgt in Sleep-Clause-Formaten denselben Regeln wie die Suche.

  *Erfolg:* roter Test zuerst (die Unter-Einstellungen tragen die Sleep Clause); Feedback 3× mit Tier-Zählung, jeder bewegte Zug gelesen; Bank gepaart. *Plan T140:* Backlog-Plan.

## Welle 2 · Spur C · Gegner-Inferenz, Sets und Spreads

Zuerst die Items, die das Log widerlegt (T130, trägt die größte Warnung des Wellen-Laufs der Runde 64), dann die Inferenz, die gegessene Items verliert (649664 Zug 8 empfiehlt Mega) und das Log mit eigenen Regex liest, wo @pkmn/client den Zustand schon führt, dann veröffentlichte Choice-Sets (T131) und die Reste des Tempo-Lösers (T132). Eine Spur, weil alle vier dieselben Dateien des Set-Baus lesen.

*Dateien:* packages/replay-core/src/inference/ (handlers.ts, item-evidence.ts), opponent-inferrer.ts, set-coherence.ts, team/set-resolvers.ts, team-builder.ts, spreads/ (fit.ts, ladder.ts, order-limit.ts, scarf.ts), spread-inference.ts.

*Tor:* Zählung „gespieltes Item vom Schaden widerlegt“ auf 0, Zählung Client gegen Inferenz gelesen, Set-Diff (D8), gebrochene Reihenfolgen bleiben 0, Bank gepaart (Doubles spät zuerst), Feedback 3×.

- [ ] **T130 · Items aus Schaden ausschließen, und Belege für verbrauchte Items** (Sets und Spreads, Runde, mittel, score-berührend D3; zuerst in Spur C)

  938644 Zug 14 (Runde 64, Spur D): Nach dem Leftovers-Ausschluss spielt p2s Gholdengo die zweite Option des veröffentlichten Item-Slots, Metal Coat. Das Log schließt Metal Coat aus: Tera-Fairy Dazzling Gleam nahm Moltres-Galar 66 %, Metal Coat schafft auf jedem Spread höchstens 47 bis 56 %, Choice Specs 64 bis 83 %. Die zwei Bank-Zeilen 938644 Zug 12 und 14 tragen rund 90 % der Warnung „Doubles spät +94 bp“ des Wellen-Laufs der Runde 64. Zweite Szene 912045 Zug 1 (das Log entscheidet dort nicht). Dazu aus Spur G: Ein geratenes Item, dessen Auslöser das Protokoll ohne seine Item-Zeile zeigt, ist ausgeschlossen (Basis-Zählung 562 Singles- und 56 Doubles-Zeilen der Bank; Szene 2658669868 Zug 24: Future Sight trifft Gholdengo, kein Air Balloon platzt). Und aus Spur D: Das Panel zeigt den Boots-Hinweis noch bei möglicher Magic Guard (`canGuessBoots` in opponent-inferrer.ts; der Bau prüft seit Runde 64 über den Simulator).

  *Nutzen:* Engine und App: Sets, die das Log nicht widerlegt; die größte Warnung des Wellen-Laufs fällt weg.

  *Erfolg:* 938644 spielt kein Item, das ein geloggter Treffer ausschließt; Zählung „gespieltes Item vom Schaden widerlegt“ auf Bank und Feedback auf 0; die Zählung verbrauchter geratener Items sinkt; Set-Diff; Bank gepaart, Doubles spät gelesen; Feedback 3×. *Plan T130:* Backlog-Plan.

- [ ] **T108 · Die Gegner-Inferenz liest, was die Bibliothek schon weiß** (Werkzeug, Runde, mittel, score-berührend D3)

  (1) recordConsumedItem schreibt einen Platzhalter statt des gegessenen Items (inference/handlers.ts:258): 649664 Tyranitar verliert die Chople Berry, bekommt Tyranitarite, und die App empfiehlt in Zug 8 'Mega + Crunch'. Ein-Zeilen-Fix mit rotem Test. (2) Die Inferenz liest das Log an 44 Stellen mit eigenen Regex; elf Handler halten fest, was @pkmn/client beim selben Log ohnehin führt (Form, Züge, Items, Fähigkeiten, Tera, Mega). Schritt 1 schickt jede Zeile durch Protocol.parseBattleLine, Schritt 2 liest die elf Fakten aus dem Zustand des Clients; eigene Beweise (Ausschlüsse aus Schaden und Immunität, widerlegte Choice-Locks) bleiben bei uns. Dazu die Taunt-Fälle aus T75 (752301 Zug 2 und 3, 751543 Zug 20), wo der Nachbau Züge aus cant-Zeilen liest.

  *Nutzen:* App: keine Mega-Empfehlung mehr für ein Pokémon, das sein Item schon gegessen hat (649664 Zug 8), dazu weniger falsch gelesene Gegner-Items.

  *Erfolg:* 649664 Zug 8 empfiehlt kein Mega mehr; die Inferenz liest Zeilen nur noch über @pkmn/protocol und die elf Fakten aus @pkmn/client; die Zählung Client gegen Inferenz ist gelesen; Bank und Dumps bewegen sich nur in Spielen, die die Zählung nennt. *Plan T108:* Backlog-Plan, Abschnitt T108 (Runde 62 neu gefasst).

- [ ] **T131 · Veröffentlichte Sets: kein Status-Zug fällt unter dem eigenen Choice-Item** (Sets und Spreads, Mini-Runde, klein, score-berührend D3)

  Runde 64, Spur D: Die Item-Zeilen der Veto-Regel streichen 146 Status-Züge aus veröffentlichten Sets, deren eigenes Item ein Choice-Item oder Assault Vest ist (Scan über 3756 veröffentlichte Sets). Ditto „Choice Scarf“ verliert Transform, Jirachi „Choice Scarf“ Healing Wish. Seit Runde 63 gilt das bewusst, weil das Item auch von anderswo kommen kann (ein gefolgerter Scarf); ist es das Item des gewählten Sets selbst, widerspricht es „Sets wie veröffentlicht“ (Gate der Runde 63).

  *Nutzen:* App: veröffentlichte Choice-Sets mit Trick, Transform oder Healing Wish erscheinen so, wie sie veröffentlicht sind.

  *Erfolg:* Scan über alle veröffentlichten Sets: 0 gestrichene Züge, wenn das Item aus dem Set selbst stammt; die Regel greift weiter, wenn das Item gefolgert ist; Set-Diff; Bank gepaart, Feedback 3×. *Plan T131:* Backlog-Plan.

- [ ] **T132 · Tempo-Löser: Reste der Runde 64** (Sets und Spreads, Runde, mittel, score-berührend D3)

  Aus Spur H: (1) Die Leiter gibt ein ungemessenes Tempo für einen Angriffs-Rang her, bei einem Fehlerunterschied von 0,00004 bis 0,00024: 562428 Victini Jolly 252 Spe → Hardy 8 Spe, 2663108091 Samurott-Hisui, 750540 Iron Boulder; 25 Bank-Sets, 23 davon schon auf 5360833. „Ungemessenes Tempo behält den Prior, wenn keine Reihenfolge es misst“ bewegt 41 Bank-Sets und 0 Feedback-Sets, bricht aber 7 Tests, die Entscheidungen der Runden 40, 41 und T117 festhalten (Frage ans Gate). (2) Ein veröffentlichtes Tempo-IV, dem eine gesehene Reihenfolge widerspricht: 2663093831 Sinistcha (veröffentlicht IV 0, kein Trick Room im Log, vor Incineroar in Zug 8); der Löser kauft Tempo-EVs (Quiet 252/0/0/0/136/120) statt das IV auf 31 zu setzen. Regel: Widerspricht eine gesehene Reihenfolge einem veröffentlichten Tempo-IV, gilt das IV nicht. (3) Ein- und zweistufige Kette unterscheiden sich in 22 Bank-Sets aus anderen Gründen als dem Auffüllen. (4) 655336 Latias behält Timid 0/0/4/0/0/252 ohne Fit.

  *Nutzen:* Engine und App: Spreads ohne geopfertes Tempo und ohne Sets, die niemand spielt.

  *Erfolg:* gebrochene Reihenfolgen bleiben 0; die 25 Sets behalten ihr Prior-Tempo oder tragen eine Messung; Sinistcha spielt IV 31 ohne Tempo-EVs; Set-Diff; Bank gepaart, Feedback 3×. *Plan T132:* Backlog-Plan.

## Welle 2 · Spur D · Bericht, zweiter Teil

Glück ohne Würfel, Lob auf einem verlorenen Zug, Reue gegen den echten Klick. Nach dem Hybrid aus Spur 1A (Glückskonten in Singles), nach Spur 1C (T64 liest 912045 Zug 8, den T16 ändert) und nach Spur 1E (dieselben Dateien).

*Dateien:* packages/eval-engine/src/turn-analysis/ (signals.ts eingeschlossen), summary.ts, report.ts, win-reason.ts, played.ts, prose/, denied-end.ts, dice-events.ts, src/components/EvalGameReport.tsx, src/components/EvalTurnAnalysis.tsx, src/components/eval-badges.ts, src/components/eval/ (SideRow.tsx, analysis-bits.tsx, EvalResultBlock.tsx), src/lib/analysis-context.ts.

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

- [ ] **T135 · Bericht: Reste der Runde 64** (Bericht, Mini-Runde, klein, verlustfrei D4)

  Aus Spur E: (1) Ein Opfer zählt nur den ersten sackförmigen K.o. einer Seite; ein zweiter K.o. im selben Zug wird seit Runde 64 genannt, nie beurteilt (912045 Zug 1, 2663093831 Zug 11, 2630685175 Zug 4, 653785 Zug 26; heute ändert keine Regel ein Korpus-Urteil, die Wahl braucht synthetische Szenen und eine Sack-Zählung auf der Bank). (2) Doubles-Paare in weiteren Satzvorlagen lesen noch als ein Wechsel („safer was switching to Ting-Lu + Scale Shot→Incineroar“, 2663093831 Zug 7; 11 Doubles-Züge); die Singles-Pins „switching to Heatran“ und „switching to Lopunny-Mega came instead“ müssen bleiben. (3) Gedankenstriche stehen in 204 von 329 Zug-Sätzen, 226 Karten-Sätzen und 7 von 10 Berichten (Rahmen in prose/clauses.ts, summary.ts, win-reason.ts); sieben Prosa-Pins liegen in solchen Sätzen, kein gepinntes Fragment enthält den Strich. (4) Bei Quote 1 sagt das verpasste frühe Ende „one sure KO … but the roll failed“ (kein Korpus-Fall).

  *Nutzen:* App: Bericht-Sätze, die in Doubles und bei Doppel-K.o. richtig lesen, ohne Gedankenstriche.

  *Erfolg:* je Punkt Szene und roter Test; Engine-Zahlen der Dumps byte-gleich; Prosa-Pins stehen. *Plan T135:* Backlog-Plan.

## Welle 2 · Spur E · Panel und Knöpfe

Zug-Knöpfe mit dem Typ beim Einsatz und ein Panel, das die Herkunft eines Spreads nennt. Nach Welle 1, weil Spur 1B den Zugkern und Spur 1D den Team-Bau ändert.

*Dateien:* src/lib/picker-state.ts, packages/eval-engine/src/branch/state.ts, packages/replay-core/src/team-info.ts, src/lib/provenance-labels.ts, src/components/branch/ChoiceButtons.tsx, src/lib/sets-io.ts.

*Tor:* UI-Tests und e2e, Set-Diff 0.

- [ ] **T85 · Zug-Knöpfe zeigen den Typ beim Einsatz** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  gen9ou-2658659909 Zug 37, der Knopf Ivy Cudgel von Ogerpon-Wellspring ist Grass, der Zug landet als Water; auf 11 Bank-Stellungen 9 falsche Knöpfe auf 6 Stellungen, Singles und Doubles (Sonde t85-type). Weg: auf den Pfaden live und stored den Simulator fragen (ModifyType-Handler wie in useMoveInner), nur der Pfad snapshot ohne Kampf nimmt moveAtUse oder den Katalog.

  *Nutzen:* App: Farbe und Beschriftung der Zug-Knöpfe stimmen; auf den geprüften Stellungen sind es 9 falsche Knöpfe auf 6 von 11, ohne dass eine Engine-Zahl sich bewegt.

  *Erfolg:* Die Sonde zeigt 0 Abweichungen, Tera Blast nach dem Klick eingeschlossen; keine Engine-Zahl bewegt sich. Läuft nach Spur 1B, weil die den Zugkern ändert. *Plan T85:* Backlog-Plan, Abschnitt T85 (Runde 62 neu gefasst).

- [ ] **T69 · Das Panel nennt die Herkunft eines Spreads** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  gen9ou-2658659909, alle 12 Körper tragen fitted; 6 kommen aus der Vorlösung zurück, nachdem die volle Lösung ihre Schadenszeilen verworfen hat, alle mit den EVs des Schätzwerts (Tyranitar Adamant 0/252/0/0/4/252), 4 weitere aus der vollen Lösung ebenfalls unverändert (Sonde t69-split).

  *Nutzen:* App: Das Etikett sagt, wer geprüft hat; in der Szene fallen 10 falsche fitted-Stempel von 12 weg, bei Set-Diff 0.

  *Erfolg:* Ein Eintrag mit EVs und Natur des Schätzwerts behält dessen Etikett, ein Eintrag aus Zugreihenfolge oder Übertrag sagt das, fitted steht nur an Spreads mit tragender Schadenszeile; Set-Diff 0 auf Bank und Feedback-Harness; Zählung über Bank und Feedback getrennt nach Singles und Doubles. Kommt T26 vorher, braucht es ein Etikett für aufgefüllte Spreads. *Plan T69:* Backlog-Plan, Abschnitt T69 (Runde 62 neu gefasst).

- [ ] **T136 · Vorschau und Panel: Reste der Runde 64** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  Aus Spur F und D: (1) Der Zug-Knopf zeigt bei Mehrfachtreffern nur die Spanne, nicht die Verteilung je Trefferzahl (Breloom Bullet Seed in Blissey 23 bis 67,9 % ohne 35/35/15/15). (2) Der schnelle Picker aus dem Snapshot trägt keinen Tera-Typ; die Tera-Knöpfe erscheinen erst, wenn die genaue Stellung ankommt. (3) Das Team-Panel und der Set-Export zeigen die gebauten IVs nicht (2663093831 Sinistcha spielt Tempo 0 und Angriff 0, das Panel zeigt 31; 364 Sets bauen IVs ungleich 31).

  *Nutzen:* App: Panel und Knöpfe zeigen, womit die Engine rechnet.

  *Erfolg:* je Punkt ein roter UI-Test; Bank und Feedback unberührt. *Plan T136:* Backlog-Plan.

## Welle 2 · Spur F · Doubles-K am Blatt und Champions-Treue

Zuerst die Champions-Treue (Gate der Runde 66, „4b“): Der Nachbau rechnet Champions-Werte wie Showdown (T145), und Champions OU liest seine eigene Set-Datei (T143). Danach das Doubles-K am Blatt, gelesen mit dem Bank-Instrument, das Skala von Gewinn trennt (Schritt 1 von T52 steht seit Runde 63), und zuletzt die Prozent-Skala für Champions (T138) auf den treuen Nachbauten.

*Dateien:* packages/eval-engine/src/winprob.ts (nur das K am Blatt), packages/eval-engine/src/search/leaf.ts; für T145 der Übergang der Sets in den Simulator und die Werte-Formel des Spread-Lösers (packages/replay-core/src/spreads/ und team-builder.ts sind Dateien der Spur C: Die Spec der Welle legt fest, welche Spur sie führt), für T143 src/lib/smogon-sets.ts und src/lib/smogon/format-fallback.ts.

*Tor:* Champions-Werte gegen die Server-Formel (T145), Teamlisten-Sonde (T143), Champions-Prüfbänke OU und VGC mit Suche ohne gepoolten Schaden; Bank mit K der Bank und eigenem K je Phase, Doubles-Tier-Zählung.

- [ ] **T145 · Champions-Stat-Points als Stat Points rechnen** (Rechner-Treue, Runde, mittel, score-berührend D3)

  Pokémon Champions ersetzt EVs durch Stat Points (0 bis 32 je Wert, 66 gesamt); Showdown rechnet Wert = Basis + SP + 20 und KP = Basis + SP + 75 (`data/mods/champions/scripts.ts`, `statModify`; 32 SP entsprechen etwa 252 EVs). `@pkmn/sim` (0.10.11, neueste Version) kennt keinen Champions-Modus, und der Nachbau gibt die Stat Points als EVs weiter, auch der Spread-Löser rechnet mit ihnen in der EV-Formel. Ein Adamant-Garchomp mit 32 SP Angriff hat auf Level 50 in Showdown 200 Angriff, im Nachbau 169; KP 215 gegen 187; ein Champions-Pokémon mit vollem Tempo ist für den Löser 4 statt 32 Punkte schneller. Jede Schadensrechnung, jede K.-o.-Quote und jede Tempo-Reihenfolge der Champions-Nachbauten (OU und VGC) steht auf zu schwachen Pokémon. Gefunden in Runde 66 bei der Sichtung der frühen Warnung von T141.

  *Nutzen:* App: Champions-Spieler (OU und VGC, die größte VGC-Zielgruppe) bekommen Schaden, Quoten und Tempo wie im Spiel. Engine: Die Champions-Fits der Runden 65 und 66 stehen danach auf treuen Nachbauten.

  *Erfolg:* Der Nachbau rechnet Champions-Werte wie Showdown (Umrechnung am Übergang zum Simulator, SP → EV mit 8·SP − 4 ab SP 1, oder der Champions-Modus des Servers über `@pkmn/sim`, Upstream nur nach Okay), der Spread-Löser ebenso; ein Prüfer-Test vergleicht die Werte gegen die Server-Formel; Prüfbank Champions OU und Champions VGC mit Suche ohne gepoolten Schaden; danach die Champions-Fits (OU, VGC) neu. Keine Spiellogik von Hand: Die Formel kommt aus dem Server-Modus, der Test hält sie gegen ihn. *Plan T145:* Backlog-Plan.

- [ ] **T143 · Champions OU baut aus seiner eigenen Set-Datei** (Sets und Spreads, Mini-Runde, klein, score-berührend D3)

  Champions OU fragt seine Sets als `sets/gen9championsou.json` an. Die Datei gibt es nicht (404), also fällt es auf die SV-Ubers-Analysen zurück; `@pkmn/smogon` führt Champions-Dateien ohne Generation (`sets/championsou.json`, 50 Arten, Champions-Skala). Szene: Corviknight (39 % Nutzung) bekommt Impish 252/160/96 mit Tera statt des Champions-Sets mit 32/32/2. Der Champions-OU-Fit der Runde 65 stand auf diesem Bau. Gefunden im Review der Runde 66; Champions VGC liest seine Datei seit T142.

  *Nutzen:* App: Champions-OU-Spieler bekommen Sets aus ihrem Spiel. Engine: Champions-OU-Stellungen bauen treu, und der Fit der Runde 65 bekommt seine Nachprüfung.

  *Erfolg:* Champions OU liest `championsou` ohne SV-Ubers-Rückfall; Prüfbank Champions OU mit Suche ohne gepoolten Schaden; danach den Champions-OU-Fit auf dem neuen Bau gegenprüfen (Kreuzprüfung, Prüfbank). *Plan T143:* Backlog-Plan.

- [ ] **T52 · Doubles-K am Blatt, gelesen gegen die Skala** (Re-Fit, Mini-Runde, klein, score-berührend D3)

  Doubles-K am Blatt als billiger Kandidat (1,987 + 3,666 × Anteil gefallener Pokémon). Schritt 1 ist seit Runde 63 erledigt (888cd12): scripts/paired-calibration.mjs druckt neben der Tabelle mit dem K der Bank eine mit eigenem K je Phase (D25), weil ein reines Umskalieren je Phase in Doubles schon −35 bp bringt. Offen ist der Kandidat, zweifach gelesen, dazu die Doubles-Tier-Zählung.

  *Nutzen:* Engine: ein billiger Doubles-Hebel am Blatt (bis −20 bp je Stellung, unaufgelöst) und ein Bank-Instrument, das Skala von Gewinn trennt.

  *Erfolg:* Doubles-Zeile mit eigenem K je Phase aufgelöst besser, kein gepoolter Schaden; Doubles-Noten bewegen sich nur mit Lesung. Der Singles-Teil (gedeckeltes K) entfällt. *Plan T52:* Backlog-Plan, Abschnitt T52 (Runde 62 neu gefasst).

- [ ] **T138 · Prozent-Skala für Champions** (Re-Fit, Mini-Runde, klein, score-berührend D3, braucht T52, T145 und T143)

  Champions OU rechnet seit Runde 65 mit eigenen Gewichten, aber mit der Prozent-Skala von Scarlet/Violet (K am Blatt in Singles 2,28 + 1,49 × Anteil gefallener Pokémon). Auf den 149 Champions-OU-Spielen der Prüfbank wollen beide Tabellen ein ganz anderes K: früh 0,44 (Handtabelle) und 0,85 (neue Tabelle), spät 3,73 und 4,55. Früh zeigt die App also weit sicherere Prozente, als die Spiele hergeben; spät sind die der neuen Tabelle zu vorsichtig (spät +87 bp mit festem K, eine Warnung; mit eigenem K nur +24). Wie bei T52 hängen die Schwellen in wp-Einheiten an K. Champions VGC zeigt seit Runde 66 mit seinem Fit statisch dasselbe Muster auf der Prüfbank (früh −59 bp, spät +35 bp mit festem K); mit Suche ist es früh −45 bp aufgelöst besser und spät neutral.

  *Nutzen:* App: Die Prozente in Champions-Replays treffen früh und spät besser. Engine: Die Champions-Tabellen werden nicht mehr an einer fremden Skala gemessen.

  *Erfolg:* Champions-OU-Prüfbank mit Suche ohne Warnung in beiden Tabellen und besser als heute (−23 bp mit festem K); Tier-Urteile bewegen sich nur mit Lesung; Champions VGC mit derselben Methode geprüft. *Plan T138:* Backlog-Plan.

## Welle 2 · Spur G · Reihenfolge und Nachbau

Ein Urteil darf nicht davon abhängen, in welcher Reihenfolge der Nachbau die Bank führt (T129, zuerst), und ein korrigiert eingewechseltes Pokémon soll die Effekte spielen, die das Protokoll zeigt (T133). Neue Spur seit dem Gate der Runde 64 („5a“).

*Dateien:* die Spec der Welle legt sie nach der Diagnose von T129 fest; T133 liest packages/eval-engine/src/branch/ (corrections.ts, held-items.ts, protocol-choices.ts, execute.ts). branch/state.ts gehört Spur E, search/options.ts Spur B.

*Tor:* derselbe Zustand in zwei Bank-Reihenfolgen liest dieselbe Rangliste, Singles und Doubles; Zählung Einwechsel-Effekt im Protokoll gegen Brett auf 0; Bank gepaart, Feedback 3×.

- [ ] **T129 · Such-Urteile hängen von der Reihenfolge der Bank im Team ab** (Simulation und Suche, Runde, mittel, score-berührend D3; zuerst in Spur G)

  649664 Zug 14 (Runde 64, Spur G): Zwei Bretter mit gleichen KP, Status, Items, Boosts, Volatiles und Feld unterscheiden sich nur in der Reihenfolge der Bank-Pokémon in der Teamliste des Simulators. Die Suche liest den Wechsel zu Ferrothorn einmal mit +0,195 (bester Zug), einmal mit −0,288 (Blunder, Regret 0,415). Ebenso 649664 Zug 15 und 648453 Zug 27 (kleine Bewegungen). Weg: die Ursache in der Suche finden (Options-Reihenfolge, Hash, Tie-Break, Zufallsstrom je Slot), dann die Suche gegen die Reihenfolge unempfindlich machen; Prüfer-Test, der dasselbe Brett in zwei Reihenfolgen rechnet.

  *Nutzen:* Engine und App: dasselbe Spiel bekommt dieselben Urteile, unabhängig davon, wie der Nachbau das Team ordnet; ein Blunder wie in 649664 Zug 14 entsteht nicht aus der Reihenfolge.

  *Erfolg:* derselbe Zustand in zwei Bank-Reihenfolgen liest dieselbe Rangliste in Singles und Doubles; Zählung über Bank und Dumps, wie oft ein Urteil mit der Reihenfolge wechselt, vorher und nachher; Bank gepaart, Feedback 3×. *Plan T129:* Backlog-Plan.

- [ ] **T133 · Nachbau: Einwechsel-Effekte eines korrigiert eingewechselten Pokémon** (Nachbau, Mini-Runde, klein, score-berührend D3)

  Runde 64, Spur G: Bringt die Grenz-Korrektur ein Pokémon aufs Feld, das der Simulator nicht selbst eingewechselt hat, spielt es seine Einwechsel-Effekte nie: 749828 Zug 17, Roaring Moon ohne Item wie im Spiel, aber ohne den Protosynthesis-Tempo-Boost, den das Protokoll zeigt (eine der späten Zeilen der Warnung +6 bp der Spur G). Dazu: Ein Wechsel per Emergency Exit oder Wimp Out, bevor der Träger handelt, gilt noch als Wahl zu Zugbeginn (Szene aus dem Simulator: Drum Beating trifft Golisopod, Emergency Exit, Wechsel zu Corviknight; 0 solche Zeilen in Bank und Feedback).

  *Nutzen:* Engine: Bretter mit den Effekten, die das Protokoll zeigt.

  *Erfolg:* Zählung „Einwechsel-Effekt im Protokoll, nicht auf dem Brett“ auf Bank und Feedback auf 0; die Emergency-Exit-Szene aus dem Simulator liest den Wechsel als erzwungen; Bank gepaart, Feedback 3×. *Plan T133:* Backlog-Plan.

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

Hinweis-Terme und Feld-Paar für Doubles früh, dann der Re-Fit der Statik (Modellform, Status-Faktor, Boost-Gewicht) und zuletzt die Q5-Sichtung. Eine Spur, weil alle vier dieselben Gewichte fitten; nach Spur 1B, weil der Fit auf dem neuen Zugkern laufen muss, und mit dem Werkzeug der Runde 65 (Korpus im Bau der App, Fit je Familie, Prüfbank aus dem Korpus, Regeln vorab).

*Dateien:* packages/eval-engine/src/score/ (weights.ts, features.ts, matchup.ts), eval-function.ts, search/hints.ts, search/options.ts, Fit-Werkzeug.

*Tor:* Bank mit beiden K-Lesungen, Fit-Korpus mit Kreuzprüfung, Feedback 3× mit Tier-Zählung.

- [ ] **T42 · Q7 · Doubles-Hinweise und Feld-Paar** (Q-Runden, Runde, mittel, score-berührend D3, braucht T81)

  Erst die Hinweise: An jedem Doubles-Knoten bleiben 16 Kombinationen (search/hints.ts, search/options.ts:23); die gespielte Kombination bleibt ohne keepPlayed nur in 80 von 241 Listen. Szene 912045 Zug 1: mit der Fake-Out-Linie steigt p2s Bedauern über die Fehler-Schwelle und der Score geht zum Sieger. Dann der Feld-Paar-Term (score/weights.ts:177) mit Fit-Plan. Läuft nach T81, weil T81 dieselben Hinweise ändert; 912045 Zug 1 erst danach neu lesen. Erster Schritt: Messung der Hinweis-Terme bei gleicher Kappe (nicht Kappe 32, die halbiert die Besuche).

  *Nutzen:* Engine: Doubles früh ist die schwächste Zeile der Bank (Brier wie ein Münzwurf); ein Treffer dort ist der größte offene Doubles-Hebel nach T81.

  *Erfolg:* Doubles früh gepaart aufgelöst besser, mit eigenem K je Phase gelesen; Doubles-Baumzeit im Rahmen; Singles byte-gleich. *Plan T42:* Backlog-Plan, Abschnitt T42 (Runde 62 neu gefasst).

- [ ] **T49 · Boost-Gewicht, das weiß, ob der Boost beißt** (Re-Fit, Runde, mittel, score-berührend D3, braucht T81)

  573756 Zug 20: LordEnz' Toxapex klickt Knock Off in die verbrannte Clefable, ein PP-Krieg. Mit dem gefitteten Boost-Gewicht 39 (heute 12) nennt die Engine das einen Fehler („safer was switching to Landorus-Therian“) und wiederholt das Urteil über vierzig Züge: 573756 geht von 14 Ungenauigkeiten und 0 Fehlern auf 40 und 7, die fünf anderen Korpus-Spiele bleiben ruhig. Die Bank mag das Gewicht (hq Singles −4/−27/−5 bp, Singles Mitte voll −43 bp mit Band [−74, −12], im Fit-Korpus außerhalb der Stichprobe bestätigt). Ein stehender Boost ist im Schnitt viel wert, aber die statische Bewertung fragt nicht, ob er gegen die Wand gegenüber etwas bringt (Unaware, Haze, Phazer, ein Wall, der den geboosteten Treffer trotzdem hält). Runde 64: Der freie Fit auf dem Fit-Korpus mit STAB nach den Regeln wählt 40 [32, 49] in Singles und 30 [22, 39] in Doubles.

  *Nutzen:* Bank Singles hochgerechnet etwa −18 bp der Singles-Zeilen (Mitte und spät), wenn die Dämpfung die Urteile hält.

  *Erfolg:* Mit dem gedämpften, neu gefitteten Gewicht liest die Bank die Singles-Zeile aufgelöst besser (Sonde mit reinem 39 auf 5d428b2: etwa −18 bp der Singles-Zeilen, Mitte und spät), und die Tier-Zählung der sechs Singles-Dumps bleibt bei höchstens 29 Ungenauigkeiten und 4 Fehlern (Stand 22 und 3). *Plan T49:* 7 Schritte, 3 offene Entscheidungen.

- [ ] **T102 · Die Modellform der Statik** (Re-Fit, Runde, mittel, score-berührend D3, braucht T81)

  Die Modellform der Statik mit Re-Fit: Phasen-Terme, Status-Faktor (Poison Heal, Guts, Quick Feet, Marvel Scale werden heute bestraft; Korrektur ohne Re-Fit schadet, Singles-Bewegung 0,085), Boost-Gewicht (T49). Braucht T81 (neuer Zugkern), nicht T52. Fittet nach T127 die breitere Modellform noch einmal (Gate der Runde 63: „kann auch nochmal in 3 kommen“), mit dem Werkzeug der Runde 65: Der Korpus-Fit der Runde 64 gewann dort in allen 20 Seeds und kostete die Bank in Doubles +116 bp, weil er auf nackt gebauten Teams lernte und die Bank-Doubles bei Screens eine Ausnahme-Stichprobe sind; seit Runde 65 lernt der Fit auf dem Korpus im Bau der App, je Familie (Regelwerk und Spielart), und misst sich auf der Prüfbank. Dazu aus Runde 64: das Sweep-Gate prüft nur Pokémon mit positiver Angriffs- oder Spezial-Angriffs-Stufe, nie solche, deren Stufen nur Body Press füttern (62 Bank-Stellungen, 24 Singles und 38 Doubles; Szenen gen9ou-2658663604 Zug 20 Zamazenta mit +2 Def, gen9doublesou-2660813469 Zug 6 Diancie mit +6 Def); und sechs Setup-Züge, deren Stufen ein Handler setzt, fehlen im Setup-Hinweis (Belly Drum, Curse, Stockpile, Take Heart, Tidy Up, Acupressure; keine Doubles-Bank-Stellung trägt einen).

  *Nutzen:* Engine: die Decke der Statik liegt bei +16 bp (mit Modellform +32), und seit Runde 61 ist die Statik Blattwert jedes Baums; der Re-Fit ist der Weg dorthin.

  *Erfolg:* Fit-Korpus-Gewinn wie Runde 58 (+16,8 bp) bestätigt auf der Bank, gelesen mit eigenem K je Phase; Singles und Doubles getrennt. *Plan T102:* Backlog-Plan, Abschnitt T102 (Runde 62 neu gefasst).

- [ ] **T39 · Q5 · Redundanz und Optionswert, Sichtung zuerst** (Q-Runden, Runde, groß, score-berührend D3, braucht T81)

  Früh im Spiel liegt die Engine bei vielen Singles-Stellungen falsch und ist sich dabei sicher: Bei 82 von 193 frühen Singles-Stellungen der Bank liegen beide Zweige falsch. Muster: ein Material-Vorsprung, während die Seite nur noch eine einzige Antwort auf den gegnerischen Sweeper hat. 655336 Zug 23: Die Engine wählt den schnellen Kill und gibt die HP-Marge des letzten Mons auf. Ein Feature zählt, wie viele Antworten eine Seite je Bedrohung übrig hat. Vorher zehn Fehlstellungen von Hand sichten; sagen weniger als sechs „ja, fehlende Antwort“, endet die Runde dort.

  *Nutzen:* Bei Erfolg besserer früher Singles-Brier auf 193 Bank-Zeilen mit heute 50 % Vorzeichen; Erwartung klein (acht Boost-Anläufe verloren), die Sichtung von zehn Stellungen entscheidet für rund eine Stunde.

  *Erfolg:* Erst Held-out-Gewinn in der CV (mindestens 16 von 20 Seeds), dann früher Brier (Stand 0,2562) und frühe Sign-Accuracy (54 %) besser bei unveränderter später Zeile. *Plan T39:* 9 Schritte, 3 offene Entscheidungen.

- [ ] **T144 · Tailwind und Coverage in SV VGC prüfen, dann SV VGC neu fitten** (Re-Fit, Runde, mittel, score-berührend D3)

  SV VGC rechnet weiter mit der Hand-Doubles-Tabelle vom August (Gate der Runde 66, „3a“). Der Fit der Runde 66 (711 Sets aus gewerteten Ladder-Spielen, App-Bau nach T142) gewann im ersten Durchgang 18 von 20 Seeds (Log-Loss −44 bp), mit Tailwind bei 3 [−32, 35] statt 68 und Coverage bei −27 [−72, 20] statt 40; R2 hielt beide auf den Handwerten, und der zweite Durchgang fiel auf 14 von 20. Statisch auf der Prüfbank las keiner der Durchgänge besser (+12 und +26 bp Brier). Champions VGC fittet Tailwind ebenfalls niedrig (17 [−14, 47]).

  *Nutzen:* App: SV-VGC-Spieler bekommen eigene Gewichte. Engine: ein Tailwind-Merkmal, das in VGC misst, was es soll.

  *Erfolg:* eine Erklärung für Tailwind um 0 und Coverage unter 0 in VGC (doppelt mit Matchup? beide Seiten mit Tailwind? das Merkmal selbst?), danach ein SV-VGC-Fit, der die Regeln der Runde 65 besteht, oder ein begründetes Nein. *Plan T144:* Backlog-Plan.

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
| Simulation und Suche | T109, T113, T114, T128, T129, T140 |
| Zufall preisen | T134 |
| Sets und Spreads | T26, T31, T86, T130, T131, T132, T143 |
| Werkzeug | T43, T103, T108, T111, T139 |
| Bericht | T22, T51, T59, T64, T135 |
| Oberfläche | T69, T85, T136 |
| Nachbau | T133 |
| Rechner-Treue | T72, T76, T83, T84, T100, T145 |
| Re-Fit | T49, T52, T102, T138, T144 |
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
| 649664 t23 | observed steht seit Runde 42 auf chance. Die Bar liest 0,79 statt 0,92, weil der Beweis den nächsten 80-%-Hydro-Pump offen lässt, keinen Crit (Runde 62). Seit Runde 63 nennt die Karte Zug 24 den offenen 80-%-Hydro-Pump (T19) und sagt in Zug 23, dass das Urteil am Item von Keldeo hängt (Choice Scarf: fine, Mystic Water: blunder). Seit Runde 64 (T121 Punkt 1) bekommt der geratene Choice-Item von Keldeo die Schadens-Prüfung, die ihn widerlegt; der Gap blieb im Wellen-Lauf offen, gelesen hat ihn noch niemand. | Re-Pin-Frage am Gate |
| Draft-Spiel t48, 573756 t70 | Chance-Buchung ohne Würfel: Der Read-Payoff verpufft (t48), die Setup-Auszahlung kommt eine Bewertung zu spät (t70, liest heute quiet mit −0,145). | T22 |
| GPL DzBQ5azlO5l t13 | Heavy Slam liest ohne Fehler-Band. Stone Edge fehlt im Set (gen9ou 0,35 %, eine Grenze der Rekonstruktion); mit von Hand nachgetragenem Stone Edge liest die Zelle Air Slash gegen Stone Edge seit Runde 64 (T119) −0,336 gegen die MC-Referenz −0,328 ± 0,033; Stone Edge steht für p2 vorn, Heavy Slam hat Regret rund 0,007, eine Note gibt es nicht. Der Gap hängt damit am fehlenden Stone Edge im Set (Grenze der Rekonstruktion), nicht an der Nachprüfung. t15 liest in Auto richtig (Vileplume-Reue 0 bis 0,018 in drei Seed-Sätzen, Runde 62) und ist erledigt. Fixture `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | Gate-Frage (Rekonstruktion) |
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
- [ ] Ein neuer Live-Zugriff in `pairThreat` oder `singleMoveFraction` braucht seinen Schlüssel-Term in `pairKey` (Runde 49: HP, Typen und Basiswerte fehlten, Doubles-Zellen wichen von Lauf zu Lauf ab) → bei jeder Änderung an `score/threat.ts` den Test `threat-memo.spec.ts` um den neuen Zugriff erweitern (seit Runde 64, T125, führt der Schlüssel auch die Werte, die ein Zug außerhalb seiner Achse liest: Body Press, Foul Play). Seit Runde 54 trägt der Schlüssel den Tera-Typ neben den rohen Typen, für Angreifer und Verteidiger (be95961); ein Blatt, das die lebenden Typen liest, ist damit gedeckt, der Fall steht in `threat-memo.spec.ts`.
- [ ] Das Gegnermodell liest eine Doubles-Paar-Zeile nur am ersten Slot (`isSwitchChoice` in `opponent-model.ts`); in Doubles wird es deshalb selten sicher (Favorit ab 0,6 auf 10 von 496 Seiten) → handeln, wenn der Read in Doubles gebraucht wird (T42).
- [ ] 573756 Zug 134 bis 136: Die Decided-Erkennung nennt seit Zug 92 die richtige Seite, der Balken steht bei 0,33 bis 0,60, weil die Suche den Struggle-Plan über zwölf Plies nicht ausrechnet. Seit Runde 50 schweigt der Satz dort bis Zug 137 → mit T109 messen (2400 Durchläufe; T33 ist in Runde 62 geschlossen): Steht der Balken ab Zug 134 bei 0,7, spricht der Satz von selbst früher.
- [ ] 2663093831 Zug 10: p2s Ungenauigkeit verschwindet mit T81 (Runde 63, Spur B), obwohl ihr Regret von 0,152 auf 0,276 steigt; die Ursache ist ungelesen → lesen, wenn T127 die Statik-Gewichte neu fittet.
- [ ] Gen-2-Logs zeigen Leftovers-Träger unter vollen KP ohne Heilung (684843 Zug 34; 72 Züge in 30 Gen-2-Spielen; Runde 63, Spur D) → handeln, bevor ein Gen-2-Spiel in eine Messung kommt, deren Urteil an einem Leftovers-Ausschluss hängt.
- [ ] Doubles mit verdecktem Slot: Die gespielte Kombination wird vor der Nachprüfung gewählt, die Note kann auf einer anderen Kombination landen (`tree-orchestrator.ts:104`, Review der Runde 63) → handeln, wenn eine Doubles-Note an einem teilweise gesehenen Zug falsch liegt; T134 liest mit.
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

- [ ] Ein Play-out verheizt eine Win-Condition in falscher Reihenfolge (Draft t56 bis t62). Seit Runde 64 (Gate 08.10., „2a“) prüft der e2e-Pin die Absicht statt der Reihenfolge: p2 gewinnt das Play-out bis Zug 70 (Welle 1.5: Heatran in Zug 61, Sieg in Zug 66; die alte Reihenfolge Muk vor Heatran hielt nur über Gleichstände von 0,001 bis 0,005, die die Monte-Carlo-Referenz andersherum entscheidet) → bei einem weiteren Fall Q5 (T39) vorziehen.
- [ ] Früher Brier: Runde 40 kostete früh 28 bp hq (0,2569 → 0,2597), spät gewann sie 84 bp; Verdacht: exakte HP-Körper geben früh zu extreme Balken → bei jeder Fitter-Runde die frühe hq-Spalte vorregistrieren; handeln, wenn zwei Runden hintereinander früh verlieren.
- [ ] hq-Tranche: n=560 (r61-t98b; smogtours plus Ladder ab Rating 1700) → Tranche neu schneiden, wenn n unter 500 fällt oder eine neue Tranche das Verhältnis kippt.
- [ ] Premature-End-Rest: heute nur 2663093831 Zug 14 (1 von 320 Blöcken der Dumps; 648453 hat keinen Rest mehr) → Backstop nur, falls die Rate mit dem Korpus wächst.

- [ ] Bewegte MCTS-Züge, deren Urteil nicht am umgepreisten Zug hängt (Runde 57, 648453): Neue Hinweise an der Wurzel (Hidden Power Ice in Zug 23: 0,21 → 0,85) ordnen die Baum-Expansion um, ziehen den einen Zufallsausgang jeder Wurzelzelle neu (Chance-Knoten aus) und ändern, welche Zellen die Nachprüfung neu preist (Zug 24 und 33; Zug 31 eine neu gezogene 70-%-Zelle). Fast jede Zelle eines MCTS-Zugs bewegt sich (Zug 23: 26 von 28 Zellen), obwohl kein Urteil am Wurzelpreis von Hidden Power Ice hängt → handeln, wenn ein Pin nur an so einer Verschiebung hängt; Hebel: Baum-Varianz messen (mehr Bäume oder Iterationen), bevor ein Urteil gelesen wird.
- [ ] Golden 655336 driftet seit Runde 64 in neun Kanälen (Gate 06.10.: der Trick in Zug 5 ist kein unbedingter Fehler, Fehlzug 5:p2 ist aus der Golden): fehlende Schlüsselmomente Zug 5, 6 und 26, zusätzliche Schlüsselmomente Zug 18, 22 und 27 (Zug 27 liest seit T119 shift statt p1-read), fehlender Fehlzug 26:p2, zusätzlicher Fehlzug 22:p1, kein Wendepunkt statt 4. Zug 13 ist mit T16 geheilt, der Read 27:p1 mit T119 → beim nächsten Golden-Refresh am User-Gate gesammelt lesen; T127 misst zuerst an der Golden (D7).
- [ ] Warnung der Runde 64 auf der Bank (Wellen-Lauf gegen r64-base-1008): Doubles spät +94 bp [+4, +264] mit festem K, +130 mit eigenem K; rund 90 % davon tragen 938644 Zug 12 und 14 (Gholdengo mit Metal Coat aus dem veröffentlichten Item-Slot, vom Log ausgeschlossen), der Rest die protokoll-richtigen Bretter der Spur G (938276 Zug 10, 941638 Zug 10) → T130 misst zuerst daran.
- [ ] 20 falsche Treffer außerhalb aller Familien (Schiedsrichter der Runde 57, Zeile „ohne Familie“: Air Balloon, Psychic Terrain, Armor Tail gegen Priorität) → handeln, wenn einer davon ein Urteil trägt; Hebel: Familien im Schiedsrichter anlegen und zählen.
- [ ] Der Pin 653785 Zug 19 ist seit Runde 63 truth (Hazard-Sack-Satz, kein Tier, played → Weavile) und hängt an wackeligen Zahlen: Weavile liegt 0,004 hinter der besten Zeile (Stand 06.10.), der Satz am Payoff der Folgezüge, und der Gewinn lehnt sich an Tornadus-T als Antwort auf Dragonite. Das Spiel widerlegt das in Zug 24: Die vierfach effektive Hidden Power löst Dragonites Weakness Policy aus, die die Engine nicht kennt → handeln, wenn der Pin kippt oder ein Weakness-Policy-Term gebaut wird; Hebel: Pins auf gameValue statt Score lesen, Weakness Policy in der Statik.

- [ ] Auf einer Bo3-Ladder trägt nur das entscheidende Spiel eines Sets die Wertung (M-C-Bo3: 16 von 51 Spielen gewertet; Review der Runde 66). Die Fit-Regel gegen ungewertete Ladder-Spiele (`withoutUnratedLadder`) würde Spiel 1 und 2 eines gewerteten Bo3-Sets verwerfen, und `--sort rating` fände dort nur die entscheidenden Spiele → vor einer Bo3-Ladder-Erweiterung die Wertung auf das Set ziehen. Heute steht kein gewertetes Bo3-Ladder-Spiel im Korpus.
- [ ] Champions VGC füllt Arten, die seiner Nutzungsdatei fehlen, aus SV-Dateien (Doubles OU, OU, Ubers) statt aus `gen9championsou`, und die Champions-Fähigkeit „Aura Guard“ kennt `@pkmn/sim` nicht (Runde 66) → handeln, wenn eine Art im Korpus daran falsch baut oder ein Spiel die Fähigkeit zeigt (Upstream nur nach Okay).
- [ ] T142 in 2026 Reg F: Ohne Set-Datei des Jahres rät die Nutzungsdatei 2026 Züge schlechter als die Doubles-OU-Sets (77,1 → 72,8 %, Items 59,8 → 62,5 %, 120 Bo3-Spiele mit Teamliste); 2024 hat keine Teamlisten, und die Prüfbank liest 2024 Reg H +124 bp [−26, +284] ungelöst → handeln, wenn data.pkmn.cc eine Set-Datei für 2026 führt oder ein Urteil an 2024-Spielen hängt.

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
- Aufgeräumt am 08.10. nach Runde 64: der Runden-Branch `r64` (in `v1`) und die Spur-Branches `w15-a` und `w15-c` bis `w15-h` (jeder Commit per Cherry-Pick in `v1`) sind gelöscht. Hashes in `docs/perf/probes/2026-10-06-r64/gate/deleted-branches.txt`; solange Git die Objekte hält, holt `git branch <name> <hash>` einen zurück.
- Aufgeräumt am 09.10. nach Runde 65 (User-Okay): der Runden-Branch `r65` (in `v1`), der Proben-Branch `r65-cand` (2f0d3db, Kandidaten-Gewichte des Familien-Fits; seine Tabellen stehen in `v1`) und `w15-b` (043baf1, Re-Fit E der Runde 64, vom Werkzeug der Runde 65 überholt) sind gelöscht. Hashes in `docs/perf/probes/2026-10-09-r65/gate/deleted-branches.txt`; solange Git die Objekte hält, holt `git branch <name> <hash>` einen zurück.
- `r41-wide` (163efcc): weite Lesart der Tempo-Freigabe, Referenz für T26. Der Bank-Ordner ist gelöscht, die Zahlen stehen in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.

## D. Standing Rules

- **D1** Kein Push ohne Ansage. Stand 24.09. (Verdikt der Runde 57): origin/master steht auf e7f618f (Runde 55), origin/v1 auf dem master-Stand nach Runde 57. Zuletzt gingen `v1` und master am 21.09. um 17:18 gemeinsam zu origin (Runde 55); seither folgt nur `v1`. Seit dem 20.09. trägt der Branch `v1` bei origin den master-Stand: nach Runde 52 (User-Freigabe 14:50: „auf einen v1 branch, den du pushen darfst“), nach Runde 53 (User-Gate 16:22, „3a“), nach Runde 54 (User-Gate 21.09. 16:21, „4a“), nach Runde 55 (User-Gate 21.09. 17:18), nach Runde 56 (User-Gate 23.09. 17:18, „2a“) und nach Runde 57 (User-Gate 24.09. 12:13, „1a“). Die Gates der Runden 56 und 57 bestätigen die Regel: Nur `v1` folgt dem master-Stand, origin/master bleibt auf e7f618f. Jede Freigabe gilt für `v1` und für den genannten Stand. Seit dem User-Gate der Runde 59 (01.10.2026) blieb das Programm „Mehr Simulation“ auf Branch `r59` bis Runde 62; danach ging es in `v1`, und `v1` wurde gepusht. Seit Runde 63 (Gate 06.10., „8a“) stand origin/v1 auf f4fee1b; gearbeitet wird auf `v1`, jede Runde auf ihrem eigenen Branch ab `v1`, der nach dem Push gelöscht wird. Nach Runde 64 (Gate 08.10., „6a“) ging `v1` mit der Buchung wieder zu origin, ebenso nach Runde 65 (Gate 09.10., „4a“) und nach Runde 66 (Gate 09.10., „5a“).
- **D2** Vor jedem Push `npm run lint` lokal (der Pages-Workflow hat ein eigenes Lint-Gate) und `npx tsc -b` (`tsc --noEmit` prüft in diesem Solution-Setup nichts).
- **D3** Score-berührend = Cache-Bump + gepaarter Bank-Bench gegen eine frische Basis vom selben Tag + drei byte-identische Feedback-Läufe (seit Runde 49 zehn Dumps: sechs Singles, vier Doubles). Das Bank-Verdikt liest die Tabelle mit Fehlerbalken aus `scripts/paired-calibration.mjs` (seit Runde 48: 90-%-Band aus einem gepaarten Bootstrap über Replays, Sichten full, hq und glücksbereinigt): **Gepoolte Zeilen entscheiden, Phasen-Zellen warnen.** Ein Kandidat besteht, wenn (1) sein Gewinn dort belegt ist, wo die Messung scharf genug ist (eine gepoolte Bank-Zeile ganz im Guten ODER der Fit-Korpus out-of-sample in allen Seeds), (2) keine gepoolte Bank-Zeile Schaden zeigt und (3) die Tier-Zählung der Feedback-Dumps hält (D21). **Schaden braucht Größe** (User-Gate 19.09., Runde 49): Eine gepoolte Zeile ist Schaden und eine Phasen-Zelle eine Warnung, wenn ihr Band ganz im Schlechten liegt UND ihr Mittel mindestens 5 bp beträgt; kleinere aufgelöste Verschiebungen druckt das Skript als Hinweis hinter dem Verdikt (eine Änderung, die wenige Stellungen bewegt, löst ein einzelnes bp auf). Warnungen und Hinweise gehen mit ihrer Größe ans Gate. Eine Korrektur mit Zweck außerhalb der Bank (Korpus-Gap, Korrektheitsfehler) braucht (2) und (3) und ihren eigenen Beleg. Auflösung der Bank (kleinster wahrer Effekt, den eine Zeile in vier von fünf Fällen sieht, Median über die Kandidaten der Runde 47): gepoolt gesamt 23 bp, gepoolt Singles 24, gepoolt Doubles 58, Singles-Phasen-Zelle 33, Doubles-Phasen-Zelle 72; eine K-Abbildung löst feiner auf (gepoolt 10 bp) als ein Gewicht, das wenige Stellungen stark bewegt. Punktwerte ohne Band sind kein Verdikt. Corpus-Re-Pins und Golden-Refreshes nur nach User-Gate.
- **D4** Verlustfrei oder render-only = drei byte-identische Feedback-Läufe + Kalibrierung ziffern-gleich + `npm run test:regression`, e2e, lint, `tsc -b`.
- **D5** Messen vor Bauen: Spike oder Sonde vor dem Design-Gate, Messkette vor Pins, roter Test vor dem Umbau. Jede Runde bekommt vor dem Bau Brainstorming und Spec.
- **D6** Byte-Vergleiche nur mit `FEEDBACK_DUMP=1` und frischen Dumps (mtime prüfen). Wanduhr-Gates und Perf-Sonden nur verschränkt mit der Basis auf einem Maschinenzustand (Runde 43: +18 % Drift bei unverändertem Code innerhalb eines Vormittags; 573756 unter Fremdlast 101 bis 440 s).
- **D7** Baum-, Wurzel- und Ziehungs-Änderungen: zuerst den Play-out-Pin einzeln fahren (Draft t56, p2 gewinnt bis Zug 70, `e2e/branch.spec.ts`). Er kippt früher als die Bank (Runde 43, Runde 45). Verify- und Merge-Änderungen zuerst an der Golden 655336 messen (`docs/perf/probes/2026-09-03-r32/verify-check.spec.ts`, 34 s, billigstes Orakel).
- **D8** Fitter- und Set-Runden: Set-Diffs auf allen Bau-Wegen VOR der Bank. Bewegt sich auf dem Bank-Weg kein Set, misst die Bank blind (Runde 41). Es gibt vier Bau-Wege (Runde 51, T12): nackt (nur Beobachtungen und Zugreihenfolgen), alter Bank-Bau (rohe Team-Infos plus Nutzungs-Fills, eine Lösung; seit Runde 52 nur noch hinter `EVAL_CALIBRATION_RAWBUILD=1`), App-Bau (angereicherte Infos, `solveReplaySpreads` mit Tempo-Vorlösung) und Feedback-Harness (derselbe Code wie die App, aber Daten aus `e2e-feedback/fixtures`). Seit Runde 52 baut die Bank über `buildAppTeams` (`src/lib/app-team-build.ts`) wie die App: Set-Diff Bank gegen App 0 von 1549 über die 129 Replays. Eine Runde, die den App-Bau ändert, ändert damit auch die Bank; `regression/app-build-parity.spec.ts` und `ui/hooks/appBuildParity.spec.tsx` halten Hook-Kette, Worker-Lösung und `buildAppTeams` zusammen. Die zwei Options-Blöcke in `src/lib/team-build-options.ts` lesen App und Bank gemeinsam: Eine Änderung dort bewegt beide und fällt den Pins nicht auf. Seit Runde 53 (T66) behält ein Pokémon, das die Volllösung verwirft, den Eintrag der Tempo-Vorlösung (`carryPreSolve`); vorher fiel es auf die Nutzungsstatistik zurück und brach 13 Zugreihenfolgen, die die Vorlösung hielt. Wer an der Übergabe zwischen den zwei Stufen baut, zählt die Zugreihenfolgen je Stufe (`docs/perf/probes/2026-09-20-r53/T66/stage-trace.vt.ts`: der Nachbau der Kette besteht zuerst den Identitäts-Test gegen `solveReplaySpreads`). Der alte Satz „Set-Annahmen 404 im Harness“ war falsch: Die Fixtures tragen die Set-Dateien, nur `sets/gen9doublesubers` fehlt, und die fehlt auch im Cache. Jede Sonde nennt ihren Bau-Weg UND ihre Datenquelle. Fit-Korpus und Bank teilen kein einziges Replay: Ein Fit-Korpus-Diff sagt nie voraus, ob die Bank etwas sieht. Ein Diff gegen eine gespeicherte alte Liste zeigt nur, was die letzten Runden geändert haben; wer wissen will, was der Löser tut, misst gegen den Prior desselben Laufs (gegen die Liste vom 11.09. bewegt sich 1 Doubles-Set, gegen den Prior sind es 43).
- **D9** Sonden nie unter `regression/` ablegen (die Suite sammelt sie ein; zweimal je eine Stunde verloren), sondern als `.vt.ts` unter `docs/perf/probes/<datum>/` mit eigener Vitest-Config (Vorbild `docs/perf/probes/2026-09-12-r45/vitest.probe.config.ts`). Sonden auf das Bank-Universum begrenzen (neun Minuten); den Fit-Korpus nur parser-seitig anfassen (mit Fills und Löser über eine Stunde).
- **D10** Diagnosen am Battle-State über den echten App-Pfad (Browser-Probe mit debug-Feld plus `FEEDBACK_DUMP`); nackte node-Rekonstruktion ist nicht harness-treu; `graph.results[]` hat kein turn-Feld (Index i = Turn i+1).
- **D11** Während Feedback-, e2e- und Kalibrierungsläufen nichts im Repo anfassen, auch keine Root-Markdown-Dateien (Vite reloadet, HMR zerschießt den Lauf); das gilt, bis Port 5176 leer ist. Browser-Messungen im eigenen Worktree, wenn eine zweite Session aktiv ist. Läufe über zehn Minuten abgekoppelt starten (nohup plus Marker-Datei), das Hintergrund-Tool endet sonst.
- **D12** Feedback-Läufe: `npm run test:feedback` startet seit Runde 46 über `scripts/run-e2e.mjs --dev-port 5176` (wartet auf Vites Abhängigkeits-Cache, verweigert einen belegten Port, räumt den Server am Ende ab). Weiter von Hand: drift-json vorher löschen (ein roter Lauf schreibt den Bericht zweimal, die zweite Fassung ist unvollständig), Läufe über zehn Minuten detached starten. Meldet der Starter „Port busy“, den Besitzer per `netstat` suchen und seine Kommandozeile prüfen, bevor etwas beendet wird.
- **D13** Bank: `node scripts/run-calibration.mjs --slices 6 --out .calibration/<name>` (volle Bank 200 bis 410 s; Runde 55 lief in 201 s, am 23.09. dieselbe master-Bank in 336 s und die Bank mit dem Paar-Plan in 407 s, rund 20 % mehr, weil er die 129 Doubles-Matrix-Stellungen verteuert; seit Runde 46 misst sie mit den Parametern der App, also mit Abgleich an jeder Zug-Grenze; `--env EVAL_CALIBRATION_RAW=1` ist das Instrument von vor Runde 46, `EVAL_CALIBRATION_LEGACY=1` ein Lauf je Stichprobe mit den heutigen Parametern; Basis `.calibration/base-20260918-live`, 833 Stellungen; seit Runde 47 (Bank-HP, Cache v47) ist `.calibration/r47-t46` die Basis des Code-Stands, 833 Stellungen, Brier 0,2565/0,2196/0,1222, hq 0,2468/0,1916/0,1227. Seit Runde 49 (vollständiger Merkzettel-Schlüssel, Cache v48) ist `.calibration/r49-fullkey` die Basis des Code-Stands: 833 Stellungen, Brier 0,2565/0,2196/0,1223, hq 0,2469/0,1918/0,1228; 45 Stellungen liegen anders als in `r47-t46`. Seit Runde 50 trägt jede Dump-Zeile `decidedHeld`, und die Zusammenfassung endet mit der Quote der Decided-Erkennung, roh und vom Balken gehalten (`.calibration/r50-held`: 76,7 % von 103, gehalten 94,7 % von 57; sonst ziffern-gleich zu `r49-fullkey`); `scripts/dossier-decided-losses.mjs --held` listet die Verluste unter den gehaltenen. Seit Runde 52 (20.09.) baut die Bank ihre Teams über die Kette der App (angereicherte Infos, zweistufige Lösung, HP-Evidenz); `--env EVAL_CALIBRATION_RAWBUILD=1` ist der Bau von vor Runde 52 und byte-gleich zu `base-20260920` und `r50-held`. Basis des Code-Stands ist `.calibration/r52-appbuild` (als Instrument übernommen am User-Gate 20.09. 14:50): 833 Stellungen (dieselben), Brier 0,2564/0,2197/0,1255, hq 0,2429/0,1941/0,1278, glücksbereinigt 0,2333/0,1950/0,1204, K gepoolt 2,24, Decided 76,7 % von 103 und gehalten 93,1 % von 58. Gegen den alten Bau liest sie gepoolt +11 bp [+1, +28] und in Singles +15 [+1, +39], hq +4 [+0, +7], Doubles unbewegt; 8 der 11 bp trägt eine Stellung (2658663776 Zug 86, T66). Seit Runde 53 (T66, Cache v49) ist `.calibration/r53-carry` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2566/0,2197/0,1232, hq 0,2431/0,1937/0,1275, glücksbereinigt 0,2330/0,1948/0,1177, K gepoolt 2,28, Decided 76,7 % von 103 und gehalten 94,7 % von 57; gegen `r52-appbuild` gepoolt −7 bp [−21, +0] und Singles −10 [−29, +0], 39 Stellungen in 8 Replays bewegt, Doubles ziffern-gleich; gegen den alten Bau bleiben gepoolt +4 bp [+0, +7] und Singles +5 [+0, +10], und das Skript druckt auf dieser Paarung weiter „HARM on full singles (+5)“ (die Instrumentzeile aus Runde 52, nicht das Gate der Runde 53). Seit Runde 54 (T57, Cache v50) ist `.calibration/r54-nostab` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2540/0,2207/0,1193, hq 0,2429/0,1956/0,1226, glücksbereinigt 0,2272/0,1940/0,1131, K gepoolt 2,34 (Singles 2,22, Doubles 2,55), Decided 75,9 % von 108 und gehalten 94,6 % von 56; gegen `r53-carry` Gewinn glücksbereinigt gesamt −22 bp und Singles −13 [−26, −2], Singles voll −6 [−15, +0], Doubles voll −46 [−113, +14] nicht aufgelöst, kein Schaden, eine Warnung (Doubles Mitte hq +96 [+8, +198], drei Stellungen tragen 92 davon); gemessen unter dem ersten Hash 8a0b790 des Park-Commits c910b91 (gleicher Baum); 297 Stellungen in 98 Replays liegen anders als in `r53-carry` (151 Singles, 146 Doubles): 293 tragen einen lebenden Tera-Körper, die 4 übrigen sind das Singles-Spiel gen9ou-2663110678 mit einem Soundproof-Träger. Die Zwischenstände der Runde liegen als `.calibration/r54-clickA`, `-markB`, `-key`, `-def`, `-stab`, `-flags`, `-review`. Seit Runde 55 (T74 und T70, Cache v51) ist `.calibration/r55-rebuild` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2537/0,2230/0,1195, hq 0,2428/0,1957/0,1229, glücksbereinigt 0,2272/0,1943/0,1134, K gepoolt 2,31 (Singles 2,22, Doubles 2,48), Decided 75,9 % von 108 und gehalten 94,7 % von 57; gegen `r54-nostab` 5 Stellungen bewegt, alle Doubles in den drei Encore-Replays. Seit Runde 56 (T58, Cache v52) ist `.calibration/r56-shortcut` die Basis des Code-Stands (`r56-fixodds` byte-gleich): 833 Stellungen (dieselben), Brier 0,2546/0,2231/0,1197, hq 0,2444/0,1960/0,1234, glücksbereinigt 0,2290/0,1947/0,1136 (503 statt 501 Stellungen gezählt), K gepoolt 2,31 (Singles 2,22, Doubles 2,46), Decided 75,9 % von 108 und gehalten 94,7 % von 57; gegen `r55-rebuild` gepoolt +4 bp [−4, +12] und Doubles +12 [−11, +41] nicht aufgelöst, kein Schaden, eine Warnung (hq Doubles spät +15 [+1, +35]) und ein Hinweis unter 5 bp (hq gesamt spät +4 [+0, +8], dieselben 45 Doubles-Stellungen); 115 der 129 Doubles-Matrix-Stellungen bewegt, alle Singles-Zeilen und alle Doubles-Stellungen ab Fainted-Anteil 0,25 byte-gleich (die Bank rechnet diese über `mctsSearch` ohne Verify). Die Zwischenstände der Runde liegen als `.calibration/r56-base` (byte-gleich zu `r55-rebuild`), `-pattern`, `-sampler` und `-odds` (Stand 9404ccf, vor dem finalen Review; gegen ihn liest `r56-shortcut` 42 Stellungen bewegt und glücksbereinigt −1 bp). Seit Runde 57 (T73, Cache v53) ist `.calibration/r57-timing` die Basis des Code-Stands (byte-gleich zu `r57-hp` und `r57-sentence2`): 833 Stellungen (dieselben), Brier 0,2543/0,2237/0,1193, hq 0,2441/0,1967/0,1227, glücksbereinigt 0,2301/0,1957/0,1136, K gepoolt 2,30 (Singles 2,24, Doubles 2,42), Decided 78,5 % von 107 und gehalten 94,9 % von 59; gegen `r56-shortcut` Singles voll −8 bp [−18, +1] (nicht aufgelöst) und glücksbereinigt −9 [−20, +0] (aufgelöst), Doubles +18 und +24 nicht aufgelöst, kein Schaden, eine Warnung (Doubles früh glücksbereinigt +59, auf hq +78); 157 Singles- und 108 Doubles-Stellungen in 60 Replays bewegt. Die Zwischenstände der Runde liegen als `.calibration/r57-base` (byte-gleich zu `r56-shortcut`), `-body`, `-field`, `-tera`, `-hp`, `-power` (T81, geparkt) und `-sentence2`; die Bank-Läufe der Kette liefen ab `field` mit `--slices 4` (nach Bauart gleich zu 6, weil der Merge sortiert, am selben Code aber nicht nachgemessen; 417 bis 460 s, mit sechs Slices 281 bis 304 s). Seit Runde 61 (T98, Cache v56) ist `.calibration/r61-t98b` die Basis des Code-Stands (byte-gleich zu `r61-early-tree`): 837 Stellungen; die Bank rechnet über `regression/bank-search.ts` wie die App (Bäume über `searchTreesOrchestrated`, Tera der App, gespielte Doubles-Kombination), Auto-Züge ab dem ersten mit dem Baum; gegen `r61-app` gepoolt −23 bp [−45, −2], Doubles −70; ein Lauf mit `--slices 4` braucht rund 800 s. Seit Runde 63 (Welle 1, Cache v57) ist `.calibration/r63-wave3` die Basis des Code-Stands (Gate-Stand 7db8a8c): 837 Stellungen, Brier 0,2543/0,2272/0,1113, hq 0,2466/0,2006/0,1062, K gepoolt 2,41; gegen die Tagesbasis `r63-base-1006` kein Schaden in beiden Tabellen, 805 Stellungen bewegt; vier Slices brauchten 694 bis 945 s. Seit Runde 64 (Welle 1.5, Cache v58) ist `.calibration/r64-wave1` die Basis des Code-Stands (Wellen-Stand 7a64967): 837 Stellungen, Brier 0,2508/0,2258/0,1134, hq 0,2423/0,2001/0,1101, K gepoolt 2,45; gegen die Tagesbasis `r64-base-1008` (byte-gleich zu `r63-wave3`) kein Schaden in beiden Tabellen, Singles früh −39 bp [−69, −11] aufgelöst besser, eine Warnung Doubles spät +94 (T130); 567 Stellungen bewegt; vier Slices brauchten 704 bis 1010 s. Seit Runde 63 liest `scripts/paired-calibration.mjs` jede Paarung zweimal: mit dem K der A-Seite und mit eigenem K je Spielart und Phase, in jeder Bootstrap-Ziehung neu gefittet (D25); jede Welle misst gegen eine Basis vom selben Tag. `--env EVAL_SEARCH_BUDGET=<Form>` misst eine Budget-Form (`tree-from=0.25` ist die Auflösung vor Runde 61), `--env EVAL_CALIBRATION_EXPORT_ALL=1` exportiert jede Stellung mit Tera und Sleep Clause. Bank-Zahlen vor dem 20.09. stehen auf dem alten Bau und gelten nur als Vergleich innerhalb ihrer Runde oder gegen einen Lauf mit `RAWBUILD=1`; das gilt auch für fit-seitige Dumps (`EVAL_CALIBRATION_SOURCE=fit` läuft durch dieselbe Schleife; seit Runde 65 trainiert der Familien-Fit von `regression/eval-fit.spec.ts` auf diesen Dumps (`EVAL_FIT_DUMP`), mit `EVAL_CALIBRATION_STATIC=1` und `EVAL_CALIBRATION_FEATURES=1`; die eigene Erfassung der Spec baut weiter nackt). Seit Runde 65 (Cache v59 und v60) ist `.calibration/r65-gate` die Basis des Code-Stands (Gate-Stand 359769a): 837 Stellungen, Brier 0,2519/0,2311/0,1154, hq 0,2394/0,2031/0,1180, glücksbereinigt 0,2242/0,2077/0,1070, K gepoolt 2,38 (Singles 2,46, Doubles 2,25), Decided 82,4 % von 108 und gehalten 95,2 % von 63; gegen die Tagesbasis `r65-base-1009` (Stand 92b8646, in den Werten gleich `r64-wave1`) 198 Stellungen bewegt, alle Doubles OU; die Bank allein liest Doubles +96 bp schlechter (nach D26 eine Warnung), Bank plus Prüfbank −10 [−34, +15], eigenes K −4, kein Schaden. Prüfbank-Läufe der Runde: `.calibration/r65-hold-base-<familie>` (Stand afc530a), `r65-hold-gate-doublesou` und `r65-hold-gate-vgc` (Gate-Stand), `r65-hold-final-championsou` (Stand 8fb437b); die Familien-Fits lasen `.calibration/r65-corpus-app3` (3 977 Replays, Statik mit Merkmalen). Seit Runde 66 (Cache v61 bis v63) ist `.calibration/r66-t142` die Basis des Code-Stands (byte-gleich zum Kandidaten `r66-cand`): 837 Stellungen, Brier 0,2520/0,2305/0,1147, hq 0,2395/0,2031/0,1177, glücksbereinigt 0,2240/0,2070/0,1063, K gepoolt 2,40 (Singles 2,46, Doubles 2,30), Decided 82,4 % von 108 und gehalten 95,2 % von 63; gegen die Tagesbasis `r66-base-1009` (byte-gleich zu `r65-gate`) 46 Stellungen in den 10 VGC-Spielen bewegt (T142), Doubles −14 bp aufgelöst besser, kein Schaden. Prüfbank-Läufe der Runde: `.calibration/r66-hold-base-vgc`, `r66-hold-t142-vgc`, `r66-hold-base-championsvgc`, `r66-hold-t141-championsvgc`, `r66-hold-t142-championsvgc`, `r66-hold-cand-championsvgc`; die Fits lasen `.calibration/r66-corpus-app-t142` (5 627 Replays, Statik mit Merkmalen; `r66-corpus-app` ist der T141-Stand). Alle Bank-Zahlen in dieser Datei und im Backlog-Plan, die älter sind als der 18.09., stammen vom alten Instrument und gelten nur als Vergleich innerhalb ihrer Runde; weitere Flags `--env KEY=VALUE` und `--tranche`). A/B = zwei Ausgabeordner, dazwischen `scripts/paired-calibration.mjs` (dort `--quality hq|std`). Positions-Export über `--env EVAL_CALIBRATION_POSITIONS=<dir>`. Ist ein Slice-Lauf ungleich einem Ein-Prozess-Lauf, zuerst die mtimes von `.smogon-cache` prüfen.
- **D14** Perf-Umbauten an der Engine tragen ihre Identität dreifach: Fixture `fork-identity.json` (neu aufnehmen nur mit `PERF_IDENTITY_RECORD=1` auf dem Vorher-Code), Engine-Suite, Kalibrierung A/B ziffern-gleich. Die A-Seite einer A/B-Messung läuft auf dem Vorher-Code (Stash oder Worktree), nie auf einer Mischung. Perf-Sonde vor und nach am selben Tag: `PERF_PROBE=1 PERF_PROBE_LABEL=before|after npx playwright test -c docs/perf/probes/2026-09-03/probe.config.ts`.
- **D15** Worktree-Abbau (Vorfall 12.09. 15:25): Junctions (node_modules, .calibration, .smogon-cache, .fit-corpus) VOR `git worktree remove` einzeln und nicht-rekursiv löschen (PowerShell `[System.IO.Directory]::Delete('<worktree>\<junction>')`), dann per Reparse-Point-Scan prüfen, dass keine mehr existiert. `git worktree remove --force` folgt Junctions und löscht ihre Ziele. Seither: jede Bank-A/B mit frischer Basis am selben Tag; Vergleiche mit Ledger-Zahlen vor dem 12.09. nur mit diesem Vorbehalt. Memory `worktree-junction-removal`.
- **D16** `ALIGNMENT_SEEDS[0]` bleibt `'1,2,3,4'`; jede Listen-Änderung ist ein Cache-Version-Event. Runde 49 hat v48 genommen (Merkzettel-Schlüssel), Runde 53 v49 (Übergabe der Tempo-Vorlösung), Runde 54 v50 (Tera im Nachbau und in der Statik), Runde 55 v51 (Encore und gesperrte Slots im Nachbau), Runde 56 v52 (Doubles-Zellenplan), Runde 57 v53 (Züge beim Einsatz), Runde 60 v54 (Regelfehler am Simulator-Übergang), Runde 61 v55 und v56 (Baum ab dem ersten Zug), Runde 63 v57 (Welle 1: ein Bump für alle Spuren, nach dem Merge), Runde 64 v58 (Welle 1.5, ebenso), Runde 65 v59 (Champions OU) und v60 (Doubles OU, Regelwerk VGC), Runde 66 v61 (T141), v62 (T142) und v63 (Champions-Doubles-Gewichte).
- **D17** Gates nie durch eine Pipe leiten (Exit-Code direkt lesen); PP immer live aus `moveSlots.pp`; Commits englisch im Release-Stil, ohne Attribution.
- **D18** Design-Gates und Erklärungen in einfacher Sprache (User-Vorgabe 25.08.). Doubles und Singles sind First-Class: Neue Features decken beide von Anfang an ab (User-Vorgabe 28.08.). Die Experten-Evidenz des Feedback-Korpus ist rein Singles. Seit Runde 49 laufen vier Doubles-Spiele ohne Pins im Feedback-Lauf mit (`FEEDBACK_CENSUS_REPLAYS`): Sie liefern Dumps für die Tier-Zählung und den Byte-Gleichheits-Test, aber kein Experten-Urteil. Doubles-Änderungen brauchen weiter die Bank, das VGC-Replay oder die Doubles-Fixtures als Orakel; seit Runde 65 fällt das Doubles-Urteil auf Bank plus Prüfbank (D26).
- **D19** `docs/` bleibt gitignored; `FeedbackEval.xlsx` und `deploy.ps1` untracked lassen (deploy.ps1 = lokales Server-Deploy via `Host vserver`, nicht pushen). `NextSteps.md` ist getrackt.
- **D21** Jede score-berührende Änderung liest neben der gepaarten Bank die Tier-Zählung der Feedback-Dumps: `node scripts/tier-census.mjs <ordner>...` zählt Ungenauigkeiten, Fehler und Blunder je Seiten-Zug, getrennt nach Singles und Doubles, mit nicht zugeordneten und nur teilweise gesehenen Seiten daneben; `--moved <basis> <neu>` nennt jeden Zug, dessen Einordnung, Tier oder Zuordnung gewechselt hat. Stand nach Runde 49 (Ordner `docs/perf/probes/2026-09-19-r49/feedback/fullkey-run1`): Singles 38 / 2 / 0 auf 558 Seiten-Zügen (39 nicht zugeordnet), Doubles 7 / 5 / 0 auf 88 Seiten-Zügen (3 nicht zugeordnet, 11 teilweise). Die Bank benotet den Balken, nicht die Zug-Urteile (Runde 47: Boosts 39 gewann auf der Bank und gab 573756 sieben neue Fehlerzüge). Die Summe allein genügt nicht: die bewegten Züge lesen, in Singles vor allem die Golden 655336 (Runde 48: Summe 38/2/0 → 32/2/1, aber ein neuer Blunder auf dem Experten-Spiel), in Doubles das VGC-Spiel 2629703929 mit Team-Auswahl. Doubles liest gröber und nie allein als Spielart: Bewertet werden 16 ausgewählte Zug-Paare, ein nie gesehener Slot macht das Regret zur Untergrenze (teilweise), und die vier Spiele sind Gen 9 mit Tera (VGC Level 50) gegen Gen 6 und 8 im Singles-Korpus; ein bewegtes Doubles-Urteil ist ein Anlass nachzusehen, kein Beweis. Ein neues K verschiebt jede Schwelle in Gewinnprozent mit (T52).
- **D20** Jede Barrel-Änderung erscheint als Fixture-Diff unter `regression/fixtures/api/` (`UPDATE_API_SNAPSHOT=1` nur bewusst; der Diff ist das API-Review); nach Paket-Änderungen `npm run pack:smoke`.
- **D22** Set-Sonden (Runde 51): Set-Listen nach Replay, Seite und Art paaren, nie nach Index (der Formen-Marker-Fix hat 492 Sets entfernt, die alten Skripte zählen sonst 1582 statt 977). Jeder Nachbau (Leiter, Sweep, Engine-Kopie) besteht vor der ersten Zahl einen Identitäts-Test gegen das heutige Ergebnis (der erste Leiter-Nachbau der Runde traf 595 von 977 Zeilen, der treue 960). Seit Runde 52 (T61) führt der Merkzettel der Nutzungsstatistik seine Datenquelle im Schlüssel: Zwei Quellen in einem Prozess liefern zwei Antworten (Gegenprobe `docs/perf/probes/2026-09-20-r52/T61/two-sources.vt.ts`, 4 von 120). Für Builder-Zählungen in Doubles die vier echten Spiele aus `e2e-feedback/fixtures` nehmen (die synthetischen Doubles-Fixtures stehen in keiner Nutzungsdatei), und den Platzhalter `Tackle` aus `team-builder.ts` nicht als gesehenen Zug zählen. Der Positions-Export der Bank trägt nur die 110 kleinen entschiedenen Endspiele, nicht die 833 Stellungen.
- **D23** Absturz-Schutz (Vorfall 20.09. 12:48: Bluescreen 30 s nach dem Start eines Bank-Laufs, der zweite harte Absturz in zwei Tagen). Danach standen alle in den letzten Sekunden geschriebenen Dateien in voller Länge aus Null-Bytes da, darunter `.git/HEAD`, `.git/config` und der frische Branch-Ref (`fatal: not a git repository`). Vor jedem schweren Lauf (Bank, Feedback, e2e): erst committen, dann die frisch geschriebenen Dateien auf die Platte zwingen (`powershell -File docs/perf/probes/2026-09-20-r52/flush-recent.ps1`), und unmittelbar vor dem Start kein Git-Schreibvorgang. Ketten flushen nach jeder Stufe (Vorbild `docs/perf/probes/2026-09-20-r52/gates-chain.sh`). Nach einem Absturz: genullte Dateien unter `.git` suchen und aus dem Reflog wiederherstellen, halbe `.calibration`-Ordner löschen, den Lauf neu fahren, mtimes der Caches prüfen. Rezept samt `config`-Inhalt in der Memory-Notiz `machine-crash-zeroed-git-files`. Dritter Absturz 23.09. gegen 21:16, wieder während eines Bank-Laufs mit sechs Slices; diesmal nichts genullt. Seither ist die Kette wiederaufnehmbar (`SKIP_BASE`, `STATES_FILE`, `PREV_BANK`, `PREV_PROBE`, `PREV_DUMPS` in `docs/perf/probes/2026-09-23-r57/gates-chain.sh`), und ihre Bank-Läufe fuhren ab der Wiederaufnahme mit `BANK_ARGS="--slices 4"` (`bank-run.sh` setzt ohne `BANK_ARGS` weiter sechs).
- **D24** Ein Upgrade von `@pkmn/sim` ist ein eigener PR mit allen Identitäts-Toren der Runde 59 (Kette `docs/perf/probes/2026-09-24-r59/gate/`), der Guard-Spec samt dynamischem Zensus über alle Generationen und dem grep nach Laufzeit-Handlern; T103 ist vorher erledigt.
- **D25** Parallele Spuren (seit Runde 62): Regeln im Abschnitt „Parallel arbeiten“. Score-berührende Messungen lesen die gepaarte Bank zusätzlich mit eigenem K je Phase, Doubles getrennt (Runde 62: ein reines Umskalieren je Phase bringt in Doubles schon −35 bp). Änderungen an Nachprüfung, Kill-Quoten und Bericht sieht die Bank kaum, weil der Score auf Baum-Zügen das Mittel der Besuche ist (`packages/eval-engine/src/mcts-merge.ts:272`); ihr Tor sind Dumps, Pins und Zählungen, und jede bewegte Bank-Zeile wird gelesen.
- **D26** Doubles-Urteile (Gate der Runde 65, „3a“): Die 46 Doubles-Spiele der Bank allein sind zu wenige und bei Screens eine Ausnahme-Stichprobe (die Screens-Seite verlor 12 von 17 Spielen, auf der Prüfbank gewann sie 49 von 84). Das Doubles-Urteil liest die Bank zusammen mit der Prüfbank des Fit-Korpus (`regression/fixtures/fit-holdout-manifest.json`, ein Drittel der Sets je Familie, vom Fit nie gesehen): Je Seite gehen Bank-Dump und Holdout-Dumps als Komma-Liste an `scripts/paired-calibration.mjs`, die Zeile „doubles“ entscheidet mit beiden Tabellen, die Bank-Doubles allein warnen. Holdout-Läufe: `node scripts/run-calibration.mjs --slices 4 --out .calibration/<name>-hold-<familie> --env EVAL_CALIBRATION_SOURCE=holdout --env EVAL_CALIBRATION_TRANCHE=holdout-<familie>` mit `doublesou` (369 Spiele, 1 101 Stellungen, rund 25 Minuten mit Suche) und `vgc` (seit Runde 66 415 Spiele, 1 114 Stellungen, rund 26 Minuten); die Champions-Familien lesen ihre eigene Prüfbank (`championsou` 149 Spiele, 3 Minuten; `championsvgc` seit Runde 66 491 Spiele, 1 444 Stellungen, rund 33 Minuten). Jedes Replay rechnet mit dem Regelwerk seines Formats (`replayRuleset`: standard, vgc, champions); ein Fit je Familie (Regelwerk und Spielart) folgt den Regeln der Runde 65: Kreuzprüfung in 20 von 20 Seeds, markierte Gewichte gehalten und einmal neu gefittet, kein gepoolter Schaden mit Suche auf der Prüfbank.
- **D27** Ein Format baut seine Teams aus den Daten seines eigenen Spiels (Gate der Runde 66): Nutzungs- und Set-Datei des Formats oder seines Jahres (VGC über `vgcYearFormat`; `@pkmn/smogon` führt Champions-Dateien ohne Generation, etwa `sets/championsvgc2026.json`), nie die Analysen eines anderen Formats. Ein neuer Datenweg misst sich vor dem Einbau an offenen Teamlisten (`docs/perf/probes/2026-10-09-r66/diag/ots-truth.vt.ts`: Liste aus dem Log streichen, geratene Sets gegen die Liste; Bo3-Formate tragen Teamlisten seit 2025). Korpus-Erweiterungen holen gewertete Ladder-Spiele mit `scripts/expand-fit-corpus.mjs --sort rating` (neueste zuerst liefert nach einem Formatende nur ungewertete Herausforderungen); ungewertete Ladder-Spiele bleiben aus dem Fit (`withoutUnratedLadder`).

## E. Prozess: abhaken und überführen

Kurzfassung; vollständig in `docs/completed/README.md`.

1. Die Reihenfolge der Liste ist die Priorität: Die oberste Iteration ist die nächste Sitzung. Beim Start bekommt sie die nächste freie Rundennummer in ihre Überschrift, und ihre TODOs bekommen, falls sie sie noch nicht tragen, die Schritte aus dem Backlog-Plan als Unterpunkte. Schritte abhaken (Kästchen ankreuzen, Commit-Hash dazu), nicht löschen. Die Spec der Runde darf die Schritte ersetzen.
2. Am Rundenende (Teil des Abschluss-Tasks): den Block als Eintrag (Ziel / Geliefert / Gates / Lehren / Reste) an `docs/completed/<gebiet>.md` anhängen, eine Zeile in dessen Inhaltsliste, und den Abschnitt im Backlog-Plan streichen.
3. Reste einsortieren: Ein offener Rest wird ein neues TODO mit der nächsten freien T-Nummer in der passenden Iteration (samt Abschnitt im Backlog-Plan) oder eine Zeile in B; Signale → C, Regeln → D, dauerhafte Lehren → Memory-Notiz der Runde.
4. Die erledigte Iteration hier löschen und die Kopfzeile „Stand …, nach Runde N“ setzen. T-Nummern und Iterations-Nummern der übrigen bleiben stehen; Lücken in der Zählung sind gewollt.
5. Prüfen: `grep -c '\[x\]' NextSteps.md` ist 0; `grep -rc '\[ \]' docs/completed/ --exclude=README.md | grep -v ':0$'` ist leer.
