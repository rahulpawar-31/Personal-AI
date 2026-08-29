# DevOS — UI/UX Improvement PRD

**Version:** 1.0
**Date:** 2026-08-29
**Author:** Rahul
**Status:** Draft

---

## 1. Purpose

DevOS's UI works today but was built panel-by-panel over time (`client/src/components/*.jsx`, largest files 500–1050 lines) with inline `style={{...}}` objects and no shared CSS beyond `index.css` and `design-system/colors_and_type.css`. It has never been made to work on anything but a full-width desktop browser. This PRD defines the work to make the product **more workable** — easier to navigate, usable on more screen sizes, visually consistent panel-to-panel, and faster-feeling — without changing what DevOS *does* (see [PRD.md](PRD.md) for the product/data roadmap; this doc is UI/UX only).

A `design-system/` audit already exists in this repo, extracted from the live product (colors, type, spacing, voice, iconography — see `design-system/README.md`) and a **proposed** redesign UI kit sits alongside it (`design-system/ui_kits/devos/*.jsx` — Digest/Comms/Calendar/Tasks/Chat views with in-memory sample data, not wired to the app). That kit is a useful reference for target visual direction but has not been reconciled with the live components. Part of this PRD's job is closing that gap deliberately instead of letting two versions of the UI drift apart.

---

## 2. Current State (Audited 2026-08-29)

| Area | Finding |
|---|---|
| Layout | `App.jsx` renders a fixed `220px` sidebar + flex main panel inside a `height: 100vh, overflow: hidden` container. No responsive breakpoint anywhere. |
| Responsiveness | `client/src/index.css` (250 lines) contains **zero** `@media` queries. The app is desktop-only; on a phone or narrow tablet the sidebar and content simply clip. |
| Styling approach | Nearly all styling is inline `style={{}}` objects per component, not CSS classes. `design-system/colors_and_type.css` defines the token set (`--bg`, `--accent`, `--radius`, etc.) but individual panels re-declare pixel values inline rather than consuming shared component classes. |
| Panel sizes | `SettingsPage.jsx` (1052 lines), `TaskPanel.jsx` (663), `GitHubPanel.jsx` (568), `ChatPanel.jsx` (567) — large, single-file, mixed data-fetching + presentation. |
| Design system fidelity | `design-system/README.md` documents the *intended* system precisely (hairline borders, no shadows, no icon library beyond Unicode glyphs + colored dots, system fonts only, no dark mode). The live app mostly follows this, but there's no lint/enforcement — drift is easy and unchecked. |
| Navigation | Single flat sidebar list (9 items: digest, comms, calendar, tasks, github, linkedin, slack, chat, settings + admin for admins). No grouping, no collapse, no keyboard shortcuts, no command palette. |
| Integration panels | Per `design-system/ui_kits/devos/README.md`, GitHub/LinkedIn/Slack are described as "integration shells" — thinner than Comms/Calendar/Tasks. |
| Onboarding | `OnboardingWizard.jsx` (498 lines) — 4-step wizard already exists (welcome → Google → tools → done). `NotConnected.jsx` gives a consistent empty-state pattern for disconnected services. |
| Accessibility | Design system explicitly states "no focus rings are styled" and hover states are background-only. No ARIA roles observed in Sidebar/NavBar. |
| Chat vs. panels | Two ways to take the same actions: individual panels (Comms, Calendar, Tasks…) and free-form Chat (`ChatPanel.jsx`, backed by `/api/chat` and the parallel `/api/chat/agent` LangChain path). No UI cues connect the two — a user has no way to know an action is also chat-doable. |

---

## 3. Problems to Solve

### P0 — Not usable outside a desktop browser
Zero responsive behavior means DevOS cannot be opened on a phone to check a digest or triage email, which is a normal thing to want from a personal command center. This is the single biggest "not workable" gap.

### P1 — Visual and structural inconsistency across panels
Because styling is inline and duplicated per file rather than shared, panels drift from the documented design system in small ways (padding, hover states, empty-state treatment) that compound into a UI that feels hand-built rather than systematic. `SettingsPage.jsx` at 1000+ lines is also the hardest panel to keep consistent by hand.

### P2 — Flat, ungrouped navigation
9 sidebar items with no hierarchy or shortcuts forces every action through a mouse click on a specific row. Power users (the target audience per the design system doc: "designed for keyboard-driven power users") have no keyboard path through the app at all today.

### P3 — Chat and panels are disconnected experiences
A user chatting "what's on my calendar today" gets an answer, but nothing in the Calendar panel or the Chat panel indicates these are the same underlying actions, and there's no way to jump from a chat answer to the live panel it affected (`onAction` in `App.jsx` silently bumps a `refreshKey` — no visible link).

### P4 — Inconsistent loading/empty/error states
Each panel implements its own loading and empty state by hand. `NotConnected.jsx` is a shared pattern but not all panels use it consistently, and there's no shared skeleton/loading treatment — some panels likely show a blank frame while fetching.

### P5 — No accessibility baseline
No keyboard focus indication, no visible ARIA landmarks/roles in the nav. This blocks keyboard-only and screen-reader use entirely, not just a nice-to-have.

---

## 4. Goals & Non-Goals

**Goals**
- DevOS is fully usable (read + core actions) on a phone-width viewport.
- One shared set of layout/state primitives (loading, empty, error, card) used by every panel — no more per-panel reinvention.
- A navigable, keyboard-operable app: shortcuts for switching panels, a command palette for actions.
- Chat and panel actions are visibly the same system — chat actions deep-link to the panel/row they affected.
- Baseline accessibility: visible focus states, correct landmark roles, tab order.
- `design-system/` stays the single source of truth — the `ui_kits/devos/*` mockups either get formally adopted (component-by-component) or archived, not left as silent drift.

**Non-goals**
- No new integrations or backend actions (that's [PRD.md](PRD.md) Phase 2 territory: multi-tenancy, per-user credentials, admin visibility).
- No dark mode (explicitly out of scope per `design-system/README.md` — "No dark mode in the source. If you need one, derive — don't invent" — would need its own design pass and sign-off).
- No native mobile app — responsive web only.
- No rebrand — colors, type, voice, iconography stay as documented in `design-system/colors_and_type.css`.

---

## 5. Requirements

### 5.1 Responsive layout (P0)
- Add breakpoints to `client/src/index.css` / layout components: collapse the 220px `Sidebar` into a slide-over drawer (hamburger trigger in a new mobile top bar) below ~768px.
- Panels that assume wide layouts (`TaskPanel`'s multi-column view, `CalendarPanel`'s day-grouped agenda, `GitHubPanel`'s tables) need a single-column fallback.
- Chat and Settings, already closer to single-column, need padding/touch-target audits (`padding: '24px 28px'` / `'32px 36px'` in `App.jsx` main panel is desktop-tuned and should scale down).
- Target breakpoints: desktop (≥1024px, current experience), tablet (768–1023px, condensed sidebar), mobile (<768px, drawer nav + single column).

### 5.2 Shared component layer (P1)
- Promote the inline-styled patterns already repeated across panels (card, stat tile, tag, empty state, loading skeleton) into real shared components/CSS classes, sourced from `design-system/colors_and_type.css` tokens and modeled on `design-system/ui_kits/devos/primitives.jsx` (Card, Tag, Eyebrow, StatTile, Button, Input already prototyped there).
- Migrate panels to the shared layer incrementally, starting with the two most duplicated patterns: card layout and empty/loading state (`NotConnected.jsx` becomes the canonical empty state, extended with a matching `Loading` / `ErrorState` sibling).
- Split `SettingsPage.jsx` (1052 lines) into per-integration sub-components sharing one layout shell — no behavior change, structural only.

### 5.3 Navigation & keyboard support (P1)
- Add keyboard shortcuts for switching panels (e.g. `g` then a letter, or `⌘1`–`⌘9`, matching the "reads `man` pages" persona from the design system voice guide).
- Add a command palette (`⌘K`) for cross-panel actions (jump to panel, run digest, connect a service) — this is the natural home for the "keyboard-driven power user" promise the design system already claims but the app doesn't deliver on yet.
- Group the sidebar's 9 flat items into logical sections (e.g. Overview: Digest/Chat; Inbox & Calendar: Comms/Calendar; Work: Tasks/GitHub; Social: LinkedIn/Slack) with subtle section labels, not new chrome.

### 5.4 Chat/panel unification (P2)
- When a chat action affects a panel (`handleChatAction` in `App.jsx` already tracks which panel to refresh), surface an inline link/toast — "Updated Tasks →" — that navigates the user there, instead of silently bumping a refresh key with no visible trace.
- Conversely, consider a lightweight "ask DevOS" affordance inside panels (e.g. Comms) that pre-fills Chat with panel context, so the two systems visibly compose rather than compete.

### 5.5 Consistent state handling (P2)
- Standardize on three states every data panel must implement: loading (skeleton, not blank), empty (`NotConnected`-style with a primary action), error (retry affordance). Audit each of Digest/Comms/Calendar/Tasks/GitHub/LinkedIn/Slack against this and fix gaps.

### 5.6 Accessibility baseline (P1)
- Add visible focus outlines (the design system's "no focus rings" rule was a visual choice for mouse users, not a decision to drop keyboard accessibility — needs an explicit focus style that fits the hairline aesthetic, e.g. a 1.5px accent outline).
- Add `role="navigation"`/`aria-current` to `Sidebar`/`NavItem`, proper `<button>`/`<nav>` semantics audit across components.
- Verify tab order through Sidebar → main panel → panel-internal controls.

---

## 6. Success Metrics

- DevOS is fully operable (view digest, triage an email, check calendar, run chat) on a 375px-wide viewport with no horizontal scroll or clipped content.
- No panel has more than ~1 inline style block duplicating a pattern that exists in the shared component layer (spot-checked, not automated).
- Every panel implements loading/empty/error states via the shared components, not bespoke JSX.
- Full app is navigable via keyboard alone (tab order + shortcuts + command palette) with visible focus at every step.
- `design-system/ui_kits/devos/*` mockups are either merged into the live component set or explicitly marked archived/reference-only in their README — no more silent drift between "documented design" and "shipped design."

---

## 7. Phasing

| Phase | Scope |
|---|---|
| 1 | Responsive layout (5.1) — highest-impact, unblocks mobile usage entirely |
| 2 | Shared component layer + state handling (5.2, 5.5) — de-risks every later change by giving future panels one pattern to follow |
| 3 | Navigation & keyboard support (5.3) — command palette, shortcuts, sidebar grouping |
| 4 | Chat/panel unification + accessibility polish (5.4, 5.6) |

Each phase should ship independently and be checked against the design system voice/visual rules in `design-system/README.md` before merging — that doc is the acceptance bar, not just inspiration.

---

## 8. Open Questions

- Should the mobile sidebar be a drawer (overlay) or a bottom tab bar? Drawer matches the existing desktop pattern most closely; bottom tabs are more native-feeling on mobile but a bigger visual departure.
- Command palette (5.3) — reuse an existing library (e.g. `cmdk`) or hand-roll to keep the zero-dependency, no-icon-library ethos documented in `design-system/README.md`?
- Does Settings' 1052-line file get split as pure refactor (this PRD) or wait until Phase 2 multi-tenancy work (PRD.md §4) touches the same file anyway, to avoid two separate large diffs on one file?
- Who signs off on the "target visual direction" question — does `design-system/ui_kits/devos/*` get formally adopted as-is, or is it just reference?
