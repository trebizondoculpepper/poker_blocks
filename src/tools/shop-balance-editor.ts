/** Developer-only draft editor. It owns no run state and never writes balance definitions. */
import { weightAt, type WeightCurve } from "../offer-weights";
import { playSfx } from "../audio/sfx";
import {
  currentShopBalanceDraft,
  validateShopBalanceDraft,
  type DraftCurve,
  type ShopBalanceDraft,
} from "./shop-balance-draft";
import "./shop-balance-editor.css";

export type ShopBalanceEditor = { show(): void; hide(): void; dispose(): void };
type Selection = { panel: "stock" | "material" | "passive" | "frequency"; id: string };

export function createShopBalanceEditor(host: HTMLElement): ShopBalanceEditor {
  const root = document.createElement("section");
  root.className = "shop-balance-editor";
  root.hidden = true;
  root.setAttribute("aria-label", "Shop Balance Editor");
  root.innerHTML = `
    <header><h1>Shop Balance Editor</h1><p>Draft only · current run is unchanged</p><a href="?mode=game">Back to game</a></header>
    <div class="balance-editor-body"><nav aria-label="Shop balance entries"></nav><div class="balance-editor-detail"></div></div>
    <footer><span class="balance-editor-status" role="status"></span><button type="button" data-action="copy">Copy complete JSON</button><button type="button" data-action="download">Download JSON</button></footer>`;
  host.append(root);
  const nav = root.querySelector("nav")!;
  const detail = root.querySelector<HTMLElement>(".balance-editor-detail")!;
  const status = root.querySelector<HTMLElement>(".balance-editor-status")!;
  const copy = root.querySelector<HTMLButtonElement>('[data-action="copy"]')!;
  const download = root.querySelector<HTMLButtonElement>('[data-action="download"]')!;
  root.querySelector("header a")!.addEventListener("click", () => playSfx("ui.back"));
  let draft: ShopBalanceDraft = currentShopBalanceDraft();
  let selection: Selection = { panel: "stock", id: "stock" };

  function field(
    label: string,
    path: string,
    value: number,
    set: (next: number) => void,
    step = "1",
  ) {
    const wrapper = document.createElement("label");
    wrapper.className = "balance-editor-field";
    wrapper.dataset.path = path;
    const title = document.createElement("span");
    title.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.step = step;
    input.value = String(value);
    input.addEventListener("input", () => {
      set(input.value === "" ? Number.NaN : Number(input.value));
      updateValidation();
      drawGraph();
    });
    wrapper.append(title, input);
    return wrapper;
  }

  function section(title: string): HTMLElement {
    const heading = document.createElement("h2");
    heading.textContent = title;
    detail.append(heading);
    return heading;
  }

  function curveEditor(curve: DraftCurve, path: string): void {
    section("Relative frequency by round");
    const graph = document.createElement("div");
    graph.className = "balance-editor-graph";
    detail.append(graph);
    const rows = document.createElement("div");
    rows.className = "balance-editor-keyframes";
    rows.dataset.path = path;
    detail.append(rows);
    curve.forEach((point, index) => {
      const row = document.createElement("div");
      row.className = "balance-editor-keyframe";
      row.append(
        field("Round", `${path}.${index}.round`, point[0], (value) => {
          point[0] = value;
          drawGraph();
        }),
        field(
          "Weight",
          `${path}.${index}.weight`,
          point[1],
          (value) => {
            point[1] = value;
            drawGraph();
          },
          "0.25",
        ),
      );
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove keyframe ${index + 1}`);
      remove.addEventListener("click", () => {
        playSfx("ui.click");
        curve.splice(index, 1);
        renderDetail();
      });
      row.append(remove);
      rows.append(row);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add keyframe";
    add.addEventListener("click", () => {
      playSfx("ui.click");
      const last = curve.at(-1);
      curve.push([(last?.[0] ?? 0) + 1, last?.[1] ?? 1]);
      renderDetail();
    });
    detail.append(add);
    const help = document.createElement("p");
    help.className = "balance-editor-help";
    help.textContent =
      "Drag graph points or edit their round and weight. Straight lines interpolate between keyframes; values before the first keyframe are zero.";
    detail.append(help);
    drawGraph();
  }

  function selectedCurve(): { curve: DraftCurve; path: string; unlock?: number } | null {
    return panels[selection.panel].curve(selection.id);
  }

  function drawGraph(): void {
    const graph = detail.querySelector(".balance-editor-graph");
    const selected = selectedCurve();
    if (!graph || !selected?.curve) return;
    const { curve, unlock } = selected;
    const valid = curve
      .filter(([round, weight]) => Number.isFinite(round) && Number.isFinite(weight))
      .toSorted((a, b) => a[0] - b[0]);
    const maxRound = Math.max(8, ...valid.map(([round]) => round + 1));
    const maxWeight = Math.max(
      4,
      ...valid.map(([, weight]) => Math.min(Number.MAX_VALUE, weight * 1.2)),
    );
    const width = 620,
      height = 230,
      left = 42,
      right = 18,
      top = 16,
      bottom = 36;
    const px = (round: number) => left + ((round - 1) / (maxRound - 1)) * (width - left - right);
    const py = (weight: number) => height - bottom - (weight / maxWeight) * (height - top - bottom);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Frequency weight by round; drag a point to edit a keyframe");
    const line = (x1: number, y1: number, x2: number, y2: number, className: string) => {
      const element = document.createElementNS(svg.namespaceURI, "line");
      for (const [key, value] of Object.entries({ x1, y1, x2, y2 }))
        element.setAttribute(key, String(value));
      element.setAttribute("class", className);
      svg.append(element);
    };
    line(left, py(0), width - right, py(0), "axis");
    line(left, top, left, py(0), "axis");
    const tickCount = Math.min(8, maxRound - 1);
    for (let index = 0; index <= tickCount; index++) {
      const round = 1 + Math.round(((maxRound - 1) * index) / tickCount);
      const tick = document.createElementNS(svg.namespaceURI, "text");
      tick.setAttribute("x", String(px(round)));
      tick.setAttribute("y", String(height - 11));
      tick.textContent = String(round);
      svg.append(tick);
    }
    const points = Array.from({ length: 129 }, (_, index) => {
      const round = 1 + ((maxRound - 1) * index) / 128;
      const weight = valid.length ? weightAt(valid as WeightCurve, round) : 0;
      return `${px(round)},${py(unlock && round < unlock ? 0 : weight)}`;
    });
    const polyline = document.createElementNS(svg.namespaceURI, "polyline");
    polyline.setAttribute("points", points.join(" "));
    polyline.setAttribute("class", "curve");
    svg.append(polyline);
    curve.forEach((point, index) => {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", String(px(point[0])));
      circle.setAttribute("cy", String(py(point[1])));
      circle.setAttribute("r", "7");
      circle.setAttribute("class", "keyframe-point");
      circle.setAttribute("aria-label", `Keyframe ${index + 1}`);
      circle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        playSfx("ui.click");
        const move = (pointer: PointerEvent) => {
          // The graph container survives each redraw; the SVG point does not.
          const box = graph.getBoundingClientRect();
          const x = ((pointer.clientX - box.left) / box.width) * width;
          const y = ((pointer.clientY - box.top) / box.height) * height;
          point[0] = Math.max(
            1,
            Math.round(1 + ((x - left) / (width - left - right)) * (maxRound - 1)),
          );
          point[1] = Math.max(
            0,
            Math.round(((height - bottom - y) / (height - top - bottom)) * maxWeight * 4) / 4,
          );
          const row = detail.querySelectorAll<HTMLElement>(".balance-editor-keyframe")[index];
          const inputs = row?.querySelectorAll<HTMLInputElement>("input");
          if (inputs) {
            inputs[0]!.value = String(point[0]);
            inputs[1]!.value = String(point[1]);
          }
          drawGraph();
          updateValidation();
        };
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
      });
      svg.append(circle);
    });
    graph.replaceChildren(svg);
  }

  function updateValidation(): void {
    const errors = validateShopBalanceDraft(draft);
    for (const element of detail.querySelectorAll<HTMLElement>("[data-path]")) {
      const path = element.dataset.path!;
      const issue = errors.find(
        (error) =>
          error.path === path ||
          error.path.startsWith(`${path}.`) ||
          path.startsWith(`${error.path}.`),
      );
      element.classList.toggle("is-invalid", !!issue);
      element.title = issue?.message ?? "";
      const input = element.querySelector("input");
      if (input) input.setAttribute("aria-invalid", issue ? "true" : "false");
    }
    status.textContent = errors.length
      ? `${errors.length} issue${errors.length === 1 ? "" : "s"}: ${errors[0]!.path} — ${errors[0]!.message}`
      : "Valid draft · ready to export";
    copy.disabled = download.disabled = errors.length > 0;
  }

  const panels: Record<
    Selection["panel"],
    {
      label(id: string): string;
      curve(id: string): { curve: DraftCurve; path: string; unlock?: number } | null;
      render(id: string): void;
    }
  > = {
    stock: {
      label: () => "Stock & rank prices",
      curve: () => null,
      render: () => {
        section("Stock and card prices");
        const fields = document.createElement("div");
        fields.className = "balance-editor-fields";
        for (const key of [
          "minOffers",
          "maxOffers",
          "guaranteedPassives",
          "guaranteedCards",
        ] as const)
          fields.append(
            field(key, `stock.${key}`, draft.stock[key], (value) => {
              draft.stock[key] = value;
            }),
          );
        for (const rank of Object.keys(draft.cardRankSurcharge))
          fields.append(
            field(
              `${rank} rank bonus`,
              `cardRankSurcharge.${rank}`,
              draft.cardRankSurcharge[rank]!,
              (value) => {
                draft.cardRankSurcharge[rank] = value;
              },
            ),
          );
        detail.append(fields);
      },
    },
    material: {
      label: (id) => id,
      curve: (id) => {
        const value = draft.materials[id];
        return value ? { curve: value.weights, path: `materials.${id}.weights` } : null;
      },
      render: (id) => {
        section(`Material · ${id}`);
        const value = draft.materials[id];
        if (!value) {
          detail.append("This material is not sold in the shop.");
          return;
        }
        detail.append(
          field("Base price (coins)", `materials.${id}.basePrice`, value.basePrice, (next) => {
            value.basePrice = next;
          }),
        );
        curveEditor(value.weights, `materials.${id}.weights`);
      },
    },
    passive: {
      label: (id) => id,
      curve: (id) => {
        const value = draft.passives[id];
        return value
          ? {
              curve: draft.frequencies[value.frequency]!,
              path: `frequencies.${value.frequency}`,
              unlock: value.unlockRound,
            }
          : null;
      },
      render: (id) => {
        section(`Passive · ${id}`);
        const value = draft.passives[id];
        if (!value) {
          detail.append("This passive is retired or not sold in the shop.");
          return;
        }
        const fields = document.createElement("div");
        fields.className = "balance-editor-fields";
        fields.append(
          field("Base price (coins)", `passives.${id}.basePrice`, value.basePrice, (next) => {
            value.basePrice = next;
          }),
          field("Unlock round", `passives.${id}.unlockRound`, value.unlockRound, (next) => {
            value.unlockRound = next;
          }),
        );
        detail.append(fields);
        const note = document.createElement("p");
        note.textContent = `Uses shared frequency curve: ${value.frequency}. Editing it affects every passive that names it.`;
        detail.append(note);
        curveEditor(draft.frequencies[value.frequency]!, `frequencies.${value.frequency}`);
      },
    },
    frequency: {
      label: (id) => id,
      curve: (id) => ({ curve: draft.frequencies[id]!, path: `frequencies.${id}` }),
      render: (id) => {
        section(`Frequency · ${id}`);
        curveEditor(draft.frequencies[id]!, `frequencies.${id}`);
      },
    },
  };

  function renderDetail(): void {
    detail.replaceChildren();
    panels[selection.panel].render(selection.id);
    updateValidation();
  }

  function renderNav(): void {
    nav.replaceChildren();
    const groups: [string, Selection[]][] = [
      ["General", [{ panel: "stock", id: "stock" }]],
      ["Materials", Object.keys(draft.materials).map((id) => ({ panel: "material", id }))],
      ["Passives", Object.keys(draft.passives).map((id) => ({ panel: "passive", id }))],
      ["Shared curves", Object.keys(draft.frequencies).map((id) => ({ panel: "frequency", id }))],
    ];
    for (const [name, entries] of groups) {
      const heading = document.createElement("h2");
      heading.textContent = name;
      nav.append(heading);
      for (const entry of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = panels[entry.panel].label(entry.id);
        button.classList.toggle(
          "is-selected",
          selection.panel === entry.panel && selection.id === entry.id,
        );
        button.addEventListener("click", () => {
          playSfx("ui.click");
          selection = entry;
          renderNav();
          renderDetail();
        });
        nav.append(button);
      }
    }
  }

  const exported = () => JSON.stringify(draft, null, 2);
  copy.addEventListener("click", async () => {
    if (validateShopBalanceDraft(draft).length) return;
    playSfx("ui.click");
    try {
      await navigator.clipboard.writeText(exported());
      status.textContent = "Complete JSON copied";
    } catch {
      status.textContent = "Clipboard unavailable; use Download JSON";
    }
  });
  download.addEventListener("click", () => {
    if (validateShopBalanceDraft(draft).length) return;
    playSfx("ui.click");
    const url = URL.createObjectURL(new Blob([exported()], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "shop-balance-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return {
    show() {
      draft = currentShopBalanceDraft();
      selection = { panel: "stock", id: "stock" };
      renderNav();
      renderDetail();
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    dispose() {
      root.remove();
    },
  };
}
