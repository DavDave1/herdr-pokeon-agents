import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Popup, Popover } from "gpui-base";
import { agents, panes, spaces, run, setAgentOrder, exec, appHome, terminals, settings, checking } from "herdr";

import { families, infoFor, nextForms, thresholdFor, evolutionChance, runIdentity, formatTime } from "./evolution.js";
import { placeholderSprite } from "./placeholder.js";
import { statusSprites } from "./status-sprite.js";
import { buildBiome, clearRoute, isWalkable, nearestGround, compareDepth, BIOME_TYPES, BIOME_LABELS } from "./biome.js";
import { WORLD_HEIGHT } from "./biome-world.js";
import { SPRITE_PATH, SPRITE_VERSION, TERRAIN_PATH, TERRAIN_VERSION } from "./asset-paths.js";
import { boundedStep, separationStep, walkKeepsDistance } from "./movement.js";

const DIRECTIONS = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];
const PLACEHOLDER_BOUNDS = [20.16, 18.24, 75.84, 77.76];

function spriteBody([left, top, right, bottom], size) {
  const scale = size / 96;
  return {x: (left - 48) * scale, y: (top - 88) * scale,
    w: (right - left) * scale, h: (bottom - top) * scale};
}

function walkingBody(bounds, size) {
  // Keep room for every walking frame and the poses at the start and end of a step.
  const [first, ...rest] = ["walk", "idle", "sleep"].flatMap(action => Object.values(bounds?.[action] ?? {}));
  const envelope = rest.reduce((a, b) => [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]),
  ], first ?? PLACEHOLDER_BOUNDS);
  return spriteBody(envelope, size);
}

function startWalk(actor, x, y, now, speed) {
  const {motion} = actor;
  const dx = x - motion.x, dy = y - motion.y;
  const heading = Math.round(Math.atan2(dy / .55, dx) / (Math.PI / 4));
  const duration = Math.round(Math.hypot(dx, dy) / speed * 1000);
  Object.assign(motion, {
    fromX: motion.x, fromY: motion.y, x, y, started: now, duration,
    direction: DIRECTIONS[(heading + 8) % 8], action: "walk", walking: true,
    sequence: (motion.sequence ?? 0) + 1, next: now + duration,
  });
  // Reserve the destination for the companions choosing their next step.
  Object.assign(actor, {x, y});
}

function spriteAction(status, motion) {
  if (motion.walking) return "walk";
  if (status === "idle") return "sleep";
  return status === "working" ? motion.action : "idle";
}

async function prepareArtwork(task, ...species) {
  const home = appHome();
  const result = await exec("node", [`${home}/mods/pokemon-agents/assets/prepare.js`, home, task, ...species.map(String)],
    { timeout: 120_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Artwork helper failed for ${task}`);
  return JSON.parse(result.stdout);
}

export default class PokemonHabitat extends View {
  init(_props, cx) {
    this.pokemon = JSON.parse(localStorage.getItem("pokemon") ?? "{}");
    this.size = {width: 1000, height: WORLD_HEIGHT};
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
    this.optionsOpen = false;
    this.walkers = new Map();
    this.presence = new Map();
    this.assets = new Map();
    this.downloads = 0;
    this.terrain = {state: "pending"};
    this.evolution = JSON.parse(localStorage.getItem("evolution-progress") ?? "{}");
    this.evolutionEffects = new Map();
    this.lastWorkSample = Date.now();
    this.lastWorkSave = Date.now();
    this.previousWorking = new Set();
    if (checking()) return;
    this.loadTerrain(cx);
    cx.timer.every(1000, cx => {
      this.trackWorkingTime(cx);
      this.prepareEvolutions(cx);
    });
    // Timers choose activity phases; native transitions and sprite cycles render each frame.
    cx.timer.every(250, cx => {
      const presenceChanged = this.syncPresence();
      const movementChanged = this.advanceWalkers(true);
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
      if (entry.phase === "loading" && this.drag?.address !== agent.address && ["ready", "failed"].includes(asset?.state)) {
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
    if (!entry.cached) return placeholderSprite(size);
    const number = this.pokemon[address]?.[0];
    return div().id(`pokeball-${address}-${entry.phase}-${entry.started}`).size(size)
      .child(image(`${SPRITE_PATH}/${number}/${entry.phase}.webp`).size(size));
  }

  loadTerrain(cx) {
    if (["loading", "ready"].includes(this.terrain.state) || Date.now() < (this.terrain.retry ?? 0)) return;
    const attempts = this.terrain.attempts ?? 0;
    this.terrain = {state: "loading", attempts};
    cx.spawn(async cx => {
      try {
        const manifest = await prepareArtwork("terrain");
        if (manifest.version !== TERRAIN_VERSION || manifest.path !== TERRAIN_PATH) throw new Error("Invalid terrain manifest");
        this.terrain = {state: "ready", path: manifest.path};
        for (const [address, motion] of this.walkers) {
          if (motion.walking) {
            const progress = Math.min(1, Math.max(0, (Date.now() - motion.started) / motion.duration));
            motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
            motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
          }
          this.settleOnGround(address, motion);
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
          const manifest = await prepareArtwork("sprites", number);
          if (manifest.version !== SPRITE_VERSION || manifest.number !== number) throw new Error("Invalid sprite manifest");
          this.assets.set(number, {state: "ready", manifest, body: walkingBody(manifest.bounds, this.spriteSize())});
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
    return 158.4;
  }

  updatePanelSize() {
    if (!this.panelPixels) return;
    const zoom = Number(settings().zoom) || 1;
    // on_size_change reports painted logical pixels; numeric styles apply zoom.
    const size = {width: this.panelPixels.width / zoom, height: this.panelPixels.height / zoom};
    const deltaY = size.height - this.size.height;
    // Match the terrain's bottom-left anchor without changing walk progress.
    for (const motion of this.walkers.values()) {
      motion.y += deltaY;
      if (motion.fromY !== undefined) motion.fromY += deltaY;
    }
    if (this.drag) this.drag.y += deltaY;
    this.size = size;
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
    for (const [address, motion] of this.walkers) {
      if (motion.walking) {
        const progress = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
        motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
        motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
      }
      this.settleOnGround(address, motion);
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

  terrainBody(address) {
    return this.assets.get(this.pokemon[address]?.[0])?.body ?? spriteBody(PLACEHOLDER_BOUNDS, this.spriteSize());
  }

  groundFor(address, x, y) {
    const biome = this.biome(), offset = this.spriteSize() / 2, body = this.terrainBody(address);
    const point = nearestGround(biome, x, y, this.walkingBounds(), offset, body);
    if (point) return point;
    // A short sidebar can have no clear space in the usual walking strip.
    const {width, height} = this.size;
    const bounds = {
      left: Math.max(0, -body.x) - offset, right: Math.min(width, width - body.x - body.w) - offset,
      back: Math.max(0, -body.y), front: Math.min(height, height - body.y - body.h),
    };
    if (bounds.left > bounds.right || bounds.back > bounds.front) return null;
    return nearestGround(biome, x, y, bounds, offset, body);
  }

  settleOnGround(address, motion) {
    const point = this.groundFor(address, motion.x, motion.y);
    if (point) Object.assign(motion, point);
    return Boolean(point);
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
    const {address, x, y} = this.drag;
    const motion = this.walker(address);
    if (!this.settleOnGround(address, motion)) Object.assign(motion, {x, y});
    motion.next = Date.now() + 1500;
    this.drag = null;
    cx.notify();
  }

  walker(address) {
    if (!this.walkers.has(address)) {
      const bounds = this.walkingBounds();
      const x = bounds.left + Math.random() * (bounds.right - bounds.left);
      const y = bounds.back + Math.random() * (bounds.front - bounds.back);
      const point = this.groundFor(address, x, y) ?? {x, y};
      this.walkers.set(address, {
        x: point.x, y: point.y,
        direction: "s", moveChance: .2, action: "idle", walking: false, duration: 0, next: Date.now() + 500 + Math.random() * 2000,
      });
    }
    return this.walkers.get(address);
  }

  advanceWalkers(separate = false) {
    const now = Date.now();
    for (const address of this.walkers.keys()) {
      if (!this.presence.has(address)) this.walkers.delete(address);
    }
    let changed = false;
    const size = this.spriteSize(), scale = size / 96, offset = size / 2;
    const biome = this.biome();
    const companions = [];
    for (const {agent: {address, status}, phase} of this.presence.values()) {
      if (phase !== "active" || !this.pokemon[address]) continue;
      const motion = this.walker(address);
      const dragging = this.drag?.address === address;
      if (!dragging && motion.status !== status) {
        if (motion.walking && status !== "working") {
          // Freeze at the visible position, rather than sliding to the old destination.
          const progress = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
          motion.x = motion.fromX + (motion.x - motion.fromX) * progress;
          motion.y = motion.fromY + (motion.y - motion.fromY) * progress;
          motion.walking = false;
          motion.duration = 0;
        }
        motion.moveChance = .2;
        motion.action = "idle";
        motion.status = status;
        motion.next = now + 150;
        changed = true;
      }
      if (motion.walking && now >= motion.started + motion.duration) {
        motion.walking = false;
        motion.duration = 0;
        if (status !== "working") motion.action = "idle";
        changed = true;
      }
      const [left, top, right, bottom] = this.spriteBounds(address, status);
      const currentTop = motion.y - size * 88 / 96;
      if (motion.x + right * scale <= 0 || motion.x + left * scale >= this.size.width ||
          currentTop + bottom * scale <= 0 || currentTop + top * scale >= this.size.height) continue;
      const body = this.terrainBody(address);
      if (separate && !dragging && !motion.walking && !isWalkable(biome, motion.x + offset, motion.y, 5, body)) {
        // New artwork or a resize can leave a resting companion in the canopy.
        if (this.settleOnGround(address, motion)) changed = true;
      }
      // Use the resting sprite's width so turning or changing poses keeps the same spacing.
      const resting = this.assets.get(this.pokemon[address][0])?.manifest?.bounds?.idle?.s;
      const radius = (resting ? resting[2] - resting[0] : right - left) * scale / 2 + 4;
      companions.push({address, status, motion, dragging, radius, body, x: motion.x, y: motion.y});
    }
    if (!companions.length) return changed;

    const bounds = this.walkingBounds();
    for (const actor of companions) {
      const {address, status, motion, dragging, body} = actor;
      if (dragging || motion.walking) continue;
      const hovering = this.hovered === address;
      const canReach = (x, y) => clearRoute(biome, motion.x + offset, motion.y, x + offset, y, body);
      if (separate && !hovering) {
        const panel = this.panelBounds(address, status);
        // Separation can use more of the panel than a normal walk, especially
        // in a short sidebar where the ordinary walking area is a single row.
        const room = Math.max(0, panel.front - panel.back);
        const gap = Math.min(38, room / 3);
        const step = separationStep(actor, companions, {...panel, back: panel.back + gap}, canReach);
        if (step) {
          startWalk(actor, step.x, step.y, now, 52);
          changed = true;
          continue;
        }
      }
      if (status !== "working" || now < motion.next) continue;
      const number = this.pokemon[address]?.[0];
      const manifest = this.assets.get(number)?.manifest;
      if (motion.action !== "idle") {
        // Let a full idle cycle settle the pose before drawing the next activity.
        const cycle = manifest?.durations?.idle ?? 1000;
        motion.action = "idle";
        motion.sequence = (motion.sequence ?? 0) + 1;
        motion.next = now + cycle * Math.max(1, Math.ceil(900 / cycle));
        changed = true;
        continue;
      }
      if (hovering) continue;
      const actions = [...new Set([...(manifest?.randomActions ?? []), manifest?.workAction])]
        .filter(action => {
          if (!action || action === "idle") return false;
          const box = manifest?.bounds?.[action]?.[motion.direction];
          return !box || isWalkable(biome, motion.x + offset, motion.y, 5, spriteBody(box, size));
        });
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
      const {x, y} = boundedStep(motion.x, motion.y,
        Math.cos(direction) * distance, Math.sin(direction) * distance * .55, bounds);
      const length = Math.hypot(x - motion.x, y - motion.y);
      if (length < 8 || !walkKeepsDistance(actor, x, y, companions) || !canReach(x, y)) {
        motion.next = now + 500;
        continue;
      }
      startWalk(actor, x, y, now, 34);
      motion.moveChance = Math.min(1, Math.round((motion.moveChance + .1) * 100) / 100);
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
            const effect = await prepareArtwork("evolution", number, next);
            this.evolutionEffects.set(key, {state:"ready", ...effect});
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

  workSummary(address) {
    return `worked for ${formatTime(this.evolution[address]?.workingMs ?? 0)}`;
  }

  spriteBounds(address, status) {
    const number = this.pokemon[address]?.[0];
    const asset = this.assets.get(number), motion = this.walker(address);
    const action = spriteAction(status, motion);
    return asset?.manifest?.bounds?.[action]?.[motion.direction] ?? PLACEHOLDER_BOUNDS;
  }

  pokemonSprite(address, status, size = this.spriteSize()) {
    const info = this.pokemonInfo(address);
    if (!info) return div().size(size).text_size(11).child("Awaiting Pokémon");
    const {number} = info;
    const key = `pokemon-${address}`;
    const motion = this.walker(address);
    const asset = this.assets.get(number);
    const ready = asset?.state === "ready";
    const action = spriteAction(status, motion);
    const filename = ready ? (asset.manifest.animations[action]?.[motion.direction] ?? asset.manifest.animations.idle[motion.direction]) : null;
    const sprite = filename
      ? image(`${SPRITE_PATH}/${number}/${filename}`).size(size)
      : placeholderSprite(size);
    const body = div().id(key + "-body").absolute().left(0).top(0).size(size)
      .child(div().id(`${key}-${action}-${motion.sequence ?? 0}`).size(size).child(sprite));
    const scene = div().id(key).relative().size(size).flex_none().child(body);
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
      .on_mouse_up("right", (event, cx) => { this.moveDrag(event, cx); this.stopDrag(cx); })
      .on_hover((on, cx) => { if (!on) this.stopDrag(cx); })
      .on_size_change((size, cx) => {
        if (this.panelPixels?.width !== size.width || this.panelPixels?.height !== size.height) {
          this.panelPixels = size;
          this.updatePanelSize();
          cx.notify();
        }
      })
      .child(div().absolute().inset_0().children(this.biome().ground.map(tile =>
        image(tile.path).absolute().left(tile.x).bottom(height - tile.y - tile.h).w(tile.w).h(tile.h))));

    if (!list.length) stage.child(div().absolute().left(25).bottom(45).text_color("#f0f8e8").text_size(13).child("Your Pokémon will arrive when an agent reports its status."));
    const notifications = [];
    const actors = list.map(a => {
      const mon = this.pokemonInfo(a.address), hover = !this.drag && this.hovered === a.address;
      const motion = this.walker(a.address);
      const spriteSize = this.spriteSize(), actorSize = spriteSize;
      const x = motion.x, feet = motion.y;
      // Animate inside a fixed-height, bottom-anchored container: resizing
      // moves the container with terrain without changing animation targets.
      const bodyTop = feet - spriteSize * 88 / 96;
      const top = bodyTop - (height - WORLD_HEIGHT);
      const anchored = actor => div().id(`pokemon-anchor-${a.address}`).absolute()
        .left(0).bottom(0).w(width).h(WORLD_HEIGHT).child(actor);
      const presence = this.presence.get(a.address);
      if (["release", "recall", "evolution"].includes(presence.phase) && mon) {
        return {
          actor: anchored(div().id(`roaming-${a.address}`).absolute().left(x).top(top).size(actorSize)
            .child(this.presenceSprite(a.address, spriteSize))),
          depth: feet,
        };
      }
      const status = {working:"Working",blocked:"Needs you",done:"Done",idle:"Idle"}[a.status] || a.status;
      const detail = panes().find(p => p.pane === a.pane);
      const tab = spaces().find(s => s.id === a.space)?.tabs.find(tab => tab.id === a.tab);
      const summary = (a.title || detail?.title || (tab?.named ? tab.name : "") || a.program?.name || "Agent").trim();
      const box = this.spriteBounds(a.address, a.status).map(value => value * spriteSize / 96);
      if (mon) notifications.push({address: a.address, status: a.status, duration: motion.duration,
        bounds: [x + box[0], bodyTop + box[1], x + box[2], bodyTop + box[3]]});
      // Anchor the popup to the visible silhouette, not transparent canvas padding.
      const trigger = div().id(`pokemon-hit-${a.address}`).w(box[2] - box[0]).h(box[3] - box[1])
        .cursor_pointer()
        .on_hover((on, cx) => { if (this.drag) return; this.hovered = on ? a.address : this.hovered === a.address ? null : this.hovered; cx.notify(); })
        .on_click(() => {
          if (a.pane) run("pane.focus", {pane:a.pane}); else run("terminal.peek", {terminal:a.address});
        })
        .on_mouse_down("right", (event, cx) => this.startDrag(a.address, event, cx));
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
        // A pixel-edged Pokédex shell surrounds a biome-tinted LCD screen.
        const palette = {
          forest: {edge: "#243e35", frame: "#79a877", paper: "#f3f4d9", ink: "#293e32", muted: "#536650"},
          desert: {edge: "#59432f", frame: "#c9a265", paper: "#fff0cb", ink: "#503c2d", muted: "#796044"},
          cave: {edge: "#302e46", frame: "#8e86a5", paper: "#eeebf5", ink: "#39364e", muted: "#696078"},
          mountain: {edge: "#2e414d", frame: "#8ba7af", paper: "#edf2e9", ink: "#314752", muted: "#5b7078"},
        }[this.biomeType];
        const statusColor = {working: "#32664b", blocked: "#934333", done: "#355a8a", idle: "#605b69"}[a.status] || palette.muted;
        const lamp = color => div().size(7).flex_none().border(1).border_color("#512635").bg(color);
        popup.content(div().w(bubbleWidth).p(3).rounded(3).bg("#492531")
          .font_family("JetBrains Mono").text_color(palette.ink).text_size(11)
          .child(v_flex().p(8).gap(8).border(2).border_color("#f08379").bg("#be4050")
            .child(h_flex().items_center().gap(6)
              .child(div().size(25).p(3).flex_none().border(2).border_color("#fff0d8").bg("#34657d")
                .child(div().size_full().bg("#75d9e8").child(div().size(5).bg("#e5ffff"))))
              .child(lamp("#ef8a7e")).child(lamp("#f7d676")).child(lamp("#8cc589"))
               .child(div().flex_1())
               .child(div().font_bold().text_size(9).text_color("#fff0d8").child("POKÉDEX")))
             .child(div().h(2).bg("#842e43"))
            .child(div().p(4).border(2).border_color("#752d3b").bg("#dfdac5")
              .child(v_flex().p(8).gap(7).border(2).border_color(palette.edge).bg(palette.paper)
               .child(h_flex().justify_between().gap(6).text_size(8).text_color(palette.muted)
                 .child(div().flex_1().min_w(0).text_size(10).child(`${a.space_name || space?.name || "Agent"} - ${a.program?.name || "Agent"}`))
                 .child(div().flex_none().child(`No.${String(mon.number).padStart(3, "0")}`)))
                .child(h_flex().items_center().gap(7)
                  .child(div().w(6).h(18).flex_none().bg(mon.color))
                  .child(div().flex_1().min_w(0).font_bold().text_size(14).truncate().child(mon.name))
                 .child(div().flex_none().px(5).py(2).border(1).border_color(palette.edge).bg(mon.color)
                   .text_color("#202b30").font_bold().text_size(9).child(mon.type.toUpperCase())))
                .child(div().h(2).bg(palette.frame))
                .child(v_flex().gap(6)
                  .child(div().text_size(10).font_bold().text_color(statusColor)
                    .child(`${status.toUpperCase()} - ${this.workSummary(a.address)}`))
                  .child(div().font_semibold().child(title)))))
            .child(h_flex().items_center().gap(8)
              .child(div().w(20).h(6).bg("#492531"))
              .child(div().flex_1().min_w(0).px(5).py(3).border(1).border_color("#492531")
                .bg(palette.frame).text_size(8).child(
                  this.assets.get(mon.number)?.state === "ready" ? "SpriteCollab · credits saved with sprites" :
                  this.assets.get(mon.number)?.state === "failed" ? "Generic companion · download will retry" : "Downloading animation cycles…"))
              .child(h_flex().gap(2).children([0, 1, 2].map(() => div().w(2).h(10).bg("#842e43")))))));

      }
      actor.child(div().absolute().left(box[0]).top(box[1]).w(box[2] - box[0]).h(box[3] - box[1]).child(popup));
      return {actor: anchored(actor), depth: feet};
    });
    // Draw distant scenery and agents first so nearer objects can overlap them.
    for (const prop of this.biome().scenery) actors.push({
      actor: div().id(prop.id).absolute().left(prop.x).bottom(height - prop.y - prop.h).w(prop.w).h(prop.h)
        .overflow_hidden().child(image(prop.path).w(prop.w).h(prop.h)),
      depth: prop.depth, x: prop.x,
    });
    actors.sort(compareDepth);
    for (const item of actors) stage.child(item.actor);
    stage.children(statusSprites(notifications, this.size));
    stage.child(h_flex().absolute().top(10).left(14).right(14).items_center().justify_between()
      .child(div().px(10).py(5).rounded(6).bg("#132e25e8").text_size(12).text_color("#edf8dc")
        .child(`${BIOME_LABELS[this.biomeType]} · ${agents().length} agent${agents().length === 1 ? "" : "s"}`))
      .child(this.optionsMenu()));
    // Keep release events out of Popup triggers and other controls while dragging.
    // A stationary surface also keeps the pointer target stable as actors move.
    if (this.drag) stage.child(div().id("pokemon-drag-surface").absolute().inset_0()
      .on_mouse_move((event, cx) => { this.moveDrag(event, cx); cx.stop_propagation(); })
      .on_mouse_up("right", (event, cx) => {
        this.moveDrag(event, cx);
        this.stopDrag(cx);
        cx.stop_propagation();
      })
      .on_mouse_down("right", (_event, cx) => { this.stopDrag(cx); cx.stop_propagation(); })
      .on_click((_event, cx) => { this.stopDrag(cx); cx.stop_propagation(); })
      .on_hover((on, cx) => { if (!on) this.stopDrag(cx); }));
    return stage;
  }
}
