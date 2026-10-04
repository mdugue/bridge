import type { Metadata } from "next";
import { LegalDoc } from "../_lib/legal-doc";

export const metadata: Metadata = {
  title: "Datenschutz — City Walk",
  description:
    "Welche Daten beim Besuch von City Walk anfallen, wohin sie gehen und wie du widersprichst.",
  alternates: { canonical: "/datenschutz" },
};

/**
 * The privacy policy (Art. 13 DSGVO): datenschutz.md beside this file. It
 * describes what the code does — a new request to a third party, a new
 * field in a report or a new key in the browser's storage is not done
 * until that file says so (ADR 0045).
 */
export default function DatenschutzPage() {
  return <LegalDoc name="datenschutz" />;
}
