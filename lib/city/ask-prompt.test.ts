import { expect, test } from "bun:test";
import { askSystemPrompt } from "./ask-prompt";
import type { AskPromptSite } from "./ask-prompt";

const SITE: AskPromptSite = { epsg: 25_833, label: "Dresden", layers: [] };
const TODAY = new Date(2026, 9, 31, 12);

test("the prompt names the site, the date and the rules", () => {
  const prompt = askSystemPrompt(SITE, TODAY);
  expect(prompt).toContain("Dresden");
  expect(prompt).toContain("EPSG:25833");
  expect(prompt).toContain("31. Oktober 2026");
  expect(prompt).toContain("Legenden als Legenden");
  expect(prompt).toContain("`zeige`");
});

test("the layer tool is named only where the city has layers", () => {
  const none = askSystemPrompt(SITE, TODAY);
  expect(none).toContain("keine Datenebenen");
  expect(none).not.toContain("`datenschicht`");

  const some = askSystemPrompt(
    {
      ...SITE,
      layers: [{ key: "tramLayer", label: "Bahnen", description: "Fahrplan" }],
    },
    TODAY
  );
  expect(some).toContain("`datenschicht`");
  expect(some).not.toContain("keine Datenebenen");
});
