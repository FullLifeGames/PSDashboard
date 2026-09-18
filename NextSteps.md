# Next Steps (Stand 18.09.2026, nach Runde 45)

Nur offene Schritte, als priorisierte Checkliste: Die oberste Iteration ist die nächste Sitzung, das oberste offene Kästchen darin das nächste TODO. Jedes TODO nennt das Problem an einer Spielszene und das Erfolgsmaß. Die TODOs der Iterationen 1 bis 3 tragen ihre Umsetzungsschritte hier; für alle anderen stehen sie als Checkliste im Backlog-Plan unter derselben Nummer.

- **Iterationen** bündeln die TODOs einer Sitzung. Eine Iteration wird beim Start zur Runde mit der nächsten freien Rundennummer: Iteration 1 wird Runde 46. Score-berührende TODOs derselben Iteration bekommen je ihre eigene Messung (D3), nie eine gemeinsame.
- **T-Nummern** (T01 bis T45) sind feste Namen, vergeben am 18.09. in Prioritäts-Reihenfolge. Wandert ein TODO in der Liste, behält es seine Nummer; ein neues TODO bekommt die nächste freie (ab T47; T46 kam am 18.09. in Runde 46 dazu). „braucht T01“ heißt: T01 muss vorher gelaufen sein.
- **Backlog-Plan** (je TODO: Idee, Schritte mit Dateien, volles Gate, Doubles-Abdeckung, offene Entscheidungen, Zahlen, Code-Belege): `docs/superpowers/plans/2026-09-18-backlog-plans.md`.
- **Erledigtes**: `docs/completed/` nach Gebiet (Index, Eintragsformat und Prozess in `docs/completed/README.md`).
- **Maschinen-Quellen**: Ledger in `regression/eval-calibration.spec.ts`, Pins in `e2e-feedback/corpus.ts`, Memory-Notizen.
- Diese Datei liegt seit 06.09. im Repository; `docs/` bleibt gitignored.

Die Schritte sind ein erster Entwurf vom 18.09. (Code-Stand dcf9526, jeder Code-Beleg per Grep geprüft). Jede Runde bekommt vor dem Bau weiterhin ihr Brainstorming und ihre Spec; die Schritte hier sind deren Startpunkt, und die Spec darf sie ersetzen. Ältere Dokumente nennen Q6 und Q4 gemeinsam „Runde 46“; hier sind es T06 und T09 in den Iterationen 2 und 3.

Hinter jedem Titel stehen Thema, Art, Größe (mini, klein, mittel, groß), Gate (score-berührend = D3, verlustfrei = D4, sonst ausgeschrieben) und „braucht“ = muss vorher gelaufen sein.

## Iteration 1 · Runde 46 · Messbasis und Werkzeug

Die Sitzung bringt die Messbasis in Ordnung. T01 zuerst: Seine Feedback-Dumps sind die Vorher-Seite für T02, seine Bank-Basis die Vorher-Seite für T04 (frische Basis am selben Tag, D3). Am Ende der Sitzung T05 abgekoppelt über Nacht starten.

- [x] **T01 · Messbasis neu aufbauen** (Messbasis, Vorarbeit, klein, kein Score-Touch)

  Seit dem Worktree-Vorfall vom 12.09. sind `.calibration` und `.smogon-cache` leer: kein Bank-Stand, kein Positions-Export, keine Bank-Replays auf der Platte. Die sechs Feedback-Dumps unter `docs/reports` stammen vom 12.09., 14:10 bis 14:12 (Basis der Runde 45, laut Ledger byte-gleich zu master): Für Zählungen taugen sie, ein Byte-Gate braucht frische Dumps vom selben Tag. Fast jedes TODO unten beginnt mit einer Zählung oder einer A/B-Messung und braucht diesen Boden.

  - [x] (48db172: drei Läufe byte-gleich in allen sechs Dumps und im Drift-JSON, byte-gleich zur Runde-45-Aufnahme `run-ac`, 0 von 13 Kanälen bewegt, 206 bis 227 s, Ablage `docs/perf/probes/2026-09-18-r46/base-run1..3`) Räume Port 5176 (`netstat`-PID, `taskkill //T`), lösche `docs/reports/feedback-drift.json` und fahre drei Feedback-Läufe mit `FEEDBACK_DUMP=1` auf master; prüfe die mtime der sechs Dumps und dass sie untereinander byte-gleich sind.
  - [x] (48db172: `.calibration/base-20260918`, 816 Stellungen, 338 s, Smogon-Cache neu gepinnt mit 11 Treffern und einem 404, kein 599) Fahre die Bank auf master abgekoppelt (nohup plus Marker-Datei): `node scripts/run-calibration.mjs --slices 6 --out .calibration/base-<datum> --env EVAL_CALIBRATION_POSITIONS=.calibration/base-<datum>/positions`. Der Läufer setzt `EVAL_CALIBRATION_MODE=auto` und `EVAL_CALIBRATION_SMOGON=1` selbst und pinnt dabei `.smogon-cache` neu.
  - [x] (48db172: `.calibration/base-20260918-b`, `merged.jsonl` und `summary.txt` byte-gleich; die Positions-Exporte unterscheiden sich nur in den `|t:|`-Zeitstempeln des Sim-Logs) Fahre die Bank ein zweites Mal in einen zweiten Ordner und vergleiche beide mit `scripts/paired-calibration.mjs`: Sie müssen ziffern-gleich sein (der erste Lauf füllt den kalten Smogon-Cache, das Kaltstart-Rennen vom 03.09. ist der bekannte Stolperstein).
  - [x] (129 von 129 geladen, beide Ordner gefüllt, 1,9 MB) Lege die 129 Bank-Replays wieder ab, auf beiden Wegen: Unter `.calibration/replays` liest die nackte Set-Sonde (`sets-diff.spec.ts`, Vorgabe `SETS_DIR`, ohne Smogon-Daten), unter `.calibration/replay-cache` liest die Harness-Sonde (`bank-sets.spec.ts`, Vorgabe `REPLAY_CACHE`, Ausgangsliste `bank-ids.json`); ohne den zweiten Ordner zieht die Harness-Sonde jedes Replay erneut aus dem Netz.
  - [x] (48db172: Vorgabe `.calibration/base-20260918/positions`, 95 Stellungen; ein fehlender Ordner meldet sich jetzt, statt still nur die Fixtures zu fahren) Richte die Vorgabe des Prüfstands auf den neuen Positions-Export (oder übergib `EVAL_ENDGAME_POSITIONS`), damit T08 und T37 ohne Umweg starten.
  - [x] (48db172: Ledger-Eintrag MEASUREMENT BASE 2026-09-18; Kopfzahlen 54/61/82, Brier 0,2564/0,2242/0,1285, K 2,19, hq 0,2491/0,2031/0,1286, zeichengleich zum übernommenen Runde-45-Stand) Trage Datum, Commit, Ordnernamen und die Kopfzahlen der Bank (Brier früh, mittel, spät, hq, K) als Basis-Vermerk in den Ledger ein.

  *Erfolg:* Zwei Bank-Läufe auf master sind ziffern-gleich, drei Feedback-Läufe byte-gleich, Positions-Export und Bank-Replays liegen wieder auf der Platte, der Stand steht mit Datum im Ledger.

- [x] **T02 · Harness-Hygiene: Feedback-Starter und knip-Gate** (Werkzeug, Mini-Runde, klein, verlustfrei D4)

  Ein Feedback-Lauf startet, Vite bündelt noch seine Abhängigkeiten, die Seite lädt neu, der Graph bleibt leer: „sweep produced no scores“ (Runde 45: einer von fünf Läufen). Nach dem Lauf bleibt der Vite-Server auf Port 5176 stehen, der nächste Lauf stirbt am Port, und am 05.09. überschrieb eine verwaiste Seite per HMR drei Dumps. Die Feedback-Suite bekommt den Starter der e2e-Suite (`scripts/run-e2e.mjs`). Im selben Durchgang wird das knip-Gate grün (`@testing-library/dom`).

  - [x] (Vorher-Zahl: 1 von 25 Feedback-Protokollen unter `docs/perf/probes/`, in der Byte-Serie der Runde 45 einer von fünf: `feedback-run3.log`, erstes Replay 573756, leerer Graph) Zähle die Kaltstart-Ausfälle in den Lauf-Protokollen der Runde 45 und halte die Quote als Vorher-Zahl fest.
  - [x] (99b00f2: eigene Fahne `--dev-port` oder `PS_DEV_PORT`, wird aus der Argumentliste genommen, weil Playwright kein `--port` kennt und eine nackte Zahl als Testfilter läse) Erweitere den e2e-Starter um den Port als Argument (scripts/run-e2e.mjs:5 hat 5174 fest verdrahtet); die Playwright-Config reicht er schon durch (Zeile 114 hängt alle CLI-Argumente an, so startet die CSS-Sonde per -c), damit e2e und Feedback denselben Startweg nehmen.
  - [x] (99b00f2: webServer-Block entfernt, `test:feedback` startet über den Starter; beide Configs öffnen die Seite als `http://127.0.0.1:<port>`, also auf dem Socket, den der Starter besitzt; knip kennt die Suite-Configs über den Playwright-Plugin-Eintrag) Hänge die Feedback-Suite an den Starter: den webServer-Block aus der Config nehmen und das npm-Skript `test:feedback` auf den Starter umstellen.
  - [x] (99b00f2: Verbindungsprobe auf 127.0.0.1 und ::1, meldet und bricht ab, räumt nie selbst; von Hand geprüft mit einem Schein-Listener je Adresse) Ergänze im Starter einen Port-Vorcheck, der einen belegten Port meldet und den Lauf abbricht, statt gegen einen Waisen-Server zu testen.
  - [x] (sechs Feedback-Läufe und zwei e2e-Läufe über den Starter: nach jedem Lauf kein Listener auf 5176 oder 5174, nie ein Kill nötig; neu dazu: SIGINT, SIGTERM und SIGHUP räumen Playwright und Vite ab. Unter Windows nicht automatisiert geprüft, ein erzwungener Kill des Starters läuft an jedem Handler vorbei) Belege den Teardown: nach einem Lauf horcht kein Prozess mehr auf dem Port, geprüft per netstat und im Lauf-Protokoll festgehalten.
  - [x] (entfällt: knip 6.34 ist auf dem Stand vor T02 schon grün, es zählt Peers benutzter Pakete als benutzt; das Paket bleibt in den devDependencies, `package-lock.json` unberührt) Streiche `@testing-library/dom` aus den devDependencies, weil keine Quelle es direkt importiert und jest-dom, react und user-event es als Peer ziehen; prüfe nach der Installation, dass das Paket weiter unter node_modules steht.
  - [x] (`tsc -b`, lint, knip sauber; Regression 1425 Tests grün; e2e 75 von 75 in 134 s) Lass `tsc -b`, lint, knip, die Regression und die volle e2e-Suite laufen; e2e deckt den geänderten Starter selbst mit ab.
  - [x] (drei Läufe auf dem Endstand byte-gleich untereinander und zur Basis von heute früh, 0 von 13 Kanälen bewegt, je 175 s; Ablage `docs/perf/probes/2026-09-18-r46/t02b-run1..3`) Fahre drei Feedback-Läufe mit `FEEDBACK_DUMP=1` und vergleiche die sechs Dumps byte-genau gegen eine frische Basis desselben Tages.
  - [x] (Port: melden und abbrechen, nie räumen, weil der Port einer Nachbarsitzung gehören kann. `@testing-library/dom`: bleibt, siehe oben) Vor dem Bau klären: 2 offene Entscheidungen (Plan T02).

  Rest: Startet ein Sweep nie, meldet `e2e-feedback/feedback-drift.spec.ts` weiter „sweep produced no scores“ (die Warteschleife erklärt ihn nach 30 s für beendet). Ein eigener Grund „sweep never started“ wäre ein Dreizeiler im roten Pfad; offen, bis der User ihn will. Vites Ausgabe steht seit T02 im Lauf-Protokoll, ein nächster leerer Graph ist damit zuzuordnen.

  *Erfolg:* Fünf Feedback-Läufe hintereinander ohne leeren Graphen, kein Listener auf dem Feedback-Port nach dem Lauf, knip ohne Befund.

- [x] **T03 · 653785 t19 als Wahrheit schließen** (Bericht, Mini-Runde, mini, Korpus-Re-Pin am User-Gate)

  Ergebnis am User-Gate (18.09.): kein Wechsel auf truth. Die Will-O-Wisp-Hälfte ist erledigt, aber der gespielte Zug selbst ist der Punkt: 3d wechselt das todgeweihte Weavile (63/281) in die Stealth Rocks, es stirbt beim Reinkommen, Flare Blitz geht ins Leere, und Lopunny-Mega kommt gratis rein (BKC antwortet in Zug 20 genauso mit Landorus-Therian). Die Engine liest den Zug ruhig und empfiehlt den Wechsel auf Tornadus-Therian, der den Flare Blitz frisst. Der Eintrag bleibt `gap` mit neuem `desired` (Hazard-Sack erkennen und gutschreiben); die Szene wandert nach T17.

  Der Drift-Bericht meldet 653785 Zug 19 in jedem Lauf als offene Lücke, obwohl beide gewünschten Hälften seit Runde 5 stehen (Wechsel auf Weavile mit Regret 0,0021, die Empfehlung ist ein Wechsel, Will-O-Wisp taucht nicht mehr auf). Der Eintrag wechselt von gap auf truth; dann prüft der Drift-Lauf ihn aktiv.

  - [x] (Dump von heute: quiet, p1 ohne Band, Regret 0,0021, beste Zeile → Tornadus-Therian, Will-O-Wisp auf Rang 7 von 8) Bestätige am aktuellen Dump, dass Zug 19 quiet liest, p1 kein Band trägt und die beste Zeile ein Wechsel ist statt eines wirkungslosen Zuges.
  - [x] (entworfen und am Gate verworfen; stattdessen essence-Nachtrag und neues desired im gap-Eintrag) Formuliere den Wahrheits-Eintrag mit expect auf side p1, tier none und attribution quiet und häng die Historie des Eintrags unverändert an.
  - [x] (`eval-null-moves.spec.ts` mit 11 Tests, dazu die bestNull-Tests in `eval-analysis.spec.ts`; der Wächter ist bewusst Singles-only, das Schweigen in Doubles ist gepinnt) Weis nach, dass die Null-Zug-Garantie ohne diesen Korpus-Eintrag weiterlebt, weil sie einen eigenen Unit-Anker hat.
  - [x] (User 18.09.: nein, der Hazard-Sack fehlt noch) Leg dem User den Wechsel von gap auf truth vor und trag ihn erst nach dem Ja ein.
  - [x] (f6c901c, Läufe von 12:02 bis 12:11: die Zeile bleibt wie am Gate entschieden GAP open und trägt das neue desired, 0 von 13 Kanälen bewegt, Dumps byte-gleich zur Basis) Fahr einen Feedback-Lauf und prüfe, dass die Zeile als OK erscheint statt als GAP open.
  - [ ] Vor dem Bau klären: 2 offene Entscheidungen (Plan T03).

  *Erfolg:* Die Zeile erscheint im Feedback-Lauf als OK statt als GAP open, alle anderen Kanäle unverändert.

- [x] **T04 · choicelock im Bank-Pfad bereinigen** (Messbasis, Mini-Runde, mini, score-berührend D3, braucht T01)

  Ergebnis (18.09., am User-Gate übernommen: „so wie die App“): Der Lock war nur das Symptom. Der Bank-Läufer glich das laufende Spiel nie mit dem Replay ab, nur die gemessene Kopie, und seit Runde 40 behalten ausgewechselte Pokémon die HP des Simulators. In jeder zweiten Singles-Stellung der Bank lag mindestens ein Bank-Pokémon mehr als 10 Punkte neben dem echten Wert (751533 Zug 26: Kyurem real 48 %, in der Bank 1 %). Die Bank misst jetzt mit den Parametern der App; die Engine ist unberührt. Neue Basis `.calibration/base-20260918-live` (833 Stellungen, Vorzeichen 54/65/84, Brier 0,2565/0,2205/0,1229, K 2,27, hq 0,2467/0,1930/0,1239); der alte Weg bleibt über `EVAL_CALIBRATION_RAW=1`. Zahlen, Sonden und die Einordnung der Runden 40 bis 45 stehen im Ledger (BANK INSTRUMENT 2026-09-18).

  Bank-Stellung 573756 t138: Zapdos ist in Close Combat gesperrt. In der App ist dasselbe Zapdos frei. Die Bank misst damit eine andere Stellung, als der User sieht; wie viele der 816 Bank-Stellungen betroffen sind, ist offen. Erst klären, welcher Pfad recht hat, dann den anderen nachziehen.

  - [x] (`docs/perf/probes/2026-09-18-r46/t04/lock-diff.vt.ts`: t138 ist die einzige von 138 Grenzen mit abweichendem Lock-Bild; Ursache per `lock-trace`: Toxapex stirbt im Sim einen Zug zu früh, aus „move struggle“ wird ein Ersatz-Close-Combat) Stelle die Abweichung mit einer Sonde nach: lade 573756 t138 einmal über den Kalibrierungs-Pfad und einmal über den App-Pfad und vergleiche die Volatiles und das Item des Zapdos.
  - [x] (über eine eigene Rekonstruktion statt über den Export, der nur Endspiel-Stellungen trägt: Lock-Bilder weichen an 6 von 775 gemessenen Zügen ab, in beide Richtungen; die 11 Locks auf Bank-Pokémon im Export sitzen alle auf besiegten Körpern) Zähle über den Bank-Positions-Export, wie viele Stellungen mit einem choicelock in die Bewertung gehen und wie viele davon auf dem App-Pfad keinen tragen.
  - [x] (entfällt: die Ursache liegt nicht in `corrections.ts`, sondern im Bank-Läufer; der Test, der die Voraussetzung der Runde-40-Regel pinnt, wandert nach T46) Schreibe den roten Test für den Fall, den es heute nicht gibt: der Aktive steht schon richtig, trägt aber einen Lock ohne Protokoll-Beleg.
  - [x] (058a0ab: unterlegen war der Bank-Läufer; `passInstrument` gibt dem Einmal-Pass und seinem Rückfall die App-Parameter (Abgleich an jeder Zug-Grenze, Choice-Lock-Kontext)) Ziehe den unterlegenen Pfad nach: `repointActiveSlot` steigt sofort aus, wenn der Ziel-Aktive schon steht, und nur dieser Pfad löscht den Lock.
  - [x] (`position-diff.vt.ts` und `bench-hp-truth.vt.ts`: Bank-HP 8,1 / 7,4 Punkte neben der letzten Sichtung gegen 2,4 / 1,8 mit den App-Parametern; die Sets bewegen sich nicht, der Team-Bau ist unberührt) Miss den Set- und Positions-Diff auf allen drei Pfaden (nackt, Harness, Feedback) vor der Bank, weil sonst eine blinde Bank gemessen wird.
  - [x] (alt gegen neu auf 814 gemeinsamen Stellungen: Mitte −40 bp (hq −101), spät flach, 576 Scores bewegt; RAW-Schalter byte-gleich zur Basis, zwei Läufe der neuen Vorgabe byte-gleich. Keine Feedback-Läufe, weil kein App-Pfad und keine Engine-Datei berührt ist; Regression, lint, knip, `tsc -b` grün) Fahre die gepaarte Bank und drei Feedback-Läufe und lege bewegte Kanäle dem User vor.
  - [x] (beantwortet: die App hat recht; es war weder der Lock noch das geratene Item, sondern der fehlende Abgleich des laufenden Spiels) Vor dem Bau klären: 2 offene Entscheidungen (Plan T04).

  *Erfolg:* Beide Pfade zeigen dasselbe Volatile-Bild, die Zahl der betroffenen Bank-Stellungen steht im Ledger.

- [ ] **T05 · Re-Fit: Fit neu aufnehmen und Bericht lesen (über Nacht)** (Re-Fit, Sichtung, klein, kein Score-Touch)

  Feature-Gewichte, Phasen-K und die Anzeige-Konstante `DISPLAY_K` (1,85) wurden im August gegen Teams mit einem Phantom-Siebten gefittet: 305 der 2122 Fit-Replays tragen so einen Formen-Marker. Als Runde 45 das behob, sprang das Bank-K von 1,80 auf 2,19. Der Siegbalken ist seither systematisch zu zaghaft. Dieser Teil ändert keinen Code: Aufnahme abgekoppelt über Nacht (über eine Stunde), dann den Bericht lesen.

  Falle: `EVAL_FIT=1` allein liest die alte Aufnahme. Vor dem Lauf `.fit-corpus/samples-cache.json` (Stand 09.08.) löschen.

  - [x] (18.09.: nicht gelöscht, sondern als `.fit-corpus/samples-cache-2026-08-09.keep.json` aufgehoben; der Stempel der alten Aufnahme passt ohnehin nicht mehr (zehn gegen dreizehn Feature-Schlüssel). Neu seit 4923967: die Aufnahme schneidet VGC-Teams auf die gebrachten vier, wie App und Bank) Lösche die Aufnahme-Datei des Fit von Hand, weil ihr Stempel nur Schema, Feature-Schlüssel, Gewichte und Manifest-Kennungen deckt und die Team-Bau-Änderungen der Runden 40, 41 und 45 nicht bemerkt; ohne das Löschen liest der Lauf die alten Phantom-Merkmale vom 09.08.
  - [ ] Halte fest, dass der Korpus so vollständig ist wie in den Runden 40 und 41 (2122 Logs, fünf Manifest-Einträge ohne Datei), damit die neuen Zahlen mit den alten vergleichbar bleiben.
  - [ ] Fahre den Fit neu mit `EVAL_FIT=1` und sichere die ganze Konsole als Datei im Sonden-Ordner; die Aufnahme dauert über eine Stunde, der Test-Timeout steht auf zwei Stunden.
  - [ ] Lies drei Dinge aus dem Bericht: implizierte Feature-Gewichte je Tranche mit Bootstrap-Fehler, Phasen-K je Spielart, und Brier je Phase gegen konstantes K.
  - [ ] Prüfe die Anzeige-Konstante getrennt: die Bank fittet ihr K selbst und liest jetzt 2,19, die Konstante steht seit dem 11.08. auf 1,85; ihr Wechsel ist render-only, bewegt aber die Bericht-Felder aller sechs Dumps samt der Accuracy-Zahl.
  - [ ] Vor dem Bau klären: 1 offene Entscheidung (Plan T05).

  *Erfolg:* Der Bericht liegt im Sonden-Ordner: implizierte Gewichte je Tranche mit Bootstrap-Fehler, Phasen-K je Spielart, Brier je Phase gegen konstantes K, dazu der Vergleich von `DISPLAY_K` 1,85 mit dem Bank-K 2,19.

## Iteration 2 · Q6 und Re-Fit-Übernahme

T06 ist render-only, T46 und T07 sind score-berührend: getrennte Gates. T07 braucht die Aufnahme aus T05. Entschieden am 18.09. (User): Die Re-Fit-Übernahme landet vor Q4, weil das Phasen-K jeden Score bewegt und Q4 sonst zweimal gemessen würde. Am Ende der Sitzung T08 abgekoppelt über Nacht starten, dann vergleicht der Nachtlauf schon gegen die neuen Gewichte.

- [ ] **T06 · Q6 · Prädiktiver Read vor dem Klick** (Bericht, Runde, klein, verlustfrei D4, braucht T01)

  562428 Zug 10: Der Bericht nennt die Breite des Zugs und im Rückblick den Read („The read was there for … switching to Heatran“). Vor dem Klick sagt er nichts, obwohl die Read-Linse die beste Antwort auf den wahrscheinlichsten Gegnerzug schon rechnet. Ziel ist ein Satz der Form „Wenn du X erwartest, ist Y der Zug“, der selten feuert.

  Falle: Der Bericht-Lauf bekommt heute kein `reads`-Feld, nur die Zug-Karte. Die Feedback-Pins sehen den Satz erst, wenn der Lauf `reads` mitbekommt, und das kann bestehende Read-Formulierungen bewegen.

  - [ ] Schreibe Brainstorming und Spec für den Satz: Wortlaut, die drei Auslöser (Modell-Konfidenz, Gewinn der besten Antwort, Y ist nicht die angezeigte Empfehlung), Sprechort (Zug-Karte und Bericht-Lauf) und die Doubles-Abdeckung.
  - [ ] Zähle zuerst auf den vorhandenen Voll-Dumps, wie oft der Satz feuern würde: rechne je Zug aus `graph.results[t-1].matrix` und `parseTendencies` über den Fixture-Log `computeRead` neu und miss die Trefferquote gegen das Ziel von höchstens einem Satz je zehn Zügen, getrennt für Singles und Doubles.
  - [ ] Miss die Nebenwirkung der Verdrahtung: der Bericht-Lauf übergibt heute kein reads-Feld, also zähle auf denselben Dumps, auf wie vielen Zügen `riskUnpunished` mit einem passenden Read zusammenfällt und die Formulierung von „a read“ auf „a read against the opponent's tendencies“ kippen würde.
  - [ ] Schreibe die roten Tests zuerst: ein Fall, in dem der Satz steht, und drei Fälle, in denen er schweigt (Konfidenz zu niedrig, Gewinn unter dem Fehler-Band, Y ist schon die Empfehlung), dazu ein Doubles-Matrix-Fall.
  - [ ] Baue das Signal je Seite aus `params.reads` in `signals.ts`, lege die zwei Schwellen neben `READ_CONFIDENCE` ab und sprich den Satz in `summary.ts` direkt vor der Rückblick-Zeile.
  - [ ] Reiche reads in den Bericht-Lauf durch, damit Dump und Pins denselben Text sehen wie die Zug-Karte, und halte die Reihenfolge der Sätze stabil.
  - [ ] Prüfe Doubles am VGC-Replay 2634199230 und an einem Doubles-Matrix-Test, ob der Satz dort richtig feuert oder sauber schweigt, und schreibe die Zahl in die Spec.
  - [ ] Fahre die verlustfreien Gates: drei byte-identische Feedback-Läufe mit `FEEDBACK_DUMP=1`, Kalibrierung ziffern-gleich ohne Cache-Bump, `npm run test:regression`, e2e, lint, `tsc -b`, und liste jeden bewegten Kanal einzeln auf.
  - [ ] Lege dem User am Gate die bewegten Kanäle vor und setze erst danach den Pin 562428 t10 neu (`summaryIncludes` um den prädiktiven Satz, Wechsel von gap auf truth zur Entscheidung des Users).
  - [ ] Vor dem Bau klären: 3 offene Entscheidungen (Plan T06).

  *Erfolg:* Höchstens ein Satz je zehn Zügen im Korpus (Singles und Doubles getrennt gezählt), 562428 t10 trägt den Satz mit dem Heatran-Wechsel, kein anderer Pin bewegt sich ungefragt.

- [ ] **T46 · Bank-HP: wer im selben Zug getroffen wird und geht** (Messbasis, Runde, klein, score-berührend D3)

  913994 Zug 5: Rillaboom nimmt zwei Treffer (100 → 61 → 22 %) und geht im selben Zug per U-turn. Ab Zug 6 liest die App 100 %, wahr sind 22 %. Der Abgleich mit dem Replay läuft an der Zug-Grenze und fasst seit Runde 40 nur das Pokémon auf dem Feld an: Wer innerhalb eines Zuges Schaden nimmt und das Feld verlässt, wird nie korrigiert und behält den Würfel des Simulators. Das trifft App, Bank und Fit gleich. Vorschlag aus der Sichtung: die HP eines Bank-Pokémon auf das Fenster von der letzten Sichtung bis zu einer Regenerator-Heilung darüber klemmen, statt den Körper ganz dem Simulator zu lassen. Dazu gehört der Test, der die Voraussetzung der Runde-40-Regel pinnt (`packages/eval-engine/test/bench-hp.spec.ts`: dasselbe Log einmal mit und einmal ohne Abgleich an jeder Grenze).

  Hinweis: Steht vor T07, weil die Änderung jede Stellung mit einem Pivot bewegt, in der Bank wie in der Fit-Aufnahme. Landet sie nach der Nachtaufnahme aus T05, braucht T07 eine Kontroll-Aufnahme. Der User kann die Reihenfolge drehen.

  *Erfolg:* Auf dem App-Weg sinkt die Zahl der Bank-Körper, die mehr als 10 Punkte neben der letzten Sichtung liegen (heute 144 von 1821 in Singles, 16 von 453 in Doubles, ein Teil davon echtes Regenerator), 573756 behält seine zwei regenerierten Toxapex, Bank in der vorregistrierten Linie. *Plan T46:* noch nicht ausgeschrieben; Sonde `docs/perf/probes/2026-09-18-r46/t04/bench-hp-truth.vt.ts`.

- [ ] **T07 · Re-Fit: K und Gewichte übernehmen** (Re-Fit, Runde, mittel, score-berührend D3, braucht T05, T01)

  Entschieden am 18.09. (User): Die Übernahme läuft vor Q4. Das Phasen-K sitzt am Suchblatt und bewegt jeden Score, und die Decided-Erkennung löst den Beweiser erst ab Score 0,6 aus: Wer Q4 vor dem Re-Fit misst, misst es danach noch einmal. Die K-Abbildung kommt in jedem Fall (vorregistrierte Regel aus Runde 45), ein Feature-Gewicht nur bei gepaartem Gewinn auf der hq-Tranche, `DISPLAY_K` nach der Prüfung aus T05. `DISPLAY_K` bewegt die Prozent-Sätze aller sechs Feedback-Dumps: Re-Pins am User-Gate.

  Hinweis: Nach den Fitter-Runden (T25, T26) folgt eine Kontroll-Aufnahme: eine zweite Übernahme nur, wenn sich Gewichte oder K über ihren Bootstrap-Fehler hinaus bewegen, sonst ein Vermerk im Ledger (letzter Schritt von T26).

  - [ ] Lies den Bericht aus T05 und registriere die Verdikt-Regel vor dem ersten Bank-Lauf: die K-Abbildung in jedem Fall, ein Feature-Gewicht nur bei gepaartem Gewinn auf der hq-Tranche, glücksbereinigte Zeile mitlesen. Kläre am User-Gate, ob `DISPLAY_K` im selben Commit mitgeht.
  - [ ] Übernimm ein Feature-Gewicht nur bei gepaartem Bank-Gewinn auf der hq-Tranche mit mitgelesener glücksbereinigter Zeile; sonst übernimm nur die K-Abbildung.
  - [ ] Bump den Cache, weil die K-Abbildung am Suchblatt hängt und jeden Zellwert bewegt, und fahre die gepaarte Bank mit frischer Basis am selben Tag.
  - [ ] Schließe die Gates (drei byte-identische Feedback-Läufe mit `FEEDBACK_DUMP=1`, `npm run test:regression`, e2e, lint, npx `tsc -b`) und lege Kanal-Bewegungen und Re-Pins dem User vor.
  - [ ] Vor dem Bau klären: 2 offene Entscheidungen (Plan T07).

  *Erfolg:* Das gefittete Bank-K nähert sich der Anzeige-Konstante, die hq-Tranche verliert in keiner Phase, jede übernommene Zahl steht mit Bootstrap-Fehler im Ledger.

- [ ] **T08 · Löser-Nachtlauf mit großen Deckeln (über Nacht)** (Endspiel, Sichtung, klein, kein Score-Touch, braucht T01)

  Der Prüfstand hat in Runde 34 nur 14 von 51 Stellungen exakt gelöst; jede Bank-Stellung mit drei Körpern lief in den 120-s-Deckel. Q4, die Rennen-Statik und die Richter-Probe 2 haben deshalb keine exakte Bank-Referenz. Einmal über Nacht mit großen Deckeln rechnen, abgekoppelt, und danach nachschlagen.

  - [ ] Nimm den Positions-Export der neuen Basis (`.calibration/base-20260918-live/positions`, 110 Stellungen, die Vorgabe des Prüfstands); der alte Ordner `.calibration/r34-after/positions` ist beim Worktree-Vorfall gelöscht worden. Läuft der Nachtlauf erst nach T07, exportiere auf dem neuen Stand frisch.
  - [ ] Fahre einen Trockenlauf mit `EVAL_ENDGAME_LIMIT` über zwei Bank-Stellungen und miss die Wanduhr je Stellung, damit die Nachtlauf-Dauer geschätzt ist, bevor der Lauf startet.
  - [ ] Setze die Deckel für den Lauf hoch (heute 30 Züge, 20000 Zustände, 120 s; Vorschlag 200000 Zustände und 20 min Wanduhr) und übergib sie als Teil-Deckel an `solveEndgame`, ohne die Vorgabe im Produktionspfad zu ändern.
  - [ ] Starte vier Slices abgekoppelt (nohup plus Marker-Datei), weil das Hintergrund-Werkzeug nach zehn Minuten endet, und lege keine Sonden-Dateien in regression/ ab, solange die Regressionssuite laufen könnte.
  - [ ] Baue die Tabelle mit dem vorhandenen Skript und schreibe den Bericht als neuen Abschnitt in die Prüfstand-Datei, so wie Runde 35 es getan hat.
  - [ ] Werte 749828#23 einzeln aus (Löser −1 ungepreist bei 7 Zuständen, Beweiser −1 mit Masse 1, Statik +0,6, Decided-Sweep p1) und schreibe auf, welche der drei Quellen die Stellung falsch liest.
  - [ ] Exportiere zusätzlich die Positionen der sechs Feedback-Replays und löse 573756 t138 exakt, um den offenen Zweig des Beweisers zu benennen.
  - [ ] Trage den Befund als Q4-Referenzzeile nach (exakter Wert gegen die vom Sweep entschiedene Seite) und melde, ob die Rennen-Statik ein Bank-Verdikt bekommen kann.
  - [ ] Vor dem Bau klären: 3 offene Entscheidungen (Plan T08).

  *Erfolg:* Jede der 25 Bank-Stellungen mit höchstens drei Körpern trägt `exact` oder ein benanntes Etikett, 749828#23 ist eingeordnet, Q4 hat eine Zeile „exakt gegen decided“ mit mehr als einer Stellung.

## Iteration 3 · Q4 Decided v2

Eine große Runde für sich: Brainstorming, Spec, Messung auf dem frischen Bank-Dump, Bau, gepaarter Bench.

- [ ] **T09 · Q4 · Decided v2: erst messen, dann den Score klammern** (Endspiel, Runde, groß, score-berührend D3, braucht T01, T07, T08 soweit fertig)

  573756 ab Zug 135: Der Bericht sagt „practically decided“, der Balken steht bei 26 bis 40 % für SoulWind. Auf der Bank gewinnt die als entschieden gelesene Seite nur 72 bis 80 %. In 749828 Zug 23 nennt die Erkennung p1, Löser und Beweiser beweisen p2. Die Erkennung soll erst „entschieden“ sagen, wenn sie auch gegen einen Volltreffer und einen verlorenen Zug recht behält. Die Score-Klammer (der Score springt auf einen festen Wert, sobald die Erkennung „entschieden“ sagt) kommt erst, wenn die gemessene Quote sie trägt.

  Hinweis: Seit Runde 35 ist jede Änderung hier score-berührend: Die Erkennung löst den Beweiser oberhalb von drei Körpern aus (`search/forced-win.ts`, `PROVER_SCORE_FLOOR` 0,6). Die Roadmap führt Q4 noch als nicht score-berührend. Die alten Quoten stammen von vor dem Formen-Marker-Fix und müssen neu gezählt werden.

  - [ ] Schreibe Brainstorming und Spec mit beiden Hypothesen und der vorregistrierten Verdikt-Regel: v2 misst zuerst nur (Quote aus dem Dump), die Score-Klammer bekommt erst bei mindestens 90 % gesamt und 85 % in Singles eine eigene Runde.
  - [ ] Ziehe auf frischem master einen Bank-Dump und zähle die Decided-Quote neu, getrennt nach Singles, Doubles und hq-Tranche; die alten Zahlen (72,3 / 79,8 / 73,8 %) stammen aus der Zeit vor dem Formen-Marker-Fix der Runde 45, der 32 der 129 Bank-Replays bewegt hat.
  - [ ] Klassifiziere die Verluste nach dem Muster der Runde-33-Sichtung (Tera, Setup, Deckung, Aufgabe) und leite daraus ab, welche Reserve v2 braucht und welche Ursache eine Reserve gar nicht fangen kann.
  - [ ] Schreibe die roten Tests zuerst: 749828 Zug 23 als serialisierte Stellung darf nicht mehr als entschieden für p1 lesen, dazu je ein Singles- und ein Doubles-Fall, in dem ein Tempo-Gleichstand oder ein Volltreffer gegen den Sweeper das Paar kippt.
  - [ ] Baue v2 hinter einem Schalter: strenge Paarsiege ohne Tempo-Gleichstand-Kredit, `DECIDED_MAX_TURNS` von 6 auf 4, und eine Reserve über die vorhandenen Renn-Takte (ein Volltreffer gegen den Sweeper und ein verlorener Zug als Zug-Aufschlag).
  - [ ] Miss die Quote von v1 gegen v2 auf demselben Dump-Paar und weise aus, wie viele Stellungen v2 gar nicht mehr als entschieden liest und wie viele der alten Verluste dabei verschwinden.
  - [ ] Zähle die Nebenwirkungen im selben Lauf: der Beweiser startet oberhalb von drei Körpern nur, wenn die Erkennung eine Seite nennt und der Score mindestens 0,6 steht (also bewegt v2 Scores), die Variante B des Letzten Paares liest die Erkennung mit, der Conversion-Satz nimmt den ersten entschiedenen Zug, und die Satz-Serie spricht je Spezies neu; dazu die späte Sicherheit an 2663102863 t8.
  - [ ] Fahre die Score-Gates: Cache-Bump, gepaarter Bank-Bench gegen eine am selben Tag frisch gerechnete Basis, hq-Tranche und glücksbereinigte Zeile mitlesen, drei byte-identische Feedback-Läufe, dazu Regression, e2e, lint und `tsc -b`.
  - [ ] Lege dem User das Verdikt vor: Quote, bewegte Kanäle und die Antwort auf die Frage nach der Score-Klammer; Re-Pins (573756 t135 und t138, 649664 t23) nur am Gate, die Score-Klammer bekommt nur bei bestandener Quote eine eigene Runde.
  - [ ] Vor dem Bau klären: 4 offene Entscheidungen (Plan T09).

  *Erfolg:* Quote der entschiedenen Seite mindestens 90 % gesamt und 85 % in Singles, später Bank-Brier nicht schlechter. Die Score-Klammer ist ein eigener Schritt und startet nur bei bestandener Quote.

## Iteration 4 · Vier Sichtungen

Kein Score-Touch. Jede Sichtung entscheidet, wie eine spätere Runde aussieht: T10 für T24, T11 für T22, T12 für T27, T28, T30 und T31, T13 für T25 und T26.

- [ ] **T10 · GPL Zug 13: Fehlt Cobalion ein Zug?** (Bericht, Sichtung, mini, kein Score-Touch)

  GPL-Spiel DzBQ5azlO5l Zug 13: Cobalion steht auf +2 gegen Noivern, klickt Heavy Slam und stirbt einen Zug später an Air Slash. Mit Stone Edge wäre Noivern gefallen, sagt der User; die Engine zeigt kein Fehler-Band. Offen ist, ob sie Stone Edge falsch bewertet oder ob der Zug in Cobalions gebautem Set fehlt (Custom-Game-Formate haben keine Nutzungsstatistik zum Auffüllen).

  *Erfolg:* Klar ist, welcher Pfad den fehlenden Tadel erzeugt (Optionssatz oder Bewertung), mit Zahlen für beide Varianten. *Plan T10:* 5 Schritte, 2 offene Entscheidungen.

- [ ] **T11 · VGC-Bo3 Zug 5 nachstellen: Read-Lob auf verlorenem Zug** (Bericht, Sichtung, klein, kein Score-Touch)

  Replay `gen9championsvgc2026regmbbo3-2634199230`: Der Bericht lobt Kirans Read für Zug 5 („really paid off“), obwohl Kiran den Zug verliert und kurz danach aufgibt. Der Fall ist nie nachgestellt worden. Erster Verdacht: Das Bo3-Log enthält mehrere Spiele, die App liest das erste `|win|` als Sieger, und die Bring-Erkennung fällt bei mehr als vier gebrachten Arten still aus.

  *Erfolg:* Eine belegte Antwort, warum Zug 5 gelobt wird (Zugnummer, Attribution, Payoff-Zahl), und die Einordnung: Bo3-Lesefehler, Payoff-Fenster oder Prosa-Gate. *Plan T11:* 6 Schritte, 2 offene Entscheidungen.

- [ ] **T12 · Set-Stände der drei Pfade abgleichen** (Sets und Spreads, Sichtung, klein, kein Score-Touch, braucht T01)

  Nach Runde 37 bewegt sich das Feedback-Spiel 648453 in allen 35 Zügen, obwohl die Set-Sonde keinen Unterschied zeigte. Die Sonde las gen6ou-Fixtures, der Feedback-Harness bekommt für Set-Annahmen einen 404: Die Sonde hat den Feedback-Pfad nie gemessen. App, Feedback-Harness und Bank nebeneinanderlegen, bevor jemand am Rechenweg dreht. Offen ist außerdem der Prior-Unterschied: Die App löst erst nur Tempo und gibt diese Sets als Prior weiter, der Harness löst einmal.

  *Erfolg:* Die drei Pfade bauen für 648453 dieselben Sets, oder der Unterschied ist mit einer Zahl je Hypothese erklärt. *Plan T12:* 8 Schritte, 2 offene Entscheidungen.

- [ ] **T13 · Fitter-Set-Diff sichten: Bulk, Natur, Doubles** (Sets und Spreads, Sichtung, klein, kein Score-Touch, braucht T01)

  Runde 40 nahm 963 von 25 959 Sets im Fit-Korpus eine 252er-Offensive. Runde 41 gab 20 zurück, die weite Lesart 186. Die anderen 777 kennt niemand im Detail (147 „Bulk hoch bei niedrigem Prior-Tempo“, 222 „Summe unter 300“, 176 korrekt, Rest gemischt), und 1543 Sets wechselten ihre Natur, meist zu Hardy. Erst zählen, dann bauen. Alle gespeicherten Set-Listen sind älter als der Formen-Marker-Fix.

  *Erfolg:* Jede Familie hat eine Zahl, zehn Beispiele und eine Empfehlung, getrennt nach Singles und Doubles; die Listen liegen im Sonden-Ordner. *Plan T13:* 7 Schritte, 2 offene Entscheidungen.

## Iteration 5 · Wurzel: Klassen auf Ansage und Speed-Ties

Beide fassen `search/cell-sampler.ts` an: eine Spec, zwei getrennt gemessene Commits. Der Play-out-Pin läuft zuerst einzeln (D7).

- [ ] **T14 · Klassen auf Ansage an der Wurzel** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T01)

  573756, Wurzelzelle mit einem 90-%-Zug: Die fünf Basis-Würfe treffen alle, der Sampler jagt den Fehlschlag mit elf festen Sonden-Seeds, findet ihn nicht und gibt auf. Die Wurzel preist den Zug sicherer, als er ist, und die Zug-Karte meldet 209 KO-Odds-Mismatches. Löser und Beweiser sagen dem Sim seit Runde 43 „diesmal daneben“ und bekommen die Klasse sofort; Wurzel und Verify-Sampler sollen denselben Griff nutzen.

  Hinweis: Macht die auf `r45-threshold` geparkte Sonden-Schwelle (6d10308) überflüssig; der Ledger führt diesen Umbau als ihren Nachfolger. Dieselbe Stelle in `search/cell-sampler.ts` trägt den Matrix-Tie aus T15: Wer zuerst läuft, nimmt ihn mit.

  *Erfolg:* Weniger Ziehungen je Randzelle als heute (Basis: 940 Ziehungen auf 111 Randzellen; Schwelle in der Spec vorregistrieren), Mismatch-Diagnosen nur noch bei echter Calc-gegen-Sim-Uneinigkeit, Play-out-Pin hält, Bank spät und hq in der vorregistrierten Linie. *Plan T14:* 9 Schritte, 3 offene Entscheidungen.

- [ ] **T15 · Speed-Ties als Münzwurf: Matrix, Doubles, Statik** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T01)

  Prüfstand: zwei Machamp auf 1 HP, gleich schnell, jeder tötet den anderen sicher. Der Löser rechnet 0, also Münzwurf. Wurzelmatrix und Baum lesen +1,0 für p1, weil ein fester Seed die Reihenfolge ordnet; die Rennen-Statik liest −0,6. In Doubles sieht der Löser den Tie gar nicht und meldet 1,0 als exakt. Gleich schnell soll überall heißen: zwei Reihenfolgen zu je einer Hälfte.

  Hinweis: Die Baum-Hälfte des Tie-Splits liegt fertig hinter `CHANCE_NODES` und kommt mit T35 zurück; diese Runde fasst Matrix, Doubles-Löser und Statik an.

  *Erfolg:* `ohko-tie`, `speed-tie-2hko`, `toss-race-even` und `doubles-ohko-tie` lesen 0 statt ±1 oder −0,6, die übrigen exakten Prüfstand-Zeilen bewegen sich nicht, später Bank-Brier in der vorregistrierten Linie. *Plan T15:* 9 Schritte, 7 offene Entscheidungen.

## Iteration 6 · Die 573756-Gaps: Bar vor dem Wurf und Opfer-Satz

T16 ist score-berührend, fasst Verify und Merge an (`mcts-merge.ts`, `worker-client.ts`) und misst zuerst die Golden 655336 (D7). T17 ist render-only. Zusammen schließen sie 573756 t73, 573756 t68 und 648453 t13; T17 nimmt seit dem 18.09. auch 653785 t19 mit.

- [ ] **T16 · Gleiche Tiefe in der Wurzel-Matrix** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T14)

  573756 Zug 73: Die Bar steht vor dem Klick bei 19,5 % für SoulWind, das gespielte Paar Body Press gegen Fire Fang preist 8,7 %. Die Wurzel ist freundlicher als ihre eigenen Zellen. Ursache: Die Vertiefung ersetzt den Mehr-Seed-Wert durch das erste Seed-Kind (der 10-%-Fehlschlag von Scale Shot verschwindet), unverifizierte Zeilen behalten den flacheren Wert. So entsteht für Defog, den niemand gespielt hat, ein Regret von 0,166. Alle Zeilen eines Vergleichs sollen auf derselben Tiefe gepreist sein.

  *Erfolg:* Lücke zwischen Wurzel-Score und bestem Zeilenwert an 573756 t73 unter 0,1, der Defog-Regret 0,166 verschwindet, Feedback-Wanduhr der kleinen Korpus-Spiele höchstens +30 % (sonst `VERIFY_CELL_CAP` 12 gegen 8 messen). *Plan T16:* 9 Schritte, 3 offene Entscheidungen.

- [ ] **T17 · Lob ohne Fehler-Band: Opfer-Satz und Read-Gutschrift** (Bericht, Runde, mittel, verlustfrei D4, braucht T01)

  573756 Zug 68: SoulWind opfert Weavile an Corviknight und macht damit den Garchomp-Sweep möglich. Die Engine sagt nichts dazu: Knock Off hat Regret 0,0735, also kein Fehler-Band, und ohne Fehler-Band gibt es keinen Opfer-Satz. 648453 Zug 13: BKC wechselt auf Lopunny-Mega, der Zug trägt das Spiel, die Karte sagt quiet. 653785 Zug 19 (User 18.09.): 3d wechselt ein Weavile mit 63/281 in die Stealth Rocks, es stirbt beim Reinkommen, der Flare Blitz von Charizard-Mega-X geht ins Leere, und Lopunny-Mega kommt gratis rein; die Engine liest quiet und empfiehlt den Wechsel auf Tornadus-Therian, der den Flare Blitz frisst. Die Engine kann heute nur loben, was sie vorher getadelt hat. Sie soll auch loben können, was sie nie getadelt hat.

  Hinweis: Verwandt mit T36 (Züge kreditieren, die erst die tiefe Bewertung rechtfertigt): beide zusammen entscheiden, sonst bauen zwei Runden dieselbe Gutschrift.

  *Erfolg:* 573756 t68 trägt den verifizierten Opfer-Satz ohne Fehler-Band, 648453 t13 liest p2-read, 653785 t19 nennt den Hazard-Sack (oder die Spec begründet, warum er eine eigene Runde braucht), die Kollateral-Zählung nennt jeden weiteren bewegten Zug. *Plan T17:* 8 Schritte, 4 offene Entscheidungen.

## Iteration 7 · Kleine sichtbare Korrekturen

Drei render-only-Punkte mit einem gemeinsamen Schluss-Gate. Prosa ist nur an drei Stellen byte-gepinnt (`summaryIncludes` für 573756 t8, 573756 t73, 562428 t10); die Golden 655336 pinnt keine Prosa.

- [ ] **T18 · Kleine Sätze im Spielbericht aufräumen** (Bericht, Mini-Runde, mittel, verlustfrei D4, braucht T01)

  649664 Zug 3: Der Bericht sagt bei vollen Teams, Medicham-Mega sei einen 90-%-Wurf vom Aufräumen entfernt. 648453: vier „practically decided“-Sätze hintereinander, jeder mit einer anderen Art. 573756 Zug 75: Der Halter-Satz liest schräg, weil beide Toxapex heißen. 653785: erst „tipped on turn 24“, dann „From turn 23, Dragonite cleared everything“. Dazu stehen die Reads-Beispiele im Sieger-Pfad nach Auszahlung statt nach Zug, die Hauptvariante zeigt „(waiting)“, und der Odds-Satz rendert in keinem Korpus-Zug mehr. Sieben kleine Prosa-Punkte, ein Gate.

  Hinweis: Die Golden 655336 pinnt keine Prosa (nur keyMoments, misplays, reads, turningPoint); die Runde ist damit billiger, als der alte Text annahm. Hier lässt sich auch der Rest aus T09 mitnehmen: „practically decided“ abschwächen, solange die Quote unter 90 % liegt.

  *Erfolg:* Die drei Prosa-Pins (573756 t8, 573756 t73, 562428 t10) stehen unverändert, die Golden-Felder von 655336 bewegen sich nicht, der Dump-Diff zeigt nur `summary`-Felder. *Plan T18:* 9 Schritte, 4 offene Entscheidungen.

- [ ] **T19 · Der offene Crit erklärt die gefallene Bar** (Bericht, Mini-Runde, mini, verlustfrei D4)

  649664 Zug 23: Seit dem Klassenpfad sinkt die bewiesene Masse von 0,92 auf 0,79, weil die Crit-Klasse offen bleibt, und die Bar fällt sichtbar. Der Satz mit dem Vorbehalt „barring a crit“ spricht erst ab 0,9 und schweigt jetzt. Der User sieht eine tiefere Bar ohne Grund.

  Hinweis: Entfällt, wenn T23 (Crit-Klasse) vorher landet.

  *Erfolg:* 649664 t23 trägt einen Satz, der die gefallene Bar mit dem offenen Crit erklärt, kein anderer Korpus-Zug bekommt einen neuen Satz, alle Engine-Zahlen der Dumps bleiben gleich. *Plan T19:* 7 Schritte, 2 offene Entscheidungen.

- [ ] **T20 · Tera-Toggle in die Schadensvorschau des Branch-Pickers** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  Im Branch-Picker drückt man „Tera (Ice)“ und liest darunter die Schadenszahlen weiter ohne Tera: Der Calc sieht den Tera-Typ erst nach der Ausführung. Genau im Moment der Entscheidung zeigt die Vorschau eine falsche KO-Zahl. Seit der QA-Kampagne im Juli bewusst offen.

  *Erfolg:* Die Vorschau-Zahl springt beim Drücken des Tera-Knopfs und zeigt denselben Wert wie der Calc nach der Ausführung, in Singles und mit zwei Zielen in Doubles. *Plan T20:* 8 Schritte, 3 offene Entscheidungen.

## Iteration 8 · Glückskonto: gewürfelt oder umbewertet

Ein Zähl-Skript beantwortet beide Fragen (T21 und Schritt 2 von T22), danach folgt der Split des Glückskontos.

- [ ] **T21 · Dossier: Folgte der Spieler dem Engine-Favoriten?** (Richter und Bank, Mini-Runde, klein, kein Score-Touch)

  655336: p1 folgte in 10 von 26 Zügen dem Engine-Favoriten, p2 in 11 von 28, p1 gewann. Aus solchen Zahlen lässt sich Zugqualität aus Ergebnissen lesen. Die Zahl ist verzerrt (wer folgt, ist im Schnitt stärker) und bleibt Diagnostik. Ein Lese-Skript über die Dumps, fällig, wenn eine Runde sie ohnehin zieht. Dasselbe Skript beantwortet im selben Lauf die Zähl-Frage aus T22: Wie oft trägt eine chance-Attribution keinen Würfel-Zug?

  *Erfolg:* Die Tabelle steht je Score-Band, die Kopfzeile benennt die Verzerrung; die Zahl wird nie Gate. *Plan T21:* 7 Schritte, 2 offene Entscheidungen.

- [ ] **T22 · Chance ohne Würfel als eigene Klasse ausweisen** (Bericht, Runde, mittel, verlustfrei D4, braucht T11)

  Der Bericht zu 573756 endet mit „The rolls decided it, luck ran LordEnz's way overall (+138%)“. Von diesen 2,76 Punkten tragen die im Protokoll mit einem Marker sichtbaren Würfel 0,03. Der Rest entsteht, weil die Matrix eines Zugs die entstandene Stellung anders bewertet als die Wurzel des Folgezugs (573756 t70 Schwerttanz, Draft t48 U-turn-Read). Der User liest Glück, wo die Engine ihre Meinung geändert hat. Das Glückskonto bekommt zwei Töpfe: gewürfelt und umbewertet.

  Hinweis: Das Gate gilt für Stufe (a), render-only. Stufe (a2) trägt die Klassen-Antwort aus der Suche ins Ergebnis und braucht einen Cache-Bump bei ziffern-gleichen Scores. Stufe (b), der Abgleich des Zellenpreises gegen die Folgewurzel, ist score-berührend und gehört zur Familie T16. Die Zählung aus Schritt 2 ist dieselbe wie in T21: Wer zuerst läuft, legt sie als Sonde ab.

  *Erfolg:* 573756 und 653785 verlieren „The rolls decided it“ (Würfel-Deckung 2 % und 26 %, gemessen mit dem schärferen Anker aus Protokoll-Marker oder koOdds der gespielten Zeile), 562428 und 649664 behalten ihre Glückszeile (69 % und 78 %), höchstens vier Zug-Karten wechseln die Klasse, die gepinnten chance-Kanäle 573756 t73 und 649664 t23 bleiben stehen. *Plan T22:* 9 Schritte, 4 offene Entscheidungen.

## Iteration 9 · Crit-Klasse und Zuck-Klasse

Eine gemeinsame Spec für die Klassen-Arithmetik, zwei getrennt gemessene Commits. Dieselbe Maschinerie wie Iteration 5 (`cell-blend.ts`, `search/outcome-children.ts`, `forward/scripted-prng.ts`); der Play-out-Pin läuft zuerst einzeln (D7).

- [ ] **T23 · Crits als eigene Klasse im Zellenplan** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T15)

  Der Zellenplan kennt drei Ausgänge: daneben, Treffer mit KO, Treffer ohne KO. Der Crit steckt nur als Beimischung in der KO-Quote. Deshalb bleiben im Prüfstand 6 von 26 Stellungen ungepreist, und viele Beweise tragen „barring a crit“. 649664 Zug 23: Der offene Crit senkt die Bar von 0,92 auf 0,79.

  *Erfolg:* `healer-burned`, `toxic-stall`, `two-v-one-sack` und `setup-vs-heal` verlieren das Etikett ungepreist, weniger Beweise mit „barring a crit“, Bank und Perf (verschränkt gemessen) in der vorregistrierten Linie. *Plan T23:* 8 Schritte, 4 offene Entscheidungen.

- [ ] **T24 · Zuck-Chance preisen statt würfeln** (Zufall preisen, Runde, groß, score-berührend D3, braucht T10)

  GPL-Spiel DzBQ5azlO5l Zug 15: Noivern (55/161) steht gegen ein frisches Rotom-Wash, Bene wechselt auf Vileplume, die Engine nennt das einen Fehler. Air Slash lässt das Ziel zu 30 % zurückzucken, aber die Engine preist das Zurückzucken nicht als Anteil: Welcher der festen Seeds zieht, entscheidet, ob Rotom in der Rechnung zurückzuckt. Bei einem sicher treffenden Zuck-Zug ohne KO rechnet die Zelle sogar mit einem einzigen Seed. Die Zuck-Chance bekommt denselben Rang wie der Fehlschlag: eine eigene Klasse mit Gewicht.

  Hinweis: Teilt Klassen-Arithmetik und Dateien mit T23 (`cell-blend.ts`, `outcome-children.ts`, `scripted-prng.ts`); eine gemeinsame Spec spart einen Messzyklus.

  *Erfolg:* Weniger Zellen fallen wegen einer `cant`-Zeile auf das Seed-Mittel zurück, GPL Zug 15 hängt nicht mehr am Seed, Play-out-Pin hält, Bank in der vorregistrierten Linie. *Plan T24:* 9 Schritte, 5 offene Entscheidungen.

## Iteration 10 · Fitter: Budget auffüllen und Tempo gegen Offensive

Beide Umbauten sitzen in der Leiter des Spread-Fitters; T25 zuerst, weil ein voll aufgefüllter Körper die Sprossen-Wahl verschiebt. Für beide gilt D8: Set-Diffs auf allen drei Pfaden vor der Bank. Am Ende der Sitzung läuft die Kontroll-Aufnahme des Fits über Nacht.

- [ ] **T25 · Budget auffüllen, auch unter gemessenen Stats** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T13)

  Wenn das Log die HP misst und eine Verteidiger-Beobachtung den Bulk als uninvestiert liest, gelten HP, Def und SpD als gemessen. Die Auffüll-Regel lässt gemessene Stats stehen, der Rest des Budgets bleibt liegen: Im Fit-Korpus tragen 6151 Körper weniger als 300 von 508 EVs, 222 davon mit 0 Offensive. Im Branch steht dann ein dünnerer Körper als im Replay. Eine gemessene 0 soll heißen: auffüllen, solange der Fit-Fehler nicht steigt. Die Zahlen 6151 und 222 stammen aus dem Runde-40-Bench, also von vor dem Formen-Marker-Fix; Schritt 1 zählt sie neu.

  *Erfolg:* Weniger Körper unter 300 EVs im Fit-Korpus, der Fit-Fehler steigt bei keinem Set, Bank in keiner Phase schlechter als die vorregistrierte Linie (früher Brier als benannte Nebenfrage). *Plan T25:* 9 Schritte, 3 offene Entscheidungen.

- [ ] **T26 · Gehaltenes Tempo gegen gemessene Offensive, zweiter Anlauf** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T13)

  Ein Weavile in einem Bank-Replay steht mit 0/0/0/0/0/252, obwohl saubere Schadenslinien 252 Atk messen: Eine erfüllte Zugreihenfolge hält sein Tempo, und die Leiter gibt es nur frei, wenn der Angriffs-Anspruch selbst gekappt wurde. Dazu sperrt `keepNature` jede Sprosse mit eigener Natur, also auch Adamant, die den Schaden 10 % besser träfe. Die weite Lesart aus Runde 41 (Branch `r41-wide`) holte 186 Offensiven zurück, kostete aber 162 Körper ihr Tempo. Gesucht ist ein schärferer Auslöser.

  *Erfolg:* Mehr zurückgeholte Offensiven als die engen 20, höchstens eine Handvoll Tempo-Verluste statt 162, Bank spät nicht schlechter als die +9 bp hq der weiten Lesart. *Plan T26:* 9 Schritte, 3 offene Entscheidungen.

## Iteration 11 · Drei kleine Set-Punkte

T27 bewegt keine Sets und ist verlustfrei. T28 und T29 sind score-berührend und werden getrennt gemessen; für T28 gilt D8.

- [ ] **T27 · Sensitivitäts-Etikett stabil machen** (Sets und Spreads, Mini-Runde, klein, verlustfrei D4, braucht T12)

  648453 Zug 13: Ein Lauf schreibt, das Urteil hänge an Landorus-Therians Choice Scarf, der nächste nennt Keldeos Choice Scarf. Die Zahlen darunter sind gleich (0,070 und 0,323). Die Sondenliste entsteht aus den gelösten Sets, und die landen asynchron aus dem Worker: Wer zuerst da ist, gibt dem Urteil den Namen.

  *Erfolg:* Dasselbe Replay liefert in fünf Läufen dasselbe Etikett, der Byte-Vergleich läuft mit `graph.sensitivity`, kein gepinnter Kanal bewegt sich ungefragt. *Plan T27:* 7 Schritte, 2 offene Entscheidungen.

- [ ] **T28 · Sets mit weniger als vier Zügen: Ursache finden** (Sets und Spreads, Mini-Runde, klein, score-berührend D3, braucht T12)

  573756: Magnezone bekam in Runde 33 nur drei Züge (das Choice-Set gewinnt, das Kohärenz-Veto streicht Toxic). Im Branch fehlt der Suche damit eine Option. Der Builder rückt nach einem Veto aber schon nach: `assembleMoves` filtert den ganzen Pool und schneidet erst danach auf vier. Unter vier Zügen bleibt ein Set nur, wenn der gefilterte Pool selbst zu klein ist. Zuerst prüfen, ob das Symptom unter dem seit Runde 37 inferierten Scarf noch besteht, dann zählen, wo der Pool zu klein ist und warum.

  *Erfolg:* Die Ursache jedes Sets mit weniger als vier Zügen ist benannt (Pool zu klein, Format ohne Nutzungsstatistik, Veto-Kette); nach dem Umbau gibt es solche Sets nur noch bei leerem Pool, die Bank steht mindestens still. *Plan T28:* 6 Schritte, 2 offene Entscheidungen.

- [ ] **T29 · Engine-Preis für Choice-gebundene Cleaner** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T01)

  750540: Darkrai trägt wirklich ein Choice Scarf. Mit dem richtigen Set kippt Zug 18 von 0,11 auf 0,58 zum Verlierer; dieses eine Spiel trägt 0,238 der 0,364 Punkte, mit denen Runde 37 ihre Bank-Linie verfehlte. Die Engine bucht beim Choice-Träger fast nur den Preis (gesperrte Status-Züge, Lock) und kaum den Nutzen (Tempo). Ein richtiges Set darf die Bewertung nicht verschlechtern.

  *Erfolg:* 750540 gibt den Zug-18-Sprung ab, die späte hq-Linie verbessert sich oder steht still, und der Gewinn hängt nicht wieder an einem einzigen Spiel. *Plan T29:* 9 Schritte, 2 offene Entscheidungen.

## Iteration 12 · Tempo-Evidenz

Vier Regeln, je Regel ein eigener Branch-Bench: eine Sitzung für sich. Es gilt D8.

- [ ] **T30 · Tempo-Evidenz: Item-Zeitraum, Bremsen, Widerspruchs-Gate** (Sets und Spreads, Runde, groß, score-berührend D3, braucht T12)

  939635: Zapdos-Galar verliert sein Scarf durch Knock Off, und die Engine liest aus dem Rennen ein Scarf für Landorus heraus, das es nie gab. Der Parser wirft deshalb jedes Rennen weg, das ein Item-Wechsel berührt (260 Paare im Fit-Korpus). 2663107495: Gholdengo zieht in Zug 1 vor Ogerpon-Wellspring und in Zug 10 dahinter; die erste Beobachtung entscheidet, das Panel zeigt ein Scarf auf Hardy 60 Spe. Das Item wird ein Zustand mit Zeitraum, Brems-Items (Iron Ball, Lagging Tail, Macho Brace, Power-Items) bekommen ihre Spiegel-Regel, Quick Claw wird als Item gelesen, und bei Widerspruch enthält sich die Inferenz.

  *Erfolg:* Weniger weggeworfene Rennen als die heutigen 260 (Schwelle in der Spec vorregistrieren), 939635 Landorus verliert das falsche Scarf, 2663107495 Gholdengo bekommt keine Entscheidung, hq spät steht mindestens still; Handprüfung von je fünf Scarf-in- und Scarf-out-Zeilen gegen das Log. *Plan T30:* 9 Schritte, 3 offene Entscheidungen.

## Iteration 13 · Doubles-Schaden und Item-Achse

Erst das Doubles-Gate, dann die Item-Achse, getrennt gemessen (D8). Der größte Bau bei den Sets: Er bewegt die Doubles-Hälfte der Bank.

- [ ] **T31 · Doubles: Schaden messen und richtig rechnen** (Sets und Spreads, Runde, groß, score-berührend D3, braucht T12, T30)

  In Doubles liest der Parser keine einzige Schadensbeobachtung: `protocol-parser.ts:32` lässt nur Singles durch. Die Doubles-Sets der ganzen VGC- und Champions-Hälfte der Bank sind damit reine Usage-Raten, und der Branch tötet Pokémon, die im Replay sichtbar überlebt haben. Dazu sagt niemand dem Schadensrechner, dass Doubles gespielt wird: Der Fit baut sein Feld ohne Spielart (`spreads/fit.ts:152`), die KO-Odds tragen fest Singles ein (`ko-odds.ts:99`). Ein Erdbeben auf zwei Ziele rechnet so ein Drittel zu stark: heute in den KO-Odds, im Fit ab dem Moment, in dem das Gate offen ist.

  *Erfolg:* Singles-Sets und Singles-Scores bleiben byte-identisch, die Doubles-Zeilen der Bank verbessern sich oder stehen still, nicht mehr Bank-Stellungen mit vorzeitig endender Rekonstruktion. *Plan T31:* 9 Schritte, 5 offene Entscheidungen.

- [ ] **T32 · Band und Specs aus Schaden lesen** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T31)

  Die Schadens-Leiter kann kein Choice Band und keine Choice Specs erkennen, weil das Item fest am gebauten Set hängt. Trifft ein Angriff härter, als jeder EV-Körper erklärt, ist das Item die Erklärung. Die Leiter bekommt eine Item-Achse (Band, Specs, Life Orb, kein Item).

  *Erfolg:* Die Leiter erklärt zu harte Treffer mit einem Item statt mit einem verbogenen Körper, die Handprüfung bestätigt die Items, die Bank steht mindestens still. *Plan T32:* 6 Schritte.

## Iteration 14 · Endspiel-Statik

T33 braucht die exakten Bank-Werte aus dem Nachtlauf (T08). T34 ist ein Mini am selben Beweiser-Pfad und wird getrennt gemessen.

- [ ] **T33 · Rennen-Statik: PP, Körper ohne Angriff, Deckel** (Endspiel, Runde, groß, score-berührend D3, braucht T08)

  Zapdos mit einem PP Thunderbolt gegen Toxapex mit Recover: Löser −0,995, Statik +0,36. Chansey mit Seismic Toss gegen Gengar: Löser −1, Statik und Matrix 0,0. Zwei Wände ohne Angriffszug gegen Garchomp: Statik +0,64, Wahrheit −1. Level 100 gegen Level 30: 0,9 statt 1,0. Die Statik soll wissen: Leere Angriffs-PP heißen kein Schaden, ein Körper ohne Angriffszug gewinnt nichts, und wo nur eine Seite Schaden macht, ist das Rennen entschieden.

  *Erfolg:* `struggle-lock`, `fixed-vs-ghost` und `two-v-one-switch-loop` lesen in der Statik das richtige Vorzeichen, `level-gap` liest 1,0, später Bank-Brier in der vorregistrierten Linie. Der Prüfstand ist das Instrument, die Bank nur die Nicht-Verschlechterungs-Linie. *Plan T33:* 8 Schritte, 4 offene Entscheidungen.

- [ ] **T34 · Beweiser prüft die zweite Seite nur nach verlorener Probe** (Endspiel, Mini-Runde, mini, score-berührend D3, braucht T01)

  In jedem kleinen Endspiel versucht der Beweiser beide Seiten, auch wenn eine Seite sicher gewinnt. Im Sweep von 573756 kostet das 13 s über 140 Aufrufe. Die zweite Seite nur prüfen, wenn die gierige Linie der ersten mit einer Niederlage endet.

  Hinweis: Gedacht als Kostenhebel, aber score-berührend: Ein nicht mehr versuchter Beweis nimmt Masse aus dem Score (`search/forced-win-apply.ts`).

  *Erfolg:* Die Zahl der Beweise auf der Bank bleibt gleich (33 von 816 nach Runde 35), die Beweiser-Zeit im Sweep sinkt messbar (verschränkt gemessen). *Plan T34:* 5 Schritte, 2 offene Entscheidungen.

## Iteration 15 · Zufallsknoten im Baum

Der riskanteste Umbau der Liste. Er misst gegen alles, was davor gelandet ist, und endet wie Runde 43 als Fallback, wenn eine Linie fällt.

- [ ] **T35 · Zufallsknoten im Baum, zweiter Anlauf (Q2)** (Zufall preisen, Runde, groß, score-berührend D3, braucht T01)

  Doubles-Spiel 2663102863 Zug 8: ein gewonnenes Endspiel, der Balken zeigt seit Runde 42 nur 0,29 statt 0,85. Runde 43 holte die Gewissheit mit Zufallsknoten zurück (0,66), verteilte dabei aber die Suchtiefe auf Nebenklassen: Bank spät 12 bis 15 bp schlechter, Doubles-Baum 44 bis 70 % teurer, der Draft-t56-Play-out-Pin kippt. Alles liegt fertig hinter `CHANCE_NODES = false`. Zweiter Anlauf: nur die schwerste Klasse tief suchen, Nebenklassen ohne Abstieg bepreisen.

  Hinweis: Die Runde-43-Zahlen stammen von vor dem Formen-Marker-Fix; Schritt 2 misst den alten Baumstand auf dem heutigen Code nach, bevor eine Verdikt-Regel darauf zeigt.

  *Erfolg:* hq spät gepaart mindestens 3 bp besser und Vollmenge spät nicht schlechter, Play-out-Pin grün (Muk-Alola vor Heatran, Sieg in Zug 65), 2663102863 t8 mindestens 0,6, Prüfstand `thunder-70` im Baum 0,400, Doubles-Baum höchstens +40 %. Fällt eine Linie, bleibt `CHANCE_NODES` aus. *Plan T35:* 9 Schritte, 4 offene Entscheidungen.

## Iteration 16 · Scan-Wertung und Choke-Proben

Zwei Punkte ohne Score-Touch. T37 entscheidet mit Ja oder Nein, ob Iteration 17 stattfindet.

- [ ] **T36 · Scan-Wertung behalten, schwer zu findende Züge kreditieren** (Bericht, Runde, mittel, verlustfrei D4)

  Draft-Spiel: Bene schaltet Heatran immer wieder vor Kyurem, und genau das nennt der User die schweren, richtigen Züge (t24, t50, t63). Die Engine sieht davon nichts: überall 6 bis 10 brauchbare Optionen, der Grind-Reiter hat zwei Beine (genau eine haltende Linie bei mindestens vier Optionen, oder ein Zug, den die Tiefe-plus-1-Verifikation freispricht), und keines greift hier. Der Sweep läuft erst schnell, dann tief, und wirft die schnelle Wertung weg. Wir behalten sie und kreditieren Züge, bei denen erst das tiefe Rechnen den gespielten Klick rechtfertigt.

  Hinweis: Der User hat die Conversion-Satz-Erweiterung (Entry-Züge benennen) bewusst nicht gewollt. Die behaltene Scan-Wertung ist zugleich der billigste Weg zum Wurzel-Prior (T41).

  *Erfolg:* Der Grind-Satz im Draft-Spiel nennt mindestens einen der Heatran-Züge t24, t50 oder t63, kein Korpus-Pin bewegt sich, die Sweep-Wanduhr verschlechtert sich nicht messbar. *Plan T36:* 9 Schritte, 4 offene Entscheidungen.

- [ ] **T37 · Choke-Erkennung prüfen: drei Proben vor dem Richter** (Richter und Bank, Sichtung, mittel, kein Score-Touch, braucht T01, T08 für Probe 2 auf Bank-Stellungen)

  Ein Richter, der Spielerfehler erkennen soll, muss selbst geprüft sein. Stand: Über die sechs Feedback-Dumps stehen 2 mistakes und 0 blunders gegen 36 inaccuracies in 558 Seiten-Zügen; 573756 liefert in 139 Zügen keinen einzigen Fehler-Zug. In 655336 nennt der Experte zwei Fehler von p2 (Trick in Zug 5, Protect in Zug 26), die Engine findet nur den Trick. Drei Proben: gegen die Experten-Pins, gegen exakt gelöste Endspiele, gegen den eigenen Score-Verlauf.

  Hinweis: Die alte Vorgabe „nur mistake und blunder, mit `verifiedAtDepth`“ ergäbe wörtlich eine leere Richter-Datei: Das Flag steht nur, wenn die Vertiefung den Tier gestrichen hat. Gemeint sind Verdikte, die die Vertiefung stehen ließ.

  *Erfolg:* Die Probenzahlen stehen (Treffer gegen Experten-Pins, Fehlalarme auf den vier verteidigten Zügen, Treffer und Fehlnennungen auf exakt gelösten Stellungen, Anteil Richter-Fehler ohne Score-Bewegung), und daraus fällt ein Ja oder Nein für den Richter. *Plan T37:* 9 Schritte, 4 offene Entscheidungen.

## Iteration 17 · Gefrorener Richter

Nur, wenn T37 mit Ja endet.

- [ ] **T38 · Gefrorener Richter und vierfache Bank-Ausgabe** (Richter und Bank, Runde, groß, kein Score-Touch, braucht T37)

  Die Bank misst, ob die Prozente ehrlich sind. Sie misst nicht, ob die Engine besser urteilt als die Spieler: Patzt die favorisierte Seite nach der gemessenen Stellung, lastet die Bank den verlorenen Punkt der Engine an. Eine eingefrorene Engine-Version bestimmt einmal, welche Züge Fehler waren (Richter-Datei), und jede spätere Engine wird gegen diese feste Liste gemessen. Ausgabe vierfach: roh, glücksbereinigt, choke-bereinigt, Zahl der Ausschlüsse. Gleichzeitig fällt die Fenster-Frage der Glückszeile, die heute 334 von 816 Stellungen ausschließt (41 %).

  Hinweis: Ehrliche Grenze: „besser als die Spieler“ heißt hier „so gut wie die Fehler-Erkennung des Richters“. Der Sweep mit Zug-Verdikten ist neue Arbeit: Die Kalibrierung ruft `analyzeTurn` nie auf.

  *Erfolg:* Vier Zeilen stehen, roh und glücksbereinigt bleiben gegen eine frische Basis ziffern-gleich, Richter-Stand und Fenster-Wahl stehen mit Zahlen im Ledger. Die choke-bereinigte Zahl bleibt Diagnostik, bis T37 bestanden ist. *Plan T38:* 9 Schritte, 5 offene Entscheidungen.

## Iteration 18 · Q5-Sichtung und Q9

Von Q5 zuerst nur die Sichtungs-Schritte 1 bis 4: Sie sind billig und entscheiden über die teuerste Runde der Liste. Fällt die Sichtung positiv aus, wird der Bau von Q5 eine eigene Iteration. Q9 ist ein Offline-Skript auf demselben frischen Bank-Dump.

- [ ] **T39 · Q5 · Redundanz und Optionswert, Sichtung zuerst** (Q-Runden, Runde, groß, score-berührend D3, braucht T01, T07)

  Früh im Spiel liegt die Engine bei vielen Singles-Stellungen falsch und ist sich dabei sicher: Bei 82 von 193 frühen Singles-Stellungen der Bank liegen beide Zweige falsch. Muster: ein Material-Vorsprung, während die Seite nur noch eine einzige Antwort auf den gegnerischen Sweeper hat. 655336 Zug 23: Die Engine wählt den schnellen Kill und gibt die HP-Marge des letzten Mons auf. Ein Feature zählt, wie viele Antworten eine Seite je Bedrohung übrig hat. Vorher zehn Fehlstellungen von Hand sichten; sagen weniger als sechs „ja, fehlende Antwort“, endet die Runde dort.

  *Erfolg:* Erst Held-out-Gewinn in der CV (mindestens 16 von 20 Seeds), dann früher Brier (Stand 0,2562) und frühe Sign-Accuracy (54 %) besser bei unveränderter später Zeile. *Plan T39:* 9 Schritte, 3 offene Entscheidungen.

- [ ] **T40 · Q9 · Ehrliche Prozente nach Spielstärke** (Q-Runden, Mini-Runde, klein, kein Score-Touch, braucht T01)

  Die Prozentzahl über dem Balken ist für alle gleich geeicht, obwohl Turnierspieler Vorteile seltener verwandeln: gepooltes K 0,87 im Turnier-Band gegen 1,4 bis 1,9 auf der Leiter. Ein Offline-Skript prüft zuerst, ob die Rating-Bänder klar und monoton verschieden sind; alle früheren K-Varianten (je Modus, Phase, Spielart) haben out-of-sample verloren.

  *Erfolg:* Ein klares, monotones Gefälle zwischen den Bändern oder der gebuchte Beleg, dass eine Konstante ehrlich ist. Geht die Anzeige in die App, gelten die render-only-Gates (D4) samt Re-Pins der Prozent-Sätze. *Plan T40:* 5 Schritte, 3 offene Entscheidungen.

## Iteration 19 · Q8 Wurzel-Prior

- [ ] **T41 · Q8 · Wurzel-Prior aus der Skizzen-Matrix** (Q-Runden, Runde, mittel, score-berührend D3, braucht T01)

  Jede Baumsuche startet an der Wurzel bei null Besuchen, obwohl der Sweep für denselben Zug kurz vorher eine ganze Matrix gelöst hat. Die ersten hundert Iterationen laufen durch Zeilen, die der Sweep schon als schwach kannte. Jede Wurzelzelle bekommt zwei Vorab-Besuche mit dem Matrix-Wert; zweite Variante: Regret-Matching statt UCB an der Wurzel.

  *Erfolg:* Beide Varianten einzeln verdiktet: hq-Linie besser oder gleich, Play-out-Pin hält, Baumzeit je Spielart verschränkt nicht schlechter. *Plan T41:* 6 Schritte, 3 offene Entscheidungen.

## Iteration 20 · Q7 Doubles-Feld-Paar

Q10 (Werkzeuge für die Messkette) ist bis auf Reste erledigt und steht deshalb nicht in der Liste.

- [ ] **T42 · Q7 · Doubles-Feld-Paar und bessere Zielwahl** (Q-Runden, Runde, mittel, score-berührend D3, braucht T01, T07)

  In Doubles trifft die Engine nur sieben von zehn Vorzeichen, früh liest sie 29 von 67 Stellungen sicher falsch. Der Matchup-Term rechnet jedes Mon einzeln; dass zwei Slots dasselbe Ziel abräumen, sieht die Suche nicht, und Follow Me zählt wie jeder Status-Zug. Geplant sind Hinweise für Doppel-Fokus, Umlenkung und Protect-Tempo, dazu ein Feld-Paar-Feature bei Gewicht 0.

  Hinweis: Der Feedback-Korpus enthält keine Doubles und sieht diese Änderung nicht; die Evidenz kommt aus der Bank und aus dem VGC-Replay (T11).

  *Erfolg:* Doubles-Sign-Zeile (Stand 70 %) und früher Doubles-Brier besser, Singles-Zeilen der Bank ziffern-gleich. *Plan T42:* 7 Schritte, 2 offene Entscheidungen.

## Außer der Reihe (am nächsten Release-Tag)

Fällig am nächsten Release-Tag, unabhängig vom Platz in der Liste.

- [ ] **T43 · Release-Check vor jedem Paket-Release** (Werkzeug, Mini-Runde, mini, kein Score-Touch)

  Beide Pakete stehen auf npm (0.7.0 und 0.7.1). Der lokale Checkout kennt den Tag v0.7.1 nicht, weil CI ihn auf seiner Kopie setzt: Ein lokaler Probelauf des Publish-Skripts vergleicht gegen v0.7.0 und würde ein unverändertes Paket veröffentlichen. Dazu gehören die Barrel-Pins (`regression/fixtures/api/`), `pack:smoke` und eine neue Chunk-Karte (das alte Skript lag im Scratchpad und ist weg). Fällig am Release-Tag.

  *Erfolg:* Der lokale Probelauf nennt denselben Vorgänger-Tag wie CI, die published-Spalte deckt sich mit `npm view`, die Barrel-Pins zeigen keinen unbeabsichtigten Diff. *Plan T43:* 7 Schritte, 2 offene Entscheidungen.

## Geparkt (ohne Priorität)

- [ ] **T44 · Prinzipien als eigene Bausteine im Bericht** (Bericht, Geparkt, klein, braucht T18)

  Die Zug-Karte nennt an einzelnen Zügen, welches Prinzip greift (562428 t10 echte Breite, 648453 t13 keine lebende Antwort). Im Spielbericht taucht davon nichts auf. Wartet auf T18, weil es dieselben Sätze anfasst; vor dem ersten Code zwei oder drei Formulierungs-Muster am User-Gate.

  *Plan T44:* 4 Schritte, 2 offene Entscheidungen.

- [ ] **T45 · Experten-Urteile zu den größten Bank-Abweichungen** (Richter und Bank, Geparkt, mittel, braucht T21)

  Nur ein Mensch, der die strittigsten Stellungen ansieht und „Engine hat recht“ oder „Spieler hat recht“ sagt, kann zeigen, ob die Engine besser urteilt als die Spieler. Geparkt (User 04.09., manuelle Arbeit), bis ein Dossier eine kurze Liste liefert und der User Zeit dafür einplant.

  *Plan T45:* 6 Schritte, 2 offene Entscheidungen.

## Themen-Übersicht

Wer an einem Thema arbeitet, findet hier die verwandten TODOs.

| Thema | TODOs |
| --- | --- |
| Messbasis | T01, T04, T46 |
| Werkzeug | T02, T43 |
| Bericht | T03, T06, T10, T11, T17, T18, T19, T22, T36, T44 |
| Re-Fit | T05, T07 |
| Endspiel | T08, T09, T33, T34 |
| Sets und Spreads | T12, T13, T25, T26, T27, T28, T29, T30, T31, T32 |
| Zufall preisen | T14, T15, T16, T23, T24, T35 |
| Oberfläche | T20 |
| Richter und Bank | T21, T37, T38, T45 |
| Q-Runden | T39, T40, T41, T42 |

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

| Gap | Stand 18.09. | Bearbeitet in |
| --- | --- | --- |
| 573756 t68 (seit Runde 32) | Knock Off liest ohne Fehler-Band (Regret 0,0735). Der Opfer-Satz fehlt, weil ohne Band kein Opfer-Stempel entsteht; der Floor-Riss liegt bei 0,054. | T17 |
| 573756 t73 (seit Runde 32) | chance und Key Moment sind seit Runde 40 gepinnt (dbffb5f). Offen ist die Bar vor dem Wurf: 19,5 % gegen 8,7 % des gespielten Paars. Der Pin trägt diese Hälfte weiter im `desired`. | T16 |
| 648453 t13 (seit Runde 33) | HP Ice liest inaccuracy (Regret 0,1288), kein Mistake mehr. Offen ist p2-read für BKCs Lopunny-Wechsel. Das Sensitivitäts-Etikett wackelt zwischen Läufen. | T17, T27 |
| 562428 t10 | Breite (Runde 5) und Rückblick-Read (Runde 13) stehen. Offen ist das prädiktive Framing. | T06 |
| 653785 t19 | Die Null-Zug-Hälfte steht seit Runde 5. Offen (User 18.09.): der Hazard-Sack. 3d wechselt das todgeweihte Weavile in die Stealth Rocks, Flare Blitz geht ins Leere, Lopunny-Mega kommt gratis rein; die Engine liest quiet und empfiehlt Tornadus-Therian in den Flare Blitz. | T17 |
| 649664 t23 | observed steht seit Runde 42 auf chance. Die Bar liest 0,79 statt 0,92, weil der Crit offen bleibt. Der Odds-Satz rendert in keinem Korpus-Zug mehr. | T19, T23, T18 |
| Draft-Spiel t48, 573756 t70 | Chance-Buchung ohne Würfel: Der Read-Payoff verpufft (t48), die Setup-Auszahlung kommt eine Bewertung zu spät (t70, liest heute quiet mit −0,145). | T22 |
| VGC Bo3 2634199230 t5 | Read-Lob auf einem verlorenen Zug (User-Befund 06.09.), nie nachgestellt. | T11 |
| GPL DzBQ5azlO5l t13, t15 | Heavy Slam ohne Tadel (t13), Vileplume-Wechsel als Fehler wegen ungepreister Zuck-Chance (t15); User-Befund 12.09., Fixture `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | T10, T24 |

## C. Beobachten (Signal → wann handeln)

Oberfläche und Tempo:

- [ ] Replay-iframe: Seeks und Log-Anhänge kosten je 200 bis 350 ms, die letzte Long-Task-Quelle (Play-out: 8 Tasks, 1,8 s über 4 Züge) → handeln, wenn das Battle-Fenster beim Play-out sichtbar ruckelt; Hebel: `hold` ohne Vorparsen oder Anhänge in Paketen.
- [ ] Eval-Panel während der Suche: jedes Render unter 50 ms (Drossel: 10 Fortschritte, 4 Partials je Sekunde) → wenn die Sonde wieder Busy-Segmente über 30 % zeigt: `React.memo` an `GameGraphSection` und `EvalResultBlock`, `variation` per useMemo.
- [ ] Erster Worker-Spawn: 12 Eval-Worker plus Replay-Worker parsen je 7 MB gleichzeitig → progressiver Spawn oder Pool-Warmup, wenn es beim ersten Evaluate ruckelt (`src/lib/eval/worker-client.ts`, `pool-size.ts`).
- [ ] `pre`-Task vor dem Laden 200 bis 290 ms gegen 130 bis 150 ms, unter Fremdlast gemessen (Eintritts-Chunk 8,7 MB) → leer nachmessen, bevor daraus ein Befund wird.
- [ ] Wanduhr 573756 im Feedback-Lauf: 51 → 62 s (Runde 42), 61 → 51 s (Runde 43), beides nicht verschränkt → im nächsten ruhigen Fenster verschränkt nachmessen, bevor eine Kosten-Zeile in den Ledger geht.

Bericht und Buchung:

- [ ] Stufen-Doppelsprechen (562428: Victini t15 stark, t19 von Heatran gehalten; gewollt seit Runde 14) → nur handeln, wenn es als Widerspruch gelesen wird; Hebel: Einmal-Schlüssel in `turn-analysis/types.ts`.
- [ ] Aufrunde-Kante im Erwartungs-Rennen (648453 t14: 0,812/0,8162 = 0,995 → Ein-Klick-Uhr) → nur wissen: gehalten oder voll kann kippen, wenn sich HP-Rundungen ändern (`score/races.ts`, Epsilon 1e-9).
- [ ] Favor-Grenze prüft nur das Vorzeichen (655336 bucht +2,05 ab t5 als Resolution) → Größen-Bedingung nachrüsten, sobald ein echtes Glücksereignis eines Start-Ziel-Siegers als Resolution gebucht wird (`report.ts`: `favorBoundary`, `resolutionTurns`).
- [ ] Setup-Züge ohne Feed bleiben bewusst unentlastet (573756 t70, zweiter Schwerttanz: heute Regret 0,075, kein Tier) → handeln, falls der Experte solche Spots reklamiert; Gutschrift nur mit Floor-Anker, sonst Ergebnis-Wäsche.
- [ ] 648453 t13 HP Ice: Regret 0,1288 (inaccuracy) → erreicht er wieder 0,2, ist die erste Hälfte des Gaps erneut offen.
- [ ] 573756 t68: chanceDelta +0,0749 für die opfernde Seite → fällt der Wert unter 0,02, reicht für T17 die strenge Opfer-Schwelle ohne Aufweichung.

Engine und Messung:

- [ ] Ein Play-out verheizt eine Win-Condition in falscher Reihenfolge (Draft t56 bis t62 hält seit Runde 42 per e2e-Pin) → bei einem weiteren Fall Q5 (T39) vorziehen.
- [ ] Früher Brier: Runde 40 kostete früh 28 bp hq (0,2569 → 0,2597), spät gewann sie 84 bp; Verdacht: exakte HP-Körper geben früh zu extreme Balken → bei jeder Fitter-Runde die frühe hq-Spalte vorregistrieren; handeln, wenn zwei Runden hintereinander früh verlieren.
- [ ] hq-Tranche: n=548 (410 smogtours plus Ladder ab Rating 1700; der Ledger nennt je nach Runde 547 oder 548) → Tranche neu schneiden, wenn n unter 500 fällt oder eine neue Tranche das Verhältnis kippt.
- [ ] Einmalig anderes `punishedBy`-Label der Spikes-Zeile (Singles-Matrix 573756) bei gleichen `ev`/`expected`/`worstCase`; drei weitere Aufnahmen byte-gleich → bei Wiederholung die Options-Reihenfolge der Matrix auf Stabilität prüfen.
- [ ] 648453-Divergenz (einziger Premature-End-Rest, 1 Block von 270) → Backstop nur, falls die Rate mit dem Korpus wächst.
- [ ] gen8-Soft-Residual (573756: 9 von 138 perfekte Blöcke, soft 275, Faints einstellig) → gelegentlich dossieren, kein Verdikt-Risiko.

Umgebung:

- [ ] Browser-Build ist Teil des Feedback-Ankers: Ein Chromium-Wechsel verschiebt die letzte Gleitkomma-Stelle (573756 t81 Verify-Auswahl) → jedes Playwright-Upgrade ist eine Re-Verankerung mit `FEEDBACK_DUMP=1`; Stand `@playwright/test ^1.62.1`.
- [ ] TypeScript bleibt auf 6.x, bis typescript-eslint den nativen Compiler parst; `@types/node` folgt dem CI-Node-Major (24) → Peer-Range beobachten.
- [ ] Screenshot-Sonde `docs/probes/2026-09-03-css/` (32 Tests, 34 Screens, 0 Pixel Toleranz; Start über `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`; ihre baseURL steht fest auf Port 5174, `--dev-port` erreicht sie nicht) → als Pixel-Gate für jede UI-Runde wiederverwenden; Baseline mit `--update-snapshots` neu aufnehmen, wenn Copy oder Layout sich bewusst ändern.

Geparkte Branches:

- `r45-threshold` (6d10308, ein Commit vor e30e72a, Cache v47): Sonden-Schwelle, gemessen und nicht empfohlen; T14 macht sie überflüssig, danach löschen. Ihr Bank-Ordner ist gelöscht, die Zahlen stehen im Ledger und in `docs/perf/probes/2026-09-12-r45/paired-*.txt`.
- `r41-wide` (163efcc): weite Lesart der Tempo-Freigabe, Referenz für T26. Der Bank-Ordner ist gelöscht, die Zahlen stehen in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.
- `r43` und `r45` liegen vollständig in master (kein eigener Commit) und können weg.

## D. Standing Rules

- **D1** Kein Push ohne Ansage (Stand 18.09.: 33 Commits vor origin/master; origin steht auf ba2ce5b, Release 0.7.1).
- **D2** Vor jedem Push `npm run lint` lokal (der Pages-Workflow hat ein eigenes Lint-Gate) und `npx tsc -b` (`tsc --noEmit` prüft in diesem Solution-Setup nichts).
- **D3** Score-berührend = Cache-Bump + vorregistrierte Verdikt-Regel (hq-Tranche über `--quality hq`, n=548; glücksbereinigte Zeile mitlesen) + gepaarter Bank-Bench gegen eine frische Basis vom selben Tag + drei byte-identische Feedback-Läufe. Corpus-Re-Pins und Golden-Refreshes nur nach User-Gate.
- **D4** Verlustfrei oder render-only = drei byte-identische Feedback-Läufe + Kalibrierung ziffern-gleich + `npm run test:regression`, e2e, lint, `tsc -b`.
- **D5** Messen vor Bauen: Spike oder Sonde vor dem Design-Gate, Messkette vor Pins, roter Test vor dem Umbau. Jede Runde bekommt vor dem Bau Brainstorming und Spec.
- **D6** Byte-Vergleiche nur mit `FEEDBACK_DUMP=1` und frischen Dumps (mtime prüfen). Wanduhr-Gates und Perf-Sonden nur verschränkt mit der Basis auf einem Maschinenzustand (Runde 43: +18 % Drift bei unverändertem Code innerhalb eines Vormittags; 573756 unter Fremdlast 101 bis 440 s).
- **D7** Baum-, Wurzel- und Ziehungs-Änderungen: zuerst den Play-out-Pin einzeln fahren (Draft t56, Muk-Alola vor Heatran, `e2e/branch.spec.ts`, 34 s). Er kippt früher als die Bank (Runde 43, Runde 45). Verify- und Merge-Änderungen zuerst an der Golden 655336 messen (`docs/perf/probes/2026-09-03-r32/verify-check.spec.ts`, 34 s, billigstes Orakel).
- **D8** Fitter- und Set-Runden: Set-Diffs auf allen drei Pfaden (nackt, Harness, Feedback) VOR der Bank. Bewegt sich auf dem Harness-Pfad kein Set, misst die Bank blind (Runde 41). Die drei Pfade liefern drei Set-Stände: Produktion mit Usage-Stats und Set-Annahmen, Feedback-Harness nur mit Usage-Stats (Set-Annahmen 404), nackte Rekonstruktion ohne beides. Jede Sonde nennt ihren Pfad.
- **D9** Sonden nie unter `regression/` ablegen (die Suite sammelt sie ein; zweimal je eine Stunde verloren), sondern als `.vt.ts` unter `docs/perf/probes/<datum>/` mit eigener Vitest-Config (Vorbild `docs/perf/probes/2026-09-12-r45/vitest.probe.config.ts`). Sonden auf das Bank-Universum begrenzen (neun Minuten); den Fit-Korpus nur parser-seitig anfassen (mit Fills und Löser über eine Stunde).
- **D10** Diagnosen am Battle-State über den echten App-Pfad (Browser-Probe mit debug-Feld plus `FEEDBACK_DUMP`); nackte node-Rekonstruktion ist nicht harness-treu; `graph.results[]` hat kein turn-Feld (Index i = Turn i+1).
- **D11** Während Feedback-, e2e- und Kalibrierungsläufen nichts im Repo anfassen, auch keine Root-Markdown-Dateien (Vite reloadet, HMR zerschießt den Lauf); das gilt, bis Port 5176 leer ist. Browser-Messungen im eigenen Worktree, wenn eine zweite Session aktiv ist. Läufe über zehn Minuten abgekoppelt starten (nohup plus Marker-Datei), das Hintergrund-Tool endet sonst.
- **D12** Feedback-Läufe: `npm run test:feedback` startet seit Runde 46 über `scripts/run-e2e.mjs --dev-port 5176` (wartet auf Vites Abhängigkeits-Cache, verweigert einen belegten Port, räumt den Server am Ende ab). Weiter von Hand: drift-json vorher löschen (ein roter Lauf schreibt den Bericht zweimal, die zweite Fassung ist unvollständig), Läufe über zehn Minuten detached starten. Meldet der Starter „Port busy“, den Besitzer per `netstat` suchen und seine Kommandozeile prüfen, bevor etwas beendet wird.
- **D13** Bank: `node scripts/run-calibration.mjs --slices 6 --out .calibration/<name>` (volle Bank 210 bis 340 s; seit Runde 46 misst sie mit den Parametern der App, also mit Abgleich an jeder Zug-Grenze; `--env EVAL_CALIBRATION_RAW=1` ist das Instrument von vor Runde 46, `EVAL_CALIBRATION_LEGACY=1` ein Lauf je Stichprobe mit den heutigen Parametern; Basis `.calibration/base-20260918-live`, 833 Stellungen. Alle Bank-Zahlen in dieser Datei und im Backlog-Plan, die älter sind als der 18.09., stammen vom alten Instrument und gelten nur als Vergleich innerhalb ihrer Runde; weitere Flags `--env KEY=VALUE` und `--tranche`). A/B = zwei Ausgabeordner, dazwischen `scripts/paired-calibration.mjs` (dort `--quality hq|std`). Positions-Export über `--env EVAL_CALIBRATION_POSITIONS=<dir>`. Ist ein Slice-Lauf ungleich einem Ein-Prozess-Lauf, zuerst die mtimes von `.smogon-cache` prüfen.
- **D14** Perf-Umbauten an der Engine tragen ihre Identität dreifach: Fixture `fork-identity.json` (neu aufnehmen nur mit `PERF_IDENTITY_RECORD=1` auf dem Vorher-Code), Engine-Suite, Kalibrierung A/B ziffern-gleich. Die A-Seite einer A/B-Messung läuft auf dem Vorher-Code (Stash oder Worktree), nie auf einer Mischung. Perf-Sonde vor und nach am selben Tag: `PERF_PROBE=1 PERF_PROBE_LABEL=before|after npx playwright test -c docs/perf/probes/2026-09-03/probe.config.ts`.
- **D15** Worktree-Abbau (Vorfall 12.09. 15:25): Junctions (node_modules, .calibration, .smogon-cache, .fit-corpus) VOR `git worktree remove` einzeln und nicht-rekursiv löschen (PowerShell `[System.IO.Directory]::Delete('<worktree>\<junction>')`), dann per Reparse-Point-Scan prüfen, dass keine mehr existiert. `git worktree remove --force` folgt Junctions und löscht ihre Ziele. Seither: jede Bank-A/B mit frischer Basis am selben Tag; Vergleiche mit Ledger-Zahlen vor dem 12.09. nur mit diesem Vorbehalt. Memory `worktree-junction-removal`.
- **D16** `ALIGNMENT_SEEDS[0]` bleibt `'1,2,3,4'`; jede Listen-Änderung ist ein Cache-Version-Event. master steht auf Cache v46, `r45-threshold` trägt v47: Wer zuerst landet, nimmt die nächste Nummer.
- **D17** Gates nie durch eine Pipe leiten (Exit-Code direkt lesen); PP immer live aus `moveSlots.pp`; Commits englisch im Release-Stil, ohne Attribution.
- **D18** Design-Gates und Erklärungen in einfacher Sprache (User-Vorgabe 25.08.). Doubles und Singles sind First-Class: Neue Features decken beide von Anfang an ab (User-Vorgabe 28.08.). Der Feedback-Korpus ist reine Singles-Evidenz; Doubles-Änderungen brauchen die Bank, das VGC-Replay oder die Doubles-Fixtures als Orakel.
- **D19** `docs/` bleibt gitignored; `FeedbackEval.xlsx` und `deploy.ps1` untracked lassen (deploy.ps1 = lokales Server-Deploy via `Host vserver`, nicht pushen). `NextSteps.md` ist getrackt.
- **D20** Jede Barrel-Änderung erscheint als Fixture-Diff unter `regression/fixtures/api/` (`UPDATE_API_SNAPSHOT=1` nur bewusst; der Diff ist das API-Review); nach Paket-Änderungen `npm run pack:smoke`.

## E. Prozess: abhaken und überführen

Kurzfassung; vollständig in `docs/completed/README.md`.

1. Die Reihenfolge der Liste ist die Priorität: Die oberste Iteration ist die nächste Sitzung. Beim Start bekommt sie die nächste freie Rundennummer in ihre Überschrift, und ihre TODOs bekommen, falls sie sie noch nicht tragen, die Schritte aus dem Backlog-Plan als Unterpunkte. Schritte abhaken (Kästchen ankreuzen, Commit-Hash dazu), nicht löschen. Die Spec der Runde darf die Schritte ersetzen.
2. Am Rundenende (Teil des Abschluss-Tasks): den Block als Eintrag (Ziel / Geliefert / Gates / Lehren / Reste) an `docs/completed/<gebiet>.md` anhängen, eine Zeile in dessen Inhaltsliste, und den Abschnitt im Backlog-Plan streichen.
3. Reste einsortieren: Ein offener Rest wird ein neues TODO mit der nächsten freien T-Nummer in der passenden Iteration (samt Abschnitt im Backlog-Plan) oder eine Zeile in B; Signale → C, Regeln → D, dauerhafte Lehren → Memory-Notiz der Runde.
4. Die erledigte Iteration hier löschen und die Kopfzeile „Stand …, nach Runde N“ setzen. T-Nummern und Iterations-Nummern der übrigen bleiben stehen; Lücken in der Zählung sind gewollt.
5. Prüfen: `grep -c '\[x\]' NextSteps.md` ist 0; `grep -rc '\[ \]' docs/completed/ --exclude=README.md | grep -v ':0$'` ist leer.
