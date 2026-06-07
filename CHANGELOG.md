# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on Keep a Changelog, with versions tracked alongside Git tags such as `v0.1.2`.

## [0.1.2] - 2026-06-07

### Added
- Added provider-based API configuration with preset vendor tabs for Kimi, MiniMax, and DeepSeek.
- Added a configuration list view with enable, edit, test, and delete actions for saved model providers.
- Added extension icons and an icon generation script for release packaging.
- Added an API key visibility toggle inside the input field.
- Added this `CHANGELOG.md` to keep future releases easier to review.

### Changed
- Updated the side panel layout: settings now contains sub-tabs for configuration, page content, and about information.
- Unified chat and agent input areas to support inline model switching and a shared send/stop button pattern.
- Moved page reading into the settings area and improved page content display behavior.
- Made feature switches and translation switches apply immediately when toggled, without requiring an extra save step.
- Improved release automation to use `npm ci`, cache npm dependencies, and generate GitHub release notes automatically.
- Updated CI to run with Node.js 22 and opt into Node 24-compatible GitHub Actions execution.

### Fixed
- Avoided duplicate current-page translations for nested list and paragraph structures.
- Reduced re-render flicker during repeated translation scans.
- Fixed translation status checks so already translated pages are not translated again.
- Fixed send/stop button state recovery after model responses complete.
- Fixed agent reasoning display so the current answer's thinking content renders in the correct place.
- Fixed saved provider handling so newly added providers move from the `+` editor into the configuration list after saving.
- Restored compatibility in config migration and translation DOM handling so automated tests and CI pass reliably.

## [0.1.1] - 2026-06-07

### Added
- Published the first packaged release workflow for NeonAgent.
