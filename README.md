# PVFX Foundry 1.0

One hundred and one pixel-art visual effects for games: impacts, slashes,
explosions, fire, ice, lightning, holy and shadow magic, nature, water, wind,
smoke, status auras, projectiles, and interface feedback. Every effect comes in
two style tiers and two sheet layouts, with exact frame metadata.

You do not need Pixel VFX Studio to use this pack.

## What is new in 1.0

1.0 replaces the pack's look with a new generation of effects. Each one is a
small authored animation with anticipation, a peak, and a decay that steps down
a colour ramp: fire cools from white through gold to ember, smoke breaks into
separate clusters and thins, sparks scatter and vanish, loops close without a
seam. Effects are drawn at their native size, so a hit spark is 64×64 and a
meteor strike is 128×128, and each keeps the frame timing it was authored with.

## Two style tiers

- `lit`: full colour with additive light and translucent volumes. Glows, smoke
  and heat haze keep soft alpha. Use it for most modern pixel-art games.
- `strict`: a limited palette, banded light, and binary alpha: every pixel is
  either fully opaque or fully transparent. Use it for strict palettes, GIF
  output, or engines without alpha blending.

## What is included

- 101 effects, 77 one-shots and 24 seamless loops, 1,826 frames per tier.
- 404 transparent PNG sprite sheets: for each effect and tier, one fixed grid
  sheet and one trimmed packed sheet.
- A JSON manifest beside every sheet with frame order, exact durations, pivots,
  visible and trim bounds, sheet placements, and per-frame pixel hashes.
- `pack.json`, an index of every effect with its name, description, tags, size,
  timing and loop flag.
- The previous release's 44 effects, unchanged, under `legacy/0.10.0/`.

The download contains sprite sheets and metadata only: no project source,
engine plugins, or software.

## Fastest import

Open `effects/<family>/<effect>/lit/grid/sprite-sheet.png`. Slice it into cells
of the effect's size (in `pack.json` and the manifest's `source_size`) with
eight columns, read frames left to right, top to bottom, and stop at the frame
count. Use nearest-neighbour filtering.

For smaller textures and trimmed pivots, use the `packed` sheet and follow its
manifest placements. See `IMPORTING.md` for formulas and `FORMAT.md` for the
pack contract.

## License

The rendered sprite sheets and bundled metadata and documents are dedicated to
the public domain under CC0 1.0 Universal. Attribution is appreciated but not
required. A suggested credit is:

> VFX from PVFX Foundry by Pixel VFX Studio

The dedication does not cover Pixel VFX Studio software, effect program source,
or product marks, none of which are included. See `LICENSE.txt` for the exact
scope and legal text, and `THIRD_PARTY_NOTICES.txt` for credits.

## Feedback

Tell us on the itch.io page which effects you use and what your game needs
next.
