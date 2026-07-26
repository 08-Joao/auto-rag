<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## RAG local com LangChain e Ollama

O fluxo de chat usa o módulo `src/rag` para executar um RAG local:

- `RagRetrieverService`: chama um script Python para recuperar chunks em `../rag_chunks_output/manual_chunks.faiss`;
- `scripts/retrieve_chunks.py`: lê o FAISS e `../rag_chunks_output/chunks_metadata.json`;
- `RagService`: monta o contexto e executa a chain LangChain;
- `OllamaService`: fornece o modelo LangChain `Ollama` apontando para `deepseek-r1:8b`.

Antes de usar os chats, garanta que o índice foi gerado pelo notebook `../chunking.ipynb` e que o modelo está disponível:

```bash
$ ollama pull deepseek-r1:8b
$ ollama pull qwen2.5vl:7b
$ ollama list
```

Crie o ambiente Python do recuperador na raiz do projeto:

```bash
$ cd ..
$ python3 -m venv .venv
$ .venv/bin/pip install -r requirements.txt
```

Variáveis opcionais:

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:8b
RAG_OUTPUT_DIR=../rag_chunks_output
RAG_TOP_K=5
RAG_PYTHON_BIN=../.venv/bin/python
RAG_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RAG_BM25_TOP_K=40
RAG_RERANKER_TOP_K=40
# Opcional, local/cacheado:
# RAG_RERANKER_MODEL=BAAI/bge-reranker-v2-m3
RAG_CLIP_THRESHOLD=0.24
RAG_CLIP_MAX_IMAGES=5
RAG_CLIP_DEVICE=cpu
RAG_EMBEDDING_DEVICE=cpu
RAG_RERANKER_DEVICE=cpu
RAG_VISUAL_RETRIEVAL_ENABLED=true
RAG_QWEN_RERANKER_ENABLED=false
RAG_MAX_CONCURRENT_RETRIEVALS=1
RAG_MAX_CONCURRENT_GENERATIONS=1
RAG_GENERATION_TEMPERATURE=0
RAG_GENERATION_TOP_P=1
RAG_QWEN_RERANKER_MODEL=qwen2.5vl:7b
RAG_QWEN_MAX_IMAGES=5
# Defina como true somente para executar o Qwen sem analisar os pixels:
RAG_QWEN_TEXT_ONLY=false
```

### Pipeline de qualidade implementado

O recuperador combina busca vetorial FAISS, BM25 local, suplementos lexicais de dominio e metadados do veiculo. Quando `RAG_RERANKER_MODEL` e definido, os candidatos tambem passam por um cross-encoder local antes de chegar ao LLM.

A resposta final preserva o contrato antigo (`answer`, `sources`, `returnImages`) e adiciona metadados profissionais: `confidence`, `status`, `reasoning_type`, `vehicle_detected`, `citations`, `images`, `warnings`, `missing_information` e `retrieval_scores` por fonte.

O CLIP continua local e so e chamado quando a pergunta tem intencao visual e existem imagens candidatas. As imagens exibidas passam a vir preferencialmente dos resultados aprovados pelo CLIP.

Para o reranking visual com Qwen, use uma variante VL. `qwen2.5:7b` e um
modelo apenas textual e nao aceita o campo `images` da API do Ollama. O servico
consulta as capacidades do modelo antes do reranking e, quando `vision` nao
estiver disponivel, usa somente legenda, OCR e contexto textual sem disparar
uma requisicao visual invalida.

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
