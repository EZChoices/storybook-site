const Busboy = require("busboy");

const OPENAI_IMAGES_EDITS_URL = "https://api.openai.com/v1/images/edits";

const STYLE_PRESETS = {
  Watercolor: "soft watercolor, pastel palette, gentle brushstrokes",
  "Studio Ghibli Style":
    "whimsical hand-painted animation look, warm lighting, detailed backgrounds, cozy mood",
  "Classic 90s Kids Book":
    "classic 1990s children's picture book illustration, simple shapes, warm colors",
  "Crayon Doodle": "playful crayon doodle on textured paper, childlike linework",
  "Hand-painted Look": "hand-painted gouache illustration, rich texture, warm tones",
  "Vintage Storybook": "vintage storybook illustration, muted colors, slight ink outlines",
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
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
  { maxFiles = 12, maxFileSizeBytes = 10 * 1024 * 1024 } = {}
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

    busboy.on("file", (fieldname, fileStream, filenameOrInfo, encoding, mimeType) => {
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
    });

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

function buildPrompt({ style, childName, lang }) {
  const stylePreset = STYLE_PRESETS[style] || style;
  const languageLine = lang
    ? `If you include any readable text, it must be in ${lang}.`
    : "If you include any readable text, keep it minimal.";
  const childLine = childName ? `The child's name is \"${childName}\".` : "";

  return [
    `Convert this photo into a children's book illustration in a ${stylePreset} style.`,
    "Preserve faces and key features of subjects.",
    "Keep the scene warm, wholesome, and family-friendly.",
    childLine,
    languageLine,
    "Do not add extra characters or distort identity.",
    "Do not include trademarks, logos, or copyrighted characters.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function openAiImageEdit({ imageBuffer, filename, mimeType, prompt }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
  const responseFormat = "b64_json";

  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", size);
  formData.append("response_format", responseFormat);
  formData.append("n", "1");

  const blob = new Blob([imageBuffer], { type: mimeType || "application/octet-stream" });
  formData.append("image", blob, filename || "photo");

  const response = await fetch(OPENAI_IMAGES_EDITS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = await safeReadJson(response);
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      (typeof data?._raw === "string" ? data._raw : "OpenAI request failed");
    throw new Error(`OpenAI Images API error (${response.status}): ${message}`);
  }

  const b64 =
    data?.data?.[0]?.b64_json ||
    data?.data?.[0]?.b64_png ||
    data?.data?.[0]?.b64 ||
    null;
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

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
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

  let parsed;
  try {
    parsed = await parseMultipartForm(req, {
      maxFiles: 12,
      maxFileSizeBytes: 12 * 1024 * 1024,
    });
  } catch (err) {
    json(res, 400, { error: err?.message || "Invalid form upload" });
    return;
  }

  const style = (parsed.fields.style || "").trim();
  const childName = (parsed.fields.childName || "").trim();
  const lang = (parsed.fields.lang || parsed.fields.captionLanguage || "English").trim();

  const photoFiles = parsed.files.filter(
    (f) => f.fieldname === "photos" || f.fieldname === "photos[]"
  );

  if (!style) {
    json(res, 400, { error: "Missing field: style" });
    return;
  }
  if (!childName) {
    json(res, 400, { error: "Missing field: childName" });
    return;
  }
  if (!photoFiles.length) {
    json(res, 400, { error: "No photos uploaded. Use field name 'photos'." });
    return;
  }

  const prompt = buildPrompt({ style, childName, lang });
  const concurrency = Number(process.env.OPENAI_IMAGE_CONCURRENCY || 2);

  const images = await mapWithConcurrency(photoFiles, concurrency, async (file) => {
    const filename = file.filename || "photo";
    try {
      const b64_png = await openAiImageEdit({
        imageBuffer: file.buffer,
        filename,
        mimeType: file.mimeType,
        prompt,
      });
      return { filename, b64_png };
    } catch (err) {
      return { filename, error: err?.message || "Image generation failed" };
    }
  });

  const successCount = images.filter((img) => img && img.b64_png).length;
  if (successCount === 0) {
    json(res, 502, { error: "All image generations failed", images });
    return;
  }

  json(res, 200, { images });
};
