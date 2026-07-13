# How I'd feed it to Sonnet, session by session

1. Point each session at the checklist, not the review. Something like: "Work through Tier A of
   docs/planning/ai-first-review-checklist.md, items A-1 through A-3. Read the linked review
   section for context only if an item is ambiguous. Check off each item as you complete it, and
   run npx nx run-many -t test,lint on affected packages before moving on." The checklist is
   deliberately self-contained so sessions stay cheap and focused.

2. One tier per session boundary. Tier A can be one or two sessions. Tier B should be two
   separate sessions each split in two turns: "write the TDD section, stop for my review" then
   "implement it" — those two items define public API conventions you'll live with, so you want
   eyes on the design before code exists.

3. Don't run Tier C standalone — hand those to whichever session implements the corresponding
   Phase 4 item (the checklist says which pairs with which).

One thing to decide before starting Tier B: item B-2 locks in the FeathersJS-style
$limit/$skip/$sort reserved-key convention as my recommendation. If you'd rather have pagination
as separate query params (e.g. ?limit=10 without the $), say so in the session prompt — it's
the one decision in the checklist that's taste rather than correctness.
