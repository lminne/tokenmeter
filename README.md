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
import { monitor, withAttributes, TokenMeterProcessor } from 'tokenmeter';

// 1. Set up OpenTelemetry with TokenMeter processor
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new TokenMeterProcessor());
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();

// 2. Wrap your AI client
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

### `TokenMeterProcessor`

An OpenTelemetry SpanProcessor that calculates costs from span attributes and adds `tokenmeter.cost_usd`.

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { TokenMeterProcessor } from 'tokenmeter';

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
| `extractTraceHeaders()` | Get W3C trace headers for propagation |
| `withExtractedContext(headers, fn)` | Restore context from headers |

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
