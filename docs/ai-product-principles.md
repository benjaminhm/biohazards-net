# AI product principles (staff reference)

Captured from product discussion (2026-04). Use this when designing or implementing AI, messaging, and automation.

## Client-facing stance

- **Direct AI interaction with clients should be zero or minimal and invisible.** No client-facing “AI assistant” or obvious bot replies tied to clinical or case judgment.
- **Humans** own what gets said and how: writing/sending email and SMS, calls, organising, assessing.
- **Software / automation** keeps clients in the loop: reminders, no-reply SMS, notifications, status updates — predictable, transactional comms, not open-ended AI conversation.

## Where AI belongs (backend)

- **Invisible to the client:** parsing, extraction, internal tooling, drafts **for staff only**.
- **Primary value (stated intent):** turn **unstructured** content in the file (messages, notes, documents, pasted text) into **structured fields** for intra-job use — not to formulate clinical or sensitive outbound content.
- **Narrow outbound (if ever):** only procedural, non-clinical asks (e.g. “please confirm full legal name and property address”) — never AI-authored clinical matter; **human-in-the-loop (HITL)** before anything sends at scale.

## Human-in-the-loop and rollout

- **HITL is essential:** staff review/edit/approve before client-facing send, especially while validating efficacy.
- **Validate before full-scale release:** measure quality, safety, and operations; expand automation only when data supports it.

## Sender identity model

- **Assigned technician** is the primary human relationship on a file (e.g. user in that role).
- Other messages may use distinct sender contexts such as **admin** or **accounts** (operational/billing).
- **HITL** still applies: human + AI assist behind the scenes; AI does not replace role judgment in what goes out under each sender.

## Implementation hints (when coding)

- **AI document wording vs layout:** see [document-rules-architecture.md](./document-rules-architecture.md) (`document_rules` + platform baseline vs print/PDF templates).
- Prefer **schema + approval UI** for extracted fields over auto-replies.
- Separate **sender profiles** (From / reply-to / template) by role: technician vs admin vs accounts.
- Keep **Twilio/Resend** paths clearly **transactional** vs **staff-composed** where the product differentiates them.
