# remark-slides-template

A simple template for making slide presentations in the browser with [remark](https://github.com/gnab/remark).
You write plain text; you get slides with images, videos, equations, grids, speaker notes and a laser pointer.
It works **offline in any browser**, and the whole folder can be uploaded to a personal website.

## Quick start

1. Download this folder (Code → Download ZIP, or "Use this template" on GitHub).
2. Open `example_slide.html` in a browser to see the example talk.
3. Open `example_slide.html` in a text editor and change the text between the `<textarea>` tags. Save and reload.

That's it. Nothing to install.

## Cheat sheet

| You want | You write |
|---|---|
| New slide | a line with `---` |
| Heading | `# Heading` |
| Bullet | `- text` |
| Picture | `image(images/file.png)` |
| Picture at half width | `image(images/file.png, 0.5)` |
| Video | `video(videos/file.mp4)` (also `video(videos/file.mp4, 0.5)`) |
| Equation | `$$ ... $$` (displayed) or `$ ... $` (inline), LaTeX syntax |
| Grid | `.grid[2x2 ... ]`, cells separated by a line `===` |
| Line right of a grid cell / below it | end the cell with `\|` / `__` |
| Speaker notes | a line `???`, notes go below it |

A single line break inside a paragraph does not start a new line: leave a blank line, or end the line with two spaces.
Never put a line starting with `---` or `???` inside a code block.

## While presenting

| Key | Action |
|---|---|
| Left / Right arrows, Space | previous / next slide |
| **C** | clone the presentation in a new window (drag it to the projector) |
| **P** | presenter mode: notes, timer, next slide |
| **L** (or CapsLock) | laser pointer on/off |
| **F** | full screen |
| **H** or **?** | all shortcuts |

The laser pointer and presenter view talk between windows, which some browsers only allow when the folder is served over HTTP.
If they don't sync when opening `example_slide.html` directly, run `python3 -m http.server 8000` in this folder and open `http://localhost:8000/example_slide.html`.

## Before a talk

- Open `example_slide.html?check` to step through every slide and list overflowing content, broken images/videos and math errors.
- To make a PDF: print the page (Ctrl+P), destination *Save as PDF*, margins *None*, scale *100%*.

## Customizing

Everything about the look is in `deck.css`, with a comment next to each setting: font and heading sizes, title-slide layout,
logo size, picture height, grid height and lines, colours. The slide shape (`16:9`, `4:3`, ...) is set by `window.RATIO` at the bottom of `example_slide.html`.

## Folder contents

- `example_slide.html`: your slides (edit this)
- `deck.css`: look and layout (edit to taste)
- `deck.js`: the `image()`, `video()`, grid, equation and check features (no need to edit)
- `images/`, `videos/`: put your pictures and videos here (the logos are placeholders; replace them)
- `plugin/`: laser pointer and video sync
- `vendor/`: bundled copies of remark, KaTeX and the font, so everything works offline

## Credits and licenses

This template (`deck.css`, `deck.js`, `plugin/`, `example_slide.html`) is MIT licensed, see `LICENSE`.
It bundles, unmodified, in `vendor/`:

- [remark](https://github.com/gnab/remark), MIT (`vendor/licenses/remark-LICENSE.txt`)
- [KaTeX](https://katex.org), MIT (`vendor/licenses/katex-LICENSE.txt`)
- Google Sans Flex font, SIL Open Font License 1.1 (`vendor/licenses/google-sans-flex-OFL.txt`)
