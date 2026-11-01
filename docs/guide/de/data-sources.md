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
Viewer in Kacheln denkt. Welche Kacheln er zeigt, steht an einer einzigen
Stelle, der Standort-Konfiguration `sites/dresden.ts`: die fünfzehn Kacheln
(die erste ist die, auf der du startest) und die Aussichtspunkte; die
Quellenvermerke kommen vom Anbieter.

**Andere Orte, andere Anbieter.** Jedes Bundesland hat seine eigene
Landesvermessung, und der Viewer kann fünf davon nutzen: das GeoSN für
Dresden, Leipzig, Meißen und Grimma; **Geobasis NRW** für Unna; die
**Bayerische Vermessungsverwaltung (LDBV)** für München; den **LGV** in
Hamburg; und die **Senatsverwaltung für Stadtentwicklung** in Berlin. Sie
veröffentlichen dieselben Arten von Datensätzen in anderem Zuschnitt —
1-km-Kacheln, ein Archiv für die ganze Stadt, Luftbilder ohne Infrarotkanal
—, und ein kleiner Adapter je Amt schneidet sie auf die 2-km-Kacheln des
Viewers zu. Hamburg und Berlin veröffentlichen das Landschaftsmodell nicht
in der Form, die der Viewer liest; dort kommen die Bodenfarben aus
OpenStreetMap — und ebenso die Brücken: Die Brückenwege aus OpenStreetMap
springen ein, die Höhe jedes Brückendecks wird weiter im Oberflächenmodell
gemessen. (Die Gleise kommen in jeder Stadt aus OpenStreetMap, eines nach
dem anderen; anderswo ergänzt das Landschaftsmodell nur, wo es keine
kartiert.) Münchens Luftbilder haben
keinen Infrarotkanal, deshalb wird die Farbe seiner Bäume und Wiesen
stattdessen aus den sichtbaren Farben des Bildes berechnet (siehe NDVI
unten). Und wo das Material eines Gebäudes nicht erfasst ist, übernimmt es
das seiner Nachbarschaft: In einer Straße erfasster Backsteinhäuser wird
es in Backstein gezeichnet, sonst in Putz — so erscheinen Hamburgs
Klinkerviertel in Backstein, ohne dass jemand das für die ganze Stadt
festlegen muss. Eine Bereitstellung zeigt jede Stadt, mit deren Daten sie
gebaut wurde, jede unter ihrer eigenen Adresse (`/dresden`, `/leipzig`, …),
und die Startseite listet sie auf; die Liste der Ämter mit ihren Lizenzen
steht in `sites/providers.ts`. Welche Stadt was aus welcher Quelle zeichnet
— und wo ein Ersatz einspringt, weil ein Land oder eine Stadt etwas nicht
offen veröffentlicht —, zeigt die Tabelle
[Quellen nach Stadt](./sources-by-city.md).

**OpenStreetMap (OSM)** — die von Freiwilligen gepflegte Weltkarte. Sie
füllt Lücken, die die amtlichen Datensätze lassen: Straßenlampen,
Bänke und andere Stadtmöbel, Bahnsteige, die Gleise einzeln, Stützmauern
mit Höhen, den Tragwerkstyp von Brücken, die Form von Brunnenbecken und die
Bäume in Höfen und Gärten, die das Stadtbaumkataster nicht führt — in
einer Stadt ohne Kataster jeden kartierten Baum, so hoch, wie das
Oberflächenmodell ihn misst.

**Wikidata** — die freie Wissensdatenbank hinter Wikipedia. Für benannte
Brücken sagt sie, welcher Bauart sie sind (Bogen-, Hänge-, Fachwerkbrücke
…) und oft ihre größte Spannweite und die Zahl ihrer Felder. Sie nennt auch die **Wahrzeichen**
jeder Stadt: die Bauwerke mit Wikipedia-Artikeln, geordnet danach, in wie
vielen Sprachen über sie geschrieben wird. Der Viewer markiert die
Gebäude, die eines sind, listet die zwölf bekanntesten der Stadt im Feld
und nimmt das Material, das Wikidata nennt (Glas, Backstein, Stein …),
wo OpenStreetMap keines kennt. Befragt, steht der Name eines Wahrzeichens
neben ihm in der Stadt, mit dem, was Wikidata über es weiß: wann und von
wem es erbaut, wann es wiederaufgebaut wurde, wie hoch es ist. Bei Denkmälern und Skulpturen sagt sie
oft, woraus sie sind — der Goldene Reiter ist Kupfer unter Blattgold —,
und der Viewer färbt sie in einem gedämpften Ton dieses Materials, wo
OpenStreetMap keines nennt. Ein Bauwerk, das Wikidata als abgerissen oder
zerstört führt, bleibt außen vor, außer OpenStreetMap verknüpft ein
stehendes Gebäude damit — vorher war Dresdens Neues Rathaus als die Alte
Reformierte Kirche markiert, die bis 1894 dort stand. Für ein Wandbild,
das OpenStreetMap ohne sie erfasst, kann Wikidata seine Größe und ein Foto
nennen.

**Wikimedia Commons** — das freie Medienarchiv hinter Wikipedia, in dem
Fotografinnen und Fotografen ihre Bilder teilen, jedes unter einer freien
Lizenz ihrer Wahl. Ein Wandbild, das OpenStreetMap mit seiner Größe
erfasst, wird nach einem Foto aus Commons auf seine Wand gezeichnet, wo
eines das ganze Bild gerade von vorn zeigt: in Dresden der Fürstenzug und
*Der Weg der Roten Fahne* am Kulturpalast. Gezeichnet, nicht
fotografiert: Feder­linien in einer dunklen Tinte über einer hellen Lasur
in den Farben des Wandbilds, im Pastellton der übrigen Stadt. Ein schräg
aufgenommenes Foto, eines von einem Ausschnitt oder von einem Bild anderer
Größe wird nicht genommen, und die Wand bleibt schlicht. Urheber und
Lizenz jedes Fotos stehen in den Quellen im Fuß des Felds; die Zeichnung
steht unter der Lizenz ihres Fotos.

**Landeshauptstadt Dresden** — die Stadt selbst. Ihr Stadtbaumkataster
verzeichnet rund 124.000 städtische Bäume mit Art, Höhe,
Kronen- und Stammdurchmesser. Der Viewer pflanzt diese Bäume dort, wo sie
wirklich stehen, mit gemessener Höhe, Krone und Stamm, einer Kronenform,
die der Art folgt, und dem Jahr der Art: wann sie austreibt, wie sie sich
im Herbst färbt und wann sie kahl ist.
Aus derselben Quelle kommen zwei Verkehrsdatensätze, die der Viewer als
**zuschaltbare Datenebenen** zeigt (Seitenleiste, *Erkunden* →
*Verkehrsdaten*; beim Start aus): die gezählten Kraftfahrzeuge je
Straßenabschnitt und die Rad-Dauerzählstellen, deren Zählwerte der Browser
live bei der Stadt abruft.

**DELFI und gtfs.de** — DELFI e.V. sammelt die Fahrpläne aller
Verkehrsverbünde Deutschlands (in Dresden den des VVO mit den Linien der
DVB, in Leipzig den der LVB, in München den der MVG); gtfs.de stellt sie
im verbreiteten GTFS-Format bereit. Daraus fahren die Straßenbahnen der
dritten Datenebene, so wie der Fahrplan sie fahren lässt, jede in den
Farben ihres Betreibers.

**Copernicus** — das Erdbeobachtungsprogramm der Europäischen Union. Sein
Höhenmodell **GLO-30**, von DLR und Airbus Defence and Space erstellt,
deckt die ganze Welt im 30-m-Raster ab. Der Viewer liest es nur für das
Land jenseits der Kacheln einer Stadt: die Hügel am fernen Horizont, bis
10 km, die das gebackene Himmelslicht und die fernen Schatten einbeziehen,
und den Rand des Tals, in dem die Stadt liegt, der bestimmt, wie tief sich
der Taldunst sammelt. Bevor es für den Boden einspringt, wird es auf das
Geländemodell der Stadt gerückt, wo beide offenen Boden sehen; innerhalb
der Kacheln zählt allein das Geländemodell.

**Deutscher Wetterdienst (DWD)** — der nationale Wetterdienst. Seine
ehrenamtlichen Beobachter notieren jedes Jahr, an welchem Tag die Bäume
und Sträucher um sie herum austreiben, blühen, sich färben und ihr Laub
abwerfen. Das Jahr der Bäume im Viewer ist das Dresdner; das jeder
anderen Stadt ist um den Unterschied verschoben, den die Beobachter im
Umkreis von 30 km für zwölf Bäume und Sträucher verzeichnet haben,
2010–2023 — Hamburgs Bäume treiben drei Tage später aus und färben sich
fünf Tage später, Unnas treiben sechs Tage früher aus. Die Beobachtungen
wurden einmal, offline, in eine Tabelle von Verschiebungen übertragen; der
Browser fragt beim Wetterdienst nichts ab.

**Hamburg, Leipzig und Berlin** veröffentlichen Verzeichnisse derselben
Art, die genauso gelesen werden. Hamburgs Straßenbaumkataster (die
Umweltbehörde BUKEA) führt die Straßenbäume mit Art, Kronendurchmesser,
Stammumfang und Pflanzjahr, aber **ohne Höhe**: Der Viewer leitet die
Höhe jedes Baums aus Gattung und Stammdicke ab, gelernt an den Katastern
Dresdens und Leipzigs, die beides führen. Hamburgs Oberflächenmodell wurde
bei kahlen Bäumen beflogen und misst sie zu niedrig; es hebt deshalb nur
eine Höhe an, die es deutlich übertrifft, und streicht einen Baum, den es
nicht mehr zeigt. Leipzigs
Baumkataster (Amt für Stadtgrün und Gewässer) führt Straßen- und
Parkbäume mit Höhe, Krone und Stamm; gefällte Bäume bleiben weg. Berlins
Baumbestand (Geoportal Berlin) führt Straßen- und Anlagenbäume ebenso;
Berlin ist eingerichtet, aber noch nicht gebaut.

## Die Datensätze im Überblick

| Datensatz | Auf Deutsch | Anbieter | Wofür der Viewer ihn nutzt |
|---|---|---|---|
| **DGM1** | Geländemodell, 1-m-Raster | GeoSN | Der Boden; jedes Objekt darauf absetzen; Brückenwiderlager-Höhen und der Wasserspiegel unter der Fahrrinne; eine Höhe für jedes Gewässer und die Strände und Kiesbänke darin; Eingang für Baumhöhen |
| **DOM1** | Oberflächenmodell, 1-m-Raster (Gelände *plus* alles, was darauf steht) | GeoSN | Baumhöhen (Oberfläche minus Gelände), und wo die Bäume einer kartierten Baumreihe oder Obstwiese stehen; die Fahrbahnhöhe und -breite von Brücken und was über ihr steht: Fachwerk, Pylone, Bögen, und die Pfeiler unter einer steinernen Brücke; Schornsteine, Türme und Masten, Gebäude, die das 3D-Modell noch nicht führt, und Bahnsteigdächer, Carports und Unterstände — nur wo OpenStreetMap sie benennt; die Dachform eines Wahrzeichens, das das 3D-Modell flach zeichnet; die Dächer der Gebäude, die das 3D-Modell grob verfehlt; die Gauben auf geneigten Dächern und die Hausschornsteine; das Vordach über einer Ladenfront; die Decks der Anlegestellen und wie hoch die Pontons schwimmen; Heckenhöhen, wo kein Laserscan vorliegt |
| **LoD2** | 3D-Gebäudemodell mit Dachformen | GeoSN | Grundriss, Höhe, Dachform und Attribute jedes Gebäudes (seine Brücken-Platten lässt der Viewer weg) |
| **Basis-DLM** | Digitales Landschaftsmodell (die Landnutzungskarte) | GeoSN | Bodenfarben (auch der Felder), Gewässerumrisse, Hecken und Baumreihen, Bahnflächen, Gleise, wo OpenStreetMap keine kartiert, Brückenumrisse, Denkmäler und Brunnen (Lage und amtlicher Name) |
| **DOP** | Digitales Orthophoto, 20 cm, mit Nahinfrarot-Kanal | GeoSN | Dachfarben; die Farbe jedes Gewässers; Vegetationsgrün für Baumkronen, Wiesen und Feldfrüchte; in welche Richtung die Rebzeilen laufen; wo kein Laserscan gelesen wird, die Bäume in Höfen und Gärten (grün, wo das Oberflächenmodell rau ist); im Mischwald, wo das Bild vor dem Laubaustrieb geflogen wurde, sind die Kronen, die darauf grün sind, Nadelbäume, bleiben das ganze Jahr grün und stehen als Kegel, wie jede Krone in einem Nadelwald, den die Landnutzungskarte nennt |
| **LSC** | Laserscan-Punktwolke | GeoSN (Dresden, Meißen, Grimma, Leipzig), Geobasis NRW (Unna), Bayerische Vermessungsverwaltung (München) | Heckenhöhen und Hecken, die OpenStreetMap fehlen (lange, schmale, grüne, abseits von Bäumen); Bäume in Höfen und Gärten; die Gartenlauben, Schuppen und Containerbauten, die dem 3D-Gebäudemodell fehlen |
| **OSM** | OpenStreetMap | Freiwillige | Straßenlampen, Hecken, Stadtmöbel (Bänke, Papierkörbe, Fahrradbügel, Poller, Briefkästen, Wartehäuschen und Haltestellenschilder, Litfaßsäulen, Ampeln, Hydranten, Uhren, Trinkbrunnen), Spielplätze und ihre Geräte, Bahnsteige und ihre Höhen, einzelne Gleise, ihre Elektrifizierung und Oberleitungsmasten, Mauern, Felskanten, Treppen, Brücken-Tragwerkstypen und Durchfahrtshöhen, Brunnenbecken, womit Straßen, Gehwege und Parkplätze belegt sind, Sportplätze, Läden und Cafés im Erdgeschoss, Baudenkmale, Zäune, Geländer und Tore, Fahrbahnmarkierungen (Überwege, Haltlinien, Rad- und Mittellinien), Kleingärten, Obstwiesen und Weinberge, Bäume, die das Stadtbaumkataster nicht führt (in einer Stadt ohne Kataster jeder kartierte Baum), Straßenbahngleise mit ihren Oberleitungsmasten, Anlegestellen, Buhnen und Fährrouten auf der Elbe, woraus Gebäude gebaut sind und ihre Wand- und Dachfarben, Schornsteine, Türme und Masten, die Gebäude, die für das 3D-Modell zu neu sind (in ihrer eingetragenen Höhe, wo das Oberflächenmodell vor ihrer Fertigstellung beflogen wurde), Bahnsteigdächer, Carports und Unterstände und Wandbilder mit ihrer Größe |
| **Wikidata** | freie Wissensdatenbank | Freiwillige | Bauart, Hauptspannweite und Zahl der Felder benannter Brücken; die Wahrzeichen der Stadt (die Liste im Feld), ihr Fassadenmaterial und die Angaben unter dem Namen eines befragten Wahrzeichens (Bauzeit, Architekt, Wiederaufbau, Höhe); woraus Denkmäler sind; Größe und Foto eines Wandbilds, wo OpenStreetMap keine nennt |
| **Wikimedia Commons** | freies Medienarchiv | Fotografinnen und Fotografen, jedes Foto unter seiner eigenen Lizenz | Die Fotos, nach denen die Wandbilder gezeichnet sind, wo eines das ganze Bild gerade von vorn zeigt (in Dresden der Fürstenzug und *Der Weg der Roten Fahne*) |
| **Mapillary** | Straßenfotos und die darin erkannten Objekte | Fotos der Mitwirkenden, Erkennung durch Mapillary | In Dresden, Grimma, Meißen und Unna Straßenlampen, die OpenStreetMap nicht kennt (in Dresden etwa 5 400, in Grimma 950, in Meißen 120, in Unna 130). Mapillary verortet jedes Objekt, das es auf mehreren Fotos erkennt; der Viewer behält die, bei denen in 8 m keine Lampe aus OpenStreetMap steht, die seit 2020 gesehen wurden, aus der Nähe (ein Foto in 25 m) und mindestens einmal bei Tageslicht, nicht in einem Gebäude und nicht über einem Straßentunnel liegen, und rückt sie von der Fahrbahn an den Bordstein. Ihre Lage ist ein paar Meter ungenau, und eine Lampe, die es aus zwei Fahrten doppelt verortet, steht nur einmal (mindestens 7 m Abstand). Seine Papierkörbe nutzt der Viewer nicht: auf Straßenfotos sind die meisten Mülltonnen der Haushalte, zur Abholung herausgestellt. Auf Nachfrage sagt eine Lampe, ob sie von Mapillary stammt. Die Rundumfotos — in jeder Stadt außer Unna, wo Mapillary keine hat — sagen außerdem je Gebäude (knapp 2 000 in Dresden und 1 600 in Leipzig, vor allem an den Straßen der Innenstadt), wie unruhig und wie dunkel eine Straßenfassade ist und ob ein Ladenschild daran hängt; der Ton macht daraus ein feines Relief, einen etwas dunkleren oder helleren Ton und einen Ladensockel (*Fassadenbild*). Zwei weitere Messungen geben die Fenster. Das Schaufenster: auf jeder Kachel werden die Rundumfotos noch einmal entlang des Erdgeschosses jeder Wand vermessen, und wo zwei Fotos sich über breite Öffnungen einig sind — oder eine moderne Ladenzeile fast durchgehend Glas zeigt —, bekommt das Haus dort Schaufenster als weiche Nischen: das Glas in einem gedämpften, etwas dunkleren und kühleren Ton als die Wand, leicht spiegelnd, in einer flachen Laibung mit gerundeten Kanten, ohne Sprossen, mit Pfeilern dazwischen und einem Schildband, wo ein Ladenschild gesehen wurde (etwa 1 000 Wände an 780 Gebäuden in Dresden, 1 130 an 843 in Leipzig, 3 079 an 2 229 in München, 152 an 112 in Hamburg, wo wenige Rundumfotos aufgenommen wurden, 79 in Grimma und 23 in Meißen). Wo das Oberflächenmodell (DOM1) über einer solchen Ladenfront ein flaches Vordach zeigt, wie an den DDR-Ladenpavillons der Hauptstraße, wird auch das Vordach gezeichnet, und das Glas läuft darunter durch. Ein Laden, den OpenStreetMap kennt und kein Foto zeigt, bekommt kein Fenster: ein Kartenpunkt sagt, dass dort ein Laden ist, nicht wo seine Fenster sind. Der Fensterrhythmus: die Rundumfotos werden über jeder Wand oberhalb des Erdgeschosses noch einmal vermessen, auf das, was nicht davon abhängt, wo genau die Kamera stand — wie weit die Fensterachsen auseinanderliegen und wie regelmäßig, die Geschosshöhe, Breite und Proportion der Fenster, Schmuck. Ein Merkmal wird nur genutzt, wo zwei getrennte Fahrten an denselben Wänden sich darüber einig sind (eine Rangkorrelation von mindestens 0,6); Faschen, Sohlbankgesimse, Lisenen und Sockel waren es nicht. Das ergibt einen gemessenen Rhythmus für etwa 590 Wände an 530 Gebäuden in Dresden. Jedes andere Haus leiht sich den Rhythmus des nächsten gemessenen in 150 m mit derselben Dachform und etwa seiner Traufhöhe (die Häuser eines Blocks stammen meist aus einer Zeit) oder nimmt den seines Typs — ein Bürgerhaus mit hohen Geschossen, ein Mietshaus, ein kleines Haus, ein Flachdachblock —, dessen Werte die Mediane sind, die die Fotos an Dresdens Häusern dieses Typs gemessen haben; in den anderen Städten nimmt jedes Haus den seines Typs. Die Fenster sind in die Wand gezeichnet, nicht modelliert: eine Öffnung, in die das Auge hineinsieht, die Laibungen im Putz der Wand, der Grund dunkler und kühler, eine schmale Sohlbank darunter — kein Glas, keine Scheiben, keine Sprossen —, mittig auf jeder Wand, eine Reihe je Geschoss, ihre Höhe nach dem Geschoss. Keine an einer Brandwand, neben einer Tür, über einer Ladenfront, an einer Kirche, einem Schloss, Theater, Museum oder einer Halle und an einer Glas- oder Metallfassade |
| **Stadtbaumkataster** | Das Baumverzeichnis der Stadt | Landeshauptstadt Dresden | Straßen- und Parkbäume an ihrem vermessenen Standort, mit Höhe, Kronenbreite, Stamm, einer Kronenform nach der Art und deren Herbstfarbe und Laubfall; auf Nachfrage Art, Standort, Baumnummer und Alter |
| **Straßenbaumkataster / Baumkataster / Baumbestand** | Die Baumverzeichnisse von Hamburg, Leipzig und Berlin | Freie und Hansestadt Hamburg (BUKEA); Stadt Leipzig (Amt für Stadtgrün und Gewässer); Geoportal Berlin | Wie das Dresdner; Hamburgs Kataster kennt keine Höhen: Sie kommen aus Gattung und Stammdicke, gelernt an den Katastern Dresdens und Leipzigs |
| **Verkehrsmengen** | Kfz je Tag und Straßenabschnitt | Landeshauptstadt Dresden | Datenebene *Kfz-Verkehr*: gläserne Ströme je Fahrtrichtung, breiter, höher und kräftiger gefärbt, wo mehr fährt |
| **Tagesgang** | Anteil jeder Stunde am Tagesverkehr | Freie und Hansestadt Hamburg | die Uhrzeit der Datenebene *Kfz-Verkehr* |
| **Verkehrsmengen anderer Städte, Straßenverkehrszählungen** | Kfz je Tag und Abschnitt in Berlin und Hamburg; die Zählungen der Länder Sachsen und NRW auf ihren Straßen | Berlin (SenMVKU); Hamburg (BVM); Freistaat Sachsen (LASuV); Straßen.NRW | die Datenebene *Kfz-Verkehr* dieser Städte, beide Richtungen zusammen gezählt |
| **Hamburger Radzählnetz** | Fahrräder der letzten Stunde, live | Freie und Hansestadt Hamburg | die Datenebene *Radverkehr (live)* in Hamburg |
| **Rad-Dauerzählstellen** | Fahrräder der letzten Stunde, live | Landeshauptstadt Dresden | Datenebene *Radverkehr (live)*: je Zählstelle zwei Glassäulen, eine je Richtung |
| **GTFS-Fahrplan** | Soll-Fahrplan des Nahverkehrs | DELFI e.V. über gtfs.de | Datenebene *Straßenbahnen (Fahrplan)*: jede Bahn (DVB, LVB, MVG) zur Szenenzeit auf ihrem Gleis, in den Farben und der Länge ihres Betreibers |
| **GLO-30** | Copernicus-Höhenmodell, ein Oberflächenmodell der ganzen Welt im 30-m-Raster | DLR / Airbus Defence and Space, im Copernicus-Programm der EU | Das Land jenseits der Kacheln: die Hügel am fernen Horizont (bis 10 km) und der Talrand für den Taldunst |
| **DWD-Phänologie** | Die jährlichen Pflanzenbeobachtungen des Wetterdienstes: wann Bäume und Sträucher austreiben, blühen, sich färben und ihr Laub abwerfen | Deutscher Wetterdienst | Um wie viele Tage früher oder später als in Dresden die Bäume jeder Stadt austreiben und sich färben |

Im selben Portal verfügbar, aber **noch nicht genutzt**: die Flurstücke
(**ALKIS**) und die topographische Grundkarte (**DTK**). Der Abschnitt
„Planned“ des [Transformations-Verzeichnisses](../../transformations.md)
(englisch) hält fest, was sie beitragen könnten.

## Wie die amtlichen Datensätze entstehen

Das meiste, was der Viewer zeigt, geht auf zwei Arten von Befliegungen
über der Stadt und auf die Datenbanken der Landesvermessung zurück. Das
Diagramm zeigt, wie die Produkte voneinander abhängen; die Steckbriefe
darunter liefern die Details.

```mermaid
flowchart LR
  subgraph LASER["Laserscan-Befliegung (LiDAR) — Dresden: 27.–30. Nov. 2024"]
    LSC["Punktwolke (LSC)<br/>jedes Laser-Echo, klassifiziert<br/>Boden / Nicht-Boden"]
  end
  LSC --> DGM["DGM1 — Geländemodell<br/>Bodenpunkte → 1-m-Raster"]
  LSC --> DOM["DOM1 — Oberflächenmodell<br/>erste Echos → 1-m-Raster"]
  DGM --> NDOM["nDOM = DOM1 − DGM1<br/>Höhe von allem, was auf dem Boden steht"]
  DOM --> NDOM
  subgraph PHOTO["Bildflug — Dresden: 19. März 2024"]
    DOP["DOP20 RGBI — Orthophoto<br/>Rot, Grün, Blau, Nahinfrarot · 20 cm"]
  end
  DGM -. "zur Entzerrung" .-> DOP
  DOP --> NDVI["NDVI — Grünindex<br/>(NIR − Rot) / (NIR + Rot)"]
  subgraph OFFICE["Datenbanken der Landesvermessung, laufend gepflegt"]
    DLM["Basis-DLM — Landschaftsmodell<br/>Straßen, Bahnen, Gewässer, Nutzung, …"]
  end
  DLM --> LOD["LoD2 — 3D-Gebäude<br/>Grundrisse aus den Datenbanken,<br/>Dachformen an die Punktwolke angepasst"]
  LSC --> LOD
```

## Datensatz für Datensatz

Jeder Steckbrief beantwortet dieselben Fragen: Wofür steht die Abkürzung,
wie werden die Daten erhoben, wie oft aktualisiert, wie genau sind sie,
wofür eignen sie sich allgemein, wofür nutzt sie der Viewer, und wo haben
sie Schwächen. Angaben mit „laut GeoSN“ stammen aus der
Produktdokumentation des Anbieters.

### DGM1 — das Geländemodell

| | |
|---|---|
| **Steht für** | *Digitales Geländemodell 1* — Geländemodell mit 1 m Gitterweite. „Gelände“ meint den nackten Boden: Gebäude, Brücken und Vegetation sind entfernt. |
| **Wie erhoben** | Flugzeuggestütztes Laserscanning (LiDAR): Ein Flugzeug tastet den Boden mit Laserimpulsen ab und zeichnet jedes Echo auf. Die entstehende Punktwolke wird in Boden- und Nichtbodenpunkte klassifiziert; die Bodenpunkte werden in ein regelmäßiges Raster interpoliert. Lücken unter Gebäuden werden mit interpolierten Punkten gefüllt. |
| **Aktualisierung** | Gebietsweise nach jeder neuen Laserbefliegung. Für Dresden stammte der vorige Scan von 2016, der aktuelle vom 27.–30. November 2024. |
| **Auflösung und Genauigkeit** | 1-m-Zellen, Höhe in der Zellenmitte. Höhengenauigkeit bis ±0,15 m, Lagegenauigkeit ±0,30 m bei 95 % Sicherheit, laut GeoSN. |
| **Allgemein geeignet für** | Jede Frage „wie hoch liegt der Boden hier“: Geländeanalysen, Hochwasser- und Abflussmodelle, Sichtbarkeitsstudien, Hangneigungskarten, Entzerrung von Luftbildern. |
| **Hier genutzt für** | Den Boden selbst — ein Dreiecksnetz, das jeden Punkt des 1-m-Rasters auf 15 cm genau trifft (25 cm auf den äußeren Kacheln), dicht, wo der Boden sich biegt, und grob, wo er flach ist, sodass Mauern und Böschungen ihre Kanten behalten; das Absetzen von Gebäuden, Bäumen, Lampen und Spieler darauf; die Widerlagerhöhen von Brücken; den Grundterm der Baumhöhen. |
| **Stärken** | Die wahre Form des Bodens, einschließlich Flussufern, Dämmen und den Terrassen der Altstadt, auf wenige Zentimeter. |
| **Schwächen** | Alles Senkrechte: Eine gelaserte Mauer wird zu einer steilen, ein bis zwei Meter breiten Rampe, nie zu einer senkrechten Wand — und sobald der Viewer das 1-m-Raster auf sein 2-m-Netz umrechnet, „verschwinden“ monumentale Mauern wie die Brühlsche Terrasse in einer etwa 3 m breiten, sanften Böschung. Brücken sind per Definition entfernt, ein Deck aus diesem Modell würde auf den Flussgrund sinken. Der Viewer behebt beides mit anderen Quellen. |
| **Format und Download** | GeoTIFF, 2000 × 2000 Pixel als 32-Bit-Gleitkommazahlen, 13,6 MB je 2-km-Kachel, mit `.tfw`-Weltdatei und einer `_akt.csv` mit dem Erfassungsdatum. Höhen in Metern über Normalhöhennull (**DHHN2016**). [Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html). |

Sonderrolle: Dies ist der einzige Rohdatensatz, der ins Repository
eingecheckt ist, weil der Build-Schritt ihn direkt liest. Siehe
[Der Weg der Daten](./data-journey.md).

### DOM1 — das Oberflächenmodell

| | |
|---|---|
| **Steht für** | *Digitales Oberflächenmodell 1* — Oberflächenmodell mit 1 m Gitterweite. „Oberfläche“ meint das Erste, was der Laser trifft: Dächer, Baumwipfel, Brückendecks, parkende Lastwagen. |
| **Wie erhoben** | Dieselbe Laserbefliegung wie das DGM1; statt der Bodenpunkte werden die ersten Echos der Punktwolke ins Raster interpoliert. |
| **Aktualisierung** | Zusammen mit dem DGM1; für diese Kacheln identische Daten (27.–30. November 2024). |
| **Auflösung und Genauigkeit** | 1-m-Zellen; dieselbe Höhengenauigkeit wie die Punktwolke (bis ±0,15 m), laut GeoSN. Eine Zelle am Rand einer Krone oder eines Dachs kann beide Höhen tragen. |
| **Allgemein geeignet für** | Gebäude- und Baumhöhen (als DOM − DGM, das **nDOM**), Kronenkartierung, Unterscheidung von Laub- und Nadelbäumen (durch kahle Kronen scheint der Boden durch), Auffinden von Brücken und abgesenkten Einfahrten, Solardach-Studien. |
| **Hier genutzt für** | `DOM1 − DGM1` ergibt die Höhe von allem, was auf dem Boden steht. Wo das Landschaftsmodell Wald, Gehölz oder Park sagt, setzt der Viewer je 7-m-Zelle einen Baum an den höchsten Punkt, mit dieser Höhe; die Bäume einer kartierten Baumreihe oder Obstwiese stehen an den Kronenspitzen, die es entlang der Reihe oder in der Obstwiese zeigt, so hoch wie gemessen. Brücken bekommen daraus die Höhe und Breite ihrer Fahrbahn (eine Brücke, die nur als Linie kartiert ist, ist so breit, wie die Oberfläche ihr Deck zeigt — die Marienbrücke 20,5 m, nicht die 11 m ihrer Art) und alles, was über ihr steht: Entlang der Brückenachse zeigt der höchste Punkt über dem Deck das Fachwerk des Blauen Wunders zwischen seinen zwei Pylonen und den Stahlbogen der Waldschlößchenbrücke; Lampen und Autos werden als zu kurz herausgefiltert. Unter einer steinernen Bogenbrücke stehen die Pfeiler dort, wo das Deck über ihnen ausbaucht. Es ist außerdem die einzige verlässliche Quelle dafür, wie ein Denkmal oder die Skulptur eines Brunnens *aussieht*: Sein gemessener Körper (die Figurengruppen am Albertplatz sind 3,7 m hoch und etwa 4 × 5 m groß) wird zu einer weichen Tonform in dieser Größe und diesem Umriss; eine hohe Säule oder ein Obelisk steht in seiner gemessenen Höhe (Münchens Mariensäule 13,2 m und Friedensengel 36,6 m, dort am Laserscan gelesen), und auf einem Spielplatz, den OpenStreetMap ohne Geräte erfasst, wird, was dort 1,2–4 m hoch steht und kein Baum ist, eine Schaukel oder ein Klettergerüst. Die kleinen Bauten, die dem 3D-Modell fehlen, stecken in derselben Oberfläche, werden aber aus der Punktwolke selbst in 0,5 m gelesen, wo jedes Echo auch sagt, ob sich der Impuls geteilt hat (siehe LSC). Was höher steht als das 3D-Gebäudemodell — die Oberfläche minus das Höhere von Boden und LoD2-Dach —, kommt nur dazu, wo OpenStreetMap sagt, was es ist: Ein eingetragener Schornstein, Turm, Mast, Wasserturm oder Leuchtturm wird eine runde Säule in der gemessenen Höhe (der 48 m hohe Schornstein der Lindenbrauerei in Unna), ein eingetragenes Gebäude, das das 3D-Modell noch nicht führt, ein Block in der gemessenen Höhe (unter der Dachform, die die Oberfläche zeigt, wo sie eine gemessen hat) — oder in der von OpenStreetMap, wo das Oberflächenmodell beflogen wurde, bevor das Gebäude fertig war (das Hamburger, beflogen am 2022-11-21, maß The Lyte mit 21,6 m; OpenStreetMap führt es mit 51,2 m). Ein eingetragenes Bahnsteigdach, ein Carport oder ein Unterstand, über dem die Oberfläche ein ebenes Dach zeigt, wird ein dünnes Dach auf Stützen in dieser Höhe. Unbenannte Spitzen bleiben weg: In der Leipziger Innenstadt waren Dutzende davon, 50–95 m hoch, die Baukräne des Flugtags. Ein Turm, den das 3D-Modell schon zeichnet — der einer Kirche, eines Schlosses —, kommt nicht ein zweites Mal dazu. Auf einem Wahrzeichen kommt ein Dach, das das 3D-Modell flach zeichnet oder zu früh abschneidet, die Oberfläche aber geformt zeigt, als die gemessene Oberfläche selbst dazu, Meter für Meter und leicht geglättet: Die Wellenkämme der Elbphilharmonie rollen über ihrem 96 m hohen Block, und ein Turmhelm, den das Modell bei 137 m enden lässt (die Stadtkirche in Unna), steigt bis zu seiner gemessenen Spitze bei fast 178 m. Und wo das Dach des 3D-Modells diese Oberfläche grob verfehlt — mehr als 2 m daneben auf 40 % der Dachfläche, oder auf einem Fünftel, wo die Oberfläche eben ist und das Modell sich neigt (ein flaches Walmdach über einem Kaufhaus mit Flachdach) —, baut der Viewer das Dach daraus neu, im eigenen Grundriss des Gebäudes und in der gemessenen Form: flach, wo die Oberfläche flach ist, und wo sie sich über eine breite Fläche neigt oder wölbt — die Bogenhalle des Hauptbahnhofs, ein großes Walmdach — als die gemessene Oberfläche selbst, leicht geglättet; eine schmale Schräge bleibt eine Stufe oder zwei, das wirkt mehr wie ein Gebäude als der unscharfe Rand des Scans. Wo das 3D-Modell die richtige Form hat und nur in der falschen Höhe steht, bleibt es stehen: Die modellierte Kuppel der Frauenkirche liegt rund 5 m tiefer als das Oberflächenmodell, ist aber die richtige Kuppel (siehe LoD2, Schwächen). Auch die Gauben auf den geneigten Dächern kommen daher: Wo immer die Oberfläche 0,7 m oder mehr über einem schrägen Dach des 3D-Modells steht — gleich wie groß und wie dicht an der nächsten, kompakt, niedriger als der First, nicht entlang eines Firsts oder einer Kehle, die das Modell etwas daneben gezeichnet hat, und ohne Baum in der Nähe —, setzt der Viewer eine Gaube dieser Größe und Höhe auf, zur Traufe gewandt — mit flachem Dach oder als Schleppgaube, wo die Oberfläche ihr Dach mit dem Hauptdach fallen zeigt — in den Farben des Hauses und ohne Fenster; eine Gaubenreihe, die das 1-m-Raster zusammenlaufen lässt, wird wieder getrennt. Eine Erhebung von ein, zwei Zellen am First, eine, die über den First ragt, oder eine auf einem Flachdach ist ein Hausschornstein: ein schmaler Kasten bis zu seiner gemessenen Spitze, in der Farbe des Hauses. Und über einer Ladenfront, die die Straßenfotos gefunden haben, ist eine ebene Fläche 2,6–6,5 m hoch, die 1,5–8 m aus der Wand ragt und dann abbricht, ein Vordach: die DDR-Ladenpavillons an der Hauptstraße tragen ihr Flachdach rund 4 m weit über den Gehweg. Der Viewer zeichnet diese Platte mit ihrer hohen Kante in der Farbe des Hauses und lässt das Schaufensterglas darunter durchlaufen; die Stützen, die sie tragen, sieht das Oberflächenmodell nicht, sie werden nicht gezeichnet. Auch die Höhe der Straßenlaternen kommt daher: Wo der Scan einen Mast frei von Bäumen und Fassaden zeigt, wird sein Kopf gelesen, und jede Laterne einer Straße bekommt den Median der Masten ihrer Straße (bei zu wenigen den ihrer Art Straße) — Leipzigs Hauptstraßen haben rund 10 m hohe Laternen, seine Nebenstraßen 5 m; wo der Scan zu wenige Masten zeigt, bleibt eine Laterne 5 m. Es gibt auch die Höhe jeder frei stehenden Mauer, für die OpenStreetMap keine angibt (ihre Krone über der tieferen Seite), und jeder kartierten Hecke, die der Laserscan nicht misst: der Median entlang der Linie, alles über 3 m bleibt als Baum außen vor; eine Hecke, die es unter 0,4 m liest, steht dort nicht und wird nicht gezeichnet. Auf der Elbe liegt das Deck eines festen Stegs in der Höhe, in der die Oberfläche es misst, und ein Ponton schwimmt so hoch über dem Wasser, wie er gemessen wurde. |
| **Stärken** | Gemessene Höhen für jeden Baum und jedes Dach der Stadt auf einmal, in echter Draufsicht ohne die seitliche Verkippung eines Fotos. |
| **Schwächen** | Es kann einen Baum nicht von einem Gebäude oder Bus unterscheiden; die Baumplatzierung ist deshalb auf Vegetationsklassen beschränkt und von Straßen, Gleisen und Wasser ausgeschlossen. Auf Straßen- und Bahnflächen gilt eine glatte, kahle Fläche — eine Schotterhalde, ein Schuppendach — nicht als Baum. Bewuchs unter 3 m wird ignoriert; ein Meter ist zu grob für einzelne Sträucher. Ein November-Scan zeigt Laubbäume ohne Blätter, ihre Kronen sind in den Daten dünner als im Sommer. |
| **Format und Download** | GeoTIFF wie das DGM1, dieselbe Portalseite. Nur offline genutzt; die Rohdatei ist nicht eingecheckt und erreicht den Browser nie. |

### LSC — die Laserscan-Punktwolke

| | |
|---|---|
| **Steht für** | *Laserscandaten* — die rohe Punktwolke, aus der die beiden Höhenmodelle berechnet werden. |
| **Wie erhoben** | Die Laserbefliegung selbst; jedes Echo ist ein Punkt mit Lage, Höhe und Intensität, klassifiziert in Boden und Nicht-Boden. |
| **Aktualisierung** | Wie die Höhenmodelle (27.–30. November 2024 für diese Kacheln). |
| **Auflösung und Genauigkeit** | Unregelmäßige Punkte, mehrere je Quadratmeter; ±0,15 m in der Höhe, ±0,30 m in der Lage, laut GeoSN. |
| **Allgemein geeignet für** | Alles, was die Raster wegvereinfachen: einzelne Baumkronen, Dachkanten, Mauerflächen, Freileitungen. |
| **Hier genutzt für** | Die Höhe der in OpenStreetMap kartierten Hecken sowie Bäume in Höfen und Gärten, die die Landnutzungskarte nicht als Grün führt (außer dort, wo das Stadtbaumkataster schon einen Baum hat). Von den Hecken, die nur der Scan findet, werden nur die langen, schmalen gezeigt (seit 2026-10-21), abseits von Baumkronen und grün im Luftbild: Etwa ein Drittel von allen waren Ränder von Baumkronen. Die Sträucher, die er findet, werden nicht gezeigt. Dazu die kleinen Bauten, die das 3D-Gebäudemodell auslässt — Garten- und Kleingartenlauben, Schuppen, Carports, Containerbauten, Pavillons, etwa 6 600 auf den fünfzehn Kacheln: Was 2–6,5 m über dem Boden steht, außerhalb jedes LoD2-Gebäudes, je Impuls nur ein Echo zurückwirft und oben flach oder gleichmäßig geneigt ist, wird zu einem einfachen Quader mit diesem Grundriss und dieser Höhe, im selben Ton wie die übrigen Gebäude, das Dach in der Farbe, die das Luftbild zeigt, wo es in der Sonne liegt; im Schatten des Luftbilds zählt nur eine saubere, kastenförmige Oberseite (ein Schatten im Hof sah wie ein Schuppen aus). Die Befliegung hat die gerade eröffneten Weihnachtsmärkte erfasst (der Striezelmarkt begann am 27. November 2024): Aus Fußgängerzonen und Plätzen, Marktplätzen, Baustellen und Parkplätzen, wie OpenStreetMap sie erfasst, wird nichts übernommen, und nichts in der Größe eines Transporters, außer OpenStreetMap kennt dort ein Gebäude. Dasselbe geschieht für Meißen, Grimma und Leipzig mit dem Scan von GeoSN (Meißen: 475 kleine Bauten und 6 449 Bäume, die die Kronenmaske auslässt) für Unna mit dem aus Nordrhein-Westfalen (*3D-Messdaten*) und für München mit den Laserpunkten aus Bayern (beflogen im Juni 2022, mit Laub); für Hamburg und Berlin wird kein Scan gelesen: Dort gibt es nur die Hecken aus OpenStreetMap, so hoch, wie das Oberflächenmodell sie liest, und die Bäume in Höfen und Gärten werden stattdessen im Luftbild gefunden — wo es grün ist und das Oberflächenmodell so rau wie eine Krone, abseits jedes Gebäudes (in Hamburg, dessen Luftbild im Sommer beflogen wurde, hat das die gefundenen Bäume mehr als verdoppelt). Die Regeln wurden an der Dresdner Befliegung abgestimmt. |
| **Stärken** | Sieht unter 3 m und zwischen die Häuser, wo die Höhenraster und die Landnutzungskarte nichts sehen. Jeder Punkt weiß, wie hell sein Echo war und ob sich der Puls geteilt hat — hohe Bäume teilen ihn fast immer, Dächer fast nie. |
| **Schwächen** | Die Klassen trennen Vegetation nicht von Gebäuden, Autos oder Zäunen. Eine geschnittene Hecke teilt einen Puls selten, deshalb stützt sich der Viewer bei niedrigen Pflanzen stattdessen auf die Grünheit des (Frühjahrs-)Luftbilds; eine Hecke unter einer Baumkrone bleibt unsichtbar. Die Echo-Helligkeit ist zwischen den Scannern zweier Ämter nicht vergleichbar (NRW zeichnet sie auf einer 16-mal größeren Skala auf): Jeder Scan wird so skaliert, dass seine Bodenechos im Mittel so hell sind wie die des Dresdner Scans, an dem die Heckenregel abgestimmt wurde — eine Annahme (derselbe Asphalt, derselbe Rasen werfen bei jedem Scanner gleich viel zurück), an Unnas und Münchens Hecken noch nicht geprüft. Bayern sortiert seine Punkte anders — Gebäude in einer eigenen Klasse, Vegetation zusammen mit anderen „Objektpunkten“ —, deshalb werden seine Klassen zuerst in die sächsischen übersetzt. |
| **Format und Download** | Sachsen: LAZ je 2-km-Kachel, groß (≈380 MB für 60 Millionen Punkte); dieselbe Portalseite wie das DGM1. Nordrhein-Westfalen: *3D-Messdaten* auf [opengeodata.nrw.de](https://www.opengeodata.nrw.de/produkte/geobasis/hm/3dm_l_las/) (`hm/3dm_l_las`), LAZ je 1-km-Kachel (je ≈100 MB) mit denselben Klassen Boden / Nicht-Boden; die vier Dateien einer 2-km-Kachel werden zu einer zusammengefügt. Bayern: klassifizierte Laserpunkte auf [geodaten.bayern.de](https://geodaten.bayern.de/opengeodata/), LAZ je 1-km-Kachel (je ≈105 MB), ebenso zusammengefügt. Geladen nur auf Wunsch (`bun run fetch <Ort> --lsc`). |

### LoD2 — das 3D-Gebäudemodell

| | |
|---|---|
| **Steht für** | *Level of Detail 2* des *Digitalen 3D-Stadtmodells*: jedes Gebäude als einfacher Körper mit echtem Grundriss, gemessener Höhe und standardisierter Dachform (Flach-, Sattel-, Walm-, Mansarddach und weitere). LoD1 wären flache Klötze; LoD3 hätte Fassadendetail. |
| **Wie erhoben** | Automatisch von der Landesvermessung erzeugt: Die Grundrisse kommen aus ihren Kataster- und Landschaftsdatenbanken (ALKIS / ATKIS), Dachformen und Höhen werden an die Laser-Punktwolke angepasst. Seit 2021 kann das Produkt auch Brücken, Mauern, Türme, Windräder und Masten enthalten. |
| **Aktualisierung** | Eine Kachel wird neu erzeugt, wenn sich ihre Eingaben ändern; das landesweite Modell wurde zuletzt im August 2025 aktualisiert. Das Modell einer Kachel ist so alt wie seine Eingaben: Für diese Kacheln stammen die Dächer aus dem Laserscan von **2016**, die Grundrisse aus dem Basis-DLM von 2021 bzw. 2022 und der Boden aus dem DGM von 2016; das Modell selbst wurde 2023 (westliches Paar) bzw. 2024 (östliches Paar) erzeugt. Die Daten von 2025 in den Dateien sind Exportdaten, keine Erfassungsdaten. |
| **Auflösung und Genauigkeit** | Grundrisse in Katastergenauigkeit (Dezimeter); Dachhöhen in Lasergenauigkeit; Dachformen sind der nächstliegende Standardtyp, nicht das reale Dach. |
| **Allgemein geeignet für** | Stadtbild-Visualisierung, Verschattungs- und Solarstudien, Lärm- und Windmodelle, Geschoss- und Volumenzählung. |
| **Hier genutzt für** | Grundriss, Höhe, Dachform und Attribute jedes Gebäudes; die Grundrisse der Minikarte; das Abriss-Werkzeug; und was die Karte eines befragten Gebäudes darüber sagt — seine Kennung, die amtliche Nutzung, Dachform und -neigung, gemessene Höhe und Grundfläche und den Stand des Modells. Die kleinen Bauten, die ihm fehlen, kommen aus dem Laserscan (siehe LSC); Schornsteine, Türme, Masten und Gebäude, die jünger sind als das Modell, aus dem Oberflächenmodell, wo OpenStreetMap sie benennt (siehe DOM1). Seine Überdachungen und Carports, die es als massive Blöcke modelliert (Hamburg, München und Unna haben welche), werden zu einem Dach auf Stützen geöffnet. |
| **Stärken** | Exakte Silhouetten: Grundrisse und Dachformen sind stadtweit konsistent, Höhen gemessen. |
| **Schwächen** | Nichts unterhalb der Traufe: keine Fenster, Türen, Materialien oder Farben (der Viewer zeichnet eine Tür, wo OpenStreetMap einen Eingang erfasst, öffnet einen Durchgang durch das Gebäude, wo es einen erfasst — eine Tordurchfahrt in den Hof, die Tore des Zwingers —, und Fenster im Rhythmus, den Straßenfotos gemessen haben, dem eines Nachbarn oder dem des Haustyps). Die Gebäudefunktion ist bei etwa 86 % der Gebäude „nicht spezifiziert“, die Geschosszahl nur bei wenigen Prozent gefüllt; der Viewer nimmt die Geschosse deshalb aus OpenStreetMap, wo sie eingetragen sind, und leitet die Geschossbänder sonst aus der gemessenen Höhe ab. Brücken stehen in den Kacheln als flache, 1 m dicke Platten in einer Höhe (Funktion `53001_1800`, „Bauwerk im Verkehrsbereich“) — der Viewer lässt sie weg und baut Brücken aus Landschaftsmodell und Oberflächenmodell. Ein Gebäude, das zu verwickelt für den Katalog der Dachformen ist, bekommt ein „Freiform“-Dach, und bei einem großen Komplex sind das oft wenige riesige schräge Flächen über dem ganzen Grundriss: Das Hotel Westin Bellevue an der Elbe, eine flach gedeckte Scheibe mit niedrigeren Flügeln und zwei Innenhöfen, stand unter einem zeltartigen Dach mit einer Spitze in der Mitte. Gebäude, die erst nach der Dachvermessung fertig wurden, stehen als 3-m-Platzhalter da. Der Viewer misst jedes Dach am Oberflächenmodell (DOM1) und baut die 886, die es grob verfehlen — etwa 2 % —, in der Form neu, die das Oberflächenmodell zeigt: flache Teile in ihren gemessenen Höhen, breite geneigte, gewölbte und überkuppelte Teile als die gemessene Oberfläche. |
| **Format und Download** | **CityGML** je 2-km-Kachel (auch DXF und Shape); das Projekt wandelt vor dem Einchecken in **CityJSON** um, eine kompakte JSON-Form desselben Standards (8–11 MB je Kachel). [Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html). |

### Basis-DLM — das Landschaftsmodell

| | |
|---|---|
| **Steht für** | *Digitales Basis-Landschaftsmodell*: die detaillierteste Stufe von **ATKIS**, dem *Amtlichen Topographisch-Kartographischen Informationssystem*, dem bundesweiten System amtlicher topographischer Daten. Eine Vektorkarte dessen, was den Boden bedeckt — Straßen, Wege, Bahnen, Gewässer, Wald, Landwirtschaft, Siedlung — plus Linienobjekte wie Hecken und Baumreihen, mit Attributen. |
| **Wie erhoben** | Von der Landesvermessung gepflegt auf Grundlage aktueller Orthophotos, des Geländemodells, örtlicher Messungen und Daten anderer Stellen (Straßen- und Bahnbetreiber, Kommunen). Objektarten und Attribute folgen einem bundesweiten Katalog (GeoInfoDok / AAA-Schema 7.1.2 seit 2025), sind also in jedem Bundesland gleich. |
| **Aktualisierung** | Zwei Rhythmen, laut GeoSN: eine *Grundaktualisierung*, bei der alle Objekte alle 3–5 Jahre überprüft werden, und eine *Spitzenaktualisierung*, bei der wichtige Objekte (Straßen, Bahnen und dergleichen) alle 3, 6 oder 12 Monate überprüft werden. Das Download-Paket wird quartalsweise erneuert. |
| **Auflösung und Genauigkeit** | Lagegenauigkeit ±3 m für die wesentlichen Linienobjekte (Straßen, Gleise, Flüsse) und ±15 m für alles Übrige, laut GeoSN. Straßen sind Achsen mit Breitenattribut, keine Flächen. |
| **Allgemein geeignet für** | Eine konsistente, attributierte Grundlage für GIS: Fachdaten daran anknüpfen, Routing und Navigation, Nutzungsstatistiken, Kartographie im Maßstab etwa 1:10 000 bis 1:25 000. |
| **Hier genutzt für** | Die Bodenfarben (zehn Landnutzungsklassen, darunter Ackerland), den Gewässerumriss, Hecken und Baumreihen, die Vegetationsmaske für die Baumplatzierung, Bahnflächen, die Gleislinien, wo OpenStreetMap kein Gleis kartiert, und ob eine Strecke elektrifiziert ist, wo OpenStreetMap es nicht sagt, Brückenachsen und, wo vorhanden, Deck-Umrisse; die Denkmäler, Gedenksteine, Säulen und benannten Brunnen (die Albertplatz-Brunnen „Stilles Wasser“ und „Stürmische Wogen“, der Neptunbrunnen, …) mit ihren amtlichen Namen. |
| **Stärken** | Amtliche Klassifizierung mit nützlichen Attributen: Straßenbreiten, Gleiszahl, Elektrifizierung, Brückennamen. |
| **Schwächen** | Alles Kleine oder Exakte: Straßen müssen nach Regel verbreitert werden, Bahnlinien und Straßenachsen kommen in kurzen Fragmenten und sagen nicht, ob sie unter der Erde verlaufen — der Viewer lässt einen Abschnitt weg, der mehr als 15 m an einem erfassten Tunnel entlangläuft (U- und S-Bahn unter dem Münchner Marienplatz, der Leipziger City-Tunnel, die Straße durch den Meißner Schottenbergtunnel), ein Gleis oder eine Straße, die nur über einen hinwegführt, bleibt —, Deck-Umrisse gibt es vor allem für große Brücken, es gibt keine Straßenmöbel und keine Bahnsteige. Denkmäler sind nur Punkte mit Namen: keine Größe, keine Form, und nichts sagt, welches davon ein Brunnen ist — der Viewer nimmt die Form eines Denkmals aus dem Oberflächenmodell, wo sie messbar ist (sonst eine abstrakte Markierung), und das Becken eines Brunnens aus OpenStreetMap. Bei ±3 m kann ein Straßenrand eine Spur daneben liegen. |
| **Format und Download** | Landesweites Paket als Shape (oder NAS oder GeoPackage), etwa 1,2 GB; das Projekt schneidet jede Kachel daraus aus. [Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html). |

### DOP20 RGBI — die Luftbilder

| | |
|---|---|
| **Steht für** | *Digitales Orthophoto*, 20 cm Bodenauflösung, Kanäle **R**ot, **G**rün, **B**lau und Nah**i**nfrarot. Ein Orthophoto ist eine Luftaufnahme, die über das Geländemodell entzerrt ist, sodass jedes Pixel an seiner wahren Kartenposition sitzt und Entfernungen wie in einer Karte gemessen werden können. |
| **Wie erhoben** | Ein Vermessungsflugzeug fotografiert Streifen des Landes mit einer kalibrierten Kamera (seit 2021 mit 80 % Längs- und 60 % Querüberdeckung); die Bilder werden orientiert, über das DGM entzerrt und zu 2-km-Kacheln zusammengesetzt. |
| **Aktualisierung** | Jährlich etwa die Hälfte des Landes, abwechselnd im Frühjahr und im Sommer, also jede Kachel ungefähr alle zwei Jahre, laut GeoSN. Diese Kacheln wurden am **19. März 2024** beflogen — eine Frühjahrsbefliegung ohne Laub. |
| **Auflösung und Genauigkeit** | 20 cm je Pixel; Standardabweichung eines Pixels von seiner wahren Lage ≤ 0,4 m; 8 Bit je Kanal; 10 000 × 10 000 Pixel je Kachel, laut GeoSN. |
| **Allgemein geeignet für** | Das Basisbild für Kartierung und GIS-Erfassung; Umwelt-, Land- und Forstwirtschaftsmonitoring (der Infrarotkanal trennt Vegetation von allem anderen); Verkehrs- und Stadtplanung. |
| **Hier genutzt für** | Die Farbe jedes Dachs, gelesen aus seinen sonnigen Teilen (ein robuster Median, den Rand meidend). Die Luftbilder jeder Stadt haben ihren eigenen Farbstich — Leipzigs sind blaugrün, Münchens gelblich —, deshalb wird das Bild jeder Stadt zuerst an ihren eigenen sonnigen Straßen auf Dresdens Farbbalance gebracht, und ein graues Dach ist in jeder Stadt grau. Außerdem den Grünindex **NDVI** aus Rot- und Infrarotkanal, der Baumkronen von trocken-salbeigrün bis satt-dunkelgrün tönt und Wiesen ebenso und ein Feld grün färbt, wo etwas darauf wächst. Die Zeilen eines Weinbergs laufen, wie das Bild sie zeigt. Es sagt auch, womit ein Sportplatz belegt ist, den OpenStreetMap nicht beschreibt: Rasen, wo das Infrarot etwas wachsen sieht, Kunstrasen, wo er grün ist und nichts wächst, das Rot von Tartan, das Orange von Sand- oder Tennenplätzen oder ein grauer oder blauer Hartplatz — in Dresden ist nur einer der zwölf Fußballplätze ohne Angabe Rasen. |
| **Stärken** | Echte Farben und echtes Grün, wo das Foto senkrecht nach unten schaut. |
| **Schwächen** | Fassaden sind unsichtbar (ein Senkrechtbild sieht nur Dächer); hohe Gebäude kippen im Bild seitlich, weshalb Dachgrundrisse vor der Abtastung nach innen verkleinert werden; die Rohfarben wirken fahl und dunstig, was der Viewer mit einer farbtonerhaltenden Sättigungsanhebung korrigiert. Weil die Befliegung ohne Laub stattfand, sind Laubbäume im Bild kahl: Der Grünindex ist fast überall niedrig, und die Kronenfärbung zentriert ihn auf den Median, statt ihn als Absolutwert zu lesen. |
| **Format und Download** | GeoTIFF je 2-km-Kachel, etwa 380 MB für die 4-Kanal-Variante. [DOP-Downloadbereich](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html). Eingecheckt sind nur Derivate (Dachfarben, NDVI-Raster). |

### NDVI — der Grünindex (abgeleitet, nicht heruntergeladen)

| | |
|---|---|
| **Steht für** | *Normalized Difference Vegetation Index*: (Nahinfrarot − Rot) / (Nahinfrarot + Rot), je Pixel aus dem DOP berechnet. |
| **Warum es funktioniert** | Gesunde Blätter reflektieren Nahinfrarot stark und absorbieren Rot, also ist der Index auf saftiger Vegetation hoch und auf Dächern, Straßen und Wasser nahe null. |
| **Hier genutzt für** | Kronenfarbe und Wiesentönung; gebacken in ein 1024²-Raster je Kachel (etwa 2 m je Pixel). |
| **Vorbehalt** | Nur so gut wie das Aufnahmedatum: Ein Märzbild trennt Immergrüne und Gras von allem anderen, sagt aber wenig über das Sommerlaub. Wo das Luftbild keinen Infrarotkanal hat (Bayerns, für München), springt ein Ersatz aus den sichtbaren Farben ein — der *Green Leaf Index*, (2·Grün − Rot − Blau) / (2·Grün + Rot + Blau), so skaliert, dass er dort zum NDVI passt, wo es beide gibt (auf den Sommerbildern aus Nordrhein-Westfalen stimmt er bei 85 % der Pixel darin mit dem NDVI überein, ob ein Pixel grün ist). Er unterscheidet Grün von Grau gut, wie wüchsig eine Pflanze ist, weniger gut. Und jede Befliegung hat ihre eigene Helligkeit je Kanal — derselbe Asphalt liest in Dresden −0,30 und in Hamburg −0,07 —, deshalb wird der Index jeder Stadt an zwei Flächen, die es überall gibt, auf eine Skala gebracht: Ihre Fahrbahnen und ihre gemähten Rasen lesen sich wie Dresdens, damit „grün“ in jeder Stadt dasselbe heißt. |

### OSM — OpenStreetMap

| | |
|---|---|
| **Steht für** | *OpenStreetMap*, die freie Weltkarte, die seit 2004 von Freiwilligen gebaut wird. |
| **Wie erhoben** | Mitwirkende kartieren aus GPS-Spuren, Begehungen vor Ort und durch Abzeichnen von Luftbildern (einschließlich amtlicher Orthophotos, wo deren Lizenz es erlaubt) und beschreiben jedes Objekt mit freien Schlüssel-Wert-*Tags* wie `highway=street_lamp` oder `barrier=retaining_wall` + `height=9`. |
| **Aktualisierung** | Laufend: Änderungen sind binnen Minuten live. Download-Auszüge (Geofabrik) werden täglich neu gebaut; das Projekt liest einen solchen Auszug, nicht die Live-Datenbank. |
| **Auflösung und Genauigkeit** | Keine Garantie; in einer gut kartierten Stadt typischerweise meterngenaue Lagen. Vollständigkeit und Tag-Konsistenz schwanken von Straße zu Straße und Mapper zu Mapper. |
| **Allgemein geeignet für** | Dinge, die kein amtlicher Datensatz hat: Straßenmöbel, Points of Interest, Namen, informelle Wege, Tragwerkstypen; nahezu weltweite Abdeckung; schnell abzurufen. |
| **Hier genutzt für** | Lampenpositionen (`highway=street_lamp`), Stadtmöbel — Sitzbänke (`amenity=bench`, mit `backrest` und `direction`, wo eingetragen), Picknicktische, Papierkörbe, Fahrradbügel (mit `capacity`), Poller, Briefkästen und Wartehäuschen (`shelter=yes`) — eine Bushaltestelle ohne eines bekommt ihr „H“-Schild —, Litfaßsäulen (`advertising=column`), Ampeln (`highway=traffic_signals`, von der Haltlinie auf der Fahrbahn an den Bordstein auf der Seite des Verkehrs versetzt, dem sie gelten, `traffic_signals:direction`), Hydranten (`emergency=fire_hydrant`: ein Überflurhydrant, bei einem Unterflurhydranten nur sein kleines Hinweisschild), Uhren (`amenity=clock` an einem Mast oder an einer Wand) und Trinkbrunnen, Spielplatzumrisse (`leisure=playground`) mit den darauf eingetragenen Geräten (`playground=swing`, `slide`, `sandpit`, …) —, ohne eingetragene Richtung zur nächsten Straße oder zum nächsten Weg gedreht, Bahnsteige (`railway=platform`), Hecken (`barrier=hedge`), Stütz- und Stadtmauern, Böschungen und Felskanten (`barrier=*`, `man_made=embankment`, `natural=cliff`) mit ihrem `height`-Tag und Material (`material`, `wall=*`), Treppenläufe (`highway=steps` mit `width`, `step_count`, `surface` und `handrail`, die Breite sonst aus einem `area:highway=steps`-Umriss), ob eine Brücke eine Bogenbrücke ist (`bridge:structure`, wenn Wikidata die Brücke nicht kennt), die Durchfahrtshöhe der Elbbrücken aus den Binnenschifffahrts-Zeichen (`seamark:bridge:clearance_height`: sie ergibt die Konstruktionshöhe des Decks, und über der Fahrrinne stehen keine Pfeiler), und Brunnen (`amenity=fountain`): der Umriss jedes Beckens, ob es ein Wasserspielplatz oder ein stilles Becken ist, und die vielen kleinen Brunnen, die das Landschaftsmodell nicht führt. Steht ein amtliches Denkmal in einem OSM-Becken, behält der Brunnen den amtlichen Namen. Denkmäler und Kunstwerke (`memorial=*`, `artwork_type=*`): ob ein Denkmal ein Standbild auf einem Sockel ist, eine Büste, eine freie Skulptur, eine Stele, ein Stein oder ein Obelisk — das amtliche Verzeichnis sagt es nicht —, dazu Künstler und Material für die Karte und ihre Farbe (ein gedämpfter Ton von Bronze, Sandstein, Granit …) und die Skulpturen in Parks, die das amtliche Verzeichnis nicht führt. Außerdem, womit eine Straße, ein Weg oder ein Parkplatz belegt ist (`surface=asphalt`, `paving_stones`, `sett`, … an den Wegen, `sidewalk:*:surface` an den Straßen) und in welche Richtung sie verläuft, damit Platten und Pflastersteine längs der Straße liegen; und wo Autos parken (`parking:left/right/both` mit Ausrichtung an den Straßen, `amenity=parking`-Parkplätze mit ihren Fahrgassen, erfasste Stellplätze), gezeichnet als Stellplätze — mit gemalten Linien nur, wo OpenStreetMap sagt, dass sie markiert sind (`parking:<side>:markings`), und auf einem Parkplatz, außer es sagt, sie sind es nicht, oder der Parkplatz ist unbefestigt; und wo der Bordstein abgesenkt ist (`highway=crossing`, `kerb=lowered|flush`, Querungswege, Grundstückszufahrten); und die Fußgängerinseln, Rasenflächen und Brunnen in Plätzen, die das Landschaftsmodell als eine einzige Straßenfläche führt (der Albertplatz). Und die Sportplätze (`leisure=pitch`, `leisure=track`): ihr Umriss, die Sportart (`sport=soccer`, `tennis`, `basketball`, …) und der Belag (`surface=grass`, `clay`, `tartan`, `sand`, …), gezeichnet als Spielfeld mit seinen Linien, dazu die Tore, Basketballkörbe und Netze darauf. Und an den Gebäuden: Läden und Lokale (`shop=*`, `amenity=cafe`, `restaurant`, `bar`, `pub`, `fast_food`, …) im Erdgeschoss (ohne `level` oder mit einem, das die 0 enthält), deren Schaufenster in der Dämmerung warm leuchten, und Baudenkmale (`heritage=*` an einem Gebäudeumriss), deren Fassade ganz leicht wärmer wird. Für die Karte eines befragten Gebäudes: der Name eines Gebäudes (`name` an seinem Umriss), seine Adresse (`addr:street` und `addr:housenumber`, am Umriss oder an Adresspunkten darin) und seine Geschosse (`building:levels`), die auch die Geschossbänder setzen: Jede Linie liegt dann auf einer echten Decke, wo die Zahl zur Wandhöhe passt. Und die Eingänge (`entrance=*`, im Erdgeschoss): Jeder wird zu einer Tür an der nächsten Wand des 3D-Gebäudemodells — ein heller Rahmen und ein dunklerer, zurückgesetzter Flügel darin, seine Größe nach der Art (`main`, `garage`, `service`, …) oder nach `width` und `height`, wo eingetragen. Ein Gebäude ohne erfassten Eingang bekommt keine Tür; keine wird erfunden. Die Durchgänge durch Gebäude (`tunnel=building_passage`: eine Tordurchfahrt in den Hof, ein Stadttor, die Durchgänge des Zwingers zu seinem Teich) werden im 3D-Gebäudemodell geöffnet, so breit, wie `width` sagt oder wie eine Durchfahrt oder ein Fußweg ist, und so hoch, wie `maxheight` sagt oder das Erdgeschoss zulässt, mit Wänden und einer Decke in der Farbe des Gebäudes ausgekleidet — man kann hindurchgehen. Ihre Öffnungen sind Rechtecke: Keine Quelle gibt die Form eines Bogens. Dazu die Zäune und Geländer (`barrier=fence`, `handrail`) mit ihrer Bauart (`fence_type`: Holz wirkt etwas wärmer) und Höhe, gezeichnet als niedriges, ruhiges Band in einem sanften Ton statt Stab für Stab, und die Tore darauf (`barrier=gate`, `lift_gate`, …), die eine Lücke mit einem helleren Flügel oder einer Schranke in Zaun oder Gartenmauer schneiden. Baujahre (`start_date`) trägt OpenStreetMap hier an weniger als einem Prozent der Gebäude — zu wenig, um die Stadt danach zu färben. Und die Farbe auf der Fahrbahn: Fußgängerüberwege (`highway=crossing`), gezeichnet als Zebrastreifen nur, wo OpenStreetMap sagt, dass es einer ist (`crossing:markings=zebra`, `crossing_ref=zebra`, das Zeichen des Zebrastreifens), und als die zwei unterbrochenen Linien einer Fußgängerfurt, wo es Linien oder eine Ampel einträgt — ein Überweg, der nur `marked` oder `uncontrolled` heißt, bekommt keine Farbe, denn die meisten zeigen auf den Luftbildern keine; Haltlinien vor Ampeln, deren Richtung eingetragen ist (`traffic_signals:direction`); Radfahrstreifen und Schutzstreifen (`cycleway:right=lane`, …: eine durchgezogene Linie für einen Radfahrstreifen, `cycleway:right:lane=exclusive`, Striche für einen Schutzstreifen, rot, wo `surface:colour=red`), rote Radwege und Mittellinien auf zweispurigen Hauptstraßen mit Gegenverkehr (`lanes`, `oneway`; durchgezogen, wo Überholen verboten ist, keine über einem Straßenbahngleis in der Straßenmitte, Fahrstreifenlinien ab vier Fahrstreifen). Und das bebaute Land, das das Landschaftsmodell in Wiese oder Siedlungsfläche aufgehen lässt: Kleingartenanlagen (`landuse=allotments`), gezeichnet als kleine Gärten — Parzellen in sanften Grüntönen mit schmalen Wegen dazwischen, einigen Gemüsebeeten und Blumen; die Parzellen sind erfunden, weil OpenStreetMap hier keine einzelne darin erfasst —, Obstwiesen (`landuse=orchard`), ihre Bäume dort, wo das Oberflächenmodell die Kronen zeigt (sonst, wo ein Baum eingetragen ist, sonst alle 8 m), ihre Art aus `trees=*`, und Weinberge (`landuse=vineyard`), deren Zeilen laufen, wie das Luftbild sie zeigt, sonst den Hang hinab, an steilen Terrassen ihm entlang (an den Loschwitzer Elbhängen). Und einzelne Bäume (`natural=tree`), wo das Stadtbaumkataster im Umkreis von 3 m (oder innerhalb der Krone des Katasterbaums) keinen führt — in einer Stadt ohne Kataster jeder, so hoch, wie das Oberflächenmodell ihn misst — in Höfen, im Zwinger und auf privatem Grund: ihre Art (`species`, `genus`) oder wenigstens, ob Laub- oder Nadelbaum (`leaf_type`), und ihre Höhe (`height`), wo eingetragen; ein kartierter Baum ohne beides bleibt weg. Und die Straßenbahn: jedes Gleis (`railway=tram`) in seiner eingetragenen Spurweite (`gauge`: 1 450 mm in Dresden, 1 458 mm in Leipzig, Normalspur, wo keine eingetragen ist), ob es über eine Brücke führt, und die Oberleitungsmasten (`power=catenary_mast`); das Gleisbett — Straße, Rasen oder Schotter — wird aus der Landnutzungskarte und dem Vegetationsindex gelesen, und wo kein Mast eingetragen ist, wird die Oberleitung zwischen den Fassaden der kartierten Gebäude (`building=*`) links und rechts aufgehängt, wie es Dresden in engen Straßen tut, oder, wo keine Fassade nah ist, an Masten am Straßenrand. Eine Straßenbahnhaltestelle (`railway=tram_stop`) bekommt ihr Haltestellenschild auf ihrem eingetragenen Bahnsteig. Auf der Elbe die Anlegestellen der Dampfer und die kleineren Stege (`man_made=pier`, schwimmende mit `floating=yes`), die Buhnen (`man_made=groyne`) und die Fährrouten (`route=ferry`), gezeichnet als zarte Kielspur, die nur aus der Luft zu sehen ist. Und woraus die Gebäude gebaut sind und welche Farbe sie haben (`building:material`, `building:colour`, `roof:colour`, an einem Gebäude oder einem seiner Teile): Die Farbe wird in den Pastellton des Viewers übersetzt — ein rotes Haus wird ein staubiges Terrakotta, nie ein Signalrot —, das Material wählt eine Familie der Tonpalette (Backstein, Stein, Putz …), und Glas- und Metallfassaden werden etwas kühler und glatter, Glas mit einem blassen Himmelsschimmer im Streiflicht; Fenster werden keine gezeichnet. Die Dachfarbe aus dem Luftbild gewinnt weiterhin, wo es eine gibt. Ein Gebäude ohne erfasstes Material übernimmt das seiner Nachbarschaft: Sind die meisten erfassten Wände im Umkreis von 300 m aus Backstein, wird es in Backstein gezeichnet, sonst in Putz (Glas- und Metallfassaden zählen nicht mit). Und die Bahnstrecken, Gleis für Gleis (`railway=rail`, `light_rail`, `subway`, `narrow_gauge`, mit `electrified`, `gauge` und `bridge`), die Oberleitungsmasten daneben (`power=catenary_mast`) und die Höhe der Bahnsteige (`height`); in Hamburg und Berlin, deren Vermessungsämter kein Landschaftsmodell in der Form veröffentlichen, die der Viewer liest, auch ihre Gleisbetten und die Brücken (`bridge=*` an Straßen, Wegen und Bahnstrecken, je Brücke zu einem Deck vereint, auf ihrem `man_made=bridge`-Umriss, wo einer erfasst ist); die Höhe jedes Decks kommt weiter aus dem Oberflächenmodell. Außerdem Schornsteine, Türme, Masten, Wassertürme und Leuchttürme (`man_made=*`, mit `height` und `diameter`, wo eingetragen) und Gebäudeumrisse: Sie sagen, was eine Höhe im Oberflächenmodell, die dem 3D-Gebäudemodell fehlt, eigentlich ist (siehe DOM1) — ebenso die Dächer auf Stützen (`building=roof`, `carport`, `amenity=shelter`); die `height` oder `building:levels` eines Gebäudes gilt, wo das Oberflächenmodell beflogen wurde, bevor es fertig war. Und das Merkmal `wikidata=*` an einem Gebäudeumriss, das sagt, welche Gebäude ein Wikidata-Wahrzeichen sind. Und die Wandbilder (`tourism=artwork` mit `artwork_type=mural`, `mosaic`, `graffiti` oder `sgraffito`, ein Punkt oder eine Linie an der Wand) mit ihrer Größe (`width`, `height`, die Länge einer Linie) und der Höhe, in der sie beginnen (`min_height`; wo sie fehlt, hängt der Viewer sie ein Geschoss hoch), und einem Foto von ihnen (`image`, `wikimedia_commons`, sonst Foto und Größe ihres `wikidata`-Objekts): Wo das Foto das ganze Bild gerade von vorn zeigt, wird es nach diesem Foto auf seine Wand gezeichnet. |
| **Stärken** | Lesbare Tags für genau die Details, die die Landesvermessung nicht modelliert; die Brühlsche Terrasse existiert hier und sonst nirgends. |
| **Schwächen** | Nicht jede Lampe oder Bank ist erfasst, und nur wenige Bänke sagen, wohin sie blicken, Höhen fehlen oft (der Viewer misst eine Mauer ohne Höhe im Oberflächenmodell, sonst nutzt er Standardwerte je Mauertyp), Tags variieren. Freiwilligendaten müssen genannt werden (ODbL). |
| **Download und Lizenz** | Ein regionaler Auszug des ganzen Bundeslandes, `sachsen-latest.osm.pbf`, von [Geofabrik](https://download.geofabrik.de/europe/germany/sachsen.html) geladen (etwa 250 MB) und lokal gelesen, was Ratenlimits vermeidet und das Ergebnis reproduzierbar macht. Die heute eingecheckten Lampen-, Bahnsteig- und Brückentragwerk-Dateien sind älter: Sie wurden über die **Overpass-API**, einen Live-Abfragedienst, geholt, bevor die Bakes auf den Auszug umgestellt wurden, und wechseln beim nächsten Neubacken auf den Auszug. Lizenz: **ODbL**, Vermerk „© OpenStreetMap-Mitwirkende“. |

### Verkehrsmengen — die gezählten Kraftfahrzeuge

| | |
|---|---|
| **Steht für** | Die *Verkehrsbelegung* des Straßen- und Tiefbauamts: Kraftfahrzeuge je Tag (DTV, durchschnittlicher täglicher Verkehr) für jeden gezählten Straßenabschnitt zwischen zwei Kreuzungen, je Fahrtrichtung, mit dem Schwerverkehr. |
| **Wie erhoben** | Meist von Hand an einem Tag gezählt und auf den Durchschnittstag hochgerechnet; an einigen Straßen Induktionsschleifen oder Infrarotdetektoren mit Jahresmittelwerten; an wenigen ein geschätzter „Hilfswert“. |
| **Aktualisierung** | Abschnitt für Abschnitt, wenn neu gezählt wird; im Gebiet meist 2023–2026, einzelne Abschnitte bis 2010 zurück. |
| **Hier genutzt für** | Die Datenebene *Kfz-Verkehr*: je gezählter Richtung ein gläserner Strom auf der Fahrbahn, rechts der Fahrtrichtung, so breit und so hoch wie die Wurzel der Fahrzeuge je Tag, in fünf Stufen von Salbei über Pfirsich, Koralle und Rosé zu Weinrot getönt; Licht läuft in Fahrtrichtung hindurch, viel Schwerverkehr färbt ihn schieferblau. Die Ströme folgen der eingestellten Uhrzeit: Die Tageszahl wird nach dem *Tagesgang* (unten) auf die Stunde umgelegt — nachts schmal und fast dunkel, im Berufsverkehr voll und langsam. Durch das Glas sieht man die Straße dahinter, leicht gebrochen; aus der Luft wird es satter, damit die Ebene als Karte lesbar bleibt. Eine Straße ohne Zählung bleibt leer — es wird nichts geschätzt. |
| **Stärken** | Gemessen und je Richtung; fast alle Hauptstraßen gezählt. |
| **Schwächen** | Ein Tagesmittel, kein eigener Verlauf über den Tag (den liefert der Tagesgang, für alle Straßen derselbe); Zählungen aus verschiedenen Jahren nebeneinander; Nebenstraßen oft ungezählt. |
| **Download und Lizenz** | Der WFS der Stadt (`kommisdd.dresden.de`, Ebene `cls:L363` „Kfz/Tag“), je Kachel abgefragt. Lizenz `dl-de/by-2-0`, Vermerk „Landeshauptstadt Dresden“. |

### Tagesgang — wie sich der Verkehr über den Tag verteilt

| | |
|---|---|
| **Steht für** | Welcher Anteil der Fahrzeuge eines Tages in welcher Stunde fährt, je für Werktag, Samstag und Sonntag. |
| **Wie erhoben** | Gemessen von den Infrarotdetektoren Hamburgs an 38 innerstädtischen Hauptstraßen, stündlich, im September 2026: je Zählstelle die vollständigen Tage auf eins normiert und gemittelt, dann über die Zählstellen. Dresden veröffentlicht nur Tageswerte; die Form der Hauptstraßen einer deutschen Großstadt steht für ihre Stunden. |
| **Hier genutzt für** | Die Uhrzeit der Datenebene *Kfz-Verkehr*: Farbe, Größe und Licht eines Stroms folgen der Tageszahl seiner Straße mal dem Anteil der eingestellten Stunde. Die Seitenleiste nennt die Stunde und wie viel los ist. |
| **Stärken** | Gemessen, städtisch, mit Werktag, Samstag und Sonntag. |
| **Schwächen** | Eine Kurve für alle Straßen und aus einer anderen Stadt; Feiertage zählen als Werktage; ein Monat, keine Jahreszeiten. |
| **Download und Lizenz** | Hamburgs Urban Data Platform (SensorThings, `iot.hamburg.de`, `HH_STA_Verkehrsdaten_Kfz_Infrarotdetektoren`), einmal ausgewertet; die Werte stehen in `lib/city/traffic-hours.ts`. Lizenz `dl-de/by-2-0`, Vermerk „Freie und Hansestadt Hamburg“. |

### Verkehrszählungen der anderen Städte

| | |
|---|---|
| **Steht für** | Kraftfahrzeuge je Tag und Straßenabschnitt, beide Richtungen zusammen: in **Berlin** die *Verkehrsmengen 2023* (Werktagsmittel, Hauptstraßennetz), in **Hamburg** die *Verkehrsmengen 2019* der Hauptverkehrsstraßen (auf tausend gerundet, mit Schwerverkehrsanteil), für **Grimma** und **Meißen** die *Straßenverkehrszählung 2021* Sachsens, für **Unna** die *Verkehrswerte* von Straßen.NRW. |
| **Wie erhoben** | Die Städte rechnen Zählungen auf ihr Netz hoch; die Straßenverkehrszählungen der Länder zählen alle fünf Jahre an festen Stellen der Bundes-, Landes- und Kreisstraßen und rechnen auf den Jahresdurchschnittstag hoch. |
| **Hier genutzt für** | Die Datenebene *Kfz-Verkehr* dieser Städte, genauso dargestellt wie in Dresden; weil nur die Summe beider Richtungen bekannt ist, bekommt jede Richtung die Hälfte — das sagt auch die Seitenleiste. |
| **Stärken** | Amtlich und offen; überall dieselbe Darstellung. |
| **Schwächen** | Keine Richtungen; Einbahnstraßen sind nicht gekennzeichnet; die Zählungen der Länder reichen nicht in die Stadtzentren (in **Leipzig** und **München** liegt keine gezählte Straße auf den Kacheln, dort gibt es die Ebene nicht). |
| **Download und Lizenz** | Berlin: WFS `gdi.berlin.de/services/wfs/verkehrsmengen_2023`, `dl-de/zero-2-0`. Hamburg: WFS `geodienste.hamburg.de/HH_WFS_Verkehrsmengen`, `dl-de/by-2-0`, „Freie und Hansestadt Hamburg, Behörde für Verkehr und Mobilitätswende“. Sachsen: `list.smwa.sachsen.de/gdi/download/DE-SN-SBV-SVZ2021.zip`, `dl-de/by-2-0`, „Freistaat Sachsen, LASuV“. NRW: WFS `wfs.nrw.de/wfs/strassen_nrw` (`ms:Verkehrswerte`), `dl-de/by-2-0`, „Straßen.NRW“. |

### Hamburger Radzählnetz — Fahrräder, live

| | |
|---|---|
| **Steht für** | Die Infrarot-Zählstellen des Hamburger Radzählnetzes, je Knotenarm und Richtung — auf Hamburgs Kacheln 21. |
| **Aktualisierung** | Stündlich. |
| **Hier genutzt für** | Die Datenebene *Radverkehr (live)* in Hamburg, wie in Dresden: Der Browser fragt die Werte der letzten Stunde direkt bei der Stadt ab. |
| **Download und Lizenz** | Die Urban Data Platform (SensorThings, `iot.hamburg.de`, `HH_STA_Verkehrsdaten_Rad_Infrarotdetektoren`). Lizenz `dl-de/by-2-0`, Vermerk „Freie und Hansestadt Hamburg“. Leipzig (täglich), München (monatlich) und Berlin (jährlich) veröffentlichen ihre Radzählungen nicht live — dort gibt es die Ebene nicht. |

### Rad-Dauerzählstellen — Fahrräder, live

| | |
|---|---|
| **Steht für** | Die automatischen Zählstellen der Stadt für den Radverkehr — im Gebiet 35, etwa auf der Albert- und der Waldschlößchenbrücke und am Elberadweg. |
| **Wie erhoben** | Messschwellen oder Sensoren im Radweg zählen jedes Rad und seine Richtung und melden die Summe jeder Stunde. |
| **Aktualisierung** | Stündlich, wenige Minuten nach der vollen Stunde. |
| **Hier genutzt für** | Die Datenebene *Radverkehr (live)*: Der Browser fragt die Zählwerte beim Einschalten und dann alle fünf Minuten direkt bei der Stadt ab. Je Zählstelle stehen zwei Glassäulen beidseits der Straße, eine je Richtung (türkis, lila), so hoch wie die Wurzel der Räder der letzten Stunde, mit Lichtringen, die umso schneller aufsteigen, je mehr Räder fuhren; meldet eine Zählstelle seit drei Stunden nichts, wird sie grau. In der Seitenleiste stehen die Zahlen, ein Klick fliegt hin. |
| **Stärken** | Aktuell, gemessen, je Richtung. |
| **Schwächen** | Nur wenige Punkte; zeigt nicht, wo dazwischen gefahren wird. Ist der Dienst der Stadt nicht erreichbar, bleiben die letzten Werte stehen. |
| **Download und Lizenz** | Derselbe WFS, Ebene `cls:L1781` („aktuelle Zählwerte“; die ganze Stundenreihe seit 2017 ist `cls:L1780`). Lizenz `dl-de/by-2-0`, Vermerk „Landeshauptstadt Dresden“. |

### GTFS-Fahrplan — die Straßenbahnen

| | |
|---|---|
| **Steht für** | *General Transit Feed Specification*, das verbreitete Austauschformat für Fahrpläne: Linien, Haltestellen, Fahrten und ihre Zeiten. |
| **Wie erhoben** | Die Verkehrsunternehmen planen ihre Fahrten; DELFI e.V. sammelt die Fahrpläne aller Verbünde Deutschlands (im NeTEx-Format), gtfs.de wandelt sie wöchentlich nach GTFS. |
| **Aktualisierung** | Wöchentlich, jeweils etwa einen Monat voraus. |
| **Hier genutzt für** | Die Datenebene *Straßenbahnen (Fahrplan)*: jede Straßenbahnfahrt im Gebiet (die der Dresdner DVB — an einem Werktag rund 2 600 —, der Leipziger LVB, der Münchner MVG), auf die Gleise aus OpenStreetMap gelegt (der Fahrplan kennt keine Streckenverläufe, nur die Haltestellen). Zur Szenenzeit, die von der eingestellten Uhrzeit an in Echtzeit weiterläuft, fährt jede Bahn als Wagen in den Farben ihres Betreibers und in einer der Längen seiner Flotte (in Dresden gelb, in Leipzig silbergrau mit gelbem Dachband, in München blau und weiß) mit einer Lichtspur dahinter, hält an ihren Haltestellen und fährt über die Brücken. Der Viewer unterscheidet Werktag, Samstag und Sonntag; ein Feiertag fährt wie sein Wochentag. |
| **Stärken** | Vollständig: jede geplante Fahrt jeder Linie. |
| **Schwächen** | Nicht live — Verspätungen, Umleitungen und Ausfälle zeigt er nicht. An wenigen Stellen liegt der Weg zwischen zwei Haltestellen auf dem falschen von zwei Gleisen. |
| **Download und Lizenz** | `nv_free` von [gtfs.de](https://gtfs.de/de/feeds/de_nv/) (ganz Deutschland, etwa 290 MB, nicht eingecheckt); eingecheckt ist nur der Auszug für jedes Gebiet, `data/<site>/transit/trams.json`, mit den Betreibern der Linien aus der `agency.txt` des Feeds. Lizenz *CC BY 4.0*, Vermerk „DELFI e.V. via gtfs.de“; die Gleise „© OpenStreetMap-Mitwirkende“. |

## Verwendete Datenstände

Der genaue Stand zählt, wenn das Bild der Wirklichkeit widerspricht. Das
GeoSN veröffentlicht zu jeder Kachel und jedem Produkt ein Feld „Stand“
über den Download-Dienst hinter seinem Portal; die Werte unten wurden dort
am 2026-09-22 abgelesen und stimmen mit den Metadatendateien in den
Kachel-ZIPs überein. Die maschinenlesbare Fassung mit dem Download-Link
jeder Datei ist [`data/dresden/provenance.json`](../../../data/dresden/provenance.json).
Die Stände unten sind die Dresdens; die eines anderen Orts liest man beim
Laden seiner Daten aus demselben Dienst ab.
„Eingecheckt“ ist das Datum, an dem die Datei ins Repository kam; der
Download fand an diesem Tag oder kurz davor statt.

| Datensatz | Kacheln | Stand / Erfassungsdatum (Feld „Stand“ des Anbieters) | Woher bekannt | Eingecheckt |
|---|---|---|---|---|
| DGM1 | alle fünfzehn | **2024-11-30**; die nördliche Reihe (5658) **2024-11-27 und 2024-11-30** | die `_akt.csv` in jeder Kachel-ZIP; GeoSN-Download-Dienst | 2026-06-11; die elf Kacheln im Süden, Osten und Westen 2026-09-25 |
| DOM1 | alle fünfzehn | **dieselbe Laserbefliegung** wie das DGM1: 2024-11-30 bzw. 2024-11-27 und 2024-11-30 | GeoSN-Download-Dienst (DOM1, DGM1 und Punktwolke tragen identische Daten) | abgeleitete Kronen-Dateien 2026-06-12; die elf neuen Kacheln 2026-09-25 |
| LoD2 | alle fünfzehn | die westliche Spalte (33408_*) und 33410_5656/5658: Modell **2023**, gebaut aus dem Laserscan 2016, den Basis-DLM-Grundrissen 2021 und dem DGM 2016; 33412_5656/5658 und 33414_5656/5658: Modell **2024**, aus dem Laserscan 2016, dem Basis-DLM 2022 und dem DGM 2016; die südliche Reihe (5654) und 33416_5656: Modell **2023**, Grundrisse aus dem Basis-DLM 2020–2024; 33416_5658 (Wald, ein Gebäude): Modell **2021**. Exportiert wurden die Objekte 2025-04-26 … 2025-07-07 (`creationDate`) | GeoSN-Download-Dienst; einige ältere Objekte tragen noch `Stand_*`-Attribute mit denselben Werten | 2026-06-11; die elf neuen Kacheln 2026-09-25 |
| DOP (RGBI) | alle fünfzehn | beflogen am **2024-03-19** (ohne Laub) | GeoSN-Download-Dienst | abgeleitete Dachfarben und NDVI 2026-06-16/17; die elf neuen Kacheln 2026-09-25 |
| Basis-DLM | landesweites Paket | das am **2026-10-20** freigegebene Paket (`basisdlm_akt.csv` und das Paket in der ZIP tragen dieses Datum) | die Metadaten in der ZIP; `data/dresden/provenance.json` | alle abgeleiteten Dateien neu gebacken am 2026-11-01 |
| OSM über BBBike | der Stadtauszug Dresden | der Auszug vom **2026-10-31** (`Last-Modified` 16:49 UTC), alle OSM-Ebenen aller fünfzehn Kacheln; nur die Hecken und die kleinen Bauten aus dem Laserscan stammen noch aus den Auszügen vom 2026-09-19/23, weil ihr Neubacken den Laserscan braucht, den das GeoSN derzeit nicht ausliefert | `Last-Modified` der Datei; `data/dresden/provenance.json` | 2026-11-01 |
| Verkehrsmengen | alle fünfzehn | Zählungen von 2010 bis 2026, meist 2023–2026, abgefragt am **2026-10-01** | WFS der Stadt; `data/dresden/provenance.json` | 2026-10-01 |
| Rad-Dauerzählstellen | — | live, beim Einschalten der Ebene und alle fünf Minuten | WFS der Stadt | nicht eingecheckt |
| GTFS-Fahrplan | das ganze Gebiet | der Feed vom **2026-09-26**; die Tage 2026-10-01 (Werktag), 2026-10-10 (Samstag), 2026-10-04 (Sonntag) | `Last-Modified` der Datei; `data/dresden/transit/trams.json` | 2026-10-01 |
| Mapillary-Objekte (Straßenlampen) | Dresden (fünfzehn Kacheln), Grimma (zwei), Meißen (eine), Unna (zwei) | Erkennungen, zuletzt gesehen 2020 – 2026 | `last_seen_at` jedes Objekts, Ort und Zeit jedes Fotos; der Zwischenspeicher unter `data/_raw/<provider>/mapillary/<tile>.v2.json`, neu abgerufen am 2026-11-01 | 2026-11-01 |
| Mapillary-Rundumfotos (Fassadenbild, Schaufenster) | Dresden (fünfzehn Kacheln), Leipzig, München, Hamburg (je vier), Grimma (zwei), Meißen (eine); Unna hat keine | aufgenommen 2017 – 2026: Dresden meist 2025, Leipzig 2023 – 2025, München 2021 – 2026, meist 2026, Hamburg 2025, Grimma 2024 – 2026, Meißen 2026 | `captured_at` jedes Bildes; die Messwerte unter `data/_raw/<provider>/mapillary/facades/` (die Fotos werden nicht behalten) | 2026-10-08 (Dresden), 2026-10-09 |
| Copernicus DEM GLO-30 | jede Stadt: ihre Kacheln und 10 km darum | das Modell, wie seine öffentliche Cloud-Kopie es am Abruftag bereitstellt (© DLR e.V. 2010-2014, © Airbus Defence and Space GmbH 2014-2018) | der Ausschnitt im Zwischenspeicher `data/_raw/glo30/<site>.tif`, abgerufen am 2026-10-21 | nicht eingecheckt (nur Himmelslicht und Horizont, die daraus gebacken sind) |
| DWD-Phänologie | die Beobachter im Umkreis von 30 km jeder Stadt | die Jahre 2010–2023 | die Jahreszeiten-Tabelle des Viewers | als Teil des Codes |

Beachte die **unterschiedlichen Stände in einem Bild**: Boden und Baumhöhen
stammen von Ende 2024, die Gebäudeformen aus einem Laserscan von 2016 mit
Grundrissen von 2021/2022, die Dachfarben vom März 2024 und Lampen und
Mauern aus OpenStreetMap von Ende Oktober 2026. Ein 2023 fertiggestelltes Haus
kann eine Dachfarbe von 2024 und keine 3D-Form haben.

Die anderen Orte wurden am 2026-11-01 ebenso neu gebacken: Leipzig und
Grimma aus BBBikes Leipzig-Auszug, Meißen aus dessen Dresden-Auszug,
Hamburg und München aus ihren eigenen (alle vom 2026-10-31), Unna aus dem
Arnsberg-Auszug von openstreetmap.fr (2026-11-01); die sächsischen Orte
aus dem Basis-DLM vom 2026-10-20, Unna aus dem Nordrhein-Westfalens vom
2026-10-20 und München aus dem Bayerns vom 2026-07-03. Das `provenance.json`
jedes Orts hält es fest.

## Woher genau jede Datei stammt

Das GeoSN liefert jede Kachel-ZIP aus öffentlichen Ordnern auf seinem
Cloud-Share; die Download-App des Portals findet sie über einen
Kartendienst, der auch den „Stand“ jeder Kachel führt. Die Ordner sind je
Produkt und Format:

| Produkt | Paket | Portalseite |
|---|---|---|
| DGM1 (GeoTIFF + `.tfw` + `_akt.csv`) | `…/JCcXyifaNdLDnxZ/dgm1_<Kachel>_tiff.zip` | [Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html) |
| DOM1 (GeoTIFF) | `…/S6wwnFwX7882sZm/dom1_<Kachel>_tiff.zip` | dieselbe Seite |
| Laserscan-Punktwolke (LAZ) | `…/EpkzyJHScGb5ndd/lsc_<Kachel>_laz.zip` | dieselbe Seite |
| LoD2 (CityGML) | `…/GVzwbSyp7Yl7mBD/lod2_<Kachel>_citygml.zip` | [Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html) |
| DOP20 RGBI (GeoTIFF) | `…/sX3GPcdBMGrfXT9/dop20rgbi_<Kachel>_tiff.zip` | [DOP](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html) |
| Basis-DLM (Shape, landesweit, 1,23 GB) | `…/DtPWngtLEJP8K3k/basisdlm_sn_shape.zip` | [Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html) |

`…` steht für `https://geocloud.landesvermessung.sachsen.de/public.php/dav/files/`.
Die Ordner-Tokens können wechseln; der in
[data-pipeline.md](../../data-pipeline.md#provenance) (englisch)
beschriebene Download-Dienst nennt zu jeder Kachel den „Stand“, die
Batch-Download-Seite des GeoSN die aktuellen Tokens. `bun run fetch dresden` liest
die Tokens von dieser Seite und holt jedes Produkt jeder Kachel —
Gelände, Oberflächenmodell, Gebäudemodell (unterwegs nach CityJSON
umgewandelt), Luftbild — sowie das landesweite Basis-DLM-Paket und den
OpenStreetMap-Auszug. Dresdens Gelände- und Gebäudemodelle sind so
eingecheckt, wie sie zuerst geladen wurden. OpenStreetMap-Daten kommen
jetzt nur noch aus dem Geofabrik-Auszug für Sachsen
(`sachsen-latest.osm.pbf`); die eingecheckten Lampen-, Bahnsteig- und
Brückentragwerk-Dateien stammen noch aus früheren Abfragen über die
Overpass-API.

## Lizenzen und Quellenvermerke

| Quelle | Lizenz | Erforderlicher Vermerk |
|---|---|---|
| GeoSN-Datensätze (DGM1, DOM1, LoD2, Basis-DLM, DOP) | *Datenlizenz Deutschland – Namensnennung – Version 2.0* (`dl-de/by-2-0`), laut den [Nutzungsbedingungen](https://www.landesvermessung.sachsen.de/allgemeine-nutzungsbedingungen-8954.html) des GeoSN (geprüft am 2026-09-22) | „Quelle: GeoSN, dl-de/by-2-0“ |
| Geobasis NRW (Unna; auch sein Laserscan) | *Datenlizenz Deutschland – Zero – Version 2.0* (`dl-de/zero-2-0`): kein Vermerk nötig | trotzdem: „Geobasis NRW, dl-de/zero-2-0“ |
| Bayerische Vermessungsverwaltung (München; auch ihre Laserpunkte) | *CC BY 4.0* | „Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0“ |
| LGV Hamburg | `dl-de/by-2-0` | „Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), dl-de/by-2-0“ |
| Geoportal Berlin | `dl-de/zero-2-0`: kein Vermerk nötig | trotzdem: „Geoportal Berlin, dl-de/zero-2-0“ |
| OpenStreetMap | *Open Database License* (ODbL) | „© OpenStreetMap-Mitwirkende“ |
| Wikidata | *CC0* (gemeinfrei) | keiner erforderlich |
| Wikimedia Commons (die Fotos, nach denen die Wandbilder gezeichnet sind) | die eigene freie Lizenz jedes Fotos (CC BY, CC BY-SA …), mit dem Urheber aus Commons gelesen; die Zeichnung steht unter derselben | je Foto: „Wandbild „…“: gezeichnet nach Foto *Urheber*, *Lizenz*, Wikimedia Commons“ |
| Copernicus DEM GLO-30 (das Land jenseits der Kacheln) | *Licence for the use of the Copernicus WorldDEM-30*: kostenlos für jede Nutzung; ein verändertes Produkt trägt den Vermerk, sein Impressum den Haftungssatz | „Gelände im Umland: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved“; dazu: „Die nach Gesetz oder im Auftrag für das Copernicus-Programm zuständigen Organisationen haften nicht für jegliche Nutzung des Copernicus WorldDEM-30.“ |
| DWD-Phänologie (die Beobachtungen der Jahresmelder an Wildpflanzen, 2010–2023) | `dl-de/by-2-0` | „Quelle: Deutscher Wetterdienst“ |
| Stadtbaumkataster | `dl-de/by-2-0` | „Landeshauptstadt Dresden“ |
| Straßenbaumkataster Hamburg | `dl-de/by-2-0` | „Freie und Hansestadt Hamburg (BUKEA)“ |
| Baumkataster Leipzig | `dl-de/by-2-0` | „Stadt Leipzig, Amt für Stadtgrün und Gewässer“ |
| Baumbestand Berlin | `dl-de/zero-2-0`: kein Vermerk nötig | trotzdem: „Geoportal Berlin“ |
| Verkehrsmengen, Rad-Dauerzählstellen | `dl-de/by-2-0` | „Landeshauptstadt Dresden“ |
| Tagesgang (Kfz-Zählstellen Hamburg) | `dl-de/by-2-0` | „Freie und Hansestadt Hamburg“ |
| Verkehrsmengen Hamburg, Radzählnetz Hamburg | `dl-de/by-2-0` | „Freie und Hansestadt Hamburg“ |
| Verkehrsmengen Berlin | `dl-de/zero-2-0`: kein Vermerk nötig | trotzdem: „SenMVKU Berlin“ |
| Straßenverkehrszählung Sachsen | `dl-de/by-2-0` | „Freistaat Sachsen, LASuV“ |
| Verkehrswerte NRW | `dl-de/by-2-0` | „Straßen.NRW“ |
| GTFS-Fahrplan | *CC BY 4.0* | „DELFI e.V. via gtfs.de“ |
| Mapillary (erkannte Straßenlampen, Fassadenbild, Schaufenster, Fensterrhythmus) | *CC BY-SA 4.0* | „Mapillary“ — in einer eigenen Datei, getrennt von den OpenStreetMap-Daten |

Der Viewer zeigt den Vermerk des Anbieters des Orts, den OSM-Vermerk, den
Copernicus-Vermerk und, wo es eines gibt, den des städtischen Baumkatasters
in der Fußzeile seines Einstellungsfelds (und den von Mapillary und der
Datenebenen, wo die Stadt sie nutzt, und den jedes Wandbild-Fotos); die gebackenen Himmelslicht- und
Horizontdateien tragen den Copernicus-Vermerk zusätzlich in sich. Die
Beobachtungen des Wetterdienstes erreichen den Viewer nur als Tabelle
weniger Tage Verschiebung je Stadt, deshalb steht sein Vermerk hier.
Die abgeleiteten Lampen- und Mauerdateien tragen den OSM-Vermerk zusätzlich
in der Datei selbst; die Denkmaldatei trägt die Vermerke von GeoSN und OSM,
weil sie beide Quellen verbindet, und die Stadtbaumdatei den der Stadt
und, für die aus OpenStreetMap ergänzten Bäume, den von OSM.
