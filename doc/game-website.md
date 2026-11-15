# Game website and title-caption cleanup (#1435)

Owner request: a webpage with a prominent near-top launch button, an approachable explanation of placing blocks/scoring/modifiers, and bottom links to report a bug and get source code. Remove the floating subtitle from the in-game title screen. These are separate focused runtime tickets #1406 and #1407 after this design merges.

## Entry and build ownership

Add a lightweight standalone `about.html` page to this repository's existing static build. Keep `index.html` as the playable game so existing bookmarks, query-string mode links, release archives and itch.io entry remain valid. The page's prominent **Play Poker Blocks** link launches `./index.html` in the same browser/tab without creating a fresh seed or destructive reset parameter. Relative paths must work under the deployed repository subpath and local preview. The existing game entry can link to the information page through configured footer/link data; do not replace the playable entry or introduce a client router merely for this page. Making the website the root entry would be a separate reversible hosting decision, not implied here.

The build explicitly includes both HTML entries and their bundled assets. Website content must not import the game bootstrap, create a WebGL context or start music just to explain the game. Shared typography/colors and static artwork may be reused with their normal asset ownership/credits. Keep deployment in the existing Pages/release pipeline; no new host/domain/account or external publishing setup. Ensure release packaging retains index.html at the archive root and includes the information page.

## Content and layout

Use the game title, a concise description and the near-top launch link before explanatory content. No mandatory signup, animation or large hero asset is needed. Suggested copy structure, aligned with game.md:

- **Build in three dimensions:** select cards from your hand, drag the group to an available attachment face, and rotate the structure to inspect other placements.
- **Make scoring lines:** straight connected rows along the three axes score as poker hands. The game chooses the strongest poker hand type, then its highest unmodified base within that type; a long row uses its best five-card subset rather than adding overlapping hands. Narration explains the hand, base, applied modifiers and total.
- **Shape your strategy:** card materials and installed modifiers change scoring or consequences at their declared stages. Their requirements and ordering matter; inspect them in-game. Explain the concept without listing every modifier or promising a specific unfinished item.
- **Reach the target:** score enough within the stage's limited plays, then use rewards/shop choices to develop the run. Avoid hard-coded tuning values in marketing copy where the game's configuration is authoritative.

Keep the content concise enough to scan on a phone, with semantic headings, readable contrast/type size, visible keyboard focus and a normal link/button hit area. No dependence on hover or gamepad input to read or launch. The footer sits after content and contains **Report a bug** and **Get source code**, leaving later information for later work. Do not invent social accounts, pricing or availability claims.

## Link and feedback composition

Share configured project destinations through a small static link-data boundary rather than importing game-modes or duplicating hard-coded repository URLs across the page. Link data belongs on the defining configuration, not a table keyed by scene identity. The existing GitHub issue destination remains a valid initial website fallback; use the shared Sentry feedback launcher once that capability is configured/adopted, without blocking this page on account credentials. No fabricated crash or empty gameplay snapshot: an information page can explicitly lack game state. Preserve the agreed in-game Sentry reporting contract independently.

## Remove the floating title caption

The actual source caption is **“Poker solitaire in three dimensions”** in `src/menus.ts:createMenus`; the voice transcript called it “Hocus Solitaire…”. Remove that configured title caption, not the title block, menu actions or footer. The phrase can remain as explanatory prose on the website/README; this is not a global terminology deletion. No invisible duplicate caption or CSS-only hide is required. Preserve accessible game title, focus, settings/pause navigation and re-entry. The existing title renderer remains reusable; do not add a title-screen identity branch in generic menu code.

## Evidence and acceptance

Source audit at `9841e391`: `index.html` boots `src/main.ts`; `vite.config.ts` uses relative base and the existing display version; `.github/workflows/ci.yml` builds/uploads dist for Pages, while release packaging expects a playable index at the archive root. `src/game-modes.ts:projectLinks` declares current source/bug destinations, and `src/menus.ts:createMenus` injects the caption. These support a second static entry and isolated caption removal; they do not prove multi-entry output is already configured.

Verify production build/preview under a repository subpath, both entry URLs, near-top same-tab launch, no unwanted WebGL/audio on the information page, footer destinations, mobile/desktop/keyboard/reduced motion and release archive contents. Check home title at initial load, settings return and game exit/resume, with no floating subtitle and no lost actions. Supply screenshots and build evidence. No new gameplay, third-party asset or live deployment is claimed by this documentation.
