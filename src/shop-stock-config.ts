import type { ShopTrait } from "./game-modes";

export type ShopStockError = { field: keyof ShopTrait; message: string };

/** Stock limits shared by the live shop and the developer balance draft. */
export function validateShopStock(stock: ShopTrait): ShopStockError[] {
  const errors: ShopStockError[] = [];
  const add = (field: keyof ShopTrait, message: string) => errors.push({ field, message });
  const whole = (value: number | undefined, minimum: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
  for (const field of ["minOffers", "maxOffers"] as const)
    if (!whole(stock[field], 1)) add(field, "Use a positive whole offer count");
  if (stock.transmogrifierSlots !== undefined && !whole(stock.transmogrifierSlots, 0))
    add("transmogrifierSlots", "Use a nonnegative whole slot count");
  else if ((stock.transmogrifierSlots ?? 1) > 2)
    add("transmogrifierSlots", "Use at most two transmogrifier slots");
  for (const field of ["guaranteedPassives", "guaranteedCards"] as const)
    if (stock[field] !== undefined && !whole(stock[field], 0))
      add(field, "Use a nonnegative whole guaranteed count");
  if (whole(stock.minOffers, 1) && whole(stock.maxOffers, 1)) {
    if (stock.minOffers > stock.maxOffers) add("maxOffers", "Maximum must be at least the minimum");
    if (stock.maxOffers > 9) add("maxOffers", "The landscape shop fits at most nine offers");
  }
  if (
    whole(stock.minOffers, 1) &&
    whole(stock.guaranteedPassives ?? 1, 0) &&
    whole(stock.guaranteedCards ?? 1, 0) &&
    (stock.guaranteedPassives ?? 1) + (stock.guaranteedCards ?? 1) > stock.minOffers
  )
    add("guaranteedPassives", "Guaranteed offers cannot exceed the minimum stock count");
  // The shop lays out at most nine offers: the guarantees and the dedicated transmogrifier
  // slots must fit together (#388).
  if (
    whole(stock.guaranteedPassives ?? 1, 0) &&
    whole(stock.guaranteedCards ?? 1, 0) &&
    whole(stock.transmogrifierSlots ?? 1, 0) &&
    (stock.guaranteedPassives ?? 1) +
      (stock.guaranteedCards ?? 1) +
      (stock.transmogrifierSlots ?? 1) >
      9
  )
    add("transmogrifierSlots", "Guaranteed offers and transmogrifier slots must fit in nine");
  return errors;
}
