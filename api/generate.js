const Busboy = require("busboy");
const { getTemplate } = require("../storyTemplates.js");

const OPENAI_IMAGES_EDITS_URL = "https://api.openai.com/v1/images/edits";
const MAX_PHOTOS = 12;
const STORY_PAGES = 6;

const SUPPORTED_IMAGE_SIZES = new Set([
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "auto",
]);

const STYLE_PRESETS = {
  Watercolor:
    "soft watercolor wash, gentle brushstrokes, subtle paper texture, pastel palette, clean whites",
  "Cozy Anime":
    "cozy hand-drawn animation look, soft shading, gentle outlines, natural lighting, neutral white balance, balanced skin tones",
  "Classic Storybook":
    "classic children's picture book illustration, ink outlines, warm balanced colors, textured paper, soft grain",
  "Studio Ghibli Style":
    "cozy hand-drawn animation look, soft shading, gentle outlines, natural lighting, neutral white balance, balanced skin tones",
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parseMultipartForm(
  req,
  { maxFiles = MAX_PHOTOS, maxFileSizeBytes = 10 * 1024 * 1024 } = {}
) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data"));
      return;
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: maxFiles,
        fileSize: maxFileSizeBytes,
      },
    });

    const fields = {};
    const files = [];

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on(
      "file",
      (fieldname, fileStream, filenameOrInfo, encoding, mimeType) => {
        if (files.length >= maxFiles) {
          fileStream.resume();
          return;
        }

        let filename = "upload";
        let mime = "application/octet-stream";
        if (filenameOrInfo && typeof filenameOrInfo === "object") {
          filename = filenameOrInfo.filename || filename;
          mime = filenameOrInfo.mimeType || mime;
        } else {
          filename = filenameOrInfo || filename;
          mime = mimeType || mime;
        }

        const chunks = [];
        let tooLarge = false;

        fileStream.on("limit", () => {
          tooLarge = true;
        });

        fileStream.on("data", (chunk) => {
          chunks.push(chunk);
        });

        fileStream.on("end", () => {
          if (tooLarge) {
            reject(new Error(`File too large: ${filename}`));
            return;
          }
          files.push({
            fieldname,
            filename,
            mimeType: mime,
            buffer: Buffer.concat(chunks),
          });
        });
      }
    );

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));

    req.pipe(busboy);
  });
}

async function safeReadJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function selectPhotoIndices(totalPhotos, needed) {
  if (totalPhotos <= 0) return [];
  if (totalPhotos >= needed) {
    if (totalPhotos === needed) {
      return Array.from({ length: needed }, (_, i) => i);
    }

    const lastIndex = totalPhotos - 1;
    const denom = needed - 1;
    return Array.from({ length: needed }, (_, i) =>
      Math.round((i * lastIndex) / denom)
    );
  }

  return Array.from({ length: needed }, (_, i) => i % totalPhotos);
}

function buildPrompt({ style, childName, lang, page }) {
  const styleName = String(style || "Watercolor").trim() || "Watercolor";
  const styleNotes = STYLE_PRESETS[styleName] || styleName;
  const childLine = childName ? `Child name (context only): "${childName}".` : "";
  const langLine = lang ? `Language context: ${lang}.` : "";

  return [
    `Convert the provided photo into a premium children’s storybook illustration in ${styleName} style.`,
    `Style notes: ${styleNotes}.`,
    "Preserve the identity, face, and key facial features of the people in the photo.",
    "Keep the same number of people. Do not add new people.",
    "Keep it warm, wholesome, family friendly.",
    "Avoid distortions: extra fingers, warped eyes, melted features, unnatural hands.",
    "Preserve the original color balance and lighting; avoid strong color casts (e.g., overly orange/sepia). Keep skin tones natural.",
    "Do not add logos, watermarks, or readable text.",
    childLine,
    langLine,
    `Page role: ${page.role}.`,
    `Scene guidance: ${page.imagePrompt}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function openAiImageEdit({
  apiKey,
  imageBuffer,
  filename,
  mimeType,
  prompt,
  model,
  size,
  timeoutMs,
}) {
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", size);
  formData.append("n", "1");

  const blob = new Blob([imageBuffer], {
    type: mimeType || "application/octet-stream",
  });
  formData.append("image", blob, filename || "photo");

  let signal;
  if (
    timeoutMs &&
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    signal = AbortSignal.timeout(timeoutMs);
  }

  const response = await fetch(OPENAI_IMAGES_EDITS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal,
  });

  const data = await safeReadJson(response);
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      (typeof data?._raw === "string" ? data._raw : "OpenAI request failed");
    throw new Error(`OpenAI Images API error (${response.status}): ${message}`);
  }

  const b64 = data?.data?.[0]?.b64_json || null;
  if (!b64) {
    throw new Error("OpenAI response missing base64 image data");
  }

  return b64;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    json(res, 500, { error: "Server is missing OPENAI_API_KEY" });
    return;
  }

  let parsed;
  try {
    parsed = await parseMultipartForm(req, {
      maxFiles: MAX_PHOTOS,
      maxFileSizeBytes: 12 * 1024 * 1024,
    });
  } catch (err) {
    json(res, 400, { error: err?.message || "Invalid upload" });
    return;
  }

  const templateId = String(parsed.fields.templateId || "").trim();
  const style = String(parsed.fields.style || "Watercolor").trim() || "Watercolor";
  const childName = String(parsed.fields.childName || "").trim();
  const lang = String(parsed.fields.lang || "English").trim() || "English";
  const pageStartRaw = String(parsed.fields.pageStart || "").trim();
  const pageCountRaw = String(parsed.fields.pageCount || "").trim();

  if (!templateId) {
    json(res, 400, { error: "Missing field: templateId" });
    return;
  }

  const template = getTemplate(templateId);
  if (!template) {
    json(res, 400, { error: `Unsupported templateId: ${templateId}` });
    return;
  }

  const photoFiles = parsed.files.filter(
    (f) =>
      f.fieldname === "photos" ||
      f.fieldname === "photos[]" ||
      f.fieldname === "photos[]"
  );

  if (!photoFiles.length) {
    json(res, 400, { error: "No photos uploaded. Use field name photos[]." });
    return;
  }

  const pages = Array.isArray(template.pages)
    ? template.pages.slice(0, STORY_PAGES)
    : [];
  if (pages.length !== STORY_PAGES) {
    json(res, 400, { error: "Template is misconfigured (expected 6 pages)" });
    return;
  }

  const limitedPhotos = photoFiles.slice(0, MAX_PHOTOS);
  const chosenIndices = selectPhotoIndices(limitedPhotos.length, STORY_PAGES);
  const chosenPhotos = chosenIndices.map((idx) => limitedPhotos[idx]);

  const pageStart = pageStartRaw ? Number(pageStartRaw) : 0;
  const pageCount = pageCountRaw ? Number(pageCountRaw) : STORY_PAGES;
  if (!Number.isInteger(pageStart) || pageStart < 0 || pageStart >= STORY_PAGES) {
    json(res, 400, { error: "Invalid field: pageStart" });
    return;
  }
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > STORY_PAGES) {
    json(res, 400, { error: "Invalid field: pageCount" });
    return;
  }
  const endExclusive = Math.min(STORY_PAGES, pageStart + pageCount);
  const requestedPageIndices = Array.from(
    { length: endExclusive - pageStart },
    (_, i) => pageStart + i + 1
  );

  const model = String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5").trim();
  const requestedSize = String(process.env.OPENAI_IMAGE_SIZE || "1024x1024").trim();
  const size = SUPPORTED_IMAGE_SIZES.has(requestedSize) ? requestedSize : "1024x1024";
  const timeoutMs = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 0) || 0;

  const tasks = requestedPageIndices.map((pageIndex) => {
    const idx = pageIndex - 1;
    return {
      page: pages[idx],
      pageIndex,
      file: chosenPhotos[idx],
    };
  });

  const defaultConcurrency = tasks.length;
  const rawConcurrency = process.env.OPENAI_IMAGE_CONCURRENCY;
  const requestedConcurrency = rawConcurrency ? Number(rawConcurrency) : defaultConcurrency;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(tasks.length, requestedConcurrency))
    : defaultConcurrency;

  const results = await mapWithConcurrency(tasks, concurrency, async (task) => {
    const { pageIndex, page, file } = task;
    try {
      const prompt = buildPrompt({ style, childName, lang, page });
      const b64_png = await openAiImageEdit({
        apiKey,
        imageBuffer: file.buffer,
        filename: file.filename,
        mimeType: file.mimeType,
        prompt,
        model,
        size,
        timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
      });

      return {
        pageIndex,
        role: page.role,
        caption: page.caption,
        b64_png,
      };
    } catch (err) {
      return {
        pageIndex,
        role: page.role,
        caption: page.caption,
        error: err?.message || "Image generation failed",
      };
    }
  });

  const failed = results.find((r) => r && r.error);
  if (failed) {
    json(res, 502, {
      error: `Page ${failed.pageIndex} (${failed.role}) failed: ${failed.error}`,
      pageIndex: failed.pageIndex,
      role: failed.role,
    });
    return;
  }

  results.sort((a, b) => a.pageIndex - b.pageIndex);
  json(res, 200, { templateId, style, pages: results });
};
