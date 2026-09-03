# Proportion Canon

## Why a lookup table beats knowing it

Every number here is common knowledge, and it gets violated anyway. The reason
is that proportion errors happen at *coordinate-emission time*, when attention
is on the feature being drawn rather than on the whole. Drawing a face, you
attend to the eyes and nose and simply forget the cranium exists — which is
precisely why almost every untrained drawing puts the eyes too high.

Reading a number off a table is a different operation from recalling it while
concentrating on something else. Look these up during the block-in, encode them
as derived landmarks with `scripts/armature.js`, and assert them before drawing
anything. Then the error can't happen instead of merely being unlikely.

## Humans

| Measure | Canon | The error it prevents |
|---|---|---|
| Eye line | Exactly halfway between the top of the skull and the bottom of the chin | Eyes drawn far too high — the single most common proportion error there is |
| Head width | About ⅔ of head height | Round, ball-like heads |
| Ears | Span from the brow line to the base of the nose | Ears too small, set too high |
| Nose base | Halfway between eye line and chin | Long midface |
| Mouth | About ⅓ from nose base to chin, not halfway | Mouth too low |
| Eye spacing | One eye-width between the two eyes | Eyes set too close |
| Figure height | 7.5 head-lengths for an adult (8 for heroic/fashion, 5–6 for a child) | Adults built like children |
| Elbow | At the bottom of the ribcage, ≈ head 3 | Short upper arms |
| Wrist | At crotch level; fingertips reach mid-thigh | Comically short arms — very common |
| Leg | Half of total height, measured at the crotch | Short legs, long torso |
| Shoulders | 2 head-widths across for an adult male, slightly less for female | Narrow, childlike torso |

Children are not scaled-down adults: the cranium is proportionally much larger,
the face occupies a smaller fraction of the head, and limbs are shorter relative
to the trunk. Scaling an adult figure down is the tell.

## Hands and feet

| Measure | Canon | The error it prevents |
|---|---|---|
| Hand length | Chin to hairline — about the size of the face | Tiny doll hands |
| Palm | Roughly square | Long palm, stubby fingers |
| Middle finger | About the same length as the palm | Fingers drawn far too short |
| Knuckle arc | The knuckles form an arc, not a straight line | Rake-like, mechanical hands |
| Foot | About one head length | Feet too small to support the figure |

## Quadrupeds

| Measure | Canon | The error it prevents |
|---|---|---|
| Cat/dog "elbow" | High and tucked against the ribcage, not down near the wrist | Legs that look bolted to the belly |
| Hock (rear leg) | The prominent backward-bending joint is the **ankle**; the true knee is up against the body | Backward-bending knees |
| Digitigrade stance | Cats and dogs walk on their toes — what looks like a long lower leg is the foot | Flat, human-like feet |
| Horse body | Body length ≈ height at the withers (roughly square) | Long, dachshund-like horses |
| Head-to-body | Cat head ≈ ⅕ of body length excluding tail | Oversized cartoon heads on a realistic body |

## Birds

| Measure | Canon | The error it prevents |
|---|---|---|
| Leg joints | The visible backward-bending joint is the **ankle**, not the knee — the knee is hidden inside the body feathers | Reversed-looking legs, the classic bird tell |
| Wing | Folded, the wing tip reaches roughly the base of the tail | Stubby wings |
| Body mass | The breast is the heaviest part and sits forward of the leg attachment | Birds that look like they'd tip backward |
| Eye | Set well forward and high on the skull, large relative to the head | Small, mammal-placed eyes |

## Trees and plants

| Measure | Canon | The error it prevents |
|---|---|---|
| Branch taper | Total cross-sectional area is conserved at a fork: the two children together equal the parent (da Vinci's rule) — so each child's radius is the parent's ÷ √2 for an even split | Branches that stay too thick, or taper to nothing instantly |
| Branch angle | Narrower near the top of the tree, wider near the base | Uniform, umbrella-like silhouettes |
| Canopy | Made of distinct clumps with sky holes through them, never one solid mass | The "broccoli" tree |
| Trunk | Widens noticeably at the base where it meets the ground (root flare) | Trees that look pushed into the dirt like a pole |

## Vehicles and architecture

| Measure | Canon | The error it prevents |
|---|---|---|
| Car height | About 2 wheel-diameters overall; the body sits roughly 1 wheel-diameter tall | Toy-like proportions |
| Greenhouse (cabin) | Shorter than instinct says — roughly ⅓ of total height, ½ of length | Bus-like, boxy cars |
| Wheelbase | About 3 wheel-diameters between axles | Cramped, cartoon wheelbase |
| Wheel ellipse | Derived from height relative to the horizon — use `Shading.camera().groundCircle()` | Arbitrarily squashed wheels |
| Door | About 2 m; use it as the human-scale yardstick for every other building measure | Buildings with no readable scale |
| Storey height | ≈ 3 m residential, ≈ 4 m commercial ground floor | Squashed or impossibly tall floors |
| Step | Rise ≈ 18 cm, run ≈ 28 cm | Stairs that read as a ramp or a ladder |

## Everyday objects

| Subject | Canon | The error it prevents |
|---|---|---|
| Mug | Height ≈ 1.2 × diameter; handle spans the middle half of the height | Bucket-shaped mugs |
| Wine glass | Bowl ≈ ⅓ of total height, sitting on a stem ≈ ½ | Bowl too large, stem too short |
| Book | Roughly 3:2 height to width | Square books |
| Chair | Seat at ≈ 45 cm, back at ≈ 90 cm — half the seated figure's height | Chairs the figure can't sit in |
| Apple | Slightly wider than tall; the stem sits in a distinct well, never on a smooth dome | The "red ball with a stick" apple |

## Using these with the rig

Encode the canon as *derived* landmarks so they cannot drift, and assert the
ones you had to place by hand:

```js
const rig = Armature.rig(0, 0, W, H);
rig.at('skullTop', 0.50, 0.08);
rig.at('chin',     0.50, 0.34);
rig.mid('eyeLine', 'skullTop', 'chin');            // canon, not a guess
rig.mid('noseBase','eyeLine',  'chin');
rig.mid('mouth',   'noseBase', 'chin', 1 / 3);
rig.at('wrist',    0.36, 0.52);
rig.at('crotch',   0.50, 0.52);
rig.check('wrist reaches crotch level', rig.y('wrist'), rig.y('crotch'), 4);
rig.verify();   // throws with the numbers if the block-in is wrong
```

Every landmark placed with `mid`/`derive` is a proportion that can no longer be
wrong. Every one placed with `at` is a proportion worth a `check`.
