# Triage (Runde 62)

TODOs, die die Triage nach dem Umbau „Mehr Simulation“ geschlossen hat: obsolet (die Szene liest auf dem neuen Stand richtig), verworfen (ohne messbaren Nutzen für Engine oder App) oder zusammengelegt (der Inhalt lebt in einem anderen TODO weiter). Je TODO das Urteil, der Beleg, der Grund und der alte Text. Kommt ein Problem wieder, bekommt es eine neue T-Nummer. Gate 05.10.2026 „1a“. Tabelle, Berichte und Sonden: `docs/perf/probes/2026-10-04-r62/`.

## Inhalt

- T65 · Eine Zuck-Zeile wirft die Zelle nicht mehr auf eine Ziehung zurück (verwerfen)
- T14 · Klassen auf Ansage an der Wurzel (verwerfen)
- T15 · Speed-Ties als Münzwurf: Matrix, Doubles, Statik (verwerfen)
- T23 · Crits als eigene Klasse im Zellenplan (verwerfen)
- T24 · Zuck-Chance preisen statt würfeln (verwerfen)
- T77 · Paar-Plan: seltene teure Ausgänge und das sichere Zurückzucken von Fake Out (verwerfen)
- T35 · Zufallsknoten im Baum, zweiter Anlauf (Q2) (verwerfen)
- T41 · Q8 · Wurzel-Prior aus der Skizzen-Matrix (verwerfen)
- T107 · Restposten aus dem Review der Runde 60 (verwerfen)
- T75 · Der Simulator lehnt im Nachbau noch 21 Wahlen ab (verwerfen)
- T105 · Körper auf der Bank tragen Volatile vom Feld (verwerfen)
- T106 · Die Korrektur schreibt Bedingungen, die der Simulator nicht kennt (verwerfen)
- T71 · STAB nach den Spielregeln übernehmen (zusammengelegt)
- T82 · Züge, deren Katalog-Stärke beim Einsatz steigt oder fällt (zusammengelegt)
- T88 · Body Press, Psyshock und Foul Play rechnen mit den falschen Werten (zusammengelegt)
- T90 · Reste der Zug-Tabelle (verwerfen)
- T50 · Doubles-Gewichte je Format, zum gemeinsamen Wert gezogen (verwerfen)
- T33 · Rennen-Statik: PP, Körper ohne Angriff, Deckel, Priorität (verwerfen)
- T34 · Beweiser prüft die zweite Seite nur nach verlorener Probe (verwerfen)
- T87 · Endspiel-Löser und Beweiser halten Züge mit Katalog-Stärke 0 für schadlos (verwerfen)
- T55 · Score-Klammer unter zwei Schlüsseln (verwerfen)
- T29 · Engine-Preis für Choice-gebundene Cleaner (verwerfen)
- T60 · Phantom-Siebter aus der Mega-Wechselzeile (zusammengelegt)
- T62 · Das Vorschau-Häkchen ist kein bekanntes Item (verwerfen)
- T25 · Budget auffüllen, auch unter gemessenen Stats (zusammengelegt)
- T27 · Sensitivitäts-Etikett stabil machen (obsolet)
- T30 · Tempo-Evidenz: Item-Zeitraum, Bremsen, Widerspruchs-Gate (verwerfen)
- T32 · Band und Specs aus Schaden lesen (verwerfen)
- T63 · Auffüllen nach der gesehenen Angriffsseite (verwerfen)
- T36 · Scan-Wertung behalten, schwer zu findende Züge kreditieren (verwerfen)
- T44 · Prinzipien als eigene Bausteine im Bericht (verwerfen)
- T67 · Typ-Prüfung für regression/ und ui/ (verwerfen)
- T21 · Dossier: Folgte der Spieler dem Engine-Favoriten? (obsolet)
- T37 · Choke-Erkennung prüfen: drei Proben vor dem Richter (verwerfen)
- T38 · Gefrorener Richter und vierfache Bank-Ausgabe (verwerfen)
- T40 · Q9 · Ehrliche Prozente nach Spielstärke (obsolet)

### T65 · Eine Zuck-Zeile wirft die Zelle nicht mehr auf eine Ziehung zurück

- Urteil: verwerfen (nach Ruling)
- Szene: GPL DzBQ5azlO5l Zug 13 mit Stone Edge von Hand in Cobalions Set (Team-Editor-Pfad wie Runde 51), Auto-Modus = Baum, gerechnet wie die App mit groups/wurzel-zufall/app-turn.vt.ts (Dateien out/gpl-t13-edge-s0.json, out/gpl-t13-edge-whatif.json); dazu der explizite Matrix-Modus d1s1 und d2s3.
- Beleg: out/gpl-t13-edge-s0.json: Zelle Air Slash gegen Stone Edge in der Nachprüfung, Rückfall über drei Ziehungen −0,4333 (400-Seed-Mittel Runde 51: −0,4339). Angewandt wird −0,0993 = vertiefte erste Ziehung (Cobalion zuckt), die drei Ziehungen vertieft −0,0993/−0,5261/−0,5092. Stone Edge Platz 5 von 9 (0,0994); mit vertiefter Mehr-Ziehung Platz 1 (0,3383, out/gpl-t13-edge-whatif.json). Ein-Ziehungs-Fall nur im Matrix-Modus mit einem Wurf (−0,1488); Matrix-Vorgabe ist drei Würfe (src/hooks/evaluation/prefs.ts:9) und liest −0,0993.
- Grund: Der Rückfall mittelt in der Nachprüfung drei Ziehungen und trifft das 400-Seed-Mittel (−0,4333 gegen −0,4339); die Szene liest falsch wegen der Vertiefung aus der ersten Ziehung, und das trägt T16. Gilt, solange die frühe Singles-Matrix aus T110 mit drei Würfen rechnet; wählt das Gate einen Wurf, öffnet T65 wieder.
- Spielart: Singles

**Alter Text in NextSteps.md:**

> - ☐ **T65 · Eine Zuck-Zeile wirft die Zelle nicht mehr auf eine Ziehung zurück** (Zufall preisen, Mini-Runde, klein, score-berührend D3)
> 
>   GPL Zug 13, Stone Edge von Hand in Cobalions Set: Die Zelle Air Slash gegen Stone Edge soll Treffer, Fehlschlag und K. o. anteilig mischen. In der ersten Ziehung zuckt Cobalion zurück (Noivern ist schneller, Air Slash lässt zu 30 % zurückzucken). Die `cant`-Zeile lässt `classifyChild` aussteigen (`cell-blend.ts`), und `blendCellSample` fällt auf `fallback()` zurück: den Mittelwert über die Basis-Ziehungen, bei einem Seed über genau eine (`search/cell-sampler.ts`). Die Engine schreibt −0,2224 in die Zelle; das Mittel über 400 Seeds ist −0,4339, die Streuung einer Ziehung 0,19. Stone Edge landet auf Platz vier, obwohl dieselbe Zeile „tötet sicher, wenn er trifft“ anzeigt. Wie ein Tester, der das Auto einmal startet, einen Aussetzer erwischt und „springt nicht an“ notiert. Eine gelungene Mischung zieht 12 bis 16 Seeds (`BOUNDARY_DRAW_BUDGET`); der Rückfall soll auf Ereignis-Zellen ebenfalls nachziehen und dann schlicht mitteln.
> 
>   Hinweis: Die kleine Schwester von T24. T24 preist das Zurückzucken als eigene Klasse; diese Runde nimmt nur dem Rückfall die Ein-Ziehungs-Lotterie (User-Gate 19.09. 22:46, vorgezogen). Erster Schritt ist eine Zählung: Wie oft feuert der Rückfall über Bank und Feedback-Spiele, und aus welchem Grund (`cant`-Zeile, Reihenfolge nicht beobachtbar, Gewicht 0)? Auf dem ausgelieferten Set von Zug 13 feuert er nie (22 von 22 Ereignis-Zellen mischen). T14 fasst dieselbe Funktion an: eine Spec, getrennt gemessene Commits, der Play-out-Pin zuerst (D7). In Doubles schickt eine Zuck-Zeile die Zelle seit Runde 56 auf das Mittel von acht Ziehungen (Regel F3 des Paar-Plans, 25 von 712 Zählungs-Zellen); diese Runde bewegt nur Singles und sagt das im Gate.
> 
>   *Erfolg:* Die Zelle Air Slash gegen Stone Edge liegt höchstens 0,1 vom 400-Seed-Mittel (heute 0,21), Stone Edge steht im nachgetragenen Set unter den ersten zwei Zeilen, auf den Dumps bewegen sich nur Züge mit einer Rückfall-Zelle, der Play-out-Pin hält, die Bank bleibt in der vorregistrierten Linie, die Matrixzeit verschränkt gemessen im vorregistrierten Rahmen. *Plan T65:* 7 Schritte, 3 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T65 · Eine Zuck-Zeile wirft die Zelle nicht mehr auf eine Ziehung zurück
> 
> *Zufall preisen · Mini-Runde · klein · score-berührend D3*
> 
> **Problem.** `blendCellSample` (`packages/eval-engine/src/search/cell-sampler.ts`) gibt bei jeder Abweichung vom Ereignis-Modell `fallback()` zurück: den Mittelwert über `draws.slice(0, baseDraws)`. `baseDraws` ist die Seed-Zahl der Suche, in der Matrix-Stufe der App also 1. Eine `cant`-Zeile auf einer Ereignis-Seite (Zurückzucken, Schlaf, volle Paralyse) reicht dafür (`cell-blend.ts:215`). GPL Zug 13 mit nachgetragenem Stone Edge: −0,2224 aus einer gezuckten Ziehung gegen −0,4339 über 400 Seeds, Streuung einer Ziehung 0,19; Stone Edge wird vierte Wahl.
> 
> **Idee.** Der Rückfall zieht auf Ereignis-Zellen Sonden-Seeds nach und mittelt dann schlicht, statt eine einzige Ziehung für den Wert zu nehmen. Der Schätzer bleibt erwartungstreu, seine Streuung sinkt.
> 
> **Schritte**
> 
> - ☐ **1.** Zählung als Sonde (Vorlage `docs/perf/probes/2026-09-19-r51/T10/resolve-cellcensus.vt.ts`, bildet `blendCellSample` Schritt für Schritt nach): Rückfälle je Grund (`cant`-Zeile, `observeOrder` liefert null, Gewichtssumme 0) über die Singles-Bank-Stellungen und die sechs Singles-Feedback-Spiele, dazu der Anteil an allen Ereignis-Zellen.
> - ☐ **2.** Spec: Nachzieh-Zahl (16 wie `BOUNDARY_DRAW_BUDGET` oder weniger), welche Rückfall-Gründe nachziehen, vorregistrierte Linien für Bank und Matrixzeit.
> - ☐ **3.** Roter Test in `packages/eval-engine/test/`: Eine Zelle, deren erste Ziehung eine `cant`-Zeile trägt, mittelt über mehr als eine Ziehung.
> - ☐ **4.** Bau in `search/cell-sampler.ts`: `fallback()` zieht aus `PROBE_SEEDS` nach und mittelt über alle Ziehungen der Zelle.
> - ☐ **5.** Play-out-Pin einzeln (D7), danach die Golden 655336 über `verify-check.spec.ts`.
> - ☐ **6.** Gate D3: Cache-Bump, gepaarte Bank gegen eine frische Basis mit Band, drei Feedback-Läufe byte-gleich, Tier-Zählung mit gelesenen bewegten Zügen (D21), Matrixzeit verschränkt.
> - ☐ **7.** Anker ins Ledger: GPL Zug 13 mit nachgetragenem Stone Edge über `docs/perf/probes/2026-09-19-r51/T10/turn13.vt.ts` (Zellenwert, Zeilen-Reihenfolge). T24 im Plan nachziehen: Der Rückfall-Teil ist dann erledigt, T24 bleibt die Zuck-Klasse.
> 
> **Gate und Erfolg.** Wie in NextSteps.
> 
> **Doubles und Singles.** In Doubles läuft seit Runde 56 der Paar-Plan (`pair/sampler.ts`): Eine Zuck-Zeile (`cant:flinch`) oder eine Zuck-Chance auf ein später ziehendes Ziel (`flinch-chance`) schickt die Zelle dort auf das Mittel von acht natürlichen Ziehungen (Regel F3 in `pair/pattern.ts`), nie auf eine. T65 bewegt nur Singles; die Doubles-Zeilen der Bank müssen ziffern-gleich bleiben.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Wie viele Ziehungen zieht der Rückfall nach: 16 wie die Mischung oder weniger (Kosten je Rückfall-Zelle)?
> - Nur `cant`-Rückfälle nachziehen oder jeden Rückfall einer Ereignis-Zelle?
> - Läuft T65 vor T14 auf der heutigen Wurzel (eigene Messung, kleiner Diff) oder als dritter Commit danach?
> 
> **Code-Belege (Stand 1235f27)**
> 
> - `packages/eval-engine/src/search/cell-sampler.ts`: `blendCellSample`, `fallback()` mittelt über `draws.slice(0, baseDraws)`; vier Rückfall-Stellen
> - `packages/eval-engine/src/cell-blend.ts:215` bis `:218`: eine `cant`-Zeile auf einer Ereignis-Seite gilt als nicht modellierter Aussetzer; `:42` `BOUNDARY_DRAW_BUDGET = 16`; `:35` `PROBE_SEEDS`
> - `docs/perf/probes/2026-09-19-r51/T10/sighting.md` Abschnitt 4.2 (Zellen-Zählung 22 von 22 und 26 von 27) und Abschnitt 5 (Löser-Tabellen)
> 
> **Herkunft.** Sichtung T10, Runde 51; vorgezogen am User-Gate vom 19.09. 22:46.

### T14 · Klassen auf Ansage an der Wurzel

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 573756 Zug 73 (Entscheidungsstellung, Dump-Index 72), Zelle Body Press gegen Fire Fang, gerechnet wie die App (out/smogtours-gen8ou-573756-t73-base-s0.json); dazu alle 25 Singles-Noten des Korpus mit der Variante 'fehlende Klassen auf Ansage' (out/tiers/, tier-table.cjs) und die KO-Diagnosen der zehn Dumps.
- Beleg: t73: 14 Ziehungen nur 'hit-kill', 5-%-Fehlschlag fehlt; auf Ansage −0,6236 statt −0,6502, Reue Body Press 0,1206 → 0,1106, Note bleibt. 25 Singles-Noten: unter der Variante verschwindet keine, größte Zellbewegung 0,0292 in 33 Zügen. Dumps: 255 Diagnosen in 279 Singles-Zügen, alle aus der Nachprüfung (alle 330 Züge Baum, dump-census.json), Doubles 0 in 51 Zügen. Score in 33 Zügen unverändert. Nachprüfung 14 bis 196 ms gegen Bäume 1,4 bis 3,0 s (out/timing-*.json). Diagnosen nur im Feedback-Bericht (e2e-feedback/report.ts:47).
- Grund: Die Wurzel-Matrix rechnet ab Zug 1 nur noch die Nachprüfung, und dort ändert die fehlende Klasse Zellen um Hundertstel und keine Note. Die Bank sieht es nicht, weil die Nachprüfung den Score (Besuchsmittel, mcts-merge.ts:232) nie anfasst. Doubles zieht seit Runde 56 schon auf Ansage.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T14 · Klassen auf Ansage an der Wurzel** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T01)
> 
>   573756, Wurzelzelle mit einem 90-%-Zug: Die fünf Basis-Würfe treffen alle, der Sampler jagt den Fehlschlag mit elf festen Sonden-Seeds, findet ihn nicht und gibt auf. Die Wurzel preist den Zug sicherer, als er ist, und die Zug-Karte meldet 209 KO-Odds-Mismatches. Löser und Beweiser sagen dem Sim seit Runde 43 „diesmal daneben“ und bekommen die Klasse sofort; Wurzel und Verify-Sampler sollen denselben Griff nutzen.
> 
>   Hinweis: Macht die auf `r45-threshold` geparkte Sonden-Schwelle (6d10308) überflüssig; der Ledger führt diesen Umbau als ihren Nachfolger. Dieselbe Stelle in `search/cell-sampler.ts` trägt den Matrix-Tie aus T15: Wer zuerst läuft, nimmt ihn mit. In Doubles antworten die Würfel seit Runde 56 je Treffer-Instanz auf Ansage (`pair/prng.ts`); diese Runde zieht die Singles-Wurzel nach.
> 
>   *Erfolg:* Weniger Ziehungen je Randzelle als heute (Basis: 940 Ziehungen auf 111 Randzellen; Schwelle in der Spec vorregistrieren), Mismatch-Diagnosen nur noch bei echter Calc-gegen-Sim-Uneinigkeit, Play-out-Pin hält, Bank spät und hq in der vorregistrierten Linie. *Plan T14:* 8 Schritte (Schritt 6 entfällt seit Runde 56), 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T14 · Klassen auf Ansage an der Wurzel
> 
> *Zufall preisen · Runde · mittel · score-berührend (D3) · braucht T01*
> 
> **Problem.** An einer Wurzelstellung von 573756 steht ein Zug mit 90 Prozent Trefferchance. Die fünf Basis-Würfe treffen alle, also fehlt der Zelle die Fehlschlag-Klasse. Der Sampler jagt sie mit elf festen Sonden-Seeds, die ebenfalls treffen, und gibt auf: elf Sims umsonst, und die Zug-Karte meldet 209 KO-Odds-Mismatches. Die Fehlschlag-Masse verteilt sich still auf die Treffer-Klassen, die Wurzel preist den Zug also sicherer, als er ist.
> 
> **Idee.** Runde 43 hat den Würfel auf Ansage schon gebaut: Löser und Beweiser sagen dem Sim "diesmal daneben" und bekommen die Klasse sofort. Die Wurzel und der Verify-Sampler sollen an denselben Griff, wie ein Koch, der die Zutat aus dem Regal nimmt, statt den Einkaufswagen elfmal zu durchwühlen.
> 
> **Hinweis.** Macht die auf `r45-threshold` geparkte Sonden-Schwelle (6d10308) überflüssig; der Ledger führt diesen Umbau als ihren Nachfolger. Dieselbe Stelle in `search/cell-sampler.ts` trägt den Matrix-Tie aus T15: Wer zuerst läuft, nimmt ihn mit.
> 
> **Schritte**
> 
> - ☐ **1.** Miss auf dem heutigen master mit der vorhandenen Sonde, was die Wurzelzellen an Ziehungen, Diagnosen und fehlenden Klassen kosten (Basis aus Runde 45: 111 Randzellen, 940 Ziehungen, 64 Diagnosen mit 71 fehlenden Klassen).
>   - Dateien: `docs/perf/probes/2026-09-12-r45/draws.vt.ts`, `docs/perf/probes/2026-09-12-r45/vitest.probe.config.ts`
> - ☐ **2.** Schreib den roten Test: eine Wurzelzelle mit einem 90-Prozent-Zug bekommt ihre Miss-Klasse auch dann, wenn kein Basis-Seed sie zeigt, und meldet dafür keine Diagnose.
>   - Dateien: `packages/eval-engine/test/eval-cell-blend.spec.ts`
> - ☐ **3.** Zieh die erzwungenen Ziehungen aus dem Klassenpfad so heraus, dass der Wurzel-Sampler sie aufrufen kann, ohne die Logik zu verdoppeln (scriptsFor und forceMissing liegen heute privat im Modul).
>   - Dateien: `packages/eval-engine/src/search/outcome-children.ts`
> - ☐ **4.** Ersetze in blendCellSample die Schleife über PROBE_SEEDS durch eine angesagte Ziehung je fehlender Klasse und lass BOUNDARY_DRAW_BUDGET als Deckel stehen.
>   - Dateien: `packages/eval-engine/src/search/cell-sampler.ts`, `packages/eval-engine/src/cell-blend.ts`
> - ☐ **5.** Lass die KoOddsMismatch-Diagnose nur noch feuern, wenn der Sim die angesagte Klasse verweigert, also bei echter Calc-gegen-Sim-Uneinigkeit.
>   - Dateien: `packages/eval-engine/src/search/cell-sampler.ts`, `packages/eval-engine/src/types.ts`
> - ☐ **6.** (Entfällt seit Runde 56: Doubles-Wurzelzellen haben den Paar-Plan.) Entscheide und miss den Doubles-Pfad: Wurzelzellen ohne Klassenplan bleiben beim Mehr-Seed-Mittel, oder sie gruppieren nach Faint-Signatur (groupedChildren); miss beide Varianten auf der Doubles-Tranche ladder-dou-0804, bevor du wählst.
>   - Dateien: `packages/eval-engine/src/search/outcome-children.ts`, `packages/eval-engine/src/search/cell-sampler.ts`
> - ☐ **7.** Fahr die Ziehungs-Sonde erneut und leg die Wanduhr verschränkt auf ruhiger Maschine daneben (Runde 43 sah 18 Prozent Maschinen-Drift bei unverändertem Code).
>   - Dateien: `docs/perf/probes/2026-09-12-r45/draws.vt.ts`
> - ☐ **8.** Fahr den Runde-42-Play-out-Pin einzeln, bevor die Bank läuft: er kippte unter der geparkten Schwelle deterministisch und ist empfindlicher als die Bank (34 Sekunden).
>   - Dateien: `e2e/branch.spec.ts`
> - ☐ **9.** Leg dem User die bewegten Kanäle, die Wurzelwert-Diffs und die Pins vor; Re-Pins nur am User-Gate, danach r45-threshold löschen oder im Ledger als überholt vermerken.
>   - Dateien: `regression/eval-calibration.spec.ts`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump (master steht auf v46), vorregistrierte Verdikt-Regel auf der hq-Tranche (n 548) mit mitgelesener glücksbereinigter Zeile, gepaarter Bank-Bench (scripts/run-calibration.mjs plus scripts/paired-calibration.mjs, frische Basis am selben Tag, weil .calibration leer ist), drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, e2e inklusive Runde-42-Play-out-Pin, npm run test:regression, lint, tsc -b; Re-Pins nur am User-Gate. Erfolg heißt: Ziehungen je Randzelle fallen deutlich unter die 940 der Basis, die Mismatch-Diagnosen nennen nur noch echte Calc-gegen-Sim-Fälle, der Play-out-Pin hält, und die Bank hält spät und hq die vorregistrierte Linie.
> 
> **Doubles und Singles.** Singles gewinnen den Klassenpfad an der Wurzel. Doubles hat ihn seit Runde 56 schon auf Ansage: `PairPRNG` beantwortet Treffer, Volltreffer und Schadenswurf je Treffer-Instanz, und der Paar-Plan zieht den schwersten noch nicht versuchten Gegenwurf gezielt (`pair/sampler.ts`). Schritt 6 entfällt damit für Doubles; die Doubles-Zeilen der Bank müssen ziffern-gleich bleiben.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Wie hoch darf der Deckel für erzwungene Ziehungen an der Wurzel sein (Beweiser nimmt 6, Baum 6, Endspiel 16)?
> - Wird r45-threshold nach der Übernahme gelöscht, oder bleibt der Branch als Messstand stehen, obwohl sein Bank-Ordner nicht mehr existiert?
> 
> **Hintergrund**
> 
> - Geparkte Schwelle: Branch r45-threshold, Commit 6d10308 auf e30e72a, Cache v47, vier Commits hinter master (0f4c832, 8522814, 0a7bf11, dcf9526); master steht auf Cache 46.
> - Sie führte PROBE_CHASE_MIN_WEIGHT 0,15 und chasedClass ein: Klassen bis 15 Prozent analytisches Gewicht werden weder gejagt noch gemeldet.
> - Messung Runde 45 (Sonde draws.vt.ts, 38 harness-gesampelte Stellungen der sechs Feedback-Replays, d1s1-Wurzel, nackte Teams): 111 Randzellen, 940 zu 171 Ziehungen (minus 82 Prozent), 64 Diagnosen mit 71 fehlenden Klassen zu 0 (alle Tail-Klassen).
> - Bank .calibration/r45-b auf den 601 Nicht-Marker-Stellungen inert (0,2555/0,2317/0,1361 zu 0,2554/0,2316/0,1361, kein exklusiver Kipp).
> - Feedback-Läufe 1, 2 und 4 byte-gleich, kein Kanal von 13 bewegt, KO-Odds-Mismatches 209/58/208/126/87/53 zu 1/0/3/2/5/6.
> - ABER Wurzelwerte bewegen sich, wo eine Sonde bisher eine Tail-Klasse fand (648453 t10 minus 0,125 zu minus 0,069, t1 0,118 zu 0,154, größter Betrag 0,057; 573756 höchstens 0,0014), und der Runde-42-Play-out-Pin kippt deterministisch: p2 schickt Slowking, Heatran, Dragapult, Slowking, Dragapult, Muk-Alola kommt nie; ohne die zwei Schwellen-Dateien grün in 30 Sekunden (Logs e2e-pin-head.log und e2e-pin-nothreshold.log unter docs/perf/probes/2026-09-12-r45/).
> - Preis der Schwelle: 85-bis-90-Prozent-Züge verlieren an der Wurzel ihre Miss-Preisung, wenn kein Basis-Seed den Miss zeigt.
> - Runde-43-Maschinerie, die hier wiederverwendet wird: ScriptedPRNG beantwortet Trefferprobe, Crit, Schadenswurf und Tie-Reihenfolge eines benannten Zuges; classChildren zieht je nicht gezeigter Klasse einmal auf Ansage (Miss, Median-KO-Wurf, Median-Nicht-KO-Wurf, Crit nur wenn kein normaler Wurf tötet, Extremwurf als Wiederholung); Deckel heute: PROVER_DRAW_BUDGET 6 und innen 3, TREE_FORCED_CAP 6, Endspiel drawBudget gleich BOUNDARY_DRAW_BUDGET 16.
> - Verworfen in Runde 43 und nicht wieder aufzurollen: Zufallsknoten im MCTS-Baum (Bank spät plus 12 bis 15 bp, Doubles-Baum plus 44 bis 70 Prozent, Play-out-Pin kippt, seither CHANCE_NODES false), Leiterstufe 2 mit CHANCE_MAX_DEPTH 1 sparte in Doubles nichts.
> - Der Ledger registriert diesen Umbau ausdrücklich als Nachfolger der Schwelle.
> - Bank-Tranchen für die Auswertung: ladder-dou-0804 n 49, tournament-0811b n 203, ladder-ou-0802 n 137, ladder-0811 n 195, draft n 22; volle Bank n 816, hq n 548.
> - Alle alten Bank-Stände unter .calibration sind beim Worktree-Vorfall am 12.09. verloren gegangen, die Zahlen stehen in docs/perf/probes/2026-09-12-r45/paired-*.txt und im Ledger.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/search/cell-sampler.ts:157 die while-Schleife jagt fehlende Klassen mit PROBE_SEEDS
> - packages/eval-engine/src/cell-blend.ts:35 die elf festen Sonden-Seeds
> - packages/eval-engine/src/cell-blend.ts:42 BOUNDARY_DRAW_BUDGET 16 als Deckel je Randzelle
> - packages/eval-engine/src/search/cell-sampler.ts:113 die KoOddsMismatch-Diagnose entsteht aus jeder ungefundenen Klasse
> - packages/eval-engine/src/search/outcome-children.ts:201 forceMissing zieht jede fehlende Klasse auf Ansage, mit Wiederholung
> - packages/eval-engine/src/search/outcome-children.ts:137 scriptFor baut Miss, Median-KO-Wurf, Median-Nicht-KO-Wurf und Crit-Wurf
> - packages/eval-engine/src/forward/scripted-prng.ts:46 ScriptedPRNG beantwortet Treffer, Crit, Schadenswurf und Tie-Reihenfolge
> - packages/eval-engine/src/endgame/children.ts:70 der Löser nutzt den Klassenpfad bereits
> - packages/eval-engine/src/search/position.ts:290 evalCells sampelt jede Verify-Zelle mit blendRoot true
> - packages/eval-engine/src/cell-blend.ts:142 planCellEvents lehnt kombinierte Choices ab, Doubles fällt auf den Plain-Pfad
> - src/lib/eval-cache-store.ts:160 Cache-Version 46 auf master
> - e2e/branch.spec.ts:59 der Runde-42-Play-out-Pin (Draft t56, Muk-Alola vor Heatran)
> - regression/eval-calibration.spec.ts:971 der Ledger nennt die Ziehungen an der Wurzel als registrierten Nachfolger der Schwelle
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 37; Zeile 156; Zeile 147. Zusammengelegt, weil: Alle drei hängen an derselben Stelle: blendCellSample jagt fehlende Ausgangsklassen mit elf festen Sonden-Seeds. Zeile 37 (geparkte Schwelle) unterdrückt die Jagd, Zeile 156 will die erzwungenen Ziehungen stattdessen, Zeile 147 zählt die Diagnosen, die nur aus dieser Jagd entstehen. Ein Umbau erledigt alle drei.

### T15 · Speed-Ties als Münzwurf: Matrix, Doubles, Statik

- Urteil: verwerfen (nach Ruling)
- Szene: Prüfstand-Stellungen ohko-tie, speed-tie-2hko, toss-race-even, doubles-ohko-tie (regression/endgame-fixtures.ts) durch den neuen Auto-Pfad (groups/wurzel-zufall/fixture.vt.ts, out/fixtures/*.json), Wahrheit aus docs/perf/probes/2026-09-12-r43/truth-after.jsonl; Gleichstands-Zählung über die 837 exportierten Bank-Stellungen (tie-census.mjs, nur Dateien gelesen, out/tie-census.txt).
- Beleg: toss-race-even −0,001 (Wahrheit 0, Runde 43: 0,997). ohko-tie 0,5 und speed-tie-2hko 0,5 (Wahrheit 0, Runde 43: 1,0). doubles-ohko-tie 1,0 mit Beweis Masse 1 'sampled-rolls'. Statik −0,6 (score/last-pair.ts:47). Bank: 71 von 837 Stellungen mit gleich schnellem Gegnerpaar (Singles 16/585, Doubles 55/252), davon 0 letzte Paare, 0 von 31 Beweis-Zeilen, alle 28 späten Gleichstands-Zeilen mit dem Score schon auf der Siegerseite. Doubles-Nachprüfung mittelt beim Gleichstand acht Ziehungen (pair/pattern.ts:197, pair/sampler.ts:67).
- Grund: Der Baum zieht Gleichstände mit wechselnden Seeds; die Matrix-Hälfte hat keinen Ort mehr. Was bleibt, sind Prüfstände ohne Gegenstück auf Bank oder Korpus: ohko-tie und speed-tie-2hko lesen 0,5 statt 0, toss-race-even stimmt. Auf der Bank steht kein letztes Paar im Gleichstand (0 von 837) und kein Beweis auf einem Gleichstand (0 von 31). Die Baum-Hälfte schickte der Text an T35, das ebenfalls schließt. Der falsche Doubles-Beweis (doubles-ohko-tie 1,0 mit Masse 1) geht in das neue TODO zum Wurzel-Score.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T15 · Speed-Ties als Münzwurf: Matrix, Doubles, Statik** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T01)
> 
>   Prüfstand: zwei Machamp auf 1 HP, gleich schnell, jeder tötet den anderen sicher. Der Löser rechnet 0, also Münzwurf. Wurzelmatrix und Baum lesen +1,0 für p1, weil ein fester Seed die Reihenfolge ordnet; die Rennen-Statik liest −0,6. In Doubles sieht der Löser den Tie gar nicht und meldet 1,0 als exakt. Gleich schnell soll überall heißen: zwei Reihenfolgen zu je einer Hälfte.
> 
>   Hinweis: Die Baum-Hälfte des Tie-Splits liegt fertig hinter `CHANCE_NODES` und kommt mit T35 zurück; diese Runde fasst Matrix, Doubles-Löser und Statik an. An der Doubles-Wurzel schickt ein Gleichstand unter Zug-Aktionen die Zelle seit Runde 56 auf das Mittel von acht Ziehungen (Regel F2 des Paar-Plans, 68 von 712 Zählungs-Zellen); der Münzwurf ersetzt diesen Rückfall. Runde 58 hat die Stelle der Statik zur Laufzeit bestätigt: `score/last-pair.ts:47` gibt einen exakten Tempo-Gleichstand p2 (gespiegelte Garchomp 240 gegen 240 lesen −0,6).
> 
>   *Erfolg:* `ohko-tie`, `speed-tie-2hko`, `toss-race-even` und `doubles-ohko-tie` lesen 0 statt ±1 oder −0,6, die übrigen exakten Prüfstand-Zeilen bewegen sich nicht, später Bank-Brier in der vorregistrierten Linie. *Plan T15:* 9 Schritte, 7 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T15 · Speed-Ties als Münzwurf: Matrix, Doubles, Statik
> 
> *Zufall preisen · Runde · mittel · score-berührend (D3) · braucht T01*
> 
> **Problem.** Im Prüfstand stehen zwei Machamp auf 1 HP, gleich schnell, jeder tötet den anderen sicher. Der Löser rechnet 0, also 50:50. Die Wurzelmatrix liest +1,0 für p1, der Baum auch, und die Rennen-Statik liest −0,6 für p2. In Doubles sieht der Löser den Tie gar nicht: dieselbe Stellung meldet er als sicheren Sieg mit 1,0 und dem Etikett exakt. Der User sieht dort einen Balken bei 100 Prozent, wo eine Münze fällt.
> 
> **Idee.** Gleich schnell heißt zwei Reihenfolgen zu je einer Hälfte, in der Matrix, in Doubles und in der Rennen-Statik. Wie beim Anstoß im Sport: keiner setzt vorher auf eine Seite der Münze, beide Seiten zählen halb.
> 
> **Hinweis.** Die Baum-Hälfte des Tie-Splits liegt fertig hinter `CHANCE_NODES` und kommt mit T35 zurück; diese Runde fasst Matrix, Doubles-Löser und Statik an.
> 
> **Schritte**
> 
> - ☐ **1.** Zähle mit einer Sonde über das Bank-Universum (129 Replays, Vorbild docs/perf/probes/2026-09-12-r45/draws.vt.ts), wie viele Wurzelzellen einen Speed-Tie tragen, getrennt nach Singles und Doubles, damit die Kosten der Aufspaltung vor dem Bau feststehen.
>   - Dateien: `docs/perf/probes/2026-09-1X-tie/tie-count.vt.ts (NEU)`, `packages/eval-engine/src/search/outcome-children.ts`
> - ☐ **2.** Schreibe die roten Tests zuerst: doubles-ohko-tie muss im Löser 0 lesen, die Rennen-Statik muss bei gleichen Uhren 0 liefern, und eine Wurzelzelle mit Tie muss zwei Klassen zu je 0,5 tragen.
>   - Dateien: `packages/eval-engine/test/endgame-solver.spec.ts`, `packages/eval-engine/test/eval-last-pair.spec.ts`, `packages/eval-engine/test/outcome-children.spec.ts`
> - ☐ **3.** Öffne speedTie für Doubles (die Funktion steigt heute in Zeile 101 bei gameType ungleich singles aus) und lege fest, wie die Reihenfolge der vier Aktiven in Klassen fällt.
>   - Dateien: `packages/eval-engine/src/search/outcome-children.ts`, `packages/eval-engine/src/cell-blend.ts`
> - ☐ **4.** Gib der Rennen-Statik einen Tie-Wert 0: pairRace liefert bei gleichen Uhren heute movesFirst und damit ±0,6, weil movesFirst bei exakt gleicher Geschwindigkeit false zurückgibt.
>   - Dateien: `packages/eval-engine/src/score/last-pair.ts`, `packages/eval-engine/src/speed.ts`
> - ☐ **5.** Spalte die Wurzelmatrix am Tie in beide Reihenfolgen mit je einem halben Gewicht, über die gescripteten Ziehungen statt über Seed-Glück.
>   - Dateien: `packages/eval-engine/src/search/cell-sampler.ts`, `packages/eval-engine/src/forward/scripted-prng.ts`, `packages/eval-engine/src/search/outcome-children.ts`
> - ☐ **6.** Bewerte die offene Masse des Beweisers ohne Statik-Verzerrung: openFields mittelt die offenen Zweige mit leafValue, und leafValue liefert im Tie-Rennen ±0,6 statt 0.
>   - Dateien: `packages/eval-engine/src/endgame/prover.ts`, `packages/eval-engine/src/search/forced-win-apply.ts`
> - ☐ **7.** Fahre den Prüfstand über die 26 synthetischen Endspiele vor und nach dem Umbau und lege die Tabelle neben truth-before und truth-after der Runde 43.
>   - Dateien: `regression/endgame-truth.spec.ts`, `scripts/endgame-truth-table.mjs`, `regression/endgame-fixtures.ts`
> - ☐ **8.** Miss in dieser Reihenfolge: e2e-Play-out-Pin einzeln (34 s), dann die gepaarte Bank gegen eine frische Basis desselben Tages, dann drei Feedback-Läufe mit FEEDBACK_DUMP=1.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`, `scripts/run-e2e.mjs`
> - ☐ **9.** Lege dem User die bewegten Kanäle vor (649664 t23 und 573756 t138 sind die wahrscheinlichen) und hole das Re-Pin-Gate.
>   - Dateien: `e2e-feedback/corpus.ts`, `regression/eval-calibration.spec.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche (n=548) mit mitgelesener glücksbereinigter Zeile, gepaarter Bank-Bench (run-calibration.mjs plus paired-calibration.mjs, frische Basis am selben Tag), drei byte-identische Feedback-Läufe, Re-Pins nur am User-Gate. Erfolg wird zweifach gemessen: der Prüfstand liest ohko-tie, speed-tie-2hko, toss-race-even und doubles-ohko-tie als 0 statt als ±1 oder −0,6, und die späte Bank-Brier bleibt innerhalb der vorregistrierten Linie. Der Play-out-Pin läuft einzeln vor der Bank, weil er empfindlicher ist als sie.
> 
> **Doubles und Singles.** Der Kern des Punktes ist Doubles: der Tie-Split existiert heute nur in Singles (outcome-children.ts:101). An der Doubles-Wurzel schickt seit Runde 56 ein Gleichstand unter Zug-Aktionen die Zelle auf das Mittel von acht Ziehungen (Regel F2 in `pair/pattern.ts`, 68 von 712 Zählungs-Zellen der Runde 56); der Münzwurf ersetzt dort diesen Rückfall durch zwei Klassen zu je einer Hälfte (`PairPRNG` notiert den Gleichstand schon). Singles bekommt die Matrix-Hälfte und den Statik-Tie-Wert, Doubles bekommt die Erkennung überhaupt. Der Prüfstand hat für beide Spielarten eine Stellung: ohko-tie, speed-tie-2hko und toss-race-even in Singles, doubles-ohko-tie in Doubles. Singles sind der Bau-Fall: speedTie prüft heute gameType singles. Doubles werden in derselben Runde gemessen (doubles-ohko-tie liest exakt 1,000, obwohl der Wert eine Münze ist, weil die drei Plain-Ziehungen den Tie gleich ordneten); die Sonde aus Schritt 1 zählt Doubles-Ties getrennt, und die offene Frage, ob die Runde den Doubles-Tie mitnimmt oder ihn an die Löser-Folgerung (3) abgibt, geht vor dem Bau ans User-Gate.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Doubles-Wurzel: Der Paar-Plan notiert den Gleichstand schon (`PairPRNG`) und fällt heute auf acht Ziehungen zurück (Regel F2, 68 von 712 Zählungs-Zellen). Werden daraus zwei Klassen zu je einer Hälfte, oder bleibt der Rückfall? Löser und Baum lesen Doubles weiter über `planCellEvents`, das dort scheitert; ihren Tie trägt die Entscheidung, ob die Runde den Doubles-Tie mitnimmt.
> - Zählt in Doubles jede Reihenfolge der vier Aktiven als eigene Klasse (bis zu vier Gruppen) oder nur das Slot-Paar, das sich trifft?
> - Läuft der Matrix-Split nur an der Wurzel (Kosten) oder auf jeder Matrix-Tiefe?
> - Ersetzt der Tie-Wert 0 die Münzwurf-Regel des Beweisers (Masse genau 0,5 bewegt keinen Score, 295be63) oder bleiben beide Regeln nebeneinander?
> - Nimmt die Runde den Doubles-Tie mit, oder bleibt er bei der Löser-Folgerung (3)?
> - Baut die Runde nur den Tie-Zweig, oder ersetzt sie die Sonden-Jagd der Wurzelzelle gleich ganz durch erzwungene Ziehungen?
> - Darf der sichtbare Balken einer Tie-Stellung von voll auf halb springen, ohne dass ein Pin bewegt wird?
> 
> **Hintergrund**
> 
> - Prüfstand-Zahlen (docs/perf/probes/2026-09-12-r43/truth-after.jsonl, 26 synthetische Stellungen): ohko-tie Wahrheit 0,000 bei Statik −0,600, d1 1,000, MCTS 1,000, Beweiser 1,000 mit Masse 0,5; speed-tie-2hko dieselbe Zeile; toss-race-even Wahrheit 0,000 bei Statik −0,600, d1 −0,600, MCTS 0,997, Beweiser −0,600 mit Masse 0,5; doubles-ohko-tie Wahrheit 1,000 ohne Etikett (der Löser sieht den Tie nicht) bei Statik −0,600, d1 und MCTS 1,000.
> - Runde 34 (docs/perf/2026-09-04-endgame-truth.md): die drei Singles-Tie-Zeilen sind der ganze Grund, warum die Statik in Singles (n=8) eine bessere Brier hat als die Suchen (0,0744 gegen 0,1078 bis 0,1250).
> - Fixtures: ohko-tie ist zwei Machamp auf 1 HP, speed-tie-2hko zwei Garchomp mit Earthquake auf 150 HP, doubles-ohko-tie dasselbe Machamp-Paar in Doubles.
> - Der Singles-Split entstand in Runde 34 (Commit a6828ad) und zieht seit Runde 43 beide Reihenfolgen über den gescripteten Würfel (a42e634 ScriptedPRNG, a98b3dc outcome-children, 351a9fc Löser und Beweiser).
> - Der Beweiser bekam in Runde 35 die Münzwurf-Regel (295be63), weil toss-race-even unter der Bar −0,8 statt 0 gelesen hatte.
> - Die offene Masse geht über openFields in den Score (score = mass mal Vorzeichen plus (1 minus mass) mal openValue).
> - Der Baum-Split liegt fertig und ausgeschaltet (CHANCE_NODES = false, 9ff493c); er kostete in Runde 43 spät 12 bis 15 bp auf der Bank, +44 bis +70 Prozent Doubles-Baumzeit und kippte den Play-out-Pin (Draft t56, Gengar statt Muk-Alola, p2 gewinnt in Zug 68 statt 65).
> - Warnung aus Runde 45: die geparkte Sonden-Schwelle (Branch r45-threshold, Commit 6d10308) war auf der Bank inert und kippte trotzdem denselben Pin.
> - Bank-Basis heute: spät 0,1285, hq 0,1286, K 2,19 (Runde 45); die .calibration-Stände sind beim Worktree-Vorfall gelöscht, die Zahlen stehen in docs/perf/probes/2026-09-12-r45/paired-*.txt.
> - Prüfstand Runde 34, docs/perf/2026-09-04-endgame-truth.md: drei Singles-Tie-Zeilen mit exaktem Wert 0,000 lesen in d1 bis d3 und in MCTS +1,000, die Rennen-Statik minus 0,600 (Tabellenzeilen 128 ohko-tie, 130 speed-tie-2hko, 214 toss-race-even).
> - Die Doubles-Zeile doubles-ohko-tie liest exakt 1,000, weil die drei Plain-Ziehungen den Tie gleich ordneten und die Singles-Tie-Regel in Doubles nicht läuft (Berichtszeilen 16 und 161).
> - Auf den 14 exakten Zeilen hat d1 die beste Brier (0,0632), dann MCTS (0,0664), d2 und d3 (0,0714), die Statik zuletzt (0,0947); in Singles schlägt die Statik die Suchen nur wegen dieser drei Tie-Zeilen.
> - Der Löser splittet den Tie seit Runde 34 mit Münzwurf-Regel und zieht seit Runde 43 beide Reihenfolgen auf Ansage (RollScript-Feld first, shuffle über die Zug-Aktionen, ScriptedPRNG in forward/scripted-prng.ts).
> - Heute steht speedTie nur in search/outcome-children.ts und wird nur von classChildren gerufen; die Wurzelmatrix geht über sampleCell und blendCellSample, liest eine Reihenfolge mit observeOrder aus den Basis-Logs und faltet die Klassen nur für diese Reihenfolge, fehlende Klassen jagt sie mit PROBE_SEEDS bis BOUNDARY_DRAW_BUDGET 16.
> - Wurzel-Sampling der App und der Bank: search/position.ts:290 mit blendRoot true, tiefere Zellen search/matrix.ts:52.
> - Verwandt: Runde 45 hat die Sonden-Jagd mit einer Gewichtsschwelle 0,15 gemessen (Ziehungen minus 82 Prozent, KO-Mismatches 741 auf 17, Bank inert, Play-out-Pin kippt, Wurzelwerte bewegen sich wo eine Sonde bisher eine Tail-Klasse fand, 648453 t10 minus 0,125 auf minus 0,069) und auf Branch r45-threshold mit Cache v47 geparkt; der dort genannte Nachfolger heißt Klassen auf Ansage auch an der Wurzel und ist derselbe Umbau.
> - Sonden-Muster für die Zählung: docs/perf/probes/2026-09-12-r45/draws.vt.ts, 38 harness-gesampelte Stellungen der sechs Feedback-Replays, d1s1-Wurzel, nackte Teams, Hebel PROBE_ROOT und DRAWS_OUT.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/search/outcome-children.ts:101 speedTie steigt bei gameType ungleich singles aus
> - packages/eval-engine/src/search/outcome-children.ts:119 expectedGroups teilt bei Tie jede Klasse auf zwei Reihenfolgen zu je einer Hälfte
> - packages/eval-engine/src/search/outcome-children.ts:155 scriptsFor setzt die Tie-Reihenfolge per Skript auf den Zug der Seite, die zuerst ziehen soll
> - packages/eval-engine/src/score/last-pair.ts:47 gleiche Uhren liefern movesFirst und damit ±0,6
> - packages/eval-engine/src/speed.ts:71 movesFirst gibt bei exakt gleicher Geschwindigkeit false zurück, also p2
> - packages/eval-engine/src/search/cell-sampler.ts:183 sampleCell kennt keinen Tie, der Klassenpfad läuft allein über planCellEvents
> - packages/eval-engine/src/cell-blend.ts:142 planCellEvents scheitert an kombinierten Doubles-Zügen
> - packages/eval-engine/src/endgame/prover.ts:377 openFields bewertet die offene Masse mit leafValue, also mit der Statik
> - packages/eval-engine/src/search/forced-win-apply.ts:58 der Score mischt bewiesene Masse und openValue
> - packages/eval-engine/src/search/expansion.ts:29 CHANCE_NODES = false hält den Baum-Split aus
> - regression/endgame-fixtures.ts:94 ohko-tie, :116 speed-tie-2hko, :142 doubles-ohko-tie
> - packages/eval-engine/src/search/outcome-children.ts:100 - speedTie prüft gameType singles, gleiche Priorität und gleiche effektive Geschwindigkeit
> - packages/eval-engine/src/search/outcome-children.ts:225 - nur classChildren ruft speedTie, also nur Löser, Beweiser und der ausgeschaltete Baumpfad
> - packages/eval-engine/src/search/cell-sampler.ts:148 - blendCellSample nimmt eine einzige Reihenfolge aus observeOrder
> - packages/eval-engine/src/search/cell-sampler.ts:155 - die Wurzelzelle jagt fehlende Klassen mit PROBE_SEEDS statt sie zu ziehen
> - packages/eval-engine/src/search/position.ts:290 - Wurzelzellen werden mit blendRoot true gesampelt
> - regression/endgame-fixtures.ts:92 - Fixture toss-race-even, :94 ohko-tie, :116 speed-tie-2hko, :142 doubles-ohko-tie
> - docs/perf/2026-09-04-endgame-truth.md:128 - Tabellenzeile ohko-tie exakt 0,000 gegen d1 bis d3 und MCTS 1,000
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 24 (1); Zeile 24 (3); Zeile 25 (Tie-Split in Doubles); Zeile 25 (offene Hälfte einer Teilmasse ohne Statik-Verzerrung); Zeile 24 (1) Matrix-Hälfte. Zusammengelegt, weil: Alle vier Punkte haben dieselbe Ursache (zwei gleich schnelle Züge sind ein Münzwurf), dieselben vier Prüfstand-Stellungen als Messung und dasselbe Gate. Die offene Masse des Beweisers wird mit der Statik bewertet, und die Verzerrung entsteht genau in Tie-Rennen, also verschwindet sie mit dem Tie-Wert. Die Baum-Hälfte desselben Punktes liegt fertig in outcome-children.ts und kommt mit dem Schalter der ersten Runde zurück; offen ist nur die Matrix, und die ist eine andere Datei (search/cell-sampler.ts) mit einer eigenen Messung (Wurzelwerte, KO-Odds-Diagnostik, frühe und mittlere Bank).

### T23 · Crits als eigene Klasse im Zellenplan

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Beweise in den zehn Dumps (dump-census.json, Feld forced), 649664 Zug 23, die ungepreisten Prüfstand-Stellungen healer-burned, toxic-stall, two-v-one-sack, setup-vs-heal, doubles-spread-2v1, doubles-1v2-spread im neuen Auto-Pfad (out/fixtures/), Beweis-Zeilen der Bank (.calibration/r61-t98b/merged.jsonl, forcedWinMass) und die einzige falsche davon (out/pos-2663108091-t26.json).
- Beleg: Korpus: 12 Beweise in 330 Zügen, 3 mit 'barring-crit' (649664 Masse 0,8; 573756 Masse 0,663 und 1,0); der Satz spricht ab Masse 0,9 und ist wahr (summary.ts:48 bis :49). 649664 t23 Bar 0,788: eine Crit-Klasse senkt die Masse, hebt die Bar nicht auf 0,92. Prüfstand: healer-burned −1 und toxic-stall −1 (Wahrheit −1), two-v-one-sack 0,8395 gegen 0,761 und setup-vs-heal 0,833 gegen 1,0 sind gedeckelt, Fehler aus der Suchtiefe. 'unpriced' setzt nur der Löser (endgame/solver.ts:108), der in der App nicht läuft. Bank: 31 Beweis-Zeilen, 30 richtig, die falsche (gen9ou-2663108091 Zug 26) mit Vorbehalt 'none'.
- Grund: Der Crit steckt anteilig in der K.-o.-Quote und im ehrlichen Vorbehalt des Beweisers. Eine eigene Klasse würde wenige Beweise um einige Prozent Masse senken; die Bank hat keinen Beweis, den ein Crit falsch macht. Die Wurzel-Hälfte träfe nur die Nachprüfung, und die ändert den Score nicht.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T23 · Crits als eigene Klasse im Zellenplan** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T15)
> 
>   Der Zellenplan kennt drei Ausgänge: daneben, Treffer mit KO, Treffer ohne KO. Der Crit steckt nur als Beimischung in der KO-Quote. Deshalb bleiben im Prüfstand 6 von 26 Stellungen ungepreist, und viele Beweise tragen „barring a crit“. 649664 Zug 23: Der offene Crit senkt die Bar von 0,92 auf 0,79.
> 
>   Hinweis: Der Doubles-Plan aus Runde 56 (`pair/pattern.ts`) mischt den Crit genauso nur in die K.-o.-Quote; die Crit-Klasse gehört in beide Pläne.
> 
>   *Erfolg:* `healer-burned`, `toxic-stall`, `two-v-one-sack` und `setup-vs-heal` verlieren das Etikett ungepreist, weniger Beweise mit „barring a crit“, Bank und Perf (verschränkt gemessen) in der vorregistrierten Linie. *Plan T23:* 8 Schritte, 4 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T23 · Crits als eigene Klasse im Zellenplan
> 
> *Zufall preisen · Runde · mittel · score-berührend (D3) · braucht T15*
> 
> **Problem.** Der Zellenplan kennt drei Ausgänge: daneben, Treffer mit KO, Treffer ohne KO. Der Crit steckt nur als Beimischung in der KO-Quote. Deshalb bleiben im Prüfstand nach Runde 43 sechs von 26 Stellungen ungepreist, und der Beweiser hängt an viele Beweise das Etikett 'barring a crit'. An 649664 t23 senkt der offene Crit die Bar von 0,92 auf 0,79, und der User liest eine Zahl, deren Abschlag im Bericht nicht vorkommt.
> 
> **Idee.** Der kritische Treffer bekommt eine eigene Spur im Plan, so wie der Fehlschuss eine hat. Dann kann die Engine sagen: in 94 von 100 Spielen so, in 6 von 100 mit Crit so, statt den Crit in einer Mischzahl zu verstecken.
> 
> **Schritte**
> 
> - ☐ **1.** Zähle über die sechs Feedback-Replays und das Bank-Universum, wie viele Wurzel- und Beweiser-Zellen heute ein barring-crit tragen und wie viele Klassen je Zelle dazukämen, damit die Kostengrenze vor dem Bau steht.
>   - Dateien: `docs/perf/probes/2026-09-1X-crit/crit-count.vt.ts (NEU)`, `packages/eval-engine/src/endgame/prover.ts`, `packages/eval-engine/src/cell-blend.ts`
> - ☐ **2.** Schreibe die roten Tests: healer-burned und toxic-stall müssen ohne das Etikett unpriced lösen, und eine Zelle mit einem Crit-KO muss zwei Treffer-Klassen mit den Gewichten aus critRate tragen.
>   - Dateien: `packages/eval-engine/test/eval-cell-blend.spec.ts`, `packages/eval-engine/test/outcome-children.spec.ts`, `regression/endgame-truth.spec.ts`
> - ☐ **3.** Erweitere den Ausgangs-Fold um die Crit-Spur: foldClassWeights kennt heute miss, hit-kill und hit-nokill, und die KO-Quote mischt Crit und Normalwurf schon vorher (killFraction = (1 minus c) mal normal plus c mal crit).
>   - Dateien: `packages/eval-engine/src/cell-blend.ts`, `packages/eval-engine/src/ko-odds.ts`
> - ☐ **4.** Lies die neue Klasse aus dem Log zurück (classifyChild sieht die Crit-Zeile des Protokolls) und ziehe sie auf Ansage, wenn kein Basis-Seed sie zeigt; scriptFor kann den Crit schon erzwingen.
>   - Dateien: `packages/eval-engine/src/cell-blend.ts`, `packages/eval-engine/src/search/outcome-children.ts`, `packages/eval-engine/src/forward/scripted-prng.ts`
> - ☐ **5.** Nimm das Caveat barring-crit zurück, wo der Plan den Crit jetzt trägt, und lass survivedHit nur noch dort greifen, wo wirklich keine Crit-Klasse existiert.
>   - Dateien: `packages/eval-engine/src/endgame/prover.ts`, `packages/eval-engine/src/types.ts`
> - ☐ **6.** Deckle die Klassenzahl je Zelle und passe die Ziehungsbudgets an (Wurzel 16, Beweiser-Wurzel 6, innere Zellen 3, Baum 6), damit die Zellen nicht teurer werden als der Gewinn.
>   - Dateien: `packages/eval-engine/src/cell-blend.ts`, `packages/eval-engine/src/endgame/prover.ts`, `packages/eval-engine/src/endgame/children.ts`
> - ☐ **7.** Fahre den Prüfstand vor und nach, dann die Perf-Sonde verschränkt auf einem Maschinenzustand, dann den Play-out-Pin, die gepaarte Bank und drei Feedback-Läufe.
>   - Dateien: `regression/endgame-truth.spec.ts`, `docs/perf/probes/2026-09-03/probe.config.ts`, `scripts/paired-calibration.mjs`
> - ☐ **8.** Lege 649664 t23 (Caveat und Bar) und 573756 t138 (Masse) dem User vor und hole das Re-Pin-Gate.
>   - Dateien: `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche mit glücksbereinigter Zeile, gepaarter Bank-Bench, drei byte-identische Feedback-Läufe, Re-Pins nur am User-Gate. Erfolg: die vier ungepreisten Singles-Stellungen des Prüfstands (healer-burned, toxic-stall, two-v-one-sack, setup-vs-heal) verlieren das Etikett, die Zahl der Beweise mit Caveat barring-crit sinkt, und Bank wie Perf bleiben in der vorregistrierten Linie (Perf verschränkt gemessen, die Maschine driftete in Runde 43 um 18 Prozent bei unverändertem Code).
> 
> **Doubles und Singles.** Seit Runde 56 läuft die Doubles-Wurzel über den Paar-Plan: Er mischt den Crit wie Singles nur in die Kill-Anteile ((1 − c) · k/16 + c · k'/16 in `pair/pattern.ts`). Die Crit-Klasse zerlegt dort die Kill-Anteile in eine eigene Klasse mit der Ansage `crit: true`, die `PairPRNG` schon beantwortet. Die zwei ungepreisten Doubles-Stellungen des Prüfstands (doubles-spread-2v1, doubles-1v2-spread) liegen im Löser-Pfad, den Runde 56 nicht anfasst; dort bleibt die erzwungene Crit-Ziehung im empirischen Pfad (groupedChildren nach Faint-Signatur) der Weg.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Wie viele Klassen darf eine Zelle tragen? Mit Crit werden aus drei Ausgängen je Seite fünf, bei zwei Ereignis-Seiten also bis zu 25 Kombinationen.
> - Bekommt der Crit ohne KO eine eigene Klasse oder nur der Crit, der tötet? Ein Crit ohne KO ändert den Schaden, den Substitute-Bruch und die Verteidigungs-Stufen.
> - Zählt der Crit-Anteil aus critRate mit Crit-Ratio des Zuges, oder braucht die Klasse auch Fähigkeiten wie Sniper und Items wie Scope Lens?
> - Soll der Bericht 'barring a crit' erklären, wenn der Unterschied über 0,1 liegt (Beobachtung aus Runde 43)?
> 
> **Hintergrund**
> 
> - Nach Runde 43 bleiben 6 von 26 synthetischen Stellungen ungepreist: healer-burned, toxic-stall, two-v-one-sack und setup-vs-heal in Singles (Crit außerhalb des Plans), doubles-spread-2v1 und doubles-1v2-spread in Doubles (Plain-Pfad).
> - Runde 34 zählte 36 von 51, damals mit 25 Bank-Stellungen im Feld; die Bank-Stellungen sind seitdem nicht wieder gelaufen.
> - Runde 43 hob die synthetische Zeile von 13 auf 19 exakt gelöste Stellungen (focus-blast-range, healer-vs-band, struggle-lock, choice-locked, two-v-one-switch-loop, doubles-healer-vs-band kamen dazu; one-v-two-breaker ist nur noch capped).
> - Der Plan kennt drei Ausgänge je Ereignis, die KO-Quote mischt Crit und Normalwurf analytisch, und der gescriptete Würfel erzwingt einen Crit nur als Weg zu hit-kill, wenn kein normaler Wurf tötet.
> - Der Beweiser hängt barring-crit an, sobald ein Verteidiger einen critfähigen Treffer in einem bewiesenen Kind überlebt.
> - Korpus-Belege: 649664 t23 wechselte in Runde 43 von sampled-rolls auf barring-crit, die Wurzel las danach 0,79 statt 0,92; 573756 t138 p2-Masse stieg von 0,641 auf 0,663 und liegt weiter unter der Sprechschwelle SPOKEN_MASS 0,9 (Runde 35 hatte dort Masse 0,88 auf dem App-Pfad gemessen, auch 150 Zellen änderten daran nichts).
> - Kosten: jede neue Klasse kostet eine erzwungene Ziehung plus ein makeNode je Kind; die Ziehungsbudgets sind BOUNDARY_DRAW_BUDGET 16 an der Wurzel, PROVER_DRAW_BUDGET 6, PROVER_INNER_DRAW_BUDGET 3 und TREE_FORCED_CAP 6.
> - Verwandt: der Verify-Sampler jagt Klassen weiterhin mit den elf Probe-Seeds statt auf Ansage.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/cell-blend.ts:269 foldClassWeights kennt nur miss, hit-kill und hit-nokill
> - packages/eval-engine/src/ko-odds.ts:180 killFraction mischt Crit und Normalwurf zu einer Zahl
> - packages/eval-engine/src/search/outcome-children.ts:137 scriptFor nimmt den Crit nur, wenn kein normaler Wurf tötet
> - packages/eval-engine/src/endgame/prover.ts:350 survivedHit setzt das Caveat barring-crit
> - packages/eval-engine/src/endgame/prover.ts:103 sampled markiert Doubles- und Plain-Zellen als sampled-rolls
> - packages/eval-engine/src/endgame/children.ts:73 unpriced heißt: eine erwartete Klasse fehlt
> - packages/eval-engine/src/search/cell-sampler.ts:157 der Verify-Sampler jagt fehlende Klassen weiter mit Probe-Seeds
> - docs/perf/probes/2026-09-12-r43/truth-after.txt:5 Deckung 26 Items, 19 exakt, 3 capped, 6 unpriced
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 24 (4); Zeile 25 (Crits als Klasse). Zusammengelegt, weil: Beide Punkte nennen dieselbe Lücke im selben Modul (der Zellenplan kennt Treffer und KO-Bereich, keinen Crit) und werden an derselben Zahl gemessen (ungepreiste Stellungen im Prüfstand, Caveat barring-crit im Beweiser).

### T24 · Zuck-Chance preisen statt würfeln

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: GPL DzBQ5azlO5l Zug 15 (Noivern gegen Rotom-Wash, Bene wechselt auf Vileplume), Auto-Modus wie die App, Bäume mit drei Seed-Sätzen (Versatz 0 bis 3, 4 bis 7, 8 bis 11): out/gpl-t15-base-s0.json, -s4.json, -s8.json; dazu GPL Zug 13 mit Stone Edge und die Doubles-Regel F3 im Code.
- Beleg: Vileplume-Wechsel Reue 0 (bester Zug), 0,005 und 0,018: in keinem Seed-Satz eine Note. Zelle Air Slash gegen Volt Switch −0,0103/0,0121/−0,0819 (Spanne 0,09), das Urteil bleibt. Nur der explizite Matrix-Modus (Vorgabe d2s3) nennt noch 'inaccuracy' (0,148). GPL t13: Rückfall über drei Ziehungen −0,4333 trifft das 400-Seed-Mittel, der Fehler kommt aus der Vertiefung (T16). Doubles: Zuck-Chance oder Zurückzucken mittelt acht Ziehungen (pair/pattern.ts:70 bis :77 und :190, pair/sampler.ts:28 und :67). Score in 33 Zügen unter keiner Nachprüfungs-Variante bewegt.
- Grund: Im Auto-Modus liest die Szene richtig, und die verbleibende Zuck-Streuung sitzt im Baum: Jeder der vier Bäume zieht die Wurzelzelle einmal (GPL t13: 2 von 4 Bäumen außerhalb des Klassenplans, erwartet 28,5 %). Das ist der Hebel der Zufallsknoten (T35), nicht der des Samplers.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T24 · Zuck-Chance preisen statt würfeln** (Zufall preisen, Runde, groß, score-berührend D3)
> 
>   GPL-Spiel DzBQ5azlO5l Zug 15: Noivern (55/161) steht gegen ein frisches Rotom-Wash, Bene wechselt auf Vileplume, die Engine nennt das einen Fehler. Air Slash lässt das Ziel zu 30 % zurückzucken, aber die Engine preist das Zurückzucken nicht als Anteil: Welcher der festen Seeds zieht, entscheidet, ob Rotom in der Rechnung zurückzuckt. Bei einem sicher treffenden Zuck-Zug ohne KO rechnet die Zelle sogar mit einem einzigen Seed. Die Zuck-Chance bekommt denselben Rang wie der Fehlschlag: eine eigene Klasse mit Gewicht.
> 
>   Hinweis: Teilt Klassen-Arithmetik und Dateien mit T23 (`cell-blend.ts`, `outcome-children.ts`, `scripted-prng.ts`); eine gemeinsame Spec spart einen Messzyklus. Aus der Sichtung T10 (Runde 51): Eine `cant`-Zeile auf einer Ereignis-Seite lässt `classifyChild` aussteigen (`cell-blend.ts`), und die Zelle fällt auf eine einzige Ziehung zurück, wo eine gelungene Mischung 12 bis 16 zieht. GPL Zug 13 mit von Hand nachgetragenem Stone Edge: −0,2224 aus einer gezuckten Ziehung gegen ein Mittel von −0,4339 über 400 Seeds, Streuung einer Ziehung 0,19. Auf dem ausgelieferten Set mischt Zug 13 sauber (22 von 22 Ereignis-Zellen); als Prüfstein taugt er nur mit nachgetragenem Zug, und ein Fehler-Band erzeugt die Zuck-Klasse dort nicht (Reue höchstens 0,052, weil Noivern im Gleichgewicht ausweicht). Die Spec sagt, ob die Zuck-Chance eine eigene Klasse wird (Zelle −0,43) oder die vorhandenen Gewichte sie tragen (−0,54). In Doubles läuft seit Runde 56 der Paar-Plan: Eine Zuck-Chance auf ein später ziehendes Ziel oder ein echtes Zurückzucken schickt die Zelle dort auf das Mittel von acht Ziehungen (Regel F3: 8 Zuck-Chancen und 25 `cant:flinch`-Zeilen von 712 Zählungs-Zellen). 13 der 25 sind Fake Out allein, das sicher zurückzucken lässt; die nimmt T77 heraus. Für die übrigen ersetzt die Zuck-Klasse den Rückfall, in beiden Plänen. Den Rückfall auf eine Ziehung nimmt T65 vorweg; hier bleibt die Zuck-Klasse.
> 
>   *Erfolg:* Weniger Zellen fallen wegen einer `cant`-Zeile auf das Seed-Mittel zurück, GPL Zug 15 hängt nicht mehr am Seed, Play-out-Pin hält, Bank in der vorregistrierten Linie. *Plan T24:* 9 Schritte, 5 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T24 · Zuck-Chance preisen statt würfeln
> 
> *Zufall preisen · Runde · groß · score-berührend (D3)*
> 
> **Problem.** Im GPL-Spiel DzBQ5azlO5l steht an Zug 15 Noivern mit 55 von 161 Leben gegen ein frisches Rotom-Wash. Bene wechselt auf Vileplume, und die Engine nennt das einen Fehler, weil die Zeile Air Slash im Sim gut aussieht. Air Slash hat aber nur 30 Prozent Zuck-Chance, und die Engine preist sie nicht als Anteil: welcher der fünf festen Seeds gerade zieht, entscheidet, ob Rotom in der Rechnung zuckt oder nicht. Der User liest daraus ein Urteil, das an einer Münze hängt.
> 
> **Idee.** Die Engine kennt heute nur zwei Würfel pro Zug: trifft der Angriff, und tötet der Schaden. Alles andere, Zucken und Statuswerte-Senken, fällt in den Seed. Wir geben der Zuck-Chance denselben Rang wie dem Fehlschlag: eine eigene Klasse mit ihrem Gewicht, so wie ein Wetterbericht 30 Prozent Regen nennt statt zu würfeln, ob es regnet.
> 
> **Hinweis.** Teilt Klassen-Arithmetik und Dateien mit T23 (`cell-blend.ts`, `outcome-children.ts`, `scripted-prng.ts`); eine gemeinsame Spec spart einen Messzyklus.
> 
> **Schritte**
> 
> - ☐ **1.** Zähl mit einer Sonde über die sechs Feedback-Replays, wie oft eine Wurzel-Zelle den Klassen-Blend verlässt, weil classifyChild an einer cant-Zeile null liefert, und wie oft eine Zelle mit 100-Prozent-Zug und Sekundäreffekt mit nur einem Seed gerechnet wird.
>   - Dateien: `packages/eval-engine/src/search/cell-sampler.ts`, `packages/eval-engine/src/cell-blend.ts`, `docs/perf/probes/2026-09-12-r45/vitest.probe.config.ts`
> - ☐ **2.** Miss an der GPL-Stellung Zug 15 die Zeile Air Slash und die Zeile Wechsel auf Vileplume je Seed einzeln und schreib auf, wie stark der Zuck-Anteil der fünf Seeds vom wahren Anteil 0,3 abweicht.
>   - Dateien: `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`, `packages/eval-engine/test/eval-gpl.spec.ts`, `src/lib/replay-file.ts`
> - ☐ **3.** Schreib einen roten Test, der für eine Zelle mit einem Zuck-Zug drei Klassen mit den Gewichten aus Genauigkeit mal Zuck-Chance verlangt statt eines Seed-Mittels.
>   - Dateien: `packages/eval-engine/test/eval-analysis.spec.ts`, `packages/eval-engine/src/cell-blend.ts`
> - ☐ **4.** Erweitere boundaryEvent um die Zuck-Wahrscheinlichkeit des Zuges (move.secondaries mit volatileStatus flinch) und gib sie nur aus, wenn der Angreifer laut effektiver Initiative zuerst handelt.
>   - Dateien: `packages/eval-engine/src/ko-odds.ts`, `packages/eval-engine/src/speed.ts`
> - ☐ **5.** Erweitere classifyChild und foldClassWeights um die Klasse hit-flinch, damit eine cant-Zeile die Zelle nicht mehr auf das Seed-Mittel wirft.
>   - Dateien: `packages/eval-engine/src/cell-blend.ts`, `packages/eval-engine/src/search/cell-sampler.ts`
> - ☐ **6.** Erweitere RollScript und scriptFor um die Sekundär-Antwort, damit der Löser und der Beweiser die Zuck-Klasse auf Ansage ziehen statt sie zu suchen, und prüfe dabei den Kollisionsfall, dass bei einem Zug mit sicherer Genauigkeit der erste randomChance-Aufruf mit Nenner 100 schon der Sekundär-Wurf ist.
>   - Dateien: `packages/eval-engine/src/forward/scripted-prng.ts`, `packages/eval-engine/src/search/outcome-children.ts`
> - ☐ **7.** Nimm Sekundär-Chancen in rollSensitivePair auf, damit auch Doubles-Zellen und Zellen mit sicheren Zuck-Zügen mehrere Seeds ziehen statt einer.
>   - Dateien: `packages/eval-engine/src/search/leaf.ts`, `packages/eval-engine/src/search/cell-sampler.ts`
> - ☐ **8.** Bump die Cache-Version, registriere das Verdikt auf der hq-Tranche vor und nimm die Zell-Identität neu auf.
>   - Dateien: `packages/eval-engine/src/types.ts`, `regression/eval-calibration.spec.ts`
> - ☐ **9.** Fahr die gepaarte Bank gegen eine frische Basis desselben Tages, drei byte-identische Feedback-Läufe und die übrigen Gates, und leg die bewegten Korpus-Kanäle dem User vor.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche mit mitgelesener glücksbereinigter Zeile, gepaarter Bank-Bench (run-calibration.mjs plus paired-calibration.mjs, frische Basis am selben Tag), drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, Regression, e2e, lint, tsc -b, Re-Pins nur am User-Gate. Zusätzlich zwei eigene Messpunkte: die Zahl der Zellen, die wegen einer cant-Zeile auf das Seed-Mittel fallen, muss sinken, und der Runde-42-Play-out-Pin (Draft t56, 34 Sekunden) läuft vor der Bank einzeln, weil er empfindlicher ist als sie.
> 
> **Doubles und Singles.** Seit Runde 56 läuft die Doubles-Wurzel über den Paar-Plan: Eine Zuck-Chance auf ein später ziehendes Ziel (`flinch-chance`, 8 von 712 Zählungs-Zellen) oder ein echtes Zurückzucken (`cant:flinch`, 25; 13 davon Fake Out allein, die T77 herausnimmt) schickt die Zelle dort auf das Mittel von acht Ziehungen (Regel F3). Für Zuck-Chancen an der Doubles-Wurzel entfällt Schritt 7 (Sekundär-Chancen in rollSensitivePair) damit; andere Sekundär-Chancen (Verbrennung, Vergiftung, Schlaf, Werte-Senkung) bleiben in der gezogenen Klasse oder in der einen Plain-Ziehung (14 der 247 Plain-Zellen der Zählung zeigen eine in ihrer Ziehung), und Teil-Suchen bleiben beim Plain-Pfad. Die Zuck-Klasse ersetzt den Rückfall: `pair/pattern.ts` bekommt einen Ausgang für das Zurückzucken, `PairPRNG` eine Ansage für den Sekundär-Wurf, gemessen mit der VGC-Fixture als Probe.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Gilt die Zuck-Klasse nur im Wurzel-Blend oder auch im Baum, wo Runde 43 gemessen hat, dass Klassen die Tiefe spalten?
> - Wie viele Klassen darf eine Zelle tragen, bevor das Ziehbudget von 16 reißt (Treffer mal KO mal Zuck sind schon acht Fälle)?
> - Zählt die Zuck-Klasse nur, wenn der Angreifer schneller ist, oder auch bei Gleichstand der Initiative?
> - Sollen SpD-Senkungen und andere Sekundäreffekte in derselben Runde mitlaufen oder erst später?
> - Braucht der Rückfall auf das Seed-Mittel einen eigenen Zähler im Feedback-Bericht, damit die Runde ihre Wirkung belegen kann?
> 
> **Hintergrund**
> 
> - Szene aus e2e/fixtures/gpl-replay-DzBQ5azlO5l.html, Format [Gen 9] Custom Game, Level 50, Singles, 39 Züge, Bene (p1) gegen Pres (p2), aus dem Video rekonstruiert von gpl-pipeline, Quelle D:\Programming\analysis-pipeline\corpus\ingest\DzBQ5azlO5l\replay.html vom 06.09., Commit dcf9526.
> - Zug 12: Noivern kommt, Frisk zeigt Cobalions Salac Berry, Cobalion tanzt auf plus 2.
> - Zug 13: Air Slash bringt Cobalion auf 36 Prozent, Heavy Slam bringt Noivern auf 55 von 161.
> - Zug 14: Air Slash tötet Cobalion, Rotom-Wash kommt.
> - Zug 15: Bene wechselt auf Vileplume, Volt Switch holt Landorus-Therian.
> - Noivern (Grundwert 123) ist schneller als Rotom-Wash (Grundwert 86), die Zuck-Chance ist also wirksam.
> - Code-Stand: boundaryEvent preist nur Genauigkeit und crit-gewichteten KO-Anteil der 16 Würfe, Sekundäreffekte kommen nicht vor. classifyChild gibt für jede cant-Zeile auf einer Ereignis-Seite null zurück, classifyDraw meldet dann false, und blendCellSample fällt auf das reine Seed-Mittel über baseDraws zurück, ohne Diagnose-Eintrag: der Rückfall ist heute unsichtbar, der KO-Odds-Zähler im Feedback-Bericht sieht nur fehlende Klassen (573756 209, 648453 208, 649664 126, 653785 87, 655336 53, 562428 58 im Lauf vom 12.09.).
> - SEARCH_SEEDS hat fünf feste Einträge ab 1,2,3,4, Feedback läuft mit depth 2 und samples 3, also drei Basis-Ziehungen je Zelle, Ziehbudget 16 mit elf PROBE_SEEDS. rollSensitivePair kennt nur Genauigkeit unter 100 und die vier Zufalls-Aufruf-Züge, ein sicherer Zuck-Zug wie Iron Head bekommt darum ohne KO genau eine Ziehung.
> - Im Baum läuft expandCell mit CHANCE_NODES false über singleChild und nimmt Seed (iteration plus seedOffset) modulo 5, der Zuck-Anteil im Baum ist also die Seed-Quote, nicht 0,3.
> - ScriptedPRNG aus Runde 43 kann hit, crit, roll und first ansagen, keine Sekundäreffekte; scriptFor baut nur miss, hit-kill und hit-nokill.
> - Randbedingungen aus Runde 43, die der zweite Anlauf beachten muss: Klassen spalten die Tiefe (Doubles-Identität 8 auf 7 Stufen), die Bank verlor spät 12 bis 15 bp, der Doubles-Baum kostete plus 44 bis plus 70 Prozent, und der Play-out-Pin kippte auf Gengar statt Muk-Alola.
> - ALIGNMENT_SEEDS[0] bleibt 1,2,3,4, jede Listen-Änderung ist ein Cache-Ereignis.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/ko-odds.ts:193: boundaryEvent liefert nur Genauigkeit, KO-Anteil und Wurfzähler
> - packages/eval-engine/src/ko-odds.ts:204: Statuszüge bekommen ein reines Genauigkeits-Ereignis
> - packages/eval-engine/src/cell-blend.ts:29: die Klassen sind miss, hit-kill, hit-nokill, none
> - packages/eval-engine/src/cell-blend.ts:216: jede cant-Zeile auf einer Ereignis-Seite macht das Kind unklassifizierbar
> - packages/eval-engine/src/cell-blend.ts:142: kombinierte Doubles-Wahlen lassen den Plan scheitern
> - packages/eval-engine/src/search/cell-sampler.ts:153: eine gescheiterte Klassifikation wirft die Zelle auf das Seed-Mittel
> - packages/eval-engine/src/search/cell-sampler.ts:113: die Diagnose entsteht nur für fehlende Klassen, nicht für den Rückfall
> - packages/eval-engine/src/search/cell-sampler.ts:42: ohne KO und ohne Wurf zieht die Zelle genau einen Seed
> - packages/eval-engine/src/search/leaf.ts:15: fünf feste Suchseeds
> - packages/eval-engine/src/search/leaf.ts:62: rollSensitivePair prüft nur Genauigkeit und Zufalls-Aufruf-Züge
> - packages/eval-engine/src/search/expansion.ts:105: tiefere Plies nehmen einen Seed je Iteration
> - packages/eval-engine/src/search/expansion.ts:29: CHANCE_NODES steht auf false
> - packages/eval-engine/src/forward/scripted-prng.ts:17: RollScript kennt hit, crit, roll und first
> - packages/eval-engine/src/forward/scripted-prng.ts:80: der erste Aufruf mit Nenner 100 gilt als Genauigkeits-Wurf
> - packages/eval-engine/src/search/outcome-children.ts:137: scriptFor baut nur miss, hit-kill und hit-nokill
> - packages/eval-engine/src/streaks.ts:70: Sekundäreffekte werden bisher nur für die Erzählung gelesen
> - packages/eval-engine/src/dice-events.ts:20: flinch zählt im Glück-Anker als Würfel
> - e2e/fixtures/gpl-replay-DzBQ5azlO5l.html:1: die rekonstruierte GPL-Partie mit den Frisk-Zeilen
> - packages/eval-engine/test/eval-gpl.spec.ts:22: der bestehende GPL-Endpunkt-Pin auf der älteren Fixture
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 73 (Befund b: Air Slash und Flinch).

### T77 · Paar-Plan: seltene teure Ausgänge und das sichere Zurückzucken von Fake Out

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 912045 Zug 8 (exportierte Bank-Stellung #8, Score 0,6836 wie Bank und Dump), gespielte Nachprüf-Zelle Blood Moon→Okidogi + Matcha Gotcha gegen Protect + Tera + Drain Punch; VGC 2629703929 Zug 13 (nachgebaut wie die Bank, Score −0,8279784095055285 und Matrix gleich dem Dump), Zelle Dragon Claw gegen Psychic Fangs; 2663093831 Zug 3 aus dem frischen Dump.
- Beleg: groups/paar-plan/out/smogtours-gen9doublesou-912045_t8.json: Zellwert 0,49792011680076936 (byte-gleich mit Runde 56), Deckung 0,9634 nach 5 Ziehungen, es fehlt die tödliche Drain-Punch-Volltreffer-Klasse (p 0,0292); volle Deckung: Zelle 0,4237 → 0,4043, p1-Bedauern 0,4778 → 0,4767, die Spalte trägt nur 0,0015 von p2s Mischung. groups/paar-plan/out/gen9vgc2026regi-2629703929_t13.json: Deckung 0,9583, Volltreffer 1/24 fehlt; volle Deckung: p2-Bedauern 0,2618 → 0,2604. Dump 2663093831 Zug 3: keine Stufe (p1 0,063, p2 0,075). Bank-Score auf Baum-Zügen = Besuchsmittel (packages/eval-engine/src/mcts-merge.ts:232-244, gesetzt :292-294); die Nachprüfung ändert nur Rangliste und Matrix. Code unverändert: pair/log.ts:7 und :34 (cant:flinch, kleines attract), pair/guards.ts:16-18 (Wide Guard, Quick Guard).
- Grund: Der Fehler steht noch im Code, aber sein Hebel ist mit dem Umbau weg: Seit Runde 61 rechnet der Paar-Plan auf Doubles-Zügen ab Zug 1 nur noch die Nachprüf-Zellen (tree-orchestrator.ts:80-99), und die berühren den Score der Bank nicht. In zwei gemessenen Szenen bewegt volle Deckung das Bedauern um höchstens 0,0014, kein Urteil kippt. Fake Out, Attract und die Guard-Regeln wirken nur in denselben wenigen Zellen; nur der von Hand gewählte Matrix-Modus rechnet noch jede Wurzelzelle mit dem Paar-Plan.
- Spielart: Doubles

**Alter Text in NextSteps.md:**

> - ☐ **T77 · Paar-Plan: seltene teure Ausgänge und das sichere Zurückzucken von Fake Out** (Zufall preisen, Mini-Runde, klein, score-berührend D3)
> 
>   smogtours-gen9doublesou-912045 Zug 8: Der Paar-Plan hört bei 95 % Deckung auf und lässt in der gespielten Zelle eine Klasse weg, in der ein Volltreffer tötet (Wahrscheinlichkeit 3,4 %, Wert −0,86). Die fehlende Masse verteilt er auf die gefundenen Klassen, als gäbe es den tödlichen Volltreffer nicht. Dasselbe passiert einem einzelnen 5-%-Fehlschlag (2663093831 Zug 3, neun Zellen mit Steam Eruption) und dem Volltreffer, der VGC 2629703929 beendete: In der Verify-Zelle Dragon Claw gegen Psychic Fangs (Zug 13) deckt die Klasse ohne Volltreffer mit 23/24 schon 0,958, der tödliche Volltreffer (1/24) wird nie gezogen. Zweitens lässt Fake Out sicher zurückzucken, Regel F3 zählt die `cant`-Zeile aber als Zufall und schickt die Zelle auf das Mittel von acht Ziehungen: 13 der 25 `cant:flinch`-Rückfälle der Zählung sind Fake Out allein. Wie ein Wetterbericht, der den Hagel weglässt, weil der Rest schon 95 % des Tages abdeckt.
> 
>   Hinweis: Fake Out: Eine `cant:flinch`-Zeile zählt nur als Zufall, wenn ein Treffer mit Zuck-Chance unter 100 % das Ziel traf (dieselbe Regel liest `flinchChance` in `pair/pattern.ts` schon). Deckung: weiterziehen, solange ein Kandidat mit mindestens 0,02 Masse übrig ist und das Budget reicht, oder die Schwelle auf 0,98 heben; beides gegen Kantenfehler und Zeit messen (heute 0,021 und 3,5 bis 3,7×, Rahmen 4×). Aus dem finalen Review der Runde 56 gehören dazu: Die Attract-Prüfung von F3 vergleicht `attract`, der Simulator schreibt `Attract` (`pair/log.ts`, in Runde 58 zur Laufzeit bestätigt); eine Paralyse aus demselben Zug lässt einen bestandenen 25-%-Wurf ohne Zeile (19 geplante Zellen der 34 788); Wide Guard und Quick Guard würfeln seit Gen 7 nicht mehr, Ally Switch würfelt über einen eigenen Zähler (`pair/guards.ts`); bei drei Basis-Ziehungen zieht der Plan Klassen doppelt (74 von 201 Gegenwürfen); Focus Sash und Sturdy schicken auch dann in den Rückfall, wenn kein Wurf töten kann (Tabelle fragen); eine Rückfall-Zelle könnte als Ein-Klassen-Mischung ihr Mittel durch die Vertiefung tragen.
> 
>   *Erfolg:* In 912045 Zug 8 trägt die gespielte Verify-Zelle die tödliche Volltreffer-Klasse (p 0,034), in 2663093831 Zug 3 tragen die neun Steam-Eruption-Zellen ihren 5-%-Fehlschlag, die 13 Fake-Out-Zellen fallen nicht mehr wegen `cant:flinch` zurück; der Kantenfehler der Zählung steigt nicht über den Stand nach Runde 56, die Matrixzeit bleibt unter 4× gegen den master vor Runde 56, Singles unberührt. *Plan T77:* 4 Schritte, 1 offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T77 · Paar-Plan: seltene teure Ausgänge und das sichere Zurückzucken von Fake Out
> 
> *Zufall preisen · Mini-Runde · klein · score-berührend D3*
> 
> **Problem.** (1) Regel E hört bei 95 % Deckung auf. Die Masse der ungezogenen Klassen verteilt die Mischung auf die gefundenen; eine seltene, teure Klasse verschwindet so ganz. 912045 Zug 8, gespielte Verify-Zelle: tödlicher Volltreffer mit p 0,034 und vertieftem Wert −0,855 fehlt; 2663093831 Zug 3: der 5-%-Fehlschlag von Steam Eruption in neun Zellen. (2) Regel F3 zählt jede `|cant|…|flinch`-Zeile als Zufall (`randomDeviation` in `pair/log.ts`), auch nach Fake Out, das sicher zurückzucken lässt; `flinchChance` in `pair/pattern.ts` nimmt Zuck-Chancen von 100 % dagegen schon aus. 13 der 25 `cant:flinch`-Rückfälle der Zählung sind Fake Out allein (Fehler dort 0,020 und im Vorzeichen-Mittel −0,002, also unverzerrt, aber acht Ziehungen statt Plan; über alle 25 `cant:flinch`-Zellen 0,024). (3) Weitere Reste aus dem finalen Review: Die Attract-Prüfung vergleicht `attract`, der Simulator schreibt `Attract`; eine Paralyse aus demselben Zug lässt einen bestandenen Wurf ohne Zeile (67 der 34 788 ersten Ziehungen, 19 im Plan); Wide Guard und Quick Guard würfeln seit Gen 7 nicht, Ally Switch über einen eigenen Zähler; bei drei Basis-Ziehungen zieht der Plan Klassen doppelt (74 von 201 Gegenwürfen, Kosten ohne Wertfehler); Focus Sash und Sturdy schicken in den Rückfall, auch wenn kein Wurf töten kann; eine Rückfall-Zelle verliert unter der Vertiefung ihr Mittel. Auch 2629703929 Zug 13 gehört zu (1): Die Klasse ohne Volltreffer deckt mit 23/24 schon 0,958, der Volltreffer, der das Spiel beendete, wird nie gezogen.
> 
> **Idee.** (1) Weiterziehen, solange ein Kandidat mit mindestens 0,02 Masse übrig ist und das Budget reicht, oder die Deckungs-Schwelle auf 0,98 heben. (2) Eine `cant:flinch`-Zeile zählt nur, wenn im selben Zug ein Treffer mit Zuck-Chance unter 100 % (Zug, King's Rock, Razor Fang, Stench) das zuckende Ziel traf.
> 
> **Schritte**
> 
> - ☐ **1.** Zählung: `census-after.vt.ts` um die fehlende Masse je Zelle erweitern (1 − Deckung, größter ungezogener Kandidat) und die `cant:flinch`-Zellen nach Quelle zählen.
> - ☐ **2.** Roter Test je Regel in `test/pair-pattern.spec.ts` und `test/pair-sampler.spec.ts` (Fake-Out-Kampf ohne Rückfall; Zelle mit einem 3-%-Ausgang, der gezogen wird).
> - ☐ **3.** Umbau in `pair/log.ts` bzw. `pair/pattern.ts` und `pair/sampler.ts`; Cache-Bump.
> - ☐ **4.** Gate D3: Zählung gegen den Stand nach Runde 56 (Kantenfehler und p99 steigen nicht), Zeit verschränkt gegen ein frisches Archiv der Spitze der Runde 56 und gegen `base-src` (Rahmen 4× gegen den master vor Runde 56), Bank gepaart gegen die Basis der Runde 56, drei Feedback-Läufe, bewegte Doubles-Urteile lesen.
> 
> **Doubles und Singles.** Nur Doubles (der Paar-Plan). Die Singles-Wurzel hat ihre eigene Deckungs-Logik (`cell-blend.ts`), T14 und T65 fassen sie an.
> 
> **Offene Entscheidung.** Deckungs-Regel: Mindestmasse je Kandidat oder höhere Schwelle?
> 
> **Herkunft.** Lesung der Runde 56 (Gegenprüfer 912045 und 2663093831), Zählung `out/census-after-odds.json`.

### T35 · Zufallsknoten im Baum, zweiter Anlauf (Q2)

- Urteil: verwerfen (nach Ruling)
- Szene: 2663102863 Zug 8 und 10 (Doubles, p1 gewann), Bank-Stellungen #8/#10; Prüfstand thunder-70 und doubles-thunder-70 (regression/endgame-fixtures.ts:96, :144); die Runde-43-Kipps 2660802611 #10, 749601 #22, 2630461565 #4 und 2663102863 #6. App-Baum auf HEAD gegen eine Kopie mit CHANCE_NODES = true (groups/baum-suche/t35-chance.vt.ts).
- Beleg: groups/baum-suche/out/t35-fixtures.json und counter-t35-fixtures.json (ohko-tie 0,5 / mit Zufallsknoten 0,0017, Wahrheit 0); out/counter-t35-bank-ties.json (0,239→0,252, 0,081→0,065, 0,494→0,472, 0,491→0,521); groups/wurzel-zufall/out/tie-census.txt.
- Grund: Die Szene 2663102863 Zug 8 trägt den Würfel nicht mehr (die Bank las ab Runde 46 schon 0,616 ohne Zufallsknoten; gefallen ist der Wert mit dem Tera-Typ in Runde 54), thunder-70 erledigt der Beweiser. Volle Zufallsknoten bewegen vier echte Bank-Stellungen mit gleich schnellen Gegnern nur um 0,01 bis 0,03, in beide Richtungen, bei 29 bis 54 % mehr Zeit. Die Gleichstands-Hälfte lebt nur auf den Prüfständen ohko-tie und speed-tie-2hko (Baum 0,5 statt 0); auf der Bank steht kein letztes Paar im Gleichstand (0 von 837) und kein Beweis auf einem Gleichstand (0 von 31). Kommt eine echte Szene, bekommt sie eine neue Nummer.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T35 · Zufallsknoten im Baum, zweiter Anlauf (Q2)** (Zufall preisen, Runde, groß, score-berührend D3, braucht T01)
> 
>   Doubles-Spiel 2663102863 Zug 8: ein gewonnenes Endspiel, der Balken zeigt seit Runde 42 nur 0,29 statt 0,85. Runde 43 holte die Gewissheit mit Zufallsknoten zurück (0,66), verteilte dabei aber die Suchtiefe auf Nebenklassen: Bank spät 12 bis 15 bp schlechter, Doubles-Baum 44 bis 70 % teurer, der Draft-t56-Play-out-Pin kippt. Alles liegt fertig hinter `CHANCE_NODES = false`. Zweiter Anlauf: nur die schwerste Klasse tief suchen, Nebenklassen ohne Abstieg bepreisen.
> 
>   Hinweis: Die Runde-43-Zahlen stammen von vor dem Formen-Marker-Fix; Schritt 2 misst den alten Baumstand auf dem heutigen Code nach, bevor eine Verdikt-Regel darauf zeigt.
> 
>   *Erfolg:* hq spät gepaart mindestens 3 bp besser und Vollmenge spät nicht schlechter, Play-out-Pin grün (Muk-Alola vor Heatran, Sieg in Zug 65), 2663102863 t8 mindestens 0,6, Prüfstand `thunder-70` im Baum 0,400, Doubles-Baum höchstens +40 %. Fällt eine Linie, bleibt `CHANCE_NODES` aus. *Plan T35:* 9 Schritte, 4 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T35 · Zufallsknoten im Baum, zweiter Anlauf (Q2)
> 
> *Zufall preisen · Runde · groß · score-berührend (D3) · braucht T01*
> 
> **Problem.** Im Doubles-Spiel 2663102863 steht in Zug 8 ein gewonnenes Endspiel. Der Siegbalken zeigt seit Runde 42 nur 0,29 statt 0,85, weil jeder Baum den Würfel einer Zelle einmal festlegt und danach in dieser einen Welt weiterrechnet. Runde 43 hat die Gewissheit mit Zufallsknoten zurückgeholt (0,29 auf 0,66), dabei aber die Besuche auf die Nebenklassen verteilt: ein 30-Prozent-Miss bekommt 30 Prozent der Abstiege, der Hauptlinie bleibt über zwei Züge die halbe Tiefe. Die Bank verliert spät 12 bis 15 bp, der Doubles-Baum kostet 44 bis 70 Prozent mehr Zeit, und der gepinnte Draft-t56-Play-out schickt Gengar statt Muk-Alola. Deshalb steht die ganze Maschinerie hinter CHANCE_NODES = false.
> 
> **Idee.** Nur die schwerste Klasse bekommt einen echten Teilbaum, die Nebenklassen bekommen einen Preis ohne Abstieg (Statik oder ein Schritt) und gehen mit ihrem Gewicht in den Zellenwert. Wie ein Trainer, der die wahrscheinliche Welt wirklich durchdenkt und die seltene nur kurz überschlägt.
> 
> **Hinweis.** Die Runde-43-Zahlen stammen von vor dem Formen-Marker-Fix; Schritt 2 misst den alten Baumstand auf dem heutigen Code nach, bevor eine Verdikt-Regel darauf zeigt.
> 
> **Schritte**
> 
> - ☐ **1.** Nimm am Bautag eine frische Basis auf: Bank-Lauf auf master nach .calibration/r46-base plus eine Feedback-Basis mit FEEDBACK_DUMP=1, weil der Worktree-Vorfall vom 12.09. alle alten Messstände und Replay-Caches gelöscht hat.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`, `playwright.feedback.config.ts`
> - ☐ **2.** Schalte CHANCE_NODES auf true und miss den Runde-43-Baumstand auf dem heutigen Code nach (Play-out-Pin einzeln, 2663102863 t8, Truth-Bench-Zeile thunder-70, Perf-Sonde verschränkt für Singles und Doubles), damit die Zahlen gegen die Bank nach dem Formen-Marker-Fix gelten.
>   - Dateien: `packages/eval-engine/src/search/expansion.ts`, `e2e/branch.spec.ts`, `regression/endgame-truth.spec.ts`, `docs/perf/probes/2026-09-03/perf-probe.spec.ts`
> - ☐ **3.** Schreib Brainstorming und Spec mit der Regel schwerste Klasse tief, Nebenklassen ohne Abstieg, mit der vorregistrierten Verdikt-Regel und mit der Kostenleiter für Doubles, bevor eine Zeile Code fällt.
>   - Dateien: `docs/superpowers/specs/2026-09-XX-round-46-design.md (NEU)`, `docs/superpowers/plans/2026-09-XX-round-46-plan.md (NEU)`
> - ☐ **4.** Nimm die sechs Baum-Tests aus der Flag-Schranke describe.runIf und schreib den roten Test dazu: nach 600 Iterationen behält die Hauptlinie ihre Tiefe, und der Zellenwert bleibt das gewichtete Klassenmittel.
>   - Dateien: `packages/eval-engine/test/eval-mcts-chance.spec.ts`
> - ☐ **5.** Bau die Auswahl um: pickClass schickt jeden Abstieg in die schwerste Klasse, die Nebenklassen behalten ihren Statikwert mit ihrem Gewicht, chanceValue mischt weiter alle Klassen.
>   - Dateien: `packages/eval-engine/src/search/chance-node.ts`, `packages/eval-engine/src/mcts.ts`
> - ☐ **6.** Mach die Nebenklassen billig: expandCell legt nur für die schwerste Klasse ein makeNode an (Optionen, Hinweise, Statik), die anderen tragen Position und Statik, und groupedChildren zieht die dritte Ziehung nur, wenn die ersten zwei verschiedene Faint-Signaturen zeigen.
>   - Dateien: `packages/eval-engine/src/search/expansion.ts`, `packages/eval-engine/src/search/outcome-children.ts`, `packages/eval-engine/src/search/mcts-node.ts`
> - ☐ **7.** Zieh die Merge-Seite nach, damit Klassen ohne eigene Besuche lesbar bleiben: cellStats, pooledChanceValue, cellContribution und die Hauptvarianten-Zeile durch die schwerste Klasse.
>   - Dateien: `packages/eval-engine/src/search/chance-node.ts`, `packages/eval-engine/src/search/merge-pool.ts`, `packages/eval-engine/src/mcts-merge.ts`
> - ☐ **8.** Fahr die Stationen einzeln und in dieser Reihenfolge: Play-out-Pin (34 s), Identitäts-Fixture, Truth-Bench-Synthetik, Perf-Sonde verschränkt auf einem Maschinenzustand; erst danach Bank gepaart und Feedback dreimal.
>   - Dateien: `e2e/branch.spec.ts`, `packages/eval-engine/test/eval-search-identity.spec.ts`, `regression/endgame-truth.spec.ts`, `docs/perf/probes/2026-09-03/probe.config.ts`
> - ☐ **9.** Buche das Ergebnis mit Cache-Bump, Ledger-Block und Eintrag in docs/completed/eval-quality.md und leg jede Pin-Bewegung (653785 t19, Golden 655336 t27) dem User vor, bevor etwas gepinnt wird.
>   - Dateien: `src/lib/eval-cache-store.ts`, `regression/eval-calibration.spec.ts`, `docs/completed/eval-quality.md`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend. Cache-Bump (master steht auf v46, die geparkte Sonden-Schwelle auf r45-threshold trägt schon v47, wer zuerst landet, nimmt die Nummer), vorregistrierte Verdikt-Regel vor dem ersten Bank-Lauf: hq spät gepaart mindestens 3 bp besser UND Vollmenge spät nicht schlechter, glücksbereinigte Zeile spät nicht schlechter, Bucket 0,7 bis 1,0 nicht schlechter, Mitte höchstens ein Vorzeichen schlechter, exklusive Kipps ausgewiesen. Gepaarter Bank-Bench gegen eine frische Basis desselben Tages (scripts/run-calibration.mjs --slices 6, dann scripts/paired-calibration.mjs, dasselbe mit --quality hq, n=548). Drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, Vergleich ohne graph.sensitivity. Re-Pins nur am User-Gate. Zusatz-Linien der Runde: Play-out-Pin grün (Muk-Alola vor Heatran, p2 gewinnt in Zug 65), 2663102863 t8 mindestens 0,6, Truth-Bench-Spalte mcts auf thunder-70 gleich 0,400 statt 1,000, Doubles-Baum verschränkt höchstens +40 Prozent, KO-Odds-Mismatches je Replay nicht höher. Fällt eine Linie, bleibt CHANCE_NODES aus und die Runde endet als Fallback wie Runde 43.
> 
> **Doubles und Singles.** Singles laufen über den Klassenpfad (573756 t73 Fire Fang, Truth-Bench thunder-70, Draft-t56-Play-out-Pin, Tranchen ladder-ou-0802 und tournament-0811b), Doubles über den empirischen Pfad mit Faint-Signaturen (2663102863 t6 bis t9, Tranche ladder-dou-0804, Fixture doubles-thunder-70). Die Kostenleiter zielt genau auf die Doubles-Wurzel, weil dort jedes Paar ein Komma-Paar ohne Klassenplan ist; jede Perf- und Bank-Zeile wird für beide Formate getrennt gelesen.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Bleiben die Nebenklassen ganz statisch, oder bekommt jede genau einen Abstieg und friert danach ein?
> - Darf die Doubles-Gruppierung ganz entfallen (GROUP_MAX_DEPTH 0), wenn die Kosten sonst nicht unter +40 Prozent kommen?
> - Zählt eine Pin-Bewegung am Golden 655336 als Abbruchgrund, oder geht sie wie in Runde 43 als Re-Pin ans User-Gate?
> - Soll der Schalter am Ende verschwinden, oder bleibt CHANCE_NODES als Konstante für einen dritten Anlauf stehen?
> 
> **Hintergrund**
> 
> - Runde 43 (12.09., Commits a42e634, 7bae1d3, a98b3dc, 351a9fc, 6582922, 1b3fcc1, 6478f20, 3e25179, 82eac6b, 9ff493c; Cache v46; Spec docs/superpowers/specs/2026-09-12-round-43-design.md, Plan mit Chronik docs/superpowers/plans/2026-09-12-round-43-plan.md, Ledger-Block CHANCE NODES ROUND 2026-09-12 ab regression/eval-calibration.spec.ts:1001, Eintrag docs/completed/eval-quality.md, Abschnitt „Runde 43“, Memory round-43-chance-nodes-2026-09).
> - Alle zehn Commits liegen auf master; Branch r43 ist ein Vorfahr von master, der gemessene Baumstand ist die eine Konstante CHANCE_NODES. MECHANIK HEUTE: expandCell öffnet in Ply 1 bis 2 an Zuggrenzen-Zellen einen Zufallsknoten je Ausgangsklasse, pickClass gibt den Abstieg der Klasse mit dem größten Defizit (weight mal visits minus eigene visits), ab Ply 3 fixiert der rotierte Seed SEARCH_SEEDS[(iteration + seedOffset) % 5] eine Welt; MCTS_ITERATIONS 600; CHANCE_MAX_DEPTH 2, GROUP_MAX_DEPTH 1, TREE_FORCED_CAP 6, GROUP_SEEDS die ersten drei SEARCH_SEEDS. BANK gegen r42-b: spät 0,1536 auf 0,1548 (+12 bp), hq 0,1622 auf 0,1637 (+15), glücksbereinigt 0,1471 auf 0,1482 (+11), hq Mitte minus 13, Bucket 0,7 bis 1,0 87 auf 88 Prozent (n 127 auf 120), Sign 53/62/78/61/71 auf 53/61/79/61/71, drei exklusive Kipps (B richtig 2660802611 t10 und 749601 t22, A richtig 2630461565 t4).
> - Tranchen: tournament-0811b spät 0,1174 auf 0,1240 (+66), ladder-dou-0804 Mitte 0,0986 auf 0,1221 (+235) und spät 0,0862 auf 0,0856, ladder-ou-0802 spät 0,1348 auf 0,1337.
> - Gegen r41-b spät 0,1518 auf 0,1548 (+30). 2663102863 t8 0,287 auf 0,662 (Runde 42 hatte 0,851 auf 0,287).
> - TIEFE: Doubles-Identität 8 auf 7 Stufen, Singles-Fixture-Score minus 0,2929 auf minus 0,2903 bei Tiefe 4, Doubles 0,9198 auf 0,9281.
> - PERF verschränkt auf einem Maschinenzustand (Leiterstufe 1, 12:08): Doubles t8 flach 1435 gegen Chance 2061 ms (+44 Prozent), t9 1078 gegen 1830 (+70), Matrix gleich (644/646 und 684/707).
> - Vor der Leiter: Doubles t6 1344 auf 2713 (+102), t7 +145, t8 1460 auf 3420 (+134), t9 +152; Singles t70 1017 auf 1244 (+22), t120 676 auf 799 (+18), auf Stufe 1 +28 und +31.
> - Vorregistriert war +40.
> - GEMESSEN UND VERWORFEN: Leiterstufe 2 (CHANCE_MAX_DEPTH 1) spart in Doubles nichts, weil dort jedes Paar ohne Klassenplan ist und der Aufwand in den drei Wurzel-Ziehungen plus einem makeNode je Klassen-Kind steckt.
> - Aus der Spec verworfen: Seed-Jagd mit Budget 6, Chance-Blatt ohne Teilbaum, Zufalls-Hash für die Klassenwahl.
> - OFFENE HEBEL: schwerste Klasse tief suchen und Nebenklassen statisch oder einschrittig bepreisen; Klassen-Kinder erst beim ersten Abstieg voll anlegen; dritte Ziehung nur bei Uneinigkeit der ersten zwei; Doubles-Gruppierung mit zwei Seeds oder GROUP_MAX_DEPTH 0.
> - STATIONEN: Play-out-Pin e2e/branch.spec.ts 'the draft t56 play-out sends Muk-Alola before Heatran' (34 s grün; unter Zufallsknoten kippt er deterministisch, p2 schickt Slowking, Gengar, Heatran, Slowking, Gengar, Slowking, Gengar, Muk-Alola kommt nie, p2 gewinnt in Zug 68 statt 65, Laufzeit 1,3 min; unter der Runde-45-Sonden-Schwelle kippt er ebenfalls); 2663102863 t8; Tranche tournament-0811b; Truth-Bench-Zeile thunder-70 (exakt 0,400, Matrix d1 bis d3 0,400, Statik 0,600, MCTS flach 1,000, mit Zufallsknoten 0,400; Lauf mit EVAL_ENDGAME_TRUTH=1 und EVAL_ENDGAME_POSITIONS auf einen leeren Ordner, 26 Synthetik-Fixtures, Minuten).
> - BEWEISER-TEIL bereits übernommen: Truth-Bench unpriced 13 auf 6, exakt gelöst 13 auf 19, Beweiser-Tabelle identisch bis auf states 16 auf 19 und 3 auf 4.
> - FEEDBACK auf dem Baumstand: dreimal byte-identisch, aber 653785 t19 (gap) open auf moved und Golden 655336 t27 p1-read auf shift (acht auf sieben Kanäle), KO-Odds-Mismatches 209/58/208/126/87/53 auf 212/57/202/123/86/47; auf dem Fallback bewegte sich kein Kanal, nur 573756 t138 p2-Masse 0,641 auf 0,663 und 649664 t23 Caveat sampled-rolls auf barring-crit (Wurzel 0,92 auf 0,79).
> - PERF-SONDE: PERF_PROBE=1 PERF_PROBE_LABEL=before|after PERF_PROBE_OUT=... npx playwright test -c docs/perf/probes/2026-09-03/probe.config.ts, Hebel PERF_PROBE_REPLAY, PERF_PROBE_DIR, PERF_PROBE_TURNS; der Doubles-Replay liegt noch unter docs/perf/probes/2026-09-12-r43/replays/gen9doublesou-2663102863.json.
> - Maschinen-Drift 18 Prozent bei unverändertem Code innerhalb eines Vormittags, deshalb nur verschränkt messen.
> - Bank-Ordner .calibration ist leer.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/search/expansion.ts:29 - export const CHANCE_NODES = false, der Schalter des Baum-Teils
> - packages/eval-engine/src/search/expansion.ts:105 - bei ausgeschaltetem Schalter oder Tiefe über 2 fällt die Zelle auf singleChild mit rotiertem Seed
> - packages/eval-engine/src/search/expansion.ts:119 - makeChanceNode bekommt für jedes Klassen-Kind ein volles nodeFrom, das ist die Doubles-Wurzelkosten-Stelle
> - packages/eval-engine/src/search/expansion.ts:34 - GROUP_MAX_DEPTH = 1, die gemessene Leiterstufe 1
> - packages/eval-engine/src/search/chance-node.ts:46 - pickClass wählt die Klasse mit dem größten Defizit, hier teilt sich die Tiefe
> - packages/eval-engine/src/search/chance-node.ts:69 - chanceValue mischt die Klassenmittel mit ihren Gewichten
> - packages/eval-engine/src/mcts.ts:133 - der Abstieg gibt den Zufallsknoten an pickClass weiter
> - packages/eval-engine/src/search/mcts-node.ts:66 - makeNode rechnet searchOptions, optionHints und leafValue je Kind
> - packages/eval-engine/src/search/mcts-node.ts:146: principalVariation gibt die Linie an der schwersten Klasse weiter (Funktion ab Zeile 126)
> - packages/eval-engine/src/search/outcome-children.ts:262 - groupedChildren zieht die restlichen Seeds, sobald jemand fällt oder das Paar wurfempfindlich ist
> - packages/eval-engine/src/search/merge-pool.ts:17 - pooledChanceValue verlangt in jedem Baum dieselben Klassenschlüssel
> - packages/eval-engine/test/eval-mcts-chance.spec.ts:84 - die sechs Baum-Tests hängen an describe.runIf(CHANCE_NODES)
> - e2e/branch.spec.ts:59 - der Runde-42-Play-out-Pin (Draft t56, Muk-Alola vor Heatran)
> - regression/endgame-fixtures.ts:96 - Fixture thunder-70, die Testposition aus Runde 34
> - regression/eval-calibration.spec.ts:1045 - Ledger-Zeilen zur Doubles-Kostenmessung und zum Fallback
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 35; Zeile 152; Zeile 153; Zeile 154; Zeile 122; Zeile 24 (1) Baum-Hälfte. Zusammengelegt, weil: Alle Punkte zeigen auf dieselbe Code-Stelle (search/expansion.ts, search/chance-node.ts, search/outcome-children.ts), dieselbe Ursache (die Besuche teilen sich auf die Klassen) und dieselbe Messung (Bank spät, Doubles-Baumkosten, Play-out-Pin, Truth-Bench-Zeile thunder-70). Zeile 154 liefert die erste Mess-Station, Zeile 122 die billigste Wahrheitsprobe, Zeile 24 (1) die Baum-Hälfte des Tie-Splits, die mit dem Schalter zurückkommt.

### T41 · Q8 · Wurzel-Prior aus der Skizzen-Matrix

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Kein Spiel im Text. Nächste Szene: 562428 Zug 10 (Singles, früh), nachgebaut wie die Bank und mit 600 und 2400 Durchläufen sowie 16 Bäumen gesucht (groups/baum-suche/feedback-position.vt.ts); frühe Zählung out/early-compare.json.
- Beleg: out/smogtours-gen8ou-562428-t10-11.json: Abstand der besten zwei p1-Zeilen 0,0008 (600), 0,0011 (2400), 0,0007 (16 Bäume); mehr Besuche ändern die Wurzel nicht. Nachprüfung seit Runde 61 bepreist Stützzellen unter 8 Besuchen neu und vertieft sie (packages/eval-engine/src/mcts-merge.ts:38, :390; tree-orchestrator.ts:61, :80). Obergrenze: doppelte echte Durchläufe gepoolt -10 bp [-20, -2] (docs/perf/probes/2026-10-02-r61/gate/t97-table.md, T98 -33 gegen -23), unter der Auflösung von rund 23 bp.
- Grund: Kein Spiel trägt das TODO, die Probe-Szene zeigt keine ausgehungerte Wurzel, und das Ziel der Idee (keine dünne Stützzelle) erledigt die Nachprüfung der Runde 61. Ein Prior mit zwei Schein-Besuchen sucht unter der Wurzel nichts tiefer, sein Gewinn liegt also unter dem Wert doppelter Durchläufe und damit unter der Auflösung. Die Regret-Matching-Hälfte hat weder Szene noch Messung.
- Spielart: Singles

**Alter Text in NextSteps.md:**

> - ☐ **T41 · Q8 · Wurzel-Prior aus der Skizzen-Matrix** (Q-Runden, Runde, mittel, score-berührend D3, braucht T01)
> 
>   Jede Baumsuche startet an der Wurzel bei null Besuchen, obwohl der Sweep für denselben Zug kurz vorher eine ganze Matrix gelöst hat. Die ersten hundert Iterationen laufen durch Zeilen, die der Sweep schon als schwach kannte. Jede Wurzelzelle bekommt zwei Vorab-Besuche mit dem Matrix-Wert; zweite Variante: Regret-Matching statt UCB an der Wurzel.
> 
>   *Erfolg:* Beide Varianten einzeln verdiktet: hq-Linie besser oder gleich, Play-out-Pin hält, Baumzeit je Spielart verschränkt nicht schlechter. *Plan T41:* 6 Schritte, 3 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T41 · Q8 · Wurzel-Prior aus der Skizzen-Matrix
> 
> *Q-Runden · Runde · mittel · score-berührend (D3) · braucht T01*
> 
> **Problem.** Jede Baumsuche fängt an der Wurzel bei null an: alle Zellen haben null Besuche, und die Reihenfolge kommt nur aus statischen Hinweisen. Dabei hat der Sweep für denselben Zug kurz vorher schon eine ganze Matrix gelöst und wirft sie weg. Die ersten hundert Iterationen laufen deshalb durch Zeilen, die der Sweep längst als schwach kannte, und der Baum wandert früh.
> 
> **Idee.** Der Baum startet mit dem Wissen, das schon auf dem Tisch liegt: jede Wurzelzelle bekommt zwei Vorab-Besuche mit dem Wert aus der Skizzen-Matrix, wie ein Läufer, der nicht bei null, sondern mit Vorsprung startet. Als zweite Variante wählt die Wurzel per Regret-Matching statt per UCB.
> 
> **Schritte**
> 
> - ☐ **1.** Sonde zuerst: zähle auf den sechs Feedback-Replays, wie oft der beste Wurzel-Zug des Baums vom besten Zug der Skizzen-Matrix abweicht und wie die Besuche sich auf die Zellen verteilen.
>   - Dateien: `packages/eval-engine/src/mcts.ts`, `docs/perf/probes (NEU, eigener Ordner mit Datum)`
> - ☐ **2.** Reiche die Skizzen-Matrix an die Suche durch: das Skizzen-Ergebnis liegt in data.results und trägt die gelöste Wurzel-Matrix, der Worker-Request bekommt ein optionales Prior-Feld, und das Harness rechnet die Matrix selbst.
>   - Dateien: `src/hooks/evaluation/graph-sweep.ts`, `src/hooks/evaluation/sweep-core.ts`, `src/lib/eval/worker-client.ts`, `src/workers/eval-worker.ts`, `packages/eval-engine/src/mcts.ts`
> - ☐ **3.** Schreibe den roten Test zuerst: mit Prior startet eine Wurzelzelle mit zwei Besuchen und dem Matrix-Wert, ohne Prior bleibt jede Zelle auf null.
>   - Dateien: `packages/eval-engine/test/eval-mcts.spec.ts`, `packages/eval-engine/src/search/mcts-node.ts`
> - ☐ **4.** Baue die zweite Variante getrennt und hinter einem eigenen Schalter: Regret-Matching an der Wurzel statt UCB, mit dem fertigen Löser aus dem Ranking-Paket.
>   - Dateien: `packages/eval-engine/src/search/mcts-node.ts`, `packages/eval-engine/src/ranking/solve.ts`
> - ☐ **5.** Miss beide Varianten einzeln und gepaart gegen dieselbe frische Basis und lies vor der Bank den Play-out-Pin (einzeln 34 s) sowie die Truth-Bench-Zeilen fixed-vs-ghost und thunder-70 mit.
>   - Dateien: `e2e/branch.spec.ts`, `regression/endgame-truth.spec.ts`, `scripts/paired-calibration.mjs`
> - ☐ **6.** Schließe die Gates mit Cache-Bump, vorregistrierter Verdikt-Regel auf der hq-Tranche, Baumkosten je Spielart und drei byte-identischen Feedback-Läufen.
>   - Dateien: `regression/eval-calibration.spec.ts`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend. Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche mit glücksbereinigter Zeile, gepaarter Bank-Bench gegen frische Basis vom selben Tag, drei byte-identische Feedback-Läufe, Re-Pins am User-Gate. Zusätzlich zwei Kosten-Gates, weil die Runde den Baum anfasst: der Play-out-Pin in e2e/branch.spec.ts läuft vor jeder Bank-Messung einzeln, und die Baumzeit wird je Spielart verschränkt gemessen (Runde 43 hat den Doubles-Baum um 44 bis 70 % verteuert). Beide Varianten werden einzeln verdiktet, keine gemeinsame Adoption.
> 
> **Doubles und Singles.** Die Skizzen-Matrix liegt in beiden Spielarten vor. Doubles hat bis zu 16 mal 16 Wurzelzellen, also wird der Prior dort getrennt gemessen, sowohl auf der Bank-Zeile als auch bei den Baumkosten; Singles hat den Play-out-Pin als Tripwire.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Bleibt PRIOR_VISITS bei 2, oder wird die Zahl selbst gemessen (2, 4, 8)?
> - Werden Prior und Regret-Matching getrennt verdiktet, oder darf eine Variante die andere tragen?
> - Zählt ein Kipp des Play-out-Pins als Abbruch oder als Re-Pin am User-Gate?
> 
> **Hintergrund**
> 
> - Q8 der Roadmap (docs/superpowers/plans/2026-09-02-analysis-quality-roadmap.md:242) und Plan-Abschnitt Runde 36+ (docs/superpowers/plans/2026-09-02-perf-and-quality-plan.md:886).
> - H_a: die Pass-1-Matrix (d1s1) liegt für jeden MCTS-Zug schon vor; als Prior für die Wurzel-Statistik (progressive Unpruning, Chaslot 2008) und mit Regret-Matching statt DUCT an der Wurzel (Lisy et al. 2013: konvergiert zum Gleichgewicht, DUCT nicht) sinkt das frühe Wandern des Baums.
> - H_b: Tak et al. 2014, DUCT gewinnt trotz Theorie, und der Prior verschiebt nur, was der Verify-Sampler ohnehin nachpreist; Erwartung klein, deshalb hinten.
> - Plan-Vorgabe: PRIOR_VISITS = 2 je Zelle.
> - Heutiger Stand: pick() ist UCB mit EXPLORATION 0,8 und progressiver Fensterung (WIDENING_BASE 4, WIDENING_VISITS_PER_SLOT 8), p1N und p1W starten auf 0, die Reihenfolge kommt aus hintOrder über die statischen Hinweise; vier Bäume je Suche, 600 Iterationen je Baum.
> - Der Regret-Matching-Löser steht fertig da (4000 Iterationen, nur die Durchschnitts-Strategien sind Nash).
> - Prior-Quelle: der Skizzen-Pass des Sweeps (d1s1, matrix, prove false) legt sein Ergebnis in data.results ab, EvalResult trägt die gelöste Wurzel-Matrix mit den Mischungen; Pass 2 und Pass 3 überschreiben die Skizze danach, also muss der Prior beim Start des tiefen Passes gelesen oder im Request mitgeschickt werden.
> - Im Kalibrierungs-Harness gibt es keinen Sweep, dort rechnet die Bank die Matrix selbst.
> - Warnungen aus den Vorrunden: der Play-out-Pin (Draft t56, Muk-Alola vor Heatran) kippte schon an der Sonden-Schwelle aus Runde 45 deterministisch und ist empfindlicher als die Bank; Runde 43 hat den Baum-Teil der Chance-Knoten wegen spät plus 12 bis 15 bp und plus 44 bis 70 % Doubles-Kosten ausgeschaltet; Perf-Sonden driften um 18 % an einem Vormittag, also nur verschränkt messen.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/search/mcts-node.ts:105, pick() ist UCB über die entkoppelten Statistiken, ohne jeden Prior
> - packages/eval-engine/src/search/mcts-node.ts:88, p1N und p1W starten als Nullen-Arrays
> - packages/eval-engine/src/search/mcts-node.ts:16, EXPLORATION 0,8
> - packages/eval-engine/src/search/mcts-node.ts:29, WIDENING_BASE 4 und WIDENING_VISITS_PER_SLOT 8 bestimmen das Fenster
> - packages/eval-engine/src/ranking/solve.ts:21, solveMatrixGame ist ein fertiger Regret-Matching-Löser
> - src/hooks/evaluation/graph-sweep.ts:291, fastSettings d1s1 matrix mit prove false ist die Skizze
> - src/hooks/evaluation/sweep-core.ts:149, data.results[turn-1] speichert das Skizzen-Ergebnis
> - packages/eval-engine/src/types.ts:195, EvalResult trägt die gelöste Wurzel-Matrix samt Mischungen
> - src/workers/eval-worker.ts:48, mctsTreeSearch läuft im Worker, der Request müsste den Prior tragen
> - packages/eval-engine/src/mcts-merge.ts:23, MCTS_TREES 4 Bäume je Suche
> - e2e/branch.spec.ts:59, der Play-out-Pin über die Reihenfolge der p2-Wechsel
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 39 (Q8).

### T107 · Restposten aus dem Review der Runde 60

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 837 Bank-Stellungen und 139 Replays (129 Bank, 10 Feedback); gen9doublesou-2660809089#6 für Punkt 4; Code forward/request-moves.ts:61
- Beleg: out/position-census.txt: Primal-Wetter 0 Stellungen, Porygon mit Download 0, Trace-Träger 0, Slow Start 0, Macho Brace, Power-Items und Iron Ball 0 Körper; 1 Doubles-Stellung mit aufladendem Aktiven (2660809089#6, Trevenant); Spitzname mit „: “ in 0 von 139 Replays; pass erzeugt kein Aufrufer im Zug-Request (request-moves.ts:61, choices.ts:199, advance.ts:110)
- Grund: Kein Punkt trifft ein Bank- oder Feedback-Spiel. Punkt 4 ändert nur das Etikett einer Option in einer Stellung (pair/odds.ts liefert keinen Score), Punkt 7 sind Tests ohne Wirkung. Ohne Hebel und ohne Szene bleibt nichts.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T107 · Restposten aus dem Review der Runde 60** (Regelfehler, Mini-Runde, klein, je Punkt verlustfrei oder mit eigenem Beleg)
> 
>   Sieben kleine Befunde, keiner trifft heute ein Bank- oder Feedback-Spiel: (1) Ein ausdrückliches `pass` in einer Doubles-Wahl überspringt in `forward/request-moves.ts` einen besiegten Slot, der Simulator nicht. (2) `recordAbilityAttribution` schneidet den Spitznamen mit `split(': ')`; die alte Erfassung nahm den ganzen Rest. (3) `syncWeather` lässt bei Wechsel oder Entfernen `source` und `sourceSlot` stehen (Primal-Wetter endet in der Vorschau nie). (4) Ein festgelegter Phantom-Force-Release in Doubles verliert die K.-o.-Quote der Option (`pair/odds.ts`, Ziel ohne Ort seit T94). (5) Ein Porygon2, das Download kopiert, bekommt Download als eigene Fähigkeit (`-ability`-Zeilen mit `[from]` sind erworben). (6) Die Tempo-Liste kennt Slow Start, Macho Brace und die Power-Items nicht; der Prüfer sieht eine fehlende Regel nur, wenn ein Fixture-Körper sie trägt. (7) Tests, die die Spec nennt und der Plan ausließ: Calyrex kündigt As One und Unnerve in der Engine an, ein Tera-Typ aus dem Log schlägt `requiredTeraType`, T104 mit zwei möglichen Besitzern, eingefügtes Terrain endet nach seiner Dauer.
> 
>   *Erfolg:* Jeder Punkt ist behoben mit rotem Test oder begründet verworfen.

**Alter Abschnitt im Backlog-Plan:**

> ### T107 · Restposten aus dem Review der Runde 60
> 
> *Regelfehler · Mini-Runde · klein · je Punkt verlustfrei oder mit eigenem Beleg*
> 
> **Problem.** Sieben Befunde des Schluss-Reviews (Ledger `docs/perf/probes/2026-10-02-r60/ledger.md`, Zeilen `Final: minor (deferred)`): `pass` in `request-moves.ts`, Spitzname per `split(': ')` in `recordAbilityAttribution`, alter `source` im Wetter nach `syncWeather`, K.-o.-Quote eines festgelegten Releases in `pair/odds.ts`, Download beim Trace von Porygon2, Slow Start und Tempo-Items in der Liste, fehlende Tests der Spec.
> 
> **Schritte.**
> - ☐ Je Punkt ein roter Test oder eine begründete Ablehnung, dann der Fix; Engine- und replay-core-Suite, Bank und Feedback byte-gleich oder gelesen.

### T75 · Der Simulator lehnt im Nachbau noch 21 Wahlen ab

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Die 149 Replays der Zählung der Runde 55 auf 5d428b2 (Bank, Feedback, Fit-Korpus-Doubles mit Sperre); Bank-Zeilen nach der ersten Ablehnung; smogtours-gen8ou-573756 Zug 102
- Beleg: out/reject-census.json: 20 Ablehnungen in 18 Replays (Doubles „can only switch in once“ 12 in 10 Replays, immer „switch N, switch N“); 33 von 837 Bank-Zeilen liegen nach der ersten Ablehnung, die Hauptklasse erreicht 2 (2629731825#8, 939625#12); Obergrenze bei 0,05 je Zeile zum Sieger: −4,6 bp gepoolt; out/ab-t105.jsonl: die übrig bleibenden Volatiles bewegen die Bank um +0,08 bp
- Grund: Nach jeder Ablehnung korrigiert die nächste Zug-Grenze Aktive, KP, Stufen und Status; was bleibt, misst T105 ohne Hebel. Kein Doubles-Spiel des Feedback-Korpus hat eine Ablehnung, in 573756 liegt nach Zug 102 nur der Pin t138 (ok). Die Klasse „move matching“ in 752301 geht im Rest von T108 auf.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T75 · Der Simulator lehnt im Nachbau noch 21 Wahlen ab** (Nachbau, Mini-Runde, klein, score-berührend D3 mit eigenem Beleg, erster Schritt Sichtung)
> 
>   Lehnt der Simulator die Wahl einer Seite ab, schickt der Nachbau `default`, und in Doubles spielt dann auch der Partner seinen ersten Zug statt seines Protokollzugs. Runde 55 hat zwei Ursachen geschlossen (Zielort am gesperrten Slot, gesperrter erster Zug nach einem Zurückzucken) und die Zahl von 42 auf 21 gedrückt. Der Rest nach der letzten Meldung je Replay: 11-mal „can only switch in once“ (Doubles, 10 Replays: zwei Slots wollen dasselbe Pokémon einwechseln), 4-mal „doesn't have a move matching“ (das gebaute Set trägt den gespielten Zug nicht, etwa Landorus ohne Taunt in smogtours-gen9ou-752301), 3-mal „is trapped“, 3-mal „is disabled“ (Ogerpon Ivy Cudgel, Gouging Fire Morning Sun, Toxapex Toxic Spikes in 573756). Wie ein Formular, das an der Kasse zurückkommt: Der Kunde bekommt dann das Standardmenü.
> 
>   Hinweis: `choiceErrors` hält je Replay nur die Zahl und die letzte Meldung. Erster Schritt: jede Ablehnung mit Zug und Meldung mitschreiben, dann die größte Klasse (Doppel-Einwechslung) an einem Replay verfolgen. 573756 ist ein Pin-Spiel; ein Fix dort braucht den Feedback-Lauf vor der Bank. Die Zählung nennt außerdem drei Taunt-Abweichungen (752301 Zug 2 und 3, smogtours-gen9ou-751543 Zug 20, ungelesen) und eine Encore-Abweichung aus gebrochener Zugreihenfolge (smogtours-gen9doublesou-937928 Zug 4, gehört zu T30).
> 
>   *Erfolg:* Die Zählung nennt jede Ablehnung mit Zug und Klasse, die Klasse „can only switch in once“ steht bei 0 oder ist erklärt, Singles-Dumps byte-gleich oder gelesen. *Plan T75:* 4 Schritte, 1 offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T75 · Der Simulator lehnt im Nachbau noch 21 Wahlen ab
> 
> *Nachbau · Mini-Runde · klein · score-berührend D3 mit eigenem Beleg · erster Schritt Sichtung*
> 
> **Problem.** 21 abgelehnte Wahlen in 19 von 149 Replays (Zählung Runde 55, Stand 2f9b0a9). Nach der letzten Meldung je Replay: 11-mal „can only switch in once“ (Doubles, 10 Replays), 4-mal „doesn't have a move matching“, 3-mal „is trapped“, 3-mal „is disabled“. Auf jede Ablehnung folgt `default` für die ganze Seite.
> 
> **Idee.** Erst jede Ablehnung mit Zug und Meldung mitschreiben, dann die größte Klasse an einem Replay verfolgen.
> 
> **Schritte**
> 
> - ☐ **1.** `choiceErrors` um eine Liste (Zug, Seite, Wahl, Meldung) erweitern oder in der Sonde über `recordStreamError` mitschreiben; Zählung neu fahren.
> - ☐ **2.** Doppel-Einwechslung verfolgen: Zwei Slots einer Seite lösen auf dasselbe Bank-Pokémon auf (`findSlotBySpecies`, `buildForcedSwitchChoice`). Roter Test mit dem kleinsten Log.
> - ☐ **3.** Fix; „is trapped“ und „is disabled“ je an einem Fall lesen und entscheiden (Fix oder T30/T28).
> - ☐ **4.** Gate D3 mit eigenem Beleg: Zählung vorher und nachher, gepaarte Bank gegen `r55-rebuild`, drei Feedback-Läufe (573756 ist Pin-Spiel), bewegte Urteile lesen.
> 
> **Doubles und Singles.** Die größte Klasse sitzt in Doubles; „is trapped“ und zwei „is disabled“ sitzen in Singles. Die Zählung deckt beide ab.
> 
> **Offene Entscheidung.** „doesn't have a move matching“ hier (Nachbau weicht auf einen anderen Zug aus) oder bei den Sets (T28)?
> 
> **Herkunft.** Zählung der Runde 55 (`docs/perf/probes/2026-09-21-r55/out/lock-census-after.json`).

### T105 · Körper auf der Bank tragen Volatile vom Feld

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: smogtours-gen9ou-751466 Zug 10 und alle 25 Bank-Stellungen mit Volatiles auf der Bank (22 Singles, 3 Doubles, 11 Spiele)
- Beleg: out/ab-t105.jsonl: 18 von 25 flach (unter 0,005), 4 zum Sieger, 3 weg, größte Bewegung 0,046 (937926#5, Doubles, weg vom Sieger), Brier gepoolt +0,08 bp; Szene 751466 Zug 10: 0,1098 → 0,1102; Zählung out/bench-volatiles.txt: 26 Körper in 25 Stellungen
- Grund: Der Zustand ist falsch: der Simulator leert beim Einwechseln nur den gehenden Körper (battle-actions.js:108), ein Booster-Volatile bleibt beim Wiedereintritt. Auf allen betroffenen Bank-Stellungen ändert das Leeren den Wert aber kaum, und keine Szene zeigt es.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T105 · Körper auf der Bank tragen Volatile vom Feld** (Nachbau, Mini-Runde, klein, score-berührend D3)
> 
>   smogtours-gen9ou-751466 Zug 10: Iron Valiant sitzt auf der Bank und trägt noch das Quark-Drive-Volatile. Der Simulator löscht Volatiles beim Auswechseln; ein Körper auf der Bank dürfte keins tragen. Die Tempo-Zählung der Runde 60 fand 11 solche Körper in 5 Spielen (751466, 937926, 751207, 2658664943, 937928), alle mit Protosynthesis oder Quark Drive. Wechselt der Körper im Nachbau ein, spielt der Simulator den alten Schub weiter (die Tempo-Liste liest ihn ebenso). Vermutete Herkunft: die Schnappschuss-Korrektur der Aktiven, die Körper zwischen Feld und Bank tauscht, ohne die Volatiles zu leeren.
> 
>   *Erfolg:* Kein Körper auf der Bank trägt nach einer Korrektur ein Volatile; die Tempo-Zählung (`census/speed-census.vt.ts`) findet die Klasse nicht mehr; Bank und Dumps bewegen sich nur in Spielen mit Paradox-Pokémon.

**Alter Abschnitt im Backlog-Plan:**

> ### T105 · Körper auf der Bank tragen Volatile vom Feld
> 
> *Nachbau · Mini-Runde · klein · score-berührend D3*
> 
> **Problem.** smogtours-gen9ou-751466 Zug 10: Iron Valiant sitzt auf der Bank mit dem Quark-Drive-Volatile; die Tempo-Zählung der Runde 60 (`docs/perf/probes/2026-10-02-r60/census/t95b/census-before.txt`) fand 11 solche Körper in 5 Spielen. Der Simulator leert Volatiles beim Auswechseln; ein Körper, der im Nachbau einwechselt, spielt den alten Schub weiter.
> 
> **Schritte.**
> - ☐ Herkunft finden: die Korrektur der Aktiven in `packages/eval-engine/src/branch/corrections.ts` (`correctActivesFromSnapshot`, `repointActiveSlot`) gegen die Fünf-Spiele-Liste lesen.
> - ☐ Roter Test: eine Korrektur, die einen Körper mit Volatile auf die Bank tauscht; danach trägt er keins.
> - ☐ Fix über den Simulator (`clearVolatile` beim Tausch), Zählung erneut, Messung D3.

### T106 · Die Korrektur schreibt Bedingungen, die der Simulator nicht kennt

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 13 Bank-Stellungen mit futuresight als Seitenbedingung in 7 Singles-Spielen, zum Beispiel smogtours-gen9ou-751505 Zug 29 bis 65 und gen9ou-2658665571 Zug 9
- Beleg: out/unknown-conditions.txt: 13 Stellungen, einzige unbekannte Id, in 8 davon führt der Simulator den echten Angriff als futuremove beim Ziel; out/ab-t106.jsonl: alle 13 mit und ohne Phantom gesucht, Score auf vier Stellen gleich, beste Option beider Seiten gleich
- Grund: Der Dex kennt die Id nicht, also gibt es keine Handler; eigener Code liest Seitenbedingungen nur per fester Id (cell-blend.ts:87, ko-odds.ts:94, branch/state.ts:182 für die Vorschau, die nur Screens nimmt). Gemessen sind Singles; der Code-Grund gilt auch für Doubles, dort hat die Bank kein Spiel mit Future Sight.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T106 · Die Korrektur schreibt Bedingungen, die der Simulator nicht kennt** (Nachbau, Mini-Runde, klein, verlustfrei D4 erwartet)
> 
>   GPL-Replay Zug 26 bis 38: `@pkmn/client` führt Future Sight als Seitenbedingung (`level 1`, `minDuration 3`, ohne `-end`-Zeile nie beendet); die Schnappschuss-Korrektur schreibt `futuresight` in die Seitenbedingungen des Simulators, dessen Dex die Id nicht kennt (`exists: false`). Der Simulator führt Future Sight als Slot-Bedingung. Der Eintrag ändert heute kein Spiel, liegt aber in jedem serialisierten Zustand. Der Prüfer der Runde 60 vergleicht deshalb nur Bedingungen, die der Dex kennt.
> 
>   *Erfolg:* Die Korrektur übersetzt nur Bedingungen, die der Dex kennt (Future Sight als Slot-Bedingung oder gar nicht); Bank und Dumps byte-gleich oder gelesen.

**Alter Abschnitt im Backlog-Plan:**

> ### T106 · Die Korrektur schreibt Bedingungen, die der Simulator nicht kennt
> 
> *Nachbau · Mini-Runde · klein · verlustfrei D4 erwartet*
> 
> **Problem.** GPL-Replay Zug 26 bis 38: `@pkmn/client` führt Future Sight als Seitenbedingung (ohne `-end`-Zeile nie beendet); `branch/field-correction.ts` schreibt `futuresight` in die Seitenbedingungen, der Dex kennt die Id nicht (`exists: false`).
> 
> **Schritte.**
> - ☐ Zählen, welche Ids die Korrektur über Bank und Feedback schreibt, die `battle.dex.conditions.get(id).exists` verneint.
> - ☐ Roter Test, Fix in `syncEffectTableFromSnapshot` (nur Ids, die der Dex kennt), Prüfer `field-correction-oracle.spec.ts` ohne Ausnahme.

### T71 · STAB nach den Spielregeln übernehmen

- Urteil: zusammengelegt (nach Ruling)
- Szene: HEAD rechnet STAB Tera-blind (packages/eval-engine/src/score/threat.ts:223). Gelesen: Baum-Blätter in gen9ou-2658659909#17 (Singles) und smogtours-gen9doublesou-941638#6 (Doubles), dazu eine Viertel-Stichprobe aller Bank-Stellungen mit erlaubtem Tera.
- Beleg: groups/statik-achse/out-leaves.jsonl: 2048 von 3034 Blättern (Singles) und 4326 von 9148 (Doubles) tragen einen terastallisierten Körper, dessen STAB die Regel ändert; an der Wurzel nur 114 von 585 Singles- und 54 von 252 Doubles-Stellungen (out-census.json). out-stab71-*.jsonl (Regel ohne Re-Fit): Singles 130 Stellungen −1,4 bp der Singles-Zeilen [−3,0; +0,1], 17 zum Sieger, 9 weg; Doubles 61 Stellungen +1,3 bp [−8,0; +10,7], 16 zu 16; Zeit 0,98× und 0,97×.
- Grund: Aufgegangen in T81: die STAB-Regel (d8eb0a3) läuft als Zeile im gemeinsamen Bau, ohne eigenen Re-Fit.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T71 · STAB nach den Spielregeln übernehmen** (Re-Fit, Mini-Runde, klein, score-berührend D3, braucht T49 oder T50; geparkt, bis S2 gemessen hat, Urteil in T99, Gate der Runde 58 „1a“)
> 
>   Ein Garchomp mit Tera Boden trifft mit Earthquake 2,0-fach statt 1,5-fach, ein Tera-Feuer-Garchomp bekommt auf Fire Fang 1,5 statt 1,0. Die Regel ist gebaut (d8eb0a3, Branch `r54-stab`), gegen den Simulator auf acht Fällen nachgerechnet, und der Schiedsrichter stützt sie: 116 von 150 strittigen Paaren liegen näher am Schadensrechner. Die Bank liest mit ihr Doubles schlechter: glücksbereinigt +10 bp [+0, +22] gegen den Stand ohne sie, dazu Warnungen in Doubles spät (hq +8, glücksbereinigt +23); Singles steht still. Warum die Bank mit der richtigeren Regel schlechter liest, ist ungemessen. Die Arbeitsvermutung: Gewichte und K sind gegen die blinde Statik gefittet, wie ein neues, genaueres Thermometer an einer Heizung, deren Regler auf das alte geeicht ist.
> 
>   Hinweis: Runde 54 hat die Regel mit c910b91 geparkt; ein glatter `git revert c910b91` scheitert am Cache-Kommentar, den die Buchung danach geändert hat; c910b91 zeigt aber genau, was zurück muss (die Funktion `stabMultiplier`, ihr Aufruf, ihre Tests). Der Test „STAB stays tera-blind while the rule is parked“ in `tera-statics.spec.ts` wird dabei durch die Tabelle der Regel ersetzt. Erster Schritt ist die Probe auf die Vermutung: dieselbe Regel mit neu gefitteten Gewichten gegen die Basis messen. Sie gehört neben den Re-Fit der Gewichte, nicht davor. Seit Runde 57 gehören dazu: Adaptability, der 60er-Boden der Tera-Züge und der Bonus für Tera Blast nach dem Klick (Runde 57 gibt Tera Blast Typ und Kategorie, unter Stellar die Stärke 100 und doppelten Schaden gegen terastallisierte Ziele; der eigene Typ-Bonus nach dem Klick fehlt; User-Gate 23.09., „2a 3a“).
> 
>   *Erfolg:* Mit neu gefitteten Gewichten zeigt keine gepoolte Bank-Zeile Schaden, der Schiedsrichter-Gewinn bleibt (116 zu 34), die Tier-Zählung hält. *Plan T71:* 3 Schritte, 1 offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T71 · STAB nach den Spielregeln übernehmen
> 
> **Geparkt, bis Iteration S2 gemessen hat** (User-Gate der Runde 58, „1a“): Die Obergrenze der ganzen Genauigkeits-Achse liegt bei +16,4 bp [7,6; 25,3] und braucht neu gefittete Gewichte; ob das TODO nach dem Umbau noch gebraucht wird, entscheidet danach die Triage (T99).
> 
> *Re-Fit · Mini-Runde · klein · score-berührend D3 · braucht T49 oder T50*
> 
> **Problem.** Die STAB-Regel nach den Spielregeln (alter Typ 1,5, Tera-Typ 1,5, beides 2,0, Stellar 2,0 und 1,2) ist gebaut und gegen den Simulator geprüft, der Schiedsrichter stützt sie (116 von 150 Paaren näher). Die Bank liest mit ihr Doubles glücksbereinigt +10 bp [+0, +22] schlechter; Gewichte und K sind gegen die blinde Statik gefittet.
> 
> **Schritte**
> 
> - ☐ **1.** Die Regel auf dem Re-Fit-Branch zurückholen: c910b91 zeigt, was zurück muss (ein glatter Revert scheitert am Cache-Kommentar); den Pin „STAB stays tera-blind while the rule is parked“ durch die Tabelle der Regel ersetzen.
> - ☐ **2.** Gewichte mit der Regel neu fitten (zusammen mit T49 oder T50), Kandidat gegen die Basis ohne Regel messen.
> - ☐ **3.** Gate D3: keine gepoolte Zeile mit Schaden, Schiedsrichter-Probe, Tier-Zählung.
> 
> **Offene Entscheidung.** Eigene Messung oder im selben Re-Fit wie das Boost-Gewicht?
> 
> **Herkunft.** Runde 54, Zustand `stab` (`.calibration/r54-stab`, `.calibration/r54-review`).

### T82 · Züge, deren Katalog-Stärke beim Einsatz steigt oder fällt

- Urteil: zusammengelegt (nach Ruling)
- Szene: gen9vgc2026regi-2630110359 Zug 3 (Bank-Stellung): Surging Strikes von Urshifu-Rapid-Strike in keiner Kombination von p2. Census der Doubles-Kürzung und Statik-Sonde auf 332 Singles-Stellungen.
- Beleg: out-census.json: Kombinationen mit Mehrfachtreffern überleben die Kürzung zu 32 von 636 (5,0 %, andere 12,7 %), Surging Strikes fehlt an 3 von 3 Seiten, Tachyon Cutter an 8 von 23; Knock-Off-Familie 613 von 5512 (11,1 %). out-hintall-f.jsonl: mit Treffern gezählt wird Surging Strikes die beste Zeile von p2 (−0,549). out-staticall-s-*.jsonl: Stellungen nur mit T82-Zügen tragen −2,3 bp der Singles-Zeilen (182 Stellungen, 46 zu 42). Bank-Träger: Knock Off in 734 von 837 Stellungen.
- Grund: Aufgegangen in T81: dieselbe Ursache (eigener Schadenskern für Blatt und Doubles-Kürzung), ein gemeinsamer Bau. Die offene Entscheidung zu Stored Power und Power Trip bleibt und steht jetzt in T81 (die Statik rechnet über boostedFraction mit Stufen).
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T82 · Züge, deren Katalog-Stärke beim Einsatz steigt oder fällt** (Endspiel, Runde, mittel, score-berührend D3; geparkt, bis S2 gemessen hat, Urteil in T99, Gate der Runde 58 „1a“)
> 
>   Knock Off trifft ein Ziel mit Item mit 97 statt 65 Stärke; auf der Bank steht er in 292 Feld-Stellungen. Facade trifft mit Status doppelt, Hex gegen einen Statusträger, Acrobatics ohne Item; Eruption, Water Spout und Dragon Energy fallen mit den KP (die Statik rechnet immer 150), Stored Power steigt mit Boosts, Expanding Force im Psycho-Feld, Solar Beam halbiert sich im Regen, und Mehrfachtreffer wie Triple Axel zählen einen Treffer. Die Statik rechnet all das mit der Katalog-Stärke. Schiedsrichter der Runde 57: Water Spout 0,533, Eruption 0,241, Acrobatics 0,156, Hex 0,074 Fehler.
> 
>   Hinweis: Knock Off läuft im Simulator über `onBasePower` und steht im Schiedsrichter noch unter „ohne Familie“; erst die Familien erweitern. KP, Status und Boosts ändern sich zwischen gegabelten Stellungen: die Antwort gehört in den Memo-Schlüssel (`CONTEXT_MOVES`), und Boosts widersprechen der stufenfreien Statik (Entscheidung). Knock Off allein bewegt mehr Paare als alle Gewichts-Züge.
> 
>   *Erfolg:* Der Fehler jeder Familie fällt, keine gepoolte Bank-Zeile zeigt Schaden, die Statik bleibt unter 1,15×. *Plan T82:* 5 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T82 · Züge, deren Katalog-Stärke beim Einsatz steigt oder fällt
> 
> **Geparkt, bis Iteration S2 gemessen hat** (User-Gate der Runde 58, „1a“): Die Obergrenze der ganzen Genauigkeits-Achse liegt bei +16,4 bp [7,6; 25,3] und braucht neu gefittete Gewichte; ob das TODO nach dem Umbau noch gebraucht wird, entscheidet danach die Triage (T99).
> 
> *Endspiel · Runde · mittel · score-berührend D3*
> 
> **Problem.** Die Statik rechnet mit der Katalog-Stärke: Knock Off (97 gegen ein Ziel mit Item, 292 Feld-Stellungen der Bank), Facade, Hex, Venoshock, Acrobatics, Eruption, Water Spout, Dragon Energy, Brine, Stored Power, Power Trip, Expanding Force, Solar Beam im Wetter, Mehrfachtreffer.
> 
> **Schritte**
> 
> - ☐ **1.** Schiedsrichter der Runde 57 um die `onBasePower`-Züge erweitern, Zählung je Zug.
> - ☐ **2.** Rote Tests je Familie gegen den Simulator (Orakel `test/move-oracle.ts`).
> - ☐ **3.** Regeln in `move-use-rules.ts`; KP, Status und Item in die Antwort, die Antwort in `CONTEXT_MOVES`.
> - ☐ **4.** Zeit verschränkt (Statik unter 1,15×).
> - ☐ **5.** Gate D3 je Familie für sich.
> 
> **Offene Entscheidungen.** Boosts (Stored Power) gegen die stufenfreie Statik; Knock Off allein oder mit dem Rest?
> 
> **Herkunft.** Lese-Berichte der Runde 57 zu T81 (`understand/t81-*`).

### T88 · Body Press, Psyshock und Foul Play rechnen mit den falschen Werten

- Urteil: zusammengelegt (nach Ruling)
- Szene: gen9vgc2026regi-2630452654 Zug 6 (Bank-Stellung): Body Press in keiner Zeile von p1 auf HEAD. Census der Doubles-Kürzung und Statik-Sonde auf den Singles-Stellungen mit Body Press, Psyshock oder Foul Play.
- Beleg: out-hintall-e.jsonl: mit der Werte-Achse in den Hinweisen wird Body Press→Iron Valiant + → Tornadus die beste Zeile von p1 (0,255). out-census.json: Body Press und Co. überleben die Kürzung zu 198 von 1859 (10,7 %, andere 12,7 %), an 10 von 70 Seiten fehlt der Zug ganz. out-staticall-s-*.jsonl: Stellungen nur mit T88-Zügen tragen −4,8 bp der Singles-Zeilen (51 Stellungen, 17 zum Sieger, 10 weg).
- Grund: Aufgegangen in T81: dieselbe Ursache, ein gemeinsamer Bau. Die Stufen-Achse für Body Press (Def-Boosts in den Hinweisen, setupEquity) steht jetzt in T81; sie ist in Doubles der größte Einzelteil und trägt die VGC-Szene 2629760324 Zug 2 und 3.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T88 · Body Press, Psyshock und Foul Play rechnen mit den falschen Werten** (Endspiel, Mini-Runde, klein, score-berührend D3; geparkt, bis S2 gemessen hat, Urteil in T99, Gate der Runde 58 „1a“)
> 
>   Die Statik nimmt Angriff gegen Verteidigung oder Spezial-Angriff gegen Spezial-Verteidigung, je nach Kategorie. Body Press rechnet aber mit der Verteidigung des Angreifers, Psyshock gegen die Verteidigung des Ziels, Foul Play mit dem Angriff des Ziels; die Stufen in `boostedFraction` folgen derselben falschen Achse. Auf der Bank: Body Press in 110 Feld-Stellungen und 289 mit einem Träger, Psyshock 23 und 93, Foul Play 6 und 32 (Zählung der Runde 57).
> 
>   *Erfolg:* Der Schiedsrichter der Runde 57 liest diese Züge näher am Rechner, keine gepoolte Bank-Zeile zeigt Schaden. *Plan T88:* 3 Schritte, 1 offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T88 · Body Press, Psyshock und Foul Play rechnen mit den falschen Werten
> 
> **Geparkt, bis Iteration S2 gemessen hat** (User-Gate der Runde 58, „1a“): Die Obergrenze der ganzen Genauigkeits-Achse liegt bei +16,4 bp [7,6; 25,3] und braucht neu gefittete Gewichte; ob das TODO nach dem Umbau noch gebraucht wird, entscheidet danach die Triage (T99).
> 
> *Endspiel · Mini-Runde · klein · score-berührend D3*
> 
> **Problem.** Die Statik wählt Angriff oder Spezial-Angriff gegen die passende Verteidigung nach der Kategorie; Body Press (eigene Verteidigung), Psyshock (Verteidigung des Ziels) und Foul Play (Angriff des Ziels) weichen ab, ebenso die Stufen in `boostedFraction`. Bank: Body Press 110 Feld-Stellungen und 289 mit Träger, Psyshock 23 und 93, Foul Play 6 und 32.
> 
> **Schritte**
> 
> - ☐ **1.** Rote Tests gegen den Simulator.
> - ☐ **2.** Die Werte-Achse in die Antwort der Tabelle (`move-use.ts`), `boostedFraction` folgt ihr.
> - ☐ **3.** Gate D3 mit dem Schiedsrichter der Runde 57.
> 
> **Offene Entscheidung.** Stufe der eigenen Verteidigung für Body Press im Memo oder nach dem Memo?
> 
> **Herkunft.** Gegenprüfer der Runde-57-Zählung (`understand/t81-power-census.check.json`).

### T90 · Reste der Zug-Tabelle

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Suche nach Trägern in den 837 exportierten Bank-Stellungen (docs/perf/probes/2026-10-02-r61/positions) und den zehn Feedback-Dumps (feedback/now); Code von landedOrCatalog und seinen Aufrufern auf 5d428b2.
- Beleg: 0 Träger von Mega Sol, Eelevate, Meganium-Mega, Eelektross-Mega, Normalize, Revelation Dance, Judgment, Multi-Attack, Techno Blast und Natural Gift in Bank und Feedback. Die Aufrufer von landedOrCatalog lesen nur (packages/eval-engine/src/score/threat.ts:204 und :248, score/move-facts.ts:102); UserFacts.item liest nur für die vier Item-Regel-Züge mit 0 Trägern.
- Grund: Keine Lücke hat einen Träger auf Bank oder Feedback, also gibt es weder Bank-Hebel noch Szene. Der veränderbare Dex-Zug wird von keinem Aufrufer verändert, und das doppelte Lesen des Items betrifft nur Züge ohne Träger, also auch keinen Tempo-Hebel.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T90 · Reste der Zug-Tabelle** (Endspiel, Mini-Runde, klein, score-berührend D3; geparkt, bis S2 gemessen hat, Urteil in T99, Gate der Runde 58 „1a“)
> 
>   Aus dem finalen Review der Runde 57: Mega Sol (Meganium-Mega: die eigenen Züge wie in Sonne, Weather Ball also Feuer) und Eelevate (Eelektross-Mega schwebt) fehlen im Adapter, und Champions-Replays liegen im Korpus. Judgment mit einem Z-Kristall bleibt im Simulator Normal (`!item.zMove`), die Tabelle liest nur die Platte. Normalize lässt in Gen 5 und 6 Züge, die sich selbst umtypen (Weather Ball, Hidden Power), bei ihrem Typ. Der Null-Zug-Satz liest für Revelation Dance die Typen der Art (Soak, Reflect Type, Burn Up). `landedOrCatalog` gibt den geteilten Dex-Zug als veränderbares Objekt heraus. `UserFacts.item` baut bei jedem Lesen ein neues Objekt, und `byItem` liest es zweimal.
> 
>   *Erfolg:* Jede Lücke hat einen roten Test und ist geschlossen oder begründet stehen gelassen; der Schiedsrichter bewegt sich nur in Zeilen mit einem Träger. *Plan T90:* 3 Schritte, keine offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T90 · Reste der Zug-Tabelle
> 
> **Geparkt, bis Iteration S2 gemessen hat** (User-Gate der Runde 58, „1a“): Die Obergrenze der ganzen Genauigkeits-Achse liegt bei +16,4 bp [7,6; 25,3] und braucht neu gefittete Gewichte; ob das TODO nach dem Umbau noch gebraucht wird, entscheidet danach die Triage (T99).
> 
> *Endspiel · Mini-Runde · klein · score-berührend D3*
> 
> **Problem.** Aus dem finalen Review der Runde 57: Mega Sol, Eelevate, Judgment mit Z-Kristall, Normalize in Gen 5 und 6 bei Zügen, die sich selbst umtypen, Revelation Dance im Null-Zug-Satz, der veränderbare Dex-Zug aus `landedOrCatalog`, `UserFacts.item` baut bei jedem Lesen ein neues Objekt (`byItem` liest es zweimal).
> 
> **Schritte**
> 
> - ☐ **1.** Je Lücke ein roter Test gegen den Simulator.
> - ☐ **2.** Adapter und Tabelle nachziehen (`score/move-facts.ts`, `move-use-rules.ts`, `null-moves.ts`).
> - ☐ **3.** Gate D3 mit dem Schiedsrichter der Runde 57.
> 
> **Herkunft.** Finaler Review der Runde 57 (Ledger `.superpowers/sdd/2026-09-23-round-57-plan/progress.md`, „Final: minor (deferred)“).

### T50 · Doubles-Gewichte je Format, zum gemeinsamen Wert gezogen

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Keine Szene im Text. Gelesen: Zahl der Doubles-Stellungen und Spiele in .calibration/r61-t98b/merged.jsonl und die Fit-Korpus-Zahl aus der Kalibrier-Recherche der Runde 47.
- Beleg: Fit-Korpus: −4,2 bp Brier auf 7 von 8 Seeds, Schrumpfstärke auf den Testdaten gewählt (docs/perf/probes/2026-09-18-r47/calib-research/m3-weights-by-group.txt). Bank heute 252 Doubles-Stellungen aus 46 Spielen, davon 10 VGC-Spiele; Auflösung der Doubles-Zeile etwa 58 bp (Runde 48). Zum Vergleich der Doubles-Hebel am Blatt: Doubles-K −54,7 bp je Stichproben-Stellung (out-k52-*.jsonl).
- Grund: Der Gewinn liegt eine Größenordnung unter der Auflösung der Bank, und es gibt keine Szene, die ihn trägt. Der Umbau ändert daran nichts. Der größere und billigere Doubles-Hebel am Blatt ist K (T52); Formate lassen sich später als Term in der Modellform (T102) prüfen.
- Spielart: Doubles

**Alter Text in NextSteps.md:**

> - ☐ **T50 · Doubles-Gewichte je Format, zum gemeinsamen Wert gezogen** (Re-Fit, Sichtung, klein, kein Score-Touch)
> 
>   Die Frage des Users vom 18.09.: Lohnen eigene Werte je Format? Für K nein (je Format −6,2 bp außerhalb der Stichprobe, je Quelle −2,2 bp, je Generation −1,3 bp; selbst mit perfektem Rückblick wären es 3,9 bp). Frei gefittete Gewichte je Format verlieren klar (Singles +120 bp, Doubles +107 bp). Ein Kandidat überlebt: Doubles-Gewichte je Format, zum gemeinsamen Vektor hin geschrumpft („jedes Format bekommt seinen Wert, wird aber zur gemeinsamen Mitte gezogen, je weniger Daten es hat“), −4,2 bp Brier auf 7 von 8 Seeds. Zwei Dämpfer: Die Schrumpfstärke wurde auf den Testdaten gewählt, und die Bank hält nur 197 Doubles-Stellungen aus 36 Replays.
> 
>   *Erfolg:* Die Schrumpfstärke kommt aus einer inneren Kreuzvalidierung, der Gewinn steht mit Band da, und die Sichtung sagt mit einer Zahl, ob 36 Doubles-Replays für ein Bank-Verdikt reichen. *Plan T50:* 5 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T50 · Doubles-Gewichte je Format, zum gemeinsamen Wert gezogen
> 
> *Re-Fit · Sichtung · klein · kein Score-Touch · braucht T47*
> 
> **Problem und Zahlen.** Aus der Kalibrier-Recherche (`docs/perf/probes/2026-09-18-r47/calib-research/m3-weights-by-group.txt`, Gegenprüfung `verify-weights-by-group.mjs`): frei gefittete Gewichte je Format verlieren (Singles +120 bp, Doubles +107 bp); geschrumpft schlagen sie in Doubles das Phasen-K um −16,4 bp Logloss und −4,2 bp Brier auf 7 von 8 Seeds. Die Schrumpfstärke wurde auf den Testdaten gewählt. K je Format, Quelle, Generation: alle verlieren (−6,2 / −2,2 / −1,3 bp), mit perfektem Rückblick wären 3,9 bp zu holen.
> 
> **Schritte**
> 
> - ☐ **1.** Wiederhole die Messung mit innerer Kreuzvalidierung für die Schrumpfstärke.
> - ☐ **2.** Gib den Gewinn mit Band an (Bootstrap über Spiele).
> - ☐ **3.** Zähle, welche Doubles-Formate die Bank abdeckt (197 Stellungen aus 36 Replays, davon 51 VGC aus 10), und schätze mit T47, ob das für ein Verdikt reicht.
> - ☐ **4.** Liste, was im Code ein Format-Gewicht bräuchte (`featureWeights(doubles)` bekommt die Format-Id; Cache-Schlüssel; API-Snapshot).
> - ☐ **5.** Ja oder Nein für eine Bau-Runde.
> 
> **Offene Entscheidungen.** Neue Doubles-Replays für die Bank sammeln oder nicht; Format-Familien (VGC-Regelsätze zusammen) oder einzelne Formate.

### T33 · Rennen-Statik: PP, Körper ohne Angriff, Deckel, Priorität

- Urteil: verwerfen (nach Ruling)
- Szene: Prüfstand-Stellungen struggle-lock, fixed-vs-ghost, two-v-one-switch-loop, level-gap, doubles-level-gap und doubles-healer-vs-band über den App-Pfad (searchTreesOrchestrated, vier Bäume, Nachprüfung, Beweiser); Bank-Stellung smogtours-gen9ou-749828 Zug 23; Reichweite über alle 837 Bank-Stellungen
- Beleg: docs/perf/probes/2026-10-04-r62/groups/endspiel/fixtures.json: struggle-lock liest in der App -0,995 (Wahrheit -0,995, Statik +0,359), fixed-vs-ghost -0,955 (Wahrheit -1, Statik 0), level-gap 1,000 (Statik 0,9), doubles-level-gap 1,000, doubles-healer-vs-band -0,987; nur two-v-one-switch-loop bleibt bei -0,003 (Wahrheit -1). .calibration/r61-t98b/merged.jsonl: 749828#23 Score -1,000 mit Beweis Masse 1, decidedHeld null. census.json: 0 von 10 letzten Paaren mit gegenseitigen Wänden; idle.json: 0 Seiten ganz ohne Schadenszug; Deckel 0,9 aufheben auf den 10 letzten Paaren: -0,06 bp gepoolt; priority.json: 36 Stellungen (17 Singles, 19 Doubles) mit bedingter Priorität, die Statik liest weiter nur die Dex-Priorität (packages/eval-engine/src/score/threat.ts:255, packages/eval-engine/src/speed.ts:82).
- Grund: Die App liest fünf von sechs Prüfständen richtig, der Deckel als Blattwert bringt gepoolt +2,0 bp, keinen Gewinn. Das echte Spiel 573756 liest an Zug 134 bis 136 weiter zaghaft für den Sieger (−0,48, −0,60, −0,33); diese Beobachtung bleibt als C-Zeile mit T109 (2400 Durchläufe) als Messpunkt.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T33 · Rennen-Statik: PP, Körper ohne Angriff, Deckel, Priorität** (Endspiel, Runde, groß, score-berührend D3)
> 
>   Zapdos mit einem PP Thunderbolt gegen Toxapex mit Recover: Löser −0,995, Statik +0,36. Chansey mit Seismic Toss gegen Gengar: Löser −1, Statik und Matrix 0,0. Zwei Wände ohne Angriffszug gegen Garchomp: Statik +0,64, Wahrheit −1. Level 100 gegen Level 30: 0,9 statt 1,0. Die Statik soll wissen: Leere Angriffs-PP heißen kein Schaden, ein Körper ohne Angriffszug gewinnt nichts, und wo nur eine Seite Schaden macht, ist das Rennen entschieden.
> 
>   Aus dem Nachtlauf der Runde 47: 749828 Zug 23, Primarina (98/364) gegen Rillaboom (65/341) im Grassy Terrain. Die Statik liest +0,6 für Primarina, der Decided-Sweep nennt p1, Suche, Beweiser und Spielausgang sagen p2. Ursache ist `movesFirst` (`packages/eval-engine/src/speed.ts`): Ein Prioritätszug schlägt das Tempo und verleiht den Erstschlag dem besten Zug der Seite, und gelesen wird nur die Dex-Priorität. Primarinas Aqua Jet zählt, Rillabooms Grassy Glide (Priorität erst durch das Terrain) nicht. Auf den 11 voll aufgeklappten Stellungen des Nachtlaufs trifft die Statik 9 Vorzeichen, jede Suche 11. Dieselbe Leihe steckt in der Decided-Erkennung (`score/unanswered.ts`): Runde 50 hat den ehrlichen Erstschlag dort als Sonde gezählt (Tempo entscheidet, gegnerische Priorität nimmt den Erstschlag, eigene Priorität zählt nur, wenn der Prioritätszug selbst tötet). Die Quote der genannten Seite steigt in Singles von 78,5 auf 83,6 %, 5 Verluste und 5 richtige Nennungen fallen weg (`docs/perf/probes/2026-09-19-r50/decided-levers.vt.ts`, Schalter `honestFirst`). Die Roh-Erkennung nennt in 749828 Zug 23 weiter p1 (`packages/eval-engine/test/decided-held-positions.spec.ts` hält das fest): Das ist der rote Test dieser Runde. Eine Änderung dort ist score-berührend, weil die genannte Seite den Beweiser startet. Ein Bank-Verdikt für die Statik bleibt außer Reichweite (5 exakte Bank-Stellungen); der Prüfstand bleibt das Instrument.
> 
>   *Erfolg:* `struggle-lock`, `fixed-vs-ghost` und `two-v-one-switch-loop` lesen in der Statik das richtige Vorzeichen, `level-gap` liest 1,0, später Bank-Brier in der vorregistrierten Linie. Der Prüfstand ist das Instrument, die Bank nur die Nicht-Verschlechterungs-Linie. *Plan T33:* 8 Schritte, 4 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T33 · Rennen-Statik: PP, Körper ohne Angriff, Deckel
> 
> **Nachtrag Runde 50 (Decided v2).** Dieselbe Prioritäts-Leihe steckt in der Decided-Erkennung (`score/unanswered.ts`, `sweepClocks` und `beatsEntry` rufen `movesFirst`). Die Sonde `docs/perf/probes/2026-09-19-r50/decided-levers.vt.ts` (Schalter `honestFirst`: Tempo entscheidet, gegnerische Priorität nimmt den Erstschlag, eigene Priorität zählt nur, wenn der Prioritätszug selbst aus den aktuellen HP tötet) hebt die Quote der genannten Seite in Singles von 78,5 auf 83,6 % und streicht 5 Verluste (2658663604 t17, 2663108091 t26, 2663110678 t17, 2663112349 t32, 749828 t23) und 5 richtige Nennungen. Der rote Test liegt bereit: `packages/eval-engine/test/decided-held-positions.spec.ts` hält fest, dass die Roh-Erkennung in 749828 t23 p1 nennt. Eine Änderung an der Roh-Erkennung ist score-berührend (die genannte Seite startet den Beweiser). Doubles: Dort hilft der strenge Paarsieg ohne Gleichstand-Kredit (73,7 auf 95,7 %, alle Doubles-Verluste bis auf einen hängen an einem 1/1-Takt), in Singles bewegt er nichts.
> 
> **Nachtrag Runde 47 (Nachtlauf).** Neuer Punkt für diese Runde: die Priorität in `movesFirst` (`packages/eval-engine/src/speed.ts:61`). Ein nutzbarer Prioritätszug schlägt das Tempo und verleiht den Erstschlag dem BESTEN Zug der Seite, und `pairThreat` (`score/threat.ts`) liest nur `move.priority` aus dem Dex. `749828#23`: Primarina (98/364, Aqua Jet) gegen Rillaboom (65/341, Grassy Glide im Grassy Terrain, dazu schneller): Statik +0,600, Decided-Sweep p1, Löser, Suche und Beweiser −1,000, Spielausgang p2. Zwei Fehler: bedingte Priorität ist unsichtbar (Grassy Glide, ebenso Prankster, Gale Wings, Triage), und der Prioritätszug leiht seine Zugreihenfolge einem anderen Zug. Auf den 11 voll aufgeklappten Stellungen des Nachtlaufs trifft die Statik 9 Vorzeichen (mittlerer Fehler 0,525), Variante B 8, jede Suche 11. Ein Bank-Verdikt für die Statik bleibt außer Reichweite (5 exakte Bank-Stellungen, 44 von 55 an der 20-Minuten-Wanduhr gedeckelt bei rund 5 Zuständen je Sekunde); der Prüfstand bleibt das Instrument, und `EVAL_ENDGAME_SOLVED` benotet einen neuen Statik-Stand gegen die Nachtlauf-Zeilen in anderthalb Minuten. Ein weiterer langer Lauf lohnt erst, wenn der Löser eine Größenordnung schneller ist oder Crits als Klasse gepreist sind (T23).
> 
> *Endspiel · Runde · groß · score-berührend (D3) · braucht T08*
> 
> **Problem.** Zapdos hat noch einen PP Thunderbolt gegen ein Toxapex mit Recover. Der Löser sagt: Zapdos verliert (−0,995). Die Statik sagt +0,36 für Zapdos, weil beide Uhren auf unendlich stehen und die Material-Statik übernimmt. Chansey mit Seismic Toss gegen ein Gengar liest der Löser als −1, die Statik und die Matrix lesen 0,0. Zwei Wände ohne Angriffszug gegen ein Garchomp liest die Statik mit +0,64, die Wahrheit ist −1. Und ein Level-100-Machamp gegen ein Level-30-Eevee liest 0,9 statt 1,0.
> 
> **Idee.** Die Statik soll die drei Dinge wissen, die jeder Spieler weiß: leere Angriffs-PP heißen kein Schaden mehr, ein Körper ohne Angriffszug gewinnt nichts, und wo nur eine Seite überhaupt Schaden macht, ist das Rennen entschieden. Der Deckel darf höher als 0,9 stehen, wo die Gegenseite gar nichts tun kann.
> 
> **Schritte**
> 
> - ☐ **1.** Zähle über den Bank-Positions-Export, wie oft lastPairRace null liefert (gegenseitige Wände) und wie oft ein lebender Körper keinen nutzbaren Schadenszug hat, damit die Reichweite vor dem Bau feststeht.
>   - Dateien: `docs/perf/probes/2026-09-1X-race/race-count.vt.ts (NEU)`, `packages/eval-engine/src/score/last-pair.ts`, `packages/eval-engine/src/score/features.ts`
> - ☐ **2.** Schreibe die roten Tests an den vier Prüfstand-Stellungen struggle-lock, fixed-vs-ghost, two-v-one-switch-loop und level-gap, dazu den Gegen-Test, dass echte gegenseitige Wände weiter auf die Material-Statik fallen.
>   - Dateien: `packages/eval-engine/test/eval-last-pair.spec.ts`, `regression/endgame-fixtures.ts`
> - ☐ **3.** Trenne im Rennen die beiden Unendlich-Gründe: eine Seite ohne Schadenszug (frac 0) und eine Seite, deren Uhr am PP-Deckel scheitert. Wo nur eine Seite je Schaden macht, gewinnt sie das Rennen mit vollem Vorsprung.
>   - Dateien: `packages/eval-engine/src/score/races.ts`, `packages/eval-engine/src/score/last-pair.ts`
> - ☐ **4.** Nimm Körper ohne nutzbaren Schadenszug aus dem Material-Term heraus oder gib ihnen ein eigenes kleines Gewicht, so wie strandedAlive es für Hazard-verurteilte Körper schon tut.
>   - Dateien: `packages/eval-engine/src/score/features.ts`, `packages/eval-engine/src/score/weights.ts`
> - ☐ **5.** Hebe LAST_PAIR_CAP an oder mache den Deckel davon abhängig, ob die Gegenseite überhaupt zurückschlagen kann, und ziehe die zwei losen Pins nach.
>   - Dateien: `packages/eval-engine/src/score/last-pair.ts`, `packages/eval-engine/test/eval-mcts.spec.ts`, `packages/eval-engine/test/eval-search.spec.ts`
> - ☐ **6.** Fahre den Prüfstand vor und nach dem Umbau, diesmal mit den exakten Bank-Werten aus dem Nachtlauf, damit die Statik erstmals gegen echte Bank-Wahrheit gemessen wird.
>   - Dateien: `regression/endgame-truth.spec.ts`, `scripts/endgame-truth-table.mjs`
> - ☐ **7.** Miss den e2e-Play-out-Pin einzeln, dann die gepaarte Bank, dann drei Feedback-Läufe, und lies die glücksbereinigte Zeile mit.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`, `scripts/run-e2e.mjs`
> - ☐ **8.** Lege die bewegten Kanäle und die Statik-Zeilen dem User vor und hole das Re-Pin-Gate.
>   - Dateien: `e2e-feedback/corpus.ts`, `regression/eval-calibration.spec.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche mit glücksbereinigter Zeile, gepaarter Bank-Bench mit frischer Basis am selben Tag, drei byte-identische Feedback-Läufe, Re-Pins nur am User-Gate. Erfolg: struggle-lock, fixed-vs-ghost und two-v-one-switch-loop lesen in der Statik das richtige Vorzeichen, level-gap liest 1,0, und die späte Bank-Brier bleibt innerhalb der vorregistrierten Linie. Achtung: die vorregistrierte lastPair-Teilmenge der Bank ist leer (alle sechs Ein-Körper-Stellungen sind schon entschieden), also ist der Prüfstand das Instrument und die Bank nur die Nicht-Verschlechterungs-Linie.
> 
> **Doubles und Singles.** lastPairRace deckt Doubles bereits ab (Test 'doubles: one living body per side, both on the field, races too'), und die Material-Statik gilt für beide Spielarten. Belege: Singles struggle-lock, fixed-vs-ghost, two-v-one-switch-loop, level-gap; Doubles doubles-level-gap (0,900 gegen Wahrheit 1,000) und doubles-healer-vs-band (−0,900 gegen −1,000).
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Soll ein Körper ohne Schadenszug ganz aus dem Material fallen oder nur ein Bruchteil zählen? Er kann noch Hazards setzen, Wechsel-Tempo geben und stallen (toxic-stall gewinnt ohne Angriffszug).
> - Was zählt als Schadenszug: Grundstärke über 0, fester Schaden, OHKO? Und was ist mit Statuszügen, die über Residuen töten?
> - Bleibt der Deckel 0,9 für Rennen mit Gegenwehr stehen und fällt nur dort, wo die Gegenseite keinen Schaden machen kann?
> - Wird die Änderung zusammen mit dem Tie-Wert aus TODO 1 gemessen oder in einer eigenen Bank-Messung?
> 
> **Hintergrund**
> 
> - Prüfstand (docs/perf/probes/2026-09-12-r43/truth-after.jsonl): struggle-lock Wahrheit −0,995 bei Statik +0,359, d1 −0,995, MCTS −0,995 (Zapdos mit 1 PP Thunderbolt gegen Toxapex mit Recover, beide Uhren unendlich, deshalb Material-Statik); fixed-vs-ghost Wahrheit −1,000 bei Statik 0,000, d1 bis d3 0,000, MCTS −0,955 (Chansey Seismic Toss gegen Gengar Shadow Ball; der Löser braucht 27 Züge und 28 Zustände, die Statik sieht Chanseys Zug als typ-immun und Gengars Uhr am PP-Deckel scheitern); two-v-one-switch-loop Wahrheit −1,000 bei Statik +0,639, d1 +0,688, MCTS −0,003 (Toxapex Recover plus Corviknight Roost gegen Garchomp Earthquake, drei Körper, also die Material-Statik, nicht das letzte Paar); level-gap Wahrheit 1,000 bei Statik 0,900, doubles-level-gap ebenso.
> - Die Statik steht seit Runde 33 (Commit 12ad69a): Basis 0,6 plus 0,1 je Zug Vorsprung, Deckel 0,9, Vorsprung gedeckelt bei drei Zügen; damit las 573756 ab t136 −0,92 statt −0,77 an t137.
> - Die Rennen-Uhren kennen schon Heil-PP als Überleben, die Aktions-Ökonomie des Heilers und den PP-Deckel (races.ts), aber der PP-Deckel macht aus einer langsamen Sicherheit ein Unendlich.
> - Variante B (Flag EVAL_LAST_PAIR_SWEEP, setLastPairSweep) ist gemessen und nirgends übernommen: auf drei Bankzeilen anders als die Statik, einmal richtig (751443#23, B −0,900 gegen +0,508 bei Wahrheit −1,000), zweimal falsch (2658663604#20 B −0,700 bei Wahrheit 1,000; 2658660641#51 B −0,900 bei Wahrheit 0,027).
> - Die beiden losen Pins aus Zeile 114 sind eval-mcts.spec.ts:76 (Score größer 0,3) und eval-search.spec.ts:77 (Score größer 0,5), beide auf Level-100-gegen-Level-30-Stellungen, beide knapp über dem Deckel.
> - Bank-Beleg: 749828#23 liest die Statik mit +0,600, Löser und Beweiser mit −1,000 bei Masse 1,000.
> - Die glücksbereinigte Zeile schließt 334 von 816 Stellungen aus (41 Prozent).
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/score/last-pair.ts:46 gegenseitige Wände geben null zurück und die Material-Statik übernimmt
> - packages/eval-engine/src/score/last-pair.ts:20 LAST_PAIR_BASE 0,6 / :21 LAST_PAIR_PER_TURN 0,1 / :22 LAST_PAIR_CAP 0,9 / :23 MARGIN_CAP 3
> - packages/eval-engine/src/score/races.ts:139 die Uhr wird unendlich, sobald sie mehr Züge braucht als der Angreifer PP hat
> - packages/eval-engine/src/score/races.ts:124 ein Angreifer ohne Schadensanteil bekommt sofort Unendlich
> - packages/eval-engine/src/score/features.ts:44 bodyShare zählt jeden lebenden Körper voll, nur strandedAlive kürzt
> - packages/eval-engine/src/score/features.ts:92 die Seitensumme addiert bodyShare über alle lebenden Körper
> - packages/eval-engine/src/search/leaf.ts:50 das Blatt nimmt den Rennen-Wert, wenn das Rennen einen Sieger nennt
> - packages/eval-engine/test/eval-last-pair.spec.ts:105 der Pin 'mutual walls fall back to the material static'
> - packages/eval-engine/test/eval-mcts.spec.ts:76 und packages/eval-engine/test/eval-search.spec.ts:77 die zwei losen Deckel-Pins
> - docs/perf/2026-09-04-endgame-truth.md:25 struggle-lock, :26 two-v-one-switch-loop, :23 fixed-vs-ghost, :24 level-gap
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 24 (2); Zeile 114; Zeile 123. Zusammengelegt, weil: Alle drei Punkte hängen an derselben Stelle. Das Rennen erklärt beide Seiten für unfähig zu töten, gibt null zurück und übergibt an die Material-Statik, und die zählt jeden lebenden Körper voll. Der Deckel 0,9 steht in derselben Datei und wird von denselben Prüfstand-Zeilen widerlegt.

### T34 · Beweiser prüft die zweite Seite nur nach verlorener Probe

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Alle 38 Bank-Stellungen im Endspiel-Bereich (28 Singles, 10 Doubles), Beweiser in der Reihenfolge von forcedWinFor (packages/eval-engine/src/search/forced-win.ts:38) mit Zeit je Versuch; Dump von 573756 (feedback/now)
- Beleg: docs/perf/probes/2026-10-04-r62/groups/endspiel/prover-plain.json: zweite Seite 22 Versuche, 1 030 ms gesamt (47 ms je Versuch), 3 Beweise (749828#23, 751443#23, 2663112349#37) von 19 Endspiel-Beweisen; erste Seite 3 060 ms. Ein Bank-Zug kostet rund 3,6 s (.calibration/r61-t98b/run.json: 4 Scheiben je rund 750 s für 837 Stellungen). 573756: 62 Endspiel-Züge, 60 ohne Beweis (feedback-full-smogtours-gen8ou-573756.json), Wanduhr 48 s (feedback-now.log Zeile 27). Bank heute 31 Beweise auf 837, 30 richtig.
- Grund: In Runde 35 waren 13 s ein Fünftel eines billigen Matrix-Sweeps. Seit Runde 61 rechnet jeder Zug vier Bäume, die zweite Seite ist rund 1 Prozent davon und auf der Uhr nicht zu sehen. Gleichzeitig liefert sie 3 von 19 Endspiel-Beweisen, genau dort, wo die Roh-Erkennung die falsche Seite favorisiert; der Umbau könnte nur Beweise kosten.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T34 · Beweiser prüft die zweite Seite nur nach verlorener Probe** (Endspiel, Mini-Runde, mini, score-berührend D3, braucht T01)
> 
>   In jedem kleinen Endspiel versucht der Beweiser beide Seiten, auch wenn eine Seite sicher gewinnt. Im Sweep von 573756 kostet das 13 s über 140 Aufrufe. Die zweite Seite nur prüfen, wenn die gierige Linie der ersten mit einer Niederlage endet.
> 
>   Hinweis: Gedacht als Kostenhebel, aber score-berührend: Ein nicht mehr versuchter Beweis nimmt Masse aus dem Score (`search/forced-win-apply.ts`).
> 
>   *Erfolg:* Die Zahl der Beweise auf der Bank bleibt gleich (33 von 816 nach Runde 35), die Beweiser-Zeit im Sweep sinkt messbar (verschränkt gemessen). *Plan T34:* 5 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T34 · Beweiser prüft die zweite Seite nur nach verlorener Probe
> 
> *Endspiel · Mini-Runde · mini · score-berührend (D3) · braucht T01*
> 
> **Problem.** In jedem kleinen Endspiel versucht der Beweiser beide Seiten. Meistens gewinnt eine Seite klar, und der zweite Versuch kostet Zellen, ohne je etwas zu finden. Im Sweep von 573756 summiert sich das auf 13 Sekunden über 140 Aufrufe.
> 
> **Idee.** Erst die gierige Probe der favorisierten Seite laufen lassen und die zweite Seite nur prüfen, wenn diese Linie mit einer Niederlage endet. Wie beim Aufräumen: die zweite Schublade nur öffnen, wenn die erste nichts hergibt.
> 
> **Hinweis.** Gedacht als Kostenhebel, aber score-berührend: Ein nicht mehr versuchter Beweis nimmt Masse aus dem Score (`search/forced-win-apply.ts`).
> 
> **Schritte**
> 
> - ☐ **1.** Miss zuerst, wie oft die zweite Seite überhaupt einen Beweis liefert: zähle über die Bank-Positionen die Aufrufe je Seite und die Treffer der zweiten.
>   - Dateien: `docs/perf/probes/2026-09-1X-prover/second-side.vt.ts (NEU)`, `packages/eval-engine/src/search/forced-win.ts`
> - ☐ **2.** Schreibe den roten Test: eine Stellung, in der die erste Seite gewinnt, darf den Beweiser für die zweite Seite nicht mehr aufrufen.
>   - Dateien: `packages/eval-engine/test/forced-win-prover.spec.ts`, `packages/eval-engine/test/forced-win-apply.spec.ts`
> - ☐ **3.** Gib der gierigen Vorprobe ein Ergebnis zurück, das sagt, ob die Linie in einer Niederlage endet, und lass forcedWinSides die zweite Seite nur danach anhängen.
>   - Dateien: `packages/eval-engine/src/search/forced-win.ts`, `packages/eval-engine/src/endgame/prover.ts`
> - ☐ **4.** Miss die Beweiser-Zeit im Sweep von 573756 verschränkt gegen die Basis desselben Laufs, nicht gegen eine Zahl von gestern.
>   - Dateien: `docs/perf/probes/2026-09-03/probe.config.ts`
> - ☐ **5.** Fahre die gepaarte Bank und drei Feedback-Läufe, weil ein verlorener Beweis einen Score bewegt, und lege bewegte Kanäle dem User vor.
>   - Dateien: `scripts/paired-calibration.mjs`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend, auch wenn es als Kostenhebel gedacht ist: ein nicht mehr versuchter Beweis nimmt eine Masse aus dem Score. Also Cache-Bump, gepaarter Bank-Bench, drei byte-identische Feedback-Läufe, Re-Pins am User-Gate. Erfolg: die Zahl der Beweise auf der Bank bleibt gleich (33 von 816 nach Runde 35) und die Beweiser-Zeit im Sweep sinkt messbar.
> 
> **Doubles und Singles.** Der Auslöser sitzt in forcedWinSides und gilt für beide Spielarten; die Messung trennt die Doubles-Tranche der Bank, weil dort jede Zelle den Plain-Pfad nimmt und ein Beweis seltener steht.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Zählt als Auslöser für die zweite Seite die gierige Linie oder der Wurzel-Score? Im Endspiel-Bereich ist der Score selbst unsicher.
> - Bleibt die zweite Seite in Doubles erhalten, wo der Beweiser ohnehin nur über gezogene Würfe beweist?
> 
> **Hintergrund**
> 
> - forcedWinSides gibt im Endspiel-Bereich beide Seiten zurück (favorisiert zuerst, dann die andere) und außerhalb nur die favorisierte; die Begründung im Kopfkommentar lautet, ein gescheiterter Versuch sei im Endspiel billig.
> - Runde 35 maß die Beweiser-Zeit im Sweep mit 13 s über 140 Aufrufe (25 s beim ersten Vorproben-Bau) und die Wanduhr auf 573756 mit etwa plus 10 s bei 10 s Maschinendrift.
> - Das erste Budget (nur Zustände) hatte 2 s je gescheiterter Stellung gekostet, bei neun Antworten bis 20 s; das Zellenbudget brachte die Kosten auf null (65 s gegen 65 s verschränkt gemessen).
> - Verworfen nach Messung in Runde 35: Ein-Seed-Vorprobe (zu optimistisch), Frühabbruch bei stehender Statik (kostet Beweise), Kostenschätz-Gate (kostet Beweise), 150 Zellen (ändert nichts).
> - Budget heute: 200 Zustände, 100 Zellen, Tiefe 12, Vorprobe 16 Zellen und 5 Züge, drei Wurzelkandidaten, zwei innere Kandidaten.
> - Bank-Stand: 33 von 816 Stellungen mit Beweis, 30 davon richtig.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/search/forced-win.ts:34 im Endspiel-Bereich kommen beide Seiten zurück
> - packages/eval-engine/src/search/forced-win.ts:37 forcedWinFor übernimmt die verbrauchten Zustände und Zellen in den zweiten Versuch
> - packages/eval-engine/src/endgame/prover.ts:42 PROVER_BUDGET mit 200 Zuständen, 100 Zellen, Tiefe 12, Vorprobe 16 Zellen und 5 Züge
> - packages/eval-engine/src/endgame/prover.ts:237 die gierige Probe liefert heute nur die Gewinner-Kandidaten, keine Niederlage-Auskunft
> - packages/eval-engine/src/endgame/prover.ts:250 followsToWin gibt 0 zurück, sobald die Linie nicht im Sieg endet
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 25 (zweite Seite im kleinen Endspiel).

### T87 · Endspiel-Löser und Beweiser halten Züge mit Katalog-Stärke 0 für schadlos

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 24 Bank-Stellungen im Beweiser-Bereich mit Low Kick, Heavy Slam, Heat Crash oder Ruination auf dem Feld (17 Singles, 7 Doubles); Code packages/eval-engine/src/endgame/children.ts:44 und packages/eval-engine/src/endgame/prover.ts:90; der Löser läuft in der App nicht (Stand-Karte Abschnitt 4)
- Beleg: docs/perf/probes/2026-10-04-r62/groups/endspiel/prover-carriers-plain.json gegen prover-carriers-patched.json (Katalog-Stärke 1 für Low Kick, Heavy Slam, Heat Crash, Ruination, Endeavor; Schaden im Simulator unverändert): 0 von 24 Stellungen ändern Masse, Züge oder Vorbehalt; patchcheck.vt.ts bestätigt, dass der Patch jede gegabelte Stellung erreicht. classplan.json: 120 von 156 Singles-Zellen mit solchen Zügen nehmen den einfachen Pfad, dort hängt aber kein K.-o. am Wurf.
- Grund: Die Lücke ist echt, aber sie bewegt auf der Bank keinen Beweis, keine Masse und keinen Volltreffer-Vorbehalt. Der Rechner kennt die echte Stärke und meldet in diesen Zellen keine Kill-Grenze, eine Ziehung statt drei verschiebt nur Rest-HP. Der Löser-Teil hat keinen App-Pfad, und der Rest (Stärke beim Einsatz) gehört zu T81.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T87 · Endspiel-Löser und Beweiser halten Züge mit Katalog-Stärke 0 für schadlos** (Endspiel, Mini-Runde, klein, score-berührend D3)
> 
>   `endgame/children.ts` (`damagingPair`) und `endgame/prover.ts` (`critable`, Reihenfolge nach Stärke) lesen die Katalog-Stärke: Ist auch der Zug der Gegenseite schadlos, bekommt ein Paar mit Low Kick, Heat Crash, Gyro Ball, Return oder einer Hidden Power bis Gen 5 eine Ziehung statt drei; das gilt auf dem einfachen Pfad, wenn der Zellenplan aussteigt. In jeder bewiesenen Zelle trägt ein überlebter Treffer aus so einem Zug keinen Volltreffer-Vorbehalt (`critable`, `survivedHit`).
> 
>   *Erfolg:* Die Prüfungen lesen die Stärke beim Einsatz (Tabelle der Runde 57); Prüfstand und Bank-Endspiele bewegen sich nur in Stellungen mit einem Träger. *Plan T87:* 3 Schritte, keine offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T87 · Endspiel-Löser und Beweiser halten Züge mit Katalog-Stärke 0 für schadlos
> 
> *Endspiel · Mini-Runde · klein · score-berührend D3*
> 
> **Problem.** `endgame/children.ts` (`damagingPair`) und `endgame/prover.ts` (`critable`, `survivedHit`, Ordnung) lesen die Katalog-Stärke. `damagingPair` gibt dem Paar nur dann eine Ziehung statt drei, wenn auch der Zug der Gegenseite schadlos ist; der fehlende Volltreffer-Vorbehalt trifft jede bewiesene Zelle.
> 
> **Schritte**
> 
> - ☐ **1.** Roter Test: Low-Kick-Paar im Löser bekommt drei Ziehungen, ein überlebter Treffer den Volltreffer-Vorbehalt.
> - ☐ **2.** Stärke beim Einsatz fragen (Hidden Power bis Gen 5 liest die Tabelle schon; die T81-Züge, sobald T81 landet; bis dahin `basePowerCallback` als Kennzeichen).
> - ☐ **3.** Gate D3 mit Prüfstand.
> 
> **Herkunft.** Lese-Bericht der Runde 57 (`understand/t81-power-keys.md`, Abschnitt 4).

### T55 · Score-Klammer unter zwei Schlüsseln

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 573756 Zug 137 im frischen Dump (feedback/now, tools/dump-turn.mjs 573756 137); die 64 gehaltenen Stellungen der Bank-Basis .calibration/r61-t98b/merged.jsonl
- Beleg: docs/perf/probes/2026-10-04-r62/groups/endspiel/t55-clamp.txt: gehaltene Stellungen 64 (37 Singles, 27 Doubles), die genannte Seite gewinnt 58 (90,6 %) bei versprochenen 89,7 % (Runde 50: 94,7 % gegen 88,8 %). Klammer-Änderung des Brier: Boden 0,85 gepoolt +0,5 bp [-1,1; +3,1], spät -0,7 bp [-3,2; +3,7]; Boden 0,9 spät -1,1 bp [-5,4; +5,4]; Boden 1,0 spät -0,2 bp [-8,1; +11,3]. 573756 Zug 137: Score vor dem Zug -0,893, Balken 84 % wie in Runde 50; Anzeige auf gehaltenen Stellungen im Schnitt 84,1 %, 95-%-Band der Siegquote 81 bis 96 %.
- Grund: Die Lücke, die die Klammer schließen sollte, ist auf dem neuen Stand fast weg: gehaltene Sweeps gewinnen so oft, wie der Score verspricht (0,9 statt 5,9 Punkte Abstand). Die Klammer bewegt den Brier um höchstens 3 bp, alle Bänder schließen 0 ein. Der Balken in 573756 Zug 137 zeigt weiter 84 %, aber die Bank belegt nicht, dass 84 % dort falsch sind, und der Park-Auslöser „mehr gehaltene Stellungen“ ist kein hartes Ereignis.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T55 · Score-Klammer unter zwei Schlüsseln** (Endspiel, Geparkt, klein, score-berührend D3)
> 
>   573756 Zug 137: Satz und Balken nennen beide LordEnz, der Balken zeigt 84 %. Auf der Bank gewinnt die genannte Seite in solchen Stellungen 54 von 57 Mal (94,7 %), der Balken verspricht dort im Schnitt 88,8 %. Gleich hohe Balken ohne gehaltenen Sweep gewinnen 84,3 % bei versprochenen 86,6 %. Eine Klammer würde den Score auf einen festen Wert heben, sobald der Sweep gehalten ist. Vorab gerechnet in Runde 50 auf `.calibration/r49-fullkey`: Klammer 0,85 unter der Halte-Regel bewegt den späten Brier von 0,1223 auf 0,1221, also 2 bp bei einer Auflösung von 23 bp; eine Klammer auf jede entschiedene Stellung kostet 182 bp (wie Runde 15). Geparkt, bis die Bank mehr gehaltene Stellungen trägt oder eine Runde die Anzeige in entschiedenen Stellungen ohnehin anfasst.
> 
>   *Plan T55:* 4 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T55 · Score-Klammer unter zwei Schlüsseln
> 
> *Endspiel · Geparkt · klein · score-berührend (D3)*
> 
> **Problem.** 573756 Zug 137: Satz und Balken nennen beide LordEnz, der Balken zeigt 84 %. Auf der Bank gewinnt die genannte Seite in gehaltenen Stellungen 54 von 57 Mal (94,7 %), der Balken verspricht dort im Schnitt 88,8 % (Anzeige 84,3 %). Gleich hohe Balken ohne gehaltenen Sweep gewinnen 84,3 % bei versprochenen 86,6 %.
> 
> **Idee.** Wie ein zweites Gutachten, das dem ersten recht gibt: Stimmen Überschlagsrechnung und Suche überein, darf die Anzeige mutiger sein als die Suche allein.
> 
> **Schritte**
> 
> - ☐ **1.** Zähle die gehaltenen Stellungen auf dem frischen Dump und im Fit-Korpus neu (`decidedHeld` steht seit Runde 50 in jeder Zeile) und rechne die Klammer offline für Böden von 0,85 bis 1,2 mit Band (`scripts/paired-calibration.mjs` auf einem umgeschriebenen Dump).
>   - Dateien: `scripts/calibration-lib.mjs`, `scripts/paired-calibration.mjs`
> - ☐ **2.** Entscheide am Gate, ob der Gewinn die Auflösung der Bank erreicht (gepoolt 23 bp); Runde 50 las 2 bp für den Boden 0,85.
> - ☐ **3.** Baue die Klammer an der Stelle, an der der Beweiser-Balken ansetzt (`search/forced-win-apply.ts`), hinter einem Schalter, mit rotem Test zuerst.
>   - Dateien: `packages/eval-engine/src/search/forced-win-apply.ts`, `packages/eval-engine/src/turn-analysis/decided-held.ts`
> - ☐ **4.** Fahre D3: Cache-Bump, gepaarte Bank mit Bändern, drei byte-gleiche Feedback-Läufe, Tier-Zählung mit bewegten Zügen.
> 
> **Offene Entscheidungen**
> 
> - Klammert der Score oder nur die Anzeige (`winPercent`)? Eine Anzeige-Klammer wäre render-only.
> - Reichen 57 gehaltene Bank-Stellungen für ein Verdikt, oder wartet die Runde auf eine größere Bank?
> 
> **Hintergrund**
> 
> - Runde 15 baute eine Klammer auf jede entschiedene Stellung (`DECIDED_FLOOR` 0,85) und nahm sie am selben Tag zurück: später Brier 0,1500 auf 0,1547. Runde 50 rechnete dieselbe Klammer auf `.calibration/r49-fullkey` nach: 0,1223 auf 0,1405. Unter der Halte-Regel: 0,1223 auf 0,1221.
> - Zähl-Skripte: `docs/perf/probes/2026-09-19-r50/decided-info.mjs`, `gate-pooled.mjs`.

### T29 · Engine-Preis für Choice-gebundene Cleaner

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Bank-Zeilen von smogtours-gen9ou-750540 über alle Basen seit r52; Stellung 750540#18 wie gebaut (Choice Scarf) und mit Life Orb; alle 77 Bank-Stellungen mit lebendem Choice-Träger und Status-Zug mit choiceMismatch 40 und 0.
- Beleg: .calibration/*/merged.jsonl: 750540 Zug 18 r60-base 0,557, r61-trees 0,599, r61-app und r61-t98b 0,213 (Brier dieser Zeile mit K 2,41: 0,629 -> 0,391). groups/sets/patch-750540-t18.json: Scarf 0,2134 (gleich Bank-Zeile), Life Orb -0,050; Darkrai Timid 252 Init. (rund 383) ist ohne Scarf schneller als Landorus-T (rund 309), Gouging Fire auf +1 (rund 357) und Gholdengo. groups/sets/choice-weight-40.json und choice-weight-0-s0/s1.json: 75 von 77 Stellungen bewegt, höchstens 0,049; gepaarte Brier-Differenz gepoolt +0,2 bp, hq -0,5, Singles +1,0, Doubles -1,6.
- Grund: Der Zug-18-Sprung ist mit der App-Einstellung der Runde 61 von 0,557 auf 0,213 gefallen. Der Rest gegen Life Orb ist Spielmechanik: der Scarf bringt an dieser Wurzel kein Tempo, Life Orb bringt Schaden, und choiceMismatch ist dort 0, weil Darkrai keinen Status-Zug trägt. Der einzige messbare Hebel, choiceMismatch, liegt bei 0,2 bp; das Scarf-Tempo im Bedrohungs-Term ist ein Statik-Gewicht ohne Re-Fit-Plan.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T29 · Engine-Preis für Choice-gebundene Cleaner** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T01)
> 
>   750540: Darkrai trägt wirklich ein Choice Scarf. Mit dem richtigen Set kippt Zug 18 von 0,11 auf 0,58 zum Verlierer; dieses eine Spiel trägt 0,238 der 0,364 Punkte, mit denen Runde 37 ihre Bank-Linie verfehlte. Die Engine bucht beim Choice-Träger fast nur den Preis (gesperrte Status-Züge, Lock) und kaum den Nutzen (Tempo). Ein richtiges Set darf die Bewertung nicht verschlechtern.
> 
>   *Erfolg:* 750540 gibt den Zug-18-Sprung ab, die späte hq-Linie verbessert sich oder steht still, und der Gewinn hängt nicht wieder an einem einzigen Spiel. *Plan T29:* 9 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T29 · Engine-Preis für Choice-gebundene Cleaner
> 
> *Sets und Spreads · Runde · mittel · score-berührend (D3) · braucht T01*
> 
> **Problem.** In 750540 trägt Darkrai wirklich ein Choice Scarf; die Engine hatte vorher ein falsches Life-Orb-Darkrai und bewertete damit besser. Mit dem richtigen Set kippt Zug 18 von 0,11 auf 0,58 zum Verlierer. Dieses eine Spiel trägt 0,238 der 0,364 Punkte, mit denen Runde 37 ihre Bank-Linie verfehlt hat. Ein richtiges Set darf die Bewertung nicht verschlechtern.
> 
> **Idee.** Die Engine bucht beim Choice-Träger fast nur den Preis und kaum den Nutzen: Status-Züge zählen als Ballast, der Lock schneidet die Bedrohung auf einen Zug, und der Scarf bekommt keinen Schadens-Bonus. Wie ein Rennwagen, dem man den Kofferraum abzieht und die Höchstgeschwindigkeit nicht gutschreibt.
> 
> **Schritte**
> 
> - ☐ **1.** Baue eine Sonde, die 750540 Zug 13 bis 20 einmal mit Scarf-Darkrai und einmal mit Life-Orb-Darkrai bewertet und die Score-Bestandteile je Stellung ausgibt.
>   - Dateien: `packages/eval-engine/src/score/features.ts`, `packages/eval-engine/src/score/weights.ts`
> - ☐ **2.** Zähle über das Bank-Universum, wie viele Sets ein Choice-Item tragen und wie groß der choiceMismatch-Abzug je Seite ausfällt, getrennt nach Singles und Doubles.
>   - Dateien: `docs/perf/probes/2026-09-12-r45/bank-sets.vt.ts`
> - ☐ **3.** Schreibe einen roten Test neben den bestehenden Lock-Test: ein Scarf-Cleaner, der das Rennen gewinnt, muss besser stehen als derselbe Körper mit Life Orb, der es verliert.
>   - Dateien: `packages/eval-engine/test/eval-function.spec.ts`
> - ☐ **4.** Mache den Tempo-Vorteil des Scarfs im Bedrohungs-Term sichtbar, statt ihn nur über den Durchschnitts-Speed der Seite zu buchen.
>   - Dateien: `packages/eval-engine/src/score/threat.ts`, `packages/eval-engine/src/speed.ts`
> - ☐ **5.** Ziehe den choiceMismatch-Abzug nur, wenn die gesperrten Status-Züge im Horizont überhaupt gebraucht werden, und miss die Variante gegen den heutigen festen Anteil.
>   - Dateien: `packages/eval-engine/src/score/features.ts`, `packages/eval-engine/src/score/weights.ts`
> - ☐ **6.** Prüfe an 750540 einzeln, ob der Zug-18-Sprung verschwindet, bevor die Bank läuft.
> - ☐ **7.** Bump die Eval-Cache-Version auf v47 und nimm die Baum-Identität neu auf.
>   - Dateien: `src/lib/eval-cache-store.ts`
> - ☐ **8.** Registriere die Verdikt-Regel vor dem Lauf auf der hq-Tranche, fahre die gepaarte Bank mit frischer Basis am selben Tag und lies die glücksbereinigte Zeile mit.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`
> - ☐ **9.** Fahre drei byte-identische Feedback-Läufe und lege bewegte Pins dem User vor.
>   - Dateien: `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump v46 auf v47, vorregistrierte Verdikt-Regel auf der hq-Tranche (n=548) mit mitgelesener glücksbereinigter Zeile, gepaarter Bank-Bench über run-calibration.mjs und paired-calibration.mjs mit frischer Basis am selben Tag, drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, Re-Pins nur am User-Gate. Erfolg heißt: 750540 gibt den Zug-18-Sprung ab und die späte hq-Linie verbessert sich, mindestens aber steht sie still; die Zuordnung je Replay muss zeigen, dass der Gewinn nicht wieder an einem einzigen Spiel hängt.
> 
> **Doubles und Singles.** Choice-Items stehen in beiden Formaten; die Zählung trennt Singles und Doubles, der rote Test bekommt eine Singles-Stellung (Scarf-Cleaner gegen langsameren Angreifer) und eine Doubles-Stellung (Scarf-Träger neben einem Partner, damit der Durchschnitts-Speed der Seite den Effekt nicht schluckt).
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Soll der Scarf im Bedrohungs-Term sichtbar werden oder soll der choiceMismatch-Abzug schrumpfen? Beides zusammen macht die Zuordnung unmöglich, also nacheinander messen.
> - Darf das Gewicht choiceMismatch (heute 40) im selben Zug neu gefittet werden, oder bleibt der Re-Fit der Gewichte ein eigener Kandidat (Runde 45)?
> 
> **Hintergrund**
> 
> - Quelle: Bank-Zuordnung der Runde 37 mit festem K 1,76.
> - Ein Spiel, smogtours-gen9ou-750540, trägt +0,238 der +0,364 hq-spät-Summe; t18 springt von 0,11 auf 0,58 zum Verlierer.
> - Die Scarf-Inferenz dort ist richtig: Darkrai schlägt in t13 Deoxys-Speed aus, bevor dieses gezogen hat, das ist ohne Scarf unmöglich, und das echte Darkrai spielte je Aufenthalt genau einen Zug.
> - Ohne 750540 bleiben +0,126 aus kleinen Posten (749601 +0,052, 938644 +0,035, 752755 +0,027 mit Grimmsnarl 252 auf 0 Spe unter der Prankster-Regel, 914633 +0,020, 750953 +0,018, dagegen 751543 -0,036); die großen Gewinne liegen in std-Doubles (2663100395 -0,088, 2660818097 -0,079) und zählen für hq nicht.
> - Zehn Item-Entscheidungen in den 33 bewegten Replays: acht Scarf-in (750540 Darkrai, 750953 Typhlosion-Hisui, 2658665571 Kyurem, vier Gholdengo, 751244 Glimmora) und zwei Scarf-out (914633 Landorus-Therian auf Choice Band, 912047 Chi-Yu auf Choice Specs).
> - Heutige Mechanik: choiceMismatch zieht den Status-Zug-Anteil mit Gewicht 40 ab; der Bedrohungs-Proxy gibt Life Orb 1,3, Choice Band und Choice Specs je 1,5 auf die passende Kategorie und dem Scarf nichts; ein gesetzter Lock schneidet die Bedrohung auf den gesperrten Zug; der Scarf zahlt nur über effectiveSpeed in den Durchschnitts-Speed der Seite.
> - Lehre der Runde 37: ein richtiges Set kann die Bank verschlechtern, die Linie misst die Engine mit dem Set und braucht die Zuordnung je Replay, sonst entscheidet ein Spiel.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/score/features.ts:54: choiceMismatchOf zieht dem Choice-Träger den Anteil seiner Status-Züge ab
> - packages/eval-engine/src/score/weights.ts:74: das Gewicht choiceMismatch steht auf 40
> - packages/eval-engine/src/score/threat.ts:93: Life Orb gibt 1,3, Band und Specs je 1,5, der Scarf bekommt keinen Faktor
> - packages/eval-engine/src/score/threat.ts:167: ein gesetzter Lock schneidet die Bedrohung auf den gesperrten Zug
> - packages/eval-engine/src/speed.ts:29: der Scarf wirkt nur über effectiveSpeed, also über den Durchschnitts-Speed der Seite
> - packages/eval-engine/test/eval-function.spec.ts:464: ein Test für den gesperrten Angreifer steht schon und ist der Platz für den roten Test
> - src/lib/eval-cache-store.ts:160: Cache-Version 46, also v47 für diese Runde
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 31 (1).

### T60 · Phantom-Siebter aus der Mega-Wechselzeile

- Urteil: zusammengelegt (nach Ruling)
- Szene: VGC 2634199230 (Fit-Korpus .fit-corpus/gen9championsvgc2026regmbbo3-2634199230-...json): Inferenz und Bau auf HEAD; Körper-Zählung über Fit-Korpus (2122), Bank (129) und Feedback (10) auf HEAD und auf 597d1b0; Bau von smogtours-gen9ru-762698, gen9doublesou-2544016875, smogtours-gen7ubers-898976.
- Beleg: groups/sets/sets-2634199230.json: Kiran (p2) sechs Arten wie die Vorschau, kein Floette. groups/sets/body-census.json: Fit-Korpus 51 -> 27 Seiten über der Vorschau, alle 24 Floette-Phantome weg; Bank 1 -> 0 (749895 Ogerpon-Teal); Feedback 0 -> 0. Ursache behoben durch 1e8f778 (lookup.ts:13-23 liest battleOnly). Übrig 27 Seiten: Mimikyu-Busted 12, Zygarde-Complete 6, Palafin-Hero 5, Necrozma 3, Greninja-Ash 1 (Suffix-Liste lookup.ts:7-11 kennt -Busted, -Hero, -Complete, -Ash nicht). groups/sets/sets-formes.json: siebter Satz Mimikyu-Busted nur mit Tackle (762698), Palafin-Hero nur mit Tackle (2544016875), Zygarde-Complete auf beiden Seiten (898976).
- Grund: Aufgegangen in T101: Die Mega-Zeile ist seit Runde 60 erledigt (1e8f778, battleOnly aus dem Dex). Der Rest (27 Seiten im Fit-Korpus mit Mimikyu-Busted, Zygarde-Complete, Palafin-Hero, Necrozma-Ultra, Greninja-Ash) steht als Kampfformen-Punkt in T101.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T60 · Phantom-Siebter aus der Mega-Wechselzeile** (Sets und Spreads, Mini-Runde, klein, score-berührend D3)
> 
>   VGC 2634199230: Kirans Floette-Eternal entwickelt sich zur Mega-Form, das Log schreibt `|switch|p2b: Floette|Floette-Mega`, und `inferOpponentTeam` nimmt „Floette“ als siebte Art auf, obwohl Vorschau und Team-Sheet je sechs nennen. Kiran wird mit sieben Körpern bewertet, wb_vg mit sechs, und die Matrix trägt die Spalte „→ Floette-Eternal“ doppelt. Dieselbe Klasse wie der Formen-Marker aus Runde 45 (36 Bank-Seiten, spät −252 bp).
> 
>   *Erfolg:* Eine Zählung nennt die betroffenen Seiten in Bank, Fit-Korpus und Feedback-Spielen; danach baut jede Seite höchstens so viele Körper, wie die Vorschau nennt, und die Bank steht mindestens still. *Plan T60:* 5 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T60 · Phantom-Siebter aus der Mega-Wechselzeile
> 
> *Sets und Spreads · Mini-Runde · klein · score-berührend D3*
> 
> **Schritte**
> 
> - ☐ **1.** Zählung: Seiten mit mehr gebauten Körpern als Vorschau-Einträgen, über Bank, Fit-Korpus und Feedback-Spiele, nach Ursache (Mega-Wechselzeile, andere).
> - ☐ **2.** Roter Test im Replay-Kern: `|switch|p2b: Floette|Floette-Mega` legt keine neue Art an (`packages/replay-core/src/opponent-inferrer.ts`).
> - ☐ **3.** Fix nach dem Vorbild des Formen-Markers aus Runde 45 (e30e72a).
> - ☐ **4.** Set-Diffs auf den Bau-Wegen (D8), dann Gate D3, falls ein Bank-Replay betroffen ist; sonst D4 mit den Paket-Suiten.
> - ☐ **5.** VGC 2634199230: Kiran wird mit sechs Körpern bewertet, die doppelte Floette-Spalte ist weg.
> 
> **Offene Entscheidungen**
> 
> - Eigene Runde oder Huckepack bei T28?
> - Wirkung auf die 69 % vor Zug 5 messen (gepatchte Kopie mit Identitäts-Check) oder nur die Zählung?
> 
> **Herkunft.** Sichtung T11, Runde 51.

### T62 · Das Vorschau-Häkchen ist kein bekanntes Item

- Urteil: verwerfen (nach Ruling)
- Szene: Bau der 10 Feedback-Spiele mit den Item-Entscheidungen des Lösers auf angereicherten und auf rohen Infos (648453 als Szene); alle Aufrufer von inferOpponentTeam, buildTeamsFromReplay und solveReplaySpreads in App und Bank.
- Beleg: groups/sets/sets-feedback.json: rohe Infos 22 Platzhalter (has item), angereicherte 0 (team-info.ts:138 ersetzt ihn); Item-Entscheidungen App-Pfad 3 (648453: 2, 573756: 1), roher Pfad 1, Doubles 0 gegen 0. App löst auf effektiven, angereicherten Infos: src/hooks/useTeamKnowledge.ts:116-129, src/hooks/useTeamSources.ts:142, src/lib/eval-acquire.ts:47-55. Bank: regression/bank-build.ts:40 und :58-66 (App-Bau, Standard über scripts/run-calibration.mjs:25); rohe Infos nur hinter EVAL_CALIBRATION_RAWBUILD=1 oder ohne Smogon-Füllung (bank-build.ts:34-37).
- Grund: Kein Pfad löst auf rohen Infos, das Vorschau-Häkchen selbst richtet keinen Schaden an. Der eigentliche Fehler (recordConsumedItem schreibt einen Platzhalter) ist Punkt 1 von T108, mit der Szene 649664 Zug 8.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T62 · Das Vorschau-Häkchen ist kein bekanntes Item** (Sets und Spreads, Mini-Runde, mini, braucht T56)
> 
>   648453: Die Team-Vorschau eines gen6-Logs trägt je Pokémon ein Häkchen „hat ein Item“. `addFromPreview` schreibt daraus `(has item)` mit der Quelle `revealed` (`inference/handlers.ts:138`), und `speedKnowledgeFor` hält das Item damit für bekannt (`team/inferred-items.ts:20`). Auf rohen Infos darf die Scarf-Inferenz der Runde 37 deshalb nicht feuern; nimmt man das Häkchen weg, trifft der Löser genau die zwei Entscheidungen des App-Pfads. 22 von 1069 Singles-Pokémon tragen das Häkchen, alle in den vier gen6ou-Spielen des Feedback-Korpus; ein Ergebnis ändert es in einem Replay. Die Bank sieht nichts davon (kein gen6-Replay, in gen9 ist die Spalte nie gefüllt), und der App-Pfad ersetzt den Platzhalter beim Anreichern.
> 
>   *Erfolg:* Rohe und angereicherte Infos treffen dieselben Item-Entscheidungen (heute 9 gegen 11 in Singles, 2 gegen 2 in Doubles); kein Feedback-Dump bewegt sich. *Plan T62:* 4 Schritte, 1 offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T62 · Das Vorschau-Häkchen ist kein bekanntes Item
> 
> *Sets und Spreads · Mini-Runde · mini · braucht T56*
> 
> **Schritte**
> 
> - ☐ **1.** Roter Test: `speedKnowledgeFor` behandelt `(has item)` wie ein unbekanntes Item (`packages/replay-core/src/team/inferred-items.ts:20`, Platzhalter aus `inference/handlers.ts:138`).
> - ☐ **2.** Fix; rohe und angereicherte Infos treffen dieselben Item-Entscheidungen (heute 9 gegen 11 in Singles).
> - ☐ **3.** Set-Diffs: 648453 auf rohen Infos bekommt die zwei Entscheidungen des App-Pfads; Bank und App unbewegt.
> - ☐ **4.** Gate D4 mit Paket-Suiten und API-Snapshot.
> 
> **Offene Entscheidungen**
> 
> - Entfällt das TODO, wenn nach T56 kein Pfad mehr auf rohen Infos löst?
> 
> **Herkunft.** Sichtung T12, Runde 51.

### T25 · Budget auffüllen, auch unter gemessenen Stats

- Urteil: zusammengelegt (nach Ruling)
- Szene: Bank-Sets der 129 Bank-Spiele aus den exportierten Stellungen der Runde 61 (App-Bau auf dem neuen Stand), z. B. 750267 p1 Volcanion Hardy 0/0/0/0/0/0, 751382 p2 Slowking-Galar Hardy 0/0/0/0/0/0, 2658660641 p1 Kyurem Timid 0/0/0/0/0/252 mit Choice Specs; dazu fünf Auffüll-Sonden mit der App-Suche (Baum ab Zug 1).
- Beleg: groups/spreads/census.json: 85 von 996 Singles-Körpern unter 300 EVs (70 davon ohne Offensive), 229 unter 508; Doubles 5 von 524 unter 508, 0 unter 300. groups/spreads/out/fill_*.json: Score-Verschiebung 0,001 bis 0,035, im Mittel 0,014, 4 von 5 vom Spielausgang weg; Rauschen 0,005 (out/livenull_*.json). Mechanik unverändert: packages/replay-core/src/spread-inference.ts:116 topUpUnmeasured überspringt gemessene Stats (:121), letzte Änderung 5c6dcf6 am 20.09.
- Grund: Aufgegangen in T26 (Angreifer ohne Angriff): dieselbe Ursache, dasselbe Messproblem.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T25 · Budget auffüllen, auch unter gemessenen Stats** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T56, T31)
> 
>   Wenn das Log die HP misst und eine Verteidiger-Beobachtung den Bulk als uninvestiert liest, gelten HP, Def und SpD als gemessen. Die Auffüll-Regel lässt gemessene Stats stehen, der Rest des Budgets bleibt liegen: Im Fit-Korpus tragen 6151 Körper weniger als 300 von 508 EVs, 222 davon mit 0 Offensive. Im Branch steht dann ein dünnerer Körper als im Replay. Eine gemessene 0 soll heißen: auffüllen, solange der Fit-Fehler nicht steigt. Neu gezählt in Runde 51 (T13, nackter Pfad, heutiger master): Die flache Elle „unter 300 EVs“ mischt drei Budgets (6129 Körper, darin 3902 Champions-Sets, die bei 66 EVs Budget die 300 nie erreichen). Mit dem Budget des eigenen Formats (`spreads/ev-budget.ts`) lassen 5984 von 17 267 Singles-Sets, 13 von 4298 Doubles-Sets und 3890 von 3902 Champions-Sets Budget liegen; die 3890 Champions-Sets stehen alle ohne Offensive da.
> 
>   *Erfolg:* Weniger Körper unter dem Budget ihres Formats (getrennt nach Singles, Doubles und Champions), der Fit-Fehler steigt bei keinem Set, Bank in keiner Phase schlechter als die vorregistrierte Linie (früher Brier als benannte Nebenfrage). *Plan T25:* 9 Schritte, 3 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T25 · Budget auffüllen, auch unter gemessenen Stats
> 
> *Sets und Spreads · Runde · mittel · score-berührend (D3) · braucht T56, T31*
> 
> **Problem.** Sobald das Log die maximale HP misst und eine Verteidiger-Beobachtung den Bulk als uninvestiert liest, gelten HP, Def und SpD als gemessen. Die Auffüll-Regel lässt gemessene Stats stehen, also bleibt der Rest des Budgets einfach liegen. Im Fit-Korpus tragen 6151 Körper weniger als 300 von 508 EVs, 233 mehr als vor Runde 40, und 222 davon haben zusätzlich 0 Offensive. Im geforkten Kampf steht dann ein dünnerer Körper auf dem Feld, als das Replay gezeigt hat.
> 
> **Idee.** Eine gemessene 0 heißt heute fass mich nie an. Besser heißt sie fass mich so weit an, wie die Beobachtung es aushält: wie beim Kofferpacken wird der freie Platz gefüllt, solange der Deckel noch schließt, also solange der Fit-Fehler nicht steigt.
> 
> **Schritte**
> 
> - ☐ **1.** Schreibe eine Sonde, die je Set des Fit-Korpus die EV-Summe, die als gemessen geltenden Stats und den Fit-Fehler ausgibt, und zähle die Körper unter 300 EVs nach Ursache (fixierte HP, Verteidiger-Beobachtung, KO-only-Offensive).
>   - Dateien: `docs/perf/probes/2026-09-11-r41/sets-diff.spec.ts`, `packages/replay-core/src/spread-inference.ts`
> - ☐ **2.** Schreibe den roten Test zuerst: ein Körper mit fixierten HP, einer Verteidiger-Beobachtung und einer 0-Offensiv-Sprosse steht heute deutlich unter dem Budget; erwartet wird ein voller Körper, der jede Beobachtung weiter erfüllt.
>   - Dateien: `packages/replay-core/test/spread-inference.spec.ts`
> - ☐ **3.** Baue die Auffüllung um: sie füllt einen gemessenen Stat schrittweise gegen budget.perStat und behält den größten Betrag, bei dem observationError über alle Beobachtungen des Mons nicht steigt.
>   - Dateien: `packages/replay-core/src/spread-inference.ts`, `packages/replay-core/src/spreads/fit.ts`
> - ☐ **4.** Schicke die beiden Prior-mit-HP-Ausgänge durch dieselbe Auffüllung, damit ein Forfeit-Körper nicht mehr zuerst seine Offensive verliert.
>   - Dateien: `packages/replay-core/src/spread-inference.ts`, `packages/replay-core/src/spreads/ev-budget.ts`
> - ☐ **5.** Fahre die Set-Diffs auf allen drei Pfaden vor der Bank (nackt, Harness, Feedback) und prüfe, ob die 129 Bank-Replays überhaupt ein Set bewegen; ohne Bewegung misst die Bank blind.
>   - Dateien: `docs/perf/probes/2026-09-11-r41/sets-diff.spec.ts`, `docs/perf/probes/2026-09-11-r41/bank-sets.spec.ts`, `docs/perf/probes/2026-09-11-r41/feedback-sets.spec.ts`
> - ☐ **6.** Bump den Cache und registriere die Verdikt-Regel vor dem Lauf: hq-Tranche n=548, glücksbereinigte Zeile mitlesen, früher Brier als benannte Nebenfrage, weil Runde 40 dort 28 bp hq verlor.
>   - Dateien: `src/lib/eval-cache-store.ts`, `regression/eval-calibration.spec.ts`
> - ☐ **7.** Fahre die gepaarte Bank mit frischer Basis am selben Tag und werte nach dem Set-Diff getrennt aus, also bewegte gegen unbewegte Replays.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`, `docs/perf/probes/2026-09-12-r45/split-marker.mjs`
> - ☐ **8.** Schließe die Gates: drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, npm run test:regression, e2e, lint und npx tsc -b.
> - ☐ **9.** Lege die Kanal-Bewegungen der sechs Dumps und mögliche Re-Pins dem User vor.
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche mit mitgelesener glücksbereinigter Zeile, gepaarter Bank-Bench mit frischer Basis am selben Tag, drei byte-identische Feedback-Läufe, Re-Pins nur am User-Gate. Gemessen wird: Körper unter 300 EVs im Fit-Korpus fallen, der Fit-Fehler je Set steigt nirgends, die Bank ist in keiner Phase schlechter als die vorregistrierte Linie.
> 
> **Doubles und Singles.** Die Auffüllung liest budget.perStat und budget.total, deckt also auch das Champions-Budget 32/66 der VGC-Formate; die Schrittfolge wird relativ zum Budget gebildet, nicht mit festen 252ern. Der rote Test läuft in beiden Formaten wie spread-ladder-release.spec.ts, und der Set-Diff wird nach Spielart getrennt gezählt.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Wie fein darf die Auffüllung suchen? Jede Stufe kostet einen Kalk-Aufruf je Beobachtung, und der Fit läuft über 2122 Replays.
> - Darf ein gemessener Stat auch dann gefüllt werden, wenn die Sprosse ihn ausdrücklich als uninvestiert beansprucht hat, oder nur wenn keine Beobachtung dagegen spricht?
> - Soll Speed weiter gar nicht gefüllt werden? Heute nennt die Auffüllung nur offenseStat, hp, def und spd.
> 
> **Hintergrund**
> 
> - Mechanismus: solveOne baut die Menge measured aus hasOffenseEvidence (Offensiv-Stat), hasDefenderObs (hp, def, spd) und fixedHp (hp); topUpUnmeasured überspringt jeden Stat in measured und füllt nur offenseStat, hp, def, spd in dieser Reihenfolge, Speed nie.
> - Zahlen aus dem Runde-40-Bench: mittlere EV-Summe 409 auf 406, Körper unter 300 EVs 5918 auf 6151 (plus 233), 222 der 963 Starvations liegen in dieser Familie.
> - Beispiel aus den Runde-33-Beobachtungen: Kyurem 573756 stand unter dem gen8ubers-Set bei 0/0/0/0/0/216 (216 EVs), in Runde 40 bei Jolly 56/0/236/0/0/216 und seit Runde 41 bei Hardy 56/0/0/252/0/200, beide mit 508 EVs; der Fall selbst ist damit geschlossen, die Regel nicht.
> - Forfeit-Pfade: priorWithFixedHp legalisiert mit leerem kept, und die Kappreihenfolge in capToBudget nimmt atk und spa zuerst, daher 0 statt der 4 Atk der Prior-Sprosse (Runde-41-Beobachtung, Unterschied 4 EVs).
> - Schwellen: FIT_FORFEIT_PER_OBSERVATION 0,01, MIN_OBSERVATIONS 2, OBSERVATION_SLACK 0,02, SPEED_VIOLATION_PENALTY 1000.
> - Budget 252/508 in den meisten Formaten, 32/66 in Champions (evBudget prüft /champions/).
> - Die Bank hat die Runde-40-Kosten mitgemessen, die übernommenen Zahlen tragen sie also bereits.
> - Runde-40-Bank gepaart n=813: Vorzeichen 53/62/80 auf 53/62/79, Brier 0,2605/0,2293/0,1591 auf 0,2610/0,2301/0,1529; hq n=545 0,2569/0,2167/0,1708 auf 0,2597/0,2177/0,1624, also früh plus 28 bp und spät minus 84 bp; glücksbereinigt spät minus 45 bp.
> - Die frühe Spalte ist die offene Nebenfrage dieser Runde.
> - Bank-Stand nach Runde 45 (kein Ordner mehr, nur Zahlen): voll 0,2564/0,2242/0,1285, hq 0,2491/0,2031/0,1286, K gepoolt 2,19.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/replay-core/src/spread-inference.ts:114 topUpUnmeasured überspringt jeden Stat in measured und füllt nur offenseStat, hp, def, spd
> - packages/replay-core/src/spread-inference.ts:198 baut measured aus Angreifer-Linien, Verteidiger-Beobachtungen und der fixierten HP
> - packages/replay-core/src/spread-inference.ts:182 setzt bei zu wenig Beobachtungen priorWithFixedHp ohne jede Auffüllung
> - packages/replay-core/src/spread-inference.ts:195 setzt beim Forfeit ebenfalls priorWithFixedHp ohne Auffüllung
> - packages/replay-core/src/spread-inference.ts:73 priorWithFixedHp ruft capToBudget mit leerem kept
> - packages/replay-core/src/spreads/ev-budget.ts:36 kappt in der Reihenfolge atk, spa, def, spd, hp, also die Offensive zuerst
> - packages/replay-core/src/spreads/fit.ts:167 observationError liefert den quadratischen Abstand zur Rollspanne, abzüglich OBSERVATION_SLACK
> - regression/eval-calibration.spec.ts:1366 nennt Körper unter 300 EVs 5918 auf 6151 und die Auffüllung, die gemessene Stats auslässt
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 32 (3) Top-up unter fester HP; Zeile 34 (222 Summe unter 300); Zeile 162 Forfeit-Körper. Zusammengelegt, weil: Alle drei sitzen im selben Pfad: solveOne entscheidet über gemessene Stats und ruft danach topUpUnmeasured, und die beiden Forfeit-Ausgänge umgehen die Auffüllung ganz. Eine Ursache, eine Datei, eine Messung.

### T27 · Sensitivitäts-Etikett stabil machen

- Urteil: obsolet (Prüfer und Gegenprüfer einig)
- Szene: 648453 t13 im frischen Dump (tools/dump-turn.mjs 648453 13): Modus mcts, HP Ice ist inaccuracy (regret 0,10), graph.sensitivity null; dazu graph.sensitivity aller zehn Korpus-Spiele in neun Feedback-Läufen der heutigen Einstellung.
- Beleg: graph.sensitivity ab Zug 1 byte-gleich in 9 Läufen (docs/perf/probes/2026-10-02-r61/gate/feedback/t98b-1 bis -3, gateb-new-1 bis -3, final-1, final-2, docs/perf/probes/2026-10-04-r62/feedback/now) auf allen 10 Spielen; 9 Züge mit Etikett: Singles 648453 t35, 649664 t22, 655336 t4 und t12; Doubles 2663093831 t12, 2630685175 t4 und t7, 912045 t8 und t9. 648453 t13 trug schon in den Matrix-Läufen vor Runde 61 kein Etikett (gate/feedback/old-1 bis -3).
- Grund: Das Erfolgsmaß, dasselbe Etikett in fünf Läufen mit Byte-Vergleich von graph.sensitivity, ist mit neun Läufen in beiden Spielarten erfüllt, und die genannte Szene trägt kein Etikett mehr. Der Wettlauf steht noch im Code (src/hooks/useTeamSources.ts:155, packages/eval-engine/src/sensitivity.ts:60, turn-analysis/grading.ts:247), feuert aber in keinem Lauf; kommt er wieder, bekommt er eine neue Nummer.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T27 · Sensitivitäts-Etikett stabil machen** (Sets und Spreads, Mini-Runde, klein, verlustfrei D4)
> 
>   648453 Zug 13: Ein Lauf schreibt, das Urteil hänge an Landorus-Therians Choice Scarf, der nächste nennt Keldeos Choice Scarf. Die Zahlen darunter sind gleich (0,070 und 0,323). Die Sondenliste entsteht aus den gelösten Sets, und die landen asynchron aus dem Worker: Wer zuerst da ist, gibt dem Urteil den Namen. Gemessen in Runde 51 (T12): Die Sondenliste ändert sich zwischen dem Stand vor und nach der App-Lösung (648453: 6 auf 5 Ziele, Landorus-Therian fällt weg, sobald sein Schal inferiert ist; 573756: 2 auf 1; über die Bank-Replays 499 auf 491 in Singles, Doubles 338 auf 338). In welcher Reihenfolge der Worker die Lösungen liefert, hat noch niemand gemessen.
> 
>   *Erfolg:* Dasselbe Replay liefert in fünf Läufen dasselbe Etikett, der Byte-Vergleich läuft mit `graph.sensitivity`, kein gepinnter Kanal bewegt sich ungefragt. *Plan T27:* 7 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T27 · Sensitivitäts-Etikett stabil machen
> 
> *Sets und Spreads · Mini-Runde · klein · verlustfrei (D4)*
> 
> **Problem.** In 648453 Zug 13 schreibt die App einmal, das Urteil hänge an Landorus-Therians Choice Scarf, und im nächsten Lauf, es hänge an Keldeos Choice Scarf. Die Zahlen darunter sind in beiden Läufen gleich (0,070 und 0,323). Der User bekommt also zwei verschiedene Begründungen für dasselbe Urteil, und ein Byte-Gate an den Sensitivitätsdaten ist wertlos.
> 
> **Idee.** Die Sondenliste entsteht aus den gelösten Sets, und die Lösung landet asynchron aus dem Worker. Wer zuerst da ist, gibt dem Urteil den Namen. Wie beim Auszählen von Stimmen darf die Reihenfolge des Eintreffens das Ergebnis nicht bestimmen.
> 
> **Schritte**
> 
> - ☐ **1.** Schreibe einen roten Test, der selectProbeCombos mit zwei gleichwertigen Zielen in beiden Reihenfolgen aufruft und zeigt, dass die Kombos und damit das Etikett kippen.
>   - Dateien: `packages/eval-engine/test/eval-sensitivity.spec.ts`, `packages/eval-engine/src/sensitivity.ts`
> - ☐ **2.** Schreibe einen zweiten roten Test auf App-Ebene, der den Sweep einmal vor und einmal nach dem Eintreffen der gelösten Spreads laufen lässt und die verschiedenen Ziellisten zeigt.
>   - Dateien: `ui/hooks/useTeamKnowledge.spec.tsx`, `ui/hooks/useTeamSources.spec.tsx`
> - ☐ **3.** Sortiere die Ziele stabil (Art-Name) und lass den Gleichstand in der Freispruch-Wahl nach einer festen Regel entscheiden, statt nach Listenposition.
>   - Dateien: `src/lib/team-knowledge.ts`, `packages/eval-engine/src/turn-analysis/grading.ts`
> - ☐ **4.** Lass den Sweep auf die gelösten Spreads warten, so wie er heute schon auf die Smogon-Daten wartet, damit jeder Zug dieselbe Zielliste sieht.
>   - Dateien: `src/hooks/useTeamSources.ts`, `src/hooks/evaluation/sweep-verify.ts`
> - ☐ **5.** Prüfe, ob im Eval-Cache gespeicherte Sondenergebnisse aus alten Läufen die neue Auswahl überstimmen, und bump die Cache-Version, falls ja.
>   - Dateien: `src/hooks/evaluation/sweep-cached.ts`, `src/lib/eval-cache-store.ts`
> - ☐ **6.** Fahre drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1 und vergleiche diesmal MIT graph.sensitivity, dazu Regression, e2e, lint und tsc -b.
>   - Dateien: `e2e-feedback/feedback-drift.spec.ts`
> - ☐ **7.** Lege dem User jede bewegte Pin-Bewertung einzeln vor, falls ein Freispruch kippt.
>   - Dateien: `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Verlustfrei gemeint, aber mit Vorbehalt: die Sondenauswahl kann einen Freispruch kippen und damit ein Fehler-Tier bewegen. Also drei byte-identische Feedback-Läufe einschließlich graph.sensitivity, Kalibrierung ziffern-gleich, npm run test:regression, e2e, lint, tsc -b. Cache-Bump nur, wenn alte Sondenergebnisse im Eval-Cache die neue Auswahl überstimmen. Erfolg heißt: dasselbe Replay liefert in fünf Läufen dasselbe Etikett, und kein gepinnter Kanal bewegt sich; bewegt sich einer, entscheidet der User.
> 
> **Doubles und Singles.** Die Sonden laufen in beiden Formaten; der Test bekommt je eine Singles- und eine Doubles-Stellung, weil selectProbeCombos über die aktiven Pokémon der Gegenseite geht und Doubles zwei Aktive je Seite hat.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Soll der Sweep auf die Lösung warten (langsamer erster Zug) oder sollen die Ziele ohne Lösung gar nicht gesondert werden (weniger Freisprüche)?
> - Zählt ein gekipptes Fehler-Tier in 648453 t13 als Verbesserung oder als Regression? Der Zug ist ein offener Korpus-Gap (User-Lesart: HP Ice ist kein Fehler).
> 
> **Hintergrund**
> 
> - Befund aus Runde 37, 05.09.: 648453 t13 zeigt dieselben EVs 0,070 und 0,323 einmal als Landorus-Therian Choice Scarf und einmal als Keldeo Choice Scarf; derselbe Wettlauf steht auch in der Basis d8a2cb7, also nicht von Runde 37 verursacht.
> - Auch 655336 zeigte in einem Paar das andere Etikett.
> - Der Ledger der Runde 37 hält fest, dass Feedback-Lauf 7 byte-identisch zu Lauf 2 war, die Sensitivitätsdaten eingeschlossen, der Wettlauf also selten feuert.
> - Mechanik: die Sondenziele kommen aus statsP1Info/statsP2Info, die an solvedSpreads hängen; solvedSpreads wird im then der Worker-Promise gesetzt, der Sweep hält aber die Params-Closure des Starts. selectProbeCombos nimmt die ersten zwei beteiligten Ziele (slice(0,2)) und dreht danach im Round-Robin über deren Alternativen, Deckel 2 Kombos je Seite; die Freispruch-Wahl in grading.ts nimmt per reduce bei gleichem Rang das erste Ergebnis.
> - Ein inferiertes Scarf fällt ganz aus der Zielliste, ein abgelehntes Scarf wandert in die Ausschlussliste der Alternativen.
> - Betroffener Gap: 648453 t13 ist seit Runde 33 ein gap-Pin (HP Ice als Mistake 0,219 gegen Hurricane; User will p2-read ohne Fehler-Tier für p1).
> 
> **Code-Belege (Stand dcf9526)**
> 
> - src/hooks/useTeamSources.ts:154: solvedSpreads landet erst im then der Worker-Promise
> - src/hooks/useTeamKnowledge.ts:183: sensitivityTargetsFor liest statsP1Info, das an solvedSpreads hängt
> - src/hooks/evaluation/sweep-verify.ts:115: der Sweep zieht die Ziele je Zug aus den Params der laufenden Suche
> - packages/eval-engine/src/sensitivity.ts:60: slice(0,2) nimmt die ersten zwei beteiligten Ziele in Listenreihenfolge
> - packages/eval-engine/src/turn-analysis/grading.ts:244: reduce behält bei gleichem Rang das erste Sondenergebnis und dessen Art-Namen
> - src/hooks/evaluation/sweep-cached.ts:80: die Sondenergebnisse werden im Eval-Cache abgelegt
> - src/lib/eval-cache-store.ts:160: die Eval-Cache-Version steht auf 46
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 131.

### T30 · Tempo-Evidenz: Item-Zeitraum, Bremsen, Widerspruchs-Gate

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Bank-Stellung 939635 #10 (p1 Landorus) und 2663107495 #10 (p2 Gholdengo), Export Runde 61; Zugreihenfolgen des Parsers für 2663107495; Zählung der gestrichenen Reihenfolgen über die 129 Bank-Spiele.
- Beleg: 939635 p1 Landorus trägt heute Life Orb, kein Scarf. groups/spreads/speed-orders.mjs: p2 Gholdengo zieht in Zug 1 vor p1 Ogerpon-Wellspring und in Zug 6 vor Raging Bolt; die Reihenfolge in Zug 10 ist p2 Ogerpon vor p1 Gholdengo (Air Balloon), ein anderes Pokémon, also kein Widerspruch. groups/spreads/scarf-drops.mjs: dropScarfMovers streicht 13 von 1191 Reihenfolgen in 8 von 129 Spielen (Singles 12 von 922, Doubles 1 von 269).
- Grund: Beide Szenen lesen auf dem neuen Stand richtig: das falsche Scarf ist weg, und der Scarf-Gholdengo hat keine widersprüchliche Reihenfolge (sein Set mit Trick und Thunder Wave passt zum Scarf). Die Regeln erreichen 1 % der Bank-Reihenfolgen; Bremsen-Items und Quick Claw haben keine Szene. Der Umbau berührt speed-evidence.ts:85 und scarf.ts:129 nicht, und speed-evidence.ts:73 behält die Rennen vor einem verlorenen Scarf schon heute.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T30 · Tempo-Evidenz: Item-Zeitraum, Bremsen, Widerspruchs-Gate** (Sets und Spreads, Runde, groß, score-berührend D3, braucht T56)
> 
>   939635: Zapdos-Galar verliert sein Scarf durch Knock Off, und die Engine liest aus dem Rennen ein Scarf für Landorus heraus, das es nie gab. Der Parser wirft deshalb jedes Rennen weg, das ein Item-Wechsel berührt (260 Paare im Fit-Korpus). 2663107495: Gholdengo zieht in Zug 1 vor Ogerpon-Wellspring und in Zug 10 dahinter; die erste Beobachtung entscheidet, das Panel zeigt ein Scarf auf Hardy 60 Spe. Das Item wird ein Zustand mit Zeitraum, Brems-Items (Iron Ball, Lagging Tail, Macho Brace, Power-Items) bekommen ihre Spiegel-Regel, Quick Claw wird als Item gelesen, und bei Widerspruch enthält sich die Inferenz.
> 
>   *Erfolg:* Weniger weggeworfene Rennen als die heutigen 260 (Schwelle in der Spec vorregistrieren), 939635 Landorus verliert das falsche Scarf, 2663107495 Gholdengo bekommt keine Entscheidung, hq spät steht mindestens still; Handprüfung von je fünf Scarf-in- und Scarf-out-Zeilen gegen das Log. *Plan T30:* 9 Schritte, 3 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T30 · Tempo-Evidenz: Item-Zeitraum, Bremsen, Widerspruchs-Gate
> 
> *Sets und Spreads · Runde · groß · score-berührend (D3) · braucht T56*
> 
> **Problem.** In 939635 verliert Zapdos-Galar sein Scarf in derselben Runde durch Knock Off, und die Engine liest aus dem Rennen ein Scarf für Landorus heraus, das es nie gab. Heute wirft der Parser deshalb jedes Rennen weg, das ein Item-Wechsel berührt: 260 Paare im Fit-Korpus. In 2663107495 zieht Gholdengo in Zug 1 vor Ogerpon-Wellspring und in Zug 10 dahinter; die erste Beobachtung entscheidet, die zweite fällt unter den Tisch, und der Panel zeigt ein Scarf auf einem Hardy-Körper mit 60 Spe.
> 
> **Idee.** Das Item eines Pokémon ist kein fester Wert für das ganze Spiel, sondern ein Zustand mit Zeitraum. Wie beim Mietwagen zählt für jede Fahrt, wer an diesem Tag am Steuer saß; und wenn zwei Fahrtenbücher sich widersprechen, schreibt man keinen Halter fest.
> 
> **Schritte**
> 
> - ☐ **1.** Zähle zuerst, wie viele Rennen dropScarfMovers heute wegwirft und wie viele davon ein Zeitraum-Modell behielte, über das Bank-Universum vollständig und über den Fit-Korpus nur parser-seitig.
>   - Dateien: `packages/replay-core/src/protocol/speed-evidence.ts`, `docs/perf/probes/2026-09-11-r41/bank-ids.json`
> - ☐ **2.** Schreibe den roten Test für Regel 1: ein Log, in dem ein Scarf per Knock Off fällt, behält das Rennen VOR dem Wechsel und verliert nur die danach.
>   - Dateien: `packages/replay-core/test/protocol-parser.spec.ts`
> - ☐ **3.** Gib den schon vorhandenen Zeitraum aus scarfChange als Item-Zustand je Zug an die Reihenfolge weiter und lass decideScarfs gegen den Zustand dieses Zugs entscheiden, statt das Rennen zu streichen.
>   - Dateien: `packages/replay-core/src/protocol/speed-evidence.ts`, `packages/replay-core/src/protocol/parser-state.ts`, `packages/replay-core/src/types.ts`, `packages/replay-core/src/spreads/scarf.ts`
> - ☐ **4.** Baue Regel 2 als Spiegel der Scarf-Regel: ein Pokémon, das langsamer zieht als jede plausible Aufstellung erlaubt, kann Iron Ball, Lagging Tail, Macho Brace oder ein Power-Item tragen.
>   - Dateien: `packages/replay-core/src/spreads/scarf.ts`, `packages/eval-engine/src/speed.ts`
> - ☐ **5.** Baue Regel 3: lies Quick Claw aus der Aktivierungszeile als verratenes Item in den Inferrer, denn Custap kommt über die enditem-Zeile schon an und Quick Claw fällt heute nur als Verunreinigung weg.
>   - Dateien: `packages/replay-core/src/inference/handlers.ts`, `packages/replay-core/src/protocol/speed-evidence.ts`
> - ☐ **6.** Baue Regel 4 als Widerspruchs-Gate: sammle alle Entscheidungen je Pokémon und enthalte dich, sobald zwei Rennen sich widersprechen, statt die erste Entscheidung stehen zu lassen.
>   - Dateien: `packages/replay-core/src/spreads/scarf.ts`, `regression/scarf-inference.spec.ts`
> - ☐ **7.** Zähle je Regel einzeln den Set-Diff auf allen drei Pfaden (nackt, Harness, Feedback), bevor irgendeine Bank läuft, sonst misst man eine blinde Bank.
>   - Dateien: `docs/perf/probes/2026-09-11-r41/feedback-sets.spec.ts`, `docs/perf/probes/2026-09-12-r45/bank-sets.vt.ts`
> - ☐ **8.** Fahre die gepaarte Bank je Regel als eigenen Branch, mit frischer Basis am selben Tag, vorregistrierter Regel auf der hq-Tranche und mitgelesener glücksbereinigter Zeile.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`
> - ☐ **9.** Bump die Cache-Version, fahre drei byte-identische Feedback-Läufe, prüfe die Golden 655336 einzeln und lege jede bewegte Pin-Bewertung dem User vor.
>   - Dateien: `src/lib/eval-cache-store.ts`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Score-berührend: Cache-Bump, vorregistrierte Verdikt-Regel auf der hq-Tranche mit glücksbereinigter Zeile, gepaarter Bank-Bench je Regel mit frischer Basis am selben Tag, drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, Re-Pins nur am User-Gate. Zusätzliche Bedingung aus Runde 37: die Handprüfung von mindestens fünf Scarf-in- und fünf Scarf-out-Zeilen gegen das Log, denn eine Bank-Verbesserung mit falschen Items ist kein Erfolg. Erfolg heißt: die Zahl der weggeworfenen Rennen sinkt deutlich unter 260, 939635 Landorus verliert sein falsches Scarf, 2663107495 Gholdengo bekommt keine Entscheidung mehr, und die hq-spät-Linie steht mindestens still.
> 
> **Doubles und Singles.** Zugreihenfolgen liest der Parser seit a9c3295 in Doubles wie in Singles (bis zu vier Ziehende je Zug, jedes Paar über die Seitengrenze ist ein Rennen). Jede der vier Regeln bekommt deshalb zwei Tests: ein Singles-Log und ein Doubles-Log mit vier Ziehenden, in dem der Item-Wechsel nur eines der Paare vergiftet. Die Zählungen und der Set-Diff werden nach Format getrennt ausgewiesen.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Soll ein Rennen nach einem Item-Wechsel als Evidenz für das NEUE Item zählen (der Dieb trägt jetzt das Scarf) oder nur die Rennen davor behalten?
> - Wie weit soll das Widerspruchs-Gate gehen: Enthaltung für das Pokémon (sicher, verliert Wahrheit) oder Mehrheitsentscheid über die Rennen (mutiger, kann kippen)?
> - Sollen die Bremsen-Items eine eigene Runde bekommen, falls der Set-Diff der Regeln 1 und 4 schon groß ausfällt?
> 
> **Hintergrund**
> 
> - Zahlen aus dem Ledger der Runde 37 (Fit-Korpus 2128 Replays, Basis gegen r37): Singles-Reihenfolgen 20233 auf 19606, davon 792 gestrichen (Wetter-Fähigkeit 205, Prankster 102, Unburden 71, Gale Wings 43, Grassy Glide 39, Triage 25, Custap 19, Pursuit auf wechselndes Ziel 13, Stall und Mycelium Might 6, Surge Surfer 4, Quick Claw 2, Magic-Bounce-Kopien 2, eine kopierte Chlorophyll 1, Rennen nach einem Scarf-Wechsel 260), dazu 165 gewonnene Sleep-Talk-Paare; Doubles 0 auf 3794 in 626 Replays.
> - Die Falsch-Reihenfolgen der Design-Sonde fielen von 178 auf 10, und diese zehn sind Grobheit der Sonde selbst.
> - Handprüfung: acht von neun Scarf-in plausibel (573756 Magnezone, Kyurem vor Zamazenta, Gholdengo vor Darkrai, Iron Moth und Ogerpon-Wellspring, Glimmora KOt Dragapult vor dessen Zug, Typhlosion-Hisui vor Ogerpon-Wellspring), eine falsch (939635 Landorus, weil Zapdos-Galar sein Scarf in derselben Runde per Knock Off verlor, daraus entstand die Wechsel-Regel); beide Scarf-out richtig (912047 Chi-Yu, 914633 Landorus-Therian in Doubles). 2663107495 Gholdengo behält bei widersprüchlicher Evidenz ein Scarf auf Hardy 60 Spe.
> - Die Golden 655336 reagiert empfindlich: Latias trickt sein Scarf an Bisharp, die Wechsel-Regel streicht t5, Latias wird Timid 248 HP statt Hardy 248 Atk, Bisharp Adamant, und acht Drift-Kanäle wechseln die Form (t26 Key Moment als p1-read statt p2-decision, t27 shift weg, extra read 26:p1).
> - Heutige Mechanik: der Parser merkt sich je Pokémon einen vergifteten Zeitraum (entferntes Scarf ab diesem Zug, ankommendes Scarf bis zu diesem Zug, verschenktes Scarf das ganze Spiel und in beiden Rollen) und streicht danach jedes Rennen in diesem Zeitraum; SpeedOrderObservation trägt den Zug bereits.
> - Der Scarf-Faktor 1,5 ist der einzige Item-Faktor der Solver-Seite; die Engine kennt zusätzlich Iron Ball mit 0,5 und nennt Lagging Tail im Kommentar ausdrücklich als nicht modelliert.
> - Verworfen in Runde 37: keine Varianten in diesem Bereich.
> - Spec docs/superpowers/specs/2026-09-05-round-37-design.md, Plan 2026-09-05-round-37-plan.md.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/replay-core/src/protocol/speed-evidence.ts:85: dropScarfMovers wirft jedes Rennen im vergifteten Zeitraum weg
> - packages/replay-core/src/protocol/speed-evidence.ts:71: scarfChange kennt den Zeitraum schon, gibt ihn aber nur zum Streichen weiter
> - packages/replay-core/src/protocol/speed-evidence.ts:51: Quick Claw und Custap verunreinigen den Ziehenden, verraten aber kein Item
> - packages/replay-core/src/inference/handlers.ts:224: recordItem liest nur |-item|-Zeilen, die Quick-Claw-Aktivierung erreicht den Inferrer nie
> - packages/replay-core/src/spreads/scarf.ts:39: SCARF_FACTOR 1,5 ist der einzige Item-Faktor der Tempo-Regel
> - packages/replay-core/src/spreads/scarf.ts:136: die erste Entscheidung je Pokémon steht, spätere Widersprüche fallen weg
> - packages/replay-core/src/types.ts:107: SpeedOrderObservation trägt schon den Zug, an dem das Rennen stattfand
> - packages/eval-engine/src/speed.ts:30: Iron Ball halbiert das Tempo, Lagging Tail steht im Kommentar als bewusst ungemodellt
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 31 (3); Zeile 31 (4); Zeile 31 (7). Zusammengelegt, weil: Alle drei Punkte hängen an derselben Kette: die Zugreihenfolgen aus dem Protokoll gehen in decideScarfs und entscheiden dort über ein Item. Wer den Item-Zeitraum einführt, fasst dieselben Zeilen an wie die Bremsen-Regel und das Widerspruchs-Gate, und alle drei bewegen dieselben Sets. Getrennt gebaut zahlt man dreimal Bank und Feedback.

### T32 · Band und Specs aus Schaden lesen

- Urteil: verwerfen (nach Ruling)
- Szene: Alle 1777 nicht tödlichen Singles-Treffer der 83 Singles-Bank-Spiele, geprüft mit observationError gegen die fertigen Sets der Runde 61 (TODO hatte keine eigene Szene).
- Beleg: groups/spreads/item-axis.json (106 zu harte Treffer, meist Fähigkeiten); groups/spreads/census.json (17 Boost-Item-Körper mit 0 Offensive).
- Grund: Die harte Richtung (zu harter Treffer wird Band) fällt: Ihre Ursachen sind Lücken im Fit-Feld (Supreme Overlord, Booster Energy, Body Press, Status, Tera), die T86 trägt. Die weiche Richtung (geratenes Boost-Item weicht) ist aufgegangen in T26. Die Doubles-Schadens-Widersprüche aus T80 gehören zu T31.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T32 · Band und Specs aus Schaden lesen** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T31)
> 
>   Die Schadens-Leiter kann kein Choice Band und keine Choice Specs erkennen, weil das Item fest am gebauten Set hängt. Trifft ein Angriff härter, als jeder EV-Körper erklärt, ist das Item die Erklärung. Die Leiter bekommt eine Item-Achse (Band, Specs, Life Orb, kein Item).
> 
>   *Erfolg:* Die Leiter erklärt zu harte Treffer mit einem Item statt mit einem verbogenen Körper, die Handprüfung bestätigt die Items, die Bank steht mindestens still. *Plan T32:* 6 Schritte.

**Alter Abschnitt im Backlog-Plan:**

> ### T32 · Band und Specs aus Schaden lesen
> 
> *Sets und Spreads · Runde · mittel · score-berührend (D3) · braucht T31*
> 
> **Problem.** Die Leiter des Spread-Fitters kennt Sprossen für Offensive, Bulk und Tempo, aber keine für das Item: Sie rechnet jede Sprosse mit dem Item des gebauten Sets. Ein Treffer, der für jeden EV-Körper zu hart ist, verbiegt deshalb den Körper (volle Offensive, falsche Natur), statt ein Choice Band oder Choice Specs zu verraten. Rest (6) der Runde 37.
> 
> **Idee.** Wenn ein Läufer schneller ist, als sein Training erklärt, prüft man die Schuhe. Die Leiter bekommt eine Item-Achse, und die Sprosse trägt ihr Item in die Schadensrechnung.
> 
> **Schritte**
> 
> - ☐ **1.** Zähle über das Bank-Universum, wie viele Beobachtungen kein EV-Körper erklärt und ein Boost-Item erklären würde, getrennt nach Singles und Doubles.
>   - Dateien: `packages/replay-core/src/spreads/fit.ts`, `docs/perf/probes/<datum>-item-axis/ (NEU)`
> - ☐ **2.** Schreibe den roten Test: Ein Treffer, den kein EV-Körper erklärt, den ein Choice Band aber trifft, muss die Band-Sprosse gewinnen; je ein Singles- und ein Doubles-Fall.
>   - Dateien: `packages/replay-core/test/`
> - ☐ **3.** Gib der Leiter eine Item-Achse (Band, Specs, Life Orb, kein Item) und lass die Sprosse ihr Item in die Berechnung tragen, statt das Item des Baus zu nehmen.
>   - Dateien: `packages/replay-core/src/spreads/ladder.ts`, `packages/replay-core/src/spreads/fit.ts`
> - ☐ **4.** Nimm die vorhandene Schadens-Prüfung der Choice-Items (`corroborateChoiceItem`) als Vorbild für Slack und KO-Untergrenze, damit Solver und Lock-Prüfung dieselbe Regel nutzen.
>   - Dateien: `packages/eval-engine/src/choice-lock.ts`
> - ☐ **5.** Zähle den Set-Diff auf allen drei Pfaden und prüfe fünf Band- oder Specs-Entscheidungen von Hand gegen das Log.
>   - Dateien: `docs/perf/probes/2026-09-11-r41/sets-diff.spec.ts`
> - ☐ **6.** Bump den Cache, fahre die gepaarte Bank mit frischer Basis und hq-Tranche, drei byte-identische Feedback-Läufe und hole das User-Gate für bewegte Pins.
>   - Dateien: `src/lib/eval-cache-store.ts`, `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`
> 
> **Gate und Erfolg.** Score-berührend (D3). Zusätzlich die Handprüfung von fünf Item-Entscheidungen gegen das Log: Eine Bank-Verbesserung mit falschen Items ist kein Erfolg (Lehre Runde 37).
> 
> **Doubles und Singles.** Die Item-Achse wirkt in beiden Formaten; sie bekommt je einen Singles- und einen Doubles-Test und eine getrennte Bank-Zeile. In Doubles greift sie erst, wenn T31 dort Beobachtungen liefert.
> 
> **Hintergrund**
> 
> - Herkunft: Rest (6) der Runde 37 („Band/Specs aus Schaden“).
> - Der Planer des Item-Clusters hat die Item-Achse zusammen mit dem Doubles-Gate geplant (Hintergrund dort, T31).
> - Getrennt geführt, damit die Bank-Zuordnung sauber bleibt: erst das Doubles-Gate, dann die Item-Achse.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/replay-core/src/spreads/ladder.ts:50: Sprossen gibt es für Offensive, Bulk und Tempo, keine für Items
> - packages/replay-core/src/spreads/fit.ts:130: die Sprosse rechnet mit dem Item des gebauten Sets
> - packages/replay-core/src/spreads/fit.ts:167: observationError misst die Sprosse an der Rollspanne
> - packages/eval-engine/src/choice-lock.ts:158: corroborateChoiceItem prüft eine Item-Hypothese schon gegen den beobachteten Schaden
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 31 (6).

### T63 · Auffüllen nach der gesehenen Angriffsseite

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Sets der 129 Bank-Spiele (Export Runde 61) gegen die im Log gesehenen Züge, strenge Zählung ohne Pivot-, Prioritäts- und Festschaden-Züge (TODO hatte keine eigene Szene).
- Beleg: groups/spreads/census.mjs: 14 von 861 Singles-Sets mit gesehenen Zügen bekommen einen Füller der anderen Angriffsseite, 0 von 451 Doubles-Sets; 6 davon Iron Valiant mit Moonblast und Close Combat, 2 Deoxys-Speed mit Superpower und Psycho Boost, also echte gemischte Sets. packages/replay-core/src/team/set-resolvers.ts:16 USAGE_MOVE_POOL = 10 unverändert.
- Grund: Die Regel träfe höchstens 8 Bank-Sets mit echtem Fehler, unter 1 % der Sets, und ein schwacher Füller ist im Baum nur eine schwache Option mehr. Das Beispiel Clefable mit Knock Off und Moonblast ist das übliche Set. Der Umbau ändert den Zug-Auffüller nicht; Runde 60 hat dort nur Fähigkeiten geändert.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T63 · Auffüllen nach der gesehenen Angriffsseite** (Sets und Spreads, Mini-Runde, klein, score-berührend D3, braucht T56)
> 
>   GPL DzBQ5azlO5l: Clefable zeigt Moonblast und bekommt Knock Off aufgefüllt, Iron Valiant zeigt Knock Off und bekommt Moonblast. In Doubles sieht Landorus-Therian U-turn und Rock Slide und bekommt Tera Blast. `assembleMoves` füllt aus den zehn meistgenutzten Zügen (`team/set-resolvers.ts:16`), ohne auf die gesehene Angriffsseite zu achten: 3 von 18 Singles-Sets und 3 von 37 Doubles-Sets mit eindeutig physischer oder spezieller Spur bekommen einen Füller der Gegenseite.
> 
>   Hinweis: Cobalion aus T10 ist kein Fall davon. Seine Füller sind Status-Züge (Stealth Rock 96,5 %, Taunt 65,3 % in gen9ou; Custom Game fällt auf gen9ou zurück), und die Regel würde dort Body Press und Iron Head bauen. Stone Edge steht mit 0,35 % auf Rang 19; dass er fehlt, ist eine Grenze der Rekonstruktion. Die Evidenz ist dünn (sechs Sets, keine Bank-Zahl): erst Set-Diffs auf allen Pfaden (D8), dann entscheiden, ob sich eine Runde lohnt.
> 
>   *Erfolg:* Die Zählung über Bank und Fit-Korpus sagt, wie viele Sets die Regel bewegt; bewegt sie genug, steht die Bank nach dem Umbau mindestens still. *Plan T63:* 5 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T63 · Auffüllen nach der gesehenen Angriffsseite
> 
> *Sets und Spreads · Mini-Runde · klein · score-berührend D3 · braucht T56*
> 
> **Schritte**
> 
> - ☐ **1.** Zählung über Bank und Fit-Korpus: Sets mit eindeutig physischer oder spezieller Spur, die einen Füller der Gegenseite bekommen (Vorlage `docs/perf/probes/2026-09-19-r51/T10/resolve-fillcheck*`; der Platzhalter `Tackle` zählt nicht als gesehen).
> - ☐ **2.** Entscheiden, ob die Menge eine Runde trägt (Vorlage: 3 von 18 Singles, 3 von 37 Doubles).
> - ☐ **3.** Roter Test in `team/set-resolvers.ts`: Züge der gesehenen Kategorie rücken aus der vollen Nutzungsliste vor den Zehner-Deckel (`USAGE_MOVE_POOL`).
> - ☐ **4.** Set-Diffs auf den Bau-Wegen (D8).
> - ☐ **5.** Gate D3.
> 
> **Offene Entscheidungen**
> 
> - Vorziehen aus der vollen Liste oder nur den Deckel anheben?
> - Gilt die Regel auch für gemischte Spuren (ein physischer, ein spezieller Zug)?
> 
> **Herkunft.** Sichtung T10, Runde 51. Cobalion selbst ist kein Fall (Füller sind Status-Züge, die Regel baute Body Press und Iron Head).

### T36 · Scan-Wertung behalten, schwer zu findende Züge kreditieren

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 40 exportierte Bank-Stellungen (24 Singles, 16 Doubles), Probe groups/bericht/scan-vs-tree.json; Draft-Spiel gen9draft-2058494320 t24/t50/t63 liegt weder im Korpus noch auf der Bank
- Beleg: scan-vs-tree.json: beste Zeile der Skizze ungleich der des Baums auf 31 von 48 Singles-Seiten und 18 von 32 Doubles-Seiten; die Baum-Wahl ist in der Skizze mindestens eine Ungenauigkeit auf 2 von 48 und 6 von 32 Seiten. Skizze = Matrix Tiefe 1 (graph-sweep.ts:291), Endlauf ab Zug 1 der Baum (prefs.ts:73, budget.ts:26 mit treeFrom 0).
- Grund: Der Hebel ist mit dem Umbau weg: Skizze und Endlauf sind nicht mehr erster und zweiter Blick derselben Engine, sondern zwei Engines, die auf mehr als der Hälfte der Seiten eine andere beste Zeile nennen. Das geplante Signal misst diesen Unterschied, nicht die Schwierigkeit. Die Motiv-Szene liegt außerhalb des Korpus, der Grind-Faktor feuert dort laut Runde 36 gar nicht; kein Pin, kein Bank-Hebel. T41 nennt die Skizze als Prior-Quelle, das ist keine harte Abhängigkeit, weil Skizze und Endlauf schon unter getrennten Speicher-Schlüsseln liegen.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T36 · Scan-Wertung behalten, schwer zu findende Züge kreditieren** (Bericht, Runde, mittel, verlustfrei D4)
> 
>   Draft-Spiel: Bene schaltet Heatran immer wieder vor Kyurem, und genau das nennt der User die schweren, richtigen Züge (t24, t50, t63). Die Engine sieht davon nichts: überall 6 bis 10 brauchbare Optionen, der Grind-Reiter hat zwei Beine (genau eine haltende Linie bei mindestens vier Optionen, oder ein Zug, den die Tiefe-plus-1-Verifikation freispricht), und keines greift hier. Der Sweep läuft erst schnell, dann tief, und wirft die schnelle Wertung weg. Wir behalten sie und kreditieren Züge, bei denen erst das tiefe Rechnen den gespielten Klick rechtfertigt.
> 
>   Hinweis: Der User hat die Conversion-Satz-Erweiterung (Entry-Züge benennen) bewusst nicht gewollt. Die behaltene Scan-Wertung ist zugleich der billigste Weg zum Wurzel-Prior (T41).
> 
>   *Erfolg:* Der Grind-Satz im Draft-Spiel nennt mindestens einen der Heatran-Züge t24, t50 oder t63, kein Korpus-Pin bewegt sich, die Sweep-Wanduhr verschlechtert sich nicht messbar. *Plan T36:* 9 Schritte, 4 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T36 · Scan-Wertung behalten, schwer zu findende Züge kreditieren
> 
> *Bericht · Runde · mittel · verlustfrei (D4)*
> 
> **Problem.** Im Draft-Spiel schaltet Bene seinen Heatran immer wieder vor Kyurem, und der User nennt genau das die schweren, richtigen Züge. Die Engine sieht davon nichts: t50 liest Regret 0,0033 gegen Recover, t24 eine Ungenauigkeit von 0,15 gegen die Pivot-Linie und t63 Regret 0,07, und überall stehen 6 bis 10 brauchbare Optionen nebeneinander. Der Reiter des Grind-Satzes zählt aber nur Züge, bei denen genau eine Linie hält, also feuert er nie. Der Bericht lobt am Ende den Grind, ohne sagen zu können, was daran schwer war.
> 
> **Idee.** Der Sweep läuft heute zweimal über jeden Zug, erst schnell und dann tief, und wirft die schnelle Wertung weg. Wir behalten sie, wie man den ersten Eindruck notiert, bevor man lange nachdenkt, und kreditieren die Züge, bei denen das lange Nachdenken einen Klick rechtfertigt, den der erste Eindruck nicht bevorzugt hatte.
> 
> **Hinweis.** Der User hat die Conversion-Satz-Erweiterung (Entry-Züge benennen) bewusst nicht gewollt. Die behaltene Scan-Wertung ist zugleich der billigste Weg zum Wurzel-Prior (T41).
> 
> **Schritte**
> 
> - ☐ **1.** Miss zuerst, wie oft Scan und Endlauf überhaupt auseinanderlaufen: lies für das Draft-Replay und ein Doubles-Replay je Zug die gespeicherte Schnell-Bewertung (Schlüssel d1s1 matrix) gegen die Endbewertung aus dem Eval-Speicher und zähle die Züge, bei denen die beste Zeile wechselt.
>   - Dateien: `src/lib/eval-cache-store.ts`, `src/hooks/evaluation/sweep-core.ts`, `e2e/fixtures/draft-replay.json`, `docs/perf/probes/<neu>/scan-diff.mjs (NEU)`
> - ☐ **2.** Kläre an derselben Zählung, wie viele Züge der Endlauf unter der Vorgabe auto wirklich vertieft: in der Eröffnung fahren beide Pässe d1s1 matrix und unterscheiden sich nur im Beweiser, erst ab einem Viertel gefallener Körper wechselt der Endlauf auf den Baum.
>   - Dateien: `src/hooks/evaluation/prefs.ts`, `src/hooks/evaluation/graph-sweep.ts`
> - ☐ **3.** Schreibe den roten Test: ein Zug mit Scan-Favorit A, End-Favorit B und gespieltem B trägt das neue Signal, ein Zug mit gleichem Favoriten auf beiden Seiten trägt es nicht.
>   - Dateien: `packages/eval-engine/test/win-reason.spec.ts`, `packages/eval-engine/test/eval-analysis.spec.ts`
> - ☐ **4.** Hänge ein Scan-Feld an die Sweep-Arrays, das der Vertiefungspass nicht überschreibt, und fülle es im ersten Pass mit den Zeilen-Werten beider Seiten.
>   - Dateien: `src/hooks/evaluation/graph-sweep.ts`, `src/hooks/evaluation/sweep-core.ts`
> - ☐ **5.** Reiche das Feld über den Analyse-Kontext in analyzeTurn und setze je Seite ein Signal, wenn der Endlauf den gespielten Klick mit Regret nahe null trägt und der Scan ihn nicht bevorzugt hatte.
>   - Dateien: `src/lib/analysis-context.ts`, `packages/eval-engine/src/turn-analysis/signals.ts`, `packages/eval-engine/src/turn-analysis/types.ts`
> - ☐ **6.** Erweitere den Reiter des Grind-Satzes um dieses Signal neben den beiden vorhandenen Beinen und kläre mit dem User, ob der Kredit das Grind-Fenster verlassen darf, weil t50 und t63 hinter der Favor-Grenze t47 liegen.
>   - Dateien: `packages/eval-engine/src/win-reason.ts`
> - ☐ **7.** Miss die Kosten auf leerer Maschine gegen eine Basis desselben Tages: der Sweep hält je Zug zwei Zeilenlisten mehr, also prüfe Speicher und Wanduhr des ganzen Laufs, bevor eine Kosten-Zeile in den Ledger geht.
>   - Dateien: `src/hooks/evaluation/graph-sweep.ts`, `regression/eval-calibration.spec.ts`
> - ☐ **8.** Fahre die Gates und prüfe, dass der neue Satz im Draft-Spiel steht und in den sechs Korpus-Spielen keinen Pin bewegt.
>   - Dateien: `e2e-feedback/corpus.ts`, `e2e-feedback/feedback-drift.spec.ts`
> - ☐ **9.** Hole das User-Gate für den Reiter-Text und für jeden Pin, den das neue Signal bewegt hat.
>   - Dateien: `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Die Bewertung selbst bleibt unberührt, die Runde ist verlustfrei bis auf den neuen Satz: drei byte-identische Feedback-Läufe mit FEEDBACK_DUMP=1, Kalibrierung ziffern-gleich, npm run test:regression, e2e, npm run lint, npx tsc -b. Erfolg heißt: der Grind-Satz im Draft-Spiel nennt mindestens einen der drei Heatran-Züge t24, t50 oder t63, kein Korpus-Pin bewegt sich, die Golden-Felder von 655336 stehen, und die Sweep-Wanduhr verschlechtert sich nicht messbar (verschränkt gemessen, gleiche Maschine, gleicher Tag).
> 
> **Doubles und Singles.** Die Retention hängt am Sweep und nicht an der Spielform, also bekommen Doubles und Singles dieselben Scan-Werte. Die Zählung in Schritt 1 läuft auf dem Singles-Draft-Replay und auf einem Doubles-Replay (e2e/fixtures/vgc-replay.ts oder e2e/fixtures/doubles-replay.ts; die GPL-Fixture ist Singles), und der rote Test in Schritt 3 deckt beide Seiten einer Doubles-Zuweisung ab, weil das Signal je Seite gesetzt wird.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Darf der Kredit das Grind-Fenster verlassen, weil t50 und t63 hinter der Favor-Grenze t47 liegen, und wenn ja: eigener Satz im Bericht oder eigenes Feld?
> - Was heißt 'der Scan war uneins': eine andere beste Zeile, oder ein Abstand über einer Ungenauigkeit?
> - Reicht der Wechsel von Matrix auf Baum als Vertiefung, oder braucht die Runde für Eröffnungszüge einen eigenen Scan mit fester Einstellung, weil auto dort in beiden Pässen dasselbe rechnet?
> - Wird die Scan-Wertung nur im Speicher gehalten oder auch im IndexedDB abgelegt (Kosten je Replay)?
> 
> **Hintergrund**
> 
> - Motivfall Draft-Spiel gen9draft-2058494320, am 05.09. nachmittags am echten App-Pfad nachgemessen: t24 liest eine Ungenauigkeit von 0,15 gegen die Pivot-Linie 'Chilly Reception -> Dragapult', t50 Regret 0,0033 gegen Recover (das ist der T50-Pin, ein totes Patt, das erst die Trend-Schichten trennen), t63 Regret 0,07 gegen den Wechsel auf Muk-Alola; überall 6 bis 10 brauchbare Optionen.
> - Favor-Grenze des Spiels ist t47, also liegen t50 und t63 hinter dem Grind-Fenster (GRIND_WINDOW 12 Züge davor, GRIND_MIN_TURNS 8).
> - Runde 36 hat außerdem gemessen: Sieger-Gesamtregret 1,35 gegen Verlierer 0,85, Accuracy 96,2 gegen 96,7, der Grind-Faktor feuert am Draft-Spiel nicht.
> - Sweep-Aufbau: drei Pässe, Pass 1 als Skizze mit depth 1, samples 1, mode matrix und abgeschaltetem Beweiser, Pass 2 die Schlüsselzüge (KEY_TURN_SWING 0,25, Deckel 16), Pass 3 der Rest; kurze Bereiche gehen in einem Pass.
> - Wichtige Einschränkung, die im alten Text fehlt: unter der Vorgabe auto (der Feedback-Harness fährt depth 2, samples 3, mode auto) löst die Eröffnung ebenfalls auf d1s1 matrix auf, erst ab AUTO_MCTS_FAINTED_FRACTION 0,25 wechselt der Endlauf auf d1s1 MCTS. Für Baum-Züge liegen Skizze und Endlauf darum schon heute unter verschiedenen Speicher-Schlüsseln nebeneinander im IndexedDB (v46|<replay>:<turn>|d1s1mmatrix gegen d1s1mmcts), für Matrix-Züge überschreibt der Endlauf denselben Schlüssel.
> - Der Reiter hat heute zwei Beine: viableCount 1 bei Breite ab 4, und ein von der Tiefe-plus-1-Verifikation freigesprochener Zug.
> - Verwandt mit der Options- und Varianzwert-Agenda (Q5), aber billiger; die Conversion-Satz-Erweiterung hat der User am 05.09. 15:32 abgelehnt.
> - Skripte und Zahlen der Runde 36 stehen in docs/completed/eval-quality.md, Abschnitt Runde 36.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - src/hooks/evaluation/sweep-core.ts:149 schreibt data.results[turn-1] = result, der Vertiefungspass überschreibt also die Skizze
> - src/hooks/evaluation/graph-sweep.ts:291 definiert die Skizze als depth 1, samples 1, mode matrix, prove false
> - src/hooks/evaluation/graph-sweep.ts:294-300 führt die drei Pässe aus
> - src/hooks/evaluation/prefs.ts:72-76 löst auto auf d1s1 matrix oder d1s1 mcts auf, packages/eval-engine/src/types.ts:51 setzt die Schwelle auf 0,25
> - src/lib/eval-cache-store.ts:160 und :169 zeigen Cache v46 und den Aufbau des Speicher-Schlüssels mit Tiefe, Stichproben und Modus
> - packages/eval-engine/src/win-reason.ts:192-195 narrowTurn zählt nur viableCount 1 oder verifiedAtDepth
> - packages/eval-engine/src/win-reason.ts:241-253 baut den Grind-Satz samt Reiter 'kept finding the right play where it was hard to spot'
> - packages/eval-engine/src/win-reason.ts:220-223 begrenzt den Grind auf das Fenster von 12 Zügen vor der Favor-Grenze
> - packages/eval-engine/src/turn-analysis/grading.ts:59-77 zeigt, woher verifiedAtDepth kommt: nur ein Freispruch, nie eine Verschärfung
> - src/lib/analysis-context.ts:42-63 ist die eine Stelle, an der ein neues Feld in analyzeTurn hineinkommt
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 30; Zeile 99 (Grind-Faktor ohne hard-to-spot-Träger). Zusammengelegt, weil: Beide Punkte sind derselbe Befund aus Runde 36: der Grind-Reiter findet am Draft-Spiel keinen Träger, weil sein Detektor Breite misst und die Schwierigkeit in der Tiefe liegt. Zeile 99 ist die Beobachtung, Zeile 30 der ausformulierte Kandidat dazu.

### T44 · Prinzipien als eigene Bausteine im Bericht

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 562428 t10, 648453 t13, alle Karten und Berichte der zehn Dumps (groups/bericht/summaries.json)
- Beleg: summaries.json: 'has no live answer' auf 26 Zügen, 'genuinely open turn' auf 9, Halter-Satz auf 10; kein Prinzip im Spielbericht. 562428 t10 hat den Breiten-Satz verloren (Drift seit Runde 61), 648453 t13 trägt wieder 'Lopunny-Mega has no live answer'.
- Grund: Eine Idee aus dem Ideen-Parkplatz ohne Erfolgsmaß, ohne Wunsch-Szene und ohne Bau-Gate. Die Zug-Prinzipien sprechen schon auf vielen Karten; ein Bericht-Baustein hat keinen Pin und keinen Bank-Hebel, und seine Träger sind wackelig. Kommt der Wunsch wieder, bekommt er eine neue Nummer mit Mustern und Erfolgsmaß.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T44 · Prinzipien als eigene Bausteine im Bericht** (Bericht, Geparkt, klein, braucht T18)
> 
>   Die Zug-Karte nennt an einzelnen Zügen, welches Prinzip greift (562428 t10 echte Breite, 648453 t13 keine lebende Antwort). Im Spielbericht taucht davon nichts auf. Wartet auf T18, weil es dieselben Sätze anfasst; vor dem ersten Code zwei oder drei Formulierungs-Muster am User-Gate.
> 
>   *Plan T44:* 4 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T44 · Prinzipien als eigene Bausteine im Bericht
> 
> *Bericht · Geparkt · klein · braucht T18*
> 
> **Problem.** Der Bericht sagt heute an einzelnen Zügen, welches Prinzip greift: in 562428 t10 nennt er die echte Breite des Zuges, in 648453 t13 sagt er, dass ein Mon keine lebende Antwort mehr hat. Im Spielbericht selbst taucht davon nichts auf, also bleibt das Prinzip an einem Zug hängen und trägt die Geschichte des Spiels nicht.
> 
> **Idee.** Die Prinzipien würden eigene Bausteine des Urteils, so wie ein Schachbericht von Raumvorteil oder Bauernstruktur spricht statt nur von einzelnen Zügen.
> 
> **Schritte**
> 
> - ☐ **1.** Sammle zuerst, welche Prinzipien der Bericht heute überhaupt kennt: Breiten-Satz, Rückblick-Read, Entry-ist-Profit und die Schalter-Stufe.
>   - Dateien: `packages/eval-engine/src/summary.ts`, `packages/eval-engine/src/prose/clauses.ts`
> - ☐ **2.** Zähle an den sechs Feedback-Dumps, wie viele Züge je Spiel einen solchen Baustein tragen würden, damit klar ist, ob der Bericht davon überhaupt genug bekommt.
>   - Dateien: `e2e-feedback/feedback-drift.spec.ts`
> - ☐ **3.** Lege dem User zwei oder drei Muster vor, wie ein Prinzip als Bericht-Baustein klingt, und lass ihn wählen, bevor Code entsteht.
> - ☐ **4.** Halte den Punkt bis dahin geparkt, weil er dieselben Sätze anfasst wie die Narrativ-Mini-Runde und sonst zweimal dieselben Pins bewegt.
> 
> **Gate und Erfolg.** Noch kein Bau-Gate. Vor dem ersten Code brauchen wir Brainstorming und Spec; die Umsetzung wäre danach render-only und liefe unter denselben Bedingungen wie die Narrativ-Mini-Runde: drei byte-identische Feedback-Läufe, Kalibrierung ziffern-gleich, Regression, e2e, lint, tsc -b, Re-Pins nur am User-Gate.
> 
> **Doubles und Singles.** Die beiden Träger-Prinzipien kommen aus dem Wurzel-Profil der Suche und aus der Matrix, beide gibt es in Doubles genauso; eine spätere Spec müsste je ein Singles- und ein Doubles-Beispiel benennen, bevor ein Baustein in den Bericht geht.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Welche Prinzipien sollen überhaupt in den Bericht, und wie viele Bausteine verträgt ein Bericht, ohne geschwätzig zu werden?
> - Ist der Baustein eine eigene Zeile im Bericht oder ein Chip wie die Schlüsselmomente?
> 
> **Hintergrund**
> 
> - Herkunft: der Ideen-Parkplatz nennt die t10- und t13-Prinzipien als eigene Urteils-Bausteine und vermerkt selbst, dass sich das mit dem Narrativ-Paket überschneidet.
> - Die Zug-Hälfte ist geliefert: 562428 t10 rendert seit Runde 5 den Breiten-Satz ('A genuinely open turn rather than a drift ... 9 of 9 options ... 11 of 13'), seit Runde 13 zusätzlich den Rückblick-Read ('switching to Heatran was worth +17% more'); 648453 t13 rendert seit Runde 13 und 14 den Entry-ist-Profit-Satz und die Schalter-Stufe ('no switch-in left on the other side'), steht seit Runde 33 aber wieder als Gap, weil Tornadus-Therian unter den veröffentlichten Sets wieder eine lebende Antwort ist, und liest seit Runde 40 quiet.
> - Offen bleibt in beiden Fällen nur die vorausschauende Hälfte, die als Q6 in der nächsten Runde steckt.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/summary.ts:132-150 baut den Breiten-Satz und den Rückblick-Read des Zuges
> - packages/eval-engine/src/prose/clauses.ts:187-195 baut die beiden Entry-Sätze
> - e2e-feedback/corpus.ts:129-133 hält 562428 t10 als Gap mit den drei gepinnten Fragmenten
> - e2e-feedback/corpus.ts:135-139 hält 648453 t13 als Gap, seit Runde 40 auf quiet re-gepinnt
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 182. Zusammengelegt, weil: Alleiniger Punkt des Ideen-Parkplatzes, der auf das Narrativ zeigt; er fasst dieselben Sätze an wie die Narrativ-Mini-Runde und wartet darum auf sie.

### T67 · Typ-Prüfung für regression/ und ui/

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Kein Spiel. tsconfig.json referenziert nur tsconfig.app.json (include src), tsconfig.node.json und die Pakete; ui/tsconfig.json hängt in keinem tsc -b.
- Beleg: Sonde t67/tsconfig.t67.json über regression/, ui/, e2e/, e2e-feedback/ (54, 75, 13 und 5 Dateien im Programm), Ausgabe t67/tsc-t67.log: 32 Fehler in 5 Dateien, alle in regression/, 0 in ui/, e2e/, e2e-feedback/; Laufzeit 5 bis 7 s. Der Fehler aus Runde 52 (depth in eval-calibration.spec.ts) ist weg. 17 davon in eval-graph.spec.ts (Prefs ohne autoAnalyze, das needsSettingsUpgrade in src/hooks/evaluation/prefs.ts:125-140 nie liest), 13 untypisierte .mjs-Importe, je einer Teil-Bericht und Cast. Keiner ändert, was ein Test prüft.
- Grund: Reines Werkzeug ohne Bank-Hebel und ohne Szene für einen User; nach zwei Monaten ohne Gate hat die Lücke keinen falschen Test erzeugt. Die veralteten Verträge, die zählen, sind inhaltlich und bestehen jede Typ-Prüfung (zwei Pins auf dem alten Weg, T111 Punkt 9).
- Spielart: keine

**Alter Text in NextSteps.md:**

> - ☐ **T67 · Typ-Prüfung für regression/ und ui/** (Werkzeug, Mini-Runde, klein, verlustfrei D4)
> 
>   Runde 52: Beide neuen Paritäts-Tests bauten ihr `TeamBuildSources`-Objekt zuerst mit `as unknown as`. Kein Gate hätte gemerkt, wenn dem Objekt ein Feld fehlt: `tsconfig.app.json` prüft nur `src`, `tsconfig.node.json` nur die Vite-Configs, ESLint läuft ohne Typ-Information, und Vitest prüft keine Typen. Ein Probelauf mit einer temporären tsconfig fand einen stehenden Fehler in `regression/eval-calibration.spec.ts` (das `depth`-Argument von `searchPosition` ist `number`, verlangt ist `1 | 3 | 5`). Ein Test, dessen Typen niemand prüft, bleibt grün, während er am geänderten Vertrag vorbeitestet.
> 
>   *Erfolg:* `npx tsc -b` deckt `regression/`, `ui/`, `e2e/` und `e2e-feedback/` ab (eigenes `tsconfig.test.json` im selben Gate), die stehenden Fehler sind gezählt und behoben, die Laufzeit des Gates steht in D2, kein Dump bewegt sich. *Plan T67:* 4 Schritte, 1 offene Entscheidung.

**Alter Abschnitt im Backlog-Plan:**

> ### T67 · Typ-Prüfung für regression/ und ui/
> 
> *Werkzeug · Mini-Runde · klein · verlustfrei D4*
> 
> **Problem.** `tsconfig.app.json` prüft nur `src`, `tsconfig.node.json` nur die Vite-Configs; ESLint läuft ohne Typ-Information, Vitest prüft keine Typen. `regression/`, `ui/`, `e2e/` und `e2e-feedback/` liegen außerhalb jedes Typ-Gates. Runde 52: zwei neue Tests casteten ihr `TeamBuildSources`-Objekt mit `as unknown as`, ohne dass ein Gate es gemerkt hätte.
> 
> **Schritte**
> 
> - ☐ **1.** `tsconfig.test.json` (erbt von `tsconfig.app.json`, schließt die vier Ordner ein) in die `tsc -b`-Referenzen hängen; Fehler zählen (bekannt: `regression/eval-calibration.spec.ts`, `depth`-Argument von `searchPosition`).
> - ☐ **2.** Fehler beheben, ohne Laufzeit-Verhalten zu ändern; `as unknown as` in Tests zählen und die unnötigen streichen.
> - ☐ **3.** Laufzeit von `npx tsc -b` vorher und nachher notieren; D2 fortschreiben.
> - ☐ **4.** Gate D4.
> 
> **Offene Entscheidungen**
> 
> - Eigene tsconfig im selben `tsc -b` oder ein zweites Kommando im Lint-Gate?
> 
> **Herkunft.** Review der Runde 52 (Linse Standards).

### T21 · Dossier: Folgte der Spieler dem Engine-Favoriten?

- Urteil: obsolet (Prüfer und Gegenprüfer einig)
- Szene: Zehn frische Feedback-Dumps auf 5d428b2 (feedback/now), darunter 655336 und 573756 aus dem Text und die vier Doubles-Spiele; Tabelle je Score-Band in groups/richter-bank/referee-probe.out.txt
- Beleg: groups/richter-bank/referee-probe.out.txt und count-tiers.out.txt: 655336 p1 folgte 11 von 26, p2 11 von 28 (alt 10/26, 11/28); Singles: Sieger folgt 101 von 250 (40 %), Verlierer 83 von 269 (31 %), in 6 von 6 Spielen der Sieger öfter; Doubles 14 von 50 gegen 13 von 47 (je 28 %); zweite Frage: 31 von 41 chance-Zügen ohne Würfel-Zeile im Protokoll (Singles 21/25, Doubles 10/16)
- Grund: Das Erfolgsmaß ist erfüllt: Die Tabelle je Score-Band steht, getrennt nach Spielart, mit der Verzerrung als Kopfzeile, und die Doubles-Zeile ist dank vier Doubles-Dumps gefüllt. Die Zahl ändert weder Score noch Anzeige und wird nie Gate. Die Zählung chance ohne Würfel geht als fertige Zahl an T22.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T21 · Dossier: Folgte der Spieler dem Engine-Favoriten?** (Richter und Bank, Mini-Runde, klein, kein Score-Touch)
> 
>   655336: p1 folgte in 10 von 26 Zügen dem Engine-Favoriten, p2 in 11 von 28, p1 gewann. Aus solchen Zahlen lässt sich Zugqualität aus Ergebnissen lesen. Die Zahl ist verzerrt (wer folgt, ist im Schnitt stärker) und bleibt Diagnostik. Ein Lese-Skript über die Dumps, fällig, wenn eine Runde sie ohnehin zieht. Dasselbe Skript beantwortet im selben Lauf die Zähl-Frage aus T22: Wie oft trägt eine chance-Attribution keinen Würfel-Zug?
> 
>   *Erfolg:* Die Tabelle steht je Score-Band, die Kopfzeile benennt die Verzerrung; die Zahl wird nie Gate. *Plan T21:* 7 Schritte, 2 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T21 · Dossier: Folgte der Spieler dem Engine-Favoriten?
> 
> *Richter und Bank · Mini-Runde · klein · kein Score-Touch*
> 
> **Problem.** In 655336 folgte p1 in 10 von 26 Zügen dem Engine-Favoriten, p2 in 11 von 28, und p1 gewann. Aus solchen Zahlen lässt sich eine Zugqualität aus Ergebnissen lesen, die die Bank heute gar nicht misst. Die Zahl ist verzerrt, weil stärkere Spieler öfter folgen, taugt aber als Diagnostik neben dem Richter.
> 
> **Idee.** Ein Blick in die Buchhaltung, kein Gate: aus den Dumps ablesen, wie oft der gespielte Zug der Favorit war, und das gegen den Ausgang halten.
> 
> **Schritte**
> 
> - ☐ **1.** Lies die sechs Dumps unter docs/reports und zähle je Seite und Zug, ob der gespielte Zug der Favorit war (Regret praktisch null).
>   - Dateien: `docs/reports/feedback-full-smogtours-gen6ou-655336.json`
> - ☐ **2.** Gruppiere die Züge nach Ausgangslage in die Score-Bänder der Bank (0 bis 0,2, 0,2 bis 0,4, 0,4 bis 0,7, 0,7 bis 1,0), damit Gleiches mit Gleichem verglichen wird.
>   - Dateien: `scripts/calibration-lib.mjs`
> - ☐ **3.** Stelle je Band die Folgequote gegen den Spielausgang und drucke eine Markdown-Tabelle im Stil des Decided-Verlust-Dossiers.
>   - Dateien: `scripts/dossier-follow-rate.mjs (NEU)`, `scripts/dossier-decided-losses.mjs`
> - ☐ **4.** Nimm die zweite offene Frage gleich mit und zähle die chance-Attributionen ohne Würfel-Zug, damit ein Skript zwei Fragen beantwortet.
>   - Dateien: `src/lib/analysis-context.ts`
> - ☐ **5.** Schreibe die Verzerrung als Kopfzeile in die Ausgabe: wer folgt, ist im Schnitt stärker, die Zahl bleibt Diagnostik.
>   - Dateien: `scripts/dossier-follow-rate.mjs (NEU)`
> - ☐ **6.** Trenne die Ausgabe nach gameType und lass die Doubles-Zeile leer, solange kein Doubles-Dump vorliegt.
>   - Dateien: `scripts/dossier-follow-rate.mjs (NEU)`
> - ☐ **7.** Fahre das Skript nur, wenn eine Runde die Dumps ohnehin zieht, und lege die Tabelle unter docs/perf/probes/ ab.
>   - Dateien: `docs/reports/feedback-drift.md`
> 
> **Gate und Erfolg.** Reines Lese-Skript über vorhandene Dumps, kein Engine-Touch, kein Cache-Bump, kein Bank-Lauf. Gates sind npm run test:regression, lint und tsc -b. Erfolg heißt: die Tabelle steht und die Kopfzeile benennt die Verzerrung; die Zahl wird nie Gate und nie Verdikt-Linie.
> 
> **Doubles und Singles.** Das Skript gruppiert nach gameType. Die sechs heutigen Dumps sind Singles, die Doubles-Zeile bleibt leer und füllt sich, sobald der Bank-Sweep des Richters Doubles-Verdikte liefert oder ein Doubles-Replay in den Feedback-Korpus kommt.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Zählt als gefolgt nur Regret null, oder auch jeder Zug innerhalb der inaccuracy-Schwelle 0,1?
> - Reichen sechs Spiele für eine Aussage je Score-Band, oder wartet das Dossier auf den Bank-Sweep des Richters, der dieselben Verdikte für 129 Replays liefert?
> 
> **Hintergrund**
> 
> - Belegbeispiel aus dem 655336-Dump vom 12.09.: gameReport.winner p1, accuracy p1 86,9 und p2 91,5, decisionTotals p1 0,729 und p2 1,286, turningPoint 3; gefolgt (Regret unter 1e-9) p1 10 von 26, p2 11 von 28.
> - Die Dumps tragen je Seite played, best, regret, tier, choiceCount und viableCount, dazu je Zug attribution, scoreBefore, scoreAfter, decisionDelta und chanceDelta.
> - Der Bericht rechnet schon eine eigene Accuracy je Seite als harmonisches Mittel, die Folgequote ist eine andere Zahl und darf nicht mit ihr verwechselt werden.
> - Vorbild für Form und Cache-Verhalten ist das Dossier der Decided-Verluste aus Runde 33, das 22 Decided-Verluste in 17 Paar-Fehlpreisungen, 5 Aufgaben und 0 Würfel zerlegte.
> - Die zweite Frage im selben Skript stammt aus dem offenen Punkt zu 573756 t70: zähle, wie oft im Korpus eine chance-Attribution ohne Würfel-Zug auftritt; diceEventTurns liegt als Export bereit.
> - Der User hat diese Messung ausdrücklich als Beobachtung eingeordnet, nicht als Gate.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - docs/reports/feedback-full-smogtours-gen6ou-655336.json: gameReport mit winner, accuracy, decisionTotals und turningPoint
> - packages/eval-engine/src/report.ts:392: der Bericht baut misplays und reads aus denselben Analysen, die das Dossier liest
> - scripts/dossier-decided-losses.mjs:33: das Vorbild filtert Samples und druckt Tabelle plus Zählung
> - packages/eval-engine/src/index.ts:67: diceEventTurns ist aus dem Paket exportiert (Quelle dice-events.ts) und liefert die Würfel-Züge für die zweite Frage; src/lib/analysis-context.ts:4 importiert es, Zeile 167 ruft es auf
> - packages/eval-engine/src/turn-analysis/types.ts:341: jede Analyse trägt attribution neben decisionDelta und chanceDelta
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 28. Zusammengelegt, weil: Zeile 28 steht allein, teilt sich aber Datenquelle und Skript-Form mit der Chance-ohne-Würfel-Zählung aus dem Narrativ-Cluster; ein Dossier-Skript beantwortet beide Fragen.

### T37 · Choke-Erkennung prüfen: drei Proben vor dem Richter

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: 655336 Zug 5 und Zug 26 (Experten-Fehler der Golden), die vier verteidigten Züge 573756 t68, 648453 t13, 649664 t23, 653785 t19, alle Tier-Züge der zehn Dumps (dump-turn.mjs)
- Beleg: groups/richter-bank/referee-probe.out.txt: Probe 1 an der mistake-Schwelle 1 von 2 Experten-Fehlern (t5 Trick 0,228 ja, t26 Protect nur inaccuracy 0,120), 0 von 4 Fehlalarmen (648453 t13 nur inaccuracy 0,102), höchstens 1 ungenannter mistake je Spiel (655336 t13 p2, 648453 t14 p1); Probe 3: Singles-mistakes 3 von 3, Doubles-mistakes 4 von 4 mit eigenem Score-Sturz; Singles 3 mistakes und 22 inaccuracies auf 558 Seiten-Zügen (alt 2 und 36)
- Grund: T37 dient nur der Entscheidung, ob der Richter für T38 taugt, und T38 fällt. Die sichtbaren Teile von Probe 1 tragen schon Pins: der Spiel-Pin 655336 meldet genau missing misplay 26:p2 und extra misplay 13:p2, 648453 t13 ist ein offener Gap. Probe 2 bräuchte einen Regressionslauf, an dem keine Entscheidung mehr hängt.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T37 · Choke-Erkennung prüfen: drei Proben vor dem Richter** (Richter und Bank, Sichtung, mittel, kein Score-Touch)
> 
>   Ein Richter, der Spielerfehler erkennen soll, muss selbst geprüft sein. Stand: Über die sechs Feedback-Dumps stehen 2 mistakes und 0 blunders gegen 36 inaccuracies in 558 Seiten-Zügen; 573756 liefert in 139 Zügen keinen einzigen Fehler-Zug. In 655336 nennt der Experte zwei Fehler von p2 (Trick in Zug 5, Protect in Zug 26), die Engine findet nur den Trick. Drei Proben: gegen die Experten-Pins, gegen exakt gelöste Endspiele, gegen den eigenen Score-Verlauf.
> 
>   Hinweis: Die alte Vorgabe „nur mistake und blunder, mit `verifiedAtDepth`“ ergäbe wörtlich eine leere Richter-Datei: Das Flag steht nur, wenn die Vertiefung den Tier gestrichen hat. Gemeint sind Verdikte, die die Vertiefung stehen ließ.
> 
>   *Erfolg:* Die Probenzahlen stehen (Treffer gegen Experten-Pins, Fehlalarme auf den vier verteidigten Zügen, Treffer und Fehlnennungen auf exakt gelösten Stellungen, Anteil Richter-Fehler ohne Score-Bewegung), und daraus fällt ein Ja oder Nein für den Richter. *Plan T37:* 9 Schritte, 4 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T37 · Choke-Erkennung prüfen: drei Proben vor dem Richter
> 
> *Richter und Bank · Sichtung · mittel · kein Score-Touch · braucht T01, T08 für Probe 2 auf Bank-Stellungen*
> 
> **Problem.** Im Spiel 655336 nennt der Experte zwei Fehler von p2: Trick in Zug 5 und Protect in Zug 26. Die Engine findet heute nur den Trick als mistake (Regret 0,393); Protect bleibt eine inaccuracy und fällt aus der Fehlerliste. Im Spiel 573756 mit 139 Zügen findet sie über beide Seiten keinen einzigen mistake. Ein Richter, der in sechs Spielen zwei Fehler kennt, schließt auf der Bank fast nichts aus und die choke-bereinigte Zahl sagt nichts.
> 
> **Idee.** Erst die Waage mit bekannten Gewichten prüfen, dann wiegen: die Fehler-Erkennung gegen drei unabhängige Wahrheiten messen, bevor irgendeine Zahl auf ihr aufbaut.
> 
> **Hinweis.** Die alte Vorgabe „nur mistake und blunder, mit `verifiedAtDepth`“ ergäbe wörtlich eine leere Richter-Datei: Das Flag steht nur, wenn die Vertiefung den Tier gestrichen hat. Gemeint sind Verdikte, die die Vertiefung stehen ließ.
> 
> **Schritte**
> 
> - ☐ **1.** Ziehe drei frische Feedback-Dumps mit FEEDBACK_DUMP=1 auf master und prüfe die mtime der sechs Dateien, bevor du zählst.
>   - Dateien: `e2e-feedback/feedback-drift.spec.ts`, `docs/reports/feedback-full-smogtours-gen8ou-573756.json`
> - ☐ **2.** Schreibe ein Zähl-Skript, das über die sechs Dumps je Seite und Zug tier, regret, verifiedAtDepth, played und best auswertet und die Verteilung druckt.
>   - Dateien: `scripts/referee-probe.mjs (NEU)`, `scripts/dossier-decided-losses.mjs`
> - ☐ **3.** Halte Probe 1 gegen die Korpus-Pins: die zwei vom Experten genannten Misplays der Golden als Treffer (vorregistrierte Trefferquote mindestens 80 %), die vier verteidigten Züge 573756 t68, 648453 t13, 649664 t23 und 653785 t19 als Fehlalarm-Test, und zähle je Spiel die Richter-Fehler, die der Experte nie genannt hat (vorregistrierte Grenze: höchstens einer je Spiel; Beispiel 648453 t36).
>   - Dateien: `e2e-feedback/corpus.ts`, `e2e-feedback/golden/smogtours-gen6ou-655336.report.json`
> - ☐ **4.** Miss Probe 3 im selben Skript: jeder Richter-Fehler muss an derselben Stelle einen Score-Sturz der eigenen Seite zeigen, und zähle die Fehler ohne Bewegung.
>   - Dateien: `packages/eval-engine/src/turn-analysis/types.ts`
> - ☐ **5.** Entscheide anhand der Zählung, ob die Schwelle mistake (0,2) oder inaccuracy (0,1) den Richter trägt, und schreibe die Wahl vor dem Bau fest.
>   - Dateien: `packages/eval-engine/src/turn-analysis/types.ts`
> - ☐ **6.** Exportiere für Probe 2 die Bank-Stellungen neu, weil der Standard-Ordner des Prüfstands seit dem 12.09. leer ist.
>   - Dateien: `regression/eval-calibration.spec.ts`, `regression/endgame-truth.spec.ts`
> - ☐ **7.** Fahre Probe 2 zuerst auf den 19 exakt gelösten synthetischen Endspielen: der Richter muss jeden Zug treffen, dessen exakter Wert mindestens 0,2 unter dem besten liegt, und darf keinen anderen nennen.
>   - Dateien: `docs/perf/probes/2026-09-12-r43/truth-after.jsonl`, `regression/endgame-fixtures.ts`
> - ☐ **8.** Fahre alle drei Zählungen getrennt nach gameType und vermerke, dass die sechs Korpus-Spiele Singles sind, die Doubles-Aussage also am Bank-Sweep hängt.
>   - Dateien: `regression/eval-calibration.spec.ts`
> - ☐ **9.** Lege die Zahlen unter docs/perf/probes/<datum>-referee/ ab und schreibe das Verdikt in den Ledger: Richter taugt, taugt nach Schwellenwechsel, oder taugt nicht.
>   - Dateien: `regression/eval-calibration.spec.ts`
> 
> **Gate und Erfolg.** Kein Score-Touch, kein Cache-Bump: reine Diagnostik. Gates sind npm run test:regression, lint und tsc -b für das neue Skript. Erfolg heißt: die drei Probenzahlen stehen (Trefferquote gegen die Experten-Pins, Fehlalarme auf den vier verteidigten Zügen, Treffer und Fehlnennungen auf den exakt gelösten Stellungen, Anteil der Richter-Fehler ohne Score-Bewegung), und daraus fällt eine Ja-Nein-Entscheidung für den Richter. Die Zählung selbst läuft nur auf frischen Dumps (FEEDBACK_DUMP=1, mtime geprüft).
> 
> **Doubles und Singles.** Die Zählung läuft getrennt nach gameType. Singles decken die sechs Korpus-Spiele ab. Für Doubles liefert Probe 2 die gelösten Doubles-Endspiele des Prüfstands, und Probe 1 und 3 bekommen ihre Doubles-Zeile erst aus dem Bank-Sweep der Doubles-Tranche ladder-dou-0804 plus dem VGC-Replay des offenen Befunds.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Zählt als Richter-Fehler nur mistake ab 0,2, oder ab inaccuracy 0,1? Über die sechs Dumps stehen 2 mistakes gegen 36 inaccuracies; mit der engen Lesart ist der Richter fast blind.
> - Probe 1 hat heute zwei vom Experten genannte Spieler-Misplays als Nenner. Bleibt die Vorgabe Trefferquote über 80 Prozent sinnvoll, oder wird Probe 1 zur Fehlalarm-Probe auf den vier verteidigten Zügen umgeschrieben?
> - Wartet Probe 2 auf den Löser-Nachtlauf mit exakten Bank-Stellungen, oder genügen die 19 synthetischen Endspiele für das erste Verdikt?
> - Gehen die beiden User-Befunde aus dem GPL-Spiel (Vileplume-Wechsel fälschlich als Fehler, Heavy Slam nicht als Fehler) als zwei weitere Probe-1-Punkte in die Zählung?
> 
> **Hintergrund**
> 
> - Zählung über die sechs Dumps in docs/reports vom 12.09. 14:10 bis 14:12: 279 Züge, 558 Seiten-Züge, davon 36 inaccuracy, 2 mistake, 0 blunder, 5 sacrifice, 6 riskPaidOff, 1 riskUnpunished.
> - Je Spiel: 648453 39 Züge mit 1 mistake (t36 p2, Regret 0,431, gespielt Wechsel zu Ferrothorn statt Quick Attack, riskUnpunished, vom Experten nie genannt); 655336 28 Züge mit 1 mistake (t5 p2 Trick, Regret 0,393, besser Thunder Wave) und 6 inaccuracies (t6p1, t13p2, t14p1, t16p2, t23p1, t26p2); 649664 24 Züge, 653785 26, 562428 23, 573756 139 Züge ohne einen einzigen mistake oder blunder.
> - Die Golden von 655336 pinnt genau zwei Misplays: t5 p2 und t26 p2.
> - Schwellen: inaccuracy 0,1, mistake 0,2, blunder 0,4; ab eigenem Score 0,7 fällt der Tier eine Stufe (DECIDED_SCORE), ein Sack fällt ebenfalls eine Stufe, ein verifizierter Feed fällt ganz weg.
> - Die Report-Liste nimmt höchstens zwei Misplays je Seite und schließt riskPaidOff aus.
> - Die vier Experten-Punkte, die keine Spieler-Fehler sind, sondern falsche Verdikte rügen: 573756 t68 (Weavile-Sack soll keinen Tier tragen), 648453 t13 (HP Ice ist kein Fehler), 649664 t23 (Hydro Pump war der einzige Gewinnzug), 653785 t19 (Will-O-Wisp als Empfehlung).
> - Probe 2 braucht exakt gelöste Stellungen: Runde 34 hatte 51 von 116 Items im Bereich, 14 exakt (13 synthetisch, 1 Bank), 23 gedeckelt, 36 ungepreist, Löser-Wanduhr 3013 s bei vier parallelen Slices, jede Drei-Körper-Bankstellung im 120-s-Deckel.
> - Runde 43 hob die synthetische Seite auf 19 exakt von 26 Items; Bank-Zeilen gibt es heute keine, weil der Standard-Ordner .calibration/r34-after/positions mit dem Vorfall vom 12.09. verschwand.
> - Probe 3 liest scoreBefore, scoreAfter, decisionDelta, chanceDelta und attribution direkt aus den Dump-Analysen.
> - Vorbild für das Skript ist das Dossier der Decided-Verluste, das merged.jsonl liest, Replays unter .calibration/replays zwischenspeichert und eine Markdown-Tabelle plus Zählung druckt.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - docs/reports/feedback-full-smogtours-gen6ou-655336.json: gameReport.misplays enthält nur t5 p2 Trick, Regret 0,393
> - e2e-feedback/golden/smogtours-gen6ou-655336.report.json: misplays t5 p2 und t26 p2, die Experten-Wahrheit
> - packages/eval-engine/src/turn-analysis/types.ts:23: TIER_THRESHOLDS inaccuracy 0,1, mistake 0,2, blunder 0,4
> - packages/eval-engine/src/turn-analysis/types.ts:36: DECIDED_SCORE 0,7 senkt jeden Tier eine Stufe
> - packages/eval-engine/src/report.ts:204: misplaysFor nimmt nur badTier ohne riskPaidOff, höchstens zwei je Seite
> - packages/eval-engine/src/report.ts:26: REPORT_MISPLAYS_PER_SIDE ist 2
> - e2e-feedback/feedback-drift.spec.ts:156: unter FEEDBACK_DUMP=1 schreibt der Lauf feedback-full-<id>.json mit analyses und gameReport
> - e2e-feedback/corpus.ts:119: der 573756-t73-Eintrag zeigt, wie die Pins Verdikte und Gegenrede des Experten tragen
> - regression/endgame-truth.spec.ts:31: DEFAULT_DIR zeigt auf .calibration/r34-after/positions, das heute leer ist
> - docs/perf/probes/2026-09-12-r43/truth-after.jsonl: 26 Zeilen, 19 exakt, alle synthetisch, keine Bank-Zeile
> - scripts/dossier-decided-losses.mjs:20: replayJson holt Replays aus .fit-corpus, dann aus .calibration/replays, dann vom Server
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 27. Zusammengelegt, weil: Zeile 27 steht allein, zieht aber die Vorbedingung von Zeile 26 und die Belege aus Zeile 73 an sich; alle drei Proben lesen dieselben Daten (Feedback-Dumps, Korpus-Pins, Löser-Stellungen).

### T38 · Gefrorener Richter und vierfache Bank-Ausgabe

- Urteil: verwerfen (Prüfer und Gegenprüfer einig)
- Szene: Bank-Basis .calibration/r61-t98b (837 Stellungen, 129 Spiele) und vier Bank-Paare der Runde 61 gegen r61-app (early-tree, early-depth-2, late-iter-1200, early-samples-3); Bank-artige Stichproben der zehn Dumps; 573756 Zug 2 aus dem Text
- Beleg: r61-t98b/summary.txt: Glückszeile schließt 339 von 837 aus (40,5 %). groups/richter-bank/view-widths.out.txt: Bandbreite voll gegen glücksbereinigt early-tree 43,3 gegen 48,7 bp, early-depth-2 26,6 gegen 23,8, late-iter-1200 18,0 gegen 18,1, early-samples-3 7,9 gegen 11,2. luck-window.out.txt: Fenster 8/4/2 Züge lassen das early-tree-Band bei 44,8/42,5/44,5 bp. choke-share.out.txt: Choke-Filter träfe an der mistake-Schwelle 3 von 44 Singles- und 5 von 22 Doubles-Stichproben, an der inaccuracy-Schwelle 29 von 44 und 15 von 22
- Grund: T38 fasst laut Plan keinen Score an und ändert nichts, was ein Nutzer sieht; ein Hebel bliebe nur, wenn der Filter die Bank schärfer machte. Schon der Glücksfilter, der 40 % wegnimmt, macht das Band nicht enger, auch mit engerem Fenster nicht, und ein Choke-Filter träfe kaum Stellungen oder zwei Drittel. Die Einfrier-Kandidaten v39 und v46 sind seit Cache v56 und dem Baum ab Zug 1 (budget.ts:26) überholt.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T38 · Gefrorener Richter und vierfache Bank-Ausgabe** (Richter und Bank, Runde, groß, kein Score-Touch, braucht T37)
> 
>   Die Bank misst, ob die Prozente ehrlich sind. Sie misst nicht, ob die Engine besser urteilt als die Spieler: Patzt die favorisierte Seite nach der gemessenen Stellung, lastet die Bank den verlorenen Punkt der Engine an. Eine eingefrorene Engine-Version bestimmt einmal, welche Züge Fehler waren (Richter-Datei), und jede spätere Engine wird gegen diese feste Liste gemessen. Ausgabe vierfach: roh, glücksbereinigt, choke-bereinigt, Zahl der Ausschlüsse. Gleichzeitig fällt die Fenster-Frage der Glückszeile, die heute 334 von 816 Stellungen ausschließt (41 %).
> 
>   Hinweis: Ehrliche Grenze: „besser als die Spieler“ heißt hier „so gut wie die Fehler-Erkennung des Richters“. Der Sweep mit Zug-Verdikten ist neue Arbeit: Die Kalibrierung ruft `analyzeTurn` nie auf.
> 
>   *Erfolg:* Vier Zeilen stehen, roh und glücksbereinigt bleiben gegen eine frische Basis ziffern-gleich, Richter-Stand und Fenster-Wahl stehen mit Zahlen im Ledger. Die choke-bereinigte Zahl bleibt Diagnostik, bis T37 bestanden ist. *Plan T38:* 9 Schritte, 5 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T38 · Gefrorener Richter und vierfache Bank-Ausgabe
> 
> *Richter und Bank · Runde · groß · kein Score-Touch · braucht T37*
> 
> **Problem.** Die Bank sagt heute, ob die Prozente unter dem Spielerpool ehrlich sind. Sie sagt nicht, ob die Engine besser urteilt als die Spieler: wenn die favorisierte Seite nach dem Sample selbst patzt, fällt der Punkt der Engine zur Last. Dazu schließt die Glückszeile 334 von 816 Stellungen aus, 41 Prozent, weil sie jeden Crit und jeden Miss bis zum Spielende mitzählt, auch lange nach der Entscheidung.
> 
> **Idee.** Ein Schiedsrichter, der vor dem Spiel festgelegt wird und sich während des Spiels nicht mehr ändert: eine eingefrorene Engine-Version bestimmt einmal, welche Züge Fehler waren, und jede spätere Engine wird gegen diese feste Liste gemessen.
> 
> **Hinweis.** Ehrliche Grenze: „besser als die Spieler“ heißt hier „so gut wie die Fehler-Erkennung des Richters“. Der Sweep mit Zug-Verdikten ist neue Arbeit: Die Kalibrierung ruft `analyzeTurn` nie auf.
> 
> **Schritte**
> 
> - ☐ **1.** Entscheide am User-Gate den Einfrier-Stand: v39 auf dem Runde-32-Kopf 81e921f mit altem Werkzeugkasten, oder das heutige master als Richter v46.
>   - Dateien: `src/lib/eval-cache-store.ts`
> - ☐ **2.** Miss den Sweep-Pfad an einem einzelnen Bank-Replay: Browser-Sweep wie im Feedback-Harness gegen den verkürzten Node-Pfad des GPL-Tests, und halte fest, wie weit die Tiers auseinanderliegen.
>   - Dateien: `e2e-feedback/feedback-drift.spec.ts`, `packages/eval-engine/test/eval-gpl.spec.ts`, `src/lib/analysis-context.ts`
> - ☐ **3.** Baue das Richter-Skript, das die 129 Bank-Replays in Slices sweept und die Fehler-Züge je Seite als JSON-Datei unter .calibration ablegt.
>   - Dateien: `scripts/build-referee.mjs (NEU)`, `scripts/run-calibration.mjs`
> - ☐ **4.** Schreibe den roten Test zuerst: die Summary-Spec erwartet die choke-bereinigte Zeile samt Ausschlusszahl neben den drei vorhandenen Zeilen.
>   - Dateien: `regression/calibration-summary.spec.ts`
> - ☐ **5.** Ergänze die Ausschluss-Funktion in calibration-lib.mjs und dieselbe Zeile in calibration-summary.ts, damit beide Drucker weiter zeichengleich sind.
>   - Dateien: `scripts/calibration-lib.mjs`, `regression/calibration-summary.ts`
> - ☐ **6.** Lege die Fenster-Regel fest und miss alle drei Varianten: bis Spielende, bis zum ersten Richter-Fehler, bis zum ersten Decided-Sweep, je mit der Zahl der Ausschlüsse.
>   - Dateien: `regression/luck-events.ts`, `regression/eval-calibration.spec.ts`
> - ☐ **7.** Fahre die Bank einmal frisch als Basis und einmal mit der neuen Ausgabe: die rohe und die glückbereinigte Zeile müssen ziffern-gleich bleiben, nur die Choke-Zeile kommt dazu.
>   - Dateien: `scripts/run-calibration.mjs`, `scripts/paired-calibration.mjs`
> - ☐ **8.** Schließe die Gates mit Regression, lint und tsc -b und trage Richter-Stand, Fenster-Regel und Ausschlusszahlen als Vermerk in den Ledger.
>   - Dateien: `regression/eval-calibration.spec.ts`
> - ☐ **9.** Hole das User-Gate, bevor die choke-bereinigte Zeile von Diagnostik zur Verdikt-Linie wird, und schreibe dazu, dass der Richter nur an Rundengrenzen wechselt.
>   - Dateien: `regression/eval-calibration.spec.ts`
> 
> **Gate und Erfolg.** Die Runde fasst keinen Score an, also kein Cache-Bump und kein Feedback-Byte-Gate. Gemessen wird an der Bank selbst: die rohe Zeile und die glückbereinigte Zeile müssen gegen eine am selben Tag frisch gefahrene Basis ziffern-gleich bleiben (frische Basis ist Pflicht, weil unter .calibration seit dem 12.09. kein Stand mehr liegt), beide Drucker müssen zeichengleich sein (die Unit-Spec hält das), dazu npm run test:regression, lint und tsc -b. Die choke-bereinigte Zahl bleibt Diagnostik, solange die drei Choke-Proben nicht stehen. Erfolg heißt: vier Zeilen stehen (roh, glückbereinigt, choke-bereinigt, Ausschlusszahlen), der Richter-Stand steht im Ledger, und die Fenster-Wahl ist mit Zahlen belegt. Re-Pins oder eine neue Verdikt-Linie nur am User-Gate.
> 
> **Doubles und Singles.** Die Richter-Datei trägt je Replay beide Seiten und deckt damit die Doubles-Tranche der Bank mit. Die gedruckten Zeilen trennen schon heute singles und doubles; die neue Choke-Zeile bekommt dieselbe Trennung, damit ein Richter auffällt, der in Doubles nichts findet. Der Sweep-Pfad muss vor dem Bau an einem Doubles-Replay geprüfte Zug-Verdikte liefern, weil die sechs Korpus-Spiele alle Singles sind.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Welcher Stand wird eingefroren? v39 liegt auf 81e921f vom 03.09., vor dem Vitest-Umzug und ohne ui/, braucht also ein eigenes npm ci im alten Werkzeugkasten, und urteilt mit den Sets vor den veröffentlichten Smogon-Sets. Ein Richter auf dem heutigen master wäre billig, urteilt aber mit der Version, die er bewerten soll.
> - Welchen Sweep-Pfad nimmt die Richter-Datei? Der Browser-Pfad ist harness-treu, braucht aber für 129 Replays entweder aufgezeichnete Fixtures oder Netzzugriff bei leerem .smogon-cache. Der Node-Pfad ist billig, gradet aber ohne playedOutcome, ohne Zukunftsfenster und ohne Verify-Pass.
> - Welches Fenster gilt für beide Ausschlüsse? Bis Spielende schließt heute 41 Prozent aus; bis zum ersten Decided-Sweep wäre enger, braucht aber je Replay den frühesten Sample mit decided.
> - Soll die choke-bereinigte Zeile jemals Verdikt-Linie werden, oder bleibt sie dauerhaft Diagnostik neben der hq-Tranche?
> - Wird die Richter-Datei versioniert abgelegt, damit ein Wechsel im Ledger nachweisbar ist, obwohl .calibration nicht im Repository liegt?
> 
> **Hintergrund**
> 
> - Entwurf aus dem Perf-und-Qualitäts-Plan vom 04.09. 08:48: calibration-lib.mjs bekommt adjust(samples, { luck, referee }); Stufe 1 markiert luckAgainstFavored ab dem Sample-Turn bis zum ersten Richter-Fehler oder bis zum Ende; Stufe 2 liest .calibration/referee-v39.json im Format { "<replayId>": { "p1": [turns], "p2": [turns] } }, erzeugt einmalig aus einem Feedback-Sweep der Bank-Replays auf v39 mit FEEDBACK_DUMP=1, nur mistake und blunder, und markiert chokeByFavored, wenn die favorisierte Seite nach dem Sample einen Richter-Fehler beging; record() druckt roh, ohne luck, ohne choke, plus Ausschlusszahlen; Richterwechsel nur an Rundengrenzen mit Ledger-Vermerk.
> - Stand heute: gebaut ist davon nichts, kein build-referee.mjs, keine referee-precision.spec.ts, kein Commit mit referee in git log --all.
> - Runde 35 wurde der Zwangssieg-Beweiser, der Richter fiel aus.
> - Bank-Zahlen aus Runde 34: 816 Samples, 129 Replays in sechs Tranchen (draft, ladder-ou-0802, ladder-dou-0804, ladder-0811, tournament-0811, tournament-0811b), etwa acht Sample-Züge je Replay (Schritt gleich Aufrundung maxTurn durch 8, Start bei Zug 2); Glück Stufe 1 schließt 334 von 816 aus, Brier glückbereinigt 0,2434/0,2084/0,1490 gegen die volle Bank 0,2600/0,2294/0,1564, also früh minus 166, mittel minus 210, spät minus 74 Basispunkte; hq n=547 (410 smogtours plus 137 Ladder ab Rating 1700, 384 bewertete Samples von 1403 bis 1831), Sign 65 Prozent, Brier 0,2540/0,2168/0,1684.
> - Spätere Runden lesen hq mit n=548.
> - Einfrier-Kandidaten: v39 wurde mit 070b9b9 am 03.09. gesetzt und mit 1689c24 am 04.09. auf v40 gehoben; der Runde-32-Kopf ist 81e921f, davor cc8dceb (Re-Pins).
> - Heute steht der Cache auf v46.
> - Zwischen v39 und heute liegen: veröffentlichte Smogon-Sets (R33), Löser und hq-Tranche (R34), Beweiser (R35), Scarf-Inferenz (R37), HP aus dem Log (R40), Offensive gegen Tempo (R41), Zwangswechsel-Knoten (R42), Klassen auf Ansage (R43), Pivot-Paar (R44), Formen-Marker (R45).
> - Kalibrierung läuft in sechs Slices in 326 bis 473 s; ein Feedback-Sweep von 573756 mit 139 Zügen braucht auf ruhiger Maschine 51 bis 67 s, Bank-Replays sind kürzer.
> - Ehrliche Grenze, die in den Ledger gehört: besser als die Spieler heißt hier so gut wie die Fehler-Erkennung des Richters; die Frage hätte die Engine gewonnen kann kein Replay beantworten.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - docs/superpowers/plans/2026-09-02-perf-and-quality-plan.md:776: der vollständige Entwurf von adjust(samples, { luck, referee }) und der Richter-Datei
> - scripts/calibration-lib.mjs:110: die glückbereinigte Zeile filtert auf !luckAgainstFavored und druckt die Ausschlusszahl
> - scripts/calibration-lib.mjs:52: record() druckt die gepaarte Zeile, die um die Choke-Spalte wächst
> - regression/calibration-summary.ts:82: derselbe Zeilentext im Harness, zeichengleich zu calibration-lib.mjs
> - regression/calibration-summary.spec.ts:10: die Unit-Spec pinnt hq- und luck-Zeile per Regex, dort kommt der rote Test hin
> - regression/luck-events.ts:12: luckAgainstFavored zählt Crit, Miss und Ausfall vom Sample-Turn bis zum Ende, ohne Fenster
> - regression/eval-calibration.spec.ts:3139: jedes Sample trägt decided, den Sweep-Befund der Wurzel
> - regression/eval-calibration.spec.ts:2909: Kommentar im Ledger, die Kalibrierung ruft analyzeTurn nie auf, Zug-Verdikte fehlen der Bank also ganz
> - regression/eval-calibration.spec.ts:3303: acht Sample-Züge je Replay ab Zug 2
> - src/lib/analysis-context.ts:29: analyzeTurnAt setzt die Verdikt-Eingaben des App-Pfads zusammen, inklusive playedOutcome, Zukunftsfenster und verify
> - packages/eval-engine/test/eval-gpl.spec.ts:35: der verkürzte Node-Pfad gradet mit d1s1 ohne playedOutcome und ohne verify
> - src/lib/eval-cache-store.ts:160: der Cache steht heute auf 46, v39 ist der Kommentarblock darüber
> - e2e-feedback/hermetic.ts:36: der Feedback-Harness pinnt jede Eingabe aus Fixtures, für 129 Bank-Replays fehlen sie
> - packages/eval-engine/src/turn-analysis/grading.ts:64: verifiedRegret setzt verifiedAtDepth nur, wenn die tiefe Prüfung den Regret unter die Mistake-Schwelle zieht
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 26; Zeile 126. Zusammengelegt, weil: Zeile 26 baut die Richter-Datei und die vierfache Ausgabe, Zeile 126 stellt die Fenster-Frage an genau dieselbe Ausschluss-Logik in summarize und summaryLines; beide Ausschlüsse (Glück und Choke) brauchen dieselbe Antwort, wie weit nach dem Sample gezählt wird.

### T40 · Q9 · Ehrliche Prozente nach Spielstärke

- Urteil: obsolet (Prüfer und Gegenprüfer einig)
- Szene: Bank-Basis .calibration/r61-t98b mit Rating je Stellung: 394 bewertete Stellungen aus 62 Spielen (1403 bis 1831), 421 Turnier-Stellungen, 22 Draft-Stellungen
- Beleg: groups/richter-bank/k-by-rating.out.txt, k-rated-oos.out.txt, k-by-format.out.txt: K je Rating-Band 0,75 [0,08; 1,62] unter 1500, 2,49 [1,29; 4,73] 1500 bis 1699, 2,30 [1,04; 4,31] ab 1700, nicht monoton; eigenes K je Band verliert außerhalb der Stichprobe gepoolt 8 von 20 Seeds (+15 bp), Singles 0 von 20 (+69 bp), Schnitt bei 1700 0 von 20 (+28 bp); Turnier K 3,37 [2,56; 4,37] statt der angenommenen 0,87; Doubles-Gewinn 20 von 20 ist ein Format-Schnitt: VGC K 1,30 [0,56; 2,40] auf 10 Spielen gegen Doubles OU 3,36 [2,51; 4,53]
- Grund: Das Erfolgsmaß ist im zweiten Zweig erfüllt: Es gibt kein klares, monotones Gefälle nach Spielstärke, weder gepoolt noch in Singles, eine Konstante ist für das Rating ehrlich. Die Ausgangslage hat sich gedreht, Turnierspiele verwandeln Vorteile jetzt am verlässlichsten. Was in Doubles nach Rating aussieht, ist VGC gegen Doubles OU und damit eine Frage der Engine, nicht der Anzeige.
- Spielart: beide

**Alter Text in NextSteps.md:**

> - ☐ **T40 · Q9 · Ehrliche Prozente nach Spielstärke** (Q-Runden, Mini-Runde, klein, kein Score-Touch, braucht T01)
> 
>   Die Prozentzahl über dem Balken ist für alle gleich geeicht, obwohl Turnierspieler Vorteile seltener verwandeln: gepooltes K 0,87 im Turnier-Band gegen 1,4 bis 1,9 auf der Leiter. Ein Offline-Skript prüft zuerst, ob die Rating-Bänder klar und monoton verschieden sind; alle früheren K-Varianten (je Modus, Phase, Spielart) haben out-of-sample verloren.
> 
>   *Erfolg:* Ein klares, monotones Gefälle zwischen den Bändern oder der gebuchte Beleg, dass eine Konstante ehrlich ist. Geht die Anzeige in die App, gelten die render-only-Gates (D4) samt Re-Pins der Prozent-Sätze. *Plan T40:* 5 Schritte, 3 offene Entscheidungen.

**Alter Abschnitt im Backlog-Plan:**

> ### T40 · Q9 · Ehrliche Prozente nach Spielstärke
> 
> *Q-Runden · Mini-Runde · klein · kein Score-Touch · braucht T01*
> 
> **Problem.** Die Zahl über dem Balken ist für alle gleich gerechnet, obwohl Turnierspieler Vorteile viel seltener in Siege verwandeln: gepooltes K 0,87 im Turnier-Stratum gegen 1,4 bis 1,9 auf der Leiter. Wer ein Turnierspiel ansieht, liest also eine Prozentzahl, die für Leiterspiele geeicht ist. Die Bank kennt das Rating jedes Leiter-Replays seit Runde 34, die Anzeige benutzt es nicht.
> 
> **Idee.** Ein Offline-Skript prüft zuerst, ob die Bänder wirklich verschieden sind, und erst danach bekommt die Anzeige je Rating-Band ihr eigenes K. Wie eine Waage, die man für schwere und leichte Lasten getrennt eicht, statt eine Mitte für alle zu nehmen.
> 
> **Schritte**
> 
> - ☐ **1.** Fahre einen frischen Bank-Lauf mit Dump und zähle die Stellungen je Rating-Band (unter 1500, 1500 bis 1700, ab 1700, ohne Rating), getrennt nach Singles und Doubles.
>   - Dateien: `scripts/run-calibration.mjs`, `regression/eval-calibration.spec.ts`
> - ☐ **2.** Schreibe ein Offline-Skript, das je Band ein eigenes K fittet und Brier und Log-Loss je Band ausgibt, mit der Fit-Mathematik aus der Kalibrierungs-Bibliothek.
>   - Dateien: `scripts/calibration-lib.mjs`, `scripts/display-k-by-rating.mjs (NEU)`
> - ☐ **3.** Prüfe das Gefälle gegen die bekannten Fallen: Varianten je Modus, je Phase und je Spielart haben 2026 alle out-of-sample verloren, also zählt nur ein klarer und monotoner Unterschied zwischen den Bändern.
> - ☐ **4.** Lege dem User die Frage vor, welches K unbewertete und Turnier-Replays bekommen, bevor irgendetwas in die App geht.
> - ☐ **5.** Führe das Rating nur bei klarem Gefälle in die Anzeige: ReplayData trägt es schon, die Anzeige-Abbildung bekommt es als Parameter, und die Prozentsätze in Zug-Karte und Spielbericht ändern sich.
>   - Dateien: `packages/replay-core/src/types.ts`, `packages/eval-engine/src/winprob.ts`, `packages/eval-engine/src/summary.ts`, `packages/eval-engine/src/report.ts`, `e2e-feedback/corpus.ts`
> 
> **Gate und Erfolg.** Kein Score-Touch: Regret, Swings und Verdikt-Bänder bleiben in wp-Einheiten, nur die angezeigte Prozentzahl ändert sich. Die Schritte 1 bis 3 sind reine Messung ohne Gate; Ergebnis ist entweder ein klares Gefälle oder der gebuchte Beleg, dass eine Konstante ehrlich ist. Geht die Anzeige in die App, gelten die render-only-Gates: Kalibrierung ziffern-gleich, npm run test:regression, e2e, lint, tsc -b, und drei byte-identische Feedback-Läufe nach den Re-Pins, weil die Prozent-Sätze aller sechs Korpus-Replays sich bewegen.
> 
> **Doubles und Singles.** Das Rating steht an jedem Bank-Sample unabhängig von der Spielart, also werden die Bänder je Spielart gezählt und gefittet. Vorsicht: ein eigenes K je Spielart hat schon einmal out-of-sample verloren, deshalb ist die Spielart hier nur Kontrolle, kein zweiter Freiheitsgrad.
> 
> **Offene Entscheidungen (vor dem Bau am User-Gate)**
> 
> - Welches K bekommen Turnier-Replays und unbewertete Spiele, wenn das Rating fehlt?
> - Soll dieselbe Stellung in zwei Replays verschiedene Prozente zeigen dürfen, oder wiegt Wiedererkennbarkeit schwerer als Ehrlichkeit?
> - Reicht das Rating am Replay, oder braucht es das Rating je Seite (Showdown liefert nur eines)?
> 
> **Hintergrund**
> 
> - Q9 der Roadmap (docs/superpowers/plans/2026-09-02-analysis-quality-roadmap.md:252) und Plan-Abschnitt Runde 36+ (docs/superpowers/plans/2026-09-02-perf-and-quality-plan.md:889).
> - H_a: Turnier-Spiele konvertieren Vorteile seltener (gepooltes K 0,87 gegen 1,4 bis 1,9), ein Rating-abhängiger Display-K zeigt starken Spielern ehrlichere Prozente.
> - H_b: der Effekt sitzt im Stratum und nicht im Rating.
> - Heutiger Stand: DISPLAY_K 1,85, gefittet am 11.08. auf einer Zwanzigstel-Scheibe des Fit-Korpus (629 gepaarte d1- und mcts-Scores: d1 1,75, mcts 1,81, auto-geroutet 1,87) und out-of-sample auf dem 826er-Bett benotet (Brier 0,2275 linear auf 0,2207, spät 0,2180 auf 0,1972); die Varianten je Modus (plus 0,0002), phasenlinear (k1 fittet negativ) und je Spielart (Doubles überangepasst, 0,2167 gegen 0,2068) haben alle verloren, eine gemeinsame Konstante war die ehrliche Abbildung.
> - Die Bank trägt seit Runde 34 je Sample das Rating aus dem Replay-JSON (384 bewertete Samples zwischen 1403 und 1831, 137 davon ab 1700, das ist die hq-Schwelle), und der JSONL-Dump schreibt das ganze Sample, also auch das Rating; der Positions-Export tut das nicht.
> - Turnier-Replays von smogtours tragen kein Rating und zählen per Regel als hq.
> - ReplayData hat ein Feld rating, in der App liest es niemand. winPercent speist die Prozentsätze der Zug-Karten, des Spielberichts und der Sieger-Zeile.
> - Kosten laut Roadmap: ein Skript, kein Bench.
> 
> **Code-Belege (Stand dcf9526)**
> 
> - packages/eval-engine/src/winprob.ts:56, DISPLAY_K 1,85 als eine Konstante für alle
> - packages/eval-engine/src/winprob.ts:47, die Fit-Notiz nennt die drei verworfenen Varianten samt Zahlen
> - regression/eval-calibration.spec.ts:3144, jedes Bank-Sample trägt rating oder null
> - regression/eval-calibration.spec.ts:3187, qualityOf setzt hq bei smogtours oder Rating ab 1700
> - regression/eval-calibration.spec.ts:3471, der Dump schreibt das ganze Sample, Rating inklusive
> - regression/eval-calibration.spec.ts:3207, der Positions-Export lässt das Rating weg
> - packages/replay-core/src/types.ts:10, ReplayData.rating existiert und wird nirgends gelesen
> - packages/eval-engine/src/summary.ts:35, winPercent macht die Prozentsätze der Zug-Karte
> - packages/eval-engine/src/report.ts:137, und die des Spielberichts
> 
> **Herkunft.** Alte NextSteps.md (dcf9526): Zeile 39 (Q9).

## Nachtrag Runde 67 (12.10.2026): neue Nummern, die die Prüfung schloss

Am Gate der Runde 67 (11.10.) bekamen die Funde der Spuren die Nummern T146 bis T187; vier frische Prüfer lasen sie am 12.10. gegen den Code (Bericht `docs/perf/probes/2026-10-10-r67/gate/todo-verification.md`). Zwölf Nummern sind damit stillgelegt; nie in NextSteps.md gebucht, der alte Text steht im Entwurf `docs/perf/probes/2026-10-10-r67/gate/new-todos-draft.md`.

- T147 · Status-Treffer gegen Typ-Immunität (zusammengelegt in T146; der Wert stimmte, die Kosten sind verschwendete Ziehungen und ein falscher Quoten-Abgleich)
- T150 · ohko-tie in der Singles-Matrix (zusammengelegt in T146; die Szene ist die Singles-Fixture `ohko-tie`)
- T153 · Tera Starstorm nach dem Klick gegen einen Gegner (zusammengelegt in T152)
- T157 · choice-lock liest die Fähigkeit des Verteidigers (zusammengelegt in T156)
- T164 · Ein Champions-OU-K, das die Suche verträgt (zusammengelegt in T163)
- T165 · Doubles-Blattgewicht und Item-Korrekturen (zusammengelegt in T102 als Lesung; die Erklärung war verkehrt herum: der Score geht zur Seite mit dem stärkeren Gholdengo, die verlor)
- T171 · Supreme Overlord nach verfehltem K.o. (obsolet: 38a2440 liest Supreme Overlord aus der -activate-Zeile; Spur Gs Zählung lief auf ihrem Branch mit Defiant-Kingambits; Sonde auf r67: 2663100395, 2663102863, 913994 zählen wie das Protokoll)
- T173 · Retaliate nach Korrekturen (in die C-Zeile zur Katalog-Stärke; Code-Lücke ohne Korpus-Fall)
- T174 · Fähigkeit aus einer -activate-Zeile (obsolet: 38a2440; 752324 Kingambit liest Supreme Overlord)
- T176 · Reihenfolge-Zählung mit Trick Room (verworfen, falsche Prämisse: der Parser verwirft Reihenfolgen unter Trick Room, keine der 193 lag unter Trick Room; der Befund zu Mega-Fähigkeiten steht in T188)
- T181 · Toxic Spikes als gewürfelter Status (zusammengelegt in T177)
- T183 · Ungetestete Wege der Runde 67 (zusammengelegt in T184)

## Nachtrag Triage vor dem Release (21.10.2026)

Vor dem Release sortierte die Triage alle 52 offenen TODOs nach einer Frage: Sieht ein Nutzer den Fehler in echten Spielen, oder braucht das Release ihn? 21 bleiben auf dem Weg zum Release (Welle 5 mit den Spuren F, H und I, T163, T160, die letzte Welle, T43), 28 parken mit einem Trigger im Abschnitt „Parked“ von `docs/backlog.md`, drei sind hier stillgelegt. Ein TODO, das eine falsche Spielregel nennt, parkt nur. Gate 21.10.2026 „1a 2a 3b“ (3b: der Showdown Companion bleibt als eigenes Projekt nach dem Release geparkt). Tabelle: `docs/perf/probes/2026-10-19-r72/triage/gate-triage.md`.

### T255 · Der lexikalische gen.num-Check

- Urteil: verwerfen
- Grund: ein schwacher Test, keine falsche Spielregel; der Check fängt die ausgeschriebene Form, und keine Nutzer-Szene hängt an der destrukturierten.
- Spielart: beide

**Alter Text in docs/backlog.md:**

> ### T255 · The lexical `gen.num` guard
>
> *Tests · small fix · round 72*
>
> **Problem.** A calculator generation read as the simulator's generation slips past the guard when it is destructured: `test/calc-generation.spec.ts:64-65` matches the text `gen.num` line by line, so `const { num } = calcGen` passes it, and `replay-core/src/replay-format.ts:79` destructures the client's standard `Generation` (`const { num: generation } = battle.gen`) to stay outside it.
>
> **Benefit.** Contributors: the guard catches the calculator's generation by its type, not by its spelling.
>
> **Success.** The guard tells the calculator's generation from the simulator's by type; `replay-format.ts` reads `gen.num` plainly.
>
> **Evidence.** `packages/eval-engine/test/calc-generation.spec.ts:61-68`, `packages/replay-core/src/replay-format.ts:79`.
>
> **Steps.**
> - [ ] A type-aware check (the TypeScript checker or a branded type for the calculator's generation), red on a destructured `calcGen`.

### T200 · Bank-Zeilen aus aufgegebenen Spielen

- Urteil: verwerfen
- Grund: nur Messmethode; kein Nutzer sieht die Gewichtung der Bank-Zeilen, und bis zum Release entscheidet keine Bank-Frage daran.
- Spielart: beide

**Alter Text in docs/backlog.md:**

> ### T200 · Bank rows from games that end in a forfeit
>
> *Measurement · mini round · small · round 69*
>
> **Problem.** The T39 sighting found that 68 of 193 early singles rows of the bank come from games that end in a forfeit. An early state of a forfeited game measures the statics against an outcome that no move decided.
>
> **Benefit.** Measurement: the bank verdict weighs rows by how much they say.
>
> **Success.** Count per family, verdict with and without these rows; decision at the gate.
>
> **Evidence.** `r69/lanes/B/ledger.md:125`, `:139` (68 of 193 early singles rows, 26 of 92 both-wrong rows, 9 of 28 sure ones), `r69/lanes/B/sight-t39.vt.ts` with readers `out/sight-read.mjs`, `out/sight-sum.mjs`, `r69/progress-ledger.md:105`.
>
> **Steps.**
> - [ ] Count per family (singles, doubles, VGC, Champions): rows from games that end in a forfeit, and their share of the rows of the verdict.
> - [ ] Compute the bank verdict with and without these rows (error bars as in round 48), singles and doubles separately.
> - [ ] Decision at the gate: exclude the rows, weigh them less or keep them.

### T185 · Eine tiefere Analyse, klar definiert

- Urteil: verwerfen
- Grund: eine Feature-Idee; nach der Ziellinie vom 21.10.2026 kommen nach dem Release nur Bugreports aus echter Nutzung dazu. Die Watch-Zeile zu 573756 Zug 134 bis 136 wartet seitdem auf einen Nutzerbericht.
- Spielart: beide

**Alter Text in docs/backlog.md:**

> ### T185 · A deeper analysis, clearly defined
>
> *Surface and search · programme · parked*
>
> **Problem.** Gate of round 67 of 10.10. ("5b"): "Think deeper" is dropped. A deeper analysis returns when it is settled what it computes beyond Auto, how long a click waits (click at move 2 in the worker pool since round 67: doubles warm 2.5 s, cold 8.9 s) and how the panel shows its result. The C line on 573756 turns 134 to 136 measures against it.
>
> **Benefit.** App: whoever wants to give more compute time gets a level with a known gain.
>
> **Success.** A definition with budget, wait time and display, measured on the bank.
>
> **Trigger.** The user asks for a deeper level, or a gate needs one.
>
> **Steps.**
> - [ ] Definition: budget against Auto, wait time of a click (measurement as in T111 point 11), display in the panel.
> - [ ] Bank run with the budget; then brainstorming and spec.
