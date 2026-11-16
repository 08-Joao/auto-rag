import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve("experiments");
const FORM_ID = "1OtQf0r0Rcngzo1Y0l983_cijeE6kpbLdZE1gE--1s4E";
const SYSTEMS = [
  "deepseek-sem-rag",
  "rag-com-clip",
  "rag-com-qwen",
  "chatgpt-web",
  "claude-web",
];

const key = JSON.parse(
  fs.readFileSync(path.join(ROOT, "gabarito-privado.json"), "utf8"),
).perguntas;

function cleanMarkdown(markdown) {
  return markdown
    .replace(/^## Imagens exibidas\s*$/gm, "")
    .replace(/^!\[[^\]]*\]\([^\n]+\)\s*$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const payload = { formId: FORM_ID, questions: {} };
for (let number = 1; number <= 10; number += 1) {
  const questionKey = `pergunta-${String(number).padStart(2, "0")}`;
  const questionMarkdown = fs.readFileSync(
    path.join(ROOT, questionKey, "pergunta.md"),
    "utf8",
  );
  const question = questionMarkdown.replace(/^#\s+Pergunta\s+\d+\s*/i, "").trim();
  const responses = {};

  for (const system of SYSTEMS) {
    const directory = path.join(ROOT, questionKey, system);
    const markdown = fs.readFileSync(path.join(directory, "resposta.md"), "utf8");
    const imageDirectory = path.join(directory, "imagens");
    const images = fs.existsSync(imageDirectory)
      ? fs.readdirSync(imageDirectory).sort().map((name, index) => {
          const bytes = fs.readFileSync(path.join(imageDirectory, name));
          const match = markdown.match(
            new RegExp(`!\\[([^\\]]*)\\]\\(imagens/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`),
          );
          return {
            caption: match?.[1] || `Imagem ${index + 1}`,
            md5: crypto.createHash("md5").update(bytes).digest("hex"),
            name,
          };
        })
      : [];

    responses[system] = {
      images,
      text: cleanMarkdown(markdown),
    };
  }

  payload.questions[questionKey] = {
    number,
    order: key[questionKey],
    question,
    responses,
  };
}

const compressedPayload = zlib.gzipSync(JSON.stringify(payload)).toString("base64");

const script = `// Gerado por experiments/build-google-form-rebuild.mjs.
// Reconstrói a rodada cega atual e mantém o formulário fechado até a validação.
const EXPERIMENT_PAYLOAD_GZIP_BASE64 = ${JSON.stringify(compressedPayload)};

function decodeExperimentPayload_() {
  const bytes = Utilities.base64Decode(EXPERIMENT_PAYLOAD_GZIP_BASE64);
  const json = Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString("UTF-8");
  return JSON.parse(json);
}

function normalizeResponseText_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function digestHex_(blob) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes())
    .map(function (byte) { return (byte + 256).toString(16).slice(-2); })
    .join("");
}

function prefixScore_(left, right) {
  const limit = Math.min(left.length, right.length, 1200);
  let score = 0;
  while (score < limit && left.charAt(score) === right.charAt(score)) score += 1;
  return score;
}

function splitForForms_(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const paragraphs = text.split(/\\n\\s*\\n/);
  const parts = [];
  let current = "";
  paragraphs.forEach(function (paragraph) {
    if (paragraph.length > maxLength) {
      if (current) { parts.push(current); current = ""; }
      for (let start = 0; start < paragraph.length; start += maxLength) {
        parts.push(paragraph.slice(start, start + maxLength));
      }
      return;
    }
    const candidate = current ? current + "\\n\\n" + paragraph : paragraph;
    if (candidate.length > maxLength) {
      parts.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  });
  if (current) parts.push(current);
  return parts;
}

function captureExistingImages_(form, payload) {
  const groups = {};
  let questionKey = null;
  let groupKey = null;

  form.getItems().forEach(function (item) {
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) {
      const match = item.getTitle().match(/(?:Questão|Pergunta)\\s*0*(\\d+)/i);
      questionKey = match
        ? "pergunta-" + String(Number(match[1])).padStart(2, "0")
        : null;
      groupKey = null;
      return;
    }
    if (!questionKey) return;

    if (item.getType() === FormApp.ItemType.SECTION_HEADER) {
      const title = item.getTitle();
      const match = title.match(/^Resposta\\s+([A-E])(?:\\s+—\\s+parte\\s+\\d+\\/\\d+)?$/i);
      if (match) {
        groupKey = questionKey + ":" + match[1].toUpperCase();
        groups[groupKey] = groups[groupKey] || { images: [], texts: [] };
        groups[groupKey].texts.push(item.asSectionHeaderItem().getHelpText() || "");
      } else if (!/^Resposta\\s+[A-E]/i.test(title)) {
        groupKey = null;
      }
      return;
    }

    if (item.getType() === FormApp.ItemType.IMAGE && groupKey) {
      const image = item.asImageItem();
      groups[groupKey].images.push({
        blob: image.getImage(),
        helpText: image.getHelpText() || "",
        title: image.getTitle() || "",
      });
      return;
    }

    if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE ||
        item.getType() === FormApp.ItemType.SCALE) {
      groupKey = null;
    }
  });

  const captured = {};
  Object.keys(payload.questions).forEach(function (questionKey) {
    const question = payload.questions[questionKey];
    captured[questionKey] = {};
    const candidates = Object.keys(groups)
      .filter(function (key) { return key.indexOf(questionKey + ":") === 0; })
      .map(function (key) { return groups[key]; });

    Object.keys(question.responses).forEach(function (system) {
      const target = question.responses[system];
      const normalizedTarget = normalizeResponseText_(target.text);
      let best = null;
      let bestScore = -1;

      candidates.forEach(function (candidate) {
        const normalizedCandidate = normalizeResponseText_(candidate.texts.join("\\n\\n"));
        let score = prefixScore_(normalizedCandidate, normalizedTarget);
        const expected = target.images.map(function (image) { return image.md5; });
        const actual = candidate.images.map(function (image) { return digestHex_(image.blob); });
        if (expected.length === actual.length && expected.every(function (hash, index) {
          return hash === actual[index];
        })) score += 10000;
        if (score > bestScore) { bestScore = score; best = candidate; }
      });

      captured[questionKey][system] = best && bestScore >= 40 ? best.images : [];
    });
  });
  return captured;
}

function rebuildBlindEvaluationForm() {
  const payload = decodeExperimentPayload_();
  const form = FormApp.openById(payload.formId);
  form.setAcceptingResponses(false);
  const capturedImages = captureExistingImages_(form, payload);

  const items = form.getItems();
  let firstQuestionSection = items.findIndex(function (item) {
    return item.getType() === FormApp.ItemType.PAGE_BREAK;
  });
  if (firstQuestionSection < 0) throw new Error("Nenhuma seção de perguntas foi encontrada.");
  for (let index = items.length - 1; index >= firstQuestionSection; index -= 1) {
    form.deleteItem(index);
  }

  let responseCount = 0;
  let imageCount = 0;
  Object.keys(payload.questions).sort().forEach(function (questionKey) {
    const question = payload.questions[questionKey];
    form.addPageBreakItem()
      .setTitle("Questão " + String(question.number).padStart(2, "0"))
      .setHelpText(question.question + "\\n\\nLeia integralmente as respostas A–E antes de avaliá-las.");

    ["A", "B", "C", "D", "E"].forEach(function (letter) {
      const system = question.order[letter];
      const response = question.responses[system];
      const parts = splitForForms_(response.text, 1800);
      parts.forEach(function (part, index) {
        const title = parts.length === 1
          ? "Resposta " + letter
          : "Resposta " + letter + " — parte " + (index + 1) + "/" + parts.length;
        form.addSectionHeaderItem().setTitle(title).setHelpText(part);
      });

      const images = capturedImages[questionKey][system] || [];
      images.forEach(function (image, index) {
        form.addImageItem()
          .setTitle(response.images[index] ? response.images[index].caption : (image.title || "Imagem " + (index + 1)))
          .setHelpText(image.helpText || "Imagem exibida junto da Resposta " + letter)
          .setImage(image.blob);
        imageCount += 1;
      });

      form.addScaleItem()
        .setTitle("Nota da Resposta " + letter)
        .setBounds(1, 10)
        .setLabels("1 — não atende à pergunta", "10 — atende completamente")
        .setRequired(true);
      responseCount += 1;
    });
  });

  if (responseCount !== 50) throw new Error("Contagem inválida de respostas: " + responseCount);
  console.log("RESPONSES=" + responseCount);
  console.log("IMAGES_REUSED=" + imageCount);
  console.log("ITEMS=" + form.getItems().length);
  console.log("PUBLIC_URL=" + form.getPublishedUrl());
}
`;

const outputDirectory = path.join(ROOT, "google-forms");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "rebuild-blind-evaluation-form.gs");
fs.writeFileSync(outputPath, script);
console.log(outputPath);
