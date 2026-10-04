import type { Metadata } from "next";
import { LegalDoc } from "../_lib/legal-doc";

export const metadata: Metadata = {
  title: "Impressum — City Walk",
  description: "Anbieterkennzeichnung von City Walk.",
  alternates: { canonical: "/impressum" },
};

/** The Impressum (§ 5 DDG, § 18 MStV): impressum.md beside this file. */
export default function ImpressumPage() {
  return <LegalDoc name="impressum" />;
}
