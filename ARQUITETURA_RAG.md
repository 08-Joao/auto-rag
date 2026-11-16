# Arquitetura técnica do Auto RAG

## Escopo e base documental

O sistema consulta 30 manuais automotivos já processados. Esse corpus corresponde
exatamente ao índice ativo, que contém 25.934 chunks. Para evitar adicionar cerca
de 1,7 GB ao histórico Git, os PDFs são baixados sob demanda para `documents/`
por `scripts/setup-documents.sh`, com validação de integridade por SHA-256.

## Pipeline final

```text
Pergunta
  → proteção e normalização
  → reconstrução conversacional + veículo/filtros
  → expansão bilíngue de domínio + aliases de veículo
  → retrieval híbrido (FAISS + BM25 + suplementos lexicais)
  → fusão RRF + sinais de domínio/metadados
  → similaridade semântica do início do chunk
  → cross-encoder opcional
  → validação de veículo, intenção e conflito de componente
  → seleção adaptativa + vizinhos estruturais do procedimento
  → resposta preliminar extrativa OU DeepSeek R1 8B
  → imagens candidatas das páginas selecionadas
  → CLIP (seleção final) OU CLIP → Qwen2.5-VL (shortlist opcional)
  → revisão final de grounding, imagens e confiança
  → resposta + fonte/página/trecho + imagens aprovadas
```

## Fluxo de uma pergunta

1. O backend valida a mensagem e remove tentativas simples de alterar o papel do
   sistema.
2. `QueryRewriterService` usa o estado da conversa para produzir uma consulta
   independente, classificar continuação/correção e preservar marca, modelo, ano,
   motor e versão.
3. Se faltarem dados indispensáveis do veículo, o sistema pede esclarecimento
   antes de consultar o índice.
4. `RagRetrieverService` mantém um worker Python persistente. FAISS, metadados e
   o modelo de embeddings são carregados uma vez por processo; resultados
   idênticos podem ser armazenados por tempo limitado e chamadas simultâneas
   iguais compartilham a mesma execução.
5. `RelevanceValidatorService` rejeita veículo/componente conflitante, separa
   evidência direta, complementar, apenas relacionada e não relacionada e pode
   preservar até dois chunks adjacentes quando um procedimento foi fragmentado
   pela extração do PDF.
6. Apenas evidências diretas ou complementares acima do corte adaptativo chegam
   à resposta.
7. Especificações detectáveis de modo determinístico (por exemplo, normas de
   óleo) e procedimentos explicitamente estruturados podem ser extraídos sem
   pedir ao LLM que os reconstrua. Isso preserva números e reduz alucinação e
   latência. Os demais casos usam `deepseek-r1:8b`.
8. A resposta é revisada contra as evidências. Recusa do gerador apesar de
   evidência direta, detalhes não suportados, confusão entre componentes e mero
   encaminhamento ao manual são penalidades fatais.
9. Se a pergunta for visual, as imagens associadas aos chunks selecionados são
   filtradas; somente as aprovadas chegam ao frontend.
10. Mensagem, fontes, citações, imagens, estado conversacional e sinais de
    confiança são persistidos no PostgreSQL.

## Retrieval híbrido e reranking

- **Query processing:** expansão determinística português--inglês para conceitos
  automotivos, preservação de códigos/números e aliases como `750iL`/`7 Series`.
- **Vetorial:** múltiplas variantes da consulta com embeddings normalizados do modelo
  `paraphrase-multilingual-MiniLM-L12-v2` em um índice FAISS `IndexFlatIP`.
- **Lexical:** BM25 sobre todos os chunks elegíveis, importante para códigos,
  siglas, normas, números e nomes exatos.
- **Suplementos de domínio:** regras conservadoras para conceitos críticos como
  óleo, aro/roda, portinhola de combustível e localização visual.
- **Fusão:** Reciprocal Rank Fusion (RRF), sinais de domínio e correspondência de
  metadados do veículo.
- **Lead semantic score:** nova similaridade sobre título + início do trecho,
  reduzindo falsos positivos por menções incidentais no fim de chunks longos.
- **Cross-encoder:** opcional por configuração. Em falha, o pipeline mantém o
  ranking híbrido e registra o fallback.
- **Seleção final:** corte adaptativo relativo ao melhor candidato, limite de
  seis evidências para o contexto do LLM e inclusão conservadora de vizinhos
  estruturais, com deduplicação por `chunk_id`.

## Chunking

O notebook `chunking.ipynb` extrai blocos de texto e imagens do PDF, detecta
títulos por tipografia e conteúdo, preserva páginas e seções, divide seções
longas em fronteiras naturais e mantém overlap semântico curto. Chunks pequenos
da mesma seção podem ser unidos. Cada registro preserva documento, caminho do
PDF, páginas, seção, motivo da divisão, imagens, marca e identificador FAISS.

O texto de embedding inclui documento, páginas e seção. O texto original não é
substituído e continua disponível para citação e auditoria.

## Multimodalidade

As imagens não são escolhidas apenas por proximidade física. O fluxo é:

1. recuperar e validar chunks textuais;
2. coletar imagens apenas das evidências/páginas selecionadas;
3. aplicar CLIP com prompts positivos e distratores negativos;
4. no modo Qwen, usar no máximo seis resultados do CLIP como pré-filtro e
   apresentar até oito candidatos ao Qwen2.5-VL;
5. combinar o resultado com legenda, texto do chunk e sinais semelhantes a OCR;
6. rejeitar capa, arquivo vazio, imagem genérica, duplicata e componente conflitante;
7. retornar no máximo duas imagens aprovadas.

O Qwen2.5-VL é um reranker opcional por chat e não é um reranker textual dos
chunks. Na configuração Qwen, o CLIP atua primeiro como filtro barato e o modelo
visual faz a decisão mais precisa sobre a shortlist. Caso o Qwen esteja
indisponível, o sistema registra o fallback. Perguntas sem intenção visual não
devem executar nenhum dos dois modelos.

## DeepSeek R1 8B

O `deepseek-r1:8b` continua sendo o gerador local principal. O prompt exige
português do Brasil, linguagem para leigos, uso exclusivo das fontes, preservação
de unidades/códigos e recusa quando não houver evidência. Histórico é usado para
resolver referências, nunca como fonte técnica.

O modelo recebe somente os chunks selecionados, com documento, página, seção,
tipo de conteúdo, entidades e trecho limitado. Scores são úteis para auditoria,
mas não são exibidos como fatos ao usuário.

## Confiança

A confiança interna não é pedida ao LLM. Ela combina score final/reranker,
melhor candidato, média dos candidatos, correspondência de metadados, cobertura
de evidências, consenso documental e qualidade de página/citação. Penalidades de
grounding podem reduzir ou invalidar a resposta.

O frontend traduz o sinal para estados qualitativos:

- evidência forte: confiança interna a partir de 0,75;
- evidência moderada: de 0,50 a 0,74;
- evidência insuficiente: abaixo de 0,50.

Esses rótulos representam qualidade dos sinais do pipeline, não probabilidade
estatística de a resposta estar correta.

## Persistência e API

NestJS expõe autenticação, CRUD de chats, seleção do reranker e mensagens por
SSE. Prisma/PostgreSQL persistem usuários, chats e mensagens. A mensagem do
assistente armazena fontes compactadas, páginas, scores, citações, imagens,
estado conversacional, confiança, avisos e diagnósticos do reranker visual
(estratégia efetiva, duração, candidatos avaliados e imagens selecionadas).
Exclusão remove mensagens e chat em uma transação.

O frontend Next.js usa cookies HTTP-only, tenta renovar a sessão uma vez e
consome os eventos SSE (`user_message`, `assistant_start`, `sources`, `token`,
`done`, `error`). A primeira navegação de um chat ocorre somente após a resposta
ter sido persistida, evitando abortar o stream durante a troca de rota.

## Observabilidade e falhas

Em desenvolvimento, logs estruturados registram consulta resolvida, filtros,
candidatos e scores, validação/rejeição, chunks selecionados, páginas, imagens
candidatas/aprovadas/rejeitadas, modelo, fallbacks e duração das etapas. O
recuperador diferencia índice ausente, falha de embedding, timeout, esgotamento
de recurso e erro interno. Falha visual não elimina uma resposta textual válida.

## Limitações conhecidas

- somente 30 manuais estão indexados;
- a primeira consulta após reinício carrega FAISS/metadados/modelo no worker e é
  mais lenta (aproximadamente 10,4 s no experimento); consultas seguintes ficaram
  em aproximadamente 2,00 s no avaliador de recuperação;
- OCR/extração de PDFs pode embaralhar tabelas e cabeçalhos;
- CLIP mede alinhamento semântico e não substitui entendimento visual detalhado;
- Qwen visual depende de modelo compatível instalado e de recursos locais;
- a confiança é uma heurística auditável, não uma probabilidade calibrada.
