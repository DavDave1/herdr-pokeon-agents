export const ASSET_ROOT = "data/pokemon-agents";
export const TERRAIN_VERSION = 10;
export const SPRITE_VERSION = 4;
export const TERRAIN_PATH = `${ASSET_ROOT}/terrain/emerald-v${TERRAIN_VERSION}`;
export const SPRITE_PATH = `${ASSET_ROOT}/v${SPRITE_VERSION}`;
export const movePackPath = (move, number) => `${ASSET_ROOT}/moves/${move}-v1/${number}`;
