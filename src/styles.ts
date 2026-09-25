/**
 * Card styles.
 *
 * Presentation values are sourced from standard Home Assistant theme
 * variables first, via a layer of `--yardian-*` custom properties that a
 * user theme or dashboard can override without touching global HA
 * variables. See docs/theming.md for the documented override surface.
 *
 * Both the controller chip grid and the zone tile grid use
 * `repeat(auto-fit, minmax(...))`, each with its own minimum-width
 * custom property (--yardian-tile-min-width for controller chips,
 * --yardian-zone-tile-min-width for zone tiles, since a zone tile
 * carries a photo + dropdown a status chip doesn't), so both show as
 * many tiles per row as comfortably fit and wrap gracefully otherwise.
 *
 * Variable layering: the public --yardian-* names are never declared
 * here, only read. Declaring them on :host would shadow any value a
 * theme sets (theme variables reach the card by inheritance, and a
 * declaration on the element always beats an inherited value). Instead
 * each public name seeds a private --_yardian-* token, in the order
 * Yardian override -> HA semantic variable(s) -> literal fallback, and
 * component rules read only the private tokens.
 *
 * Surface layers: card (--_yardian-background) -> tile
 * (--_yardian-surface-color, outlined by --_yardian-tile-border-color so
 * tiles stay visible when a theme makes card and secondary backgrounds
 * identical) -> nested controls/photo (card background again, outlined
 * by --_yardian-border-color) -> detail overlay.
 */
export const CARD_STYLES = `
  :host {
    --_yardian-background: var(--yardian-background, var(--ha-card-background, var(--card-background-color, #ffffff)));
    --_yardian-surface-color: var(--yardian-surface-color, var(--secondary-background-color, rgba(0, 0, 0, 0.04)));
    --_yardian-text-primary: var(--yardian-text-primary, var(--primary-text-color, #212121));
    --_yardian-text-secondary: var(--yardian-text-secondary, var(--secondary-text-color, #727272));
    --_yardian-border-color: var(--yardian-border-color, var(--divider-color, #e0e0e0));
    --_yardian-tile-border-color: var(--yardian-tile-border-color, var(--_yardian-border-color));
    --_yardian-accent-color: var(--yardian-accent-color, var(--primary-color, var(--accent-color, #03a9f4)));
    --_yardian-warning-color: var(--yardian-warning-color, var(--error-color, #db4437));
    /* Text on a filled accent/warning button. --mdc-theme-on-primary is
       HA's "on primary" color (it defaults to --text-primary-color in the
       stock themes, so they render exactly as before); some themes set
       --text-primary-color to a light grey that matches a light
       --primary-color, and set --mdc-theme-on-primary correctly. */
    --_yardian-action-foreground: var(--yardian-action-foreground, var(--mdc-theme-on-primary, var(--text-primary-color, #ffffff)));

    /* Controller-tile sizing primitive (.chip-grid). */
    --_yardian-tile-min-width: var(--yardian-tile-min-width, 120px);
    --_yardian-tile-gap: var(--yardian-tile-gap, 6px);
    /* Zone-tile sizing: wide enough for the photo column + the
       status/controls column (.zone-body) side by side without crushing
       either. Zone tiles intentionally use their own minimum, not
       --yardian-tile-min-width -- they carry more content per tile than
       a controller status chip. */
    --_yardian-zone-tile-min-width: var(--yardian-zone-tile-min-width, 240px);

    display: block;
  }

  ha-card {
    background: var(--_yardian-background);
    color: var(--_yardian-text-primary);
    font-family: var(--paper-font-body1_-_font-family, inherit);
    padding: 12px 16px 16px;
  }

  .header {
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: 8px;
    margin-top: 10px;
  }

  .build {
    font-size: 0.68em;
    color: var(--_yardian-text-secondary);
    font-family: var(--code-font-family, monospace);
    opacity: 0.7;
    white-space: nowrap;
  }

  .section {
    margin-top: 10px;
  }

  .section-label {
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--_yardian-text-secondary);
    margin-bottom: 5px;
  }

  /* Zone tiles -- a responsive horizontal grid (one row on a wide-enough
     card, wrapping gracefully on narrower ones), each tile the same
     corner radius as a controller tile (.chip's 6px, not the card's own
     --ha-card-border-radius) so the two tile families read as one family. */

  .zone-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--_yardian-zone-tile-min-width), 1fr));
    gap: 8px;
  }

  /* Each tile is its own inline-size container so the one narrow-width
     fallback below (@container zone-tile) keys off the tile's own width,
     not the viewport or the card. */

  .zone-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 6px;
    background: var(--_yardian-surface-color);
    border: 1px solid var(--_yardian-tile-border-color);
    min-width: 0;
    container-type: inline-size;
    container-name: zone-tile;
  }

  /* Dim the tile's content, not the tile itself, so an unused tile's
     surface and border keep the same strength as its neighbours and it
     doesn't fade into a dark card background. */
  .zone-row.zone-unused > * {
    opacity: 0.55;
  }

  .zone-row.zone-unused .zone-name {
    font-style: italic;
  }

  /* Deliberately no .zone-row.state-on rule: running must not change the
     tile's background/border/color. Off vs Running is communicated only
     by the icon (zoneIcon), the state text (formatZoneState), and the
     Run/Stop button -- never by shading the whole tile. */

  .zone-row.state-unavailable {
    border-color: color-mix(in srgb, var(--_yardian-warning-color) 55%, transparent);
  }

  .zone-row.state-unavailable .zone-icon,
  .zone-row.state-unavailable .zone-state {
    color: var(--_yardian-warning-color);
  }

  .zone-row.state-unknown .zone-state {
    font-style: italic;
  }

  /* Row 1: zone header, spanning the full tile width: the zone-state icon
     followed by the name. State text and controls live in the body's
     right column, never here. The name shrinks (min-width: 0) so long
     names ellipsize instead of pushing the icon out. */

  .zone-header {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .zone-name {
    display: block;
    min-width: 0;
    font-size: 0.9em;
    font-weight: 600;
    line-height: 1.25;
    color: var(--_yardian-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Row 2: [photo | status + controls]. A fixed two-column grid (~45/55)
     whose composition does not change with width; only the single
     @container fallback below rearranges it. flex: 1 lets the body take
     up any extra height when a neighbouring tile in the same outer grid
     row is taller, so photos in one row stay the same height. */

  .zone-body {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: minmax(0, 9fr) minmax(0, 11fr);
    gap: 8px;
    min-height: 112px;
  }

  /* Photo fills the whole left column: the grid cell stretches to the
     body's height and the image is absolutely positioned inside it, so
     its intrinsic size can never inflate the row. Nested inside the 6px
     tile with 8px padding, so it uses a smaller 4px radius. */

  .zone-photo {
    position: relative;
    min-width: 0;
    border-radius: 4px;
    overflow: hidden;
    background: var(--_yardian-surface-color);
    border: 1px solid var(--_yardian-border-color);
  }

  .zone-photo-img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .zone-photo-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--_yardian-text-secondary);
  }

  .zone-photo-placeholder ha-icon {
    --mdc-icon-size: 26px;
    opacity: 0.5;
  }

  /* Right column: a plain top-aligned vertical stack -- status, last
     active, [duration / Run-Stop], quick durations. No
     space-between, so nothing drifts apart as the tile grows. */

  .zone-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .zone-status {
    min-width: 0;
    max-width: 100%;
  }

  .zone-icon {
    --mdc-icon-size: 18px;
    color: var(--_yardian-text-secondary);
    flex-shrink: 0;
  }

  .zone-state {
    min-width: 0;
    font-size: 0.76em;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--_yardian-text-secondary);
  }

  .zone-panel .zone-last-active {
    max-width: 100%;
  }

  /* Duration dropdown above Run/Stop, always together and left-aligned.
     The button shares the dropdown's 70px minimum width and 30px height
     so the pair reads as one block. */

  .zone-controls {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .zone-controls .zone-action-btn {
    min-width: 70px;
    height: 30px;
    box-sizing: border-box;
  }

  /* Single fallback for genuinely narrow tiles: name, photo, then the
     status/controls stack, all full width. The photo gets its own 16:9
     box because it no longer has a sibling column to stretch against. */

  @container zone-tile (max-width: 220px) {
    .zone-body {
      grid-template-columns: minmax(0, 1fr);
      min-height: 0;
    }

    .zone-photo {
      aspect-ratio: 16 / 9;
    }
  }

  /* Duration dropdown -- locked at exactly 70x30, immune to flex/grid
     stretch or shrink: no grow/shrink (flex: none, so it holds in the
     column-direction .zone-controls stack too), explicit width/height,
     and box-sizing so padding/border can't inflate it past that size.
     Text/arrow vertical centering comes from the fixed height plus zero
     top/bottom padding, which is how browsers render a <select>'s
     content centered by default. */

  .zone-duration {
    flex: none;
    width: 70px;
    height: 30px;
    box-sizing: border-box;
    padding: 0 4px 0 6px;
    border-radius: 6px;
    border: 1px solid var(--_yardian-border-color);
    background: var(--_yardian-background);
    color: var(--_yardian-text-primary);
    font-size: 0.78em;
    font-family: inherit;
  }

  .zone-duration:disabled {
    opacity: 0.5;
  }

  .zone-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 7px 12px;
    border: none;
    border-radius: 6px;
    color: var(--_yardian-action-foreground);
    font-size: 0.78em;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .zone-action-btn.zone-run-btn {
    background: var(--_yardian-accent-color);
  }

  .zone-action-btn.zone-stop-btn {
    background: var(--_yardian-warning-color);
  }

  .zone-action-btn ha-icon {
    --mdc-icon-size: 16px;
  }

  .zone-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Global stop control */

  .stop-section {
    margin-top: 10px;
    margin-bottom: 10px;
  }

  .stop-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--ha-card-border-radius, 8px);
    border: 1px solid var(--_yardian-warning-color);
    background: color-mix(in srgb, var(--_yardian-warning-color) 12%, transparent);
    color: var(--_yardian-warning-color);
    cursor: pointer;
  }

  .stop-button ha-icon {
    --mdc-icon-size: 20px;
  }

  .stop-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .stop-button-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.25;
  }

  .stop-button-label {
    font-size: 0.85em;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .stop-button-hint {
    font-size: 0.68em;
    font-weight: 400;
    opacity: 0.8;
  }

  /* Controller status chips (the device-identity tile is the first .chip
     in this grid -- see _renderDeviceTile -- deliberately reusing this
     exact markup/sizing so it's a peer, not a banner). */

  .chip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--_yardian-tile-min-width), 1fr));
    gap: var(--_yardian-tile-gap);
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 8px;
    /* 1px less padding than before on each side to absorb the 1px border,
       so the chip's outer size is unchanged. */
    padding: 5px 7px;
    border-radius: 6px;
    background: var(--_yardian-surface-color);
    border: 1px solid var(--_yardian-tile-border-color);
    min-width: 0;
  }

  .chip-icon {
    --mdc-icon-size: 18px;
    color: var(--_yardian-text-secondary);
    flex-shrink: 0;
  }

  .chip-text {
    min-width: 0;
  }

  .chip-label {
    font-size: 0.66em;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--_yardian-text-secondary);
  }

  .chip-value {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--_yardian-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip.state-on .chip-icon,
  .chip.state-on .chip-value {
    color: var(--_yardian-accent-color);
  }

  .chip.state-unavailable .chip-icon,
  .chip.state-unavailable .chip-value {
    color: var(--_yardian-warning-color);
  }

  .chip.state-missing .chip-icon,
  .chip.state-missing .chip-value {
    opacity: 0.55;
  }

  /* Click affordance. Purely a cursor hint -- see _handleClick; which
     clicks actually do something is decided there, not here. */

  [data-more-info-entity],
  [data-zone-detail] {
    cursor: pointer;
  }

  /* Keyboard focus: an offset accent outline, kept outside the control
     so it never reads as the selected quick-duration state (an inset
     ring) and stays visible on filled Run/Stop buttons. */
  button:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--_yardian-accent-color);
    outline-offset: 2px;
  }

  /* Provable card-issued attribution (see _reconcileStartedHere). */

  .zone-source {
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--_yardian-accent-color) 16%, transparent);
    color: var(--_yardian-accent-color);
    font-size: 0.86em;
    font-weight: 600;
    letter-spacing: 0;
  }

  .zone-last-active {
    font-size: 0.7em;
    color: var(--_yardian-text-secondary);
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Informational controller conditions, shown in the zone detail panel
     only (zone tiles no longer repeat them). */

  .zone-conditions {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.7em;
    line-height: 1.25;
    color: var(--_yardian-text-secondary);
  }

  .zone-conditions ha-icon {
    --mdc-icon-size: 14px;
    flex-shrink: 0;
  }

  /* Quick-duration shortcuts. Wrap rather than overflow on narrow tiles. */

  .zone-quick-durations {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .zone-quick-btn {
    flex: 0 0 auto;
    min-width: 30px;
    padding: 3px 7px;
    border-radius: 999px;
    border: 1px solid var(--_yardian-border-color);
    background: transparent;
    color: var(--_yardian-text-secondary);
    font-size: 0.72em;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  /* Selected: accent border doubled by an inset ring (no size change) plus
     a tint, so it stays obvious when the accent is a grey that sits close
     to the unselected border/text colors (monochrome/e-ink themes). */
  .zone-quick-btn.is-selected {
    border-color: var(--_yardian-accent-color);
    box-shadow: inset 0 0 0 1px var(--_yardian-accent-color);
    background: color-mix(in srgb, var(--_yardian-accent-color) 20%, transparent);
    color: var(--_yardian-accent-color);
  }

  .zone-quick-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Recent observed activity list (zone detail panel). */

  .activity-strip {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .activity-item {
    font-size: 0.76em;
    color: var(--_yardian-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Zone detail panel. */

  .zone-detail-overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.45);
  }

  .zone-detail-panel {
    width: 100%;
    max-width: 420px;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: var(--ha-card-border-radius, 8px);
    background: var(--_yardian-background);
    color: var(--_yardian-text-primary);
    /* The border keeps the panel separate from the backdrop when the
       card background is as dark as the dimmed page behind it. */
    border: 1px solid var(--_yardian-tile-border-color);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .zone-detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .zone-detail-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 1.05em;
    font-weight: 600;
    min-width: 0;
  }

  .zone-detail-close {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--_yardian-text-secondary);
    cursor: pointer;
  }

  .zone-detail-photo {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 6px;
  }

  .zone-detail-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.85em;
    color: var(--_yardian-text-secondary);
  }

  .zone-detail-row span:last-child {
    color: var(--_yardian-text-primary);
    font-weight: 600;
    text-align: right;
  }

  .zone-detail-row .state-on {
    color: var(--_yardian-accent-color);
  }

  .zone-detail-source {
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--_yardian-accent-color) 16%, transparent);
    color: var(--_yardian-accent-color);
    font-size: 0.74em;
    font-weight: 600;
  }

  .zone-detail-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--_yardian-border-color);
  }

  .zone-detail-more-info {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--_yardian-border-color);
    border-radius: 6px;
    background: transparent;
    color: var(--_yardian-text-primary);
    font-size: 0.8em;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .zone-detail-more-info ha-icon {
    --mdc-icon-size: 16px;
  }

  .card-error {
    color: var(--_yardian-warning-color);
    white-space: pre-wrap;
    font-family: var(--code-font-family, monospace);
    font-size: 0.9em;
  }
`;
