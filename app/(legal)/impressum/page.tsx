import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, routeOf } from "@/lib/docs/routes";
import { type Operator, operatorFrom } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Impressum — City Walk",
  description: "Anbieterkennzeichnung von City Walk.",
  alternates: { canonical: "/impressum" },
};

/**
 * The Impressum (§ 5 DDG, § 18 MStV) of this deployment: its operator comes
 * from the build's environment (lib/legal.ts, ADR 0045), never from the
 * repository. A build without one says so rather than show a stranger's.
 */
export default function ImpressumPage() {
  const { operator, missing } = operatorFrom(process.env);
  return (
    <>
      <h1>Impressum</h1>
      {operator ? (
        <OperatorDetails operator={operator} />
      ) : (
        <p data-testid="operator-missing">
          Für diese Installation sind die Angaben zum Anbieter nicht hinterlegt
          (es fehlen {missing.join(", ")}).
        </p>
      )}

      <h2>Geodaten und Quellcode</h2>
      <p>
        Die Städte entstehen aus offenen Geodaten der Länder und Städte und aus
        OpenStreetMap. Jede Quelle steht mit ihrer Lizenz und ihrem
        Quellenvermerk unter{" "}
        <Link href={routeOf("docs/guide/de/data-sources.md") ?? "/wissen"}>
          Datenquellen
        </Link>{" "}
        und im Viewer unten in der Seitenleiste. Der Quellcode ist unter der
        Apache-Lizenz 2.0 <a href={REPO_URL}>auf GitHub</a> veröffentlicht.
      </p>

      <h2>Datenschutz</h2>
      <p>
        Welche Daten beim Besuch anfallen und wohin sie gehen, steht in der{" "}
        <Link href="/datenschutz">Datenschutzerklärung</Link>.
      </p>
    </>
  );
}

function OperatorDetails({ operator }: { operator: Operator }) {
  return (
    <>
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        {operator.name}
        {operator.address.map((line) => (
          <span key={line}>
            <br />
            {line}
          </span>
        ))}
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
        {operator.phone ? (
          <>
            <br />
            Telefon:{" "}
            <a href={`tel:${operator.phone.replaceAll(/[^+\d]/g, "")}`}>
              {operator.phone}
            </a>
          </>
        ) : null}
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>{operator.name}, Anschrift wie oben.</p>
    </>
  );
}
