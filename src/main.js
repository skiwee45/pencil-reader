import {
  cloneAnnotation,
  loadAnnotations,
  loadPreferences,
  deserializeAnnotationPages,
  saveAnnotations,
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
  zoomOut: document.querySelector("#zoom-out"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomReset: document.querySelector("#zoom-reset"),
  textSizeDown: document.querySelector("#text-size-down"),
  textSizeUp: document.querySelector("#text-size-up"),
  textSizeInput: document.querySelector("#text-size-input"),
  helpMenu: document.querySelector("#help-menu"),
  helpButton: document.querySelector("#help-button"),
  helpPopover: document.querySelector("#help-popover"),
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
  noteFontSize: preferences.noteFontSize,
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
  elements.textSizeDown.addEventListener("click", () => {
    setNoteFontSize(state.noteFontSize - NOTE_FONT_SIZE_STEP);
  });
  elements.textSizeUp.addEventListener("click", () => {
    setNoteFontSize(state.noteFontSize + NOTE_FONT_SIZE_STEP);
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
      elements.textSizeInput.value = String(state.noteFontSize);
      elements.textSizeInput.blur();
    }
  });
  elements.textSizeInput.addEventListener("blur", commitNoteFontSize);
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
  document.addEventListener("pointerdown", (event) => {
    if (!elements.helpPopover.hidden && !elements.helpMenu.contains(event.target)) {
      setHelpOpen(false);
    }
    if (!elements.notesPopover.hidden && !elements.notesMenu.contains(event.target)) {
      setNotesOpen(false);
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
      if (state.textSelectionMode !== event.shiftKey) setTextSelectionMode(event.shiftKey);
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
    const baseViewport = pdfPage.getViewport({ scale: 1 });
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
    renderScale: null,
    renderingScale: null,
    failedRenderScale: null,
    visible: false,
  };

  updatePageDimensions(view);
  renderAnnotations(view);
  bindAnnotationSurface(view);
  return view;
}

function updatePageDimensions(view) {
  const viewport = view.pdfPage.getViewport({ scale: state.zoom });
  view.element.style.width = `${viewport.width}px`;
  view.element.style.height = `${viewport.height}px`;
  view.element.style.setProperty("--total-scale-factor", viewport.scale);
  view.element.style.setProperty("--scale-round-x", "1px");
  view.element.style.setProperty("--scale-round-y", "1px");
  view.element.style.setProperty("--annotation-scale", state.zoom);
  view.element.style.setProperty(
    "--annotation-font-size",
    `${state.noteFontSize * state.zoom}px`,
  );
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
  if (
    !state.pdf ||
    !view.visible ||
    view.renderScale === state.zoom ||
    view.failedRenderScale === state.zoom
  ) {
    return;
  }

  if (view.renderTask) {
    if (view.renderingScale !== state.zoom) view.renderTask.cancel();
    return;
  }

  const requestedZoom = state.zoom;
  const viewport = view.pdfPage.getViewport({ scale: requestedZoom });
  ensureTextLayer(view, viewport);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const context = view.canvas.getContext("2d", { alpha: false });

  view.canvas.width = Math.floor(viewport.width * pixelRatio);
  view.canvas.height = Math.floor(viewport.height * pixelRatio);
  view.canvas.style.width = `${viewport.width}px`;
  view.canvas.style.height = `${viewport.height}px`;

  const transform = pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0];
  view.renderTask = view.pdfPage.render({ canvasContext: context, transform, viewport });
  view.renderingScale = requestedZoom;

  try {
    await view.renderTask.promise;
    if (requestedZoom === state.zoom) {
      view.renderScale = requestedZoom;
      view.failedRenderScale = null;
      view.element.classList.remove("has-render-error");
      view.placeholder.textContent = `Page ${view.pageNumber}`;
      view.placeholder.hidden = true;
    }
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      view.failedRenderScale = requestedZoom;
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
    view.renderingScale = null;
    if (!view.visible) {
      clearPageCanvas(view);
    } else if (view.renderScale !== state.zoom) {
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
  view.renderScale = null;
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
    view.renderScale = null;
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

function setNoteFontSize(nextSize) {
  const size = clamp(nextSize, MIN_NOTE_FONT_SIZE, MAX_NOTE_FONT_SIZE);
  if (size === state.noteFontSize) {
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

  for (const view of state.pageViews) updatePageDimensions(view);
  updateTextSizeDisplay();
  scheduleSidecarSave();
}

function commitNoteFontSize() {
  if (elements.textSizeInput.dataset.cancelChange) {
    delete elements.textSizeInput.dataset.cancelChange;
    return;
  }

  const size = Number(elements.textSizeInput.value);
  if (!Number.isInteger(size) || size < MIN_NOTE_FONT_SIZE || size > MAX_NOTE_FONT_SIZE) {
    elements.textSizeInput.value = String(state.noteFontSize);
    showToast(`Choose a text size from ${MIN_NOTE_FONT_SIZE} to ${MAX_NOTE_FONT_SIZE}px.`, 2500);
    return;
  }

  setNoteFontSize(size);
}

function updateTextSizeDisplay() {
  if (document.activeElement !== elements.textSizeInput) {
    elements.textSizeInput.value = String(state.noteFontSize);
  }
  elements.textSizeDown.disabled = !state.pdf || state.noteFontSize <= MIN_NOTE_FONT_SIZE;
  elements.textSizeUp.disabled = !state.pdf || state.noteFontSize >= MAX_NOTE_FONT_SIZE;
  elements.textSizeInput.disabled = !state.pdf;
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
      event.shiftKey ||
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
  const annotation = {
    id: createId(),
    type: "line",
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    persisted: true,
  };
  pageAnnotations(view.pageNumber).push(annotation);
  state.undoStack.push({ type: "add", pageNumber: view.pageNumber, annotation: cloneAnnotation(annotation) });
  persistAnnotations();
  renderAnnotations(view);
}

function addNote(view, point) {
  const annotation = {
    id: createId(),
    type: "note",
    x: point.x,
    y: point.y,
    text: "",
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
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 },
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

function createNoteElement(view, annotation) {
  const note = document.createElement("div");
  note.className = "annotation-note";
  note.dataset.annotationId = annotation.id;
  note.contentEditable = "plaintext-only";
  note.spellcheck = true;
  note.setAttribute("role", "textbox");
  note.setAttribute("aria-label", `Note on page ${view.pageNumber}`);
  note.style.left = `${annotation.x * 100}%`;
  note.style.top = `${annotation.y * 100}%`;
  note.textContent = annotation.text;

  note.addEventListener("pointerdown", (event) => event.stopPropagation());
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
  note.addEventListener("blur", () => {
    annotation.text = normalizeNoteText(note.innerText);
    if (!annotation.text) {
      deleteAnnotation(view.pageNumber, annotation.id, { recordUndo: false });
    } else {
      persistAnnotations();
    }
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
  if (event.key === "Shift") setTextSelectionMode(true);

  const modifier = event.metaKey || event.ctrlKey;
  const editingNote = event.target.closest?.(".annotation-note");

  if (event.key === "Escape") {
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
  if (event.key === "Shift") setTextSelectionMode(false);
}

function setTextSelectionMode(enabled) {
  if (state.textSelectionMode === enabled) return;
  state.textSelectionMode = enabled;
  elements.viewer.classList.toggle("is-text-selection-mode", enabled);
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

    try {
      saveAnnotations(state.documentId, state.annotations);
    } catch (error) {
      console.error(error);
      showToast("Notes loaded, but the browser backup could not be updated.", 5000);
    }
    for (const view of state.pageViews) {
      updatePageDimensions(view);
      renderAnnotations(view);
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
    preferences: { noteFontSize: state.noteFontSize },
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
  elements.currentPage.disabled = !enabled;
  elements.notesButton.disabled = !enabled;
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
  state.sidecarGeneration += 1;
  clearTimeout(state.sidecarSaveTimer);
  state.sidecarSaveTimer = null;
  state.pageObserver?.disconnect();
  state.pageObserver = null;
  for (const view of state.pageViews) {
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
