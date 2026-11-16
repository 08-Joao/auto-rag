#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${AUTO_RAG_ROOT:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
CHECKSUM_FILE="$ROOT_DIR/documents/checksums.sha256"
ARCHIVE_NAME="auto-rag-documents-30-manuals.tar.gz"
ARCHIVE_SHA256="ee0241dc39cd2d766acec1922597807671d8596ad7bf3e9cc5b34640db569701"
DRIVE_FILE_ID="${AUTO_RAG_DOCUMENTS_FILE_ID:-1Gp7cDoDXWvSjudzCcK8vSEDWFHv46iM6}"
DOWNLOAD_URL="${AUTO_RAG_DOCUMENTS_URL:-https://drive.usercontent.google.com/download?id=${DRIVE_FILE_ID}&export=download&confirm=t}"
CACHE_DIR="${AUTO_RAG_CACHE_DIR:-$ROOT_DIR/.cache/auto-rag-documents}"
ARCHIVE_PATH="$CACHE_DIR/$ARCHIVE_NAME"
FORCE=false

usage() {
  cat <<'EOF'
Uso: ./scripts/setup-documents.sh [--force]

Baixa e valida os 30 manuais usados pelo RAG.

Opções:
  --force  Substitui uma instalação local incompleta ou modificada.
  -h       Exibe esta ajuda.

Variáveis opcionais:
  AUTO_RAG_DOCUMENTS_URL      URL alternativa do pacote.
  AUTO_RAG_DOCUMENTS_FILE_ID  ID alternativo do arquivo no Google Drive.
  AUTO_RAG_CACHE_DIR          Diretório de cache do pacote.
EOF
}

fail() {
  printf 'Erro: %s\n' "$1" >&2
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "opção desconhecida: $arg" ;;
  esac
done

for command in curl tar sha256sum find; do
  command -v "$command" >/dev/null 2>&1 || fail "comando obrigatório não encontrado: $command"
done

test -f "$CHECKSUM_FILE" || fail "manifesto de checksums não encontrado: $CHECKSUM_FILE"

verify_documents() {
  (
    cd -- "$ROOT_DIR"
    sha256sum --check --status documents/checksums.sha256 2>/dev/null
  )
}

if verify_documents; then
  printf 'Os 30 manuais já estão instalados e íntegros.\n'
  exit 0
fi

if [[ -d "$ROOT_DIR/documents/audi" || -d "$ROOT_DIR/documents/bmw" ]] && [[ "$FORCE" != true ]]; then
  fail "há manuais locais ausentes ou modificados; revise-os ou execute novamente com --force"
fi

install -d -- "$CACHE_DIR"

if [[ ! -f "$ARCHIVE_PATH" ]] || ! printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE_PATH" | sha256sum --check --status; then
  printf 'Baixando os manuais (aproximadamente 1,67 GB)...\n'
  curl \
    --location \
    --fail \
    --retry 5 \
    --retry-delay 2 \
    --continue-at - \
    --output "$ARCHIVE_PATH" \
    "$DOWNLOAD_URL"
fi

printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE_PATH" | sha256sum --check --status \
  || fail "o pacote baixado não corresponde ao SHA-256 esperado"

while IFS= read -r entry; do
  case "$entry" in
    documents/audi/|documents/bmw/|documents/audi/*.pdf|documents/bmw/*.pdf) ;;
    *) fail "entrada inesperada no pacote: $entry" ;;
  esac
done < <(tar -tzf "$ARCHIVE_PATH")

STAGING_DIR="$(mktemp -d "$CACHE_DIR/extract.XXXXXX")"
cleanup() {
  rm -rf -- "$STAGING_DIR"
}
trap cleanup EXIT

tar -xzf "$ARCHIVE_PATH" --no-same-owner --no-same-permissions -C "$STAGING_DIR"

pdf_count="$(find "$STAGING_DIR/documents" -type f -name '*.pdf' | wc -l)"
[[ "$pdf_count" -eq 30 ]] || fail "o pacote contém $pdf_count PDFs; eram esperados 30"

(
  cd -- "$STAGING_DIR"
  sha256sum --check --status "$CHECKSUM_FILE"
) || fail "um ou mais manuais falharam na validação individual"

if [[ "$FORCE" == true ]]; then
  rm -rf -- "$ROOT_DIR/documents/audi" "$ROOT_DIR/documents/bmw"
fi

install -d -- "$ROOT_DIR/documents"
mv -- "$STAGING_DIR/documents/audi" "$ROOT_DIR/documents/audi"
mv -- "$STAGING_DIR/documents/bmw" "$ROOT_DIR/documents/bmw"

verify_documents || fail "a validação final dos manuais falhou"
printf 'Instalação concluída: 30 manuais validados em %s/documents.\n' "$ROOT_DIR"
