import { expect, test } from "@playwright/test";

// Software-rendered WebGL so the smoke test also runs on headless CI boxes
// without a GPU (ANGLE -> SwiftShader).
test.use({
  launchOptions: {
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
});

test("city page serves the viewer shell", async ({ page }) => {
  await page.goto("/city");
  // Either the loading overlay, the ready HUD, or a loud error — never blank.
  await expect(
    page
      .locator("main")
      .filter({ has: page.locator("div") })
      .first()
  ).toBeVisible();
});

test("city walk renders buildings, terrain and shadows", async ({ page }) => {
  // Software-rendered WebGL plus the post-processing stack (SSAO, tilt-shift)
  // makes every frame expensive on CI machines without a GPU.
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto("/city");

  const webglAvailable = await page.evaluate(() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  });
  // biome-ignore lint/suspicious/noSkippedTests: conditional runtime skip — render assertions are meaningless without WebGL, but the spec still runs everywhere it can
  test.skip(
    !webglAvailable,
    "WebGL is genuinely unavailable in this environment — render assertions skipped"
  );

  // Debug hook (dev/test builds only) is set after the first successful load.
  // Waited on first: in dev, React StrictMode briefly runs a second, aborted
  // viewer instance whose canvas would trip a strict locator during loading.
  await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
    timeout: 120_000,
  });

  // Renderer booted -> exactly one sized WebGL canvas (the minimap adds
  // 2D canvases of its own; three.js tags its canvas with data-engine).
  const canvas = page.locator("canvas[data-engine]");
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  const poc = await page.evaluate(() => window.__poc);
  expect(poc?.buildingCount ?? 0).toBeGreaterThan(0);
  expect(poc?.terrainVertexCount ?? 0).toBeGreaterThan(0);
  expect(poc?.shadowsEnabled).toBe(true);

  // Demolish end to end: hover the camera over a real building, aim straight
  // down and trigger the crosshair demolition — the building count must drop.
  const cityDoc = (await (
    await page.request.get("/data/lod1_33412_5656_2_sn.city.json")
  ).json()) as {
    CityObjects: Record<
      string,
      { type: string; geographicalExtent?: number[] }
    >;
  };
  const target = Object.values(cityDoc.CityObjects).find(
    (o) => o.type === "Building" && o.geographicalExtent
  );
  expect(target?.geographicalExtent).toBeDefined();
  const [minX, minY, minZ, maxX, maxY, maxZ] = target?.geographicalExtent ?? [];
  const buildingsBefore = poc?.buildingCount ?? 0;
  await page.evaluate(
    ([easting, northing, midHeight, top]) => {
      const api = window.__poc;
      if (!(api?.flyTo && api.demolishAtCrosshair && api.offset)) {
        throw new Error("debug api incomplete");
      }
      // EPSG:25833 -> world: x = X - cx, z = -(Y - cy), y = elevation.
      const x = easting - api.offset.cx;
      const z = -(northing - api.offset.cy);
      // Approach at an angle (not straight down: a view direction parallel
      // to the camera's up vector makes lookAt degenerate) and aim the
      // crosshair at the building's mid-height.
      api.flyTo({ x, y: top + 120, z: z + 80 }, { x, y: midHeight, z });
      api.demolishAtCrosshair();
    },
    [
      ((minX ?? 0) + (maxX ?? 0)) / 2,
      ((minY ?? 0) + (maxY ?? 0)) / 2,
      ((minZ ?? 0) + (maxZ ?? 0)) / 2,
      maxZ ?? 0,
    ]
  );
  await page.waitForFunction(
    (before) => (window.__poc?.buildingCount ?? 0) < before,
    buildingsBefore,
    { timeout: 30_000 }
  );

  // Minimap teleport: the map is 192 px over the 2 km tile, so clicking
  // (48, 48) must land the player near 412500 E / 5657500 N (quarter tile
  // from the north-west corner).
  await page.getByTestId("minimap").click({ position: { x: 48, y: 48 } });
  const pose = await page.evaluate(() => window.__poc?.getPose?.());
  expect(pose?.epsgX ?? 0).toBeGreaterThan(412_450);
  expect(pose?.epsgX ?? 0).toBeLessThan(412_550);
  expect(pose?.epsgY ?? 0).toBeGreaterThan(5_657_450);
  expect(pose?.epsgY ?? 0).toBeLessThan(5_657_550);

  // Style + tilt-shift toggles must not produce shader/render errors
  // (caught by the console assertions below after a few frames).
  await page.evaluate(() => {
    window.__poc?.setStyle?.("clay");
    window.__poc?.setStyle?.("standard");
    window.__poc?.setStyle?.("ghost");
    window.__poc?.setTiltShift?.(false);
    window.__poc?.setTiltShift?.(true);
  });
  await page.waitForTimeout(500);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // Visual artifact for humans; not asserted on.
  await page.screenshot({ path: "test-results/city-walk-smoke.png" });
});
