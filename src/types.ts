/**
 * Minimal Home Assistant frontend types.
 *
 * Only the shape this card actually reads is declared here; the real
 * `hass` object carries far more than this.
 */

export interface HassEntityAttributes {
  friendly_name?: string;
  unit_of_measurement?: string;
  [key: string]: unknown;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: HassEntityAttributes;
}

export interface HassServiceTarget {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
}

/** The lightweight entity-registry view HA exposes on `hass.entities` (not full hass.states). */
export interface HassEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  [key: string]: unknown;
}

/** The device-registry entry HA exposes on `hass.devices`, keyed by device id. */
export interface HassDeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  model: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  [key: string]: unknown;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  /**
   * Registry data HA's own frontend attaches to `hass` (not every host of
   * this card is guaranteed to populate it, e.g. older HA versions or
   * certain preview contexts) -- always optional, never assumed present.
   */
  entities?: Record<string, HassEntityRegistryEntry>;
  devices?: Record<string, HassDeviceRegistryEntry>;
  /**
   * Home Assistant's websocket call helper. Used read-only, for recorder
   * history (`history/history_during_period`). Optional because not every
   * host of this card is guaranteed to expose it; callers must degrade to
   * "no history" rather than assume it exists.
   */
  callWS?: <T>(message: Record<string, unknown>) => Promise<T>;
  /** Calls a Home Assistant service/action -- the only way this card ever affects real state. */
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: HassServiceTarget,
  ): Promise<unknown>;
}

/** Element interface expected by Home Assistant's Lovelace card contract. */
export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: unknown): void;
  getCardSize?: () => number | Promise<number>;
}

export interface LovelaceCardConstructor {
  new (): LovelaceCard;
  getConfigElement?: () => HTMLElement;
  getStubConfig?: () => Record<string, unknown>;
}
