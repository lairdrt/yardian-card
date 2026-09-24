import { CARD_STYLES } from "./styles";
import { normalizeConfig, type YardianCardConfig, type YardianZoneConfig } from "./config";
import type { HomeAssistant, LovelaceCard } from "./types";
import {
  canRunZone,
  DEFAULT_ZONE_RUN_DURATION_MINUTES,
  entityStateClass,
  escapeHtml,
  formatBinaryState,
  formatObservedRunDuration,
  formatObservedTimestamp,
  formatRainDelay,
  formatZoneState,
  getEntity,
  isStopButtonAvailable,
  isZoneOn,
  parseNumericState,
  QUICK_DURATIONS_MINUTES,
  resolveControllerDevice,
  zoneIcon,
  ZONE_RUN_DURATIONS_MINUTES,
} from "./helpers";
import {
  fetchObservedZoneRuns,
  latestObservedRun,
  type ObservedRunsByZone,
  type ObservedZoneRun,
} from "./history";

/**
 * Visible build identifier so it is obvious in the rendered card which
 * build Home Assistant actually loaded. See CLAUDE.md "Build and Version
 * Identification". The single authoritative value is computed once by
 * vite.config.ts and injected here verbatim -- it is the same string
 * written to dist/build-info.json for deploy.ps1 to report.
 */
export const BUILD_ID = __YARDIAN_BUILD_TAG__;

/**
 * How often, while the dashboard is actually visible, the card asks Home
 * Assistant to refresh the Yardian coordinator (see
 * YardianCard._requestCoordinatorRefresh). Deliberately independent of
 * the integration's own 30s poll interval, which is not modified.
 */
const REFRESH_INTERVAL_MS = 10_000;

/**
 * Elements whose clicks must never be escalated into a More Info popup
 * (see YardianCard._handleClick). Run/Stop already carry `data-action`
 * and are handled before this guard is reached; the rest are listed so
 * any control added later is excluded by default rather than by luck.
 */
const INTERACTIVE_SELECTOR = "button, select, option, input, textarea, a, [data-action]";

/**
 * How long a card-issued start command may sit unconfirmed before it is
 * discarded. If the zone hasn't gone "on" within this window, this card
 * cannot claim it started anything -- and keeping the record would risk
 * mislabelling a later, externally-started run as "Started here".
 */
const STARTED_HERE_CONFIRM_WINDOW_MS = 90_000;

/** Never issue two history fetches closer together than this. */
const HISTORY_MIN_REFETCH_MS = 30_000;

/** Age past which cached history is refetched on becoming visible. */
const HISTORY_STALE_MS = 5 * 60_000;

/** How many observed runs the zone detail panel's activity list shows. */
const RECENT_ACTIVITY_LIMIT = 4;

/**
 * A start command this card instance issued and is still tracking. Kept
 * in memory only -- never localStorage, never an HA helper -- so a
 * reload deliberately forgets all attribution.
 */
interface StartedHereRecord {
  issuedAt: number;
  /** Set once the zone was actually observed "on" after our command. */
  confirmed: boolean;
}

/**
 * A controller-row tile, already fully resolved by _buildChips. Chips
 * carry their final CSS state class and display text rather than an
 * entity, because not every chip maps to a single entity: Watering and
 * Active Zones combine a controller entity with the configured zone
 * switches.
 */
interface ChipSpec {
  label: string;
  icon: string;
  stateClass: string;
  valueText: string;
  /**
   * Entity whose More Info dialog this tile opens, when it has one. For
   * Watering and Active Zones this is deliberately the OFFICIAL
   * configured controller entity even though the tile displays a
   * combined/derived value. Undefined leaves the tile non-clickable.
   */
  moreInfoEntityId?: string;
}

/** Resolved watering state -- see YardianCard._resolveWateringState. */
interface WateringState {
  /** Configured zones currently reporting "on", in config order. */
  runningZones: YardianZoneConfig[];
  runningZoneCount: number;
  /** The official controller watering signal (scheduled/program runs). */
  officialWatering: boolean;
  /** Either source indicates irrigation is running. */
  isWatering: boolean;
}

export class YardianCard extends HTMLElement implements LovelaceCard {
  private _config?: YardianCardConfig;
  private _hass?: HomeAssistant;
  private _configError?: string;
  /**
   * In-memory only, per zone entity id. Deliberately not persisted --
   * lost on reload, as specified -- but kept across re-renders within a
   * session so an unrelated hass update doesn't silently reset a user's
   * in-progress duration choice back to the default.
   */
  private _selectedDurations = new Map<string, number>();
  /**
   * Handle for the visible-only refresh interval. `undefined` means no
   * interval is running; _startRefreshCycle/_stopRefreshCycle are the
   * only things that may write it, which is what guarantees at most one
   * interval per card instance.
   */
  private _refreshTimerId?: ReturnType<typeof setInterval>;
  /**
   * Stable bound reference so removeEventListener in
   * disconnectedCallback actually detaches the same listener
   * addEventListener attached (and so repeat adds are no-ops).
   */
  private readonly _handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      this._startRefreshCycle();
      this._maybeFetchHistory("visible");
    } else {
      this._stopRefreshCycle();
    }
  };
  /** Escape closes the zone detail panel; ignored when nothing is open. */
  private readonly _handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this._detailZoneEntityId === undefined) return;
    this._closeZoneDetail();
  };

  /**
   * Start commands this card instance issued, keyed by zone entity id.
   * Only ever used to render "Started here" -- see _reconcileStartedHere
   * for the rules that keep it from outliving its own certainty.
   */
  private _startedHere = new Map<string, StartedHereRecord>();
  /** Last observed state per configured zone, for transition detection. */
  private _lastZoneStates = new Map<string, string | undefined>();

  /** Observed-run cache. Undefined means "not fetched yet". */
  private _observedRuns?: ObservedRunsByZone;
  private _historyFetchedAt?: number;
  private _historyFetchInFlight = false;
  /** Set when history is unavailable, so the UI omits it rather than guessing. */
  private _historyUnavailable = false;

  /** Entity whose custom detail panel is open, if any. */
  private _detailZoneEntityId?: string;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    // Delegated once on the shadow root: click/change bubble, so these
    // keep working across every full-innerHTML re-render without needing
    // to be re-attached per element.
    root.addEventListener("click", (event) => this._handleClick(event));
    root.addEventListener("change", (event) => this._handleChange(event));
  }

  setConfig(config: unknown): void {
    try {
      this._config = normalizeConfig(config);
      this._configError = undefined;
    } catch (err) {
      this._config = undefined;
      this._configError = err instanceof Error ? err.message : "Invalid configuration.";
    }
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    // State-change bookkeeping happens here, where new state actually
    // arrives -- not in _render(), which stays purely presentational.
    this._onHassUpdated();
    this._render();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  connectedCallback(): void {
    this._render();

    document.addEventListener("visibilitychange", this._handleVisibilityChange);
    document.addEventListener("keydown", this._handleKeyDown);
    if (document.visibilityState === "visible") {
      this._startRefreshCycle();
      this._maybeFetchHistory("connected");
    }
  }

  disconnectedCallback(): void {
    document.removeEventListener("visibilitychange", this._handleVisibilityChange);
    document.removeEventListener("keydown", this._handleKeyDown);
    this._stopRefreshCycle();

    // Attribution is intentionally not durable: once this instance goes
    // away it can no longer vouch for who started anything.
    this._startedHere.clear();
    this._detailZoneEntityId = undefined;
  }

  /**
   * Runs on every incoming hass update. Pure local bookkeeping -- it
   * issues no service calls, and the only I/O it can trigger is an
   * event-driven history refetch when a configured zone actually
   * changed state (never on a timer, never per render).
   */
  private _onHassUpdated(): void {
    const config = this._config;
    const hass = this._hass;
    if (!config || !hass) return;

    let zoneTransitioned = false;
    for (const zone of config.zones) {
      const state = getEntity(hass, zone.entity)?.state;
      if (this._lastZoneStates.get(zone.entity) !== state) {
        this._lastZoneStates.set(zone.entity, state);
        zoneTransitioned = true;
      }
    }

    this._reconcileStartedHere(config, hass);

    if (zoneTransitioned) {
      this._maybeFetchHistory("zone-transition");
    }
  }

  /**
   * Keeps "Started here" attribution honest. A record is only shown once
   * the zone was actually observed on after our command, and is dropped
   * the moment it stops being unambiguous:
   *
   *  - zone back off      -> that run is over, forget it;
   *  - never went on in
   *    STARTED_HERE_CONFIRM_WINDOW_MS -> our command produced no visible
   *    run, so a later externally-started run must not inherit credit;
   *  - zone no longer configured -> nothing to attribute.
   */
  private _reconcileStartedHere(config: YardianCardConfig, hass: HomeAssistant): void {
    const now = Date.now();
    const configuredEntityIds = new Set(config.zones.map((zone) => zone.entity));

    for (const [entityId, record] of this._startedHere) {
      if (!configuredEntityIds.has(entityId)) {
        this._startedHere.delete(entityId);
        continue;
      }

      const isOn = getEntity(hass, entityId)?.state === "on";

      if (isOn) {
        record.confirmed = true;
        continue;
      }

      // Off: either the confirmed run finished, or our command never
      // visibly took effect within the window. Both end attribution.
      if (record.confirmed || now - record.issuedAt > STARTED_HERE_CONFIRM_WINDOW_MS) {
        this._startedHere.delete(entityId);
      }
    }
  }

  /** True only when this instance can still prove it started this run. */
  private _wasStartedHere(entityId: string, hass: HomeAssistant | undefined): boolean {
    const record = this._startedHere.get(entityId);
    return !!record && record.confirmed && getEntity(hass, entityId)?.state === "on";
  }

  /**
   * Starts (or restarts) the visible-only refresh cycle: one immediate
   * refresh, then one every REFRESH_INTERVAL_MS. Always stops any
   * existing interval first, so a second connectedCallback or
   * visibilitychange can never leave two intervals running.
   */
  private _startRefreshCycle(): void {
    this._stopRefreshCycle();

    this._requestCoordinatorRefresh();
    this._refreshTimerId = setInterval(() => this._requestCoordinatorRefresh(), REFRESH_INTERVAL_MS);
  }

  private _stopRefreshCycle(): void {
    if (this._refreshTimerId === undefined) return;

    clearInterval(this._refreshTimerId);
    this._refreshTimerId = undefined;
  }

  /**
   * Asks Home Assistant to refresh the Yardian coordinator, using the
   * already-configured active-zones entity as the target. This only
   * re-polls the integration; it changes no device state and issues no
   * irrigation command.
   *
   * Never called from _render() or the hass setter -- only from the
   * lifecycle/visibility path and the interval tick -- so a refresh can
   * never feed back into another refresh.
   */
  private _requestCoordinatorRefresh(): void {
    const refreshEntityId = this._config?.controller?.active_zones_entity;
    // hass/config may not be set yet on the first connect, and the
    // entity is optional in config. Skip quietly; the next tick retries.
    if (!this._hass || !refreshEntityId) return;

    void this._hass
      .callService("homeassistant", "update_entity", {}, { entity_id: refreshEntityId })
      .catch(() => {
        // Best-effort refresh: a failure just means this tick's data is
        // as stale as it would have been without the call. Swallowed
        // rather than logged so a persistently failing entity can't
        // spam the console every 10 seconds.
      });
  }

  /**
   * Event-driven history refresh. Deliberately NOT wired to _render() or
   * to the 10-second coordinator refresh tick: it runs on connect, on
   * becoming visible (only if the cache is stale), and when a configured
   * zone actually changed state. A min-interval guard plus an in-flight
   * flag stop bursts and concurrent duplicate fetches.
   */
  private _maybeFetchHistory(reason: "connected" | "visible" | "zone-transition"): void {
    const config = this._config;
    const hass = this._hass;
    if (!config || !hass || !hass.callWS) return;
    if (this._historyFetchInFlight) return;

    const now = Date.now();
    const fetchedAt = this._historyFetchedAt;

    if (fetchedAt !== undefined) {
      if (now - fetchedAt < HISTORY_MIN_REFETCH_MS) return;
      if (reason === "visible" && now - fetchedAt < HISTORY_STALE_MS) return;
    }

    this._historyFetchInFlight = true;
    const zoneEntityIds = config.zones.map((zone) => zone.entity);

    void fetchObservedZoneRuns(hass, zoneEntityIds)
      .then((runs) => {
        this._observedRuns = runs;
        this._historyUnavailable = false;
        this._historyFetchedAt = Date.now();
        this._render();
      })
      .catch(() => {
        // History is an enhancement, never a requirement. On failure the
        // card simply omits history rather than showing a guess, and a
        // later trigger may retry. Swallowed so a recorder that is
        // disabled or restricted can't spam the console.
        this._historyUnavailable = true;
        this._historyFetchedAt = Date.now();
        this._render();
      })
      .finally(() => {
        this._historyFetchInFlight = false;
      });
  }

  /** Observed runs for one zone, or undefined when history isn't available. */
  private _zoneRuns(entityId: string): ObservedZoneRun[] | undefined {
    if (this._historyUnavailable) return undefined;
    return this._observedRuns?.get(entityId);
  }

  getCardSize(): number {
    const zoneCount = this._config?.zones.length ?? 5;
    const zoneUnits = Math.ceil(zoneCount * 1.1);
    const stopUnits = 1;
    const chipUnits = 2;
    const headerUnits = 1;
    return Math.max(3, zoneUnits + stopUnits + chipUnits + headerUnits);
  }

  private _render(): void {
    const root = this.shadowRoot;
    if (!root) return;

    if (this._configError) {
      root.innerHTML = `
        <style>${CARD_STYLES}</style>
        <ha-card>
          <div class="header">
            <span class="build" title="yardian-card build">${escapeHtml(BUILD_ID)}</span>
          </div>
          <div class="card-error">${escapeHtml(this._configError)}</div>
        </ha-card>
      `;
      return;
    }

    if (!this._config) {
      return;
    }

    const config = this._config;
    const hass = this._hass;

    // Resolved once and shared, so the Watering tile and the global Stop
    // bar can never disagree about whether irrigation is running.
    const watering = this._resolveWateringState(config, hass);
    const conditions = this._controllerConditions(config, hass);

    const zoneRows = config.zones.map((zone) => this._renderZoneRow(zone, hass)).join("");
    const stopHtml = this._renderStopControl(config, hass, watering);

    const deviceTileHtml = this._renderDeviceTile(config, hass);
    const chips = this._buildChips(config, hass, watering);
    const chipHtml = chips.map((chip) => this._renderChip(chip)).join("");

    root.innerHTML = `
      <style>${CARD_STYLES}</style>
      <ha-card>
        ${stopHtml}

        <div class="section-label">Zones</div>
        <div class="zone-list">
          ${zoneRows}
        </div>

        <div class="section">
          <div class="section-label">Controller</div>
          <div class="chip-grid">
            ${deviceTileHtml}
            ${chipHtml}
          </div>
        </div>

        <div class="header">
          <span class="build" title="yardian-card build">${escapeHtml(BUILD_ID)}</span>
        </div>
      </ha-card>
      ${this._renderZoneDetailPanel(config, hass, conditions)}
    `;

    this._attachImageFallbacks(root);
  }

  /**
   * Single source of truth for "is irrigation running, and which zones",
   * resolved once per render and shared by the Watering tile and the
   * global Stop bar so the two can't drift apart.
   *
   * Two sources, because neither alone covers both ways irrigation
   * starts: the official controller signal tracks scheduled/program runs
   * (and is the only signal when no configured zone maps to what's
   * running), while the configured zone switches flip immediately for
   * manual and app-started runs and are the only source of zone
   * identity. Only a literal "on" counts on either side -- "unknown",
   * "unavailable" and missing entities never mean watering.
   */
  private _resolveWateringState(config: YardianCardConfig, hass: HomeAssistant | undefined): WateringState {
    const runningZones = config.zones.filter((zone) => isZoneOn(getEntity(hass, zone.entity)));
    const officialWatering = getEntity(hass, config.controller?.watering_running_entity)?.state === "on";

    return {
      runningZones,
      runningZoneCount: runningZones.length,
      officialWatering,
      isWatering: officialWatering || runningZones.length > 0,
    };
  }

  /**
   * Display label for a configured zone. Shared by the zone tile and the
   * Watering tile so the same zone never shows two different names.
   * Never invents a name: the configured name wins, then HA's own
   * friendly name, and only then the raw entity id as a last resort.
   */
  private _zoneLabel(zone: YardianZoneConfig, hass: HomeAssistant | undefined): string {
    return zone.name ?? getEntity(hass, zone.entity)?.attributes.friendly_name ?? zone.entity;
  }

  /**
   * Off -> [duration] [Run] (calls yardian.start_irrigation on this zone).
   * On  -> [duration] [Stop] (calls button.press on the GLOBAL stop
   * entity -- there is no per-zone stop capability, so this is never
   * scoped to just this row, only labeled on it). Both buttons dispatch
   * through the same delegated click handler as before (`data-action`
   * "run-zone" / "stop-irrigation"), so `_handleRunZone` and
   * `_handleStopIrrigation` are unchanged.
   */
  private _renderZoneRow(zone: YardianZoneConfig, hass: HomeAssistant | undefined): string {
    const entity = getEntity(hass, zone.entity);
    const label = this._zoneLabel(zone, hass);
    const stateText = formatZoneState(entity);
    const stateClass = entityStateClass(entity);
    const unusedClass = zone.unused ? "zone-unused" : "";
    const isRunning = entity?.state === "on";
    const runnable = canRunZone(entity);
    const selectedDuration = this._selectedDurations.get(zone.entity) ?? DEFAULT_ZONE_RUN_DURATION_MINUTES;

    // Stop availability depends only on the global stop button entity's
    // own state -- never on Watering/Active Zones or any other controller
    // summary entity, which can legitimately lag a zone's own switch state.
    const stopEntityId = this._config?.controller?.stop_irrigation_entity;
    const stopAvailable = isStopButtonAvailable(hass, stopEntityId);

    const durationDisabled = isRunning || !runnable;

    const durationOptions = ZONE_RUN_DURATIONS_MINUTES.map((minutes) => {
      const selectedAttr = minutes === selectedDuration ? "selected" : "";
      return `<option value="${minutes}" ${selectedAttr}>${minutes} min</option>`;
    }).join("");

    const photoHtml = zone.image
      ? `
        <img class="zone-photo-img" src="${escapeHtml(zone.image)}" alt="" loading="lazy" />
        <div class="zone-photo-placeholder" style="display:none;">
          <ha-icon icon="mdi:image-off-outline"></ha-icon>
        </div>
      `
      : `
        <div class="zone-photo-placeholder">
          <ha-icon icon="mdi:image-outline"></ha-icon>
        </div>
      `;

    const actionButtonHtml = isRunning
      ? `
        <button
          type="button"
          class="zone-action-btn zone-stop-btn"
          data-action="stop-irrigation"
          data-stop-entity="${escapeHtml(stopEntityId ?? "")}"
          title="Stops all irrigation"
          aria-label="Stops all irrigation"
          ${stopAvailable ? "" : "disabled"}
        >
          <ha-icon icon="mdi:stop"></ha-icon>
          <span>Stop</span>
        </button>
      `
      : `
        <button
          type="button"
          class="zone-action-btn zone-run-btn"
          data-action="run-zone"
          data-zone-entity="${escapeHtml(zone.entity)}"
          ${runnable ? "" : "disabled"}
        >
          <ha-icon icon="mdi:play"></ha-icon>
          <span>Run</span>
        </button>
      `;

    // Only rendered when this instance can still prove it -- see
    // _reconcileStartedHere. Any other running zone gets no source text
    // at all rather than a guessed "Manual"/"Scheduled" label.
    const startedHereHtml = this._wasStartedHere(zone.entity, hass)
      ? `<span class="zone-source" title="This card issued the start command for this run">Started here</span>`
      : "";

    const lastActiveHtml = this._renderLastActive(zone.entity, entity?.state === "on");

    return `
      <div
        class="zone-row ${stateClass} ${unusedClass}"
        data-zone-detail="${escapeHtml(zone.entity)}"
        title="Show zone details"
      >
        <div class="zone-header">
          <ha-icon class="zone-icon" icon="${zoneIcon(entity)}"></ha-icon>
          <span class="zone-name">${escapeHtml(label)}</span>
        </div>
        <div class="zone-body">
          <div class="zone-photo">${photoHtml}</div>
          <div class="zone-panel">
            <div class="zone-status">
              <span class="zone-state">${escapeHtml(stateText)}${startedHereHtml}</span>
            </div>
            ${lastActiveHtml}
            <div class="zone-controls">
              <select
                class="zone-duration"
                data-role="zone-duration"
                data-zone-entity="${escapeHtml(zone.entity)}"
                ${durationDisabled ? "disabled" : ""}
              >
                ${durationOptions}
              </select>
              ${actionButtonHtml}
            </div>
            ${this._renderQuickDurations(zone.entity, selectedDuration, durationDisabled)}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Quick-duration shortcuts. These only change the pending duration;
   * Run remains the only thing that starts irrigation. Disabled in
   * lockstep with the dropdown so a running zone offers no stale choice.
   */
  private _renderQuickDurations(entityId: string, selectedDuration: number, disabled: boolean): string {
    const buttons = QUICK_DURATIONS_MINUTES.map((minutes) => {
      const activeClass = minutes === selectedDuration ? "is-selected" : "";
      return `
        <button
          type="button"
          class="zone-quick-btn ${activeClass}"
          data-action="set-duration"
          data-zone-entity="${escapeHtml(entityId)}"
          data-duration="${minutes}"
          title="Set run duration to ${minutes} minutes"
          aria-pressed="${minutes === selectedDuration ? "true" : "false"}"
          ${disabled ? "disabled" : ""}
        >${minutes}</button>
      `;
    }).join("");

    return `<div class="zone-quick-durations">${buttons}</div>`;
  }

  /**
   * "Last active" from recorded history only. Omitted entirely when
   * history is unavailable or the window holds no recorded run -- never
   * replaced with an estimate. Suppressed while the zone is on, where
   * the live state already says more than the last run would.
   */
  private _renderLastActive(entityId: string, isOn: boolean): string {
    if (isOn) return "";

    const run = latestObservedRun(this._zoneRuns(entityId));
    if (!run) return "";

    return `<div class="zone-last-active">Last active: ${escapeHtml(formatObservedTimestamp(run.startedAt))}</div>`;
  }

  /**
   * Controller conditions worth knowing before starting a run. Each line
   * is a direct reading of an official entity; nothing is inferred.
   */
  private _controllerConditions(config: YardianCardConfig, hass: HomeAssistant | undefined): string[] {
    const conditions: string[] = [];

    const rainDelayEntity = getEntity(hass, config.controller?.rain_delay_entity);
    const rainDelaySeconds = parseNumericState(rainDelayEntity);
    if (rainDelaySeconds !== undefined && rainDelaySeconds > 0) {
      conditions.push(`Rain delay active · ${formatRainDelay(rainDelayEntity)}`);
    }

    if (getEntity(hass, config.controller?.freeze_prevent_entity)?.state === "on") {
      conditions.push("Freeze prevention enabled");
    }

    if (getEntity(hass, config.controller?.standby_entity)?.state === "on") {
      conditions.push("Standby active");
    }

    return conditions;
  }

  /**
   * One observed run, worded as an observation. A duration is only ever
   * appended when the retrieved history contained a proven ON->OFF pair
   * (see history.ts: endedAt is left undefined otherwise).
   */
  private _formatObservedRunLine(run: ObservedZoneRun, hass: HomeAssistant | undefined): string {
    const zone = this._config?.zones.find((candidate) => candidate.entity === run.zoneEntityId);
    const label = zone ? this._zoneLabel(zone, hass) : run.zoneEntityId;

    const duration = run.endedAt === undefined ? undefined : formatObservedRunDuration(run.startedAt, run.endedAt);
    const when = formatObservedTimestamp(run.startedAt);

    return duration ? `${label} · active ${duration} · ${when}` : `${label} · active ${when}`;
  }

  /**
   * Card-local zone detail panel: the primary zone experience, with
   * Home Assistant's own More Info one click away rather than removed.
   * Shows only observed facts -- no schedule, no next run, no remaining
   * time, no manual/program classification.
   */
  private _renderZoneDetailPanel(
    config: YardianCardConfig,
    hass: HomeAssistant | undefined,
    conditions: readonly string[],
  ): string {
    const entityId = this._detailZoneEntityId;
    if (!entityId) return "";

    const zone = config.zones.find((candidate) => candidate.entity === entityId);
    if (!zone) return "";

    const entity = getEntity(hass, entityId);
    const label = this._zoneLabel(zone, hass);
    const stateText = formatZoneState(entity);
    const isOn = entity?.state === "on";

    const photoHtml = zone.image
      ? `<img class="zone-detail-photo" src="${escapeHtml(zone.image)}" alt="" />`
      : "";

    const startedHereHtml = this._wasStartedHere(entityId, hass)
      ? `<div class="zone-detail-source">Started here</div>`
      : "";

    const runs = this._zoneRuns(entityId);
    const latest = latestObservedRun(runs);
    const lastActiveHtml = latest
      ? `<div class="zone-detail-row"><span>Last active</span><span>${escapeHtml(
          formatObservedTimestamp(latest.startedAt),
        )}</span></div>`
      : "";

    const recentForZone = (runs ?? [])
      .slice(-RECENT_ACTIVITY_LIMIT)
      .reverse()
      .map((run) => `<li class="activity-item">${escapeHtml(this._formatObservedRunLine(run, hass))}</li>`)
      .join("");
    const recentHtml = recentForZone
      ? `
        <div class="zone-detail-section">
          <div class="section-label">Recent observed activity</div>
          <ul class="activity-strip">${recentForZone}</ul>
        </div>
      `
      : "";

    const conditionsHtml =
      conditions.length > 0
        ? `
          <div class="zone-detail-section">
            <div class="section-label">Controller conditions</div>
            <div class="zone-conditions">
              <ha-icon icon="mdi:information-outline"></ha-icon>
              <span>${escapeHtml(conditions.join(" · "))}</span>
            </div>
          </div>
        `
        : "";

    return `
      <div class="zone-detail-overlay" data-action="zone-detail-backdrop">
        <div class="zone-detail-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}">
          <div class="zone-detail-header">
            <div class="zone-detail-title">
              <ha-icon class="zone-icon" icon="${zoneIcon(entity)}"></ha-icon>
              <span>${escapeHtml(label)}</span>
            </div>
            <button
              type="button"
              class="zone-detail-close"
              data-action="close-zone-detail"
              title="Close"
              aria-label="Close"
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>

          ${photoHtml}

          <div class="zone-detail-row">
            <span>State</span>
            <span class="${isOn ? "state-on" : ""}">${escapeHtml(stateText)}</span>
          </div>
          ${startedHereHtml}
          ${lastActiveHtml}

          ${recentHtml}
          ${conditionsHtml}

          <button
            type="button"
            class="zone-detail-more-info"
            data-action="zone-more-info"
            data-zone-entity="${escapeHtml(entityId)}"
          >
            <ha-icon icon="mdi:open-in-new"></ha-icon>
            <span>Open Home Assistant More Info</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Global stop is only rendered when configured -- there is nothing
   * useful to bind a stop button to otherwise, and a permanently broken
   * button would be worse than no button. If configured but the button
   * entity itself is unavailable, the control is shown disabled instead
   * of hidden, so the user can see why. Button entities normally sit at
   * "unknown" until first pressed -- that's a normal ready state, not an
   * error, so only "unavailable"/missing disables it.
   *
   * It is also only rendered while something is actually watering (the
   * same shared state the Watering tile uses). Returning "" emits no
   * .stop-section at all, so its margins leave no gap behind when idle.
   */
  private _renderStopControl(
    config: YardianCardConfig,
    hass: HomeAssistant | undefined,
    watering: WateringState,
  ): string {
    const stopEntityId = config.controller?.stop_irrigation_entity;
    if (!stopEntityId) return "";
    if (!watering.isWatering) return "";

    const stopAvailable = isStopButtonAvailable(hass, stopEntityId);
    const hint = stopAvailable ? "Stops all zones, not just one" : "Unavailable -- stops all zones";

    return `
      <div class="stop-section">
        <button
          type="button"
          class="stop-button"
          data-action="stop-irrigation"
          data-stop-entity="${escapeHtml(stopEntityId)}"
          title="Stops all irrigation"
          aria-label="Stops all irrigation"
          ${stopAvailable ? "" : "disabled"}
        >
          <ha-icon icon="mdi:stop-circle"></ha-icon>
          <span class="stop-button-text">
            <span class="stop-button-label">Stop Irrigation</span>
            <span class="stop-button-hint">${escapeHtml(hint)}</span>
          </span>
        </button>
      </div>
    `;
  }

  /**
   * <img> "error" doesn't bubble, so unlike click/change it can't be
   * delegated once on the shadow root -- it has to be (re)attached after
   * every render, once per rendered image.
   */
  private _attachImageFallbacks(root: ShadowRoot): void {
    root.querySelectorAll<HTMLImageElement>(".zone-photo-img").forEach((img) => {
      img.addEventListener(
        "error",
        () => {
          img.style.display = "none";
          const placeholder = img.nextElementSibling as HTMLElement | null;
          if (placeholder) placeholder.style.display = "flex";
        },
        { once: true },
      );
    });
  }

  /**
   * One delegated click handler for the whole card. Order matters:
   * existing Run/Stop actions are resolved first and always win, then
   * any other interactive control is left alone, and only what's left
   * can open a More Info dialog. That ordering is what stops a Run/Stop
   * click bubbling up into the zone tile's More Info target.
   */
  private _handleClick(event: Event): void {
    const eventTarget = event.target as HTMLElement | null;
    if (!eventTarget) return;

    const actionTarget = eventTarget.closest<HTMLElement>("[data-action]");
    if (actionTarget) {
      const action = actionTarget.dataset.action;

      if (action === "run-zone") {
        this._handleRunZone(actionTarget);
      } else if (action === "stop-irrigation") {
        this._handleStopIrrigation(actionTarget);
      } else if (action === "set-duration") {
        this._handleSetDuration(actionTarget);
      } else if (action === "zone-more-info") {
        // Native HA dialog stays reachable, just no longer the primary
        // zone experience. Close ours first so theirs isn't behind it.
        const entityId = actionTarget.dataset.zoneEntity;
        this._closeZoneDetail();
        if (entityId) this._fireMoreInfo(entityId);
      } else if (action === "close-zone-detail") {
        this._closeZoneDetail();
      } else if (action === "zone-detail-backdrop") {
        // Only a click on the backdrop itself closes -- clicks on the
        // panel bubble through here too and must be ignored.
        if (eventTarget === actionTarget) this._closeZoneDetail();
      }
      return;
    }

    // Interactive controls keep their own behaviour -- clicking the
    // duration select (or any future control) must never escalate into
    // opening a panel or a More Info popup.
    if (eventTarget.closest(INTERACTIVE_SELECTOR)) return;

    const zoneDetailEntityId = eventTarget.closest<HTMLElement>("[data-zone-detail]")?.dataset.zoneDetail;
    if (zoneDetailEntityId) {
      this._openZoneDetail(zoneDetailEntityId);
      return;
    }

    const moreInfoEntityId = eventTarget.closest<HTMLElement>("[data-more-info-entity]")?.dataset
      .moreInfoEntity;
    if (moreInfoEntityId) {
      this._fireMoreInfo(moreInfoEntityId);
    }
  }

  /**
   * Quick-duration shortcut. Sets the same per-zone pending duration the
   * dropdown writes and nothing else -- it never starts irrigation.
   */
  private _handleSetDuration(target: HTMLElement): void {
    if ((target as HTMLButtonElement).disabled) return;

    const entityId = target.dataset.zoneEntity;
    const minutes = Number(target.dataset.duration);
    if (!entityId || !Number.isInteger(minutes) || minutes <= 0) return;

    this._selectedDurations.set(entityId, minutes);
    this._render();
  }

  private _openZoneDetail(entityId: string): void {
    this._detailZoneEntityId = entityId;
    this._render();
  }

  private _closeZoneDetail(): void {
    if (this._detailZoneEntityId === undefined) return;
    this._detailZoneEntityId = undefined;
    this._render();
  }

  /**
   * Opens Home Assistant's own entity dialog via the standard frontend
   * event. `composed: true` is required for it to escape this card's
   * shadow root and reach HA's dialog manager. No custom dialog, no
   * dependency.
   */
  private _fireMoreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.role !== "zone-duration") return;

    const entityId = target.dataset.zoneEntity;
    const minutes = Number(target.value);
    if (entityId && Number.isInteger(minutes) && minutes > 0) {
      this._selectedDurations.set(entityId, minutes);
    }
  }

  /**
   * The only place this card ever calls yardian.start_irrigation. Never
   * invoked on render, config, or state updates -- only from here, which
   * only runs on a direct user click. Re-checks live hass state (not
   * just the DOM's disabled attribute) before calling, so a stale render
   * can't issue a call the current state no longer allows.
   */
  private _handleRunZone(target: HTMLElement): void {
    if ((target as HTMLButtonElement).disabled) return;
    const entityId = target.dataset.zoneEntity;
    if (!entityId || !this._hass) return;

    const entity = getEntity(this._hass, entityId);
    if (!canRunZone(entity)) return;

    const duration = this._selectedDurations.get(entityId) ?? DEFAULT_ZONE_RUN_DURATION_MINUTES;

    void this._hass
      .callService("yardian", "start_irrigation", { duration }, { entity_id: entityId })
      .then(() => {
        // Recorded only once the command was actually accepted, and only
        // as a candidate: _reconcileStartedHere still has to see the zone
        // go on before anything is displayed.
        this._startedHere.set(entityId, { issuedAt: Date.now(), confirmed: false });
      })
      .catch(() => {
        // A rejected command proves nothing was started here.
        this._startedHere.delete(entityId);
      });
  }

  /**
   * The only place this card ever presses the global stop button. This
   * targets the configured global stop entity only -- it is never scoped
   * to a single zone. Re-checks live availability (same rule as the
   * render sites, via isStopButtonAvailable) rather than trusting only
   * the DOM's disabled attribute, matching how _handleRunZone re-checks
   * canRunZone.
   */
  private _handleStopIrrigation(target: HTMLElement): void {
    if ((target as HTMLButtonElement).disabled) return;
    const stopEntityId = target.dataset.stopEntity;
    if (!stopEntityId || !this._hass) return;
    if (!isStopButtonAvailable(this._hass, stopEntityId)) return;

    void this._hass.callService("button", "press", {}, { entity_id: stopEntityId });
  }

  /**
   * Device identity (name/model/manufacturer/serial number) comes only
   * from HA's own entity/device registries (hass.entities, hass.devices)
   * -- never from YAML, never hardcoded, never a direct Yardian/.storage
   * read. Tries every entity id already present in config (controller
   * fields first, then zone switches) as a way in to the device record,
   * since any of them may resolve depending on what HA actually exposes.
   *
   * Rendered as the first tile using the exact same `.chip` markup as
   * the Watering/Active Zones/etc. tiles (not a bespoke wider component),
   * so it's a peer in size, not a banner. Model + manufacturer collapse
   * onto the one value line a chip has room for; the fuller name/serial
   * number go in a `title` tooltip rather than being forced into the
   * visible tile.
   */
  private _renderDeviceTile(config: YardianCardConfig, hass: HomeAssistant | undefined): string {
    const candidateEntityIds = [
      config.controller?.rain_delay_entity,
      config.controller?.active_zones_entity,
      config.controller?.watering_running_entity,
      config.controller?.freeze_prevent_entity,
      config.controller?.standby_entity,
      config.controller?.stop_irrigation_entity,
      ...config.zones.map((zone) => zone.entity),
    ].filter((id): id is string => typeof id === "string");

    const device = resolveControllerDevice(hass, candidateEntityIds);
    const hasAnyField = !!device && (device.name || device.model || device.manufacturer || device.serialNumber);

    const valueParts: string[] = [];
    if (hasAnyField) {
      if (device!.model) valueParts.push(device!.model);
      if (device!.manufacturer) valueParts.push(device!.manufacturer);
    }
    const valueText = valueParts.length > 0 ? valueParts.join(" · ") : "Unavailable";

    const tooltipParts: string[] = [];
    if (hasAnyField && device!.name) tooltipParts.push(device!.name);
    if (hasAnyField && device!.serialNumber) tooltipParts.push(`SN ${device!.serialNumber}`);
    const titleAttr = tooltipParts.length > 0 ? ` title="${escapeHtml(tooltipParts.join(" — "))}"` : "";

    const stateClass = hasAnyField ? "" : "state-missing";

    return `
      <div class="chip ${stateClass}"${titleAttr}>
        <ha-icon class="chip-icon" icon="mdi:chip"></ha-icon>
        <div class="chip-text">
          <div class="chip-label">Model</div>
          <div class="chip-value">${escapeHtml(valueText)}</div>
        </div>
      </div>
    `;
  }

  private _buildChips(
    config: YardianCardConfig,
    hass: HomeAssistant | undefined,
    watering: WateringState,
  ): ChipSpec[] {
    /*
     * Watering and Active Zones combine two sources, because neither one
     * alone covers both ways irrigation can start:
     *
     *  - the official controller entities track scheduled/program runs,
     *    but the integration refreshes them on its own ~30s poll cycle,
     *    so they lag manually-started irrigation;
     *  - the configured zone switches flip immediately and reliably for
     *    manual runs, and are the only source of zone identity.
     *
     * Watering is an OR of the two (see _resolveWateringState); Active
     * Zones is the max of the two counts, never the sum, so a single
     * physical zone reported by both sources is not counted twice.
     *
     * Only zones listed in the card's own `zones:` config contribute to
     * the derived side; Yardian zones deliberately omitted from config
     * stay uncounted there (the official sensor may still report them).
     */
    const { runningZones, runningZoneCount, isWatering } = watering;

    // Zone identity when we have it. Official-only watering (a scheduled
    // run with no matching configured switch on) stays a bare "Running"
    // rather than guessing which zone it is.
    const runningZoneNames = runningZones.map((zone) => this._zoneLabel(zone, hass));
    const wateringValueText = !isWatering
      ? "Idle"
      : runningZoneNames.length > 0
        ? `Running · ${runningZoneNames.join(", ")}`
        : "Running";

    // Ids are also the More Info targets: even where a tile shows a
    // combined/derived value, its popup opens the official HA entity.
    const wateringId = config.controller?.watering_running_entity;
    const activeZonesId = config.controller?.active_zones_entity;

    const activeZonesEntity = getEntity(hass, activeZonesId);
    const parsedActiveZones = parseNumericState(activeZonesEntity);
    const officialActiveZones = parsedActiveZones !== undefined && parsedActiveZones >= 0 ? parsedActiveZones : 0;
    const displayedActiveZones = Math.max(runningZoneCount, officialActiveZones);

    const rainDelayId = config.controller?.rain_delay_entity;
    const rainDelayEntity = getEntity(hass, rainDelayId);

    const freezeId = config.controller?.freeze_prevent_entity;
    const freezeEntity = getEntity(hass, freezeId);

    const standbyId = config.controller?.standby_entity;
    const standbyEntity = getEntity(hass, standbyId);

    return [
      {
        label: "Watering",
        icon: "mdi:water",
        stateClass: isWatering ? "state-on" : "state-off",
        valueText: wateringValueText,
        moreInfoEntityId: wateringId,
      },
      {
        label: "Active Zones",
        icon: "mdi:counter",
        stateClass: displayedActiveZones > 0 ? "state-on" : "state-off",
        valueText: `${displayedActiveZones} ${displayedActiveZones === 1 ? "zone" : "zones"}`,
        moreInfoEntityId: activeZonesId,
      },
      {
        label: "Rain Delay",
        icon: "mdi:weather-rainy",
        stateClass: rainDelayId ? entityStateClass(rainDelayEntity) : "state-missing",
        valueText: rainDelayId ? formatRainDelay(rainDelayEntity) : "Not configured",
        moreInfoEntityId: rainDelayId,
      },
      {
        label: "Freeze Prevention",
        icon: "mdi:snowflake",
        stateClass: freezeId ? entityStateClass(freezeEntity) : "state-missing",
        valueText: freezeId ? formatBinaryState(freezeEntity, "Enabled", "Disabled") : "Not configured",
        moreInfoEntityId: freezeId,
      },
      {
        label: "Standby",
        icon: "mdi:pause-circle-outline",
        stateClass: standbyId ? entityStateClass(standbyEntity) : "state-missing",
        valueText: standbyId ? formatBinaryState(standbyEntity, "Standby", "Ready") : "Not configured",
        moreInfoEntityId: standbyId,
      },
    ];
  }

  private _renderChip(chip: ChipSpec): string {
    // A chip with no entity (or an unconfigured one) stays non-clickable.
    const moreInfoAttrs = chip.moreInfoEntityId
      ? ` data-more-info-entity="${escapeHtml(chip.moreInfoEntityId)}" title="Show more info"`
      : "";

    return `
      <div class="chip ${chip.stateClass}"${moreInfoAttrs}>
        <ha-icon class="chip-icon" icon="${chip.icon}"></ha-icon>
        <div class="chip-text">
          <div class="chip-label">${escapeHtml(chip.label)}</div>
          <div class="chip-value">${escapeHtml(chip.valueText)}</div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "yardian-card",
  name: "Yardian",
  description: "Status and manual timed-run control card for a Yardian Pro irrigation controller.",
});

customElements.define("yardian-card", YardianCard);
