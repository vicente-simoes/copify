import { path as ghostPath } from "ghost-cursor";
import type { Locator, Page } from "rebrowser-playwright";

export type Vector = { x: number; y: number };

export type HumanInputAction = "CLICK" | "TYPE" | "PASTE" | "SCROLL" | "SELECT" | "CHECK";
export type HumanInputMethod = "MOUSE" | "KEYBOARD" | "CLIPBOARD" | "INSERT_TEXT" | "SELECT_OPTION_FALLBACK";
export type HumanInputTelemetry = {
  action: HumanInputAction;
  method: HumanInputMethod;
  durationMs: number;
  movementMs?: number;
  dwellMs?: number;
  pointCount?: number;
  fallback?: boolean;
};

export interface ClipboardPasteClient {
  acquire(value: string): Promise<boolean>;
  release(): Promise<void>;
}

type HumanInputDependencies = {
  random: () => number;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  path: (from: Vector, to: Vector) => Vector[];
  clipboard?: ClipboardPasteClient;
  telemetry?: (event: HumanInputTelemetry) => void;
};

const FAST_DROP = {
  movementMinMs: 100,
  movementMaxMs: 220,
  dwellMinMs: 40,
  dwellMaxMs: 75,
  keyMinMs: 15,
  keyMaxMs: 35,
  maxScrollAttempts: 12,
  maxPathPoints: 24,
  minPathPoints: 12,
} as const;

export class HumanInput {
  private location: Vector = { x: 0, y: 0 };
  private readonly dependencies: HumanInputDependencies;

  constructor(private readonly page: Page, dependencies: Partial<HumanInputDependencies> = {}) {
    this.dependencies = {
      random: dependencies.random ?? Math.random,
      now: dependencies.now ?? (() => performance.now()),
      sleep: dependencies.sleep ?? delay,
      path: dependencies.path ?? ((from, to) => ghostPath(from, to, { moveSpeed: 1 }).map(({ x, y }) => ({ x, y }))),
      clipboard: dependencies.clipboard,
      telemetry: dependencies.telemetry,
    };
  }

  async click(locator: Locator): Promise<void> {
    const started = this.dependencies.now();
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.ensureInteractable(locator);
        const scrolled = await this.scrollIntoView(locator);
        const box = await locator.boundingBox();
        if (!box || box.width <= 1 || box.height <= 1) throw new HumanInputError("The input target has no usable screen position.");
        const insetX = Math.min(box.width * 0.2, Math.max(1, box.width / 2 - 1));
        const insetY = Math.min(box.height * 0.2, Math.max(1, box.height / 2 - 1));
        const destination = {
          x: box.x + insetX + this.dependencies.random() * Math.max(1, box.width - insetX * 2),
          y: box.y + insetY + this.dependencies.random() * Math.max(1, box.height - insetY * 2),
        };
        const receivesPointer = await locator.evaluate((element, point) => {
          if (window !== window.top) return true;
          const hit = document.elementFromPoint(point.x, point.y);
          return hit === element || (hit !== null && element.contains(hit));
        }, destination).catch(() => false);
        if (!receivesPointer) throw new HumanInputError("The input target is covered by another element.");
        const movement = await this.move(destination);
        const dwellMs = randomInteger(this.dependencies.random, FAST_DROP.dwellMinMs, FAST_DROP.dwellMaxMs);
        await this.page.mouse.down();
        await this.dependencies.sleep(dwellMs);
        await this.page.mouse.up();
        this.dependencies.telemetry?.({ action: "CLICK", method: "MOUSE", durationMs: this.dependencies.now() - started, movementMs: movement.durationMs, dwellMs, pointCount: movement.pointCount });
        if (scrolled) this.dependencies.telemetry?.({ action: "SCROLL", method: "MOUSE", durationMs: scrolled.durationMs, pointCount: scrolled.steps });
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await this.dependencies.sleep(25);
      }
    }
    throw lastError instanceof Error ? lastError : new HumanInputError("The input target could not be clicked.");
  }

  async type(locator: Locator, text: string): Promise<void> {
    const started = this.dependencies.now();
    await this.focusAndClear(locator);
    for (const character of [...text]) {
      if (isKeyboardCharacter(character)) await this.page.keyboard.type(character);
      else await this.page.keyboard.insertText(character);
      await this.dependencies.sleep(randomInteger(this.dependencies.random, FAST_DROP.keyMinMs, FAST_DROP.keyMaxMs));
    }
    await this.verifyValue(locator, text);
    this.dependencies.telemetry?.({ action: "TYPE", method: "KEYBOARD", durationMs: this.dependencies.now() - started });
  }

  async paste(locator: Locator, text: string): Promise<void> {
    const started = this.dependencies.now();
    await this.focusAndClear(locator);
    let granted = false;
    try {
      granted = Boolean(this.dependencies.clipboard && await this.dependencies.clipboard.acquire(text));
      if (granted) {
        await this.page.keyboard.press("Control+V");
        await this.verifyValue(locator, text);
        this.dependencies.telemetry?.({ action: "PASTE", method: "CLIPBOARD", durationMs: this.dependencies.now() - started });
        return;
      }
    } catch {
      // A paste failure is recoverable: clear any partial value and use the
      // browser's text insertion path without touching the user's clipboard.
    } finally {
      if (granted) await this.dependencies.clipboard?.release().catch(() => undefined);
    }
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await this.page.keyboard.insertText(text);
    await this.verifyValue(locator, text);
    this.dependencies.telemetry?.({ action: "PASTE", method: "INSERT_TEXT", durationMs: this.dependencies.now() - started, fallback: true });
  }

  async selectOption(locator: Locator, wanted: readonly string[]): Promise<void> {
    const started = this.dependencies.now();
    const option = await locator.locator("option").evaluateAll((options, values) => options.map((item) => ({
      value: (item as HTMLOptionElement).value,
      text: item.textContent?.trim() ?? "",
      disabled: (item as HTMLOptionElement).disabled,
    })).filter((item) => !item.disabled).map((item, index) => ({ ...item, index })).find((item) => values.some((value) => item.value.trim().toLocaleLowerCase() === value.toLocaleLowerCase() || item.text.trim().toLocaleLowerCase() === value.toLocaleLowerCase())), [...wanted]).catch(() => undefined);
    if (!option) throw new HumanInputError("The requested option is unavailable.");
    let fallback = false;
    try {
      await this.click(locator);
      await this.page.keyboard.press("Home");
      for (let index = 0; index < option.index; index += 1) {
        await this.page.keyboard.press("ArrowDown");
        await this.dependencies.sleep(randomInteger(this.dependencies.random, FAST_DROP.keyMinMs, FAST_DROP.keyMaxMs));
      }
      await this.page.keyboard.press("Enter");
      if (await locator.inputValue() !== option.value) throw new HumanInputError("Keyboard selection was not accepted.");
    } catch {
      fallback = true;
      await locator.selectOption({ value: option.value });
      if (await locator.inputValue() !== option.value) throw new HumanInputError("The requested option could not be selected.");
    }
    this.dependencies.telemetry?.({ action: "SELECT", method: fallback ? "SELECT_OPTION_FALLBACK" : "KEYBOARD", durationMs: this.dependencies.now() - started, fallback });
  }

  async check(locator: Locator): Promise<void> {
    const started = this.dependencies.now();
    if (!await locator.isChecked()) await this.click(locator);
    if (await this.waitForChecked(locator)) {
      this.dependencies.telemetry?.({ action: "CHECK", method: "MOUSE", durationMs: this.dependencies.now() - started });
      return;
    }

    // Shopify can visually check the control before its checkout component has
    // synchronized the input's checked property. Wait first, then make one
    // deliberate retry rather than treating that transient state as failure.
    await this.click(locator);
    if (!await this.waitForChecked(locator)) throw new HumanInputError("The checkbox did not accept the click.");
    this.dependencies.telemetry?.({ action: "CHECK", method: "MOUSE", durationMs: this.dependencies.now() - started, fallback: true });
  }

  private async waitForChecked(locator: Locator): Promise<boolean> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await locator.isChecked().catch(() => false)) return true;
      if (attempt < 5) await this.dependencies.sleep(75);
    }
    return false;
  }

  private async focusAndClear(locator: Locator): Promise<void> {
    await this.click(locator);
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
  }

  private async ensureInteractable(locator: Locator): Promise<void> {
    if (!await locator.count() || !await locator.isVisible()) throw new HumanInputError("The input target is not visible.");
    if (await locator.isDisabled().catch(() => false)) throw new HumanInputError("The input target is disabled.");
  }

  private async scrollIntoView(locator: Locator): Promise<{ durationMs: number; steps: number } | undefined> {
    const started = this.dependencies.now();
    let steps = 0;
    for (; steps < FAST_DROP.maxScrollAttempts; steps += 1) {
      const box = await locator.boundingBox();
      if (!box) throw new HumanInputError("The input target has no screen position.");
      const viewport = await this.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      if (box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height) return steps ? { durationMs: this.dependencies.now() - started, steps } : undefined;
      const deltaX = clamp(box.x + box.width / 2 - viewport.width / 2, -500, 500);
      const deltaY = clamp(box.y + box.height / 2 - viewport.height / 2, -500, 500);
      await this.page.mouse.wheel(deltaX, deltaY);
      await this.dependencies.sleep(randomInteger(this.dependencies.random, FAST_DROP.keyMinMs, FAST_DROP.keyMaxMs));
    }
    throw new HumanInputError("The input target could not be scrolled into view.");
  }

  private async move(destination: Vector): Promise<{ durationMs: number; pointCount: number }> {
    const requestedDuration = randomInteger(this.dependencies.random, FAST_DROP.movementMinMs, FAST_DROP.movementMaxMs);
    const raw = this.dependencies.path(this.location, destination);
    const distance = Math.hypot(destination.x - this.location.x, destination.y - this.location.y);
    const wantedPoints = clamp(Math.round(FAST_DROP.minPathPoints + distance / 80), FAST_DROP.minPathPoints, FAST_DROP.maxPathPoints);
    const points = samplePath(raw.length >= 2 ? raw : [this.location, destination], wantedPoints);
    const started = this.dependencies.now();
    for (let index = 1; index < points.length; index += 1) {
      const due = started + requestedDuration * (index / (points.length - 1));
      const remaining = due - this.dependencies.now();
      if (remaining > 0) await this.dependencies.sleep(remaining);
      await this.page.mouse.move(points[index].x, points[index].y);
    }
    this.location = destination;
    return { durationMs: this.dependencies.now() - started, pointCount: points.length };
  }

  private async verifyValue(locator: Locator, expected: string): Promise<void> {
    if (await locator.inputValue() !== expected) throw new HumanInputError("The input field did not retain the requested value.");
  }
}

export function samplePath(points: readonly Vector[], wanted: number): Vector[] {
  if (points.length <= 2 || wanted <= 2) return [points[0], points.at(-1)!];
  const count = Math.min(points.length, Math.max(2, wanted));
  return Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / (count - 1))]);
}

export function randomInteger(random: () => number, minimum: number, maximum: number): number {
  return Math.floor(minimum + clamp(random(), 0, 0.999999999) * (maximum - minimum + 1));
}

function isKeyboardCharacter(value: string): boolean { return /^[\x20-\x7e]$/.test(value); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
async function delay(milliseconds: number): Promise<void> { if (milliseconds > 0) await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }

export class HumanInputError extends Error {}
