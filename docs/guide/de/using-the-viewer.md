# Bedienung

*English: [Using the viewer](../en/using-the-viewer.md)*

Diese Seite geht das Einstellungsfeld Beschriftung für Beschriftung
durch. Du brauchst einen Browser mit **WebGL2** (jeder aktuelle Desktop-
und Mobilbrowser hat es) und für ein flüssiges Bild eine halbwegs aktuelle
Grafikkarte. Handys werden unterstützt: Sie bekommen automatisch ein
leichteres Render-Budget.

## Laden

Der Ladebildschirm listet fünf Stufen und einen Balken. Die ersten drei
(Gebäude, Gelände, Licht) enden an der Marke *begehbar*: Ab da löst sich
der Vorhang auf, und du kannst dich bewegen, während die übrigen zwei
(die Umgebung im Blick, dann Bäume, Lampen, Schienen und Mauern) hinter
einer kleinen Pille oben im Bild nachladen. *Alles geladen* heißt, alles
in deinem Blick ist da – nicht die ganze Stadt. Danach lädt der Viewer
weiter, während du dich bewegst: Die Stadt wird Kachel für Kachel
gestreamt, in deiner Nähe detailliert, weiter weg grob. Dauert das einen
Moment, etwa bei einem langen Flug, zeigt ein kleiner Hinweis *Umgebung
lädt* oben im Bild (siehe
[Wie ein Besuch abläuft](./how-it-works.md#wie-ein-besuch-abläuft)).

## Bewegen

| Eingabe (Desktop) | Wirkung |
|---|---|
| Mit der Maus ziehen | umsehen |
| `W` `A` `S` `D` | gehen (oder fliegen) |
| `Shift` | sprinten |
| `F` | zwischen Gehen und Fliegen wechseln |
| `Leertaste` / `Shift` (oder `E` / `Q`) | hoch / runter im Flug |
| `1` – `9` | zum ersten bis neunten Aussichtspunkt gleiten |
| Mausrad | zoomen (Blickwinkel enger oder weiter) |
| Doppelklick auf den Boden | in einem kurzen Gleitflug dorthin |
| Klick auf die Minikarte | dorthin teleportieren |
| *Standort* (Werkzeugleiste unten rechts) | zu deinem echten Standort teleportieren |
| `R` | Gebäude unter dem Fadenkreuz abreißen |
| `Esc` | immersiven Modus verlassen |

| Eingabe (Touch) | Wirkung |
|---|---|
| Ziehen | umsehen |
| Joystick (unten links) | gehen |
| *Standort* (Werkzeugleiste unten rechts) | zu deinem echten Standort teleportieren, Blick in die Richtung, in die das Telefon zeigt |
| *Live* (Werkzeugleiste, nur mit Kompass) | Blick und Position folgen dir und deinem Telefon, bis du es ausschaltest, ziehst oder den Joystick nimmst |
| *Fliegen* (Werkzeugleiste) | zwischen Gehen und Fliegen wechseln |
| ⌄ unter der Werkzeugleiste | die Leiste zu einem Knopf einklappen (⋮ klappt sie wieder auf) |
| Höhenregler (unten rechts, nur im Flug) | nach oben schieben steigt, nach unten sinkt; loslassen hält die Höhe |
| Doppeltippen auf den Boden | dorthin |
| Zwei Finger zusammenziehen | zoomen |

Beim Gehen bleibst du in Augenhöhe auf dem Gelände und stößt an Gebäuden
und Mauern an. Beim Fliegen gibt es keine Kollision; nur sinken kannst du
nicht tiefer als bis auf Augenhöhe über dem Boden. Jede Eingabe bricht
einen laufenden Gleitflug ab.

Unten rechts liegt die **Werkzeugleiste**; jeder Knopf trägt seinen Namen
unter dem Symbol. Mit dem ⌄ darunter klappst du sie zu einem kleinen Knopf
ein, der Browser merkt sich das; ein grüner Punkt darauf zeigt, dass *Live*
noch läuft.

*Standort* fragt den Browser nach
deinem Standort und setzt dich dort auf Augenhöhe ab, zu Fuß. Auf einem
Telefon mit Kompass schaust du danach in die Richtung, in die die Rückseite
des Telefons zeigt (liegt es flach, die Oberkante); ohne Kompass bleibt die
Blickrichtung, wie sie war. Die Genauigkeit meldet eine kurze Zeile oben —
GPS liegt in der Stadt oft 5–20 m daneben, ein Handykompass einige Grad.
Stehst du außerhalb des Gebiets, sagt dieselbe Zeile, wie weit, und du
bleibst, wo du bist. Browser fragen dafür um Erlaubnis (iPhones auch für den
Kompass); der Standort verlässt das Gerät nicht — es gibt keinen Server,
dem er geschickt würde.

*Live* erscheint, sobald dein Telefon Kompasswerte liefert (auf dem iPhone
fragt es beim ersten Antippen um Erlaubnis; am Rechner ohne Kompass gibt es
den Knopf nicht). Eingeschaltet wird die Stadt zum Fenster, das du vor dich
hältst: Drehst du dich, dreht sich der Blick mit; kippst du das Telefon,
schaust du hoch oder runter. Und gehst du los, geht die Kamera mit — sie
folgt deiner GPS-Position, sanft geglättet, damit die Streuung der Ortung
nicht ruckelt. Stehst du außerhalb des Gebiets oder gibt es keinen
Standort, folgt nur der Blick. Ein zweites Antippen, Ziehen zum Umsehen
oder der Joystick geben dir die Steuerung zurück.

Eine schwebende Leiste zeigt die vier wichtigsten Bedienungen, bis du sie
mit *Verstanden* ausblendest; die vollständige Tabelle bleibt im Feld unter
*Steuerung* erreichbar.

## Das Feld

Der Knopf in der Ecke öffnet ein Feld mit drei Reitern.

### Erkunden

- **Minikarte** — das ganze Gebiet von oben, mit den Landnutzungsfarben
  und den Grundrissen der gerade geladenen Gebäude. Deine Position und
  Blickrichtung sind eingezeichnet; ein Klick teleportiert.
- **Gehen / Fliegen** — der Bewegungsmodus.
- **Aussichtspunkte** — handverlesene Standpunkte, zu denen die Kamera
  gleitet (am Rechner auch mit den Tasten `1` – `9`):
  - *aus der Luft*: *Altstadt-Silhouette* (der Startblick, tief über der
    Elbe), Draufsichten auf *Frauenkirche*, *Brühlsche Terrasse*,
    *Albertplatz*, *Alaunpark* und *Zwinger & Semperoper*, ein tiefer Flug
    über die *Äußere Neustadt*, dazu *Carolabrücke* (über dem Fluss),
    *Elbe-Panorama* (hoch über der Flussbiegung) und *Über den Dächern*
    (ein tiefer Gleitflug über die Altstadtdächer);
  - *auf Augenhöhe*: *Canaletto-Blick* (auf der Elbwiese, die Altstadt
    jenseits des Grases), *Elbufer* (am baumbestandenen Neustädter Ufer),
    *Am Japanischen Palais* (auf der Neustädter Elbwiese, wo Canaletto
    malte) und *Neumarkt* (vor der Frauenkirche).

  Der Große Garten liegt knapp südlich des Gebiets und hat deshalb noch
  keinen Aussichtspunkt. Die letzte Karte, *Aktuelle Sicht merken*, merkt
  sich, wo du stehst; sie wird dann zu *Gemerkte Sicht*, die dorthin
  zurückspringt, mit einem ✕ zum Vergessen.
- **Steuerung** — die vollständige Tastentabelle.

### Szene

- **Sonne & Zeit** — eine Datumsauswahl und ein Tageszeit-Regler. Das
  Farbband des Reglers markiert den echten Sonnenauf- und -untergang
  dieses Tages. Der Sonnenstand wird für Dresden für den gewählten
  Zeitpunkt berechnet; Schatten, Himmel, Nebelfarben und das Abendlicht in
  den Gebäuden folgen ihm. *Standardzeit* springt zurück auf 14:00, die
  Uhrzeit, auf die der Standard-Look abgestimmt ist.
- **Darstellung** — Regler in vier aufklappbaren Gruppen. Jeder Regler ist
  eine Prozentzahl; die Voreinstellungen sind der abgestimmte Look.

| Gruppe | Regler | Was er tut |
|---|---|---|
| Atmosphäre | *Nebel* | Entfernungsdunst |
| | *Talnebel* | zusätzlicher Dunst, der sich im tiefen Gelände am Fluss sammelt; liest die echte Geländehöhe |
| | *Flussnebel* | treibende Nebelschicht über dem Wasser |
| | *Tiefenfärbung* | warm nah, kühl fern: eine tiefenabhängige Farbgebung |
| Gebäude | *Transparenz* | durch Gebäude hindurchsehen (gerastert), bis 90 % |
| | *Boden-Verlauf* | Abdunkeln der Wände zum Boden hin |
| | *Höhenlinien* | zarte Geschossbänder, aus der gemessenen Höhe abgeleitet |
| | *Streiflicht* | Kantenlicht an sonnenabgewandten Kanten |
| | *Farbvariation* | Wandton je Gebäude aus Nutzung und Höhe |
| | *Dachfarbe* | wie stark die echte (oder synthetische) Dachfarbe durchkommt |
| | *Dachsättigung* | hebt die Sättigung der Luftbild-Dachfarben, ohne den Farbton zu verschieben; 0 = rohes Luftbild |
| | *Traufkante* | eine weiche Linie, wo Wand auf Dach trifft |
| | *Abendlicht* | warme Fenster in Läden und öffentlichen Bauten in der Dämmerung |
| | *Materialstreuung* | Variation zwischen matt und seidig je Gebäude |
| Vegetation | *Wiesenfärbung* | färbt Wiesen saftig bis trocken aus dem Infrarot-Luftbild |
| | *Gegenlicht-Schimmer* | Gegenlichtschimmer auf Kronen zwischen dir und der Sonne |
| | *Blattdurchscheinen* | Durchleuchtung naher, großer Kronen (schattenabhängig) |
| | *Blattflimmern* | Böen drehen Blätter auf sonnigen Kronen auf die helle Unterseite |
| | *Windhelligkeit* | Kronen hellen auf, wenn sie sich in eine Böe neigen |
| Rendering | *Kontaktschatten* | Umgebungsverdunkelung in Ecken und unter Traufen |
| | *Papierkorn* | das Papierkorn über dem ganzen Bild |
| | *Tiefenschärfe* (Schalter) | fotografische Tiefenschärfe; *Auto* fokussiert auf das Fadenkreuz, *Manuell* auf eine feste Entfernung |
| | *Detaillierte Kronen* (Schalter) | reiche Mehrbüschel-Kronen nahe der Kamera; aus = die einfache Krone überall |

Solange sich die Kamera bewegt, ist die Tiefenschärfe-Unschärfe
abgeschaltet (das Auge kann sie in Bewegung nicht auflösen) und kommt
zurück, sobald du stehst.

### Erweitert

- **Werkzeuge** — *Gebäude unter dem Fadenkreuz abreißen* entfernt das
  Gebäude, das du anschaust (wie `R`), auf jeder Kachel im Blick; das
  lässt sich nicht rückgängig machen. *Immersiver Modus* fängt den
  Mauszeiger für ein Ego-Perspektive-Gefühl ein; `Esc` verlässt ihn.
- **Snapshot** — *Kopieren* kopiert deine genaue Position, Datum und Uhrzeit
  und jeden Regler als kleinen JSON-Text; einen solchen Text in das Feld
  einfügen und *Anwenden* drücken stellt ihn wieder her. So wird eine
  bestimmte Ansicht geteilt oder für einen Screenshot reproduziert. Ein
  fehlerhafter Snapshot wird mit einer Meldung abgelehnt, statt die Szene
  zu zerstören.
- **Statistik** — Anzahl der Gebäude und Geländepunkte, die gerade im
  Blick sind, geschätzter Grafikspeicher und die Bildrate.

Die Fußzeile nennt die Datenquellen: die sächsische Landesvermessung für
die amtlichen Datensätze und die OpenStreetMap-Mitwirkenden für Lampen,
Mauern, Bahnsteige und Brückentragwerke. Daneben führt *Unterstützen* zur
Ko-fi-Seite des Projekts; es ist ein einfacher Link, der erst beim Klick
etwas von Ko-fi lädt.

## Tipps

- Beurteile das Bild aus **schrägen Blickwinkeln**, nicht senkrecht von
  oben; so prüfen es auch die Betreiber.
- Goldene Stunde (Sonne wenige Grad über dem Horizont) und blaue Stunde
  (wenige Grad darunter) geben die reichsten Farben; probiere 07:00 oder
  20:00 im Sommer.
- Auf einem Laptop ohne eigene Grafikkarte senke *Kontaktschatten* und
  schalte *Tiefenschärfe* aus, um mehr Bilder pro Sekunde zu bekommen.
- `?scene=lite` in der Adresszeile streamt nur die Startkachel, mit
  groben Schatten. Das ist für automatische Tests gedacht und nicht, wie
  die Szene aussehen soll.
