# Bedienung

*English: [Using the viewer](../en/using-the-viewer.md)*

Diese Seite geht das Einstellungsfeld Beschriftung für Beschriftung
durch. Du brauchst einen Browser mit **WebGPU** (die neuere
Grafikschnittstelle, die die meisten aktuellen Browser bieten) oder, wo
das fehlt, **WebGL2** (jeder aktuelle Desktop- und Mobilbrowser hat es;
das Bild ist dasselbe, nur kann die Ansicht kurz stocken, während neue
Gegenden erscheinen) und für ein flüssiges Bild eine halbwegs aktuelle
Grafikkarte. Handys werden unterstützt: Sie bekommen
automatisch ein leichteres Render-Budget.

## Eine Stadt wählen

Die Startseite (`/`) zeigt eine Karte für jede Stadt, mit der diese
Bereitstellung gebaut wurde: die Karte der Stadt in den Bodenfarben des
Viewers, ihr Bundesland, die Fläche, die sie abdeckt, und wie viele
Aussichtspunkte sie hat. Eine Karte öffnet den Viewer dieser Stadt, der
eine eigene Adresse hat — `/dresden`, `/leipzig`, … —, sodass ein Link oder
Lesezeichen direkt hineinführt. Im Viewer führt *Andere Stadt wählen*
unter dem Namen der Stadt oben im Feld zurück zur Startseite. Die
Startseite verlinkt außerdem die Wissensseiten (`/wissen`).

Über den Karten ordnet *Sortieren* sie. *Empfohlen* stellt Dresden an den
Anfang — die am besten gepflegte Stadt — und die übrigen nach Namen; die
anderen Ordnungen reihen nach einer Zahl, die der Build für jede Stadt
gleich gemessen hat, und jede Karte zeigt dann ihre Zahl: die meisten
Baumkronen je km² (so wie das Oberflächenmodell sie sieht), die grünste
(Wald, Wiese und Feld in der Bodenbedeckung), das meiste Wasser, die
höchsten Häuser (die Höhe des mittleren Gebäudes), die dichteste Bebauung
(der Anteil des Bodens unter einem Dach), die hügeligste (der
Höhenunterschied im Gelände), die meisten Wahrzeichen, die größte Fläche.

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

Die Seitenleiste ist von Anfang an da, über dem Ladebildschirm. Schon
während die Stadt lädt, kannst du einen Ort wählen, einen Punkt auf der
Karte anklicken oder einen Snapshot anwenden: Das Laden beginnt dann
dort neu (der Ladebildschirm nennt ihn als *Start*), und du kommst gleich
dort an statt am üblichen Startpunkt mit anschließender Reise. Sonne,
Uhrzeit und Look lassen sich ebenfalls schon einstellen; Modell, die
Werkzeuge, *Sicht merken*, der Klang und das Speichern eines Bildes
warten, bis die Szene steht.

## Bewegen

| Eingabe (Desktop) | Wirkung |
|---|---|
| Mit der Maus ziehen | umsehen (der Zeiger ist eine Hand, die den Blick greift) |
| `W` `A` `S` `D` | gehen (oder fliegen) |
| `↑` `↓` / `←` `→` | vor und zurück gehen / nach links und rechts drehen |
| `Shift` | sprinten |
| `F` | zwischen Gehen und Fliegen wechseln (abheben / landen) |
| `Leertaste` / `Shift` (oder `E` / `Q`) | hoch / runter im Flug |
| `1` – `9` | zum ersten bis neunten Aussichtspunkt gleiten |
| Mausrad (oder Zwei-Finger-Geste auf dem Trackpad, auch Aufziehen) | zu der Stelle unter dem Mauszeiger (im immersiven Modus: dem Fadenkreuz) hin oder von ihr weg: zu Fuß den Boden entlang, im Flug auf der Linie zu ihr, die Stelle bleibt unter dem Zeiger; jeder Schritt legt den Großteil des restlichen Wegs zurück, nie über sie hinaus, und über dem Himmel bleibt der Flug waagerecht |
| `Alt` + Mausrad | zoomen (Blickwinkel enger oder weiter) |
| Doppelklick auf den Boden | in einem kurzen Gleitflug dorthin; im Flug ein Stück darauf zu |
| Klick auf die Minikarte | dorthin gleiten (zu Fuß landest du stehend, im Flug in gleicher Höhe) |
| *Standort* (Werkzeugleiste unten rechts) | zu deinem echten Standort teleportieren |
| Klick auf ein Gebäude | es befragen: eine Karte sagt, was die Daten darüber wissen |
| `I` | befragen, was unter dem Mauszeiger steht (immersiv: in der Bildmitte) |
| `R` | Gebäude unter dem Mauszeiger abreißen (immersiv: in der Bildmitte) |
| `V` | zum nächsten Bildstil wechseln (Pastell → Comic → Film noir → Sin City → Papier → Strich → Schwarzplan) |
| `M` | ins *Modell* wechseln, die Stadt in Parallelprojektion, und zurück (siehe [Modell](#modell-die-stadt-als-planzeichnung)) |
| `Esc` | immersiven Modus verlassen |

| Eingabe (Touch) | Wirkung |
|---|---|
| Ziehen | umsehen |
| Joystick (unten links) | gehen |
| *Standort* (Werkzeugleiste unten rechts) | zu deinem echten Standort teleportieren, Blick in die Richtung, in die das Telefon zeigt |
| *Live* (Werkzeugleiste, nur mit Kompass) | Blick und Position folgen dir und deinem Telefon — auch im Flug —, bis du es ausschaltest, ziehst oder den Joystick nimmst |
| *Fliegen* (Werkzeugleiste) | zwischen Gehen und Fliegen wechseln (abheben / landen) |
| *Modell* (Werkzeugleiste) | zur Stadt in Parallelprojektion wechseln und zurück |
| Lange auf ein Gebäude drücken | es befragen |
| ⌄ unter der Werkzeugleiste | die Leiste zu einem Knopf einklappen (⋮ klappt sie wieder auf) |
| Höhenregler (über der Werkzeugleiste, nur im Flug) | nach oben schieben steigt, nach unten sinkt; loslassen hält die Höhe |
| Doppeltippen auf den Boden | in einem kurzen Gleitflug dorthin; im Flug ein Stück darauf zu |
| Zwei Finger auseinander / zusammen | zur Stelle zwischen den Fingern hin / von ihr weg: zu Fuß den Weg entlang, im Flug auf der Linie zu ihr (je höher, desto weiter) |

Beim Gehen bleibst du in Augenhöhe auf dem Gelände und stößt an Gebäuden
und Mauern an. Auch im Flug stößt du an Fassaden, sinken kannst du nicht
tiefer als bis auf Augenhöhe über dem Boden, und über ansteigendem Gelände
hebt dich der Boden mit. In einem Gebäude oder unter der Erde landest du
nie: Ein Doppelklick auf eine Fassade, ein Snapshot oder dein Standort in
einem Haus setzt dich davor ab, in der Luft über das Dach, und ein
Gleitflug steigt über das, was auf seinem Weg steht. Jede Eingabe bricht
einen laufenden Gleitflug zu einem Aussichtspunkt ab.

Der Wechsel zwischen Gehen und Fliegen springt nicht, er gleitet: Beim
Abheben steigst du auf rund 30 m über dem Boden und blickst leicht auf die
Straße hinab; beim Landen sinkst du senkrecht auf den Boden unter dir (neben
ein Gebäude, nicht auf sein Dach), und der Blick richtet sich wieder nach
vorn, auch wenn du im Flug nach unten geschaut hast. Während des Landens
oder eines Doppeltipp-Gleitflugs kannst du dich umsehen, ohne ihn
abzubrechen. Im Flug wirst du umso schneller, je höher du bist.

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
Stehst du außerhalb des Gebiets, sagt ein kleines Fenster, wie weit, und
bietet an, wohin es stattdessen gehen kann: zu einem der Aussichtspunkte, zu
einer Stelle, die du auf der Karte wählst, oder du bleibst, wo du bist.
Stehst du in einer anderen Stadt, die diese Seite auch zeigt, sagt das
Fenster das zuerst und bietet an, dorthin zu springen: Ihr Viewer öffnet
sich mit dir dort, wo du stehst (die Position reist im Fragment des Links
mit, das nie beim Server ankommt). Browser fragen dafür um Erlaubnis
(iPhones auch für den
Kompass); der Standort verlässt das Gerät nicht — auch nicht in einem
Absturzbericht (siehe *Wenn es abstürzt*).

*Live* erscheint, sobald dein Telefon Kompasswerte liefert (auf dem iPhone
fragt es beim ersten Antippen um Erlaubnis; am Rechner ohne Kompass gibt es
den Knopf nicht). Eingeschaltet wird die Stadt zum Fenster, das du vor dich
hältst: Drehst du dich, dreht sich der Blick mit; kippst du das Telefon,
schaust du hoch oder runter. Und gehst du los, geht die Kamera mit — sie
folgt deiner GPS-Position, sanft geglättet, damit die Streuung der Ortung
nicht ruckelt. Stehst du außerhalb des Gebiets oder gibt es keinen
Standort, folgt nur der Blick. Ein zweites Antippen, Ziehen zum Umsehen
oder der Joystick geben dir die Steuerung zurück. *Live* und *Fliegen* gehen
zusammen: Dann schwebst du wie eine Drohne über deiner Position, und mit
dem Höhenregler steigst oder sinkst du, ohne dass *Live* endet.

Eine schwebende Leiste zeigt die vier wichtigsten Bedienungen, bis du sie
mit *Verstanden* ausblendest; die vollständige Tabelle bleibt im Feld unter
*Steuerung* erreichbar.

## Modell: die Stadt als Planzeichnung

`M`, *Modell* in der Werkzeugleiste oder *Modell* neben *Gehen* und
*Fliegen* im Feld wechseln ins **Modell**: die Stadt in Parallelprojektion,
so wie Städtebauer sie zeichnen. Die Ansicht fährt in einem kurzen
Dolly-Zoom zurück und wird enger, bis die Perspektive verschwunden ist;
`M` gleitet wieder dorthin zurück, wo du warst — oder, wenn du das Bild
weit verschoben hast, in eine Ansicht aus der Luft über seiner Mitte.

Eine Parallelprojektion hat einen Maßstab statt einer Entfernung: Gleiche
Längen bleiben gleich lang, wo immer sie im Bild stehen, vorn wie hinten.
Du bewegst das Blatt, nicht dich, und es bleibt parallel, was du auch
tust — näher heran ändert nur den Maßstab:

| Eingabe | Wirkung |
|---|---|
| Ziehen | das Bild verschieben (der Boden unter dem Zeiger bleibt unter ihm) |
| Mausrad / zwei Finger auseinander oder zusammen | Maßstab, um den Zeiger |
| `+` / `−` | eine Maßstabsstufe |
| Rechts ziehen oder mit `Strg` ziehen / zwei Finger drehen | drehen (unter zwei Fingern dreht sich der Boden mit ihnen); losgelassen rastet es auf die nächsten 15° |
| `Shift` + rechts ziehen | neigen (die Ansicht wird zur *Vogelschau*) |
| `Q` / `E`, ⟲ ⟳ | um 90° drehen |
| `W` `A` `S` `D`, Pfeiltasten | das Bild verschieben |
| Doppelklick / Doppeltippen | das Bild dort zentrieren |
| `1` – `9`, *Orte*, die Minikarte | das Bild auf diesen Ort zentrieren, Maßstab und Drehung bleiben |
| Klick / lange drücken | befragen, wie immer |
| `F` | das Modell in den Flug verlassen |

Unten links, wo zu Fuß der Joystick sitzt, stehen die **Maßstabsleiste** —
eine runde Länge in schwarzen und weißen Abschnitten, darunter der
Maßstab („1 : 2 500 bei 96 dpi“: ein Bildschirmpixel als 0,26 mm
gerechnet) — und der **Nordpfeil** zwischen zwei Vierteldrehungen; ein
Klick auf den Pfeil dreht Norden nach oben. Die Minikarte zeichnet den
Boden, den das Bild zeigt.

Unter *Gehen · Fliegen · Modell* im Feld bietet **Projektion** die
Ansichten an, jede Karte mit dem Würfel, den sie zeichnet:

| Ansicht | Was sie ist |
|---|---|
| *Isometrie* | die 30°-Isometrie: 35,26° geneigt, alle drei Achsen gleich verkürzt (Längen entlang ihnen × 0,816), über Eck gedreht |
| *Vogelschau* | parallel von oben, Neigung (Regler) und Drehung frei |
| *Militär* | die Militärperspektive: der Grundriss unverzerrt und maßstäblich, die Höhen senkrecht darüber — mit 30°/60° oder 45°/45° zur Blattkante, Höhen × 1 oder × ⅔ |
| *Lageplan* | senkrecht von oben, Norden oben |
| *Ansicht* | waagerecht auf die Linie durch die Bildmitte; was davor steht, ist weggeschnitten |
| *Schnitt* | dasselbe, mit schwarz gefüllt, was der Schnitt öffnet (Poché), und dem Gelände als Profil darunter |

Darunter: der aktuelle Maßstab und die Stufen 1:500 … 1:10 000 (dazwischen
zoomt es frei); *Ausschnitt mit Sockel*, der nur die Bildmitte behält und
sie auf einen dunklen Sockel stellt, wie ein aus der Stadt geschnittenes
Modell (*neu setzen* nimmt die aktuelle Mitte; er endet mit dem Modell;
beim ersten Mal steht dort kurz *Wird vorbereitet …*, während die Stadt
für den Schnitt vorbereitet wird, und sie bewegt sich dabei weiter —
Gebäude knapp außerhalb werfen ihren Schatten noch über seinen Rand;
lässt er sich nicht vorbereiten, sagt das die Zeile darunter, mit *noch
einmal versuchen*); und *Bild speichern*.

**Die Bäume stehen in jedem Maßstab.** Nah heran steht jeder Baum im
Bild; wo die Stadt gröber gezeichnet wird — weit hinausgezoomt, die
ganze Stadt auf einmal, oder wenn das Gerät Speicher sparen muss — steht
ein Drittel von ihnen, die Kronen breiter gezeichnet, damit ein Wald ein
Wald bleibt, jeder dort, wo sein Baum stand. Dasselbe gilt in der Ferne
zu Fuß und im Flug. Die Brücken stehen in jedem Maßstab, eine Straßenbrücke mit
ihren Gehwegen, Bordsteinen und der Fahrbahn, die steinernen in Lagen aus
behauenem Stein.

Jeder Bildstil geht im Modell; *Strich* und *Schwarzplan* sind dafür
gemacht. Tiefenschärfe, die warm/kalt-Tiefenfärbung und die Vignette ruhen
im Modell, der Entfernungsdunst öffnet sich, und der Himmel weicht dem
Papier des Stils.

**Bild speichern** (auch unter *Erweitert*) speichert die aktuelle Ansicht
als PNG mit einem Legendenstreifen darunter: Nordpfeil, Maßstabsleiste,
die Ansicht und der Maßstab, den das Bild im Druck bei 300 dpi hat, Datum
und Uhrzeit und die Quellenvermerke der Daten (ihre Lizenzen verlangen
sie). Im Modell wird das Bild größer als der Bildschirm gerendert — am
Computer etwa drei Bildpixel je Bildschirmpunkt, am Telefon zwei, in
Kacheln, mit einem Schleier über der Stadt für den Moment, den es dauert;
beim Gehen und Fliegen ist es das Bild, wie du es siehst, mit den
Quellenvermerken.

## Ein Gebäude befragen

Die Stadt selbst trägt keine Schrift. Du kannst sie stattdessen fragen:
Mit der Maus genügt ein **Klick** auf ein Gebäude, auf einem Touchscreen
**langes Drücken** (den Finger eine halbe Sekunde ruhig halten); `I`
fragt, was unter dem Mauszeiger steht (im immersiven Modus, der den
Zeiger ausblendet, was in der Bildmitte steht; nur dort markiert ein
Punkt die Mitte). Das Gebäude bekommt eine feine
Schraffur und eine Linie um seinen Umriss, beide in der pinken
Akzentfarbe der Bedienelemente, und eine Karte öffnet sich. Ein Klick ins Leere
schließt sie wieder. Ein kleines Haus musst du
nicht genau treffen: Steht direkt unter dem Finger nichts, antwortet das
Gebäude, zu dem das meiste rund um die Stelle gehört. Auf dem Telefon ist
die Karte ein Blatt am unteren Rand: eingeklappt sagt es, was das Gebäude
ist und wo; nach oben wischen (oder *Angaben und Quellen* antippen)
zeigt den Rest, nach unten wischen klappt es ein oder schließt es —
Joystick und Werkzeugleiste treten so lange zur Seite, und die Stadt
dahinter bleibt bedienbar. Langes Drücken markiert nie Text auf der
Seite. Die Karte sagt nur, was die
Daten wissen:

- den **Namen** des Gebäudes (aus OpenStreetMap) oder seine amtliche
  **Nutzung** (die ALKIS-Gebäudefunktion des Stadtmodells; bei den meisten
  Häusern ist sie als *nicht zu spezifizieren* erfasst, und genau das sagt
  die Karte),
- seine **Adresse** (OpenStreetMap),
- **Höhe** (gemessen), Traufe, **Dach**form und -neigung, Grundfläche, die
  **Geschosse**, wo OpenStreetMap sie kennt, aus wie vielen Teilen das
  Modell es zusammensetzt, ob es ein Kulturdenkmal ist oder im Erdgeschoss
  ein Laden liegt,
- seine **Kennung** im amtlichen Stadtmodell (zum Kopieren — andere
  Datensätze kennen das Gebäude unter ihr),
- und je zitiertem Datensatz eine **Quellenzeile** mit Stand und Lizenz:
  beim Stadtmodell das Modelljahr, das Jahr, in dem die Dächer gemessen,
  und das, in dem die Grundrisse erfasst wurden.

Ein Schuppen oder Gartenhaus, das der Laserscan gefunden hat, das
Stadtmodell aber nicht kennt, sagt das. Esc, × oder nach unten Wischen
schließt die Karte und nimmt die Schraffur weg; die nächste Frage gilt dem
nächsten Gebäude.
Geschätzt wird nichts: Ein Gebäude ohne erfasste Geschosse hat einfach
keine Geschosszeile.

Bäume, Denkmale und Brunnen und Brücken antworten genauso. Was du
gefragt hast, umrahmt eine weiche pinke Linie auf einem hellen Saum —
entlang seines Umrisses, so wie du ihn gerade siehst, gleich breit auf
dem Bildschirm, ob nah oder fern. Beim Antippen leuchtet der Saum kurz
auf. Ein
**Straßenbaum** nennt seine Art (deutsch und botanisch), Straße und
Nummer im Stadtbaumkataster, Höhe, Krone und Stamm, soweit das Kataster
sie gemessen hat (was fehlt, bleibt weg, statt geschätzt zu werden), und
das Alter, das es verzeichnet, mit dem Datum des Eintrags. Ein
**Denkmal** nennt seinen amtlichen Namen, ein Brunnen die Form seines
Beckens; eine **Brücke** ihren Namen, Tragwerk und Hauptspannweite (aus
Wikidata, dessen Kennung du kopieren kannst), ihre Länge und die
Durchfahrtshöhe für die Schifffahrt.

Auch die **Verkehrsdaten** lassen sich befragen, solange ihre Ebene
eingeschaltet ist. Ein **Verkehrsstrom** nennt seine Straße, die
gezählten Fahrzeuge am Tag in beiden Richtungen und je Richtung (nach der
Himmelsrichtung, in die sie fahren, mit dem Anteil des Schwerverkehrs),
das Jahr und wie gezählt wurde — und wenn die Quelle beide Richtungen nur
zusammen zählt, sagt die Karte das, statt eine Aufteilung zu erfinden.
Dazu kommt ein Schätzwert für die eingestellte Uhrzeit, ausdrücklich als
Schätzung nach einem typischen Tagesgang. Eine **Radzählstelle** nennt
die Räder der letzten vollen Stunde je Richtung und wann sie gezählt
wurden. Beide Karten nennen ihre Quelle mit Lizenz.

## Das Feld

Der Knopf in der Ecke öffnet ein Feld mit drei Reitern.

### Erkunden

- **Minikarte** — das ganze Gebiet von oben, mit den Landnutzungsfarben,
  den Brücken und den Grundrissen der gerade geladenen Gebäude. Deine Position und
  Blickrichtung sind eingezeichnet; ein Klick gleitet dorthin.
- **Gehen / Fliegen / Modell** — gehen, fliegen oder die Stadt in
  Parallelprojektion sehen ([Modell](#modell-die-stadt-als-planzeichnung));
  im Modell folgt der Abschnitt **Projektion**.
- **Orte** — wohin es gehen kann, als eine Liste: die handverlesenen
  Standpunkte und die Wahrzeichen der Stadt zusammen. Die ersten sechs
  stehen da; *Alle … Orte zeigen* öffnet den Rest mit einem Suchfeld über
  alle Namen. Eine Zeile gleitet dorthin (im Modell zentriert sie das Bild
  darauf); das Symbol sagt, wie du ankommst — zu Fuß, aus der Luft oder an
  einem Wahrzeichen —, und am Rechner erreichen die Tasten `1` – `9` die
  ersten neun.
  - *Die Standpunkte* stehen vorn, in der Reihenfolge, in der sie gewählt
    sind. In Dresden *aus der Luft*: *Altstadt-Silhouette* (der
    Startblick, tief über der Elbe), Draufsichten auf *Frauenkirche*,
    *Brühlsche Terrasse*, *Albertplatz*, *Alaunpark* und *Zwinger &
    Semperoper*, ein tiefer Flug über die *Äußere Neustadt*, dazu
    *Carolabrücke* (über dem Fluss), *Elbe-Panorama* (hoch über der
    Flussbiegung), *Über den Dächern* (ein tiefer Gleitflug über die
    Altstadtdächer), *Großer Garten* (über dem Palais, dahinter der
    Palaisteich und die Baumkronen des Parks), *Blaues Wunder* (über der
    Elbe, die Brücke spannt sich von Blasewitz nach Loschwitz),
    *Waldschlößchenbrücke* (über den Elbwiesen, flussabwärts die Türme der
    Altstadt) und *Hauptbahnhof* (von oben auf die Bahnsteighallen, die
    Prager Straße führt zur Altstadt); *auf Augenhöhe*: *Canaletto-Blick*
    (auf der Elbwiese, die Altstadt jenseits des Grases), *Elbufer* (am
    baumbestandenen Neustädter Ufer), *Am Japanischen Palais* (auf der
    Neustädter Elbwiese, wo Canaletto malte), *Neumarkt* (vor der
    Frauenkirche) und *Palais im Großen Garten* (am Südende des
    Palaisteichs, jenseits des Wassers das barocke Palais).
  - *Die Wahrzeichen* folgen: die bekanntesten Bauwerke der Stadt, bis zu
    zwölf — die Hofkirche und die Kreuzkirche in Dresden, das Chilehaus
    und St. Michaelis in Hamburg. Die Liste ist nicht von Hand gewählt:
    Sie kommt aus Wikidata (die Bauwerke mit den meisten
    Wikipedia-Artikeln, zugeordnet zu den Gebäuden, die der Viewer
    zeichnet), so bekommt jede Stadt ihre eigene. Ein Wahrzeichen, das ein
    Standpunkt schon zeigt, steht nicht doppelt da — die Frauenkirche ist
    der Standpunkt *Frauenkirche*, Zwinger und Semperoper sind *Zwinger &
    Semperoper* (die Suche findet sie unter ihrem eigenen Namen) —, und
    eine Einrichtung im Gebäude eines bekannteren Wahrzeichens ist dieses
    Wahrzeichen (die Rüstkammer ist das Residenzschloss). Eine
    Wahrzeichen-Zeile gleitet zu einem Blick aus Süd-Südwest, etwas über
    dem Bauwerk und umso höher, je höher es ist.

  *Sicht merken* in der Kopfzeile der Liste merkt sich, wo du stehst:
  *Gemerkte Sicht* steht dann oben in der Liste und springt dorthin
  zurück, mit einem ✕ zum Vergessen.
- **Verkehrsdaten** — bis zu drei Datenebenen über der Stadt, jede mit
  eigenem Schalter, beim Start alle aus; eine Stadt zeigt nur die, für die
  es offene Daten gibt (siehe [Quellen nach Stadt](./sources-by-city.md) und
  [Woher die Daten kommen](./data-sources.md)):
  - *Kfz-Verkehr*: die gezählten Fahrzeuge je Tag als gläserne Ströme auf
    der Fahrbahn, je Richtung einer — breiter, höher und kräftiger gefärbt
    (salbeigrün, pfirsich, koralle, rosé, weinrot), wo mehr fährt, mit
    Licht, das in Fahrtrichtung hindurchläuft. Die Ströme folgen der
    eingestellten Uhrzeit: Die Tageszählung wird nach einem gemessenen
    typischen Tagesgang über den Tag verteilt (nachts schmal und fast
    dunkel, im Berufsverkehr voll und gestaut); unter dem Schalter steht,
    wie viel gerade los ist;
  - *Radverkehr (live)*: an jeder Zählstelle der Stadt zwei Glassäulen, so hoch
    wie die Räder der letzten Stunde je Richtung; darunter die Liste der
    Zählstellen mit ihren Zahlen, ein Klick fliegt hin;
  - *Straßenbahnen (Fahrplan)*: jede Straßenbahn der Stadt, wie der Fahrplan sie zur
    eingestellten Zeit fahren lässt, mit einer Lichtspur dahinter — die
    Zeit läuft von dort an weiter;
    darunter, wie viele gerade unterwegs sind.

  Aus der Luft werden Ströme, Säulen und Spuren breiter und satter, damit
  sie lesbar bleiben.
- **Steuerung** — die vollständige Tastentabelle, eingeklappt, bis du
  sie öffnest (die Leiste über der Szene zeigt die ersten Tasten).

### Szene

- **Sonne & Zeit** — eine Datumsauswahl und ein Tageszeit-Regler. Das
  Farbband des Reglers markiert den echten Sonnenauf- und -untergang
  dieses Tages. Der Sonnenstand wird für Dresden für den gewählten
  Zeitpunkt berechnet; Schatten, Himmel, Nebelfarben und das Abendlicht in
  den Gebäuden folgen ihm. *Standardzeit* springt zurück auf 14:00, die
  Uhrzeit, auf die der Standard-Look abgestimmt ist.
  Darunter die **Verschattungsstudie**: Chips für den 21. März, 21. Juni
  und 21. Dezember des gezeigten Jahres und für 9, 12, 15 und 18 Uhr
  setzen die Sonne mit einem Klick; *Als Blatt speichern* rendert die
  aktuelle Ansicht zu allen zwölf Zeitpunkten und speichert sie als ein
  Blatt — eine Zeile je Tag, eine Spalte je Uhrzeit — mit der Legende
  darunter (im Modell mit Maßstabsleiste und Nordpfeil). Die Uhrzeiten
  sind die Ortszeit deines Geräts.
- **Darstellung** — ganz oben der **Bildstil**, darunter Regler in vier
  aufklappbaren Gruppen. Jeder Regler ist eine Prozentzahl; die
  Voreinstellungen sind der abgestimmte Look. *Zurücksetzen* stellt die
  Regler zurück und lässt den Bildstil, wie er ist.

Der Bildstil zeichnet dieselbe Stadt auf eine andere Art; er lässt sich
jederzeit wechseln, per Klick oder mit `V`. Der Browser merkt sich den
zuletzt gewählten Stil für den nächsten Besuch:

| Bildstil | So sieht er aus |
|---|---|
| *Pastell* | der Grundstil: Tonmodell auf Papier, weiches Licht, keine Umrisse |
| *Comic* | Tuschelinien wie von Hand gezogen — wellig, mal dick, mal dünn, mal abgesetzt, leicht neben der Fläche —, flache Farbflächen in wenigen Tönen, ein Punktraster in den tiefsten Schatten aus der Nähe; die Bäume werden runde Comic-Wolken aus drei Kugeln; aus der Höhe und in der Ferne wird die Zeichnung lockerer und sparsamer |
| *Film noir* | Schwarzweiß mit harter Gradation, rauchige Ferne, ein Himmel, der nach oben dunkel wird, laufendes Filmkorn und ein dunkler Bildrand; unter jeder Straßenlaterne ein weicher Lichtkegel — am Tag nur angedeutet, in der Dämmerung voll; wenn es dunkel wird, blendet die Kamera auf, statt alles schwarz werden zu lassen |
| *Sin City* | harte Flächen in vier Tönen (Schwarz, fast Schwarz, fast Weiß, Weiß), die sich nach der Helligkeit der Umgebung richten, so bleibt auch eine dunkle Ansicht lesbar; Baumkronen und die Elbe werden schwarz, Wiesen bleiben hell, die Skyline und große Silhouetten stehen als weiße Kante gegen das Schwarz; Regen fällt vor der Szene; nur die roten Ziegeldächer behalten Farbe |
| *Papier* | die Stadt als weißes Papiermodell: jede Fläche aus leicht gebrochenem Weiß, echtes Sonnenlicht und echte Schatten (bläulich-grau), feine gezeichnete Graphitkonturen; die Bäume werden gefaltete Karton-Polyeder; Fahrbahnmarkierungen und Sportplatzlinien bleiben als zartes Grau, Wasser als etwas kühleres, tieferes Papier; Lichter und Nebelschleier fallen weg |
| *Strich* | Strichzeichnung wie im Plan: das weiße Modell mit jeder Kante in einer gleich starken Linie, der Schatten als eine hellgraue Lasur, das Gelände in Planfarben (zartes Grün, hellblaues Wasser, fast weiße Straßen), die Bäume aus gefaltetem Karton |
| *Schwarzplan* | die Gebäude schwarz, alles andere weiß, die Bäume des Baumkatasters als Kronenkreise mit Stammpunkt (gemessen, darum nur sie) — keine Schatten, keine Linien; gemacht für den *Lageplan*, überall wählbar |

In den grafischen Stilen *Comic*, *Sin City*, *Strich* und *Schwarzplan*
ruht die Tiefenschärfe (ein unscharfer Hintergrund unter scharfen Linien
wirkt wie ein Fehler); der Schalter bleibt, wie du ihn gesetzt hast.

| Gruppe | Regler | Was er tut |
|---|---|---|
| Atmosphäre | *Nebel* | Entfernungsdunst |
| | *Talnebel* | zusätzlicher Dunst, der sich im tiefen Gelände am Fluss sammelt; liest die echte Geländehöhe und setzt erst in einigem Abstand ein, was direkt vor einem steht, bleibt klar |
| | *Flussnebel* | treibende Nebelschicht über dem Wasser, erst ab etwa 30 m vor dir und mit der Entfernung dichter |
| | *Tiefenfärbung* | warm nah, kühl fern: eine tiefenabhängige Farbgebung |
| Gebäude | *Transparenz* | durch Gebäude hindurchsehen (gerastert), bis 90 % |
| | *Boden-Verlauf* | Abdunkeln der Wände zum Boden hin |
| | *Höhenlinien* | zarte Geschossbänder, aus der gemessenen Höhe abgeleitet |
| | *Streiflicht* | Kantenlicht an sonnenabgewandten Kanten |
| | *Farbvariation* | Wandton je Gebäude aus Nutzung und Höhe |
| | *Dachfarbe* | wie stark die echte (oder synthetische) Dachfarbe durchkommt |
| | *Dachsättigung* | hebt die Sättigung der Luftbild-Dachfarben, ohne den Farbton zu verschieben; 0 = rohes Luftbild |
| | *Traufkante* | eine weiche Linie, wo Wand auf Dach trifft |
| | *Gliederung* | was ein Haus auf Augenhöhe vor seinen Fenstern zeigt, gemalt: eine dunklere Ladenzone, wo ein Laden erfasst ist — keine Fenster. Sockel, Gesims über dem Erdgeschoss und Traufgesims sind modelliert, laufen von Haus zu Haus durch und sind immer da |
| | *Fassadenbild* | was Straßenfotos (Mapillary) über eine Fassade sagen, abstrahiert: ein feines Relief, wo sie unruhig ist, ein Gesims an jedem Geschoss einer unruhigen Gründerzeitfront, ein etwas dunklerer oder hellerer Ton, ein Ladensockel, wo ein Ladenschild hängt — keine Fenster; nur in Dresden, wo Rundumfotos die Fassade zeigen |
| | *Abendlicht* | warme Fenster in Läden und öffentlichen Bauten in der Dämmerung |
| | *Materialstreuung* | Variation zwischen matt und seidig je Gebäude |
| Vegetation | *Bodendetail* | Bordsteine, Rasenkanten, Stellplätze, Fahrbahnmarkierungen (Überwege, Halt-, Rad- und Mittellinien), die Gärten der Kleingartenanlagen und der Belag unter den Füßen (Asphalt, Platten, Kopfsteinpflaster aus OpenStreetMap), die Mähstreifen und Körnung der Sportplätze, aus der Nähe sichtbar |
| | *Stadtgrün* | färbt begrünte Höfe, Vorgärten und Parks im Siedlungsgebiet wie Wiese, aus dem Infrarot-Luftbild |
| | *Wiesenfärbung* | färbt Wiesen saftig bis trocken aus dem Infrarot-Luftbild |
| | *Gegenlicht-Schimmer* | Gegenlichtschimmer auf Kronen zwischen dir und der Sonne |
| | *Blattdurchscheinen* | Durchleuchtung naher, großer Kronen (schattenabhängig) |
| | *Blattflimmern* | Böen drehen Blätter auf sonnigen Kronen auf die helle Unterseite |
| | *Windhelligkeit* | Kronen hellen auf, wenn sie sich in eine Böe neigen |
| | *Multi-Tuft-Kronen (nah)* (Schalter) | reiche Mehrbüschel-Kronen nahe der Kamera; aus = die einfache Krone überall |
| Rendering | *Kontaktschatten* | Umgebungsverdunkelung in Ecken und unter Traufen |
| | *Himmelslicht* | enge Höfe und Straßenschluchten bekommen weniger Himmelslicht als offene Wiesen — aus Gelände und Gebäudemodell vorberechnet |
| | *Ferne Schatten* | Schatten jenseits der gewöhnlichen Schattenreichweite: lange Schatten ferner Häuser und Hänge bei tiefer Sonne, und in der Ferne auch die Schatten der Nachbarhäuser |
| | *Spiegelung* | der Himmel spiegelt sich in Glasfassaden, Vergoldungen und im Wasser; nur der Himmel, nicht die Häuser gegenüber |
| | *Papierkorn* | das Papierkorn über dem ganzen Bild (in *Film noir* und *Sin City* laufendes Filmkorn) |
| | *Tuschelinien* | wie kräftig die Umrisse in *Comic*, *Film noir*, *Sin City*, *Papier* und *Strich* sind |
| | *Tiefenschärfe* (Schalter) | fotografische Tiefenschärfe, nur hinter dem Fokus (der Vordergrund bleibt scharf); *Auto* fokussiert auf die Bildmitte, *Manuell* auf eine feste Entfernung; auf Telefonen nicht angeboten |

Solange sich die Kamera bewegt, ist die Tiefenschärfe-Unschärfe
abgeschaltet (das Auge kann sie in Bewegung nicht auflösen) und kommt
zurück, sobald du stehst. Telefone bieten den Schalter gar nicht an: Die
Unschärfe braucht mehr Grafikspeicher, als ein Telefon für einen Hauch
erübrigen kann, den ein kleiner Bildschirm kaum zeigt.

### Erweitert

- **Werkzeuge** — *Gebäude in der Bildmitte abreißen* entfernt das
  Gebäude, das du anschaust (`R` das unter dem Mauszeiger), auf jeder Kachel im Blick; das
  lässt sich nicht rückgängig machen. *Bild speichern* speichert die
  Ansicht als PNG mit ihren Quellen (siehe [Modell](#modell-die-stadt-als-planzeichnung)). *Immersiver Modus* fängt den
  Mauszeiger für ein Ego-Perspektive-Gefühl ein; `Esc` verlässt ihn.
- **Snapshot** — *Kopieren* kopiert deine genaue Position, Datum und Uhrzeit,
  den Bildstil und jeden Regler als kleinen JSON-Text; einen solchen Text in das Feld
  einfügen und *Anwenden* drücken stellt ihn wieder her. So wird eine
  bestimmte Ansicht geteilt oder für einen Screenshot reproduziert. Ein
  fehlerhafter Snapshot wird mit einer Meldung abgelehnt, statt die Szene
  zu zerstören.
- **Statistik** — Anzahl der Gebäude und Geländepunkte, die gerade im
  Blick sind, geschätzter Grafikspeicher und die Bildrate.

Die Fußzeile nennt die Datenquellen: die Landesvermessung (in Dresden
die sächsische) für die amtlichen Datensätze und die
OpenStreetMap-Mitwirkenden unter anderem für Lampen, Mauern und Zäune,
Bahnsteige, Brückentragwerke, Läden und Baudenkmale (und die
Landbedeckung, wo das Land kein Basis-DLM veröffentlicht). Daneben führt
*Unterstützen* zur Ko-fi-Seite des Projekts; es ist ein einfacher Link,
der erst beim Klick etwas von Ko-fi lädt.

## Tipps

- Beurteile das Bild aus **schrägen Blickwinkeln**, nicht senkrecht von
  oben; so prüfen es auch die Betreiber.
- Goldene Stunde (Sonne wenige Grad über dem Horizont) und blaue Stunde
  (wenige Grad darunter) geben die reichsten Farben; probiere 07:00 oder
  20:00 im Sommer.
- Auf einem Laptop ohne eigene Grafikkarte senke *Kontaktschatten* und
  schalte *Tiefenschärfe* aus, um mehr Bilder pro Sekunde zu bekommen.
- `?scene=lite` hinter der Adresse der Stadt (`/dresden?scene=lite`)
  streamt nur die Startkachel, mit groben Schatten. Das ist für automatische Tests gedacht und nicht, wie
  die Szene aussehen soll.

## Wenn es abstürzt

Ein Telefon kann die Seite beenden, wenn die Stadt mehr Speicher braucht,
als es ihr zugesteht; die Seite verschwindet dann einfach oder lädt neu.
Beim nächsten Besuch sagt eine Karte, dass die letzte Sitzung unerwartet
beendet wurde, und zeigt ihr Protokoll: was geladen war, die Bildrate und
den Speicher ihrer letzten Sekunden.

Fällt die Grafik aus – ein Telefon entzieht dem Browser den
Grafikspeicher –, baut sich der Viewer dort, wo du standest, **eine Stufe
leichter** wieder auf: ein etwas weicheres Bild, gröberes Gelände in der
Ferne, weniger Teile der Stadt im Speicher und ab der zweiten Stufe ohne
den Bildstil oder das *Modell*, in dem du warst. Das merkt er sich für
dein Gerät (auch ein Absturz, der den letzten Besuch beendet hat, zählt)
und kehrt nach ein paar Tagen von selbst zu vollen Details zurück, alle
drei Tage um eine Stufe. Fällt die Grafik auf der leichtesten Stufe
wieder aus, sagt eine Karte *Die Grafik ist ausgefallen* und bietet
*Leichter weiter* (eine Stufe leichter, zurück, wo du standest) und *Neu
laden* an. Auch einer Seite, die eine Weile im Hintergrund lag, kann ein
Telefon die Grafik nehmen; dann lädt der Viewer einfach auf derselben
Stufe neu.

**Wenn die Verbindung abreißt**, versucht es der Viewer von selbst
weiter: Teile der Stadt, die nicht laden konnten, fehlen vorerst oder
sind nur grob da, oben steht kurz *Keine Verbindung zum Server — ein Teil
der Stadt fehlt, neuer Versuch folgt.*, und die Lücken schließen sich,
sobald die Verbindung wieder da ist. Ein Start ohne Verbindung wartet,
solange dein Gerät offline ist; antwortet der Server auch online nicht,
sagt der Viewer nach einer Weile (20 Sekunden bis eine Minute) *Keine
Verbindung zum Server* und bietet *Erneut versuchen* an.

Wo diese Seite dafür eingerichtet ist, geht dieses Protokoll auch von
selbst an einen Fehlerdienst (Sentry), dazu Fehler, auf die der Viewer
stößt, und zu jedem Besuch ein paar Zahlen darüber, wie er lief: wie lange
bis zum ersten Bild und bis alles geladen war, die Bildrate, der meiste
belegte Speicher und ob er normal oder mit einem Absturz endete. So werden die langsamen und die abstürzenden Telefone
sichtbar. Ein Bericht enthält Browser- und Gerätetyp, die
Bildschirmgröße, welche Stadt (ohne den Rest der Adresse), die Stufe, auf
der der Viewer auf deinem Gerät läuft, und diese Zahlen
— nie deinen Standort oder wo in der Stadt du warst, keinen Namen, keine
IP-Adresse und kein Cookie. Sendet dein Browser *Global Privacy Control*,
wird nichts geschickt, und der Schalter auf der Datenschutzseite
(*Datenschutz*, verlinkt am Fuß jeder Seite und der
Seitenleiste) schaltet die Berichte für deinen Browser sofort aus. Dort
steht auch, wer die Seite betreibt, wo die Berichte liegen und wie lange.
Ist kein Fehlerdienst eingerichtet, bietet die Karte das Protokoll
stattdessen zum Kopieren an.

## Kleinigkeiten

- **Lauschen.** Drücke **L** (oder schalte auf dem Telefon ganz unten in
  *Erweitert* *Klang (experimentell)* ein), und die Stadt klingt leise:
  Wind, die Elbe, Vögel am Tag und Grillen in Sommernächten, Schritte, die
  das Pflaster unter den Füßen kennen — und wenn du die Uhr über eine
  volle Stunde schiebst, schlagen die Kirchen in der Nähe sie, jede ein
  wenig später, je weiter sie entfernt steht, so wie der Schall reist. Bei
  jedem Laden der Seite ist er aus, in einem Hintergrund-Tab verstummt er,
  und der kleine Lautsprecher oben links schaltet ihn wieder aus.
