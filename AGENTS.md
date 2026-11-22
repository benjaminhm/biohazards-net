<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product: AI and messaging boundaries

Before adding AI features, client-facing automation, or sender identity logic, read **`docs/ai-product-principles.md`** (human-owned comms; AI backend-only and invisible to clients; HITL; technician vs admin/accounts).

## UX / UI Scope & Archived Pages

Before auditing, redesigning, or simplifying any UI/UX or data-entry workflow, read **`docs/ux-audit-tags.json`** (maintained via the in-app admin `🏷️ Tag UI` tool in `src/components/UxTagger.tsx` and synced from `orgs.features`). Skip every entry listed under `ignore`, preserve `keep`, and focus simplification work on `simplify`.
