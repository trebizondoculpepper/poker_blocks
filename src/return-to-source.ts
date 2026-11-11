/**
 * Return to source (#482): a dragged thing that is refused (dropped off any target, or on a
 * target that turns it away) flies back to where it rests instead of snapping there.
 *
 * It works on any element a drag source moves with the CSS `translate` property, an offset from
 * its resting place. The flight eases that offset back to zero, so it always lands on the
 * element's **live** resting place: if the layout reflows mid-flight, the destination moves with
 * it. Nothing else of the pose changes while dragging (no rotation or scale), so the resting
 * orientation and size are kept throughout.
 *
 * Presentation only: the drop's outcome is already decided and committed when the flight starts,
 * and nothing waits for it. The element can be picked up again mid-flight: `take` stops the
 * flight and says where the element is now, so the new drag continues from there without a jump.
 */

export type ReturnFlightSettings = {
  /** How long the flight back takes, in seconds. */
  seconds: number;
  /** A CSS easing for the flight. */
  easing: string;
};

export const defaultReturnFlight: ReturnFlightSettings = {
  seconds: 0.5,
  easing: "cubic-bezier(.2,.7,.2,1)",
};

/** An offset in pixels. */
export type Offset = { x: number; y: number };

/** The element's offset from rest, from its CSS translate ("12px -4px", "12px", "none" or ""). */
export function translateOffset(translate: string): Offset {
  const [x = 0, y = 0] = translate
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .map((value) => (Number.isFinite(value) ? value : 0));
  return { x, y };
}

/** The parts of an element the flight uses (a real HTMLElement, or a stand-in in tests). */
export type ReturnableElement = Pick<HTMLElement, "style" | "animate" | "classList">;

/** Each element's flight in progress, so it can be retaken or stopped. */
const flights = new WeakMap<ReturnableElement, { animation: Animation; className?: string }>();

/**
 * Fly `element` from where it was released back to rest. With reduced motion it is put back at
 * once. `className` is kept on the element while it flies (to keep it above its neighbours).
 */
export function returnToSource(
  element: ReturnableElement,
  options: {
    reducedMotion: boolean;
    settings?: ReturnFlightSettings;
    className?: string;
    /** Where the element is now, read from its live style when left out. */
    from?: Offset;
  },
): void {
  stop(element);
  const settings = options.settings ?? defaultReturnFlight;
  const from = options.from ?? translateOffset(element.style.translate);
  element.style.translate = "";
  if (options.reducedMotion || settings.seconds <= 0 || (from.x === 0 && from.y === 0)) return;
  const animation = element.animate(
    [{ translate: `${from.x}px ${from.y}px` }, { translate: "0px 0px" }],
    { duration: settings.seconds * 1000, easing: settings.easing },
  );
  const flight = { animation, className: options.className };
  flights.set(element, flight);
  if (flight.className) element.classList.add(flight.className);
  // Landing ends the flight; one stopped or replaced already ended itself.
  const landed = () => {
    if (flights.get(element) === flight) stop(element);
  };
  animation.finished.then(landed, landed);
}

/**
 * Stop a flight where it is, leaving the element there (its translate set to the flight's
 * current offset), and say where that is. An element not flying stays where it is.
 */
export function take(element: ReturnableElement, read: () => string): Offset {
  const flight = flights.get(element);
  if (!flight) return translateOffset(element.style.translate);
  const here = translateOffset(read());
  stop(element);
  element.style.translate = `${here.x}px ${here.y}px`;
  return here;
}

/** End a flight at once (the element is being removed, or the scene is leaving). */
export function stop(element: ReturnableElement): void {
  const flight = flights.get(element);
  if (!flight) return;
  flights.delete(element);
  flight.animation.cancel();
  if (flight.className) element.classList.remove(flight.className);
}
