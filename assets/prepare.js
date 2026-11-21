import { isAbsolute } from "node:path";
import { prepareEvolution } from "./effects.js";
import { prepareSprites, prepareMove } from "./sprites.js";
import { prepareTerrain } from "./terrain.js";

function speciesNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1025) throw new Error("Invalid species number");
  return number;
}

try {
  const [appHome, task, first, second] = process.argv.slice(2);
  if (!appHome || !isAbsolute(appHome)) throw new Error("Expected an absolute Herdr home directory");
  let result;
  switch (task) {
    case "terrain":
      result = await prepareTerrain(appHome);
      break;
    case "sprites":
      result = await prepareSprites(appHome, speciesNumber(first));
      break;
    case "move":
      result = await prepareMove(appHome, speciesNumber(first));
      break;
    case "evolution":
      result = await prepareEvolution(appHome, speciesNumber(first), speciesNumber(second));
      break;
    default:
      throw new Error(`Unknown artwork task: ${task}`);
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
