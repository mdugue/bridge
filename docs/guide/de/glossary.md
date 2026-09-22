# Glossar

*English: [Glossary](../en/glossary.md)*

Die Abkürzungen und der Fachjargon dieses Projekts, in einfachen Worten.
Zuerst Geodaten-Begriffe, dann Rendering-Begriffe, dann Projektbegriffe.

## Geodaten

Die Datensätze selbst haben vollständige Steckbriefe (Abkürzung,
Erhebungsmethode, Aktualisierungsturnus, Genauigkeit, Eignung, Stärken und
Schwächen) in [Woher die Daten kommen](./data-sources.md#datensatz-für-datensatz);
die Einträge hier sind die Kurzform.

**AAA / GeoInfoDok** — das bundesweite Datenmodell hinter ALKIS, ATKIS und
den Festpunkten (*AFIS-ALKIS-ATKIS*), dokumentiert in der *GeoInfoDok*. Das
Basis-DLM folgt seinem Schema 7.1.2; deshalb sind seine Objektarten in
jedem Bundesland gleich.

**ALKIS** — *Amtliches Liegenschaftskataster-Informationssystem*, das
amtliche Kataster: Flurstücke, Eigentumsgrenzen, Gebäudegrundrisse und
-funktionen. Die Gebäudeattribute im 3D-Modell (Funktionsschlüssel,
Dachform) folgen ALKIS-Schlüssellisten. Flurstücke selbst werden noch nicht
genutzt.

**ATKIS** — *Amtliches Topographisch-Kartographisches Informationssystem*,
das bundesweite System amtlicher topographischer Daten. Das Basis-DLM ist
sein detailliertestes Landschaftsmodell.

**Basis-DLM** — *Digitales Basis-Landschaftsmodell*: die Vektorkarte
dessen, was den Boden bedeckt (Straßen, Gleise, Gewässer, Wald,
Landwirtschaft, Siedlung), mit Attributen, von der Landesvermessung aus
Orthophotos, Geländemodell, örtlichen Messungen und Daten anderer Stellen
gepflegt; jedes Objekt alle 3–5 Jahre überprüft, wichtige alle 3–12 Monate;
Lagegenauigkeit ±3 m für wesentliche Linienobjekte. Geliefert als
Shapefiles, landesweit, quartalsweise erneuert. Die Bodenfarben, Hecken,
Bahnen und Brücken des Viewers stammen daraus.
[Steckbrief](./data-sources.md#basis-dlm--das-landschaftsmodell).

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

**DGM1** — *Digitales Geländemodell 1*, das Geländemodell: Höhen des
nackten Bodens auf einem 1-m-Raster, interpoliert aus den Bodenpunkten
eines flugzeuggestützten Laserscans; Höhengenauigkeit bis ±0,15 m.
Gebäude, Brücken und Vegetation sind entfernt. Dresden wurde im November
2024 gescannt. [Steckbrief](./data-sources.md#dgm1--das-geländemodell).

**DHHN2016** — *Deutsches Haupthöhennetz 2016*, der aktuelle deutsche
Höhenbezug; Höhen sind „Meter über Normalhöhennull“ in diesem System.

**DOM1** — *Digitales Oberflächenmodell 1*, das Oberflächenmodell: die
erste Oberfläche, die der Laser trifft, auf einem 1-m-Raster — Dächer,
Baumwipfel, Brückendecks. Aus derselben Befliegung wie das DGM1;
DOM1 − DGM1 ergibt die Höhe von allem, was auf dem Boden steht.
[Steckbrief](./data-sources.md#dom1--das-oberflächenmodell).

**DOP / DOP20 / RGBI** — *Digitales Orthophoto*: eine Luftaufnahme, die
über das Geländemodell entzerrt ist, sodass jedes Pixel an seiner wahren
Kartenposition sitzt; „20“ = 20 cm je Pixel; „RGBI“ = Rot, Grün, Blau plus
Nahinfrarot. Von Vermessungsflugzeugen aufgenommen, jede Kachel etwa alle
zwei Jahre, abwechselnd im Frühjahr und Sommer; Lagegenauigkeit ≤ 0,4 m.
Diese Kacheln stammen vom 19. März 2024.
[Steckbrief](./data-sources.md#dop20-rgbi--die-luftbilder).

**DTK** — *Digitale Topographische Karte*, das amtliche Kartenwerk (DTK10,
DTK25, DTK50, DTK100 für die Maßstäbe 1:10 000 bis 1:100 000), als
Rasterkacheln vom selben Portal verfügbar; noch nicht genutzt (Kandidat für
eine kartographische Minikarte).

**Echo (first / last / only)** — ein Laserimpuls kann mehrere Echos
zurückwerfen: das *erste* von der Baumkrone oder dem Dach, das *letzte* vom
Boden darunter. Das Oberflächenmodell nutzt die ersten Echos, das
Geländemodell die als Boden klassifizierten Punkte.

**GDAL / ogr2ogr** — das quelloffene Geodaten-Werkzeugpaket, mit dem die
Bake-Skripte ausschneiden, umprojizieren, rastern und umwandeln.

**GeoJSON** — ein einfaches JSON-Format für Punkte, Linien und Polygone mit
Attributen. Alle kleinen Vektordateien je Kachel sind GeoJSON.

**GeoTIFF / Weltdatei (.tfw)** — ein TIFF-Bild, das zusätzlich weiß, wo auf
der Erde es liegt. Fehlt die Lage im Bild, liefert eine kleine `.tfw`-
Textdatei daneben sie nach.

**Geofabrik** — ein Unternehmen, das regionale OpenStreetMap-Auszüge zum
Download anbietet, täglich neu gebaut; das Projekt liest den
Sachsen-Auszug.

**GeoSN** — *Landesamt für Geobasisinformation Sachsen*, die
Landesvermessung und Anbieter aller hier genutzten amtlichen Datensätze.

**Bodenauflösung / GSD** — die Größe eines Pixels am Boden (*ground
sampling distance*): 20 cm beim DOP, 1 m bei den Höhenmodellen.

**Landnutzungsklasse** — die Nutzungskategorie eines Pixels im gebackenen
Klassenraster: Hintergrund, Landwirtschaft/Wiese, Wald, Gehölz, Siedlung,
Bahn, Weg, Straße, Wasser (Kennungen 0–8).

**LiDAR / Laserscanning** — *light detection and ranging*:
Entfernungsmessung mit Laserimpulsen aus dem Flugzeug; die Messmethode
hinter Punktwolke, DGM1, DOM1 und den Dachformen des LoD2.

**LoD1 / LoD2** — *Level of Detail* eines 3D-Gebäudemodells: LoD1 ist ein
flacher Klotz je Gebäude, LoD2 ergänzt die an den Laserscan angepasste
Standard-Dachform; LoD3 hätte Fassadendetail. Das Modell wird automatisch
aus Katastergrundrissen und der Punktwolke erzeugt; der Stand einer Kachel
ist der ihrer Eingaben (hier: Laserscan 2016, Grundrisse 2021/2022).
[Steckbrief](./data-sources.md#lod2--das-3d-gebäudemodell).

**LSC** — *Laserscandaten*, die klassifizierte Laser-Punktwolke selbst
(LAZ-Dateien), das Rohmaterial der Höhenmodelle; vom Viewer noch nicht
genutzt. [Steckbrief](./data-sources.md#lsc--die-laserscan-punktwolke).

**nDOM** — *normalisiertes DOM*: Oberflächenmodell minus Geländemodell,
also die Höhe dessen, was auf dem Boden steht. Vom Projekt aus DOM1 und
DGM1 berechnet; das Portal bietet es auch auf Anfrage an.

**NDVI** — *Normalized Difference Vegetation Index*: (Infrarot − Rot) /
(Infrarot + Rot). Gesunde Vegetation reflektiert Infrarot stark, also ist
der Index auf saftigen Pflanzen hoch und auf Dächern, Straßen und Wasser
nahe null. Nur so gut wie das Aufnahmedatum (ein Märzbild zeigt kahle
Laubbäume). [Steckbrief](./data-sources.md#ndvi--der-grünindex-abgeleitet-nicht-heruntergeladen).

**ODbL** — *Open Database License*, die Lizenz von OpenStreetMap; verlangt
den Vermerk „© OpenStreetMap-Mitwirkende“.

**dl-de/by-2-0** — *Datenlizenz Deutschland – Namensnennung – Version 2.0*,
die Lizenz der offenen Geodaten des GeoSN; verlangt den Vermerk „Quelle:
GeoSN, dl-de/by-2-0“.

**OSM / Overpass** — *OpenStreetMap*, die Freiwilligen-Weltkarte, kartiert
aus GPS-Spuren, Begehungen und abgezeichneten Luftbildern, laufend
aktualisiert, ohne Genauigkeitsgarantie; und die *Overpass-API*, ein
Abfragedienst dafür. Lampen, Mauern, Bahnsteige und Brücken-Tragwerkstypen
des Viewers stammen daraus. [Steckbrief](./data-sources.md#osm--openstreetmap).

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
