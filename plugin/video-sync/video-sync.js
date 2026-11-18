/*
 * Video sync for remark.js: play / pause / seek / speed on a <video> in one window
 * (e.g. presenter view) is mirrored to the same video in the other windows of the
 * same deck (e.g. the cloned audience window).
 *
 * Videos are matched by their order in the page. Videos inside the presenter-view
 * "next slide" preview and notes panels are ignored.
 * Volume / mute are deliberately NOT synced (you probably want sound from one window only).
 *
 * Browser autoplay rules: a window that has never been clicked may refuse to start
 * a video with sound. In that case the video is started muted; click once anywhere
 * in that window (and unmute the video) to get sound.
 */
(function (doc, win) {
	"use strict"
	if (win.__videoSyncLoaded) return
	win.__videoSyncLoaded = true

	let bc = null
	try { bc = new BroadcastChannel('slides-video-sync:' + win.location.origin + win.location.pathname) } catch (err) { return }

	const sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
	const SUPPRESS_MS = 1000     // ignore local events this long after applying a remote change (prevents echo loops)
	const HEARTBEAT_MS = 2000    // the window that last controlled a video re-sends its time while playing
	const SEEK_TOLERANCE_S = 0.3 // only jump if the two windows differ by more than this

	const suppressUntil = new WeakMap()
	const leader = new Set()     // indices of videos this window last controlled

	function syncedVideos() {
		return Array.from(doc.querySelectorAll('video'))
			.filter(function (v) { return !v.closest('.remark-preview-area, .remark-notes-area') })
	}

	function state(v, idx, type) {
		return { v: 1, sid: sid, type: type, idx: idx, paused: v.paused, time: v.currentTime, rate: v.playbackRate }
	}

	function send(v, type) {
		const idx = syncedVideos().indexOf(v)
		if (idx < 0) return
		leader.add(idx)
		try { bc.postMessage(state(v, idx, type)) } catch (err) {}
	}

	function onLocal(e) {
		const v = e.target
		if (!v || v.tagName !== 'VIDEO') return
		if ((suppressUntil.get(v) || 0) > Date.now()) return   // caused by a remote change
		send(v, e.type)
	}

	// media events don't bubble, but they can be caught in the capture phase
	;['play', 'pause', 'seeked', 'ratechange'].forEach(function (t) {
		doc.addEventListener(t, onLocal, true)
	})

	function apply(v, m) {
		suppressUntil.set(v, Date.now() + SUPPRESS_MS)
		const tol = m.paused ? 0.05 : SEEK_TOLERANCE_S
		if (isFinite(m.time) && Math.abs(v.currentTime - m.time) > tol) v.currentTime = m.time
		if (m.rate > 0 && v.playbackRate !== m.rate) v.playbackRate = m.rate
		if (m.paused && !v.paused) {
			v.pause()
		} else if (!m.paused && v.paused) {
			const p = v.play()
			if (p && p.catch) p.catch(function () {
				// autoplay with sound blocked in this window: play silently instead
				v.muted = true
				const p2 = v.play()
				if (p2 && p2.catch) p2.catch(function () {})
				console.warn('video-sync: autoplay with sound was blocked here; started muted. Click once in this window to allow sound.')
			})
		}
	}

	bc.onmessage = function (ev) {
		const m = ev && ev.data
		if (!m || m.v !== 1 || m.sid === sid || typeof m.idx !== 'number') return
		if (typeof m.paused !== 'boolean' || typeof m.time !== 'number') return
		const v = syncedVideos()[m.idx]
		if (!v) return
		leader.delete(m.idx)   // the other window is in charge now
		apply(v, m)
	}

	// the controlling window keeps the others from drifting (buffering, stalls...)
	setInterval(function () {
		const vids = syncedVideos()
		leader.forEach(function (idx) {
			const v = vids[idx]
			if (v && !v.paused) {
				try { bc.postMessage(state(v, idx, 'tick')) } catch (err) {}
			}
		})
	}, HEARTBEAT_MS)
})(document, window)
