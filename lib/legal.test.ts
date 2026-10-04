import { expect, test } from "bun:test";
import { addressLines, operatorFrom, trackerOf } from "./legal";

const full = {
  IMPRESSUM_NAME: " Erika Mustermann ",
  IMPRESSUM_ADDRESS: "Musterstraße 1, 01067 Dresden",
  IMPRESSUM_EMAIL: "post@example.org",
};

test("the operator comes from the build's environment, trimmed", () => {
  expect(operatorFrom(full)).toEqual({
    operator: {
      name: "Erika Mustermann",
      address: ["Musterstraße 1", "01067 Dresden"],
      email: "post@example.org",
    },
    missing: [],
  });
  expect(
    operatorFrom({ ...full, IMPRESSUM_PHONE: "+49 351 000000" }).operator?.phone
  ).toBe("+49 351 000000");
});

test("an incomplete operator is none, and names what is missing", () => {
  expect(operatorFrom({ ...full, IMPRESSUM_ADDRESS: "  " })).toEqual({
    operator: null,
    missing: ["IMPRESSUM_ADDRESS"],
  });
  expect(operatorFrom({}).missing).toEqual([
    "IMPRESSUM_NAME",
    "IMPRESSUM_ADDRESS",
    "IMPRESSUM_EMAIL",
  ]);
});

test("an address splits by newline, a written \\n, or else by comma", () => {
  expect(addressLines("c/o Atelier, Musterstraße 1\n01067 Dresden")).toEqual([
    "c/o Atelier, Musterstraße 1",
    "01067 Dresden",
  ]);
  expect(addressLines("Musterstraße 1\\n01067 Dresden")).toEqual([
    "Musterstraße 1",
    "01067 Dresden",
  ]);
  expect(addressLines("Musterstraße 1, 01067 Dresden, ")).toEqual([
    "Musterstraße 1",
    "01067 Dresden",
  ]);
});

test("a DSN names Sentry's region, or another tracker's host", () => {
  expect(trackerOf("https://key@o1.ingest.de.sentry.io/42")).toEqual({
    kind: "sentry",
    region: "eu",
  });
  expect(trackerOf("https://key@o1.ingest.us.sentry.io/42")).toEqual({
    kind: "sentry",
    region: "us",
  });
  expect(trackerOf("https://key@o1.ingest.sentry.io/42")).toEqual({
    kind: "sentry",
    region: "us",
  });
  expect(trackerOf("https://key@glitchtip.example.org/3")).toEqual({
    kind: "other",
    host: "glitchtip.example.org",
  });
  expect(trackerOf(null)).toBeNull();
  expect(trackerOf("not a dsn")).toBeNull();
});
