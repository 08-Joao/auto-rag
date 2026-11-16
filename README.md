# Auto RAG Automotivo

Aplicação de perguntas e respostas sobre manuais automotivos. O projeto combina:

- frontend em Next.js;
- API em NestJS;
- PostgreSQL para usuários, chats e mensagens;
- Ollama para geração local de respostas;
- recuperação híbrida com FAISS, BM25 e embeddings;
- recuperação/reranking opcional de imagens.

Este guia descreve a instalação local completa, incluindo o Ollama, os modelos e o corpus de manuais.

## Requisitos

Instale antes de começar:

- Git;
- Node.js 20.9 ou superior;
- pnpm 9 ou superior;
- Python 3.10 ou superior;
- PostgreSQL 14 ou superior;
- Ollama;
- aproximadamente 3 GB livres para o pacote dos manuais, PDFs extraídos e cache dos modelos.

O projeto usa `pnpm-lock.yaml`. Para evitar versões diferentes das testadas, use `pnpm install --frozen-lockfile`.

## 1. Obter o código

```bash
git clone https://github.com/08-Joao/auto-rag.git
cd auto-rag
```

Se o repositório já estiver clonado, apenas entre na pasta raiz do projeto.

## 2. Instalar e iniciar o Ollama

### Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
```

Se o serviço não estiver disponível pelo `systemctl`, inicie o Ollama em um terminal:

```bash
ollama serve
```

### macOS e Windows

Baixe o instalador oficial em [ollama.com/download](https://ollama.com/download) e abra o aplicativo uma vez. O comando `ollama` deve ficar disponível no terminal.

### Verificar a instalação

```bash
ollama --version
ollama list
```

## 3. Baixar os modelos locais

O backend usa `deepseek-r1:8b` para gerar respostas. O modelo `qwen2.5vl:7b` é usado pelo reranker visual quando essa função está habilitada.

```bash
ollama pull deepseek-r1:8b
ollama pull qwen2.5vl:7b
ollama list
```

O primeiro download pode demorar e ocupar vários gigabytes. O Ollama mantém os modelos em cache; não é necessário baixá-los novamente em cada execução.

Para testar o modelo principal:

```bash
ollama run deepseek-r1:8b "Responda apenas: Ollama funcionando"
```

## 4. Instalar as dependências Python

Na raiz do repositório:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

No Windows PowerShell, use:

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\pip install -r requirements.txt
```

As dependências Python são usadas pelo recuperador de chunks e pelo notebook de processamento dos PDFs.

## 5. Baixar os documentos

Os documentos não são versionados no Git. O pacote oficial usado pelo projeto está neste [arquivo do Google Drive](https://drive.google.com/file/d/1Gp7cDoDXWvSjudzCcK8vSEDWFHv46iM6/view?usp=sharing).

O script abaixo baixa o pacote, retoma um download interrompido, valida o SHA-256 do arquivo, extrai os documentos e valida individualmente os 30 PDFs:

```bash
./scripts/setup-documents.sh
```

Uma instalação concluída deve produzir:

```text
documents/audi/   # 22 manuais Audi
documents/bmw/    # 8 manuais BMW
```

Para substituir uma instalação incompleta ou modificada:

```bash
./scripts/setup-documents.sh --force
```

O script usa o ID do arquivo já configurado no repositório. Para usar outro arquivo compatível, defina `AUTO_RAG_DOCUMENTS_FILE_ID` ou `AUTO_RAG_DOCUMENTS_URL` antes de executar o script.

## 6. Gerar o índice RAG

O índice FAISS e os metadados são gerados pelo notebook `chunking.ipynb`. Se `rag_chunks_output/` já estiver presente com `manual_chunks.faiss` e `chunks_metadata.json`, esta etapa pode ser pulada.

Para gerar um índice novo:

```bash
.venv/bin/jupyter lab
```

Abra `chunking.ipynb`, execute as células em ordem e aguarde a conclusão. O notebook lê os PDFs em `documents/` e grava:

```text
rag_chunks_output/manual_chunks.faiss
rag_chunks_output/chunks_metadata.json
rag_chunks_output/images/
rag_chunks_output/processing_report.json
```

O processamento dos 30 manuais pode consumir alguns minutos ou mais, dependendo da CPU, memória e, se configurado, da GPU.

## 7. Configurar o PostgreSQL

Crie um banco PostgreSQL local ou use um banco de desenvolvimento já existente. Depois, crie o arquivo `rag-automotivo-backend/.env`:

```dotenv
DATABASE_URL=postgresql://USUARIO:SENHA@localhost:5432/auto_rag
```

O arquivo `.env` é local e não deve ser commitado. O backend também aceita estas configurações opcionais:

```dotenv
PORT=4005
FRONTEND_URL=http://localhost:3005
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:8b
RAG_OUTPUT_DIR=../rag_chunks_output
RAG_PYTHON_BIN=../.venv/bin/python
RAG_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RAG_VISUAL_RETRIEVAL_ENABLED=true
RAG_QWEN_RERANKER_ENABLED=false
RAG_QWEN_RERANKER_MODEL=qwen2.5vl:7b
```

No Windows, altere `RAG_PYTHON_BIN` para `..\\.venv\\Scripts\\python.exe` se o caminho padrão não for detectado automaticamente.

## 8. Instalar dependências JavaScript e preparar o banco

Em um terminal, instale e prepare o backend:

```bash
cd rag-automotivo-backend
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

Em outro terminal, instale as dependências do frontend:

```bash
cd rag-automotivo-frontend
pnpm install --frozen-lockfile
```

## 9. Executar a aplicação

Mantenha o Ollama em execução e abra dois terminais na raiz do projeto.

Terminal 1 — API:

```bash
cd rag-automotivo-backend
pnpm run start:dev
```

A API ficará disponível em `http://localhost:4005`.

Terminal 2 — frontend:

```bash
cd rag-automotivo-frontend
pnpm run dev
```

Acesse [http://localhost:3005](http://localhost:3005).

## 10. Verificar a instalação

Confirme os seguintes itens antes de testar o chat:

```bash
ollama list
test -f rag_chunks_output/manual_chunks.faiss
test -f rag_chunks_output/chunks_metadata.json
```

Depois, crie uma conta no frontend, inicie um chat e faça uma pergunta específica sobre um dos veículos presentes no corpus. O backend deve registrar no log a inicialização do recuperador e retornar as fontes usadas na resposta.

## Testes e validações

Backend:

```bash
cd rag-automotivo-backend
pnpm run test
pnpm run test:cov
pnpm run build
```

Frontend:

```bash
cd rag-automotivo-frontend
pnpm run lint
pnpm run build
```

## Solução de problemas

### `ollama: command not found`

Feche e reabra o terminal após instalar o Ollama. No Linux, verifique também `systemctl status ollama` ou inicie manualmente com `ollama serve`.

### `model not found`

Baixe exatamente os modelos esperados:

```bash
ollama pull deepseek-r1:8b
ollama pull qwen2.5vl:7b
```

### `DATABASE_URL is not configured`

Verifique se `rag-automotivo-backend/.env` existe e contém uma URL PostgreSQL válida.

### `manual_chunks.faiss` não encontrado

Execute a instalação dos documentos e gere o índice pelo `chunking.ipynb`. O backend não consegue recuperar contexto sem esses dois arquivos:

```text
rag_chunks_output/manual_chunks.faiss
rag_chunks_output/chunks_metadata.json
```

### O frontend não consegue acessar a API

Garanta que o backend está na porta 4005. Para outra porta, defina `NEXT_PUBLIC_API_URL` no ambiente do frontend, por exemplo:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:4005
```

## Estrutura principal

```text
.
├── documents/                 # PDFs locais, baixados sob demanda
├── rag_chunks_output/         # índice FAISS e metadados gerados
├── chunking.ipynb             # processamento dos PDFs
├── scripts/setup-documents.sh # download e validação dos manuais
├── rag-automotivo-backend/    # API NestJS e pipeline RAG
└── rag-automotivo-frontend/   # interface Next.js
```

## Segurança e dados locais

Não committe arquivos `.env`, credenciais, os PDFs, o índice gerado ou os modelos do Ollama. Esses artefatos estão excluídos do Git por serem locais, grandes ou sensíveis.
