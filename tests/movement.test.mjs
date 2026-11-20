import test from "node:test";
import assert from "node:assert/strict";
import { clearRoute } from "../biome.js";
import { separationStep, walkKeepsDistance } from "../movement.js";

const panel = {left: 0, right: 160, back: 0, front: 100};
const companion = (x, y, radius = 19) => ({x, y, radius});

test("companions starting at the same point spread out and come to rest", () => {
  const neighbors = Array.from({length: 5}, () => companion(80, 50));
  const stepFor = actor => separationStep(actor, neighbors, panel, () => true);
  for (let tick = 0; tick < 20; tick++) {
    for (const actor of neighbors) Object.assign(actor, stepFor(actor));
  }
  for (const [index, actor] of neighbors.entries()) {
    assert.equal(stepFor(actor), null);
    for (const other of neighbors.slice(index + 1)) {
      assert.ok(Math.hypot(actor.x - other.x, (actor.y - other.y) / .7) >= 37);
    }
  }
});

test("separation finds a detour when terrain and the panel edge block direct moves", () => {
  const actor = companion(0, 34), other = companion(8, 34);
  const biome = {obstacles: [{x: 0, y: 40, w: 30, h: 30}]};
  const canReach = (x, y) => clearRoute(biome, actor.x, actor.y, x, y);
  const step = separationStep(actor, [actor, other], panel, canReach);
  assert.ok(step && step.x >= panel.left && step.y < actor.y);
  assert.ok(canReach(step.x, step.y));
  assert.equal(separationStep(actor, [actor, other], panel, () => false), null);
});

test("wandering avoids crossing a companion and allows walking out of an overlap", () => {
  const actor = companion(30, 40), other = companion(80, 40);
  assert.equal(walkKeepsDistance(actor, 130, 40, [actor, other]), false);
  assert.equal(walkKeepsDistance(actor, 60, 40, [actor, other]), false);
  assert.equal(walkKeepsDistance(actor, 30, 70, [actor, other]), true);
  other.x = 40;
  assert.equal(walkKeepsDistance(actor, 16, 40, [actor, other]), true);
  assert.equal(walkKeepsDistance(actor, 40, 40, [actor, other]), false);
});
