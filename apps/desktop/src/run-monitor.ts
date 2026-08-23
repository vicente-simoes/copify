import type { SessionSnapshot } from "@copify/shared";

/**
 * Monitoring is only useful once a checkout browser is available to receive a
 * selected target. Deferring it until READY also prevents a failed launch from
 * producing unrelated storefront-monitor and protection-circuit events.
 */
export function canStartTargetMonitor(
  hasTarget: boolean,
  monitorAlreadyStarted: boolean,
  runIsEnding: boolean,
  sessionState: SessionSnapshot["state"],
): boolean {
  return hasTarget && !monitorAlreadyStarted && !runIsEnding && sessionState === "READY";
}
