export type StagingMigrationMode = "plan" | "preflight" | "apply";

export function parseStagingMigrationMode(arguments_: readonly string[]): StagingMigrationMode {
  if (arguments_.length === 0) return "plan";
  if (arguments_.length !== 1) {
    throw new Error("Staging migration accepts exactly one mode: --plan, --preflight, or --apply.");
  }

  const mode = arguments_[0];
  if (mode === "--plan") return "plan";
  if (mode === "--preflight") return "preflight";
  if (mode === "--apply") return "apply";

  throw new Error("Staging migration accepts exactly one mode: --plan, --preflight, or --apply.");
}
