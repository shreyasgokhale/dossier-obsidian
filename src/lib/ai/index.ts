import "server-only";

import { jobSourceContext } from "@/lib/jobs/source-context";
import { AiProvider } from "@/generated/prisma/enums";

import { loadAiConfig, type AiConfig } from "./config";
import { AiError } from "./errors";
import { providerOption } from "./provider-options";
import type { AIProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { LocalProvider } from "./providers/local";
import { LmStudioProvider } from "./providers/lmstudio";
import { MistralProvider } from "./providers/mistral";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

export { AiError } from "./errors";
export type { AIProvider, ChatMessage, CompletionRequest, JsonCompletionRequest } from "./provider";

/** A provider for `config`. A saved key that can't be read stops hosted providers with a clear message. */
export function createProvider(config: AiConfig, { rejectRedirects = false } = {}): AIProvider {
  const { provider, baseUrl, model, apiKey, apiKeyProblem, timeoutMs } = config;
  if (apiKeyProblem && providerOption(provider).apiKey) throw AiError.config(apiKeyProblem);
  const localFetch: typeof fetch | undefined = rejectRedirects
    ? (input, init) => fetch(input, { ...init, redirect: "error" })
    : undefined;
  switch (provider) {
    case AiProvider.LOCAL:
      return new LocalProvider(baseUrl, model, timeoutMs, localFetch);
    case AiProvider.OPENAI:
      return new OpenAICompatibleProvider("OPENAI", baseUrl, apiKey, model, timeoutMs);
    case AiProvider.ANTHROPIC:
      return new AnthropicProvider(baseUrl, apiKey, model, timeoutMs);
    case AiProvider.MISTRAL:
      return new MistralProvider(baseUrl, apiKey, model, timeoutMs);
    case AiProvider.LMSTUDIO:
      return new LmStudioProvider(baseUrl, apiKey, model, timeoutMs, localFetch);
  }
}

/** The provider configured in Settings, or by the DOSSIER_AI_* variables. */
export async function getAiProvider(): Promise<AIProvider> {
  const source = jobSourceContext.getStore();
  return createProvider(source?.config ?? await loadAiConfig(), { rejectRedirects: source?.rejectAiRedirects });
}
