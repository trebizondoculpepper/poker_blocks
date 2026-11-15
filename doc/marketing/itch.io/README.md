# Poker Blocks itch.io artwork

Prepared 2026-11-15 for #1480 using the built-in `image_gen` tool, with the project's actual rendered logo, wood king and gold queen as visual references. These are AI-assisted marketing illustrations, **not gameplay screenshots or exact game renders**. The website's original render assets remain unchanged.

| File                             | Actual dimensions | Theme editor slot                                                             |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| [background.png](background.png) | 1672 × 941        | Background: centre, cover, no repeat; suggested surrounding colour `#160f0d`  |
| [banner.png](banner.png)         | 2172 × 724 (3:1)  | Banner: contains the Poker Blocks title; scale to the content width           |
| [embed-bg.png](embed-bg.png)     | 1672 × 941        | Embed BG: click-to-play viewport, with empty centre for itch.io's Play button |

All three are opaque PNGs. The background keeps its central content region quiet; card-block decoration sits at the edges. The banner alone uses the letter-block title; other blocks carry card ranks and suits. The embed image deliberately contains no fake button or interface. Inspect cropping in the actual page editor, particularly on phones and non-widescreen embeds. These files have not been uploaded or applied to the itch.io theme.

The output dimensions above are the tool's delivered sizes, rather than the nominal target dimensions in the prompts. No external crop, resampling or retouching was applied. One built-in edit removed an unwanted bottle from the banner. Exact generation and edit prompts are in [prompts.json](prompts.json); file hashes and sizes are in [manifest.json](manifest.json).

Upload through **Edit theme → Images**. itch.io's [page design guide](https://itch.io/docs/creators/design) explains that a banner replaces the displayed page title. Its [HTML5 guide](https://itch.io/docs/creators/html5#visual-customization) explains that Embed BG sits behind the platform's Play button. These are preparation choices, not platform-mandated pixel dimensions. Retain this provenance and the project artwork/font credits in [CREDITS.md](../../../CREDITS.md).
