# Next Steps (Stand 20.09.2026, nach Runde 52)

Nur offene Schritte, als priorisierte Checkliste: Die oberste Iteration ist die nächste Sitzung, das oberste offene Kästchen darin das nächste TODO. Jedes TODO nennt das Problem an einer Spielszene und das Erfolgsmaß. Die Umsetzungsschritte jedes TODOs stehen als Checkliste im Backlog-Plan unter derselben Nummer; beim Start einer Iteration wandern sie hierher.

- **Iterationen** bündeln die TODOs einer Sitzung. Eine Iteration wird beim Start zur Runde mit der nächsten freien Rundennummer: Iteration 1 war Runde 46, Iteration 2 war Runde 47, Iteration 2a war Runde 48, Iteration 2b war Runde 49, Iteration 3 war Runde 50, Iteration 4 war Runde 51, Iteration 4a war Runde 52, Iteration 4b wird Runde 53. Score-berührende TODOs derselben Iteration bekommen je ihre eigene Messung (D3), nie eine gemeinsame.
- **T-Nummern** (T01 bis T45) sind feste Namen, vergeben am 18.09. in Prioritäts-Reihenfolge. Wandert ein TODO in der Liste, behält es seine Nummer; ein neues TODO bekommt die nächste freie (ab T69; T46 kam am 18.09. in Runde 46 dazu, T47 bis T51 in Runde 47, T52 und T53 in Runde 48, T54 in Runde 49, T55 in Runde 50, T56 bis T64 in Runde 51, T65 am 19.09. nach deren Gate, T66 bis T68 am 20.09. in Runde 52). „braucht T01“ heißt: T01 muss vorher gelaufen sein.
- **Backlog-Plan** (je TODO: Idee, Schritte mit Dateien, volles Gate, Doubles-Abdeckung, offene Entscheidungen, Zahlen, Code-Belege): `docs/superpowers/plans/2026-09-18-backlog-plans.md`.
- **Erledigtes**: `docs/completed/` nach Gebiet (Index, Eintragsformat und Prozess in `docs/completed/README.md`).
- **Maschinen-Quellen**: Ledger in `regression/eval-calibration.spec.ts`, Pins in `e2e-feedback/corpus.ts`, Memory-Notizen.
- Diese Datei liegt seit 06.09. im Repository; `docs/` bleibt gitignored.

Die Schritte sind ein erster Entwurf vom 18.09. (Code-Stand dcf9526, jeder Code-Beleg per Grep geprüft). Jede Runde bekommt vor dem Bau weiterhin ihr Brainstorming und ihre Spec; die Schritte hier sind deren Startpunkt, und die Spec darf sie ersetzen. Ältere Dokumente nennen Q6 und Q4 gemeinsam „Runde 46“; hier sind es T06 und T09 in den Iterationen 2 und 3.

Hinter jedem Titel stehen Thema, Art, Größe (mini, klein, mittel, groß), Gate (score-berührend = D3, verlustfrei = D4, sonst ausgeschrieben) und „braucht“ = muss vorher gelaufen sein.

## Iteration 4b · Tera in der Statik

Die Sichtung T54 hat aus dem Verdacht eine Runde gemacht. Sie misst auf der Basis, die T56 hinterlassen hat (`.calibration/r52-appbuild`): Zwei Instrumentwechsel kurz hintereinander machen die Bank-Zahlen dazwischen unlesbar.

- [ ] **T57 · Tera in der Statik: Typen lebend lesen** (Endspiel, Runde, mittel, score-berührend D3)

  smogtours-gen9ou-751207 Zug 6: Ceruledge (Feuer/Geist) hat zu Kampf terastallisiert und steht mit einem Viertel Leben da. Die Statik liest weiter Geist und hält Zamazentas Body Press für wirkungslos (0 statt 237 % der KP). 226 der 833 Bank-Stellungen tragen ein terastallisiertes Pokémon auf dem Feld (27 %), in Doubles jede zweite (125 von 248). Sechs Stellen lesen `pokemon.types` roh: `score/threat.ts:165` bis `:168` (Immunität, Typ-Tabelle, STAB), `score/hazards.ts:65` und `:69`, `score/features.ts:26`. Eine Variante mit lebenden Typen bewegt 263 Stellungen (im Mittel 0,024, größter sauberer Abstand 0,249 in VGC 2629703929 Zug 10) und keine der 508 Stellungen ohne Tera. Gegen den Tera-tauglichen Schadensrechner liegt sie in 605 von 711 strittigen Paaren näher; die heutige Statik setzt 50-mal Schaden 0, wo Schaden fällt, die Variante einmal. Fast der ganze Gewinn sitzt im Verteidiger-Typ (424 zu 57), der STAB bringt kaum etwas (90 zu 28).

  Dazu ein zweiter Fehler, der vorher fallen muss: Der Nachbau verliert Tera-Klicks, und zwar nur in eine Richtung. 18 Stellungen in 8 Replays tragen einen Tera-Körper zu wenig, keine einen zu viel. Ursache A: Hat der Slot im Tera-Zug keine `|move|`-Zeile (Zurückzucken, Schlaf, volle Paralyse), fällt `getChoiceForSlot` auf `defaultMoveChoice` (`branch/protocol-choices.ts:253`), und nur die anderen Zweige hängen den Zusatz `terastallize` an (8 von 207 Klicks). Ursache B: Der Simulator löscht `terastallized` beim K. o., und die HP-Korrektur belebt den Körper ohne Markierung wieder (5 Replays).

  Hinweis: Das ergebnisnahe Maß zeigt keinen Gewinn: gepaarter Brier gesamt +6,5 bp ± 7,2, Singles −6,5 ± 16,3, Doubles +45 bp ± 35 (Richtungsmessung auf Tiefe 1 mit einer schlichten Abbildung, kein Verdikt). Gewichte und K sind gegen die blinde Statik gefittet. Die Runde geht als Korrektur mit eigenem Beleg ans Gate (D3, Zusatz für Korrekturen): Beleg ist der Schadensrechner. Vier getrennt gemessene Commits: (1) der Nachbau trägt den Tera-Klick, (2) `pairKey` bekommt den Tera-Term samt Fall in `threat-memo.spec.ts` (der Klick ändert im Sim nur `terastallized`, der Schlüssel ist vorher und nachher zeichengleich; auf dem App-Pfad mit Tera in der Suche ist das heute schon scharf), (3) Verteidiger-Typ lebend, (4) STAB nach den Spielregeln (alter Typ 1,5, Tera-Typ 1,5, beides 2,0; Stellar nach Regel, in der Bank ein Körper von 449). Ein fünfter Commit ist render-only: `null-moves.ts:125` liest die Typen der Dex-Art und kann „immun“ sagen, wo der lebende Körper es nicht ist. Beim Schiedsrichter-Lauf fiel außerdem auf: `ABILITY_IMMUNITIES` kennt Wind Rider nicht (gen9doublesou-2660822493 Zug 2, Hurricane auf Shiftry: Statik 277 % der KP, Rechner 0).

  *Erfolg:* Die 18 Stellungen tragen ihren Tera-Körper (Zählung Log gegen Nachbau 0 zu 0), die Statik setzt auf den Bank-Stellungen keine falsche Immunität mehr (heute 50), keine gepoolte Bank-Zeile zeigt Schaden (D3), die Tier-Zählung hält, und die bewegten Doubles-Urteile der vier Spiele ohne Pins sind gelesen. Fällt die Doubles-Zeile, entscheidet das User-Gate zwischen Übernahme mit Re-Fit (T49, T50, T52) und Parken. *Plan T57:* 9 Schritte, 4 offene Entscheidungen.

## Iteration 4c · Doubles bekommt den Zellenplan

Zwei Sichtungen haben denselben Befund unabhängig gefunden (T10 an den Zellen, T11 an den Dumps). Er steht vor Iteration 5, weil T14, T23 und T24 auf demselben Plan bauen und nach D18 beide Spielarten abdecken müssen.

- [ ] **T58 · Doubles bekommt den Zellenplan: Klassen und K.-o.-Quoten für Paar-Züge** (Zufall preisen, Runde, groß, score-berührend D3)

  VGC-Spiel 2634199230 Zug 5: Mawile klickt Play Rough auf Incineroar. In derselben Matrix fällt Incineroar in einer Zeile und überlebt in der gespielten. Die Engine lobt Kirans Read mit +18 %, während Kiran im selben Zug von 69 auf 48 % fällt und danach aufgibt. `planCellEvents` steigt bei jeder Wahl mit Komma aus (`cell-blend.ts:142`), `koOddsForOptions` ebenso (`:310`), und in Doubles trägt jede Wahl ein Komma (`forward/choices.ts:205`). Gemessen: 0 von 75 565 Wurzelzellen mit Ereignis-Plan (sechs Züge, zwei echte Spiele), und `koOdds` steht in allen fünf Doubles-Dumps 0-mal, in den sechs Singles-Dumps 36- bis 135-mal. Bei einem Seed ist jede Doubles-Wurzelzelle eine einzige Ziehung. Fehlschlag, K.-o.-Wurf und Crit preist die Engine in Doubles also nicht; der Klassenpfad der Singles-Wurzel läuft dort nie. Wie ein Wetterdienst, der für die halbe Stadt nur einmal aus dem Fenster schaut.

  Hinweis: Erster Schritt ist eine Zählung: Wie viele Doubles-Wurzelzellen liegen auf einer K.-o.- oder Fehlschlag-Kante, und was kostet ein Plan mit zwei Ereignis-Slots je Seite? Dieselbe Stelle trägt T14 (Klassen auf Ansage), T23 (Crit) und T24 (Zurückzucken); eine gemeinsame Arithmetik für Paar-Züge erspart drei Nachrüstungen. Der Play-out-Pin läuft zuerst einzeln (D7). Bleibt die Wanduhr der Doubles-Matrix nicht im Rahmen, ist die kleine Variante „mehr Ziehungen auf Kanten-Zellen“ der Rückfall.

  *Erfolg:* Die vier Doubles-Dumps tragen `koOdds`, die gespielte Zelle in 2634199230 Zug 5 preist den K. o. an Incineroar anteilig statt gar nicht, Singles-Dumps und Singles-Zeilen der Bank bleiben ziffern-gleich, die Doubles-Zeilen der Bank stehen in der vorregistrierten Linie, Doubles-Matrixzeit höchstens im vorregistrierten Rahmen. *Plan T58:* 8 Schritte, 3 offene Entscheidungen.

## Iteration 4d · Der App-Bau hält die Zugreihenfolgen

Gefunden in Runde 52 vom neuen Bank-Instrument: Der alte Bau konnte den Defekt nicht sehen. Die App löst seit dem 08.08. zweistufig; seit wann sie genau diese Sets baut, ist nicht gemessen. Die Runde steht hinter 4c, weil der User die Reihenfolge 4a, 4b, 4c am 19.09. bestätigt hat; ob sie nach vorn rückt, entscheidet das Gate der Runde 52.

- [ ] **T66 · Die zweistufige Lösung hält die beobachteten Zugreihenfolgen** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T56)

  gen9ou-2658663776, Zug 86 bis 92: Gliscor zieht viermal vor Volcanion. Sein Substitute steht, bevor Flamethrower trifft, so streckt es Volcanions PP aus, und p1 gibt in Zug 94 auf. Die App baut Volcanion trotzdem mit 252 Tempo-EVs (239) über Gliscors 226. Im Nachbau trifft Flamethrower vor dem Substitute, und die Bank liest +0,99 für p1; der alte Bank-Bau hielt Volcanion bei 176 und las −0,25. Gezählt über die 910 beobachteten Singles-Zugreihenfolgen der 129 Bank-Replays: Der Bau mit einer Lösung widerspricht 10 (8 Replays), der zweistufige 20 (14 Replays). Die Anreicherung ändert daran nichts (10 bleiben 10), die zweite Lösung allein macht aus 10 die 20. Weitere Zeilen: 2663112821 Zug 11 Gholdengo vor Kyurem (eine Lösung 267 gegen 250, zwei Lösungen 219 gegen 250), smogtours-gen9ou-749601 Zug 8 Moltres vor Heatran (279 gegen 278, danach 219 gegen 278), 2663115898 Zug 19 Pecharunt vor Great Tusk (302 gegen 300, danach 219 gegen 300). Doubles: 8 von 267 auf beiden Wegen. Wie ein Protokollant, der beim Abtippen der Reinschrift eine Zeile der Mitschrift verliert.

  Hinweis: Der Hebel ist die zweite Lösung in `solveReplaySpreads` (`packages/replay-core/src/team-builder.ts`): Die Tempo-Vorlösung baut ihre Entscheidungen in die Basis-Sets, die Volllösung rechnet auf dieser Basis weiter. Die Sichtung klärt, an welcher Stelle das gehaltene Tempo verloren geht oder überstimmt wird. Das Schluss-Audit der Runde 52 hat die 13 Zeilen, die nur der neue Bau bricht (7 Replays), gegen das Log gelesen: alle sauber, kein Trick Room, kein Tailwind, keine Paralyse, kein Boost, kein Vorrang. Seine Spur, noch ungemessen: `speedMeasured` (`spread-inference.ts`) wertet eine Zugreihenfolge, die der Prior schon erfüllt, als „misst nichts“, und in der Kette ist der Prior die erste Lösung; `speedError` (`spreads/fit.ts`) rechnet gegen den gerade gültigen Spread des Gegenübers, die Lösung je Körper hängt damit an ihrer Reihenfolge. Der gewollte Tausch aus Runde 41 ist es nicht: `releasedRung` gibt gehaltenes Tempo nur nach unten frei, hier gewinnt Volcanion 252 Tempo-EVs, und Pecharunt, Moltres und Gholdengo tauschen eine Tempo-Natur gegen eine Bulk-Natur. Die Tempo-Rechnung der Zählung kennt Choice Scarf und Iron Ball, aber keine Boosts, keine Paralyse, kein Tailwind und kein Trick Room: Die absolute Zahl ist eine Obergrenze, der Unterschied zwischen den Bauten ist der Befund (`docs/perf/probes/2026-09-20-r52/T56/speed-order-violations.vt.ts` und `speed-order-levers.vt.ts`). Die eine Stellung 2658663776 Zug 86 trägt 8 der 11 bp, um die das neue Bank-Instrument schlechter liest als das alte. Verwandt mit T26 (gehaltenes Tempo gegen gemessene Offensive) und T30 (Widerspruchs-Gate): Vor dem Bau klären, ob eine Spec mehrere davon trägt. Es gilt D8; der Feedback-Korpus baut zweistufig, also Set-Diff der zehn Spiele vor dem ersten Lauf.

  *Erfolg:* Der App-Bau widerspricht höchstens so vielen Zugreihenfolgen wie der Bau mit einer Lösung (heute 20 gegen 10 von 910), die 13 neu gebrochenen Zeilen sind weg, 2658663776 Zug 86 liest wieder für p2, die gepoolte Singles-Zeile der Bank holt den Abstand zum alten Bau zurück (Linie in der Spec vorregistrieren, Größenordnung −10 bp), Doubles bleibt unbewegt, und die bewegten Urteile der Feedback-Dumps sind gelesen. *Plan T66:* 7 Schritte, 3 offene Entscheidungen.

## Iteration 5 · Wurzel: Klassen auf Ansage und Speed-Ties

Alle drei fassen `search/cell-sampler.ts` an: eine Spec, drei getrennt gemessene Commits. T65 ist der kleinste und kam am 19.09. nach dem Gate der Runde 51 dazu. Der Play-out-Pin läuft zuerst einzeln (D7). In Doubles greift beides erst, wenn T58 den Zellenplan für Paar-Züge geöffnet hat (heute 0 von 75 565 Wurzelzellen mit Plan).

- [ ] **T65 · Eine Zuck-Zeile wirft die Zelle nicht mehr auf eine Ziehung zurück** (Zufall preisen, Mini-Runde, klein, score-berührend D3)

  GPL Zug 13, Stone Edge von Hand in Cobalions Set: Die Zelle Air Slash gegen Stone Edge soll Treffer, Fehlschlag und K. o. anteilig mischen. In der ersten Ziehung zuckt Cobalion zurück (Noivern ist schneller, Air Slash lässt zu 30 % zurückzucken). Die `cant`-Zeile lässt `classifyChild` aussteigen (`cell-blend.ts:215`), und `blendCellSample` fällt auf `fallback()` zurück: den Mittelwert über die Basis-Ziehungen, bei einem Seed über genau eine (`search/cell-sampler.ts`). Die Engine schreibt −0,2224 in die Zelle; das Mittel über 400 Seeds ist −0,4339, die Streuung einer Ziehung 0,19. Stone Edge landet auf Platz vier, obwohl dieselbe Zeile „tötet sicher, wenn er trifft“ anzeigt. Wie ein Tester, der das Auto einmal startet, einen Aussetzer erwischt und „springt nicht an“ notiert. Eine gelungene Mischung zieht 12 bis 16 Seeds (`BOUNDARY_DRAW_BUDGET`); der Rückfall soll auf Ereignis-Zellen ebenfalls nachziehen und dann schlicht mitteln.

  Hinweis: Die kleine Schwester von T24. T24 preist das Zurückzucken als eigene Klasse; diese Runde nimmt nur dem Rückfall die Ein-Ziehungs-Lotterie (User-Gate 19.09. 22:46, vorgezogen). Erster Schritt ist eine Zählung: Wie oft feuert der Rückfall über Bank und Feedback-Spiele, und aus welchem Grund (`cant`-Zeile, Reihenfolge nicht beobachtbar, Gewicht 0)? Auf dem ausgelieferten Set von Zug 13 feuert er nie (22 von 22 Ereignis-Zellen mischen). T14 fasst dieselbe Funktion an: eine Spec, getrennt gemessene Commits, der Play-out-Pin zuerst (D7). In Doubles läuft der Zellenplan erst nach T58; bis dahin bewegt diese Runde nur Singles und sagt das im Gate.

  *Erfolg:* Die Zelle Air Slash gegen Stone Edge liegt höchstens 0,1 vom 400-Seed-Mittel (heute 0,21), Stone Edge steht im nachgetragenen Set unter den ersten zwei Zeilen, auf den Dumps bewegen sich nur Züge mit einer Rückfall-Zelle, der Play-out-Pin hält, die Bank bleibt in der vorregistrierten Linie, die Matrixzeit verschränkt gemessen im vorregistrierten Rahmen. *Plan T65:* 7 Schritte, 3 offene Entscheidungen.

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

Fünf kleine Punkte mit einem gemeinsamen Schluss-Gate, vier davon render-only; T59 und T64 kamen in Runde 51 dazu. Prosa ist nur an drei Stellen byte-gepinnt (`summaryIncludes` für 573756 t8, 573756 t73, 562428 t10); die Golden 655336 pinnt keine Prosa.

- [ ] **T18 · Kleine Sätze im Spielbericht aufräumen** (Bericht, Mini-Runde, mittel, verlustfrei D4, braucht T01)

  649664 Zug 3: Der Bericht sagt bei vollen Teams, Medicham-Mega sei einen 90-%-Wurf vom Aufräumen entfernt. 648453: Nach dem Beweis-Satz in Zug 35 sprechen Zug 36 und Zug 39 noch je einen „practically decided“-Satz mit einer anderen Art (vor Runde 50 waren es vier Sätze ab Zug 17). 573756 Zug 75: Der Halter-Satz liest schräg, weil beide Toxapex heißen. Dazu stehen die Reads-Beispiele im Sieger-Pfad nach Auszahlung statt nach Zug, die Hauptvariante zeigt „(waiting)“, und der Odds-Satz rendert in keinem Korpus-Zug mehr. Sechs kleine Prosa-Punkte, ein Gate.

  Hinweis: Die Golden 655336 pinnt keine Prosa (nur keyMoments, misplays, reads, turningPoint); die Runde ist damit billiger, als der alte Text annahm. Seit Runde 50 spricht „practically decided“ nur noch, wenn der Balken die genannte Seite mit mindestens 0,7 stützt (Bank: 54 von 57 gewinnen); der Widerspruch in 653785 („tipped on turn 24“, dann „From turn 23“) ist damit weg, der Bericht sagt „From turn 26 the win was forced“.

  *Erfolg:* Die drei Prosa-Pins (573756 t8, 573756 t73, 562428 t10) stehen unverändert, die Golden-Felder von 655336 bewegen sich nicht, der Dump-Diff zeigt nur `summary`-Felder. *Plan T18:* 9 Schritte, 4 offene Entscheidungen.

- [ ] **T19 · Der offene Crit erklärt die gefallene Bar** (Bericht, Mini-Runde, mini, verlustfrei D4)

  649664 Zug 23: Seit dem Klassenpfad sinkt die bewiesene Masse von 0,92 auf 0,79, weil die Crit-Klasse offen bleibt, und die Bar fällt sichtbar. Der Satz mit dem Vorbehalt „barring a crit“ spricht erst ab 0,9 und schweigt jetzt. Der User sieht eine tiefere Bar ohne Grund.

  Hinweis: Entfällt, wenn T23 (Crit-Klasse) vorher landet.

  *Erfolg:* 649664 t23 trägt einen Satz, der die gefallene Bar mit dem offenen Crit erklärt, kein anderer Korpus-Zug bekommt einen neuen Satz, alle Engine-Zahlen der Dumps bleiben gleich. *Plan T19:* 7 Schritte, 2 offene Entscheidungen.

- [ ] **T20 · Tera-Toggle in die Schadensvorschau des Branch-Pickers** (Oberfläche, Mini-Runde, klein, verlustfrei D4)

  Im Branch-Picker drückt man „Tera (Ice)“ und liest darunter die Schadenszahlen weiter ohne Tera: Der Calc sieht den Tera-Typ erst nach der Ausführung. Genau im Moment der Entscheidung zeigt die Vorschau eine falsche KO-Zahl. Seit der QA-Kampagne im Juli bewusst offen.

  *Erfolg:* Die Vorschau-Zahl springt beim Drücken des Tera-Knopfs und zeigt denselben Wert wie der Calc nach der Ausführung, in Singles und mit zwei Zielen in Doubles. *Plan T20:* 8 Schritte, 3 offene Entscheidungen.

- [ ] **T59 · Kein Lob auf einem verlorenen Zug** (Bericht, Mini-Runde, klein, verlustfrei D4 für die Sätze; ein Kanalwechsel der Abzeichen braucht das User-Gate)

  VGC 2634199230 Zug 5: Die Karte sagt „kirans's read paid off“ und „a read that paid off, +18% over the safe …“, während Kiran im selben Zug von 69 auf 48 % fällt und danach aufgibt. Das Lob steht an fünf Stellen: Abzeichen der Zug-Karte (`eval-badges.ts:24`), Satz (`prose/clauses.ts:14`), Verdikt-Zelle (`eval/SideRow.tsx:131`), Read-Chip und Schlüsselmoment-Abzeichen im Spielbericht (`EvalGameReport.tsx:150` und `:196`). Keine liest den Ausgang des Zugs gegen. Die drei Sätze hängen an `riskPaidOff` und sind render-only, die zwei Abzeichen hängen an der Attribution `p2-read`. Über elf Dumps: 14 gelobte Reads in 329 Zügen, 3 davon auf einem Zug, den die gelobte Seite verliert (einer in Singles: 562428 t11, direkt vor dem gepinnten t12). Kein gepinnter Kanal hängt an einer dieser Zeilen.

  Hinweis: Der Bo3-Verdacht aus dem alten Text ist widerlegt (das Log ist ein Spiel, Showdown schreibt je Bo3-Spiel ein eigenes Replay), das Payoff-Fenster ist unbeteiligt (`riskPayoffTurn` ist nicht gesetzt). Die Ursache der falschen Zelle liegt bei T58; diese Runde hält nur das Lob zurück. `riskPaidOff` hält den Regret heute auch aus den Entscheidungs-Summen (`report.ts:237`) und dem Sieger-Pfad heraus; ein reiner Text-Zuschnitt ändert daran nichts. In Doubles nimmt das Lob für einen nie gesehenen zweiten Slot die günstigste verträgliche Vervollständigung (hier kippt dadurch fast das Wagnis-Tor: 0,39 gegen 0,21 bei Schwelle 0,2).

  *Erfolg:* 2634199230 Zug 5 und 562428 t11 tragen kein Lob mehr, die elf übrigen gelobten Reads behalten ihres, die Pins 573756 t75 und 562428 t12 stehen, alle Engine-Zahlen der Dumps bleiben gleich. *Plan T59:* 6 Schritte, 3 offene Entscheidungen.

- [ ] **T64 · Zweite Zahl im Bericht: Reue gegen den wirklich geklickten Gegenzug** (Bericht, Mini-Runde, klein, verlustfrei D4)

  GPL Zug 13: Gegen Noiverns wirklich geklickten Air Slash wäre Stone Edge 0,12 mehr wert gewesen als Heavy Slam, das ist ein Fehler-Band. Gegen das Gleichgewicht sind es 0,04, weil Noivern dort zu 38 % auf Clefable ausweicht, sobald Stone Edge droht. Die Engine benotet gegen das Gleichgewicht, der User liest den Zug mit dem Wissen, was kam. Eine zweite, klar beschriftete Zahl neben der Reue zeigt beide Lesarten. Wie ein Schiedsrichter, der neben der Regelauslegung auch die Zeitlupe zeigt.

  Hinweis: Entparkt am User-Gate vom 19.09. 22:46. Die Zahl kommt aus der vorhandenen Matrix (Spalte des gespielten Gegenzugs) und fließt weder in das Tier noch in die Summen ein; sonst wäscht das Ergebnis die Note. Ohne Stone Edge im gebauten Set zeigt sie in Zug 13 nur 0,03: Den Tadel zeigt sie erst, wenn der Zug im Set steht (Team-Editor) und T65 die Zelle richtig preist. In Doubles liest sie das gespielte Paar; ein nie gesehener Slot macht sie zur Untergrenze wie beim Regret. Vor dem ersten Code zwei Formulierungs-Muster am User-Gate.

  *Erfolg:* GPL Zug 13 mit nachgetragenem Stone Edge zeigt beide Zahlen nebeneinander, kein Tier und keine Summe bewegt sich, alle Engine-Zahlen der Dumps bleiben gleich, die drei Prosa-Pins stehen. *Plan T64:* 4 Schritte, 2 offene Entscheidungen.

## Iteration 7a · Kleines Werkzeug aus Runde 52

Zwei Minis, die beim Review der Runde 52 aufgefallen sind. Beide sind verlustfrei und teilen sich ein Schluss-Gate.

- [ ] **T67 · Typ-Prüfung für regression/ und ui/** (Werkzeug, Mini-Runde, klein, verlustfrei D4)

  Runde 52: Beide neuen Paritäts-Tests bauten ihr `TeamBuildSources`-Objekt zuerst mit `as unknown as`. Kein Gate hätte gemerkt, wenn dem Objekt ein Feld fehlt: `tsconfig.app.json` prüft nur `src`, `tsconfig.node.json` nur die Vite-Configs, ESLint läuft ohne Typ-Information, und Vitest prüft keine Typen. Ein Probelauf mit einer temporären tsconfig fand einen stehenden Fehler in `regression/eval-calibration.spec.ts` (das `depth`-Argument von `searchPosition` ist `number`, verlangt ist `1 | 3 | 5`). Ein Test, dessen Typen niemand prüft, bleibt grün, während er am geänderten Vertrag vorbeitestet.

  *Erfolg:* `npx tsc -b` deckt `regression/`, `ui/`, `e2e/` und `e2e-feedback/` ab (eigenes `tsconfig.test.json` im selben Gate), die stehenden Fehler sind gezählt und behoben, die Laufzeit des Gates steht in D2, kein Dump bewegt sich. *Plan T67:* 4 Schritte, 1 offene Entscheidung.

- [ ] **T68 · Ein gescheiterter Statistik-Abruf bleibt nicht im Merkzettel** (Oberfläche, Mini-Runde, mini, verlustfrei D4 mit eigenem Test)

  Der User lädt ein Replay und wechselt auf ein zweites desselben Formats, bevor die Nutzungsstatistik da ist. `fetchSmogonUsageStats` legt den Abruf in den Merkzettel, bevor er fertig ist (`src/lib/smogon-stats.ts`, `usageCache.set`), und räumt ihn nach einem Abbruch nicht weg: Der zweite Aufruf bekommt den abgebrochenen Abruf zurück. `fetchSmogonSetAssumptions` löscht einen gescheiterten Eintrag (`src/lib/smogon-sets.ts`, „A failure is never cached“). Aus dem Code gelesen, im Browser noch nicht nachgestellt.

  *Erfolg:* Ein Test in `ui/hooks/useSmogonUsageStats.spec.tsx` stellt den Wechsel nach (erst rot), der zweite Abruf desselben Formats liefert Daten, alle Engine-Zahlen der Dumps bleiben gleich. *Plan T68:* 3 Schritte, 1 offene Entscheidung.

## Iteration 8 · Glückskonto: gewürfelt oder umbewertet

Ein Zähl-Skript beantwortet beide Fragen (T21 und Schritt 2 von T22), danach folgt der Split des Glückskontos.

- [ ] **T21 · Dossier: Folgte der Spieler dem Engine-Favoriten?** (Richter und Bank, Mini-Runde, klein, kein Score-Touch)

  655336: p1 folgte in 10 von 26 Zügen dem Engine-Favoriten, p2 in 11 von 28, p1 gewann. Aus solchen Zahlen lässt sich Zugqualität aus Ergebnissen lesen. Die Zahl ist verzerrt (wer folgt, ist im Schnitt stärker) und bleibt Diagnostik. Ein Lese-Skript über die Dumps, fällig, wenn eine Runde sie ohnehin zieht. Dasselbe Skript beantwortet im selben Lauf die Zähl-Frage aus T22: Wie oft trägt eine chance-Attribution keinen Würfel-Zug?

  *Erfolg:* Die Tabelle steht je Score-Band, die Kopfzeile benennt die Verzerrung; die Zahl wird nie Gate. *Plan T21:* 7 Schritte, 2 offene Entscheidungen.

- [ ] **T22 · Chance ohne Würfel als eigene Klasse ausweisen** (Bericht, Runde, mittel, verlustfrei D4)

  Der Bericht zu 573756 endet mit „The rolls decided it, luck ran LordEnz's way overall (+138%)“. Von diesen 2,76 Punkten tragen die im Protokoll mit einem Marker sichtbaren Würfel 0,03. Der Rest entsteht, weil die Matrix eines Zugs die entstandene Stellung anders bewertet als die Wurzel des Folgezugs (573756 t70 Schwerttanz, Draft t48 U-turn-Read). Der User liest Glück, wo die Engine ihre Meinung geändert hat. Das Glückskonto bekommt zwei Töpfe: gewürfelt und umbewertet.

  Hinweis: Das Gate gilt für Stufe (a), render-only. Stufe (a2) trägt die Klassen-Antwort aus der Suche ins Ergebnis und braucht einen Cache-Bump bei ziffern-gleichen Scores. Stufe (b), der Abgleich des Zellenpreises gegen die Folgewurzel, ist score-berührend und gehört zur Familie T16. Die Zählung aus Schritt 2 ist dieselbe wie in T21: Wer zuerst läuft, legt sie als Sonde ab. VGC 2634199230 Zug 5 ist kein Anker für diese Runde: Die Sichtung T11 (Runde 51) hat dort den Würfel gefunden (die gelobte Zelle zieht den K. o. nicht, T58); der Zug taugt höchstens als Abgrenzung.

  *Erfolg:* 573756 und 653785 verlieren „The rolls decided it“ (Würfel-Deckung 2 % und 26 %, gemessen mit dem schärferen Anker aus Protokoll-Marker oder koOdds der gespielten Zeile), 562428 und 649664 behalten ihre Glückszeile (69 % und 78 %), höchstens vier Zug-Karten wechseln die Klasse, die gepinnten chance-Kanäle 573756 t73 und 649664 t23 bleiben stehen. *Plan T22:* 9 Schritte, 4 offene Entscheidungen.

## Iteration 9 · Crit-Klasse und Zuck-Klasse

Eine gemeinsame Spec für die Klassen-Arithmetik, zwei getrennt gemessene Commits. Dieselbe Maschinerie wie Iteration 5 (`cell-blend.ts`, `search/outcome-children.ts`, `forward/scripted-prng.ts`); der Play-out-Pin läuft zuerst einzeln (D7).

- [ ] **T23 · Crits als eigene Klasse im Zellenplan** (Zufall preisen, Runde, mittel, score-berührend D3, braucht T15)

  Der Zellenplan kennt drei Ausgänge: daneben, Treffer mit KO, Treffer ohne KO. Der Crit steckt nur als Beimischung in der KO-Quote. Deshalb bleiben im Prüfstand 6 von 26 Stellungen ungepreist, und viele Beweise tragen „barring a crit“. 649664 Zug 23: Der offene Crit senkt die Bar von 0,92 auf 0,79.

  *Erfolg:* `healer-burned`, `toxic-stall`, `two-v-one-sack` und `setup-vs-heal` verlieren das Etikett ungepreist, weniger Beweise mit „barring a crit“, Bank und Perf (verschränkt gemessen) in der vorregistrierten Linie. *Plan T23:* 8 Schritte, 4 offene Entscheidungen.

- [ ] **T24 · Zuck-Chance preisen statt würfeln** (Zufall preisen, Runde, groß, score-berührend D3)

  GPL-Spiel DzBQ5azlO5l Zug 15: Noivern (55/161) steht gegen ein frisches Rotom-Wash, Bene wechselt auf Vileplume, die Engine nennt das einen Fehler. Air Slash lässt das Ziel zu 30 % zurückzucken, aber die Engine preist das Zurückzucken nicht als Anteil: Welcher der festen Seeds zieht, entscheidet, ob Rotom in der Rechnung zurückzuckt. Bei einem sicher treffenden Zuck-Zug ohne KO rechnet die Zelle sogar mit einem einzigen Seed. Die Zuck-Chance bekommt denselben Rang wie der Fehlschlag: eine eigene Klasse mit Gewicht.

  Hinweis: Teilt Klassen-Arithmetik und Dateien mit T23 (`cell-blend.ts`, `outcome-children.ts`, `scripted-prng.ts`); eine gemeinsame Spec spart einen Messzyklus. Aus der Sichtung T10 (Runde 51): Eine `cant`-Zeile auf einer Ereignis-Seite lässt `classifyChild` aussteigen (`cell-blend.ts:215`), und die Zelle fällt auf eine einzige Ziehung zurück, wo eine gelungene Mischung 12 bis 16 zieht. GPL Zug 13 mit von Hand nachgetragenem Stone Edge: −0,2224 aus einer gezuckten Ziehung gegen ein Mittel von −0,4339 über 400 Seeds, Streuung einer Ziehung 0,19. Auf dem ausgelieferten Set mischt Zug 13 sauber (22 von 22 Ereignis-Zellen); als Prüfstein taugt er nur mit nachgetragenem Zug, und ein Fehler-Band erzeugt die Zuck-Klasse dort nicht (Reue höchstens 0,052, weil Noivern im Gleichgewicht ausweicht). Die Spec sagt, ob die Zuck-Chance eine eigene Klasse wird (Zelle −0,43) oder die vorhandenen Gewichte sie tragen (−0,54). In Doubles läuft der Plan erst nach T58. Den Rückfall auf eine Ziehung nimmt T65 vorweg; hier bleibt die Zuck-Klasse.

  *Erfolg:* Weniger Zellen fallen wegen einer `cant`-Zeile auf das Seed-Mittel zurück, GPL Zug 15 hängt nicht mehr am Seed, Play-out-Pin hält, Bank in der vorregistrierten Linie. *Plan T24:* 9 Schritte, 5 offene Entscheidungen.

## Iteration 13 · Doubles-Schaden und Item-Achse

Erst das Doubles-Gate, dann die Item-Achse, getrennt gemessen (D8). Der größte Bau bei den Sets: Er bewegt die Doubles-Hälfte der Bank. Die Iteration steht seit dem User-Gate vom 19.09. (Runde 51) vor Iteration 10 und behält ihre Nummer. T30 stand bis dahin als Vorgänger von T31 in der Liste; der Plan nennt dafür keinen harten Grund, nur die Prüfung in Schritt 6 (hängt die Divergenz in 2663100395 und 913990 an der Tempo-Evidenz?).

- [ ] **T31 · Doubles: Schaden messen und richtig rechnen** (Sets und Spreads, Runde, groß, score-berührend D3, braucht T56)

  In Doubles liest der Parser keine einzige Schadensbeobachtung: `protocol-parser.ts:32` lässt nur Singles durch. Die Doubles-Sets der ganzen VGC- und Champions-Hälfte der Bank sind damit reine Usage-Raten, und der Branch tötet Pokémon, die im Replay sichtbar überlebt haben. Dazu sagt niemand dem Schadensrechner, dass Doubles gespielt wird: Der Fit baut sein Feld ohne Spielart (`spreads/fit.ts:152`), die KO-Odds tragen fest Singles ein (`ko-odds.ts:99`). Ein Erdbeben auf zwei Ziele rechnet so ein Drittel zu stark: heute in den KO-Odds, im Fit ab dem Moment, in dem das Gate offen ist. Gezählt in Runde 51 (T13): Der Parser verwirft in den 681 Doubles-Replays des Fit-Korpus 12 620 Schadenszeilen (0 Beobachtungen gegen 44 064 in Singles), und 43 Doubles-Sets verlieren ihre ganze Offensive, weil eine Zugreihenfolge 252 Speed beansprucht und nichts die ungemessene Offensive schützt (gen9doublesou-2661679765 Incineroar, gen9vgc2024regh-2273212502 Pelipper).

  *Erfolg:* Singles-Sets und Singles-Scores bleiben byte-identisch, die Doubles-Zeilen der Bank verbessern sich oder stehen still, nicht mehr Bank-Stellungen mit vorzeitig endender Rekonstruktion. *Plan T31:* 9 Schritte, 5 offene Entscheidungen.

- [ ] **T32 · Band und Specs aus Schaden lesen** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T31)

  Die Schadens-Leiter kann kein Choice Band und keine Choice Specs erkennen, weil das Item fest am gebauten Set hängt. Trifft ein Angriff härter, als jeder EV-Körper erklärt, ist das Item die Erklärung. Die Leiter bekommt eine Item-Achse (Band, Specs, Life Orb, kein Item).

  *Erfolg:* Die Leiter erklärt zu harte Treffer mit einem Item statt mit einem verbogenen Körper, die Handprüfung bestätigt die Items, die Bank steht mindestens still. *Plan T32:* 6 Schritte.

## Iteration 10 · Fitter: Budget auffüllen und Tempo gegen Offensive

Beide Umbauten sitzen in der Leiter des Spread-Fitters; T25 zuerst, weil ein voll aufgefüllter Körper die Sprossen-Wahl verschiebt. Für beide gilt D8: Set-Diffs auf allen drei Pfaden vor der Bank. Am Ende der Sitzung läuft die Kontroll-Aufnahme des Fits über Nacht. Iteration 13 (T31, T32) steht seit dem User-Gate vom 19.09. davor: Ohne Doubles-Schaden ist jede Doubles-Zeile der beiden Runden per Konstruktion 0.

- [ ] **T25 · Budget auffüllen, auch unter gemessenen Stats** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T56, T31)

  Wenn das Log die HP misst und eine Verteidiger-Beobachtung den Bulk als uninvestiert liest, gelten HP, Def und SpD als gemessen. Die Auffüll-Regel lässt gemessene Stats stehen, der Rest des Budgets bleibt liegen: Im Fit-Korpus tragen 6151 Körper weniger als 300 von 508 EVs, 222 davon mit 0 Offensive. Im Branch steht dann ein dünnerer Körper als im Replay. Eine gemessene 0 soll heißen: auffüllen, solange der Fit-Fehler nicht steigt. Neu gezählt in Runde 51 (T13, nackter Pfad, heutiger master): Die flache Elle „unter 300 EVs“ mischt drei Budgets (6129 Körper, darin 3902 Champions-Sets, die bei 66 EVs Budget die 300 nie erreichen). Mit dem Budget des eigenen Formats (`spreads/ev-budget.ts`) lassen 5984 von 17 267 Singles-Sets, 13 von 4298 Doubles-Sets und 3890 von 3902 Champions-Sets Budget liegen; die 3890 Champions-Sets stehen alle ohne Offensive da.

  *Erfolg:* Weniger Körper unter dem Budget ihres Formats (getrennt nach Singles, Doubles und Champions), der Fit-Fehler steigt bei keinem Set, Bank in keiner Phase schlechter als die vorregistrierte Linie (früher Brier als benannte Nebenfrage). *Plan T25:* 9 Schritte, 3 offene Entscheidungen.

- [ ] **T26 · Gehaltenes Tempo gegen gemessene Offensive, zweiter Anlauf** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T56, T31)

  smogtours-gen9ou-750267: p2 Weavile steht mit Jolly 0/0/0/0/0/252 (Prior Jolly 0/252/0/0/4/252), obwohl das Log 41 Schadens-Beobachtungen trägt: Eine erfüllte Zugreihenfolge hält sein Tempo, und die Leiter gibt es nur frei, wenn der Angriffs-Anspruch selbst gekappt wurde. Dazu sperrt `keepNature` jede Sprosse mit eigener Natur, also auch Adamant, die den Schaden 10 % besser träfe. Die weite Lesart aus Runde 41 (Branch `r41-wide`) holte 186 Offensiven zurück, kostete aber 162 Körper ihr Tempo. Gesucht ist ein schärferer Auslöser. Aus der Sichtung T13 (Runde 51): Der Fall lebt auf dem Bau mit Nutzungs-Prioren (Bank-Bau und App-Bau sind für 750267 und den zweiten Weavile in 751382 gleich). Dort sperrt `keepsNature` 25-mal über die 129 Bank-Replays, und der Löser hungert 57 Singles- und 4 Doubles-Sets aus. Auf dem nackten Fit-Korpus kann die Sperre nie feuern, weil dort jeder Prior Hardy ist; er dient nur als Mengen-Kontrolle (Tempo-Familie: 200 Singles, 1 Doubles). Ein reiner Abstands-Auslöser trägt nicht: Nur 18 von 174 Zeilen verlieren ihre Offensive um höchstens 0,5 Prozentpunkte einer HP-Leiste, der Median liegt bei 3,77.

  *Erfolg:* Mehr zurückgeholte Offensiven als die engen 20, höchstens eine Handvoll Tempo-Verluste statt 162, Bank spät nicht schlechter als die +9 bp hq der weiten Lesart. *Plan T26:* 9 Schritte, 3 offene Entscheidungen.

## Iteration 10a · Re-Fit-Kandidaten aus Runde 47

Drei Kandidaten, die Runde 47 gemessen und nicht übernommen hat, dazu T52 aus Runde 48. Das Verdikt mit Bändern (T47) liegt seit Runde 48 vor. Sie stehen hinter den Fitter-Runden, weil deren Kontroll-Aufnahme die Gewichte ohnehin neu liest.

- [ ] **T49 · Boost-Gewicht, das weiß, ob der Boost beißt** (Re-Fit, Runde, mittel, score-berührend D3)

  573756 Zug 20: LordEnz' Toxapex klickt Knock Off in die verbrannte Clefable, ein PP-Krieg. Mit dem gefitteten Boost-Gewicht 39 (heute 12) nennt die Engine das einen Fehler („safer was switching to Landorus-Therian“) und wiederholt das Urteil über vierzig Züge: 573756 geht von 14 Ungenauigkeiten und 0 Fehlern auf 40 und 7, die fünf anderen Korpus-Spiele bleiben ruhig. Die Bank mag das Gewicht (hq Singles −4/−27/−5 bp, Singles Mitte voll −43 bp mit Band [−74, −12], im Fit-Korpus außerhalb der Stichprobe bestätigt). Ein stehender Boost ist im Schnitt viel wert, aber die statische Bewertung fragt nicht, ob er gegen die Wand gegenüber etwas bringt (Unaware, Haze, Phazer, ein Wall, der den geboosteten Treffer trotzdem hält).

  *Erfolg:* Das Boost-Feature zählt eine Stufe nur so weit, wie sie gegen die lebenden Gegner etwas ändert; mit dem neu gefitteten Gewicht hält die Bank den Gewinn der Mitte, und die Tier-Zählung der sechs Feedback-Dumps bleibt bei höchstens 45 Ungenauigkeiten und 3 Fehlern (Stand 38 und 2). *Plan T49:* 7 Schritte, 3 offene Entscheidungen.

- [ ] **T50 · Doubles-Gewichte je Format, zum gemeinsamen Wert gezogen** (Re-Fit, Sichtung, klein, kein Score-Touch)

  Die Frage des Users vom 18.09.: Lohnen eigene Werte je Format? Für K nein (je Format −6,2 bp außerhalb der Stichprobe, je Quelle −2,2 bp, je Generation −1,3 bp; selbst mit perfektem Rückblick wären es 3,9 bp). Frei gefittete Gewichte je Format verlieren klar (Singles +120 bp, Doubles +107 bp). Ein Kandidat überlebt: Doubles-Gewichte je Format, zum gemeinsamen Vektor hin geschrumpft („jedes Format bekommt seinen Wert, wird aber zur gemeinsamen Mitte gezogen, je weniger Daten es hat“), −4,2 bp Brier auf 7 von 8 Seeds. Zwei Dämpfer: Die Schrumpfstärke wurde auf den Testdaten gewählt, und die Bank hält nur 197 Doubles-Stellungen aus 36 Replays.

  *Erfolg:* Die Schrumpfstärke kommt aus einer inneren Kreuzvalidierung, der Gewinn steht mit Band da, und die Sichtung sagt mit einer Zahl, ob 36 Doubles-Replays für ein Bank-Verdikt reichen. *Plan T50:* 5 Schritte, 2 offene Entscheidungen.

- [ ] **T51 · Prozent-Anzeige, die mit dem Spielverlauf sicherer wird** (Bericht, Runde, klein, verlustfrei D4 mit Re-Pins)

  Die Prozentzahl über dem Balken rechnet mit einer Konstante (`DISPLAY_K` 1,85). Neu gefittet wäre sie 2,22 und verliert auf der Bank früh (+38 bp, spät −66). Eine Anzeige, die mit dem Anteil gefallener Pokémon steiler wird (1,93 + 0,92 × Anteil, trainiert auf 680 Fit-Korpus-Stellungen), gewinnt auf der Bank gesamt −17 bp, spät −68, beste Spiele −29, glücksbereinigt −41 und verliert früh +16 (beste Spiele früh +9). Im August fittete dieselbe Steigung noch negativ. Ein eigener Wert je Spielart verliert dagegen (+13 bp).

  *Erfolg:* Die Phasen-Variante hat ein Verdikt mit Band (Tabelle aus `scripts/paired-calibration.mjs`); bei Übernahme liegen die bewegten Prozent-Sätze der sechs Feedback-Dumps dem User gesammelt als Re-Pins vor, und alle Engine-Zahlen der Dumps bleiben gleich. *Plan T51:* 6 Schritte, 2 offene Entscheidungen.

- [ ] **T52 · Urteils-Schwellen, die nicht an K hängen** (Re-Fit, Runde, mittel, score-berührend D3)

  655336 Zug 23: BKC opfert Landorus mit 8 % HP, der Bericht nennt das einen „low-cost trade“. Mit dem in Runde 48 gefitteten Singles-K (steigt bis ein Drittel gefallener Körper, dann flach bei 3,65; Fit-Korpus −4,1 bp in 20 von 20 Seeds, Bank ohne Schaden) wird derselbe Zug ein Blunder (Regret 0,215 → 0,430), Zug 18 bekommt einen Fehler, und früh verschwinden Urteile (573756 Zug 19 bis 22). 36 von 279 Zügen wechseln Urteil oder Einordnung. Ursache: Die Schwellen 0,1 / 0,2 / 0,4, `HEALTHY_SACK_FLOOR` 0,4 und `PROVER_SCORE_FLOOR` 0,6 sind in Gewinnprozent gemessen, und Gewinnprozent hängt an K. Ein neues K eicht das Thermometer neu und lässt die Fiebergrenze stehen.

  *Erfolg:* Eine Sichtung zeigt, welche Schwellen an K hängen und wie sie sich unter dem gedeckelten K verschieben; die Schwellen sind danach K-unabhängig definiert oder werden mit K gemeinsam eingestellt, sodass die Tier-Zählung und die Urteile der Golden 655336 unter dem neuen K halten. Erst dann gehen die K-Kandidaten der Runde 48 (Singles gedeckelt 1,548 + 6,007 × min(Anteil, 0,35); Doubles 1,99/3,67) erneut ans Gate. *Plan T52:* 6 Schritte, 3 offene Entscheidungen.

## Iteration 11 · Kleine Set-Punkte

T27 bewegt keine Sets und ist verlustfrei. T28 und T29 sind score-berührend und werden getrennt gemessen; für T28 gilt D8. T60, T62 und T63 kamen in Runde 51 dazu, jede mit eigener Zählung vor dem Bau.

- [ ] **T27 · Sensitivitäts-Etikett stabil machen** (Sets und Spreads, Mini-Runde, klein, verlustfrei D4)

  648453 Zug 13: Ein Lauf schreibt, das Urteil hänge an Landorus-Therians Choice Scarf, der nächste nennt Keldeos Choice Scarf. Die Zahlen darunter sind gleich (0,070 und 0,323). Die Sondenliste entsteht aus den gelösten Sets, und die landen asynchron aus dem Worker: Wer zuerst da ist, gibt dem Urteil den Namen. Gemessen in Runde 51 (T12): Die Sondenliste ändert sich zwischen dem Stand vor und nach der App-Lösung (648453: 6 auf 5 Ziele, Landorus-Therian fällt weg, sobald sein Schal inferiert ist; 573756: 2 auf 1; über die Bank-Replays 499 auf 491 in Singles, Doubles 338 auf 338). In welcher Reihenfolge der Worker die Lösungen liefert, hat noch niemand gemessen.

  *Erfolg:* Dasselbe Replay liefert in fünf Läufen dasselbe Etikett, der Byte-Vergleich läuft mit `graph.sensitivity`, kein gepinnter Kanal bewegt sich ungefragt. *Plan T27:* 7 Schritte, 2 offene Entscheidungen.

- [ ] **T28 · Sets mit weniger als vier Zügen: Ursache finden** (Sets und Spreads, Mini-Runde, klein, score-berührend D3, braucht T56)

  573756: Magnezone bekam in Runde 33 nur drei Züge (das Choice-Set gewinnt, das Kohärenz-Veto streicht Toxic). Im Branch fehlt der Suche damit eine Option. Der Builder rückt nach einem Veto aber schon nach: `assembleMoves` filtert den ganzen Pool und schneidet erst danach auf vier. Unter vier Zügen bleibt ein Set nur, wenn der gefilterte Pool selbst zu klein ist. Zuerst prüfen, ob das Symptom unter dem seit Runde 37 inferierten Scarf noch besteht, dann zählen, wo der Pool zu klein ist und warum.

  *Erfolg:* Die Ursache jedes Sets mit weniger als vier Zügen ist benannt (Pool zu klein, Format ohne Nutzungsstatistik, Veto-Kette); nach dem Umbau gibt es solche Sets nur noch bei leerem Pool, die Bank steht mindestens still. *Plan T28:* 6 Schritte, 2 offene Entscheidungen.

- [ ] **T29 · Engine-Preis für Choice-gebundene Cleaner** (Sets und Spreads, Runde, mittel, score-berührend D3, braucht T01)

  750540: Darkrai trägt wirklich ein Choice Scarf. Mit dem richtigen Set kippt Zug 18 von 0,11 auf 0,58 zum Verlierer; dieses eine Spiel trägt 0,238 der 0,364 Punkte, mit denen Runde 37 ihre Bank-Linie verfehlte. Die Engine bucht beim Choice-Träger fast nur den Preis (gesperrte Status-Züge, Lock) und kaum den Nutzen (Tempo). Ein richtiges Set darf die Bewertung nicht verschlechtern.

  *Erfolg:* 750540 gibt den Zug-18-Sprung ab, die späte hq-Linie verbessert sich oder steht still, und der Gewinn hängt nicht wieder an einem einzigen Spiel. *Plan T29:* 9 Schritte, 2 offene Entscheidungen.

- [ ] **T60 · Phantom-Siebter aus der Mega-Wechselzeile** (Sets und Spreads, Mini-Runde, klein, score-berührend D3)

  VGC 2634199230: Kirans Floette-Eternal entwickelt sich zur Mega-Form, das Log schreibt `|switch|p2b: Floette|Floette-Mega`, und `inferOpponentTeam` nimmt „Floette“ als siebte Art auf, obwohl Vorschau und Team-Sheet je sechs nennen. Kiran wird mit sieben Körpern bewertet, wb_vg mit sechs, und die Matrix trägt die Spalte „→ Floette-Eternal“ doppelt. Dieselbe Klasse wie der Formen-Marker aus Runde 45 (36 Bank-Seiten, spät −252 bp).

  *Erfolg:* Eine Zählung nennt die betroffenen Seiten in Bank, Fit-Korpus und Feedback-Spielen; danach baut jede Seite höchstens so viele Körper, wie die Vorschau nennt, und die Bank steht mindestens still. *Plan T60:* 5 Schritte, 2 offene Entscheidungen.

- [ ] **T62 · Das Vorschau-Häkchen ist kein bekanntes Item** (Sets und Spreads, Mini-Runde, mini, braucht T56)

  648453: Die Team-Vorschau eines gen6-Logs trägt je Pokémon ein Häkchen „hat ein Item“. `addFromPreview` schreibt daraus `(has item)` mit der Quelle `revealed` (`inference/handlers.ts:138`), und `speedKnowledgeFor` hält das Item damit für bekannt (`team/inferred-items.ts:20`). Auf rohen Infos darf die Scarf-Inferenz der Runde 37 deshalb nicht feuern; nimmt man das Häkchen weg, trifft der Löser genau die zwei Entscheidungen des App-Pfads. 22 von 1069 Singles-Pokémon tragen das Häkchen, alle in den vier gen6ou-Spielen des Feedback-Korpus; ein Ergebnis ändert es in einem Replay. Die Bank sieht nichts davon (kein gen6-Replay, in gen9 ist die Spalte nie gefüllt), und der App-Pfad ersetzt den Platzhalter beim Anreichern.

  *Erfolg:* Rohe und angereicherte Infos treffen dieselben Item-Entscheidungen (heute 9 gegen 11 in Singles, 2 gegen 2 in Doubles); kein Feedback-Dump bewegt sich. *Plan T62:* 4 Schritte, 1 offene Entscheidung.

- [ ] **T63 · Auffüllen nach der gesehenen Angriffsseite** (Sets und Spreads, Mini-Runde, klein, score-berührend D3, braucht T56)

  GPL DzBQ5azlO5l: Clefable zeigt Moonblast und bekommt Knock Off aufgefüllt, Iron Valiant zeigt Knock Off und bekommt Moonblast. In Doubles sieht Landorus-Therian U-turn und Rock Slide und bekommt Tera Blast. `assembleMoves` füllt aus den zehn meistgenutzten Zügen (`team/set-resolvers.ts:16`), ohne auf die gesehene Angriffsseite zu achten: 3 von 18 Singles-Sets und 3 von 37 Doubles-Sets mit eindeutig physischer oder spezieller Spur bekommen einen Füller der Gegenseite.

  Hinweis: Cobalion aus T10 ist kein Fall davon. Seine Füller sind Status-Züge (Stealth Rock 96,5 %, Taunt 65,3 % in gen9ou; Custom Game fällt auf gen9ou zurück), und die Regel würde dort Body Press und Iron Head bauen. Stone Edge steht mit 0,35 % auf Rang 19; dass er fehlt, ist eine Grenze der Rekonstruktion. Die Evidenz ist dünn (sechs Sets, keine Bank-Zahl): erst Set-Diffs auf allen Pfaden (D8), dann entscheiden, ob sich eine Runde lohnt.

  *Erfolg:* Die Zählung über Bank und Fit-Korpus sagt, wie viele Sets die Regel bewegt; bewegt sie genug, steht die Bank nach dem Umbau mindestens still. *Plan T63:* 5 Schritte, 2 offene Entscheidungen.

## Iteration 12 · Tempo-Evidenz

Vier Regeln, je Regel ein eigener Branch-Bench: eine Sitzung für sich. Es gilt D8.

- [ ] **T30 · Tempo-Evidenz: Item-Zeitraum, Bremsen, Widerspruchs-Gate** (Sets und Spreads, Runde, groß, score-berührend D3, braucht T56)

  939635: Zapdos-Galar verliert sein Scarf durch Knock Off, und die Engine liest aus dem Rennen ein Scarf für Landorus heraus, das es nie gab. Der Parser wirft deshalb jedes Rennen weg, das ein Item-Wechsel berührt (260 Paare im Fit-Korpus). 2663107495: Gholdengo zieht in Zug 1 vor Ogerpon-Wellspring und in Zug 10 dahinter; die erste Beobachtung entscheidet, das Panel zeigt ein Scarf auf Hardy 60 Spe. Das Item wird ein Zustand mit Zeitraum, Brems-Items (Iron Ball, Lagging Tail, Macho Brace, Power-Items) bekommen ihre Spiegel-Regel, Quick Claw wird als Item gelesen, und bei Widerspruch enthält sich die Inferenz.

  *Erfolg:* Weniger weggeworfene Rennen als die heutigen 260 (Schwelle in der Spec vorregistrieren), 939635 Landorus verliert das falsche Scarf, 2663107495 Gholdengo bekommt keine Entscheidung, hq spät steht mindestens still; Handprüfung von je fünf Scarf-in- und Scarf-out-Zeilen gegen das Log. *Plan T30:* 9 Schritte, 3 offene Entscheidungen.

## Iteration 14 · Endspiel-Statik

Die exakten Bank-Werte aus dem Nachtlauf der Runde 47 liegen vor (5 exakt, 11 voll aufgeklappt; Nachschlagen mit `EVAL_ENDGAME_SOLVED`). T34 ist ein Mini am selben Beweiser-Pfad und wird getrennt gemessen.

- [ ] **T33 · Rennen-Statik: PP, Körper ohne Angriff, Deckel, Priorität** (Endspiel, Runde, groß, score-berührend D3)

  Zapdos mit einem PP Thunderbolt gegen Toxapex mit Recover: Löser −0,995, Statik +0,36. Chansey mit Seismic Toss gegen Gengar: Löser −1, Statik und Matrix 0,0. Zwei Wände ohne Angriffszug gegen Garchomp: Statik +0,64, Wahrheit −1. Level 100 gegen Level 30: 0,9 statt 1,0. Die Statik soll wissen: Leere Angriffs-PP heißen kein Schaden, ein Körper ohne Angriffszug gewinnt nichts, und wo nur eine Seite Schaden macht, ist das Rennen entschieden.

  Aus dem Nachtlauf der Runde 47: 749828 Zug 23, Primarina (98/364) gegen Rillaboom (65/341) im Grassy Terrain. Die Statik liest +0,6 für Primarina, der Decided-Sweep nennt p1, Suche, Beweiser und Spielausgang sagen p2. Ursache ist `movesFirst` (`packages/eval-engine/src/speed.ts`): Ein Prioritätszug schlägt das Tempo und verleiht den Erstschlag dem besten Zug der Seite, und gelesen wird nur die Dex-Priorität. Primarinas Aqua Jet zählt, Rillabooms Grassy Glide (Priorität erst durch das Terrain) nicht. Auf den 11 voll aufgeklappten Stellungen des Nachtlaufs trifft die Statik 9 Vorzeichen, jede Suche 11. Dieselbe Leihe steckt in der Decided-Erkennung (`score/unanswered.ts`): Runde 50 hat den ehrlichen Erstschlag dort als Sonde gezählt (Tempo entscheidet, gegnerische Priorität nimmt den Erstschlag, eigene Priorität zählt nur, wenn der Prioritätszug selbst tötet). Die Quote der genannten Seite steigt in Singles von 78,5 auf 83,6 %, 5 Verluste und 5 richtige Nennungen fallen weg (`docs/perf/probes/2026-09-19-r50/decided-levers.vt.ts`, Schalter `honestFirst`). Die Roh-Erkennung nennt in 749828 Zug 23 weiter p1 (`packages/eval-engine/test/decided-held-positions.spec.ts` hält das fest): Das ist der rote Test dieser Runde. Eine Änderung dort ist score-berührend, weil die genannte Seite den Beweiser startet. Ein Bank-Verdikt für die Statik bleibt außer Reichweite (5 exakte Bank-Stellungen); der Prüfstand bleibt das Instrument.

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

- [ ] **T37 · Choke-Erkennung prüfen: drei Proben vor dem Richter** (Richter und Bank, Sichtung, mittel, kein Score-Touch)

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

- [ ] **T42 · Q7 · Doubles-Feld-Paar und bessere Zielwahl** (Q-Runden, Runde, mittel, score-berührend D3, braucht T01, T07, T57, T58)

  In Doubles trifft die Engine nur sieben von zehn Vorzeichen, früh liest sie 29 von 67 Stellungen sicher falsch. Der Matchup-Term rechnet jedes Mon einzeln; dass zwei Slots dasselbe Ziel abräumen, sieht die Suche nicht, und Follow Me zählt wie jeder Status-Zug. Geplant sind Hinweise für Doppel-Fokus, Umlenkung und Protect-Tempo, dazu ein Feld-Paar-Feature bei Gewicht 0.

  Hinweis: Der Feedback-Korpus trägt keine Doubles-Pins; die vier Doubles-Spiele ohne Pins liefern Dumps, die sich bewegen würden (Tier-Zählung, D21). Die Evidenz kommt aus der Bank. Vorher landen T57 und T58: In jeder zweiten Doubles-Bank-Stellung steht ein terastallisiertes Pokémon mit falsch gelesenem Typ (125 von 248), und die Doubles-Wurzel preist keinen K. o. (VGC 2634199230 Zug 5). Ein Feld-Paar-Term, der davor gemessen wird, misst beide Fehler mit.

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

- [ ] **T55 · Score-Klammer unter zwei Schlüsseln** (Endspiel, Geparkt, klein, score-berührend D3)

  573756 Zug 137: Satz und Balken nennen beide LordEnz, der Balken zeigt 84 %. Auf der Bank gewinnt die genannte Seite in solchen Stellungen 54 von 57 Mal (94,7 %), der Balken verspricht dort im Schnitt 88,8 %. Gleich hohe Balken ohne gehaltenen Sweep gewinnen 84,3 % bei versprochenen 86,6 %. Eine Klammer würde den Score auf einen festen Wert heben, sobald der Sweep gehalten ist. Vorab gerechnet in Runde 50 auf `.calibration/r49-fullkey`: Klammer 0,85 unter der Halte-Regel bewegt den späten Brier von 0,1223 auf 0,1221, also 2 bp bei einer Auflösung von 23 bp; eine Klammer auf jede entschiedene Stellung kostet 182 bp (wie Runde 15). Geparkt, bis die Bank mehr gehaltene Stellungen trägt oder eine Runde die Anzeige in entschiedenen Stellungen ohnehin anfasst.

  *Plan T55:* 4 Schritte, 2 offene Entscheidungen.

## Themen-Übersicht

Wer an einem Thema arbeitet, findet hier die verwandten TODOs.

| Thema | TODOs |
| --- | --- |
| Werkzeug | T43, T67 |
| Bericht | T17, T18, T19, T22, T36, T44, T51, T59, T64 |
| Re-Fit | T49, T50, T52 |
| Endspiel | T33, T34, T55, T57 |
| Sets und Spreads | T25, T26, T27, T28, T29, T30, T31, T32, T60, T62, T63, T66 |
| Zufall preisen | T14, T15, T16, T23, T24, T35, T58, T65 |
| Oberfläche | T20, T68 |
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

| Gap | Stand 19.09. | Bearbeitet in |
| --- | --- | --- |
| 573756 t68 (seit Runde 32) | Knock Off liest ohne Fehler-Band (Regret 0,0735). Der Opfer-Satz fehlt, weil ohne Band kein Opfer-Stempel entsteht; der Floor-Riss liegt bei 0,054. | T17 |
| 573756 t73 (seit Runde 32) | chance und Key Moment sind seit Runde 40 gepinnt (dbffb5f). Offen ist die Bar vor dem Wurf: 19,5 % gegen 8,7 % des gespielten Paars. Der Pin trägt diese Hälfte weiter im `desired`. | T16 |
| 648453 t13 (seit Runde 33) | HP Ice liest inaccuracy (Regret 0,1288), kein Mistake mehr. Offen ist p2-read für BKCs Lopunny-Wechsel. Das Sensitivitäts-Etikett wackelt zwischen Läufen. | T17, T27 |
| 653785 t19 | Die Null-Zug-Hälfte steht seit Runde 5. Offen (User 18.09.): der Hazard-Sack. 3d wechselt das todgeweihte Weavile in die Stealth Rocks, Flare Blitz geht ins Leere, Lopunny-Mega kommt gratis rein; die Engine liest quiet und empfiehlt Tornadus-Therian in den Flare Blitz. | T17 |
| 649664 t23 | observed steht seit Runde 42 auf chance. Die Bar liest 0,79 statt 0,92, weil der Crit offen bleibt. Der Odds-Satz rendert in keinem Korpus-Zug mehr. | T19, T23, T18 |
| Draft-Spiel t48, 573756 t70 | Chance-Buchung ohne Würfel: Der Read-Payoff verpufft (t48), die Setup-Auszahlung kommt eine Bewertung zu spät (t70, liest heute quiet mit −0,145). | T22 |
| VGC Bo3 2634199230 t5 | Nachgestellt in Runde 51, zwei byte-gleiche App-Läufe. Das Lob steht an fünf Stellen; Attribution `p2-read`, `riskPayoff` +0,35 (+18 %), kein Payoff-Fenster, kein Bo3-Lesefehler. Kiran fällt im Zug von 69 auf 48 %. Ursache: Die gelobte Zelle zieht den K. o. an Incineroar nicht, eine Zeile weiter oben fällt er. | T58, T59 |
| GPL DzBQ5azlO5l t13, t15 | t13: Heavy Slam liest ohne Fehler-Band (Reue 0,034 im Browser, 0,028 mit von Hand nachgetragenem Stone Edge). Drei Dinge müssten zusammenkommen: Stone Edge fehlt im Set (gen9ou 0,35 %), die Zelle Air Slash gegen Stone Edge steht auf einer einzigen gezuckten Ziehung, und der Maßstab ist das Gleichgewicht (deckelt die Reue bei 0,052). t15: Vileplume-Wechsel als Fehler wegen ungepreister Zuck-Chance, nicht angefasst. Fixture `e2e/fixtures/gpl-replay-DzBQ5azlO5l.html`. | T24, T63, T64, T65 |
| 648453 Set-Stand | Geklärt in Runde 52: Die Handprüfung stützt den App-Bau (Landorus-Therian mit Choice Scarf, 330 gegen 278). Zug 6 zeigt Volcanions Leftovers (Knock Off), der alte Bank-Bau gab ihm trotzdem den Schal; gegen den Schal bei Landorus-Therian spricht keine Zeile. Zug 12 ist die einzige Tempo-Beobachtung, Zug 22 ist ein Wechsel. Auf rohen Infos steht das Vorschau-Häkchen `(has item)` dem gesehenen Item im Weg; das bleibt bei T62. | T62 |
| smogtours-gen9ou-750267 Weavile | Steht mit Jolly 0/0/0/0/0/252 bei 41 Schadens-Beobachtungen und 11 Zugreihenfolgen: Die erfüllte Reihenfolge hält das Tempo, das Budget zahlt es aus dem Angriff. Bank-Bau und App-Bau gleich. | T26 |
| smogtours-gen9ou-751207 t6, VGC 2629703929 t10 | Tera in der Statik: Ceruledge (Tera Kampf) gilt weiter als immun gegen Body Press; Koraidon (Tera Feuer) liest −0,645 statt −0,396. | T57 |

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

- [ ] Der Set-Rückfall für Doubles und VGC ist fest auf Gen 9 verdrahtet (`src/lib/smogon/format-fallback.ts`): Ein Doubles-Replay vor Gen 9 bekäme Gen-9-Sets. Heute ist jedes Doubles-Replay in Bank, Fit-Korpus und Feedback-Lauf Gen 9 → handeln, bevor ein älteres Doubles-Spiel in eine Messung kommt.
- [ ] Ein neuer Live-Zugriff in `pairThreat` oder `singleMoveFraction` braucht seinen Schlüssel-Term in `pairKey` (Runde 49: HP, Typen und Basiswerte fehlten, Doubles-Zellen wichen von Lauf zu Lauf ab) → bei jeder Änderung an `score/threat.ts` den Test `threat-memo.spec.ts` um den neuen Zugriff erweitern. Der Schlüssel trägt die rohen Typen und keinen Tera-Term: Sobald ein Blatt die lebenden Typen liest, braucht er ihn (T57).
- [ ] `detectSacks` liest die Snapshot-HP der Bank, also die letzte Sichtung, und kennt Regenerator nicht (649664 t9: „sacked Tornadus (3% HP)“, wahr 36 % nach der Heilung) → handeln, wenn ein Sack-Satz eine falsche HP nennt, die ein User reklamiert; Hebel: dieselbe Regel wie `benchHpFromSighting` in `branch/corrections.ts`.
- [ ] Das Gegnermodell liest eine Doubles-Paar-Zeile nur am ersten Slot (`isSwitchChoice` in `opponent-model.ts`); in Doubles wird es deshalb selten sicher (Favorit ab 0,6 auf 10 von 496 Seiten) → handeln, wenn der Read in Doubles gebraucht wird (T42).
- [ ] 573756 Zug 134 bis 136: Die Decided-Erkennung nennt seit Zug 92 die richtige Seite, der Balken steht bei 0,33 bis 0,60, weil die Suche den Struggle-Plan über zwölf Plies nicht ausrechnet. Seit Runde 50 schweigt der Satz dort bis Zug 137 → in T33 mitlesen: Steht der Balken ab Zug 134 bei 0,7, spricht der Satz von selbst früher.
- [ ] GPL Zug 35 sitzt auf der Kante der Schwelle `HEALTHY_SACK_FLOOR` (Score nach dem Sack 0,383 gegen 0,4; seit Runde 47 ohne Sack-Stempel, liest inaccuracy) → nur wissen: Der Engine-Pin prüft die Regel, nicht mehr den Stempel.

- [ ] Browser und node liefern für GPL Zug 13 dieselbe Reihenfolge und dieselbe Reue, aber ein anderes Niveau (Stealth Rock 0,27 im Browser gegen 0,34 in node, beide Tiefe 1, ein Seed) → vor der nächsten Sonde, die Browser- und node-Zahlen mischt, die Ursache suchen (Set-Stand, Seeds, Tiefe).
- [ ] Pivot-Paare bekommen keinen Ereignis-Plan (`cell-blend.ts:91`): in GPL Zug 13 sind das 16 von 99 Zellen, darunter U-turn nach Clefable, die nach einer Zellen-Reparatur 39 % des Gleichgewichts trüge → in T24 oder T14 mitlesen.
- [ ] Der Spread-Löser gibt GPL-Cobalion Timid bei 252 Angriffs-EVs: Natur und EVs stammen aus unvereinbaren Vorlagen. Der beobachtete Treffer (106) beweist den Fehler nicht, er bindet Cobalions Angriff und Noiverns Verteidigung gemeinsam → handeln, wenn eine Fitter-Runde denselben Widerspruch an weiteren Sets zeigt.
- [ ] Die Bring-Beschränkung fällt in kurzen VGC-Spielen still weg: `replayBringOnly` liefert null, sobald eine Seite weniger Arten zeigt als die Bring-Zahl (2634199230: 3 von 4 nach sechs Zügen). `|teamsize|` nennt nur die Zahl 4, nicht die vier Arten → handeln, wenn ein gemessenes Urteil daran hängt.
- [ ] Die Harness-Fixtures tragen einen älteren Datenstand als `.smogon-cache` (gen6ou: 292 gegen 297 Arten, Datei vom 14.08.) und bewegen 4 von 72 Singles-Sets in 649664 und 655336 → beim nächsten Neu-Aufzeichnen der Fixtures mit bewegten Pins in genau diesen beiden Spielen rechnen.
- [ ] Der App-Bau widerspricht 20 von 910 beobachteten Singles-Zugreihenfolgen der Bank, der Bau mit einer Lösung 10 (Runde 52, `speed-order-violations.vt.ts`) → nach jeder Set- oder Löser-Runde neu zählen; steigt die Zahl, vor der Bank nachsehen. Bis T66 landet, trägt die Stellung 2658663776 Zug 86 rund 8 der 11 bp der gepoolten Bank-Zeile (12 der 15 bp in Singles).
- [ ] `carryItemDecisions` rettet eine Item-Entscheidung, die die Volllösung aufgibt (`team-builder.ts:158`); der Zweig feuert in keinem der 139 gemessenen Replays → wer die App auf eine Lösung zurückbauen will, braucht zuerst einen Fall dafür.

- [ ] Ein Play-out verheizt eine Win-Condition in falscher Reihenfolge (Draft t56 bis t62 hält seit Runde 42 per e2e-Pin) → bei einem weiteren Fall Q5 (T39) vorziehen.
- [ ] Früher Brier: Runde 40 kostete früh 28 bp hq (0,2569 → 0,2597), spät gewann sie 84 bp; Verdacht: exakte HP-Körper geben früh zu extreme Balken → bei jeder Fitter-Runde die frühe hq-Spalte vorregistrieren; handeln, wenn zwei Runden hintereinander früh verlieren.
- [ ] hq-Tranche: n=548 (410 smogtours plus Ladder ab Rating 1700; der Ledger nennt je nach Runde 547 oder 548) → Tranche neu schneiden, wenn n unter 500 fällt oder eine neue Tranche das Verhältnis kippt.
- [ ] Einmalig anderes `punishedBy`-Label der Spikes-Zeile (Singles-Matrix 573756) bei gleichen `ev`/`expected`/`worstCase`; drei weitere Aufnahmen byte-gleich → bei Wiederholung die Options-Reihenfolge der Matrix auf Stabilität prüfen.
- [ ] 648453-Divergenz (einziger Premature-End-Rest, 1 Block von 270) → Backstop nur, falls die Rate mit dem Korpus wächst.
- [ ] gen8-Soft-Residual (573756: 9 von 138 perfekte Blöcke, soft 275, Faints einstellig) → gelegentlich dossieren, kein Verdikt-Risiko.

Umgebung:

- [ ] e2e „branch replay play controls stay muted without audio errors“ sah in Runde 50 zwei Seitenfehler aus dem Replay-iframe (`$ is not defined`, danach `reading 'length'`): 1 von 2 vollen Läufen rot, einzeln 10 von 12 grün auf dem Branch und 6 von 6 auf der Basis. Ein Showdown-Skript läuft, bevor jQuery geladen ist (dieselbe Familie wie der Config-Routes-Fix e019a73) → handeln, wenn der Test ein zweites Mal ein Gate kippt; Hebel: Ladereihenfolge der dynamischen Skripte im Embed, oder der Test wartet auf `window.$` im iframe, bevor er Fehler zählt.
- [ ] Browser-Build ist Teil des Feedback-Ankers: Ein Chromium-Wechsel verschiebt die letzte Gleitkomma-Stelle (573756 t81 Verify-Auswahl) → jedes Playwright-Upgrade ist eine Re-Verankerung mit `FEEDBACK_DUMP=1`; Stand `@playwright/test ^1.62.1`.
- [ ] TypeScript bleibt auf 6.x, bis typescript-eslint den nativen Compiler parst; `@types/node` folgt dem CI-Node-Major (24) → Peer-Range beobachten.
- [ ] Screenshot-Sonde `docs/probes/2026-09-03-css/` (32 Tests, 34 Screens, 0 Pixel Toleranz; Start über `node scripts/run-e2e.mjs -c docs/probes/2026-09-03-css/shots.config.ts`; ihre baseURL steht fest auf Port 5174, `--dev-port` erreicht sie nicht) → als Pixel-Gate für jede UI-Runde wiederverwenden; Baseline mit `--update-snapshots` neu aufnehmen, wenn Copy oder Layout sich bewusst ändern.

Geparkte Branches:

- `r45-threshold` (6d10308, ein Commit vor e30e72a, Cache v47): Sonden-Schwelle, gemessen und nicht empfohlen; T14 macht sie überflüssig, danach löschen. Ihr Bank-Ordner ist gelöscht, die Zahlen stehen im Ledger und in `docs/perf/probes/2026-09-12-r45/paired-*.txt`.
- `r41-wide` (163efcc): weite Lesart der Tempo-Freigabe, Referenz für T26. Der Bank-Ordner ist gelöscht, die Zahlen stehen in `docs/perf/probes/2026-09-11-r41/paired-wide-*.txt`.
- `r43` und `r45` liegen vollständig in master (kein eigener Commit) und können weg.

## D. Standing Rules

- **D1** Kein Push ohne Ansage (Stand 18.09. nach Runde 46: 43 Commits vor origin/master; origin steht auf ba2ce5b, Release 0.7.1).
- **D2** Vor jedem Push `npm run lint` lokal (der Pages-Workflow hat ein eigenes Lint-Gate) und `npx tsc -b` (`tsc --noEmit` prüft in diesem Solution-Setup nichts).
- **D3** Score-berührend = Cache-Bump + gepaarter Bank-Bench gegen eine frische Basis vom selben Tag + drei byte-identische Feedback-Läufe (seit Runde 49 zehn Dumps: sechs Singles, vier Doubles). Das Bank-Verdikt liest die Tabelle mit Fehlerbalken aus `scripts/paired-calibration.mjs` (seit Runde 48: 90-%-Band aus einem gepaarten Bootstrap über Replays, Sichten full, hq und glücksbereinigt): **Gepoolte Zeilen entscheiden, Phasen-Zellen warnen.** Ein Kandidat besteht, wenn (1) sein Gewinn dort belegt ist, wo die Messung scharf genug ist (eine gepoolte Bank-Zeile ganz im Guten ODER der Fit-Korpus out-of-sample in allen Seeds), (2) keine gepoolte Bank-Zeile Schaden zeigt und (3) die Tier-Zählung der Feedback-Dumps hält (D21). **Schaden braucht Größe** (User-Gate 19.09., Runde 49): Eine gepoolte Zeile ist Schaden und eine Phasen-Zelle eine Warnung, wenn ihr Band ganz im Schlechten liegt UND ihr Mittel mindestens 5 bp beträgt; kleinere aufgelöste Verschiebungen druckt das Skript als Hinweis hinter dem Verdikt (eine Änderung, die wenige Stellungen bewegt, löst ein einzelnes bp auf). Warnungen und Hinweise gehen mit ihrer Größe ans Gate. Eine Korrektur mit Zweck außerhalb der Bank (Korpus-Gap, Korrektheitsfehler) braucht (2) und (3) und ihren eigenen Beleg. Auflösung der Bank (kleinster wahrer Effekt, den eine Zeile in vier von fünf Fällen sieht, Median über die Kandidaten der Runde 47): gepoolt gesamt 23 bp, gepoolt Singles 24, gepoolt Doubles 58, Singles-Phasen-Zelle 33, Doubles-Phasen-Zelle 72; eine K-Abbildung löst feiner auf (gepoolt 10 bp) als ein Gewicht, das wenige Stellungen stark bewegt. Punktwerte ohne Band sind kein Verdikt. Corpus-Re-Pins und Golden-Refreshes nur nach User-Gate.
- **D4** Verlustfrei oder render-only = drei byte-identische Feedback-Läufe + Kalibrierung ziffern-gleich + `npm run test:regression`, e2e, lint, `tsc -b`.
- **D5** Messen vor Bauen: Spike oder Sonde vor dem Design-Gate, Messkette vor Pins, roter Test vor dem Umbau. Jede Runde bekommt vor dem Bau Brainstorming und Spec.
- **D6** Byte-Vergleiche nur mit `FEEDBACK_DUMP=1` und frischen Dumps (mtime prüfen). Wanduhr-Gates und Perf-Sonden nur verschränkt mit der Basis auf einem Maschinenzustand (Runde 43: +18 % Drift bei unverändertem Code innerhalb eines Vormittags; 573756 unter Fremdlast 101 bis 440 s).
- **D7** Baum-, Wurzel- und Ziehungs-Änderungen: zuerst den Play-out-Pin einzeln fahren (Draft t56, Muk-Alola vor Heatran, `e2e/branch.spec.ts`, 34 s). Er kippt früher als die Bank (Runde 43, Runde 45). Verify- und Merge-Änderungen zuerst an der Golden 655336 messen (`docs/perf/probes/2026-09-03-r32/verify-check.spec.ts`, 34 s, billigstes Orakel).
- **D8** Fitter- und Set-Runden: Set-Diffs auf allen Bau-Wegen VOR der Bank. Bewegt sich auf dem Bank-Weg kein Set, misst die Bank blind (Runde 41). Es gibt vier Bau-Wege (Runde 51, T12): nackt (nur Beobachtungen und Zugreihenfolgen), alter Bank-Bau (rohe Team-Infos plus Nutzungs-Fills, eine Lösung; seit Runde 52 nur noch hinter `EVAL_CALIBRATION_RAWBUILD=1`), App-Bau (angereicherte Infos, `solveReplaySpreads` mit Tempo-Vorlösung) und Feedback-Harness (derselbe Code wie die App, aber Daten aus `e2e-feedback/fixtures`). Seit Runde 52 baut die Bank über `buildAppTeams` (`src/lib/app-team-build.ts`) wie die App: Set-Diff Bank gegen App 0 von 1549 über die 129 Replays. Eine Runde, die den App-Bau ändert, ändert damit auch die Bank; `regression/app-build-parity.spec.ts` und `ui/hooks/appBuildParity.spec.tsx` halten Hook-Kette, Worker-Lösung und `buildAppTeams` zusammen. Die zwei Options-Blöcke in `src/lib/team-build-options.ts` lesen App und Bank gemeinsam: Eine Änderung dort bewegt beide und fällt den Pins nicht auf. Der alte Satz „Set-Annahmen 404 im Harness“ war falsch: Die Fixtures tragen die Set-Dateien, nur `sets/gen9doublesubers` fehlt, und die fehlt auch im Cache. Jede Sonde nennt ihren Bau-Weg UND ihre Datenquelle. Fit-Korpus und Bank teilen kein einziges Replay: Ein Fit-Korpus-Diff sagt nie voraus, ob die Bank etwas sieht. Ein Diff gegen eine gespeicherte alte Liste zeigt nur, was die letzten Runden geändert haben; wer wissen will, was der Löser tut, misst gegen den Prior desselben Laufs (gegen die Liste vom 11.09. bewegt sich 1 Doubles-Set, gegen den Prior sind es 43).
- **D9** Sonden nie unter `regression/` ablegen (die Suite sammelt sie ein; zweimal je eine Stunde verloren), sondern als `.vt.ts` unter `docs/perf/probes/<datum>/` mit eigener Vitest-Config (Vorbild `docs/perf/probes/2026-09-12-r45/vitest.probe.config.ts`). Sonden auf das Bank-Universum begrenzen (neun Minuten); den Fit-Korpus nur parser-seitig anfassen (mit Fills und Löser über eine Stunde).
- **D10** Diagnosen am Battle-State über den echten App-Pfad (Browser-Probe mit debug-Feld plus `FEEDBACK_DUMP`); nackte node-Rekonstruktion ist nicht harness-treu; `graph.results[]` hat kein turn-Feld (Index i = Turn i+1).
- **D11** Während Feedback-, e2e- und Kalibrierungsläufen nichts im Repo anfassen, auch keine Root-Markdown-Dateien (Vite reloadet, HMR zerschießt den Lauf); das gilt, bis Port 5176 leer ist. Browser-Messungen im eigenen Worktree, wenn eine zweite Session aktiv ist. Läufe über zehn Minuten abgekoppelt starten (nohup plus Marker-Datei), das Hintergrund-Tool endet sonst.
- **D12** Feedback-Läufe: `npm run test:feedback` startet seit Runde 46 über `scripts/run-e2e.mjs --dev-port 5176` (wartet auf Vites Abhängigkeits-Cache, verweigert einen belegten Port, räumt den Server am Ende ab). Weiter von Hand: drift-json vorher löschen (ein roter Lauf schreibt den Bericht zweimal, die zweite Fassung ist unvollständig), Läufe über zehn Minuten detached starten. Meldet der Starter „Port busy“, den Besitzer per `netstat` suchen und seine Kommandozeile prüfen, bevor etwas beendet wird.
- **D13** Bank: `node scripts/run-calibration.mjs --slices 6 --out .calibration/<name>` (volle Bank 210 bis 340 s; seit Runde 46 misst sie mit den Parametern der App, also mit Abgleich an jeder Zug-Grenze; `--env EVAL_CALIBRATION_RAW=1` ist das Instrument von vor Runde 46, `EVAL_CALIBRATION_LEGACY=1` ein Lauf je Stichprobe mit den heutigen Parametern; Basis `.calibration/base-20260918-live`, 833 Stellungen; seit Runde 47 (Bank-HP, Cache v47) ist `.calibration/r47-t46` die Basis des Code-Stands, 833 Stellungen, Brier 0,2565/0,2196/0,1222, hq 0,2468/0,1916/0,1227. Seit Runde 49 (vollständiger Merkzettel-Schlüssel, Cache v48) ist `.calibration/r49-fullkey` die Basis des Code-Stands: 833 Stellungen, Brier 0,2565/0,2196/0,1223, hq 0,2469/0,1918/0,1228; 45 Stellungen liegen anders als in `r47-t46`. Seit Runde 50 trägt jede Dump-Zeile `decidedHeld`, und die Zusammenfassung endet mit der Quote der Decided-Erkennung, roh und vom Balken gehalten (`.calibration/r50-held`: 76,7 % von 103, gehalten 94,7 % von 57; sonst ziffern-gleich zu `r49-fullkey`); `scripts/dossier-decided-losses.mjs --held` listet die Verluste unter den gehaltenen. Seit Runde 52 (20.09.) baut die Bank ihre Teams über die Kette der App (angereicherte Infos, zweistufige Lösung, HP-Evidenz); `--env EVAL_CALIBRATION_RAWBUILD=1` ist der Bau von vor Runde 52 und byte-gleich zu `base-20260920` und `r50-held`. Basis des Code-Stands ist `.calibration/r52-appbuild`: 833 Stellungen (dieselben), Brier 0,2564/0,2197/0,1255, hq 0,2429/0,1941/0,1278, glücksbereinigt 0,2333/0,1950/0,1204, K gepoolt 2,24, Decided 76,7 % von 103 und gehalten 93,1 % von 58. Gegen den alten Bau liest sie gepoolt +11 bp [+1, +28] und in Singles +15 [+1, +39], hq +4 [+0, +7], Doubles unbewegt; 8 der 11 bp trägt eine Stellung (2658663776 Zug 86, T66). Bank-Zahlen vor dem 20.09. stehen auf dem alten Bau und gelten nur als Vergleich innerhalb ihrer Runde oder gegen einen Lauf mit `RAWBUILD=1`; das gilt auch für fit-seitige Dumps (`EVAL_CALIBRATION_SOURCE=fit` läuft durch dieselbe Schleife, während `regression/eval-fit.spec.ts` weiter nackt trainiert). Alle Bank-Zahlen in dieser Datei und im Backlog-Plan, die älter sind als der 18.09., stammen vom alten Instrument und gelten nur als Vergleich innerhalb ihrer Runde; weitere Flags `--env KEY=VALUE` und `--tranche`). A/B = zwei Ausgabeordner, dazwischen `scripts/paired-calibration.mjs` (dort `--quality hq|std`). Positions-Export über `--env EVAL_CALIBRATION_POSITIONS=<dir>`. Ist ein Slice-Lauf ungleich einem Ein-Prozess-Lauf, zuerst die mtimes von `.smogon-cache` prüfen.
- **D14** Perf-Umbauten an der Engine tragen ihre Identität dreifach: Fixture `fork-identity.json` (neu aufnehmen nur mit `PERF_IDENTITY_RECORD=1` auf dem Vorher-Code), Engine-Suite, Kalibrierung A/B ziffern-gleich. Die A-Seite einer A/B-Messung läuft auf dem Vorher-Code (Stash oder Worktree), nie auf einer Mischung. Perf-Sonde vor und nach am selben Tag: `PERF_PROBE=1 PERF_PROBE_LABEL=before|after npx playwright test -c docs/perf/probes/2026-09-03/probe.config.ts`.
- **D15** Worktree-Abbau (Vorfall 12.09. 15:25): Junctions (node_modules, .calibration, .smogon-cache, .fit-corpus) VOR `git worktree remove` einzeln und nicht-rekursiv löschen (PowerShell `[System.IO.Directory]::Delete('<worktree>\<junction>')`), dann per Reparse-Point-Scan prüfen, dass keine mehr existiert. `git worktree remove --force` folgt Junctions und löscht ihre Ziele. Seither: jede Bank-A/B mit frischer Basis am selben Tag; Vergleiche mit Ledger-Zahlen vor dem 12.09. nur mit diesem Vorbehalt. Memory `worktree-junction-removal`.
- **D16** `ALIGNMENT_SEEDS[0]` bleibt `'1,2,3,4'`; jede Listen-Änderung ist ein Cache-Version-Event. Runde 49 hat v48 genommen (Merkzettel-Schlüssel); `r45-threshold` trägt eine v47 und bekäme bei einer Landung die nächste freie Nummer.
- **D17** Gates nie durch eine Pipe leiten (Exit-Code direkt lesen); PP immer live aus `moveSlots.pp`; Commits englisch im Release-Stil, ohne Attribution.
- **D18** Design-Gates und Erklärungen in einfacher Sprache (User-Vorgabe 25.08.). Doubles und Singles sind First-Class: Neue Features decken beide von Anfang an ab (User-Vorgabe 28.08.). Die Experten-Evidenz des Feedback-Korpus ist rein Singles. Seit Runde 49 laufen vier Doubles-Spiele ohne Pins im Feedback-Lauf mit (`FEEDBACK_CENSUS_REPLAYS`): Sie liefern Dumps für die Tier-Zählung und den Byte-Gleichheits-Test, aber kein Experten-Urteil. Doubles-Änderungen brauchen weiter die Bank, das VGC-Replay oder die Doubles-Fixtures als Orakel.
- **D19** `docs/` bleibt gitignored; `FeedbackEval.xlsx` und `deploy.ps1` untracked lassen (deploy.ps1 = lokales Server-Deploy via `Host vserver`, nicht pushen). `NextSteps.md` ist getrackt.
- **D21** Jede score-berührende Änderung liest neben der gepaarten Bank die Tier-Zählung der Feedback-Dumps: `node scripts/tier-census.mjs <ordner>...` zählt Ungenauigkeiten, Fehler und Blunder je Seiten-Zug, getrennt nach Singles und Doubles, mit nicht zugeordneten und nur teilweise gesehenen Seiten daneben; `--moved <basis> <neu>` nennt jeden Zug, dessen Einordnung, Tier oder Zuordnung gewechselt hat. Stand nach Runde 49 (Ordner `docs/perf/probes/2026-09-19-r49/feedback/fullkey-run1`): Singles 38 / 2 / 0 auf 558 Seiten-Zügen (39 nicht zugeordnet), Doubles 7 / 5 / 0 auf 88 Seiten-Zügen (3 nicht zugeordnet, 11 teilweise). Die Bank benotet den Balken, nicht die Zug-Urteile (Runde 47: Boosts 39 gewann auf der Bank und gab 573756 sieben neue Fehlerzüge). Die Summe allein genügt nicht: die bewegten Züge lesen, in Singles vor allem die Golden 655336 (Runde 48: Summe 38/2/0 → 32/2/1, aber ein neuer Blunder auf dem Experten-Spiel), in Doubles das VGC-Spiel 2629703929 mit Team-Auswahl. Doubles liest gröber und nie allein als Spielart: Bewertet werden 16 ausgewählte Zug-Paare, ein nie gesehener Slot macht das Regret zur Untergrenze (teilweise), und die vier Spiele sind Gen 9 mit Tera (VGC Level 50) gegen Gen 6 und 8 im Singles-Korpus; ein bewegtes Doubles-Urteil ist ein Anlass nachzusehen, kein Beweis. Ein neues K verschiebt jede Schwelle in Gewinnprozent mit (T52).
- **D20** Jede Barrel-Änderung erscheint als Fixture-Diff unter `regression/fixtures/api/` (`UPDATE_API_SNAPSHOT=1` nur bewusst; der Diff ist das API-Review); nach Paket-Änderungen `npm run pack:smoke`.
- **D22** Set-Sonden (Runde 51): Set-Listen nach Replay, Seite und Art paaren, nie nach Index (der Formen-Marker-Fix hat 492 Sets entfernt, die alten Skripte zählen sonst 1582 statt 977). Jeder Nachbau (Leiter, Sweep, Engine-Kopie) besteht vor der ersten Zahl einen Identitäts-Test gegen das heutige Ergebnis (der erste Leiter-Nachbau der Runde traf 595 von 977 Zeilen, der treue 960). Seit Runde 52 (T61) führt der Merkzettel der Nutzungsstatistik seine Datenquelle im Schlüssel: Zwei Quellen in einem Prozess liefern zwei Antworten (Gegenprobe `docs/perf/probes/2026-09-20-r52/T61/two-sources.vt.ts`, 4 von 120). Für Builder-Zählungen in Doubles die vier echten Spiele aus `e2e-feedback/fixtures` nehmen (die synthetischen Doubles-Fixtures stehen in keiner Nutzungsdatei), und den Platzhalter `Tackle` aus `team-builder.ts` nicht als gesehenen Zug zählen. Der Positions-Export der Bank trägt nur die 110 kleinen entschiedenen Endspiele, nicht die 833 Stellungen.
- **D23** Absturz-Schutz (Vorfall 20.09. 12:48: Bluescreen 30 s nach dem Start eines Bank-Laufs, der zweite harte Absturz in zwei Tagen). Danach standen alle in den letzten Sekunden geschriebenen Dateien in voller Länge aus Null-Bytes da, darunter `.git/HEAD`, `.git/config` und der frische Branch-Ref (`fatal: not a git repository`). Vor jedem schweren Lauf (Bank, Feedback, e2e): erst committen, dann die frisch geschriebenen Dateien auf die Platte zwingen (`powershell -File docs/perf/probes/2026-09-20-r52/flush-recent.ps1`), und unmittelbar vor dem Start kein Git-Schreibvorgang. Ketten flushen nach jeder Stufe (Vorbild `docs/perf/probes/2026-09-20-r52/gates-chain.sh`). Nach einem Absturz: genullte Dateien unter `.git` suchen und aus dem Reflog wiederherstellen, halbe `.calibration`-Ordner löschen, den Lauf neu fahren, mtimes der Caches prüfen. Rezept samt `config`-Inhalt in der Memory-Notiz `machine-crash-zeroed-git-files`.

## E. Prozess: abhaken und überführen

Kurzfassung; vollständig in `docs/completed/README.md`.

1. Die Reihenfolge der Liste ist die Priorität: Die oberste Iteration ist die nächste Sitzung. Beim Start bekommt sie die nächste freie Rundennummer in ihre Überschrift, und ihre TODOs bekommen, falls sie sie noch nicht tragen, die Schritte aus dem Backlog-Plan als Unterpunkte. Schritte abhaken (Kästchen ankreuzen, Commit-Hash dazu), nicht löschen. Die Spec der Runde darf die Schritte ersetzen.
2. Am Rundenende (Teil des Abschluss-Tasks): den Block als Eintrag (Ziel / Geliefert / Gates / Lehren / Reste) an `docs/completed/<gebiet>.md` anhängen, eine Zeile in dessen Inhaltsliste, und den Abschnitt im Backlog-Plan streichen.
3. Reste einsortieren: Ein offener Rest wird ein neues TODO mit der nächsten freien T-Nummer in der passenden Iteration (samt Abschnitt im Backlog-Plan) oder eine Zeile in B; Signale → C, Regeln → D, dauerhafte Lehren → Memory-Notiz der Runde.
4. Die erledigte Iteration hier löschen und die Kopfzeile „Stand …, nach Runde N“ setzen. T-Nummern und Iterations-Nummern der übrigen bleiben stehen; Lücken in der Zählung sind gewollt.
5. Prüfen: `grep -c '\[x\]' NextSteps.md` ist 0; `grep -rc '\[ \]' docs/completed/ --exclude=README.md | grep -v ':0$'` ist leer.
