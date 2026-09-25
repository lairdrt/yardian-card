# Theming

`yardian-card` is styled from Home Assistant theme variables through a small
layer of `--yardian-*` custom properties. It does not depend on `card-mod`.
All styles live in `src/styles.ts`.

## Color variables

Each `--yardian-*` color is defined on the card's host element and seeded
from Home Assistant variables, falling back to a literal value only when the
theme sets none of them. Component rules use only the `--yardian-*` names.

| Card variable | Reads (in order) | Literal fallback | Used for |
| --- | --- | --- | --- |
| `--yardian-background` | `--ha-card-background`, `--card-background-color` | `#ffffff` | Card background, duration dropdown, detail panel |
| `--yardian-surface-color` | `--secondary-background-color` | `rgba(0, 0, 0, 0.04)` | Zone tiles, controller tiles, photo placeholder |
| `--yardian-text-primary` | `--primary-text-color` | `#212121` | Zone names, tile values, detail panel text |
| `--yardian-text-secondary` | `--secondary-text-color` | `#727272` | State text, labels, icons, Last active, build identifier |
| `--yardian-border-color` | `--divider-color` | `#e0e0e0` | Photo border, dropdown, quick-duration buttons, detail dividers |
| `--yardian-accent-color` | `--primary-color`, `--accent-color` | `#03a9f4` | Run button, selected quick duration, "on" controller tiles, "Started here" |
| `--yardian-warning-color` | `--error-color` | `#db4437` | Stop button, Stop Irrigation bar, unavailable state, configuration errors |

## Layout variables

| Card variable | Default | Effect |
| --- | --- | --- |
| `--yardian-zone-tile-min-width` | `240px` | Minimum zone tile width in the zone grid before tiles wrap |
| `--yardian-tile-min-width` | `120px` | Minimum controller tile width |
| `--yardian-tile-gap` | `6px` | Gap between controller tiles |

## Other Home Assistant variables read directly

| Variable | Fallback | Used for |
| --- | --- | --- |
| `--text-primary-color` | `#ffffff` | Text on the Run and Stop buttons |
| `--ha-card-border-radius` | `8px` | Stop Irrigation bar and zone detail panel corners |
| `--paper-font-body1_-_font-family` | `inherit` | Card font |
| `--code-font-family` | `monospace` | Build identifier and configuration errors |

Icons are `<ha-icon>` elements rendered by Home Assistant. Their color follows
the card's text variables. `<ha-card>` supplies the theme's own card border
radius and shadow for the outer card.

## State styling

- **Running zones:** the zone tile is deliberately **not** tinted or
  recolored. Running is shown only by the zone icon (a spraying sprinkler),
  the `Running` state text, and the Run button becoming a Stop button in the
  warning color.
- **Unavailable zones:** the tile border is a mix of the warning color, and
  the icon and state text use the warning color.
- **Unused zones** (`unused: true`): the tile is dimmed to 55% opacity and the
  name is italic.
- **Controller tiles:** "on" tiles use the accent color for icon and value,
  unavailable tiles use the warning color, and "Not configured" tiles are
  dimmed.
- **Tints:** the selected quick duration, the "Started here" badge, and the
  Stop Irrigation bar use a light `color-mix()` tint of the accent or warning
  color. Without `color-mix()` support the tint is dropped, while the colored
  text and borders still carry the meaning.

Zone and controller tiles use a fixed 6px corner radius so the two tile
families match. Zone photos use 4px, nested inside the tile. The only
hard-coded colors besides the fallbacks above are the detail panel's
translucent black backdrop and shadow.

## Layout

Each zone tile is a full-width header (state icon and name) above a
two-column body: photo on the left, status and controls on the right. Each
tile is its own CSS container. A single `@container` rule for tiles 220px or
narrower stacks the name, a 16:9 photo, and the controls. Browsers without
container-query support keep the two-column layout.

## Overriding

Set any `--yardian-*` variable in a Home Assistant theme (`frontend: themes:`),
written without the leading `--`, to change this card without changing the
rest of the dashboard. See [examples/theme.yaml](../examples/theme.yaml) for
a fragment that sets `yardian-accent-color` and `yardian-warning-color` for
light and dark modes.

Because the card honors the active theme rather than imposing a palette, some
third-party themes can produce low-contrast combinations, for example a pale
`--primary-color` behind `--text-primary-color` on the Run button. Override
the relevant `yardian-*` variable if that happens. Check appearance under
both the default light and dark themes after changing styles.
