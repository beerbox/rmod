# Local server API notes (verified 2026-10-09; re-verify with /docs-check and /probe-local-servers)

All requests are loopback HTTP GETs with no body. Use `127.0.0.1`, not `localhost`, because on macOS `localhost` may resolve to `::1` first.

## Ollama (default `http://127.0.0.1:11434`, overridable with `OLLAMA_HOST`)

| Purpose | Request | Notes |
|---|---|---|
| liveness and version | `GET /api/version` → `{ "version": "x.y.z" }` | Any 2xx means up. `GET /` returns the plain text "Ollama is running". |
| available models | `GET /api/tags` → `{ models: [{ name, model, modified_at, size, digest, details: { format, family, families, parameter_size, quantization_level, runner? } , capabilities? }] }` | Seen on 0.40.2: `capabilities[]` (e.g. `completion`, `tools`, `embedding`) and `details.runner` (`mlx`). MLX models report `parameter_size` / `quantization_level` as `""`, so treat empty strings as unknown. |
| loaded models | `GET /api/ps` → `{ models: [{ name, model, size, digest, details{…}, expires_at, size_vram, context_length }] }` | Loaded means present in this list. |
| Claude Code via Ollama | `ANTHROPIC_BASE_URL=http://localhost:11434` `ANTHROPIC_AUTH_TOKEN=ollama` | Serves `/v1/messages`. The local server ignores the key. |

The local server needs no auth. The Ollama macOS app runs in the menu bar, and `ollama serve` runs it headless.

## LM Studio (default `http://127.0.0.1:1234`)

The server must be started in the app (Developer tab) or with `lms server start`. The headless daemon also works.

| Purpose | Request | Notes |
|---|---|---|
| liveness and models (native v1, recommended) | `GET /api/v1/models` → `{ models: [{ type: "llm"\|"embedding", publisher, key, display_name, architecture, quantization: { name, bits_per_weight }, size_bytes, params_string, loaded_instances: [{ id, config }], max_context_length, format, capabilities, … }] }` | Loaded means `loaded_instances.length > 0`. Use `key` as the id. `quantization` (and its `name`, `bits_per_weight`) and `params_string` may be `null`. Embedding entries omit `architecture`, `capabilities` and `description`. |
| fallback (OpenAI-compatible) | `GET /v1/models` → `{ data: [{ id, object, owned_by }] }` | No loaded state, so loaded is shown as unknown. |
| auth | `Authorization: Bearer <token>` when "require API token" is on | 401 without it means up, auth required. |
| Claude Code via LM Studio | Anthropic-compatible `/v1/messages` | Follow LM Studio's current Claude Code guide for the env vars. |

Other native endpoints exist (`/api/v1/chat`, `/api/v1/models/load`, `/unload`, `/download`). rmod must **not** call them, because rmod is read-only.

## Ports rmod uses to classify tool calls (FR-4.1b)

Configured `ollamaUrl` and `lmstudioUrl` ports (defaults 11434 and 1234) on `127.0.0.1`, `localhost` or `[::1]`. CLI verbs: `ollama run`, `lms chat`. MCP name pattern: `localMcpToolPattern`.
