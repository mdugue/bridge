# Glossar

*English: [Glossary](../en/glossary.md)*

Die Abkürzungen und der Fachjargon dieses Projekts, in einfachen Worten.
Zuerst Geodaten-Begriffe, dann Rendering-Begriffe, dann Projektbegriffe.

## Geodaten

**ALKIS** — *Amtliches Liegenschaftskataster-Informationssystem*, das
amtliche Kataster: Flurstücke, Eigentumsgrenzen, Gebäudefunktionen. Die
Gebäudeattribute im 3D-Modell (Funktionsschlüssel, Dachform) folgen
ALKIS-Schlüssellisten. Flurstücke selbst werden noch nicht genutzt.

**ATKIS** — *Amtliches Topographisch-Kartographisches Informationssystem*,
das bundesweite System amtlicher topographischer Daten. Das Basis-DLM ist
sein detailliertestes Landschaftsmodell.

**Basis-DLM** — *Digitales Basis-Landschaftsmodell*: die Vektorkarte
dessen, was den Boden bedeckt (Straßen, Gleise, Gewässer, Wald,
Landwirtschaft, Siedlung), mit Attributen. Geliefert als Shapefiles. Die
Bodenfarben, Hecken, Bahnen und Brücken des Viewers stammen daraus.

**CityGML / CityJSON** — zwei Kodierungen desselben Standards für
3D-Stadtmodelle. CityGML ist XML und das, was das Portal liefert; CityJSON
ist eine kompakte JSON-Form davon, in die das Projekt umwandelt. Beide
beschreiben Gebäude als Körper mit semantischen Flächen (Wand, Dach,
Boden).

**CRS / EPSG:25833** — ein *Koordinatenreferenzsystem* legt fest, was die
Zahlen einer Koordinate bedeuten. EPSG:25833 ist „ETRS89 / UTM-Zone 33 N“:
Meter östlich und nördlich eines Bezugspunkts, gültig für Ostdeutschland.
Alle Projektdaten bleiben in diesem System; die Szeneneinheit des Viewers
ist der Meter.

**DGM1** — *Digitales Geländemodell*: Bodenhöhen auf einem 1-m-Raster, mit
entfernten Gebäuden und Vegetation.

**DHHN2016** — der aktuelle deutsche Höhenbezug; Höhen sind „Meter über
Normalhöhennull“ in diesem System.

**DOM1** — *Digitales Oberflächenmodell*: die erste Oberfläche, die der
Laser trifft, auf einem 1-m-Raster — Dächer, Baumwipfel, Brückendecks.

**DOP / DOP20 / RGBI** — *Digitales Orthophoto*: eine Luftaufnahme, die so
entzerrt ist, dass jedes Pixel an seiner wahren Kartenposition sitzt; 20 cm
je Pixel; „RGBI“ = Rot, Grün, Blau plus Nahinfrarot.

**GDAL / ogr2ogr** — das quelloffene Geodaten-Werkzeugpaket, mit dem die
Bake-Skripte ausschneiden, umprojizieren, rastern und umwandeln.

**GeoJSON** — ein einfaches JSON-Format für Punkte, Linien und Polygone mit
Attributen. Alle kleinen Vektordateien je Kachel sind GeoJSON.

**GeoTIFF / Weltdatei (.tfw)** — ein TIFF-Bild, das zusätzlich weiß, wo auf
der Erde es liegt. Fehlt die Lage im Bild, liefert eine kleine `.tfw`-
Textdatei daneben sie nach.

**Geofabrik** — ein Unternehmen, das regionale OpenStreetMap-Auszüge zum
Download anbietet; das Projekt liest den Sachsen-Auszug.

**GeoSN** — *Landesamt für Geobasisinformation Sachsen*, die
Landesvermessung und Anbieter aller hier genutzten amtlichen Datensätze.

**Landnutzungsklasse** — die Nutzungskategorie eines Pixels im gebackenen
Klassenraster: Hintergrund, Landwirtschaft/Wiese, Wald, Gehölz, Siedlung,
Bahn, Weg, Straße, Wasser (Kennungen 0–8).

**LoD1 / LoD2** — *Level of Detail* eines 3D-Gebäudemodells: LoD1 ist ein
flacher Klotz je Gebäude, LoD2 ergänzt die standardisierte Dachform. Kein
Fassadendetail in beiden.

**nDOM** — *normalisiertes DOM*: Oberflächenmodell minus Geländemodell,
also die Höhe dessen, was auf dem Boden steht. Vom Projekt aus DOM1 und
DGM1 berechnet; das Portal bietet es auch auf Anfrage an.

**NDVI** — *Normalized Difference Vegetation Index*: (Infrarot − Rot) /
(Infrarot + Rot). Gesunde Vegetation reflektiert Infrarot stark, also ist
der Index auf saftigen Pflanzen hoch und auf Dächern, Straßen und Wasser
nahe null.

**ODbL** — *Open Database License*, die Lizenz von OpenStreetMap; verlangt
den Vermerk „© OpenStreetMap-Mitwirkende“.

**dl-de/by-2-0** — *Datenlizenz Deutschland – Namensnennung – Version 2.0*,
die Lizenz der offenen Geodaten des GeoSN; verlangt den Vermerk „Quelle:
GeoSN, dl-de/by-2-0“.

**OSM / Overpass** — OpenStreetMap, die Freiwilligen-Weltkarte, und die
Overpass-API, ein Abfragedienst dafür.

**.osm.pbf** — das kompakte Binärformat von OpenStreetMap-Auszügen.

**Raster / Vektor** — ein Raster ist ein Gitter aus Pixeln (Geländemodell,
Luftbild); Vektordaten sind Punkte, Linien und Polygone (Gebäude, Straßen,
Baumpunkte).

**Shapefile** — ein altes, aber allgegenwärtiges Vektorformat; das
Basis-DLM kommt als ein Dateisatz je Objektart.

**Kachel** — ein 2 km × 2 km großes Quadrat des Landes-Kachelschemas. Der
Name `33412_5656_2_sn` bedeutet UTM-Zone 33, Rechtswert 412 km, Hochwert
5656 km (die Südwestecke), 2 km Kantenlänge, Sachsen. Der Viewer lädt einen
Block von vier; die, auf der du startest, ist die *Primärkachel*.

## Rendering

**three.js** — die JavaScript-Bibliothek, die über WebGL mit der Grafikkarte
spricht; die ganze Szene ist damit gebaut.

**WebGL2** — die Schnittstelle des Browsers zur Grafikkarte. Voraussetzung.

**Mesh / Dreieck** — alles Gezeichnete besteht aus Dreiecken. Ein Mesh ist
eine Menge Dreiecke mit einem Material. Die Gebäude einer Kachel sind ein
Mesh; ein „Gebäude“ ist je Eckpunkt gekennzeichnet, damit sich eines
abreißen lässt.

**Höhenfeld** — ein regelmäßiges Gitter von Höhen; das Geländenetz wird
daraus gebaut (ein Eckpunkt je Gitterzelle).

**Splatmap** — eine Textur, die dem Boden-Shader sagt, welche Farbe wo
hingehört. Hier: das pastellige Landnutzungsraster; sein Transparenzkanal
kodiert den Wasseranteil.

**Instancing / InstancedMesh** — tausende Kopien einer Form (Bäume,
Laternenmasten) in einem einzigen Zeichenaufruf, jede mit eigener Position
und Größe.

**LOD** — *Level of Detail*: eine günstigere Version einer Form, die in der
Ferne gezeichnet wird (die Baumkrone hat zwei Versionen).

**Schattenkarte** — ein Tiefenbild aus Sicht der Sonne; jedes Pixel prüft
dann, ob es das Nächste zur Sonne ist. Weiche Kanten entstehen durch
mehrfaches Abtasten (PCF).

**SSAO / Kontaktschatten** — *Screen-Space Ambient Occlusion*: Abdunkelung
in Ecken, unter Traufen und wo Objekte den Boden berühren, aus dem
Tiefenpuffer berechnet.

**Tiefenschärfe (DoF)** — die fotografische Unschärfe außerhalb der
Fokusentfernung; hier standardmäßig auf das Fadenkreuz fokussiert.

**Nachbearbeitung (Post-Processing)** — Effekte auf dem fertigen Bild:
Kontaktschatten, Tiefenschärfe, Kantenglättung (SMAA), Tiefenfärbung,
Vignette, Papierkorn.

**Füllrate** — wie viele Pixel je Sekunde die Grafikkarte einfärben kann;
der Hauptkostentreiber der Szene, weshalb Handys weniger Pixel rendern.

**Frustum** — die Pyramide des Raums, die eine Kamera (oder die
Schattenkamera) sieht; alles außerhalb wird übersprungen.

**BVH** — *Bounding Volume Hierarchy*, ein Suchbaum über Dreiecke, der
„was liegt unter dem Fadenkreuz“ und Kollisionsprüfungen schnell macht.

**Pixelverhältnis (DPR)** — wie viele gerenderte Pixel je Bildschirmpixel;
auf Handys gesenkt, um Füllrate zu sparen.

**SwiftShader** — ein Software-Renderer, den der Test-Browser ohne
Bildschirm nutzt; er zeichnet die Szene auf der CPU, langsam und ohne den
echten Look.

## Projekt

**Bake** — jeder Offline- oder Build-Schritt, der eine schwere Eingabe in
ein kleines, direkt nutzbares Artefakt verwandelt.

**Artefakt** — eine der vorbereiteten Dateien, die der Browser anfordern
kann; die vollständige Liste steht in `lib/city/tile.ts`.

**Manifest** — `public/data/manifest.json`, das einfache Dateinamen auf die
Namen mit Fingerabdruck abbildet, unter denen sie ausgeliefert werden.

**Content-Hash** — der achtstellige Fingerabdruck in einem ausgelieferten
Dateinamen; ändert sich, sobald sich der Inhalt ändert, sodass Caches nie
veraltete Daten liefern.

**Lite-Profil** — `?scene=lite`: eine Kachel, winzige Schattenkarte, halbe
Auflösung; nur für automatische Tests.

**Snapshot** — der JSON-Text, der Kamera, Datum/Uhrzeit und jeden Regler
festhält, um eine Ansicht zu reproduzieren.

**Aussichtspunkt** — einer der fünf gestalteten Standpunkte, zu denen die
Kamera gleiten kann.

**Primärkachel / Nachbarkacheln** — die Kachel, auf der du startest (volle
Detailstufe, Kollision, Abriss) und die drei drumherum (Kulisse, geringere
Auflösung).

**ADR** — *Architecture Decision Record*: ein kurzes Dokument, das eine
Entscheidung, ihren Kontext und ihre Folgen festhält; siehe
[docs/adr](../../adr/README.md) (englisch).
