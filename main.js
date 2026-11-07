import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Popup, Popover } from "gpui-base";
import { agents, panes, spaces, run, setAgentOrder, exec, appHome, terminals, settings } from "herdr";

import { families, familyFor, infoFor, nextForms, thresholdFor, evolutionChance, runIdentity, formatTime } from "./evolution.js";
import { placeholderSprite } from "./placeholder.js";
import { buildBiome, clearRoute, nearestGround, compareDepth, BIOME_TYPES, BIOME_LABELS } from "./biome.js";

export default class PokemonHabitat extends View {
  init(_props, cx) {
    this.pokemon = JSON.parse(localStorage.getItem("pokemon") ?? "{}");
    this.size = {width: 1000, height: 270};
    const storedSeed = localStorage.getItem("biome-seed");
    const parsedSeed = storedSeed === null ? NaN : Number(storedSeed);
    this.biomeSeed = Number.isInteger(parsedSeed) && parsedSeed >= 0 && parsedSeed <= 0xffffffff
      ? parsedSeed : Math.floor(Math.random() * 4294967296);
    localStorage.setItem("biome-seed", String(this.biomeSeed));
    const savedBiome = localStorage.getItem("biome-type");
    this.biomeType = BIOME_TYPES.includes(savedBiome) ? savedBiome : "forest";
    this.panelPixels = null;
    this.hovered = null;
    this.drag = null;
    this.dragClick = null;
    const savedSize = localStorage.getItem("sprite-size");
    this.spriteSizeChoice = ["small", "medium", "big"].includes(savedSize) ? savedSize : "medium";
    this.optionsOpen = false;
    this.walkers = new Map();
    this.presence = new Map();
    this.assets = new Map();
    this.downloads = 0;
    this.terrain = {state: "pending"};
    this.loadTerrain(cx);
    this.evolution = JSON.parse(localStorage.getItem("evolution-progress") ?? "{}");
    this.evolutionEffects = new Map();
    this.lastWorkSample = Date.now();
    this.lastWorkSave = Date.now();
    this.previousWorking = new Set();
    cx.timer.every(1000, cx => {
      this.trackWorkingTime(cx);
      this.prepareEvolutions(cx);
    });
    // Timers choose activity phases; native transitions and sprite cycles render each frame.
    cx.timer.every(250, cx => {
      const presenceChanged = this.syncPresence();
      const movementChanged = this.advanceWalkers();
      if (presenceChanged || movementChanged) cx.notify();
      this.loadAnimations(cx);
      this.loadTerrain(cx);
    });
  }
  syncPresence() {
    const now = Date.now(), list = agents(), live = new Set(list.map(agent => agent.address));
    let changed = false;
    for (const agent of list) {
      let entry = this.presence.get(agent.address);
      if (!entry || entry.phase === "recall") {
        entry = {agent, phase: "loading", started: now};
        this.presence.set(agent.address, entry);
        changed = true;
      }
      entry.agent = agent;
      const number = this.pokemon[agent.address]?.[0], asset = this.assets.get(number);
      if (entry.phase === "loading" && ["ready", "failed"].includes(asset?.state)) {
        entry.phase = "release";
        entry.started = now;
        // Keep the same artwork for the whole effect if a download completes mid-cycle.
        entry.cached = asset.state === "ready";
        entry.duration = asset.manifest?.lifecycle?.release ?? 1200;
        changed = true;
      }
      if (entry.phase === "evolution" && now >= entry.started + entry.duration) {
        this.pokemon[agent.address] = entry.nextMon;
        localStorage.setItem("pokemon", JSON.stringify(this.pokemon));
        const record = this.evolution[agent.address];
        if (record) { record.due = false; record.target = null; record.form = entry.nextMon[0]; }
        this.saveEvolution();
        entry.phase = "active";
        const motion = this.walker(agent.address);
        motion.action = "idle";
        motion.next = now + 1000;
        changed = true;
      }
      if (entry.phase === "release" && now >= entry.started + entry.duration) {
        entry.phase = "active";
        changed = true;
      }
    }
    for (const [address, entry] of this.presence) {
      if (live.has(address)) continue;
      if (entry.phase === "loading") {
        this.presence.delete(address);
        changed = true;
        continue;
      }
      if (entry.phase !== "recall") {
        const motion = this.walker(address);
        if (motion.walking) {
          const progress = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
          motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
          motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
        }
        motion.walking = false;
        motion.duration = 0;
        motion.action = "idle";
        const asset = this.assets.get(this.pokemon[address]?.[0]);
        entry.phase = "recall";
        entry.started = now;
        entry.cached = asset?.state === "ready";
        entry.duration = asset?.manifest?.lifecycle?.recall ?? 1320;
        if (this.hovered === address) this.hovered = null;
        changed = true;
      } else if (now >= entry.started + entry.duration) {
        this.presence.delete(address);
        changed = true;
      }
    }
    return changed;
  }

  presenceSprite(address, size) {
    const entry = this.presence.get(address);
    if (entry.phase === "evolution") return div().id(`evolution-${address}-${entry.started}`).size(size)
      .child(image(entry.effect).size(size));
    if (entry.phase === "loading") return div().size(size);
    if (!entry.cached) return placeholderSprite(size);
    const number = this.pokemon[address]?.[0];
    const folder = `v4/${number}`;
    return div().id(`pokeball-${address}-${entry.phase}-${entry.started}`).size(size)
      .child(image(`data/pokemon-agents/${folder}/${entry.phase}.webp`).size(size));
  }

  loadTerrain(cx) {
    if (["loading", "ready"].includes(this.terrain.state) || Date.now() < (this.terrain.retry ?? 0)) return;
    const attempts = this.terrain.attempts ?? 0;
    this.terrain = {state: "loading", attempts};
    cx.spawn(async cx => {
      try {
        const result = await exec("python3", [`${appHome()}/mods/pokemon-agents/package_tiles.py`]);
        if (result.code !== 0) throw new Error(result.stderr || "Terrain download failed");
        const manifest = JSON.parse(result.stdout);
        if (manifest.version !== 6 || manifest.path !== "data/pokemon-agents/terrain/emerald-v6") throw new Error("Invalid terrain manifest");
        this.terrain = {state: "ready", path: manifest.path};
        for (const motion of this.walkers.values()) {
          if (motion.walking) {
            const progress = Math.min(1, Math.max(0, (Date.now() - motion.started) / motion.duration));
            motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
            motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
          }
          this.settleOnGround(motion);
          motion.walking = false;
          motion.duration = 0;
          motion.action = "idle";
          motion.next = Date.now() + 500;
        }
      } catch (error) {
        this.terrain = {state: "failed", attempts: attempts + 1,
          retry: Date.now() + Math.min(300000, 30000 * 2 ** attempts)};
        console.log(`Terrain: ${error}`);
      }
      cx.notify();
    });
  }

  loadAnimations(cx) {
    const numbers = new Set(agents().map(a => this.pokemon[a.address]?.[0]).filter(Boolean));
    for (const record of Object.values(this.evolution)) {
      if (record.target) numbers.add(record.target[0]);
    }
    for (const number of numbers) {
      if (this.downloads >= 2) break;
      const previous = this.assets.get(number);
      if (["ready", "loading"].includes(previous?.state) || Date.now() < (previous?.retry ?? 0)) continue;
      this.assets.set(number, {state: "loading"});
      this.downloads++;
      cx.spawn(async cx => {
        try {
          // The helper validates cached files before returning, and only downloads missing packs.
          const result = await exec("python3", [`${appHome()}/mods/pokemon-agents/package_sprites.py`, String(number)]);
          if (result.code !== 0) throw new Error(result.stderr || "Sprite download failed");
          const manifest = JSON.parse(result.stdout);
          this.assets.set(number, {state: "ready", manifest});
        } catch (error) {
          const attempts = (previous?.attempts ?? 0) + 1;
          this.assets.set(number, {state: "failed", attempts, retry: Date.now() + Math.min(300000, 30000 * 2 ** (attempts - 1))});
          console.log(`Pokémon ${number}: ${error}`);
        } finally {
          this.downloads--;
          cx.notify();
        }
      });
    }
  }

  spriteSize() {
    const requested = {small: 105.6, medium: 158.4, big: 211.2}[this.spriteSizeChoice];
    return Math.max(1, Math.min(requested, this.size.width, this.size.height,
      Math.max(48, this.size.height - 64), Math.max(48, this.size.width - 12)));
  }

  updatePanelSize() {
    if (!this.panelPixels) return;
    const zoom = Number(settings().zoom) || 1;
    // on_size_change reports painted logical pixels; numeric styles apply zoom.
    this.size = {width: this.panelPixels.width / zoom, height: this.panelPixels.height / zoom};
  }

  selectSpriteSize(choice) {
    this.spriteSizeChoice = choice;
    localStorage.setItem("sprite-size", choice);
    this.optionsOpen = false;
    const now = Date.now(), bounds = this.walkingBounds();
    for (const motion of this.walkers.values()) {
      if (motion.walking) {
        const progress = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
        motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
        motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
      }
      motion.x = Math.max(bounds.left, Math.min(bounds.right, motion.x));
      motion.y = Math.max(bounds.back, Math.min(bounds.front, motion.y));
      this.settleOnGround(motion);
      motion.walking = false;
      motion.duration = 0;
      motion.moveChance = .2;
      motion.action = "idle";
      motion.next = now + 150;
    }
  }

  optionsMenu() {
    const trigger = div().id("pokemon-options-button").px(10).py(5).rounded(6)
      .bg("#132e25e8").text_size(12).text_color("#edf8dc").cursor_pointer()
      .hover(style => style.bg("#244b3b")).child("Options");
    return Popover.new("pokemon-options").anchor("top_right")
      .open(this.optionsOpen)
      .on_open_change((open, cx) => { this.optionsOpen = open; cx.notify(); })
      .trigger(trigger)
      .content(v_flex().w(180).p(8).gap(4).rounded(8).border(1).border_color("#446b56")
        .bg("#fff9e8").text_color("#20372d").text_size(12)
        .child(div().px(8).py(4).font_semibold().child("Sprite size"))
        .children(["small", "medium", "big"].map(choice => {
          const selected = choice === this.spriteSizeChoice;
          return h_flex().id(`pokemon-size-${choice}`).px(8).py(7).rounded(5).justify_between()
            .bg(selected ? "#cfe6ce" : "#fff9e8").cursor_pointer()
            .hover(style => style.bg("#dfedda"))
            .on_click((_event, cx) => { this.selectSpriteSize(choice); cx.notify(); })
            .child(choice[0].toUpperCase() + choice.slice(1))
            .child(selected ? "✓" : "");
        }))
        .child(div().h(1).my(5).bg("#c5d5c0"))
        .child(div().px(8).py(4).font_semibold().child("Biome"))
        .children(BIOME_TYPES.map(type => h_flex().id(`pokemon-biome-${type}`).px(8).py(7).rounded(5).justify_between()
          .bg(type === this.biomeType ? "#cfe6ce" : "#fff9e8").cursor_pointer()
          .hover(style => style.bg("#dfedda"))
          .child(type[0].toUpperCase() + type.slice(1)).child(type === this.biomeType ? "✓" : "")
          .on_click((_event, cx) => {
            this.biomeType = type;
            localStorage.setItem("biome-type", type);
            this.regenerateBiome(false);
            cx.notify();
          })))
        .child(div().h(1).my(5).bg("#c5d5c0"))
        .child(div().id("pokemon-new-biome").px(8).py(7).rounded(5).cursor_pointer()
          .hover(style => style.bg("#dfedda"))
          .child("Generate new biome")
          .on_click((_event, cx) => { this.regenerateBiome(); cx.notify(); })));

  }

  regenerateBiome(newSeed = true) {
    if (newSeed) this.biomeSeed = (this.biomeSeed + 1 + Math.floor(Math.random() * 0xffffffff)) >>> 0;
    localStorage.setItem("biome-seed", String(this.biomeSeed));
    this.optionsOpen = false;
    this.drag = null;
    this.hovered = null;
    const now = Date.now();
    for (const motion of this.walkers.values()) {
      if (motion.walking) {
        const progress = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
        motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
        motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
      }
      this.settleOnGround(motion);
      Object.assign(motion, {walking: false, duration: 0, action: "idle", next: now + 500});
    }
  }

  biome() {
    const key = `${this.size.width}:${this.size.height}:${this.terrain.path ?? "placeholder"}:${this.biomeSeed}:${this.biomeType}`;
    if (this.biomeKey !== key) {
      this.biomeKey = key;
      this.biomeLayout = buildBiome(this.size.width, this.size.height, this.terrain.path, this.biomeSeed, this.biomeType);
    }
    return this.biomeLayout;
  }

  settleOnGround(motion) {
    const point = nearestGround(this.biome(), motion.x, motion.y, this.walkingBounds(), this.spriteSize() / 2);
    motion.x = point.x;
    motion.y = point.y;
  }

  walkingBounds() {
    const size = this.spriteSize();
    const front = Math.max(20, this.size.height - 28);
    return {
      left: 6,
      right: Math.max(6, this.size.width - size - 6),
      back: Math.min(front, size * 88 / 96 + 46),
      front,
    };
  }

  panelBounds(address, status) {
    const size = this.spriteSize(), anchor = size * 88 / 96;
    const box = this.spriteBounds(address, status).map(value => value * size / 96);
    return {left: -box[0], right: this.size.width - box[2],
      back: anchor - box[1], front: this.size.height + anchor - box[3]};
  }

  startDrag(address, event, cx) {
    if (event.modifiers.control && event.modifiers.shift) return;
    const status = this.presence.get(address)?.agent.status;
    const box = this.spriteBounds(address, status).map(value => value * this.spriteSize() / 96);
    const motion = this.walker(address), now = Date.now();
    if (motion.walking) {
      const progress = Math.max(0, Math.min(1, (now - motion.started) / motion.duration));
      motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
      motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
    }
    motion.walking = false;
    motion.duration = 0;
    motion.action = "idle";
    const bounds = this.panelBounds(address, status);
    motion.x = Math.max(bounds.left, Math.min(bounds.right, motion.x));
    motion.y = Math.max(bounds.back, Math.min(bounds.front, motion.y));
    this.dragClick = null;
    // Pointer events use painted window pixels; layout values may be scaled.
    const scaleX = event.bounds?.width / (box[2] - box[0]) || 1;
    const scaleY = event.bounds?.height / (box[3] - box[1]) || 1;
    const grabX = box[0] + (event.local_position?.x ?? (event.position.x - (event.bounds?.x ?? event.position.x))) / scaleX;
    const grabY = box[1] + (event.local_position?.y ?? (event.position.y - (event.bounds?.y ?? event.position.y))) / scaleY;
    this.drag = {address, status, pointer: {...event.position}, x: motion.x, y: motion.y,
      scaleX, scaleY, grabX, grabY, moved: false};
    this.hovered = null;
    cx.stop_propagation();
    cx.notify();
  }

  moveDrag(event, cx) {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.position.x - drag.pointer.x, dy = event.position.y - drag.pointer.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const motion = this.walker(drag.address), bounds = this.panelBounds(drag.address, drag.status);
    const local = event.local_position, painted = event.bounds;
    const x = local && painted?.width ? local.x * this.size.width / painted.width - drag.grabX : drag.x + dx / drag.scaleX;
    const y = local && painted?.height ? local.y * this.size.height / painted.height - drag.grabY + this.spriteSize() * 88 / 96 : drag.y + dy / drag.scaleY;
    motion.x = Math.max(bounds.left, Math.min(bounds.right, x));
    motion.y = Math.max(bounds.back, Math.min(bounds.front, y));
    cx.notify();
  }

  stopDrag(cx) {
    if (!this.drag) return;
    const {address, moved} = this.drag;
    if (moved) this.dragClick = address;
    const motion = this.walker(address);
    this.settleOnGround(motion);
    motion.next = Date.now() + 1500;
    this.drag = null;
    cx.notify();
  }

  walker(address) {
    if (!this.walkers.has(address)) {
      const bounds = this.walkingBounds();
      const point = nearestGround(this.biome(),
        bounds.left + Math.random() * (bounds.right - bounds.left),
        bounds.back + Math.random() * (bounds.front - bounds.back), bounds, this.spriteSize() / 2);
      this.walkers.set(address, {
        x: point.x, y: point.y,
        direction: "s", moveChance: .2, action: "idle", walking: false, duration: 0, next: Date.now() + 500 + Math.random() * 2000,
      });
    }
    return this.walkers.get(address);
  }

  advanceWalkers() {
    const now = Date.now(), list = agents();
    const live = new Set(this.presence.keys());
    for (const address of this.walkers.keys()) {
      if (!live.has(address)) this.walkers.delete(address);
    }
    let changed = false;
    const bounds = this.walkingBounds();
    for (const agent of list) {
      if (this.drag?.address === agent.address) continue;
      if (this.presence.get(agent.address)?.phase !== "active") continue;
      const motion = this.walker(agent.address);
      if (motion.status !== agent.status) {
        if (motion.walking && agent.status !== "working") {
          // Freeze at the visible position, rather than sliding to the old destination.
          const progress = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
          motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
          motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
          motion.walking = false;
          motion.duration = 0;
        }
        motion.moveChance = .2;
        motion.action = "idle";
        motion.status = agent.status;
        motion.next = now + 150;
        changed = true;
      }
      if (agent.status !== "working" || now < motion.next) continue;
      const number = this.pokemon[agent.address]?.[0];
      const manifest = this.assets.get(number)?.manifest;
      motion.walking = false;
      if (motion.action !== "idle") {
        // Let a full idle cycle settle the pose before drawing the next activity.
        const cycle = manifest?.durations?.idle ?? 1000;
        motion.action = "idle";
        motion.sequence = (motion.sequence ?? 0) + 1;
        motion.next = now + cycle * Math.max(1, Math.ceil(900 / cycle));
        changed = true;
        continue;
      }
      if (this.hovered === agent.address) {
        if (motion.action !== "idle") { motion.action = "idle"; changed = true; }
        continue;
      }
      const actions = [...new Set([...(manifest?.randomActions ?? []), manifest?.workAction].filter(action => action && action !== "idle"))];
      if (actions.length && Math.random() < motion.moveChance) {
        const available = actions.filter(action => action !== motion.lastGesture);
        const choices = available.length ? available : actions;
        motion.action = choices[Math.floor(Math.random() * choices.length)];
        motion.lastGesture = motion.action;
        motion.moveChance = .2;
        motion.next = now + (manifest?.durations?.[motion.action] ?? 1000);
        motion.sequence = (motion.sequence ?? 0) + 1;
        changed = true;
        continue;
      }
      // A single direction and shared duration keep a steady speed along the ground.
      const direction = Math.floor(Math.random() * 8) * Math.PI / 4;
      const distance = 24 + Math.random() * 44;
      const x = Math.max(bounds.left, Math.min(bounds.right, motion.x + Math.cos(direction) * distance));
      const y = Math.max(bounds.back, Math.min(bounds.front, motion.y + Math.sin(direction) * distance * .55));
      const length = Math.hypot(x - motion.x, y - motion.y);
      const offset = this.spriteSize() / 2;
      if (length < 8 || !clearRoute(this.biome(), motion.x + offset, motion.y, x + offset, y)) {
        motion.next = now + 500;
        continue;
      }
      const heading = Math.round(Math.atan2((y - motion.y) / .55, x - motion.x) / (Math.PI / 4));
      motion.direction = ["e", "se", "s", "sw", "w", "nw", "n", "ne"][(heading + 8) % 8];
      motion.duration = Math.round(length / 34 * 1000);
      motion.fromX = motion.x;
      motion.fromY = motion.y;
      motion.started = now;
      motion.x = x;
      motion.y = y;
      motion.action = "walk";
      motion.moveChance = Math.min(1, Math.round((motion.moveChance + .1) * 100) / 100);
      motion.sequence = (motion.sequence ?? 0) + 1;
      motion.walking = true;
      motion.next = now + motion.duration;
      changed = true;
    }
    return changed;
  }

  pokemonInfo(address) {
    const choices = families.map(line => line[0]);
    if (!this.pokemon[address]) {
      const used = new Set(Object.values(this.pokemon).map(mon => mon[0]));
      const available = choices.filter(mon => !used.has(mon[0]));
      if (!available.length) return null;
      this.pokemon[address] = available[Math.floor(Math.random() * available.length)];
      localStorage.setItem("pokemon", JSON.stringify(this.pokemon));
    }
    return infoFor(this.pokemon[address]);
  }

  saveEvolution() {
    localStorage.setItem("evolution-progress", JSON.stringify(this.evolution));
    this.lastWorkSave = Date.now();
  }

  close() { this.saveEvolution(); }

  trackWorkingTime(cx) {
    const now = Date.now(), elapsed = Math.max(0, Math.min(5000, now - this.lastWorkSample));
    this.lastWorkSample = now;
    const all = terminals(), list = agents(), live = new Set(list.map(agent => agent.address));
    let changed = false;
    for (const address of Object.keys(this.evolution)) {
      if (!live.has(address) && !this.presence.has(address)) { delete this.evolution[address]; changed = true; }
    }
    for (const agent of list) {
      const mon = this.pokemon[agent.address];
      if (!mon) continue;
      const terminal = all.find(item => item.address === agent.address);
      // A transiently missing terminal snapshot must not erase saved progress.
      if (!terminal) continue;
      const identity = runIdentity(terminal, agent.address);
      let record = this.evolution[agent.address];
      if (!record || record.identity !== identity) {
        const entry = this.presence.get(agent.address);
        if (entry?.phase === "evolution") entry.phase = "active";
        if (record && this.pokemon[agent.address][0] !== record.base[0]) {
          const occupied = Object.entries(this.pokemon).some(([address, value]) => address !== agent.address && value[0] === record.base[0]);
          if (!occupied) this.pokemon[agent.address] = record.base;
          localStorage.setItem("pokemon", JSON.stringify(this.pokemon));
        }
        record = {identity, base: this.pokemon[agent.address], form: this.pokemon[agent.address][0], workingMs: 0, due: false, target: null};
        this.evolution[agent.address] = record;
        this.previousWorking.delete(agent.address);
        changed = true;
      }
      // Crash/reload after the sprite swap must not replay an already completed evolution.
      if (record.form !== this.pokemon[agent.address][0]) {
        record.form = this.pokemon[agent.address][0]; record.due = false; record.target = null;
      }
      const before = record.workingMs;
      if (agent.status === "working" && this.previousWorking.has(agent.address)) record.workingMs += elapsed;
      const nominal = thresholdFor(this.pokemon[agent.address][0]);
      if (nominal && !record.due && record.workingMs > before &&
          Math.random() < evolutionChance(before, record.workingMs, nominal)) {
        record.due = true;
        changed = true;
      }
    }
    this.previousWorking = new Set(list.filter(agent => agent.status === "working").map(agent => agent.address));
    if (changed || now - this.lastWorkSave >= 10000) this.saveEvolution();
    // Refresh minute counters only when they are visible.
    if (changed || this.hovered) cx.notify();
  }

  prepareEvolutions(cx) {
    for (const agent of agents()) {
      const record = this.evolution[agent.address], entry = this.presence.get(agent.address);
      if (this.drag?.address === agent.address) continue;
      if (!record?.due || entry?.phase !== "active") continue;
      const number = this.pokemon[agent.address]?.[0];
      const reserved = new Set(Object.entries(this.pokemon).filter(([address]) => address !== agent.address).map(([,mon]) => mon[0]));
      for (const [address, progress] of Object.entries(this.evolution)) {
        if (address !== agent.address && progress.target) reserved.add(progress.target[0]);
      }
      if (record.target && reserved.has(record.target[0])) record.target = null;
      if (!record.target) {
        const choices = nextForms(number).filter(mon => !reserved.has(mon[0]));
        if (!choices.length) continue;
        record.target = choices[Math.floor(Math.random() * choices.length)];
        this.saveEvolution();
      }
      const next = record.target[0];
      if (this.assets.get(number)?.state !== "ready" || this.assets.get(next)?.state !== "ready") continue;
      const key = `${number}-${next}`, effect = this.evolutionEffects.get(key);
      if (!effect || (effect.state === "failed" && Date.now() >= effect.retry)) {
        this.evolutionEffects.set(key, {state:"loading"});
        cx.spawn(async cx => {
          try {
            const result = await exec("python3", [`${appHome()}/mods/pokemon-agents/evolution_effect.py`, String(number), String(next)]);
            if (result.code !== 0) throw new Error(result.stderr || "Evolution effect failed");
            this.evolutionEffects.set(key, {state:"ready", ...JSON.parse(result.stdout)});
          } catch (error) {
            this.evolutionEffects.set(key, {state:"failed", retry:Date.now() + 30000});
            console.log(`Evolution ${key}: ${error}`);
          }
          cx.notify();
        });
        continue;
      }
      if (effect.state !== "ready") continue;
      const now = Date.now(), motion = this.walker(agent.address);
      if (motion.walking) {
        const fraction = Math.max(0, Math.min(1, (now - motion.started) / motion.duration));
        motion.x = motion.fromX + (motion.x - motion.fromX) * fraction;
        motion.y = motion.fromY + (motion.y - motion.fromY) * fraction;
      }
      motion.walking = false; motion.duration = 0; motion.action = "idle"; motion.direction = "s";
      Object.assign(entry, {phase:"evolution", started:now, duration:effect.duration, effect:effect.path, nextMon:record.target});
      if (this.hovered === agent.address) this.hovered = null;
      cx.notify();
    }
  }

  // Hidden testing shortcuts reuse the normal download, reservation and effect pipeline.
  debugEvolution(address, restore, cx) {
    const entry = this.presence.get(address), mon = this.pokemon[address];
    if (!mon || !entry || !["active", "evolution"].includes(entry.phase)) return;
    this.trackWorkingTime(cx);
    const record = this.evolution[address];
    if (!record) return;
    if (restore) {
      const base = families[familyFor(mon[0])]?.[0];
      if (!base) return;
      const occupied = Object.entries(this.pokemon).some(([other, value]) => other !== address && value[0] === base[0]) ||
        Object.entries(this.evolution).some(([other, progress]) => other !== address && progress.target?.[0] === base[0]);
      if (occupied) return;
      const now = Date.now(), motion = this.walker(address);
      if (motion.walking) {
        const progress = Math.max(0, Math.min(1, (now - motion.started) / motion.duration));
        motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
        motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
      }
      Object.assign(motion, {walking:false, duration:0, action:"idle", next:now + 1000});
      this.pokemon[address] = base;
      Object.assign(record, {base, form:base[0], workingMs:0, due:false, target:null});
      entry.phase = "active";
      localStorage.setItem("pokemon", JSON.stringify(this.pokemon));
    } else {
      if (entry.phase !== "active" || !nextForms(mon[0]).length) return;
      record.due = true;
    }
    this.saveEvolution();
    this.prepareEvolutions(cx);
    this.loadAnimations(cx);
    cx.notify();
  }

  workSummary(address) {
    return `worked for ${formatTime(this.evolution[address]?.workingMs ?? 0)}`;
  }

  spriteBounds(address, status) {
    const number = this.pokemon[address]?.[0];
    const asset = this.assets.get(number), motion = this.walker(address);
    const action = status === "idle" ? "sleep" : status === "working" ? motion.action : "idle";
    return asset?.manifest?.bounds?.[action]?.[motion.direction] ?? [20.16, 18.24, 75.84, 77.76];
  }

  pokemonSprite(address, status, size = this.spriteSize()) {
    const info = this.pokemonInfo(address);
    if (!info) return div().size(size).text_size(11).child("Awaiting Pokémon");
    const {number} = info;
    const key = `pokemon-${address}`;
    const sleeping = status === "idle";
    const motion = this.walker(address);
    const asset = this.assets.get(number);
    const ready = asset?.state === "ready";
    const action = sleeping ? "sleep" : status === "working" ? motion.action : "idle";
    const filename = ready ? (asset.manifest.animations[action]?.[motion.direction] ?? asset.manifest.animations.idle[motion.direction]) : null;
    const box = this.spriteBounds(address, status);
    const iconX = Math.min(size - 24, box[2] * size / 96 + 3);
    const iconY = Math.max(2, box[1] * size / 96 - 14);
    const sprite = filename
      ? image(`data/pokemon-agents/v4/${number}/${filename}`).size(size)
      : placeholderSprite(size);
    const body = div().id(key + "-body").absolute().left(0).top(0).size(size)
      .child(div().id(`${key}-${action}-${motion.sequence ?? 0}`).size(size).child(sprite));
    const scene = div().id(key).relative().size(size).flex_none().child(body);
    if (status === "blocked" || status === "error") {
      scene.child(div().id(key + "-alert").absolute().top(iconY).left(iconX).text_size(18).font_bold()
        .text_color("#ffe6b2").child("!").loop("opacity", {from: .4, to: 1, period: 900}));
    } else if (status === "done") {
      scene.child(div().absolute().top(iconY).left(Math.max(0, box[0] * size / 96 - 8)).text_color("#fff0a8").text_size(16).frames(["✦", "·", "✧", "·"], 240));
      scene.child(div().absolute().top(iconY + 12).left(iconX).text_color("#ffffff").text_size(12).frames(["·", "✧", "·", "✦"], 240));
    } else if (sleeping) {
      scene.child(div().id(key + "-sleep").absolute().top(iconY).left(iconX).text_color("#d5e4fa").text_size(12)
        .frames(["z", "z Z", "z Z Z", "Z Z"], 900)
        .loop("top", {from: iconY, to: iconY - 4, period: 3600, easing: "ease-in-out"})
        .loop("opacity", {from: .55, to: 1, period: 3600, easing: "ease-in-out"}));
    }
    if (asset?.state === "loading" || !asset) {
      scene.child(div().absolute().bottom(0).left(0).text_size(10).text_color("#f4f7e5")
        .frames(["Arriving", "Arriving ·", "Arriving ··", "Arriving ···"], 500));
    }
    return scene;
  }

  render() {
    this.updatePanelSize();
    this.syncPresence();
    this.advanceWalkers();
    const list = [...this.presence.values()].map(entry => entry.agent);
    setAgentOrder(agents().map(a => a.address));
    // Reserve surviving assignments first, repairing duplicates from older versions.
    const occupied = new Set(), live = {};
    for (const agent of list) {
      const mon = this.pokemon[agent.address];
      if (mon && !occupied.has(mon[0])) {
        live[agent.address] = mon;
        occupied.add(mon[0]);
      }
    }
    if (JSON.stringify(live) !== JSON.stringify(this.pokemon)) {
      this.pokemon = live;
      localStorage.setItem("pokemon", JSON.stringify(live));
    }
    for (const agent of list) this.pokemonInfo(agent.address);
    const width = this.size.width, height = this.size.height;
    const stage = div().id("pokemon-meadow").relative().size_full().overflow_hidden()
      .bg("#72b998").border_t(1).border_color("#5a997d")
      .on_mouse_move((event, cx) => this.moveDrag(event, cx))
      .on_mouse_up("left", (event, cx) => { this.moveDrag(event, cx); this.stopDrag(cx); })
      .on_hover((on, cx) => { if (!on) this.stopDrag(cx); })
      .on_size_change((size, cx) => {
        if (this.panelPixels?.width !== size.width || this.panelPixels?.height !== size.height) {
          this.panelPixels = size;
          this.updatePanelSize();
          for (const motion of this.walkers.values()) {
            this.settleOnGround(motion);
            motion.walking = false;
            motion.duration = 0;
            motion.action = "idle";
            motion.next = Date.now() + 500;
          }
          cx.notify();
        }
      })
      .child(div().absolute().inset_0().children(this.biome().ground.map(tile =>
        image(tile.path).absolute().left(tile.x).top(tile.y).w(tile.w).h(tile.h))));
    if (!list.length) stage.child(div().absolute().left(25).bottom(45).text_color("#f0f8e8").text_size(13).child("Your Pokémon will arrive when an agent reports its status."));
    const actors = list.map(a => {
      const mon = this.pokemonInfo(a.address), hover = !this.drag && this.hovered === a.address;
      const motion = this.walker(a.address);
      const spriteSize = this.spriteSize(), actorSize = spriteSize;
      const bounds = this.panelBounds(a.address, a.status);
      const x = Math.max(bounds.left, Math.min(bounds.right, motion.x));
      const feet = Math.max(bounds.back, Math.min(bounds.front, motion.y));
      // All supplied sprites have eight transparent pixels below their feet.
      const top = feet - spriteSize * 88 / 96;
      const presence = this.presence.get(a.address);
      if (presence.phase !== "active" && mon) {
        return {
          actor: div().id(`roaming-${a.address}`).absolute().left(x).top(top).size(actorSize)
            .child(this.presenceSprite(a.address, spriteSize))
            .on_mouse_down("right", (event, cx) => {
              if (presence.phase !== "evolution" || !event.modifiers.control || !event.modifiers.shift) return;
              cx.stop_propagation();
              this.debugEvolution(a.address, true, cx);
            }),
          depth: feet,
        };
      }
      const status = {working:"Working",blocked:"Needs you",done:"Done",idle:"Idle"}[a.status] || a.status;
      const detail = panes().find(p => p.pane === a.pane);
      const tab = spaces().find(s => s.id === a.space)?.tabs.find(tab => tab.id === a.tab);
      const summary = (a.title || detail?.title || (tab?.named ? tab.name : "") || a.program?.name || "Agent").trim();
      const box = this.spriteBounds(a.address, a.status).map(value => value * spriteSize / 96);
      // Anchor the popup to the visible silhouette, not transparent canvas padding.
      const trigger = div().id(`pokemon-hit-${a.address}`).w(box[2] - box[0]).h(box[3] - box[1])
        .cursor_pointer()
        .on_hover((on, cx) => { if (this.drag) return; this.hovered = on ? a.address : this.hovered === a.address ? null : this.hovered; cx.notify(); })
        .on_mouse_down("left", (event, cx) => this.startDrag(a.address, event, cx))
        .on_click((event, cx) => {
          if (this.drag?.moved || this.dragClick === a.address) {
            this.dragClick = null;
            cx.stop_propagation();
            return;
          }
          if (event.modifiers.control && event.modifiers.shift) {
            cx.stop_propagation();
            this.debugEvolution(a.address, false, cx);
            return;
          }
          if (a.pane) run("pane.focus", {pane:a.pane}); else run("terminal.peek", {terminal:a.address});
        })
        .on_mouse_down("right", (event, cx) => {
          if (!event.modifiers.control || !event.modifiers.shift) return;
          cx.stop_propagation();
          this.debugEvolution(a.address, true, cx);
        });
      const popup = Popup.new(`agent-bubble-${a.address}`, trigger).anchor("bottom_left");
      const dragging = this.drag?.address === a.address;
      const actor = div().id(`${dragging ? "dragging" : "roaming"}-${a.address}`).absolute().left(x).top(top).w(actorSize).h(actorSize)
        .child(this.pokemonSprite(a.address, a.status, spriteSize));
      if (!dragging) actor
        .transition("left", {duration: motion.duration, easing: "linear"})
        .transition("top", {duration: motion.duration, easing: "linear"});
      if (hover && mon) {
        const space = spaces().find(s => s.id === a.space);
        const title = summary;
        const bubbleWidth = Math.min(280, Math.max(200, width - 24));
        popup.content(v_flex().w(bubbleWidth).p(12).gap(5)
          .rounded(12).border(2).border_color("#263b32").bg("#fff9e8").text_color("#20372d").text_size(12)
          .child(h_flex().justify_between().gap(5).child(div().font_bold().child(mon.name))
            .child(div().text_size(10).child(`${mon.type} · ${status}`)))
          .child(div().font_semibold().truncate().child(a.space_name || space?.name || "Agent"))
          .child(div().truncate().child(title))
          .child(div().text_size(10).text_color("#526457").truncate().child(`${a.program?.name || "Agent"} · ${a.address}`))
          .child(div().text_size(10).text_color("#526457").child(this.workSummary(a.address)))
          .child(div().text_size(10).text_color("#526457").child("Click Pokémon to focus agent"))
          .child(div().text_size(10).text_color("#526457").child(
            this.assets.get(mon.number)?.state === "ready" ? "SpriteCollab · artist credits saved with sprites" :
            this.assets.get(mon.number)?.state === "failed" ? "Generic companion · download will retry" : "Downloading animation cycles…")));

      }
      actor.child(div().absolute().left(box[0]).top(box[1]).w(box[2] - box[0]).h(box[3] - box[1]).child(popup));
      return {actor, depth: feet};
    });
    // Draw the back of the meadow first so nearer Pokémon occlude distant ones.
    for (const prop of this.biome().scenery) actors.push({
      // Give each tree its own clipped paint bounds and stable identity, just
      // like actors, so overlapping image draws retain the shared painter order.
      actor: div().id(prop.id).absolute().left(prop.x).top(prop.y).w(prop.w).h(prop.h).overflow_hidden()
        .child(image(prop.path).size_full()),
      depth: prop.depth, x: prop.x,
    });
    actors.sort(compareDepth);
    for (const item of actors) stage.child(item.actor);
    stage.child(h_flex().absolute().top(10).left(14).right(14).items_center().justify_between()
      .child(div().px(10).py(5).rounded(6).bg("#132e25e8").text_size(12).text_color("#edf8dc")
        .child(`${BIOME_LABELS[this.biomeType]} · ${agents().length} agent${agents().length === 1 ? "" : "s"}`))
      .child(this.optionsMenu()));
    // Keep release events out of Popup triggers and other controls while dragging.
    // A stationary surface also keeps the pointer target stable as actors move.
    if (this.drag) stage.child(div().id("pokemon-drag-surface").absolute().inset_0()
      .on_mouse_move((event, cx) => { this.moveDrag(event, cx); cx.stop_propagation(); })
      .on_mouse_up("left", (event, cx) => {
        this.moveDrag(event, cx);
        this.stopDrag(cx);
        cx.stop_propagation();
      })
      .on_mouse_down("left", (_event, cx) => { this.stopDrag(cx); cx.stop_propagation(); })
      .on_click((_event, cx) => { this.stopDrag(cx); cx.stop_propagation(); })
      .on_hover((on, cx) => { if (!on) this.stopDrag(cx); }));
    return stage;
  }
}
