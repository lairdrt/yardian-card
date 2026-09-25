# Yardian Card Architecture

This is the contributor design document for `yardian-card`. It describes how
the card is built, what it depends on in Home Assistant and the Yardian
integration, and why the important decisions were made. User-facing
installation, configuration, and operation are in the [README](../README.md).

Statements here fall into three kinds, labeled where it matters:

- **Upstream (verified):** behavior of the Home Assistant Yardian integration,
  pyYardian, or HA core, checked against HA 2026.9.3 source and
  `pyyardian` 1.4.2.
- **Repository:** behavior of this card's current source.
- **Design choice:** a decision this project made, with its rationale.

## Contents

- [Design goals](#design-goals)
- [System overview](#system-overview)
- [Yardian integration capability boundary](#yardian-integration-capability-boundary)
- [Home Assistant contract](#home-assistant-contract)
- [Repository structure](#repository-structure)
- [State model](#state-model)
- [Coordinator refresh strategy](#coordinator-refresh-strategy)
- [Irrigation command model](#irrigation-command-model)
- [Accuracy and provenance invariant](#accuracy-and-provenance-invariant)
- [History](#history)
- [UI architecture](#ui-architecture)
- [Theme architecture](#theme-architecture)
- [Loader, cache, and build architecture](#loader-cache-and-build-architecture)
- [Lifecycle](#lifecycle)
- [Security and trust boundaries](#security-and-trust-boundaries)
- [Direct Yardian API decision](#direct-yardian-api-decision)
- [Development and deployment workflow](#development-and-deployment-workflow)
- [Extension guidelines](#extension-guidelines)
- [Known limitations and current boundaries](#known-limitations-and-current-boundaries)

## Design goals

- **HA-mediated control.** Home Assistant is the only path to the controller:
  state from entities, commands through actions, history from Recorder.
- **No browser-direct controller API.** The card holds no controller address
  or credentials and opens no connection to the controller.
- **Accurate state.** The card shows what Home Assistant reports and nothing it
  can't back up. Displayed facts have a clear source.
- **Safe command semantics.** Irrigation moves water through physical valves.
  Commands are explicit, user-initiated, re-checked against live state, and
  never retried or issued implicitly.
- **Responsive UI.** The card compensates for the integration's polling and
  notification behavior without inventing state.
- **Theme-native styling.** Colors come from Home Assistant theme variables.
- **Minimal dependencies.** TypeScript and Vite at build time; nothing at
  runtime beyond what the HA frontend provides (`ha-card`, `ha-icon`).
- **Incremental maintainability.** Small modules, explicit types, no
  framework, one render path.

## System overview

```text
Yardian Pro controller
        │  local HTTP, polled (pyYardian)
        ▼
Home Assistant Yardian integration
        │  YardianUpdateCoordinator (one per config entry, 30 s)
        ├── entities: zone switches, binary sensors, sensors, stop button
        ├── action:   yardian.start_irrigation
        ├── device registry: name, model, manufacturer, serial
        └── Recorder: entity state history
        │
        ▼
yardian-card (custom element in the HA frontend)
        ├── reads    hass.states, hass.entities, hass.devices
        ├── commands hass.callService(...)
        ├── history  hass.callWS(history/history_during_period)
        └── dialogs  hass-more-info event → native More Info
        │
        ▼
Lovelace dashboard in the browser
```

The card is a view and command surface. It owns presentation, pending
duration selection, the refresh cadence, history caching, and short-lived
attribution. It owns no controller state.

## Yardian integration capability boundary

```text
Yardian controller
    ↓  pyYardian
HA Yardian integration
    ↓  exposed entities / actions / device info / Recorder
yardian-card
```

The card can only consume what crosses this boundary. Anything the
integration does not expose is out of reach by design (see
[Direct Yardian API decision](#direct-yardian-api-decision)).

### What the integration exposes (upstream, verified)

The coordinator holds three things per poll: the zone list (name,
enabled flag), the set of `active_zones` (zone indexes currently running), and
the controller's `oper_info` dictionary.

| Integration surface | Derived from | Used by the card |
| --- | --- | --- |
| `switch` per zone | `is_on` = zone index in `active_zones`; `available` = zone enabled on controller | Zone state, Run target, history, More Info |
| `yardian.start_irrigation` ("Start zone"; `duration`: positive int, 1–1440 minutes) | Entity action on zone switches → `async_turn_on` | Run |
| `switch.turn_off` | pyYardian `stop_zone` | Not used (see [command model](#irrigation-command-model)) |
| `button` "Stop irrigation" | pyYardian `stop_irrigation` | Tile Stop and global Stop bar |
| `binary_sensor` "Water running" | `bool(active_zones)` | Watering tile, Stop bar |
| `sensor` "Active zones" | `len(active_zones)` | Active Zones tile, refresh target |
| `sensor` "Rain delay" (s) | `oper_info.iRainDelay` | Rain Delay tile, detail conditions |
| `binary_sensor` "Standby" | `oper_info.iStandby` later than now | Standby tile, detail conditions |
| `binary_sensor` "Freeze prevent enabled" (disabled by default) | `oper_info.fFreezePrevent` | Freeze Prevention tile, detail conditions |
| `sensor` Zone delay, Water hammer duration (disabled by default) | `oper_info` | Not used |
| `binary_sensor` Zone enabled, per zone (disabled by default) | Zone enabled flag | Not used (reflected as switch availability) |
| Device registry entry | Config entry: name, model, serial; manufacturer "Aeon Matrix" | Model tile |
| Recorder history of **enabled** entities above (disabled-by-default entities have no state or history until enabled) | HA core | Last active, recent activity (zone switches only, enabled by default) |

### What the integration does not expose (upstream, verified)

Checked against the integration's entity platforms, `services.yaml`, and the
coordinator data model, and against pyYardian 1.4.2's client API:

| Not exposed | Architectural consequence |
| --- | --- |
| Program definitions and schedules; program/schedule create, edit, delete | The card cannot show or edit Yardian programs or schedules, and does not invent a "next watering" field. pyYardian 1.4.2 itself has no method to read or edit programs or schedules. |
| Next scheduled execution | No next-run display. |
| Run source or origin (schedule, program, app, HA) | Arbitrary watering cannot be classified safely; unknown provenance stays unlabeled. `watering_running` is only `bool(active_zones)` and carries no program identity. |
| Remaining run time or end time | No countdown is synthesized. `active_zones` is a set of indexes with no timing. |
| Actions to change rain delay, standby, or freeze prevention | These are display-only in the card. |
| Isolated per-zone stop on Yardian Pro | pyYardian's `stop_zone` calls the global `stop_irrigation` for Pro (non-"YC") controllers. The card presents Stop as global. |

These are upstream capability boundaries, not unfinished card features. If a
future integration exposes program data, for example, the card can consume it
through HA without changing its architecture.

### Classification of boundaries

| Kind | Examples |
| --- | --- |
| **Upstream integration limitation** | No programs/schedules, run source, remaining time, or settings actions; global stop on Pro; 30 s polling; optimistic-update notification gap (see [State model](#state-model)). |
| **Card design choice** | No direct controller API; no inferred facts; command-only zone control; global Stop presentation; no automatic retry; fixed duration list; ephemeral attribution; fixed 7-day history window. |
| **Current implementation omission** | Exposed but unused: zone delay, water-hammer duration, zone-enabled sensors, per-zone `switch.turn_off` on YC controllers. Also: `title` not rendered, no visual config editor. |

## Home Assistant contract

### Stable contracts

These are documented Home Assistant entity, action, and card interfaces.

| Contract | Use |
| --- | --- |
| Lovelace custom card: `setConfig()`, `hass` setter, `getCardSize()`, `customElements.define` | Card registration and configuration |
| `window.customCards` entry `{ type: "yardian-card", name: "Yardian" }` | Card picker listing |
| `hass.states[entity_id]` | All live state |
| `hass.callService("yardian", "start_irrigation", { duration }, { entity_id })` | Run |
| `hass.callService("button", "press", {}, { entity_id })` | Stop |
| `hass.callService("homeassistant", "update_entity", {}, { entity_id })` | Coordinator refresh |
| Configured entity IDs only | No entity ID is hard-coded or pattern-matched |

### Frontend conventions (compatibility-sensitive)

These are how HA's own frontend works. They are relied on but not documented
as stable public APIs.

| Mechanism | Use | Degradation if absent |
| --- | --- | --- |
| `hass-more-info` `CustomEvent` (`bubbles`, `composed`, `detail.entityId`) | Opens native More Info | Clicking does nothing |
| `hass.entities` and `hass.devices` registry snapshots | Model tile device lookup | Model tile shows `Unavailable` |
| `hass.callWS` with `history/history_during_period` | Recorder history | History omitted |
| `<ha-card>`, `<ha-icon>` | Card chrome and icons | Provided by HA frontend at runtime |

## Repository structure

| Path | Responsibility |
| --- | --- |
| `src/yardian-card.ts` | `YardianCard` element: lifecycle, render, delegated events, Run/Stop handlers, `_resolveWateringState()`, `_buildChips()`, device tile, detail panel, refresh loop, history triggers, "Started here" reconciliation. Also the `YARDIAN_BUILD` placeholder. |
| `src/config.ts` | Config types and `normalizeConfig()`: validates required structure, coerces optional fields, applies defaults. |
| `src/types.ts` | Minimal HA frontend types (`HomeAssistant`, `HassEntity`, registry entries, `LovelaceCard`). Only what the card reads. |
| `src/helpers.ts` | Pure functions: HTML escaping, entity lookup, state classes and wording, `canRunZone`, `isStopButtonAvailable`, duration constants, time and rain-delay formatting, `resolveControllerDevice`. |
| `src/history.ts` | `fetchObservedZoneRuns()` (WebSocket history) and `parseObservedRuns()` (ON-run extraction). |
| `src/styles.ts` | `CARD_STYLES`: all CSS and the `--yardian-*` variable layer. |
| `loader.js` | Stable Lovelace resource; dynamic import with `?ts=`. |
| `deploy.ps1` | Windows build, deploy, build-ID injection, and verification. |
| `vite.config.ts` | Vite library build: `src/yardian-card.ts` → `dist/yardian-card.js` (ES module, unminified, source map). |
| `examples/` | `lovelace.yaml` (card config), `theme.yaml` (theme variable fragment). |
| `docs/` | This document and `theming.md`. |

`dist/` and `node_modules/` are generated and not part of the architecture.

## State model

### Upstream behavior that shapes the design

The facts below are verified in HA 2026.9.3's Yardian integration and
`homeassistant/helpers/update_coordinator.py`.

1. Zone switches, "Water running", and "Active zones" are all computed
   from the same coordinator field, `active_zones`.
2. `YardianSwitch.async_turn_on`, which is what `yardian.start_irrigation`
   runs, first mutates the shared coordinator data in place
   (`coordinator.data.active_zones.add(zone)`) and writes **only the switch's**
   state. It then sends the command, waits 2 seconds, and requests a
   coordinator refresh.
3. The coordinator uses `always_update=False`. After a refresh it notifies
   listeners only if `previous_data != self.data`.
4. Because the previous data was already mutated to include the zone, a
   refresh confirming the run returns equal data and **no listener is
   notified**. The "Water running" and "Active zones" entities are not
   re-written, and keep their pre-run state until the coordinator data next
   genuinely changes, typically when the run ends.

So after a run started through Home Assistant, the zone switch says `on`
while the controller-level entities can still say idle and `0`. Runs started
elsewhere (app, schedule) don't have this gap: they arrive through a normal
poll, and all entities update together.

### Combined state (design choice)

`_resolveWateringState()` computes one shared result per render, used by the
Watering tile, the Stop bar, and the Active Zones tile:

```text
Watering    = official watering_running == "on"
              OR any configured zone switch == "on"

Active Zones = max(official active-zone count,
                   number of configured zone switches "on")
```

- **OR for Watering** tolerates the stale controller-level entity after a
  card-started run, and still reports watering the official entity sees on
  zones not configured in the card.
- **max, not sum, for Active Zones:** both sources count the same physical
  zones, so a sum would double-count. `max` takes whichever is more current.
  It keeps official information, including zones outside the card's config,
  and covers the stale case.
- **Zone names only from switches:** the Watering tile names zones only when
  configured switches identify them (`Running · Front Drip`). Official-only
  watering shows a bare `Running`.
- Only a literal `on` counts. `unknown`, `unavailable`, missing entities, and
  a non-numeric or negative official count contribute nothing.

## Coordinator refresh strategy

### Upstream mechanics (verified)

- The integration uses one `DataUpdateCoordinator` per config entry, with a
  30-second `update_interval`. All Yardian entities are `CoordinatorEntity`
  subclasses sharing it.
- `homeassistant.update_entity` on a `CoordinatorEntity` calls
  `coordinator.async_request_refresh()`, so refreshing any one enabled
  Yardian entity refreshes the shared coordinator. Disabled entities ignore
  the request.
- `async_request_refresh` goes through a debouncer (default 10-second
  cooldown, immediate first call), so closely spaced requests may be merged.
- A refresh cancels the pending scheduled poll and reschedules it afterwards,
  so a forced refresh resets the 30-second poll clock.

### Card behavior (repository)

- The target is the configured `active_zones_entity`, which is enabled by
  default upstream. Without it, the card issues no refresh.
- `connectedCallback`: if the document is visible, the card refreshes
  immediately and starts one 10-second `setInterval`.
- `visibilitychange` to hidden stops the interval. Back to visible, it
  refreshes immediately and restarts the interval.
- `_startRefreshCycle()` always clears any existing interval first, so there
  is at most one interval per card instance.
- `disconnectedCallback` stops the interval and removes the listeners.
- Refresh errors are swallowed; a failed tick just means that tick's data is
  no fresher.
- No refresh is issued from `_render()` or the `hass` setter. A refresh
  produces a `hass` update, which renders, so issuing refreshes there would
  create a feedback loop.

### Limitation

The refresh makes app- and schedule-originated changes visible within about
10 seconds instead of up to 30. It does **not** fix the optimistic-update
notification gap: a refresh returning equal data still notifies no one. The
combined state model handles that case.

## Irrigation command model

**Start (design choice over upstream action).** `_handleRunZone()` calls
`yardian.start_irrigation` targeting the zone's switch with
`{ duration: <integer minutes> }`. pyYardian converts that to seconds for the
controller. The call happens only from a user click and only if the live
entity is `off` (`canRunZone`). The DOM `disabled` state is re-checked but
not trusted alone.

**Stop.** `_handleStopIrrigation()` calls `button.press` on the configured
`stop_irrigation_entity`, after re-checking `isStopButtonAvailable` (present
and not `unavailable`; a button's normal `unknown` state counts as ready). The
same handler serves the per-tile Stop and the global Stop bar. Upstream, this
is pyYardian `stop_irrigation`, which stops all irrigation.

**Why command-oriented, not a switch toggle.** A Yardian zone "on" means "the
controller is running a timed task", not a latched output. Turning it on
requires a duration, and the controller ends the run itself. A toggle would
hide the duration and suggest the zone stays on until turned off. The card
therefore offers only "Run for N minutes" and a Stop labeled as global. It
does not use `switch.turn_off`: on Yardian Pro it is the same global stop
(pyYardian `stop_zone` → `stop_irrigation`), and presenting it as a per-zone
stop would be misleading.

**No automatic retry.** A retried start can double-water or start a zone the
user has since stopped; a retried stop can race a new start. With 30-second
polling the card cannot tell whether a failed-looking command took effect. It
issues each command once, and state converges through normal HA updates.

## Accuracy and provenance invariant

> **Do not present inferred controller intent as observed fact.**

Acceptable evidence sources, and nothing else:

1. **Current HA entity state** from the Yardian integration.
2. **HA Recorder history** of those entities.
3. **Narrow, ephemeral knowledge of an action issued by this card instance.**

Consequences in the current code:

- A run's origin is never labeled; there is no Program/App/Manual/Scheduled
  wording.
- No remaining-time countdown and no next-schedule display.
- History is never extrapolated beyond the retrieved window, and durations
  need a proven ON→OFF pair.
- "Watering: Running" without a matching configured zone shows no zone name.
- **"Started here"** (`_startedHere`, in memory, per instance):
  - recorded only after `start_irrigation` resolves successfully, as
    unconfirmed;
  - confirmed only when the zone is then observed `on`;
  - shown only while confirmed and the zone is `on`;
  - dropped when the zone goes off after confirmation, when it never came on
    within 90 seconds (so a later external run can't inherit credit), when the
    zone leaves the config, or on disconnect;
  - never persisted, so a reload forgets everything.
- Ambiguous or missing data is omitted, never filled in.

## History

`src/history.ts`, driven by `_maybeFetchHistory()` in the element.

**Query:**

```text
hass.callWS({
  type: "history/history_during_period",
  start_time: now - 7 days,  end_time: now,
  entity_ids: <configured zone switches>,
  minimal_response: true, no_attributes: true,
  significant_changes_only: false,
  include_start_time_state: false
})
```

`include_start_time_state: false` is deliberate. HA's synthetic entry at the
window start carries the window boundary as its timestamp, and treating that
as a transition time would present a boundary artifact as fact. As a result,
a zone already `on` at window start with no change inside the window has no
recorded start.

**Extraction (`parseObservedRuns`):** entries arrive in ascending order in
compressed form (`s` state, `lu` epoch seconds). A run is recorded at each
genuine transition into `on` (previous state not `on`). `endedAt` is set only
if the **immediately next** entry is `off`; if it is `unavailable`, `unknown`,
or absent, the run stays open rather than pairing with a later `off` from
another period.

**Derivations:**

- Last active = the `startedAt` of the latest run, hidden while the zone is
  `on`.
- Detail panel = up to four most recent runs for the zone, newest first, with
  a duration only when `endedAt` exists and rounds to a positive number of
  minutes.

**Cache and triggers:** results are held in memory per card instance. Fetches
are triggered by connect while visible; by becoming visible if the cache is
older than 5 minutes; and by any configured zone's state changing, including
the first `hass` assignment. A 30-second minimum interval and an in-flight
flag suppress bursts and concurrent fetches. History is not tied to the
10-second refresh tick or to render.

**Failure:** if `callWS` is absent, the result is empty. If the call rejects,
the card sets `_historyUnavailable`, hides history, and allows a later trigger
to retry. The Recorder database is never accessed directly. Retention (HA
default 10 days) and Recorder excludes bound what exists. History reflects
integration entity states as HA recorded them, with polling-granularity
timing. It contains no program, schedule, or source metadata, because none was
exposed.

## UI architecture

- **Element:** `YardianCard extends HTMLElement` with an open shadow root.
  There is no framework and no virtual DOM.
- **Render model:** `_render()` rebuilds the shadow root's `innerHTML` from
  config, `hass`, and instance state. It runs on `setConfig`, on each `hass`
  assignment, on connect, and after local UI changes. It has no side effects
  beyond the DOM and re-attaching image `error` listeners, which don't bubble
  and so can't be delegated. All interpolated text goes through `escapeHtml`.
- **Delegated events:** one `click` and one `change` listener on the shadow
  root, attached in the constructor, so they survive every re-render.
  - `click` first resolves `[data-action]`: `run-zone`, `stop-irrigation`,
    `set-duration`, `zone-more-info`, `close-zone-detail`, or
    `zone-detail-backdrop` (backdrop only when the click is on the backdrop
    itself).
  - Next, any element matching the interactive selector (`button`, `select`,
    `option`, `input`, `textarea`, `a`, `[data-action]`) is left alone.
  - Only then does `[data-zone-detail]` open the detail panel, or
    `[data-more-info-entity]` fire native More Info.
  - This ordering is the interactive-child guard: controls inside a tile
    never open the panel.
- **Zone tile:** a full-width header (state icon and name, ellipsized),
  above a body grid of about 45% photo and 55% status and controls. The right
  column is a top-aligned stack: state text and "Started here", Last active,
  duration dropdown above Run/Stop, then quick durations. The body has a
  112px minimum height and the photo fills its column.
- **Responsive fallback:** each tile is a CSS container. One
  `@container (max-width: 220px)` rule stacks name, a 16:9 photo, and
  controls. The outer grid is `repeat(auto-fit, minmax(240px, 1fr))`.
- **Detail panel:** rendered from `_detailZoneEntityId` as a fixed overlay
  inside the shadow root. It closes on ×, a backdrop click, Escape (a
  document `keydown` listener), or after the More Info button fires.
- **More Info:** controller tiles carry `data-more-info-entity` pointing at
  the **official** entity even when the tile shows a combined value. The Model
  tile has none. Zone tiles open the custom panel, whose button fires More
  Info for the zone switch.
- **Global Stop bar:** rendered only when `stop_irrigation_entity` is
  configured **and** the combined Watering state is true, and disabled if the
  button is unavailable. When idle, no element is emitted, so no spacing is
  left behind.
- **Controller tiles:** a `ChipSpec` list from `_buildChips()`
  (label, icon, state class, value text, optional More Info entity) rendered
  by one `_renderChip()`. The Model tile uses the same `.chip` markup from
  `_renderDeviceTile()`.

## Theme architecture

- `:host` defines a `--yardian-*` layer, each seeded from Home Assistant
  variables with a literal fallback: background (`--ha-card-background` →
  `--card-background-color`), surface (`--secondary-background-color`), text
  (`--primary-text-color`, `--secondary-text-color`), border
  (`--divider-color`), accent (`--primary-color` → `--accent-color`), and
  warning (`--error-color`). All component rules use only the `--yardian-*`
  names.
- **Semantics:** accent marks action and active (Run, selected quick
  duration, "on" controller tiles, "Started here"). Warning marks destructive
  or problem states (Stop, the Stop bar, unavailable).
- Tints use `color-mix()` over the theme color rather than fixed rgba
  palettes.
- Running zones deliberately get no tile tint.
- **Why no hard-coded palette:** the card must read correctly in any HA theme
  and in light and dark modes. Theme variables let HA and the user decide.
  The only fixed colors are the literal fallbacks when HA variables are absent,
  and the detail overlay's translucent black backdrop and panel shadow.
- **Tradeoff:** honoring arbitrary themes means a third-party theme can
  produce low contrast, for example a pale `--primary-color` under
  `--text-primary-color`. Per-card overrides of the `--yardian-*` variables
  are the remedy. `card-mod` is never required.
- Layout variables `--yardian-zone-tile-min-width`, `--yardian-tile-min-width`,
  and `--yardian-tile-gap` are also overridable.

## Loader, cache, and build architecture

The loading model is copied from the `nvr-card` project.

```text
Lovelace resource (registered once, type module):
    /local/yardian-card/loader.js
            │
            ▼  import(`/local/yardian-card/yardian-card.js?ts=${Date.now()}`)
    /local/yardian-card/yardian-card.js?ts=<page-load time>
            │
            ▼
    customElements.define("yardian-card", ...)
```

- The resource URL is stable, so deployments never require editing Lovelace
  resources or HA `.storage`.
- The main module URL is unique per page load, so the browser cannot reuse a
  stale cached module after a deployment. A page left open keeps the module it
  loaded.
- `yardian-card.js` must **not** also be registered. Two module URLs means two
  module instances, and the second `customElements.define("yardian-card")`
  throws.

**Deployment location:** `Z:\www\yardian-card\` on the Windows machine, which
is `/config/www/yardian-card/` in Home Assistant, served as
`/local/yardian-card/`.

**Stages, kept distinct:**

| Stage | Tool | Output |
| --- | --- | --- |
| Compile | `tsc --noEmit` (type-check), `vite build` | `dist/yardian-card.js` containing `"__YARDIAN_BUILD__"` |
| Build identity | `deploy.ps1` | `YARDIAN <git short HEAD>-<first 6 hex of manifest SHA-256>` |
| Deploy | `deploy.ps1` | Placeholder replaced **in memory**; bytes written to the share; `loader.js` copied |
| Verify | `deploy.ps1` | Files exist; deployed size equals the injected bytes; non-empty; loader sizes match; deployed file contains `const YARDIAN_BUILD = "<id>";` |
| Cache-busting | `loader.js` in the browser | `?ts=` on every page load |

The manifest is the sorted list of deployed source files (`dist/yardian-card.js`,
`loader.js`) as `relative/path|sha256` lines joined with `\n`, UTF-8 without
BOM, then SHA-256 hashed. The identifier thus changes with content even
without a new commit. The source and `dist/` placeholder are never modified.
Files copied without the script show `__YARDIAN_BUILD__`.

Deviations from `nvr-card`'s `deploy-to-ha.ps1`, all Yardian-specific:

- the script first runs `npm run build`, with output shown only on failure;
- the deployable source is `dist\yardian-card.js`;
- reads use `-Encoding UTF8`, because the bundle contains non-ASCII text and
  Windows PowerShell 5.1 would otherwise misdecode it;
- NVR's extra module trees don't exist here.

## Lifecycle

| Event | Actions |
| --- | --- |
| `constructor` | Attach shadow root; add delegated `click`/`change` listeners. |
| `setConfig` | Normalize config, or store the error; render. |
| `hass` setter | `_onHassUpdated()`: detect zone state changes, reconcile "Started here", trigger a history fetch on a zone change. Then render. **No actions are issued.** |
| `connectedCallback` | Render; add document `visibilitychange` and `keydown` listeners; if visible, start the refresh cycle and trigger a history fetch. |
| `visibilitychange` | Visible: restart the refresh cycle and fetch history if stale. Hidden: stop the interval. |
| `disconnectedCallback` | Remove both document listeners; stop the interval; clear "Started here"; close the detail panel. |

There is one interval per instance at most. Render has no network or action
side effects. History results arriving after disconnect only update instance
fields and re-render the detached root, which is harmless.

## Security and trust boundaries

- The card runs inside the authenticated Home Assistant frontend and acts
  with the logged-in user's permissions through `hass`.
- The browser never needs, holds, or sees the Yardian host or access token.
  Those live in the integration's config entry. Controller credentials do not
  belong in Lovelace YAML, and the card has no field for them.
- All controller communication is the integration's. Commands are HA actions,
  subject to HA's own authorization and logging. History comes through HA's
  WebSocket API.
- Files in `/config/www` (`/local/...`), including `loader.js`, the bundle, and
  zone photos, are static and served **without authentication**. Nothing
  sensitive belongs there.
- There is no direct browser-to-controller transport.

## Direct Yardian API decision

**Design choice:** the card deliberately does not call the Yardian controller
from the browser, although the controller has a local HTTP API (pyYardian uses
it) and a direct path is technically possible.

Reasons:

- **Single source of truth.** The coordinator owns controller state, so every
  consumer (dashboards, automations, history, this card) sees the same state.
- **No frontend credentials.** A direct path would put the controller address
  and access token into the browser and Lovelace configuration.
- **No duplicate transport.** Reimplementing the protocol in the frontend
  would duplicate pyYardian and add a second, uncoordinated poller against the
  same device.
- **HA infrastructure.** Actions, errors, availability, authorization,
  logging, and Recorder come for free and behave consistently.
- **Consistent history.** Recorder history matches what the card displays,
  because both come from the same entities.
- **Simpler lifecycle.** The card holds no sockets or controller sessions.

**Tradeoff:** the card inherits the integration's capability ceiling (see
[capability boundary](#yardian-integration-capability-boundary)). New
capabilities should be added to the integration or pyYardian, then consumed
here through HA.

## Development and deployment workflow

```powershell
npm install
npx tsc --noEmit
npm run build
.\deploy.ps1
```

Then reload the Home Assistant page.

- After the one-time `loader.js` resource registration, no resource or query
  edits are needed.
- `deploy.ps1` requires the `Z:` share (`$HaConfigShare`), an existing
  `Z:\www\yardian-card\`, Git, and npm. It fails with `exit 1` on any check,
  and its output ends with `Deployment succeeded with build identifier: ...`.
  Match that to the identifier shown in the card.
- `dist/` is generated and Git-ignored. The source placeholder is never
  modified.
- Development safety: never trigger irrigation automatically in tests or
  tooling. Prefer rendering and state checks over live commands.

## Extension guidelines

- Prefer existing HA entities and actions. Keep the HA-mediated architecture;
  don't add controller HTTP to the frontend.
- Add configuration only when necessary. New fields are optional and
  normalized in `normalizeConfig()` with defaults that preserve current
  behavior, so existing YAML keeps working.
- Keep `_render()` and the `hass` setter free of actions and network
  side effects. Put commands in click handlers and periodic work in the
  lifecycle.
- Release everything you acquire (listeners, timers) in
  `disconnectedCallback`, and keep one interval per instance.
- Use the delegated handlers. New controls need `data-action` or must match
  the interactive selector, so they don't open the detail panel.
- Preserve global Stop semantics and labeling. Don't present Yardian zone
  switches as persistent toggles.
- Style with `--yardian-*` variables seeded from HA theme variables.
- Preserve the provenance invariant. New displays must name their evidence
  source, and must omit when it is ambiguous.
- Don't infer data the integration doesn't provide (programs, sources,
  remaining time).
- Run `npx tsc --noEmit` and `npm run build` before deploying.

**Future integration capabilities.** If a future HA Yardian integration
exposed, for example, program entities or program actions, the card could
display or edit programs on top of those entities and actions, with the same
provenance rules. That is a possibility, not a commitment.

## Known limitations and current boundaries

| Limitation | Kind |
| --- | --- |
| No program or schedule display, editing, or next-run | Integration limitation |
| No run-source classification | Integration limitation |
| No remaining-time countdown | Integration limitation |
| Rain delay, standby, freeze prevention are read-only | Integration limitation |
| Stop is global on Yardian Pro | Integration limitation |
| 30 s polling; controller-level entities can stay stale after HA-started runs | Integration limitation |
| No direct controller access | Card design choice |
| Timed Run commands only, no toggle; no automatic retry | Card design choice |
| Fixed durations 5–60 min (integration accepts 1–1440) | Card design choice |
| Ephemeral duration selection and "Started here"; fixed 7-day history window | Card design choice |
| Zone delay, water-hammer, zone-enabled sensors not shown | Current implementation limitation |
| Per-zone `switch.turn_off` not used on YC controllers (untested model family) | Current implementation limitation |
| `title` accepted but not rendered | Current implementation limitation |
| No visual config editor; no HACS package | Current implementation limitation |
| Detail-panel photo has no broken-image placeholder | Current implementation limitation |
| `hass-more-info`, registry snapshots, `history/history_during_period` are frontend conventions | Compatibility-sensitive dependency |
