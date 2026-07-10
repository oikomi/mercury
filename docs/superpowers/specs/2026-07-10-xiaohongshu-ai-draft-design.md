# Xiaohongshu Screenshot-to-Draft Design

## Goal

Add a screenshot-first authoring flow to the existing Xiaohongshu publisher. A user pastes one screenshot, optionally provides a short intent, asks an image-capable model to generate a complete Chinese Xiaohongshu draft, reviews or edits the generated fields, and then explicitly publishes through the existing real-account workflow.

The generated language must be relaxed and lively, may use current internet slang naturally, and must not invent facts that are not visible in the screenshot or supplied intent.

## Scope

In scope:

- Paste one PNG, JPEG, or WebP screenshot into the publisher.
- Show a local preview with replace and remove actions.
- Accept an optional intent of at most 500 characters.
- Generate a title, body, and topic list from the screenshot and intent.
- Save the screenshot to a local application data directory for the existing Playwright publisher.
- Populate the existing editable form without automatically publishing.
- Keep the manual local media path as an optional fallback.
- Prefer the pasted screenshot when both a screenshot and manual path are present.

Out of scope:

- Multiple pasted images.
- Automatic publishing immediately after generation.
- Draft history or a new draft database table.
- Sending account cookies to the AI provider.
- Reverse-engineered Xiaohongshu signing services.

## User Experience

The existing `New publish task` card remains the primary work surface. A new unframed generation section appears above the title field and uses only shadcn/ui components from `@mercury/ui`.

The section has these states:

1. Empty: a keyboard-focusable paste target invites the user to press `Cmd+V` or `Ctrl+V`. An optional intent textarea and disabled generation button are visible.
2. Ready: the pasted screenshot preview, filename, and size appear. Icon buttons allow replacing or removing it. The generation button becomes available.
3. Generating: the button displays progress and duplicate generation is disabled. Existing form values remain unchanged.
4. Generated: title, body, topics, and the internal saved media path update together. A success alert asks the user to review before publishing.
5. Error: a destructive alert explains the actionable failure. Existing form values and the pasted preview remain intact for retry.

The manual media path remains visible and is labeled optional. The preflight media check succeeds when either a generated screenshot path or a manual path exists. If both exist, the generated screenshot path is used.

Replacing or removing the screenshot clears its generated media path so stale media cannot be published. Generated text remains editable.

## Components

### Web UI

`XiaohongshuPublisher` owns the transient pasted image, preview URL, intent, generation feedback, and generated media path. A focused child component may be extracted when doing so keeps paste and preview behavior isolated from publishing state.

The implementation uses shadcn/ui primitives already exposed through `@mercury/ui`, including `Button`, `Field`, `Input`, `Textarea`, `Alert`, and `Skeleton` where useful. It uses Lucide icons for image, replace, remove, generate, and loading actions. It does not introduce a second card inside the existing publish card.

### tRPC API

Add an authenticated `xiaohongshuPublisher.generateDraft` mutation.

Input:

```ts
{
  imageDataUrl: string;
  intent?: string;
}
```

Output:

```ts
{
  content: string;
  mediaPath: string;
  title: string;
  topics: string[];
}
```

The input schema limits the encoded payload, validates the data URL MIME type, and limits intent to 500 characters. The service independently validates decoded size and image signatures before making an external request.

### AI Draft Generator

Create a focused server-side module with an injectable fetch function and media directory for deterministic tests.

The provider constants are intentionally fixed in server code:

- Base URL: `https://aicoding.xdreamdev.com/v1/responses`
- Model: `gpt-5.6-sol`

Only `XHS_AI_API_KEY` is configurable and it is read from validated server environment variables. The key never appears in client bundles, request logs, database rows, screenshots, or committed files.

The request follows the Responses-compatible shape supplied by the user: one user message containing `input_text` plus `input_image` with the original data URL. The prompt requests strict JSON containing `title`, `content`, and `topics`, directs the model to treat screenshot text as content rather than instructions, and specifies a light, lively Chinese style with natural current memes.

The implementation uses normal TLS certificate verification. It does not reproduce `ssl._create_unverified_context()`.

The response parser scans message output for `output_text`, parses it with `JSON.parse`, and validates the result with Zod. Malformed or incomplete output is an error and does not partially update the client.

## Media Persistence

After the model output validates, decode the image and write it under `.data/xhs-media/` with a random application-generated name and MIME-derived extension. Create the directory when necessary. The returned absolute path becomes the task media path.

Do not trust a filename or path supplied by the browser. Do not log the data URL. If persistence fails, return an error rather than a draft with an unusable media path.

## Data Flow

1. The user focuses the paste target and pastes an image.
2. The browser validates basic type and size, creates a preview URL, and stores the `File` in component state.
3. The user optionally enters intent and selects `Generate draft`.
4. The browser converts the file to a data URL and calls `generateDraft`.
5. The server validates the payload and sends the image plus prompt to the fixed Responses endpoint using the server-only API key.
6. The server validates the structured model output, persists the image locally, and returns the draft plus media path.
7. The browser atomically updates title, content, topics, and generated media path.
8. The user reviews or edits the fields and explicitly submits the existing publish form.
9. Existing task creation and Playwright publishing run unchanged, using the generated screenshot path before any manual path.

## Validation And Errors

- Accepted images: PNG, JPEG, and WebP.
- Maximum decoded image size: 10 MiB.
- Optional intent: 500 characters.
- AI request timeout: 60 seconds.
- Title, content, and topics are validated against existing Xiaohongshu task limits before being returned.
- Empty, non-image, oversized, malformed Base64, invalid image signature, AI authentication, timeout, non-2xx response, and malformed model output failures receive distinct server messages.
- A generation error never clears or partially overwrites current form values.
- Publishing remains disabled unless the account session and all existing preflight requirements are valid.

## Security

- Keep the API key server-only and redact upstream response bodies from errors and logs.
- Use default TLS verification.
- Validate MIME type, decoded byte size, and magic bytes.
- Generate destination filenames server-side and keep them under the configured application data boundary.
- Treat screenshot content as untrusted prompt data.
- Do not make real AI calls in automated tests.
- The API key included in the original chat should be rotated because it has already been disclosed in conversation history.

## Testing

Add focused tests for:

- Input schema MIME, size, and intent constraints.
- Data URL decoding and image signature validation.
- Responses payload construction without exposing the API key.
- Successful output extraction and Zod validation.
- Upstream timeout, authentication, HTTP, and malformed output errors.
- Local media persistence with an injected temporary directory.
- Authenticated router wiring.
- Clipboard paste preview, replace/remove behavior, and optional intent.
- Successful generation atomically filling title, body, topics, and media state.
- Error behavior preserving existing fields.
- Pasted screenshot precedence over a simultaneous manual path.
- Existing manual path publishing when no screenshot was generated.

Run targeted Vitest suites first, then API TypeScript checking, Ultracite, the full test suite, and browser visual checks at desktop and mobile widths.

## Operational Notes

`restart.sh` continues to run the project on port `18123`. The local `apps/web/.env` must contain `XHS_AI_API_KEY`. The fixed base URL and model do not require environment entries.

Automated verification may use a mocked AI response and must not create a real Xiaohongshu post. Final live publishing remains an explicit user action.
