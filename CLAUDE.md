# CLAUDE.md

## Project

This repository contains `yardian-card`, a custom Home Assistant Lovelace card for the Yardian Pro irrigation controller.

The card is intended to provide a clean, local Home Assistant UI for Yardian status and control while preserving Home Assistant as the control boundary.

## Working Model

Claude should work incrementally and conservatively.

Before making significant changes:
1. inspect the relevant files;
2. understand the current known-good behavior;
3. identify the smallest change that satisfies the requested milestone;
4. avoid broad refactors unless they are explicitly requested or clearly necessary.

Do not rewrite working architecture merely because an alternative design is possible.

## Architecture Rules

- Home Assistant is the primary control boundary.
- The frontend card should use Home Assistant entities, services/actions, and state updates.
- Do not call the Yardian controller directly from browser/frontend code unless the project architecture is explicitly changed.
- Do not invent or assume undocumented Yardian API behavior.
- Only rely on Yardian capabilities that have been verified through Home Assistant, `pyyardian`, controller responses, or documented behavior.
- Keep the card independent from any future custom backend integration where practical.
- Separate UI concerns from backend/controller concerns.

See `docs/ARCHITECTURE.md` for enduring architectural decisions.

## Home Assistant Compatibility

Use native Home Assistant frontend conventions wherever practical.

The card must:
- consume the `hass` object supplied by Home Assistant;
- use Home Assistant entity state as the authoritative UI state;
- use Home Assistant actions/services for control;
- react correctly when entities become unavailable or are missing;
- avoid assumptions that entity IDs will always use one exact naming scheme unless configuration explicitly supplies them.

Do not introduce `card-mod` or another external frontend dependency as a requirement.

## Theming

Theme compatibility is a core requirement.

- Do not hard-code presentation colors when an appropriate Home Assistant CSS variable exists.
- Inherit standard Home Assistant theme variables first.
- Expose documented `--yardian-*` CSS custom properties for card-specific overrides where useful.
- Support both light and dark Home Assistant themes.
- Avoid styling choices that make the card unreadable under arbitrary user themes.

Theme behavior should be documented in `docs/theming.md`.

## Development Style

Prefer:
- TypeScript;
- small focused modules;
- explicit types;
- readable code over clever code;
- minimal dependencies;
- predictable state flow;
- defensive handling of unavailable entities;
- deterministic behavior.

Avoid:
- large frameworks unless clearly justified;
- unnecessary abstractions;
- hidden global state;
- duplicated controller logic in the frontend;
- speculative future features that are not part of the current milestone.

## Build and Version Identification

The card must expose a visible build/version identifier in the UI during development.

This is important for confirming which build is actually loaded by Home Assistant and for avoiding browser-cache confusion.

Do not remove the visible build identifier unless explicitly requested.

## Generated Files

`dist/` is generated build output.

Do not manually edit files in `dist/`.

Modify source files and rebuild instead.

## Testing

For every implementation milestone:

1. build the project;
2. fix TypeScript/build errors;
3. verify that generated output is produced;
4. describe exactly what changed;
5. state what should be tested manually in Home Assistant;
6. stop at the requested milestone.

Do not continue into unrelated features without being asked.

## Change Discipline

Preserve known-good behavior.

When debugging:
- identify the failing layer first;
- form a specific hypothesis;
- prefer a discriminating test over speculative patches;
- investigate upstream Home Assistant or Yardian behavior when appropriate;
- avoid stacking workaround upon workaround.

If two or more attempted fixes fail, stop and reassess the underlying assumption before continuing.

## Scope Control

When given a prompt for one milestone, complete that milestone and stop.

Do not:
- redesign unrelated parts of the project;
- rename broad areas of the codebase without need;
- add speculative features;
- change architecture silently;
- perform cleanup unrelated to the requested work.

If a larger change appears necessary, explain why before implementing it.

## Communication

At the end of each task, report:

- files changed;
- concise summary of implementation;
- build/test result;
- any assumptions made;
- exact manual verification steps;
- anything that remains uncertain.

Keep reports concise and technical.

## Current Known Yardian Constraints

The current project targets a Yardian Pro controller using Home Assistant's Yardian integration.

Known useful Home Assistant-facing capabilities include:
- six physical irrigation zones;
- timed zone start;
- global irrigation stop;
- active-zone state;
- rain-delay state;
- watering-running state;
- freeze-prevention state;
- standby state;
- zone-delay information;
- water-hammer-duration information.

Do not assume full Yardian schedule/program management is available through the current local API.

## Safety

Irrigation control affects physical hardware.

Do not:
- trigger irrigation automatically during development;
- issue controller-changing calls during tests unless explicitly requested;
- assume a test environment is isolated from real valves.

Prefer rendering/state tests before live control tests.