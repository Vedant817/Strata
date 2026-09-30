/**
 * The provider registry.
 *
 * There is no SDK per provider here, and that is the whole point. OpenAI,
 * Groq, OpenRouter, DeepSeek, Kimi (Moonshot), MiniMax, GLM (Zhipu) and most of
 * the long tail all speak the same wire format — `POST /chat/completions` with
 * a bearer key — and differ only in base URL, the auth header, and the shape
 * of the model list. Anthropic is the notable exception with a genuinely
 * different protocol, so it gets its own adapter. Two code paths cover every
 * provider below, and adding a new one is a data change, not a code change.
 *
 * This is the honest reason BYOK is practical: the request shape a key unlocks
 * is a string and a URL, not a per-vendor SDK someone has to keep updated.
 */

export type Wire = 'openai' | 'anthropic';

export interface ProviderDef {
  id: string;
  label: string;
  wire: Wire;
  baseUrl: string;
  /** Env var for the deployment's own key, when there is one. */
  envKey?: string;
  /** Model id to offer when nothing else is chosen. */
  fallbackModel: string;
  /** Shown in the picker, so nobody wonders what a key does. */
  note: string;
  /**
   * True when the provider publishes a model catalogue we can filter for free
   * tiers at runtime instead of hardcoding one that rots.
   */
  catalog: boolean;
  docsUrl: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    fallbackModel: 'claude-sonnet-4-5',
    note: 'Claude models. Required for the model-backed Ask on the free plan.',
    catalog: false,
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    fallbackModel: 'gpt-4o-mini',
    note: 'GPT models. A ChatGPT Plus subscription is not an API key — billing is separate.',
    catalog: true,
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'groq',
    label: 'Groq',
    wire: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    fallbackModel: 'llama-3.3-70b-versatile',
    note: 'Very fast open models. Only free-tier models are offered.',
    catalog: true,
    docsUrl: 'https://console.groq.com/docs',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    wire: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    fallbackModel: 'meta-llama/llama-3.3-70b-instruct:free',
    note: 'One key, many providers. Only models tagged free are offered.',
    catalog: true,
    docsUrl: 'https://openrouter.ai/docs',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    wire: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    fallbackModel: 'deepseek-chat',
    note: 'Cheap, strong at code and reasoning.',
    catalog: true,
    docsUrl: 'https://api-docs.deepseek.com',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    wire: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    envKey: 'MOONSHOT_API_KEY',
    fallbackModel: 'moonshot-v1-8k',
    note: 'Long context; good with long documents.',
    catalog: true,
    docsUrl: 'https://platform.moonshot.ai/docs',
  },
  {
    id: 'minimax',
    label: 'minimax',
    wire: 'openai',
    baseUrl: 'https://api.minimax.chat/v1',
    envKey: 'MINIMAX_API_KEY',
    fallbackModel: 'MiniMax-Text-01',
    note: 'Long-context text models.',
    catalog: true,
    docsUrl: 'https://platform.minimax.io/docs',
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu)',
    wire: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    envKey: 'ZHIPU_API_KEY',
    fallbackModel: 'glm-4-flash',
    note: 'Free flash tier available for experimentation.',
    catalog: true,
    docsUrl: 'https://docs.bigmodel.cn',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    wire: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    fallbackModel: 'grok-2-latest',
    note: 'Grok models.',
    catalog: true,
    docsUrl: 'https://docs.x.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    wire: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
    fallbackModel: 'mistral-small-latest',
    note: 'European models; strong on cost.',
    catalog: true,
    docsUrl: 'https://docs.mistral.ai',
  },
  {
    id: 'together',
    label: 'Together AI',
    wire: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
    fallbackModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    note: 'Open-weight models, pay per token.',
    catalog: true,
    docsUrl: 'https://docs.together.ai',
  },
];

export const PROVIDERS_BY_ID: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
);

export function getProvider(id: string): ProviderDef | null {
  return PROVIDERS_BY_ID[id] ?? null;
}

/**
 * Models a deployment offers without any user key — i.e. the owner has
 * configured an env key for that provider. The picker shows these first and
 * labels them as the house keys, so a reader can tell whose quota is being
 * spent.
 */
export function configuredProviders(env: Record<string, string | undefined>): ProviderDef[] {
  return PROVIDERS.filter((p) => p.envKey && Boolean(env[p.envKey]));
}
