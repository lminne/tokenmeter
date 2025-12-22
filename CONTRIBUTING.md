# Contributing to tokenmeter

Thanks for your interest in contributing to tokenmeter! This document outlines how to get started.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/lminne/tokenmeter.git
   cd tokenmeter
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Run tests**

   ```bash
   pnpm test
   ```

4. **Build**

   ```bash
   pnpm build
   ```

## Project Structure

```
src/
├── index.ts                 # Main exports
├── types.ts                 # TypeScript types
├── context.ts               # withAttributes, context propagation
├── logger.ts                # Internal logging
├── instrumentation/
│   ├── proxy.ts             # monitor() implementation
│   └── strategies/          # Provider-specific extraction
├── processor/
│   └── TokenMeterProcessor.ts
├── exporter/
│   └── PostgresExporter.ts
├── query/
│   └── client.ts            # Query client for PostgreSQL
├── pricing/
│   ├── manifest.ts          # Pricing fetching and caching
│   └── providers/           # Bundled pricing data
├── integrations/
│   ├── next/                # Next.js App Router
│   └── inngest/             # Inngest integration
└── __tests__/               # Test files
```

## Making Changes

### Adding a New Provider

1. Add pricing data to `src/pricing/providers/{provider}.json`
2. Create an extraction strategy in `src/instrumentation/strategies/`
3. Register the strategy in `src/instrumentation/strategies/index.ts`
4. Add tests in `src/__tests__/strategies.test.ts`

### Updating Pricing

1. Edit the relevant file in `src/pricing/providers/`
2. Run `pnpm build` to update the bundled manifest
3. Submit a PR with the pricing source (official docs link)

### Adding a Framework Integration

1. Create a new directory under `src/integrations/{framework}/`
2. Add the export to `package.json` exports field
3. Document in README.md

## Code Style

- TypeScript strict mode
- ESLint for linting (`pnpm lint`)
- No external runtime dependencies beyond OpenTelemetry

## Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run specific test file
pnpm test src/__tests__/proxy.test.ts
```

Tests use Vitest. Each module should have corresponding tests in `src/__tests__/`.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Run type check (`pnpm check-types`)
6. Commit with a descriptive message
7. Push and open a PR

### PR Guidelines

- Keep PRs focused on a single change
- Update documentation if adding features
- Add tests for new functionality
- Update CHANGELOG.md for notable changes

## Reporting Issues

When reporting issues, please include:

- tokenmeter version
- Node.js version
- Minimal reproduction code
- Expected vs actual behavior

## Questions?

Open a [GitHub Discussion](https://github.com/lminne/tokenmeter/discussions) for questions or ideas.
