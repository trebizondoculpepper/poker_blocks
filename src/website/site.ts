/**
 * The website's blocks (#1406; doc/game-website.md): the title's letters and the section cubes
 * as CSS 3D blocks in the game's looks, and the footer from the shared project links. No WebGL,
 * no game bootstrap and no music: this page only explains the game.
 */
import { projectLinks } from "../project-links";

/** A cube's six faces, each showing `label`, in one of the game's looks. */
function cube(label: string, look: string): HTMLElement {
  const block = document.createElement("span");
  block.className = `cube ${look}`;
  block.setAttribute("aria-hidden", "true");
  for (const side of ["front", "back", "right", "left", "top", "bottom"]) {
    const face = document.createElement("span");
    face.className = `side ${side}`;
    face.textContent = label;
    block.append(face);
  }
  return block;
}

// The title: one cube per letter, each in its own look, rocking a little out of step.
for (const word of document.querySelectorAll<HTMLElement>("[data-blocks]")) {
  const looks = (word.dataset.looks ?? "paper").split(" ");
  (word.dataset.blocks ?? "").split("").forEach((letter, index) => {
    const block = cube(letter, looks[index % looks.length]!);
    block.style.setProperty("--delay", `${index * -0.45}s`);
    word.append(block);
  });
}

// Each section's heading cube, showing its suit.
for (const holder of document.querySelectorAll<HTMLElement>("[data-cube]")) {
  const label = holder.textContent ?? "";
  holder.textContent = "";
  holder.append(cube(label, holder.dataset.cube ?? "paper"));
}

// The example row's card blocks: rank and suit in the corners, as in the game.
for (const card of document.querySelectorAll<HTMLElement>(".card")) {
  const { rank = "", suit = "" } = card.dataset;
  card.innerHTML = `<b>${rank}</b><i>${suit}</i><b class="flip">${rank}</b>`;
}

// The footer's links, from the one shared source.
for (const nav of document.querySelectorAll<HTMLElement>("[data-project-links]"))
  for (const { label, href } of projectLinks) {
    if (!href) continue;
    const link = document.createElement("a");
    link.className = "block-button steel small";
    link.href = href;
    link.rel = "noopener";
    link.innerHTML = `<span class="face">${label}</span>`;
    nav.append(link);
  }
