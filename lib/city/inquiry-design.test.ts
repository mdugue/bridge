import { describe, expect, test } from "bun:test";
import { designCard, type DesignInquiry, ifcTypeWord } from "./inquiry-design";

const asked: DesignInquiry = {
  kind: "design",
  file: "neubau.ifc",
  part: {
    name: "Außenwand Nord",
    type: "IfcWallStandardCase",
    id: "2O2Fr$t4X7Zf8NOew3FLOH",
    material: null,
  },
  partIndex: 3,
  placement: { east: 412_300.04, north: 5_657_420, base: 112.3, rotation: 15 },
  source: "file",
  triangles: 12_345,
  position: [412_301, 5_657_421],
};

describe("a design's card", () => {
  test("an IFC element: its word and entity, its GlobalId", () => {
    const card = designCard(asked);
    expect(card.kicker).toBe("Entwurf");
    expect(card.title).toBe("Außenwand Nord");
    expect(card.id).toBe("2O2Fr$t4X7Zf8NOew3FLOH");
    expect(card.idLabel).toBe("IFC-GlobalId");
    const facts = Object.fromEntries(card.facts.map((f) => [f.label, f.value]));
    expect(facts.Bauteil).toBe("Wand (IfcWallStandardCase)");
    expect(facts.Rechtswert).toBe("412.300,0 m");
    expect(facts.Drehung).toBe("15,0° im Uhrzeigersinn");
    expect(facts.Datei).toBe("neubau.ifc");
    expect(card.sources[0].text).toContain("nur auf diesem Gerät");
  });

  test("a plan's surface: its class as the title, the place as its key", () => {
    const card = designCard({
      ...asked,
      file: "park.dxf",
      part: { name: null, type: "Rasen", id: null, material: null },
      placement: { ...asked.placement, rotation: 0 },
      source: "here",
    });
    expect(card.title).toBe("Rasen");
    expect(card.idLabel).toBe("Lage");
    const facts = Object.fromEntries(
      card.facts.map((f) => [f.label, [f.value, f.method]])
    );
    expect(facts.Fläche).toEqual(["Rasen", undefined]);
    expect(facts.Drehung).toBeUndefined();
    expect(facts.Platziert?.[1]).toBe("assumed");
  });

  test("IFC entities by their word", () => {
    expect(ifcTypeWord("IFCWINDOW")).toBe("Fenster");
    expect(ifcTypeWord("IFCSOMETHINGNEW")).toBe("Bauteil");
    expect(ifcTypeWord("Rasen")).toBeNull();
    expect(ifcTypeWord(null)).toBeNull();
  });
});
