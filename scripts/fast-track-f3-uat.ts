import { renderF3UatPlan, resolveF3UatCommand } from "../src/lib/fast-track-f3-uat";

const result = resolveF3UatCommand(process.argv.slice(2), process.env);

if (result.kind === "plan") {
  process.stdout.write(`${renderF3UatPlan(result.scenarios)}\n`);
} else {
  process.stderr.write(`${result.code}: ${result.message}\n`);
  process.exitCode = result.kind === "blocked" ? 78 : 64;
}
