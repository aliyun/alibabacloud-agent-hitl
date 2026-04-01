# Contributing to Alibaba Cloud HITL Interceptor

Thank you for your interest in contributing to this project!

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/alibabacloud-hitl-claw-plugin.git
   cd alibabacloud-hitl-claw-plugin
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Testing Locally

1. Build the plugin
2. Install it to OpenClaw:
   ```bash
   openclaw plugins install .
   ```
3. Test with OpenClaw

## Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add comments for complex logic
- Keep functions focused and testable

## Pull Request Process

1. Ensure your code builds without errors
2. Update documentation if needed
3. Write a clear PR description explaining your changes
4. Link any related issues

## Reporting Issues

When reporting issues, please include:

- OpenClaw version
- Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Error messages or logs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
