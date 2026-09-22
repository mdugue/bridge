# Bedienung

*English: [Using the viewer](../en/using-the-viewer.md)*

Diese Seite geht das Einstellungsfeld Beschriftung für Beschriftung
durch. Du brauchst einen Browser mit **WebGL2** (jeder aktuelle Desktop-
und Mobilbrowser hat es) und für ein flüssiges Bild eine halbwegs aktuelle
Grafikkarte. Handys werden unterstützt: Sie bekommen automatisch ein
leichteres Render-Budget.

## Laden

Der Ladebildschirm listet sechs Stufen und einen Balken. Die ersten drei
(Gebäude, Gelände, Licht) enden an der Marke *begehbar*: Ab da löst sich
der Vorhang auf, und du kannst dich bewegen, während die übrigen Stufen
(Bäume und Lampen, Nachbarkacheln, Schienen und Mauern) hinter einer
kleinen Pille in der Ecke nachladen. *Alles geladen* heißt, alles ist da.

## Bewegen

| Eingabe (Desktop) | Wirkung |
|---|---|
| Mit der Maus ziehen | umsehen |
| `W` `A` `S` `D` | gehen (oder fliegen) |
| `Shift` | sprinten |
| `F` | zwischen Gehen und Fliegen wechseln |
| `Leertaste` / `Shift` | hoch / runter im Flug |
| Mausrad | zoomen (Blickwinkel enger oder weiter) |
| Doppelklick auf den Boden | in einem kurzen Gleitflug dorthin |
| Klick auf die Minikarte | dorthin teleportieren |
| `R` | Gebäude unter dem Fadenkreuz abreißen |
| `Esc` | immersiven Modus verlassen |

| Eingabe (Touch) | Wirkung |
|---|---|
| Ziehen | umsehen |
| Joystick (unten links) | gehen |
| Doppeltippen auf den Boden | dorthin |
| Zwei Finger zusammenziehen | zoomen |

Beim Gehen bleibst du in Augenhöhe auf dem Gelände und stößt an Gebäuden
und Mauern an. Beim Fliegen gibt es keine Kollision. Jede Eingabe bricht
einen laufenden Gleitflug ab.

Eine schwebende Leiste zeigt die vier wichtigsten Bedienungen, bis du sie
mit *Verstanden* ausblendest; die vollständige Tabelle bleibt im Feld unter
*Steuerung* erreichbar.

## Das Feld

Der Knopf in der Ecke öffnet ein Feld mit drei Reitern.

### Erkunden

- **Minikarte** — der Kachelblock von oben, mit den Landnutzungsfarben und
  den Gebäudegrundrissen. Deine Position und Blickrichtung sind
  eingezeichnet; ein Klick teleportiert.
- **Gehen / Fliegen** — der Bewegungsmodus.
- **Aussichtspunkte** — fünf handverlesene Standpunkte, zu denen die Kamera
  gleitet: *Carolabrücke* (über dem Fluss), *Elbe-Panorama* (hoch über der
  Flussbiegung), *Über den Dächern* (ein tiefer Gleitflug über die
  Altstadtdächer), *Canaletto-Blick* (zu Fuß auf der Elbwiese, die Altstadt
  jenseits des Grases) und *Elbufer* (ein Spaziergang am baumbestandenen
  Neustädter Ufer). Die sechste Karte, *Aktuelle Sicht merken*, merkt sich,
  wo du stehst; sie wird dann zu *Gemerkte Sicht*, die dorthin zurückspringt,
  mit einem ✕ zum Vergessen.
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
  Gebäude, das du anschaust (wie `R`); das geht nur auf der Startkachel und
  lässt sich nicht rückgängig machen. *Immersiver Modus* fängt den
  Mauszeiger für ein Ego-Perspektive-Gefühl ein; `Esc` verlässt ihn.
- **Snapshot** — *Kopieren* kopiert deine genaue Position, Datum und Uhrzeit
  und jeden Regler als kleinen JSON-Text; einen solchen Text in das Feld
  einfügen und *Anwenden* drücken stellt ihn wieder her. So wird eine
  bestimmte Ansicht geteilt oder für einen Screenshot reproduziert. Ein
  fehlerhafter Snapshot wird mit einer Meldung abgelehnt, statt die Szene
  zu zerstören.
- **Statistik** — Anzahl der Gebäude, Geländepunkte, geschätzter
  Grafikspeicher und die Bildrate.

Die Fußzeile nennt die Datenquellen: die sächsische Landesvermessung für
die amtlichen Datensätze und die OpenStreetMap-Mitwirkenden für Lampen,
Mauern, Bahnsteige und Brückentragwerke.

## Tipps

- Beurteile das Bild aus **schrägen Blickwinkeln**, nicht senkrecht von
  oben; so prüfen es auch die Betreiber.
- Goldene Stunde (Sonne wenige Grad über dem Horizont) und blaue Stunde
  (wenige Grad darunter) geben die reichsten Farben; probiere 07:00 oder
  20:00 im Sommer.
- Auf einem Laptop ohne eigene Grafikkarte senke *Kontaktschatten* und
  schalte *Tiefenschärfe* aus, um mehr Bilder pro Sekunde zu bekommen.
- `?scene=lite` in der Adresszeile lädt nur die Startkachel mit groben
  Schatten. Das ist für automatische Tests gedacht und nicht, wie die
  Szene aussehen soll.
