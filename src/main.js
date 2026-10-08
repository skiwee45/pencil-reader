import {
  cloneAnnotation,
  loadAnnotations,
  loadDocumentView,
  loadPreferences,
  deserializeAnnotationPages,
  saveAnnotations,
  saveDocumentView,
  savePreferences,
  serializeAnnotationPages,
} from "./storage.js";

const PDFJS_VERSION = "6.4.299";
const PDFJS_BASE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFJS_URL = `${PDFJS_BASE_URL}/build/pdf.mjs`;
const PDFJS_WORKER_URL = `${PDFJS_BASE_URL}/build/pdf.worker.mjs`;
const PDFJS_CMAP_URL = `${PDFJS_BASE_URL}/cmaps/`;
const PDFJS_ICC_URL = `${PDFJS_BASE_URL}/iccs/`;
const PDFJS_STANDARD_FONT_URL = `${PDFJS_BASE_URL}/standard_fonts/`;
const PDFJS_WASM_URL = `${PDFJS_BASE_URL}/wasm/`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const DRAG_THRESHOLD = 5;
const PAGE_RENDER_MARGIN = 1100;
const MIN_NOTE_FONT_SIZE = 6;
const MAX_NOTE_FONT_SIZE = 24;
const NOTE_FONT_SIZE_STEP = 2;
const SIDECAR_FORMAT = "pencil-reader-notes";
const SIDECAR_VERSION = 1;
const SIDECAR_AUTOSAVE_DELAY = 500;
const NOTE_PREVIEW_LENGTH = 90;
const SEARCH_CONTEXT_LENGTH = 55;

const preferences = loadPreferences();

const elements = {
  workspace: document.querySelector("#workspace"),
  viewer: document.querySelector("#viewer"),
  emptyState: document.querySelector("#empty-state"),
  openButton: document.querySelector("#open-button"),
  emptyOpenButton: document.querySelector("#empty-open-button"),
  fileInput: document.querySelector("#file-input"),
  notesMenu: document.querySelector("#notes-menu"),
  notesButton: document.querySelector("#notes-button"),
  notesPopover: document.querySelector("#notes-popover"),
  loadNotesButton: document.querySelector("#load-notes-button"),
  saveNotesButton: document.querySelector("#save-notes-button"),
  saveNotesLabel: document.querySelector("#save-notes-label"),
  notesStatusText: document.querySelector("#notes-status-text"),
  notesFileInput: document.querySelector("#notes-file-input"),
  documentTitle: document.querySelector("#document-title"),
  currentPage: document.querySelector("#current-page"),
  pageCount: document.querySelector("#page-count"),
  rotateLeft: document.querySelector("#rotate-left"),
  rotateRight: document.querySelector("#rotate-right"),
  zoomOut: document.querySelector("#zoom-out"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomReset: document.querySelector("#zoom-reset"),
  textSizeDown: document.querySelector("#text-size-down"),
  textSizeUp: document.querySelector("#text-size-up"),
  textSizeInput: document.querySelector("#text-size-input"),
  textSizeControls: document.querySelector(".text-size-controls"),
  helpMenu: document.querySelector("#help-menu"),
  helpButton: document.querySelector("#help-button"),
  helpPopover: document.querySelector("#help-popover"),
  searchButton: document.querySelector("#search-button"),
  readerShell: document.querySelector("#reader-shell"),
  searchSidebar: document.querySelector("#search-sidebar"),
  notesSearchTab: document.querySelector("#notes-search-tab"),
  pdfSearchTab: document.querySelector("#pdf-search-tab"),
  searchCloseButton: document.querySelector("#search-close-button"),
  notesSearchField: document.querySelector("#notes-search-field"),
  notesSearchInput: document.querySelector("#notes-search-input"),
  pdfSearchField: document.querySelector("#pdf-search-field"),
  pdfSearchInput: document.querySelector("#pdf-search-input"),
  searchResults: document.querySelector("#search-results"),
  loadingPanel: document.querySelector("#loading-panel"),
  loadingMessage: document.querySelector("#loading-message"),
  toast: document.querySelector("#toast"),
};

const state = {
  pdfjs: null,
  pdf: null,
  loadingTask: null,
  documentId: null,
  documentName: null,
  annotations: new Map(),
  pageViews: [],
  pageObserver: null,
  zoom: 1,
  rotation: 0,
  noteFontSize: preferences.noteFontSize,
  selectedNote: null,
  currentPage: 1,
  undoStack: [],
  scrollFrame: null,
  zoomFrame: null,
  toastTimer: null,
  openToken: null,
  sidecarHandle: null,
  sidecarFileName: null,
  sidecarSaveTimer: null,
  sidecarWriteInProgress: false,
  sidecarWritePending: false,
  sidecarGeneration: 0,
  renderErrorShown: false,
  textSelectionMode: false,
  searchMode: "notes",
  searchExpandedPages: new Set(),
  searchReturnFocus: null,
  pdfSearchStatus: "idle",
  pdfSearchPages: [],
  pdfSearchProgress: 0,
};

bindControls();
updateTextSizeDisplay();
initializePdfJs();

async function initializePdfJs() {
  try {
    state.pdfjs = await import(PDFJS_URL);
    state.pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    elements.openButton.disabled = false;
    elements.emptyOpenButton.disabled = false;
  } catch (error) {
    console.error(error);
    showToast("PDF.js could not load. Check your internet connection and refresh.", 7000);
  }
}

function bindControls() {
  elements.openButton.addEventListener("click", chooseFile);
  elements.emptyOpenButton.addEventListener("click", chooseFile);
  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files;
    if (file) openPdf(file);
    elements.fileInput.value = "";
  });
  elements.loadNotesButton.addEventListener("click", loadNotesFromFile);
  elements.saveNotesButton.addEventListener("click", saveNotesToFile);
  elements.notesButton.addEventListener("click", () => {
    setNotesOpen(elements.notesPopover.hidden);
  });
  elements.notesFileInput.addEventListener("change", () => {
    const [file] = elements.notesFileInput.files;
    if (file) importSidecarFile(file);
    elements.notesFileInput.value = "";
  });

  elements.zoomOut.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
  elements.zoomIn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
  elements.zoomReset.addEventListener("click", () => setZoom(1));
  elements.rotateLeft.addEventListener("click", () => rotateDocument(-90));
  elements.rotateRight.addEventListener("click", () => rotateDocument(90));
  elements.textSizeDown.addEventListener("click", () => {
    setNoteFontSize(currentNoteFontSize() - NOTE_FONT_SIZE_STEP);
  });
  elements.textSizeUp.addEventListener("click", () => {
    setNoteFontSize(currentNoteFontSize() + NOTE_FONT_SIZE_STEP);
  });
  elements.textSizeInput.addEventListener("focus", () => elements.textSizeInput.select());
  elements.textSizeInput.addEventListener("input", () => {
    elements.textSizeInput.value = elements.textSizeInput.value.replace(/\D/g, "");
  });
  elements.textSizeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.textSizeInput.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      elements.textSizeInput.dataset.cancelChange = "true";
      elements.textSizeInput.value = String(currentNoteFontSize());
      elements.textSizeInput.blur();
    }
  });
  elements.textSizeInput.addEventListener("blur", (event) => {
    commitNoteFontSize();
    if (
      !elements.textSizeControls.contains(event.relatedTarget) &&
      !event.relatedTarget?.closest?.(".annotation-note")
    ) {
      clearSelectedNote();
    }
  });
  elements.currentPage.addEventListener("focus", () => elements.currentPage.select());
  elements.currentPage.addEventListener("input", () => {
    elements.currentPage.value = elements.currentPage.value.replace(/\D/g, "");
  });
  elements.currentPage.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.currentPage.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      elements.currentPage.dataset.cancelNavigation = "true";
      elements.currentPage.value = String(state.currentPage);
      elements.currentPage.blur();
    }
  });
  elements.currentPage.addEventListener("blur", commitPageNavigation);
  elements.helpButton.addEventListener("click", () => {
    setHelpOpen(elements.helpPopover.hidden);
  });
  elements.searchButton.addEventListener("click", () => {
    if (elements.searchSidebar.hidden) openSearchSidebar("notes");
    else closeSearchSidebar({ restoreFocus: true });
  });
  elements.notesSearchTab.addEventListener("click", () => {
    setSearchMode("notes");
    focusActiveSearchInput();
  });
  elements.pdfSearchTab.addEventListener("click", () => {
    setSearchMode("pdf");
    focusActiveSearchInput();
  });
  elements.searchCloseButton.addEventListener("click", () => {
    closeSearchSidebar({ restoreFocus: true });
  });
  for (const input of [elements.notesSearchInput, elements.pdfSearchInput]) {
    input.addEventListener("input", () => {
      state.searchExpandedPages.clear();
      elements.searchResults.scrollTop = 0;
      renderSearchSidebar();
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (
      state.selectedNote &&
      !event.target.closest(".annotation-note") &&
      !elements.textSizeControls.contains(event.target) &&
      document.activeElement !== elements.textSizeInput
    ) {
      clearSelectedNote();
    }
    if (!elements.helpPopover.hidden && !elements.helpMenu.contains(event.target)) {
      setHelpOpen(false);
    }
    if (!elements.notesPopover.hidden && !elements.notesMenu.contains(event.target)) {
      setNotesOpen(false);
    }
  });
  document.addEventListener("focusin", (event) => {
    if (
      state.selectedNote &&
      !event.target.closest?.(".annotation-note") &&
      !elements.textSizeControls.contains(event.target)
    ) {
      clearSelectedNote();
    }
  });

  elements.workspace.addEventListener("scroll", scheduleCurrentPageUpdate, { passive: true });
  window.addEventListener("resize", scheduleVisiblePageRender, { passive: true });
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("keyup", handleGlobalKeyup);
  window.addEventListener("blur", () => setTextSelectionMode(false));
  window.addEventListener("contextmenu", () => setTextSelectionMode(false));
  window.addEventListener(
    "pointermove",
    (event) => {
      if (state.textSelectionMode !== event.altKey) setTextSelectionMode(event.altKey);
    },
    { capture: true, passive: true },
  );

  window.addEventListener("dragover", (event) => {
    if (hasPdfFile(event.dataTransfer)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (!hasPdfFile(event.dataTransfer)) return;
    event.preventDefault();
    openPdf([...event.dataTransfer.files].find(isPdfFile));
  });
}

function chooseFile() {
  elements.fileInput.click();
}

async function openPdf(file) {
  if (!state.pdfjs || !file) return;
  if (!isPdfFile(file)) {
    showToast("Please choose a PDF file.");
    return;
  }

  setLoading(true, "Opening PDF…");
  destroyCurrentDocument();
  const openToken = Symbol("open-pdf");
  state.openToken = openToken;

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (state.openToken !== openToken) return;
    state.loadingTask = state.pdfjs.getDocument({
      data,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      iccUrl: PDFJS_ICC_URL,
      standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
      wasmUrl: PDFJS_WASM_URL,
      useWasm: true,
    });
    state.loadingTask.onProgress = ({ loaded, total }) => {
      if (!total) return;
      const percent = Math.min(100, Math.round((loaded / total) * 100));
      elements.loadingMessage.textContent = `Opening PDF… ${percent}%`;
    };
    state.loadingTask.onPassword = (setPassword, reason) => {
      const incorrect = reason === state.pdfjs.PasswordResponses.INCORRECT_PASSWORD;
      const password = window.prompt(incorrect ? "That password was incorrect. Try again:" : "PDF password:");
      if (password === null) {
        state.loadingTask.destroy();
      } else {
        setPassword(password);
      }
    };

    state.pdf = await state.loadingTask.promise;
    if (state.openToken !== openToken) return;
    state.documentId = state.pdf.fingerprints?.[0] || `${file.name}:${file.size}:${file.lastModified}`;
    state.documentName = file.name;
    state.annotations = loadAnnotations(state.documentId);
    if (ensureNoteFontSizes(state.annotations, state.noteFontSize)) {
      try {
        saveAnnotations(state.documentId, state.annotations);
      } catch (error) {
        console.error(error);
      }
    }
    state.rotation = loadDocumentView(state.documentId).rotation;
    state.undoStack = [];
    state.zoom = 1;

    elements.documentTitle.textContent = file.name;
    elements.documentTitle.title = file.name;
    elements.pageCount.textContent = state.pdf.numPages;
    elements.currentPage.style.setProperty(
      "--page-number-digits",
      String(String(state.pdf.numPages).length),
    );
    state.currentPage = 1;
    elements.currentPage.value = "1";
    elements.zoomReset.textContent = "100%";
    elements.emptyState.hidden = true;
    elements.viewer.classList.add("is-visible");
    setReaderControlsEnabled(true);

    await buildPageViews(openToken);
    if (state.openToken !== openToken) return;
    elements.workspace.scrollTop = 0;
    updateCurrentPage();
    scheduleVisiblePageRender();
  } catch (error) {
    if (state.openToken !== openToken) return;
    if (error?.name !== "AbortException") {
      console.error(error);
      showToast(humanizePdfError(error), 7000);
    }
    destroyCurrentDocument();
    showEmptyState();
  } finally {
    if (state.openToken === openToken) setLoading(false);
  }
}

async function buildPageViews(openToken) {
  elements.viewer.replaceChildren();
  state.pageViews = [];

  state.pageObserver?.disconnect();
  state.pageObserver = new IntersectionObserver(handlePageVisibility, {
    root: elements.workspace,
    rootMargin: `${PAGE_RENDER_MARGIN}px 0px`,
  });

  for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber += 1) {
    if (state.openToken !== openToken) return;
    elements.loadingMessage.textContent = `Preparing page ${pageNumber} of ${state.pdf.numPages}…`;
    const pdfPage = await state.pdf.getPage(pageNumber);
    if (state.openToken !== openToken) return;
    const baseViewport = getPageViewport(pdfPage, 1, state.rotation);
    const view = createPageView(pageNumber, pdfPage, baseViewport);
    state.pageViews.push(view);
    elements.viewer.append(view.element);
    state.pageObserver.observe(view.element);
  }
}

function createPageView(pageNumber, pdfPage, baseViewport) {
  const element = document.createElement("article");
  element.className = "pdf-page";
  element.dataset.pageNumber = String(pageNumber);
  element.setAttribute("aria-label", `Page ${pageNumber}`);

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");

  const placeholder = document.createElement("span");
  placeholder.className = "page-placeholder";
  placeholder.textContent = `Page ${pageNumber}`;

  const textLayerElement = document.createElement("div");
  textLayerElement.className = "pdf-text-layer";

  const surface = document.createElement("div");
  surface.className = "annotation-surface";
  surface.dataset.pageNumber = String(pageNumber);
  surface.setAttribute("aria-label", `Annotations for page ${pageNumber}`);

  const lineSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lineSvg.classList.add("annotation-lines");
  lineSvg.setAttribute("viewBox", "0 0 1000 1000");
  lineSvg.setAttribute("preserveAspectRatio", "none");
  lineSvg.setAttribute("aria-hidden", "true");

  const noteLayer = document.createElement("div");
  noteLayer.className = "annotation-notes";

  surface.append(lineSvg, noteLayer);
  element.append(canvas, placeholder, textLayerElement, surface);

  const view = {
    pageNumber,
    pdfPage,
    baseViewport,
    element,
    canvas,
    placeholder,
    textLayerElement,
    textLayer: null,
    textLayerRendered: false,
    pendingTextViewport: null,
    surface,
    lineSvg,
    noteLayer,
    renderTask: null,
    renderKey: null,
    renderingKey: null,
    failedRenderKey: null,
    overflowFrame: null,
    visible: false,
  };

  updatePageDimensions(view);
  renderAnnotations(view);
  bindAnnotationSurface(view);
  return view;
}

function getPageViewport(pdfPage, scale, rotation) {
  return pdfPage.getViewport({
    scale,
    rotation: normalizeRotation((pdfPage.rotate || 0) + rotation),
  });
}

function currentRenderKey() {
  return `${state.zoom}:${state.rotation}`;
}

function updatePageDimensions(view) {
  const viewport = getPageViewport(view.pdfPage, state.zoom, state.rotation);
  view.element.style.width = `${viewport.width}px`;
  view.element.style.height = `${viewport.height}px`;
  view.element.style.setProperty("--total-scale-factor", viewport.scale);
  view.element.style.setProperty("--scale-round-x", "1px");
  view.element.style.setProperty("--scale-round-y", "1px");
  updateRenderedNoteFontSizes(view);
  revealAnnotationOverflow(view);
  if (view.textLayerRendered) {
    view.textLayer.update({ viewport });
  } else if (view.textLayer) {
    view.pendingTextViewport = viewport;
  }
}

function handlePageVisibility(entries) {
  for (const entry of entries) {
    const pageNumber = Number(entry.target.dataset.pageNumber);
    const view = state.pageViews[pageNumber - 1];
    if (!view) continue;

    view.visible = entry.isIntersecting;
    if (entry.isIntersecting) {
      renderPage(view);
    } else {
      releasePageCanvas(view);
    }
  }
}

async function renderPage(view) {
  const requestedKey = currentRenderKey();
  if (
    !state.pdf ||
    !view.visible ||
    view.renderKey === requestedKey ||
    view.failedRenderKey === requestedKey
  ) {
    return;
  }

  if (view.renderTask) {
    if (view.renderingKey !== requestedKey) view.renderTask.cancel();
    return;
  }

  const requestedZoom = state.zoom;
  const requestedRotation = state.rotation;
  const viewport = getPageViewport(view.pdfPage, requestedZoom, requestedRotation);
  ensureTextLayer(view, viewport);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const context = view.canvas.getContext("2d", { alpha: false });

  view.canvas.width = Math.floor(viewport.width * pixelRatio);
  view.canvas.height = Math.floor(viewport.height * pixelRatio);
  view.canvas.style.width = `${viewport.width}px`;
  view.canvas.style.height = `${viewport.height}px`;

  const transform = pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0];
  view.renderTask = view.pdfPage.render({ canvasContext: context, transform, viewport });
  view.renderingKey = requestedKey;

  try {
    await view.renderTask.promise;
    if (requestedZoom === state.zoom && requestedRotation === state.rotation) {
      view.renderKey = requestedKey;
      view.failedRenderKey = null;
      view.element.classList.remove("has-render-error");
      view.placeholder.textContent = `Page ${view.pageNumber}`;
      view.placeholder.hidden = true;
    }
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      view.failedRenderKey = requestedKey;
      view.element.classList.add("has-render-error");
      view.placeholder.textContent = `Page ${view.pageNumber} could not be rendered`;
      view.placeholder.hidden = false;
      if (!state.renderErrorShown) {
        state.renderErrorShown = true;
        showToast("A page image could not be decoded. Try reopening the PDF.", 7000);
      }
    }
  } finally {
    view.renderTask = null;
    view.renderingKey = null;
    if (!view.visible) {
      clearPageCanvas(view);
    } else if (view.renderKey !== currentRenderKey()) {
      renderPage(view);
    }
  }
}

function ensureTextLayer(view, viewport) {
  if (view.textLayer) {
    if (view.textLayerRendered) {
      view.textLayer.update({ viewport });
    } else {
      view.pendingTextViewport = viewport;
    }
    return;
  }

  const textLayer = new state.pdfjs.TextLayer({
    textContentSource: view.pdfPage.streamTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    }),
    container: view.textLayerElement,
    viewport,
  });
  view.textLayer = textLayer;
  textLayer
    .render()
    .then(() => {
      if (view.textLayer !== textLayer) return;
      view.textLayerRendered = true;
      if (view.pendingTextViewport) {
        textLayer.update({ viewport: view.pendingTextViewport });
        view.pendingTextViewport = null;
      }
    })
    .catch((error) => {
      if (error?.name === "AbortException") return;
      console.error(`Text layer for page ${view.pageNumber} could not be rendered.`, error);
      if (view.textLayer === textLayer) {
        view.textLayer = null;
        view.textLayerRendered = false;
        view.pendingTextViewport = null;
        view.textLayerElement.replaceChildren();
      }
    });
}

function releasePageCanvas(view) {
  if (view.renderTask) {
    view.renderTask.cancel();
    return;
  }
  clearPageCanvas(view);
}

function clearPageCanvas(view) {
  view.renderKey = null;
  view.canvas.width = 1;
  view.canvas.height = 1;
  view.placeholder.hidden = false;
}

function setZoom(nextZoom) {
  if (!state.pdf) return;
  const roundedZoom = Math.round(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
  if (roundedZoom === state.zoom) return;

  const anchor = getViewportAnchor();
  state.zoom = roundedZoom;
  elements.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
  updateZoomControlState();

  for (const view of state.pageViews) {
    view.renderKey = null;
    updatePageDimensions(view);
  }

  if (anchor) {
    const anchoredView = state.pageViews[anchor.pageNumber - 1];
    elements.workspace.scrollTop =
      anchoredView.element.offsetTop +
      anchoredView.element.offsetHeight * anchor.pageRatio -
      elements.workspace.clientHeight / 2;
  }

  scheduleVisiblePageRender();
  scheduleCurrentPageUpdate();
}

function rotateDocument(delta) {
  if (!state.pdf) return;
  setDocumentRotation(state.rotation + delta);
}

function setDocumentRotation(nextRotation, { persist = true } = {}) {
  const rotation = normalizeRotation(nextRotation);
  if (!state.pdf || rotation === state.rotation) return;

  const anchor = getViewportAnchor();
  state.rotation = rotation;

  for (const view of state.pageViews) {
    view.renderKey = null;
    view.failedRenderKey = null;
    updatePageDimensions(view);
    renderAnnotations(view);
  }
  if (!elements.searchSidebar.hidden && state.searchMode === "notes") {
    renderSearchSidebar();
  }

  if (anchor) {
    const anchoredView = state.pageViews[anchor.pageNumber - 1];
    elements.workspace.scrollTop =
      anchoredView.element.offsetTop +
      anchoredView.element.offsetHeight * anchor.pageRatio -
      elements.workspace.clientHeight / 2;
  }

  if (persist) {
    try {
      saveDocumentView(state.documentId, { rotation: state.rotation });
    } catch (error) {
      console.error(error);
      showToast("The rotated view could not be saved in this browser.", 4000);
    }
    scheduleSidecarSave();
  }

  scheduleVisiblePageRender();
  scheduleCurrentPageUpdate();
}

function setNoteFontSize(nextSize) {
  const size = clamp(nextSize, MIN_NOTE_FONT_SIZE, MAX_NOTE_FONT_SIZE);
  const selectedAnnotation = selectedNoteAnnotation();
  if (size === state.noteFontSize && (!selectedAnnotation || size === selectedAnnotation.fontSize)) {
    updateTextSizeDisplay();
    return;
  }

  state.noteFontSize = size;
  try {
    savePreferences({ noteFontSize: size });
  } catch (error) {
    console.error(error);
    showToast("Text size preference could not be saved.", 4000);
  }

  if (selectedAnnotation) {
    selectedAnnotation.fontSize = size;
    const selection = state.selectedNote;
    const view = state.pageViews[selection.pageNumber - 1];
    const note = view?.noteLayer.querySelector(
      `[data-annotation-id="${CSS.escape(selection.annotationId)}"]`,
    );
    if (note) note.style.fontSize = `${size * state.zoom}px`;
    revealAnnotationOverflow(view);
    persistAnnotations();
  } else {
    scheduleSidecarSave();
  }
  updateTextSizeDisplay();
}

function commitNoteFontSize() {
  if (elements.textSizeInput.dataset.cancelChange) {
    delete elements.textSizeInput.dataset.cancelChange;
    return;
  }

  const size = Number(elements.textSizeInput.value);
  if (!Number.isInteger(size) || size < MIN_NOTE_FONT_SIZE || size > MAX_NOTE_FONT_SIZE) {
    elements.textSizeInput.value = String(currentNoteFontSize());
    showToast(`Choose a text size from ${MIN_NOTE_FONT_SIZE} to ${MAX_NOTE_FONT_SIZE}px.`, 2500);
    return;
  }

  setNoteFontSize(size);
}

function updateTextSizeDisplay() {
  const size = currentNoteFontSize();
  if (document.activeElement !== elements.textSizeInput) {
    elements.textSizeInput.value = String(size);
  }
  elements.textSizeDown.disabled = !state.pdf || size <= MIN_NOTE_FONT_SIZE;
  elements.textSizeUp.disabled = !state.pdf || size >= MAX_NOTE_FONT_SIZE;
  elements.textSizeInput.disabled = !state.pdf;
}

function currentNoteFontSize() {
  return selectedNoteAnnotation()?.fontSize ?? state.noteFontSize;
}

function selectedNoteAnnotation() {
  const selection = state.selectedNote;
  if (!selection) return null;

  const annotation = state.annotations
    .get(selection.pageNumber)
    ?.find(({ id, type }) => id === selection.annotationId && type === "note");
  if (!annotation) state.selectedNote = null;
  return annotation ?? null;
}

function selectNote(pageNumber, annotationId) {
  state.selectedNote = { pageNumber, annotationId };
  updateTextSizeDisplay();
}

function clearSelectedNote() {
  if (!state.selectedNote) return;
  state.selectedNote = null;
  updateTextSizeDisplay();
}

function updateRenderedNoteFontSizes(view) {
  const notes = new Map(
    pageAnnotations(view.pageNumber)
      .filter(({ type }) => type === "note")
      .map((annotation) => [annotation.id, annotation]),
  );
  for (const note of view.noteLayer.querySelectorAll(".annotation-note")) {
    const annotation = notes.get(note.dataset.annotationId);
    if (annotation) note.style.fontSize = `${noteFontSize(annotation) * state.zoom}px`;
  }
}

function getViewportAnchor() {
  if (!state.pageViews.length) return null;
  const center = elements.workspace.getBoundingClientRect().top + elements.workspace.clientHeight / 2;
  let closest = null;
  let closestDistance = Infinity;

  for (const view of state.pageViews) {
    const rect = view.element.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - center);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = {
        pageNumber: view.pageNumber,
        pageRatio: clamp((center - rect.top) / rect.height, 0, 1),
      };
    }
  }

  return closest;
}

function scheduleVisiblePageRender() {
  if (state.zoomFrame) cancelAnimationFrame(state.zoomFrame);
  state.zoomFrame = requestAnimationFrame(() => {
    state.zoomFrame = null;
    const workspaceRect = elements.workspace.getBoundingClientRect();
    for (const view of state.pageViews) {
      const rect = view.element.getBoundingClientRect();
      const nearby =
        rect.bottom >= workspaceRect.top - PAGE_RENDER_MARGIN &&
        rect.top <= workspaceRect.bottom + PAGE_RENDER_MARGIN;
      view.visible = nearby;
      if (nearby) renderPage(view);
      else releasePageCanvas(view);
    }
  });
}

function scheduleCurrentPageUpdate() {
  if (state.scrollFrame) return;
  state.scrollFrame = requestAnimationFrame(() => {
    state.scrollFrame = null;
    updateCurrentPage();
  });
}

function updateCurrentPage() {
  if (!state.pageViews.length) return;
  const workspaceRect = elements.workspace.getBoundingClientRect();
  const readingLine = workspaceRect.top + Math.min(workspaceRect.height * 0.38, 300);
  let current = state.pageViews[0];

  for (const view of state.pageViews) {
    if (view.element.getBoundingClientRect().top <= readingLine) current = view;
    else break;
  }

  state.currentPage = current.pageNumber;
  if (document.activeElement !== elements.currentPage) {
    elements.currentPage.value = String(current.pageNumber);
  }
}

function commitPageNavigation() {
  if (!state.pdf) return;
  if (elements.currentPage.dataset.cancelNavigation) {
    delete elements.currentPage.dataset.cancelNavigation;
    return;
  }
  const pageNumber = Number(elements.currentPage.value);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.pdf.numPages) {
    elements.currentPage.value = String(state.currentPage);
    showToast(`Choose a page from 1 to ${state.pdf.numPages}.`, 2500);
    return;
  }

  goToPage(pageNumber);
}

function goToPage(pageNumber) {
  const view = state.pageViews[pageNumber - 1];
  if (!view) return;

  state.currentPage = pageNumber;
  elements.currentPage.value = String(pageNumber);
  elements.workspace.scrollTo({
    top: Math.max(0, view.element.offsetTop - 24),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

function bindAnnotationSurface(view) {
  let gesture = null;
  let preview = null;

  const cancelGesture = () => {
    if (gesture && view.surface.hasPointerCapture(gesture.pointerId)) {
      view.surface.releasePointerCapture(gesture.pointerId);
    }
    gesture = null;
    preview?.remove();
    preview = null;
  };

  view.surface.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      state.textSelectionMode ||
      event.target.closest(".annotation-note")
    ) {
      return;
    }

    const point = getSurfacePoint(event, view.surface);
    gesture = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: point,
      moved: false,
    };
    view.surface.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  view.surface.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (state.textSelectionMode) {
      cancelGesture();
      return;
    }
    const distance = Math.hypot(
      event.clientX - gesture.startClientX,
      event.clientY - gesture.startClientY,
    );
    if (!gesture.moved && distance >= DRAG_THRESHOLD) {
      gesture.moved = true;
      preview = createSvgLine(gesture.start, gesture.start, true);
      view.lineSvg.append(preview);
    }
    if (gesture.moved && preview) {
      const point = getSurfacePoint(event, view.surface);
      setSvgLineEnd(preview, point);
    }
  });

  view.surface.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (state.textSelectionMode) {
      cancelGesture();
      return;
    }
    const completedGesture = gesture;
    gesture = null;
    preview?.remove();
    preview = null;

    if (completedGesture.moved) {
      const end = getSurfacePoint(event, view.surface);
      addLine(view, completedGesture.start, end);
    } else {
      addNote(view, completedGesture.start);
    }
  });

  view.surface.addEventListener("pointercancel", cancelGesture);

  view.surface.addEventListener("contextmenu", (event) => {
    const target = event.target.closest("[data-annotation-id]");
    if (!target) return;
    event.preventDefault();
    deleteAnnotation(view.pageNumber, target.dataset.annotationId);
  });
}

function addLine(view, start, end) {
  const canonicalStart = rotatePoint(start, -state.rotation);
  const canonicalEnd = rotatePoint(end, -state.rotation);
  const annotation = {
    id: createId(),
    type: "line",
    x1: canonicalStart.x,
    y1: canonicalStart.y,
    x2: canonicalEnd.x,
    y2: canonicalEnd.y,
    persisted: true,
  };
  pageAnnotations(view.pageNumber).push(annotation);
  state.undoStack.push({ type: "add", pageNumber: view.pageNumber, annotation: cloneAnnotation(annotation) });
  persistAnnotations();
  renderAnnotations(view);
}

function addNote(view, point) {
  const canonicalPoint = rotatePoint(point, -state.rotation);
  const annotation = {
    id: createId(),
    type: "note",
    x: canonicalPoint.x,
    y: canonicalPoint.y,
    text: "",
    rotation: state.rotation,
    fontSize: state.noteFontSize,
    persisted: false,
  };
  pageAnnotations(view.pageNumber).push(annotation);
  renderAnnotations(view, annotation.id);
}

function deleteAnnotation(pageNumber, annotationId, { recordUndo = true } = {}) {
  const annotations = pageAnnotations(pageNumber);
  const index = annotations.findIndex((annotation) => annotation.id === annotationId);
  if (index < 0) return;

  const [annotation] = annotations.splice(index, 1);
  if (recordUndo && annotation.persisted !== false) {
    state.undoStack.push({ type: "delete", pageNumber, annotation: cloneAnnotation(annotation) });
  }
  persistAnnotations();
  renderAnnotations(state.pageViews[pageNumber - 1]);
}

function renderAnnotations(view, focusId = null) {
  view.lineSvg.replaceChildren();
  view.noteLayer.replaceChildren();

  for (const annotation of pageAnnotations(view.pageNumber)) {
    if (annotation.type === "line") {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.dataset.annotationId = annotation.id;

      const visibleLine = createSvgLine(
        rotatePoint({ x: annotation.x1, y: annotation.y1 }, state.rotation),
        rotatePoint({ x: annotation.x2, y: annotation.y2 }, state.rotation),
      );
      const hitbox = visibleLine.cloneNode();
      hitbox.classList.remove("annotation-line");
      hitbox.classList.add("annotation-line-hitbox");
      group.append(hitbox, visibleLine);
      view.lineSvg.append(group);
    } else {
      view.noteLayer.append(createNoteElement(view, annotation));
    }
  }

  if (focusId) {
    requestAnimationFrame(() => {
      const note = view.noteLayer.querySelector(`[data-annotation-id="${CSS.escape(focusId)}"]`);
      note?.focus();
      placeCaretAtEnd(note);
    });
  }
}

function revealAnnotationOverflow(view) {
  if (!view) return;
  if (view.overflowFrame) cancelAnimationFrame(view.overflowFrame);
  view.overflowFrame = requestAnimationFrame(() => {
    view.overflowFrame = null;
    if (!view.element.isConnected) return;

    // While editing, the browser scrolls this clipped page automatically to
    // keep an overflowing caret visible. Restore that derived position when
    // saved notes are rendered without a caret. Measure only notes: PDF.js's
    // transformed text layer can have a much larger internal scroll extent.
    const pageRect = view.element.getBoundingClientRect();
    let rightEdge = view.element.clientWidth;
    let bottomEdge = view.element.clientHeight;
    for (const note of view.noteLayer.querySelectorAll(".annotation-note")) {
      const noteRect = note.getBoundingClientRect();
      rightEdge = Math.max(
        rightEdge,
        noteRect.right - pageRect.left + view.element.scrollLeft,
      );
      bottomEdge = Math.max(
        bottomEdge,
        noteRect.bottom - pageRect.top + view.element.scrollTop,
      );
    }

    view.element.scrollLeft = Math.max(0, Math.ceil(rightEdge - view.element.clientWidth));
    view.element.scrollTop = Math.max(0, Math.ceil(bottomEdge - view.element.clientHeight));
  });
}

function createNoteElement(view, annotation) {
  const anchor = rotatePoint({ x: annotation.x, y: annotation.y }, state.rotation);
  const noteRotation = normalizeRotation(state.rotation - (annotation.rotation || 0));
  const note = document.createElement("div");
  note.className = "annotation-note";
  note.dataset.annotationId = annotation.id;
  note.contentEditable = "plaintext-only";
  note.spellcheck = true;
  note.setAttribute("role", "textbox");
  note.setAttribute("aria-label", `Note on page ${view.pageNumber}`);
  note.style.left = `${anchor.x * 100}%`;
  note.style.top = `${anchor.y * 100}%`;
  note.style.transform = `rotate(${noteRotation}deg)`;
  note.style.fontSize = `${noteFontSize(annotation) * state.zoom}px`;
  note.textContent = annotation.text;

  note.addEventListener("pointerdown", (event) => event.stopPropagation());
  note.addEventListener("focus", () => selectNote(view.pageNumber, annotation.id));
  note.addEventListener("input", () => {
    annotation.text = normalizeNoteText(note.innerText);
    if (annotation.text && annotation.persisted === false) {
      annotation.persisted = true;
      state.undoStack.push({
        type: "add",
        pageNumber: view.pageNumber,
        annotation: cloneAnnotation(annotation),
      });
    }
    persistAnnotations();
  });
  note.addEventListener("beforeinput", (event) => {
    if (event.inputType !== "insertParagraph") return;
    event.preventDefault();
    insertPlainText("\n");
  });
  note.addEventListener("paste", (event) => {
    event.preventDefault();
    insertPlainText(event.clipboardData.getData("text/plain"));
  });
  note.addEventListener("keydown", (event) => {
    if (event.key === "Escape") note.blur();
  });
  note.addEventListener("blur", (event) => {
    annotation.text = normalizeNoteText(note.innerText);
    if (!annotation.text) {
      deleteAnnotation(view.pageNumber, annotation.id, { recordUndo: false });
    } else {
      persistAnnotations();
    }
    if (!elements.textSizeControls.contains(event.relatedTarget)) clearSelectedNote();
  });

  return note;
}

function createSvgLine(start, end, preview = false) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.classList.add("annotation-line");
  if (preview) line.classList.add("annotation-line-preview");
  line.setAttribute("x1", start.x * 1000);
  line.setAttribute("y1", start.y * 1000);
  setSvgLineEnd(line, end);
  return line;
}

function setSvgLineEnd(line, end) {
  line.setAttribute("x2", end.x * 1000);
  line.setAttribute("y2", end.y * 1000);
}

function undoLastAnnotationAction() {
  while (state.undoStack.length) {
    const action = state.undoStack.pop();
    const annotations = pageAnnotations(action.pageNumber);
    if (action.type === "add") {
      const index = annotations.findIndex(({ id }) => id === action.annotation.id);
      if (index < 0) continue;
      annotations.splice(index, 1);
    } else if (action.type === "delete") {
      annotations.push({ ...action.annotation, persisted: true });
    }

    persistAnnotations();
    renderAnnotations(state.pageViews[action.pageNumber - 1]);
    return;
  }

  showToast("Nothing to undo.", 1500);
}

function handleGlobalKeydown(event) {
  if (event.key === "Alt") setTextSelectionMode(true);

  const modifier = event.metaKey || event.ctrlKey;
  const editingNote = event.target.closest?.(".annotation-note");

  if (event.key === "Escape") {
    if (!elements.searchSidebar.hidden) {
      event.preventDefault();
      closeSearchSidebar({ restoreFocus: true });
      return;
    }
    if (!elements.helpPopover.hidden) {
      event.preventDefault();
      setHelpOpen(false, { restoreFocus: true });
      return;
    }
    if (!elements.notesPopover.hidden) {
      event.preventDefault();
      setNotesOpen(false, { restoreFocus: true });
      return;
    }
  }

  if (state.pdf && modifier && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openSearchSidebar(event.shiftKey ? "pdf" : "notes");
    return;
  }

  if (modifier && event.key.toLowerCase() === "o" && !editingNote && state.pdfjs) {
    event.preventDefault();
    chooseFile();
    return;
  }

  if (modifier && event.key.toLowerCase() === "z" && !event.shiftKey && !editingNote) {
    event.preventDefault();
    undoLastAnnotationAction();
    return;
  }

  if (!state.pdf || !modifier || editingNote) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(state.zoom + ZOOM_STEP);
  } else if (event.key === "-") {
    event.preventDefault();
    setZoom(state.zoom - ZOOM_STEP);
  } else if (event.key === "0") {
    event.preventDefault();
    setZoom(1);
  }
}

function handleGlobalKeyup(event) {
  if (event.key === "Alt") setTextSelectionMode(false);
}

function setTextSelectionMode(enabled) {
  if (state.textSelectionMode === enabled) return;
  state.textSelectionMode = enabled;
  elements.viewer.classList.toggle("is-text-selection-mode", enabled);
}

function openSearchSidebar(mode) {
  if (!state.pdf) return;
  if (elements.searchSidebar.hidden) {
    state.searchReturnFocus = document.activeElement;
  }

  elements.searchSidebar.hidden = false;
  elements.readerShell.classList.add("is-search-open");
  setHelpOpen(false);
  setNotesOpen(false);
  setSearchMode(mode);
  requestAnimationFrame(focusActiveSearchInput);
}

function closeSearchSidebar({ restoreFocus = false } = {}) {
  if (elements.searchSidebar.hidden) return;
  elements.searchSidebar.hidden = true;
  elements.readerShell.classList.remove("is-search-open");
  state.searchExpandedPages.clear();

  if (restoreFocus && state.searchReturnFocus?.isConnected) {
    state.searchReturnFocus.focus?.();
  }
  state.searchReturnFocus = null;
}

function setSearchMode(mode) {
  if (mode !== "notes" && mode !== "pdf") return;
  if (state.searchMode !== mode) {
    state.searchExpandedPages.clear();
    elements.searchResults.scrollTop = 0;
  }
  state.searchMode = mode;

  const notesSelected = mode === "notes";
  elements.notesSearchTab.setAttribute("aria-selected", String(notesSelected));
  elements.notesSearchTab.tabIndex = notesSelected ? 0 : -1;
  elements.pdfSearchTab.setAttribute("aria-selected", String(!notesSelected));
  elements.pdfSearchTab.tabIndex = notesSelected ? -1 : 0;
  elements.searchResults.setAttribute(
    "aria-labelledby",
    notesSelected ? "notes-search-tab" : "pdf-search-tab",
  );
  elements.notesSearchField.hidden = !notesSelected;
  elements.pdfSearchField.hidden = notesSelected;
  renderSearchSidebar();

  if (!notesSelected) preparePdfSearchIndex();
}

function renderSearchSidebar() {
  if (elements.searchSidebar.hidden || !state.pdf) return;
  const previousScrollTop = elements.searchResults.scrollTop;
  const query = normalizeSearchQuery(activeSearchInput().value);
  elements.searchResults.replaceChildren();

  if (state.searchMode === "notes") {
    const groups = collectNoteGroups(query);
    if (!groups.length) {
      renderSearchMessage(query ? "No notes match this search." : "No notes yet.");
    } else {
      for (const group of groups) {
        elements.searchResults.append(createSearchPageGroup(group, "notes", query));
      }
    }
  } else if (state.pdfSearchStatus === "loading") {
    const total = state.pdf?.numPages || 0;
    const progress = state.pdfSearchProgress ? ` ${state.pdfSearchProgress} of ${total}` : "";
    renderSearchMessage(`Preparing searchable text…${progress}`);
  } else if (state.pdfSearchStatus === "error") {
    renderSearchMessage("The PDF text could not be prepared for searching.");
  } else if (state.pdfSearchStatus === "ready") {
    if (!state.pdfSearchPages.some(({ text }) => text.length > 0)) {
      renderSearchMessage("This PDF has no searchable text.");
    } else if (!query) {
      renderSearchMessage("Type to search the PDF text.");
    } else {
      const groups = searchPdfPages(query);
      if (!groups.length) {
        renderSearchMessage(`No matches for “${query}”.`);
      } else {
        for (const group of groups) {
          elements.searchResults.append(createSearchPageGroup(group, "pdf", query));
        }
      }
    }
  } else {
    renderSearchMessage("Preparing searchable text…");
  }

  elements.searchResults.scrollTop = previousScrollTop;
}

function activeSearchInput() {
  return state.searchMode === "notes" ? elements.notesSearchInput : elements.pdfSearchInput;
}

function focusActiveSearchInput() {
  const input = activeSearchInput();
  input.focus();
  input.select();
}

function renderSearchMessage(message) {
  const element = document.createElement("p");
  element.className = "search-empty";
  element.textContent = message;
  elements.searchResults.append(element);
}

function collectNoteGroups(query) {
  const foldedQuery = query.toLocaleLowerCase();
  const groups = [];
  const pages = [...state.annotations.entries()].sort(([pageA], [pageB]) => pageA - pageB);

  for (const [pageNumber, annotations] of pages) {
    const notes = annotations
      .filter((annotation) => {
        if (annotation.type !== "note" || !annotation.text.trim()) return false;
        return (
          !foldedQuery ||
          normalizeSearchQuery(annotation.text).toLocaleLowerCase().includes(foldedQuery)
        );
      })
      .sort((noteA, noteB) => {
        const anchorA = rotatePoint(noteA, state.rotation);
        const anchorB = rotatePoint(noteB, state.rotation);
        return anchorA.y - anchorB.y || anchorA.x - anchorB.x;
      });
    if (notes.length) groups.push({ pageNumber, items: notes });
  }

  return groups;
}

function createSearchPageGroup(group, mode, query) {
  const { pageNumber, items } = group;
  const expanded = items.length > 1 && state.searchExpandedPages.has(pageNumber);
  if (items.length === 1) state.searchExpandedPages.delete(pageNumber);
  const section = document.createElement("section");
  section.className = "search-page-group";
  if (expanded) section.classList.add("is-expanded");

  const summary = document.createElement("div");
  summary.className = "search-page-summary";
  if (items.length === 1) summary.classList.add("has-no-toggle");

  const pageLink = document.createElement("button");
  pageLink.className = "search-page-link";
  pageLink.type = "button";
  pageLink.addEventListener("click", () => goToPage(pageNumber));

  const meta = document.createElement("span");
  meta.className = "search-page-meta";
  const pageLabel = document.createElement("span");
  pageLabel.className = "search-page-number";
  pageLabel.textContent = `Page ${pageNumber}`;
  const count = document.createElement("span");
  count.className = "search-page-count";
  const noun = mode === "notes" ? "note" : "match";
  const pluralNoun = mode === "notes" ? "notes" : "matches";
  count.textContent = `${items.length} ${items.length === 1 ? noun : pluralNoun}`;
  meta.append(pageLabel, count);

  const preview = document.createElement("span");
  preview.className = "search-page-preview";
  appendSearchPreview(preview, items[0], mode, query);
  pageLink.append(meta, preview);
  summary.append(pageLink);

  const children = document.createElement("div");
  children.className = "search-page-children";
  children.hidden = !expanded;
  let childrenRendered = false;

  const renderChildren = () => {
    if (childrenRendered) return;
    childrenRendered = true;
    for (const item of items.slice(1)) {
      const resultLink = document.createElement("button");
      resultLink.className = "search-result-link";
      resultLink.type = "button";
      const resultPreview = document.createElement("span");
      resultPreview.className = "search-result-preview";
      appendSearchPreview(resultPreview, item, mode, query);
      resultLink.append(resultPreview);
      resultLink.addEventListener("click", () => {
        if (mode === "notes") goToNote(pageNumber, item.id);
        else goToPage(pageNumber);
      });
      children.append(resultLink);
    }
  };

  if (items.length > 1) {
    const toggle = document.createElement("button");
    toggle.className = "search-page-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      `${expanded ? "Hide" : "Show"} ${items.length - 1} more ${items.length === 2 ? noun : pluralNoun} on page ${pageNumber}`,
    );
    toggle.addEventListener("click", () => {
      const shouldExpand = !state.searchExpandedPages.has(pageNumber);
      if (shouldExpand) {
        state.searchExpandedPages.add(pageNumber);
        renderChildren();
      } else {
        state.searchExpandedPages.delete(pageNumber);
      }
      section.classList.toggle("is-expanded", shouldExpand);
      toggle.setAttribute("aria-expanded", String(shouldExpand));
      toggle.setAttribute(
        "aria-label",
        `${shouldExpand ? "Hide" : "Show"} ${items.length - 1} more ${items.length === 2 ? noun : pluralNoun} on page ${pageNumber}`,
      );
      children.hidden = !shouldExpand;
    });
    summary.append(toggle);
  }

  if (expanded) renderChildren();
  section.append(summary, children);
  return section;
}

function appendSearchPreview(container, item, mode, query) {
  if (mode === "pdf") {
    if (item.leadingEllipsis) container.append("…");
    container.append(document.createTextNode(item.before));
    const mark = document.createElement("mark");
    mark.textContent = item.match;
    container.append(mark, document.createTextNode(item.after));
    if (item.trailingEllipsis) container.append("…");
    return;
  }

  appendHighlightedText(container, truncatePreview(item.text), query);
}

function appendHighlightedText(container, text, query) {
  if (!query) {
    container.textContent = text;
    return;
  }

  const matcher = new RegExp(escapeRegularExpression(query), "giu");
  let cursor = 0;
  let match;
  while ((match = matcher.exec(text))) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const mark = document.createElement("mark");
    mark.textContent = match[0];
    container.append(mark);
    cursor = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function truncatePreview(text) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= NOTE_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, NOTE_PREVIEW_LENGTH).trimEnd()}…`;
}

function goToNote(pageNumber, annotationId) {
  const view = state.pageViews[pageNumber - 1];
  const note = view?.noteLayer.querySelector(
    `[data-annotation-id="${CSS.escape(annotationId)}"]`,
  );
  if (!note) {
    goToPage(pageNumber);
    return;
  }

  state.currentPage = pageNumber;
  elements.currentPage.value = String(pageNumber);
  note.scrollIntoView({
    block: "center",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
  requestAnimationFrame(() => {
    note.focus({ preventScroll: true });
    placeCaretAtEnd(note);
  });
}

async function preparePdfSearchIndex() {
  if (!state.pdf || state.pdfSearchStatus !== "idle") return;
  const openToken = state.openToken;
  state.pdfSearchStatus = "loading";
  state.pdfSearchProgress = 0;
  state.pdfSearchPages = [];
  renderSearchSidebar();

  try {
    for (const view of state.pageViews) {
      const textContent = await view.pdfPage.getTextContent({
        includeMarkedContent: true,
        disableNormalization: false,
      });
      if (state.openToken !== openToken || !state.pdf) return;
      state.pdfSearchPages.push({
        pageNumber: view.pageNumber,
        text: searchableTextFromContent(textContent),
      });
      state.pdfSearchProgress = view.pageNumber;
      if (
        view.pageNumber === 1 ||
        view.pageNumber === state.pageViews.length ||
        view.pageNumber % 10 === 0
      ) {
        renderSearchSidebar();
      }
    }

    if (state.openToken !== openToken || !state.pdf) return;
    state.pdfSearchStatus = "ready";
    renderSearchSidebar();
  } catch (error) {
    if (state.openToken !== openToken || !state.pdf || error?.name === "AbortException") return;
    console.error("PDF text could not be prepared for searching.", error);
    state.pdfSearchStatus = "error";
    renderSearchSidebar();
  }
}

function searchableTextFromContent(textContent) {
  let text = "";
  for (const item of textContent.items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text.replace(/\s+/gu, " ").trim();
}

function searchPdfPages(query) {
  const groups = [];
  for (const page of state.pdfSearchPages) {
    const matcher = new RegExp(escapeRegularExpression(query), "giu");
    const matches = [];
    let match;
    while ((match = matcher.exec(page.text))) {
      const start = Math.max(0, match.index - SEARCH_CONTEXT_LENGTH);
      const end = Math.min(
        page.text.length,
        match.index + match[0].length + SEARCH_CONTEXT_LENGTH,
      );
      matches.push({
        before: page.text.slice(start, match.index),
        match: match[0],
        after: page.text.slice(match.index + match[0].length, end),
        leadingEllipsis: start > 0,
        trailingEllipsis: end < page.text.length,
      });
    }
    if (matches.length) groups.push({ pageNumber: page.pageNumber, items: matches });
  }
  return groups;
}

function normalizeSearchQuery(query) {
  return query.replace(/\s+/gu, " ").trim();
}

function escapeRegularExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setHelpOpen(open, { restoreFocus = false } = {}) {
  if (open) {
    elements.notesPopover.hidden = true;
    elements.notesButton.setAttribute("aria-expanded", "false");
  }
  elements.helpPopover.hidden = !open;
  elements.helpButton.setAttribute("aria-expanded", String(open));
  if (!open && restoreFocus) elements.helpButton.focus();
}

function setNotesOpen(open, { restoreFocus = false } = {}) {
  if (open) {
    elements.helpPopover.hidden = true;
    elements.helpButton.setAttribute("aria-expanded", "false");
  }
  elements.notesPopover.hidden = !open;
  elements.notesButton.setAttribute("aria-expanded", String(open));
  if (!open && restoreFocus) elements.notesButton.focus();
}

function pageAnnotations(pageNumber) {
  if (!state.annotations.has(pageNumber)) state.annotations.set(pageNumber, []);
  return state.annotations.get(pageNumber);
}

function persistAnnotations() {
  try {
    saveAnnotations(state.documentId, state.annotations);
  } catch (error) {
    console.error(error);
    showToast("Notes could not be saved. Browser storage may be full.", 6000);
  }
  scheduleSidecarSave();
  if (!elements.searchSidebar.hidden && state.searchMode === "notes") {
    renderSearchSidebar();
  }
}

async function saveNotesToFile() {
  if (!state.pdf) return;
  setNotesOpen(false);

  if (!("showSaveFilePicker" in window)) {
    downloadSidecar();
    return;
  }

  try {
    if (!state.sidecarHandle) {
      state.sidecarHandle = await window.showSaveFilePicker({
        id: "pencil-reader-notes",
        suggestedName: suggestedSidecarName(),
        types: [
          {
            description: "Pencil Reader notes",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      state.sidecarFileName = state.sidecarHandle.name;
    }
    await flushSidecarSave({ requestPermission: true });
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    setSaveNotesStatus("error", "Notes file could not be saved");
    showToast("The notes file could not be saved.", 5000);
  }
}

async function loadNotesFromFile() {
  if (!state.pdf) return;
  setNotesOpen(false);

  if (!("showOpenFilePicker" in window)) {
    elements.notesFileInput.click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      id: "pencil-reader-notes",
      multiple: false,
      types: [
        {
          description: "Pencil Reader notes",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const file = await handle.getFile();
    await importSidecarFile(file, handle);
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    showToast("The notes file could not be opened.", 5000);
  }
}

async function importSidecarFile(file, handle = null) {
  const documentId = state.documentId;
  try {
    const sidecar = JSON.parse(await file.text());
    if (!state.pdf || state.documentId !== documentId) return;
    if (sidecar?.format !== SIDECAR_FORMAT || sidecar?.version !== SIDECAR_VERSION) {
      throw new Error("Unsupported notes file");
    }

    const fingerprint = sidecar.pdf?.fingerprint;
    if (
      fingerprint &&
      fingerprint !== state.documentId &&
      !window.confirm("This notes file was created for a different PDF. Load it anyway?")
    ) {
      return;
    }

    if (
      countAnnotations(state.annotations) > 0 &&
      !window.confirm("Loading this file will replace the notes currently shown. Continue?")
    ) {
      return;
    }

    const loadedPages = deserializeAnnotationPages(sidecar.pages);
    for (const pageNumber of loadedPages.keys()) {
      if (pageNumber > state.pdf.numPages) loadedPages.delete(pageNumber);
    }

    state.annotations = loadedPages;
    state.undoStack = [];
    state.sidecarHandle = handle;
    state.sidecarFileName = file.name;

    const savedFontSize = sidecar.preferences?.noteFontSize;
    if (Number.isInteger(savedFontSize)) {
      state.noteFontSize = clamp(savedFontSize, MIN_NOTE_FONT_SIZE, MAX_NOTE_FONT_SIZE);
      try {
        savePreferences({ noteFontSize: state.noteFontSize });
      } catch (error) {
        console.error(error);
      }
      updateTextSizeDisplay();
    }
    ensureNoteFontSizes(state.annotations, state.noteFontSize);

    const rotationAnchor = getViewportAnchor();
    const savedRotation = sidecar.preferences?.rotation;
    state.rotation =
      Number.isInteger(savedRotation) && savedRotation % 90 === 0
        ? normalizeRotation(savedRotation)
        : 0;

    try {
      saveAnnotations(state.documentId, state.annotations);
      saveDocumentView(state.documentId, { rotation: state.rotation });
    } catch (error) {
      console.error(error);
      showToast("Notes loaded, but the browser backup could not be updated.", 5000);
    }
    for (const view of state.pageViews) {
      view.renderKey = null;
      view.failedRenderKey = null;
      updatePageDimensions(view);
      renderAnnotations(view);
    }
    if (rotationAnchor) {
      const anchoredView = state.pageViews[rotationAnchor.pageNumber - 1];
      elements.workspace.scrollTop =
        anchoredView.element.offsetTop +
        anchoredView.element.offsetHeight * rotationAnchor.pageRatio -
        elements.workspace.clientHeight / 2;
    }
    scheduleVisiblePageRender();
    if (!elements.searchSidebar.hidden && state.searchMode === "notes") {
      renderSearchSidebar();
    }

    if (handle) {
      let permission = "prompt";
      try {
        permission = await handle.queryPermission({ mode: "readwrite" });
      } catch (error) {
        console.error(error);
      }
      if (permission === "granted") setSaveNotesStatus("saved", `Linked to ${file.name}`);
      else setSaveNotesStatus("reconnect", `Click to allow saving to ${file.name}`);
    } else {
      setSaveNotesStatus("idle", "Loaded; browser backup only");
    }
    showToast(`Loaded notes from ${file.name}.`);
  } catch (error) {
    console.error(error);
    showToast("That file is not a valid Pencil Reader notes file.", 5000);
  }
}

function scheduleSidecarSave() {
  if (!state.pdf || !state.sidecarHandle) return;
  clearTimeout(state.sidecarSaveTimer);
  setSaveNotesStatus("unsaved", `Changes pending for ${state.sidecarFileName}`);
  state.sidecarSaveTimer = setTimeout(() => {
    state.sidecarSaveTimer = null;
    flushSidecarSave();
  }, SIDECAR_AUTOSAVE_DELAY);
}

async function flushSidecarSave({ requestPermission = false } = {}) {
  if (!state.sidecarHandle || !state.pdf) return;
  if (state.sidecarWriteInProgress) {
    state.sidecarWritePending = true;
    return;
  }

  state.sidecarWriteInProgress = true;
  const handle = state.sidecarHandle;
  const documentId = state.documentId;
  const generation = state.sidecarGeneration;
  try {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission === "prompt" && requestPermission) {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (
      state.sidecarGeneration !== generation ||
      state.documentId !== documentId ||
      state.sidecarHandle !== handle
    ) return;
    if (permission !== "granted") {
      setSaveNotesStatus("reconnect", `Click to allow saving to ${state.sidecarFileName}`);
      if (requestPermission) showToast("Write access to the notes file was not granted.", 4000);
      return;
    }

    setSaveNotesStatus("saving", `Saving to ${state.sidecarFileName}`);
    const contents = JSON.stringify(createSidecar(), null, 2);
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    if (
      state.sidecarGeneration === generation &&
      state.documentId === documentId &&
      state.sidecarHandle === handle
    ) {
      setSaveNotesStatus("saved", `Saved to ${state.sidecarFileName}`);
    }
  } catch (error) {
    console.error(error);
    if (
      state.sidecarGeneration === generation &&
      state.documentId === documentId &&
      state.sidecarHandle === handle
    ) {
      setSaveNotesStatus("error", "Notes file could not be saved");
    }
  } finally {
    if (state.sidecarGeneration !== generation) return;
    state.sidecarWriteInProgress = false;
    if (state.sidecarWritePending) {
      state.sidecarWritePending = false;
      scheduleSidecarSave();
    }
  }
}

function createSidecar() {
  return {
    format: SIDECAR_FORMAT,
    version: SIDECAR_VERSION,
    pdf: {
      name: state.documentName,
      fingerprint: state.documentId,
      pageCount: state.pdf?.numPages ?? null,
    },
    savedAt: new Date().toISOString(),
    preferences: {
      noteFontSize: state.noteFontSize,
      rotation: state.rotation,
    },
    pages: serializeAnnotationPages(state.annotations),
  };
}

function downloadSidecar() {
  const contents = JSON.stringify(createSidecar(), null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedSidecarName();
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Notes downloaded. Save again after future changes to create an updated copy.", 5000);
}

function suggestedSidecarName() {
  const baseName = (state.documentName || "document").replace(/\.pdf$/i, "");
  return `${baseName}.pencil.json`;
}

function setSaveNotesStatus(status, title) {
  const actionLabels = {
    idle: "Save notes file…",
    unsaved: "Save now",
    saving: "Saving…",
    saved: "Save now",
    reconnect: "Reconnect and save…",
    error: "Try saving again…",
  };
  elements.notesButton.dataset.status = status;
  elements.saveNotesButton.dataset.status = status;
  elements.saveNotesLabel.textContent = actionLabels[status] || actionLabels.idle;
  elements.notesStatusText.textContent = title || "Browser backup only";
  elements.notesStatusText.title = title || "Browser backup only";
  elements.notesButton.title = title || "Notes file";
  elements.saveNotesButton.title = title || "Save notes to a file";
}

function countAnnotations(pages) {
  let count = 0;
  for (const annotations of pages.values()) count += annotations.length;
  return count;
}

function getSurfacePoint(event, surface) {
  const rect = surface.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function insertPlainText(text) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  document.activeElement?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function placeCaretAtEnd(element) {
  if (!element) return;
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function normalizeNoteText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

function setReaderControlsEnabled(enabled) {
  elements.zoomOut.disabled = !enabled || state.zoom <= MIN_ZOOM;
  elements.zoomIn.disabled = !enabled || state.zoom >= MAX_ZOOM;
  elements.zoomReset.disabled = !enabled;
  elements.rotateLeft.disabled = !enabled;
  elements.rotateRight.disabled = !enabled;
  elements.currentPage.disabled = !enabled;
  elements.notesButton.disabled = !enabled;
  elements.searchButton.disabled = !enabled;
  elements.loadNotesButton.disabled = !enabled;
  elements.saveNotesButton.disabled = !enabled;
  updateTextSizeDisplay();
}

function updateZoomControlState() {
  setReaderControlsEnabled(Boolean(state.pdf));
}

function setLoading(loading, message = "Opening PDF…") {
  elements.loadingPanel.hidden = !loading;
  elements.loadingMessage.textContent = message;
  elements.openButton.disabled = loading || !state.pdfjs;
  elements.emptyOpenButton.disabled = loading || !state.pdfjs;
}

function destroyCurrentDocument() {
  closeSearchSidebar();
  state.sidecarGeneration += 1;
  clearTimeout(state.sidecarSaveTimer);
  state.sidecarSaveTimer = null;
  state.pageObserver?.disconnect();
  state.pageObserver = null;
  for (const view of state.pageViews) {
    if (view.overflowFrame) cancelAnimationFrame(view.overflowFrame);
    view.renderTask?.cancel();
    view.textLayer?.cancel();
  }
  state.pageViews = [];
  elements.viewer.replaceChildren();
  if (state.loadingTask) state.loadingTask.destroy();
  else state.pdf?.destroy();
  state.loadingTask = null;
  state.pdf = null;
  state.documentId = null;
  state.documentName = null;
  state.annotations = new Map();
  state.undoStack = [];
  state.renderErrorShown = false;
  state.rotation = 0;
  state.selectedNote = null;
  state.searchMode = "notes";
  state.searchExpandedPages.clear();
  state.searchReturnFocus = null;
  state.pdfSearchStatus = "idle";
  state.pdfSearchPages = [];
  state.pdfSearchProgress = 0;
  elements.notesSearchInput.value = "";
  elements.pdfSearchInput.value = "";
  setSearchMode("notes");
  state.sidecarHandle = null;
  state.sidecarFileName = null;
  state.sidecarWriteInProgress = false;
  state.sidecarWritePending = false;
  setSaveNotesStatus("idle", "Browser backup only");
  setNotesOpen(false);
  setReaderControlsEnabled(false);
}

function showEmptyState() {
  elements.emptyState.hidden = false;
  elements.viewer.classList.remove("is-visible");
  elements.documentTitle.textContent = "No PDF open";
  elements.documentTitle.title = "No PDF open";
  elements.currentPage.value = "–";
  state.currentPage = 1;
  elements.pageCount.textContent = "–";
  setReaderControlsEnabled(false);
}

function showToast(message, duration = 3500) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

function humanizePdfError(error) {
  if (error?.name === "PasswordException") return "This PDF could not be opened without its password.";
  if (error?.name === "InvalidPDFException") return "This file does not appear to be a valid PDF.";
  if (error?.name === "MissingPDFException") return "The PDF file could not be read.";
  return "This PDF could not be opened. Try a different file.";
}

function hasPdfFile(dataTransfer) {
  const itemsContainPdf = [...(dataTransfer?.items || [])].some(
    (item) => item.kind === "file" && (item.type === "application/pdf" || item.type === ""),
  );
  return itemsContainPdf || [...(dataTransfer?.files || [])].some(isPdfFile);
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf");
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function noteFontSize(annotation) {
  return isValidNoteFontSize(annotation.fontSize) ? annotation.fontSize : state.noteFontSize;
}

function isValidNoteFontSize(value) {
  return Number.isInteger(value) && value >= MIN_NOTE_FONT_SIZE && value <= MAX_NOTE_FONT_SIZE;
}

function ensureNoteFontSizes(pages, fallbackSize) {
  let changed = false;
  for (const annotations of pages.values()) {
    for (const annotation of annotations) {
      if (annotation.type === "note" && !isValidNoteFontSize(annotation.fontSize)) {
        annotation.fontSize = fallbackSize;
        changed = true;
      }
    }
  }
  return changed;
}

function normalizeRotation(rotation) {
  return ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
}

function rotatePoint(point, rotation) {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: 1 - point.y, y: point.x };
    case 180:
      return { x: 1 - point.x, y: 1 - point.y };
    case 270:
      return { x: point.y, y: 1 - point.x };
    default:
      return { x: point.x, y: point.y };
  }
}
