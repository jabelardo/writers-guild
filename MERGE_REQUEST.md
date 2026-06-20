# Merge Request: Image preservation, greeting selector, preview mode, character import

**11 files changed, 692 insertions, 36 deletions**

---

## Changes

### 1. Image Preserver Service (new) — `server/src/services/image-preserver.js`
New service that extracts embedded images (markdown `![]()` and HTML `<img>`) from story content before sending to the LLM, replaces them with `[WG_IMAGE_X]` placeholders, and restores them after generation. Handles both `![alt](url)` and `![alt] (url)` syntax.

### 2. Image preservation integration — `server/src/routes/stories.js`
Integrated `ImagePreserver` into `streamGeneration()`:
- Extracts images before prompt building, restores after generation
- Works for streaming, polling (AI Horde), and non-streaming providers
- For `rewriteThirdPerson`: appends instruction telling LLM to preserve `[WG_IMAGE_X]` markers
- Sends `imagesRestored`, `imagesPreserved`, `imagesMissing` flags to client

### 3. Stream parser fix — `server/src/services/providers/shared/stream-parser.js`
Fixes a bug where providers that only signal completion via `[DONE]` sentinel (without a `finish_reason` chunk) would never trigger downstream finalization (image restoration). Now emits a synthetic `{ finished: true }` chunk on `[DONE]`, and also emits `finished: true` if the stream ends without an explicit finished chunk.

### 4. Language requirement — `server/src/services/default-presets.js`
Added `LANGUAGE REQUIREMENT` to system prompt: "You MUST write in the exact same language as the existing story content. Do NOT switch to English." Prevents LLM from defaulting to English when story is in another language.

### 5. Character JSON import — `server/src/routes/characters.js`
- Added `POST /characters/import-json` endpoint for importing standalone `.json` character cards
- Supports both V2 (with `data` wrapper) and flat formats
- Extracts embedded lorebooks (`character_book`) and associates with imported character
- Added `image/webp` and `image/avif` to allowed upload MIME types

### 6. Dev deps — `server/package.json`
Added `node-addon-api` and `node-gyp`.

### 7. Import modal UI — `vue_client/src/components/ImportCharacterModal.vue`
Redesigned import UI:
- **"Import from Photos"**: pick PNG/JPEG from photo gallery
- **"Import from Storage"**: browse local files, auto-detects image vs `.json`
- Added JSON file import support
- Added `charactersAPI.importJSON(file)` to `vue_client/src/services/api.js`

### 8. Preview mode — `vue_client/src/views/StoryEditor.vue`
- Added toggle button (eye icon) in header to switch between text editor and rendered preview
- `renderedContent` computed: converts markdown `![]()` to `<img>`, escapes HTML, wraps paragraphs
- Preview defaults ON if story has images (`hasImages` computed)
- `:deep()` selector used for scoped CSS on `v-html`-injected images
- Responsive image sizing: phone (≤480px), tablet (481–1024px), desktop (≥1025px)

### 9. Preview input bar — `vue_client/src/views/StoryEditor.vue`
When preview mode is on, a bottom input bar appears with text input and Send button. Typing a message and pressing Enter or clicking Send adds it to the story and triggers a character response. Includes null-guard for `editorRef` when textarea is hidden.

### 10. Image normalization — `vue_client/src/views/StoryEditor.vue`
`normalizeMarkdownImageSpacing()` normalizes `![alt] (url)` → `![alt](url)` on save to ensure consistent syntax.

### 11. Greeting selector flow — `vue_client/src/views/StoryEditor.vue`
When a new story is created with `needsRewritePrompt` flag and has characters, the greeting selector is shown FIRST (before the rewrite dialog). The rewrite dialog only appears after a greeting is selected.

### 12. Greeting selector on character detail — `vue_client/src/views/CharacterDetail.vue`
"New Story" button now shows greeting selector modal first. User selects a greeting, it's added to story, then navigates to story editor. Close without selection still navigates.

### 13. Image restoration in rewrite — `vue_client/src/views/StoryEditor.vue`
Handles server-side `imagesRestored` event in `rewriteToThirdPerson()`. When server sends back restored images via `finalContent`, the rewrite content is replaced with the server's restored version.

### 14. Viewport fix — `vue_client/src/style.css`
Added `height: 100dvh` fallback alongside `100vh` on `body`. Fixes bottom-content truncation on tablets where browser chrome occupies real viewport space.

---

## Files changed

| File | Changes |
|---|---|
| `server/src/services/image-preserver.js` | **New file** — 133 lines |
| `server/src/routes/stories.js` | +90/-14 — ImagePreserver integration |
| `server/src/routes/characters.js` | +87/-5 — JSON import endpoint |
| `server/src/services/default-presets.js` | +2 — Language requirement |
| `server/src/services/providers/shared/stream-parser.js` | +24/-3 — Finished-event fix |
| `server/package.json` | +2 — dev deps |
| `vue_client/src/views/StoryEditor.vue` | +241/-2 — Preview mode, input bar, greeting flow, normalization, image restore |
| `vue_client/src/views/CharacterDetail.vue` | +52/-9 — Greeting selector on new story |
| `vue_client/src/components/ImportCharacterModal.vue` | +78/-6 — Photos + Storage import |
| `vue_client/src/services/api.js` | +18 — importJSON method |
| `vue_client/src/style.css` | +1 — 100dvh viewport fix |