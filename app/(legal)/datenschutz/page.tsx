import type { Metadata } from "next";
import Link from "next/link";
import { reportBuild } from "@/lib/city/crash-reports";
import {
  type Operator,
  operatorFrom,
  type Tracker,
  trackerOf,
} from "@/lib/legal";
import { ReportsChoice } from "../../_components/reports-choice";

export const metadata: Metadata = {
  title: "Datenschutz — City Walk",
  description:
    "Welche Daten beim Besuch von City Walk anfallen, wohin sie gehen und wie du widersprichst.",
  alternates: { canonical: "/datenschutz" },
};

/**
 * The privacy policy of this deployment (ADR 0045). What varies by build
 * comes from its environment, as the pages that use it read it: the
 * operator (lib/legal.ts) and where the crash reports go — Sentry's
 * region from the DSN, or nothing without one (ADR 0043). Everything else
 * describes what the code does; a new request to a third party, or a new
 * kind of data in a report, is not done until it is described here.
 */
export default function DatenschutzPage() {
  const { operator } = operatorFrom(process.env);
  const tracker = trackerOf(reportBuild(process.env).dsn);
  return (
    <>
      {/* a soft hyphen: on a phone the word is wider than the column */}
      <h1>Datenschutz{"\u00AD"}erklärung</h1>
      <Summary reports={tracker !== null} />
      <Controller operator={operator} />
      <Hosting />
      {tracker ? <Reports tracker={tracker} /> : <NoReports />}
      <Storage />
      <Location />
      <LiveData />
      <FontsAndLinks />
      <Rights />
      <p>
        <small>Stand: Oktober 2026</small>
      </p>
    </>
  );
}

function Summary({ reports }: { reports: boolean }) {
  return (
    <>
      <p>Kurz gesagt:</p>
      <ul>
        <li>
          City Walk hat keine Konten, setzt keine Cookies, zeigt keine Werbung
          und verfolgt dich nicht über Seiten hinweg.
        </li>
        <li>
          Wie bei jeder Website verarbeitet der Hoster beim Aufruf technische
          Verbindungsdaten, darunter deine IP-Adresse.
        </li>
        {reports ? (
          <li>
            Damit Abstürze und langsame Geräte auffallen, schickt der Viewer
            Fehler- und Leistungsberichte – ohne Standort und ohne IP-Adresse.
            Du kannst sie <a href="#fehlerberichte">unten ausschalten</a>.
          </li>
        ) : null}
        <li>Dein Standort verlässt dein Gerät nie.</li>
      </ul>
    </>
  );
}

function Controller({ operator }: { operator: Operator | null }) {
  return (
    <>
      <h2>Verantwortlich</h2>
      {operator ? (
        <p>
          Verantwortlich für die Verarbeitung im Sinne der
          Datenschutz-Grundverordnung (DSGVO) ist:
          <br />
          {operator.name}
          {operator.address.map((line) => (
            <span key={line}>
              <br />
              {line}
            </span>
          ))}
          <br />
          E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
        </p>
      ) : (
        <p>
          Verantwortlich ist der im <Link href="/impressum">Impressum</Link>{" "}
          genannte Anbieter; für diese Installation sind seine Angaben nicht
          hinterlegt.
        </p>
      )}
    </>
  );
}

function Hosting() {
  return (
    <>
      <h2>Aufruf der Seite und Hosting</h2>
      <p>
        Diese Seite wird von Vercel Inc., 440 N Barranca Avenue #4133, Covina,
        CA 91723, USA, ausgeliefert. Wenn du sie aufrufst, schickt dein Browser
        technisch notwendige Daten an Vercels Server: deine IP-Adresse, Datum
        und Uhrzeit, die aufgerufene Adresse, die zuvor besuchte Seite
        (Referrer), soweit dein Browser sie mitschickt, sowie Browser und
        Betriebssystem (User-Agent). Ohne sie lässt sich die Seite nicht
        ausliefern. Vercel verarbeitet sie, um die Seite auszuliefern und vor
        Missbrauch zu schützen, und hält sie dafür kurze Zeit in Protokollen
        vor. Wir legen keine eigenen Protokolle an und werten keine aus.
      </p>
      <p>
        Rechtsgrundlage ist unser berechtigtes Interesse an einer sicheren und
        zuverlässigen Auslieferung der Seite (Art. 6 Abs. 1 lit. f DSGVO).
        Vercel verarbeitet die Daten in unserem Auftrag (Art. 28 DSGVO). Dabei
        können Daten in die USA übermittelt werden; Vercel ist nach dem EU-US
        Data Privacy Framework zertifiziert, für das die EU-Kommission ein
        angemessenes Datenschutzniveau festgestellt hat (Art. 45 DSGVO).
      </p>
    </>
  );
}

/** Where a report is kept, by the tracker the DSN names. */
function storedAt(tracker: Tracker) {
  if (tracker.kind === "other") {
    return (
      <>
        an den Fehlerdienst unter <code>{tracker.host}</code> weitergeleitet,
        der sie in unserem Auftrag verarbeitet (Art. 28 DSGVO) und löscht,
        sobald sie für die Fehlersuche nicht mehr gebraucht werden.
      </>
    );
  }
  return (
    <>
      an Sentry weitergeleitet: Functional Software, Inc., 45 Fremont Street,
      8th Floor, San Francisco, CA 94105, USA. Sentry verarbeitet sie in unserem
      Auftrag (Art. 28 DSGVO),{" "}
      {tracker.region === "eu"
        ? "speichert sie auf Servern in Deutschland"
        : "speichert sie auf Servern in den USA"}{" "}
      und löscht sie spätestens nach 90 Tagen. Für Übermittlungen in die USA ist
      Sentry nach dem EU-US Data Privacy Framework zertifiziert (Art. 45 DSGVO).
    </>
  );
}

function Reports({ tracker }: { tracker: Tracker }) {
  return (
    <>
      <h2 id="fehlerberichte">Fehler- und Leistungsberichte</h2>
      <p>
        Der Viewer läuft auf sehr unterschiedlichen Geräten, und gerade auf
        Telefonen stürzt er manchmal ab oder ruckelt. Damit das auffällt und
        behoben werden kann, schickt er Berichte:
      </p>
      <ul>
        <li>wenn der vorige Besuch abgestürzt ist (beim nächsten Besuch),</li>
        <li>wenn ein Fehler auftritt (höchstens fünf je Besuch),</li>
        <li>
          je Besuch eine Zusammenfassung, wie er lief: Zeit bis zum ersten Bild
          und bis alles geladen war, Bildrate, belegter Speicher,
        </li>
        <li>Beginn und Ende des Besuchs, normal oder mit Absturz.</li>
      </ul>
      <p>
        Ein Bericht enthält Browser, Betriebssystem und Gerätetyp (User-Agent),
        Bildschirmgröße und Pixeldichte, den ungefähren Arbeitsspeicher des
        Geräts, die Grafikschnittstelle (WebGPU oder WebGL2), die aufgerufene
        Seite ohne Parameter (etwa <code>/dresden</code>), den Verlauf des
        Besuchs (Ladeschritte, Fehlermeldungen, Bildrate, Speicher, geladene
        Kacheln, Bildstil, Gehen oder Fliegen, Höhe der Kamera über dem Boden),
        Zeitpunkte, eine zufällige Kennung des einzelnen Seitenaufrufs und die
        Version der Seite.
      </p>
      <p>
        Er enthält <strong>nicht</strong> deinen Standort oder wo in der Stadt
        du warst, keine IP-Adresse, keinen Namen, kein Cookie und keine Kennung,
        die dich bei einem späteren Besuch wiedererkennt.
      </p>
      <p>
        Damit ein Absturz auch dann gemeldet werden kann, wenn der Browser die
        Seite hart beendet, hält der Viewer den Verlauf des Besuchs im lokalen
        Speicher deines Browsers fest; der nächste Besuch schickt ihn und bietet
        ihn dir zum Kopieren an.
      </p>
      <p>
        Die Berichte gehen zuerst an diese Seite selbst (an die Adresse{" "}
        <code>/r/e</code>) und werden von dort über Vercel {storedAt(tracker)}{" "}
        Die Berichte enthalten keine IP-Adresse, und der Fehlerdienst ist so
        eingestellt, dass er keine speichert.
      </p>
      <p>
        Rechtsgrundlage ist unser berechtigtes Interesse an einem Viewer, der
        auf möglichst vielen Geräten stabil läuft, und daran, Abstürze und
        Fehler zu finden und zu beheben (Art. 6 Abs. 1 lit. f DSGVO). Soweit
        dafür Informationen auf deinem Gerät gespeichert oder ausgelesen werden
        – der Verlauf im lokalen Speicher, die Angaben zu Gerät und Bildschirm
        –, ist das für den stabilen Betrieb des Viewers, den du aufgerufen hast,
        unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).
      </p>
      <p>
        Du kannst den Berichten jederzeit ohne Angabe von Gründen widersprechen:
        mit dem Schalter hier, der für diesen Browser sofort gilt, oder indem
        dein Browser Global Privacy Control sendet – dann wird nie etwas
        gesendet.
      </p>
      <ReportsChoice />
    </>
  );
}

function NoReports() {
  return (
    <>
      <h2 id="fehlerberichte">Fehlerberichte</h2>
      <p>
        In dieser Installation sind keine Fehlerberichte eingerichtet: Es geht
        nichts an einen Fehlerdienst. Nach einem Absturz bietet der Viewer den
        Verlauf des Besuchs nur zum Kopieren an; er bleibt in deinem Browser.
      </p>
    </>
  );
}

function Storage() {
  return (
    <>
      <h2>Was in deinem Browser bleibt</h2>
      <p>
        Diese Seite setzt keine Cookies. Im lokalen Speicher deines Browsers
        (Local Storage und Session Storage) legt sie nur ab, was ihre Funktionen
        brauchen, und liest es nur auf deinem Gerät:
      </p>
      <ul>
        <li>den zuletzt gewählten Bildstil,</li>
        <li>
          ob du die Bedienhinweise geschlossen und die Werkzeugleiste
          eingeklappt hast,
        </li>
        <li>
          den Verlauf des laufenden und des vorigen Besuchs (siehe{" "}
          <a href="#fehlerberichte">Fehlerberichte</a>),
        </li>
        <li>deine Wahl zu den Fehlerberichten,</li>
        <li>
          wenn sich die Seite nach einem Grafikfehler selbst neu lädt, bis du
          den Tab schließt: die Stelle, an der du in der Stadt standest, und
          wann das war – damit sie dich dorthin zurückbringt und nicht endlos
          neu lädt.
        </li>
      </ul>
      <p>
        Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG: Diese Einträge sind für die
        Funktionen, die du nutzt, unbedingt erforderlich. Du kannst sie
        jederzeit in den Einstellungen deines Browsers löschen.
      </p>
    </>
  );
}

function Location() {
  return (
    <>
      <h2>Standort und Kompass</h2>
      <p>
        Die Werkzeuge <em>Standort</em> und <em>Live</em> fragen nach deinem
        Standort und der Ausrichtung deines Telefons – erst, wenn du sie
        antippst, und nur mit deiner Erlaubnis im Browser (Art. 6 Abs. 1 lit. a
        DSGVO, § 25 Abs. 1 TDDDG). Beides wird nur in deinem Browser verwendet,
        um dich in die Stadt zu setzen, und nie an uns oder Dritte gesendet;
        auch die Fehlerberichte enthalten es nicht. Wie dein Browser den
        Standort bestimmt – manche fragen dafür einen Ortungsdienst ihres
        Herstellers –, liegt bei deinem Browser. Die Erlaubnis kannst du in
        seinen Einstellungen jederzeit widerrufen.
      </p>
    </>
  );
}

function LiveData() {
  return (
    <>
      <h2>Live-Daten der Städte</h2>
      <p>
        Die Datenebenen sind beim Start alle aus. Schaltest du in Dresden oder
        Hamburg <em>Radverkehr (live)</em> ein, holt dein Browser die aktuellen
        Zählwerte direkt bei der Stadt ab: in Dresden bei der Landeshauptstadt
        Dresden (<code>kommisdd.dresden.de</code>), in Hamburg bei der Freien
        und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (
        <code>iot.hamburg.de</code>). Wie bei jedem Aufruf einer Website
        erhalten diese Stellen dabei deine IP-Adresse und Angaben zu deinem
        Browser; uns erreicht davon nichts. Es gelten die Datenschutzhinweise
        der jeweiligen Stadt. Rechtsgrundlage ist unser berechtigtes Interesse,
        die Ebene, die du eingeschaltet hast, mit aktuellen Zahlen zu zeigen
        (Art. 6 Abs. 1 lit. f DSGVO).
      </p>
    </>
  );
}

function FontsAndLinks() {
  return (
    <>
      <h2>Schriften und Links</h2>
      <p>
        Die Schriften liefert diese Seite selbst aus; es besteht keine
        Verbindung zu Google Fonts oder einem anderen Schriftdienst. Links zu
        anderen Angeboten – etwa <em>Unterstützen</em> (Ko-fi) oder GitHub –
        laden nichts, bevor du sie anklickst; danach gilt die
        Datenschutzerklärung des jeweiligen Anbieters.
      </p>
    </>
  );
}

function Rights() {
  return (
    <>
      <h2>Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16),
        Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und
        Datenübertragbarkeit (Art. 20). Einer Verarbeitung auf Grundlage
        berechtigter Interessen kannst du aus Gründen, die sich aus deiner
        besonderen Situation ergeben, widersprechen (Art. 21) – den
        Fehlerberichten jederzeit und ohne Begründung mit dem Schalter oben.
        Eine Einwilligung kannst du jederzeit für die Zukunft widerrufen (Art. 7
        Abs. 3). Schreib dafür an die oben genannte Adresse.
      </p>
      <p>
        Weil die Berichte keine Kennung enthalten, die auf dich verweist, können
        wir einzelne Berichte in der Regel nicht dir zuordnen (Art. 11 DSGVO).
      </p>
      <p>
        Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde
        beschweren (Art. 77 DSGVO), etwa bei der deines Wohnorts.
      </p>
      <p>
        Die Bereitstellung deiner Daten ist weder gesetzlich noch vertraglich
        vorgeschrieben; ohne die Verbindungsdaten lässt sich die Seite aber
        nicht ausliefern. Eine automatisierte Entscheidungsfindung oder ein
        Profiling findet nicht statt.
      </p>
    </>
  );
}
