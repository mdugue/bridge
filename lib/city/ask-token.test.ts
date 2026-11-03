import { expect, test } from "bun:test";
import { issueAskToken, verifyAskToken } from "./ask-token";

const SECRET = "test-secret-0123456789";
const KEY = "sk-ant-api03-0123456789abcdef";

test("a token holds for its key and provider until it expires", async () => {
  const token = await issueAskToken(SECRET, "anthropic", KEY, 2_000);
  expect(token.startsWith("v1.2000.")).toBe(true);
  expect(token).not.toContain(KEY);
  expect(await verifyAskToken(SECRET, token, "anthropic", KEY, 1_000)).toBe(
    true
  );
  expect(await verifyAskToken(SECRET, token, "anthropic", KEY, 3_000)).toBe(
    false
  );
  expect(await verifyAskToken(SECRET, token, "openai", KEY, 1_000)).toBe(false);
  expect(
    await verifyAskToken(SECRET, token, "anthropic", `${KEY}x`, 1_000)
  ).toBe(false);
  expect(
    await verifyAskToken("other-secret-0123", token, "anthropic", KEY, 1_000)
  ).toBe(false);
});

test("a forged or malformed token fails", async () => {
  const token = await issueAskToken(SECRET, "anthropic", KEY, 2_000);
  const [, , sig] = token.split(".");
  // a later expiry with the old signature
  expect(
    await verifyAskToken(SECRET, `v1.9999999.${sig}`, "anthropic", KEY, 1_000)
  ).toBe(false);
  for (const bad of ["", "v1", "v2.2000.x", "v1.abc.x", "v1.2000."]) {
    expect(await verifyAskToken(SECRET, bad, "anthropic", KEY, 1_000)).toBe(
      false
    );
  }
});
