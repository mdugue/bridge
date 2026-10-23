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
| Flächen (Straße, Wasser, Wiese …) | 🟢 OSM + Basis-DLM | 🟢 OSM + Basis-DLM | 🟢 OSM | 🟢 OSM + Basis-DLM | 🟢 OSM + Basis-DLM | 🟢 OSM + Basis-DLM | 🟢 OSM + Basis-DLM | 🟢 OSM |
| Bahngleise | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ |
| Brückendecks | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟡 OSM + DOM1 ¹ | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟡 OSM + DOM1 ¹ |
| Straßenbäume (Art, Krone) | 🟢 Baumkataster | 🟡 OSM + DOM1 ² | 🟡 Baumkataster ³ | 🟢 Baumkataster | 🟡 OSM + DOM1 ² | 🟡 OSM + DOM1 ² | 🟡 OSM + DOM1 ² | 🟢 Baumkataster |
| Baumreihen, Hecken | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ |
| Bäume in Gärten und Höfen | 🟢 Laserscan | 🟢 Laserscan | 🟡 DOP + DOM1 ⁴ | 🟢 Laserscan | 🟢 Laserscan | 🟢 Laserscan | 🟢 Laserscan | 🟡 DOP + DOM1 ⁵ |
| Schuppen, Heckenhöhen | 🟢 Laserscan | 🟢 Laserscan | 🟡 DOM1 (Heckenhöhen) ⁴ | 🟢 Laserscan | 🟢 Laserscan | 🟢 Laserscan | 🟢 Laserscan | 🟡 DOM1 (Heckenhöhen) ⁵ |
| Vegetationsfarbe (Vitalität) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟡 DOP RGB (GLI) ⁶ | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) |
| Schaufenster, Fassadenbild | 🟢 Mapillary | 🟢 Mapillary | 🟢 Mapillary | 🟢 Mapillary | 🟢 Mapillary | 🟢 Mapillary | ⚪ — ⁷ | ⚪ — ⁸ |
| Denkmäler, Brunnen | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ |
| Stadtmobiliar, Lampen, Treppen, Mauern, Zäune, Markierungen, Beläge, Sportplätze, Straßenbahn, Anleger | 🔵 OSM + Mapillary | 🔵 OSM + Mapillary | 🔵 OSM | 🔵 OSM | 🔵 OSM + Mapillary | 🔵 OSM | 🔵 OSM + Mapillary | 🔵 OSM |
| Datenebene: Kfz-Verkehr | 🟢 Zählungen der Stadt | 🟡 Straßenverkehrszählung ⁹ | 🟢 Zählungen der Stadt (Hauptstraßen) | ⚪ — ¹⁰ | 🟡 Straßenverkehrszählung ⁹ | ⚪ — ¹⁰ | 🟡 Straßenverkehrszählung ⁹ | 🟢 Zählungen der Stadt |
| Datenebene: Radverkehr live | 🟢 Zählstellen der Stadt | ⚪ — ¹¹ | 🟢 Zählstellen der Stadt | ⚪ — ¹¹ | ⚪ — ¹¹ | ⚪ — ¹¹ | ⚪ — ¹¹ | ⚪ — ¹¹ |
| Datenebene: Straßenbahnen (Fahrplan) | 🟢 GTFS (DELFI) + OSM | ⚪ — ¹² | ⚪ — ¹² | 🟢 GTFS (DELFI) + OSM | ⚪ — ¹² | 🟢 GTFS (DELFI) + OSM | ⚪ — ¹² | 🟢 GTFS (DELFI) + OSM |
| 🟢 aus der besten Quelle | **21** / 23 | **17** / 23 | **13** / 23 | **19** / 23 | **17** / 23 | **17** / 23 | **16** / 23 | **13** / 23 |

## Legende

- 🟢 amtlich oder gemessen — die beste Quelle, die es gibt
- 🔵 OpenStreetMap — die einzige Quelle dafür (von Freiwilligen erfasst, so vollständig wie die Kartierer der Stadt sie gemacht haben)
- 🟡 Ersatz — die bessere Quelle fehlt für diese Stadt (die Fußnote sagt, warum)
- ⚪ nicht dargestellt — keine offene Quelle (die Fußnote sagt, warum)

## Warum nicht die beste Quelle

1. Das Land veröffentlicht kein offenes Basis-DLM (das amtliche Landschaftsmodell), also springt OpenStreetMap ein.
2. Die Stadt veröffentlicht kein offenes Baumkataster; ihre Bäume kommen aus dem Kronendach, dem Laserscan und den in OSM kartierten Bäumen (Art aus OSM, Höhe aus dem Oberflächenmodell).
3. Das Kataster kennt keine Baumhöhen: Die Höhe eines Baums kommt aus Gattung und Stammdurchmesser (an den Katastern Dresdens und Leipzigs angepasst); das Oberflächenmodell hebt nur eine deutlich zu niedrige Höhe an und streicht einen Baum, den es nicht zeigt.
4. Das Land veröffentlicht keinen offenen klassifizierten Laserscan (Hamburg lehnt das mit Verweis auf den Datenschutz ab).
5. Die Pipeline liest den Laserscan dieses Landes noch nicht (kein Adapter dafür).
6. Das offene Luftbild hat keinen Infrarotkanal: Der Vegetationsindex wird aus seinen sichtbaren Farben berechnet (Green Leaf Index) — er unterscheidet Grün von Grau gut, die Vitalität weniger gut.
7. Mapillary hat hier keine Straßenpanoramen, nur flache Fotos, die die Vermessung nicht auf eine Wand legen kann.
8. Die Pipeline hat die Straßenfotos (Mapillary) dieser Stadt noch nicht vermessen.
9. Die Stadt veröffentlicht keine eigenen Zählungen: Die Straßenverkehrszählung zählt nur Bundes-, Landes- und Kreisstraßen, beide Richtungen zusammen (je zur Hälfte gezeigt).
10. Keine offenen Zählwerte je Straßenabschnitt: Die Stadt veröffentlicht keine, und die Straßenverkehrszählung reicht nicht bis in ihre Mitte.
11. Keine offene Radzählstelle, die der Browser live lesen kann (Zählwerte nur jährlich, monatlich oder täglich, oder gar keine).
12. Die Stadt hat keine Straßenbahn.

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
- **Himmelslicht, Fernschatten**: 🟢 DGM1 + LoD2 + Copernicus GLO-30

*Diese Seite wird aus den Standort- und Anbieter-Konfigurationen erzeugt
(`bun run docs:matrix`, `lib/city/source-matrix.ts`) und sagt deshalb
immer, was die Pipeline tatsächlich liest.*
