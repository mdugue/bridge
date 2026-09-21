import { expect, type Page, test } from "@playwright/test";

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
        /Loading 3D viewer|Starting renderer|Loading CityJSON|Parsing buildings|Loading DGM|Indexing terrain|Preparing render styles/
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
    // biome-ignore lint/suspicious/noSkippedTests: conditional runtime skip — render assertions are meaningless without WebGL
    test.skip(!webgl, "WebGL is genuinely unavailable in this environment");
  });

  test.afterAll(async () => {
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

    const poc = await page.evaluate(() => window.__poc);
    expect(poc?.buildingCount ?? 0).toBeGreaterThan(0);
    // The first frame precedes "everything loaded"; both are set once ready.
    expect(poc?.firstFrame).toBe(true);
    expect(poc?.terrainVertexCount ?? 0).toBeGreaterThan(0);
    expect(poc?.shadowsEnabled).toBe(true);
    expectNoErrors(errors);
  });

  test("minimap click teleports the player", async () => {
    // The map spans the loaded terrain, whatever the scene profile loaded, so
    // the assertion is about the MAPPING, not about a fixed tile block:
    // clicking a quarter in from the north-west corner must land the player a
    // quarter into the bounds from the north-west. (The px<->EPSG math itself
    // is unit-tested in lib/city/minimap.test.ts; this proves the click
    // handler is wired to it with the right bounds and pixel size.)
    const bounds = await page.evaluate(() => window.__poc?.terrainBounds);
    expect(bounds).toBeDefined();
    const [minX, minY, maxX, maxY] = bounds ?? [0, 0, 0, 0];
    const expectedX = minX + (maxX - minX) / 4;
    const expectedY = maxY - (maxY - minY) / 4;

    const minimap = page.getByTestId("minimap");
    const minimapBox = await minimap.boundingBox();
    await minimap.click({
      position: {
        x: (minimapBox?.width ?? 0) / 4,
        y: (minimapBox?.height ?? 0) / 4,
      },
    });
    const pose = await page.evaluate(() => window.__poc?.getPose?.());
    // 50 m on a 2 km tile — loose enough for the rounding a click position
    // goes through, tight enough that a wrong quadrant or a flipped axis
    // (north-up vs canvas-down) fails.
    expect(Math.abs((pose?.epsgX ?? 0) - expectedX)).toBeLessThan(50);
    expect(Math.abs((pose?.epsgY ?? 0) - expectedY)).toBeLessThan(50);
    expectNoErrors(errors);
  });

  test("grab-look drag turns the view", async () => {
    // Desktop grab-look: a primary-button mouse drag turns the view — no
    // pointer lock needed by default (immersive mode is opt-in).
    const headingBefore = await page.evaluate(
      () => window.__poc?.getPose?.().heading ?? 0
    );
    await dragAcrossCanvas(page, "mouse", 300);
    const headingAfter = await page.evaluate(
      () => window.__poc?.getPose?.().heading ?? 0
    );
    expect(Math.abs(headingAfter - headingBefore)).toBeGreaterThan(0.2);
    expectNoErrors(errors);
  });

  test("snapshot camera state round-trips", async () => {
    // Applying a captured camera state must reproduce it (the basis for
    // copy/paste QA of an exact view).
    const roundTrip = await page.evaluate(() => {
      const api = window.__poc;
      if (!(api?.applyCameraState && api.getCameraState)) {
        throw new Error("snapshot api incomplete");
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
      const api = window.__poc;
      if (!(api?.flyToViewpoint && api.applyCameraState)) {
        throw new Error("flight api incomplete");
      }
      // SCENIC_VIEWS[0] (viewpoints.ts) — inside the primary tile.
      api.flyToViewpoint({
        id: "carolabruecke",
        label: "Carolabrücke",
        description:
          "Hovering over the Elbe by the Carolabrücke, the river sweeping toward the Altstadt skyline.",
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
    const state = await page.evaluate(() => window.__poc?.getCameraState?.());
    expect(state?.pos.x).toBeCloseTo(target.pos.x, 0);
    expect(state?.pos.y).toBeCloseTo(target.pos.y, 0);
    expect(state?.pos.z).toBeCloseTo(target.pos.z, 0);
    expect(state?.mode).toBe("fly");
    expectNoErrors(errors);
  });

  test("demolishes the building under the crosshair", async () => {
    // Demolish end to end: hover the camera over a real building, aim at it
    // and trigger the crosshair demolition — the building count must drop.
    // Runs after the read-only tests: re-parsing the tile also rebuilds the
    // minimap's 2369 footprint polygons, and a main thread busy with that
    // makes Playwright's actionability checks on the minimap crawl.
    const cityMeta = (await (
      await page.request.get(
        await dataUrl(page, "city_33412_5656_2_sn.mesh.json")
      )
    ).json()) as { objects: { type: string; extent?: number[] }[] };
    const target = cityMeta.objects.find(
      (o) => o.type === "Building" && o.extent
    );
    expect(target?.extent).toBeDefined();
    const [minX, minY, minZ, maxX, maxY, maxZ] = target?.extent ?? [];
    const buildingsBefore = await page.evaluate(
      () => window.__poc?.buildingCount ?? 0
    );
    expect(buildingsBefore).toBeGreaterThan(0);
    await page.evaluate(
      ([easting, northing, midHeight, top]) => {
        const api = window.__poc;
        if (!(api?.flyTo && api.offset)) {
          throw new Error("debug api incomplete");
        }
        // EPSG:25833 -> world: x = X - cx, z = -(Y - cy), y = elevation.
        const x = easting - api.offset.cx;
        const z = -(northing - api.offset.cy);
        // Approach at an angle (not straight down: a view direction parallel
        // to the camera's up vector makes lookAt degenerate) and aim the
        // crosshair at the building's mid-height.
        api.flyTo({ x, y: top + 120, z: z + 80 }, { x, y: midHeight, z });
      },
      [
        ((minX ?? 0) + (maxX ?? 0)) / 2,
        ((minY ?? 0) + (maxY ?? 0)) / 2,
        ((minZ ?? 0) + (maxZ ?? 0)) / 2,
        maxZ ?? 0,
      ]
    );
    // Let the new pose reach a rendered frame before picking. flyTo refreshes
    // the camera's own matrixWorld, but the crosshair ray is cast against the
    // scene graph the render loop maintains; demolishing in the same tick as
    // the fly has been seen to pick nothing on a loaded runner.
    await waitForFrames(page, 1);
    await page.evaluate(() => window.__poc?.demolishAtCrosshair?.());
    await page.waitForFunction(
      (before) => (window.__poc?.buildingCount ?? 0) < before,
      buildingsBefore,
      { timeout: slow(30_000) }
    );
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
        const steps: Array<() => void> = [
          () => window.__poc?.setDepthOfField?.(false),
          // Post-stack uniforms compile nothing, so they share two steps: one
          // at full strength, one back down.
          () => {
            window.__poc?.setDepthOfField?.(true);
            window.__poc?.setAtmosphere?.(1);
            window.__poc?.setDepthGrading?.(1);
            window.__poc?.setContactShadows?.(1);
            window.__poc?.setPaperGrain?.(1);
          },
          () => {
            window.__poc?.setAtmosphere?.(0.35);
            window.__poc?.setDepthGrading?.(0.5);
            window.__poc?.setContactShadows?.(0.5);
            window.__poc?.setPaperGrain?.(0.25);
          },
          // Clay's alpha-hash program compiles when transparency crosses 0, in
          // both directions — each crossing must reach a rendered frame. (0.8
          // used to get a step of its own; it crosses nothing 0.5 hasn't.)
          () => window.__poc?.setBuildingTransparency?.(0.5),
          () => window.__poc?.setBuildingTransparency?.(0),
          // Shader paths the aesthetic work added — the terrain's NDVI meadow
          // tint, the height-fog chunk patch, the water mist sheet, and the
          // crown shaders (multi-tuft swaps the instanced LOD meshes). They
          // compile independent programs, but one frame compiles them all.
          () => {
            window.__poc?.setHeightFog?.(1);
            window.__poc?.setMeadowNdvi?.(1);
            window.__poc?.setWaterMist?.(1);
            window.__poc?.setTreeShimmer?.(1);
            window.__poc?.setTreeTranslucency?.(1);
            window.__poc?.setTreeLeafFlutter?.(1);
            window.__poc?.setTreeLeafBright?.(1);
            window.__poc?.setTreeMultiTuft?.(true);
          },
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
    // biome-ignore lint/suspicious/noSkippedTests: conditional runtime skip — render assertions are meaningless without WebGL
    test.skip(!webgl, "WebGL is genuinely unavailable in this environment");
    await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
      timeout: slow(120_000),
    });

    // Touch chrome instead of keyboard hints.
    await expect(page.getByTestId("joystick")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Scene settings" })
    ).toBeVisible();
    await expect(page.getByText("WASD")).toHaveCount(0);

    // One-finger drag turns the view (synthetic touch pointer events; the
    // canvas handler ignores mouse pointers).
    const headingBefore = await page.evaluate(
      () => window.__poc?.getPose?.().heading ?? 0
    );
    await dragAcrossCanvas(page, "touch", 400);
    const headingAfter = await page.evaluate(
      () => window.__poc?.getPose?.().heading ?? 0
    );
    expect(Math.abs(headingAfter - headingBefore)).toBeGreaterThan(0.2);

    // Double-tap on the ground ahead travels there. Synthetic events with
    // back-to-back timestamps: under software rendering the main thread is
    // busy for >320 ms between two real taps, which a real device never is.
    const poseBefore = await page.evaluate(() => window.__poc?.getPose?.());
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
        const pose = window.__poc?.getPose?.();
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
    await page.getByRole("button", { name: "Scene settings" }).tap();
    await expect(page.getByText("Boden-Verlauf")).toBeVisible({
      timeout: slow(30_000),
    });

    expectNoErrors(errors);
  });
});
