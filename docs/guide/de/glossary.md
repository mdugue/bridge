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

**Deterministisch / erschlossen** — wie der Viewer zu einer Angabe kommt.
Deterministisch (`❝ übernommen`, `= berechnet`): aus der Quelle oder mit
einer festen Formel, gleiche Daten ergeben dasselbe. Erschlossen
(`◎ erkannt`, `≈ angenommen`): durch eine Regel, einen Abgleich oder eine
Gestaltung hinzugefügt. [Die vier Abzeichen](./methods.md).

**Echo (first / last / only)** — ein Laserimpuls kann mehrere Echos
zurückwerfen: das *erste* von der Baumkrone oder dem Dach, das *letzte* vom
Boden darunter. Das Oberflächenmodell nutzt die ersten Echos, das
Geländemodell die als Boden klassifizierten Punkte.

**GDAL** — das quelloffene Geodaten-Werkzeugpaket, mit dem die Bakes
ausschneiden, umprojizieren, rastern und umwandeln. Es steckt in den
Python-Bibliotheken des Bake-Pakets und muss nicht eigens installiert
werden.

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
Bahn, Weg, Straße, Wasser (Kennungen 0–8). Die Datei enthält nur diese
Nummern; der Browser malt jede Klasse in ihrer Pastellfarbe (siehe
*Splatmap*).

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
(LAZ-Dateien), das Rohmaterial der Höhenmodelle. Offline gelesen, wo ein
Vermessungsamt sie anbietet (Sachsen, Nordrhein-Westfalen), für
Heckenhöhen, Gartenbäume und die Schuppen, die dem 3D-Gebäudemodell
fehlen. [Steckbrief](./data-sources.md#lsc--die-laserscan-punktwolke).

**Mustererkennung** — hier: eine Regel mit Schwellenwerten entscheidet,
*was* etwas ist (ein Baum an einer Kronenspitze, ein Schuppen im
Laserscan), oder zwei Quellen werden abgeglichen (ein Laden wird einem
Gebäude zugeordnet). Offen und reproduzierbar, aber nicht unfehlbar; der
Viewer kennzeichnet es mit `◎ erkannt`. [Die vier Abzeichen](./methods.md).

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
aktualisiert, ohne Genauigkeitsgarantie. Lampen, Mauern, Treppen, Bahnsteige
und Brücken-Tragwerkstypen des Viewers stammen daraus; die Bakes lesen sie aus
dem Geofabrik-Auszug. Die *Overpass-API* ist ein Live-Abfragedienst dafür;
die Bakes nutzen sie nicht mehr, aber die eingecheckten Lampen-,
Bahnsteig- und Brückentragwerk-Dateien wurden noch über sie geholt.
[Steckbrief](./data-sources.md#osm--openstreetmap).

**.osm.pbf** — das kompakte Binärformat von OpenStreetMap-Auszügen.

**Raster / Vektor** — ein Raster ist ein Gitter aus Pixeln (Geländemodell,
Luftbild); Vektordaten sind Punkte, Linien und Polygone (Gebäude, Straßen,
Baumpunkte).

**Shapefile** — ein altes, aber allgegenwärtiges Vektorformat; das
Basis-DLM kommt als ein Dateisatz je Objektart.

**Kachel** — ein 2 km × 2 km großes Quadrat des Landes-Kachelschemas. Der
Name `33412_5656_2_sn` bedeutet UTM-Zone 33, Rechtswert 412 km, Hochwert
5656 km (die Südwestecke), 2 km Kantenlänge, Sachsen. Die
Standort-Konfiguration nennt für Dresden fünfzehn davon; die erste ist die
*Startkachel*. Der Viewer streamt sie (siehe *Tileset*).

## Rendering

**three.js** — die JavaScript-Bibliothek, die über WebGPU (oder WebGL2) mit
der Grafikkarte spricht; die ganze Szene ist damit gebaut.

**WebGPU / WebGL2** — die Schnittstellen des Browsers zur Grafikkarte. Der
Viewer nutzt WebGPU, die neuere und schnellere, und weicht auf WebGL2 aus,
wo ein Browser sie nicht hat; eine der beiden ist Voraussetzung.

**Shader / Node-Material** — die kleinen Programme, mit denen die
Grafikkarte jedes Pixel einfärbt. Hier ist jedes Material als
*Node-Material* geschrieben (TSL von three.js): Der Look wird aus
Bausteinen zusammengesetzt, die three.js für WebGPU oder WebGL2 übersetzt.

**Mesh / Dreieck** — alles Gezeichnete besteht aus Dreiecken. Ein Mesh ist
eine Menge Dreiecke mit einem Material. Die Gebäude einer Kachel sind ein
Mesh; ein „Gebäude“ ist je Eckpunkt gekennzeichnet, damit sich eines
abreißen lässt.

**glTF** — das Standard-Dateiformat für 3D-Modelle, oft „das JPEG der
3D-Welt“ genannt. Gebäude und Gelände kommen als glTF-Dateien im Browser
an, komprimiert und gezippt (`.glb.gz`), sodass jeder glTF-Betrachter sie
öffnen kann.

**3D Tiles** — ein offener Standard (des OGC, des Gremiums hinter vielen
Geodaten-Standards) zum Streamen großer 3D-Welten: Eine kleine Indexdatei
beschreibt einen Baum von Kacheln und ihren Detailstufen, die Dateien
selbst sind meist glTF. Der Viewer liest ihn mit der Bibliothek
3DTilesRendererJS.

**Tileset / Streamen** — die Indexdatei `tileset.json` listet für jede
Kachel die Gebäude und das Gelände in zwei Detailstufen, einer groben
(512²-Raster) und einer detaillierten (ein TIN, siehe unten), die sie ersetzt,
sobald die Kamera nahe kommt. Daraus entscheidet der Viewer, was er lädt:
nur, was die Kamera sehen kann, nah detailliert, fern grob; was du weit
hinter dir lässt, kann wieder entfallen.

**Höhenfeld** — ein regelmäßiges Gitter von Höhen, etwa das DGM1. Der
Build-Schritt macht daraus ein fertiges Geländenetz; der Browser bekommt
das Gitter selbst nicht mehr.

**TIN** — *Triangulated Irregular Network*, ein unregelmäßiges
Dreiecksnetz: ein Geländenetz, dessen Dreiecke nicht auf einem festen
Raster liegen — mehr Dreiecke, wo sich der Boden krümmt, wenige, wo er
flach ist. Die detaillierte Geländestufe ist ein TIN des DGM1, das ihm auf
±15 cm folgt; die grobe ist ein 512²-Raster.

**Splatmap** — eine Textur, die dem Boden-Shader sagt, welche Farbe wo
hingehört. Hier wird sie nicht heruntergeladen: Der Browser malt sie einmal
je Kachel auf der Grafikkarte, aus dem Landnutzungs-Klassenraster und einer
Pastellpalette; ihr Transparenzkanal kodiert den Wasseranteil, am Ufer
weich auslaufend.

**Instancing** — tausende Kopien einer Form (Bäume, Laternenmasten) in
einem einzigen Zeichenaufruf, jede mit eigener Position und Größe.

**LOD** — *Level of Detail*: eine günstigere Version einer Form, die in der
Ferne gezeichnet wird (die Baumkrone hat zwei Versionen, das Gelände zwei
Stufen; siehe *Tileset*).

**Schattenkarte** — ein Tiefenbild aus Sicht der Sonne; jedes Pixel prüft
dann, ob es das Nächste zur Sonne ist. Weiche Kanten entstehen durch
mehrfaches Abtasten (PCF).

**Kontaktschatten (SSAO, GTAO)** — *Screen-Space Ambient Occlusion*
(SSAO) heißt die Familie von Verfahren, die Ecken, den Raum unter Traufen
und die Stellen, wo Objekte den Boden berühren, aus dem Tiefenpuffer
abdunkeln. Der Viewer nutzt eines davon, *GTAO* (Ground-Truth Ambient
Occlusion), in halber Auflösung.

**Tiefenschärfe (DoF)** — die fotografische Unschärfe außerhalb der
Fokusentfernung; hier standardmäßig auf die Bildmitte fokussiert. Nicht
auf Telefonen.

**Nachbearbeitung (Post-Processing)** — Effekte auf dem fertigen Bild:
Kontaktschatten, Tiefenschärfe, Kantenglättung (SMAA; auf Telefonen das
leichtere FXAA), Tiefenfärbung, Vignette, Papierkorn.

**Füllrate** — wie viele Pixel je Sekunde die Grafikkarte einfärben kann;
der Hauptkostentreiber der Szene, weshalb Handys weniger Pixel rendern.

**Frustum** — die Pyramide des Raums, die eine Kamera (oder die
Schattenkamera) sieht; alles außerhalb wird übersprungen.

**BVH** — *Bounding Volume Hierarchy*, ein Suchbaum über Dreiecke, der
„was liegt unter dem Mauszeiger“ und Kollisionsprüfungen schnell macht.

**Pixelverhältnis (DPR)** — wie viele gerenderte Pixel je Bildschirmpixel;
auf Handys gesenkt, um Füllrate zu sparen.

**SwiftShader** — ein Software-Renderer, den der Test-Browser ohne
Bildschirm nutzt; er zeichnet die Szene auf der CPU, langsam und ohne den
echten Look.

## Planzeichnung

Die Ansichten des *Modells* (siehe [Bedienung](./using-the-viewer.md#modell-die-stadt-als-planzeichnung)).

**Parallelprojektion / Axonometrie** — eine Zeichnung, deren Sehstrahlen
alle parallel laufen: kein Fluchtpunkt, gleiche Längen bleiben überall im
Bild gleich lang, und das Bild hat einen Maßstab. Axonometrien sind die
Parallelprojektionen, die drei Seiten eines Baukörpers zeigen.

**Isometrie** — die Axonometrie, die alle drei Achsen gleich verkürzt
(× 0,816): 35,26° über dem Boden gesehen, 45° zum Baukörper gedreht,
laufen die Kanten des Bodens auf dem Blatt unter 30° — daher
„30°-Isometrie“.

**Militärperspektive** — eine schiefe Axonometrie: der Grundriss
unverzerrt und maßstäblich gezeichnet, gedreht (meist 30°/60° oder
45°/45°), die Höhen senkrecht darüber, wahr oder auf zwei Drittel
verkürzt.

**Vogelschau** — hier eine parallele Ansicht von oben unter beliebiger
Neigung.

**Lageplan** — senkrecht von oben, Norden oben, maßstäblich.

**Ansicht / Schnitt** — waagerechte Blicke auf eine Linie. Ein Schnitt
schneidet dort und füllt, was der Schnitt öffnet (das **Poché**, hier
schwarz), mit dem Gelände als Profil (*Geländeschnitt*).

**Schwarzplan** — Gebäude schwarz auf Weiß, sonst nichts; die älteste
Art, das Gefüge einer Stadt zu lesen.

**Maßstab** — 1 : n heißt, eine Einheit auf dem Blatt ist n in der
Wirklichkeit. Am Bildschirm rechnet der Viewer ein CSS-Pixel als 1/96
Zoll (0,26 mm); das gespeicherte Bild nennt seinen Maßstab bei 300 dpi.

**Verschattungsstudie** — dieselbe Ansicht zu festen Uhrzeiten an der
Tagundnachtgleiche (21. März) und den Sonnenwenden (21. Juni,
21. Dezember): wie viel Sonne ein Ort übers Jahr bekommt.

## Projekt

**Bake** — jeder Offline- oder Build-Schritt, der eine schwere Eingabe in
ein kleines, direkt nutzbares Artefakt verwandelt. Die Offline-Bakes sind
ein Python-Paket (`pipeline/`), gestartet mit `bun run bake <ort>`; der
Build-Schritt ist `scripts/prepare-data.ts`, von `scripts/prepare-sites.ts`
für jede Stadt ausgeführt.

**Artefakt** — eine der vorbereiteten Dateien, die der Browser anfordern
kann. Das Tileset nennt sie alle; die Liste der Begleitdateien einer Kachel
(Raster und Feature-Dateien) steht in `lib/city/tile.ts`.

**Standort-Konfiguration** — `sites/dresden.ts`: alles über den Ort, was
keine Daten sind — Name, Koordinatensystem, Kacheln, Startkachel,
Aussichtspunkte und Quellenvermerke. Bakes und Viewer lesen sie beide; eine
Bereitstellung zeigt jeden Standort, mit dessen Daten sie gebaut wurde,
jeden unter seiner eigenen Adresse (`/dresden`).

**Startseite** — die Seite unter `/`: eine Karte je Stadt, mit der die
Bereitstellung gebaut wurde (ihre Landnutzungskarte, ihr Bundesland, Fläche
und Aussichtspunkte), jede führt in den Viewer dieser Stadt.

**Manifest** — `public/data/<ort>/manifest.json` (eines je Stadt), das einfache Dateinamen auf die
Namen mit Fingerabdruck abbildet, unter denen sie ausgeliefert werden.

**Content-Hash** — der achtstellige Fingerabdruck in einem ausgelieferten
Dateinamen; ändert sich, sobald sich der Inhalt ändert, sodass Caches nie
veraltete Daten liefern.

**Lite-Profil** — `?scene=lite` (`/dresden?scene=lite`): nur die Startkachel, winzige
Schattenkarte, halbe Auflösung; nur für automatische Tests.

**Snapshot** — der JSON-Text, der Kamera, Datum/Uhrzeit und jeden Regler
festhält, um eine Ansicht zu reproduzieren.

**Aussichtspunkt** — einer der gestalteten Standpunkte, zu denen die
Kamera gleiten kann; einer davon ist der Startblick.

**Startkachel** — die Kachel, auf der du startest, die erste in der
Standort-Konfiguration. Das erste Bild wartet nur auf sie; danach hat sie
keine Sonderrolle mehr: Die Entfernung zur Kamera, nicht die Kachel,
entscheidet, was detailliert gezeichnet wird, und Gehen, Kollision und
Abriss funktionieren auf jeder Kachel im Blick. (Frühere Versionen luden
einen festen Block von vier und nannten sie *Primärkachel*.)

**ADR** — *Architecture Decision Record*: ein kurzes Dokument, das eine
Entscheidung, ihren Kontext und ihre Folgen festhält; siehe
[docs/adr](../../adr/README.md) (englisch).
