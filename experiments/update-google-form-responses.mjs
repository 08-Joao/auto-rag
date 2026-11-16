import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("experiments");
const FORM_ID = "1OtQf0r0Rcngzo1Y0l983_cijeE6kpbLdZE1gE--1s4E";
const answerKey = JSON.parse(
  fs.readFileSync(path.join(ROOT, "gabarito-privado.json"), "utf8"),
).perguntas;

function toFormsText(markdown) {
  return markdown
    .replace(/^!\[[^\]]*\]\([^\n]+\)\s*$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const collected = {};
for (const [question, positions] of Object.entries(answerKey)) {
  for (const [letter, system] of Object.entries(positions)) {
    if (system !== "chatgpt-web" && system !== "claude-web") continue;
    const responsePath = path.join(ROOT, question, system, "resposta.md");
    const markdown = fs.readFileSync(responsePath, "utf8");
    collected[`${question}:${letter}`] = {
      system,
      text: toFormsText(markdown),
    };
  }
}

if (Object.keys(collected).length !== 20) {
  throw new Error(`Esperadas 20 respostas web; encontradas ${Object.keys(collected).length}.`);
}

const appsScript = `// Gerado por experiments/update-google-form-responses.mjs.
// Atualiza somente as 20 respostas ChatGPT/Claude; não altera as respostas locais.
const COLLECTED_WEB_RESPONSES = ${JSON.stringify(collected, null, 2)};

function updateCollectedWebResponses() {
  const form = FormApp.openById(${JSON.stringify(FORM_ID)});
  const items = form.getItems();
  let currentQuestion = null;
  let updated = 0;
  const seen = [];

  for (const item of items) {
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) {
      const match = item.getTitle().match(/Pergunta\\s*0*(\\d+)/i);
      currentQuestion = match
        ? "pergunta-" + String(Number(match[1])).padStart(2, "0")
        : null;
      continue;
    }

    if (!currentQuestion || item.getType() !== FormApp.ItemType.SECTION_HEADER) {
      continue;
    }

    const match = item.getTitle().match(/^Resposta\\s+([A-E])$/i);
    if (!match) continue;

    const letter = match[1].toUpperCase();
    const key = currentQuestion + ":" + letter;
    const response = COLLECTED_WEB_RESPONSES[key];
    if (!response) continue;

    item.asSectionHeaderItem().setHelpText(response.text);
    updated += 1;
    seen.push(key);
  }

  if (updated !== 20) {
    throw new Error(
      "A atualização foi interrompida: esperadas 20 respostas, encontradas " +
      updated + ". Itens localizados: " + seen.join(", "),
    );
  }

  console.log("UPDATED=" + updated);
  console.log("PUBLIC_URL=" + form.getPublishedUrl());
}
`;

const outputDir = path.join(ROOT, "google-forms");
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "update-collected-web-responses.gs");
fs.writeFileSync(outputPath, appsScript);
console.log(outputPath);
