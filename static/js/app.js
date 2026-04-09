(() => {
    const themeStorageKey = "memeforge-theme";
    const themeToggle = document.getElementById("themeToggle");

    function applyTheme(mode) {
        document.documentElement.classList.toggle("dark", mode === "dark");
        if (themeToggle) {
            themeToggle.textContent = mode === "dark" ? "Light" : "Dark";
        }
    }

    function initTheme() {
        const saved = localStorage.getItem(themeStorageKey);
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const mode = saved || (prefersDark ? "dark" : "light");
        applyTheme(mode);
    }

    function toggleTheme() {
        const nextMode = document.documentElement.classList.contains("dark") ? "light" : "dark";
        localStorage.setItem(themeStorageKey, nextMode);
        applyTheme(nextMode);
    }

    initTheme();
    themeToggle?.addEventListener("click", toggleTheme);

    const previewCanvas = document.getElementById("previewCanvas");
    if (!previewCanvas) return;

    const refs = {
        railButtons: Array.from(document.querySelectorAll(".rail-btn")),
        toolTitle: document.getElementById("toolPanelTitle"),
        toolHint: document.getElementById("toolPanelHint"),
        toolPanels: Array.from(document.querySelectorAll("[data-tool-panel]")),
        dropzone: document.getElementById("dropzone"),
        fileInput: document.getElementById("imageUpload"),
        templateSelect: document.getElementById("templateSelect"),
        templateCards: Array.from(document.querySelectorAll("[data-template-card]")),
        topText: document.getElementById("topText"),
        bottomText: document.getElementById("bottomText"),
        uppercase: document.getElementById("uppercase"),
        randomTextBtn: document.getElementById("randomTextBtn"),
        presetButtons: Array.from(document.querySelectorAll("[data-style-preset]")),
        fontSize: document.getElementById("fontSize"),
        fontSizeValue: document.getElementById("fontSizeValue"),
        strokeWidth: document.getElementById("strokeWidth"),
        strokeWidthValue: document.getElementById("strokeWidthValue"),
        textColor: document.getElementById("textColor"),
        strokeColor: document.getElementById("strokeColor"),
        alignButtons: Array.from(document.querySelectorAll("[data-align]")),
        alignmentSelect: document.getElementById("alignment"),
        blockingError: document.getElementById("blockingError"),
        imageSourceLabel: document.getElementById("imageSourceLabel"),
        generateDesktop: document.getElementById("generateBtnDesktop"),
        generateMobile: document.getElementById("mobileGenerateBtn"),
        exportDesktop: document.getElementById("exportBtnDesktop"),
        exportMobile: document.getElementById("mobileExportBtn"),
        mobilePreviewBtn: document.getElementById("mobilePreviewBtn"),
        progressImage: document.getElementById("progressImage"),
        progressText: document.getElementById("progressText"),
        progressStyle: document.getElementById("progressStyle"),
        progressReady: document.getElementById("progressReady"),
        canvasRegion: document.getElementById("canvasRegion"),
    };

    const ctx = previewCanvas.getContext("2d");
    const maxUploadMB = Number(document.querySelector(".editor-app")?.dataset.maxUploadMb || "8");
    const maxUploadBytes = maxUploadMB * 1024 * 1024;

    const toolMeta = {
        assets: { title: "Assets", hint: "Upload an image or start from a template." },
        templates: { title: "Templates", hint: "Pick a base visual for your meme." },
        text: { title: "Text", hint: "Set top and bottom captions." },
        style: { title: "Style", hint: "Apply a preset and refine from the inspector." },
    };

    const randomCaptions = [
        ["WHEN PROD IS QUIET", "AND YOU SUSPECT A TRAP"],
        ["ONE SMALL BUGFIX", "TEN NEW EDGE CASES"],
        ["CI IS GREEN", "FOR NOW"],
        ["SHIPPED ON FRIDAY", "SLEPT ON SATURDAY?"],
    ];

    const defaultStyle = {
        fontSize: 56,
        strokeWidth: 4,
        textColor: "#ffffff",
        strokeColor: "#000000",
        alignment: "center",
        uppercase: false,
    };

    const state = {
        source: "template",
        image: null,
        uploadedFile: null,
        objectUrl: null,
        generatedUrl: "",
        generatedFilename: "",
        generatedBlobUrl: null,
    };

    function ensureToastStack() {
        let stack = document.getElementById("toastStack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "toastStack";
            stack.className = "toast-stack";
            document.body.appendChild(stack);
        }
        return stack;
    }

    function showSuccessToast(text) {
        const stack = ensureToastStack();
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = text;
        stack.appendChild(toast);
        window.setTimeout(() => toast.remove(), 2200);
    }

    function showBlockingError(message) {
        refs.blockingError.hidden = false;
        refs.blockingError.textContent = message;
    }

    function clearBlockingError() {
        refs.blockingError.hidden = true;
        refs.blockingError.textContent = "";
    }

    function cleanupObjectUrl() {
        if (state.objectUrl) {
            URL.revokeObjectURL(state.objectUrl);
            state.objectUrl = null;
        }
        if (state.generatedBlobUrl) {
            URL.revokeObjectURL(state.generatedBlobUrl);
            state.generatedBlobUrl = null;
        }
    }

    function markGeneratedAsStale() {
        if (state.generatedBlobUrl) {
            URL.revokeObjectURL(state.generatedBlobUrl);
            state.generatedBlobUrl = null;
        }
        state.generatedUrl = "";
        state.generatedFilename = "";
        syncExportState();
    }

    function hasText() {
        return refs.topText.value.trim().length > 0 || refs.bottomText.value.trim().length > 0;
    }

    function styleChanged() {
        return (
            Number(refs.fontSize.value) !== defaultStyle.fontSize ||
            Number(refs.strokeWidth.value) !== defaultStyle.strokeWidth ||
            refs.textColor.value.toLowerCase() !== defaultStyle.textColor ||
            refs.strokeColor.value.toLowerCase() !== defaultStyle.strokeColor ||
            refs.alignmentSelect.value !== defaultStyle.alignment ||
            refs.uppercase.checked !== defaultStyle.uppercase
        );
    }

    function canGenerate() {
        return Boolean(state.image) && hasText();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function syncExportState() {
        const enabled = Boolean(state.generatedUrl);
        for (const exportBtn of [refs.exportDesktop, refs.exportMobile]) {
            if (!exportBtn) continue;
            if (enabled) {
                exportBtn.classList.remove("is-disabled");
                exportBtn.setAttribute("aria-disabled", "false");
                exportBtn.setAttribute("href", state.generatedUrl);
                exportBtn.setAttribute("download", state.generatedFilename || "meme.png");
            } else {
                exportBtn.classList.add("is-disabled");
                exportBtn.setAttribute("aria-disabled", "true");
                exportBtn.setAttribute("href", "#");
                exportBtn.setAttribute("download", "");
            }
        }
    }

    function syncGenerateState(isLoading = false) {
        const enabled = canGenerate() && !isLoading;
        refs.generateDesktop.disabled = !enabled;
        refs.generateMobile.disabled = !enabled;
        refs.generateDesktop.textContent = isLoading ? "Generating..." : "Generate";
        refs.generateMobile.textContent = isLoading ? "Generating..." : "Generate";
    }

    function setProgressState() {
        refs.progressImage.classList.toggle("is-complete", Boolean(state.image));
        refs.progressText.classList.toggle("is-complete", hasText());
        refs.progressStyle.classList.toggle("is-complete", styleChanged());
        refs.progressReady.classList.toggle("is-complete", canGenerate() || Boolean(state.generatedUrl));
    }

    function syncStatus() {
        syncGenerateState(false);
        syncExportState();
        setProgressState();
    }

    function openTool(toolKey) {
        const meta = toolMeta[toolKey];
        if (meta) {
            refs.toolTitle.textContent = meta.title;
            refs.toolHint.textContent = meta.hint;
        }

        for (const button of refs.railButtons) {
            button.classList.toggle("is-active", button.dataset.tool === toolKey);
        }
        for (const panel of refs.toolPanels) {
            panel.hidden = panel.dataset.toolPanel !== toolKey;
        }
    }

    function normalizeText(text) {
        const value = text.trim();
        return refs.uppercase.checked ? value.toUpperCase() : value;
    }

    function buildFont(fontSize) {
        return `${fontSize}px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif`;
    }

    function lineWidth(text, fontSize, strokeWidth) {
        ctx.font = buildFont(fontSize);
        return Math.ceil(ctx.measureText(text).width + strokeWidth * 2);
    }

    function splitLongWord(word, fontSize, maxWidth, strokeWidth) {
        const chunks = [];
        let current = "";
        for (const char of word) {
            const candidate = `${current}${char}`;
            if (lineWidth(candidate, fontSize, strokeWidth) <= maxWidth) {
                current = candidate;
                continue;
            }
            if (current) chunks.push(current);
            current = char;
        }
        if (current) chunks.push(current);
        return chunks.length ? chunks : [word];
    }

    function wrapText(text, fontSize, maxWidth, strokeWidth) {
        const clean = text.replace(/\s+/g, " ").trim();
        if (!clean) return [];

        const words = clean.split(" ");
        const lines = [];
        let currentLine = "";

        for (const word of words) {
            const candidate = currentLine ? `${currentLine} ${word}` : word;
            if (lineWidth(candidate, fontSize, strokeWidth) <= maxWidth) {
                currentLine = candidate;
                continue;
            }

            if (currentLine) {
                lines.push(currentLine);
                currentLine = "";
            }

            if (lineWidth(word, fontSize, strokeWidth) <= maxWidth) {
                currentLine = word;
                continue;
            }

            const chunks = splitLongWord(word, fontSize, maxWidth, strokeWidth);
            lines.push(...chunks.slice(0, -1));
            currentLine = chunks[chunks.length - 1];
        }

        if (currentLine) lines.push(currentLine);
        return lines;
    }

    function truncateLine(line, fontSize, maxWidth, strokeWidth) {
        const ellipsis = "...";
        if (lineWidth(line, fontSize, strokeWidth) <= maxWidth) return line;
        let trimmed = line;
        while (trimmed && lineWidth(`${trimmed}${ellipsis}`, fontSize, strokeWidth) > maxWidth) {
            trimmed = trimmed.slice(0, -1).trimEnd();
        }
        return trimmed ? `${trimmed}${ellipsis}` : ellipsis;
    }

    function fitTextBlock(text, baseSize, maxWidth, maxHeight, strokeWidth) {
        const initialSize = clamp(baseSize, 16, 140);
        let lastAttempt = {
            lines: [text],
            fontSize: initialSize,
            lineHeight: Math.ceil(initialSize * 1.15) + Math.max(2, strokeWidth),
        };

        for (let size = initialSize; size >= 16; size -= 2) {
            const lines = wrapText(text, size, maxWidth, strokeWidth);
            const lineHeight = Math.ceil(size * 1.15) + Math.max(2, strokeWidth);
            if (lines.length && lines.length * lineHeight <= maxHeight) {
                return { lines, fontSize: size, lineHeight };
            }
            lastAttempt = { lines, fontSize: size, lineHeight };
        }

        const maxLines = Math.max(1, Math.floor(maxHeight / Math.max(1, lastAttempt.lineHeight)));
        const clipped = lastAttempt.lines.slice(0, maxLines);
        if (lastAttempt.lines.length > maxLines && clipped.length) {
            clipped[clipped.length - 1] = truncateLine(
                clipped[clipped.length - 1],
                lastAttempt.fontSize,
                maxWidth,
                strokeWidth,
            );
        }
        return { lines: clipped, fontSize: lastAttempt.fontSize, lineHeight: lastAttempt.lineHeight };
    }

    function drawTextLines(lines, options) {
        ctx.font = buildFont(options.fontSize);
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = options.strokeWidth;
        ctx.strokeStyle = options.strokeColor;
        ctx.fillStyle = options.textColor;
        ctx.textAlign = options.alignment;

        let y = options.startY;
        for (const line of lines) {
            let x = options.margin;
            if (options.alignment === "center") x = previewCanvas.width / 2;
            if (options.alignment === "right") x = previewCanvas.width - options.margin;
            if (options.strokeWidth > 0) ctx.strokeText(line, x, y);
            ctx.fillText(line, x, y);
            y += options.lineHeight;
        }
    }

    function drawPlaceholder() {
        previewCanvas.width = 1080;
        previewCanvas.height = 720;
        const gradient = ctx.createLinearGradient(0, 0, previewCanvas.width, previewCanvas.height);
        gradient.addColorStop(0, "#d9e2ff");
        gradient.addColorStop(1, "#edf2ff");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
        ctx.fillStyle = "#334155";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 32px Sora, sans-serif";
        ctx.fillText("Select an image to start editing", previewCanvas.width / 2, previewCanvas.height / 2);
    }

    function resizeCanvasForImage(image) {
        const maxDimension = 1320;
        const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        previewCanvas.width = Math.max(320, Math.floor(image.naturalWidth * ratio));
        previewCanvas.height = Math.max(240, Math.floor(image.naturalHeight * ratio));
    }

    function drawPreview() {
        if (!state.image) {
            drawPlaceholder();
            return;
        }

        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        ctx.drawImage(state.image, 0, 0, previewCanvas.width, previewCanvas.height);

        const fontSize = Number(refs.fontSize.value);
        const strokeWidth = Number(refs.strokeWidth.value);
        const textColor = refs.textColor.value;
        const strokeColor = refs.strokeColor.value;
        const alignment = refs.alignmentSelect.value;

        const topText = normalizeText(refs.topText.value);
        const bottomText = normalizeText(refs.bottomText.value);

        const margin = Math.max(12, Math.floor(previewCanvas.height * 0.03));
        const maxWidth = Math.floor(previewCanvas.width * 0.92);
        const zoneHeight = Math.floor(previewCanvas.height * 0.34);

        if (topText) {
            const block = fitTextBlock(topText, fontSize, maxWidth, zoneHeight, strokeWidth);
            drawTextLines(block.lines, {
                fontSize: block.fontSize,
                lineHeight: block.lineHeight,
                startY: margin,
                margin,
                strokeWidth,
                strokeColor,
                textColor,
                alignment,
            });
        }

        if (bottomText) {
            const block = fitTextBlock(bottomText, fontSize, maxWidth, zoneHeight, strokeWidth);
            const totalHeight = block.lines.length * block.lineHeight;
            const startY = Math.max(margin, previewCanvas.height - margin - totalHeight);
            drawTextLines(block.lines, {
                fontSize: block.fontSize,
                lineHeight: block.lineHeight,
                startY,
                margin,
                strokeWidth,
                strokeColor,
                textColor,
                alignment,
            });
        }
    }

    function markActiveTemplate(filename) {
        for (const card of refs.templateCards) {
            card.classList.toggle("is-active", card.dataset.templateCard === filename);
        }
    }

    function updateImageSourceLabel(label) {
        refs.imageSourceLabel.textContent = label;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Image failed to load."));
            image.src = src;
        });
    }

    async function selectTemplate(templateFilename = null) {
        if (templateFilename) refs.templateSelect.value = templateFilename;
        const selected = refs.templateSelect.selectedOptions[0];
        if (!selected || !selected.dataset.url) return;

        clearBlockingError();
        state.source = "template";
        state.uploadedFile = null;
        cleanupObjectUrl();
        refs.fileInput.value = "";

        try {
            const image = await loadImage(selected.dataset.url);
            state.image = image;
            resizeCanvasForImage(image);
            drawPreview();
            markGeneratedAsStale();
            markActiveTemplate(selected.value);
            updateImageSourceLabel(`Template: ${selected.textContent}`);
            syncStatus();
        } catch {
            showBlockingError("Template could not be loaded.");
        }
    }

    async function selectUpload(file) {
        if (!file) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            showBlockingError("Unsupported file type. Use PNG, JPG/JPEG, or WEBP.");
            return;
        }
        if (file.size > maxUploadBytes) {
            showBlockingError(`Image is too large. Maximum file size is ${maxUploadMB}MB.`);
            return;
        }

        clearBlockingError();
        state.source = "upload";
        state.uploadedFile = file;
        cleanupObjectUrl();
        state.objectUrl = URL.createObjectURL(file);
        markActiveTemplate("__none__");
        try {
            const image = await loadImage(state.objectUrl);
            state.image = image;
            resizeCanvasForImage(image);
            drawPreview();
            markGeneratedAsStale();
            updateImageSourceLabel(`Upload: ${file.name}`);
            syncStatus();
        } catch {
            showBlockingError("Uploaded image could not be loaded.");
        }
    }

    function setAlignment(value) {
        refs.alignmentSelect.value = value;
        for (const button of refs.alignButtons) {
            button.classList.toggle("is-active", button.dataset.align === value);
        }
    }

    function applyPreset(preset) {
        refs.presetButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.stylePreset === preset));

        if (preset === "classic") {
            refs.fontSize.value = "56";
            refs.strokeWidth.value = "4";
            refs.textColor.value = "#ffffff";
            refs.strokeColor.value = "#000000";
            setAlignment("center");
            refs.uppercase.checked = true;
        } else if (preset === "clean") {
            refs.fontSize.value = "48";
            refs.strokeWidth.value = "1";
            refs.textColor.value = "#f8fafc";
            refs.strokeColor.value = "#334155";
            setAlignment("left");
            refs.uppercase.checked = false;
        } else if (preset === "loud") {
            refs.fontSize.value = "72";
            refs.strokeWidth.value = "8";
            refs.textColor.value = "#ffe066";
            refs.strokeColor.value = "#1f2937";
            setAlignment("center");
            refs.uppercase.checked = true;
        }

        refs.fontSizeValue.textContent = refs.fontSize.value;
        refs.strokeWidthValue.textContent = refs.strokeWidth.value;
        markGeneratedAsStale();
        drawPreview();
        syncStatus();
    }

    async function generateMeme() {
        clearBlockingError();
        if (!canGenerate()) {
            showBlockingError("Select an image and add at least one text field before generating.");
            return;
        }

        syncGenerateState(true);
        try {
            const payload = new FormData();
            payload.append("top_text", refs.topText.value);
            payload.append("bottom_text", refs.bottomText.value);
            payload.append("font_size", refs.fontSize.value);
            payload.append("text_color", refs.textColor.value);
            payload.append("stroke_color", refs.strokeColor.value);
            payload.append("stroke_width", refs.strokeWidth.value);
            payload.append("alignment", refs.alignmentSelect.value);
            payload.append("uppercase", refs.uppercase.checked ? "true" : "false");

            if (state.source === "upload" && state.uploadedFile) {
                payload.append("image", state.uploadedFile);
            } else {
                payload.append("template_name", refs.templateSelect.value);
            }

            const response = await fetch("/generate", {
                method: "POST",
                body: payload,
            });
            const contentType = response.headers.get("content-type") || "";
            if (!response.ok) {
                if (contentType.includes("application/json")) {
                    const errorData = await response.json().catch(() => ({}));
                    showBlockingError(errorData.message || "Generation failed.");
                } else {
                    showBlockingError("Generation failed.");
                }
                return;
            }

            if (contentType.includes("image/png")) {
                const blob = await response.blob();
                if (state.generatedBlobUrl) {
                    URL.revokeObjectURL(state.generatedBlobUrl);
                }
                state.generatedBlobUrl = URL.createObjectURL(blob);
                state.generatedUrl = state.generatedBlobUrl;

                const disposition = response.headers.get("content-disposition") || "";
                const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
                state.generatedFilename = filenameMatch?.[1] || "meme.png";
            } else {
                const data = await response.json().catch(() => ({}));
                if (!data.success) {
                    showBlockingError(data.message || "Generation failed.");
                    return;
                }
                state.generatedUrl = data.image_url || "";
                state.generatedFilename = data.filename || "meme.png";
            }

            syncExportState();
            setProgressState();
            showSuccessToast("Meme generated. Export is ready.");
        } catch {
            showBlockingError("Network error while generating meme.");
        } finally {
            syncGenerateState(false);
        }
    }

    function bindEditorEvents() {
        refs.railButtons.forEach((button) => {
            button.addEventListener("click", () => openTool(button.dataset.tool));
        });

        refs.dropzone.addEventListener("click", () => refs.fileInput.click());
        refs.dropzone.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                refs.fileInput.click();
            }
        });
        refs.dropzone.addEventListener("dragover", (event) => {
            event.preventDefault();
            refs.dropzone.classList.add("dragover");
        });
        refs.dropzone.addEventListener("dragleave", () => refs.dropzone.classList.remove("dragover"));
        refs.dropzone.addEventListener("drop", (event) => {
            event.preventDefault();
            refs.dropzone.classList.remove("dragover");
            const file = event.dataTransfer?.files?.[0];
            if (file) selectUpload(file);
        });

        refs.fileInput.addEventListener("change", (event) => {
            const file = event.target.files?.[0];
            if (file) selectUpload(file);
        });

        refs.templateSelect.addEventListener("change", () => {
            selectTemplate();
        });

        refs.templateCards.forEach((card) => {
            card.addEventListener("click", () => {
                selectTemplate(card.dataset.templateCard || "");
            });
        });

        refs.randomTextBtn.addEventListener("click", () => {
            const [top, bottom] = randomCaptions[Math.floor(Math.random() * randomCaptions.length)];
            refs.topText.value = top;
            refs.bottomText.value = bottom;
            clearBlockingError();
            markGeneratedAsStale();
            drawPreview();
            syncStatus();
        });

        refs.presetButtons.forEach((button) => {
            button.addEventListener("click", () => applyPreset(button.dataset.stylePreset));
        });

        refs.alignButtons.forEach((button) => {
            button.addEventListener("click", () => {
                setAlignment(button.dataset.align || "center");
                markGeneratedAsStale();
                drawPreview();
                syncStatus();
            });
        });

        const previewControls = [
            refs.topText,
            refs.bottomText,
            refs.uppercase,
            refs.fontSize,
            refs.strokeWidth,
            refs.textColor,
            refs.strokeColor,
        ];
        previewControls.forEach((control) => {
            control.addEventListener("input", () => {
                refs.fontSizeValue.textContent = refs.fontSize.value;
                refs.strokeWidthValue.textContent = refs.strokeWidth.value;
                markGeneratedAsStale();
                drawPreview();
                syncStatus();
            });
        });

        refs.generateDesktop.addEventListener("click", generateMeme);
        refs.generateMobile.addEventListener("click", generateMeme);
        refs.mobilePreviewBtn.addEventListener("click", () => {
            refs.canvasRegion.scrollIntoView({ behavior: "smooth", block: "start" });
        });

        [refs.exportDesktop, refs.exportMobile].forEach((button) => {
            button.addEventListener("click", (event) => {
                if (button.classList.contains("is-disabled")) {
                    event.preventDefault();
                }
            });
        });
    }

    function initEditor() {
        refs.fontSizeValue.textContent = refs.fontSize.value;
        refs.strokeWidthValue.textContent = refs.strokeWidth.value;
        setAlignment(refs.alignmentSelect.value);
        openTool("assets");
        drawPlaceholder();
        bindEditorEvents();
        syncStatus();
        applyPreset("classic");
        selectTemplate();
    }

    initEditor();
    window.addEventListener("beforeunload", cleanupObjectUrl);
})();
