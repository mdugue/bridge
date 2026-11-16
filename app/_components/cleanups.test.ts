import { expect, test } from "bun:test";
import { runCleanups } from "./cleanups";

test("cleanups unwind in reverse, and one that throws keeps none back", () => {
  const ran: string[] = [];
  const broken = new Error("half-made attribute");
  expect(() =>
    runCleanups([
      () => {
        ran.push("first");
      },
      () => {
        throw broken;
      },
      () => {
        ran.push("last");
      },
    ])
  ).toThrow(broken);
  expect(ran).toEqual(["last", "first"]);
});

const twoFail = () =>
  runCleanups([
    () => {
      throw new Error("a");
    },
    () => {
      throw new Error("b");
    },
  ]);

test("several failures come back together", () => {
  expect(twoFail).toThrow(AggregateError);
});

test("a clean unwind throws nothing", () => {
  expect(() => runCleanups([() => {}])).not.toThrow();
});
