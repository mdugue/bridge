# Woher die Daten kommen

*English: [Where the data comes from](../en/data-sources.md)*

Alles im Viewer ist aus **offenen Daten** abgeleitet: Datensätzen, die eine
Behörde oder eine Freiwilligen-Community zur freien Nutzung
veröffentlicht. Nichts wurde für dieses Projekt selbst vermessen oder von
Hand gezeichnet. Diese Seite listet jeden Datensatz, wo er heruntergeladen
wurde, was er gut kann, wo er schwächelt und unter welcher Lizenz er
verwendet werden darf. Die Abkürzungen erklärt das [Glossar](./glossary.md).

## Die Anbieter

**GeoSN** — das *Landesamt für Geobasisinformation Sachsen*, die
Landesvermessung. Es stellt Gelände- und Oberflächenmodell, das
3D-Gebäudemodell, das Landschaftsmodell und die Luftbilder als kostenlose
Downloads auf seinem Portal für offene Geodaten bereit,
[geodaten.sachsen.de](https://www.geodaten.sachsen.de/). Alle sind in
dieselben **2 km × 2 km großen Kacheln** geschnitten, weshalb auch der
Viewer in Kacheln denkt.

**OpenStreetMap (OSM)** — die von Freiwilligen gepflegte Weltkarte. Sie
füllt Lücken, die die amtlichen Datensätze lassen: Straßenlampen,
Bahnsteige, Stützmauern mit Höhen und den Tragwerkstyp von Brücken.

## Die Datensätze im Überblick

| Datensatz | Auf Deutsch | Anbieter | Wofür der Viewer ihn nutzt |
|---|---|---|---|
| **DGM1** | Geländemodell, 1-m-Raster | GeoSN | Der Boden; jedes Objekt darauf absetzen; Brückenwiderlager-Höhen; Eingang für Baumhöhen |
| **DOM1** | Oberflächenmodell, 1-m-Raster (Gelände *plus* alles, was darauf steht) | GeoSN | Baumhöhen (Oberfläche minus Gelände); Brückendeck-Höhen |
| **LoD2** | 3D-Gebäudemodell mit Dachformen | GeoSN | Grundriss, Höhe, Dachform und Attribute jedes Gebäudes |
| **Basis-DLM** | Digitales Landschaftsmodell (die Landnutzungskarte) | GeoSN | Bodenfarben, Gewässerumrisse, Hecken und Baumreihen, Bahnflächen und Gleise, Brückenumrisse |
| **DOP** | Digitales Orthophoto, 20 cm, mit Nahinfrarot-Kanal | GeoSN | Dachfarben; Vegetationsgrün für Baumkronen und Wiesen |
| **OSM** | OpenStreetMap | Freiwillige | Straßenlampen, Bahnsteige, Mauern, Brücken-Tragwerkstypen |

Im selben Portal verfügbar, aber **noch nicht genutzt**: die
Laserscan-Punktwolke (aus ihr kämen einzelne Baumkronen), die Flurstücke
(**ALKIS**) und die topographische Grundkarte (**DTK**). Der Abschnitt
„Planned“ des [Transformations-Verzeichnisses](../../transformations.md)
(englisch) hält fest, was sie beitragen könnten.

## Datensatz für Datensatz

### DGM1 — das Geländemodell

- **Was es ist:** ein Raster von Bodenhöhen, ein Wert pro Meter, mit
  entfernten Gebäuden und Vegetation. Abgeleitet aus flugzeuggestütztem
  Laserscanning.
- **Download:** [Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html),
  eine ZIP-Datei je 2-km-Kachel mit einem GeoTIFF-Raster, einer
  `.tfw`-Weltdatei und einer kleinen `_akt.csv` mit dem Erfassungsdatum.
- **Format und Größe:** GeoTIFF, 2000 × 2000 Pixel als 32-Bit-Gleitkommazahlen,
  13,6 MB je Kachel. Höhen sind Meter über Normalhöhennull im deutschen
  Höhensystem **DHHN2016**; in der Startkachel reichen sie von 104 m (die
  Elbe) bis 124 m.
- **Gut in:** der wahren Form des Bodens, einschließlich Flussufern, Dämmen
  und den Terrassen der Altstadt. Auf wenige Zentimeter genau.
- **Schwach in:** allem Senkrechten. Eine gelaserte Mauer wird zu einer etwa
  einen Meter breiten Rampe geglättet, sodass monumentale Mauern wie die
  Brühlsche Terrasse in einer sanften Böschung „verschwinden“. Brücken
  werden per Definition entfernt (es ist ein *Gelände*modell), sodass ein
  Brückendeck aus diesem Modell auf den Flussgrund sinken würde. Der Viewer
  behebt beides mit weiteren Quellen.
- **Sonderrolle:** Dies ist der einzige Rohdatensatz, der ins Repository
  eingecheckt ist, weil der Build-Schritt ihn direkt liest. Siehe
  [Der Weg der Daten](./data-journey.md).

### DOM1 — das Oberflächenmodell

- **Was es ist:** dasselbe 1-m-Raster, aber von der *ersten Oberfläche, die
  der Laser trifft*: Dächer, Baumwipfel, Brückendecks, parkende Lastwagen.
- **Download:** dieselbe Portalseite wie das DGM1.
- **Genutzt für:** `DOM1 − DGM1` ergibt die Höhe von allem, was auf dem
  Boden steht. Wo das Landschaftsmodell „Wald“ oder „Park“ sagt, setzt der
  Viewer je 7-m-Zelle einen Baum an den höchsten Punkt, mit dieser Höhe.
  Brückendecks bekommen ihre Höhe aus diesem Modell.
- **Schwach in:** einen Baum von einem Gebäude oder Bus zu unterscheiden.
  Deshalb ist die Baumplatzierung auf Vegetationsklassen des
  Landschaftsmodells beschränkt und von Straßen, Gleisen und Wasser
  ausgeschlossen. Bewuchs unter 3 m wird ignoriert; ein Meter ist zu grob
  für einzelne Sträucher.
- Nur offline genutzt; die Rohdatei ist nicht eingecheckt und erreicht den
  Browser nie.

### LoD2 — das 3D-Gebäudemodell

- **Was es ist:** jedes Gebäude als einfacher Körper mit echtem Grundriss,
  gemessener Höhe und einer standardisierten Dachform (Flach-, Sattel-,
  Walm-, Mansarddach und weitere). *LoD* steht für „Level of Detail“; LoD2
  heißt „mit Dachform, aber ohne Fassadendetail“.
- **Download:** [Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html),
  als **CityGML** je 2-km-Kachel. Das Projekt wandelt die Dateien vor dem
  Einchecken in **CityJSON** um, eine kompakte JSON-Form desselben
  Standards (8–11 MB je Kachel).
- **Was je Gebäude drinsteht:** Grundriss- und Dachpolygone; gemessene
  Höhe; die Dachform als Schlüssel; die Dachneigung; ein Schlüssel für die
  Gebäudefunktion; gelegentlich die Geschosszahl; das Erzeugungsdatum des
  Objekts. Die vier Kacheln enthalten rund 16 000 Objekte (Gebäude und
  Gebäudeteile).
- **Gut in:** Silhouetten. Grundrisse und Dachformen sind exakt, Höhen aus
  dem Laserscan gemessen.
- **Schwach in:** allem unterhalb der Traufe. Es gibt keine Fenster, Türen,
  Materialien oder Farben. Die Gebäudefunktion ist bei etwa 86 % der
  Gebäude „nicht spezifiziert“, die Geschosszahl nur bei wenigen Prozent
  gefüllt; der Viewer leitet Geschossbänder deshalb aus der gemessenen Höhe
  ab. Seit 2021 kann das Produkt auch Brücken, Mauern und Türme enthalten;
  die heruntergeladenen Kacheln enthalten nur Gebäude.

### Basis-DLM — das Landschaftsmodell

- **Was es ist:** die Vektorkarte dessen, was den Boden bedeckt: Straßen,
  Wege, Bahnen, Gewässer, Wald, Landwirtschaft, Siedlungsflächen sowie
  Linienobjekte wie Hecken und Baumreihen. Teil des bundesweiten
  **ATKIS**-Systems, die Objektarten sind also in jedem Bundesland
  gleich.
- **Download:** [Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html)
  als landesweites Shapefile-Paket von mehreren Gigabyte; das Projekt
  schneidet jede Kachel daraus aus.
- **Ebenen, die der Viewer liest:** Landwirtschaft/Wiese, Wald, Gehölz und
  Siedlungsflächen; Straßen- und Wegeachsen (auf ihre vermessene oder
  typische Breite gepuffert); Bahnflächen und Gleislinien mit Gleiszahl;
  Gewässerflächen und Bäche; Hecken und Baumreihen; Brückenachsen und, wo
  vorhanden, Brückendeck-Umrisse.
- **Gut in:** einer amtlichen, konsistenten Klassifizierung mit nützlichen
  Attributen: Straßenbreiten, Gleiszahl, Elektrifizierung, Brückennamen.
- **Schwach in:** allem Kleinen. Straßen sind Achsen, keine Flächen, und
  müssen nach Regel verbreitert werden; Bahnlinien kommen in kurzen
  Fragmenten, die zusammengefügt werden müssen; Deck-Umrisse gibt es vor
  allem für große Brücken, kleinere Straßen- und Wegebrücken werden aus
  ihrer Achse rekonstruiert; es gibt keine Straßenmöbel und keine
  Bahnsteige.

### DOP — die Luftbilder

- **Was es ist:** Orthophotos, also Luftaufnahmen, die so entzerrt sind,
  dass jedes Pixel an seiner wahren Kartenposition sitzt.
  Bodenauflösung 20 cm. Die 4-Kanal-Variante trägt zusätzlich zu Rot, Grün
  und Blau das **nahe Infrarot**.
- **Download:** [DOP-Downloadbereich](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html);
  GeoTIFF je 2-km-Kachel, 10 000 × 10 000 Pixel. Das Projekt nutzt die
  RGBI-Variante (4 Kanäle).
- **Genutzt für:** die Farbe jedes Dachs (ein robuster Median über den
  Dachgrundriss, den Rand meidend) und einen Vegetationsindex, den
  **NDVI**, berechnet aus Rot- und Infrarotkanal. Saftige Vegetation
  leuchtet im Infrarot, Dächer, Straßen und Wasser bleiben dunkel. Der
  Index tönt Baumkronen von trocken-salbeigrün bis satt-dunkelgrün und
  Wiesen ebenso.
- **Gut in:** echten Farben und echtem Grün, wo das Foto senkrecht nach
  unten schaut.
- **Schwach in:** Fassaden (ein Senkrechtbild sieht nur Dächer); hohe
  Gebäude kippen im Bild seitlich, weshalb Dachgrundrisse vor der Abtastung
  nach innen verkleinert werden; die Rohfarben wirken fahl und dunstig, was
  der Viewer mit einer farbtonerhaltenden Sättigungsanhebung korrigiert.
  Der Befliegungstermin ist in diesem Repository nicht festgehalten.

### OpenStreetMap

- **Was es ist:** die von Freiwilligen gebaute Weltkarte, lizenziert unter
  der **ODbL**, die den Hinweis „© OpenStreetMap-Mitwirkende“ verlangt.
- **Downloads:** zwei Wege. Kleine Punktabfragen (Straßenlampen,
  Bahnsteige, das Tag `bridge:structure`) laufen über die **Overpass-API**
  und werden lokal zwischengespeichert, damit der Dienst nur einmal
  angefragt wird. Mauern werden aus einem regionalen Auszug des ganzen
  Bundeslandes gelesen, einmal heruntergeladen von
  [Geofabrik](https://download.geofabrik.de/europe/germany/sachsen.html)
  (etwa 250 MB), was Ratenlimits vermeidet und das Ergebnis reproduzierbar
  macht.
- **Genutzt für:** Lampenpositionen (`highway=street_lamp`), Bahnsteige
  (`railway=platform`), Stützmauern, Stadtmauern und Böschungen
  (`barrier=*`, `man_made=embankment`) mit ihrem `height`-Tag, und ob eine
  Brücke eine Bogenbrücke ist (`bridge:structure`), was zwischen Bögen und
  schlichten Pfeilern unter dem Deck entscheidet.
- **Gut in:** Dingen, die kein amtlicher Datensatz hat, mit lesbaren Tags.
- **Schwach in:** Vollständigkeit und Einheitlichkeit. Nicht jede Lampe ist
  erfasst, Höhen fehlen oft (der Viewer nutzt Standardwerte je Mauertyp),
  und Tags variieren von Mapper zu Mapper.

## Verwendete Datenstände

Der genaue Stand zählt, wenn das Bild der Wirklichkeit widerspricht. Diese
Tabelle hält fest, was über die eingecheckten Daten bekannt ist.
„Eingecheckt“ ist das Datum, an dem die Datei ins Repository kam; der
Download fand an diesem Tag oder kurz davor statt.

| Datensatz | Kacheln | Stand / Erfassungsdatum | Woher bekannt | Eingecheckt |
|---|---|---|---|---|
| DGM1 | alle vier (plus zwei ungenutzte Kacheln im Osten) | 2024-11-30 (südliche Reihe), 2024-11-27 und 2024-11-30 (nördliche Reihe) | die `_akt.csv` in jeder Kachel-ZIP | 2026-06-11 |
| LoD2 | alle vier | Objekte erzeugt am 2025-04-26 (33410_5658), 2025-06-28 (33410_5656), 2025-07-04 (33412_5656), 2025-07-07 (33412_5658); einige hundert Objekte je Kachel tragen ältere Daten bis 2020 zurück | das Attribut `creationDate` jedes Gebäudes | 2026-06-11 |
| Basis-DLM | landesweiter Download | Stand nicht festgehalten | — | abgeleitete Dateien 2026-06-12, Bahn- und Brückendateien neu gebacken 2026-09-18 |
| DOM1 | alle vier | Stand nicht festgehalten (dieselbe Befliegung wie das DGM1 ist wahrscheinlich, aber nicht geprüft) | — | abgeleitete Kronen-Dateien 2026-06-12 |
| DOP (RGBI) | alle vier | Befliegungstermin nicht festgehalten | — | abgeleitete Dachfarben und NDVI 2026-06-16/17 |
| OSM über Overpass | alle vier | Live-Datenbank zum Abfragezeitpunkt, Juni 2026 | — | 2026-06-12 (Lampen), 2026-06-17 (Bahnsteige, Brückentragwerk) |
| OSM über Geofabrik | landesweiter Auszug | Auszugsdatum nicht festgehalten | — | Mauern neu gebacken 2026-09-18 |

Offene Punkte für den Betreiber: beim nächsten Download den Stand des
Basis-DLM, das Erfassungsdatum des DOM1, den Befliegungstermin des DOP und
das Datum des Geofabrik-Auszugs notieren (das Portal liefert zu jeder
Kachel eine Metadatendatei; der Geofabrik-Dateiname trägt sein Datum).

## Lizenzen und Quellenvermerke

| Quelle | Lizenz | Erforderlicher Vermerk |
|---|---|---|
| GeoSN-Datensätze (DGM1, DOM1, LoD2, Basis-DLM, DOP) | *Datenlizenz Deutschland – Namensnennung – Version 2.0* (`dl-de/by-2-0`), laut den [Nutzungsbedingungen](https://www.landesvermessung.sachsen.de/allgemeine-nutzungsbedingungen-8954.html) des GeoSN (geprüft am 2026-09-22) | „Quelle: GeoSN, dl-de/by-2-0“ |
| OpenStreetMap | *Open Database License* (ODbL) | „© OpenStreetMap-Mitwirkende“ |

Der Viewer zeigt beide Vermerke in der Fußzeile seines Einstellungsfelds.
Die abgeleiteten Lampen- und Mauerdateien tragen den OSM-Vermerk zusätzlich
in der Datei selbst.
