import type { HassEntity, HomeAssistant } from "./types";

export const UNAVAILABLE_TEXT = "Unavailable";
export const UNKNOWN_TEXT = "Unknown";

export type EntityStateClass = "state-on" | "state-off" | "state-unavailable" | "state-unknown";

/** Escapes text before it is interpolated into innerHTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Looks up an entity by id, returning undefined if hass or the entity is missing. */
export function getEntity(hass: HomeAssistant | undefined, entityId: string | undefined): HassEntity | undefined {
  if (!hass || !entityId) return undefined;
  return hass.states[entityId];
}

/** True only when the entity is present and reporting "on". */
export function isZoneOn(entity: HassEntity | undefined): boolean {
  return entity?.state === "on";
}

/** Fixed set of selectable manual-run durations, per milestone spec. */
export const ZONE_RUN_DURATIONS_MINUTES: readonly number[] = [5, 10, 15, 20, 30, 45, 60];
export const DEFAULT_ZONE_RUN_DURATION_MINUTES = 5;

/**
 * Shortcut durations surfaced as buttons. A strict subset of
 * ZONE_RUN_DURATIONS_MINUTES -- the dropdown remains the way to reach
 * 15/45/60. Selecting one only changes the pending duration; it never
 * starts irrigation.
 */
export const QUICK_DURATIONS_MINUTES: readonly number[] = [5, 10, 20, 30];

/**
 * Formats an observed (recorder-backed) timestamp for display. Wording is
 * deliberately about observation time only -- callers pair it with
 * "Last active"/"active", never "watered" or "completed".
 */
export function formatObservedTimestamp(epochMs: number, now: Date = new Date()): string {
  const date = new Date(epochMs);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Calendar-day arithmetic (not -24h) so DST transitions can't shift it.
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();

  if (epochMs >= startOfToday) return `Today ${time}`;
  if (epochMs >= startOfYesterday) return `Yesterday ${time}`;

  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

/**
 * Duration of an observed run, only ever called with a proven
 * start/stop pair. Returns undefined for a non-positive or non-finite
 * span rather than rendering a nonsense figure.
 */
export function formatObservedRunDuration(startedAt: number, endedAt: number): string | undefined {
  const minutes = Math.round((endedAt - startedAt) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  return `${minutes} min`;
}

/**
 * A zone can only be manually run when its switch is known and currently
 * off -- missing/unavailable/unknown zones can't be targeted, and an
 * already-running zone can't be re-triggered from here.
 */
export function canRunZone(entity: HassEntity | undefined): boolean {
  return !!entity && entity.state === "off";
}

/**
 * CSS state bucket shared by zone tiles and controller chips: an entity
 * that is missing or explicitly "unavailable" is treated the same way so
 * both render with the same warning-compatible styling.
 */
export function entityStateClass(entity: HassEntity | undefined): EntityStateClass {
  if (!entity || entity.state === "unavailable") return "state-unavailable";
  if (entity.state === "unknown") return "state-unknown";
  return entity.state === "on" ? "state-on" : "state-off";
}

/**
 * Picks the zone tile icon by actual running state, not just presence:
 * a static zone/area icon normally (including when off/unavailable/unknown),
 * switching to the spraying-sprinkler icon only while actually running so
 * the icon reinforces -- rather than contradicts -- the "Running" text.
 */
export function zoneIcon(entity: HassEntity | undefined): string {
  return entity?.state === "on" ? "mdi:sprinkler" : "mdi:chart-pie";
}

/** Renders a zone switch entity's state using irrigation-specific wording. */
export function formatZoneState(entity: HassEntity | undefined): string {
  if (!entity) return UNAVAILABLE_TEXT;
  switch (entity.state) {
    case "on":
      return "Running";
    case "off":
      return "Off";
    case "unavailable":
      return UNAVAILABLE_TEXT;
    case "unknown":
      return UNKNOWN_TEXT;
    default:
      return entity.state;
  }
}

/** Renders a binary_sensor's on/off state using caller-supplied wording. */
export function formatBinaryState(entity: HassEntity | undefined, onText: string, offText: string): string {
  if (!entity) return UNAVAILABLE_TEXT;
  switch (entity.state) {
    case "on":
      return onText;
    case "off":
      return offText;
    case "unavailable":
      return UNAVAILABLE_TEXT;
    case "unknown":
      return UNKNOWN_TEXT;
    default:
      return entity.state;
  }
}

/** Renders a sensor state as display text, with its unit if present. */
export function formatSensorState(entity: HassEntity | undefined): string {
  if (!entity) return UNAVAILABLE_TEXT;
  if (entity.state === "unavailable") return UNAVAILABLE_TEXT;
  if (entity.state === "unknown") return UNKNOWN_TEXT;
  const unit = entity.attributes.unit_of_measurement;
  return typeof unit === "string" && unit.length > 0 ? `${entity.state} ${unit}` : entity.state;
}

/** Parses a numeric sensor state, returning undefined if it isn't a plain number. */
export function parseNumericState(entity: HassEntity | undefined): number | undefined {
  if (!entity || entity.state === "unavailable" || entity.state === "unknown") return undefined;
  const value = Number(entity.state);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Whether the configured global stop button can be pressed. A `button`
 * entity's state is never "on"/"off" -- it's either "unknown" (never
 * pressed) or a last-pressed timestamp, and neither of those makes it
 * unusable. Only "not configured", "missing from hass.states", and the
 * explicit "unavailable" state disable it. Single source of truth for
 * this rule: used by both render sites (per-zone Stop button, the
 * standalone global Stop control) and the click handler's defensive
 * re-check, so they can't drift out of sync with each other.
 */
export function isStopButtonAvailable(hass: HomeAssistant | undefined, stopEntityId: string | undefined): boolean {
  if (!stopEntityId) return false;
  const entity = getEntity(hass, stopEntityId);
  return !!entity && entity.state !== "unavailable";
}

export interface ControllerDeviceInfo {
  name?: string;
  model?: string;
  manufacturer?: string;
  serialNumber?: string;
}

/**
 * Resolves Yardian controller device metadata purely from HA's own
 * entity/device registries as exposed on `hass` (hass.entities,
 * hass.devices) -- never from YAML config, never from .storage, never
 * from Yardian directly. Tries each candidate entity id in order until
 * one resolves to a device; returns undefined if the registries aren't
 * exposed or none of the candidates resolve, so the caller can fail
 * gracefully instead of guessing or throwing.
 */
export function resolveControllerDevice(
  hass: HomeAssistant | undefined,
  candidateEntityIds: readonly string[],
): ControllerDeviceInfo | undefined {
  if (!hass?.entities || !hass?.devices) return undefined;

  for (const entityId of candidateEntityIds) {
    const deviceId = hass.entities[entityId]?.device_id;
    if (!deviceId) continue;
    const device = hass.devices[deviceId];
    if (!device) continue;

    return {
      name: device.name_by_user ?? device.name ?? undefined,
      model: device.model ?? undefined,
      manufacturer: device.manufacturer ?? undefined,
      serialNumber: device.serial_number ?? undefined,
    };
  }
  return undefined;
}

const SECONDS_UNIT_PATTERN = /^s(ec(onds)?)?$/i;

function formatDurationSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return "None";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    const dayPart = `${days} day${days === 1 ? "" : "s"}`;
    return hours > 0 ? `${dayPart} ${hours} hr${hours === 1 ? "" : "s"}` : dayPart;
  }
  if (hours > 0) {
    const hourPart = `${hours} hr${hours === 1 ? "" : "s"}`;
    return minutes > 0 ? `${hourPart} ${minutes} min` : hourPart;
  }
  return `${minutes} min`;
}

/**
 * Formats a rain-delay sensor's raw state as human-readable text.
 * Display formatting only -- never mutates or re-derives HA state. Falls
 * back to the raw state + unit whenever the value doesn't look like a
 * plain seconds count, so unexpected upstream changes fail visibly rather
 * than silently mis-format.
 */
export function formatRainDelay(entity: HassEntity | undefined): string {
  if (!entity) return UNAVAILABLE_TEXT;
  if (entity.state === "unavailable") return UNAVAILABLE_TEXT;
  if (entity.state === "unknown") return UNKNOWN_TEXT;

  const seconds = Number(entity.state);
  const unit = entity.attributes.unit_of_measurement;
  const looksLikeSeconds = Number.isFinite(seconds) && (!unit || SECONDS_UNIT_PATTERN.test(unit));
  if (!looksLikeSeconds) {
    return formatSensorState(entity);
  }
  return formatDurationSeconds(seconds);
}
