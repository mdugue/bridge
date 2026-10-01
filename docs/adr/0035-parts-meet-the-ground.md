# ADR 0035: Every part meets the ground by one set of rules, and reports where it does

- **Status:** accepted
- **Date:** 2026-10

## Context

The ground is the bare-earth DGM1, and the DGM1 rounds every step a city
has into a ramp one to two metres wide: a 12 cm kerb, a 4 m quay wall, a
flight of steps, the abutment a bridge rests on. Everything that stands on
the ground — kerb stones, walls, stairs, bridge decks, fences, sheds,
hedges, furniture — therefore meets a ground whose edge is not where its
own is. Each layer answered that on its own, with its own constants (eight
different depths for a foot alone) and its own idea of what the edge
should do, and a review on a phone (2026-09-30) found the same failure in
five places at once:

- the kerb stone's top was level across, so it stood a second step on the
  pavement, whose smoothed ground lies only a few centimetres above the
  road;
- a quay wall's coping cap ended at the *median* crest along the wall, and
  wherever the measured ramp ran wider the DGM's steep facets showed
  behind it as a jagged row;
- every bridge deck ended as a slab edge a metre or more above the road
  running up to it — the deck is measured in the surface model, the road in
  the bare earth;
- a flight cut into a bank sat in the trench the terrain burn left beside
  it; a raised flight stood over the DGM's blurred shoulder;
- a tram track's bed was decided once for a whole chain of track, so a
  kilometre of street track went to ballast because a square lay under a
  third of it.

Each was fixed where it was found (PR #76). Fixing them place by place
leaves the next layer — and the next site — to rediscover the rule.

## Decision

**One module holds the rules** (`lib/city/ground-join.ts`):

- **Feet go under.** Whatever a part stands on reaches below the ground by
  its row of `SINK` (band, kerb, box, patch, planted, relief, wall, stair):
  the ground between two samples must not open a gap under it. A new part
  picks a row; it does not invent a depth.
- **Edges meet the ground.** Where a part's top surface ends on the ground
  side, it ends at the ground's level (`meetGround`: the kerb's back), or it
  runs on until the ground reaches its level (`reachLevel`: a wall's cap
  running back to where the ground behind it meets it, a bridge's approach
  falling at its grade until it lands). Never a step the data does not
  have; never a surface that stops where a median says it should.
- **Decisions per sample are smoothed along the part** (`farthestNear` in
  TypeScript; in the bakes `common.label_line`: a majority over a window
  and no run shorter than a minimum, as the tram bed now is), never taken once for a whole line,
  and never left raw: a raw per-sample decision turns an edge into a
  sawtooth, a whole-line one is wrong for most of the line.
- **A part reports where it meets the ground.** Every builder of a part
  that stands on the ground returns `joins`: `foot` points (must be at or
  below the ground) and `edge` points (must not stand more than 5 cm above
  it), sampled every metre along each span — the ground *between* two
  columns is where gaps open.

**One check holds every part to it.** `scripts/ground-joins.ts` builds the
parts baked into the fine terrain (kerbs, walls, stairs, fences) from the
committed sources on the shaped native DGM, exactly as the bake does, and
measures their joins on that same ground; `ground-joins.test.ts` holds each
part's share of misses to a budget (and checks each builder on synthetic
ground). The old kerb rule missed 32 % of its joins, the new one 2 %. A
runtime part (a bridge's approach, a tram track) is checked through its
pure function's unit test.

**A new part that stands on the ground** therefore:

1. takes its foot depth from `SINK`, its edges from `meetGround` /
   `reachLevel`;
2. answers, in its doc comment, what happens where the ground beside it is
   higher and where it is lower than the part (the two cases each of the
   five failures got wrong);
3. returns `joins` and is listed in `JOIN_PARTS` (baked parts) or tests its
   joins with `checkJoins` (runtime parts);
4. is judged from an oblique angle at the place the check names as worst.

- **A part follows the ground between its samples**: `followGround`
  densifies a line where the ground bends away from its straight span,
  `lowestGround` takes a foot down to the lowest ground along it, and a
  top whose edge finds the ground *below* it drops a face to the ground
  (a wall's cap behind, a flight's top landing) instead of ending in the
  air.

## Consequences

- The first run over the site (2026-10-01) found the same failures in the
  parts built before the rule, and they were fixed with the same helpers:
  misses of kerbs 2.9 → 0.2 %, walls 3.3 → 0.6 %, stairs 4.4 → 0.03 %,
  fences 1.7 → 0.16 %; the scan's sheds already stood on their lowest
  ground (0.02 %).

- The budgets are the measured state, not zero: a kerb where the pavement
  lies below the road keeps its step, a wall whose cap finds no ground
  within 5 m stays at its crest, a flight's top landing may end on a
  structure the DGM lacks. Lower a budget when a fix lowers a share;
  raising one needs a reason in the commit.
- `bun scripts/ground-joins.ts` prints the shares and the worst places for
  the whole site — the starting point for the next look on a phone.
- The unit tests read the spawn tile's DGM and its neighbours': about 7 s
  of `bun test`.

## Alternatives considered

- **Reshape the terrain at every part** (burn each kerb, wall and abutment
  into the ground). The fine terrain is a TIN over a 1 m grid: a vertical
  step needs a metre of hidden trench on one side, the triangles cross the
  part's face wherever the grid does not line up with it, and every
  reshaping changes the ground the other parts read. The stairs and the
  coarse level's walls do it where nothing else works (ADR 0014, 0028);
  the rest meet the ground as it is.
- **Fix each place by its snapshot.** The five failures were each found by a
  person on a phone; the same rule broken by the next layer would be found
  the same way, months later.
