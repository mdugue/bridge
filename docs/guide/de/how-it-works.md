# So funktioniert der Stadtspaziergang

*English: [How the city walker works](../en/how-it-works.md)*

Diese Seite erklärt ohne Vorwissen in Geodaten oder 3D-Grafik, was du
siehst, wenn du den Viewer öffnest, woher das alles kommt und wie viel
davon „echt“ ist. Begriffe in **Fettschrift** stehen im
[Glossar](./glossary.md).

## Was du siehst

Ein stilisiertes, begehbares 3D-Modell der Dresdner Innenstadt: ein Quadrat
von 4 km × 4 km auf beiden Elbseiten, mit der historischen Altstadt im
Südwesten, Innerer und Äußerer Neustadt im Norden und der Johannstadt im
Südosten. Du startest tief über der Elbe nahe der Carolabrücke, mit Blick
auf die Altstadt-Silhouette, und kannst auf Straßenniveau gehen oder über
die Dächer fliegen.

Nichts wird installiert, nichts über dich gespeichert, und kein Server
berechnet das Bild. Dein Browser lädt vorbereitete Dateien, während du dich
bewegst — etwa 4 MB für die Kachel, auf der du startest, bis zu etwa 17 MB,
wenn du jede Ecke besuchst —, und deine eigene Grafikkarte zeichnet jedes
Bild, mit Hilfe einer Bibliothek namens **three.js**.

Der Look ist absichtlich nicht fotorealistisch. Es ist ein weiches,
pastelliges „Aquarell auf Papier“: Gebäude sind matte Tonvolumen, der Boden
ist nach Nutzung eingefärbt statt mit Luftbildern beklebt, und über dem
ganzen Bild liegt ein feines Papierkorn. Das ist eine gestalterische
Entscheidung, dokumentiert in den
[Art-Direction-Notizen](../../transformations.md).

## Das Ganze in einem Bild

```mermaid
flowchart LR
  A["Offene Geodaten<br/>(Sachsen + OpenStreetMap)"] --> B["Einmal offline aufbereitet<br/>durch den Betreiber"]
  B --> C["Kleine Dateien je Kachel<br/>im Repository"]
  C --> D["Beim Build verpackt<br/>(3D Tiles, Dateinamen mit Fingerabdruck)"]
  D --> E["Dein Browser<br/>streamt, was die Kamera sieht"]
  E --> F["Deine Grafikkarte<br/>zeichnet die Stadt"]
```

Jede Station dieses Bildes ist in [Der Weg der Daten](./data-journey.md)
beschrieben, die Datensätze selbst in
[Woher die Daten kommen](./data-sources.md).

## Woraus die Szene besteht

Die Szene ist aus Schichten aufgebaut. Jede Schicht stammt aus ein oder
zwei Datensätzen, und jede ist eine Mischung aus gemessener Tatsache und
bewusster Vereinfachung.

| Schicht | Was sie zeigt | Woher sie kommt | Echt oder stilisiert? |
|---|---|---|---|
| **Gelände** | Die Form des Bodens: Flussufer, der Anstieg zur Neustadt, Dämme | Das amtliche Geländemodell mit 1 m Raster (**DGM1**) | Echte Höhen, auf einem Raster von etwa 2 m in deiner Nähe und 4 m weiter weg. Senkrechte Mauern und Treppen glättet die Quelle zu Rampen; wo OpenStreetMap eine Mauer, eine Felskante oder eine Treppe kennt, schärft das Projekt sie wieder |
| **Bodenfarben** | Straßen grau, Wege sandfarben, Wiesen salbeigrün, Wald moosgrün, Siedlung tonfarben, Wasser blau | Das amtliche Landschaftsmodell (**Basis-DLM**) | Echte Klassifizierung; die Farben sind eine entworfene Pastellpalette, erst in deinem Browser aufgemalt, keine Fotos |
| **Wasser** | Die Elbe und kleinere Gewässer mit leicht bewegter Oberfläche und treibendem Nebel | Wasserflächen aus dem Basis-DLM, auf das echte Gelände gelegt | Echter Umriss, erfundene Wellen |
| **Gebäude** | Jedes Gebäude mit echtem Grundriss, Höhe und Dachform | Das amtliche 3D-Gebäudemodell (**LoD2**), rund 16 000 Gebäude und Gebäudeteile in den vier Kacheln | Echte Geometrie. Fassaden sind bewusst glatt; Fenster gibt es in den Quelldaten nicht |
| **Gebäudefarben** | Dachfarben; eine leichte Tönung je Gebäude; abends ein warmes Leuchten in Läden und öffentlichen Bauten | Dachfarbe aus Luftbildern (**DOP**) gemessen; der Rest aus Gebäudeattributen abgeleitet | Dachfarben sind echt (etwa 83 % Abdeckung), Wandtöne sind synthetisch |
| **Bäume und Hecken** | Einzelbäume mit Kronen in gemessener Höhe; Hecken und Baumreihen | Baumpositionen und -höhen aus der Differenz von Oberflächenmodell (**DOM1**) und Geländemodell; Reihen aus dem Basis-DLM; Grünfärbung aus dem Infrarot-Luftbild (**NDVI**) | Positionen und Höhen sind gemessen; die Kronenform ist generisch, die Baumart unbekannt |
| **Straßenlampen** | Laternen an Straßen und Plätzen | **OpenStreetMap** | Echte Positionen, Standardhöhe |
| **Stadtmöbel** | Sitzbänke, Picknicktische, Papierkörbe, Fahrradbügel, Poller, Briefkästen und Wartehäuschen | **OpenStreetMap**; wohin eine Bank blickt, aus ihrer eingetragenen Richtung, sonst zum nächsten Weg oder zur nächsten Straße | Echte Positionen (ein Poller in seiner eingetragenen Höhe); ein weiches, abstrahiertes Modell je Art in den Pastelltönen der Szene — wie Figuren eines Architekturmodells. Nur wenige Bänke sagen, wohin sie blicken, die meisten sind zum nächsten Weg gedreht — meist, nicht immer richtig |
| **Spielplätze** | Die Spielplatzfläche als heller Sandboden, mit ihren Schaukeln, Rutschen, Klettergerüsten, Sandkästen und Wippen als weiche, einfarbige Pastell-Skulpturen | **OpenStreetMap** (der Umriss und jedes darauf eingetragene Gerät) | Echter Umriss und echte Positionen; es steht nur, was eingetragen ist — viele Spielplätze sind ohne Geräte erfasst und bleiben leer, statt mit erfundenen Geräten gefüllt zu werden |
| **Brunnen und Denkmäler** | Brunnenbecken mit stillem Wasser und durchscheinenden Wasserglocken; Statuen, Gedenksteine und Säulen | Lage und amtliche Namen aus dem Basis-DLM; Beckenumrisse und die kleineren Brunnen aus OpenStreetMap; die Form der Skulptur aus dem Oberflächenmodell (**DOM1**) | Echte Lage und Umrisse. Eine Skulptur ist ihr gemessener Körper, zu Ton geglättet — richtige Größe und Silhouette, keine Details; wo nichts messbar war, eine abstrakte Markierung. Die Wasserglocken, ihre sanfte Bewegung und die Nachtbeleuchtung sind entworfen. Beide Befliegungen fanden statt, als die Brunnen leer und ihre Figuren winterlich eingehaust waren; der gemessene Körper am Albertplatz ist also die Einhausung |
| **Bahn und Brücken** | Gleise, Schotterbetten, Brückendecks mit Bögen oder Pfeilern, Bahnsteige | Basis-DLM (Gleise, Brücken), Gelände- und Oberflächenmodell (Deckhöhen), OpenStreetMap (Bahnsteige, ob eine Brücke eine Bogenbrücke ist) | Echter Verlauf und echte Deckhöhen; das Tragwerk ist vereinfacht |
| **Mauern** | Die Brühlsche Terrasse und andere Stütz- und Stadtmauern, Felskanten | OpenStreetMap-Linien mit ihren eingetragenen Höhen | Echte Lage, eingetragene oder Standardhöhe |
| **Treppen** | Freitreppen wie die neben dem Italienischen Dörfchen oder die vom Schlossplatz zur Brühlschen Terrasse, als einzelne Stufen | OpenStreetMap (`highway=steps`: Lage, Breite, Stufenzahl; ohne Breitenangabe reicht eine Treppe von Mauer zu Mauer, wenn der Hang dazwischen ansteigt); Höhe von Fuß und Kopf aus dem Geländemodell | Echte Lage und Höhe; Stufenzahl eingetragen oder aus der Höhe geschätzt (16 cm je Stufe). Die Brühlsche Terrasse steht auf Kasematten und fehlt im Geländemodell; dort geben die eingetragenen Stufen die Höhe vor, und die Terrassenfläche aus OpenStreetMap wird auf diese Höhe angehoben |
| **Sonne, Schatten und Himmel** | Sonnenlicht für beliebiges Datum und Uhrzeit; blaue Stunde, goldene Stunde, Nacht | Aus Kalender, Uhr und Dresdens Breitengrad berechnet | Astronomisch korrekter Sonnenstand; die Farben sind entworfen |
| **Atmosphäre** | Entfernungsdunst, Talnebel in tiefem Gelände, Flussnebel, Tiefenfärbung, Papierkorn | Im Browser berechnet; der Talnebel liest die echte Geländehöhe | Künstlerisch |

## Wie ein Besuch abläuft

Die Szene wird nicht auf einmal geladen, und sie muss nie ganz geladen
sein. Die Stadt ist in 2-km-Kacheln geschnitten, und der Viewer **streamt**
sie: Er lädt, was die Kamera sehen kann, in deiner Nähe detailliert und
weiter weg gröber, und kann loslassen, was du weit hinter dir gelassen
hast. Das erste Bild braucht nur die Kachel, auf der du startest; der
Ladebildschirm zeigt, wie der Rest eintrifft:

```mermaid
flowchart LR
  subgraph P1["Phase 1 — bis die Szene begehbar ist"]
    direction LR
    a["Gebäude deiner Kachel"] --> b["Gelände deiner Kachel"] --> c["Sonne und Schatten"]
  end
  subgraph P2["Phase 2 — nachgeladen, während du schon gehst"]
    direction LR
    d["Bäume, Lampen, Gleise und Mauern<br/>deiner Kachel"] --> e["Die Kacheln um dich herum<br/>nah detailliert, fern grob"]
  end
  P1 --> P2
```

Phase 1 endet, wenn der Ladebildschirm *begehbar* meldet: Der Vorhang löst
sich auf, und du kannst dich bewegen. Phase 2 läuft im Hintergrund weiter;
eine kleine Pille oben im Bild zählt die eintreffenden Stufen mit. Solange
noch nicht alles um dich herum da ist, ist der Horizont absichtlich
dunstig, damit die fehlenden Kacheln nicht als Abbruchkante wirken. Danach
geht das Streamen einfach weiter, während du dich bewegst: Eine ferne
Kachel zeigt ihre Gebäude auf grobem Gelände und bekommt ihre Bäume,
Lampen, Gleise und Mauern, sobald du nah genug für das detaillierte
Gelände bist.

## Was echt ist und was nicht

**Gemessen, aus amtlichen Vermessungen:** Geländehöhen, Gebäudegrundrisse,
-höhen und Dachformen, Landnutzung, Gewässerumrisse, Gleisverläufe,
Brückenlagen und Deckhöhen, Baumpositionen und -höhen, Dachfarben,
Wiesengrün.

**Von Freiwilligen beigetragen (OpenStreetMap):** Straßenlampen, Bänke
und andere Stadtmöbel, Bahnsteige, Stützmauern mit Höhen, der Tragwerkstyp von Brücken. Die
Vollständigkeit schwankt von Straße zu Straße.

**Berechnet:** der Sonnenstand, alle Schatten, Nebel und Dunst, die
Tiefenschärfe, die langsame Bewegung von Blättern und Wasser.

**Für den Look erfunden:** die Pastellpalette, Papierkorn und Vignette, die
Form der Baumkronen, der Wandton je Gebäude, die Wellen auf dem Wasser, die
warmen Fenster in der Dämmerung (dass es ein Laden oder öffentliches
Gebäude *ist*, stimmt; seine leuchtenden Fenster sind erfunden).

**Gar nicht in den Daten:** Fenster und Türen, Fassadenmaterialien,
die kleineren Stadtmöbel (Pflanzkübel, Haltestellenmasten; Verkehrs- und
Straßennamensschilder sind zu lückenhaft erfasst, um sie zu zeigen),
Fahrzeuge, Menschen, Bewuchs unter etwa 3 m und
alles im Inneren von Gebäuden.

## Bevor du aus dem Bild Schlüsse ziehst

- Die Datensätze haben **unterschiedliche Stände**. Das Gelände wurde Ende
  2024 erfasst, das Gebäudemodell im Frühjahr und Sommer 2025 erzeugt,
  Landschaftsmodell und Luftbilder haben ihre eigenen Ausgaben. Ein Haus,
  das in einem Datensatz neu ist, kann in einem anderen fehlen. Siehe die
  Stände-Tabelle in [Woher die Daten kommen](./data-sources.md#verwendete-datenstände).
- Eine Kachel ist ein 2-km-Quadrat. An den **Nahtstellen** zwischen Kacheln
  kann eine kleine Stufe oder ein Farbwechsel sichtbar sein, und weiter
  entfernte Kacheln werden mit gröberem Gelände und ohne Bäume, Lampen,
  Gleise oder Mauern gezeichnet, bis du näher kommst.
- Luftbilder schauen bei hohen Gebäuden leicht **schräg**, sodass eine
  gemessene Dachfarbe etwas Fassade enthalten kann. Die Abtastung meidet den
  Dachrand, um das zu mindern.
- Baum**arten** sind unbekannt; jeder Baum hat dieselbe generische Form,
  skaliert auf seine gemessene Höhe und getönt danach, wie grün er aus der
  Luft aussah.
- Das Gebäudemodell enthält für diese Kacheln **keine Brücken, Mauern oder
  Türme**, obwohl neuere Ausgaben des Produkts das könnten; deshalb werden
  Brücken und Mauern aus anderen Quellen nachgebaut.

## Wie es weitergeht

- [Woher die Daten kommen](./data-sources.md) — jeder Datensatz, wo er
  heruntergeladen wurde, was er gut kann und was nicht, die Lizenzen.
- [Der Weg der Daten](./data-journey.md) — die Stationen der Daten, was die
  eine Wahrheit ist, was ein Derivat, was der Browser tatsächlich bekommt.
- [Bedienung](./using-the-viewer.md) — Steuerung und Einstellungsfeld,
  Beschriftung für Beschriftung.
- [Glossar](./glossary.md) — die Abkürzungen.
- Für Entwickler: [docs/README.md](../../README.md) (englisch).
