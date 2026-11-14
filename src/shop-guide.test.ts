import { describe, expect, it } from "vite-plus/test";
import type { DragLifecycle } from "./drag-drop";
import type { OfferDestination, ShopOffer } from "./offer-kinds";
import { shopGuideProvider } from "./shop-view";

// The provider never reads the drag itself: the shop knows which offer it is dragging.
const drag = {} as DragLifecycle;
// Stand-ins for the shop's DOM areas: the provider only hands them on.
const buy = { area: "buy" } as unknown as HTMLElement;
const rack = { area: "rack" } as unknown as HTMLElement;

const offer = (kind: string, id = `${kind}-1`): ShopOffer =>
  ({ kind, block: { id } }) as unknown as ShopOffer;

/** A provider over one dragged offer and a live verdict the test can change mid-drag. */
function harness(targets = { buy: [buy], rack: [rack] }) {
  let dragged: ShopOffer | null = null;
  let refusal: string | null = null;
  const asked: [string, OfferDestination][] = [];
  const provider = shopGuideProvider(
    () => dragged,
    targets,
    (id, destination) => {
      asked.push([id, destination]);
      return refusal ? { reason: refusal } : null;
    },
  );
  return {
    provider,
    asked,
    drag: (next: ShopOffer | null) => void (dragged = next),
    refuse: (reason: string | null) => void (refusal = reason),
  };
}

describe("the shop's drag guide provider (#501, #502)", () => {
  it("guides nothing while no offer is dragged", () => {
    const { provider, asked } = harness();
    expect(provider.preferred(drag)).toEqual([]);
    expect(provider.refusal(drag)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("guides a card to BUY (#502)", () => {
    const { provider, drag: hold } = harness();
    hold(offer("card"));
    expect(provider.preferred(drag)).toEqual([buy]);
  });

  it.each(["passive", "transmogrifier", "nothingifier"])(
    "guides a %s to the Items rack, by its registered view (#501)",
    (kind) => {
      const { provider, drag: hold } = harness();
      hold(offer(kind));
      expect(provider.preferred(drag)).toEqual([rack]);
    },
  );

  it("asks the live verdict for the offer kind's own destination", () => {
    const { provider, asked, drag: hold } = harness();
    hold(offer("card", "c7"));
    provider.refusal(drag);
    hold(offer("passive", "p3"));
    provider.refusal(drag);
    expect(asked).toEqual([
      ["c7", "hand"],
      ["p3", "passive-rack"],
    ]);
  });

  it("follows the verdict mid-drag: coins or rack space running out shows the refusal, and back", () => {
    const { provider, drag: hold, refuse } = harness();
    hold(offer("passive"));
    expect(provider.refusal(drag)).toBeNull();
    refuse("rack-full");
    expect(provider.refusal(drag)).toBe("rack-full");
    expect(provider.preferred(drag)).toEqual([rack]);
    refuse("unaffordable");
    expect(provider.refusal(drag)).toBe("unaffordable");
    refuse(null);
    expect(provider.refusal(drag)).toBeNull();
  });

  it("clears when the drag ends or is cancelled", () => {
    const { provider, drag: hold, refuse } = harness();
    hold(offer("card"));
    refuse("unaffordable");
    hold(null);
    expect(provider.preferred(drag)).toEqual([]);
    expect(provider.refusal(drag)).toBeNull();
  });

  it("guides a rack item nowhere when the shop shows no rack, leaving BUY to accept it", () => {
    const { provider, drag: hold } = harness({ buy: [buy], rack: [] });
    hold(offer("passive"));
    expect(provider.preferred(drag)).toEqual([]);
  });
});
