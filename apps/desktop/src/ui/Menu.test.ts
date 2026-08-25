import { describe, expect, it } from "vitest";
import { placeMenu } from "./Menu";

const VIEWPORT = { width: 1280, height: 800 };
const MENU = { width: 200, height: 300 };
/* Mirrors the constants in Menu.tsx; asserted through behaviour below. */
const MARGIN = 8;

/** Every placement must sit fully inside the window — that was the bug. */
function assertOnScreen(placement: { top: number; left: number; maxHeight: number }, menuHeight: number) {
  const height = Math.min(menuHeight, placement.maxHeight);
  expect(placement.top).toBeGreaterThanOrEqual(MARGIN);
  expect(placement.left).toBeGreaterThanOrEqual(MARGIN);
  expect(placement.top + height).toBeLessThanOrEqual(VIEWPORT.height - MARGIN + 1);
  expect(placement.left + MENU.width).toBeLessThanOrEqual(VIEWPORT.width - MARGIN + 1);
}

describe("placeMenu", () => {
  it("opens below a row with room, right-aligned to the trigger", () => {
    const placement = placeMenu({ top: 100, bottom: 128, right: 900 }, MENU, VIEWPORT);
    expect(placement.top).toBe(132);
    expect(placement.left).toBe(700);
    assertOnScreen(placement, MENU.height);
  });

  it("flips above a row near the bottom instead of running off it", () => {
    const placement = placeMenu({ top: 700, bottom: 728, right: 900 }, MENU, VIEWPORT);
    expect(placement.top).toBeLessThan(700);
    assertOnScreen(placement, MENU.height);
  });

  it("caps a list taller than the space to that space, so it scrolls", () => {
    // 40 route entries: taller than the window on either side.
    const tall = { width: 200, height: 1400 };
    const placement = placeMenu({ top: 380, bottom: 408, right: 900 }, tall, VIEWPORT);
    expect(placement.maxHeight).toBeLessThan(tall.height);
    assertOnScreen(placement, tall.height);
  });

  it("stays on screen for a row at either extreme", () => {
    for (const trigger of [{ top: 0, bottom: 28, right: 900 }, { top: 772, bottom: 800, right: 900 }]) {
      assertOnScreen(placeMenu(trigger, MENU, VIEWPORT), MENU.height);
    }
  });

  it("stays on screen when neither side clears the usable-height floor", () => {
    // Shorter than the app's minimum window, but the geometry must not be able
    // to place the menu outside the viewport regardless of how it is reached.
    const short = { width: 1280, height: 200 };
    const placement = placeMenu({ top: 90, bottom: 118, right: 900 }, MENU, short);
    const height = Math.min(MENU.height, placement.maxHeight);
    expect(placement.top).toBeGreaterThanOrEqual(MARGIN);
    expect(placement.top + height).toBeLessThanOrEqual(short.height - MARGIN);
  });

  it("pulls a menu back inside the right edge and never past the left", () => {
    expect(placeMenu({ top: 100, bottom: 128, right: 1278 }, MENU, VIEWPORT).left).toBe(VIEWPORT.width - MENU.width - MARGIN);
    // A trigger near the left cannot push the menu off the other side.
    expect(placeMenu({ top: 100, bottom: 128, right: 40 }, MENU, VIEWPORT).left).toBe(MARGIN);
  });
});
