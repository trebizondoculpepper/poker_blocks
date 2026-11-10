/**
 * The fonts a material's lettering can be auditioned in (#296): every bundled font
 * (src/assets/fonts) plus a few common system faces, each with a fallback. Data only: the block
 * design room lists these, and the game's chosen fonts live on each material's `lettering`.
 */
import type { Lettering } from "./lettering";

export type CatalogueFont = Lettering & { label: string };

export const fontCatalogue: readonly CatalogueFont[] = [
  {
    label: "Times New Roman (system)",
    font: "Times New Roman",
    fallback: "Tinos, serif",
    weight: 400,
  },
  { label: "Tinos (bundled serif)", font: "Tinos", fallback: "serif", weight: 400 },
  { label: "Roboto Slab (bundled slab)", font: "Roboto Slab", fallback: "serif", weight: 400 },
  { label: "Roboto (bundled sans)", font: "Roboto", fallback: "sans-serif", weight: 400 },
  {
    label: "Saira Stencil One (bundled stencil)",
    font: "Saira Stencil One",
    fallback: "sans-serif",
    weight: 400,
  },
  { label: "Georgia (system)", font: "Georgia", fallback: "serif", weight: 400 },
  { label: "Courier New (system mono)", font: "Courier New", fallback: "monospace", weight: 400 },
  { label: "Impact (system display)", font: "Impact", fallback: "sans-serif", weight: 400 },
];
