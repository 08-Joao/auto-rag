# Avaliação do pipeline RAG

Data: 2026-07-26

## Método

O cenário conversacional foi executado contra o índice FAISS real. A suíte
unitária avalia os dez pares semanticamente próximos definidos em
`rag-evaluation-cases.json`, conflitos entre componentes, correspondência do
veículo, preservação da intenção, correções e continuações.

## Antes

Para `Onde fica a tampa do tanque de combustível do Audi A4 2008?`, os quatro
primeiros resultados eram manuais BMW 1999 sobre `engine oil filler neck`.
Nenhum dos cinco primeiros chunks continha a resposta. O primeiro chunk
realmente útil do Audi A4 2008 não era priorizado, e chunks de óleo recebiam
`domain=0.95` por causa da palavra genérica `tampa`.

| Métrica do cenário crítico | Antes |
| --- | ---: |
| Veículo correto no top-1 | 0% |
| Componente correto no top-1 | 0% |
| Chunks relevantes no top-5 | 0% |
| Consulta de continuação independente | 0% |
| Rejeição explícita de conflito óleo/combustível | 0% |

## Depois

Com a consulta reconstruída e os filtros `Audi / A4 / 2008`, o recuperador
encontrou `chunk_000382_2297afc707`, página 254, contendo `Fuel tank flap with
tank cap attached`. A validação aceitou somente esse chunk e rejeitou o chunk
de compartimento do motor com
`component_conflict:oil_filler,brake_fluid,coolant,oil_dipstick`.

| Métrica automatizada | Depois |
| --- | ---: |
| Casos de conceito aprovados | 10/10 |
| Preservação do cenário de continuação | 1/1 |
| Correção de veículo preservada | 1/1 |
| Mudança de assunto preservando veículo | 1/1 |
| Rejeição do conjunto conflitante | 1/1 |
| Recusa exata sem fontes irrelevantes | 1/1 |
| Testes backend | 35/35 |
| Teste end-to-end da aplicação | 1/1 |

Os números refletem o conjunto pequeno de regressão e não substituem uma
avaliação anotada em escala maior.

## Revalidação prática em 2026-08-23

Um teste real no navegador revelou que a pergunta sobre óleo do Audi A4 2008
recuperava corretamente a página 325-326 (score final 0,85), mas o gerador
recusava a resposta e essa recusa ainda recebia confiança 0,83. A revisão final
passou a tratar esse caso como falha fatal. Para especificações estruturadas, a
resposta agora extrai diretamente as normas encontradas e declara quando a
viscosidade SAE não aparece no trecho.

Também foi corrigido o reranking multimodal da portinhola de combustível, que
antes reutilizava regras específicas da tampa de óleo. No reteste da página
254, apenas a imagem da portinhola aberta foi selecionada; uma imagem vizinha de
outro componente foi rejeitada.

| Cenário | Antes | Depois |
| --- | ---: | ---: |
| Óleo A4 2008, ponta a ponta | ~26 s + recusa incorreta | ~13,4 s, normas fundamentadas |
| Repetição idêntica | ~26 s | ~1,5 s (cache) |
| Portinhola A4 2008 | ~80,8 s, sem imagem e texto defeituoso | ~19,7 s, procedimento + 1 imagem relevante |
| Testes backend | 47/47 | 50/50 |

## Evolução generalista e pré-seleção

A validação deixou de exigir que o assunto pertença à taxonomia auxiliar de
componentes. Perguntas inéditas usam termos informativos abertos, códigos,
números, score semântico e score híbrido. A taxonomia permanece apenas como
barreira de conflito quando ambos os conceitos são reconhecidos.

Após a validação, as evidências são classificadas como `DIRECTLY_ANSWERS`,
`COMPLEMENTS`, `ONLY_RELATED` ou `UNRELATED`. Somente as duas primeiras podem
chegar ao gerador. O corte é adaptativo: `max(0,32; 82% do melhor score; melhor
score - 0,10)`, limitado a seis evidências para controlar contexto e latência.
Assim, a quantidade enviada varia com a qualidade, em vez de usar um Top-K
fixo.

Uma segunda similaridade semântica é calculada sobre o título e os primeiros
1.600 caracteres do candidato. Esse sinal reduz falsos positivos causados por
uma menção incidental no final de chunks longos.
