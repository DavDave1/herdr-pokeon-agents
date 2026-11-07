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
