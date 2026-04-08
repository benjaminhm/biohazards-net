# Document rules and layout (team reference)

How AI-generated documents get their **words** vs their **look**.

## Content and tone (Claude)

Merge order in prompts (earlier → later; org text refines platform text):

1. **Code baseline** — `PLATFORM_DOCUMENT_RULES_BASELINE` in [`src/lib/documentRules.ts`](../src/lib/documentRules.ts) (deploy to change).
2. **Platform DB rules** — table `platform_document_rules`, one **`document_rules` JSONB column** (not a `.json` file in the repo). Keys mirror org rules: text (`general`, `report`, …) and optional style URLs (`report_pdf`, …). Edited in **Platform admin → AI doc rules**; PDFs upload via [`src/app/api/admin/platform-style-pdf/route.ts`](../src/app/api/admin/platform-style-pdf/route.ts). Loaded via [`src/lib/platformDocumentRules.ts`](../src/lib/platformDocumentRules.ts). On **build**, the platform PDF is attached to Claude first; an org’s `[type]_pdf` is attached second and is instructed to win on conflicts.
3. **Organisation rules** — `company_profile.document_rules` (optional `[type]_pdf` URLs still org-only).

- **Where org rules are edited:** Settings → Document Rules (AI Instructions), and the per-job document page → “[Doc type] Instructions” panel.
- **Where they are applied:**
  - Initial generation: [`src/app/api/build-document/route.ts`](../src/app/api/build-document/route.ts).
  - Chat edits: [`src/app/api/chat-document/route.ts`](../src/app/api/chat-document/route.ts) (client still sends merged org `general` + type string; server adds baseline + platform DB layers).
  - Legacy edit bar: [`src/app/api/edit-document/route.ts`](../src/app/api/edit-document/route.ts) (baseline + platform DB for that doc type; org rules are not passed from that modal).

Shared helpers: [`src/lib/documentRules.ts`](../src/lib/documentRules.ts).

**Migration:** run `supabase-migration-024-platform-document-rules.sql` once so the table exists.

**Anthropic Console / Playground “custom instructions” or a `.me`-style file do not apply to API calls.** Rules must be sent on each request; the app does that via the above.

## Visual layout (orange headings, headers, PDF)

- Claude returns **structured JSON** (e.g. `executive_summary`, `site_conditions`). It does not control CSS, fonts, or section colours.
- **HTML print / preview:** [`src/lib/printDocument.ts`](../src/lib/printDocument.ts).
- **PDF:** [`src/components/PDFDocument.tsx`](../src/components/PDFDocument.tsx).
- **Branding:** logo and company block come from `company_profile` fields used by those renderers.

To change how documents **look**, update print/PDF templates (and optionally add org-level theme fields later). To change how they **read**, update `document_rules` and/or the JSON schema text in `buildPrompt()` in `build-document`.

## Related

- Product stance on AI and comms: [ai-product-principles.md](./ai-product-principles.md).
