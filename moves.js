import { typeForSpecies } from "./evolution.js";

const DEFAULT_MOVES = {
  Dragon: "dragon-pulse",
  Electric: "lightning-whip",
  Fairy: "fairy-nova",
  Fire: "fire-breath",
  Ghost: "shadow-burst",
  Grass: "leaf-storm",
  Normal: "shockwave-ring",
  Water: "water-jet",
};

export function moveForSpecies(number) {
  return DEFAULT_MOVES[typeForSpecies(number)];
}
