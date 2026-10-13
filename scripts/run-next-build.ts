import { runNextCommand } from "./lib/next-command";

process.exitCode = runNextCommand("build");
