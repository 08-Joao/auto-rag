# Avaliação cega

Esta pasta contém apenas as perguntas da nova rodada experimental. As respostas e os resultados da rodada anterior foram removidos para que a avaliação seja refeita de forma justa.

## Estrutura

Cada pasta `pergunta-XX/` começa somente com `pergunta.md`. Ao executar novamente os cinco sistemas, cada resposta deve ser salva assim:

```text
pergunta-01/
├── pergunta.md
├── deepseek-sem-rag/
│   ├── resposta.md
│   └── imagens/
├── rag-com-clip/
│   ├── resposta.md
│   └── imagens/
├── rag-com-qwen/
│   ├── resposta.md
│   └── imagens/
├── chatgpt-web/
│   ├── resposta.md
│   └── imagens/
└── claude-web/
    ├── resposta.md
    └── imagens/
```

A pasta `imagens/` só deve existir quando a resposta realmente apresentar imagens ao usuário. Não devem ser adicionadas capturas da interface, logotipos ou nomes do sistema.

## Regra para o formulário

Cada alternativa anônima deve reproduzir integralmente o que o usuário recebeu:

- texto da resposta;
- imagens efetivamente apresentadas junto da resposta;
- ordem e legenda necessárias para compreender as imagens;
- nenhuma identificação do modelo ou da interface de origem.

As alternativas continuam identificadas apenas como **Resposta A**, **Resposta B**, **Resposta C**, **Resposta D** e **Resposta E**. Depois de cada resposta, o participante atribui uma única nota obrigatória em escala linear:

- **1:** não atende à pergunta;
- **10:** atende completamente à pergunta.

A nota deve considerar a resposta completa, incluindo texto e imagens. Não haverá escolha de melhor ou pior resposta nem métricas separadas.

## Aleatorização sem viés de posição

A ordem A--E foi sorteada previamente com a semente fixa `2318019`. Foram usados dois blocos de quadrado latino: nas dez perguntas, cada sistema aparece exatamente duas vezes em cada posição. Assim, nenhum modelo é favorecido por aparecer com maior frequência no início ou no fim.

O sorteio move o bloco completo da resposta: título anônimo, texto, imagens e escala permanecem juntos. A opção nativa do Google Forms para embaralhar perguntas não deve ser ativada, pois ela poderia separar esses elementos.

O arquivo local `gabarito-privado.json` contém o mapeamento entre letras e sistemas. Ele é ignorado pelo Git e não deve ser compartilhado com os participantes.

Formulário público: <https://docs.google.com/forms/d/e/1FAIpQLSdPICK3dD-5TG8nSligO9x_DX6T7-lKl_Fa6uE92IIsM0G13A/viewform>

Enquanto as novas respostas com imagens não forem coletadas e inseridas, o formulário deve permanecer sem aceitar respostas.
