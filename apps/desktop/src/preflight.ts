import { supportsAssistedCheckout, type BrowserProfile, type ProxyBenchmark, type ProxyProfile, type SessionSnapshot, type ShippingProfile, type Target } from "@copify/shared";

export type CheckStatus = "pass" | "warn" | "fail";

export type PreflightCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type Preflight = {
  checks: PreflightCheck[];
  failures: PreflightCheck[];
  warnings: PreflightCheck[];
  /** Spec 39: a critical failure refuses to arm. Warnings are informational. */
  canStart: boolean;
};

export type PreflightInput = {
  mode: "OBSERVATION" | "ASSISTED_CHECKOUT";
  profiles: BrowserProfile[];
  selectedProfileIds: string[];
  session: (profileId: string) => SessionSnapshot;
  proxies: ProxyProfile[];
  latestBenchmark: (routeId: string) => ProxyBenchmark | undefined;
  shipping: ShippingProfile[];
  target: Target | null;
};

export function preflight(input: PreflightInput): Preflight {
  const { mode, profiles, selectedProfileIds, session, proxies, latestBenchmark, shipping, target } = input;
  const assisted = mode === "ASSISTED_CHECKOUT";
  const selected = selectedProfileIds
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is BrowserProfile => Boolean(profile));
  const missingProfiles = selectedProfileIds.filter((id) => !profiles.some((profile) => profile.id === id));
  const disabledProfiles = selected.filter((profile) => !profile.enabled);

  const checks: PreflightCheck[] = [];

  // --- browsers ---
  checks.push(
    selected.length === 0
      ? { id: "browsers", label: "Browsers selected", status: "fail", detail: "Choose at least one browser to record." }
      : missingProfiles.length > 0
        ? { id: "browsers", label: "Browsers selected", status: "fail", detail: "A browser saved in this setup no longer exists." }
        : disabledProfiles.length > 0
          ? { id: "browsers", label: "Browsers selected", status: "fail", detail: `${disabledProfiles.map((profile) => profile.name).join(", ")} ${disabledProfiles.length === 1 ? "is" : "are"} disabled.` }
      : { id: "browsers", label: "Browsers selected", status: "pass", detail: `${selected.length} browser${selected.length === 1 ? "" : "s"} ready to launch.` },
  );

  // --- stopped ---
  // The run launches the browsers itself so it can attach recording from the first
  // navigation, which is why an already-open browser cannot join a run.
  const running = selected.filter((profile) => session(profile.id).state !== "STOPPED");
  if (selected.length > 0) {
    checks.push(
      running.length > 0
        ? {
            id: "stopped",
            label: "Browsers closed",
            status: "fail",
            detail: `${running.map((profile) => profile.name).join(", ")} ${running.length === 1 ? "is" : "are"} open. The run opens them itself so it can record from the first page — close them to include them.`,
          }
        : { id: "stopped", label: "Browsers closed", status: "pass", detail: "The run will open them with recording attached." },
    );
  }

  // --- routes ---
  const routeIssues: string[] = [];
  const unverified: string[] = [];
  for (const profile of selected) {
    if (!profile.proxyProfileId) {
      if (!latestBenchmark("direct")) unverified.push(`${profile.name} (direct)`);
      continue;
    }
    const proxy = proxies.find((item) => item.id === profile.proxyProfileId);
    if (!proxy) routeIssues.push(`${profile.name}: assigned proxy no longer exists`);
    else if (!proxy.enabled) routeIssues.push(`${profile.name}: ${proxy.name} is disabled`);
    else if (!latestBenchmark(proxy.id)) unverified.push(`${profile.name} (${proxy.name})`);
  }
  if (selected.length > 0) {
    checks.push(
      routeIssues.length > 0
        ? { id: "routes", label: "Routes usable", status: "fail", detail: routeIssues.join(" · ") }
        : unverified.length > 0
          ? { id: "routes", label: "Routes verified", status: "warn", detail: `Never benchmarked: ${unverified.join(", ")}.` }
          : { id: "routes", label: "Routes verified", status: "pass", detail: "Every selected route has a benchmark." },
    );
  }

  // --- target ---
  if (!target) {
    checks.push({
      id: "target",
      label: "Target armed",
      status: assisted ? "fail" : "warn",
      detail: assisted ? "Assisted checkout needs a target to act on." : "No target monitor — this run only records browsing.",
    });
  } else if (!target.enabled) {
    checks.push({ id: "target", label: "Target armed", status: "fail", detail: `${target.name} is disabled.` });
  } else if (assisted && !supportsAssistedCheckout(target.storeId)) {
    checks.push({ id: "target", label: "Target armed", status: "fail", detail: `${target.name} belongs to a store that cannot do assisted checkout.` });
  } else {
    checks.push({ id: "target", label: "Target armed", status: "pass", detail: `${target.name} · ${target.productKeywords.join(", ")}` });
  }

  // --- assisted-only checks ---
  if (assisted) {
    const complete = new Set(shipping.filter((item) => item.enabled && item.complete).map((item) => item.id));
    const eligible = selected.filter((profile) => profile.shippingProfileId && complete.has(profile.shippingProfileId));
    const observers = selected.filter((profile) => !eligible.includes(profile));
    checks.push(
      eligible.length === 0
        ? { id: "shipping", label: "Shipping ready", status: "fail", detail: "No selected browser has a complete shipping address, so none can check out." }
        : observers.length > 0
          ? { id: "shipping", label: "Shipping ready", status: "warn", detail: `${observers.map((profile) => profile.name).join(", ")} will observe only — no complete address assigned.` }
          : { id: "shipping", label: "Shipping ready", status: "pass", detail: `${eligible.length} browser${eligible.length === 1 ? "" : "s"} can check out.` },
    );

    checks.push(
      target && target.maxRetailMinor > 0
        ? { id: "price", label: "Price limit set", status: "pass", detail: `Stops above ${target.currency} ${(target.maxRetailMinor / 100).toFixed(2)}.` }
        : { id: "price", label: "Price limit set", status: "fail", detail: "Set a maximum retail price before letting Copify cart anything." },
    );
  }

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  return { checks, failures, warnings, canStart: failures.length === 0 };
}
