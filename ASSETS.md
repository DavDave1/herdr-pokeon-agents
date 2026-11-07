Pokémon animation source: https://github.com/PMDCollab/SpriteCollab
Catalog: https://sprites.pmdcollab.org/

Walk, Idle, and Sleep sheets are packaged on demand to support directional movement and actual sleeping poses. Original per-frame timing and a shared origin are retained to prevent scaling and alignment changes between cycles. Packs live under `data/pokemon-agents/v4/<species>/`, outside the mod folder so cache writes do not reload the mod. Each pack retains original artist credits, animation metadata, source hashes, and attribution links. A file lock shares packaging work across windows; incomplete packs are never published.

Community artwork reuse policy: noncommercial use with appropriate artist credit, CC BY-NC 4.0. https://github.com/PMDCollab/SpriteCollab#submission-and-use-policy
Downloads and cache reuse are not filtered by artwork credits. SpriteCollab includes official Chunsoft artwork as well as community contributions; the community contribution license does not cover official artwork. Pokémon character rights remain with their respective owners.

Packaging uses the existing local Python 3 and Pillow installation. Downloads run in the background with a bundled fallback and delayed retries, so unavailable assets do not prevent agent navigation.

No sprite assets are bundled. `placeholder.js` draws a generic companion directly in the UI during loading and failed downloads. Downloaded sprites and generated effects stay outside the repository.

Working agents randomly choose between walking and a species action. Action probability starts at 20%, rises by 10 percentage points after each completed walk selection, and resets after an action, making gestures occasional without allowing an indefinite walk-only streak. Actions use complete source cycles and avoid immediate repeats when alternatives exist. Idle and other status changes interrupt activity immediately. All actions share the same canvas alignment and scale.

Animation packs use 384×384 canvases, scaled directly from source frames with nearest-neighbor sampling. This avoids enlarging 96×96 intermediate images in Big mode while retaining the original pixel artwork and common alignment. The display size remains independent of packaged resolution.

Arrival and recall use one-shot WebP effects composed from each Pokémon’s actual idle sprite, an original small pixel-art Poké Ball, and a brief release flash. Effects retain the common ground anchor. Removed agents remain in the meadow until recall finishes, reserving their species during that interval; loading agents display the generic companion until their animation pack is available. Generic companions also use the placeholder for arrival and recall. The ball/effect graphics are original procedural artwork, not SpriteCollab assets.

Evolution counts observed working time across all agent programs; idle, blocked, done and time while the panel is unloaded do not contribute. Progress is saved per terminal run and resets when its foreground process changes. Existing final forms are preserved; new arrivals use Gastly and Munchlax so those families can evolve. Ordinary lines evolve around 30 minutes and 2 hours of cumulative work, or 1 hour for a single evolution. A conditional random roll over a 75–125% window increases the chance as working time accumulates, independent of timer cadence. A successful roll and the chosen branch are persisted so reloads and download retries do not reroll them. Eevee chooses among its three original evolutions. Occupied species remain reserved, including during recall and pending evolution.

Evolution waits for both animation packs, then plays a one-shot lossless pixel-art effect built from their actual idle silhouettes with a shared ground anchor, warm-white pulses and square sparkles. It commits the new form only when the effect finishes, so failed downloads or effect generation leave the original Pokémon usable. Generated effects live outside the mod folder to avoid hot reloads.

Hidden animation testing shortcuts: Ctrl+Shift+left-click requests the next evolution through the normal reservation/download/effect pipeline; final forms ignore it. Ctrl+Shift+right-click restores the family base instantly, cancels any pending/running evolution and resets accumulated working time so a test reset does not immediately trigger evolution again. Reset preserves the no-duplicate rule. Ordinary clicks still focus the agent. No visible debug controls are added.


Forest biome terrain
-------------------

Only `tiles/placeholder.svg` is bundled. It is original procedural artwork covered
by the project's code license. Loading and failed downloads use this seamless
grass tile with an open, obstacle-free clearing.

At runtime `package_tiles.py` fetches `tiles.png`, `metatiles.bin`, and palettes
`00.pal` through `06.pal` from the
[pret/pokeemerald general tileset](https://github.com/pret/pokeemerald/tree/master/data/tilesets/primary/general).
It reconstructs 16×16 metatiles with their original palette, flip and layer flags,
then enlarges them with nearest-neighbor sampling. The transparent tree combines
metatiles 462/463, 468/469 and 486/487 (crown, canopy and one trunk/base). `package_roads.py` generates 47 neighbor-aware
road tiles, including outer and inset corners. The map and collision logic are original.

Complete packs are published atomically under Herdr's
`data/pokemon-agents/terrain/emerald-v9/`, outside the mod repository. A process lock
shares downloads between windows. Cache validation checks every expected PNG and
its SHA-256 hash before reuse; invalid packs are rebuilt. Downloads have time and
size limits. Failures retain the placeholder and retry with delays from 30 seconds
up to five minutes. Python 3 and Pillow are required for downloaded terrain;
missing dependencies leave the placeholder usable. Terrain installation updates
rendering and collision geometry together and moves existing agents to safe ground.

Cached packs retain `ATTRIBUTION.txt`, source links, source hashes and generated
file hashes in `manifest.json`. Pokémon Emerald terrain artwork belongs to its
original Pokémon rights holders (Nintendo, Game Freak and The Pokémon Company).
The pret archive does not grant an artwork license. Downloaded artwork is excluded
from this project's MIT code license. No third-party terrain images are shipped.

Biome generation uses a saved 32-bit seed (`biome-seed` in local storage). A seeded
PRNG controls road bends, pond location and size, grass patches and trees; coordinate
hashing places flowers consistently. The same seed and dimensions reproduce the
same layout. Options → Generate new biome saves a new seed and settles agents onto
walkable ground. Placeholder terrain remains open until the downloaded pack is ready.


Biome types: Forest, Desert, Cave and Mountain are selected in Options and saved
as `biome-type`. Changing type preserves the seed and relocates agents onto safe
ground; Generate new biome changes the seed within the selected type. Forest uses
original grass and trees. Desert uses sand, an oasis and warm-colored boulders;
Cave uses muted dirt, stone paths, pools and dark rocks; Mountain uses cool-toned
dirt, passes, lakes and boulders. `package_biomes.py` derives these palettes and
terrain textures from the downloaded general tileset, and removes the water
background from boulder metatile 197. All generated variants stay in the runtime
cache, covered by the same source artwork rights; none are bundled.
