/**
 * Shared fitted narration text (#1156; doc/presentation-contracts.md, "Shared fitted narration
 * text and over-item activation labels", "Text layout independent of content and anchor").
 *
 * A registered text-layout provider takes captured plain text, a style profile, a CSS-pixel
 * rectangle budget and a measurement interface, and returns deterministic lines, per-line font
 * sizes and spacing, and the block's rectangular extent. It knows no scoring, passive, model or
 * anchor: adopters (passive over-item labels, line-score narration) supply text and a budget, and
 * a placement capability positions the result.
 *
 * - Prefers two lines, honours supplied breaks, and allows up to `maxLines` when needed.
 * - Wraps at word boundaries; a token too long for a line splits between graphemes.
 * - Measures real glyph widths through `measure`, never a character count.
 * - Fits each line toward one common width by font size and bounded letter spacing.
 * - If the whole text can't fit at the minimum size, the last line ends in an ellipsis and
 *   `truncated` is set; `fullText` always keeps the complete text for the accessible announcement.
 *
 * The DOM adapter caches layouts by text, style revision and rectangle, and invalidates them when
 * fonts become ready, under a generation guard: no retry timer, no second clock.
 */
import { Registry } from "../core/registry";

/** One shared typography profile: reversible presentation tuning, not a game rule. */
export type FittedTextStyle = {
  /** A CSS font family, inherited from the UI. */
  family: string;
  weight: number;
  minPx: number;
  maxPx: number;
  /** Line height as a multiple of each line's font size. */
  lineHeight: number;
  preferredLines: number;
  maxLines: number;
  /** The most extra letter spacing a short line may take to reach the common width. */
  maxLetterSpacingPx: number;
  /** A short line grows at most this much over the block's base size, for readability. */
  maxLineScale: number;
};

/** The narration profile: bold inherited UI font, 12–28 px, line height 1.05, up to four lines. */
export const narrationTextStyle: FittedTextStyle = {
  family: "inherit",
  weight: 700,
  minPx: 12,
  maxPx: 28,
  lineHeight: 1.05,
  preferredLines: 2,
  maxLines: 4,
  maxLetterSpacingPx: 2,
  maxLineScale: 1.3,
};

/** Measures a run of text at a font size, in CSS px. */
export type TextMeasure = (text: string, px: number, style: FittedTextStyle) => number;

export type FittedLine = {
  text: string;
  px: number;
  letterSpacingPx: number;
  /** Measured width at `px` with the spacing applied. */
  width: number;
};

export type FittedText = {
  lines: readonly FittedLine[];
  width: number;
  height: number;
  /** True when the visible lines end in an ellipsis. */
  truncated: boolean;
  /** The complete captured text, for the accessible announcement. */
  fullText: string;
};

export type FitRequest = { text: string; style: FittedTextStyle; width: number; height: number };

export type TextLayoutProvider = { layout(request: FitRequest, measure: TextMeasure): FittedText };

export const textLayoutProviders = new Registry<TextLayoutProvider>("text layout provider");

const ellipsis = "…";

const graphemes = (text: string): string[] => {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  return Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
        (s) => s.segment,
      )
    : Array.from(text);
};

/** Split a token too wide for `width` into pieces that fit, between graphemes. */
function splitToken(token: string, fits: (text: string) => boolean): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const g of graphemes(token)) {
    if (current && !fits(current + g)) {
      pieces.push(current);
      current = g;
    } else current += g;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Greedy wrap of one paragraph at `width`, splitting a token too wide for any line. */
function wrap(
  paragraph: string,
  px: number,
  width: number,
  measure: (text: string, px: number) => number,
): string[] {
  const fits = (text: string) => measure(text, px) <= width;
  const words = paragraph
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (fits(word) ? [word] : splitToken(word, fits)));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const joined = line ? `${line} ${word}` : word;
    if (line && !fits(joined)) {
      lines.push(line);
      line = word;
    } else line = joined;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

/**
 * Balanced lines at `px`: the narrowest wrap width (up to `width`) at which the supplied
 * paragraphs take no more than `count` lines, so lines share a common width. Null if even the
 * full width needs more.
 */
function linesFor(
  paragraphs: readonly string[],
  count: number,
  px: number,
  width: number,
  measure: (text: string, px: number) => number,
): string[] | null {
  const at = (w: number) => paragraphs.flatMap((p) => wrap(p, px, w, measure));
  const widest = at(width);
  if (widest.length > count) return null;
  // Never narrower than the widest word that fits whole: balancing must not split it.
  let low = Math.max(
    0,
    ...paragraphs.flatMap((p) =>
      p
        .split(/\s+/)
        .map((word) => measure(word, px))
        .filter((w) => w <= width),
    ),
  );
  let high = width;
  if (at(low).length <= count) return at(low);
  for (let step = 0; step < 24; step++) {
    const mid = (low + high) / 2;
    if (at(mid).length <= count) high = mid;
    else low = mid;
  }
  return at(high);
}

/** Truncate `text` with an ellipsis to fit `width` at `px`, keeping whole graphemes. */
function ellipsize(
  text: string,
  px: number,
  width: number,
  measure: (t: string, px: number) => number,
) {
  const parts = graphemes(text);
  while (parts.length && measure(parts.join("") + ellipsis, px) > width) parts.pop();
  return parts.join("").trimEnd() + ellipsis;
}

export const fittedTextProvider: TextLayoutProvider = {
  layout({ text, style, width, height }, measureWith) {
    const measure = (t: string, px: number) => measureWith(t, px, style);
    const paragraphs = text
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0)
      return { lines: [], width: 0, height: 0, truncated: false, fullText: text };
    const heightFor = (lines: number, px: number) => lines * px * style.lineHeight;
    const words = paragraphs.flatMap((p) => p.split(/\s+/).filter(Boolean));
    // The largest base size, at the fewest lines from the preferred count up, that fits.
    let chosen: { lines: string[]; px: number } | null = null;
    // The fewest lines from the preferred count up, each at the largest base size that fits.
    for (
      let count = Math.max(style.preferredLines, paragraphs.length);
      count <= style.maxLines && !chosen;
      count++
    ) {
      for (let px = style.maxPx; px >= style.minPx; px -= 0.5) {
        // Splitting a word is the last resort: only at the minimum size.
        if (px > style.minPx && words.some((word) => measure(word, px) > width)) continue;
        const lines = linesFor(paragraphs, count, px, width, measure);
        if (lines && heightFor(lines.length, px) <= height) {
          chosen = { lines, px };
          break;
        }
      }
    }
    let truncated = false;
    if (!chosen) {
      // Nothing fits at the minimum: as many lines as the rectangle allows, the last ellipsized.
      const px = style.minPx;
      const room = Math.max(
        1,
        Math.min(style.maxLines, Math.floor(height / (px * style.lineHeight))),
      );
      const all = paragraphs.flatMap((p) => wrap(p, px, width, measure));
      const kept = all.slice(0, room);
      if (all.length > room || kept.some((line) => measure(line, px) > width)) {
        kept[kept.length - 1] = ellipsize(all.slice(room - 1).join(" "), px, width, measure);
        truncated = true;
      }
      chosen = { lines: kept, px };
    }
    // Fit each line toward the widest line's width: a larger size (bounded) for a short one,
    // then a little letter spacing for what is left. Never past the budget.
    const base = chosen.px;
    const common = Math.min(width, Math.max(...chosen.lines.map((line) => measure(line, base))));
    const fitted: FittedLine[] = chosen.lines.map((line) => {
      const at = measure(line, base);
      let px = base;
      if (at > 0 && at < common)
        px = Math.min(style.maxPx, base * style.maxLineScale, base * (common / at));
      const sized = measure(line, px);
      const gaps = Math.max(0, graphemes(line).length - 1);
      const letterSpacingPx =
        gaps > 0 && sized < common
          ? Math.min(style.maxLetterSpacingPx, (common - sized) / gaps)
          : 0;
      return { text: line, px, letterSpacingPx, width: sized + letterSpacingPx * gaps };
    });
    // Line growth must not overflow the rectangle: fall back to the base size if it would.
    const grown = fitted.reduce((sum, line) => sum + line.px * style.lineHeight, 0);
    const lines =
      grown <= height || truncated
        ? fitted
        : chosen.lines.map((line) => ({
            text: line,
            px: base,
            letterSpacingPx: 0,
            width: measure(line, base),
          }));
    return {
      lines,
      width: Math.max(...lines.map((line) => line.width)),
      height: lines.reduce((sum, line) => sum + line.px * style.lineHeight, 0),
      truncated,
      fullText: text,
    };
  },
};

textLayoutProviders.register("fitted", fittedTextProvider);

/**
 * A cached layout: the same captured text, style revision and rectangle return the same result
 * without remeasuring. `invalidate` (fonts became ready, a style changed) moves to a new
 * generation, so a layout computed before it is never served after.
 */
export function createFittedTextLayout(provider: TextLayoutProvider, measure: TextMeasure) {
  let generation = 0;
  const cache = new Map<string, FittedText>();
  return {
    get generation() {
      return generation;
    },
    layout(request: FitRequest, styleRevision = 0): FittedText {
      const key = JSON.stringify([
        generation,
        styleRevision,
        request.text,
        request.width,
        request.height,
      ]);
      let result = cache.get(key);
      if (!result) {
        result = provider.layout(request, measure);
        cache.set(key, result);
        if (cache.size > 256) cache.delete(cache.keys().next().value!);
      }
      return result;
    },
    invalidate() {
      generation += 1;
      cache.clear();
    },
  };
}

/** Measure with a 2D canvas context, at the profile's real font. */
export function canvasTextMeasure(context: CanvasRenderingContext2D, fallbackFamily: string) {
  return (text: string, px: number, style: FittedTextStyle) => {
    const family = style.family === "inherit" ? fallbackFamily : style.family;
    context.font = `${style.weight} ${px}px ${family}`;
    return context.measureText(text).width;
  };
}

/**
 * Render a fitted block into `element`: one child per line, sized and spaced as laid out, hidden
 * from assistive technology (the one narration owner announces `fullText`). Pointer-transparent.
 */
export function renderFittedText(element: HTMLElement, fitted: FittedText, style: FittedTextStyle) {
  element.setAttribute("aria-hidden", "true");
  element.style.pointerEvents = "none";
  element.style.width = `${fitted.width}px`;
  element.style.height = `${fitted.height}px`;
  element.replaceChildren(
    ...fitted.lines.map((line) => {
      const row = element.ownerDocument.createElement("div");
      row.textContent = line.text;
      row.style.fontSize = `${line.px}px`;
      row.style.fontWeight = String(style.weight);
      row.style.lineHeight = String(style.lineHeight);
      row.style.letterSpacing = `${line.letterSpacingPx}px`;
      row.style.whiteSpace = "nowrap";
      return row;
    }),
  );
}

/**
 * Invalidate `layout` once fonts are ready, if they aren't already; `onInvalidated` lets the
 * adopter re-render. Returns an unsubscribe that makes a late resolution do nothing.
 */
export function invalidateWhenFontsReady(
  fonts: { ready: Promise<unknown> } | undefined,
  layout: { invalidate(): void },
  onInvalidated: () => void,
): () => void {
  let live = true;
  void fonts?.ready.then(() => {
    if (!live) return;
    layout.invalidate();
    onInvalidated();
  });
  return () => {
    live = false;
  };
}
