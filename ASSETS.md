# Artwork and dependencies

The mod ships an original grass tile in `tiles/placeholder.svg` and draws its generic companion in JavaScript. Node.js prepares optional artwork in the background and caches it under `data/pokemon-agents/` inside the Herdr home directory. Windows share each completed pack. A missing helper or a failed download leaves the placeholders available.

## Pokémon sprites

SpriteCollab provides the sprite sheets and animation metadata. The mod preserves frame timing and alignment across directions and poses, scales the sprites with nearest-neighbor sampling, and saves lossless WebP animations. Release, recall, and evolution effects use the cached idle sprites. [SpriteCollab repository](https://github.com/PMDCollab/SpriteCollab) · [Sprite catalog](https://sprites.pmdcollab.org/)

Each species pack under `v4/<species>/` keeps `credits.txt`, `AnimData.xml`, `ATTRIBUTION.txt`, and a manifest with source hashes. The SpriteCollab submission policy allows reuse of community submissions with artist credit for noncommercial purposes under CC BY-NC 4.0. The collection also contains official Chunsoft artwork. Rights to that artwork and to the Pokémon characters remain with their respective owners. [SpriteCollab submission and use policy](https://github.com/PMDCollab/SpriteCollab#submission-and-use-policy) · [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)

## Terrain

The terrain helper downloads tiles, metatile definitions, and palettes from pret's Pokémon Emerald general tileset. It assembles connected roads, shorelines, and ground patches for the four biomes. The pack under `terrain/emerald-v10/` includes `ATTRIBUTION.txt` and a manifest with source and generated-file hashes.

The Pokémon Emerald artwork belongs to its respective rights holders. The project's MIT license covers the helper code and original placeholders. [pret/pokeemerald general tileset](https://github.com/pret/pokeemerald/tree/master/data/tilesets/primary/general) · [Project license](LICENSE)

## Terrain generation

The layout uses the vendored ES module of simplex-noise 4.0.3 by Jonas Wagner under its own MIT license. A saved seed controls the terrain, and resizing reveals the same world coordinates from the bottom-left. [simplex-noise 4.0.3](https://github.com/jwagner/simplex-noise.js/releases/tag/4.0.3) · [Vendored license](vendor/simplex-noise/LICENSE)
