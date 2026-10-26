export type ProductionMigrationMode = "plan" | "preflight" | "apply";

export function parseProductionMigrationMode(arguments_: readonly string[]): ProductionMigrationMode {
  if (arguments_.length !== 2 || arguments_[0] !== "--production") {
    throw new Error("Production migration requires exactly --production with one of --plan, --preflight, or --apply.");
  }

  const mode = arguments_[1];
  if (mode === "--plan") return "plan";
  if (mode === "--preflight") return "preflight";
  if (mode === "--apply") return "apply";
  throw new Error("Production migration requires exactly --production with one of --plan, --preflight, or --apply.");
}
