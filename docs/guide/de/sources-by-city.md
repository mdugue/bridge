# Quellen nach Stadt

*English: [Sources by city](../en/sources-by-city.md)*

Jede Stadt wird gleich dargestellt, aber nicht jedes Land veröffentlicht
dieselben Daten offen. Diese Tabelle zeigt für jede Stadt und alles, was
der Viewer zeichnet, woher es kommt — und ob das die beste Quelle ist,
die es gibt, die einzige, oder ein Ersatz für eine bessere, die Land oder
Stadt nicht veröffentlichen. Die Datensätze selbst (Download, Stärken,
Lizenzen) beschreibt [Woher die Daten kommen](./data-sources.md).

| Was gezeichnet wird | Dresden | Grimma | Hamburg | Leipzig | Meißen | München | Unna | Berlin (konfiguriert, noch nicht gebaut) |
|---|---|---|---|---|---|---|---|---|
| *Land* | *Sachsen* | *Sachsen* | *Hamburg* | *Sachsen* | *Sachsen* | *Bayern* | *Nordrhein-Westfalen* | *Berlin* |
| Flächen (Straße, Wasser, Wiese …) | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ |
| Bahngleise | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ |
| Brückendecks | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟡 OSM + DOM1 ¹ | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟡 OSM + DOM1 ¹ |
| Straßenbäume (Art, Krone) | 🟢 Baumkataster | ⚪ — ² | 🟡 Baumkataster ³ | 🟢 Baumkataster | ⚪ — ² | ⚪ — ² | ⚪ — ² | 🟢 Baumkataster |
| Baumreihen, Hecken | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ |
| Schuppen, weitere Bäume, Heckenhöhen | 🟢 Laserscan | 🟢 Laserscan | ⚪ — ⁴ | 🟢 Laserscan | 🟢 Laserscan | 🟢 Laserscan | 🟢 Laserscan | ⚪ — ⁵ |
| Vegetationsfarbe (Vitalität) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟡 DOP RGB (GLI) ⁶ | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) |
| Denkmäler, Brunnen | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ |
| 🟢 aus der besten Quelle | **16** / 18 | **15** / 18 | **9** / 18 | **16** / 18 | **15** / 18 | **14** / 18 | **15** / 18 | **10** / 18 |

## Legende

- 🟢 amtlich oder gemessen — die beste Quelle, die es gibt
- 🔵 OpenStreetMap — die einzige Quelle dafür (von Freiwilligen erfasst, so vollständig wie die Kartierer der Stadt sie gemacht haben)
- 🟡 Ersatz — die bessere Quelle fehlt für diese Stadt (die Fußnote sagt, warum)
- ⚪ nicht dargestellt — keine offene Quelle (die Fußnote sagt, warum)

## Warum nicht die beste Quelle

1. Das Land veröffentlicht kein offenes Basis-DLM (das amtliche Landschaftsmodell), also springt OpenStreetMap ein.
2. Die Stadt veröffentlicht kein offenes Baumkataster; ihre Straßenbäume kommen nur aus dem Kronendach und dem Laserscan.
3. Das Kataster kennt keine Baumhöhen: Die Höhe eines Baums kommt aus dem Oberflächenmodell an seinem Standort, sonst aus seiner Krone.
4. Das Land veröffentlicht keinen offenen klassifizierten Laserscan (Hamburg lehnt das mit Verweis auf den Datenschutz ab).
5. Die Pipeline liest den Laserscan dieses Landes noch nicht (kein Adapter dafür).
6. Das offene Luftbild hat keinen Infrarotkanal: Der Vegetationsindex wird aus seinen sichtbaren Farben berechnet (Green Leaf Index) — er unterscheidet Grün von Grau gut, die Vitalität weniger gut.

## In jeder Stadt gleich

Diese Darstellungen kommen überall aus derselben Art Quelle — jedes
Land veröffentlicht sie offen, oder OpenStreetMap ist die eine Quelle
dafür:

- **Gelände**: 🟢 DGM1
- **Gebäude**: 🟢 LoD2
- **Brückenbögen, Fachwerke, Pylone**: 🟢 DOM1 + OSM/Wikidata
- **Baumkronen (Kronendach)**: 🟢 DOM1 − DGM1
- **Dachfarben**: 🟢 DOP
- **Fassadenmaterial**: 🔵 OSM + Nachbarschaft
- **Türme, Schornsteine, fehlende Gebäude**: 🟢 DOM1 + OSM
- **Wahrzeichen**: 🟢 Wikidata + OSM
- **Stadtmobiliar, Lampen, Treppen, Mauern, Zäune, Markierungen, Beläge, Sportplätze, Straßenbahn, Anleger**: 🔵 OSM
- **Himmelslicht, Fernschatten**: 🟢 DGM1 + LoD2

*Diese Seite wird aus den Standort- und Anbieter-Konfigurationen erzeugt
(`bun run docs:matrix`, `lib/city/source-matrix.ts`) und sagt deshalb
immer, was die Pipeline tatsächlich liest.*
