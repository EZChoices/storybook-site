document.addEventListener("DOMContentLoaded", () => {
  const MAX_PHOTOS = 12;
  const PREVIEW_PAGES = 6;
  const BATCH_SIZE = 2;

  const templateList = document.getElementById("templateList");
  const photosInput = document.getElementById("photosInput");
  const photoGrid = document.getElementById("photoGrid");
  const styleSelect = document.getElementById("styleSelect");
  const childNameInput = document.getElementById("childNameInput");
  const langSelect = document.getElementById("langSelect");
  const generateBtn = document.getElementById("generatePreviewBtn");
  const statusEl = document.getElementById("genStatus");
  const previewBook = document.getElementById("previewBook");

  let selectedTemplateId = "mom-love-0-3";
  let selectedFiles = [];
  let objectUrls = [];

  function setStatus(message, { error = false } = {}) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(error));
  }

  function clearPreview() {
    if (!previewBook) return;
    previewBook.innerHTML = "";
  }

  function cleanupObjectUrls() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
  }

  function renderPhotoGrid() {
    if (!photoGrid) return;
    cleanupObjectUrls();
    photoGrid.innerHTML = "";

    for (let i = 0; i < MAX_PHOTOS; i += 1) {
      const slot = document.createElement("div");
      slot.className = "photo-slot";

      const badge = document.createElement("div");
      badge.className = "slot-index";
      badge.textContent = String(i + 1);
      slot.appendChild(badge);

      const file = selectedFiles[i];
      if (file) {
        const url = URL.createObjectURL(file);
        objectUrls.push(url);

        const img = document.createElement("img");
        img.src = url;
        img.alt = file.name || `Photo ${i + 1}`;
        slot.appendChild(img);
      } else {
        slot.appendChild(document.createTextNode("Add a photo"));
      }

      photoGrid.appendChild(slot);
    }
  }

  function getTemplate(templateId) {
    const api = globalThis.StoryTemplates;
    if (!api || typeof api.getTemplate !== "function") return null;
    return api.getTemplate(templateId);
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

  async function readResponseJsonOrThrow(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        data?.error ||
        (typeof text === "string" && text.trim() ? text.trim() : null) ||
        `Request failed (${response.status})`;
      throw new Error(message);
    }

    if (!data) {
      throw new Error("Server returned an invalid response.");
    }

    return data;
  }

  function setSelectedTemplate(templateId) {
    selectedTemplateId = templateId;

    templateList?.querySelectorAll("[data-template-id]").forEach((el) => {
      const isSelected = el.getAttribute("data-template-id") === templateId;
      el.classList.toggle("selected", isSelected);
      el.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  templateList?.addEventListener("click", (e) => {
    const target = e.target?.closest?.("[data-template-id]");
    if (!target) return;
    const templateId = target.getAttribute("data-template-id");
    if (!templateId) return;
    setSelectedTemplate(templateId);
  });

  photosInput?.addEventListener("change", () => {
    const allFiles = Array.from(photosInput.files || []).filter((f) =>
      String(f.type || "").toLowerCase().startsWith("image/")
    );
    selectedFiles = allFiles.slice(0, MAX_PHOTOS);
    renderPhotoGrid();
    clearPreview();

    if (allFiles.length > MAX_PHOTOS) {
      setStatus(`Loaded ${MAX_PHOTOS} photos (extra files ignored).`);
      return;
    }

    setStatus(selectedFiles.length ? `Loaded ${selectedFiles.length} photo(s).` : "");
  });

  async function generatePreview() {
    setStatus("");
    clearPreview();

    const template = getTemplate(selectedTemplateId);
    if (!template) {
      setStatus("Template unavailable. Please reload.", { error: true });
      return;
    }

    if (!selectedFiles.length) {
      setStatus("Please upload at least 1 photo.", { error: true });
      return;
    }

    const chosenIndices = selectPhotoIndices(selectedFiles.length, PREVIEW_PAGES);
    const chosenFiles = chosenIndices.map((idx) => selectedFiles[idx]).filter(Boolean);
    if (chosenFiles.length === 0) {
      setStatus("Please upload at least 1 photo.", { error: true });
      return;
    }

    generateBtn.disabled = true;
    const originalLabel = generateBtn.textContent;
    generateBtn.textContent = "Generating…";

    try {
      const style = String(styleSelect?.value || "Watercolor");
      const childName = String(childNameInput?.value || "").trim();
      const lang = String(langSelect?.value || "English");

      const pagesByIndex = new Map();

      async function runBatch(pageStart, pageCount) {
        const formData = new FormData();
        formData.append("templateId", selectedTemplateId);
        formData.append("style", style);
        formData.append("childName", childName);
        formData.append("lang", lang);
        formData.append("pageStart", String(pageStart));
        formData.append("pageCount", String(pageCount));

        for (const file of chosenFiles) {
          formData.append("photos[]", file, file.name || "photo");
        }

        const response = await fetch("/api/generate", { method: "POST", body: formData });
        return await readResponseJsonOrThrow(response);
      }

      function renderCurrent() {
        previewBook.innerHTML = "";
        const sorted = Array.from(pagesByIndex.values()).sort(
          (a, b) => a.pageIndex - b.pageIndex
        );
        for (const p of sorted) {
          const card = document.createElement("div");
          card.className = "page-card";

          const img = document.createElement("img");
          img.src = `data:image/png;base64,${p.b64_png}`;
          img.alt = `Page ${p.pageIndex}: ${p.role}`;
          card.appendChild(img);

          const meta = document.createElement("div");

          const title = document.createElement("div");
          title.className = "page-title";
          title.textContent = `Page ${p.pageIndex}: ${p.role}`;
          meta.appendChild(title);

          const caption = document.createElement("p");
          caption.className = "page-caption";
          caption.textContent = p.caption || "";
          meta.appendChild(caption);

          card.appendChild(meta);
          previewBook.appendChild(card);
        }
      }

      for (let pageStart = 0; pageStart < PREVIEW_PAGES; pageStart += BATCH_SIZE) {
        const pageCount = Math.min(BATCH_SIZE, PREVIEW_PAGES - pageStart);
        setStatus(`Generating pages ${pageStart + 1}–${pageStart + pageCount} of ${PREVIEW_PAGES}…`);

        const data = await runBatch(pageStart, pageCount);
        const batchPages = Array.isArray(data?.pages) ? data.pages : [];
        if (!batchPages.length) {
          throw new Error("Server returned no pages.");
        }

        batchPages.forEach((p) => {
          if (p?.pageIndex && p?.b64_png) pagesByIndex.set(p.pageIndex, p);
        });
        renderCurrent();
      }

      setStatus("Preview ready.");
    } catch (err) {
      setStatus(err?.message || "Something went wrong.", { error: true });
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = originalLabel;
    }
  }

  generateBtn?.addEventListener("click", () => {
    generatePreview();
  });

  renderPhotoGrid();
  setSelectedTemplate(selectedTemplateId);
});
