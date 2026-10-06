# Pencil Reader

[Try it here
](https://skiwee45.github.io/pencil-reader/)

- Click to begin a note.
- Drag to draw a line.
- Click an existing note to edit it.
- Right-click a note or line to delete it.
- `Cmd/Ctrl + Z` to undo the last action.

Saves notes in separate file, doesn't edit pdfs.

## Run it

This MVP has no build step. From this directory, start a local server:

```sh
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

PDF.js is loaded from jsDelivr, so the first load requires an internet connection. PDFs and annotations remain local. A later desktop build can bundle PDF.js for fully offline use.

## More controls
- Annotation text size is editable, the preference is remembered.
- Can jump to any page.
- Help `?` menu to see annotation controls.
- `Cmd/Ctrl + O`: open a PDF
- `Cmd/Ctrl + +` / `Cmd/Ctrl + -`: zoom
- `Cmd/Ctrl + 0`: reset zoom
- `Escape`: finish editing a note

PDF pages render lazily as they approach the viewport, keeping long books from filling memory with every page at once.
