#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

install_mod() {
  cli=herdr-app
  if ! command -v "$cli" >/dev/null 2>&1; then
    cli="$HOME/.local/bin/herdr-app"
    [ -x "$cli" ] || fail "Install and open Herdr so its command-line tool is available."
  fi
  HERDR_APP_HOME=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-"$HOME/.config"}/herdr-app}
  export HERDR_APP_HOME
  "$cli" status >/dev/null 2>&1 || fail "Open Herdr and select a space before running the installer."

  mod_dir="$HERDR_APP_HOME/mods/pokemon-agents"
  if [ ! -e "$mod_dir" ] && [ ! -L "$mod_dir" ]; then
    command -v git >/dev/null 2>&1 || fail "Install Git to download Pokémon Agents."
    mkdir -p "$HERDR_APP_HOME/mods"
    git clone --depth 1 https://github.com/DavDave1/herdr-pokeon-agents.git "$mod_dir"
  fi
  if [ -L "$mod_dir" ] || [ ! -f "$mod_dir/mod.json" ] || [ ! -f "$mod_dir/assets/prepare.js" ]; then
    fail "Expected a Pokémon Agents installation at $mod_dir. Choose a Herdr home with an available mod folder."
  fi

  "$cli" check "$mod_dir"
  if [ ! -f "$mod_dir/node_modules/.package-lock.json" ]; then
    if command -v npm >/dev/null 2>&1 &&
        node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)' 2>/dev/null; then
      npm ci --prefix "$mod_dir" || printf '%s\n' "Artwork setup failed. Opening with placeholders." >&2
    else
      printf '%s\n' "Opening with placeholders. Node.js 22+ and npm enable downloaded artwork."
    fi
  fi

  "$cli" do tab.new '{"name":"Pokémon","mod":"pokemon-agents"}'
}

install_mod
