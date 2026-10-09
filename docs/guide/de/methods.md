# Wie der Viewer zu einer Angabe kommt

*English: [How the viewer comes by what it shows](../en/methods.md)*

Alles im Viewer stammt aus offenen Daten, aber nicht alles steht so in den
Daten. Manches wird unverändert übernommen, manches mit einer Formel
ausgerechnet, manches erst durch Mustererkennung gefunden, und manches
nimmt der Viewer an, weil für dieses Ding gar nichts vorliegt. Diese Seite
erklärt die vier Abzeichen, mit denen der Viewer das kennzeichnet: in der
Detailansicht eines Gebäudes, Baums oder einer Brücke (unter *Daten*) und
hier im Wissensbereich.

## Die vier Abzeichen

| Abzeichen | Bedeutung | Beispiel |
|---|---|---|
| `❝ übernommen` | Steht so in der Quelle und wird unverändert gezeigt. | Grundriss und Traufhöhe aus dem 3D-Gebäudemodell, die Baumart aus dem Baumkataster, eine Adresse aus OpenStreetMap |
| `= berechnet` | Mit einer festen Formel aus Messwerten. Gleiche Daten ergeben immer dasselbe Ergebnis. | Die Höhe einer Baumkrone als Oberfläche minus Gelände, das Grün einer Wiese aus dem Infrarotkanal des Luftbilds, die Dachfarbe als Mittelwert der Dachpixel |
| `◎ erkannt` | Durch Mustererkennung: Schwellenwerte, der Abgleich zweier Quellen oder Bildanalyse. Kann sich irren. | Ein Baum, wo die Oberfläche eine Kronenspitze zeigt; ein Schuppen, den der Laserscan sieht; ein Laden, dessen Punkt einem Gebäude zugeordnet wird |
| `≈ angenommen` | Für dieses Ding liegt nichts vor: eine Vorgabe, ein Durchschnitt oder eine Gestaltung. | Die Form einer Baumkrone, Backstein oder Putz wie in der Nachbarschaft, der Verkehr zur Uhrzeit nach dem typischen Tagesgang |

Die ersten beiden sind **deterministisch** und haben einen durchgezogenen
Rand: Wer dieselben Daten nimmt, kommt zum selben Ergebnis, und das
Ergebnis ist so gut wie die Messung. Die letzten beiden sind
**erschlossen** und haben einen gestrichelten Rand: Hier hat jemand (eine
Regel, ein Abgleich, eine Gestaltungsentscheidung) etwas hinzugefügt, das
nicht gemessen ist. Das Zeichen vor dem Wort (❝, =, ◎, ≈) unterscheidet die
vier auch ohne Farbe.

In der Detailansicht stehen die Abzeichen an jeder Zeile unter *Daten*. Bei
den Angaben oben in der Karte (Höhe, Dach, Erdgeschoss …) steht nur dann
ein kleines ◎ oder ≈ hinter dem Wert, wenn er erschlossen ist; was ohne
Zeichen dasteht, ist übernommen oder berechnet.

## Was Mustererkennung hier heißt

Kein Teil des Viewers ist ein trainiertes neuronales Netz. „Erkannt“ heißt
hier fast immer: Eine Regel mit Schwellenwerten entscheidet, *was* etwas
ist, oder zwei Quellen werden miteinander abgeglichen. Die Regeln sind
offen und reproduzierbar, aber sie können danebenliegen, wo die Welt nicht
zur Regel passt.

- **Bäume ohne Kataster:** In Wald, Gehölz und Park wird die höchste Stelle
  der Oberfläche zwischen 3 und 45 m über dem Gelände zu einem Baum, je
  Zelle von etwa 7 m. Ein Brückenpylon im Park wäre so hoch wie eine Krone,
  deshalb sind Brücken ausgenommen.
- **Kleinbauten:** Was im Laserscan 2–6,5 m hoch steht, außerhalb des
  3D-Gebäudemodells, und je Lichtimpuls nur ein Echo zurückwirft (Laub teilt
  den Impuls, ein Dach nicht), wird ein Schuppen oder eine Laube.
- **Dächer, Schornsteine, Türme, Gauben:** Wo das Oberflächenmodell mehr als
  2 m vom Dach des Gebäudemodells abweicht, auf mindestens 40 % der
  Dachfläche, baut der Viewer das Dach aus der Messung neu. Eine Höhe über
  dem Gebäudemodell wird nur ein Schornstein oder Turm, wo OpenStreetMap ihn
  nennt.
- **Brückentragwerk:** Was entlang der Brückenachse mindestens 3 m über dem
  Deck steht, auf mindestens 25 m Länge, wird ein Bogen oder ein Fachwerk.
- **Zuordnungen:** Ein Laden aus OpenStreetMap gehört zu dem Gebäude, in
  dessen Umriss sein Punkt liegt, sonst zum nächsten in wenigen Metern; ein
  Wahrzeichen aus Wikidata zu den Gebäudeteilen, die sein Umriss deckt.
- **Fremde Erkennung:** Laternen und Papierkörbe, die Mapillary in
  Straßenfotos gefunden hat, sind dort von Mapillarys eigener Bilderkennung
  erkannt worden — trainierte Netze, deren Treffer der Viewer übernimmt.

## Wie sicher ist eine Erkennung?

Wo eine Regel gegen eine unabhängige Quelle geprüft wurde, steht das
Ergebnis beim Datensatz in [Woher die Daten kommen](./data-sources.md). Zwei
Beispiele, die zeigen, was mit den Zahlen passiert: Hecken und Sträucher,
die nur der Laserscan findet, waren zu etwa einem Drittel Ränder von
Baumkronen, deshalb zeigt der Viewer sie nicht. Und Münchens Luftbilder
haben keinen Infrarotkanal; das Grün aus den sichtbaren Farben stimmt mit
dem echten Vegetationsindex nur mäßig überein (r ≈ 0,7), deshalb steht
München in [Quellen nach Stadt](./sources-by-city.md) dort gelb.

## Alles im Überblick

| Was gezeichnet wird | Woher | Wie |
|---|---|---|
| Geländehöhen | Geländemodell DGM1 | `❝ übernommen` |
| Das Gelände als Dreiecksnetz, auf 15 cm genau | Geländemodell DGM1 | `= berechnet` |
| Mauern und Treppenstufen, im Gelände geschärft | DGM1 und OpenStreetMap | `◎ erkannt` |
| Was eine Fläche ist (Straße, Wasser, Wiese …) | Basis-DLM (Hamburg, Berlin: OpenStreetMap) | `❝ übernommen` |
| Die Farbe je Fläche | eine Palette des Viewers | `≈ angenommen` |
| Grün von Wiesen und Laub | Luftbild, Infrarot (München: sichtbare Farben) | `= berechnet` |
| Grundriss, Höhe und Dachform der Gebäude | 3D-Gebäudemodell LoD2 | `❝ übernommen` |
| Dächer, wo das Modell sie verfehlt | Oberflächenmodell DOM1 | `◎ erkannt` |
| Schornsteine, Türme, jüngere Gebäude, Gauben | DOM1, bestätigt durch OpenStreetMap | `◎ erkannt` |
| Schuppen und Lauben | Laserscan | `◎ erkannt` |
| Dachfarbe | Luftbild | `= berechnet` |
| Fassadenfarbe und Material, wo eingetragen | OpenStreetMap | `❝ übernommen` |
| Backstein oder Putz, wo nichts eingetragen ist | OpenStreetMap, die Nachbarschaft | `≈ angenommen` |
| Tönung je Gebäude, Geschossbänder | der Viewer | `≈ angenommen` |
| Haustüren | OpenStreetMap, die Eingänge | `❝ übernommen` |
| Laden oder Gastronomie im Erdgeschoss | OpenStreetMap, dem Gebäude zugeordnet | `◎ erkannt` |
| Wahrzeichen | Wikidata, den Gebäudeteilen zugeordnet | `◎ erkannt` |
| Straßenbäume: Standort, Art, Maße | Baumkataster | `❝ übernommen` |
| Bäume ohne Kataster: Standort | DOM1 oder Laserscan | `◎ erkannt` |
| Bäume ohne Kataster: Höhe | DOM1 oder Laserscan | `= berechnet` |
| Kronenform, Austrieb, Herbstfarbe | der Viewer, je Gattung | `≈ angenommen` |
| Hecken: Verlauf | Basis-DLM oder OpenStreetMap | `❝ übernommen` |
| Hecken: Höhe | Laserscan (ohne Scan: Vorgabe) | `= berechnet` `≈ angenommen` |
| Brücken: Umriss und Art | Basis-DLM (Hamburg, Berlin: OpenStreetMap) | `❝ übernommen` |
| Brücken: Höhe der Fahrbahn | DOM1 | `= berechnet` |
| Brücken: Bogen oder Fachwerk über dem Deck | DOM1 | `◎ erkannt` |
| Brücken: Pfeiler | der Viewer, außerhalb der Fahrrinne | `≈ angenommen` |
| Gleise und ihr Verlauf | Basis-DLM oder OpenStreetMap | `❝ übernommen` |
| Auf welcher Ebene ein Gleis liegt (Boden, Deck, Einschnitt) | aus Gelände und Decks entlang der ganzen Linie | `◎ erkannt` |
| Lampen, Bänke, Stadtmöbel: Standort | OpenStreetMap | `❝ übernommen` |
| Lampen und Papierkörbe aus Straßenfotos | Mapillary | `◎ erkannt` |
| Ihre Form; wohin eine Bank ohne Angabe blickt | der Viewer | `≈ angenommen` |
| Denkmäler: Standort und Name | Basis-DLM, OpenStreetMap | `❝ übernommen` |
| Denkmäler: Form, wo gemessen | DOM1 | `= berechnet` |
| Sportplätze: Umriss, Sportart, Belag | OpenStreetMap | `❝ übernommen` |
| Ihre Linien | Standardmaße der Sportart | `≈ angenommen` |
| Parzellen in Kleingärten, Bäume in Obstwiesen ohne Eintrag | der Viewer | `≈ angenommen` |
| Gewässerumriss | Basis-DLM | `❝ übernommen` |
| Wellen, Nebel, Dunst, Papierkorn | der Viewer | `≈ angenommen` |
| Himmelslicht und Horizont | Gelände und Gebäudemodell | `= berechnet` |
| Sonnenstand und Schatten zur Uhrzeit | der Viewer | `= berechnet` |
| Datenebene Kfz-Verkehr: Tageswerte | Verkehrszählungen | `❝ übernommen` |
| Datenebene Kfz-Verkehr: Wert zur Uhrzeit | typischer Tagesgang | `≈ angenommen` |
| Datenebene Radverkehr, Straßenbahnen | Zählstellen live, Fahrplan | `❝ übernommen` |

Die Entwicklerdokumentation führt dieselben Abzeichen an jedem Eintrag des
[Transformationskatalogs](../../transformations.md).

## Was die Abzeichen nicht sagen

Ein Abzeichen beschreibt, was **der Viewer** mit den Daten tut, nicht wie
die Quelle selbst entstanden ist. Das 3D-Gebäudemodell ist bei der
Landesvermessung zum Teil automatisch aus Laserscan und Grundrissen
modelliert; OpenStreetMap ist von Freiwilligen eingetragen und so
vollständig wie die Straße, in der jemand kartiert hat. Wie gut eine Quelle
selbst ist, beschreiben [Woher die Daten kommen](./data-sources.md) und
[Quellen nach Stadt](./sources-by-city.md). Und auch Übernommenes kann
veraltet sein: Die Datensätze haben unterschiedliche Stände, die die
Detailansicht bei jeder Zeile nennt.
