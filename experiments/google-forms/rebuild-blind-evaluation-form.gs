// Gerado por experiments/build-google-form-rebuild.mjs.
// Reconstrói a rodada cega atual e mantém o formulário fechado até a validação.
const EXPERIMENT_PAYLOAD_GZIP_BASE64 = "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";

function decodeExperimentPayload_() {
  const bytes = Utilities.base64Decode(EXPERIMENT_PAYLOAD_GZIP_BASE64);
  const json = Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString("UTF-8");
  return JSON.parse(json);
}

function normalizeResponseText_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  const paragraphs = text.split(/\n\s*\n/);
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
    const candidate = current ? current + "\n\n" + paragraph : paragraph;
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
      const match = item.getTitle().match(/(?:Questão|Pergunta)\s*0*(\d+)/i);
      questionKey = match
        ? "pergunta-" + String(Number(match[1])).padStart(2, "0")
        : null;
      groupKey = null;
      return;
    }
    if (!questionKey) return;

    if (item.getType() === FormApp.ItemType.SECTION_HEADER) {
      const title = item.getTitle();
      const match = title.match(/^Resposta\s+([A-E])(?:\s+—\s+parte\s+\d+\/\d+)?$/i);
      if (match) {
        groupKey = questionKey + ":" + match[1].toUpperCase();
        groups[groupKey] = groups[groupKey] || { images: [], texts: [] };
        groups[groupKey].texts.push(item.asSectionHeaderItem().getHelpText() || "");
      } else if (!/^Resposta\s+[A-E]/i.test(title)) {
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
        const normalizedCandidate = normalizeResponseText_(candidate.texts.join("\n\n"));
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
      .setHelpText(question.question + "\n\nLeia integralmente as respostas A–E antes de avaliá-las.");

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
