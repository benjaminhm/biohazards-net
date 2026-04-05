# Platform organisations — environment notes

Reference for humans and agents working on `biohazards-net`. Update when orgs change.

## Platform admin: create company vs invite people

- **Create the organisation (default)** — **Organisations** tab → **+ New Organisation** — only inserts an **`orgs`** row (name, slug, plan, seats). Same as “add a new file”: one company at a time. Inviting staff is **separate**.
- **Company + admin invite (optional bundle)** — **+ Company & admin invite** runs **`/api/admin/provision`**: org + `people` row + invite token + link. Use when you want the full package in one step.
- **Invite administrators separately** — **Administrators** tab → invite by email; org assignment can happen later from **Pending** (or **Move org…** on **Administrators**). Org on invite remains optional in that flow.

## Classification

| Organisation              | Slug                     | Notes                                      |
|----------------------------|--------------------------|--------------------------------------------|
| Brisbane Biohazard Cleaning | `brisbanebiohazardcleaning` | **Production org — real company, real data.** Treat as non-disposable; no test deletes here. |
| SD Company                 | `sdcompany`              | **Test / sandbox** — safe to remove when delete tooling or manual cleanup exists. |
| Test Cleaning Co           | `testcleaningco`         | **Test / sandbox** — same as above. |

## TODO (product / engineering)

- [ ] **Delete vs disable:** Keep **Disable** for production safety; add **Delete** only with guards (e.g. no users / no jobs) or soft-delete — see team discussion.
- [ ] **Test org cleanup:** When ready, remove or archive **SD Company** and **Test Cleaning Co** without touching **Brisbane Biohazard Cleaning** data.
- [ ] **Optional UX:** Platform admin table — filter “active only”, or tag rows as test vs production (manual flag or naming convention).

## Platform admin: Pending vs provision invite

These are **different** flows; mixing them up causes confusion (e.g. “invite invalid — member of a different organisation”).

### Provision — **New Organisation** (email with `/invite/{token}` link)

- Creates org + person + invite token; admin follows the link and **claims** via `POST /api/invites/[token]` (`src/app/api/invites/[token]/route.ts`).
- **One org per Clerk user** for claim: if `org_users` already has a row for this user for **another** `org_id`, claim returns **409** — *“You are already a member of a different organisation”*.
- **Good for:** first admin of a **new** company, using an email / Clerk user that is **not** already assigned to any org (or dev-only: remove the old `org_users` row first).

### **Pending** tab — assign users who have **no org yet**

- **Pending** = users who exist in **Clerk** but have **no** row in **`org_users`** (`GET /api/admin/users/pending`).
- Platform admin assigns org + role via `POST /api/admin/users/pending` — inserts `org_users`.
- If you somehow assign a user who **already** has an `org_users` row (e.g. race), the API returns **409** with `NEEDS_MOVE_CONFIRMATION` until `confirm_move: true` — the platform UI shows a **move** confirmation (one org per user).

### **Administrators** tab — **Move org…**

- Lists everyone with an `org_users` row. Rows other than the hard-coded platform owner have **Move org…**: pick a **different** active org + role, then **Confirm**.
- If the user is already in **another** org, a modal explains that they **cannot be in two orgs** and asks to **authorise moving** them (deletes old `org_users` row(s), inserts the new membership). Same API as Pending: `POST /api/admin/users/pending` with `confirm_move` after confirmation.

### Quick test of a new provisioned org

- Use a **new** address (e.g. Gmail `+alias`) so Clerk + DB see a user with **no** prior `org_users` row, **or** adjust **dev** DB only.

## Clerk / Supabase

- Local dev uses **Clerk Development** and may point at dev Supabase depending on `.env.local` — still treat **Brisbane Biohazard Cleaning** as real if that env shares production data; confirm env before destructive work.

## Disabled organisations (`is_active = false`)

- Tenant resolution (`getOrgId` / `getOrgResultForUser`) **excludes** inactive orgs — users lose org context until re-enabled.
- **Claude / Anthropic** routes that handle job or document data require **Clerk auth** and an **active** org match (`build-document`, `chat-document`, `edit-document`, `generate/[type]`, job SmartFill extract routes). Inactive orgs cannot send that data to the API.
- **Platform admin nudge** (`/api/admin/actions/nudge`) is unchanged — platform staff only, not tenant data paths.
- **`POST /api/extract`** (public SmartFill on intake) does not load org rows from the DB; it only formats pasted text. Disable org policy does not apply the same way there.
