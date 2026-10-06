# Pencil Reader

A small, local-first PDF reader built around a single interaction model:

- Click anywhere on a page to begin a visible note.
- Drag anywhere on a page to draw a straight line.
- Click an existing note to edit it.
- Right-click a note or line to delete it.
- Press `Cmd/Ctrl + Z` outside a note to undo the last annotation action.
- Use `A−`, `A+`, or enter a value from 6–24px to change the size of every note. The preference is remembered.
- Click the current page number, type a page from the displayed range, and press Enter to jump there.
- Open the `?` menu for a quick reminder of the annotation controls.

Notes and lines are saved in browser storage and keyed to the PDF's fingerprint. The original PDF is never modified or uploaded.

For a portable backup, open a PDF, open the **Notes** menu, and choose **Save notes file**. In browsers that support the File System Access API, choose a `.pencil.json` file once and subsequent changes will autosave to it for the rest of the session. **Load notes file** restores a sidecar and checks whether it belongs to the open PDF. Browsers without direct file-writing support download a new sidecar on each save instead.

## Run it

This MVP has no build step. From this directory, start a local server:

```sh
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

PDF.js is loaded from jsDelivr, so the first load requires an internet connection. PDFs and annotations remain local. A later desktop build can bundle PDF.js for fully offline use.

## Reader controls

- `Cmd/Ctrl + O`: open a PDF
- `Cmd/Ctrl + +` / `Cmd/Ctrl + -`: zoom
- `Cmd/Ctrl + 0`: reset zoom
- `Escape`: finish editing a note

PDF pages render lazily as they approach the viewport, keeping long books from filling memory with every page at once.
