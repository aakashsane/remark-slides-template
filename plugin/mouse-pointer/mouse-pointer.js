/*
 * Laser pointer for remark.js (and reveal.js).
 *
 * Toggle:  press "L"  or  CapsLock   (Ctrl/Alt/Cmd+L are ignored on purpose)
 * Sync:    the window where the pointer is ON broadcasts its position (as a
 *          fraction of the slide) to every other window of the SAME deck
 *          (e.g. presenter view -> audience view).
 *
 * Notes / limitations:
 *  - Mouse moves over <iframe>s are not reported by browsers, so the pointer
 *    freezes while the cursor is over an embedded iframe.
 *  - If CapsLock is already on when the page loads, press it twice.
 *    "L" always works as a plain toggle.
 */
(function (doc, win) {
	"use strict"

	// Guard against the script being included twice (would double all listeners)
	if (win.__laserPointerLoaded) return
	win.__laserPointerLoaded = true

	const HEARTBEAT_MS = 500           // sender re-sends its position this often while visible
	const STALE_MS = 2500              // receiver hides the dot if nothing arrives for this long
	const STORAGE_MIN_INTERVAL_MS = 33 // throttle for the localStorage fallback path
	const DOT_CLASS = 'laser-pointer-dot'
	const ON_CLASS = 'laser-pointer-on'

	// One channel per deck (origin + path) so two different decks open at once
	// never draw each other's pointer.
	const channelName = 'slides-laser-pointer:' + win.location.origin + win.location.pathname
	const storageKey = channelName
	let bc = null
	try { bc = new BroadcastChannel(channelName) } catch (err) { bc = null }

	// Unique id of this window, used to ignore our own messages and order others'
	const sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
	let seq = 0
	const lastSeqSeen = {}

	let enabled = false          // is the pointer ON in THIS window (this window drives it)
	let lastMouse = null         // last known cursor position {x, y}
	let pointerInside = true     // false once the mouse leaves the browser window
	let rafPending = false
	let lastSentHidden = true    // what receivers currently believe
	let lastStorageWrite = 0
	let heartbeatTimer = null
	let staleTimer = null
	let lastRemote = null        // last pointer position received {xPct, yPct, key}
	let dot = null

	function clamp01(v) { return Math.max(0, Math.min(1, v)) }

	// ---------------------------------------------------------------- slides

	function validRect(r) { return r && r.width > 0 && r.height > 0 }

	/*
	 * Geometry of the slide the audience is looking at in THIS window:
	 *   { rect: DOMRect, key: 'remark:3' | 'reveal:h:v' | null }
	 * Slides in presenter-view preview / notes panels are ignored.
	 * Returns null if no visible slide can be found.
	 */
	function getSlideGeometry() {
		// reveal.js
		try {
			if (win.Reveal && typeof win.Reveal.getIndices === 'function') {
				const present = doc.querySelector('.reveal .slides section.present')
				if (present) {
					const r = present.getBoundingClientRect()
					if (validRect(r)) {
						const idx = win.Reveal.getIndices()
						return { rect: r, key: 'reveal:' + (idx.h || 0) + ':' + (idx.v || 0) }
					}
				}
			}
		} catch (err) {}
		// remark.js
		try {
			const all = Array.from(doc.querySelectorAll('.remark-slide-container'))
				.filter(function (c) { return !c.closest('.remark-preview-area, .remark-notes-area') })
			const visible = all.find(function (c) { return c.classList.contains('remark-visible') })
			if (visible) {
				// the scaler is the actual (letterboxed, scaled) slide rectangle
				const target = visible.querySelector('.remark-slide-scaler') || visible
				const r = target.getBoundingClientRect()
				if (validRect(r)) return { rect: r, key: 'remark:' + all.indexOf(visible) }
			}
		} catch (err) {}
		return null
	}

	// ------------------------------------------------------------------ dot

	function showDotAt(x, y) {
		if (!isFinite(x) || !isFinite(y)) return
		dot.style.transform = 'translate(' + x + 'px,' + y + 'px)'
		dot.style.display = 'block'
	}

	function hideDot() { dot.style.display = 'none' }

	// -------------------------------------------------------------- sending

	function post(msg) {
		msg.v = 1
		msg.sid = sid
		msg.seq = ++seq
		msg.ts = Date.now()
		if (bc) {
			try { bc.postMessage(msg); return } catch (err) { /* fall through to storage */ }
		}
		// localStorage fallback (same-origin tabs). Throttle position spam.
		const now = (win.performance && performance.now) ? performance.now() : Date.now()
		if (msg.type === 'pos' && now - lastStorageWrite < STORAGE_MIN_INTERVAL_MS) return
		lastStorageWrite = now
		try { localStorage.setItem(storageKey, JSON.stringify(msg)) } catch (err) {}
	}

	function sendHide(force) {
		if (lastSentHidden && !force) return
		lastSentHidden = true
		post({ type: 'hide' })
	}

	function sendPos(xPct, yPct, key) {
		lastSentHidden = false
		post({ type: 'pos', xPct: xPct, yPct: yPct, key: key })
	}

	// Runs at most once per animation frame, however fast the mouse reports
	function scheduleUpdate() {
		if (rafPending) return
		rafPending = true
		win.requestAnimationFrame(updateLocal)
	}

	function updateLocal() {
		rafPending = false
		if (!enabled) return
		if (!lastMouse || !pointerInside) { hideDot(); sendHide(); return }
		const g = getSlideGeometry()
		const x = lastMouse.x
		const y = lastMouse.y
		// Cursor not over the slide (letterbox, notes panel, preview...): no pointer
		if (!g || x < g.rect.left || x > g.rect.right || y < g.rect.top || y > g.rect.bottom) {
			hideDot(); sendHide(); return
		}
		showDotAt(x, y)
		sendPos(
			clamp01((x - g.rect.left) / g.rect.width),
			clamp01((y - g.rect.top) / g.rect.height),
			g.key
		)
	}

	// ------------------------------------------------------------ receiving

	function onMessage(d) {
		if (!d || typeof d !== 'object' || d.v !== 1) return
		if (typeof d.sid !== 'string' || d.sid === sid) return
		if (typeof d.seq !== 'number') return
		// drop duplicates / out-of-order messages from the same sender
		if (lastSeqSeen[d.sid] !== undefined && d.seq <= lastSeqSeen[d.sid]) return
		lastSeqSeen[d.sid] = d.seq
		// If the user is driving the pointer in this window, ignore remote ones
		if (enabled) return

		if (d.type === 'pos') {
			if (typeof d.xPct !== 'number' || typeof d.yPct !== 'number') return
			if (!isFinite(d.xPct) || !isFinite(d.yPct)) return
			lastRemote = {
				xPct: clamp01(d.xPct),
				yPct: clamp01(d.yPct),
				key: (typeof d.key === 'string') ? d.key : null
			}
			renderRemote()
			// no news for a while (sender closed, crashed, message lost) -> hide
			clearTimeout(staleTimer)
			staleTimer = setTimeout(function () { lastRemote = null; hideDot() }, STALE_MS)
		} else if (d.type === 'hide') {
			lastRemote = null
			clearTimeout(staleTimer)
			hideDot()
		}
	}

	function renderRemote() {
		if (enabled) return
		if (!lastRemote) { hideDot(); return }
		const g = getSlideGeometry()
		if (!g) { hideDot(); return }
		// Sender is on a different slide than we are showing (e.g. sync lag): don't
		// draw it at the wrong place. It reappears once both windows agree.
		if (lastRemote.key && g.key && lastRemote.key !== g.key) { hideDot(); return }
		showDotAt(g.rect.left + lastRemote.xPct * g.rect.width,
		          g.rect.top + lastRemote.yPct * g.rect.height)
	}

	// --------------------------------------------------------------- toggle

	function setEnabled(v) {
		v = !!v
		if (v === enabled) return
		enabled = v
		const root = doc.documentElement
		if (enabled) {
			root.classList.add(ON_CLASS)
			// we drive the pointer now: forget any remote one
			lastRemote = null
			clearTimeout(staleTimer)
			hideDot()
			heartbeatTimer = setInterval(scheduleUpdate, HEARTBEAT_MS)
			scheduleUpdate()   // shows at last known cursor position (nothing until the mouse has moved)
		} else {
			root.classList.remove(ON_CLASS)
			clearInterval(heartbeatTimer)
			heartbeatTimer = null
			hideDot()
			sendHide(true)
		}
	}

	function isTypingTarget(t) {
		return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
	}

	// CapsLock: use the real lock state on both keydown and keyup. This works on
	// platforms that fire keydown for on+off (Windows/Linux) and on those that fire
	// keydown only for "on" and keyup only for "off" (macOS).
	function syncCapsLock(e) {
		if (typeof e.getModifierState === 'function') setEnabled(e.getModifierState('CapsLock'))
		else if (e.type === 'keydown') setEnabled(!enabled)
	}

	function isCapsLock(e) { return e.key === 'CapsLock' || e.code === 'CapsLock' }

	function setKeyboards() {
		doc.addEventListener('keydown', function (e) {
			if (isCapsLock(e)) { syncCapsLock(e); return }
			if (e.key && e.key.toLowerCase() === 'l'
				&& !e.ctrlKey && !e.metaKey && !e.altKey   // keep Ctrl+L (URL bar) etc. intact
				&& !e.repeat                               // holding the key must not flicker
				&& !isTypingTarget(e.target)) {
				e.preventDefault()
				setEnabled(!enabled)
			}
		}, false)
		doc.addEventListener('keyup', function (e) {
			if (isCapsLock(e)) syncCapsLock(e)
		}, false)
	}

	// ----------------------------------------------------------------- init

	function initModule() {
		// styles: dot, hidden system cursor while active, never printed
		const style = doc.createElement('style')
		style.textContent =
			'.' + DOT_CLASS + '{position:fixed;left:0;top:0;width:10px;height:10px;margin:-5px 0 0 -5px;' +
			'border-radius:50%;background:rgba(255,0,0,0.85);z-index:2147483647;display:none;' +
			'pointer-events:none;will-change:transform}' +
			'html.' + ON_CLASS + ',html.' + ON_CLASS + ' *{cursor:none !important}' +
			'@media print{.' + DOT_CLASS + '{display:none !important}}'
		;(doc.head || doc.documentElement).appendChild(style)

		dot = doc.createElement('div')
		dot.className = DOT_CLASS
		doc.body.appendChild(dot)

		// remote messages
		if (bc) bc.onmessage = function (ev) { onMessage(ev && ev.data) }
		win.addEventListener('storage', function (ev) {
			if (ev.key !== storageKey || !ev.newValue) return
			try { onMessage(JSON.parse(ev.newValue)) } catch (err) {}
		})

		// local mouse / pen / touch
		doc.addEventListener('pointermove', function (e) {
			lastMouse = { x: e.clientX, y: e.clientY }
			pointerInside = true
			if (enabled) scheduleUpdate()
		}, { passive: true })
		doc.documentElement.addEventListener('mouseleave', function () {
			pointerInside = false
			if (enabled) scheduleUpdate()
		})

		// keep a remote pointer correct when the layout or slide changes
		win.addEventListener('resize', function () { if (lastRemote) renderRemote(); if (enabled) scheduleUpdate() })
		win.addEventListener('hashchange', function () { if (lastRemote) renderRemote() })
		const area = doc.querySelector('.remark-slides-area')
		if (area && win.MutationObserver) {
			new MutationObserver(function () { if (lastRemote) renderRemote() })
				.observe(area, { attributes: true, attributeFilter: ['class'], subtree: true })
		}

		// tell the others to hide if this window goes away while pointing
		win.addEventListener('pagehide', function () { if (enabled) sendHide(true) })

		setKeyboards()
		if (win.Reveal && typeof win.Reveal.registerKeyboardShortcut === 'function') {
			try { win.Reveal.registerKeyboardShortcut('L', 'Toggle Laser Pointer') } catch (err) {}
		}
	}

	if (doc.body) initModule()
	else doc.addEventListener('DOMContentLoaded', initModule)
})(document, window)
