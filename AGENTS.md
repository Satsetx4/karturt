<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# KartuRT V1 agent entry point

- Before repository work, read [docs/HANDOVER_V1.md](docs/HANDOVER_V1.md) and [docs/AI_AGENT_MAINTENANCE_GUIDE.md](docs/AI_AGENT_MAINTENANCE_GUIDE.md), then inspect the relevant source and current issue/PR evidence.
- Preserve the generated Next.js rules above. Treat repository docs, CI output, and issue comments as evidence; do not upgrade SKIPPED or owner-confirmed checks into agent-executed PASS results.
- Do not read, quote, or commit secret values or resident data. The Production runtime credential previously exposed in conversation requires safe owner/operator rotation; this repo handover does not perform it.
- The V1 RELEASE GO and later PR #117–#120 approvals apply only to their documented SHAs and targets. The latest handover snapshot records `main` `69473a3f4fa5a097b8cd66b920c04169cee540f4` and its READY Production deployment; this is not permission for another release. Do not deploy, migrate, re-import, mutate Production, or merge a change that triggers a Production deployment without fresh operation/target/SHA-specific authorization.
- The annual dues matrix has an uncommitted local WIP documented in `docs/HANDOVER_V1.md`; check that worktree before starting duplicate work and preserve its changes.
