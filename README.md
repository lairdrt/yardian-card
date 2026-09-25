# Yardian Card

Yardian Card is a custom Home Assistant Lovelace card for Yardian smart
sprinkler controllers. It presents irrigation zones as photo tiles with timed
Run and Stop controls, shows controller status (watering, active zones, rain
delay, freeze prevention, standby), and adds a zone detail panel with
recorded activity from Home Assistant history.

The card works **through** Home Assistant's official Yardian integration. The
browser never talks to the Yardian controller: every state it shows comes from
Home Assistant entities, device registry data, or Recorder history, and every
command it sends is a Home Assistant action. Home Assistant remains the state
and control authority; the card is a richer UI over what the integration
already exposes.

```text
Yardian controller
    ↓  local polling (pyYardian)
Home Assistant Yardian integration
    ↓
HA entities, actions, device registry, Recorder history
    ↓
yardian-card (in the HA frontend)
```

Contributor internals and design rationale are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contents

**Using the card**

- [Features](#features)
- [Tested environment](#tested-environment)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Zone images](#zone-images)
- [Using the card](#using-the-card)
- [How the card treats data](#how-the-card-treats-data)
- [Current Home Assistant Yardian integration limitations](#current-home-assistant-yardian-integration-limitations)
- [Refresh behavior](#refresh-behavior)
- [History](#history)
- [Themes](#themes)
- [Troubleshooting](#troubleshooting)
- [Limitations summary](#limitations-summary)

**Developing the card**

- [Developer guide](#developer-guide)
- [References](#references)
- [License](#license)

---

# Using the card

## Features

- Zone tiles with a zone-state icon, zone name, photo, Off/Running state, and
  a "Last active" time from Home Assistant history.
- Timed manual runs: a duration dropdown, quick-duration buttons, and a Run
  button that calls `yardian.start_irrigation`.
- A Stop button on a running zone's tile and a global **Stop Irrigation** bar
  while anything is watering. Both press the integration's global Stop
  Irrigation button.
- A custom zone detail panel with state, recent observed activity, current
  controller conditions, and a link to Home Assistant's native More Info
  dialog.
- Controller tiles: Model, Watering, Active Zones, Rain Delay, Freeze
  Prevention, and Standby. Entity-backed tiles open native More Info.
- "Started here" attribution for runs this card started, shown only while it
  can still be proven.
- Styling from Home Assistant theme variables, with `--yardian-*` overrides.
- A build identifier at the bottom of the card, so you can confirm which
  deployed build the browser loaded.

## Tested environment

These are the environments used for runtime testing. They are not minimum
supported-version claims.

| Component | Tested version/environment |
| --- | --- |
| Home Assistant Core | 2026.9.3 |
| Yardian integration | As shipped in HA 2026.9.3, using `pyyardian==1.4.2` |
| Controller | Yardian Pro (PRO1906), six physical zones |

## Requirements

- Home Assistant with dashboard (Lovelace) JavaScript module resources.
- The official **Yardian** integration configured and working. It is set up
  with the controller's host and an access token from the Yardian app, and it
  polls the controller over the local network (`local_polling`). The
  controller must be reachable from Home Assistant, not from the browser.
- The integration's entities for your controller:

  | Purpose | Entity created by the integration |
  | --- | --- |
  | One per zone | `switch` (zone on/off state; target of `yardian.start_irrigation`) |
  | Watering | `binary_sensor` "Water running" |
  | Active zones | `sensor` "Active zones" |
  | Rain delay | `sensor` "Rain delay" (seconds) |
  | Standby | `binary_sensor` "Standby" (diagnostic) |
  | Freeze prevention | `binary_sensor` "Freeze prevent enabled" (diagnostic, **disabled by default**) |
  | Stop | `button` "Stop irrigation" |

  Enable the "Freeze prevent enabled" entity in Home Assistant if you want its tile.
  Entity IDs depend on your device name, so look them up in
  **Settings → Devices & services → Yardian**.
- Recorder and History enabled (the Home Assistant default) for "Last active"
  and the detail panel's recent activity. Without them the card still works;
  history is simply not shown.

## Installation

There is no HACS package or release bundle. The card is built from source.

### 1. Build

```powershell
npm install
npm run build
```

This produces `dist/yardian-card.js`. `loader.js` lives at the repository
root.

### 2. Copy files into Home Assistant

Home Assistant serves `/config/www/` as `/local/`. Create this directory:

```text
/config/www/yardian-card/
```

and place these two files in it:

```text
yardian-card.js   (from dist/)
loader.js         (from the repository root)
```

On Windows with the HA configuration share mapped as `Z:`, `.\deploy.ps1`
builds and copies both files for you and stamps the build identifier (see
[Development workflow](#development-workflow)). If you copy `dist/` by hand
instead, the card's build identifier shows the literal placeholder
`__YARDIAN_BUILD__`. That is expected: only `deploy.ps1` fills it in.

### 3. Register exactly one dashboard resource

In **Settings → Dashboards**, open the three-dots menu at the top right, choose
**Resources**, and add:

| URL | Resource type |
| --- | --- |
| `/local/yardian-card/loader.js` | JavaScript module |

Do **not** also register `/local/yardian-card/yardian-card.js`.

Why a loader:

- `loader.js` dynamically imports `yardian-card.js` with a fresh
  `?ts=<page-load time>` query on every page load, so the browser can't reuse
  a stale copy of the main module after a new deployment.
- The registered resource URL never changes, so normal redeployments need no
  resource edits. Just reload the page.
- If both `loader.js` and `yardian-card.js` are registered, the page loads two
  copies of the module and the second one fails to define `yardian-card`
  again.

If you are upgrading from an older setup that registered
`/local/yardian-card/yardian-card.js?v=...` directly, replace that resource
with the loader entry above.

### 4. Add the card

Add a Manual card to a dashboard with your configuration (see below), then
reload the page.

## Configuration

### Complete example

This is based on [examples/lovelace.yaml](examples/lovelace.yaml). **The entity
IDs are examples.** Replace every one with your own Home Assistant entity IDs.

```yaml
type: custom:yardian-card
title: Yardian
zones:
  - entity: switch.backyard_far
    name: Backyard Far
    image: /local/yardian-card/zones/backyard-far.jpg

  - entity: switch.backyard_middle
    name: Backyard Middle
    image: /local/yardian-card/zones/backyard-middle.jpg

  - entity: switch.backyard_near
    name: Backyard Near
    image: /local/yardian-card/zones/backyard-near.jpg

  - entity: switch.dead_zone_1
    name: Front Drip
    image: /local/yardian-card/zones/front-drip.jpg

  - entity: switch.dead_zone_2
    name: Front Sprinklers
    image: /local/yardian-card/zones/front-sprinklers.jpg
controller:
  rain_delay_entity: sensor.yardian_smart_sprinkler_controller_rain_delay
  active_zones_entity: sensor.yardian_smart_sprinkler_controller_active_zones
  watering_running_entity: binary_sensor.yardian_smart_sprinkler_controller_watering_running
  freeze_prevent_entity: binary_sensor.yardian_smart_sprinkler_controller_freeze_prevent
  standby_entity: binary_sensor.yardian_smart_sprinkler_controller_standby
  stop_irrigation_entity: button.backyard_yardian_smart_sprinkler_controller_stop_irrigation
```

A minimal working card needs only `type` and one zone:

```yaml
type: custom:yardian-card
zones:
  - entity: switch.backyard_far
```

### Configuration reference

The fields below are the complete set the card reads. Unknown fields are
ignored. A field with the wrong type (for example a number where a string is
expected) is treated as omitted. The only configuration errors that stop the
card rendering are a missing or empty `zones` list, or a zone without a string
`entity`. The card then shows the error message instead of zones.

#### Card

| Path | Required | Type and default | Effect |
| --- | --- | --- | --- |
| `type` | Required | String | Must be `custom:yardian-card`. Handled by Home Assistant. |
| `title` | Optional | String, `"Yardian"` | Accepted and stored, but **not currently displayed** by the card. |
| `zones` | Required | Non-empty list | The zone tiles, in the order listed. Only these zones are shown, counted, or queried for history. |
| `controller` | Optional | Object | Controller entities. If omitted, controller tiles show "Not configured" and no Stop control is available. |

#### Zone (`zones[]`)

| Path | Required | Type and default | Effect |
| --- | --- | --- | --- |
| `zones[].entity` | Required | String | The zone's Yardian `switch` entity. Used for state, Run, history, and More Info. |
| `zones[].name` | Optional | String | Display name. If omitted, the entity's friendly name is used, then the entity ID. |
| `zones[].image` | Optional | String (URL) | Photo URL served by Home Assistant, such as `/local/...`. See [Zone images](#zone-images). |
| `zones[].unused` | Optional | Boolean, `false` | Only literal `true` applies. Marks a zone that is wired but intentionally not in service: the tile is dimmed and the name italicized. It is not hidden, and its controls still work. |

#### Controller (`controller`)

Every controller field is optional and independent.

| Path | Entity type | Used for | If omitted |
| --- | --- | --- | --- |
| `controller.watering_running_entity` | `binary_sensor` | Official input to the Watering tile and the Stop bar; Watering tile More Info target | Watering is derived from zone switches only; tile is not clickable |
| `controller.active_zones_entity` | `sensor` | Official count for the Active Zones tile; More Info target; **target of the 10-second refresh** | Count is derived from zone switches only; tile not clickable; **no card-driven refresh** |
| `controller.rain_delay_entity` | `sensor` (seconds) | Rain Delay tile; rain-delay condition in the detail panel | Tile shows "Not configured" |
| `controller.freeze_prevent_entity` | `binary_sensor` | Freeze Prevention tile; condition in the detail panel | Tile shows "Not configured" |
| `controller.standby_entity` | `binary_sensor` | Standby tile; condition in the detail panel | Tile shows "Not configured" |
| `controller.stop_irrigation_entity` | `button` | Per-tile Stop and the global Stop Irrigation bar (`button.press`) | No Stop bar; a running zone's Stop button is shown disabled |

Controller entity IDs are also used, first, to find the controller device for
the Model tile.

Run durations are fixed in the card: the dropdown offers 5, 10, 15, 20, 30,
45, and 60 minutes (default 10), and the quick buttons offer 5, 10, 20, and
30. They are not configurable.

## Zone images

- `image:` is an optional URL, not a file path. Home Assistant serves
  `/config/www/...` as `/local/...`, so the file
  `/config/www/yardian-card/zones/front-drip.jpg` is referenced as
  `/local/yardian-card/zones/front-drip.jpg`.
- `deploy.ps1` does not manage images. Copy them into `/config/www/` yourself.
- Files under `/config/www/` are served **without authentication**. Don't use
  images you would not want reachable by URL.
- In the tile, the photo fills the left part of the tile body and is cropped
  to fit (`object-fit: cover`). There is no fixed aspect ratio, so landscape
  photos with the subject near the centre work best. On a very narrow tile
  the photo moves above the controls at 16:9.
- With no `image:`, the tile shows a neutral image icon.
- If the image fails to load, the tile swaps in an "image unavailable" icon.
- The detail panel shows the configured image at 16:9. It has no placeholder
  of its own, so a broken URL shows as a broken image there.

## Using the card

### Zone tiles

Each tile has a full-width header with the zone-state icon and zone name, and
below it the photo on the left and the status and controls on the right:

```text
┌──────────────────────────────┐
│ ◔ Backyard Far               │
├─────────────┬────────────────┤
│             │ Off            │
│             │ Last active: … │
│   PHOTO     │ [ 10 min ▼ ]   │
│             │ [ ▶ RUN ]      │
│             │ (5)(10)(20)(30)│
└─────────────┴────────────────┘
```

- **Icon:** a zone icon when off, a spraying sprinkler while running.
- **State:** `Off`, `Running`, `Unavailable`, or `Unknown`. The integration
  marks a zone's switch unavailable when that zone is disabled on the
  controller. An unavailable zone gets a warning-colored border and text.
- **Last active:** when Home Assistant last recorded this zone turning on, for
  example `Last active: Today 6:22 AM`. It is hidden while the zone is running
  and omitted when there is no recorded run (see [History](#history)).
- **Started here:** a small badge next to `Running` when this card started the
  run (see [How the card treats data](#how-the-card-treats-data)).
- Running does **not** recolor the tile. Only the icon, state text, and
  Run/Stop button change.

### Choosing a duration

- The **dropdown** offers 5, 10, 15, 20, 30, 45, and 60 minutes.
- The **quick-duration buttons** (5, 10, 20, 30) only select a duration. They
  do not start watering. The selected one is highlighted and the dropdown
  follows it.
- Selections are remembered per zone while the page is open and reset to 10
  minutes on reload.
- Duration controls are disabled while the zone is running or unavailable.

### Run

**Run** calls Home Assistant's `yardian.start_irrigation` action for that
zone's switch with the selected duration in whole minutes. It is a timed
command, not a persistent on/off toggle: the controller runs the zone for that
duration and turns it off itself.

Run is enabled only when the zone's switch is present and `off`. The card
re-checks live state before sending, and it never retries a command
automatically.

### Stop

While a zone is running, its Run button becomes **Stop**. When anything is
watering, a **Stop Irrigation** bar ("Stops all zones, not just one") also
appears at the top of the card.

Both press the configured `stop_irrigation_entity` button, the integration's
**Stop irrigation**. That stops all irrigation on the controller, not just
the zone whose tile you pressed. On a Yardian Pro, even the integration's
per-zone switch turn-off stops all irrigation (see
[integration limitations](#current-home-assistant-yardian-integration-limitations)),
so the card labels Stop as global rather than suggesting an isolated valve
shut-off. The controller remains authoritative: the tile shows `Off` only once
Home Assistant reports it.

Stop is disabled if `stop_irrigation_entity` is not configured, missing, or
`unavailable`. A button entity normally reports `unknown` until first pressed;
that is treated as ready.

### Zone detail panel

Click a zone tile, anywhere except its controls, to open the zone detail
panel. The dropdown, quick-duration buttons, and Run/Stop never open it.

The panel shows:

- the zone icon, name, and photo;
- the current state and, when proven, "Started here";
- Last active;
- **Recent observed activity**: up to four most recent recorded runs for this
  zone, newest first, for example `Front Drip · active 12 min · Today 6:22 AM`;
- **Controller conditions**, when any apply: an active rain delay, freeze
  prevention enabled, or standby active;
- **Open Home Assistant More Info**, which closes the panel and opens Home
  Assistant's native dialog for the zone switch.

Close the panel with ×, by clicking outside it, or with Escape.

Native More Info is Home Assistant's own dialog, not part of the card. It
includes the standard switch toggle. Turning the zone on there uses the
integration's default duration (6 minutes), not the card's selection, and
turning it off stops irrigation as described under Stop.

### Controller tiles

| Tile | Shows | Click |
| --- | --- | --- |
| **Model** | Controller model and manufacturer from the HA device registry. Hover for device name and serial number. `Unavailable` if HA doesn't expose the registry. | Not clickable |
| **Watering** | `Idle`, `Running · <zone names>`, or `Running` when HA reports watering but no configured zone switch is on | More Info for `watering_running_entity` |
| **Active Zones** | `N zones`: the larger of the official count and the number of configured zones running | More Info for `active_zones_entity` |
| **Rain Delay** | Remaining delay as `None`, `45 min`, `2 hrs 30 min`, or `1 day 4 hrs`; the raw value and unit if it isn't plain seconds | More Info for `rain_delay_entity` |
| **Freeze Prevention** | `Enabled` / `Disabled` | More Info for `freeze_prevent_entity` |
| **Standby** | `Standby` / `Ready` | More Info for `standby_entity` |

Tiles for unconfigured entities show `Not configured`, are dimmed, and are not
clickable. Watering and Active Zones always render, because they can be
derived from the zone switches alone.

## How the card treats data

The card follows one rule:

> **Do not present inferred controller intent as observed fact.**

Everything it shows is either current Home Assistant state, recorded Home
Assistant history, or a narrowly scoped fact about an action this card itself
just performed. When the data is ambiguous, the card leaves the claim out
rather than guessing. In practice:

- **No countdown.** The card doesn't show "time remaining", because Home
  Assistant doesn't provide it.
- **No source labels.** A run isn't labeled Scheduled, Program, App, or
  Manual. The card has no reliable way to know.
- **"Started here" is narrow.** It appears only after this card's own Run
  command was accepted and the zone was then seen running. It disappears when
  the run ends, when the zone never came on within 90 seconds, or when the
  card is reloaded. It is never inferred for runs started elsewhere.
- **History is observation.** "Last active" and recent activity are when Home
  Assistant recorded the zone switch turning on. They are not controller
  records of what was watered or why.
- **Durations only when proven.** A run's length is shown only when the next
  recorded state after "on" was "off".
- **No next-run claims.** There is no "next watering" and no schedule
  information, because Home Assistant has none to give.
- **Unknown stays unknown.** If Home Assistant reports watering but no
  configured zone switch is on, the Watering tile shows plain `Running` rather
  than guessing a zone.

## Current Home Assistant Yardian integration limitations

Yardian Card deliberately stays inside the official Home Assistant
integration's boundary: it uses only what that integration exposes. Many
things the card does not show are therefore not missing UI work. **The current
Home Assistant Yardian integration does not expose them.** This section
reflects the integration as shipped in Home Assistant 2026.9.3 with
`pyyardian` 1.4.2.

What the integration provides is listed in [Requirements](#requirements):
zone switches, watering and active-zone status, rain delay, standby, freeze
prevention, zone delay, water-hammer duration, zone-enabled sensors, a Stop
all irrigation button, and the `yardian.start_irrigation` action.

**Programs and schedules.** The current integration does not expose Yardian
watering programs or schedules: no entities, attributes, or actions. The card
therefore cannot:

- list Yardian watering programs or show their definitions;
- create, edit, or delete programs or schedules;
- show when the next scheduled run will happen;
- manage the controller's schedule configuration.

Use the Yardian app for these.

**Where a run came from.** The integration reports which zones are active, not
why. It gives no authoritative indication of whether a run came from a
schedule, a program, the Yardian app, or a Home Assistant action, so the card
cannot classify runs that way.

**Remaining time.** The integration exposes no remaining run time or end time
for a running zone, so the card shows no countdown.

**History.** Home Assistant history records the states of the integration's
enabled entities over time. Disabled-by-default entities, such as Freeze
prevent enabled, have no state or history until you enable them. History
cannot contain program, schedule, or run-source information the integration
never provided.

**Settings are read-only.** Rain delay, standby, and freeze prevention are
sensors. The integration has no actions to change them, so the card only
displays them.

**Stop is global on Yardian Pro.** The integration's Stop irrigation
button stops everything. Its per-zone switch turn-off calls pyYardian's
`stop_zone`, which on Yardian Pro controllers also sends the global stop
command.

**Polling delay.** The integration polls the controller every 30 seconds, so
changes made in the Yardian app or by a schedule appear in Home Assistant with
some delay. The card shortens that delay (see
[Refresh behavior](#refresh-behavior)) but cannot remove it.

**Device information.** The Model tile shows only what the integration
registers for the device: name, model, manufacturer, and serial number.

A future version of the integration or pyYardian could expose more, for
example program data. The card could then be extended to use it through Home
Assistant, keeping the same architecture. No such support is promised here.

## Refresh behavior

The Yardian integration updates its entities by polling the controller every
30 seconds. To make changes from the Yardian app, a schedule, or the
controller itself appear sooner, the card asks Home Assistant for an extra
refresh:

- While the card is on screen and the browser tab is visible, it calls
  `homeassistant.update_entity` on the configured `active_zones_entity` every
  10 seconds.
- All Yardian entities share one data coordinator, so refreshing that one
  entity refreshes them all.
- When the tab is hidden, the interval stops. When it becomes visible again,
  the card refreshes immediately and restarts the interval.
- This does not change the integration's configured polling interval, and it
  issues no irrigation commands.
- If `active_zones_entity` is not configured, the card does not refresh
  anything and you get the integration's normal cadence.

This improves responsiveness. It doesn't make the data real-time, and Home
Assistant may merge requests that arrive close together.

## History

"Last active" and the detail panel's recent activity come from Home
Assistant's Recorder, read through the frontend WebSocket command
`history/history_during_period`, the same mechanism HA's own History panel
uses. The card never touches the Recorder database directly.

- **Scope:** the configured zone switches only, over the last **7 days**.
  This is fixed.
- **Caching:** results are kept in memory for the open page. The card fetches
  when it appears, when a configured zone changes state, and when the tab
  becomes visible if the data is more than 5 minutes old. It fetches at most
  once every 30 seconds and never runs two fetches at once.
- **Last active** is the most recent recorded transition of the zone switch
  into `on` within the window.
- **Durations** in recent activity are shown only when the very next recorded
  state was `off`, rounded to whole minutes. If the next record is
  `unavailable`/`unknown`, or the run hasn't ended, no duration is shown.
- **Timing:** times are when Home Assistant recorded the change, which depends
  on polling. They are not controller-reported valve times.
- **Edge cases:** a zone that was already on when the 7-day window began, with
  no change since, has no recorded start in the window and so shows no Last
  active.
- **Incomplete history:** if Recorder is disabled, excludes the zone
  entities, has purged the period (Recorder keeps 10 days by default), or the
  request fails, the card simply omits history. It never estimates.

## Themes

The card is styled entirely from Home Assistant theme variables, so it follows
your active theme in light and dark mode. `card-mod` is not required.

| Purpose | Card variable | Default source |
| --- | --- | --- |
| Card background | `--yardian-background` | `--ha-card-background`, then `--card-background-color` |
| Tile surface | `--yardian-surface-color` | `--secondary-background-color` |
| Primary text | `--yardian-text-primary` | `--primary-text-color` |
| Secondary text | `--yardian-text-secondary` | `--secondary-text-color` |
| Borders, dividers | `--yardian-border-color` | `--divider-color` |
| Action/active color | `--yardian-accent-color` | `--primary-color`, then `--accent-color` |
| Stop / warning color | `--yardian-warning-color` | `--error-color` |

Layout variables can also be overridden:

| Variable | Default | Effect |
| --- | --- | --- |
| `--yardian-zone-tile-min-width` | `240px` | Minimum zone tile width before zones wrap to another row |
| `--yardian-tile-min-width` | `120px` | Minimum controller tile width |
| `--yardian-tile-gap` | `6px` | Gap between controller tiles |

How the colors are used:

- **Accent:** the Run button background, the selected quick duration,
  "Started here", and controller tiles that are on. Button text uses
  `--text-primary-color`.
- **Warning:** the Stop button, the Stop Irrigation bar (border, text, and a
  light tint), and anything unavailable.
- **Surface:** zone and controller tiles use the surface color. Running does
  not change it.

Theme variables go in a Home Assistant theme (`frontend: themes:` in
`configuration.yaml`) without the leading `--`, and apply when that theme is
selected in your profile or for a dashboard view.
[examples/theme.yaml](examples/theme.yaml) is a fragment showing
`yardian-accent-color` and `yardian-warning-color` overrides for light and dark
modes, for merging into an existing theme.

Because the card honors your theme rather than imposing its own palette,
unusual third-party themes can produce low-contrast combinations, for example
a pale `--primary-color` behind `--text-primary-color`. Override the relevant
`yardian-*` variable in your theme if that happens.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| "Custom element doesn't exist: yardian-card" | The resource isn't registered or isn't loading. Check the `/local/yardian-card/loader.js` resource is type JavaScript module, both files exist in `/config/www/yardian-card/`, then reload. The browser console shows "Failed to load Yardian card" if the loader's import failed. |
| Console error about `yardian-card` already being defined | Both `loader.js` and `yardian-card.js` are registered. Remove the `yardian-card.js` resource. |
| Old version still showing | Compare the build identifier at the bottom of the card with the one `deploy.ps1` printed, then reload the page. The loader fetches a fresh module on each page load; a page left open keeps the module it loaded. |
| Build identifier shows `__YARDIAN_BUILD__` | Files were copied by hand rather than by `deploy.ps1`. This is harmless. |
| Card shows a configuration error | `zones` is missing or empty, or a zone has no `entity`. |
| A zone shows `Unavailable` | The entity ID is wrong, the entity is disabled, the zone is disabled on the controller, or the integration can't reach the controller. Check the entity in Developer Tools → States. |
| Image icon instead of the photo | No `image:` is set, or the URL is wrong. Check it opens in the browser as `/local/...` and that the file is under `/config/www/`. |
| No "Last active" | No recorded run in the last 7 days, the zone is running, or Recorder/History is unavailable or excludes the zone entities. |
| Freeze Prevention shows `Unavailable` | The integration creates this entity disabled. Enable it in HA. |
| After Run, the zone shows Running but official controller entities lag | Expected. The integration updates the zone switch immediately but may not update its Watering/Active Zone entities until a later change. The card's Watering and Active Zones tiles account for this (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#state-model)). |
| Changes from the Yardian app appear slowly | Configure `active_zones_entity` so the card refreshes every 10 seconds; otherwise you get the integration's 30-second polling. |
| No Stop bar while watering, or Stop disabled | `stop_irrigation_entity` isn't configured, is wrong, or is unavailable. |
| Hard-to-read colors | Your theme's colors conflict. Override `yardian-accent-color` or `yardian-warning-color` in the theme. |

## Limitations summary

**Integration limitations** come from the current Home Assistant Yardian
integration:

- Programs and schedules are not available: the current integration does not
  expose them, so there is no program list, editing, or next-run display.
- Run source (schedule, program, app, manual) is not exposed, so runs are not
  labeled by origin.
- Remaining run time is not exposed, so there is no countdown.
- Rain delay, standby, and freeze prevention are read-only.
- Stop is global on Yardian Pro.
- State is polled, so it lags slightly behind the controller.

**Card design choices** are deliberate:

- The card never talks directly to the Yardian controller. It works only
  through Home Assistant.
- Controls are timed commands (Run for N minutes), never an on/off toggle.
- Stop is presented as global.
- Nothing is inferred: no guessed sources, countdowns, or schedules.
- Commands are never retried automatically.
- Run durations are a fixed list (5–60 minutes), even though the integration
  accepts 1–1440.
- Duration selections and "Started here" are not saved across reloads.
- The history window is fixed at 7 days.

**Current implementation limitations** are things the integration supports
but the card does not do yet:

- `title` is accepted but not displayed.
- The integration's zone delay, water-hammer duration, and zone-enabled
  sensors are not shown.
- There is no visual configuration editor; configuration is YAML only.
- On controllers where pyYardian supports a true per-zone stop (the newer
  Yardian "YC" family), the card still uses the global stop. Only Yardian Pro
  has been tested.
- There is no HACS package; installation is manual.

---

# Developing the card

## Developer guide

Full internals and rationale are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In brief:

### Architecture

The card is a single custom element, `yardian-card`, written in TypeScript
with no UI framework. It renders into a shadow DOM and is bundled by Vite as
one ES module. Home Assistant supplies `hass`; the card reads entity state
from it, sends actions with `hass.callService`, reads history with
`hass.callWS`, and opens native dialogs with the standard `hass-more-info`
event.

### Source map

| Path | Responsibility |
| --- | --- |
| `src/yardian-card.ts` | The custom element: lifecycle, rendering, click handling, Run/Stop, watering-state resolution, refresh loop, "Started here", detail panel. |
| `src/config.ts` | YAML configuration types and `normalizeConfig()`. |
| `src/helpers.ts` | Pure helpers: state formatting, run-ability, duration lists, rain-delay text, device-registry lookup. |
| `src/history.ts` | Recorder history fetch and ON-run extraction. |
| `src/styles.ts` | All CSS, including the theme variable layer. |
| `src/types.ts` | The subset of Home Assistant frontend types the card uses. |
| `loader.js` | Stable resource that imports the card with a per-page-load `?ts=`. |
| `deploy.ps1` | Windows build, deploy, and build-identifier stamping. |
| `vite.config.ts` | Library build to `dist/yardian-card.js`. |

### Development workflow

```powershell
npm install
npx tsc --noEmit
npm run build
.\deploy.ps1
```

Then reload the Home Assistant page.

`deploy.ps1` expects the HA configuration share at `Z:` (edit
`$HaConfigShare` otherwise), an existing `Z:\www\yardian-card\` directory, and
Git in `PATH`. It:

1. runs `npm run build`;
2. hashes `dist/yardian-card.js` and `loader.js` into a manifest;
3. replaces the `__YARDIAN_BUILD__` placeholder in memory with
   `YARDIAN <short-commit>-<manifest-hash>`;
4. writes that copy and `loader.js` to the share;
5. verifies the deployed files and build line.

Source and `dist/` keep the placeholder. `dist/` is generated and ignored by
Git. The script never edits Home Assistant's `.storage`.

### Extending safely

- **A controller tile:** add a `ChipSpec` in `_buildChips()` from a configured
  entity, set `moreInfoEntityId` to that entity, and add the optional entity
  field to `YardianControllerConfig` and `normalizeConfig()`.
- **A zone field or control:** add the optional field to `YardianZoneConfig`
  and `normalizeConfig()`, render it in `_renderZoneRow()`, and give any
  control a `data-action` so tile clicks don't open the detail panel.
- **Configuration:** new fields must be optional with the old behavior as the
  default, so existing YAML keeps working.
- **No side effects in render:** `_render()` and the `hass` setter run on
  every state update. Actions or fetches there would repeat or loop. Actions
  belong in click handlers; periodic work belongs in the lifecycle.
- **No direct Yardian HTTP:** talking to the controller from the browser would
  need controller credentials in the frontend, would create a second
  controller connection alongside the integration, and would bypass Home
  Assistant as the authority. Improve the integration instead.
- **Keep the accuracy rules:** new displays must come from HA state, HA
  history, or this card's own proven actions, and must omit rather than guess.

## References

- [Home Assistant Yardian integration](https://www.home-assistant.io/integrations/yardian/): user documentation, entities, and the start irrigation action.
- [Yardian integration source](https://github.com/home-assistant/core/tree/dev/homeassistant/components/yardian): the authoritative list of what the integration exposes.
- [pyYardian](https://github.com/aeon-matrix/pyyardian) ([PyPI](https://pypi.org/project/pyyardian/)): the controller client library the integration uses.
- [Yardian](https://www.yardian.com/): the manufacturer's site and product support.
- [Home Assistant custom cards](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/): the card contract (`setConfig`, `hass`, registration).
- [Registering resources](https://developers.home-assistant.io/docs/frontend/custom-ui/registering-resources/): dashboard resources and `/local`.
- [Home Assistant themes](https://www.home-assistant.io/integrations/frontend/): defining and selecting themes.
- [Recorder](https://www.home-assistant.io/integrations/recorder/) and [History](https://www.home-assistant.io/integrations/history/): where "Last active" data comes from, and retention.
- [`homeassistant.update_entity`](https://www.home-assistant.io/integrations/homeassistant/): the action used for the 10-second refresh.
- [Fetching data (DataUpdateCoordinator)](https://developers.home-assistant.io/docs/integration_fetching_data/): the coordinator pattern the integration uses.
- [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/): general WebSocket context. `history/history_during_period` is used by HA's own frontend and is not presented here as a stable public API.
- [Vite library mode](https://vite.dev/guide/build.html) and [TypeScript](https://www.typescriptlang.org/docs/): the build toolchain.

## License

See [LICENSE](LICENSE) (GNU General Public License v3).
