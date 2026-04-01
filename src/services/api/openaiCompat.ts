import type Anthropic from '@anthropic-ai/sdk'
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk/error'
import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageTokensCount,
  BetaRawMessageStreamEvent,
  BetaToolChoice,
  BetaToolUnion,
  BetaUsage,
  MessageCountTokensParams,
  MessageCreateParamsBase,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import { randomUUID } from 'crypto'
import { logForDebugging } from 'src/utils/debug.js'
import { getAPIProvider, isOpenAICompatEnabled } from 'src/utils/model/providers.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'

type OpenAIChatCompletionRequest = {
  messages: OpenAIMessage[]
  model: string
  max_tokens?: number
  response_format?: Record<string, unknown>
  stop?: string[]
  temperature?: number
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } }
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: Record<string, unknown>
    }
  }>
  user?: string
  [key: string]: unknown
}

type OpenAIMessage =
  | {
      role: 'assistant'
      content: null | string
      tool_calls?: OpenAIToolCall[]
    }
  | {
      role: 'system' | 'user'
      content: string
    }
  | {
      role: 'tool'
      content: string
      tool_call_id: string
    }

type OpenAIToolCall = {
  function?: {
    arguments?: string
    name?: string
  }
  id?: string
  type?: 'function'
}

type OpenAIContentPart =
  | string
  | {
      text?: string
      type?: string
    }

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: null | string
    index?: number
    message?: {
      content?: null | OpenAIContentPart[] | string
      role?: string
      tool_calls?: OpenAIToolCall[]
    }
  }>
  id?: string
  model?: string
  usage?: {
    completion_tokens?: number
    prompt_tokens?: number
    total_tokens?: number
  }
}

type OpenAICompatRequestResult<T> = {
  data: T
  requestId: null | string
  response: Response
}

type OpenAICompatRequestOptions = {
  headers?: HeadersInit
  signal?: AbortSignal
}

const ANTHROPIC_ONLY_FIELDS = new Set([
  'anthropic_beta',
  'anthropic_internal',
  'betas',
  'container',
  'context_management',
  'max_tokens',
  'mcp_servers',
  'messages',
  'metadata',
  'model',
  'output_config',
  'output_format',
  'service_tier',
  'speed',
  'stop_sequences',
  'stream',
  'system',
  'temperature',
  'thinking',
  'tool_choice',
  'tools',
  'top_k',
])

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

class OpenAICompatRequest<T> implements PromiseLike<T> {
  private readonly innerPromise: Promise<OpenAICompatRequestResult<T>>
  private readonly parsedPromise: Promise<T>

  constructor(
    executor: () => Promise<OpenAICompatRequestResult<T>>,
  ) {
    this.innerPromise = executor()
    this.parsedPromise = this.innerPromise.then(result => result.data)
  }

  asResponse(): Promise<Response> {
    return this.innerPromise.then(result => result.response)
  }

  catch<TResult = never>(
    onRejected?:
      | ((reason: unknown) => PromiseLike<TResult> | TResult)
      | null
      | undefined,
  ): Promise<T | TResult> {
    return this.parsedPromise.catch(onRejected ?? undefined)
  }

  finally(onFinally?: (() => void) | null | undefined): Promise<T> {
    return this.parsedPromise.finally(onFinally ?? undefined)
  }

  then<TResult1 = T, TResult2 = never>(
    onFulfilled?:
      | ((value: T) => PromiseLike<TResult1> | TResult1)
      | null
      | undefined,
    onRejected?:
      | ((reason: unknown) => PromiseLike<TResult2> | TResult2)
      | null
      | undefined,
  ): Promise<TResult1 | TResult2> {
    return this.parsedPromise.then(
      onFulfilled ?? undefined,
      onRejected ?? undefined,
    )
  }

  withResponse(): Promise<{
    data: T
    request_id: null | string
    response: Response
  }> {
    return this.innerPromise.then(result => ({
      data: result.data,
      request_id: result.requestId,
      response: result.response,
    }))
  }
}

export function getOpenAICompatClient({
  apiKey,
  fetchOverride,
  model,
  source,
}: {
  apiKey?: string
  fetchOverride?: ClientOptions['fetch']
  maxRetries: number
  model?: string
  source?: string
}): Anthropic {
  const request = async (
    params: MessageCreateParamsBase,
    options?: OpenAICompatRequestOptions,
  ): Promise<OpenAICompatRequestResult<BetaMessage | Stream<BetaRawMessageStreamEvent>>> => {
    const response = await sendOpenAICompatRequest({
      apiKey,
      fetchOverride,
      model,
      options,
      params,
      source,
    })
    const betaMessage = convertOpenAIResponseToBetaMessage(response.data, params.model)
    const requestId = getRequestId(response.response, response.data)

    if (params.stream) {
      return {
        data: createSyntheticStream(betaMessage),
        requestId,
        response: response.response,
      }
    }

    ;(betaMessage as BetaMessage & { _request_id?: null | string })._request_id =
      requestId
    return {
      data: betaMessage,
      requestId,
      response: response.response,
    }
  }

  const countTokens = async (
    params: MessageCountTokensParams,
    options?: OpenAICompatRequestOptions,
  ): Promise<OpenAICompatRequestResult<BetaMessageTokensCount>> => {
    const body = buildOpenAIRequestBody({
      ...params,
      max_tokens: 1,
      tool_choice: { type: 'none' },
    } as MessageCreateParamsBase)
    const response = await postOpenAICompat({
      apiKey,
      body,
      fetchOverride,
      options,
      source,
    })
    const promptTokens =
      response.data.usage?.prompt_tokens ??
      estimateInputTokens(body.messages, body.tools)
    const requestId = getRequestId(response.response, response.data)

    const tokenCount = {
      context_management: null,
      input_tokens: promptTokens,
    } as BetaMessageTokensCount & { _request_id?: null | string }
    tokenCount._request_id = requestId

    return {
      data: tokenCount,
      requestId,
      response: response.response,
    }
  }

  return {
    beta: {
      messages: {
        countTokens: (
          params: MessageCountTokensParams,
          options?: OpenAICompatRequestOptions,
        ) => new OpenAICompatRequest(() => countTokens(params, options)),
        create: (
          params: MessageCreateParamsBase,
          options?: OpenAICompatRequestOptions,
        ) => new OpenAICompatRequest(() => request(params, options)),
      },
    },
  } as unknown as Anthropic
}

function appendOpenAIContentText(target: string[], value: unknown): void {
  const text = flattenContent(value)
  if (text) {
    target.push(text)
  }
}

function buildOpenAIHeaders(
  apiKey: string | undefined,
  requestHeaders: HeadersInit | undefined,
): Headers {
  const headers = new Headers(requestHeaders)
  headers.set('content-type', 'application/json')

  const customHeaders = parseHeaderString(process.env.OPENAI_API_HEADERS)
  for (const [name, value] of Object.entries(customHeaders)) {
    headers.set(name, value)
  }

  if (apiKey && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${apiKey}`)
  }

  return headers
}

function buildOpenAIRequestBody(
  params: MessageCreateParamsBase,
): OpenAIChatCompletionRequest {
  const passthrough = pickOpenAIPassthroughFields(params)
  const body: OpenAIChatCompletionRequest = {
    ...passthrough,
    messages: convertAnthropicMessagesToOpenAI(params),
    model: resolveOpenAICompatModel(params.model),
  }

  if (params.max_tokens !== undefined) {
    body.max_tokens = params.max_tokens
  }
  if (params.temperature !== undefined) {
    body.temperature = params.temperature
  }
  if (params.stop_sequences && params.stop_sequences.length > 0) {
    body.stop = params.stop_sequences
  }

  const tools = convertAnthropicToolsToOpenAI(params.tools)
  if (tools.length > 0) {
    body.tools = tools
  }

  const toolChoice = convertAnthropicToolChoiceToOpenAI(params.tool_choice)
  if (toolChoice !== undefined) {
    body.tool_choice = toolChoice
  }

  if (!('response_format' in body)) {
    const responseFormat = convertOutputFormatToOpenAIResponseFormat(
      params.output_config?.format ?? params.output_format,
    )
    if (responseFormat) {
      body.response_format = responseFormat
    }
  }

  if (!('user' in body) && params.metadata?.user_id) {
    body.user = params.metadata.user_id
  }

  return body
}

function convertAnthropicAssistantMessageToOpenAI(
  content: MessageCreateParamsBase['messages'][number]['content'],
): Extract<OpenAIMessage, { role: 'assistant' }> | null {
  if (typeof content === 'string') {
    return { role: 'assistant', content }
  }

  const textParts: string[] = []
  const toolCalls: OpenAIToolCall[] = []

  for (const block of content ?? []) {
    if (typeof block === 'string') {
      appendOpenAIContentText(textParts, block)
      continue
    }

    if (block.type === 'tool_use') {
      toolCalls.push({
        type: 'function',
        id: block.id,
        function: {
          arguments: safeJSONStringify(block.input ?? {}),
          name: block.name,
        },
      })
      continue
    }

    appendOpenAIContentText(textParts, block)
  }

  if (textParts.length === 0 && toolCalls.length === 0) {
    return { role: 'assistant', content: '' }
  }

  return {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('\n\n') : null,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  }
}

function convertAnthropicMessagesToOpenAI(
  params: MessageCreateParamsBase,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []
  const systemText = flattenSystemPrompt(params.system)
  if (systemText) {
    result.push({
      role: 'system',
      content: systemText,
    })
  }

  for (const message of params.messages) {
    if (message.role === 'assistant') {
      const assistantMessage = convertAnthropicAssistantMessageToOpenAI(
        message.content,
      )
      if (assistantMessage) {
        result.push(assistantMessage)
      }
      continue
    }

    if (typeof message.content === 'string') {
      result.push({
        role: 'user',
        content: message.content,
      })
      continue
    }

    const pendingUserText: string[] = []
    const flushUserText = () => {
      if (pendingUserText.length === 0) {
        return
      }
      result.push({
        role: 'user',
        content: pendingUserText.join('\n\n'),
      })
      pendingUserText.length = 0
    }

    for (const block of message.content ?? []) {
      if (typeof block === 'string') {
        appendOpenAIContentText(pendingUserText, block)
        continue
      }

      if (block.type === 'tool_result') {
        flushUserText()
        result.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: flattenToolResultContent(block.content, block.is_error),
        })
        continue
      }

      appendOpenAIContentText(pendingUserText, block)
    }

    flushUserText()
  }

  return result
}

function convertAnthropicToolChoiceToOpenAI(
  toolChoice: BetaToolChoice | undefined,
):
  | OpenAIChatCompletionRequest['tool_choice']
  | undefined {
  if (!toolChoice) {
    return undefined
  }

  switch (toolChoice.type) {
    case 'any':
      return 'required'
    case 'auto':
      return 'auto'
    case 'none':
      return 'none'
    case 'tool':
      return {
        type: 'function',
        function: { name: toolChoice.name },
      }
    default:
      return undefined
  }
}

function convertAnthropicToolsToOpenAI(
  tools: BetaToolUnion[] | undefined,
): NonNullable<OpenAIChatCompletionRequest['tools']> {
  if (!tools || tools.length === 0) {
    return []
  }

  return tools
    .filter(
      (tool): tool is BetaToolUnion & {
        description?: string
        input_schema: Record<string, unknown>
        name: string
      } =>
        typeof tool === 'object' &&
        tool !== null &&
        'name' in tool &&
        'input_schema' in tool &&
        typeof tool.name === 'string' &&
        typeof tool.input_schema === 'object' &&
        tool.input_schema !== null,
    )
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.input_schema,
      },
    }))
}

function convertOpenAIContentToText(
  content: null | OpenAIContentPart[] | string | undefined,
): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map(part => {
      if (typeof part === 'string') {
        return part
      }
      return part.text ?? ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function convertOpenAIResponseToBetaMessage(
  response: OpenAIChatCompletionResponse,
  requestedModel: string | undefined,
): BetaMessage {
  const firstChoice = response.choices?.[0]
  if (!firstChoice?.message) {
    throw new Error('OpenAI-compatible API returned no choices')
  }

  const message = firstChoice.message
  const content: BetaContentBlock[] = []
  const textContent = convertOpenAIContentToText(message.content)
  if (textContent || !(message.tool_calls && message.tool_calls.length > 0)) {
    content.push({
      type: 'text',
      text: textContent,
      citations: null,
    } as BetaContentBlock)
  }

  for (const toolCall of message.tool_calls ?? []) {
    const rawArguments = toolCall.function?.arguments ?? '{}'
    let parsedArguments: unknown = {}
    try {
      parsedArguments = rawArguments ? JSON.parse(rawArguments) : {}
    } catch {
      parsedArguments = rawArguments
    }

    content.push({
      type: 'tool_use',
      id: toolCall.id ?? `toolu_${randomUUID()}`,
      input: parsedArguments,
      name: toolCall.function?.name ?? 'function',
    } as BetaContentBlock)
  }

  return {
    id: response.id ?? `msg_${randomUUID()}`,
    container: null,
    content,
    context_management: null,
    model: response.model ?? requestedModel ?? resolveOpenAICompatModel(requestedModel),
    role: 'assistant',
    stop_reason: mapFinishReason(firstChoice.finish_reason, message.tool_calls),
    stop_sequence: null,
    type: 'message',
    usage: createUsage(response.usage, content),
  } as BetaMessage
}

function convertOutputFormatToOpenAIResponseFormat(
  format: BetaJSONOutputFormat | undefined | null,
): Record<string, unknown> | undefined {
  if (!format || format.type !== 'json_schema') {
    return undefined
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: 'structured_output',
      schema: format.schema,
      strict: true,
    },
  }
}

function createSyntheticStream(
  message: BetaMessage,
): Stream<BetaRawMessageStreamEvent> {
  const controller = new AbortController()
  const startUsage = {
    ...message.usage,
    output_tokens: 0,
  } as BetaUsage

  return new Stream<BetaRawMessageStreamEvent>(
    async function* () {
      yield {
        type: 'message_start',
        message: {
          ...message,
          content: [],
          stop_reason: null,
          usage: startUsage,
        },
      }

      for (const [index, contentBlock] of message.content.entries()) {
        if (controller.signal.aborted) {
          return
        }

        if (contentBlock.type === 'tool_use') {
          yield {
            type: 'content_block_start',
            index,
            content_block: {
              ...contentBlock,
              input: {},
            },
          }
          const partialJSON = safeJSONStringify(contentBlock.input ?? {})
          if (partialJSON) {
            yield {
              type: 'content_block_delta',
              index,
              delta: {
                type: 'input_json_delta',
                partial_json: partialJSON,
              },
            }
          }
        } else if (contentBlock.type === 'text') {
          yield {
            type: 'content_block_start',
            index,
            content_block: {
              ...contentBlock,
              text: '',
            },
          }
          if (contentBlock.text) {
            yield {
              type: 'content_block_delta',
              index,
              delta: {
                type: 'text_delta',
                text: contentBlock.text,
              },
            }
          }
        } else {
          yield {
            type: 'content_block_start',
            index,
            content_block: contentBlock,
          }
        }

        yield {
          type: 'content_block_stop',
          index,
        }
      }

      yield {
        type: 'message_delta',
        context_management: null,
        delta: {
          container: null,
          stop_reason: message.stop_reason,
          stop_sequence: message.stop_sequence,
        },
        usage: message.usage,
      }
      yield {
        type: 'message_stop',
      }
    },
    controller,
  )
}

function createUsage(
  usage: OpenAIChatCompletionResponse['usage'],
  content: BetaContentBlock[],
): BetaUsage {
  const estimatedOutputTokens = estimateOutputTokens(content)
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: '',
    input_tokens: usage?.prompt_tokens ?? 0,
    iterations: [],
    output_tokens: usage?.completion_tokens ?? estimatedOutputTokens,
    server_tool_use: {
      web_fetch_requests: 0,
      web_search_requests: 0,
    },
    service_tier: 'standard',
    speed: 'standard',
  } as BetaUsage
}

function estimateInputTokens(
  messages: OpenAIMessage[],
  tools: OpenAIChatCompletionRequest['tools'],
): number {
  const messageBytes = messages
    .map(message => safeJSONStringify(message))
    .join('\n')
  const toolBytes = tools?.map(tool => safeJSONStringify(tool)).join('\n') ?? ''
  return roughTokenEstimate(messageBytes + toolBytes)
}

function estimateOutputTokens(content: BetaContentBlock[]): number {
  return roughTokenEstimate(
    content
      .map(block => {
        if (block.type === 'text') {
          return block.text
        }
        if (block.type === 'tool_use') {
          return `${block.name}${safeJSONStringify(block.input ?? {})}`
        }
        return safeJSONStringify(block)
      })
      .join('\n'),
  )
}

function flattenContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => flattenContent(item)).filter(Boolean).join('\n\n')
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  if ('text' in value && typeof value.text === 'string') {
    return value.text
  }
  if ('thinking' in value && typeof value.thinking === 'string') {
    return value.thinking
  }
  if ('data' in value && typeof value.data === 'string') {
    return value.data
  }
  if ('content' in value) {
    return flattenContent(value.content)
  }

  return safeJSONStringify(value)
}

function flattenSystemPrompt(
  system: MessageCreateParamsBase['system'],
): string {
  if (typeof system === 'string') {
    return system
  }
  if (!Array.isArray(system)) {
    return ''
  }
  return system
    .map(block => ('text' in block ? block.text : ''))
    .filter(Boolean)
    .join('\n\n')
}

function flattenToolResultContent(
  content: unknown,
  isError?: boolean,
): string {
  const text = flattenContent(content)
  if (isError) {
    return text ? `ERROR: ${text}` : 'ERROR'
  }
  return text
}

function getNormalizedEndpoint(baseURL: string | undefined): string {
  const rawBaseURL = (baseURL || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '')
  return rawBaseURL.endsWith('/chat/completions')
    ? rawBaseURL
    : `${rawBaseURL}/chat/completions`
}

function getOpenAICompatApiKey(
  apiKey: string | undefined,
): string | undefined {
  const resolvedApiKey =
    apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
  return resolvedApiKey?.trim() || undefined
}

function getRequestId(
  response: Response,
  data: OpenAIChatCompletionResponse,
): null | string {
  return (
    response.headers.get('x-request-id') ||
    response.headers.get('request-id') ||
    response.headers.get('openai-request-id') ||
    data.id ||
    null
  )
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}

function mapFinishReason(
  finishReason: null | string | undefined,
  toolCalls: OpenAIToolCall[] | undefined,
): BetaMessage['stop_reason'] {
  switch (finishReason) {
    case 'function_call':
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'stop':
      return 'end_turn'
    default:
      return toolCalls && toolCalls.length > 0 ? 'tool_use' : 'end_turn'
  }
}

function parseHeaderString(
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

function pickOpenAIPassthroughFields(
  params: MessageCreateParamsBase,
): Record<string, unknown> {
  const passthrough: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(
    params as unknown as Record<string, unknown>,
  )) {
    if (value === undefined || ANTHROPIC_ONLY_FIELDS.has(key)) {
      continue
    }
    passthrough[key] = value
  }
  return passthrough
}

async function postOpenAICompat({
  apiKey,
  body,
  fetchOverride,
  options,
  source,
}: {
  apiKey: string | undefined
  body: OpenAIChatCompletionRequest
  fetchOverride?: ClientOptions['fetch']
  options?: OpenAICompatRequestOptions
  source?: string
}): Promise<{
  data: OpenAIChatCompletionResponse
  response: Response
}> {
  const endpoint = getNormalizedEndpoint(process.env.OPENAI_BASE_URL)
  const fetchImpl = fetchOverride ?? globalThis.fetch
  const headers = buildOpenAIHeaders(apiKey, options?.headers)
  const resolvedHeaders = new Headers(headers)

  if (
    !resolvedHeaders.has('authorization') &&
    !resolvedHeaders.has('api-key') &&
    !resolvedHeaders.has('x-api-key')
  ) {
    throw new Error(
      'OPENAI_API_KEY is required for OpenAI-compatible mode unless OPENAI_API_HEADERS already provides authentication headers.',
    )
  }

  try {
    logForDebugging(
      `[API REQUEST] ${new URL(endpoint).pathname} source=${source ?? 'unknown'} provider=${getAPIProvider()}`,
    )

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: resolvedHeaders,
      body: JSON.stringify(body),
      signal: options?.signal,
      ...getProxyFetchOptions({
        forAnthropicAPI: false,
      }),
    })

    const data = (await parseResponseBody(response)) as OpenAIChatCompletionResponse
    if (!response.ok) {
      throw buildAPIError(response, data)
    }

    return { data, response }
  } catch (error) {
    if (isAbortError(error) || options?.signal?.aborted) {
      throw new APIUserAbortError()
    }
    if (error instanceof APIError) {
      throw error
    }
    throw APIError.generate(undefined, error as object, undefined, undefined)
  }
}

function resolveOpenAICompatModel(
  requestedModel: string | undefined,
): string {
  const preferredModel = process.env.OPENAI_MODEL?.trim()
  if (!requestedModel) {
    return stripContextSuffix(
      preferredModel || process.env.ANTHROPIC_MODEL || 'gpt-4o-mini',
    )
  }
  if (
    preferredModel &&
    requestedModel.toLowerCase().startsWith('claude-') &&
    isOpenAICompatEnabled()
  ) {
    return stripContextSuffix(preferredModel)
  }
  return stripContextSuffix(requestedModel)
}

function roughTokenEstimate(value: string): number {
  return Math.max(1, Math.round(value.length / 4))
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stripContextSuffix(value: string): string {
  return value.replace(/\[(1|2)m\]/gi, '')
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.clone().text()
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

async function sendOpenAICompatRequest({
  apiKey,
  fetchOverride,
  model,
  options,
  params,
  source,
}: {
  apiKey?: string
  fetchOverride?: ClientOptions['fetch']
  model?: string
  options?: OpenAICompatRequestOptions
  params: MessageCreateParamsBase
  source?: string
}): Promise<{
  data: OpenAIChatCompletionResponse
  response: Response
}> {
  const resolvedApiKey = getOpenAICompatApiKey(apiKey)
  const body = buildOpenAIRequestBody({
    ...params,
    ...(model && !params.model ? { model } : {}),
    stream: false,
  })
  return postOpenAICompat({
    apiKey: resolvedApiKey,
    body,
    fetchOverride,
    options,
    source,
  })
}

function buildAPIError(
  response: Response,
  errorBody: unknown,
): APIError {
  const headers = new Headers(response.headers)
  if (!headers.has('request-id') && headers.has('x-request-id')) {
    const requestId = headers.get('x-request-id')
    if (requestId) {
      headers.set('request-id', requestId)
    }
  }

  return APIError.generate(
    response.status,
    typeof errorBody === 'object' && errorBody !== null
      ? (errorBody as object)
      : { message: String(errorBody) },
    undefined,
    headers,
  )
}
