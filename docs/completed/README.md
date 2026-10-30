# Erledigte Runden (Archiv nach Gebiet)

Hier steht jede abgeschlossene Runde, sortiert nach Gebiet. `NextSteps.md` hält nur Offenes, `docs/backlog.md` die Einzelheiten offener TODOs, diese Dateien nur Erledigtes. Seit dem 13.10.2026 liegt das Archiv im Repository; Mess-Ausgaben, Sonden und Specs bleiben lokal unter `docs/`. Maschinen-Quellen sind der Ledger in `test/regression/eval-calibration.spec.ts` und die Pins in `test/e2e-feedback/corpus.ts`; die Arbeitsregeln stehen in `AGENTS.md`.

| Datei | Gebiet | Enthält |
| --- | --- | --- |
| `eval-quality.md` | Eval-Qualität | Verbesserungsrunden 4 bis 15 und 32 bis 79 (ohne 38, 39, 59 und 71), der Expert-Feedback-Korpus, geschlossene Korpus-Gaps |
| `timeline-ux.md` | Timeline und UX | Runden 17 bis 21 (Unified Timeline, T0-Branching, Play-out, Bring-Limit), Runde 38 (flüssige Oberfläche), Spur F der Wellen 1 und 1.5 (Schadensvorschau) |
| `performance.md` | Performance | Runde 16 (Time-Performance), die Perf-Evaluation vom 01.09.2026, Runde 31 (verlustfreie Perf-Basis), die Sichtung der Runde 32 |
| `architecture-refactor.md` | Architektur-Refactor | Runden 22 bis 30 (Workspace-Split, Publish-Readiness, Paket-Testsuiten, CSS), der erste npm-Publish und Trusted Publishing |
| `test-infrastructure.md` | Test-Infrastruktur | Runde 39 (Vitest, App-Testsuite unter jsdom, e2e in Themen-Dateien, Test-Workflow in CI), Runde 71 (Bank in GitHub Actions) |
| `triage.md` | Triage | stillgelegte TODOs mit Urteil, Beleg und altem Text (Runde 62, Nachträge der Runden 67 und 69, die Triage vor dem Release vom 21.10.2026) |
| `qa-campaign-2026-07.md` | QA-Kampagne 07/2026 | der Fix-Plan der 45 Befunde und die Nachtest-Runden (vor der Rundenzählung) |

Ein neues Gebiet bekommt eine eigene Datei mit demselben Kopf und eine Zeile in dieser Tabelle.

## Eintragsformat

Ein Eintrag je Runde, chronologisch von oben nach unten, dazu eine Zeile in der Inhaltsliste der Datei.

```markdown
## Runde N · Titel (Datum, TODOs, Branch und Commits, Gate, Push-Stand)

Ziel: ein Satz.

- Geliefert: was gelandet ist, mit Commits und Zahlen.
- Belege und Messung: wie gemessen, mit den Urteilen.
- Gate: die Antworten des Users.
- Lehren: was die nächste Runde wissen muss.
- Reste: was offen blieb und unter welcher T-Nummer.
```

Die Einträge der Runden 4 bis 26 tragen ihr ursprüngliches Notizformat (übernommen am 02.09.2026). Runden zählen projektweit in einer Reihe; der Ledger nennt sie „improvement round N“. Prüfung nach jeder Buchung: `grep -rc '\[ \]' docs/completed/ --exclude=README.md | grep -v ':0$'` bleibt leer.
