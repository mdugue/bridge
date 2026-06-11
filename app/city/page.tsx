import type { Metadata } from "next";
import { CityWalkClient } from "./_components/city-walk-client";

export const metadata: Metadata = {
  title: "City Walk POC — Dresden",
  description:
    "Walkable LoD1 city model on DGM terrain with sun/shadow simulation",
};

export default function CityPage() {
  return (
    <main className="h-dvh w-full">
      <CityWalkClient />
    </main>
  );
}
