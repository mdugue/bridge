import { expect, type Page, test } from "@playwright/test";
import proj4 from "proj4";

/**
 * Inner waits scale with the machine. Without a GPU every frame is rendered in
 * software, so work that is instant on a developer box — a demolish re-parses
 * the whole tile, a drawer animates while the render loop competes for the main
 * thread — can take tens of seconds on a shared CI runner. The per-test budget
 * itself lives in playwright.config.ts.
 */
const slow = (ms: number) => (process.env.CI ? ms * 3 : ms);

/**
 * The viewer specs run the `lite` scene profile (see scene-profile.ts): the
 * primary tile alone and a 512² shadow map. Under SwiftShader the full 2x2
 * block costs ~14 s to boot and ~4 s per clay frame; lite trades away the
 * scenic context — which nothing here asserts on — for a suite that finishes
 * in a couple of minutes instead of twenty.
 */
const LITE = "/?scene=lite";

/**
 * Wide enough to stay above the sidebar's 768 px mobile breakpoint (below it
 * shadcn's Sidebar becomes an off-canvas sheet and the minimap isn't
 * reachable), small enough that the post stack isn't rasterizing a megapixel
 * per frame on the CPU.
 */
const DESKTOP_VIEWPORT = { width: 800, height: 600 };

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

/** Page/console errors seen since the last `expectNoErrors`. */
interface ErrorLog {
  console: string[];
  page: string[];
}

/** Starts collecting page + console errors for the whole life of the page. */
function watchErrors(page: Page): ErrorLog {
  const log: ErrorLog = { page: [], console: [] };
  page.on("pageerror", (err) => log.page.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      log.console.push(msg.text());
    }
  });
  return log;
}

/**
 * Asserts nothing has errored and resets the log, so each test in a shared-page
 * describe is judged only on the errors it provoked itself.
 */
function expectNoErrors(log: ErrorLog): void {
  expect(log.page).toEqual([]);
  expect(log.console).toEqual([]);
  log.page.length = 0;
  log.console.length = 0;
}

/** Resolves once the viewer has rendered `count` more frames. */
async function waitForFrames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(() => window.__poc?.frames ?? 0);
  await page.waitForFunction(
    (target) => (window.__poc?.frames ?? 0) >= target,
    start + count,
    { timeout: slow(60_000) }
  );
}

/**
 * Resolves a logical /data artifact name to its content-hashed URL through
 * the manifest scripts/prepare-data.ts publishes (see lib/city/tile.ts).
 */
async function dataUrl(page: Page, file: string): Promise<string> {
  const manifest = (await (
    await page.request.get("/data/manifest.json")
  ).json()) as { files: Record<string, string> };
  return `/data/${manifest.files[file] ?? file}`;
}

/** True when the browser has WebGL at all (render assertions need it). */
function hasWebGl(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  });
}

/** Turns one pointer type's drag across the canvas into synthetic events. */
function dragAcrossCanvas(
  page: Page,
  pointerType: "mouse" | "touch",
  y: number
): Promise<void> {
  return page.evaluate(
    ({ kind, clientY }) => {
      const canvas = document.querySelector("canvas[data-engine]");
      if (!canvas) {
        throw new Error("no WebGL canvas");
      }
      const fire = (type: string, x: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: kind === "touch" ? 42 : 7,
            pointerType: kind,
            isPrimary: true,
            button: 0,
            bubbles: true,
            clientX: x,
            clientY,
          })
        );
      fire("pointerdown", 200);
      for (let i = 1; i <= 5; i++) {
        fire("pointermove", 200 + i * 20);
      }
      fire("pointerup", 300);
    },
    { kind: pointerType, clientY: y }
  );
}

/**
 * Opens the scene sidebar if it is closed. It boots closed by design — the
 * first frame is meant to be unobstructed — so every spec that reads a
 * control inside it opens it first. Idempotent: the toggle button only
 * exists while the sidebar is shut.
 */
async function openSidebar(target: Page): Promise<void> {
  const toggle = target.getByRole("button", { name: "Szeneneinstellungen" });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
}

test("city page serves the viewer shell", async ({ page }) => {
  // Deliberately the DEFAULT route (no ?scene=lite): this is the only spec
  // that proves the product URL serves a viewer at all. It never waits for the
  // scene to finish loading, so it costs the shell and nothing more.
  const errors = watchErrors(page);
  await page.goto("/");
  // Either the loading overlay or the booted canvas — never a blank page.
  await expect(
    page
      .getByText(
        /Bis zum ersten Bild|Gebäude werden geladen|Gelände wird geladen|Licht und Schatten werden berechnet/
      )
      .or(page.locator("canvas[data-engine]"))
      .first()
  ).toBeVisible({ timeout: 60_000 });
  // Scoped to <main>: the app's own error Alert lives there, while the
  // Next.js dev overlay parks an empty alert region next to it (dev server
  // only — CI serves a production build).
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(errors.page).toEqual([]);
});

/**
 * Every desktop assertion shares ONE booted viewer. Booting is the single
 * largest fixed cost in this suite (~14 s at the full profile on four cores,
 * ~4.5 s lite) and none of these tests needs a pristine scene — ordered so
 * the mutating ones (demolish, style switching) come after the assertions that
 * read the freshly-loaded state. `serial` makes that ordering a guarantee and
 * stops a broken boot from being reported five times over.
 */
test.describe("desktop viewer", () => {
  test.describe.configure({ mode: "serial" });

  let page: Page;
  let errors: ErrorLog;
  let webgl = false;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    page = await context.newPage();
    errors = watchErrors(page);
    await page.goto(LITE);
    webgl = await hasWebGl(page);
    // On CI the SwiftShader flags above must yield WebGL; a silent skip
    // would let a Chromium/Playwright bump turn the whole suite green.
    if (process.env.CI) {
      expect(webgl).toBe(true);
    }
    if (!webgl) {
      return;
    }
    // Debug hook (dev/test builds only) is set after the first successful load.
    // Waited on first: in dev, React StrictMode briefly runs a second, aborted
    // viewer instance whose canvas would trip a strict locator during loading.
    await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
      timeout: slow(120_000),
    });
  });

  test.beforeEach(() => {
    // Conditional runtime skip — render assertions are meaningless without WebGL.
    test.skip(!webgl, "WebGL is genuinely unavailable in this environment");
  });

  test.afterAll(async () => {
    // Errors logged after the last test's own check must not go unnoticed.
    if (webgl) {
      expectNoErrors(errors);
    }
    await page?.context().close();
  });

  test("renders buildings, terrain and shadows", async () => {
    // Renderer booted -> exactly one sized WebGL canvas (the minimap adds
    // 2D canvases of its own; three.js tags its canvas with data-engine).
    const canvas = page.locator("canvas[data-engine]");
    await expect(canvas).toBeVisible({ timeout: slow(60_000) });
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    const poc = await page.evaluate(() => ({
      firstFrame: window.__poc?.firstFrame,
      stats: window.__poc?.stats,
    }));
    expect(poc.stats?.buildingCount ?? 0).toBeGreaterThan(0);
    // The first frame precedes "everything loaded"; both are set once ready.
    expect(poc.firstFrame).toBe(true);
    expect(poc.stats?.terrainVertexCount ?? 0).toBeGreaterThan(0);
    expect(poc.stats?.shadowsEnabled).toBe(true);
    expectNoErrors(errors);
  });

  test("every scene layer is built on the primary tile", async () => {
    // Counts come from what each loader actually put in the scene graph, so a
    // renamed GeoJSON property, a 404 or a thrown builder — all of which the
    // loaders swallow into an empty group — fails here instead of passing.
    const stats = await page.evaluate(() => window.__poc?.stats?.layerStats);
    expect(stats).toBeDefined();
    if (!stats) {
      return;
    }
    expect(stats.city.triangles).toBeGreaterThan(0);
    expect(stats.terrain.meshes).toBe(1); // lite = primary tile only
    expect(stats.water.meshes).toBeGreaterThanOrEqual(1);
    // 5 118 canopy points + 25 tree rows + 5 788 laser-scan trees + 6 121
    // cadastre trees on 33412_5656 (trunk + two crowns each)
    expect(stats.vegetation.instances).toBeGreaterThan(1000);
    // 116 OSM hedges, cut into ≤2.5 m pieces
    expect(stats.lowVegetation.instances).toBeGreaterThan(100);
    // 339 OSM lamps: posts + heads + decals are instanced
    expect(stats.lamps.instances).toBeGreaterThan(100);
    // 48 fountains, statues and stones (Albertplatz and around): plinths,
    // figures and jets are instanced
    expect(stats.monuments.instances).toBeGreaterThan(20);
    // ~1 300 OSM benches, bins, stands, bollards, post boxes and shelters
    expect(stats.furniture.instances).toBeGreaterThan(500);
    // 3 bridges, 1 ballast yard, 21 platforms (this tile has no rail lines)
    expect(stats.rail.triangles).toBeGreaterThan(0);
    // 292 wall lines
    expect(stats.walls.triangles).toBeGreaterThan(0);
    // 277 fence lines and 114 gates on them, baked with the fine terrain
    expect(stats.fences.triangles).toBeGreaterThan(0);
    expectNoErrors(errors);
  });

  test("minimap click teleports the player", async () => {
    // The map spans the loaded terrain, whatever the scene profile loaded, so
    // the assertion is about the MAPPING, not about a fixed tile block:
    // clicking a quarter in from the north-west corner must land the player a
    // quarter into the bounds from the north-west. (The px<->EPSG math itself
    // is unit-tested in lib/city/minimap.test.ts; this proves the click
    // handler is wired to it with the right bounds and pixel size.)
    const bounds = await page.evaluate(
      () => window.__poc?.handle?.terrainBounds
    );
    expect(bounds).toBeDefined();
    const [minX, minY, maxX, maxY] = bounds ?? [0, 0, 0, 0];
    const expectedX = minX + (maxX - minX) / 4;
    const expectedY = maxY - (maxY - minY) / 4;

    // The sidebar starts closed so the first frame is unobstructed; the
    // minimap lives in its Erkunden tab.
    await openSidebar(page);
    const minimap = page.getByTestId("minimap");
    const minimapBox = await minimap.boundingBox();
    await minimap.click({
      position: {
        x: (minimapBox?.width ?? 0) / 4,
        y: (minimapBox?.height ?? 0) / 4,
      },
    });
    const pose = await page.evaluate(() => window.__poc?.handle?.getPose());
    // 50 m on a 2 km tile — loose enough for the rounding a click position
    // goes through, tight enough that a wrong quadrant or a flipped axis
    // (north-up vs canvas-down) fails.
    expect(Math.abs((pose?.epsgX ?? 0) - expectedX)).toBeLessThan(50);
    expect(Math.abs((pose?.epsgY ?? 0) - expectedY)).toBeLessThan(50);
    expectNoErrors(errors);
  });

  test("locate me puts the player at the GPS fix, facing the compass", async () => {
    // A fix a little north-east of the site's centre, reprojected here so the
    // assertion is about the wiring, not a hard-coded coordinate.
    const bounds = await page.evaluate(
      () => window.__poc?.handle?.terrainBounds
    );
    const [minX, minY, maxX, maxY] = bounds ?? [0, 0, 0, 0];
    const target = {
      x: (minX + maxX) / 2 + 150,
      y: (minY + maxY) / 2 + 250,
    };
    const [longitude, latitude] = proj4(
      "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs",
      "WGS84",
      [target.x, target.y]
    );
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude, longitude, accuracy: 8 });
    // The floating controls step aside while the sidebar is open.
    const close = page.getByRole("button", { name: "Seitenleiste schließen" });
    if (await close.isVisible()) {
      await close.click();
    }
    await page.getByRole("button", { name: "Standort", exact: true }).waitFor();
    // No compass has reported yet, so live mode is not offered.
    await expect(
      page.getByRole("button", { name: "Live", exact: true })
    ).toHaveCount(0);
    // Click, then report a phone held upright with its camera to the east,
    // ten times a second like a real sensor — on the absolute stream
    // Chromium's compass arrives on.
    await page.evaluate(() => {
      const w = window as unknown as { __compass?: number };
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.trim() === "Standort")
        ?.click();
      w.__compass = window.setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientationabsolute", {
            alpha: 270,
            beta: 90,
            gamma: 0,
            absolute: true,
          })
        );
      }, 100);
    });
    await expect(page.getByText("Du bist hier")).toBeVisible({
      timeout: slow(20_000),
    });
    const state = await page.evaluate(() =>
      window.__poc?.handle?.getCameraState()
    );
    expect(state?.mode).toBe("walk");
    expect(Math.abs((state?.epsg.x ?? 0) - target.x)).toBeLessThan(1);
    expect(Math.abs((state?.epsg.y ?? 0) - target.y)).toBeLessThan(1);
    // East by the compass, ≈ 1° more on the UTM grid (meridian convergence).
    expect(Math.abs((state?.headingDeg ?? 0) - 91)).toBeLessThan(2);
    await page.evaluate(() => {
      const w = window as unknown as { __compass?: number };
      window.clearInterval(w.__compass);
    });
    expectNoErrors(errors);
  });

  test("live mode: the view follows the compass, the camera the GPS", async () => {
    // A phone held facing south, tilted 10° up, reporting ten times a second.
    await page.evaluate(() => {
      const w = window as unknown as { __compass?: number };
      w.__compass = window.setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientationabsolute", {
            alpha: 180,
            beta: 100,
            gamma: 0,
            absolute: true,
          })
        );
      }, 100);
    });
    const toggle = page.getByRole("button", { name: "Live", exact: true });
    await expect(toggle).toBeVisible({ timeout: slow(10_000) });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // South by the compass is ≈ 181° on the grid; pitch +10°. The view eases
    // there a third of the way per frame, and SwiftShader draws about one
    // frame a second — so "well on its way", not "arrived" (camera-pose.test
    // pins the exact end point).
    await page.waitForFunction(
      () => {
        const s = window.__poc?.handle?.getCameraState();
        if (!s) {
          return false;
        }
        const heading = ((s.headingDeg % 360) + 360) % 360;
        return Math.abs(heading - 181) < 15 && s.pitchDeg > 3;
      },
      undefined,
      { timeout: slow(60_000) }
    );
    // The player walks 200 m south-west (a jump, so the camera lands there
    // at once rather than easing — see camera-pose's FOLLOW_SNAP_M).
    const before = await page.evaluate(() =>
      window.__poc?.handle?.getCameraState()
    );
    const target = {
      x: (before?.epsg.x ?? 0) - 120,
      y: (before?.epsg.y ?? 0) - 160,
    };
    const [longitude, latitude] = proj4(
      "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs",
      "WGS84",
      [target.x, target.y]
    );
    await page.context().setGeolocation({ latitude, longitude, accuracy: 6 });
    await page.waitForFunction(
      ({ x, y }) => {
        const s = window.__poc?.handle?.getCameraState();
        return (
          s !== undefined &&
          Math.abs(s.epsg.x - x) < 1 &&
          Math.abs(s.epsg.y - y) < 1
        );
      },
      target,
      { timeout: slow(20_000) }
    );
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => {
      const w = window as unknown as { __compass?: number };
      window.clearInterval(w.__compass);
    });
    expectNoErrors(errors);
  });

  test("the sidebar tabs reach every group of controls", async () => {
    // The controls are no longer one long list: Erkunden holds the map and
    // the vantages, Szene the sun and the look groups (each collapsed), and
    // Erweitert the tools and counters. A slider is only two taps away, and
    // this is what proves the three panels are actually wired.
    await openSidebar(page);
    await expect(page.getByText("Aussichtspunkte")).toBeVisible({
      timeout: slow(30_000),
    });

    await page.getByRole("tab", { name: "Szene" }).click();
    await expect(page.getByText("Sonne & Zeit")).toBeVisible();
    // Look sliders live one collapsed group down, and stay collapsed until
    // asked for — that is the point of the restructure.
    await expect(page.getByText("Boden-Verlauf")).toHaveCount(0);
    await page.getByRole("button", { name: /^Gebäude/ }).click();
    await expect(page.getByText("Boden-Verlauf")).toBeVisible({
      timeout: slow(30_000),
    });

    await page.getByRole("tab", { name: "Erweitert" }).click();
    await expect(page.getByText("Statistik")).toBeVisible();
    expectNoErrors(errors);
  });

  test("grab-look drag turns the view", async () => {
    // Desktop grab-look: a primary-button mouse drag turns the view — no
    // pointer lock needed by default (immersive mode is opt-in).
    const headingBefore = await page.evaluate(
      () => window.__poc?.handle?.getPose().heading ?? 0
    );
    await dragAcrossCanvas(page, "mouse", 300);
    const headingAfter = await page.evaluate(
      () => window.__poc?.handle?.getPose().heading ?? 0
    );
    expect(Math.abs(headingAfter - headingBefore)).toBeGreaterThan(0.2);
    expectNoErrors(errors);
  });

  test("the saved view can be set, cleared and set again", async () => {
    // It is a removable item, not a one-shot: clearing it is also how you
    // re-assign it, so the whole loop has to work from the UI alone.
    await openSidebar(page);
    await page.getByRole("tab", { name: "Erkunden" }).click();
    const save = page.getByRole("button", { name: "Aktuelle Sicht merken" });
    await expect(save).toBeVisible({ timeout: slow(15_000) });
    await save.click();

    const clear = page.getByRole("button", {
      name: "Gemerkte Sicht entfernen",
    });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(save).toBeVisible();
    await save.click();
    await expect(clear).toBeVisible();
    expectNoErrors(errors);
  });

  test("snapshot camera state round-trips", async () => {
    // Applying a captured camera state must reproduce it (the basis for
    // copy/paste QA of an exact view).
    const roundTrip = await page.evaluate(() => {
      const api = window.__poc?.handle;
      if (!api) {
        throw new Error("scene handle not published");
      }
      api.applyCameraState({
        mode: "fly",
        pos: { x: 25, y: 140, z: -60 },
        epsg: { x: 0, y: 0 },
        headingDeg: 42,
        pitchDeg: -20,
        fov: 55,
      });
      return api.getCameraState();
    });
    expect(roundTrip.mode).toBe("fly");
    expect(roundTrip.pos.x).toBeCloseTo(25, 1);
    expect(roundTrip.pos.y).toBeCloseTo(140, 1);
    expect(roundTrip.pos.z).toBeCloseTo(-60, 1);
    expect(roundTrip.headingDeg).toBeCloseTo(42, 0);
    expect(roundTrip.pitchDeg).toBeCloseTo(-20, 0);
    expect(roundTrip.fov).toBeCloseTo(55, 1);
    expectNoErrors(errors);
  });

  test("a snapshot applied mid-flight wins over the glide", async () => {
    // A scenic flight owns the camera for up to 3.8 s; a pose set from outside
    // (snapshot apply, minimap click, QA flyTo) must cancel it, or the next
    // frame silently glides the camera away again.
    const target = {
      mode: "fly" as const,
      pos: { x: -40, y: 160, z: 30 },
      epsg: { x: 0, y: 0 },
      headingDeg: 200,
      pitchDeg: -15,
      fov: 55,
    };
    await page.evaluate((t) => {
      const api = window.__poc?.handle;
      if (!api) {
        throw new Error("scene handle not published");
      }
      // The first viewpoint of sites/dresden.ts — inside the primary tile.
      // The glide takes the geometry only (ViewpointGeometry); the copy that
      // names a vantage is the HUD's business.
      api.flyToViewpoint({
        mode: "fly",
        epsg: { x: 412_550, y: 5_656_980 },
        aboveGround: 70,
        headingDeg: 245,
        pitchDeg: -10,
        fov: 62,
      });
      api.applyCameraState(t);
    }, target);
    await waitForFrames(page, 3);
    const state = await page.evaluate(() =>
      window.__poc?.handle?.getCameraState()
    );
    expect(state?.pos.x).toBeCloseTo(target.pos.x, 0);
    expect(state?.pos.y).toBeCloseTo(target.pos.y, 0);
    expect(state?.pos.z).toBeCloseTo(target.pos.z, 0);
    expect(state?.mode).toBe("fly");
    expectNoErrors(errors);
  });

  test("demolishes the building under the crosshair", async () => {
    // Demolish end to end: hover the camera over a real building, aim at it
    // and trigger the crosshair demolition — the building count must drop.
    // Runs after the read-only tests: a demolish rebuilds the tile's BVH and
    // the minimap's 2369 footprint polygons, and a main thread busy with that
    // makes Playwright's actionability checks on the minimap crawl.
    // The spawn tile's minimap footprints (one list of polygons per object,
    // published next to its glTF): aim at a mid-sized single-polygon
    // building whose bounding-box centre lies inside it — a perimeter block's
    // centre is its courtyard, and the ray would hit the ground.
    const footprints = (await (
      await page.request.get(
        await dataUrl(page, "footprints_33412_5656_2_sn.json")
      )
    ).json()) as [number, number][][][];
    const inside = ([x, y]: number[], ring: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          hit = !hit;
        }
      }
      return hit;
    };
    const target = footprints
      .filter((polys) => polys.length === 1)
      .map(([ring]) => {
        const xs = ring.map((p) => p[0]);
        const ys = ring.map((p) => p[1]);
        const [x0, y0, x1, y1] = [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ];
        return {
          ring,
          centre: [(x0 + x1) / 2, (y0 + y1) / 2],
          area: (x1 - x0) * (y1 - y0),
        };
      })
      .find((b) => b.area > 300 && b.area < 3000 && inside(b.centre, b.ring));
    expect(target).toBeDefined();
    const [centreX, centreY] = target?.centre ?? [0, 0];
    const buildingsBefore = await page.evaluate(
      () => window.__poc?.stats?.buildingCount ?? 0
    );
    expect(buildingsBefore).toBeGreaterThan(0);
    const trianglesBefore = await page.evaluate(
      () => window.__poc?.stats?.layerStats.city.triangles ?? 0
    );
    await page.evaluate(
      ([easting, northing]) => {
        const api = window.__poc?.handle;
        if (!api) {
          throw new Error("scene handle not published");
        }
        // Stand on the ground there to learn its height, then hover above.
        api.teleportTo(easting, northing);
        const ground = api.getCameraState().pos.y - 1.7;
        // EPSG:25833 -> world: x = X - cx, z = -(Y - cy), y = elevation.
        const x = easting - api.offset.cx;
        const z = -(northing - api.offset.cy);
        // Approach at an angle (not straight down: a view direction parallel
        // to the camera's up vector makes lookAt degenerate) and aim the
        // crosshair a few metres above the ground inside the footprint —
        // through the roof.
        api.flyTo({ x, y: ground + 150, z: z + 80 }, { x, y: ground + 4, z });
      },
      [centreX, centreY]
    );
    // Let the new pose reach a rendered frame before picking. flyTo refreshes
    // the camera's own matrixWorld, but the crosshair ray is cast against the
    // scene graph the render loop maintains; demolishing in the same tick as
    // the fly has been seen to pick nothing on a loaded runner.
    await waitForFrames(page, 1);
    await page.evaluate(() => window.__poc?.handle?.demolishAtCrosshair());
    await page.waitForFunction(
      (before) => (window.__poc?.stats?.buildingCount ?? 0) < before,
      buildingsBefore,
      { timeout: slow(30_000) }
    );
    // The mesh itself shrank (its index was filtered), not just the count.
    const trianglesAfter = await page.evaluate(
      () => window.__poc?.stats?.layerStats.city.triangles ?? 0
    );
    expect(trianglesAfter).toBeLessThan(trianglesBefore);
    expectNoErrors(errors);
  });

  /**
   * The style/post controls, each bound to real rendered frames: a shader that
   * only fails once its program is compiled and drawn cannot hide behind a
   * fixed sleep. This is the expensive half of the suite — every step that
   * crosses a compile boundary (a style swap, the alpha-hash threshold, a
   * shader-chunk define) costs two software-rendered frames — so steps that
   * only move uniforms are batched together rather than spent one per frame.
   */
  test("post and shader controls survive real frames", async () => {
    const CONTROL_STEPS = 6;
    for (let i = 0; i < CONTROL_STEPS; i++) {
      await page.evaluate((index) => {
        // Driven through the look store the sliders write to — one set() per
        // step is one batch of uniform writes.
        const look = window.__poc?.look;
        const steps: Array<() => void> = [
          () => look?.set({ dof: false }),
          // Post-stack uniforms compile nothing, so they share two steps: one
          // at full strength, one back down.
          () =>
            look?.set({
              dof: true,
              fogAmount: 1,
              grading: 1,
              contact: 1,
              grain: 1,
            }),
          () =>
            look?.set({
              fogAmount: 0.35,
              grading: 0.5,
              contact: 0.5,
              grain: 0.25,
            }),
          // Clay's alpha-hash program compiles when transparency crosses 0, in
          // both directions — each crossing must reach a rendered frame. (0.8
          // used to get a step of its own; it crosses nothing 0.5 hasn't.)
          () => look?.set({ transparency: 0.5 }),
          () => look?.set({ transparency: 0 }),
          // Shader paths the aesthetic work added — the terrain's NDVI meadow
          // tint, the height-fog chunk patch, the water mist sheet, and the
          // crown shaders (multi-tuft swaps the instanced LOD meshes). They
          // compile independent programs, but one frame compiles them all.
          () =>
            look?.set({
              heightFog: 1,
              meadowNdvi: 1,
              waterMist: 1,
              shimmer: 1,
              translucency: 1,
              leafFlutter: 1,
              leafBright: 1,
              multiTuft: true,
            }),
        ];
        steps[index]?.();
      }, i);
      await waitForFrames(page, 2);
      expectNoErrors(errors);
    }
  });

  test("quality regresses while moving and recovers when still", async () => {
    // Motion-keyed regression (lib/city/regression.ts): AO + DoF are skipped
    // while the camera moves. Asserted through __poc.regressed rather than
    // pixels — the passes' visual delta is exactly what SwiftShader renders
    // least like a GPU.
    const before = await page.evaluate(() => ({
      frames: window.__poc?.frames ?? 0,
      shadows: window.__poc?.shadowRenders ?? 0,
    }));
    await page.keyboard.down("KeyW");
    // 8 walking frames move at most 8 × 0.45 m = 3.6 m — inside the 20 m
    // follow dead zone, so the shadow map must not be redrawn on the way.
    await waitForFrames(page, 8);
    expect(await page.evaluate(() => window.__poc?.regressed)).toBe(true);
    const after = await page.evaluate(() => ({
      frames: window.__poc?.frames ?? 0,
      shadows: window.__poc?.shadowRenders ?? 0,
    }));
    const frames = after.frames - before.frames;
    const shadowRenders = after.shadows - before.shadows;
    expect(frames).toBeGreaterThanOrEqual(8);
    // Before the dead zone this equalled `frames` (one depth pass per frame).
    expect(shadowRenders).toBeLessThan(frames / 2);

    await page.keyboard.up("KeyW");
    // Recovery is frame-driven (RECOVER_MS of accumulated dt with the camera
    // still), so this waits on the flag, never on a clock.
    await page.waitForFunction(() => window.__poc?.regressed === false, null, {
      timeout: slow(60_000),
    });
    expectNoErrors(errors);
  });
});

test.describe("mobile", () => {
  // Phone emulation: Chromium maps isMobile+hasTouch to coarse-pointer
  // media queries, which is what the touch UI keys off. This is the one place
  // the viewport is prescribed by the thing under test, so it keeps its own
  // context (and therefore its own boot).
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("touch UI: joystick, drawer, drag-look, double-tap travel", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await page.goto(LITE);
    const webgl = await hasWebGl(page);
    if (process.env.CI) {
      expect(webgl).toBe(true);
    }
    // Conditional runtime skip — render assertions are meaningless without WebGL.
    test.skip(!webgl, "WebGL is genuinely unavailable in this environment");
    await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
      timeout: slow(120_000),
    });

    // Touch chrome instead of keyboard hints.
    await expect(page.getByTestId("joystick")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Szeneneinstellungen" })
    ).toBeVisible();
    await expect(page.getByText("WASD")).toHaveCount(0);

    // Demolish/insert live in the sidebar's Werkzeuge section; they used to
    // float over the scene as well, on the screens with the least room.
    await expect(page.getByRole("button", { name: "Abreißen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Einsetzen" })).toHaveCount(
      0
    );

    // The hint bar fits the viewport (it wraps rather than being cut off) and
    // can be waved away — everything it says is in the sidebar too.
    const hintBar = page.getByText("umsehen").first();
    const hintBox = await hintBar.boundingBox();
    const viewport = page.viewportSize();
    expect(hintBox && viewport).toBeTruthy();
    if (hintBox && viewport) {
      expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(viewport.width);
    }
    const dismiss = page.getByRole("button", { name: "Verstanden" });
    await expect(dismiss).toBeVisible();
    await dismiss.tap();
    await expect(dismiss).toHaveCount(0);

    // The start view is aerial, so the altitude stick stands opposite the
    // joystick; the plane button — the F key's stand-in — lands you on foot
    // and takes the stick away with fly mode.
    await expect(page.getByTestId("altitude-stick")).toBeVisible();
    const flyButton = page.getByRole("button", { name: "Fliegen" });
    await expect(flyButton).toHaveAttribute("aria-pressed", "true");
    const toolbar = page.getByRole("toolbar", { name: "Werkzeuge" });
    const flyingBox = await toolbar.boundingBox();
    await flyButton.tap();
    await expect(page.getByTestId("altitude-stick")).toHaveCount(0);
    // The stick sits above the toolbar, so the toolbar doesn't jump.
    const walkingBox = await toolbar.boundingBox();
    expect(walkingBox?.y).toBe(flyingBox?.y);
    await expect(flyButton).toHaveAttribute("aria-pressed", "false");
    expect(
      await page.evaluate(() => window.__poc?.handle?.getCameraState().mode)
    ).toBe("walk");

    // The toolbar folds away into one button and back.
    await page.getByRole("button", { name: "Werkzeuge einklappen" }).tap();
    await expect(flyButton).toHaveCount(0);
    await page.getByRole("button", { name: "Werkzeuge zeigen" }).tap();
    await expect(flyButton).toBeVisible();

    // One-finger drag turns the view (synthetic touch pointer events; the
    // canvas handler ignores mouse pointers).
    const headingBefore = await page.evaluate(
      () => window.__poc?.handle?.getPose().heading ?? 0
    );
    await dragAcrossCanvas(page, "touch", 400);
    const headingAfter = await page.evaluate(
      () => window.__poc?.handle?.getPose().heading ?? 0
    );
    expect(Math.abs(headingAfter - headingBefore)).toBeGreaterThan(0.2);

    // Double-tap on the ground ahead travels there. Synthetic events with
    // back-to-back timestamps: under software rendering the main thread is
    // busy for >320 ms between two real taps, which a real device never is.
    const poseBefore = await page.evaluate(() =>
      window.__poc?.handle?.getPose()
    );
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas[data-engine]");
      if (!canvas) {
        throw new Error("no WebGL canvas");
      }
      const fire = (type: string, pointerId: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType: "touch",
            isPrimary: true,
            bubbles: true,
            clientX: 195,
            clientY: 650,
          })
        );
      fire("pointerdown", 50);
      fire("pointerup", 50);
      fire("pointerdown", 51);
      fire("pointerup", 51);
    });
    await page.waitForFunction(
      (before) => {
        const pose = window.__poc?.handle?.getPose();
        if (!(pose && before)) {
          return false;
        }
        return (
          Math.abs(pose.epsgX - before.epsgX) > 1 ||
          Math.abs(pose.epsgY - before.epsgY) > 1
        );
      },
      poseBefore,
      { timeout: slow(15_000) }
    );

    // Drawer opens with the scene settings (generous timeout: the main
    // thread shares time with software-rendered frames).
    await page.getByRole("button", { name: "Szeneneinstellungen" }).tap();
    // The Erkunden tab is what a drawer opens on; the tabbed structure
    // itself is asserted on the desktop page, which is already booted.
    await expect(page.getByText("Aussichtspunkte")).toBeVisible({
      timeout: slow(30_000),
    });

    expectNoErrors(errors);
  });
});

/**
 * The whole site streamed, still at the lite render cost: `&block=1` keeps
 * every tile in the tileset (scene-profile.ts). The specs above stream the
 * spawn tile alone, so this is the one that walks the multi-tile path — tile
 * events arriving while the spawn tile boots, dressings queued for several
 * tiles, the site-wide minimap footprints. A load event that throws there
 * leaves `ready` false forever, which is exactly what this waits on.
 */
test.describe("whole site streamed", () => {
  test("several tiles load, dress and settle without errors", async ({
    browser,
  }) => {
    // Its own boot, and a longer one than the spawn-only specs: several
    // tiles' terrain, buildings and dressings, all shaded on the CPU.
    test.setTimeout(slow(240_000));
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      await page.goto(`${LITE}&block=1`);
      const webgl = await hasWebGl(page);
      if (process.env.CI) {
        expect(webgl).toBe(true);
      }
      test.skip(!webgl, "WebGL is genuinely unavailable in this environment");

      await page.waitForFunction(
        () => window.__poc?.ready === true,
        undefined,
        {
          timeout: slow(150_000),
        }
      );
      const stats = await page.evaluate(() => window.__poc?.stats?.layerStats);
      // More than the spawn tile is in view from the spawn pose: terrain and
      // buildings of at least one neighbour came through the stream.
      expect(stats?.terrain.meshes ?? 0).toBeGreaterThan(1);
      expect(stats?.city.meshes ?? 0).toBeGreaterThan(1);
      expect(stats?.vegetation.instances ?? 0).toBeGreaterThan(1000);

      // The minimap names every site tile's footprints up front, streamed
      // or not: some lie west of the spawn tile (412 000 E).
      const westmost = await page.evaluate(() => {
        const polys = window.__poc?.handle?.getFootprints() ?? [];
        let minX = Number.POSITIVE_INFINITY;
        for (const poly of polys) {
          for (const [x] of poly.pts) {
            minX = Math.min(minX, x);
          }
        }
        return minX;
      });
      expect(westmost).toBeLessThan(412_000);
      expectNoErrors(errors);
    } finally {
      await context.close();
    }
  });
});
