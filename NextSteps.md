# Next Steps (Stand 05.10.2026, nach Runde 62)

Nur offene Schritte, als priorisierte Checkliste: Die oberste Welle ist die nächste Runde; ihre Spuren laufen parallel, je Spur zuerst das oberste offene Kästchen (Abschnitt „Parallel arbeiten“). Jedes TODO nennt das Problem an einer Spielszene und das Erfolgsmaß. Die Umsetzungsschritte jedes TODOs stehen als Checkliste im Backlog-Plan unter derselben Nummer; beim Start einer Welle wandern sie hierher.

- **Iterationen** bündeln die TODOs einer Sitzung. Eine Iteration wird beim Start zur Runde mit der nächsten freien Rundennummer: Iteration 1 war Runde 46, Iteration 2 war Runde 47, Iteration 2a war Runde 48, Iteration 2b war Runde 49, Iteration 3 war Runde 50, Iteration 4 war Runde 51, Iteration 4a war Runde 52, Iteration 4d war Runde 53, Iteration 4b war Runde 54, Iteration 4e war Runde 55, Iteration 4c war Runde 56, Iteration 4f war Runde 57. Runde 58 war die Sichtung „Was bauen wir nach?“ außer der Reihe; seit ihrem Gate stehen die Iterationen S1 bis S3 des Programms „Mehr Simulation“ oben, vorgesehen als Runden 59 bis 62; Iteration S1 war Runde 59, Iteration S1a war Runde 60, Iteration S2 war Runde 61, Iteration S3 war Runde 62 (Triage). Seit Runde 62 heißen die Bündel Wellen: Eine Welle ist eine Runde, ihre Spuren laufen parallel mit je einem Sub-Agent; Welle 1 wird Runde 63. Score-berührende TODOs bekommen je ihre eigene Messung (D3), nie eine gemeinsame.
- **T-Nummern** (T01 bis T45) sind feste Namen, vergeben am 18.09. in Prioritäts-Reihenfolge. Wandert ein TODO in der Liste, behält es seine Nummer; ein neues TODO bekommt die nächste freie (ab T117; T46 kam am 18.09. in Runde 46 dazu, T47 bis T51 in Runde 47, T52 und T53 in Runde 48, T54 in Runde 49, T55 in Runde 50, T56 bis T64 in Runde 51, T65 am 19.09. nach deren Gate, T66 bis T68 am 20.09. in Runde 52, T69 am 20.09. in Runde 53, T70 bis T74 am 21.09. in Runde 54, T75 am 21.09. in Runde 55, T76 am 23.09. am Gate der Runde 56, T77 bis T80 am 23.09. in Runde 56, T81 am 23.09. am Gate der Runde 57, T82 am 23.09. in ihrer Spec, T83 bis T90 am 24.09. in Runde 57, T91 bis T102 am 24.09. am Gate der Runde 58, T103 am 01.10. in Runde 59, T104 am 02.10. in Runde 60 vergeben und dort erledigt, T105 bis T107 am 02.10. in Runde 60, T108 am 02.10. nach ihrem Gate, T109 bis T111 am 04.10. in Runde 61, T112 bis T116 am 05.10. in Runde 62). Seit Runde 62 sind 36 Nummern stillgelegt; sie stehen mit Beleg und altem Text in `docs/completed/triage.md`. „braucht T01“ heißt: T01 muss vorher gelaufen sein.
- **Backlog-Plan** (je TODO: Idee, Schritte mit Dateien, volles Gate, Doubles-Abdeckung, offene Entscheidungen, Zahlen, Code-Belege): `docs/superpowers/plans/2026-09-18-backlog-plans.md`.
- **Erledigtes**: `docs/completed/` nach Gebiet (Index, Eintragsformat und Prozess in `docs/completed/README.md`).
- **Maschinen-Quellen**: Ledger in `regression/eval-calibration.spec.ts`, Pins in `e2e-feedback/corpus.ts`, Memory-Notizen.
- Diese Datei liegt seit 06.09. im Repository; `docs/` bleibt gitignored.

Die Schritte stammen aus dem Entwurf vom 18.09. (Code-Stand dcf9526); Runde 62 hat jedes TODO gegen den Stand 5d428b2 neu gelesen, und Texte mit „Runde 62 neu gefasst“ im Backlog-Plan gehen den alten Schritten vor. Jede Runde bekommt vor dem Bau weiterhin ihr Brainstorming und ihre Spec; die Schritte hier sind deren Startpunkt, und die Spec darf sie ersetzen. Ältere Dokumente nennen Q6 und Q4 gemeinsam „Runde 46“; hier sind es T06 und T09 in den Iterationen 2 und 3.

Hinter jedem Titel stehen Thema, Art, Größe (mini, klein, mittel, groß), Gate (score-berührend = D3, verlustfrei = D4, sonst ausgeschrieben) und „braucht“ = muss vorher gelaufen sein. Seit Runde 62 trägt jedes TODO einen *Nutzen:*-Satz: was es der Engine (Bank, Pins, Feedback) oder der App (sichtbar, Tempo) bringt.

## Programm · Mehr Simulation (Runden 59 bis 62, abgeschlossen)

Das Programm ist mit Runde 62 abgeschlossen: Tempo-Schicht (Runde 59), Regelfehler am Simulator-Übergang (Runde 60), Baum ab dem ersten Zug (Runde 61) und die Triage aller übrigen TODOs (Runde 62, 36 geschlossen, 39 behalten, T112 bis T116 neu). Begründung und Ergebnisse stehen in `MoreSimulation.md`, im Programm-Plan `docs/superpowers/plans/2026-09-24-program-more-simulation.md` und in `docs/completed/eval-quality.md`. Gate der Runde 62 (05.10.2026, „1a / parallel / 3a“): `r59` geht per Fast-Forward in `v1` und `v1` wird gepusht, master bleibt auf 94c88d9.

## Parallel arbeiten: Wellen und Spuren

Gate der Runde 62 (05.10.2026): Die nächsten Schritte laufen mit mehreren Sub-Agents parallel. Die Liste ist deshalb in 3 Wellen geteilt; eine Welle ist eine Runde, jede Spur einer Welle ist die Arbeit eines Sub-Agents. Die Spuren einer Welle teilen keine Datei, Abhängigkeiten liegen zwischen den Wellen. Jede Spur nennt ihre Dateien und ihr Tor.

| Welle | Spur | TODOs | Tor |
| --- | --- | --- | --- |
| 1 | A · Auto-Budget: Singles früh, Tiefer denken, Texte | T110, T109, T111 | Bank gepaart (T110), Feedback 3× mit 562428 t10 auf ok, UI-Tests und e2e für T109. |
| 1 | B · Zugkern der Statik | T81, T112 | Bank gepaart, Singles und Doubles getrennt, mit K der Bank und eigenem K je Phase; Feedback 3× mit Tier-Zählung; T112 byte-gleich. |
| 1 | C · Nachprüfung im Baum: Klassen und Tiefe | T16, T78 | Monte-Carlo-Sonde und Dumps (Noten), Pins mit Golden 655336 am User-Gate; jede bewegte Bank-Zeile gelesen (die Bank sieht die Nachprüfung kaum). |
| 1 | D · Set-Treue | T89, T28, T80, T101 | Set-Diff auf Bank und Feedback, Bank gepaart mit frischer Basis, Feedback 3×, Pin-Bewegungen (648453 t13, t20, 649664 t8) am User-Gate. |
| 1 | E · Bericht, erster Teil | T19, T18, T17, T64, T116 | Engine-Zahlen unberührt (Score, Tiers, Bank ohne Lauf byte-gleich), Feedback-Dumps und Prosa-Pins, UI-Tests. |
| 1 | F · Vorschau | T20, T96, T68 | UI-Tests und e2e; Bank und Feedback unberührt. |
| 1 | U · User-Aufgabe: Experten-Urteile | T45 | Urteile im Ledger, mindestens ein Doubles-Pin. |
| 2 | A · Rechner-Eingaben | T83, T72, T76, T100, T84 | Zählung je TODO auf 0, Dumps (Quoten, Zeilen), jede bewegte Bank-Zeile gelesen. |
| 2 | B · Wahlen und Wurzelwert | T113, T114 | Prüfstände, Bank-Lauf mit gameValue neben dem Score, Feedback 3×, Score-Frage am User-Gate. |
| 2 | C · Nachbau-Treue | T115, T108 | Zählungen auf 0, Golden 655336 zuerst, Bank gepaart, Feedback 3×. |
| 2 | D · Bericht, zweiter Teil | T22, T59 | Engine-Zahlen unberührt, Dumps und Prosa-Pins, chance-Pins 573756 t73 und 649664 t23 stehen. |
| 2 | E · Panel und Knöpfe | T85, T69 | UI-Tests und e2e, Set-Diff 0. |
| 2 | F · Skala | T52, T51 | Bank mit K der Bank und eigenem K je Phase, Doubles-Tier-Zählung, Anzeige-Kalibrierung. |
| 3 | A · Fitter und Doubles-Schaden | T31, T26, T86 | Set-Diff, Fit-Fehler je Familie, Bank mit frischer Basis, Feedback 3×. |
| 3 | B · Statik-Gewichte | T42, T49, T102, T39 | Bank mit beiden K-Lesungen, Fit-Korpus mit Kreuzprüfung, Feedback 3× mit Tier-Zählung. |

**Regeln für parallele Spuren.**

- Eine Welle ist eine Runde. Jede Spur ist ein Sub-Agent auf einem eigenen Branch und Worktree vom Stand bei Wellen-Start; die Hauptsitzung ist Integrator. Die Spuren einer Welle teilen keine Datei; Abhängigkeiten liegen zwischen den Wellen.
- Datei-Hoheit: Eine Spur ändert nur die Dateien ihrer Liste. Braucht sie eine fremde Datei, meldet sie das dem Integrator und ändert sie nicht selbst.
- Nur der Integrator ändert: NextSteps.md, docs/completed/, den Ledger-Block in regression/eval-calibration.spec.ts, e2e-feedback/corpus.ts (Pins, Re-Pins nur am User-Gate), EVAL_ENGINE_CACHE_VERSION in src/lib/eval-cache-store.ts (ein Bump je Welle), eslint.ratchet.mjs und den Snapshot in regression/package-api.spec.ts.
- Eine schwere Messung zur Zeit auf der Maschine (Bank, Feedback, e2e, volle Regression), über eine Warteschlange beim Integrator; ein Bank-Lauf dauert rund 13 Minuten (r61-t98b 794 s), ein Feedback-Lauf rund 5. Sonden auf einzelnen Stellungen dürfen parallel laufen, je höchstens 5 Minuten.
- Messungen laufen in einem eigenen Messungs-Worktree des Integrators, der die Spur-Commits nacheinander auscheckt; jede Spur misst gegen dieselbe Basis vom Wellen-Start und liest gepaart mit dem K der Bank und mit eigenem K je Phase.
- Worktrees: nie git worktree remove auf einem Worktree mit Junctions; Junctions (.calibration, .smogon-cache, .fit-corpus, node_modules) vorher mit [System.IO.Directory]::Delete lösen. Keine automatische Worktree-Isolation des Agent-Werkzeugs, weil sie Worktrees ohne getrackte Änderung selbst entfernt und dabei Junctions folgen würde.
- Merge: Der Integrator merged die Spuren in der Reihenfolge der Liste, jede Spur vorher auf den Wellen-Stand rebased; Konflikte nur mit Marker-Zählung auflösen. Danach rechnet er den Wellen-Lauf (Bank gegen die Basis, Feedback 3×); zeigt der Lauf einen Schaden, den keine Spur allein zeigte, rechnet er Spur für Spur zurück.
- Ein User-Gate je Welle mit einer Tabelle über alle Spuren. Commits englisch und ohne Attribution, kein Push ohne Okay, Singles und Doubles gleichrangig, keine Spiellogik hart kodieren.
- Vor Welle 1 baut der Integrator Schritt 1 von T52 (eigenes K je Phase in scripts/paired-calibration.mjs), weil jede Spur damit liest.

## Welle 1 · Spur A · Auto-Budget: Singles früh, Tiefer denken, Texte

Klein und schon gemessen: Der Hybrid aus T110 ist aus vorhandenen Bank-Zeilen gerechnet neutral, holt den Pin 562428 t10 zurück und macht frühe Singles-Klicks schneller. T109 und T111 ändern dieselben Dateien und die Texte zu Auto.

*Dateien:* packages/eval-engine/src/search/budget.ts, src/hooks/evaluation/ (prefs.ts, single-eval.ts, sweep-core.ts), src/hooks/useEvaluation.ts, src/hooks/useEvalView.ts, src/components/eval/GameGraphSection.tsx, EvalControls.tsx, PlayOutBar.tsx, ThinkDeeperButton, regression/bank-search.ts, EVALUATION.md, packages/eval-engine/README.md.

*Tor:* Bank gepaart (T110), Feedback 3× mit 562428 t10 auf ok, UI-Tests und e2e für T109.

- [ ] **T110 · Frühe Singles-Züge als Matrix, Doubles bleibt beim Baum** (Simulation und Suche, Mini-Runde, klein, score-berührend D3)

  Seit Runde 61 rechnet Auto in Singles auch frühe Züge mit dem Baum. Der Baum liest sie enger: 562428 Zug 10 verliert den Heatran-Read (Pin drift), auf dem Korpus sinken die Read-Sätze von 11 auf 5 und die frühen Singles-Shifts von 6 auf 1. Weg: die Baum-Schwelle je Spielart im Suchbudget, Singles unter 25 % gefallener Pokémon als Matrix mit drei Würfen, Doubles wie heute. Aus vorhandenen Bank-Zeilen gerechnet ist das neutral (+2 [−9, +13]).

  *Nutzen:* Feedback: Pin 562428 t10 von drift zurück auf ok; App: die verlorenen Read-Sätze kommen zurück und frühe Singles-Klicks werden schneller (0,76 statt 3,25 s); Bank neutral.

  *Erfolg:* 562428 Zug 10 wieder ok, kein anderer Pin bewegt; Bank gepaart voll und hq ohne Schaden; Singles-Wanduhr nicht höher; roter Test auf die Schwelle je Spielart. T65 bleibt geschlossen, solange die frühe Singles-Matrix drei Würfe rechnet (Gate 05.10.). *Plan T110:* Backlog-Plan, Abschnitt T110 (Runde 62 neu gefasst).

- [ ] **T109 · Tiefer denken auf Baum-Zügen** (Simulation und Suche, Mini-Runde, klein, render-nah)

  Seit Runde 61 verschwindet 'Think deeper' in Auto ab Zug 1. Die Stufe ist gemessen: vierfache Durchläufe je Baum (Bank −15 bp gepoolt, Doubles −38), Wartezeit eines Klicks rund 3- bis 4-mal ein Baum-Zug (Node: Singles 2 → 7 s, Doubles 6 → 17 s). Rest: am Gate entscheiden, ob ein Baum-Zug diese Stufe anbietet; dann TurnEvalSettings mit Budget-Stufe, Cache-Schlüssel, Knopf-Text, UI-Test und e2e.

  *Nutzen:* App: ein Klick rechnet einen Zug in der besten gemessenen Tiefe (Bank −15 bp gepoolt, Doubles −38), sichtbar als Knopf in Auto, für etwa 3- bis 4-mal die Zeit eines Baum-Zugs.

  *Erfolg:* Ein Baum-Zug bietet die Stufe mit 2400 Durchläufen an und nennt die Wartezeit, oder der Knopf entfällt bewusst mit Text. *Plan T109:* Backlog-Plan, Abschnitt T109 (Runde 62 neu gefasst).

- [ ] **T111 · Restposten aus Runde 61** (Werkzeug, Mini-Runde, klein, je Punkt verlustfrei oder mit eigenem Beleg)

  Restposten aus Runde 61, gekürzt. (11) Wartezeit eines Einzelklicks an Zug 2 im Worker-Pool messen (Singles, Doubles, VGC; Einzelprozess heute 3,25, 7,3 und 5,5 s), Ergebnis ins Ledger. (7)+(8) Texte zu Auto angleichen (PlayOutBar.tsx, EvalControls.tsx, EVALUATION.md, README des Engine-Pakets, Kommentare in play-out.ts und prefs.ts). (1) FEEDBACK_SEARCH_BUDGET schon in Node parsen. (3) MCTS_TREES neben dem Budget klären (Tests lesen ihn). Verworfen: (2), (4), (5), (6), (10); (9) geht in T114.

  *Nutzen:* App: Wartezeit eines Klicks an frühen Zügen gemessen (Einzelprozess bis 7,3 s in Doubles) und Texte, die sagen, was Auto tut; Engine: zwei Pins prüfen den Weg, den die App rechnet.

  *Erfolg:* je Punkt roter Test oder Textänderung mit e2e-Abgleich, (11) im Ledger. *Plan T111:* Backlog-Plan, Abschnitt T111 (Runde 62 neu gefasst).

## Welle 1 · Spur B · Zugkern der Statik

Der einzige aufgelöste Bank-Gewinn der Triage ohne Zeitkosten (Singles rund −10 bp), und in Doubles kommen Heat Crash, Body Press und Surging Strikes zurück in die Suche. Der Merkzettel für die Hinweise folgt in derselben Spur, weil T81 die Hinweise ändert.

*Dateien:* packages/eval-engine/src/score/ (threat.ts, move-facts.ts, matchup.ts, unanswered.ts), move-use.ts, move-use-rules.ts, search/hints.ts.

*Tor:* Bank gepaart, Singles und Doubles getrennt, mit K der Bank und eigenem K je Phase; Feedback 3× mit Tier-Zählung; T112 byte-gleich.

- [ ] **T81 · Statik und Such-Hinweise lesen Züge, wie sie landen** (Statik, Runde, mittel, score-berührend D3)

  Nimmt T71, T82, T88 und den Hinweis-Teil von T84 auf. Der eigene Schadenskern (score/threat.ts) rechnet Low Kick, Heat Crash, Heavy Slam, Gyro Ball mit Stärke 0, Mehrfachtreffer mit einem Treffer, Knock Off ohne Item-Bonus, Body Press, Psyshock und Foul Play mit den falschen Werten, STAB ohne Tera, und die Hinweise bewerten Tera-Optionen auf dem Körper vor dem Klick. Szenen: gen9doublesou-2663093831 Zug 6 (Heat Crash in keiner der 13 Kombinationen von p1); gen9vgc2026regi-2630110359 Zug 3 (Surging Strikes fehlt); gen9vgc2026regi-2630452654 Zug 6 (Body Press fehlt); VGC 2629760324 Zug 2 und 3 lesen gegen den Sieger, die Stufen-Achse rückt sie zu ihm. Bau: Antworten aus Simulator und Dex (basePowerCallback, multihit, overrideOffensiveStat, overrideDefensiveStat, overrideOffensivePokemon), Stufen-Achse für Body Press (Def-Boosts in den Hinweisen), STAB nach den Spielregeln (d8eb0a3), Hinweise der Tera-Option auf dem terastallisierten Körper; offene Entscheidung: Stored Power und Power Trip über den Stufen-Weg rechnen oder mit eigener Zahl streichen. Kein Re-Fit (Gate 05.10.); der Re-Fit bleibt in T102. Erster Schritt: Bank-Lauf mit den Sonden-Mocks (groups/statik-achse/sa-staticall.vt.ts, sa-stab71.vt.ts, sa-hintall.vt.ts).

  *Nutzen:* Engine: der einzige aufgelöste Bank-Gewinn der Triage ohne Zeitkosten (Singles rund −10 bp); App: Doubles-Empfehlungen zeigen Heat Crash, Body Press und Surging Strikes wieder, die heute fast nie in die Suche kommen.

  *Erfolg:* Singles-Zeile aufgelöst besser, keine gepoolte Zeile mit Schaden, Singles und Doubles getrennt und mit eigenem K je Phase gelesen; 0 Paare mit Stärke 0, wo der Simulator mehr gibt; die drei Doubles-Szenen listen ihren Zug; Statik unter 1,15× Zeit; Feedback 3× mit Tier-Zählung, Gen 6 gelesen. *Plan T81:* Backlog-Plan, Abschnitt T81 (Runde 62 neu gefasst).

- [ ] **T112 · Merkzettel für die Such-Hinweise** (Tempo, Mini-Runde, klein, verlustfrei D4)

  Die Such-Hinweise (search/hints.ts) kosten in Doubles 17 bis 22 % der Baumzeit mit 0,6 bis 1,9 Mio. Aufrufen je Suche (docs/perf/probes/2026-10-04-r62/groups/statik-achse/out-leaves.jsonl: 2629760324#2, 941638#6, 2663093831#6), in Singles 4 bis 7 %. Viele Aufrufe rechnen dasselbe Paar aus Zug und Ziel an jedem Knoten neu. Läuft nach T81, weil T81 die Hinweise ändert.

  *Nutzen:* App: Doubles-Bäume bis rund ein Fünftel schneller bei gleichem Ergebnis; die Zeit kann später in mehr Durchläufe gehen (Runde 61: Doubles reagiert stark auf mehr Besuche).

  *Erfolg:* Bank und Feedback byte-gleich; Doubles-Baumzeit verschränkt gemessen mindestens 10 % kürzer; Singles nicht langsamer. *Plan T112:* 3 Schritte im Backlog-Plan.

## Welle 1 · Spur C · Nachprüfung im Baum: Klassen und Tiefe

Seit Runde 61 trifft die Nachprüfung jeden Zug ab 1. T16 repariert die Vertiefung aus der ersten Ziehung (rund fünf falsche Singles-Noten, Doubles-Rückfall-Zellen), T78 die Doubles-Randzellen (2629703929 Zug 13).

*Dateien:* packages/eval-engine/src/tree-orchestrator.ts, mcts-merge.ts, mcts.ts, search/cell-sampler.ts, search/position.ts, cell-blend.ts, pair/sampler.ts, src/lib/eval/worker-client.ts.

*Tor:* Monte-Carlo-Sonde und Dumps (Noten), Pins mit Golden 655336 am User-Gate; jede bewegte Bank-Zeile gelesen (die Bank sieht die Nachprüfung kaum).

- [ ] **T16 · Die Nachprüfung vertieft je Klasse statt aus der ersten Ziehung** (Zufall preisen, Runde, mittel, score-berührend D3)

  Die Nachprüfung vertieft eine Zelle nur aus der ersten Ziehung. Die erste Ziehung entscheidet damit Noten, die an einem Würfel hängen: 648453 Zug 13 (HP Ice), Zug 24 p1, Zug 31, 655336 Zug 26 p2 und 573756 Zug 136 tragen eine Note, die 40 frische Ziehungen nicht tragen; 648453 Zug 24 p2 fehlt eine. In Doubles ersetzt die Vertiefung das Mittel einer Rückfall-Zelle (912045 Zug 8: −0,9 statt −0,0143). Weg: je Klasse des Zellenplans vertiefen und mit den Plan-Gewichten mischen; Zellen ohne Plan mit mehr Ziehungen.

  *Nutzen:* App: rund fünf falsche Noten weniger und eine fehlende mehr auf sieben Singles-Zügen des Korpus, dazu die Doubles-Rückfall-Zellen; Bank: kein Hebel.

  *Erfolg:* auf allen Korpus-Zügen mit Nachprüfung stimmen die Seiten-Urteile mit der Monte-Carlo-Sonde (groups/wurzel-zufall/counter-mc.vt.ts) überein; 573756 Zug 73 Body Press behält seine Note; Doubles-Noten bewegen sich nur mit genanntem Grund; die Folge für Golden 655336 (Zug 26 p2 verliert die Note, die der Experte will) geht ans User-Gate; Feedback-Wanduhr im Zeitfenster der Runde 61. Die Bank sieht es nicht, der Score bleibt gleich; Tor sind Dumps und Pins. *Plan T16:* Backlog-Plan, Abschnitt T16 (Runde 62 neu gefasst).

- [ ] **T78 · Der Baum prüft seine Würfel-Zellen in Doubles nicht nach** (Zufall preisen, Runde, klein, score-berührend D3)

  VGC 2629703929 Zug 13: Flare Blitz tötet Solgaleo in 58 % der Würfe, die Flare-Blitz-Zellen stehen trotzdem bei −0,2 / −0,2 / +0,6 / −0,92, und p2s siegreiches Psychic Fangs bekommt eine Ungenauigkeit (0,2618). planCellEvents gibt bei einer Wahl mit Komma und bei gefallenem Slot a auf (cell-blend.ts:118, :143), Randzellen fallen aus der Nachprüfung. Weg: Randzellen der Stütz- und gespielten Zellen aus dem Paar-Plan melden und die gespielte Zeile und Spalte mitprüfen (das betrifft beide Spielarten).

  *Nutzen:* App: falsche Doubles-Urteile für Siegerzüge verschwinden (2629703929 Zug 13), in Singles werden gespielte Züge sauber nachgeprüft.

  *Erfolg:* 2629703929 Zug 13 p2 ohne Stufe; Zählung über die vier Doubles-Dumps nennt jeden bewegten Zug mit Lesung, gemessen am angezeigten Urteil; Singles-Pins als Tor; Score bewegt sich nur über die Beweiser-Reihenfolge, jede bewegte Bank-Zeile gelesen; Doubles-Baumzeit im Rahmen. *Plan T78:* Backlog-Plan, Abschnitt T78 (Runde 62 neu gefasst).

## Welle 1 · Spur D · Set-Treue

Die App baut Sets, die das Log widerlegt oder die zu wenige Züge tragen (Kyurem mit Specs und nur Icicle Spear in sieben Spielen, Slot-Alternativen statt fester Züge, Items ohne Rückstoß, Phantom-Formen); seit Runde 61 spielt der Baum sie an jedem Knoten. T89 und T28 teilen assembleMoves.

*Dateien:* packages/replay-core/src/team/ (set-resolvers.ts, set-coherence.ts), team-builder.ts, inference/lookup.ts, src/lib/replay-jobs/handlers.ts, packages/eval-engine/src/forward/switches.ts.

*Tor:* Set-Diff auf Bank und Feedback, Bank gepaart mit frischer Basis, Feedback 3×, Pin-Bewegungen (648453 t13, t20, 649664 t8) am User-Gate.

- [ ] **T89 · Der Bau hält zwei Optionen eines Smogon-Slots statt des festen Zugs** (Sets und Spreads, Mini-Runde, klein, score-berührend D3)

  Szene: 648453 Tornadus-T trägt weiter U-turn, Hidden Power Ice, Hurricane, Heat Wave; das Set Assault Vest Pivot hat Hurricane, [Heat Wave | Hidden Power Ice], Knock Off, U-turn. Zug 24 und 31 nennen Heat Wave als besten Zug und vergeben eine Ungenauigkeit (Bedauern 0,109 und 0,112). Ursache: @pkmn/smogon kürzt jeden Slot auf die erste Option (build/index.js:297), der Bau sieht Heat Wave als festen Zug; dazu stehen geratene Züge der Anreicherung im Pool vor dem kuratierten Set (set-resolvers.ts:169). Reichweite: 6 Sets in 4 von 6 Singles-Feedback-Spielen (dazu Lopunny ohne Fake Out und Excadrill ohne Iron Head in 649664), 52 Sets über Bank und Feedback nach der strengen Zählung (37 Singles, 15 Doubles). Weg: Slot-Struktur aus der rohen Sets-Datei lesen; ein Slot gilt als gefüllt, sobald eine seiner Optionen gesehen ist; feste Züge vor Alternativen.

  *Nutzen:* App: keine Urteile mehr, die einen erfundenen Zug empfehlen (648453 Zug 24 und 31), und feste Züge wie Knock Off, Fake Out oder Iron Head in 6 Sets der gepinnten Spiele; Bank-Effekt nicht gemessen, geschätzt klein.

  *Erfolg:* Tornadus-T trägt Knock Off, die strenge Zählung (groups/sets/slot-census.vt.ts) fällt für reine Slot-Fälle auf 0, Feedback dreimal byte-gleich, bewegte Urteile gelesen. Zusammen mit T28 bauen. Erwartete Pin-Bewegungen am User-Gate: 648453 t13, t20 und 649664 t8; die Notiz der Runde 33 am Pin 648453 t20 wird dabei korrigiert. *Plan T89:* Backlog-Plan, Abschnitt T89 (Runde 62 neu gefasst).

- [ ] **T28 · Sets mit weniger als vier Zügen: Veto-Zeilen und Formen reparieren** (Sets und Spreads, Runde, mittel, score-berührend D3)

  Szene: Die Bank baut wie die App 50 von 1548 Sets mit weniger als vier Zügen (Singles 42, Doubles 8), 17 davon mit einem Zug; 198 von 837 Bank-Stellungen tragen so ein Set lebend. Kyurem mit Choice Specs trägt in sieben Spielen nur Icicle Spear. Im Feedback-Korpus: Magnezone in 573756 (drei Züge auch unter dem Scarf), Weavile in 648453, 649664 und 653785, Dragapult in 562428. Ursachen: (1) Zeile 1 zählt einen Boost aus dem ganzen Pool, auch wenn das Choice-Item oder die Weste ihn selbst streicht, und wirft so alle Spezial-Angriffe (23 Sets, set-coherence.ts:217). (2) Zeile 2 wirft den zweiten Angriff desselben Typs, auch Prioritätszüge und Paare aus dem kuratierten Set (16 Sets, set-coherence.ts:179). (3) Geratene Züge der Anreicherung stehen im Pool vor dem kuratierten Set und gewinnen Zeile 2 (set-resolvers.ts:169). (4) Formen ohne eigenen Nutzungseintrag (Gastrodon-East, Maushold-Four, Sinistcha-Masterpiece, Zarude-Dada) bekommen keinen Pool; die Basis-Art aus dem Dex lesen, nichts hart kodieren. Schritt 0: Einzelsonde gen9doublesou-2663102863 Zug 10 mit Latios ohne die geratenen Züge Ally Switch und Simple Beam (das Log zeigt nur Draco Meteor); bewegt sie die Stellung zum Sieger p1, wird das Spiel Szene dieses TODOs, sonst bleibt es in der Liste von T45.

  *Nutzen:* App: keine absurden Sets mehr im Team-Panel und in simulierten Linien (50 Bank-Sets, 5 Sets in 4 von 6 gepinnten Singles-Spielen); Engine: 198 Bank-Stellungen mit vollständigen Optionen, Bank-Effekt geschätzt unter 23 bp, Richtung offen.

  *Erfolg:* Die Zählung (groups/sets/build-sets.vt.ts) sinkt auf Sets, deren Pool wirklich weniger als vier erlaubte Züge hält; kein Kyurem mit Specs ohne Spezial-Angriff; gepaarte Bank mit frischer Basis steht mindestens still; drei byte-gleiche Feedback-Läufe, bewegte Pins am User-Gate. Zusammen mit T89 bauen (gleiche Funktion assembleMoves). *Plan T28:* Backlog-Plan, Abschnitt T28 (Runde 62 neu gefasst).

- [ ] **T80 · Items, die das Protokoll ausschließt** (Sets und Spreads, Mini-Runde, klein, score-berührend D3)

  Life Orb ohne Rückstoß, Leftovers ohne Heilung. Die App baut 61 solche Sets in 46 Bank-Spielen und 4 in Feedback-Spielen (912045 Ursaluna-Bloodmoon, Gholdengo; 2663093831 Dragonite; 655336 Clefable); die Item-Probe bietet sie in vier Zügen an. Dazu Life Orb ohne Rückstoß bei 0 Offensive (2663113106 Darkrai, 2658659909 Rillaboom). Die Schadens-Widersprüche aus Doubles-Korpus-Spielen (Scale Shot, High Horsepower, Blood Moon, Flare Blitz) gehören zu T31.

  *Nutzen:* App: Team-Panel und simulierte Linien tragen kein Item mehr, das das Log widerlegt (61 Bank-Sets, 4 Feedback-Sets, beide Spielarten); Bank offen.

  *Erfolg:* kein gebautes Set trägt ein Item, das das Log widerlegt; vorab festgelegt: verschlechtert sich die gepaarte Bank um mehr als 23 bp, bleibt nur der App-Nutzen. *Plan T80:* Backlog-Plan, Abschnitt T80 (Runde 62 neu gefasst).

- [ ] **T101 · Einwechsel-Rechte und Kampfformen aus der Bibliothek** (Werkzeug, Mini-Runde, klein, score-berührend D3)

  (1) Revival Blessing: Die Suche bietet nach dem Zug lebende Pokémon an, der Simulator verlangt ein besiegtes, applyChoice wirft (forward/switches.ts:56), und die App lässt den Zug leer. smogtours-gen9ou-677869: 4 von 11 Zügen ohne Wert, gen9doublesou-2662174649 Zug 3 ebenso. Fix: die Wahl aus dem Request lesen (condition, reviving). (2) Kampfformen: inference/lookup.ts kennt nur eine Handliste von Endungen; Mimikyu-Busted, Zygarde-Complete, Palafin-Hero, Necrozma-Ultra und Greninja-Ash werden zum siebten Körper (27 Seiten im Fit-Korpus). Fix über battleOnly des Dex (bei Zygarde und Necrozma ist es eine Liste und braucht eine Wahl); nimmt den Rest von T60 auf.

  *Nutzen:* App: keine leeren Züge mehr in Spielen mit Pawmot oder Rabsca (25 Pawmot-Replays im Fit-Korpus, dort ein Zehntel bis ein Drittel der Züge betroffen) und kein erfundener siebter Körper in rund 1 % der Replays; Engine: Bank 0 Treffer.

  *Erfolg:* revival-gaps.vt.ts wirft in keinem der drei Replays; forms-check.vt.ts findet 0 Seiten mit mehr Körpern als die Teamgröße; Bank und Dumps unverändert. *Plan T101:* Backlog-Plan, Abschnitt T101 (Runde 62 neu gefasst).

## Welle 1 · Spur E · Bericht, erster Teil

Sätze, die der User liest: offene Ereignisse, kleine Sätze, Lob ohne Band, Reue gegen den echten Klick, Lead-Chips in Doubles. Alles hinter dem Score, darum ohne Bank-Lauf.

*Dateien:* packages/eval-engine/src/turn-analysis/, summary.ts, report.ts, win-reason.ts, prose/, src/lib/eval-badges.ts, src/components/eval/ (EvalTurnAnalysis.tsx, EvalGameReport.tsx, SideRow.tsx, analysis-bits.tsx, EvalResultBlock.tsx).

*Tor:* Engine-Zahlen unberührt (Score, Tiers, Bank ohne Lauf byte-gleich), Feedback-Dumps und Prosa-Pins, UI-Tests.

- [ ] **T19 · Offenes Ereignis eines Zwangssiegs unter 0,9 benennen** (Bericht, Mini-Runde, mini, verlustfrei D4)

  649664 Zug 24: Der Beweis hält mit Masse 0,8, offen ist der nächste 80-%-Hydro-Pump. Die Bar zeigt 81 %, kein Satz nennt den Grund, weil der Zwangssieg-Satz erst ab 0,9 spricht (summary.ts:48).

  *Nutzen:* Ein ehrlicher Satz an 649664 t24, der die 81 % erklärt; sehr klein, nur Anzeige.

  *Erfolg:* 649664 t24 nennt den 80-%-Hydro-Pump; 573756 t138 (Masse 0,663, offen ein 2-%-Ereignis) bekommt keinen Satz, der den Sieg an das 2-%-Ereignis hängt; kein anderer Korpus-Zug bekommt einen neuen Satz, alle Engine-Zahlen bleiben gleich. *Plan T19:* Backlog-Plan, Abschnitt T19 (Runde 62 neu gefasst).

- [ ] **T18 · Kleine Sätze im Spielbericht aufräumen** (Bericht, Mini-Runde, mittel, verlustfrei D4)

  Offen auf 5d428b2: (1) Fast-Sieg-Satz bei vollen Teams (649664 t3, VGC 2629703929 t2) und 'one 100% roll' in 9 von 12 dieser Sätze; (2) Entschieden-Sätze nach dem Beweis (648453 t36, t39) und mit wechselnder Seite (VGC 2630685175 t6, t8, t9); (3) Entschieden-Satz gegen den Ausgang der Karte (649664 t23: 16 auf 81 % für BKC, danach 'Medicham-Mega clears everything BKC has left'); (4) Reads-Beispiele nach Auszahlung statt nach Zug (655336: t27 vor t13); (5) '(waiting)' in gezeigten Hauptvarianten (54 von 329 Zügen); (6) 'The click was kills ~X%' (clauses.ts:22, heute ohne Träger). Erledigt: Halter-Spiegel, Odds-Satz.

  *Nutzen:* Rund 70 Korpus-Züge lesen sauberer, Singles und Doubles; reine Anzeige, kein Pin und keine Engine-Zahl bewegt sich.

  *Erfolg:* die genannten Stellen lesen richtig, die Prosa-Pins 573756 t8 und t73 und die Golden-Felder von 655336 stehen, der Dump-Diff zeigt nur summary-Felder. *Plan T18:* Backlog-Plan, Abschnitt T18 (Runde 62 neu gefasst).

- [ ] **T17 · Lob ohne Fehler-Band: Opfer-Satz und Read-Gutschrift** (Bericht, Runde, mittel, verlustfrei D4)

  Drei Regeln: (1) Opfer-Stempel ohne Band, Szene 573756 Zug 68 (Weavile-Opfer, Boden hält); (2) Hazard-Sack als eigene Form, Szene 653785 Zug 19 (Weavile in die Rocks, scheitert heute am Gesund-Tor); (3) Read-Gutschrift ohne Band, Szene 648453 Zug 13 (Lopunny-Wechsel, Read ohne Wagnis).

  *Nutzen:* Feedback: bis zu drei Gap-Pins (573756 t68, 648453 t13, 653785 t19) werden ok; App: Lob an den Schlüsselzügen; kein Bank-Effekt.

  *Erfolg:* die drei Szenen tragen ihren Satz; die Kollateral-Zählung nennt jeden neuen Eintrag, und die Regeln sind enger als die naive Fassung, die heute 125 von 542 ungetierten Seiten loben würde. *Plan T17:* Backlog-Plan, Abschnitt T17 (Runde 62 neu gefasst).

- [ ] **T64 · Reue gegen den wirklich geklickten Gegenzug zeigen** (Bericht, Mini-Runde, klein, verlustfrei D4)

  Die Zahl rechnet hindsightReadFor schon (signals.ts:140), sie spricht aber nur im shift-Satz und erscheint nie an der Seiten-Zeile; in Doubles fehlt sie ganz, weil opponentColumn den Doubles-Klick nicht findet (signals.ts:112). Zeigen nur, wenn sie ein Band weiter liegt als die Reue und die Zelle der besten Zeile mindestens 8 Besuche hat oder nachgeprüft ist.

  *Nutzen:* App: der User sieht neben der Note, was der Zug gegen den echten Gegenklick kostete; heute auf 46 Singles-Seiten berechnet und unsichtbar, in Doubles gar nicht.

  *Erfolg:* auf den zehn Dumps zeigt die Seiten-Zeile die Zahl genau dort, in Singles und Doubles; 912045 Zug 8 zeigt keine Zahl aus Zellen mit 1 bis 2 Besuchen; kein Tier und keine Summe bewegt sich; die Prosa-Pins stehen. *Plan T64:* Backlog-Plan, Abschnitt T64 (Runde 62 neu gefasst).

- [ ] **T116 · Lead-Urteile in Doubles nur bei stabiler Lesart** (Bericht, Mini-Runde, klein, verlustfrei D4)

  Der Spielbericht von 912045 zeigt „T0 led Ogerpon-Cornerstone + Rillaboom, better: Chi-Yu + Okidogi“ als Fehler (Bedauern 0,253). Matrix und Baum nennen an 76 von 92 Doubles-Seiten einen anderen besten Lead; die Lead-Wahl in Doubles liegt nahe am Zufall. Der Baum taugt nicht als zweiter Leser, weil Runde 61 ihn an Doubles-Vorschauen als schlechter gemessen hat.

  *Nutzen:* App: kein Lead-Fehler mehr auf Grundlage einer Lesung nahe am Zufall; heute zwei Doubles-Lead-Chips im Korpus.

  *Erfolg:* Auf den 46 Doubles-Vorschauen der Lead-Sonde ist die Zahl der Chips vorher und nachher gezählt; jeder bleibende Chip hat eine stabile Lesart; Singles unberührt; keine Engine-Zahl bewegt sich. *Plan T116:* 2 Schritte im Backlog-Plan.

## Welle 1 · Spur F · Vorschau

Was der User in der Schadensvorschau, im Editor und nach einem gescheiterten Statistik-Abruf sieht. Klein und verlustfrei für die Engine.

*Dateien:* src/lib/branch-damage.ts, packages/eval-engine/src/damage-calc.ts (nur der Vorschau-Teil), src/lib/pokemon-options.ts, Sprite-Namen, src/lib/smogon-stats.ts, smogon-sets.ts, src/components (BranchPanel.tsx, SideControls.tsx, FightSection.tsx).

*Tor:* UI-Tests und e2e; Bank und Feedback unberührt.

- [ ] **T20 · Tera-Toggle in die Schadensvorschau des Branch-Pickers** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  Im Branch-Picker drückt man „Tera (Ice)“ und liest darunter die Schadenszahlen weiter ohne Tera: Der Calc sieht den Tera-Typ erst nach der Ausführung. Genau im Moment der Entscheidung zeigt die Vorschau eine falsche KO-Zahl. Seit der QA-Kampagne im Juli bewusst offen.

  Dazu aus T96: Die Vorschau rechnet Spread-Züge wie Rock Slide auch dann mit Spread-Abzug, wenn nur ein Gegner lebt (src/lib/branch-damage.ts:73-75).

  *Nutzen:* App: Die K.-o.-Zahl stimmt beim Drücken des Tera-Knopfs; auf sechs Bank-Stellungen betrifft das 8 von 52 Zeilen, 4 davon kippen die K.-o.-Aussage.

  *Erfolg:* Die Vorschau-Zahl springt beim Drücken des Tera-Knopfs und zeigt denselben Wert wie der Calc nach der Ausführung, in Singles und mit zwei Zielen in Doubles. Ein roter Test für Rock Slide gegen einen einzelnen Gegner wird grün. *Plan T20:* 8 Schritte, 3 offene Entscheidungen.

- [ ] **T96 · Regelfehler der Inventur, die man in der App sieht** (Regelfehler, Mini-Runde, klein, verlustfrei D4 je Punkt)

  (1) Die Schadensvorschau macht aus Mehrfachtreffern einen Treffer (damage-calc.ts:109): Urshifu-Rapid-Strike mit Surging Strikes gegen Great Tusk zeigt 27 bis 32 % statt 82 bis 97 %; aktive Mehrfachtreffer-Angreifer in 68 Bank-Stellungen. (2) Sprite-Namen mit Bindestrich in der Form (Urshifu-Rapid-Strike, 3 Replays). (3) Der Team-Editor geht nur über Vorstufen, nicht über die Grundform (pokemon-options.ts:34); Rotom-Wash bekommt fast keine Züge. Geschlossen: die Engine-Fehler des Anhangs (über die Bank gezählt), Fake Out (flach gemessen), Attract (mit T77). Weitergegeben: Status-Faktor an T102, Multiscale und volle KP im Fit an T86, Rock Slide mit einem Ziel an T20.

  *Nutzen:* App: die Schadensvorschau zeigt Mehrfachtreffer richtig (68 Bank-Stellungen), dazu richtige Sprites und volle Zuglisten im Editor; Engine: kein Bank-Hebel.

  *Erfolg:* je Punkt eine Szene und ein roter Test, der nach dem Fix grün ist. *Plan T96:* Backlog-Plan, Abschnitt T96 (Runde 62 neu gefasst).

- [ ] **T68 · Ein gescheiterter Statistik-Abruf bleibt nicht im Merkzettel** (Oberfläche, Mini-Runde, mini, verlustfrei D4 mit eigenem Test)

  Replay in Format X laden, vor Ankunft der Statistik ein Replay in Format Y laden, dann wieder X: X zeigt bis zum Neuladen Smogon stats unavailable. Dasselbe nach einem Netz-Aussetzer, weil fetchSmogonUsageStats auch das null nach Netzfehlern merkt (smogon-stats.ts:84, :93). In VGC hängen daran 7 von 12 Sets (2629760324: Kyogre nur mit Tackle). Ein zweites Replay desselben Formats löst nichts aus.

  *Nutzen:* App und Engine in der Sitzung: Die Statistik lädt beim nächsten Replay wieder, statt bis zum Neuladen zu fehlen; in VGC hängen daran 7 von 12 Sets eines Spiels.

  *Erfolg:* Ein Test in ui/hooks/useSmogonUsageStats.spec.tsx stellt beide Fälle nach (erst rot), der nächste Abruf liefert Daten; ein 404 aller Quellen darf gemerkt bleiben; alle Engine-Zahlen der Dumps bleiben gleich. *Plan T68:* Backlog-Plan, Abschnitt T68 (Runde 62 neu gefasst).

## Welle 1 · Spur U · User-Aufgabe: Experten-Urteile

Läuft neben der ganzen Welle: Der User urteilt über vier offene Stellungen, der Integrator trägt die Pins ein.

*Dateien:* nur e2e-feedback/corpus.ts, und das schreibt der Integrator.

*Tor:* Urteile im Ledger, mindestens ein Doubles-Pin.

- [ ] **T45 · Experten-Urteile zu den gehaltenen Decided-Verlusten** (Richter und Bank, User-Aufgabe, klein, kein Score-Touch)

  VGC 2630685175 Zug 8 bucht p2 einen Fehler von rund 95 % auf 4 % (Taunt statt Astral Barrage, Reue 1,738), und kein Doubles-Spiel im Korpus trägt einen Pin. Die Liste: sechs gehaltene Decided-Verluste auf r61-t98b (drei Singles, drei Doubles); 2663102863 Zug 10 und 2629731825 Zug 4 sind schon erklärt. Der User sagt je Stellung 'Engine hat recht' oder 'Spieler hat recht'; jedes Urteil wird nach Zustimmung ein truth- oder gap-Pin.

  *Nutzen:* Engine: der erste Doubles-Pin im Feedback-Korpus, damit Doubles-Urteile des Baums gegen einen Menschen geprüft werden; Kosten ein Abend User-Zeit.

  *Erfolg:* vier offene Urteile im Ledger, mindestens ein Doubles-Pin im Feedback-Korpus. *Plan T45:* Backlog-Plan, Abschnitt T45 (Runde 62 neu gefasst).

## Welle 2 · Spur A · Rechner-Eingaben

Fünf kleine Fehler an derselben Stelle: Der Rechner bekommt Namen, Formen, Boosts, Gefallene und Tera-Körper nicht so, wie der Simulator sie kennt. Sichtbar an Quoten und Vorschau.

*Dateien:* packages/eval-engine/src/ko-odds.ts, damage-calc.ts, pair/kill-table.ts, pair/snapshot.ts, pair/odds.ts, choice-lock.ts, Hidden-Power-Brücke, cell-blend.ts (Tera-Körper der Quoten).

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

## Welle 2 · Spur B · Wahlen und Wurzelwert

Doubles-Züge ohne Urteil (Pollen Puff auf den Partner) und ein Wurzel-Score weit vom Spielwert in kleinen Endspielen (doubles-spread-2v1 liest 0,355 statt 1,0). Nach Spur 1C, weil T114 dieselbe Merge-Stelle liest.

*Dateien:* packages/eval-engine/src/forward/choices.ts, search/options.ts (nur Wurzel, keepPlayed), mcts-merge.ts (Score), endgame/prover.ts, regression/endgame-truth.spec.ts, decided-held-positions.spec.ts.

*Tor:* Prüfstände, Bank-Lauf mit gameValue neben dem Score, Feedback 3×, Score-Frage am User-Gate.

- [ ] **T113 · Züge auf den Partner als Option** (Simulation und Suche, Mini-Runde, klein, score-berührend D3)

  Die Zählung der Runde 61 (78 von 238) lief ohne keepPlayed. Mit keepPlayed fehlt die gespielte Kombination nur an einer echten Stelle: bei Zügen auf den eigenen Partner. VGC 2630685175 Zug 7 heilt p2 den Partner mit Pollen Puff; die Engine kennt diese Wahl nicht, weil forward/choices.ts bei Ziel normal und any nur Gegner-Slots aufzählt (choices.ts:15, :65 bis :75). Der Zug bekommt kein Urteil, ebenso Bank 938276 Zug 10 p1. Partner-Ziele überall würden die rohe Kombinationszahl je Knoten um das 1,55-Fache vergrößern; darum zuerst nur die gespielte Wahl an der Wurzel.

  *Nutzen:* App: zwei Züge in Korpus und Bank bekommen ein Urteil; Heilen oder Instruct auf den Partner wird in VGC bewertbar.

  *Erfolg:* 2630685175 Zug 7 p2 und 938276 Zug 10 p1 finden ihre Option und tragen ein Urteil; das Ziel kommt aus dem Request des Simulators, keine eigene Liste; Doubles-Baumzeit unverändert; Singles byte-gleich. *Plan T113:* 3 Schritte im Backlog-Plan.

- [ ] **T114 · Wurzel-Score gegen Spielwert** (Simulation und Suche, Runde, mittel, score-berührend D3)

  Auf Baum-Zügen ist der Score das Mittel über die Besuche, nicht der Spielwert (mcts-merge.ts:272, :292). In kleinen Endspielen liegen beide weit auseinander: Der Prüfstand doubles-spread-2v1 liest in der App 0,355 bei Spielwert 0,849, ein Einzelbaum 0,999, Wahrheit 1,0 (docs/perf/probes/2026-10-04-r62/groups/endspiel/spread2v1-doubles-spread-2v1.json). Auf den Dumps weichen 13 von 329 Zügen um mehr als 0,15 ab, in beiden Spielarten (2629703929 Zug 13 −0,83 gegen −0,64, 649664 Zug 22, 648453 Zug 35, 573756 Zug 135). doubles-ohko-tie liest 1,0 über einen falschen Beweis mit Masse 1. Der Prüfstand misst in seiner Baum-Spalte nur mctsSearch, nicht den App-Pfad (regression/endgame-truth.spec.ts:69).

  *Nutzen:* Engine und App: die Bar trifft kleine Endspiele (heute 13 von 329 Korpus-Zügen um mehr als 0,15 daneben), und die Bank zeigt, ob Score oder Spielwert besser kalibriert.

  *Erfolg:* Prüfstand über searchTreesOrchestrated; doubles-spread-2v1 näher an 1,0, doubles-ohko-tie ohne falschen Beweis; ein Bank-Lauf mit gameValue neben dem Score entscheidet, welcher den Brier besser trifft; auf den Dumps sinkt die Zahl der Züge mit Abstand über 0,15. *Plan T114:* 4 Schritte im Backlog-Plan.

## Welle 2 · Spur C · Nachbau-Treue

Der Nachbau gibt dem Baum Züge, die der Spieler nicht klicken kann (Choice-Sperre nach Trick im Golden-Spiel 655336), und die Inferenz verliert gegessene Items (649664 Zug 8 empfiehlt Mega).

*Dateien:* packages/eval-engine/src/branch/corrections.ts, packages/replay-core/src/inference/ (handlers.ts, opponent-inferrer.ts).

*Tor:* Zählungen auf 0, Golden 655336 zuerst, Bank gepaart, Feedback 3×.

- [ ] **T115 · Choice-Sperre nach Trick** (Nachbau, Mini-Runde, klein, score-berührend D3)

  Der Nachbau verliert die Choice-Sperre nach Trick. Golden 655336: In Zug 5 tauscht Trick den Choice Scarf zu Bisharp, das danach gesperrt ist; der Dump bietet in Zug 6 trotzdem Low Kick (0,431), Swords Dance und Iron Head an (graph.results[5].perSide.p1). Der Baum spielt an jedem Knoten Züge, die der Spieler nicht klicken kann. Sonst hält der Nachbau die Sperre (93 von 837 Bank-Stellungen tragen choicelock).

  *Nutzen:* App und Feedback: das Golden-Spiel 655336 bietet ab Zug 6 nur klickbare Züge an; jede Stellung nach Trick oder Switcheroo mit Choice-Item wird richtig gesucht.

  *Erfolg:* Die Zählung über Bank und Dumps (aktiver Choice-Träger nach Trick oder Switcheroo ohne choicelock) fällt auf 0; 655336 Zug 6 bietet Bisharp nur den gesperrten Zug an; jede bewegte Bank-Zeile und der Golden-Kanal gelesen. *Plan T115:* 3 Schritte im Backlog-Plan.

- [ ] **T108 · Die Gegner-Inferenz liest, was die Bibliothek schon weiß** (Werkzeug, Runde, mittel, score-berührend D3)

  (1) recordConsumedItem schreibt einen Platzhalter statt des gegessenen Items (inference/handlers.ts:258): 649664 Tyranitar verliert die Chople Berry, bekommt Tyranitarite, und die App empfiehlt in Zug 8 'Mega + Crunch'. Ein-Zeilen-Fix mit rotem Test. (2) Die Inferenz liest das Log an 44 Stellen mit eigenen Regex; elf Handler halten fest, was @pkmn/client beim selben Log ohnehin führt (Form, Züge, Items, Fähigkeiten, Tera, Mega). Schritt 1 schickt jede Zeile durch Protocol.parseBattleLine, Schritt 2 liest die elf Fakten aus dem Zustand des Clients; eigene Beweise (Ausschlüsse aus Schaden und Immunität, widerlegte Choice-Locks) bleiben bei uns. Dazu die Taunt-Fälle aus T75 (752301 Zug 2 und 3, 751543 Zug 20), wo der Nachbau Züge aus cant-Zeilen liest.

  *Nutzen:* App: keine Mega-Empfehlung mehr für ein Pokémon, das sein Item schon gegessen hat (649664 Zug 8), dazu weniger falsch gelesene Gegner-Items.

  *Erfolg:* 649664 Zug 8 empfiehlt kein Mega mehr; die Inferenz liest Zeilen nur noch über @pkmn/protocol und die elf Fakten aus @pkmn/client; die Zählung Client gegen Inferenz ist gelesen; Bank und Dumps bewegen sich nur in Spielen, die die Zählung nennt. *Plan T108:* Backlog-Plan, Abschnitt T108 (Runde 62 neu gefasst).

## Welle 2 · Spur D · Bericht, zweiter Teil

Glück ohne Würfel und Lob auf einem verlorenen Zug. Erst nach dem Hybrid aus Spur 1A, weil er die Glückskonten in Singles zurückschneidet, und nach Spur 1E, weil dieselben Dateien.

*Dateien:* wie Spur 1E, dazu packages/eval-engine/src/dice-events.ts.

*Tor:* Engine-Zahlen unberührt, Dumps und Prosa-Pins, chance-Pins 573756 t73 und 649664 t23 stehen.

- [ ] **T22 · Chance ohne Würfel als eigene Klasse ausweisen** (Bericht, Runde, mittel, verlustfrei D4, braucht T110)

  Seit dem Baum ab Zug 1 wächst das Glückskonto ohne Würfel: 649664 sagt 'The rolls decided it (+104%)' bei 17 % Würfel-Deckung (Konto +2,085, vor dem Umbau +0,584), 653785 bei 6 %; die Karten 649664 t9 und t12 sagen 'how the turn rolled' (+28 %, +32 %), obwohl der einzige Wurf gegen BKC lief.

  *Nutzen:* Der Spielbericht erzählt kein Glück mehr, wo die Engine umbewertet hat; heute betrifft das 3 von 6 Singles- und 1 von 4 Doubles-Berichten im Korpus.

  *Erfolg:* 649664 und 653785 sprechen 'The rolls decided it' nur, wenn Würfel in derselben Richtung mindestens die Hälfte des Kontos tragen; Karten ohne Würfel in Richtung des Rests sagen nicht 'how the turn rolled'; die chance-Pins 573756 t73 und 649664 t23 stehen; gemessen an den zehn Dumps, Singles und Doubles. *Plan T22:* Backlog-Plan, Abschnitt T22 (Runde 62 neu gefasst).

- [ ] **T59 · Kein Lob auf einem verlorenen Zug** (Bericht, Mini-Runde, klein, verlustfrei D4, braucht T110 und T22)

  653785 Zug 10: 'BKC played Hydro Pump, a read that paid off', obwohl Hydro Pump ins Leere ging (31 auf 44 % für 3d). Das Lob rechnet aus der gespielten Zelle; mit dem Wert der Folgewurzel wäre der Payoff −0,296. Erst nach T110 und T22 neu lesen; bleibt der Fall, prüft das Lob die Folgewurzel.

  *Nutzen:* App: kein Lob mehr für einen Zug, der ins Leere ging (ein Satz im Korpus); klein.

  *Erfolg:* 653785 Zug 10 ohne Lob, 2663093831 Zug 1 behält sein Fenster-Lob, kein anderer Prosa-Pin bewegt sich. *Plan T59:* Backlog-Plan, Abschnitt T59 (Runde 62 neu gefasst).

## Welle 2 · Spur E · Panel und Knöpfe

Zug-Knöpfe mit dem Typ beim Einsatz und ein Panel, das die Herkunft eines Spreads nennt. Nach Welle 1, weil Spur 1B den Zugkern und Spur 1D den Team-Bau ändert.

*Dateien:* src/lib/picker-state.ts, branch-Zustand der Vorschau, packages/replay-core/src/team-info.ts, Herkunfts-Etiketten.

*Tor:* UI-Tests und e2e, Set-Diff 0.

- [ ] **T85 · Zug-Knöpfe zeigen den Typ beim Einsatz** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  gen9ou-2658659909 Zug 37, der Knopf Ivy Cudgel von Ogerpon-Wellspring ist Grass, der Zug landet als Water; auf 11 Bank-Stellungen 9 falsche Knöpfe auf 6 Stellungen, Singles und Doubles (Sonde t85-type). Weg: auf den Pfaden live und stored den Simulator fragen (ModifyType-Handler wie in useMoveInner), nur der Pfad snapshot ohne Kampf nimmt moveAtUse oder den Katalog.

  *Nutzen:* App: Farbe und Beschriftung der Zug-Knöpfe stimmen; auf den geprüften Stellungen sind es 9 falsche Knöpfe auf 6 von 11, ohne dass eine Engine-Zahl sich bewegt.

  *Erfolg:* Die Sonde zeigt 0 Abweichungen, Tera Blast nach dem Klick eingeschlossen; keine Engine-Zahl bewegt sich. Läuft nach Spur 1B, weil die den Zugkern ändert. *Plan T85:* Backlog-Plan, Abschnitt T85 (Runde 62 neu gefasst).

- [ ] **T69 · Das Panel nennt die Herkunft eines Spreads** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  gen9ou-2658659909, alle 12 Körper tragen fitted; 6 kommen aus der Vorlösung zurück, nachdem die volle Lösung ihre Schadenszeilen verworfen hat, alle mit den EVs des Schätzwerts (Tyranitar Adamant 0/252/0/0/4/252), 4 weitere aus der vollen Lösung ebenfalls unverändert (Sonde t69-split).

  *Nutzen:* App: Das Etikett sagt, wer geprüft hat; in der Szene fallen 10 falsche fitted-Stempel von 12 weg, bei Set-Diff 0.

  *Erfolg:* Ein Eintrag mit EVs und Natur des Schätzwerts behält dessen Etikett, ein Eintrag aus Zugreihenfolge oder Übertrag sagt das, fitted steht nur an Spreads mit tragender Schadenszeile; Set-Diff 0 auf Bank und Feedback-Harness; Zählung über Bank und Feedback getrennt nach Singles und Doubles. Kommt T26 vorher, braucht es ein Etikett für aufgefüllte Spreads. *Plan T69:* Backlog-Plan, Abschnitt T69 (Runde 62 neu gefasst).

## Welle 2 · Spur F · Skala

Das Doubles-K am Blatt und die Prozent-Anzeige. Billig, aber zur Hälfte Skala, darum gelesen mit dem Bank-Instrument, das Skala von Gewinn trennt (Schritt 1 von T52 läuft vor Welle 1).

*Dateien:* packages/eval-engine/src/winprob.ts, search/leaf.ts (K am Blatt), Anzeige der Prozente.

*Tor:* Bank mit K der Bank und eigenem K je Phase, Doubles-Tier-Zählung, Anzeige-Kalibrierung.

- [ ] **T52 · Doubles-K am Blatt, gelesen gegen die Skala** (Re-Fit, Mini-Runde, klein, score-berührend D3)

  Doubles-K am Blatt als billiger Kandidat (1,987 + 3,666 × Anteil gefallener Pokémon). Schritt 1 baut der Integrator vor Welle 1: scripts/paired-calibration.mjs druckt neben der heutigen Zeile eine mit eigenem K je Phase (Regel in D3), weil ein reines Umskalieren je Phase in Doubles schon −35 bp bringt. Dann der Kandidat, zweifach gelesen, dazu die Doubles-Tier-Zählung.

  *Nutzen:* Engine: ein billiger Doubles-Hebel am Blatt (bis −20 bp je Stellung, unaufgelöst) und ein Bank-Instrument, das Skala von Gewinn trennt.

  *Erfolg:* Doubles-Zeile mit eigenem K je Phase aufgelöst besser, kein gepoolter Schaden; Doubles-Noten bewegen sich nur mit Lesung. Der Singles-Teil (gedeckeltes K) entfällt. *Plan T52:* Backlog-Plan, Abschnitt T52 (Runde 62 neu gefasst).

- [ ] **T51 · Prozent-Anzeige, die mit dem Spielverlauf sicherer wird** (Bericht, Runde, klein, verlustfrei D4 mit Re-Pins)

  Die Prozent-Anzeige (DISPLAY_K 1,85, winprob.ts:72 und :85) zeigt späte Stellungen zu zaghaft: spät angezeigt 76 %, gewonnen 88 bis 91 % (Singles), Doubles noch mehr. Weg: Phasen-Form der Anzeige, VGC-K getrennt prüfen.

  *Nutzen:* App: die Prozentzahl, die der User sieht, trifft späte und Doubles-Stellungen besser (rund −60 bp Anzeige-Kalibrierung); kein Urteil bewegt sich.

  *Erfolg:* Anzeige-Kalibrierung spät und Doubles besser (rund −60 bp auf allen Basen), Mitte nicht schlechter; bewiesene Wurzeln mit Masse unter 1 werden nicht übertrieben (649664 Zug 24 zeigt nicht 98 %, solange ein 20-%-Fehlschuss offen ist); kein Urteil bewegt sich. *Plan T51:* Backlog-Plan, Abschnitt T51 (Runde 62 neu gefasst).

## Welle 3 · Spur A · Fitter und Doubles-Schaden

Der Spread-Löser: Doubles-Schaden messen (T31), Angreifer ohne Angriff (T26), ein Fit-Feld wie der Simulator (T86). Sichtbar im Panel, groß im Aufwand. Nach Spur 2A, weil T31 und T86 dieselben Rechner-Eingaben lesen.

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

Hinweis-Terme und Feld-Paar für Doubles früh, dann der Re-Fit der Statik (Modellform, Status-Faktor, Boost-Gewicht) und zuletzt die Q5-Sichtung. Eine Spur, weil alle vier dieselben Gewichte fitten; nach Spur 1B, weil der Fit auf dem neuen Zugkern laufen muss.

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

  Die Modellform der Statik mit Re-Fit: Phasen-Terme, Status-Faktor (Poison Heal, Guts, Quick Feet, Marvel Scale werden heute bestraft; Korrektur ohne Re-Fit schadet, Singles-Bewegung 0,085), Boost-Gewicht (T49). Braucht T81 (neuer Zugkern), nicht T52.

  *Nutzen:* Engine: die Decke der Statik liegt bei +16 bp (mit Modellform +32), und seit Runde 61 ist die Statik Blattwert jedes Baums; der Re-Fit ist der Weg dorthin.

  *Erfolg:* Fit-Korpus-Gewinn wie Runde 58 (+16,8 bp) bestätigt auf der Bank, gelesen mit eigenem K je Phase; Singles und Doubles getrennt. *Plan T102:* Backlog-Plan, Abschnitt T102 (Runde 62 neu gefasst).

- [ ] **T39 · Q5 · Redundanz und Optionswert, Sichtung zuerst** (Q-Runden, Runde, groß, score-berührend D3, braucht T81)

  Früh im Spiel liegt die Engine bei vielen Singles-Stellungen falsch und ist sich dabei sicher: Bei 82 von 193 frühen Singles-Stellungen der Bank liegen beide Zweige falsch. Muster: ein Material-Vorsprung, während die Seite nur noch eine einzige Antwort auf den gegnerischen Sweeper hat. 655336 Zug 23: Die Engine wählt den schnellen Kill und gibt die HP-Marge des letzten Mons auf. Ein Feature zählt, wie viele Antworten eine Seite je Bedrohung übrig hat. Vorher zehn Fehlstellungen von Hand sichten; sagen weniger als sechs „ja, fehlende Antwort“, endet die Runde dort.

  *Nutzen:* Bei Erfolg besserer früher Singles-Brier auf 193 Bank-Zeilen mit heute 50 % Vorzeichen; Erwartung klein (acht Boost-Anläufe verloren), die Sichtung von zehn Stellungen entscheidet für rund eine Stunde.

  *Erfolg:* Erst Held-out-Gewinn in der CV (mindestens 16 von 20 Seeds), dann früher Brier (Stand 0,2562) und frühe Sign-Accuracy (54 %) besser bei unveränderter später Zeile. *Plan T39:* 9 Schritte, 3 offene Entscheidungen.

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
| Simulation und Suche | T109, T110, T113, T114 |
| Werkzeug | T43, T101, T103, T108, T111 |
| Statik | T81 |
| Tempo | T112 |
| Zufall preisen | T16, T78 |
| Sets und Spreads | T26, T28, T31, T80, T86, T89 |
| Bericht | T17, T18, T19, T22, T51, T59, T64, T116 |
| Oberfläche | T20, T68, T69, T85 |
| Regelfehler | T96 |
| Richter und Bank | T45 |
| Rechner-Treue | T72, T76, T83, T84, T100 |
| Nachbau | T115 |
| Re-Fit | T49, T52, T102 |
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
| 573756 t68 (seit Runde 32) | Stand 05.10.: Knock Off liest ohne Fehler-Band (Regret 0,029). Der Boden hält jetzt (Ergebnis −0,448 unter dem Boden −0,359); der Opfer-Satz fehlt, weil ohne Band kein Opfer-Stempel entsteht. | T17 |
| 573756 t73 (seit Runde 32) | chance und Key Moment sind seit Runde 40 gepinnt (dbffb5f). Stand 05.10.: Die Bar-Hälfte trägt (Score −0,6009 gegen beste Zeile −0,6544, Lücke unter 0,1); die Note für Body Press ist nach der Monte-Carlo-Sonde der Runde 62 echt. Ob der Pin auf truth geht, entscheidet das nächste User-Gate mit Re-Pins. | T16 (Re-Pin-Frage am Gate) |
| 648453 t13 (seit Runde 33) | Stand 05.10.: HP Ice liest inaccuracy (Regret 0,10), weil die Nachprüfung aus der ersten Ziehung vertieft (T16); das erfundene Heat Wave ist der beste Zug (T89). Offen ist p2-read für BKCs Lopunny-Wechsel (T17). Das Sensitivitäts-Etikett steht seit Runde 61 still. | T17, T89, T16 |
| 653785 t19 | Die Null-Zug-Hälfte steht seit Runde 5. Offen (User 18.09.): der Hazard-Sack. 3d wechselt das todgeweihte Weavile in die Stealth Rocks, Flare Blitz geht ins Leere, Lopunny-Mega kommt gratis rein; die Engine las bis Runde 56 quiet und empfahl Tornadus-Therian in den Flare Blitz; seit Runde 57 liest sie shift und nennt den Weavile-Wechsel knapp als besten Zug, lobt den Sack aber nicht (Pin seit dem User-Gate der Runde 57 auf shift). | T17 |
| 649664 t23 | observed steht seit Runde 42 auf chance. Die Bar liest 0,79 statt 0,92, weil der Beweis den nächsten 80-%-Hydro-Pump offen lässt, keinen Crit (Runde 62). Der Odds-Satz rendert in keinem Korpus-Zug mehr. | T19, T18 |
| Draft-Spiel t48, 573756 t70 | Chance-Buchung ohne Würfel: Der Read-Payoff verpufft (t48), die Setup-Auszahlung kommt eine Bewertung zu spät (t70, liest heute quiet mit −0,145). | T22 |
| GPL DzBQ5azlO5l t13 | Heavy Slam liest ohne Fehler-Band. Stone Edge fehlt im Set (gen9ou 0,35 %, eine Grenze der Rekonstruktion); mit von Hand nachgetragenem Stone Edge entscheidet die Vertiefung aus der ersten Ziehung die Zelle Air Slash gegen Stone Edge. t15 liest in Auto richtig (Vileplume-Reue 0 bis 0,018 in drei Seed-Sätzen, Runde 62) und ist erledigt. Fixture `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | T16 |
| smogtours-gen9ou-750267 Weavile | Steht mit Jolly 0/0/0/0/0/252 bei 41 Schadens-Beobachtungen und 11 Zugreihenfolgen: Die erfüllte Reihenfolge hält das Tempo, das Budget zahlt es aus dem Angriff. Bank-Bau und App-Bau gleich. | T26 |
| smogtours-gen9ou-751207 t6, VGC 2629703929 t10 | Tera in der Statik: Ceruledge (Tera Kampf) galt als immun gegen Body Press; Koraidon (Tera Feuer) las −0,645 statt −0,396. Der Träger T57 ist seit Runde 54 erledigt; ob die Szenen noch falsch lesen, prüft T81 beim Bau. | T81 |

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
- [ ] Favor-Grenze prüft nur das Vorzeichen (655336 bucht +2,05 ab t5 als Resolution) → Größen-Bedingung nachrüsten, sobald ein echtes Glücksereignis eines Start-Ziel-Siegers als Resolution gebucht wird (`report.ts`: `favorBoundary`, `resolutionTurns`).
- [ ] Setup-Züge ohne Feed bleiben bewusst unentlastet (573756 t70, zweiter Schwerttanz: heute Regret 0,075, kein Tier) → handeln, falls der Experte solche Spots reklamiert; Gutschrift nur mit Floor-Anker, sonst Ergebnis-Wäsche.
- [ ] 648453 t13 HP Ice: Regret 0,1288 (inaccuracy) → erreicht er wieder 0,2, ist die erste Hälfte des Gaps erneut offen.
- [ ] 573756 t68: chanceDelta +0,0749 für die opfernde Seite → fällt der Wert unter 0,02, reicht für T17 die strenge Opfer-Schwelle ohne Aufweichung.

Engine und Messung:

- [ ] Der Set-Rückfall für Doubles und VGC ist fest auf Gen 9 verdrahtet (`src/lib/smogon/format-fallback.ts`): Ein Doubles-Replay vor Gen 9 bekäme Gen-9-Sets. Heute ist jedes Doubles-Replay in Bank, Fit-Korpus und Feedback-Lauf Gen 9 → handeln, bevor ein älteres Doubles-Spiel in eine Messung kommt.
- [ ] Ein neuer Live-Zugriff in `pairThreat` oder `singleMoveFraction` braucht seinen Schlüssel-Term in `pairKey` (Runde 49: HP, Typen und Basiswerte fehlten, Doubles-Zellen wichen von Lauf zu Lauf ab) → bei jeder Änderung an `score/threat.ts` den Test `threat-memo.spec.ts` um den neuen Zugriff erweitern. Seit Runde 54 trägt der Schlüssel den Tera-Typ neben den rohen Typen, für Angreifer und Verteidiger (be95961); ein Blatt, das die lebenden Typen liest, ist damit gedeckt, der Fall steht in `threat-memo.spec.ts`.
- [ ] Das Gegnermodell liest eine Doubles-Paar-Zeile nur am ersten Slot (`isSwitchChoice` in `opponent-model.ts`); in Doubles wird es deshalb selten sicher (Favorit ab 0,6 auf 10 von 496 Seiten) → handeln, wenn der Read in Doubles gebraucht wird (T42).
- [ ] 573756 Zug 134 bis 136: Die Decided-Erkennung nennt seit Zug 92 die richtige Seite, der Balken steht bei 0,33 bis 0,60, weil die Suche den Struggle-Plan über zwölf Plies nicht ausrechnet. Seit Runde 50 schweigt der Satz dort bis Zug 137 → mit T109 messen (2400 Durchläufe; T33 ist in Runde 62 geschlossen): Steht der Balken ab Zug 134 bei 0,7, spricht der Satz von selbst früher.

- [ ] Der Spread-Löser gibt GPL-Cobalion Timid bei 252 Angriffs-EVs: Natur und EVs stammen aus unvereinbaren Vorlagen. Der beobachtete Treffer (106) beweist den Fehler nicht, er bindet Cobalions Angriff und Noiverns Verteidigung gemeinsam → handeln, wenn eine Fitter-Runde denselben Widerspruch an weiteren Sets zeigt.
- [ ] Die Bring-Beschränkung fällt in kurzen VGC-Spielen still weg: `replayBringOnly` liefert null, sobald eine Seite weniger Arten zeigt als die Bring-Zahl (2634199230: 3 von 4 nach sechs Zügen). `|teamsize|` nennt nur die Zahl 4, nicht die vier Arten → handeln, wenn ein gemessenes Urteil daran hängt.
- [ ] Die Harness-Fixtures tragen einen älteren Datenstand als `.smogon-cache` (gen6ou: 292 gegen 297 Arten, Datei vom 14.08.) und bewegen 4 von 72 Singles-Sets in 649664 und 655336 → beim nächsten Neu-Aufzeichnen der Fixtures mit bewegten Pins in genau diesen beiden Spielen rechnen.
- [ ] Doubles-Urteile springen zwischen zwei Zuständen einer Runde (Runde 54, VGC 2629703929): Mit dem lebenden Verteidiger-Typ entsteht in Zug 11 ein Blunder (Reue 0,00 auf 0,51), mit der STAB-Regel verschwindet er wieder (0,01), und in Zug 9 entsteht ein anderer (0,12 auf 0,48). Seit Runde 56 (T58) ist eine Doubles-Wurzelzelle der Matrix mit Würfel-Ereignis die Mischung ihrer Klassen oder das Mittel von acht Ziehungen. Die Frage beantwortet das nicht: Zug 9 bis 11 laufen über MCTS (Fainted-Anteil 0,50 bis 0,63), der Paar-Plan erreicht sie nur über Verify-Zellen, und ihre Reuen stehen in Runde 55 und 56 gleich (p2 0,1043, 0,1022, 0,0437) → beim nächsten Wechsel der Doubles-Statik dieselben Züge vergleichen; springen sie dann, liegt es nicht an der Matrix-Zelle (mit T78 lesen).
- [ ] Warnung der Runde 54 auf der Bank: Doubles Mitte hq +96 bp [+8, +198] auf 49 Stellungen (mit der STAB-Regel +98 [+11, +196]); drei Stellungen tragen 92 davon (smogtours-gen9doublesou-937928 Zug 6, -913993 Zug 6, -939625 Zug 8, alle lesen nach der Korrektur freundlicher für den späteren Verlierer) → Runde 56 hat sie kaum bewegt (937928 Zug 6: 0,4718 auf 0,4719, 913993 Zug 6: 0,05266 auf 0,05272; 939625 Zug 8 läuft über MCTS und ist byte-gleich), gelesen hat sie noch niemand → bei T31 zuerst lesen.
- [ ] `gimmickSuffixForSlot` (`branch/protocol-choices.ts`) prüft den Slot, nicht den Körper hinter dem Doppelpunkt: Steht im Nachbau ein anderer Körper im Slot, terastallisiert der falsche (gemessen am Simulator in der Vorbereitung der Runde 54, `docs/perf/probes/2026-09-20-r54/T57/wf1/check-teraloss.md`). Ein Namensvergleich trägt nicht, weil die gebauten Sets die Art als Namen führen und das Protokoll den Spitznamen. Wie oft der Nachbau dort abweicht, ist ungemessen → zählen, wenn eine Runde den Nachbau ohnehin durchläuft.
- [ ] Ein K. o., der nur im Nachbau passiert, kostet mehr als die Tera-Markierung (Runde 54): Der Simulator räumt alle Volatiles ab (Substitute, Leech Seed, Encore), setzt `isStarted` und `lastMove` zurück; die Korrektur stellt nur KP, Status, Boosts und seit Runde 54 die Markierung her. Eine vom Simulator abgelehnte Wahl beantwortet der Nachbau mit `default`, und der terastallisiert nie (die Markierung kommt an der nächsten Grenze zurück, der Zug selbst bleibt untreu) → handeln, wenn eine Stellung mit verlorenem Substitute in einem Dump oder einer Bank-Spitze auffällt.
- [ ] `parsePlayedActions` (`played.ts`) führt auf einem Zug mit `|cant|` keine Aktion, also auch kein Tera: Der Abgleich „gespielt gegen Optionen“ sieht den Tera-Klick eines zurückgezuckten Körpers nicht → mitnehmen, wenn T59 oder T64 an `played.ts` bauen.
- [ ] Der App-Bau widerspricht 7 von 910 beobachteten Singles-Zugreihenfolgen der Bank und 8 von 267 in Doubles (Runde 53; vor T66 waren es 20, der Bau mit einer Lösung bricht 10). Diese 15 Zeilen bricht jeder Bau, auch der ohne Evidenz: vier mit dem Tempo-Maximum auf beiden Seiten (darunter der einzige Choice Scarf), fünf ohne ein einziges Tempo-EV auf beiden Seiten, sechs gemischt, Stoff für die Set- und Löser-Spuren (T30 ist in Runde 62 geschlossen; Liste in `stage-trace.json` unter `stillBroken`) → nach jeder Set- oder Löser-Runde neu zählen (`docs/perf/probes/2026-09-20-r53/T66/stage-trace.vt.ts` mit `T66_CODE=after`, Stufe `app`, 17 s; ohne den Schalter scheitert der Identitäts-Test der Sonde am neuen Übertrag); steigt die Zahl, vor der Bank nachsehen. Die Sonde rechnet eine Mega-Entwicklung mit dem Tempo der Grundform. (Darunter 2663093831 Zug 7: Orthworm 166 gegen Incineroar 156, im Log trifft Flare Blitz Orthworm, bevor es zieht; die Lesung der Runde 56 hat die Zeile wiedergefunden. Dazu 937928 Zug 4, eine Encore-Notiz aus T75.)
- [ ] `carryPreSolve` (`team-builder.ts`, bis Runde 53 `carryItemDecisions`) gibt einem Pokémon, das die Volllösung verwirft und aus ihrem Ergebnis streicht, den Eintrag der Tempo-Vorlösung zurück. Ohne Item sind das 165 Einträge auf den 129 Bank-Replays, 9 davon bewegen ein Set (8 Replays); wie oft der mittlere Zweig greift (verworfen, aber vom Log mit festen KP im Ergebnis gehalten), ist ungezählt. Die Aussage zum Item-Zweig (kein Treffer in den 139 gemessenen Replays) stammt unverändert aus Runde 52 → wer die App auf eine Lösung zurückbauen will, braucht zuerst einen Fall für den Item-Zweig.

- [ ] Ein Play-out verheizt eine Win-Condition in falscher Reihenfolge (Draft t56 bis t62 hält seit Runde 42 per e2e-Pin) → bei einem weiteren Fall Q5 (T39) vorziehen.
- [ ] Früher Brier: Runde 40 kostete früh 28 bp hq (0,2569 → 0,2597), spät gewann sie 84 bp; Verdacht: exakte HP-Körper geben früh zu extreme Balken → bei jeder Fitter-Runde die frühe hq-Spalte vorregistrieren; handeln, wenn zwei Runden hintereinander früh verlieren.
- [ ] hq-Tranche: n=548 (410 smogtours plus Ladder ab Rating 1700; der Ledger nennt je nach Runde 547 oder 548) → Tranche neu schneiden, wenn n unter 500 fällt oder eine neue Tranche das Verhältnis kippt.
- [ ] 648453-Divergenz (einziger Premature-End-Rest, 1 Block von 270) → Backstop nur, falls die Rate mit dem Korpus wächst.

- [ ] Bewegte MCTS-Züge, deren Urteil nicht am umgepreisten Zug hängt (Runde 57, 648453): Neue Hinweise an der Wurzel (Hidden Power Ice in Zug 23: 0,21 → 0,85) ordnen die Baum-Expansion um, ziehen den einen Zufallsausgang jeder Wurzelzelle neu (Chance-Knoten aus) und ändern, welche Zellen die Nachprüfung neu preist (Zug 24 und 33; Zug 31 eine neu gezogene 70-%-Zelle). Fast jede Zelle eines MCTS-Zugs bewegt sich (Zug 23: 26 von 28 Zellen), obwohl kein Urteil am Wurzelpreis von Hidden Power Ice hängt → handeln, wenn ein Pin nur an so einer Verschiebung hängt; Hebel: Baum-Varianz messen (mehr Bäume oder Iterationen), bevor ein Urteil gelesen wird.
- [ ] Golden 655336 driftet seit vor Runde 57 in acht Punkten (fehlende Schlüsselmomente Zug 6, 13 und 26, zusätzlicher Schlüsselmoment Zug 27, fehlender Fehlzug 26:p2, fehlender Read 13:p1, zusätzlicher Read 27:p1, Wendepunkt 3 statt 4); T81 nimmt zwei davon weg, beide über Lopunnys Return, Zug 6 nur gegen eine Zeile, die der gesperrte Bisharp nicht klicken kann → beim nächsten Golden-Refresh am User-Gate gesammelt lesen.
- [ ] 20 falsche Treffer außerhalb aller Familien (Schiedsrichter der Runde 57, Zeile „ohne Familie“: Air Balloon, Psychic Terrain, Armor Tail gegen Priorität) → handeln, wenn einer davon ein Urteil trägt; Hebel: Familien im Schiedsrichter anlegen und zählen.
- [ ] Der Pin 653785 Zug 19 steht seit Runde 57 auf shift, und das hängt an wackeligen Zahlen (Runde 57, Verdikt-Check): → Weavile führt nur mit 0,0032 vor Pain Split, der Wechsel quiet → shift liegt in der Lücke zwischen Score und gameValue der Wurzel (auf gameValue las der Zug schon in Runde 56 shift), und der Gewinn lehnt sich an Tornadus-T als Antwort auf Dragonite. Das Spiel widerlegt das in Zug 24: Die vierfach effektive Hidden Power löst Dragonites Weakness Policy aus, die die Engine nicht kennt → handeln, wenn der Pin wieder kippt oder ein Weakness-Policy-Term gebaut wird; Hebel: Pins auf gameValue statt Score lesen, Weakness Policy in der Statik.

Umgebung:

- [ ] e2e „branch replay play controls stay muted without audio errors“ sah in Runde 50 zwei Seitenfehler aus dem Replay-iframe (`$ is not defined`, danach `reading 'length'`): 1 von 2 vollen Läufen rot, einzeln 10 von 12 grün auf dem Branch und 6 von 6 auf der Basis. Ein Showdown-Skript läuft, bevor jQuery geladen ist (dieselbe Familie wie der Config-Routes-Fix e019a73) → handeln, wenn der Test ein zweites Mal ein Gate kippt; Hebel: Ladereihenfolge der dynamischen Skripte im Embed, oder der Test wartet auf `window.$` im iframe, bevor er Fehler zählt.
- [ ] Browser-Build ist Teil des Feedback-Ankers: Ein Chromium-Wechsel verschiebt die letzte Gleitkomma-Stelle (573756 t81 Verify-Auswahl) → jedes Playwright-Upgrade ist eine Re-Verankerung mit `FEEDBACK_DUMP=1`; Stand `@playwright/test ^1.62.1`.
- [ ] TypeScript bleibt auf 6.x, bis typescript-eslint den nativen Compiler parst; `@types/node` folgt dem CI-Node-Major (24) → Peer-Range beobachten.
- [ ] Wöchentlicher Versions-Check von `@pkmn/sim` (ab der Übernahme am 26.09., Pin 0.10.11) → bei neuer Version ein Upgrade-PR nach D24.
- [ ] Screenshot-Sonde `docs/probes/2026-09-03-css/` (32 Tests, 34 Screens, 0 Pixel Toleranz; Start über `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`; ihre baseURL steht fest auf Port 5174, `--dev-port` erreicht sie nicht) → als Pixel-Gate für jede UI-Runde wiederverwenden; Baseline mit `--update-snapshots` neu aufnehmen, wenn Copy oder Layout sich bewusst ändern.

Geparkte Branches:

- `r54-stab` (252ade4): Runde 54 mit der STAB-Regel nach den Spielregeln (d8eb0a3), gemessen und geparkt; master trägt die Regel als Commit d8eb0a3 und nimmt sie mit c910b91 wieder heraus (ein glatter `git revert c910b91` scheitert am Cache-Kommentar, den die Buchung danach geändert hat; c910b91 zeigt aber genau, was zurück muss (die Funktion `stabMultiplier`, ihr Aufruf, ihre Tests)). Referenz für T81 (STAB-Zeile; T71 ist darin aufgegangen). Bank-Ordner `.calibration/r54-review` (Spitze mit STAB) und `.calibration/r54-stab` (Schritt allein).
- `r57-power` (34f84b9, auf 74f6479): T81, die Stärke beim Einsatz, gemessen und geparkt (Bank-Schaden Doubles glücksbereinigt). Referenz für T81; ein Port geht von Hand auf die Spitze (siehe T81). Bank-Ordner `.calibration/r57-power`. Dazu `r57-with-power` (66ba26f): die erste Spitze der Runde mit T81, vor dem Zeit-Commit; ihre Kette liegt unter `docs/perf/probes/2026-09-23-r57/*-withpower*`.
- `r58-oracle` (33c93c5, auf 85eb5ad): der Wegwerf-Branch der Sichtung der Runde 58: `score/oracle.ts` rechnet den Schaden der Statik wahlweise mit @smogon/calc oder einem angepassten `getDamage` des Simulators (`EVAL_STATIC_ORACLE=calc|sim`); die Commit-Nachricht trägt die vorregistrierten Schwellen. Nie mergen; Schiedsrichter. Sonden unter `docs/perf/probes/2026-09-24-r58/`; Runde 61 (T97) hat seinen Code per `git archive` nach `docs/perf/probes/2026-10-02-r61/static/src` entpackt und dort um den Modus `mean` ergänzt, ohne Worktree.
- `r41-wide` (163efcc): weite Lesart der Tempo-Freigabe, Referenz für T26. Der Bank-Ordner ist gelöscht, die Zahlen stehen in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.

## D. Standing Rules

- **D1** Kein Push ohne Ansage. Stand 24.09. (Verdikt der Runde 57): origin/master steht auf e7f618f (Runde 55), origin/v1 auf dem master-Stand nach Runde 57. Zuletzt gingen `v1` und master am 21.09. um 17:18 gemeinsam zu origin (Runde 55); seither folgt nur `v1`. Seit dem 20.09. trägt der Branch `v1` bei origin den master-Stand: nach Runde 52 (User-Freigabe 14:50: „auf einen v1 branch, den du pushen darfst“), nach Runde 53 (User-Gate 16:22, „3a“), nach Runde 54 (User-Gate 21.09. 16:21, „4a“), nach Runde 55 (User-Gate 21.09. 17:18), nach Runde 56 (User-Gate 23.09. 17:18, „2a“) und nach Runde 57 (User-Gate 24.09. 12:13, „1a“). Die Gates der Runden 56 und 57 bestätigen die Regel: Nur `v1` folgt dem master-Stand, origin/master bleibt auf e7f618f. Jede Freigabe gilt für `v1` und für den genannten Stand. Seit dem User-Gate der Runde 59 (01.10.2026) bleibt das Programm „Mehr Simulation“ auf Branch `r59`, bis Runde 62 durch ist; erst dann wird es in `v1` gemerged und `v1` gepusht.
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
- **D13** Bank: `node scripts/run-calibration.mjs --slices 6 --out .calibration/<name>` (volle Bank 200 bis 410 s; Runde 55 lief in 201 s, am 23.09. dieselbe master-Bank in 336 s und die Bank mit dem Paar-Plan in 407 s, rund 20 % mehr, weil er die 129 Doubles-Matrix-Stellungen verteuert; seit Runde 46 misst sie mit den Parametern der App, also mit Abgleich an jeder Zug-Grenze; `--env EVAL_CALIBRATION_RAW=1` ist das Instrument von vor Runde 46, `EVAL_CALIBRATION_LEGACY=1` ein Lauf je Stichprobe mit den heutigen Parametern; Basis `.calibration/base-20260918-live`, 833 Stellungen; seit Runde 47 (Bank-HP, Cache v47) ist `.calibration/r47-t46` die Basis des Code-Stands, 833 Stellungen, Brier 0,2565/0,2196/0,1222, hq 0,2468/0,1916/0,1227. Seit Runde 49 (vollständiger Merkzettel-Schlüssel, Cache v48) ist `.calibration/r49-fullkey` die Basis des Code-Stands: 833 Stellungen, Brier 0,2565/0,2196/0,1223, hq 0,2469/0,1918/0,1228; 45 Stellungen liegen anders als in `r47-t46`. Seit Runde 50 trägt jede Dump-Zeile `decidedHeld`, und die Zusammenfassung endet mit der Quote der Decided-Erkennung, roh und vom Balken gehalten (`.calibration/r50-held`: 76,7 % von 103, gehalten 94,7 % von 57; sonst ziffern-gleich zu `r49-fullkey`); `scripts/dossier-decided-losses.mjs --held` listet die Verluste unter den gehaltenen. Seit Runde 52 (20.09.) baut die Bank ihre Teams über die Kette der App (angereicherte Infos, zweistufige Lösung, HP-Evidenz); `--env EVAL_CALIBRATION_RAWBUILD=1` ist der Bau von vor Runde 52 und byte-gleich zu `base-20260920` und `r50-held`. Basis des Code-Stands ist `.calibration/r52-appbuild` (als Instrument übernommen am User-Gate 20.09. 14:50): 833 Stellungen (dieselben), Brier 0,2564/0,2197/0,1255, hq 0,2429/0,1941/0,1278, glücksbereinigt 0,2333/0,1950/0,1204, K gepoolt 2,24, Decided 76,7 % von 103 und gehalten 93,1 % von 58. Gegen den alten Bau liest sie gepoolt +11 bp [+1, +28] und in Singles +15 [+1, +39], hq +4 [+0, +7], Doubles unbewegt; 8 der 11 bp trägt eine Stellung (2658663776 Zug 86, T66). Seit Runde 53 (T66, Cache v49) ist `.calibration/r53-carry` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2566/0,2197/0,1232, hq 0,2431/0,1937/0,1275, glücksbereinigt 0,2330/0,1948/0,1177, K gepoolt 2,28, Decided 76,7 % von 103 und gehalten 94,7 % von 57; gegen `r52-appbuild` gepoolt −7 bp [−21, +0] und Singles −10 [−29, +0], 39 Stellungen in 8 Replays bewegt, Doubles ziffern-gleich; gegen den alten Bau bleiben gepoolt +4 bp [+0, +7] und Singles +5 [+0, +10], und das Skript druckt auf dieser Paarung weiter „HARM on full singles (+5)“ (die Instrumentzeile aus Runde 52, nicht das Gate der Runde 53). Seit Runde 54 (T57, Cache v50) ist `.calibration/r54-nostab` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2540/0,2207/0,1193, hq 0,2429/0,1956/0,1226, glücksbereinigt 0,2272/0,1940/0,1131, K gepoolt 2,34 (Singles 2,22, Doubles 2,55), Decided 75,9 % von 108 und gehalten 94,6 % von 56; gegen `r53-carry` Gewinn glücksbereinigt gesamt −22 bp und Singles −13 [−26, −2], Singles voll −6 [−15, +0], Doubles voll −46 [−113, +14] nicht aufgelöst, kein Schaden, eine Warnung (Doubles Mitte hq +96 [+8, +198], drei Stellungen tragen 92 davon); gemessen unter dem ersten Hash 8a0b790 des Park-Commits c910b91 (gleicher Baum); 297 Stellungen in 98 Replays liegen anders als in `r53-carry` (151 Singles, 146 Doubles): 293 tragen einen lebenden Tera-Körper, die 4 übrigen sind das Singles-Spiel gen9ou-2663110678 mit einem Soundproof-Träger. Die Zwischenstände der Runde liegen als `.calibration/r54-clickA`, `-markB`, `-key`, `-def`, `-stab`, `-flags`, `-review`. Seit Runde 55 (T74 und T70, Cache v51) ist `.calibration/r55-rebuild` die Basis des Code-Stands: 833 Stellungen (dieselben), Brier 0,2537/0,2230/0,1195, hq 0,2428/0,1957/0,1229, glücksbereinigt 0,2272/0,1943/0,1134, K gepoolt 2,31 (Singles 2,22, Doubles 2,48), Decided 75,9 % von 108 und gehalten 94,7 % von 57; gegen `r54-nostab` 5 Stellungen bewegt, alle Doubles in den drei Encore-Replays. Seit Runde 56 (T58, Cache v52) ist `.calibration/r56-shortcut` die Basis des Code-Stands (`r56-fixodds` byte-gleich): 833 Stellungen (dieselben), Brier 0,2546/0,2231/0,1197, hq 0,2444/0,1960/0,1234, glücksbereinigt 0,2290/0,1947/0,1136 (503 statt 501 Stellungen gezählt), K gepoolt 2,31 (Singles 2,22, Doubles 2,46), Decided 75,9 % von 108 und gehalten 94,7 % von 57; gegen `r55-rebuild` gepoolt +4 bp [−4, +12] und Doubles +12 [−11, +41] nicht aufgelöst, kein Schaden, eine Warnung (hq Doubles spät +15 [+1, +35]) und ein Hinweis unter 5 bp (hq gesamt spät +4 [+0, +8], dieselben 45 Doubles-Stellungen); 115 der 129 Doubles-Matrix-Stellungen bewegt, alle Singles-Zeilen und alle Doubles-Stellungen ab Fainted-Anteil 0,25 byte-gleich (die Bank rechnet diese über `mctsSearch` ohne Verify). Die Zwischenstände der Runde liegen als `.calibration/r56-base` (byte-gleich zu `r55-rebuild`), `-pattern`, `-sampler` und `-odds` (Stand 9404ccf, vor dem finalen Review; gegen ihn liest `r56-shortcut` 42 Stellungen bewegt und glücksbereinigt −1 bp). Seit Runde 57 (T73, Cache v53) ist `.calibration/r57-timing` die Basis des Code-Stands (byte-gleich zu `r57-hp` und `r57-sentence2`): 833 Stellungen (dieselben), Brier 0,2543/0,2237/0,1193, hq 0,2441/0,1967/0,1227, glücksbereinigt 0,2301/0,1957/0,1136, K gepoolt 2,30 (Singles 2,24, Doubles 2,42), Decided 78,5 % von 107 und gehalten 94,9 % von 59; gegen `r56-shortcut` Singles voll −8 bp [−18, +1] (nicht aufgelöst) und glücksbereinigt −9 [−20, +0] (aufgelöst), Doubles +18 und +24 nicht aufgelöst, kein Schaden, eine Warnung (Doubles früh glücksbereinigt +59, auf hq +78); 157 Singles- und 108 Doubles-Stellungen in 60 Replays bewegt. Die Zwischenstände der Runde liegen als `.calibration/r57-base` (byte-gleich zu `r56-shortcut`), `-body`, `-field`, `-tera`, `-hp`, `-power` (T81, geparkt) und `-sentence2`; die Bank-Läufe der Kette liefen ab `field` mit `--slices 4` (nach Bauart gleich zu 6, weil der Merge sortiert, am selben Code aber nicht nachgemessen; 417 bis 460 s, mit sechs Slices 281 bis 304 s). Seit Runde 61 (T98, Cache v56) ist `.calibration/r61-t98b` die Basis des Code-Stands (byte-gleich zu `r61-early-tree`): 837 Stellungen; die Bank rechnet über `regression/bank-search.ts` wie die App (Bäume über `searchTreesOrchestrated`, Tera der App, gespielte Doubles-Kombination), Auto-Züge ab dem ersten mit dem Baum; gegen `r61-app` gepoolt −23 bp [−45, −2], Doubles −70; ein Lauf mit `--slices 4` braucht rund 800 s. `--env EVAL_SEARCH_BUDGET=<Form>` misst eine Budget-Form (`tree-from=0.25` ist die Auflösung vor Runde 61), `--env EVAL_CALIBRATION_EXPORT_ALL=1` exportiert jede Stellung mit Tera und Sleep Clause. Bank-Zahlen vor dem 20.09. stehen auf dem alten Bau und gelten nur als Vergleich innerhalb ihrer Runde oder gegen einen Lauf mit `RAWBUILD=1`; das gilt auch für fit-seitige Dumps (`EVAL_CALIBRATION_SOURCE=fit` läuft durch dieselbe Schleife, während `regression/eval-fit.spec.ts` weiter nackt trainiert). Alle Bank-Zahlen in dieser Datei und im Backlog-Plan, die älter sind als der 18.09., stammen vom alten Instrument und gelten nur als Vergleich innerhalb ihrer Runde; weitere Flags `--env KEY=VALUE` und `--tranche`). A/B = zwei Ausgabeordner, dazwischen `scripts/paired-calibration.mjs` (dort `--quality hq|std`). Positions-Export über `--env EVAL_CALIBRATION_POSITIONS=<dir>`. Ist ein Slice-Lauf ungleich einem Ein-Prozess-Lauf, zuerst die mtimes von `.smogon-cache` prüfen.
- **D14** Perf-Umbauten an der Engine tragen ihre Identität dreifach: Fixture `fork-identity.json` (neu aufnehmen nur mit `PERF_IDENTITY_RECORD=1` auf dem Vorher-Code), Engine-Suite, Kalibrierung A/B ziffern-gleich. Die A-Seite einer A/B-Messung läuft auf dem Vorher-Code (Stash oder Worktree), nie auf einer Mischung. Perf-Sonde vor und nach am selben Tag: `PERF_PROBE=1 PERF_PROBE_LABEL=before|after npx playwright test -c docs/perf/probes/2026-09-03/probe.config.ts`.
- **D15** Worktree-Abbau (Vorfall 12.09. 15:25): Junctions (node_modules, .calibration, .smogon-cache, .fit-corpus) VOR `git worktree remove` einzeln und nicht-rekursiv löschen (PowerShell `[System.IO.Directory]::Delete('<worktree>\<junction>')`), dann per Reparse-Point-Scan prüfen, dass keine mehr existiert. `git worktree remove --force` folgt Junctions und löscht ihre Ziele. Seither: jede Bank-A/B mit frischer Basis am selben Tag; Vergleiche mit Ledger-Zahlen vor dem 12.09. nur mit diesem Vorbehalt. Memory `worktree-junction-removal`.
- **D16** `ALIGNMENT_SEEDS[0]` bleibt `'1,2,3,4'`; jede Listen-Änderung ist ein Cache-Version-Event. Runde 49 hat v48 genommen (Merkzettel-Schlüssel), Runde 53 v49 (Übergabe der Tempo-Vorlösung), Runde 54 v50 (Tera im Nachbau und in der Statik), Runde 55 v51 (Encore und gesperrte Slots im Nachbau), Runde 56 v52 (Doubles-Zellenplan), Runde 57 v53 (Züge beim Einsatz; T81 bekäme bei einer Landung die nächste freie Nummer).
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
