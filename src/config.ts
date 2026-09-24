/**
 * Lovelace configuration contract for `yardian-card`.
 *
 * Milestone 1 is read-only: configuration only declares which entities to
 * read and how to label them. It does not yet configure any controls.
 */

export interface YardianZoneConfig {
  entity: string;
  name?: string;
  /** Physically wired but intentionally not in service; de-emphasized in the UI, not hidden or treated as an error. */
  unused?: boolean;
  /** HA-served image URL (e.g. /local/yardian-card/zones/...); never a Windows/local filesystem path. */
  image?: string;
}

export interface YardianControllerConfig {
  rain_delay_entity?: string;
  active_zones_entity?: string;
  watering_running_entity?: string;
  freeze_prevent_entity?: string;
  standby_entity?: string;
  /** button entity for the global "stop all irrigation" action. */
  stop_irrigation_entity?: string;
}

export interface YardianCardConfig {
  type: string;
  title?: string;
  zones: YardianZoneConfig[];
  controller?: YardianControllerConfig;
}

export class YardianConfigError extends Error {}

/**
 * Validates and normalizes a raw Lovelace card config object.
 * Throws YardianConfigError on structurally invalid config so the caller
 * can render a clear error instead of a blank/crashed card.
 */
export function normalizeConfig(input: unknown): YardianCardConfig {
  if (!input || typeof input !== "object") {
    throw new YardianConfigError("Configuration is missing or not an object.");
  }
  const raw = input as Record<string, unknown>;

  if (!Array.isArray(raw.zones) || raw.zones.length === 0) {
    throw new YardianConfigError(
      "Configuration must include a non-empty 'zones' list of { entity, name }.",
    );
  }

  const zones: YardianZoneConfig[] = raw.zones.map((zoneRaw, index) => {
    if (!zoneRaw || typeof zoneRaw !== "object" || typeof (zoneRaw as Record<string, unknown>).entity !== "string") {
      throw new YardianConfigError(`zones[${index}] must be an object with a string 'entity'.`);
    }
    const zone = zoneRaw as Record<string, unknown>;
    return {
      entity: zone.entity as string,
      name: typeof zone.name === "string" ? zone.name : undefined,
      unused: zone.unused === true,
      image: typeof zone.image === "string" ? zone.image : undefined,
    };
  });

  let controller: YardianControllerConfig | undefined;
  if (raw.controller && typeof raw.controller === "object") {
    const c = raw.controller as Record<string, unknown>;
    controller = {
      rain_delay_entity: typeof c.rain_delay_entity === "string" ? c.rain_delay_entity : undefined,
      active_zones_entity: typeof c.active_zones_entity === "string" ? c.active_zones_entity : undefined,
      watering_running_entity: typeof c.watering_running_entity === "string" ? c.watering_running_entity : undefined,
      freeze_prevent_entity: typeof c.freeze_prevent_entity === "string" ? c.freeze_prevent_entity : undefined,
      standby_entity: typeof c.standby_entity === "string" ? c.standby_entity : undefined,
      stop_irrigation_entity: typeof c.stop_irrigation_entity === "string" ? c.stop_irrigation_entity : undefined,
    };
  }

  return {
    type: typeof raw.type === "string" ? raw.type : "custom:yardian-card",
    title: typeof raw.title === "string" ? raw.title : "Yardian",
    zones,
    controller,
  };
}
