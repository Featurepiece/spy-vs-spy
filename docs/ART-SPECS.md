# Pictures for the front menu

The game draws everything in code, so it works with no picture files at all.
These are the optional pictures that would make the front menu look better.
Until each one arrives, the menu shows a code-drawn placeholder marked
"PLACEHOLDER ART" (or our own lettering, for the logo).

When a file is ready, put it in `assets/` and set its entry in `src/art.js`.
Files are used exactly as supplied, at full size and quality: never re-encode,
resize or compress them. The one exception is cutting out a solid background
for transparency (as was done for the logo), which keeps the full resolution and
is saved as a lossless PNG.

## Rules for every picture

- **Original characters only.** Our spies are Scarlet (red) and Cobalt (blue):
  round faces, dark glasses, wide-brim hats with a coloured band, belted trench
  coats. They must not look like MAD Magazine's Spy vs Spy characters: no long
  pointed beak noses, no all-black and all-white pair, no triangular hats.
- **No text inside the picture**, except the logo itself. The menu adds its own text.
- **Style:** a 1980s spy-movie poster crossed with a bold cartoon. Flat colours,
  thick dark outlines, a little halftone shading, dramatic spotlights. Deep navy
  and dark blue shadows, so it sits well on the game's dark background.

## 1. Title key art

| | |
| --- | --- |
| File | `assets/title-art.jpg` (PNG is fine too) |
| Size | **1600 × 700 px** (a 16:7 wide banner) |
| Background | Full scene, no transparency needed |
| Keep clear | The top third stays fairly plain and dark, because the logo sits on it. The bottom-left corner stays plain for the "FILE 84" tag. |

What to show: the two spies facing each other across a dim embassy corridor or
office, each lit by their own spotlight (warm red on Scarlet at left, cool blue
on Cobalt at right). A briefcase on the floor between them. Hints of the game:
a door, a filing cabinet, maybe a bomb with a lit fuse hidden behind one spy's back.

Example prompt:

> Wide 16:7 cartoon banner in the style of a 1980s spy movie poster: flat
> colours, thick dark outlines, light halftone shading. Two rival cartoon spies
> face each other across a dim embassy corridor. Left: a spy in a red belted
> trench coat and red wide-brim hat with a yellow band, round face, dark
> sunglasses, lit by a warm red spotlight. Right: a matching spy in a blue
> trench coat and blue hat with a light blue band, lit by a cool blue
> spotlight. A brown leather briefcase sits on the floor between them. Doors
> and a filing cabinet in the background. Deep navy shadows. The top third of
> the image is plain dark wall. No text, no letters, no logos.

## 2. Logo

| | |
| --- | --- |
| File | `assets/logo.png` |
| Size | **1200 × 300 px** |
| Background | **Transparent** PNG |

The words **DOUBLE AGENTS** on one line: "DOUBLE" in red (#FF6B5E) and
"AGENTS" in blue (#6AA8FF), chunky stencil-style capitals, with a thick black
outline or drop shadow so it reads on a dark picture.

Two things to check (both are common with image generators, so worth a look,
not a certainty):

- **Spelling.** Image generators often misspell words. Check every letter.
- **Fake transparency.** Some generators paint a grey-and-white checkerboard
  instead of a real transparent background. If that happens, ask for the logo
  on a plain solid black background instead and Claude will cut it out.

If the logo doesn't come out well, the current lettering (drawn with the
free Black Ops One font) can simply stay.

## 3. App icon (optional)

| | |
| --- | --- |
| File | `assets/icon.png` |
| Size | **512 × 512 px** |
| Background | Solid, no transparency (dark navy #16213A) |

Scarlet's head and hat, front on, filling most of the square, on dark navy. It
is used for the browser tab and for "Add to Home Screen" on phones.

## Not needed as pictures

The security monitors, the gadget panels, the rooms and the spies in play
are all drawn in code. They stay sharp at any screen size, so they don't
need picture files.
