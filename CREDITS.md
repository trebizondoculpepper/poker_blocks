# Credits

Poker Blocks exists thanks to people who made their work available for others to build on. We are sincerely grateful to every creator listed here. Their generosity is what lets a small project look and sound the way it does.

This file is the canonical record of third-party and generated assets (#1053). Each entry states the licence or permission that actually applies. Not everything here is "open source": some assets carry attribution or ShareAlike conditions, and some rely on explicit permission from the maker. Entries are grouped by status:

- **Shipped**: the files are in this repository and used by the game.
- **Selected, pending**: chosen by the owner and tracked by a ticket, but not yet committed or integrated. Listing them here does not mean the game uses them.
- **Unresolved**: provenance or terms that this audit could not confirm from inspectable evidence.

**Every future asset import must update this file** in the same PR, with the fields below, and must keep upstream licence files and notices beside the asset. See [doc/process.md](doc/process.md#asset-credits).

Fields per entry: title and source URL; author; licence (name, version, link); additional terms or permission evidence; modifications; use in the game and asset paths; required notices and where they are kept.

## Shipped

### Fonts

Self-hosted Latin regular WOFF2 subsets taken from the corresponding `@fontsource` packages (5.3.x); see [src/assets/fonts/README.md](src/assets/fonts/README.md). Modifications: none beyond the Fontsource subsetting/packaging. Each family's full licence text is kept beside its font and must stay there.

| Font              | Source                                        | Authors                           | Licence                                                           | Files                                                                       |
| ----------------- | --------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Roboto            | https://github.com/googlefonts/roboto-classic | The Roboto Project Authors        | [SIL Open Font License 1.1](https://openfontlicense.org)          | `src/assets/fonts/roboto.woff2`, `roboto-LICENSE.txt`                       |
| Roboto Slab       | https://github.com/googlefonts/robotoslab     | Google / Roboto Slab authors      | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) | `src/assets/fonts/roboto-slab.woff2`, `roboto-slab-LICENSE.txt`             |
| Saira Stencil One | https://github.com/Omnibus-Type/Saira         | The Saira Stencil Project Authors | [SIL Open Font License 1.1](https://openfontlicense.org)          | `src/assets/fonts/saira-stencil-one.woff2`, `saira-stencil-one-LICENSE.txt` |
| Tinos             | https://github.com/googlefonts/tinos          | The Tinos Project Authors         | [SIL Open Font License 1.1](https://openfontlicense.org)          | `src/assets/fonts/tinos.woff2`, `tinos-LICENSE.txt`                         |

Use: lettering on word cubes, card faces and HUD text (`src/assets/fonts/fonts.css`).

### Pre-rendered website artwork

The title and card-block images in `src/website/art/*.png` are original project artwork rendered from [the Poker Blocks source](https://github.com/trebizondoculpepper/poker_blocks), by the project's procedural appearance and typography builders, not AI substitutes or third-party model imports. Licence: the project's [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html) (`LICENSE`). Preparation: fixed material composition/pose, renderer-local lighting and required prepasses, transparent PNG export with `src/tools/website-art.ts`; no later image retouching. Use: website title, playing-card decorations and royal-flush example. File checksums, dimensions and regeneration instructions are in `src/website/art/manifest.json` and `README.md`.

Baked lettering follows the material's configured font, including local system fonts where selected (no system font binaries redistributed). The bundled font families/authors/licences are credited above. Their complete notices accompany the website at `public/art-notices/`, linked from every page; existing upstream notices remain beside the font sources. No new external permissions were required for project-owned procedural artwork.

### itch.io marketing illustrations (#1480)

`doc/marketing/itch/{background,banner,embed-bg}.png` were prepared for this project with OpenAI's built-in image generation tool on 2026-11-15, referencing the project's rendered title and card-block artwork. Source: the prompts and project-owned reference files recorded in `doc/marketing/itch/prompts.json`; project artwork is covered by the repository's GNU GPL v3 licence. They are AI-assisted marketing illustrations, not exact game renders or gameplay screenshots. The banner received a generated edit to remove a bottle; no external image retouching was applied. Prompts, file hashes, actual dimensions and upload guidance are recorded beside them. The project's baked typography/font notices above remain applicable to the reference lettering. These are documentation/marketing assets and are not included in the game or website build.

### Sound effects

Sampled effects under `src/assets/sfx/` were generated for this project with the ElevenLabs sound-effects API from the prompts in `src/audio/sfx-registry.ts` (`npm run sfx`; see [doc/sound_design.md](doc/sound_design.md)). Effects with a `synth` source are synthesised live from code in this repository. No third-party recordings are shipped. Modifications: trimming/normalisation by the project's SFX pipeline.

### Music

Background loops under `music/loops/` and full recordings under `music/sources/solitaire/` were generated for this project with the Treblo (formerly Sonauto) API, then cut into seamless loops by `music/tools/`; see [music/README.md](music/README.md).

## Selected, pending

None of these files are in the repository yet. Each import must add the credit and licence beside the source and processed files, add any notice that has to ship with the build, and move its entry to **Shipped** here.

| Asset                                 | Source                                      | Author           | Licence / permission                                                                                                 | Planned use                    | Ticket       |
| ------------------------------------- | ------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------ |
| Wrapped Present                       | https://skfb.ly/ouLVI                       | Skipperino       | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                            | Present item artwork           | #747         |
| Chef Hat                              | https://skfb.ly/6SYoC                       | Awesopossum      | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                            | Le Chef item artwork           | #748         |
| Computer cooler, pc fan               | https://skfb.ly/pAVWK                       | Neutrino         | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                            | Air tile appearance            | #753         |
| White Magician Hat (AI)               | https://skfb.ly/oUurA                       | ENKY             | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                            | Could It Be Magic Now? artwork | #1056        |
| Dice (D6)                             | https://skfb.ly/6RtsC                       | tnRaro           | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                            | Six-sided die                  | #1048, #1049 |
| D12                                   | https://skfb.ly/6ZoGI                       | Cyberebral       | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                            | Twelve-sided die               | #1050        |
| D20 Dice (W20 Würfel) 3D model [FREE] | https://skfb.ly/onUnH                       | VertexDon        | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)                                                      | Twenty-sided die               | #1051        |
| Party whistle                         | https://www.youtube.com/watch?v=Cq0Xdd80TPg | Picture to Sound | Explicit permission from the maker, confirmed by the owner on 2026-11-14 (#1006); requested credit: Picture to Sound | `celebration.whistle`          | #1006        |

Notes:

- **ShareAlike (D20).** Adapted model files and textures derived from the VertexDon D20 must be distributed under CC BY-SA 4.0 with that licence information beside them. ShareAlike applies to the adapted asset, not to unrelated project code.
- **Party whistle.** Picture to Sound's public FAQ (checked 2026-11-14) covers creator/video use with attribution and asks other uses to contact them. Use in this game rests on the maker's explicit permission as reported by the owner on #1006; no written permission text is stored in this repository.

## Unresolved

- **Generated audio terms.** The ElevenLabs and Treblo terms that govern redistribution of generated sound effects and music are not recorded in this repository. Record the applicable plan/terms and date before a public distribution.
- **Repository licence boundary.** `LICENSE` covers the project's own code. Third-party assets keep their own licences as listed above; a distributed build must carry the notices those licences require. The website build now copies its artwork/font notices from `public/art-notices/` into `dist/art-notices/`. Packaging this complete credits file and notices into the standalone game remains unresolved.
