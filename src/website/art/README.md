# Actual game artwork for the website

These are transparent renders of the game's own artwork, not CSS imitations.
`title.png` uses letter blocks for the game title. Every other PNG is a playing-card block with rank and suit, including the five spades used in the example royal flush.

Regenerate with `npm run dev`, then open `/website-art.html` locally. That developer-only page imports `src/tools/website-art.ts`, which uses the production word/card face builders, board materials, attract lighting, renderer-local environment and declared appearance prepasses. Download each PNG using its link, replace the matching file here (remove the download's `poker-site-` prefix), and update SHA-256/dimensions/byte counts in `manifest.json` after inspecting the result. Chrome's numbered duplicate suffixes are not asset names. The exporter is not a production build entry.

Recipe: 1600×720 title, 512×512 card renders; 50° perspective with a bounds-fitted 1.14 margin. Static initial frame, transparent background, no game state or session RNG. Title material order and all card identities/poses are explicit in the exporter. Lighting/shaders reflect the source revision recorded in the manifest; later changes require intentional regeneration. This is a frozen illustration, not an animation or physical photograph.

Fonts are awaited before capture. Keep the source font notices and shipped `public/art-notices/` files when regenerating. See CREDITS.md for authors/licences and the project artwork licence. No third-party model or texture was imported for these renders.
