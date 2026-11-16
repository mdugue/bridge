# 085 — Window niches and shop windows: performance and follow-ups

Status: TODO. Written 2026-11-10 from the review rounds on PR #273
(window niches, shop windows cut into the wall, painted signs). Every point
below came up there, more than once, and was left out of #273 on purpose:
none is a visible fault on a typical walk. They are ordered by what they
cost a phone.

Read first: `docs/rendering.md` (rows *Window niches*, *Shopfronts*,
*Plinths*), `app/_components/window-niche-layer.ts`,
`window-niche-client.ts`, `lib/city/window-niches.ts`,
`lib/city/shop-windows.ts`, `scripts/bake-city-mesh.ts`
(`planShopfronts`, `appendShopfronts`), ADR 0047 (phone memory).

STOP if a step makes a phone's memory grow (ADR 0047) or a WebGPU-only
check is needed that the headless WebGL2 e2e cannot make: then measure on
a real GPU (`bun run shots`, `?trail=1` on the iPhone) first.

## A. Performance on the runtime path

1. **Refill without churn.** Every 6 m (and every frame in a fast
   flight) `fill` rescans every packed niche within 270 m of every shown
   tile, allocates a candidate per niche, unpacks them twice and, when the
   set changed, rewrites the whole instance range. Group the niches by
   house at `add` (a house → [first, end) index, its box and its nearest
   point), rank houses by their boxes, unpack only the picked houses, and
   write only the instances that changed (`addUpdateRange` per run).
   Measure: refill time and GC in a flight over the Altstadt, desktop and
   phone.
2. **Only the changed flag texels.** `setNiched` → `markObjects` walks
   every object and re-uploads the tile's whole object texture for a few
   OBJECT_FLAG_NICHED bits. Either an update range over the changed rows
   or a small separate niched mask (one byte per object) the clay reads.
3. **The wall copy off the main thread.** `nicheInput` scans every
   triangle of a full-LoD2 tile in `processTileModel` (accessors,
   `applyMatrix4` per corner) before the worker sees anything. Hand the
   raw quantised arrays and the tile's matrix over and filter and
   transform in the worker; weigh the copy as today
   (`nicheCopyBytes`). Watch the CPU-copy drop (`cityCpuDroppable`) and
   `bvhBuilding`: the arrays must be copied, not borrowed.
4. **The cut variant compiled before it shows.** `cutOn` flips the clay's
   `maskNode` and only queues `recompile`, so the first tile that starts
   cutting builds the `clay|niches` pipeline in the frame (once per
   session and camera kind). Compile it before the flip: a stand-in mesh
   on the same geometry with a cut clone, or warm the variant once with
   the first city tile; keep the stand-in until the real mesh has drawn
   (three frees a node-builder state when its last user goes). Also: do
   not anchor the variant for Modell's camera (Modell never cuts), and key
   `compile-lanes` records by `material.version` so `cutGround` (terrain
   design cut) stops building in the frame too; `PostStack.recompile`
   then goes.
5. **No discard in the shadow pass.** `maskShadowNode = keepWalls` (a
   constant true) still routes the clay's shadow depth through three's
   mask path with a discard and its own pipeline. Find a way to keep the
   walls whole in the shadow map without a mask node there.
6. **One wall view per fragment.** `clayWindows` evaluates `wallView`
   twice (`recess`, `parts`) and `fwidth(s)` twice (`grid`'s `inside`);
   compute once and pass down.

## B. Bake

7. **Ask coverage, cut once.** `planShopfronts` runs a full `cutWall`
   (difference, earcut, edge loops) per bay only to learn whether it is
   covered, and `appendShopfronts` cuts again. A coverage-only pass
   (intersection areas) for the plan; or keep the plan's cut and reuse
   it. The (s, z) box reject is in (#273).
8. **Plan and cut agree.** Two shopfront records on one host and plane:
   one's sign is cut before the other's window, which may then fall under
   `MIN_COVER` although the plan broke the plinth for it. Plan signs as
   well, or take the plinth breaks from what was cut (lay the plinths
   after the cut, keeping the plan only for wall finding).

## C. Correctness follow-ups (rare)

9. **The niche's colour as the wall's.** `wallColour` mixes base and tint
   only; the clay also darkens the lowest 5 m (`GROUND_SHADE`) and applies
   OSM colours, facade readings and articulation. Share the clay's wall
   colour node with the niche material (an instance attribute or the
   object texture) so a house keeps its tone at the 250 m hand-over.
10. **Box front at a grazing view.** The box's open front sits on the
    wall's mean plane; where a quantised triangle stands up to 3 cm in
    front of it, a ray past ≈ 55° through the cut's edge can miss the
    4 cm overlap. A box reaching a little out of the wall only within the
    opening, or a deeper side overlap.
11. **Opening sizes past 5.1 m.** `packNiches` caps width and height at
    255 × `SIZE_STEP_M`; a taller stair-hall window would get a box
    shorter than its cut. Widen the field or refuse the niche (no cut:
    the object then keeps the drawn window).
12. **Column index past 255.** `j` is packed in 8 bits; a wall with more
    than 256 axes would light its niches differently after dark.
13. **Hidden while the BVH holds the index.** `stands()` reads the wanted
    hidden set, while the clay applies it once the BVH worker hands the
    index back (≈ 1 s on a phone): boxes may stand in the air for that
    long after a design moves. Refill when the deferred `applyHidden`
    settles, and read the applied set.
14. **A sign over drawn windows on a raised host** is placed from the
    street's ground, not the host's base (`shopfrontMesh` knows no base).
15. **A stepped wall's niche** whose opening straddles the wall's edge
    shows its box beside the wall (any probe on the wall places it). Clip
    the box to the wall's extent along the opening.
16. **CPU and shader grids tied by a test.** `wallColumns`/`wallRows`
    re-implement `clay-windows.ts` `columns`/rows; a test that evaluates
    both (the TSL graph on a fixed input, or shared constants with a
    golden table) keeps them one.

## D. Structure

17. **One worker job queue.** `window-niche-client.ts`, `bvh-client.ts`
    and `ground-prep-client.ts` each hand-roll start, give-up, abort,
    copy-until-answered and stop. One helper, parameterised by transfer
    and run-here.
18. **Motion blur hold by time.** `BLUR_HOLD_FRAMES` counts frames (83 ms
    at 144 Hz, 400 ms at 30 fps); hold by accumulated `moveMs`.
19. **The ground-join audit** (`scripts/ground-joins.ts`) still reads the
    plinths from the unbroken features; read the baked stretches (after
    `withoutSegments`) so the plinths' budget measures what is drawn.
20. `drawScene` in `post-stack.ts` is a single-use closure; inline it.
