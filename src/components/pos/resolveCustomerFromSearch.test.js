// src/components/pos/resolveCustomerFromSearch.test.js
//
// Pins the pure helper that decides what to do with the cashier's
// "Search existing customer…" input. The bug we fixed: cashiers type the
// customer name into the search box expecting it to flow into the
// invoice, but the field used to only populate the bill's customerName
// when the cashier actively CLICKED a match from the dropdown. If they
// typed and moved on, the typed text vanished and the printed invoice
// showed "Walking Customer". The search bar now commits the typed query
// to bill.customerName on blur / Enter (provided no attach-existing
// match has been picked, which always wins).

import { resolveCustomerFromSearch } from "./POSBilling";

describe("resolveCustomerFromSearch", () => {
  test("returns the existing name unchanged when the query is empty", () => {
    expect(resolveCustomerFromSearch({ query: "", currentName: "Existing Name" })).toBe(
      "Existing Name"
    );
  });

  test("returns empty string when both query and current name are empty", () => {
    expect(resolveCustomerFromSearch({ query: "", currentName: "" })).toBe("");
  });

  test("returns the existing name when query is whitespace only", () => {
    expect(resolveCustomerFromSearch({ query: "   ", currentName: "Existing Name" })).toBe(
      "Existing Name"
    );
  });

  test("returns the trimmed query when no current name is set", () => {
    // The user's reported case: cashier types "John" in the search field,
    // doesn't click a match, then saves — the invoice should show "John",
    // not "Walking Customer".
    expect(resolveCustomerFromSearch({ query: "  John  ", currentName: "" })).toBe("John");
  });

  test("returns the trimmed query when there is no attached customer", () => {
    expect(
      resolveCustomerFromSearch({
        query: "Priya Nair",
        hasAttachedCustomer: false,
        currentName: "",
      })
    ).toBe("Priya Nair");
  });

  test("keeps the existing name when an attached customer record wins", () => {
    // Once the cashier has attached an existing customer record (by
    // clicking a dropdown match), that customer's name is authoritative —
    // subsequent typing in the search box must NOT clobber it.
    expect(
      resolveCustomerFromSearch({
        query: "SomeOther Name",
        hasAttachedCustomer: true,
        currentName: "Attached Customer",
      })
    ).toBe("Attached Customer");
  });

  test("returns current name when current is set and query is empty", () => {
    expect(resolveCustomerFromSearch({ query: "", currentName: "Already Set" })).toBe(
      "Already Set"
    );
  });

  test("treats null/undefined options defensively", () => {
    expect(resolveCustomerFromSearch({ query: "A", currentName: null })).toBe("A");
    expect(resolveCustomerFromSearch({ query: undefined, currentName: "X" })).toBe("X");
    expect(resolveCustomerFromSearch({})).toBe("");
  });
});
