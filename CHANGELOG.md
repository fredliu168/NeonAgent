# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on Keep a Changelog, with versions tracked alongside Git tags such as `v0.1.2`.

## [0.1.5] - 2026-06-08

### Added
- Added a feature switch for blocking common browser developer-mode / DevTools detection checks.
- Added runtime masking for `devtoolschange`, `outerWidth` / `outerHeight` size-difference checks, and `window.devtools`.
- Added blocking for page-level `window.clearLog` and `console.clear` when DevTools detection blocking is enabled.

### Changed
- Updated README and side-panel about text to document the new developer-mode detection blocking capability.

## [0.1.4] - 2026-06-08

### Changed
- Updated feature-switch saves so they only apply the relevant page settings instead of reapplying translation settings.
- Added a user-facing warning below “解除右键限制” that the setting may affect website behavior and should be disabled when not needed.

### Fixed
- Fixed the settings page jumping away from the current checkbox after toggling feature switches.
- Reduced layout changes from feature-switch saves by avoiding unnecessary success-status and local-command refresh updates.

## [0.1.3] - 2026-06-08

### Added
- Added a per-provider `翻译 Model` setting in API configuration, with fallback to the main model when left empty.
- Added word-detail translation cards for double-clicked English words, including pronunciation and part of speech.
- Added provider list management UI for saved model vendors, including enable, edit, test, and delete actions.

### Changed
- Updated translation requests to prefer non-thinking models for translation workloads when the configured model is a thinking/reasoner variant.
- Updated translation requests for Qwen to send `enable_thinking: false`.
- Updated translation requests for DeepSeek, `ds-v4-flash`, and `ds-v4-pro` to send `thinking: { "type": "disabled" }`.
- Updated current-page translation so one-off translation no longer leaves automatic page translation enabled afterward.
- Updated README with a user-facing summary of the new API configuration and translation behavior.

### Fixed
- Fixed repeated translation on text that is already in the target language for double-click, text selection, and full-page translation.
- Fixed page translation to process paragraphs one by one instead of issuing concurrent translation requests.
- Fixed word-lookup popups so pronunciation and part of speech render inline with the source word instead of on a separate line.

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
