// src/components/pos/DiscountEditor.test.js
//
// Behavioural contract for the unified Bill Discount editor:
//
//   - A quick chip FILLS THE DRAFT. It must not apply. A mis-click on 10%
//     cannot silently discount a sale.
//   - The committed `current` discount stays live in the bill until Apply.
//   - Apply commits; Cancel discards the draft and leaves the bill alone.
//   - Custom % and the chips share ONE draft state and ONE Apply action.
//
// Mounted with renderToString + a mounted instance via ReactDOM, matching
// the project's existing test style (@testing-library/react is not installed).

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom/server";
import { act } from "react-dom/test-utils";
import ReactDOMClient from "react-dom/client";
import DiscountEditor from "./DiscountEditor";

const renderHtml = (props) =>
  ReactDOM.renderToString(<DiscountEditor label="bill" base={1000} {...props} />);

describe("DiscountEditor — quick presets fill the draft, they do not apply", () => {
  test("a 5% chip is rendered as a quick option", () => {
    const html = renderHtml({
      current: null,
      quickOptions: [{ type: "percent", value: 5 }],
      draft: { type: "percent", text: "" },
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(html).toContain("5%");
    expect(html).toContain("Quick:");
  });

  test("no quick options means no quick row at all", () => {
    const html = renderHtml({
      current: null,
      draft: { type: "percent", text: "" },
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(html).not.toContain("Quick:");
  });
});

describe("DiscountEditor — draft vs applied", () => {
  // Drive the real component so the click handlers actually run.
  const mount = (props) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);
    act(() => {
      root.render(<DiscountEditor label="bill" base={1000} {...props} />);
    });
    return { container, root };
  };

  const click = (container, selector) => {
    const el = container.querySelector(selector);
    expect(el).toBeTruthy();
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  test("clicking a quick chip does NOT call onApply — it only updates the draft", () => {
    const onApply = jest.fn();
    const onDraftChange = jest.fn();
    const { container, root } = mount({
      current: { type: "percent", value: 5 },
      quickOptions: [{ type: "percent", value: 10 }],
      draft: { type: "percent", text: "5" },
      onDraftChange,
      onApply,
    });

    const chips = container.querySelectorAll(".disc-quick");
    expect(chips.length).toBe(1);
    act(() => {
      chips[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The bill must be untouched until Apply.
    expect(onApply).not.toHaveBeenCalled();
    // The draft is repopulated with the chip's value.
    expect(onDraftChange).toHaveBeenCalledWith({ type: "percent", text: "10" });

    act(() => root.unmount());
  });

  test("the header shows the APPLIED discount, not the draft", () => {
    // Applied 5%, but the cashier has typed 7.5 into the draft. The bill
    // still has 5% active until Apply, so that is what must be displayed.
    const html = renderHtml({
      current: { type: "percent", value: 5 },
      quickOptions: [{ type: "percent", value: 10 }],
      draft: { type: "percent", text: "7.5" },
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(html).toContain("Applied:");
    expect(html).toContain("5%");
    expect(html).not.toContain("Current:");
  });

  test("the live preview reflects the DRAFT, not the applied value", () => {
    // base 1000, draft 7.5% => ₹75.00. The applied 5% (₹50) is irrelevant
    // to what the cashier is about to commit.
    const html = renderHtml({
      current: { type: "percent", value: 5 },
      draft: { type: "percent", text: "7.5" },
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(html).toContain("Discount Amount:");
    expect(html).toContain("75.00");
  });

  test("Apply is disabled while the draft is invalid, so a bad value cannot commit", () => {
    const html = renderHtml({
      current: { type: "percent", value: 5 },
      draft: { type: "percent", text: "150" }, // > 100
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(html).toContain("disabled");
  });

  test("Remove is offered only when a discount is actually applied", () => {
    const withDiscount = renderHtml({
      current: { type: "percent", value: 5 },
      draft: { type: "percent", text: "5" },
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(withDiscount).toContain("Remove");

    const withoutDiscount = renderHtml({
      current: null,
      draft: { type: "percent", text: "" },
      onDraftChange: () => {},
      onApply: () => {},
    });
    expect(withoutDiscount).not.toContain("Remove");
  });

  test("Remove calls onApply(null) — the same removal path as a zero Apply", () => {
    const onApply = jest.fn();
    const { container, root } = mount({
      current: { type: "percent", value: 5 },
      draft: { type: "percent", text: "5" },
      onDraftChange: () => {},
      onApply,
    });
    click(container, ".disc-btn-remove");
    expect(onApply).toHaveBeenCalledWith(null);
    act(() => root.unmount());
  });

  test("Enter in the input commits the draft via onApply", () => {
    const onApply = jest.fn();
    const { container, root } = mount({
      current: { type: "percent", value: 5 },
      draft: { type: "percent", text: "7.5" },
      onDraftChange: () => {},
      onApply,
    });
    const input = container.querySelector(".disc-input");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    expect(onApply).toHaveBeenCalledWith({ type: "percent", value: 7.5 });
    act(() => root.unmount());
  });

  test("Cancel discards the draft and restores it to the applied value", () => {
    const onDraftChange = jest.fn();
    const onApply = jest.fn();
    const { container, root } = mount({
      current: { type: "percent", value: 5 },
      draft: { type: "percent", text: "7.5" },
      onDraftChange,
      onApply,
    });
    click(container, ".disc-btn-cancel");
    // Cancel must not commit.
    expect(onApply).not.toHaveBeenCalled();
    // And it puts the draft back to what is actually applied.
    expect(onDraftChange).toHaveBeenCalledWith({ type: "percent", text: "5" });
    act(() => root.unmount());
  });

  test("switching to Flat ₹ keeps the typed value and re-previews against the base", () => {
    const onDraftChange = jest.fn();
    const { container, root } = mount({
      current: null,
      draft: { type: "percent", text: "150" },
      onDraftChange,
      onApply: () => {},
    });
    const flatMode = container.querySelectorAll(".disc-mode")[1];
    act(() => {
      flatMode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Same value, new type — one draft, not two.
    expect(onDraftChange).toHaveBeenCalledWith({ type: "flat", text: "150" });
    act(() => root.unmount());
  });
});
