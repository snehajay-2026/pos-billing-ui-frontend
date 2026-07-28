// Hotel bill / cart merge helpers.
//
// `hotel_shared_items` (localStorage) holds bill lines from every room that
// was Quick Booked but not yet saved. The bill screen, however, only ever
// shows ONE room's bill at a time — opening Room B's bill must not show
// Room A's Room Booking row.
//
// `mergeSharedItemsIntoCart` enforces that scoping: rows are filtered to
// the room already active in the cart (or, for an empty cart, the first
// lodging room from the shared store, so a fresh Quick Book still
// hydrates the cart).

// Merge a `hotel_shared_items` array into the current cart state.
//
// Lodging rows are matched by `id`, NOT by `roomId`. The previous version
// keyed on `roomId`, which collapsed every lodging line for a given room
// down to a single row — silently dropping rows like the Room Booking line
// when an Extra Hours Charges line for the same room was added to the
// shared store. Each lodging line item (booking, overstay, posted charges)
// is its own line in the bill, so each gets its own id and survives the
// merge independently. Non-lodging items in the cart are preserved.
//
// Returns the SAME array reference if there's nothing to merge — callers
// rely on that to skip state updates.
export const mergeSharedItemsIntoCart = (prevItems, sharedItems) => {
  if (!Array.isArray(sharedItems) || sharedItems.length === 0) return prevItems;
  // Determine the "active room" for this cart.
  //   - Prefer a roomId already present in the cart (cashier has it open).
  //   - Otherwise, pick the first lodging roomId in the shared items
  //     (handles empty-cart hydration after a Quick Book).
  //   - Otherwise null = unrestricted merge (nothing to scope to).
  const activeRoomId = (() => {
    const fromCart = prevItems.find((p) => p && p.type === "lodging" && p.meta && p.meta.roomId)
      ?.meta?.roomId;
    if (fromCart) return String(fromCart);
    const fromShared = sharedItems.find((s) => s && s.type === "lodging" && s.meta && s.meta.roomId)
      ?.meta?.roomId;
    return fromShared ? String(fromShared) : null;
  })();

  const scopedShared = activeRoomId
    ? sharedItems.filter((s) => {
        if (!s) return false;
        // Non-lodging rows in the shared store aren't filtered — they may be
        // dining bill lines or similar that should still flow into the cart.
        if (s.type !== "lodging") return true;
        return s.meta && String(s.meta.roomId) === activeRoomId;
      })
    : sharedItems;

  // Index shared items by stable id so each line resolves to one merge
  // partner in the cart.
  const sharedById = new Map();
  scopedShared.forEach((s) => {
    if (s && s.id) sharedById.set(s.id, s);
  });
  const mergedShared = scopedShared.map((s) => {
    const prevItem = prevItems.find((p) => p && p.id === s.id);
    return prevItem ? { ...prevItem, ...s } : s;
  });
  // Drop cart items that the shared store now claims — but only when the
  // shared store actually carries an entry with the same id. Local cart
  // items that aren't in the shared store (custom added rows, dining
  // lines, overstay lines that haven't been synced upstream yet, etc.)
  // are preserved.
  const others = prevItems.filter((p) => {
    if (!p) return true;
    return !sharedById.has(p.id);
  });
  return [...mergedShared, ...others];
};

// Replace a single lodging line in the cart, matched by `id`. The matched
// row is removed and `nextItem` is prepended so it lands at the top of the
// cart list (mirrors setItems((prev) => [new, ...filtered])).
export const replaceLodgingBillItem = (prevItems, nextItem) => {
  if (!nextItem) return prevItems;
  const id = nextItem.id;
  const filtered = prevItems.filter((p) => {
    if (!p) return false;
    if (id && p.id === id) return false;
    return true;
  });
  return [nextItem, ...filtered];
};
