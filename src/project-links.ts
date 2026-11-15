/**
 * The project's public destinations (#1406; doc/game-website.md, "Link and feedback
 * composition"): one small static boundary, shared by the game's panel footer and the website,
 * so neither duplicates the URLs and the website never imports the game to read them.
 */
export type PanelLink = { label: string; href?: string };

export const projectHome = "https://github.com/trebizondoculpepper/poker_blocks";

export const projectLinks: readonly PanelLink[] = [
  { label: "Get source code", href: projectHome },
  { label: "Report a bug", href: `${projectHome}/issues/new` },
];
