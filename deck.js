(function () {
  'use strict';

  /* ======== slide shape is set in the main HTML file (window.RATIO). ======== */
  var RATIO = window.RATIO || '16:9';   // set in the main HTML file

  function showFatal(msg) {
    var d = document.createElement('div');
    d.id = 'load-error';
    d.setAttribute('style', 'position:fixed;left:0;right:0;top:0;padding:16px;background:#b00020;' +
      'color:#fff;font:16px/1.4 Arial,sans-serif;z-index:2147483647');
    d.textContent = msg;
    document.body.appendChild(d);
  }
  if (typeof remark === 'undefined') {
    showFatal('Presentation engine did not load. Check that vendor/remark-latest.min.js exists next to this file ' +
              '(and open the page through the same folder, not as a copied single file).');
    return;
  }

  /* ------------------------------------------------------------------ math
     remark runs Markdown over the slide text first, which would mangle things like x_1 or \\ in
     equations. So equations are cut out before remark sees the text (replaced by a safe token),
     and drawn with KaTeX afterwards. Code spans and fenced code blocks are left untouched. */
  var mathStore = [];
  function stash(tex, display) {
    mathStore.push({ tex: tex, display: display });
    return 'ZZMATHZZ' + (mathStore.length - 1) + 'ZZ';
  }
  // $...$ : opening $ not followed by space, closing $ not preceded by space and not followed by a digit/letter
  var INLINE = /(^|[^\\$\w])\$((?:\\[\s\S]|[^\s$\\])(?:(?:\\[\s\S]|[^$\\\n])*?(?:\\[\s\S]|[^\s$\\]))?)\$(?![\d\w])/g;
  function protectMath(src) {
    var parts = src.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m);   // odd entries are code
    for (var i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i]
        .replace(/\$\$([\s\S]+?)\$\$/g, function (m, tex) { return stash(tex, true); })
        .replace(INLINE, function (m, pre, tex) { return pre + stash(tex, false); });
    }
    return parts.join('');
  }

  function renderMath() {
    if (!mathStore.length || !document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeValue.indexOf('ZZMATHZZ') < 0) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode && n.parentNode.nodeName;
        return (p === 'TEXTAREA' || p === 'SCRIPT' || p === 'STYLE') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var text = node.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      var re = /ZZMATHZZ(\d+)ZZ/g;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var item = mathStore[+m[1]];
        var span = document.createElement('span');
        span.className = 'math-render' + (item && item.display ? ' display' : '');
        if (item) {
          var ok = false;
          if (window.katex) {
            try { window.katex.render(item.tex, span, { displayMode: item.display, throwOnError: false }); ok = true; }
            catch (e) { ok = false; }
          }
          if (!ok) span.textContent = (item.display ? '$$' : '$') + item.tex + (item.display ? '$$' : '$');   // KaTeX missing: show the source
        }
        frag.appendChild(span);
        last = re.lastIndex;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ---------------------------------------------------------------- images
     image(path/to/file.png) is shorthand for ![](path/to/file.png). Only paths ending in a picture
     extension are converted, and code spans / fenced code blocks are left untouched. */
  function expandImages(src) {
    var parts = src.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m);   // odd entries are code
    for (var i = 0; i < parts.length; i += 2) {
      // image(file.png)       -> normal picture
      // image(file.png, 0.6)  -> picture at 60% of the width of its container, aspect ratio kept
      parts[i] = parts[i].replace(/\bimage\(\s*([^()\s,]+?\.(?:png|jpe?g|gif|svg|webp|avif))\s*(?:,\s*(\d*\.?\d+)\s*)?\)/gi,
        function (m, path, frac) {
          if (frac === undefined) return '![](' + path + ')';
          return '<img src="' + path + '" style="width:' + (parseFloat(frac) * 100) + '%; max-height:none">';
        });
    }
    return parts.join('');
  }

  /* video(path/to/file.mp4) becomes a video player (same rules as image()). */
  function expandVideos(src) {
    var parts = src.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m);   // odd entries are code
    for (var i = 0; i < parts.length; i += 2) {
      // video(file.mp4)       -> normal player
      // video(file.mp4, 0.6)  -> player at 60% of the width of its container, aspect ratio kept
      parts[i] = parts[i].replace(/\bvideo\(\s*([^()\s,"'<>]+?\.(?:mp4|webm|ogv|ogg|m4v|mov))\s*(?:,\s*(\d*\.?\d+)\s*)?\)/gi,
        function (m, path, frac) {
          var style = frac === undefined ? '' : ' style="width:' + (parseFloat(frac) * 100) + '%; max-height:none"';
          return '<video controls preload="metadata" src="' + path + '"' + style + '></video>';
        });
    }
    return parts.join('');
  }

  /* ------------------------------------------------------------------ grid
     .grid[RxC ... ]  with cells separated by a line containing only ===  (R rows, C columns,
     filled row by row). Becomes .grid.g-R-C[ .cell[...] .cell[...] ... ] for remark; the row and
     column counts are applied as CSS variables by layoutGrids() once the slide is on screen. */
  function expandGrids(src) {
    return src.replace(/^\.grid\[(\d+)x(\d+)[ \t]*\n([\s\S]*?)\n\][ \t]*$/gm, function (m, r, c, body) {
      var cells = body.split(/^[ \t]*===[ \t]*$/m).map(function (t) {
        t = t.trim();
        var cls = '', tail;   /* trailing  |  = line on the right of the cell;  __  = line below it */
        while ((tail = /(\||__)$/.exec(t))) {
          cls += tail[1] === '|' ? '.vline' : '.hline';
          t = t.slice(0, -tail[1].length).replace(/\s+$/, '');
        }
        return '.cell' + cls + '[\n' + t + '\n]';
      });
      return '.grid.g-' + r + '-' + c + '[\n' + cells.join('\n') + '\n]';
    });
  }
  function layoutGrids() {
    var grids = document.querySelectorAll('.grid');
    for (var i = 0; i < grids.length; i++) {
      var m = /(?:^|\s)g-(\d+)-(\d+)(?:\s|$)/.exec(grids[i].className);
      if (!m) continue;
      grids[i].style.setProperty('--rows', m[1]);
      grids[i].style.setProperty('--cols', m[2]);
    }
  }

  /* ------------------------------------------------------------- start remark */
  var srcEl = document.getElementById('source');
  srcEl.style.display = 'none';
  var slideshow = window.slideshow = remark.create({ ratio: RATIO, source: protectMath(expandGrids(expandVideos(expandImages(srcEl.value)))) });

  /* -------------------------------------------------------- print page size
     Page size = slide size for the chosen ratio (read from the real slide, with the same
     arithmetic remark uses as a fallback). Done at load and again right before printing. */
  function slideSize() {
    var sc = document.querySelector('.remark-slide-container.remark-visible .remark-slide-scaler') ||
             document.querySelector('.remark-slide-scaler');
    var w = sc ? sc.offsetWidth : 0, h = sc ? sc.offsetHeight : 0;
    if (!(w > 0 && h > 0)) {
      var p = RATIO.split(':');
      h = 681;
      w = Math.floor(681 * parseFloat(p[0]) / parseFloat(p[1]));
    }
    return { w: w, h: h };
  }
  function applyPrintSize() {
    var s = slideSize();
    var st = document.getElementById('print-size');
    if (!st) { st = document.createElement('style'); st.id = 'print-size'; document.head.appendChild(st); }
    st.textContent = '@page{size:' + s.w + 'px ' + s.h + 'px;margin:0}' +
                     ':root{--slide-w:' + s.w + 'px;--slide-h:' + s.h + 'px}';
  }
  applyPrintSize();

  /* ------------------------------------------- draw math now and whenever slides are rebuilt */
  var scheduled = false, observer = null;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      renderMath(); layoutGrids();
      if (observer) observer.takeRecords();   // ignore the changes we just made
    }, 0);
  }
  renderMath(); layoutGrids();
  slideshow.on('afterShowSlide', schedule);
  if (window.MutationObserver) {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });   // presenter view / cloned windows rebuild slides
  }
  window.addEventListener('load', function () {
    renderMath(); layoutGrids(); applyPrintSize();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { renderMath(); applyPrintSize(); });
  });
  window.addEventListener('beforeprint', function () { renderMath(); layoutGrids(); applyPrintSize(); });

  /* ------------------------------------------------------------ preflight (?check)
     Steps through every slide and reports problems, then returns to slide 1. */
  function preflight() {
    var total = slideshow.getSlideCount(), problems = [], i = 0;
    function visibleContainer() {
      var all = document.querySelectorAll('.remark-slide-container.remark-visible');
      for (var k = 0; k < all.length; k++) if (!all[k].closest('.remark-preview-area, .remark-notes-area')) return all[k];
      return null;
    }
    function inspect(num) {
      var c = visibleContainer();
      if (!c) { problems.push('Slide ' + num + ': could not be displayed'); return; }
      var sc = c.querySelector('.remark-slide-scaler'), content = c.querySelector('.remark-slide-content');
      if (sc && content) {
        var over = content.offsetHeight - sc.offsetHeight, wide = content.scrollWidth - sc.offsetWidth;
        if (over > 1) problems.push('Slide ' + num + ': content is ' + Math.round(over) + 'px too tall (it is cut off)');
        if (wide > 1) problems.push('Slide ' + num + ': content is ' + Math.round(wide) + 'px too wide');
      }
      Array.prototype.forEach.call(c.querySelectorAll('img'), function (im) {
        if (!im.complete || im.naturalWidth === 0) problems.push('Slide ' + num + ': image not loading: ' + (im.getAttribute('src') || '?'));
      });
      Array.prototype.forEach.call(c.querySelectorAll('video'), function (v) {
        if (v.error || v.networkState === 3) problems.push('Slide ' + num + ': video not loading: ' + (v.currentSrc || v.getAttribute('src') || (v.querySelector('source') || {}).src || '?'));
      });
      if (c.querySelector('.katex-error')) problems.push('Slide ' + num + ': an equation has a LaTeX error (shown in red)');
      if ((c.textContent || '').indexOf('ZZMATHZZ') >= 0) problems.push('Slide ' + num + ': an equation was not drawn');
    }
    function step() {
      if (i >= total) return finish();
      i++;
      slideshow.gotoSlide(i);
      setTimeout(function () { renderMath(); setTimeout(function () { inspect(i); step(); }, 120); }, 80);
    }
    function finish() {
      slideshow.gotoSlide(1);
      var d = document.createElement('div');
      d.id = 'preflight';
      d.setAttribute('style', 'position:fixed;top:10px;left:10px;max-width:560px;max-height:80vh;overflow:auto;' +
        'background:#fff;color:#000;border:3px solid ' + (problems.length ? '#b00020' : '#1b7f2a') +
        ';border-radius:6px;padding:12px 16px;font:15px/1.45 Arial,sans-serif;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,.4)');
      var h = document.createElement('div');
      h.style.fontWeight = 'bold';
      h.textContent = problems.length ? ('Preflight: ' + problems.length + ' problem(s) in ' + total + ' slides')
                                      : ('Preflight: all ' + total + ' slides OK');
      d.appendChild(h);
      var ul = document.createElement('ul');
      ul.style.margin = '8px 0 8px 18px'; ul.style.padding = '0';
      problems.forEach(function (p) { var li = document.createElement('li'); li.textContent = p; ul.appendChild(li); });
      d.appendChild(ul);
      var note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:#555';
      note.textContent = 'Click this box or press Esc to close.';
      d.appendChild(note);
      function close() { if (d.parentNode) d.parentNode.removeChild(d); document.removeEventListener('keydown', onKey, true); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      d.addEventListener('click', close);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(d);
      if (window.console) console.log('Preflight:', problems.length ? problems : 'all slides OK');
    }
    step();
  }
  if (/[?&]check\b/.test(location.search)) window.addEventListener('load', function () { setTimeout(preflight, 400); });
})();
