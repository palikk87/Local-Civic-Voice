# Civic Voice workspace

A mobile app, a web app, and the backend both of them read from.

<APPROVAL_REQUIRED_BEFORE_ANY_CHANGE>
  HARD RULE — no exceptions, never ask the user to repeat this:

  NEVER edit, create, or delete any file until the user has explicitly approved the plan.

  The required loop for EVERY request:
  1. The user reports an issue or asks for something.
  2. Investigate read-only (read files, grep, run read-only commands, check logs, cURL).
  3. Report back in plain language: what's actually wrong, what you propose to change, which
     files/areas it touches, and anything risky or uncertain. Keep it short and non-technical.
  4. STOP and wait for the user to say go.
  5. Only after explicit approval, make the changes and verify them.

  - "Discuss first, then move forward" applies even when the fix looks obvious or tiny.
  - A request is NOT approval. Reporting a bug, asking for a feature, or saying "this is broken"
    means investigate and propose — it does NOT mean start editing. Approval is a separate,
    explicit reply from the user AFTER hearing the proposal.
  - Investigation is always allowed without asking. Only WRITES need approval.
</APPROVAL_REQUIRED_BEFORE_ANY_CHANGE>

<FEATURE_PARITY_BOTH_FAUCETS>
  HARD RULE — no exceptions, never ask the user to repeat this:

  ONE SOURCE OF WATER, MANY FAUCETS.
  A house has one water source. Mobile and web are two faucets on it. Turn on the kitchen tap or
  the bathroom tap and the SAME WATER comes out — not the same 20 ounces. What must match is the
  FUNCTIONALITY, not the literal code. Same features, same rules, same permissions, same data,
  same outcome for the user. How it's implemented can and should differ per platform.

  <parity_is_behavioural_not_literal>
    Match: features, screens and sections, user-visible copy, permissions and roles, validation
    rules, backend endpoints and data shapes, what happens when the user taps/clicks a thing.

    Don't force-match: rendering (RN View/Text vs div/Tailwind), navigation (expo-router vs React
    Router), storage (AsyncStorage vs localStorage), gestures vs hover, haptics, platform APIs,
    file layout, component structure. Use each platform's natural idiom — a faithful web version
    of a mobile screen is not a pixel-copy, it's the same capability done the web way (and
    responsive for desktop).

    The test is never "is the code the same?" It is: CAN THE USER DO THE SAME THING, UNDER THE
    SAME RULES, AND GET THE SAME RESULT? If yes, parity holds even if no line matches.
  </parity_is_behavioural_not_literal>

  <instructions_flow_both_ways>
    Any instruction given for one side applies to BOTH sides, automatically, without being asked:
    - Instruction given here / about the web app → also apply it to the mobile app.
    - Instruction given in / about the mobile app → also apply it here on web.
    Deliver both in the same piece of work. Don't ship one faucet and leave the other for later.
    If the two genuinely need different code to reach the same behaviour, WRITE BOTH — the
    platform-native implementation on each side — so they end up working the same way.
  </instructions_flow_both_ways>

  <required_before_answering>
    Every prompt, no exceptions — before writing code or proposing a plan:
    1. FIND IT FIRST. Grep/read `webapp/mobile/src/` for the feature, screen, store, hook or rule
       the prompt is about, and the matching place in `webapp/src/`.
    2. IF IT EXISTS ON ONE SIDE ONLY → bring the behaviour to the other side too, in that
       platform's idiom.
    3. IF IT EXISTS ON NEITHER → say so, then build it on both.
    4. NEVER let the two drift. A capability or rule on one side that the other lacks is a BUG,
       not a feature. Flag it before shipping.
    5. NEVER create new backend routes to serve one faucet. One water source — find the endpoint
       that already exists and use it for both.

    Say which files you checked on each side: "mobile `src/app/discover.tsx`, web
    `src/pages/Discover.tsx`" — or — "this exists on neither side."
  </required_before_answering>

  Known open divergence (must be resolved, do not add more):
  - Guest browsing: web allows read-only browsing while signed out; mobile still hard-redirects
    every visitor to login (`webapp/mobile/src/app/_layout.tsx`). Both faucets must behave the
    same — resolve it.
</FEATURE_PARITY_BOTH_FAUCETS>

<CRITICAL_READ_FIRST>
  THE USER'S STANDING INSTRUCTION (repeated ~38 times — do not make them repeat it again):

  The finished mobile app source lives at `webapp/mobile/src/app/` (45 screens: (tabs)/index.tsx,
  timeline.tsx, discover.tsx, library.tsx, people.tsx, profile.tsx, representatives.tsx, plus
  admin/, b2b/, bill/, delegates.tsx, constitution.tsx, etc.). The web app (webapp/src/) is a
  PORT of that app — nothing more, nothing less.

  When working on ANY webapp page:
  1. OPEN the corresponding mobile screen file FIRST and reproduce its FUNCTIONALITY — same
     sections, tabs, buttons, rules, and data calls. Implementation uses web idiom (see
     <FEATURE_PARITY_BOTH_FAUCETS> — behavioural parity, not line-for-line copying).
  2. NEVER invent features, layouts, or data shapes. NEVER build "inspired by" versions.
  3. NEVER create new backend routes for this — the backend already serves the mobile app.
     Match the exact data source each mobile screen uses.
  4. NEVER write audit/plan/summary/"COMPLETE" markdown files.
  5. A page is done only when verified rendering real data in the running app.

  Past failure: web Discover was a 9-line stub while mobile discover.tsx is 1,024 lines,
  because sessions built from imagination instead of reading the mobile source. Do not repeat this.
</CRITICAL_READ_FIRST>

<projects>
  webapp/    — React app (port 8000, environment variable VITE_BASE_URL)
  backend/   — Hono API server (port 3000)

  In production, the webapp uses relative URLs (/api/...) so it works on any domain.
  VITE_BACKEND_URL is only needed in development for cross-origin requests to the backend on a different port.

  Set `baseURL: env.BACKEND_URL` in betterAuth() config (required for crossSubDomainCookies, harmless otherwise —
  proxy headers override via trustedProxyHeaders: true).
  The webapp auth client (createAuthClient) should use: baseURL: import.meta.env.VITE_BACKEND_URL || undefined
  The webapp API helper should use: import.meta.env.VITE_BACKEND_URL || "" (empty string = relative URLs)
</projects>

<agents>
  Use subagents for project-specific work:
  - backend-developer: Changes to the backend API
  - webapp-developer: Changes to the webapp frontend

  Each agent reads its project's CLAUDE.md for detailed instructions.
</agents>

<coordination>
  When a feature needs both frontend and backend:
  1. Define Zod schemas for request/response in backend/src/types.ts (shared contracts)
  2. Implement backend route using the schemas
  3. Test backend with cURL (use $BACKEND_URL, never localhost)
  4. Implement frontend, importing schemas from backend/src/types.ts to parse responses
  5. Test the integration

  <shared_types>
    All API contracts live in backend/src/types.ts as Zod schemas.
    Both backend and frontend can import from this file — single source of truth.
  </shared_types>
</coordination>

<skills>
  Shared skills in .claude/skills/:
  - database-auth: Set up Prisma + Better Auth for user accounts and data persistence

  Frontend only skills:
  - frontend-app-design: Create distinctive, production-grade web interfaces using React, Tailwind, and shadcn/ui. Use when building pages, components, or styling any web UI.
</skills>

<environment>
  This repository is the whole product. `main` is what deploys — see SHIPPING.md.
  The user is not reading the terminal. Do the work; do not hand back instructions.
  Communicate plainly, without jargon, and briefly.
</environment>
