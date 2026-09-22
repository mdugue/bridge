# User guides · Nutzerdokumentation

Documentation for people who **use** the viewer or want to understand what
it shows, without a background in geodata or 3D graphics. Every page exists
in both languages and links to its twin at the top.

Dokumentation für alle, die den Viewer **nutzen** oder verstehen wollen, was
er zeigt, ohne Vorwissen in Geodaten oder 3D-Grafik. Jede Seite gibt es in
beiden Sprachen; der Link zur Zwillingsseite steht oben.

| English | Deutsch | Answers · Beantwortet |
|---|---|---|
| [How the city walker works](./en/how-it-works.md) | [So funktioniert der Stadtspaziergang](./de/how-it-works.md) | What am I looking at, and how much of it is real? · Was sehe ich, und wie viel davon ist echt? |
| [Where the data comes from](./en/data-sources.md) | [Woher die Daten kommen](./de/data-sources.md) | Every dataset: download, strengths, weaknesses, edition, licence · Jeder Datensatz: Download, Stärken, Schwächen, Stand, Lizenz |
| [From download to browser](./en/data-journey.md) | [Der Weg der Daten](./de/data-journey.md) | Source of truth vs. derivative, what the browser receives · Wahrheit vs. Derivat, was der Browser bekommt |
| [Using the viewer](./en/using-the-viewer.md) | [Bedienung](./de/using-the-viewer.md) | Controls and the settings panel, label by label · Steuerung und Einstellungsfeld, Beschriftung für Beschriftung |
| [Glossary](./en/glossary.md) | [Glossar](./de/glossary.md) | The abbreviations · Die Abkürzungen |

Suggested reading order: *how it works* → *data sources* → *data journey*.
The developer documentation (English only) starts at
[docs/README.md](../README.md).

## Keeping the two languages in sync

The English page is the reference. When you change one, change the other in
the same commit; the pages share their structure heading for heading so the
diff is easy to mirror. Numbers (file sizes, feature counts, dates) come from
the repository state and the measurements described in
[data-pipeline.md](../data-pipeline.md#measuring-what-the-browser-downloads);
update both languages when they change.
