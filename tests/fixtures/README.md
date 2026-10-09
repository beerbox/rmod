# Test fixtures (sanitized)

No tokens, user names, host names or personal paths. Digests are zeroed. Raw captures go to `raw/` (gitignored).

| File | Provenance |
|---|---|
| `ollama-version.json` | Real capture, Ollama 0.40.2, 2026-10-09 |
| `ollama-ps-empty.json` | Real capture, Ollama 0.40.2 (no model loaded) |
| `ollama-tags.json` | First entry real (MLX model: empty `parameter_size` / `quantization_level`); other two follow the same 0.40.2 shape |
| `ollama-tags-empty.json` | Empty inventory |
| `ollama-ps.json` | Shape from docs.ollama.com/api, same field set as 0.40.2 (loaded model) |
| `lmstudio-api-v1-models.json` | Shape from lmstudio.ai/docs/developer/rest/list (2026-10-09): one loaded LLM, one unloaded MLX LLM, one LLM with `quantization: null`, one embedding with null quantization fields. **Re-capture with `/probe-local-servers` when LM Studio is running.** |
| `lmstudio-api-v1-models-empty.json` | Empty inventory |
| `lmstudio-v1-models.json` | OpenAI-compatible fallback shape |
