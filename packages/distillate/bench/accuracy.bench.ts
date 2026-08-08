import { accuracyRows, formatRows } from "./accuracy.js";
import { envBanner } from "./harness.js";

console.log(envBanner());
console.log(formatRows(accuracyRows([10_000, 100_000, 1_000_000])));
