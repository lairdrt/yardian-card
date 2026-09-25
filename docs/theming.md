# Theming

`yardian-card` is styled from Home Assistant theme variables through a small
layer of `--yardian-*` custom properties. It does not depend on `card-mod`.
All styles live in `src/styles.ts`.

## Color variables

Every color the card uses comes from a `--yardian-*` variable. Each one is
resolved in this order:

1. the `--yardian-*` variable, if a theme (or anything above the card) sets it;
2. the Home Assistant semantic variable(s) listed below;
3. a literal fallback, only when none of those is set.

Internally the card copies each resolved value into a private `--_yardian-*`
token and component rules read only those. The private names are not a
supported override surface; set the public `--yardian-*` names.

| Card variable | Reads (in order) | Literal fallback | Used for |
| --- | --- | --- | --- |
| `--yardian-background` | `--ha-card-background`, `--card-background-color` | `#ffffff` | Card background, duration dropdown, detail panel |
| `--yardian-surface-color` | `--secondary-background-color` | `rgba(0, 0, 0, 0.04)` | Zone tiles, controller tiles, photo placeholder |
| `--yardian-text-primary` | `--primary-text-color` | `#212121` | Zone names, tile values, detail panel text |
| `--yardian-text-secondary` | `--secondary-text-color` | `#727272` | State text, labels, icons, Last active, build identifier |
| `--yardian-border-color` | `--divider-color` | `#e0e0e0` | Photo border, dropdown, quick-duration buttons, detail dividers |
| `--yardian-tile-border-color` | `--yardian-border-color` (above) | as above | Outline of zone tiles, controller tiles, and the detail panel |
| `--yardian-accent-color` | `--primary-color`, `--accent-color` | `#03a9f4` | Run button, selected quick duration, "on" controller tiles, "Started here", focus outline |
| `--yardian-action-foreground` | `--mdc-theme-on-primary`, `--text-primary-color` | `#ffffff` | Text and icon on the filled Run and zone Stop buttons |
| `--yardian-warning-color` | `--error-color` | `#db4437` | Zone Stop button, Stop Irrigation bar, unavailable state, configuration errors |

`--mdc-theme-on-primary` is Home Assistant's "text on primary color"
variable. The stock themes define it as `--text-primary-color`, so they render
the same either way. It is read first because some themes set
`--text-primary-color` to a light grey that matches a light `--primary-color`,
which would leave the Run button's label invisible, while setting
`--mdc-theme-on-primary` to a contrasting color.

## Layout variables

| Card variable | Default | Effect |
| --- | --- | --- |
| `--yardian-zone-tile-min-width` | `240px` | Minimum zone tile width in the zone grid before tiles wrap |
| `--yardian-tile-min-width` | `120px` | Minimum controller tile width |
| `--yardian-tile-gap` | `6px` | Gap between controller tiles |

## Other Home Assistant variables read directly

| Variable | Fallback | Used for |
| --- | --- | --- |
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
- **Unused zones** (`unused: true`): the tile's contents are dimmed to 55%
  opacity and the name is italic. The tile surface and outline stay at full
  strength so the tile doesn't fade into a dark card background.
- **Controller tiles:** "on" tiles use the accent color for icon and value,
  unavailable tiles use the warning color, and "Not configured" tiles are
  dimmed.
- **Selected quick duration:** accent-colored border doubled by an inset ring,
  accent text, and an accent tint. Keyboard focus is a separate accent outline
  drawn outside the control, so focus and selection look different.
- **Tints:** the selected quick duration, the "Started here" badge, and the
  Stop Irrigation bar use a light `color-mix()` tint of the accent or warning
  color. Without `color-mix()` support the tint is dropped, while the colored
  text and borders still carry the meaning.

Zone and controller tiles use a fixed 6px corner radius so the two tile
families match. Zone photos use 4px, nested inside the tile. The only
hard-coded colors besides the fallbacks above are the detail panel's
translucent black backdrop and shadow.

## Surfaces and dark themes

The card has four surface layers: the card itself, tiles (zone and
controller), nested controls and photos, and the detail overlay. Many dark
themes set `--ha-card-background`, `--secondary-background-color` and
`--primary-background-color` to the same color, which makes tile backgrounds
disappear. So tile separation does not depend on background contrast alone:
zone tiles, controller tiles and the detail panel carry a 1px
`--yardian-tile-border-color` outline, and nested controls and photos a 1px
`--yardian-border-color` outline. Both come from the theme's
`--divider-color` by default, so they are subtle under ordinary themes.

The card does not switch to its own dark palette. If a theme's divider color
is too faint to separate tiles, set `yardian-tile-border-color` (and, if you
want tiles lifted off the card, `yardian-surface-color`) in that theme.

## Layout

Each zone tile is a full-width header (state icon and name) above a
two-column body: photo on the left, status and controls on the right. Each
tile is its own CSS container. A single `@container` rule for tiles 220px or
narrower stacks the name, a 16:9 photo, and the controls. Browsers without
container-query support keep the two-column layout.

## Overriding

Set any `--yardian-*` variable in a Home Assistant theme (`frontend: themes:`),
written without the leading `--`, to change this card without changing the
rest of the dashboard. Theme variables reach the card by inheritance, and the
card never declares the public `--yardian-*` names itself, so a theme value
always takes effect. See [examples/theme.yaml](../examples/theme.yaml) for
a fragment that sets `yardian-accent-color` and `yardian-warning-color` for
light and dark modes.

Because the card honors the active theme rather than imposing a palette, some
third-party themes can still produce low-contrast combinations, for example a
pale `--primary-color` with neither `--mdc-theme-on-primary` nor
`--text-primary-color` set to a dark color. Override the relevant `yardian-*`
variable (for that case, `yardian-action-foreground`) if that happens. Check appearance under
both the default light and dark themes after changing styles.
