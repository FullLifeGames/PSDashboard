# Warum mehr Simulation

Stand 02.10.2026, nach Runde 59 und dem Spec-Gate der Runde 60. Dieses Dokument hält fest, warum die Engine seit Runde 58 umgebaut wird: Statt Spielregeln immer genauer von Hand nachzubauen, nutzt sie den echten Simulator mehr. Es sammelt die Fragen, die wir dazu gestellt haben, was wir gemessen haben, was wir entschieden haben und was noch offen ist. Die Zahlen stammen aus den Quellen am Ende; die Kurzfassung des Programms steht in `NextSteps.md` unter „Programm · Mehr Simulation“.

## Kurzfassung

Die Engine spielt Züge im echten Simulator `@pkmn/sim` durch und schätzt am Ende jedes Suchpfads mit einer eigenen Rechnung, wer vorne liegt. Dieser eigenen Rechnung haben wir seit Runde 54 Runde für Runde mehr Spielregeln beigebracht, und jede Runde fand neue Lücken. Runde 58 hat gemessen, was dieser Weg überhaupt noch bringen kann: Selbst mit perfektem Schaden gewänne die Schätzung höchstens rund 16 Basispunkte, und das nur mit neu gefitteten Gewichten. Eine Bibliothek als Rechenkern ist im Suchpfad zu teuer. Teuer ist dagegen der Simulator selbst, aber nicht wegen der Spielregeln: Kopieren und Nachfragen fressen den Großteil der Zeit. Daraus folgte die Entscheidung vom 24.09.: den Simulator billiger machen und ihm mehr Arbeit geben, unter der Bedingung, dass Qualität und Tempo bleiben. Runde 59 hat den ersten Teil erledigt: Die Suche läuft rund doppelt so schnell, ohne dass sich ein einziges Ergebnis bewegt, und ohne eine Zeile im Simulator zu ändern. Ob mehr Simulation auch besser bewertet, ist noch offen; das misst Runde 61.

## Wie die Engine eine Stellung bewertet

Drei Teile arbeiten zusammen:

| Teil | Was er tut | Woher die Regeln kommen |
| --- | --- | --- |
| Suche | Kopiert den Kampf, spielt beide Züge im Simulator, lässt ihn den ganzen Zug auflösen (Schaden, Fähigkeiten, Items, Würfel), und das tausendfach je Stellung | vom Simulator `@pkmn/sim` |
| Statik | Schätzt am Ende eines Suchpfads, wer gewinnt: wer gegen wen die Oberhand hat, auch für Pokémon auf der Bank, in Mikrosekunden | eigene, vereinfachte Regeln (`score/threat.ts` und Nachbarn) |
| Nachbau | Baut aus dem Replay den Kampf wieder auf: Sets, verdeckte Informationen, Tera, Encore, Korrekturen | eigene Regeln, weil Replays Informationen verstecken |

Die Suche kann nicht bis zum Spielende rechnen; jeder Zug verzweigt in viele Wahlen mal Würfel. Irgendwann muss sie aufhören und schätzen, wie eine Schach-Engine, die ein paar Züge vorausrechnet und dann die Stellung beurteilt. Die Statik ist dieser Beurteiler. Sie fragt nicht „was passiert, wenn ich diesen Zug mache“, sondern „wer schlägt wen“, für alle Paare, auch für Duelle, die es in der Stellung noch gar nicht gibt.

## Die Fragen, die wir gestellt haben

### „Ergibt es Sinn, dass wir eine ganze Pokémon Engine nachbauen?“ (24.09.)

Nicht die ganze. Gerechnet wird mit dem echten Simulator, Schaden prüfen wir am Smogon-Rechner. Nachgebaut wird an zwei Stellen: in der Statik und im Nachbau des Replays. Bei der Statik sprachen drei Zeichen dafür, dass wir einem langen Schwanz hinterherlaufen:

1. Jede Runde fand mehr Lücken, als sie schloss. Am 18.09. endete die Liste bei T45, am 24.09. war T91 frei.
2. Genauer hieß nicht besser. T81 korrigierte 137 falsche Einschätzungen, trotzdem las die Bank in Doubles schlechter. Die gefitteten Gewichte glichen offenbar die alten Fehler aus, wie eine Waage, die mit einem falschen Gewicht geeicht ist.
3. Die Gewinne lagen oft im Rauschen. Runde 57 brachte Singles −9 Basispunkte; die Bank löst gepoolt erst ab rund 23 auf.

Dazu kam: Unser Schiedsrichter misst die Statik am Smogon-Rechner. Wir besaßen die Wahrheit also schon und bauten sie Regel für Regel nach, weil sie im Suchpfad zu langsam schien. Gemessen war das nie. Deshalb setzten wir die Sichtung Runde 58 auf, mit deinem Zusatz: „eventuell bauen wir hier viel nach, was wir nicht benötigen (oder vll aus @pkmn/sim reusen können)“.

### „Lässt sie sich zu 100 % ersetzen?“ (24.09.)

Nein. Die Inventur der Runde 58 fand 184 Stellen mit eigenen Spielregeln (rund 5 090 Zeilen):

| Urteil | Stellen |
| --- | --- |
| eine Bibliothek ersetzt sie direkt | 11 |
| ersetzbar mit Adapter | 32 |
| muss bleiben (vor allem der Nachbau aus verdeckten Informationen und das Rennen-Modell) | 76 |
| doppelt: dieselbe Regel an mehreren Orten | 61 |
| tot | 4 |

Das größere Problem waren die Doppelungen, weil ihre Kopien auseinanderlaufen, und 57 nebenbei gefundene Regelfehler. Vier davon sind zur Laufzeit bestätigt (Spikes-Schichten beim Korrigieren, Slush Rush, Verbrennung in Gen 2 bis 6, Attract), dazu ein Gleichstand im Rennen, den eine von fünf Kopien falsch löst.

### „Wir können nicht den State in @pkmn/sim nehmen, einen Move executen und zum vorherigen State zurückgehen?“ (24.09.)

Genau das tut die Suche schon. Sie arbeitet auf einer Kopie des Kampfs und wirft sie danach weg; „zurückgehen“ heißt: die Kopie verwerfen. Eine Undo-Funktion hat `@pkmn/sim` nicht.

Für die Statik taugt dieser Weg nicht als Ersatz. Sie bewertet je Stellung rund 110 Kombinationen aus Angreifer, Verteidiger und Zug, auch Duelle mit Pokémon auf der Bank, die man erst einwechseln müsste. Jede davon auf einer eigenen Kopie durchzuspielen, wäre ungefähr 500-mal langsamer; aus einer Suche von 2,5 Sekunden würden Minuten je Zug.

### „Könnten wir eine Undo-Funktion hinzufügen?“ (24.09.)

Wir haben zwei Wege geprüft:

- **Teil-Undo nur um die Schadensfunktion:** Sichern und Zurückstellen mit den Bausteinen des Simulators funktioniert vollständig; nach 90 232 Aufrufen blieb keine Spur im Kampf zurück. Es kostet aber 180 µs je Aufruf, mehr als der Aufruf selbst (133 µs). Korrekt, aber nicht schnell.
- **Undo für ganze Züge:** Dafür müsste der Simulator jeden Schreibzugriff protokollieren, rund 2 900 Schreibstellen. Das hieße eine eigene Version des Simulators, die bei jedem Schreiben bremst.

Ergebnis: kein Undo. Der bessere Hebel ist eine billigere Kopie. Mit einer Kopie für 87 µs statt 683 µs ist „zurück zum vorherigen Zustand“ billig genug.

### „Mehr simulieren, wenn möglich“ (24.09.)

Das hat die Frage verschoben. Nicht mehr „wie genau muss die Schätzung am Ende sein“, sondern: Wo bringt eine Sekunde Rechenzeit am meisten, in einer genaueren Statik oder in mehr echter Simulation? Ehrlich vorweg: Frühere Runden zeigen, dass mehr Suche kein Selbstläufer ist.

| Runde | Was mehr Suche brachte |
| --- | --- |
| 32 | achtfaches Budget bewegte die späten Züge von 573756 um höchstens 0,05 |
| 42 | Zwangswechsel als Knoten im Baum: Baum billiger, Bank spät 18 Basispunkte schlechter |
| 43 | Zufallsknoten im Baum: 44 bis 70 % teurer, Bank spät 12 bis 15 Basispunkte schlechter |

Eine Obergrenze für die Suche, wie es sie seit Runde 58 für die Statik gibt, fehlt noch. Die misst Stufe 2.

### „Könnten wir nicht einen eigenen Patch für das Paket pflegen, um die kostenintensiven Operationen abzuflachen?“ (24.09.)

Das war der Weg, nur in anderer Form. Ein Patch auf Dateien in `node_modules` käme bei Nutzern unserer Pakete nicht an. Gewählt haben wir deshalb eine Schicht außen um den Simulator (Gate-Option 5a statt 5b „patch-package“): ein eigenes Modul, das je Kampf eingehängt wird, mit festem Pin der Simulator-Version, einem Hash-Tor über die Simulator-Funktionen, auf die es baut, und einem Schalter. Runde 59 hat gezeigt, dass das ohne eine geänderte Zeile im Simulator geht.

### „Möglichst wenig Maintenance-Arbeit bei Upstream-Patches“ (24.09., Spec der Runde 59)

Daraus wurden vier Spec-Entscheidungen: eine Regel ohne Ausnahmen für die Reichweite (die Vorprüfung gilt für jeden Kampf der Engine, die Kopie greift, wo es eine Vorlage gibt), ein Schalter ohne Knopf in der Oberfläche, der automatische Nachbau zweier Simulator-Hilfsfunktionen aus dessen eigenem Quelltext mit Selbsttest und Rückfall, und rund zwölf Bank-Stellungen als feste Testfälle. Ein Upgrade ist damit meist: Version anheben, Tore laufen lassen. Code-Arbeit fällt nur an, wenn der Simulator seine Ereignis-Suche umbaut.

## Was Runde 58 gemessen hat

**Obergrenze der Statik.** Eine Statik, deren Schaden der Simulator selbst rechnet, sagt Spielausgänge auf dem Fit-Korpus (2 103 Replays, 12 771 Stellungen) um +16,4 Basispunkte [7,6; 25,3] besser voraus. Rund drei Viertel davon liegen in Gen-9-Singles (+26,1); ältere Singles (+9,1) und Doubles (+8,0) lösen nicht auf. Der Gewinn kommt nur mit neu gefitteten Gewichten; mit den heutigen Handgewichten und neu gefittetem Phasen-K sind es +8,7. Ein reicheres Modell auf den heutigen Merkmalen gewinnt ebenso viel (+16,8), beides zusammen +32,3. Unser eigener Kern liegt im Median 3,8 % der Höchst-KP neben dem Simulator, im Mittel 8,3 %.

Zur Einordnung: Ein Basispunkt ist ein Hundertstel Prozentpunkt im Fehlermaß der Bank (Brier). 16 Basispunkte sind für die ganze Genauigkeits-Achse (T71, T81, T82, T88, T90 zusammen) wenig.

**Bibliothek als Rechenkern.** Fragt die Statik jeden Schaden beim Rechner oder beim Simulator nach, wird sie kalt 22- bzw. 40-mal teurer, die Suche an der Wurzel 1,28- bis 1,50-mal (mit einem besseren Schlüssel etwa 1,11- bis 1,25-mal). Nach der vorab festgelegten Regel bleibt unser eigener Kern im Suchpfad; Rechner und Simulator werden Schiedsrichter und Test-Orakel.

**Wo die Zeit der Suche hingeht.** In einem Singles-Baum kostet das Kopieren des Kampfs 35 bis 53 %, das Heraussuchen der Effekt-Handler 24 bis 35 % (in Doubles 39 bis 47 %). Die Regeln der Attacken selbst kosten rund 10 %. Je Zug fragt der Simulator im Schnitt 8 790-mal, ob jemand auf ein Ereignis reagiert, und findet nur 15-mal etwas. Bei gen9ou baut er außerdem bei jedem Zweig die Regeltabelle neu, 14 bis 17 % jeder gen9ou-Suche, weil er sie für dieses Format nie speichert.

**Patch-Studie.** Eine direkte Kopie (683 → 87 µs je Zweig) und eine Vorprüfung der Handler (5,76 → 1,05 µs je Ereignis) machten im Prototyp Suchbäume 2,54-mal (Singles) und 1,92-mal (Doubles) schneller, Matrix-Suchen 2,17- bis 2,62-mal, in 18 Suchen mit gleichen Ergebnissen.

**Die Alternativen und warum sie verworfen sind:**

| Weg | Warum nicht |
| --- | --- |
| Statik Regel für Regel weiter verfeinern | Decke rund 16 Basispunkte, nur mit Re-Fit; jede Runde neue Lücken; genauer las teils schlechter |
| Bibliothek als Rechenkern im Suchpfad | 22- bis 40-mal teurere Statik |
| Statik durch Simulation jedes Paars ersetzen | etwa 500-mal langsamer |
| Undo im Simulator | Teil-Undo korrekt, aber teurer als der Aufruf; Zug-Undo bräuchte eine eigene Simulator-Version |
| Patch auf `node_modules` | kommt bei Paket-Nutzern nicht an |
| Alles durch Bibliotheken ersetzen | 76 von 184 Stellen müssen bleiben |

## Die Entscheidung

Am User-Gate der Runde 58 (24.09., 18:38) fiel „1a 2a 3a 4a 5a“, mit deiner Auflage: „Das ist okay, aber bitte dafür sorgen, dass der Plan klar definiert und runtergeschrieben ist und die anderen TODOs nach dem Umbau und Erfolg evaluiert werden.“ Davor hattest du die Richtung gesetzt: „Wenn das ist, würde ich gerne voll in die Richtung gehen … dass a) Qualität und trotzdem b) Geschwindigkeit bleibt, das würde auch viele NextSteps obsolet machen, allerdings auch einen Umbau bedeuten, den wir gerne eingehen können.“

Die fünf Punkte:

1. **1a** Die Genauigkeits-Achse der Statik (T71, T81, T82, T88, T90) ruht, bis Stufe 2 gemessen hat.
2. **2a** Die Modellform (+16,8) wird ein TODO (T102); die Schätzung am Ende bleibt auch mit mehr Simulation.
3. **3a** Die Inventur wird zwei Iterationen: „Regelfehler“ und „Eine Regel, ein Ort“.
4. **4a** Reihenfolge: Tempo-Schicht, dann die Regelfehler, die dem Simulator falsche Zustände geben, dann mehr Simulation, dann die Triage aller übrigen TODOs.
5. **5a** Die Tempo-Schicht als eigenes Modul mit Pin, Hash-Tor und Schalter, mit vorab festgelegten Toren.

**Das Programm:**

| Stufe | Runde | Inhalt | Tor in einem Satz |
| --- | --- | --- | --- |
| S1 Tempo-Schicht | 59 | Simulator billiger machen | alle Ergebnisse gleich, Suchen ≥ 2,0× / 1,6× / 1,8× schneller |
| S1a Regelfehler | 60 | Spikes-Schichten, As One, Doubles-Absturz, Verbrennung, Slush Rush | je Fehler rote Probe, Fix, eigenes Gate |
| S2 Simulation investieren | 61 | mehr Budget, Weiterspielen bis zum Spielende | Bank besser bei höchstens der Wandzeit vor Runde 59 |
| S3 Triage | 62 | jedes übrige TODO neu lesen | jedes TODO mit Urteil am User-Gate |

**Deine Bedingungen:** Die Qualität bleibt (Bank, Pins und Feedback bewegen sich nur, wo ein Gate es erlaubt). Die Geschwindigkeit bleibt (keine Stufe macht die Analyse langsamer als vor Runde 59, außer du nimmst es am Gate an). Nach Umbau und Erfolg wird jedes übrige TODO neu bewertet. Erfolg heißt: T91 ist übernommen, und Stufe 2 hat gemessen. Endet eine Stufe ohne Übernahme, geht das Programm an dein Gate, bevor die nächste beginnt.

## Was Runde 59 bestätigt hat

**Der Simulator lässt sich billig wiederverwenden.** Die Tempo-Schicht hat drei Hebel: Sie baut die Regeltabelle einmal je Format, sie legt den Kampf auf den Kopierer, statt ihn als Text auszudrucken und neu abzutippen, und sie schaut vor jeder Durchsage in einer Liste nach, ob überhaupt jemand zuhört. Ergebnis gegen den Stand vor der Runde: Suchbaum Singles 2,35×, Doubles 1,81×, Matrix 2,39× schneller; im Feedback-Lauf der dritte Pass 1,90×, die ganze Analyse 1,45×. Speicher höchstens +6,2 %.

**Kein Ergebnis hat sich bewegt.** 0 Abweichungen in 40 776 Zügen ab den Bank-Stellungen (auch gegen den alten Code), in 318 424 Zügen eine Ebene tiefer, in 111 316 Zügen mitten im Zug und in 48 Suchen; Feedback dreimal an und dreimal aus Byte für Byte gleich zum alten Code; Kalibrierung Byte für Byte gleich.

**Kein Patch nötig, kleine Pflege.** Keine Zeile in `@pkmn/sim` ist geändert. Die Schicht sitzt außen herum. Ändert ein Update die Funktionen, auf die sie baut, schaltet das Hash-Tor sie ab; die Ergebnisse bleiben richtig, nur langsamer. Bei uns ist die Version fest gepinnt, und jedes Upgrade läuft als eigener PR durch die Gate-Kette der Runde (Regel D24, dazu ein wöchentlicher Versions-Check).

**Wiederverwenden verlangt exakte Zustände.** Zwei Fehler zeigten, dass der Simulator mehr Zustand trägt, als sein eigenes Speicherformat zeigt. Er leert ein Feld, wenn ein Pokémon sein Item verliert (oder in Gen 2 nach jedem Zug ein Zielfeld); der alte Weg über Text verwarf das leere Feld, die Kopie behielt den Platz. Kam das Feld einen Zug später zurück, stand es an anderer Stelle. Kein Wert änderte sich, wohl aber der Text, den der Endspiel-Löser als Merkschlüssel benutzt. Die Gate-Kette fand den ersten Fall, der Schluss-Review den zweiten in Gen 2, die keine Bank-Stellung abdeckt. Seitdem gilt eine allgemeine Regel, und ein Test spielt jede Generation von 1 bis 9 durch. Die Lehre: Beim Wiederverwenden ist der Byte-Vergleich gegen den alten Weg das Sicherheitsnetz, und die Bank allein reicht dafür nicht.

**Die App gewinnt ungleich.** Der erste Pass der Analyse, die Skizze, wird nur 1,14× schneller. Seine Zeit steckt woanders als im Kopieren und Nachfragen, vermutlich in Statik und Nachbau; Runde 59 hat das nicht zerlegt.

**Ein alter Fehler wurde sichtbar.** In Partie 913996 bietet die Engine dem Simulator in drei Stellungen eine Wahl an, die er ablehnt (Outrage im Doppel ohne Ziel). Der Fehler bestand schon vorher und steht in T94.

**Deine Entscheidung am Gate (01.10.):** „lass bei diesem größeren Umbau beim Branch bleiben, bis Runde 62 durch ist und das dann nach Abschluss in v1 mergen und pushen“.

## Den Simulator nutzen, ohne wieder nachzubauen (02.10.)

Vor Runde 60 hast du gefragt: „wir steigen ja jetzt auf die Nutzung von @pkmn/sim um. Effektiv nutzen wir die Schnittstelle davon. Ich will verhindern, dass wir jetzt wieder anfangen die Logik zu hardcoden, also magst du hier vielleicht noch etwas Hintergrund geben, warum die Änderungen notwendig sind und ob es einen besseren Ansatz gibt?“

**Wo eigener Code bleibt.** Der Simulator kann kein Replay lesen. Drei Übergänge bauen deshalb immer wir:

| Übergang | Was er tut | Beispiel aus Runde 60 |
| --- | --- | --- |
| Bau | Aus Log und Smogon-Daten ein Team in der Form, die der Simulator versteht (Fähigkeits-Id, Tera-Typ, Item) | Das Log schreibt „As One“, der Simulator kennt nur „As One (Spectrier)“ und spielt Calyrex sonst ohne Fähigkeit |
| Korrektur | Das echte Spiel hatte andere Würfel als der Nachbau; an jeder Zug-Grenze übertragen wir den beobachteten Zustand in den Simulator | Spikes kommen ohne Schichten an und machen keinen Schaden |
| Wahlen | Unsere Optionen in der Form, die der Simulator annimmt | Ein in Outrage gefangenes Pokémon muss per Index wählen, sonst lehnt der Simulator ab |

Dazu kommt die Statik, die Regeln wirklich nachbaut, weil sie in Mikrosekunden schätzen muss.

**Je mehr der Simulator entscheidet, desto mehr hängt an diesen Übergängen.** Ein Simulator, der Calyrex ohne Fähigkeit spielt, rechnet perfekt ein falsches Spiel. Deshalb steht Runde 60 vor Runde 61.

**Drei Grundsätze (Gate 02.10.):**

1. **Regeln kommen aus Simulator und Dex.** Unser Code übersetzt nur. Dabei liest er Daten der Bibliotheken (die Anfrage des Simulators, Felder des Dex, den Zustand des Replay-Parsers), keine Art- oder Zugnamen.
2. **Prüfer statt Pflege.** Wo eigener Code eine Regel oder die Form eines Zustands kennen muss, prüft ein Test sie gegen den Simulator: über alle Generationen, über die Bank, mit dem Team-Validator des Simulators. Eine neue Fehlerklasse fällt dann auf, ohne dass jemand sie kennt.
3. **Upstream statt Umweg.** Hat eine Bibliothek einen Fehler, melden wir ihn, nach deinem Okay, statt ihn still zu umgehen.

**Was das in Runde 60 geändert hat.** Die erste Fassung der Spec hätte zwei Regeln von Hand geschrieben; beide fragen jetzt die Bibliothek:

- **Wem eine Fähigkeit gehört:** Statt einer Tabelle je Protokoll-Zeile entscheidet der Dex. Die Fähigkeit geht an das Pokémon, dessen Art sie haben kann; Alomomola kann Water Absorb nicht haben.
- **Tempo:** Statt Slush Rush in unsere Liste nachzutragen, rechnet der Simulator das Tempo (`getStat('spe')`). Damit fällt eine Handliste weg, die auch Unburden falsch rechnete. Hält das Zeit-Tor nicht, bleibt die Liste, und ein Test prüft sie gegen den Simulator.

Außerdem entfernt Runde 60 einen alten Umweg: Für festgelegte Lade-Züge riet die Wahlliste das Ziel aus dem Dex nach, nur weil wir die Wahl falsch abschickten. Der Replay-Parser `@pkmn/client` hat bei Heilungen durch Fähigkeiten denselben Zuschreibungsfehler wie wir; die Meldung bereitet die Runde vor.

## Was noch offen ist und wie es entschieden wird

Runde 59 hat nur Zeit gespart, die Bewertung ist unverändert. Ob mehr Simulation besser bewertet, ist die eigentliche offene Frage.

- **Runde 60 (S1a):** die Regelfehler, die dem Simulator falsche Zustände geben. Je mehr der Simulator entscheidet, desto mehr zählt, dass er den richtigen Zustand bekommt. Jeder Fehler bekommt eine Zählung, eine rote Probe, einen Fix und eine eigene Messung. Am Gate vom 02.10. kamen dazu: Ogerpon und Terapagos neben Calyrex (T93), ihr fester Tera-Typ und ihre Maske (T79), Fähigkeiten aus `[of]`-Zeilen (T104) und das Tempo vom Simulator statt aus unserer Liste (T95).
- **Runde 61 (S2):** die Obergrenze der Suche messen (T97): doppeltes und vierfaches Budget, getrennt nach Iterationen, Tiefe und Ziehungen je Zelle; eine Sonde, die bis zum Spielende weiterspielt statt zu schätzen; dazu die billige Statik-Probe (mittlerer Wurf statt Höchstwurf, Verbrennung, Guts, Facade). Ergebnis: Gewinn je Sekunde für jede Form von „mehr simulieren“, neben den 16 Basispunkten der Genauigkeits-Achse. Übernommen wird (T98) die beste Form, die die Bank aufgelöst besser macht bei höchstens der Wandzeit vor Runde 59.
- **Wenn mehr Simulation nicht besser liest:** Dann entfällt T98 mit dem Beleg aus T97. Das Budget bleibt, und das Tempo aus Runde 59 bleibt als reiner Zeitgewinn. Die Runden 42 und 43 zeigen, dass dieser Ausgang möglich ist.
- **Runde 62 (S3):** Triage. Jedes übrige TODO wird auf dem neuen Stand gelesen, nicht geschätzt, und bekommt ein Urteil: obsolet, kleiner, wichtiger, weniger wichtig oder unverändert. Die Tabelle geht an dein Gate.

## Was mit der übrigen Liste passiert

Bis zur Triage ruht die übrige Liste; Ausnahmen gibt es nur an deinem Gate. Die Genauigkeits-Achse der Statik bleibt geparkt, ihr Urteil fällt in der Triage, mit dem Gewinn je Sekunde aus Runde 61 neben ihrer Decke. Ein TODO der Achse kommt nur mit einem Plan zurück, der die Gewichte neu fittet. „Eine Regel, ein Ort“ (die Doppelungen zusammenlegen, Bibliothek statt Eigenbau, wo sie passt) folgt nach der Triage. Der ganze Umbau bleibt bis zum Ende von Runde 62 auf Branch `r59` und geht danach nach `v1`.

## Quellen

- Gespräch der Sitzung vom 24.09.2026 (Fragen und Gate im Wortlaut), 01.10.2026 (Branch-Entscheid) und 02.10.2026 (Grundsätze, Spec-Gate der Runde 60).
- Runde 60: Spec `docs/superpowers/specs/2026-10-02-round-60-design.md`, Sonden `docs/perf/probes/2026-10-02-r60/` (beide lokal).
- Ledger-Block `STATIC UPPER BOUND AND SIM COST 2026-09-24` in `regression/eval-calibration.spec.ts` (Runde 58: Obergrenze, Kosten, Undo, Inventur, Patch-Studie, Gate).
- Ledger-Block `SPEED LAYER 2026-10-01` in derselben Datei (Runde 59: Tore, Fehler, Pflege-Regeln).
- Programm `docs/superpowers/plans/2026-09-24-program-more-simulation.md` (lokal): Stufen, Tore, Entscheidungsregeln, Risiken.
- Runde 58: `docs/perf/probes/2026-09-24-r58/` (lokal), darin `inventory/inventory.md` und `patch/review.md`.
- Runde 59: Spec `docs/superpowers/specs/2026-09-24-round-59-design.md`, Tor-Tabelle `docs/perf/probes/2026-09-24-r59/gate/verdict.md` (beide lokal), Commits 8fb5795 bis d59482e auf `r59`.
- Frühere Messungen: Runde 32, 42, 43 (Einträge in `docs/completed/eval-quality.md`), Perf-Messung vom 01.09.2026 (`docs/perf/probes/2026-09-01`).
