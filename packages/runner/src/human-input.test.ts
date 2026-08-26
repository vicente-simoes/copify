import { describe, expect, it } from "vitest";
import type { Locator, Page } from "rebrowser-playwright";
import { HumanInput, randomInteger, samplePath, type HumanInputTelemetry, type Vector } from "./human-input";

type FakeField = { value: string; checked: boolean; selected: boolean };

function fixture(options: { visible?: boolean; disabled?: boolean; covered?: boolean; clipboard?: boolean; checkedReadDelay?: number } = {}) {
  let now = 0; let selectedAll = false;
  let checkedReadDelay = options.checkedReadDelay ?? 0;
  const field: FakeField = { value: "existing", checked: false, selected: false };
  const moves: Vector[] = []; const telemetry: HumanInputTelemetry[] = []; const keys: string[] = [];
  const locator = {
    count: async () => 1,
    isVisible: async () => options.visible ?? true,
    isDisabled: async () => options.disabled ?? false,
    boundingBox: async () => ({ x: 100, y: 100, width: 120, height: 40 }),
    evaluate: async () => !(options.covered ?? false),
    inputValue: async () => field.value,
    isChecked: async () => {
      if (field.checked && checkedReadDelay > 0) { checkedReadDelay -= 1; return false; }
      return field.checked;
    },
    locator: () => ({ evaluateAll: async () => [{ index: 1, value: "PT", text: "Portugal", disabled: false }].find((item) => item.value === "PT") }),
    selectOption: async ({ value }: { value: string }) => { field.value = value; field.selected = true; },
  } as unknown as Locator;
  const page = {
    evaluate: async () => ({ width: 1_000, height: 700 }),
    mouse: {
      move: async (x: number, y: number) => { moves.push({ x, y }); },
      down: async () => undefined,
      up: async () => { field.checked = true; },
      wheel: async () => undefined,
    },
    keyboard: {
      press: async (key: string) => {
        keys.push(key);
        if (key === "Control+A") selectedAll = true;
        if (key === "Backspace" && selectedAll) { field.value = ""; selectedAll = false; }
      },
      type: async (value: string) => { field.value += value; },
      insertText: async (value: string) => { field.value += value; },
    },
  } as unknown as Page;
  const curve = Array.from({ length: 40 }, (_, index) => ({ x: index * 4, y: index * 4 + Math.sin(index / 4) * 10 }));
  const input = new HumanInput(page, {
    random: () => 0.5,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    path: (_from, to) => [...curve, to],
    clipboard: { acquire: async () => options.clipboard ?? false, release: async () => undefined },
    telemetry: (event) => telemetry.push(event),
  });
  return { input, locator, field, moves, telemetry, keys, now: () => now };
}

describe("FAST_DROP human input", () => {
  it("resamples a curved path and keeps movement and dwell in the calibrated windows", async () => {
    const value = fixture(); await value.input.click(value.locator);
    const click = value.telemetry.find((event) => event.action === "CLICK")!;
    expect(click.movementMs).toBeGreaterThanOrEqual(100); expect(click.movementMs).toBeLessThanOrEqual(220);
    expect(click.dwellMs).toBeGreaterThanOrEqual(40); expect(click.dwellMs).toBeLessThanOrEqual(75);
    expect(click.pointCount).toBeGreaterThanOrEqual(12); expect(click.pointCount).toBeLessThanOrEqual(24);
    expect(value.moves.length).toBe((click.pointCount ?? 1) - 1);
  });

  it("types ASCII with cadence and inserts Unicode without losing the final value", async () => {
    const value = fixture(); await value.input.type(value.locator, "Simões");
    expect(value.field.value).toBe("Simões");
    expect(value.now()).toBeGreaterThan(6 * 15);
    expect(value.telemetry.at(-1)).toMatchObject({ action: "TYPE", method: "KEYBOARD" });
  });

  it("uses insertText without touching a nonempty clipboard", async () => {
    const value = fixture({ clipboard: false }); await value.input.paste(value.locator, "1 Rua Principal");
    expect(value.field.value).toBe("1 Rua Principal");
    expect(value.telemetry.at(-1)).toMatchObject({ action: "PASTE", method: "INSERT_TEXT", fallback: true });
  });

  it("rejects hidden or disabled targets after its bounded retry", async () => {
    await expect(fixture({ visible: false }).input.click(fixture({ visible: false }).locator)).rejects.toThrow(/not visible/i);
    const disabled = fixture({ disabled: true }); await expect(disabled.input.click(disabled.locator)).rejects.toThrow(/disabled/i);
  });

  it("refuses to click through a covering element", async () => {
    const covered = fixture({ covered: true }); await expect(covered.input.click(covered.locator)).rejects.toThrow(/covered/i);
  });

  it("falls back to exact selectOption when keyboard selection is not accepted", async () => {
    const value = fixture(); await value.input.selectOption(value.locator, ["PT"]);
    expect(value.field.value).toBe("PT"); expect(value.field.selected).toBe(true);
    expect(value.telemetry.at(-1)).toMatchObject({ action: "SELECT", method: "SELECT_OPTION_FALLBACK", fallback: true });
  });

  it("waits for a delayed checkout checkbox state before retrying the click", async () => {
    const value = fixture({ checkedReadDelay: 3 });
    await value.input.check(value.locator);
    expect(value.field.checked).toBe(true);
    expect(value.telemetry.at(-1)).toMatchObject({ action: "CHECK", method: "MOUSE" });
    expect(value.telemetry.at(-1)?.fallback).not.toBe(true);
  });

  it("exposes deterministic range and path helpers", () => {
    expect(randomInteger(() => 0, 15, 35)).toBe(15); expect(randomInteger(() => 0.999999, 15, 35)).toBe(35);
    const points = Array.from({ length: 50 }, (_, index) => ({ x: index, y: index * index }));
    const sampled = samplePath(points, 12); expect(sampled).toHaveLength(12); expect(sampled[0]).toEqual(points[0]); expect(sampled.at(-1)).toEqual(points.at(-1));
  });
});
