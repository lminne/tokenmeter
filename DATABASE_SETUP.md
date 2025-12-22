# Database Setup

tokenmeter can persist cost data to PostgreSQL for querying and billing.

## Quick Start

### 1. Create the table

```sql
CREATE TABLE tokenmeter_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  organization_id TEXT,
  user_id TEXT,
  workflow_id TEXT,
  cost_usd NUMERIC(10, 6) NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tokenmeter_org ON tokenmeter_costs(organization_id);
CREATE INDEX idx_tokenmeter_user ON tokenmeter_costs(user_id);
CREATE INDEX idx_tokenmeter_workflow ON tokenmeter_costs(workflow_id);
CREATE INDEX idx_tokenmeter_created ON tokenmeter_costs(created_at);
CREATE INDEX idx_tokenmeter_provider ON tokenmeter_costs(provider);
```

### 2. Configure the exporter

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { TokenMeterProcessor } from 'tokenmeter';
import { PostgresExporter } from 'tokenmeter/exporter';

const provider = new NodeTracerProvider();

provider.addSpanProcessor(new TokenMeterProcessor());
provider.addSpanProcessor(new BatchSpanProcessor(
  new PostgresExporter({
    connectionString: process.env.DATABASE_URL,
    tableName: 'tokenmeter_costs', // default
  })
));

provider.register();
```

### 3. Query costs

```typescript
import { createQueryClient } from 'tokenmeter/client';

const client = createQueryClient({
  connectionString: process.env.DATABASE_URL,
});

// Get costs for a user
const { totalCost, count } = await client.getCostByUser('user_123', {
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
});

// Get costs grouped by model
const byModel = await client.getCosts({
  groupBy: ['model'],
  from: new Date('2024-01-01'),
});

// Get workflow cost
const workflowCost = await client.getWorkflowCost('workflow_abc');
```

## Schema Details

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `trace_id` | TEXT | OpenTelemetry trace ID |
| `span_id` | TEXT | OpenTelemetry span ID |
| `provider` | TEXT | AI provider (openai, anthropic, etc.) |
| `model` | TEXT | Model identifier |
| `organization_id` | TEXT | From `withAttributes({ 'org.id': ... })` |
| `user_id` | TEXT | From `withAttributes({ 'user.id': ... })` |
| `workflow_id` | TEXT | From `withAttributes({ 'workflow.id': ... })` |
| `cost_usd` | NUMERIC(10,6) | Cost in USD |
| `input_tokens` | INTEGER | Input token count |
| `output_tokens` | INTEGER | Output token count |
| `created_at` | TIMESTAMPTZ | Timestamp |

## Production Considerations

### Connection Pooling

For serverless environments, use a connection pooler:

```bash
# Supabase with PgBouncer
DATABASE_URL="postgresql://user:pass@db.supabase.co:6543/postgres?pgbouncer=true"

# Neon with pooling
DATABASE_URL="postgresql://user:pass@ep-xyz.us-east-1.aws.neon.tech/db?sslmode=require"
```

### Table Partitioning

For high-volume usage, partition by month:

```sql
CREATE TABLE tokenmeter_costs (
  id UUID DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  organization_id TEXT,
  user_id TEXT,
  workflow_id TEXT,
  cost_usd NUMERIC(10, 6) NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE tokenmeter_costs_2024_01 PARTITION OF tokenmeter_costs
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE tokenmeter_costs_2024_02 PARTITION OF tokenmeter_costs
  FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
-- etc.
```

### Data Retention

Archive or delete old data to manage storage:

```sql
-- Delete data older than 90 days
DELETE FROM tokenmeter_costs WHERE created_at < NOW() - INTERVAL '90 days';
```

## Query Examples

### Total spend by organization this month

```sql
SELECT 
  organization_id,
  SUM(cost_usd) as total_cost,
  COUNT(*) as request_count
FROM tokenmeter_costs
WHERE created_at >= date_trunc('month', NOW())
GROUP BY organization_id
ORDER BY total_cost DESC;
```

### Cost breakdown by model

```sql
SELECT 
  provider,
  model,
  SUM(cost_usd) as total_cost,
  SUM(input_tokens) as total_input,
  SUM(output_tokens) as total_output
FROM tokenmeter_costs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY provider, model
ORDER BY total_cost DESC;
```

### User spend over time

```sql
SELECT 
  date_trunc('day', created_at) as day,
  SUM(cost_usd) as daily_cost
FROM tokenmeter_costs
WHERE user_id = 'user_123'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;
```
