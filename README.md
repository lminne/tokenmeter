# tokenmeter

[![npm version](https://img.shields.io/npm/v/tokenmeter.svg)](https://www.npmjs.com/package/tokenmeter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

OpenTelemetry-native cost tracking for AI workflows. Track real USD costs per user, workflow, and provider with zero code changes.

## Why tokenmeter?

AI costs are hard to track. Tokens flow through multiple providers, streaming responses don't report usage upfront, and attributing costs to users or workflows requires custom instrumentation everywhere.

tokenmeter solves this by:

- **Wrapping AI clients transparently** - `monitor(client)` returns the same type, no code changes needed
- **Calculating costs automatically** - Uses up-to-date pricing for OpenAI, Anthropic, Google, fal.ai, ElevenLabs
- **Propagating context** - `withAttributes()` attaches user/org/workflow IDs to all nested AI calls
- **Integrating with OTel** - Export to Datadog, Jaeger, Honeycomb, or persist to PostgreSQL

## Installation

```bash
npm install tokenmeter @opentelemetry/api @opentelemetry/sdk-trace-node
```

## Quick Start

```typescript
import OpenAI from 'openai';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { monitor, withAttributes } from 'tokenmeter';

// 1. Set up OpenTelemetry
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();

// 2. Wrap your AI client (this is what adds cost tracking!)
const openai = monitor(new OpenAI());

// 3. Track costs with context
await withAttributes({ 'user.id': 'user_123' }, async () => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  console.log(response.choices[0].message.content);
});

// Spans now include: tokenmeter.cost_usd, tokenmeter.provider, tokenmeter.model, user.id
```

## Supported Providers

| Provider | Models | Pricing Unit |
|----------|--------|--------------|
| **OpenAI** | GPT-4o, GPT-4-turbo, o1, o3, GPT-3.5, embeddings, DALL-E, Whisper | per 1M tokens |
| **Anthropic** | Claude 4, Claude 3.5, Claude 3 | per 1M tokens |
| **Google** | Gemini 2.0, Gemini 1.5 | per 1M tokens |
| **fal.ai** | 900+ models (Flux, SDXL, Kling, Runway, etc.) | per request/megapixel/second |
| **ElevenLabs** | All TTS models | per 1K characters |

## Core Concepts

### `monitor(client)`

Wraps any supported AI client with a Proxy that intercepts API calls, extracts usage data, and creates OpenTelemetry spans with cost attributes.

```typescript
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { monitor } from 'tokenmeter';

const openai = monitor(new OpenAI());
const anthropic = monitor(new Anthropic());
const trackedFal = monitor(fal);

// Types are fully preserved - no changes to your code
const response = await openai.chat.completions.create({...});
```

### `withAttributes(attrs, fn)`

Sets context attributes inherited by all AI calls within the callback. Uses OpenTelemetry Baggage for propagation.

```typescript
import { withAttributes } from 'tokenmeter';

await withAttributes({ 'user.id': 'user_123', 'org.id': 'acme' }, async () => {
  // All AI calls here are tagged with user.id and org.id
  await openai.chat.completions.create({...});
  await anthropic.messages.create({...});
});

// Nesting merges attributes
await withAttributes({ 'org.id': 'acme' }, async () => {
  await withAttributes({ 'user.id': 'user_123' }, async () => {
    // Has both org.id and user.id
  });
});
```

### Request-Level Cost Attribution

Get cost data immediately after each API call using hooks or the `withCost` utility.

#### Using Hooks

Configure `beforeRequest`, `afterResponse`, and `onError` hooks when creating the monitored client:

```typescript
import { monitor } from 'tokenmeter';

const openai = monitor(new OpenAI(), {
  beforeRequest: (ctx) => {
    console.log(`Calling ${ctx.spanName}`);
    // Throw to abort the request (useful for rate limiting)
    if (isRateLimited()) throw new Error('Rate limited');
  },
  afterResponse: (ctx) => {
    console.log(`Cost: $${ctx.cost.toFixed(6)}`);
    console.log(`Tokens: ${ctx.usage?.inputUnits} in, ${ctx.usage?.outputUnits} out`);
    console.log(`Duration: ${ctx.durationMs}ms`);
    
    // Track costs in your system
    trackCost(ctx.usage, ctx.cost);
  },
  onError: (ctx) => {
    console.error(`Error in ${ctx.spanName}:`, ctx.error.message);
    alertOnError(ctx.error);
  },
});
```

Hooks are read-only—they observe but cannot modify request arguments.

#### Using `withCost`

For ad-hoc cost capture without configuring hooks:

```typescript
import { monitor, withCost } from 'tokenmeter';

const openai = monitor(new OpenAI());

const { result, cost, usage } = await withCost(() =>
  openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
  })
);

console.log(`Response: ${result.choices[0].message.content}`);
console.log(`Cost: $${cost.toFixed(6)}`);
console.log(`Tokens: ${usage?.inputUnits} in, ${usage?.outputUnits} out`);
```

### Provider-Specific Types

Use type guards to access provider-specific usage data:

```typescript
import { 
  withCost, 
  isOpenAIUsage, 
  isAnthropicUsage,
  type ProviderUsageData 
} from 'tokenmeter';

const { usage } = await withCost(() => openai.chat.completions.create({...}));

if (isOpenAIUsage(usage)) {
  console.log(`OpenAI tokens: ${usage.inputUnits} in, ${usage.outputUnits} out`);
  if (usage.totalTokens) console.log(`Total: ${usage.totalTokens}`);
}

if (isAnthropicUsage(usage)) {
  console.log(`Anthropic tokens: ${usage.inputUnits} in, ${usage.outputUnits} out`);
  if (usage.cacheCreationTokens) console.log(`Cache: ${usage.cacheCreationTokens}`);
}
```

Available type guards: `isOpenAIUsage`, `isAnthropicUsage`, `isGoogleUsage`, `isBedrockUsage`, `isFalUsage`, `isElevenLabsUsage`, `isBFLUsage`, `isVercelAIUsage`.

### `TokenMeterProcessor`

An OpenTelemetry SpanProcessor for debugging and validating cost calculations. It logs calculated costs for spans that have usage data.

> **Note**: The processor cannot add cost attributes to spans after they end (OpenTelemetry limitation). For production cost tracking, use `monitor()` which adds `tokenmeter.cost_usd` before the span ends.

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { TokenMeterProcessor, configureLogger } from 'tokenmeter';

// Enable debug logging to see calculated costs
configureLogger({ level: 'debug' });

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new TokenMeterProcessor());
provider.register();
```

## Span Attributes

tokenmeter adds these attributes to spans:

| Attribute | Type | Description |
|-----------|------|-------------|
| `tokenmeter.cost_usd` | number | Calculated cost in USD |
| `tokenmeter.provider` | string | Provider name |
| `tokenmeter.model` | string | Model identifier |
| `gen_ai.usage.input_tokens` | number | Input token count |
| `gen_ai.usage.output_tokens` | number | Output token count |

Plus any attributes set via `withAttributes()` (e.g., `user.id`, `org.id`, `workflow.id`).

## Framework Integrations

### Next.js App Router

```typescript
import { withTokenmeter } from 'tokenmeter/next';

async function handler(request: Request) {
  const response = await openai.chat.completions.create({...});
  return Response.json({ message: response.choices[0].message.content });
}

export const POST = withTokenmeter(handler, (request) => ({
  userId: request.headers.get('x-user-id') || undefined,
}));
```

### Inngest

```typescript
import { withInngest, getInngestTraceHeaders } from 'tokenmeter/inngest';

// Send events with trace context
await inngest.send({
  name: 'ai/generate',
  data: { prompt: '...' },
  ...getInngestTraceHeaders(),
});

// Restore context in function
export const generateFn = inngest.createFunction(
  { id: 'generate' },
  { event: 'ai/generate' },
  withInngest(async ({ event }) => {
    await openai.chat.completions.create({...}); // Linked to original trace
  })
);
```

### Vercel AI SDK

For non-invasive integration with the Vercel AI SDK using `experimental_telemetry`:

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { telemetry } from 'tokenmeter/vercel-ai';

const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Hello!',
  experimental_telemetry: telemetry({
    userId: 'user_123',
    orgId: 'org_456',
  }),
});
```

## PostgreSQL Persistence

Store costs for querying and billing.

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PostgresExporter } from 'tokenmeter/exporter';
import { createQueryClient } from 'tokenmeter/client';

// Export spans to PostgreSQL
provider.addSpanProcessor(new BatchSpanProcessor(
  new PostgresExporter({ connectionString: process.env.DATABASE_URL })
));

// Query costs
const client = createQueryClient({ connectionString: process.env.DATABASE_URL });

const { totalCost } = await client.getCostByUser('user_123', {
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
});

const byModel = await client.getCosts({ groupBy: ['model'] });
```

See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for schema and setup instructions.

## Streaming Support

tokenmeter handles streaming responses automatically.

```typescript
// OpenAI - requires stream_options for usage
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{...}],
  stream: true,
  stream_options: { include_usage: true },
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
// Cost calculated when stream completes

// Anthropic streaming works out of the box
const stream = anthropic.messages.stream({...});
for await (const event of stream) {...}
const finalMessage = await stream.finalMessage();
```

## Cross-Service Propagation

For distributed systems, propagate trace context across service boundaries.

```typescript
import { extractTraceHeaders, withExtractedContext } from 'tokenmeter';

// Service A: Extract headers
const headers = extractTraceHeaders();
await fetch('https://service-b.example.com', { headers });

// Service B: Restore context
await withExtractedContext(req.headers, async () => {
  await openai.chat.completions.create({...}); // Part of Service A's trace
});
```

## Pricing Configuration

tokenmeter fetches pricing from a remote manifest with local fallback.

```typescript
import { configurePricing, loadManifest } from 'tokenmeter';

// Use offline mode (bundled pricing only)
configurePricing({ offlineMode: true });

// Custom pricing API
configurePricing({ apiUrl: 'https://your-api.com/pricing' });

// Force refresh
await loadManifest({ forceRefresh: true });
```

## Export Destinations

### Datadog

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

provider.addSpanProcessor(new BatchSpanProcessor(
  new OTLPTraceExporter({
    url: 'https://trace.agent.datadoghq.com/v0.4/traces',
    headers: { 'DD-API-KEY': process.env.DD_API_KEY },
  })
));
```

### Honeycomb

```typescript
provider.addSpanProcessor(new BatchSpanProcessor(
  new OTLPTraceExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
  })
));
```

### Jaeger

```typescript
provider.addSpanProcessor(new BatchSpanProcessor(
  new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' })
));
```

## API Reference

### Core

| Export | Description |
|--------|-------------|
| `monitor(client, options?)` | Wrap AI client with cost tracking |
| `withAttributes(attrs, fn)` | Set context attributes for nested calls |
| `withCost(fn)` | Capture cost from API calls in the function |
| `extractTraceHeaders()` | Get W3C trace headers for propagation |
| `withExtractedContext(headers, fn)` | Restore context from headers |

### Monitor Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Custom name for span naming |
| `provider` | `string` | Override provider detection |
| `attributes` | `Attributes` | Custom attributes for all spans |
| `beforeRequest` | `(ctx) => void` | Hook called before each API call |
| `afterResponse` | `(ctx) => void` | Hook called after successful response |
| `onError` | `(ctx) => void` | Hook called on errors |

### Type Guards

| Export | Description |
|--------|-------------|
| `isOpenAIUsage(usage)` | Check if usage is from OpenAI |
| `isAnthropicUsage(usage)` | Check if usage is from Anthropic |
| `isGoogleUsage(usage)` | Check if usage is from Google |
| `isBedrockUsage(usage)` | Check if usage is from AWS Bedrock |
| `isFalUsage(usage)` | Check if usage is from fal.ai |
| `isElevenLabsUsage(usage)` | Check if usage is from ElevenLabs |
| `isBFLUsage(usage)` | Check if usage is from Black Forest Labs |
| `isVercelAIUsage(usage)` | Check if usage is from Vercel AI SDK |

### Processor & Exporter

| Export | Description |
|--------|-------------|
| `TokenMeterProcessor` | OTel SpanProcessor for cost calculation |
| `PostgresExporter` | OTel SpanExporter for PostgreSQL |

### Query Client (`tokenmeter/client`)

| Method | Description |
|--------|-------------|
| `createQueryClient(config)` | Create query client |
| `client.getCosts(options)` | Query with filters and grouping |
| `client.getCostByUser(userId, options?)` | Get user costs |
| `client.getCostByOrg(orgId, options?)` | Get organization costs |
| `client.getWorkflowCost(workflowId)` | Get workflow costs |

### Integrations

| Export | Description |
|--------|-------------|
| `withTokenmeter` (`tokenmeter/next`) | Next.js App Router wrapper |
| `withInngest` (`tokenmeter/inngest`) | Inngest function wrapper |
| `getInngestTraceHeaders` (`tokenmeter/inngest`) | Get headers for Inngest events |
| `telemetry` (`tokenmeter/vercel-ai`) | Vercel AI SDK telemetry settings |

## Questions Engineers Ask

### "What's the integration effort?"

One line per client. Wrap with `monitor()`, and you're done.

```typescript
// Before
const openai = new OpenAI();

// After  
const openai = monitor(new OpenAI());
```

No changes to your API calls, no middleware, no schema migrations. TypeScript types are fully preserved—autocomplete works exactly as before.

### "What's the performance overhead?"

Near-zero. The hot path is:
1. A JavaScript Proxy intercepts the method call
2. An OTel span is created (microseconds)
3. Cost lookup happens synchronously from bundled pricing data

No network calls block your AI requests. Pricing manifest refresh happens in the background.

### "What happens if something fails?"

Graceful degradation everywhere:

| Scenario | Behavior |
|----------|----------|
| Pricing data unavailable | Uses bundled fallback (works offline) |
| Unknown model | Logs warning, `cost_usd = 0`, doesn't throw |
| OTel not configured | Spans are no-ops, your code still works |
| Stream interrupted | Partial cost still recorded |

### "Does it work with streaming responses?"

Yes, automatically. tokenmeter wraps async iterators and calculates cost when the stream completes.

For OpenAI, add `stream_options: { include_usage: true }` to get token counts in streaming mode.

### "How do I attribute costs to users/orgs?"

Wrap your request handler with `withAttributes()`. All nested AI calls inherit the context automatically via OpenTelemetry Baggage:

```typescript
await withAttributes({ 'user.id': userId, 'org.id': orgId }, async () => {
  // Every AI call in here gets tagged with user.id and org.id
  await openai.chat.completions.create({...});
  await anthropic.messages.create({...});  // Also tagged
});
```

### "What if my provider isn't supported?"

Use `registerProvider()` to add custom providers without forking:

```typescript
import { registerProvider } from 'tokenmeter';

registerProvider({
  name: 'my-provider',
  detect: (client) => 'myMethod' in client,
  extractUsage: (response) => ({
    inputUnits: response.usage?.input,
    outputUnits: response.usage?.output,
  }),
  extractModel: (args) => args[0]?.model || 'default',
});
```

### "How accurate/up-to-date is the pricing?"

- **Bundled pricing** is compiled from official provider pricing pages at build time
- **Remote refresh** fetches updates from our Pricing API on startup (5-minute cache)
- **Model matching** handles version suffixes (e.g., `gpt-4o-2024-05-13` → `gpt-4o`) and aliases
- **Custom overrides** via `setModelAliases()` for fine-tuned or custom-named models

### "Can I use this without PostgreSQL?"

Yes. PostgreSQL is optional—only needed if you want to persist and query costs. The core `monitor()` and `withAttributes()` work with any OTel-compatible exporter (Datadog, Honeycomb, Jaeger, console, etc.) or no exporter at all.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) for details.

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm check-types
```

## License

MIT
