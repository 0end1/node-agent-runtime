// ---- C7 OpenAI-compatible provider ----
// Injected backend: the core never imports this package; hosts/examples pick
// a concrete ModelProvider and hand it to the runtime.
export { OpenAIClientProvider } from "./openai-compatible.js";
export type { OpenAIClientOptions } from "./openai-compatible.js";
