# Theming

`yardian-card` is styled entirely from CSS custom properties. It does not
hard-code presentation colors and does not depend on `card-mod`.

## Inherited Home Assistant variables

The card reads these standard Home Assistant frontend variables as its
first-choice source of truth. Any theme (built-in or third-party) that sets
them is picked up automatically:

| Purpose               | HA variable(s) read (in order)                              |
|------------------------|---------------------------------------------------------------|
| Card background        | `--ha-card-background`, `--card-background-color`             |
| Tile / chip surface       | `--secondary-background-color`                               |
| Primary text            | `--primary-text-color`                                        |
| Secondary text           | `--secondary-text-color`                                       |
| Border / divider         | `--divider-color`                                              |
| Active / accent state    | `--state-active-color`, `--primary-color`, `--accent-color`     |
| Warning / error state     | `--error-color`, `--warning-color`                             |
| Text on an accent-colored surface (Run button) | `--text-primary-color`                       |
| Body font                 | `--paper-font-body1_-_font-family`                              |
| Monospace (build id, errors) | `--code-font-family`                                       |
| Icons (`<ha-icon>`)      | resolved by Home Assistant's own icon element, not styled here |

Zone rows and controller chips also read the theme's card corner radius
via `--ha-card-border-radius` (falling back to `8px`), and tint the "on"
state's row/chip background from `--yardian-accent-color` using CSS
`color-mix()`. On a browser old enough not to support `color-mix()`, the
tint is simply skipped -- the accent-colored icon, accent-colored state
text, and accent-colored border still communicate the "on" state, so
nothing becomes unreadable. The same fallback logic tints the Stop
Irrigation control's background from `--yardian-warning-color`.

Each zone tile is a full-width name header above a two-column body
(photo left, status + controls right). The tile has exactly one
narrow-width fallback -- name, photo, then status + controls stacked --
applied by a CSS `@container` query keyed to the tile's own width
(each `.zone-row` is its own container), not the browser viewport. On a
browser without container-query support the query is simply ignored and
the tile keeps the two-column layout.

`<ha-card>` (the standard Home Assistant card element) is used as the
outer element, so it also inherits the active theme's card border radius
and box shadow without any extra work by this card.

## `--yardian-*` overrides

Each purpose above is exposed as a `--yardian-*` custom property on the
card's host element, seeded from the HA variables above with a plain CSS
fallback if neither is set:

- `--yardian-background`
- `--yardian-surface-color` (zone tile / status chip background)
- `--yardian-text-primary`
- `--yardian-text-secondary`
- `--yardian-border-color`
- `--yardian-accent-color` (running zone / "on" chip emphasis)
- `--yardian-warning-color` (unavailable state, inconsistency notice)

Set any of these on the card (via a dashboard theme, or a specific card's
`style:` if your Lovelace version supports it) to override just this
card's presentation without touching the rest of the dashboard's theme.
See `examples/theme.yaml` for a minimal example.

## What this milestone does not do

This milestone does not attempt custom light/dark detection, does not ship
a config editor, and does not depend on `card-mod`. Verify appearance
manually under at least the default light theme, default dark theme, and
two third-party themes (see "Manual verification" in the milestone report).
