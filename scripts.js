// scripts.js

document.addEventListener("DOMContentLoaded", () => {
  const generateButton = document.getElementById("generatePreviewButton");
  const statusEl = document.getElementById("generateStatus");
  const gridEl = document.getElementById("generatedPreviewGrid");
  const bulkUploadInput = document.getElementById("photoUploadInput");

  function setStatus(message, { error = false } = {}) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(error));
  }

  function clearGrid() {
    if (!gridEl) return;
    gridEl.innerHTML = "";
  }

  function getUploadedPhotosArray() {
    if (typeof uploadedPhotos === "undefined" || !Array.isArray(uploadedPhotos)) return null;
    return uploadedPhotos;
  }

  function getSelectedStyle() {
    if (typeof selectedStyle === "undefined") return "";
    return String(selectedStyle || "").trim();
  }

  function extensionFromMime(mimeType) {
    const mime = (mimeType || "").toLowerCase();
    if (mime.includes("png")) return "png";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    return "png";
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  async function readFileAsDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function getPhotoBoxByIndex() {
    const boxes = document.querySelectorAll(".photo-box[data-index]");
    const byIndex = new Map();
    boxes.forEach((box) => {
      const idx = Number(box.getAttribute("data-index"));
      if (!Number.isNaN(idx)) byIndex.set(idx, box);
    });
    return byIndex;
  }

  function renderPhotoIntoBox(box, dataUrl) {
    box.innerHTML = "";
    const imgEl = document.createElement("img");
    imgEl.src = dataUrl;
    box.appendChild(imgEl);
  }

  if (bulkUploadInput) {
    bulkUploadInput.addEventListener("change", async () => {
      const photos = getUploadedPhotosArray();
      if (!photos) {
        alert("Photo grid isn't ready yet. Please reload and try again.");
        return;
      }

      const files = Array.from(bulkUploadInput.files || []).slice(0, photos.length);
      if (files.length === 0) return;

      const boxesByIndex = getPhotoBoxByIndex();
      let filled = 0;

      for (const file of files) {
        const nextIndex = photos.findIndex((p) => p === null);
        if (nextIndex === -1) break;

        const box = boxesByIndex.get(nextIndex);
        if (!box) continue;

        const dataUrl = await readFileAsDataUrl(file);
        renderPhotoIntoBox(box, dataUrl);
        photos[nextIndex] = dataUrl;
        filled += 1;
      }

      if (filled === 0) {
        alert("All 12 slots are already filled.");
      }

      bulkUploadInput.value = "";
    });
  }

  if (!generateButton) return;

  generateButton.addEventListener("click", async () => {
    clearGrid();
    setStatus("");

    const style = getSelectedStyle();
    const childName = String(document.getElementById("childName")?.value || "").trim();
    const lang = String(document.getElementById("captionLanguage")?.value || "English").trim();
    const photos = getUploadedPhotosArray();

    if (!photos) {
      setStatus("Photo grid isn't ready yet. Please reload and try again.", { error: true });
      return;
    }
    if (!style) {
      setStatus("Please select an illustration style first.", { error: true });
      return;
    }
    if (!childName) {
      setStatus("Please enter your child's name first.", { error: true });
      return;
    }

    const selected = photos
      .map((dataUrl, index) => ({ dataUrl, index }))
      .filter((p) => Boolean(p.dataUrl))
      .slice(0, 12);

    if (selected.length === 0) {
      setStatus("Please upload at least 1 photo.", { error: true });
      return;
    }

    generateButton.disabled = true;
    const originalLabel = generateButton.textContent;
    generateButton.textContent = "Generating…";
    setStatus(`Generating ${selected.length} image(s)…`);

    try {
      function renderImages(images) {
        images.forEach((img) => {
          const card = document.createElement("div");
          card.className = "generated-preview-card";

          if (img?.b64_png) {
            const imageEl = document.createElement("img");
            imageEl.src = `data:image/png;base64,${img.b64_png}`;
            imageEl.alt = img.filename || "Generated image";
            card.appendChild(imageEl);
          } else {
            const errorEl = document.createElement("div");
            errorEl.className = "generated-preview-label";
            errorEl.textContent = img?.error
              ? `Error: ${img.error}`
              : "Error: image generation failed";
            card.appendChild(errorEl);
          }

          const label = document.createElement("div");
          label.className = "generated-preview-label";
          label.textContent = img?.filename || "photo";
          card.appendChild(label);

          gridEl?.appendChild(card);
        });
      }

      const formData = new FormData();
      formData.append("style", style);
      formData.append("childName", childName);
      formData.append("lang", lang);

      for (const { dataUrl, index } of selected) {
        const blob = await dataUrlToBlob(dataUrl);
        const ext = extensionFromMime(blob.type);
        const filename = `photo_${index + 1}.${ext}`;
        formData.append("photos", blob, filename);
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const images = Array.isArray(data?.images) ? data.images : [];
        if (images.length > 0) {
          setStatus(data?.error || `Request failed (${response.status})`, { error: true });
          renderImages(images);
          return;
        }
        throw new Error(data?.error || `Request failed (${response.status})`);
      }

      const images = Array.isArray(data?.images) ? data.images : [];
      if (images.length === 0) {
        throw new Error("No images returned from the server.");
      }

      const successes = images.filter((img) => img && img.b64_png).length;
      setStatus(`Generated ${successes} / ${images.length} image(s).`);

      renderImages(images);
    } catch (err) {
      setStatus(err?.message || "Something went wrong.", { error: true });
    } finally {
      generateButton.disabled = false;
      generateButton.textContent = originalLabel;
    }
  });
});
  
