# Pokémon Agents

A Pokémon habitat for your agents in Herdr, with an Emerald forest clearing, paths, tall grass, a pond and trees. Agents roam on walkable ground; drag and release them to move them around the clearing.

Choose **Forest, Desert, Cave or Mountain** under **Options → Biome**. Each habitat saves its type and a random biome seed, keeping its landscape consistent across reloads. Choose **Options → Generate new biome** for a different landscape. Layouts adapt to the pane size while retaining the saved seed.

## Install

1. Install Herdr and make sure `herdr-app` is available in your terminal. Optional terrain and SpriteCollab animation downloads require Python 3 with Pillow installed.
2. Download this repository and copy its contents into `~/.config/herdr-app/mods/pokemon-agents/` (including `mod.json`, `main.js`, the other JavaScript and Python files, and `tiles/`). If you set `HERDR_APP_HOME`, use `$HERDR_APP_HOME/mods/pokemon-agents/` instead.
3. With Herdr running and a space selected, open the mod in a new tab:

   ```sh
   herdr-app do tab.new '{"name":"Pokémon","mod":"pokemon-agents"}'
   ```

To show the habitat below your focused pane instead:

```sh
herdr-app do pane.split '{"direction":"down","mod":"pokemon-agents"}'
```

## Artwork attribution

No third-party terrain or character sprite assets are shipped in this repository. A single original placeholder grass tile is shown while terrain downloads or if it is unavailable. Terrain is downloaded and generated on demand in Herdr’s data directory; see [ASSETS.md](ASSETS.md) for sources and rights information. A generic placeholder is drawn directly in the UI while animations load or if a download fails. Optional animation artwork comes from [SpriteCollab](https://sprites.pmdcollab.org/) ([source repository](https://github.com/PMDCollab/SpriteCollab)). Community contributions are subject to [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), requiring attribution and noncommercial use; see the [upstream reuse policy](https://github.com/PMDCollab/SpriteCollab#submission-and-use-policy). Downloaded animation packs retain per-species `credits.txt` and `ATTRIBUTION.txt` files in Herdr's `data/pokemon-agents/v4/` directory. Animations are converted to WebP, scaled, and composed into release, recall, and evolution effects.

Sprites are downloaded on demand into Herdr’s data directory, outside this repository. The generic companion is shown while downloads load or fail. Downloads and cache reuse are not filtered by artwork credits.

SpriteCollab also includes official Chunsoft artwork; its community contribution license does not grant rights to that artwork or to the underlying Pokémon characters. Third-party artwork is excluded from any MIT license applied to this project's code.
