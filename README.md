# Pokémon Agents

Turn a Herdr panel into a roaming Pokémon habitat for your coding agents. Left-click a companion to open its agent. Right-click and drag to move it. Hover for agent status and accumulated working time.

Choose **Options → Biome** to switch between Forest, Desert, Cave, and Mountain. Each habitat saves its biome and seed. Resizing reveals more of the same landscape, and **Options → Generate new biome** creates a new one. Companions can evolve as their agents accumulate working time.

## Install

1. Install Herdr. This mod was tested with Herdr 0.1.16. [Herdr installation](https://github.com/herdrdev/herdr-app)
2. Download the release source and place the extracted folder at `~/.config/herdr-app/mods/pokemon-agents/`. Use `$HERDR_APP_HOME/mods/pokemon-agents/` if you set `HERDR_APP_HOME`. The folder should contain `mod.json` and `main.js` at its root.
3. For downloaded terrain, Pokémon sprites, and evolution effects, install Node.js 22 or newer with npm. Run `npm ci` in the mod folder and make sure Herdr can find `node` on its PATH. A grass tile and generic companions are available while artwork downloads or when the helper is unavailable.
4. With Herdr running and a space selected, open the habitat in a tab.

   ```sh
   herdr-app do tab.new '{"name":"Pokémon","mod":"pokemon-agents"}'
   ```

To use the habitat as your Agents panel, open a personal layout or duplicate the shipped one.

```sh
herdr-app do layout.clone '{"name":"main","as":"pokemon-agents"}'
```

In the personal layout's JSON file under Herdr's `layouts/` directory, find the block with `"id": "agents"` and set its `content` to `{"mod":"pokemon-agents"}`. Herdr applies the edit live.

## Development

Run these commands from the mod folder.

```sh
npm ci
npm test
herdr-app check .
```

Herdr loads the panel as JavaScript from `main.js`. The panel calls a separate Node.js process to download and prepare artwork. The tests run offline.

## License and artwork

The MIT license covers this project's code and original placeholder artwork. Optional artwork is fetched from SpriteCollab and pret's Pokémon Emerald archive. For source credits, cache locations, and artwork terms, see [ASSETS.md](ASSETS.md). [MIT license](LICENSE)
