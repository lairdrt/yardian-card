- Home Assistant remains the control boundary; the frontend card should not call the Yardian controller directly unless the architecture is explicitly changed.
- The card must use HA-native entities/services first.
- Theme compatibility is required; use HA CSS variables with optional --yardian-* overrides.
- Development proceeds in small known-good increments.
- Preserve a visible build/version identifier in the card.
- Do not assume undocumented Yardian API behavior; only implement capabilities that are verified.
- Avoid broad architectural rewrites without first validating the need.

## Milestone 1: bootstrap

- Toolchain: TypeScript + Vite, built as a single ES module to `dist/yardian-card.js`. No runtime UI framework dependency; the card is a plain `HTMLElement` custom element rendering via shadow DOM.
- The custom element registers as `yardian-card` and implements the standard Lovelace card contract (`setConfig`, `hass` setter, `getCardSize`).
- Configuration contract (`src/config.ts`): explicit `zones: [{ entity, name }]` list plus an optional `controller: { rain_delay_entity, active_zones_entity }` block. No entity IDs are hard-coded in rendering logic; entity IDs always come from card configuration.
- Milestone 1 is strictly read-only: it renders zone switch state, rain delay, and active-zone count. It issues no service calls and defines no controls.
- Missing or unavailable entities render distinct, non-throwing status text ("Not configured" for an entity absent from config, "Unavailable"/"Unknown" for an entity present in config but missing or in a non-normal state from `hass.states`).
- See `docs/theming.md` for the theming contract established in this milestone.

## Milestone 2: zone grid + controller status UI

- Zone entities render as a responsive tile grid (`.zone-grid`, `repeat(auto-fit, minmax(...))`) rather than a list, so column count adapts to the card's actual rendered width instead of assuming a viewport size. Still strictly read-only: tiles have no click handler.
- Controller entities render as compact status chips (`.chip-grid`) instead of another entity list. Config gained three optional fields (`watering_running_entity`, `freeze_prevent_entity`, `standby_entity`) alongside the existing `rain_delay_entity`/`active_zones_entity`; all five remain independently optional and entity IDs are still never hard-coded into rendering logic.
- Rain-delay seconds are converted to human-readable text (`src/helpers.ts: formatRainDelay`) for display only; the underlying HA state is read and passed through unmodified otherwise, and the raw state + unit is shown as a fallback if the value doesn't look like a plain seconds count.
- The active-zone sensor is a count, not a zone identity, and is never used to infer which physical zone is running. If it reports a nonzero count while no configured zone switch is "on", the card shows a subtle inconsistency notice instead of guessing a zone.
- `<ha-icon>` (provided by the Home Assistant frontend at runtime, like `<ha-card>`) is used for zone/chip icons -- no icon library dependency was added.

## Milestone 3: manual zone run + global stop controls

- **Control model is "run zone for N minutes," never "turn zone on/off."** There is no ON/OFF toggle anywhere in this card, and none is planned: Yardian's scheduled-program intent isn't visible to Home Assistant, so a toggle would misrepresent what pressing it actually does. The only zone-scoped action is a duration + Run button that calls `yardian.start_irrigation` (`entity_id` = that zone's switch, `data.duration` = selected integer minutes). The only other action is a single global Stop, scoped to the whole controller, never to one zone.
- `hass.callService` is called from exactly two places in `src/yardian-card.ts` (`_handleRunZone`, `_handleStopIrrigation`), both only from a real user click event (delegated `click`/`change` listeners registered once on the shadow root in the constructor, since the card fully replaces `innerHTML` on every render). Nothing calls a service from `setConfig`, the `hass` setter, or `_render()`.
- Run is disabled whenever the zone switch is missing, `unavailable`, `unknown`, or already `on` (`src/helpers.ts: canRunZone` -- only an entity present and `off` is runnable). The click handler re-checks live `hass` state before calling the service, not just the DOM's `disabled` attribute, so a stale render can't issue a call the current state no longer permits.
- Selected duration is per-zone, in-memory only (`Map<entityId, minutes>` on the component instance) -- not written to any HA helper or browser storage, and lost on reload by design. It's kept across re-renders (not just across a single render) so a `hass` update from an unrelated entity elsewhere in the house doesn't silently reset a user's in-progress choice.
- Global Stop (`controller.stop_irrigation_entity`) calls `button.press` against that configured button entity. It's rendered only when that field is configured (there's nothing useful to bind an unconfigured button to); if configured but the entity is `unavailable`, it renders disabled rather than hidden. A button entity's normal idle state is `unknown` (never pressed) -- that's treated as ready, not an error, unlike every other entity type in this card.
- Zone photos (`zones[].image`, optional) are always HA-served URLs (e.g. `/local/...`), never embedded in the JS bundle. A missing/failed image falls back to a themed placeholder via an `error` listener on the `<img>` (attached per-render, since `error` doesn't bubble and so can't be delegated like click/change).