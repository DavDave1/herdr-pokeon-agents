const DEPTH_SCALE = .7;
const TURN = Math.PI / 4;

export function boundedStep(x, y, dx, dy, bounds) {
  // If separation or resizing put a companion outside its usual range, it can move inward.
  const clamp = (value, delta, min, max) =>
    Math.max(Math.min(value, min), Math.min(Math.max(value, max), value + delta));
  return {x: clamp(x, dx, bounds.left, bounds.right), y: clamp(y, dy, bounds.back, bounds.front)};
}

function spacingCost(actor, x, y, neighbors) {
  let cost = 0;
  for (const other of neighbors) {
    if (actor === other) continue;
    const distance = Math.hypot(x - other.x, (y - other.y) / DEPTH_SCALE);
    const overlap = Math.max(0, actor.radius + other.radius - distance);
    cost += overlap ** 2;
  }
  return cost;
}

export function separationStep(actor, neighbors, bounds, canReach) {
  const {x, y} = actor;
  let bestCost = spacingCost(actor, x, y, neighbors);
  if (bestCost < 1) return null;
  const distance = Math.min(22, Math.max(6, Math.sqrt(bestCost) / 2));
  // Try moves in every direction, including when two companions coincide
  // or the most direct way out is blocked by terrain or a panel edge.
  let step = null;
  for (let direction = 0; direction < 8; direction++) {
    const angle = direction * TURN;
    const candidate = boundedStep(x, y, Math.cos(angle) * distance, Math.sin(angle) * distance * DEPTH_SCALE, bounds);
    const {x: nextX, y: nextY} = candidate;
    const cost = spacingCost(actor, nextX, nextY, neighbors);
    if (cost >= bestCost - 1 || !canReach(nextX, nextY)) continue;
    step = candidate;
    bestCost = cost;
  }
  return step;
}

export function walkKeepsDistance(actor, x, y, neighbors) {
  const dx = x - actor.x, dy = (y - actor.y) / DEPTH_SCALE;
  const lengthSquared = dx ** 2 + dy ** 2;
  if (!lengthSquared) return true;
  return neighbors.every(other => {
    if (actor === other) return true;
    const ox = other.x - actor.x, oy = (other.y - actor.y) / DEPTH_SCALE;
    const progress = Math.max(0, Math.min(1, (ox * dx + oy * dy) / lengthSquared));
    const nearest = Math.hypot(ox - dx * progress, oy - dy * progress);
    const spacing = Math.min(actor.radius + other.radius, Math.hypot(ox, oy));
    return nearest >= spacing - 1;
  });
}
