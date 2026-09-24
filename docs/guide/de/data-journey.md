# Der Weg der Daten

*English: [From download to browser](../en/data-journey.md)*

Diese Seite folgt den Daten vom Portal des Anbieters bis zu den Pixeln auf
deinem Bildschirm. Sie beantwortet vier Fragen, die man bei so einem
Projekt stellt: **wo liegt die Wahrheit**, **was ist ein Derivat**, **was
lädt der Browser tatsächlich herunter** und **was muss neu gemacht werden,
wenn sich eine Quelle ändert**. Abkürzungen stehen im
[Glossar](./glossary.md).

## Die sechs Stationen

```mermaid
flowchart TB
  S1["<b>1 · Portale der Anbieter</b><br/>geodaten.sachsen.de · OpenStreetMap<br/><i>die Wahrheit über die Welt</i>"]
  S2["<b>2 · Rohdownloads</b> — data/_raw/<br/>Gigabytes · nur auf der Festplatte des Betreibers<br/>nie im Repository"]
  S3["<b>3 · Bakes</b> — pipeline/ · bun run bake<br/>von Hand je Kachel · ein Python-Paket<br/>ausschneiden, klassifizieren, abtasten, vereinfachen"]
  S4["<b>4 · Eingecheckte Derivate</b> — data/<br/>kleine Dateien je Kachel im Repository<br/><i>die Wahrheit darüber, was die App zeigt</i>"]
  S5["<b>5 · Build-Schritt</b> — scripts/prepare-data.ts<br/>läuft vor jedem Dev-Server und Build<br/>backt ein 3D-Tiles-Tileset nach public/data/"]
  S6["<b>6 · Browser</b><br/>streamt die Kacheln, die die Kamera sieht<br/>zeichnet alles auf der Grafikkarte"]
  S1 -->|"Download (manuell oder per Skript)"| S2
  S2 -->|"Bake (manuell)"| S3
  S3 -->|"Commit"| S4
  S4 -->|"bun dev / bun build"| S5
  S5 -->|"HTTP, dauerhaft gecacht"| S6
```

Zwei der Pfeile sind manuell und selten (ein neuer Download, ein
geändertes Bake); die letzten beiden passieren automatisch bei jedem Build
und jedem Besuch.

### Station 1 — die Portale der Anbieter

Die sächsische Landesvermessung und OpenStreetMap besitzen die Daten. Wenn
sich die Stadt ändert, ändert sie sich zuerst dort. Das Projekt hält einen
Schnappschuss; wie alt jeder ist, steht in der
[Stände-Tabelle](./data-sources.md#verwendete-datenstände).

### Station 2 — Rohdownloads (`data/_raw/`, nicht eingecheckt)

Die Rohdownloads sind groß: das landesweite Landschaftsmodell mehrere
Gigabyte, eine Luftbildkachel hunderte Megabyte, der OpenStreetMap-Auszug
für Sachsen etwa 250 MB. Sie liegen in einem Ordner, den die
Versionsverwaltung ignoriert, mit einem Unterordner je Standort und Quelle
(`data/_raw/dresden/dom1`, `…/dop`, `…/dlm`, `…/osm`). Jeder kann sie neu
herunterladen — `bun run bake --ingest` erledigt das in einem Rutsch —, und
niemand braucht sie, um den Viewer zu betreiben.

**Die eine Ausnahme** ist das Geländemodell: Sein GeoTIFF ist eingecheckt
(13,6 MB je Kachel), weil der Build-Schritt in Station 5 es direkt liest
und zwei Bakes es ebenfalls brauchen. Das ist eine bewusste
Entscheidung ([ADR 0004](../../adr/0004-commit-derived-artifacts-not-raw-data.md),
englisch).

### Station 3 — die Bakes (manuell, je Kachel)

Ein Python-Paket, `pipeline/bake/`, verwandelt die Rohdownloads in kleine,
kachelgroße Dateien. Es läuft auf dem Rechner des Betreibers mit einem
einzigen Befehl, `bun run bake`, der die **Standort-Konfiguration** liest
(`sites/dresden.ts`: welche Kacheln, wo sie liegen, welches
Koordinatensystem) und je Kachel neun Schritte ausführt. Die
Python-Umgebung ist festgeschrieben, und ihre Geodaten-Bibliotheken bringen
GDAL gleich mit, sodass nichts weiter installiert werden muss. Mit
`--ingest` holt es die Downloads vorher selbst: Oberflächenmodell und
Luftbild jeder Kachel über den Download-Dienst der Landesvermessung, das
landesweite Landschaftsmodell und den OpenStreetMap-Auszug für Sachsen von
Geofabrik.

Die Schritte laufen in fester Reihenfolge, weil manche die Ausgabe eines
früheren lesen:

```mermaid
flowchart LR
  DLM["landcover<br/>Landnutzungsklassen + Heckenreihen"] --> CAN["canopy<br/>Baumpunkte"]
  DLM --> LAMP["lamps<br/>Lampenpunkte"]
  NDVI["ndvi<br/>Grün-Raster"]
  ROOF["roof-colour<br/>Dachfarben-Tabelle"]
  WALL["walls<br/>Mauerlinien"]
  RAIL["rail<br/>Gleise · Schotter · Brücken · Bahnsteige"]
  DLM --> TREES["trees<br/>Stadtbaumkataster"]
  CAN --> LOW["lowveg<br/>Hecken · Laserscan-Bäume"]
  TREES --> LOW
  WALL --> LOW
  RAIL --> LOW
```

Jeder Schritt beschreibt, was er in den Rohdaten „sieht“ und wie er
vereinfacht. Fehlen für eine Kachel Oberflächenmodell oder Luftbild, werden
die Schritte, die sie brauchen (Bäume, Grün, Dachfarben), mit einem Hinweis
übersprungen, statt abzubrechen. Zwei Eingaben kommen von anderswo: das
Stadtbaumkataster der Landeshauptstadt Dresden, das `--ingest` vom
Kartendienst der Stadt holt, und der Laserscan der Landesvermessung, der
von Hand abgelegt wird (er ist groß) und mit einem Werkzeug namens PDAL in
Halbmeter-Höhenraster verwandelt wird. Ohne Scan behalten die Hecken die
Höhe, die OpenStreetMap ihnen gibt. Die Entwicklerseite
[data-pipeline.md](../../data-pipeline.md) (englisch) dokumentiert
Eingaben, Ausgaben und Stellschrauben jedes Schritts.

### Station 4 — die eingecheckten Derivate (`data/`)

Dieser Ordner ist das, was das Repository tatsächlich garantiert. Alles,
was der Viewer zeigt, liegt entweder hier oder wird daraus berechnet. Er
enthält je Kachel:

| Ordner | Dateien | Was sie sind | Größe je Kachel |
|---|---|---|---|
| `data/dgm/` | `dgm1_<Kachel>.tif` + `.tfw` + `_akt.csv` | das Geländemodell wie heruntergeladen (die Ausnahme von oben) | 13,6 MB |
| `data/cityjson/` | `lod2_<Kachel>.city.json` | das Gebäudemodell, nach CityJSON umgewandelt | 8–11 MB |
| `data/dlm/` | `landcover_<Kachel>.png` + `.json` | Landnutzungsklasse je Halbmeter-Pixel (4096²), mit Legende; die Datei enthält nur Klassennummern, die Farben kommen erst im Browser dazu | 0,2 MB |
| | `ndvi_<Kachel>.png` | Grünindex aus dem Luftbild, 1024² | 0,3–0,5 MB |
| | `vegrows_<Kachel>.geojson` | Hecken- und Baumreihenlinien | wenige kB |
| | `canopy_<Kachel>.geojson` | ein Punkt je Baum mit Höhe (5 000–16 000 je Kachel) | 0,6–1,8 MB |
| | `trees_<Kachel>.geojson` | die Stadtbäume: Höhe, Kronenbreite, Kronenform | 0,4–0,8 MB |
| | `lowveg_<Kachel>.geojson` | Heckenlinien mit Höhe und Breite | 10–30 kB |
| | `canopyx_<Kachel>.geojson` | Bäume, die der Laserscan in Höfen und Gärten findet (nur Startkachel) | 0,65 MB |
| | `lamps_<Kachel>.geojson` | Lampenpositionen | bis 60 kB |
| | `walls_<Kachel>.geojson` | Mauerlinien mit Art und Höhe | 50–120 kB |
| | `rail_<Kachel>.geojson`, `railarea_<Kachel>.geojson` | Gleislinien mit Gleiszahl; verschmolzene Schotterflächen | wenige kB |
| | `bridge_<Kachel>.geojson` | Brückendeck-Umrisse mit Höhe je Ecke, Art und Tragwerk | wenige kB |
| | `platform_<Kachel>.geojson` | Bahnsteige | wenige kB |
| `data/dop/` | `roofcolor_<Kachel>.json` | eine Farbe je Gebäude, aus dem Luftbild abgetastet | 0,2 MB |

Insgesamt trägt das Repository etwa 125 MB Daten für die vier Kacheln
(plus zwei Geländekacheln im Osten, die noch nichts lädt).

**Eine Wahrheit gegenüber Derivat, auf einen Blick:**

| Schicht im Viewer | Wahrheit (Anbieter) | Im Repository eingecheckt | Beim Build erzeugt | An den Browser gesendet |
|---|---|---|---|---|
| Gelände | DGM1-GeoTIFF | das GeoTIFF selbst | zwei **Dreiecksnetze** je Kachel (ein detailliertes und ein grobes), die dem 1-m-Raster auf 15 cm bzw. 50 cm genau folgen, als **glTF** | das Netz, das die Kamera gerade braucht |
| Gebäude | LoD2-CityGML | die CityJSON-Umwandlung | ein **glTF-Gebäudenetz** je Kachel mit einer Tabelle von Stilwerten je Gebäude (Dachfarbe eingearbeitet), dazu die Grundrisse für die Minikarte | Netz + Grundrisse |
| Bodenfarben | Basis-DLM-Shapefiles | das Landnutzungsklassen-PNG mit Legende | eine halb so große Kopie (2048²) für Handys, ferne Geländeteile und die Minikarte | die Klassen-PNGs; die Farben malt der Browser |
| Bäume | Basis-DLM + DOM1 + DGM1; das Stadtbaumkataster; der Laserscan | Baumpunkte, Heckenreihen, Stadtbäume, Laserscan-Bäume | — | wie eingecheckt |
| Hecken | OpenStreetMap + der Laserscan | Heckenlinien mit Höhe | — | wie eingecheckt |
| Grün | DOP | das NDVI-PNG | — | wie eingecheckt |
| Dachfarben | DOP + LoD2 | die Dachfarben-Tabelle | in die Tabelle des Gebäudenetzes eingearbeitet | im Gebäudenetz |
| Lampen, Mauern, Bahnsteige, Brückentragwerk | OpenStreetMap | die GeoJSON-Dateien | — | wie eingecheckt |
| Gleise, Schotter, Brücken | Basis-DLM (+ DOM1/DGM1 für Höhen) | die GeoJSON-Dateien | — | wie eingecheckt |

### Station 5 — der Build-Schritt (`scripts/prepare-data.ts`)

Jedes `bun dev` und `bun build` beginnt damit, dieses Skript auszuführen.
Es tut drei Dinge:

1. **Backt die schweren Eingaben zu einem Tileset.** Für jede Kachel wird
   das Gelände-GeoTIFF zu zwei fertigen Netzen aus unregelmäßigen
   Dreiecken: einem detaillierten, das jedem Punkt des 1-m-Rasters auf
   15 cm nahekommt, und einem groben auf 50 cm. Flacher Boden wie der Fluss
   wird zu wenigen großen Dreiecken, und die Dreiecke drängen sich dort, wo
   der Boden sich biegt — an Böschungen und Mauern. Eine kurze Schürze am
   Rand sorgt dafür, dass an den Nahtstellen zwischen Kacheln keine Lücke
   sichtbar wird. Das CityJSON wird zu einem
   Gebäudenetz je Kachel mit einer Tabelle von Stilwerten je Gebäude, dazu
   einer Liste der Gebäudegrundrisse für die Minikarte. Jedes Netz wird als
   **glTF** geschrieben, das Standardformat für 3D-Modelle, komprimiert und
   gezippt: etwa 1,1–1,5 MB Gebäude, 0,9–1,5 MB detailliertes und
   0,17–0,31 MB grobes Gelände je Kachel, statt des 13,6-MB-GeoTIFFs und
   des 8–11-MB-CityJSONs. Eine kleine Indexdatei, `tileset.json`, im
   offenen **3D-Tiles**-Format, listet für jede Kachel die Gebäude und die
   zwei Geländestufen und legt fest, ab welcher Nähe die detaillierte Stufe
   die grobe ersetzt. Das Landnutzungsklassen-PNG bekommt eine
   2048²-Kopie. Ergebnisse werden in `.cache/` zwischengespeichert und nur
   neu erzeugt, wenn sich eine Eingabe oder der Bake-Code geändert hat.
2. **Veröffentlicht** jede Datei nach `public/data/` unter einem Namen, der
   einen Fingerabdruck ihres Inhalts trägt (zum Beispiel
   `canopy_33412_5656_2_sn.55a26a2d.geojson`), und schreibt eine
   `manifest.json`, die die einfachen Namen auf die Namen mit
   Fingerabdruck abbildet.
3. **Räumt auf**, was das Manifest nicht mehr nennt, damit eine entfernte
   Quelle ihr Feature wirklich abschaltet, statt weiterzuleben.

Die Namen mit Fingerabdruck erlauben dem Browser, jede Datendatei dauerhaft
zu cachen; nur das winzige Manifest wird bei jedem Besuch neu geprüft. Ein
neues Bake ändert die Fingerabdrücke, und das neue Manifest zeigt auf die
neuen Dateien.

### Station 6 — der Browser

Der Browser holt das Manifest und das Tileset und **streamt** dann: Eine
Bibliothek namens 3DTilesRendererJS entscheidet danach, wo die Kamera
steht und wohin sie schaut, welche Dateien geladen werden. Das erste Bild
wartet nur auf Gebäude und Gelände der Kachel, auf der du startest.
Kacheln nahe der Kamera bekommen das detaillierte Gelände und werden dann
mit Bäumen, Hecken, Lampen, Gleisen und Mauern *ausgestattet*; weiter entfernte
Kacheln zeigen ihre Gebäude auf dem groben Gelände; Kacheln außer Sicht
werden gar nicht geladen, und Kacheln, die du hinter dir gelassen hast,
können wieder aus dem Speicher fallen. Gemessen an den aktuellen Daten
(komprimierte Größe, wie über das Netz gesendet):

| Was | Startkachel | Andere Kacheln | Geladen, wenn |
|---|---|---|---|
| Gebäude (mit Stiltabelle) | 1,34 MB | 1,09–1,46 MB | die Kachel im Blick ist |
| Gebäudegrundrisse (Minikarte) | 48 kB | 59–76 kB | mit den Gebäuden |
| Grobes Gelände (auf 50 cm) | 0,17 MB | 0,19–0,31 MB | die Kachel im Blick ist |
| Detailliertes Gelände (auf 15 cm) | 0,90 MB | 0,89–1,47 MB | die Kamera nahe kommt |
| Landnutzungsklassen, 2048² | 0,08 MB | 0,07–0,08 MB | beim Start (Minikarte), dann fürs grobe Gelände |
| Landnutzungsklassen, 4096² | 0,22 MB | 0,22–0,25 MB | mit dem detaillierten Gelände (nur Desktop) |
| Grün (NDVI) | 0,39 MB | 0,32–0,45 MB | mit dem Gelände |
| Baumpunkte | 36 kB | 54–106 kB | mit dem detaillierten Gelände |
| Stadtbäume (Kataster) | 59 kB | 31–53 kB | mit dem detaillierten Gelände |
| Laserscan-Bäume | 51 kB | — | mit dem detaillierten Gelände |
| Hecken | 4 kB | 2–3 kB | mit dem detaillierten Gelände |
| Mauern | 12 kB | 8–22 kB | mit dem detaillierten Gelände |
| Lampen, Gleise, Schotter, Brücken, Bahnsteige, Heckenreihen | je unter 5 kB | je unter 5 kB | mit dem detaillierten Gelände |
| **Je Kachel, volle Detailstufe** | **≈ 3,3 MB** | **≈ 3,0–4,3 MB** | |
| **Je Kachel, nur als ferne Kulisse** | ≈ 2,0 MB | ≈ 1,8–2,4 MB | |

Wie viel ein Besuch lädt, hängt also davon ab, wohin du gehst. Mit jeder
Kachel in voller Detailstufe hat ein Desktop-Browser etwa **14 MB** für die
vier Kacheln geladen; ein Handy etwa 13 MB (es nimmt für jede Kachel das
2048²-Landnutzungsraster); das nur für Tests gedachte „lite“-Profil, das
allein die Startkachel streamt, etwa 3,3 MB. Das ist mehr als vor der
Umstellung aufs Streamen (ein vollständiger Besuch lag bei etwa 10,6 MB),
weil das Gelände jetzt als fertiges Netz statt als kompaktes Höhenraster
ankommt; dafür ist jede Datei ein Standardformat, das gängige 3D-Werkzeuge
öffnen können. (Die erste Streaming-Fassung mit regelmäßigem
Geländeraster lag bei etwa 17 MB.)

Was **nie** gesendet wird: das 13,6-MB-Gelände-GeoTIFF, das 10-MB-CityJSON
und keiner der Rohdownloads. Der Browser parst kein CityJSON und baut kein
Gelände; er bekommt Netze, die er direkt zeichnen kann, dazu kleine Bilder
und Feature-Dateien.

Was **im Browser berechnet** statt heruntergeladen wird: die Bodenfarben
(einmal je Kachel auf der Grafikkarte gemalt, aus den
Landnutzungsklassen und einer Pastellpalette), die Wasseroberfläche, jeder
Baum aus seinem Punkt und seiner Höhe, Laternenmasten aus ihren Punkten,
Mauern und Brücken aus ihren Umrissen, der Sonnenstand, alle Beleuchtung
und Schatten und der gesamte Nachbearbeitungs-Look.

## Was neu gemacht werden muss, wenn sich etwas ändert

| Änderung | Manuelle Schritte | Automatisch |
|---|---|---|
| Neuer Geländestand | GeoTIFF in `data/dgm/` ersetzen; die Bakes `canopy` und `rail` neu ausführen (sie lesen es) | die Geländenetze samt Mauerkanten werden beim nächsten Build neu gebacken |
| Neues Gebäudemodell | nach CityJSON umwandeln, in `data/cityjson/` ersetzen; das Bake `roof-colour` neu ausführen | das Gebäudenetz wird beim nächsten Build neu gebacken |
| Neuer Landnutzungsstand | das neue Paket laden, das Bake `landcover` neu ausführen, dann `canopy`, `lamps` und `rail` (sie lesen das Klassenraster) | die 2048²-Kopien werden neu gebacken |
| Neue Luftbilder | die Bakes `ndvi` und `roof-colour` neu ausführen | die Dachfarben werden beim nächsten Build ins Netz eingearbeitet |
| Neue OpenStreetMap-Daten | einen frischen Geofabrik-Auszug laden und die Bakes `lamps`, `walls` und `rail` neu ausführen | — |
| Andere Bodenfarben | die eine Palette im Code ändern | nichts neu zu backen: Der Browser malt die Farben |
| Eine neue Kachel | Gelände- und Gebäudemodell von Hand laden (das Gebäudemodell nach CityJSON umgewandelt) und beide einchecken; die Kachel in die Standort-Konfiguration `sites/dresden.ts` eintragen; `bun run bake --ingest` holt den Rest und führt alle sieben Bakes aus | der Build nimmt sie ins Tileset auf und veröffentlicht sie |

## Warum es so gebaut ist

Die schwere Arbeit einmal offline zu erledigen, hält den Viewer eine
schlichte statische Website: kein Server, keine Datenbank, keine
API-Schlüssel und ein erstes Bild in wenigen Sekunden selbst auf dem Handy.
Die kleinen Derivate im Repository zu halten, heißt, dass jeder den Viewer
ohne die Gigabytes an Rohdaten bauen und starten kann und jede Änderung
dessen, was der Viewer zeigt, in der Versionsgeschichte sichtbar ist. Die
Abwägungen stehen in den
[Architekturentscheidungen](../../adr/README.md) (englisch).
