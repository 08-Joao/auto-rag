# Corpus de manuais

Esta pasta recebe os 30 manuais usados no TCC e no índice RAG ativo:

- 22 manuais Audi;
- 8 manuais BMW.

A seleção corresponde exatamente aos caminhos únicos registrados em
`rag_chunks_output/chunks_metadata.json`. Os PDFs não são versionados no Git;
eles são baixados sob demanda e conferidos contra `checksums.sha256`.

## Instalação

Na raiz do projeto, execute:

```bash
./scripts/setup-documents.sh
```

O instalador aceita retomada de download, valida o pacote completo por SHA-256
e também valida individualmente os 30 PDFs. Uma instalação já íntegra não é
baixada novamente.
