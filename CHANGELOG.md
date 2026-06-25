# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on Keep a Changelog, with versions tracked alongside Git tags such as `v0.1.2`.

## [0.1.20] - 2026-06-25

### Fixed
- Fixed one-click exam solving question extraction so exam shell text such as `本卷共...`、`已答/未答`、`我要交卷`、`正在作答`、`本题分数` and `待检查` is no longer misidentified as question stems.
- Fixed exam-root detection so outer exam containers are skipped when they only wrap real question blocks, reducing duplicate and polluted extracted questions.
- Added a regression test for noisy exam-title/stem cleanup to keep future extraction changes stable.

## [0.1.19] - 2026-06-25

### Added
- Added semantic interactive-element discovery and `smart_click`, plus site-level action memory so repeated button clicks on the same site can reuse previously successful selectors.
- Added page and element screenshot analysis tools so the agent can inspect visible UI regions with the configured vision-capable model.
- Added Excel reference-file import for ask/agent flows, including drag-and-drop upload and scoped reference-context injection during requests.

### Changed
- Updated agent session persistence to keep raw assistant/tool message history and loaded tool categories, making resumed sessions more faithful to the original tool state.
- Updated build output to bundle the `xlsx` runtime in release artifacts for the new Excel reference workflow.

### Fixed
- Fixed streamed agent history capture so thinking text, tool calls, and tool results are persisted and can be reused after refresh or later turns.

## [0.1.14] - 2026-06-09

### Fixed
- Fixed ask/agent thinking blocks so manual collapse state is preserved during streaming updates and agent re-renders.

## [0.1.13] - 2026-06-09

### Changed
- Updated ask/agent message areas with a centered gray scroll-to-bottom button that appears whenever the user is not at the bottom.
- Updated agent and settings scrolling behavior so manual scroll position is preserved instead of being forced back during renders.

### Fixed
- Fixed the message-flow wrapper layout so the composer remains visible and message lists keep their own scroll area.
- Fixed developer-tools detection blocking so normal `console.*` calls keep their original arguments and stack traces.

## [0.1.12] - 2026-06-09

### Changed
- Updated agent/code block rendering so copy buttons appear on hover and code fences can be copied directly from the message bubble.
- Updated tool-call cards so running tools show elapsed seconds, then auto-collapse once finished while remaining expandable.

## [0.1.11] - 2026-06-09

### Changed
- Updated ask/agent message bubbles to show hover actions below the bubble, with copy buttons and per-message timestamps for both user and assistant messages.
- Updated the unified ask/agent textareas to auto-resize with user input and shrink back after sending or switching sessions.
- Updated assistant/agent message rendering in the side panel to display common Markdown formatting instead of raw Markdown source.

### Fixed
- Fixed fullscreen-request blocking so blocked requests resolve quietly instead of surfacing uncaught `NotAllowedError` promise rejections on target sites.
- Fixed side-panel version labels so the manifest, HTML title, and visible UI version text now stay aligned with the released package version.

## [0.1.10] - 2026-06-09

### Added
- Added a custom agent model menu with an in-menu `Thinking` toggle and a width that follows the current model name.
- Added shared token-budget helpers for estimating request size and trimming overlong agent contexts before sending requests.

### Changed
- Hid the top-level conversation tab and moved the primary ask flow into the agent composer.
- Renamed user-facing conversation labels from “对话” to `ask` in the side panel.
- Updated the agent composer layout, including the model menu placement, input styling, and ask-focused controls.
- Updated page translation candidate collection so text-only `div` and `role="heading"` blocks can be translated without swallowing existing paragraph/header candidates.

### Fixed
- Fixed devtools-detection blocking so it no longer mutates page `console.*` arguments and interfere with site network/error handling.
- Fixed agent requests that could exceed model context limits by clamping stored `agentMaxTokens`, auto-retrying oversized requests with a safer output budget, and trimming earlier agent context when requests get too large.
- Fixed full-page translation misses on sites whose main copy is rendered inside text-only `div` containers rather than semantic paragraph tags.

## [0.1.9] - 2026-06-09

### Changed
- Updated the agent context-usage meter to include in-flight thinking text, tool-call arguments, and tool results during execution.
- Updated the agent-side token estimate so the context ring now changes continuously while the agent is running, instead of appearing static until the final answer.
- Updated README with the v0.1.9 agent context-meter behavior summary.

## [0.1.8] - 2026-06-08

### Added
- Added a chat-side `Thinking` toggle in the conversation composer, with local persistence across side-panel sessions.
- Added support for disabling thinking on `kimi-k2.5` and `kimi-k2.6` via `thinking: { "type": "disabled" }`.

### Changed
- Updated exam-answer requests so they no longer send prior chat history or page context.
- Updated exam-answer prompting so the answer-format instructions are injected as a temporary `systemPrompt`, while the user message only contains the current questions.
- Updated the exam quick-action button to use a compact lightning icon with gray default and highlighted hover states.
- Updated README with the v0.1.8 chat thinking and exam-mode behavior summary.

## [0.1.7] - 2026-06-08

### Added
- Added a `↻` retry icon next to in-progress and failed page translation blocks so users can manually retry a single paragraph.
- Added request-version guards for page translation retries so stale responses cannot overwrite newer retry results.

### Changed
- Updated page translation candidate selection to include article `header` text while still skipping navigation, footer, and sidebar regions.
- Updated README with the v0.1.7 translation stability and news-page compatibility notes.

### Fixed
- Fixed page translations that could remain stuck on `翻译中...` after repeated request failures by surfacing an error state and continuing later paragraphs.
- Fixed full-page translation on news pages so media containers such as `img`, `picture`, `figure`, `video`, and `iframe` are skipped instead of being replaced.
- Fixed BBC-style ad slot interference by skipping common Google ad and advertisement containers during translation scans.

## [0.1.6] - 2026-06-08

### Added
- Added built-in API provider presets for 火山引擎 and 硅基流动.
- Added default model lists for the new 火山引擎 and 硅基流动 provider presets.

### Removed
- Removed the legacy `bridge/codex-bridge` helper extension directory; the built-in local WebSocket command channel remains the recommended bridge path.

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
