import { cardName } from "./cards";
import { passiveDefinitions } from "./passives";
import type { ShopOffer } from "./shop-stock";
import "./shop-view.css";

type Destination = "hand" | "passive-rack";

/** Five draggable shop blocks, with a fixed hand target and the existing passive rack. */
export function createShopView(
  host: HTMLElement,
  rack: HTMLElement | null,
  price: (offer: ShopOffer) => number,
  buy: (id: string, destination: Destination) => boolean,
) {
  const stock = document.createElement("section");
  stock.className = "shop-stock";
  stock.setAttribute("aria-label", "Shop stock");
  const handTarget = document.createElement("div");
  handTarget.className = "shop-hand-target";
  handTarget.textContent = "DROP PLAYABLE BLOCKS INTO HAND";
  host.append(stock, handTarget);

  const contains = (element: HTMLElement | null, x: number, y: number) => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  };

  function render(offers: readonly ShopOffer[], visible: boolean): void {
    stock.hidden = handTarget.hidden = !visible;
    if (!visible) return;
    stock.replaceChildren();
    for (const offer of offers) {
      const passive = offer.kind === "passive";
      const definition = passive ? passiveDefinitions.get(offer.block.definitionId) : null;
      const identity = !passive ? offer.block.traits.identity : null;
      const symbol = passive ? definition!.symbol : `${identity!.rank}${identity!.suit.symbol}`;
      const name = passive ? definition!.name : cardName(identity!);
      const item = document.createElement("button");
      item.type = "button";
      item.className = `shop-offer ${passive ? "is-passive" : "is-card"}`;
      item.setAttribute(
        "aria-label",
        `${name}, ${price(offer)} coin, drag to ${passive ? "passive rack" : "hand"}`,
      );
      item.style.setProperty("--shop-face", passive ? definition!.palette.face : "#f4eee2");
      item.style.setProperty(
        "--shop-ink",
        passive ? definition!.palette.ink : identity!.suit.color,
      );
      item.style.setProperty("--shop-edge", passive ? definition!.palette.edge : "#b6aa91");
      const cube = document.createElement("span");
      cube.className = "shop-cube";
      for (const face of ["front", "right", "top"]) {
        const panel = document.createElement("span");
        panel.className = `shop-face shop-face-${face}`;
        panel.textContent = symbol;
        cube.append(panel);
      }
      const label = document.createElement("span");
      label.className = "shop-offer-label";
      label.textContent = `${name} · ${price(offer)} coin`;
      item.append(cube, label);
      item.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        item.setPointerCapture(event.pointerId);
        item.classList.add("is-dragging");
        const x = event.clientX;
        const y = event.clientY;
        const move = (next: PointerEvent) => {
          item.style.translate = `${next.clientX - x}px ${next.clientY - y}px`;
        };
        const finish = (end: PointerEvent) => {
          item.removeEventListener("pointermove", move);
          item.removeEventListener("pointerup", finish);
          item.removeEventListener("pointercancel", cancel);
          const destination = contains(rack, end.clientX, end.clientY)
            ? "passive-rack"
            : contains(handTarget, end.clientX, end.clientY)
              ? "hand"
              : null;
          if (!destination || !buy(offer.block.id, destination)) {
            item.style.translate = "";
            item.classList.remove("is-dragging");
          }
        };
        const cancel = () => {
          item.removeEventListener("pointermove", move);
          item.removeEventListener("pointerup", finish);
          item.removeEventListener("pointercancel", cancel);
          item.style.translate = "";
          item.classList.remove("is-dragging");
        };
        item.addEventListener("pointermove", move);
        item.addEventListener("pointerup", finish);
        item.addEventListener("pointercancel", cancel);
      });
      stock.append(item);
    }
  }

  return {
    render,
    dispose: () => {
      stock.remove();
      handTarget.remove();
    },
  };
}
