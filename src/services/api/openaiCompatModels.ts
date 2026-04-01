import { z } from 'zod'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import { createAxiosInstance } from '../../utils/proxy.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

const openAICompatModelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        owned_by: z.string().nullish(),
      }),
    )
    .nullish(),
})

type OpenAICompatModelsResponse = z.infer<
  typeof openAICompatModelsResponseSchema
>

export class OpenAICompatAuthError extends Error {
  constructor(
    message = 'OpenAI-compatible authentication is missing.',
  ) {
    super(message)
    this.name = 'OpenAICompatAuthError'
  }
}

export class OpenAICompatModelsResponseError extends Error {
  constructor(
    message = 'OpenAI-compatible /models response format is invalid.',
  ) {
    super(message)
    this.name = 'OpenAICompatModelsResponseError'
  }
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

const NON_CHAT_MODEL_ID_TOKENS = [
  'audio',
  'dall-e',
  'embedding',
  'embeddings',
  'image',
  'moderation',
  'omni-moderation',
  'rerank',
  'speech',
  'transcribe',
  'transcription',
  'tts',
  'whisper',
] as const

export function normalizeOpenAICompatBaseUrl(
  baseUrl: string | undefined,
): string {
  const rawBaseUrl = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(
    /\/+$/,
    '',
  )

  if (rawBaseUrl.endsWith('/chat/completions')) {
    return rawBaseUrl.replace(/\/chat\/completions$/, '')
  }

  if (rawBaseUrl.endsWith('/models')) {
    return rawBaseUrl.replace(/\/models$/, '')
  }

  return rawBaseUrl
}

export function getOpenAICompatModelsEndpoint(
  baseUrl: string | undefined,
): string {
  return `${normalizeOpenAICompatBaseUrl(baseUrl)}/models`
}

export function parseOpenAICompatHeaders(
  rawHeaders: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!rawHeaders) {
    return headers
  }

  for (const line of rawHeaders.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine) {
      continue
    }

    const separatorIndex = trimmedLine.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const name = trimmedLine.slice(0, separatorIndex).trim()
    const value = trimmedLine.slice(separatorIndex + 1).trim()
    if (name) {
      headers[name] = value
    }
  }

  return headers
}

export function hasOpenAICompatAuthHeader(
  headers: Record<string, string>,
): boolean {
  return Object.keys(headers).some(name =>
    ['authorization', 'api-key', 'x-api-key'].includes(name.toLowerCase()),
  )
}

export function buildOpenAICompatHeaders({
  apiKey,
  rawHeaders,
}: {
  apiKey?: string
  rawHeaders?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...parseOpenAICompatHeaders(rawHeaders),
  }

  const resolvedApiKey = apiKey?.trim()
  if (resolvedApiKey && !hasOpenAICompatAuthHeader(headers)) {
    headers.Authorization = `Bearer ${resolvedApiKey}`
  }

  return headers
}

function isLikelyChatModelId(modelId: string): boolean {
  const normalized = modelId.toLowerCase()
  return !NON_CHAT_MODEL_ID_TOKENS.some(token => normalized.includes(token))
}

function sortModelOptions(
  a: ModelOption,
  b: ModelOption,
  preferredModel: string | undefined,
): number {
  if (preferredModel) {
    if (a.value === preferredModel && b.value !== preferredModel) {
      return -1
    }
    if (b.value === preferredModel && a.value !== preferredModel) {
      return 1
    }
  }

  return a.label.localeCompare(b.label)
}

function toOpenAICompatModelOptions(
  response: OpenAICompatModelsResponse,
  preferredModel: string | undefined,
): ModelOption[] {
  const trimmedPreferredModel = preferredModel?.trim()
  const seen = new Set<string>()
  const options: ModelOption[] = []

  for (const model of response.data ?? []) {
    const modelId = model.id.trim()
    if (!modelId || seen.has(modelId) || !isLikelyChatModelId(modelId)) {
      continue
    }

    seen.add(modelId)
    options.push({
      value: modelId,
      label: modelId,
      description:
        trimmedPreferredModel === modelId
          ? 'Current default OpenAI-compatible model'
          : model.owned_by
            ? `OpenAI-compatible model (${model.owned_by})`
            : 'OpenAI-compatible model',
    })
  }

  if (trimmedPreferredModel && !seen.has(trimmedPreferredModel)) {
    options.push({
      value: trimmedPreferredModel,
      label: trimmedPreferredModel,
      description: 'Current default OpenAI-compatible model',
    })
  }

  options.sort((a, b) => sortModelOptions(a, b, trimmedPreferredModel))
  return options
}

export async function fetchOpenAICompatModelOptions({
  apiKey,
  baseUrl,
  preferredModel,
  rawHeaders,
  timeoutMs = 5000,
}: {
  apiKey?: string
  baseUrl?: string
  preferredModel?: string
  rawHeaders?: string
  timeoutMs?: number
}): Promise<ModelOption[]> {
  const headers = buildOpenAICompatHeaders({
    apiKey,
    rawHeaders,
  })

  if (!hasOpenAICompatAuthHeader(headers)) {
    throw new OpenAICompatAuthError()
  }

  const endpoint = getOpenAICompatModelsEndpoint(baseUrl)
  const client = createAxiosInstance()
  const response = await client.get<unknown>(endpoint, {
    headers,
    timeout: timeoutMs,
  })

  const parsed = openAICompatModelsResponseSchema.safeParse(response.data)
  if (!parsed.success) {
    throw new OpenAICompatModelsResponseError()
  }

  return toOpenAICompatModelOptions(parsed.data, preferredModel)
}

export function maskSecret(value: string | undefined): string | null {
  const trimmedValue = value?.trim()
  if (!trimmedValue) {
    return null
  }

  if (trimmedValue.length <= 6) {
    return '*'.repeat(trimmedValue.length)
  }

  if (trimmedValue.length <= 12) {
    return `${trimmedValue.slice(0, 2)}***${trimmedValue.slice(-2)}`
  }

  return `${trimmedValue.slice(0, 4)}***${trimmedValue.slice(-4)}`
}
