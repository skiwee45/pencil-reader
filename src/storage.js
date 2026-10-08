const STORAGE_PREFIX = "pencil-reader:annotations:v1:";
const DOCUMENT_VIEW_PREFIX = "pencil-reader:view:v1:";
const PREFERENCES_KEY = "pencil-reader:preferences:v1";

export const DEFAULT_PREFERENCES = Object.freeze({ noteFontSize: 16 });

export function loadPreferences(storage = window.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_KEY));
    const noteFontSize = parsed?.noteFontSize;
    if (Number.isInteger(noteFontSize)) {
      return { noteFontSize: Math.min(24, Math.max(6, noteFontSize)) };
    }
  } catch {
    // Fall through to defaults if storage is unavailable or malformed.
  }

  return { ...DEFAULT_PREFERENCES };
}

export function savePreferences(preferences, storage = window.localStorage) {
  storage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({ noteFontSize: preferences.noteFontSize }),
  );
}

export function loadAnnotations(documentId, storage = window.localStorage) {
  if (!documentId) return new Map();

  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${documentId}`);
    if (!raw) return new Map();

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.pages !== "object") {
      return new Map();
    }

    return deserializeAnnotationPages(parsed.pages);
  } catch {
    return new Map();
  }
}

export function saveAnnotations(documentId, pages, storage = window.localStorage) {
  if (!documentId) return;

  storage.setItem(
    `${STORAGE_PREFIX}${documentId}`,
    JSON.stringify({ version: 1, pages: serializeAnnotationPages(pages) }),
  );
}

export function loadDocumentView(documentId, storage = window.localStorage) {
  if (!documentId) return { rotation: 0 };

  try {
    const parsed = JSON.parse(storage.getItem(`${DOCUMENT_VIEW_PREFIX}${documentId}`));
    if (isValidRotation(parsed?.rotation)) return { rotation: parsed.rotation };
  } catch {
    // Fall through to the unrotated default.
  }

  return { rotation: 0 };
}

export function saveDocumentView(documentId, view, storage = window.localStorage) {
  if (!documentId) return;
  const rotation = isValidRotation(view?.rotation) ? view.rotation : 0;
  storage.setItem(`${DOCUMENT_VIEW_PREFIX}${documentId}`, JSON.stringify({ rotation }));
}

export function serializeAnnotationPages(pages) {
  const serializedPages = {};
  for (const [pageNumber, annotations] of pages) {
    const saved = annotations
      .filter((annotation) => annotation.persisted !== false)
      .filter((annotation) => annotation.type !== "note" || annotation.text.length > 0)
      .map(stripRuntimeFields);

    if (saved.length) serializedPages[pageNumber] = saved;
  }
  return serializedPages;
}

export function deserializeAnnotationPages(rawPages) {
  const pages = new Map();
  if (!rawPages || typeof rawPages !== "object" || Array.isArray(rawPages)) return pages;

  for (const [pageNumber, annotations] of Object.entries(rawPages)) {
    const safePageNumber = Number(pageNumber);
    if (!Number.isInteger(safePageNumber) || safePageNumber < 1 || !Array.isArray(annotations)) {
      continue;
    }

    const valid = annotations.filter(isValidAnnotation).map((annotation) => ({
      ...stripRuntimeFields(annotation),
      persisted: true,
    }));

    if (valid.length) pages.set(safePageNumber, valid);
  }
  return pages;
}

export function cloneAnnotation(annotation) {
  return stripRuntimeFields(annotation);
}

function stripRuntimeFields(annotation) {
  if (annotation.type === "line") {
    return {
      id: annotation.id,
      type: "line",
      x1: annotation.x1,
      y1: annotation.y1,
      x2: annotation.x2,
      y2: annotation.y2,
    };
  }

  const stripped = {
    id: annotation.id,
    type: "note",
    x: annotation.x,
    y: annotation.y,
    text: annotation.text,
    rotation: isValidRotation(annotation.rotation) ? annotation.rotation : 0,
  };
  if (isValidNoteFontSize(annotation.fontSize)) stripped.fontSize = annotation.fontSize;
  return stripped;
}

function isValidAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object" || typeof annotation.id !== "string") {
    return false;
  }

  if (annotation.type === "line") {
    return [annotation.x1, annotation.y1, annotation.x2, annotation.y2].every(isNormalizedNumber);
  }

  if (annotation.type === "note") {
    return (
      isNormalizedNumber(annotation.x) &&
      isNormalizedNumber(annotation.y) &&
      typeof annotation.text === "string" &&
      (annotation.rotation === undefined || isValidRotation(annotation.rotation)) &&
      (annotation.fontSize === undefined || isValidNoteFontSize(annotation.fontSize))
    );
  }

  return false;
}

function isNormalizedNumber(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidRotation(value) {
  return Number.isInteger(value) && value >= 0 && value < 360 && value % 90 === 0;
}

function isValidNoteFontSize(value) {
  return Number.isInteger(value) && value >= 6 && value <= 24;
}
