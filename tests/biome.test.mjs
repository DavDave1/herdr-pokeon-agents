import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBiome, roadMask, BIOME_TYPES, TILE, isWalkable} from '../biome.js';
import {createBiomeWorld, getBiomeWorld, overlaps, WORLD_HEIGHT} from '../biome-world.js';

const terrain = 'terrain';
const worldGround = (biome, height) => new Map(biome.ground
  .map(p => [`${p.x}:${Math.round((p.y - height + WORLD_HEIGHT) / TILE)}`, p.path]));

test('seeded worlds are deterministic regardless of chunk generation order', () => {
  for (const type of BIOME_TYPES) {
    const a = createBiomeWorld(8923, type), b = createBiomeWorld(8923, type);
    const coords = [[0,0],[1,0],[-1,-1],[0,-1],[2,1]];
    const expected = coords.map(([x,y]) => a.chunk(x,y));
    for (const [x,y] of [...coords].reverse()) b.chunk(x,y);
    coords.forEach(([x,y],i) => assert.deepEqual(b.chunk(x,y),expected[i]));
  }
});

test('fractional resizing reveals the same cells and props, and reuses world chunks', () => {
  for (const type of BIOME_TYPES) for (const seed of [0,1,42,0xffffffff]) {
    const a = buildBiome(1000,270,terrain,seed,type), expected = worldGround(a,270);
    for (const height of [180,270.25,391.75,600]) {
      const b = buildBiome(1400,height,terrain,seed,type), actual = worldGround(b,height);
      for (const [key,path] of expected) if (actual.has(key)) assert.equal(actual.get(key),path);
      for (const p of a.scenery.filter(p => p.y + height - WORLD_HEIGHT >= 0 && p.y + p.h < WORLD_HEIGHT)) {
        const q = b.scenery.find(q => q.id === p.id);
        assert.ok(q,p.id);
        for (const key of ['x','w','h','path']) assert.equal(q[key],p[key]);
        assert.ok(Math.abs((height-q.y-q.h)-(270-p.y-p.h))<1e-8);
      }
    }
    const world=getBiomeWorld(seed,type), count=world.stats.generatedChunks;
    buildBiome(1000,270,terrain,seed,type);
    assert.equal(world.stats.generatedChunks,count);
  }
});

test('roads stay open; props avoid water, grass and incompatible canopies', () => {
  let checkedRocks=0, checkedTrees=0, checkedWater=0;
  for (const type of BIOME_TYPES) for (let seed=0;seed<30;seed++) {
    const b=buildBiome(1400,500,terrain,seed,type);
    const props=b.scenery;
    const grass=b.ground.filter(p=>p.path.includes('/grass-'));
    const water=b.ground.filter(p=>p.path.includes('/water-'));
    const roads=b.ground.filter(p=>p.path.includes('/road-'));
    for (const p of props) {
      assert.ok(!water.some(q=>overlaps(p,q)),`${type} ${seed}: prop/water`);
      assert.ok(!roads.some(q=>overlaps(p,q)),`${type} ${seed}: prop/road`);
      if (p.kind==='tree') checkedTrees++;
      else checkedRocks++;
      if (type==='forest') assert.ok(!grass.some(q=>overlaps(p,q)),`forest ${seed}: prop/grass`);
      if (p.kind==='rock') assert.ok(!props.some(q=>q.id!==p.id&&overlaps(p,q)),`${type} ${seed}: rock/prop`);
    }
    for (const p of water) {checkedWater++;assert.equal(isWalkable(b,p.x+16,p.y+16,0),false);}
    for (const p of roads.filter(p=>p.y>64)) assert.equal(isWalkable(b,p.x+16,p.y+16,0),true);
  }
  assert.ok(checkedTrees>0 && checkedRocks>0 && checkedWater>0);
});

test('all connected tile masks match world neighbors, and seeds change layouts', () => {
  for (const type of BIOME_TYPES) {
    const signatures=new Set();
    for(let seed=0;seed<12;seed++) {
      const world=getBiomeWorld(seed,type), b=buildBiome(1000,270,terrain,seed,type);
      for (const tile of b.ground) {
        const x=tile.x/TILE,y=tile.y/TILE,kind=world.cell(x,y);
        if(kind==='ground') continue;
        const mask=roadMask((x,y)=>world.cell(x,y)===kind,x,y);
        assert.ok(tile.path.endsWith(`/${kind}-${mask}.png`));
      }
      signatures.add(b.ground.map(p=>p.path).join(','));
    }
    assert.equal(signatures.size,12);
  }
});

test('placeholder fills the viewport without needing world assets', () => {
  const b=buildBiome(1001,399.5);
  assert.ok(b.ground.length>0);assert.equal(b.scenery.length,0);assert.equal(b.obstacles.length,0);
  assert.ok(b.ground.some(p=>p.y<=0));assert.ok(b.ground.some(p=>p.y+p.h>=399.5));
});

test('chunk cache is bounded and eviction preserves generation results', () => {
  const world=createBiomeWorld(927,'desert');
  const original=world.chunk(0,0);
  for(let x=1;x<=66;x++) world.chunk(x,0);
  assert.equal(world.stats.chunks,64);
  assert.deepEqual(world.chunk(0,0),original);
});
