# Sylph API

Free API access to AI language models for students and developers in developing countries. Seamlessly integrate with multiple LLMs through a unified, OpenAI-compatible interface.

A hosted version is available at [ai.minoa.cat](https://ai.minoa.cat)

## Features

- Free access - no credit card required
- OpenAI-compatible API endpoints
- Access to multiple model providers
- Automatic failover between providers
- Real-time health monitoring
- Privacy-focused with no data collection

## Setup Guide

1. Clone the repository:
```bash
git clone https://github.com/m1noa/Sylph
cd Sylph
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

The server will start on port 3000 by default. You can change this in your .env file.

## Using the API

Basic example:

```bash
curl https://ai.minoa.cat/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hackclub/llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

For full documentation and available models, visit:
- [API Documentation](https://ai.minoa.cat/docs)
- [Model List](https://ai.minoa.cat/models)

## Contributing

Contributions are greatly appreciated! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

Please ensure your code follows the existing style and includes appropriate tests.

## Support

If you find Sylph helpful, consider:
- Supporting the project at [ai.minoa.cat/donate](https://ai.minoa.cat/donate)
- Sharing with others who might benefit
- Contributing code improvements

## License

 Opinionated Queer License v1.2 - See [LICENSE](LICENSE) [TL;DR](https://oql.avris.it/license.tldr)
