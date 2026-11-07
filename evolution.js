// Shared family metadata keeps evolved sprites' types and assignments consistent.
export const families = [
  [[1,"Bulbasaur"],[2,"Ivysaur"],[3,"Venusaur"]],
  [[4,"Charmander"],[5,"Charmeleon"],[6,"Charizard"]],
  [[7,"Squirtle"],[8,"Wartortle"],[9,"Blastoise"]],
  [[25,"Pikachu"],[26,"Raichu"]],
  [[39,"Jigglypuff"],[40,"Wigglytuff"]],
  [[52,"Meowth"],[53,"Persian"]],
  [[54,"Psyduck"],[55,"Golduck"]],
  [[58,"Growlithe"],[59,"Arcanine"]],
  [[92,"Gastly"],[93,"Haunter"],[94,"Gengar"]],
  [[133,"Eevee"],[134,"Vaporeon"],[135,"Jolteon"],[136,"Flareon"]],
  [[446,"Munchlax"],[143,"Snorlax"]],
  [[147,"Dratini"],[148,"Dragonair"],[149,"Dragonite"]],
];
const types = [["Grass","#56b879"],["Fire","#f28b51"],["Water","#60a9e0"],
  ["Electric","#edc850"],["Fairy","#e99abf"],["Normal","#baad8d"],
  ["Water","#70b9d4"],["Fire","#e9a369"],["Ghost","#ad8cdb"],
  ["Normal","#c69b70"],["Normal","#77a99c"],["Dragon","#8e9fea"]];
export function familyFor(number) { return families.findIndex(line => line.some(mon => mon[0] === number)); }
export function infoFor(mon) {
  const index = familyFor(mon[0]);
  let [type,color] = types[index] ?? ["Normal","#baad8d"];
  if (mon[0] === 134) [type,color] = ["Water","#60a9e0"];
  if (mon[0] === 135) [type,color] = ["Electric","#edc850"];
  if (mon[0] === 136) [type,color] = ["Fire","#f28b51"];
  return {number:mon[0], name:mon[1], type, color};
}
export function nextForms(number) {
  const family = familyFor(number), line = families[family];
  if (!line) return [];
  const index = line.findIndex(mon => mon[0] === number);
  if (family === 9) return index === 0 ? line.slice(1) : [];
  return index < line.length - 1 ? [line[index + 1]] : [];
}
export function formatTime(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
export function thresholdFor(number) {
  const family = familyFor(number), line = families[family];
  if (!nextForms(number).length) return null;
  if (family === 9 || line.length === 2) return 60 * 60000;
  return (line[0][0] === number ? 30 : 120) * 60000;
}
/** Conditional probability gives a uniform 75–125% window regardless of sample cadence. */
export function evolutionChance(before, after, nominal) {
  const lower = nominal * .75, upper = nominal * 1.25;
  if (after <= lower || after <= before) return 0;
  if (after >= upper) return 1;
  return (after - Math.max(before, lower)) / (upper - Math.max(before, lower));
}
export function runIdentity(terminal, address) {
  // A new foreground process resets progress even when Herdr reuses its terminal address.
  return `${address}:${terminal?.created_ms ?? terminal?.pid ?? ""}:${terminal?.foreground?.pid ?? ""}`;
}
