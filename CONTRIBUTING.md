# Contributing to Blackbook

Thank you for your interest in contributing to Blackbook!

## Getting Started

Prerequisites for development: Node.js 23.x and pnpm.

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/blackbook.git`
3. Install dependencies: `cd tui && pnpm install`
4. Run tests: `pnpm test`
5. Run in development mode: `pnpm dev`

## Development Workflow

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run tests and type checking: `pnpm test && pnpm typecheck`
4. Commit your changes with a descriptive message
5. Push to your fork and open a Pull Request

## Code Style

- TypeScript with strict mode enabled
- React functional components with hooks
- Ink for TUI components
- Zustand for state management

## Testing

Run the test suite with:

```bash
cd tui
pnpm test
```

## Reporting Issues

Please use [GitHub Issues](https://github.com/ssweens/blackbook/issues) to report bugs or request features. Include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (OS, Node version, etc.)

## License

By contributing to Blackbook, you agree that your contributions will be licensed under the Apache 2.0 License.
