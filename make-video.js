/* HTR Studio - Make Video
   Lyric videos rendered right in the browser (Chrome / Edge, any computer - no FFmpeg, no render agent).
   Flow: Song -> (optional) folder -> backgrounds -> lyric look -> Make Video.
   Lyrics come from data/lyrics/{song}-timestamps.txt (the Lyric Timestamps tab).
   Per-song setup (look, backgrounds, end card) saves to data/video-projects/{song}.json. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const B = () => window.HTRBridge || {};
  const toast = (m, e) => (B().toast ? B().toast(m, e) : alert(m));
  const P = (p) => '/repos/' + B().OWNER + '/' + B().REPO + '/contents/' + p;

  const FONTS = ['Bebas Neue', 'Anton', 'Archivo Black', 'Alfa Slab One', 'Fjalla One', 'Oswald', 'Montserrat', 'Poppins', 'Kanit', 'Teko', 'Barlow Condensed', 'Bungee', 'Luckiest Guy', 'Inter'];
  const HEAVY = ['Montserrat', 'Poppins', 'Inter', 'Oswald', 'Barlow Condensed', 'Teko', 'Kanit'];
  const TIGHT = ['Bebas Neue', 'Anton', 'Teko'];
  const ANIMS = [['appear', 'Word-appear (pop)'], ['floatup', 'Word-appear (float up)'], ['slidein', 'Word-appear (slide in)'], ['karaoke', 'Karaoke highlight'], ['pop', 'Whole-line pop']];
  const SIZES = { '16': [1920, 1080], '9': [1080, 1920] };
  const PREVIEW_SCALE = 0.5;
  const MEDIA = /\.(mp3|wav|m4a|mp4|mov|webm|m4v|png|jpe?g)$/i;
  const OUTPUT = /-(16x9|9x16)(-test)?\.(mp4|webm)$/i; // our own renders - never offered as backgrounds
  const AUDIO_EXT = /\.(mp3|wav|m4a)$/i;
  const DEF = {
    anim: 'appear', font: 'Bebas Neue', text: '#ffffff', hi: '#e6bd52', out: '#101010', size: 5.5, stressSize: 1.5, ow: 6,
    upper: true, ori: 'h', vRows: 1, align: 'center', posX: 50, posY: 80, offset: 0, maxHold: 10,
    crossfade: 1, transition: 'dissolve', endFade: 4, kenburns: true, linePos: {}, lineSize: {}, stress: {}
  };
  const SLIDERS = {
    crossfade: ['Transition length', 0, 4, 0.1, (v) => v.toFixed(1) + 's'],
    endFade: ['End card fades in over the last', 1, 12, 0.5, (v) => v + 's'],
    size: ['Caption size', 2.5, 14, 0.1, (v) => v.toFixed(1)],
    stressSize: ['Stressed word size', 1, 2.6, 0.1, (v) => v.toFixed(1) + '\u00d7'],
    posX: ['Horizontal', 2, 98, 0.5, (v) => Math.round(v) + '%'],
    posY: ['Vertical', 2, 98, 0.5, (v) => Math.round(v) + '%'],
    vRows: ['Words per row (vertical layout)', 1, 4, 1, (v) => String(v)],
    ow: ['Outline width', 0, 14, 1, (v) => v + 'px'],
    offset: ['Timing nudge (+ = lyrics earlier)', -1, 1.5, 0.02, (v) => (v > 0 ? '+' : '') + v.toFixed(2) + 's'],
    maxHold: ['Longest a line stays up', 3, 30, 0.5, (v) => v + 's']
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const easeOut = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const easeBack = (p) => { const c = 1.7; p = clamp(p, 0, 1) - 1; return 1 + (c + 1) * p * p * p + c * p * p; };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function fmtT(s) { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }
  function fmtS(s) { s = Math.floor(Math.max(0, s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function parseT(v) { v = String(v || '').trim(); if (!v) return null; if (v.indexOf(':') >= 0) { const a = v.split(':'); const n = (+a[0]) * 60 + parseFloat(a[1]); return isNaN(n) ? null : n; } const n = parseFloat(v); return isNaN(n) ? null : n; }
  // Dropbox share link -> direct, browser-readable file (dl.dropboxusercontent.com sends CORS headers; www.dropbox.com doesn't)
  function dbx(u) {
    u = (u || '').trim(); if (!u) return '';
    try {
      const x = new URL(u);
      if (/(^|\.)dropbox\.com$/i.test(x.hostname)) x.hostname = 'dl.dropboxusercontent.com';
      if (/dropboxusercontent\.com$/i.test(x.hostname)) { x.searchParams.delete('dl'); x.searchParams.set('raw', '1'); }
      return x.toString();
    } catch (e) { return u; }
  }
  function nameOf(u) { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()) || u; } catch (e) { return u; } }
  function kindOf(n) { return /\.(mp4|mov|webm|m4v)$/i.test(n || '') ? 'video' : 'image'; }

  // ---------- state ----------
  const S = {
    songs: null, song: null, lines: [], total: 0, cfg: clone(DEF), bg: { '16': [], '9': [] }, end: { '16': null, '9': null },
    fmt: '16', move: 'all', pick: -1, shown: -1, dir: null, dirFiles: [], lyricsOn: true, out: '16', rec: null, dirty: false,
    hits: [], block: null, drag: null, seeking: false, audioName: '', ev: [], sel: null, tsDirty: false, tsHist: [], hooks: []
  };
  const audio = new Audio(); audio.crossOrigin = 'anonymous'; audio.preload = 'auto';
  let AC = null, monGain = null, mdest = null, cv = null, cx = null, built = false;

  // ---------- timestamps -> lyric lines ----------
  // file format: "M:SS.s<TAB>text" per line; [brackets] are section markers / [gap]s that end the caption before them
  let _uid = 0;
  const isMarker = (tx) => /^\[.*\]$/.test(tx);
  function parseEvents(text) {
    const ev = [];
    text.split(/\r?\n/).forEach((ln) => {
      const m = ln.match(/^\s*(\d+):(\d{2}(?:\.\d+)?)\s+(.+)$/); if (!m) return;
      const tx = m[3].trim();
      ev.push({ id: ++_uid, t: +m[1] * 60 + parseFloat(m[2]), text: tx, marker: isMarker(tx) });
    });
    return ev.sort((a, b) => a.t - b.t);
  }
  function buildLines(text) { return deriveLines(parseEvents(text)); }
  function deriveLines(ev) {
    ev = ev.slice().sort((a, b) => a.t - b.t);
    const seen = {}, out = [];
    ev.forEach((e, i) => {
      if (e.marker) return;
      const nx = ev.slice(i + 1).find((x) => x.t > e.t);
      const end = nx ? nx.t : e.t + 6;
      seen[e.text] = (seen[e.text] || 0) + 1;
      const toks = e.text.split(/\s+/).filter(Boolean);
      const real = toks.filter((w) => w !== '/' && w !== '|').length || 1;
      const gap = Math.min(((end - e.t) * 0.7) / real, 0.32);
      let k = 0;
      const words = toks.map((w) => (w === '/' || w === '|') ? { br: true } : { w: w, at: e.t + (k++) * gap });
      out.push({ key: e.text + '#' + seen[e.text], evId: e.id, start: e.t, end: end, text: e.text, words: words });
    });
    return out;
  }
  function lineAt(t) {
    let idx = -1;
    for (let i = 0; i < S.lines.length; i++) { if (S.lines[i].start <= t) idx = i; else break; }
    if (idx < 0) return -1;
    const L = S.lines[idx];
    return t < Math.min(L.end, L.start + S.cfg.maxHold) ? idx : -1;
  }

  // ---------- backgrounds ----------
  function snapThumb(el) {
    try {
      const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight; if (!iw) return '';
      const c = document.createElement('canvas'); c.width = 88; c.height = 88;
      const s = Math.max(88 / iw, 88 / ih); c.getContext('2d').drawImage(el, (88 - iw * s) / 2, (88 - ih * s) / 2, iw * s, ih * s);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  }
  function mount(it) {
    if (!it.url || (it.el && it.el._u === it.url)) return;
    it.ready = false; it.err = false;
    if (it.kind === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      v.onloadeddata = () => { it.ready = true; it.thumb = snapThumb(v); renderBg(); renderEnd(); };
      v.onerror = () => { it.err = true; renderBg(); renderEnd(); };
      v.src = it.url; v._u = it.url; it.el = v;
    } else {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { it.ready = true; it.thumb = snapThumb(im); renderBg(); renderEnd(); };
      im.onerror = () => { it.err = true; renderBg(); renderEnd(); };
      im.src = it.url; im._u = it.url; it.el = im;
    }
  }
  function itemFrom(x) {
    const it = { name: x.name || nameOf(x.src || ''), src: x.src || null, kind: x.kind || kindOf(x.name || nameOf(x.src || '')), start: x.start == null ? null : +x.start, url: x.src ? dbx(x.src) : null };
    mount(it); return it;
  }
  function allItems() { return [].concat(S.bg['16'], S.bg['9'], [S.end['16'], S.end['9']].filter(Boolean)); }
  // manual start times are pins; blanks spread evenly between them (same rule the old FFmpeg renderer used)
  function segsFor(list, total) {
    const n = list.length; if (!n || !total) return [];
    const st = list.map((b) => (b.start == null ? null : +b.start));
    if (st.every((s) => s == null)) return list.map((b, i) => ({ s: i * total / n, e: (i + 1) * total / n, b: b }));
    if (st[0] == null) st[0] = 0;
    for (let i = 0; i < n;) {
      if (st[i] != null) { i++; continue; }
      let j = i; while (j < n && st[j] == null) j++;
      const a = st[i - 1], z = j < n ? st[j] : total, step = (z - a) / (j - i + 1);
      for (let k = i; k < j; k++) st[k] = a + step * (k - i + 1);
      i = j;
    }
    const segs = list.map((b, i) => ({ s: clamp(st[i], 0, total), b: b })).sort((a, b) => a.s - b.s);
    segs.forEach((g, i) => { g.e = i + 1 < segs.length ? segs[i + 1].s : total; });
    return segs;
  }
  function coverDraw(ctx, el, W, H, alpha, zoom) {
    const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight;
    if (!iw || !ih || alpha <= 0) return;
    const sc = Math.max(W / iw, H / ih) * (zoom || 1), dw = iw * sc, dh = ih * sc;
    ctx.globalAlpha = alpha; ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.globalAlpha = 1;
  }
  function drawSeg(ctx, g, W, H, alpha, t, idx) {
    const b = g.b; if (!b.el || !b.ready) return;
    let z = 1;
    if (b.kind === 'image' && S.cfg.kenburns) {
      const p = clamp((t - g.s) / Math.max(1, g.e - g.s), 0, 1);
      z = idx % 2 === 0 ? 1 + 0.08 * p : 1.08 - 0.08 * p;
    }
    coverDraw(ctx, b.el, W, H, alpha, z);
  }
  function drawBackground(ctx, fmt, t, W, H) {
    ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const sg = segsFor(S.bg[fmt], S.total); if (!sg.length) return;
    const xf = S.cfg.crossfade;
    for (let k = 1; k < sg.length && xf > 0; k++) {
      const bk = sg[k].s;
      if (t >= bk - xf / 2 && t < bk + xf / 2) {
        const p = (t - (bk - xf / 2)) / xf;
        if (S.cfg.transition === 'fade') {
          if (p < 0.5) drawSeg(ctx, sg[k - 1], W, H, 1 - p * 2, t, k - 1); else drawSeg(ctx, sg[k], W, H, p * 2 - 1, t, k);
        } else { drawSeg(ctx, sg[k - 1], W, H, 1, t, k - 1); drawSeg(ctx, sg[k], W, H, p, t, k); }
        return;
      }
    }
    let i = 0; for (let k = 0; k < sg.length; k++) if (sg[k].s <= t) i = k;
    drawSeg(ctx, sg[i], W, H, 1, t, i);
  }
  function drawEnd(ctx, fmt, t, W, H) {
    const ec = S.end[fmt]; if (!ec || !ec.el || !ec.ready || !S.total) return;
    const f = S.cfg.endFade, a = clamp((t - (S.total - f)) / f, 0, 1);
    if (a > 0) coverDraw(ctx, ec.el, W, H, a, 1);
  }
  // keep every video layer playing at the right spot (loops if the clip is shorter than its slot)
  function syncVideos(fmts, t, playing) {
    const want = new Map(), xf = S.cfg.crossfade;
    fmts.forEach((f) => {
      segsFor(S.bg[f], S.total).forEach((g) => { if (g.b.kind === 'video' && t >= g.s - xf && t < g.e + xf) want.set(g.b, g); });
      const ec = S.end[f];
      if (ec && ec.kind === 'video' && S.total && t >= S.total - S.cfg.endFade - 1) want.set(ec, { s: S.total - S.cfg.endFade });
    });
    allItems().forEach((b) => {
      if (b.kind !== 'video' || !b.el || !b.ready) return;
      const v = b.el, g = want.get(b);
      if (!g) { if (!v.paused) v.pause(); return; }
      const d = v.duration || 0; if (!d) return;
      const lt = Math.max(0, t - g.s) % d, diff = Math.abs(v.currentTime - lt);
      if (playing) {
        if (v.paused) v.play().catch(() => { });
        if (diff > 0.35 && diff < d - 0.35) v.currentTime = lt;
      } else {
        if (!v.paused) v.pause();
        if (diff > 0.04) v.currentTime = lt;
      }
    });
  }

  // ---------- lyrics ----------
  function fontStr(px) { return fontWeight() + ' ' + px.toFixed(1) + 'px "' + S.cfg.font + '", sans-serif'; }
  function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = (TIGHT.indexOf(S.cfg.font) >= 0 ? px * 0.02 : 0).toFixed(1) + 'px'; }
  function drawLyrics(ctx, t, W, H, record) {
    const idx = lineAt(t);
    if (record) { S.hits = []; S.block = null; S.shown = idx; }
    if (idx < 0) return;
    const c = S.cfg, L = S.lines[idx], vis = Math.min(L.end, L.start + c.maxHold);
    const la = clamp((t - L.start) / 0.12, 0, 1) * clamp((vis - t) / 0.12, 0, 1);
    const pct = c.lineSize[L.key] != null ? c.lineSize[L.key] : c.size;
    const fs = pct / 100 * H, u = H / 1080, gapX = fs * 0.24;
    const items = [];
    L.words.forEach((w, i) => {
      if (w.br) { items.push({ br: true }); return; }
      const st = !!c.stress[L.key + ':' + i], wfs = st ? fs * c.stressSize : fs, txt = c.upper ? w.w.toUpperCase() : w.w;
      ctx.font = fontStr(wfs); setSpacing(ctx, wfs);
      items.push({ i: i, txt: txt, at: w.at, st: st, fs: wfs, w: ctx.measureText(txt).width });
    });
    const rows = []; let row = [], rw = 0; const maxW = W * 0.94;
    const push = () => { if (row.length) rows.push({ it: row, w: rw }); row = []; rw = 0; };
    items.forEach((it) => {
      if (it.br) { push(); return; }
      if (c.ori === 'v') { if (row.length >= c.vRows) push(); }
      else if (row.length && rw + gapX + it.w > maxW) push();
      rw += (row.length ? gapX : 0) + it.w; row.push(it);
    });
    push();
    if (!rows.length) return;
    rows.forEach((r) => { r.h = Math.max.apply(null, r.it.map((x) => x.fs)) * 1.08; });
    const bw = Math.max.apply(null, rows.map((r) => r.w)), bh = rows.reduce((a, r) => a + r.h, 0);
    const p = c.linePos[L.key] || { x: c.posX, y: c.posY };
    const ax = p.x / 100 * W, ay = p.y / 100 * H;
    const bx = c.align === 'left' ? ax : c.align === 'right' ? ax - bw : ax - bw / 2, by = ay - bh / 2;
    if (record) S.block = { x: bx, y: by, w: bw, h: bh, key: L.key, idx: idx };
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    let y = by;
    rows.forEach((r) => {
      let x = c.align === 'left' ? bx : c.align === 'right' ? bx + bw - r.w : bx + (bw - r.w) / 2;
      const cy = y + r.h / 2;
      r.it.forEach((it) => {
        const e = t - it.at;
        let op = 1, sc = 1, dx = 0, dy = 0, col = it.st ? c.hi : c.text;
        if (c.anim === 'pop') { const e0 = t - L.start; op = clamp(e0 / 0.15, 0, 1); sc = 0.6 + 0.4 * easeBack(e0 / 0.22); }
        else if (c.anim === 'karaoke') { col = e >= 0 ? c.hi : c.text; }
        else if (e < 0) { op = 0; }
        else if (c.anim === 'floatup') { op = clamp(e / 0.3, 0, 1); const q = easeOut(e / 0.55); dy = 36 * u * (1 - q); sc = 0.94 + 0.06 * q; }
        else if (c.anim === 'slidein') { op = clamp(e / 0.2, 0, 1); dx = -42 * u * (1 - easeOut(e / 0.34)); }
        else { op = clamp(e / 0.15, 0, 1); const q = easeBack(e / 0.22); dy = 14 * u * (1 - q); sc = 0.6 + 0.4 * q; }
        if (it.st && c.anim !== 'karaoke' && e >= 0 && e < 0.4) sc *= 1.35 - 0.35 * easeOut(e / 0.4);
        if (record) S.hits.push({ x: x, y: cy - r.h / 2, w: it.w, h: r.h, key: L.key + ':' + it.i });
        const a = op * la;
        if (a > 0.001) {
          ctx.save();
          ctx.translate(x + it.w / 2 + dx, cy + dy); ctx.scale(sc, sc);
          ctx.globalAlpha = a; ctx.font = fontStr(it.fs); setSpacing(ctx, it.fs);
          if (c.ow > 0) {
            ctx.lineWidth = it.fs * 0.09 * (c.ow / 6) * 2; ctx.strokeStyle = c.out;
            ctx.shadowColor = c.out; ctx.shadowBlur = it.fs * 0.06 * (c.ow / 6);
            ctx.strokeText(it.txt, -it.w / 2, 0); ctx.shadowBlur = 0;
          }
          ctx.fillStyle = col; ctx.fillText(it.txt, -it.w / 2, 0);
          ctx.restore();
        }
        x += it.w + gapX;
      });
      y += r.h;
    });
    setSpacing(ctx, 0);
  }
  function drawFrame(ctx, fmt, t, scale, record, lyrics) {
    const [W, H] = SIZES[fmt];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground(ctx, fmt, t, W, H);
    drawEnd(ctx, fmt, t, W, H);
    if (lyrics) drawLyrics(ctx, t + S.cfg.offset, W, H, record);
    else if (record) { S.hits = []; S.block = null; S.shown = lineAt(t + S.cfg.offset); }
  }

  // ---------- main loop ----------
  // Recording is clocked by a Web Worker: Chrome throttles requestAnimationFrame (down to ~1fps)
  // whenever the window is covered, unfocused or minimized - a worker timer keeps firing at 30fps.
  let clock = null;
  function startClock() {
    if (clock) return;
    const src = 'let h=setInterval(function(){postMessage(0)},1000/30);onmessage=function(){clearInterval(h)}';
    clock = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    clock.onmessage = frame;
  }
  function stopClock() { if (clock) { clock.terminate(); clock = null; } }
  function tick() { requestAnimationFrame(tick); if (!clock) frame(); }
  function frame() {
    if (!built) return;
    const visible = !$('view-mkvideo').classList.contains('hidden');
    if (!visible && !S.rec) { if (!audio.paused) audio.pause(); return; }
    const t = S.rec ? recTime() : (audio.currentTime || 0), playing = S.rec ? true : !audio.paused;
    const set = new Set([S.fmt]); if (S.rec) S.rec.list.forEach((r) => set.add(r.fmt));
    syncVideos(Array.from(set), t, playing);
    if (S.rec) {
      const R = S.rec, from = R.from || 0, lim = R.limit || (S.total - from), el = t - from;
      R.list.forEach((r) => { drawFrame(r.ctx, r.fmt, t, 1, false, R.lyrics); if (R.fade) fadeBlack(r.ctx, r.fmt, el, lim); });
      const pct = clamp(el / lim * 100, 0, 100) + '%';
      $('mvProg').firstChild.style.width = pct; if ($('hkProg')) $('hkProg').firstChild.style.width = pct;
      const msg = (R.label ? R.label + ' \u2014 ' : '') + 'Recording ' + fmtS(el) + ' / ' + fmtS(lim) + ' \u2014 you can switch windows, just don\u2019t close this tab.';
      $('mvRenderMsg').textContent = msg;
      if (R.label && $('hkNow')) $('hkNow').textContent = msg;
      if (el >= lim - 0.02) finishRender();
    } else if (H.play && (audio.paused || audio.currentTime >= H.play.end - 0.03)) {
      if (!audio.paused) audio.pause();
      H.play = null; hkRenderList();
    }
    drawFrame(cx, S.fmt, t, PREVIEW_SCALE, true, S.lyricsOn);
    if (S.total) {
      if (!S.seeking) $('mvSeek').value = Math.round(t / S.total * 1000);
      $('mvTime').textContent = fmtS(t) + ' / ' + fmtS(S.total);
    }
    markLine();
    if (H.mode === 'hooks') hkDraw();
  }
  // hooks end on a short fade to black (the audio fades with it)
  function fadeBlack(ctx, fmt, el, lim) {
    const a = clamp((el - (lim - 0.6)) / 0.6, 0, 1); if (a <= 0) return;
    const [W, H2] = SIZES[fmt]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H2); ctx.globalAlpha = 1;
  }


  // ---------- fonts: big catalog, favorites (synced via repo), live-preview drawer ----------
  // fonts.json = [{n:name, c:category, w:[weights available]}], all verified against Google Fonts.
  const FT = { cat: FONTS.map((f) => ({ n: f, c: 'Classic', w: [400, 700] })), fav: ['Poppins', 'Fjalla One'], custom: [], loaded: {}, sha: null, open: false, q: '', tab: 'fav', sample: '' };
  const FAV_PATH = 'data/video-fonts.json';
  function fontWeight() {
    if (S.cfg.bold == null) return HEAVY.indexOf(S.cfg.font) >= 0 ? 800 : 400; // setups saved before the Bold switch existed
    return S.cfg.bold ? 700 : 400;
  }
  function fontInfo(n) { return FT.custom.find((f) => f.n === n) || FT.cat.find((f) => f.n === n) || { n: n, c: 'Custom', w: [400, 700] }; }
  function ensureFont(n, w) {
    const info = fontInfo(n), want = w || 400;
    const avail = info.w && info.w.length ? info.w : [400];
    const pick = avail.indexOf(want) >= 0 ? want : avail.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), avail[0]);
    const key = n + '@' + pick;
    if (!FT.loaded[key]) {
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@' + pick + '&display=swap';
      document.head.appendChild(l);
      FT.loaded[key] = new Promise((res) => { l.onload = () => res(document.fonts.load(pick + ' 40px "' + n + '"').catch(() => { })); l.onerror = () => res(); });
    }
    return FT.loaded[key];
  }
  function ensureCurrentFont() { return Promise.all([ensureFont(S.cfg.font, fontWeight()), ensureFont(S.cfg.font, 400)]); }
  async function loadFontData() {
    try { const r = await fetch('fonts.json?v=' + (window.MV_FONTS_V || '1')); if (r.ok) FT.cat = await r.json(); } catch (e) { }
    try {
      const f = await B().gh(P(FAV_PATH + '?ref=main')); FT.sha = f.sha;
      const d = JSON.parse(B().b64decode(f.content)); if (Array.isArray(d.favorites)) FT.fav = d.favorites; if (Array.isArray(d.custom)) FT.custom = d.custom;
    } catch (e) { /* first run: defaults */ }
  }
  let favT = null;
  function saveFontData() {
    clearTimeout(favT);
    favT = setTimeout(async () => {
      try { await B().commitFile(FAV_PATH, JSON.stringify({ favorites: FT.fav, custom: FT.custom }, null, 2) + '\n', 'Video font favorites'); }
      catch (e) { toast('Couldn’t save font favorites: ' + e.message, true); }
    }, 1500);
  }
  function toggleFav(n) { const i = FT.fav.indexOf(n); if (i >= 0) FT.fav.splice(i, 1); else FT.fav.push(n); saveFontData(); renderFontBtn(); renderDrawer(); }
  function applyFont(n) {
    S.cfg.font = n; S.dirty = true;
    ensureCurrentFont(); renderFontBtn(); renderDrawer();
  }
  function renderFontBtn() {
    const b = $('mvFontBtn'); if (!b) return;
    ensureFont(S.cfg.font, 400);
    b.innerHTML = '<span style="font-family:\'' + esc(S.cfg.font) + '\',sans-serif;font-size:22px;line-height:1">' + esc(S.cfg.font) + '</span><span class="mv-dim">change ▸</span>';
    const q = $('mvFavChips');
    if (q) q.innerHTML = FT.fav.length ? FT.fav.map((n) => { ensureFont(n, 400); return '<span class="mv-fchip' + (n === S.cfg.font ? ' on' : '') + '" data-font="' + esc(n) + '" style="font-family:\'' + esc(n) + '\',sans-serif">' + esc(n) + '</span>'; }).join('')
      : '<span class="mv-dim">Star fonts in the browser to keep them here.</span>';
  }
  function sampleText() {
    let t = FT.sample;
    if (!t) { const L = S.lines[S.shown >= 0 ? S.shown : (S.pick >= 0 ? S.pick : 0)]; t = L ? L.text.replace(/\s*[\/|]\s*/g, ' ') : 'The quick brown fox'; }
    return S.cfg.upper ? t.toUpperCase() : t;
  }
  let fontObs = null;
  function renderDrawer() {
    const d = $('mvFontDrawer'); if (!d || !FT.open) return;
    const all = FT.custom.concat(FT.cat.filter((f) => !FT.custom.some((c) => c.n === f.n)));
    const cats = ['fav', 'all'].concat(Array.from(new Set(all.map((f) => f.c))));
    const q = FT.q.trim().toLowerCase();
    let list = FT.tab === 'fav' ? FT.fav.map(fontInfo) : FT.tab === 'all' ? all : all.filter((f) => f.c === FT.tab);
    if (q) list = (FT.tab === 'fav' ? list : all).filter((f) => f.n.toLowerCase().indexOf(q) >= 0);
    $('mvFtTabs').innerHTML = cats.map((c) => '<span class="mv-ftab' + (c === FT.tab ? ' on' : '') + '" data-ftab="' + esc(c) + '">' + (c === 'fav' ? '★ Favorites (' + FT.fav.length + ')' : c === 'all' ? 'All (' + all.length + ')' : esc(c)) + '</span>').join('');
    const sample = esc(sampleText()), w = fontWeight();
    $('mvFtList').innerHTML = list.length ? list.map((f) => '<div class="mv-fcard' + (f.n === S.cfg.font ? ' on' : '') + '" data-font="' + esc(f.n) + '">'
      + '<div class="mv-fhead"><span>' + esc(f.n) + ' <span class="mv-dim">' + esc(f.c) + (f.w && f.w.indexOf(700) < 0 && f.w.indexOf(800) < 0 ? ' · no true bold' : '') + '</span></span>'
      + '<span class="mv-fstar' + (FT.fav.indexOf(f.n) >= 0 ? ' on' : '') + '" data-star="' + esc(f.n) + '" title="Favorite">' + (FT.fav.indexOf(f.n) >= 0 ? '★' : '☆') + '</span></div>'
      + '<div class="mv-fsample" data-lazy="' + esc(f.n) + '" style="font-weight:' + w + '">' + sample + '</div></div>').join('')
      : '<div class="mv-dim" style="padding:14px">' + (FT.tab === 'fav' && !q ? 'No favorites yet — open <b>All</b> and tap ☆ on the ones you like.' : 'Nothing matches “' + esc(FT.q) + '”. If it’s a Google Font, add it by name below.') + '</div>';
    if (fontObs) fontObs.disconnect();
    fontObs = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (!e.isIntersecting) return; const el = e.target, n = el.dataset.lazy; fontObs.unobserve(el);
      ensureFont(n, w).then(() => { el.style.fontFamily = '\'' + n + '\', sans-serif'; el.classList.add('ld'); });
    }), { root: $('mvFtList'), rootMargin: '300px' });
    $('mvFtList').querySelectorAll('[data-lazy]').forEach((el) => fontObs.observe(el));
  }
  function openDrawer(on) {
    FT.open = on; $('mvFontDrawer').classList.toggle('hidden', !on);
    if (on) { FT.tab = FT.fav.length ? 'fav' : 'all'; $('mvFtSearch').value = FT.q = ''; renderDrawer(); setTimeout(() => $('mvFtSearch').focus(), 50); }
  }
  async function addGoogleFont() {
    const n = $('mvFtAdd').value.trim().replace(/\s+/g, ' '); if (!n) return;
    if (fontInfo(n).c !== 'Custom' || FT.custom.some((f) => f.n.toLowerCase() === n.toLowerCase())) { FT.q = n; $('mvFtSearch').value = n; FT.tab = 'all'; renderDrawer(); return toast(n + ' is already in the list'); }
    const w = [];
    for (const wt of [400, 700]) {
      try { const r = await fetch('https://fonts.googleapis.com/css2?family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@' + wt); if (r.ok) w.push(wt); } catch (e) { }
    }
    if (!w.length) return toast('Google Fonts doesn’t have “' + n + '” — check the spelling (it’s case-sensitive, e.g. “Playfair Display”)', true);
    FT.custom.unshift({ n: n, c: 'My Fonts', w: w }); if (FT.fav.indexOf(n) < 0) FT.fav.push(n);
    $('mvFtAdd').value = ''; saveFontData(); FT.tab = 'fav'; applyFont(n); toast('Added ' + n + ' and starred it');
  }

  // ---------- UI ----------
  const CSS = `
  .mv-main{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:18px;margin-top:18px;align-items:start}
  @media(max-width:1150px){.mv-main{grid-template-columns:1fr}}
  @media(min-width:1151px){.mv-left{position:sticky;top:var(--mvTop,10px)}}
  .mv-stagewrap{background:#000;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  #mvCanvas{display:block;width:min(100%, calc((100vh - var(--mvTop,10px) - 72px) * 1.7778));height:auto;margin:0 auto;touch-action:none;background:#000}
  #mvCanvas.v{width:auto;height:min(calc(100vh - var(--mvTop,10px) - 72px),760px)}
  .mv-fontbtn{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:10px 12px;border-radius:8px;margin-top:6px;text-align:left}
  .mv-fontbtn:hover{border-color:var(--warn)}
  .mv-fchips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  .mv-fchip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:16px;cursor:pointer}
  .mv-fchip:hover,.mv-fchip.on{border-color:var(--red);color:#fff}.mv-fchip.on{background:var(--red)}
  .mv-drawer{position:fixed;right:0;top:var(--mvTop,0px);bottom:0;width:min(470px,100vw);z-index:60;background:var(--panel);border-left:1px solid var(--line);box-shadow:-12px 0 30px rgba(0,0,0,.5);padding:14px;display:flex;flex-direction:column;gap:8px}
  .mv-drawer.hidden{display:none}
  .mv-drhead{display:flex;align-items:center;gap:10px}.mv-drhead b{font-family:'Bebas Neue';font-size:22px;font-weight:400}.mv-drhead .mv-dim{flex:1}
  .mv-drawer input{padding:8px 10px;font-size:14px}
  .mv-ftabs{display:flex;flex-wrap:wrap;gap:5px}
  .mv-ftab{font-size:12.5px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);cursor:pointer;color:var(--muted)}
  .mv-ftab.on{background:var(--red);border-color:var(--red);color:#fff}
  .mv-ftlist{flex:1;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#0b0907}
  .mv-fcard{padding:9px 12px;border-bottom:1px solid var(--line);cursor:pointer}
  .mv-fcard:hover{background:var(--panel2)} .mv-fcard.on{background:#3a1717}
  .mv-fhead{display:flex;justify-content:space-between;font-size:12.5px}
  .mv-fstar{font-size:20px;color:var(--muted);padding:0 4px;line-height:1}.mv-fstar.on{color:#e6bd52}.mv-fstar:hover{color:#e6bd52}
  .mv-fsample{font-size:30px;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.35;transition:opacity .2s}
  .mv-fsample.ld{opacity:1}
  .mv-transport{display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--panel)}
  .mv-pp{background:var(--red);color:#fff;width:40px;height:40px;border-radius:50%;font-size:15px;flex:none}
  .mv-transport input[type=range]{flex:1;padding:0;accent-color:var(--red);background:none;border:none}
  .mv-time{font-family:monospace;color:var(--muted);min-width:96px;text-align:right}
  .mv-lines{margin-top:10px;max-height:250px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel);position:relative}
  .mv-line{display:flex;gap:10px;padding:6px 10px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px}
  .mv-line:hover{background:var(--panel2)} .mv-line.cur{background:#3a1717} .mv-line.pick{outline:1px solid var(--warn);outline-offset:-1px}
  .mv-line{align-items:center;gap:4px !important;padding:4px 8px !important}
  .mv-line.mk .mv-lx{color:var(--warn);font-style:italic}
  .mv-lt{font-family:monospace;color:var(--warn);width:70px !important;flex:none;padding:5px 6px !important;font-size:13px !important;text-align:center}
  .mv-lx{flex:1;min-width:0;padding:5px 8px !important;font-size:14px !important;background:transparent !important;border-color:transparent !important}
  .mv-lx:focus,.mv-lx:hover{background:var(--panel2) !important;border-color:var(--line) !important}
  .mv-tsbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .mv-tag{font-size:10px;background:var(--warn);color:#1a1200;border-radius:4px;padding:1px 5px;font-weight:700;align-self:center;white-space:nowrap}
  .mv-card{padding:16px !important;margin-bottom:14px}
  .mv-card h4{font-family:'Bebas Neue',sans-serif;font-size:21px;letter-spacing:.04em;font-weight:400;margin-bottom:6px}
  .mv-card h4 .n{color:var(--red);margin-right:6px}
  .mv-dim{color:var(--muted);font-size:12.5px;line-height:1.45}
  .mv-warn{color:var(--warn);font-size:12px}
  .mv-status{margin-top:12px;font-size:14px;display:flex;gap:14px;flex-wrap:wrap}
  .mv-status .ok{color:var(--ok)} .mv-status .no{color:var(--warn)}
  .mv-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .mv-grid2 .mv-lab{margin-top:0}
  .mv-seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:4px 0 8px}
  .mv-seg button{flex:1;background:var(--panel2);color:var(--muted);padding:8px 4px;font-size:13px;font-weight:600;border-radius:0}
  .mv-seg button.on{background:var(--red);color:#fff}
  .mv-row{display:flex;gap:8px;align-items:center;margin:6px 0}
  .mv-row input{padding:8px 10px;font-size:13.5px}
  .mv-sm{padding:8px 12px !important;font-size:13px !important;white-space:nowrap}
  .mv-file{cursor:pointer;display:inline-block} .mv-file input{display:none}
  .mv-lab{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:12px 0 4px;display:block}
  .mv-sl{margin:5px 0} .mv-sll{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted)}
  .mv-sl input[type=range]{padding:0;accent-color:var(--red);background:none;border:none}
  .mv-bglist{display:flex;flex-direction:column;gap:6px;margin:6px 0}
  .mv-bg{display:flex;gap:8px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:5px 7px}
  .mv-bg img,.mv-ph{width:44px;height:44px;object-fit:cover;border-radius:5px;flex:none;background:#000;display:flex;align-items:center;justify-content:center;color:var(--muted)}
  .mv-bgn{flex:1;min-width:0;font-size:12.5px} .mv-bgn>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mv-bgt{width:66px !important;padding:6px !important;font-size:12.5px !important;font-family:monospace;text-align:center}
  .mv-ib{background:none;color:var(--muted);font-size:14px;padding:4px 5px} .mv-ib:hover{color:var(--cream)}
  .mv-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .mv-chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:13px;cursor:pointer;user-select:none}
  .mv-chip:hover{border-color:var(--warn);color:var(--warn)}
  .mv-zones{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:4px 0}
  .mv-zones button{background:var(--panel2);color:var(--cream);padding:6px;border:1px solid var(--line)}
  .mv-zones button:hover{border-color:var(--warn)}
  .mv-colors{display:flex;gap:8px} .mv-colors label{flex:1;font-size:12px;color:var(--muted);text-align:center}
  .mv-colors input{height:34px;padding:2px;cursor:pointer}
  .mv-chk{display:flex;gap:8px;align-items:center;font-size:13.5px;margin:6px 0;cursor:pointer} .mv-chk input{width:auto}
  .mv-go{width:100%;font-size:19px !important;padding:14px !important;margin-top:8px;font-family:'Bebas Neue',sans-serif;letter-spacing:.05em}
  .mv-prog{height:8px;background:var(--panel2);border-radius:99px;overflow:hidden;margin-top:10px} .mv-prog>div{height:100%;width:0;background:var(--red)}
  .mv-card select{padding:8px 10px;font-size:14px}
  .mv-tabs{display:flex;gap:4px;margin:4px 0 0;border-bottom:1px solid var(--line)}
  .mv-tabs button{background:none;color:var(--muted);padding:8px 14px;font-size:14px;font-weight:600;border-radius:8px 8px 0 0;border:1px solid transparent;border-bottom:none;margin-bottom:-1px}
  .mv-tabs button.on{color:var(--cream);background:var(--panel);border-color:var(--line)}
  .mv-left.hk{position:static !important}
  .mv-left.hk #mvCanvas{width:min(100%, calc(46vh * 1.7778))}
  .mv-left.hk #mvCanvas.v{width:auto;height:46vh}
  .hk-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:10px 0 8px}
  .hk-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
  .hk-tl{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0b0907}
  #hkCanvas{display:block;width:100%;touch-action:none;user-select:none}
  .hk-tips{margin:4px 2px 8px} .hk-tips summary{cursor:pointer;color:var(--warn);font-size:13px} .hk-tips div{margin-top:4px}
  .hk-list{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
  .hk-row{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--line);font-size:13.5px;cursor:pointer}
  .hk-row:hover{background:var(--panel2)} .hk-row.on{background:#2c1d12;outline:1px solid var(--warn);outline-offset:-1px} .hk-row.off{opacity:.5}
  .hk-dot{width:11px;height:11px;border-radius:3px;flex:none}
  .hk-name{min-width:92px;white-space:nowrap}
  .hk-t{width:68px !important;padding:4px 6px !important;font-family:monospace;font-size:13px !important;text-align:center;color:var(--warn)}
  .hk-len{min-width:44px;font-family:monospace;font-size:12.5px;color:var(--muted);text-align:right} .hk-len.out{color:var(--warn)}
  .hk-lab{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-left:4px}
  .hk-on{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);cursor:pointer;margin-left:auto} .hk-on input{width:auto}
  .hk-made{color:var(--ok);font-size:12px;min-width:50px}
  .hk-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .hk-foot .mv-chk{margin:0}
  `;
  const seg = (g, opts) => '<div class="mv-seg" data-g="' + g + '">' + opts.map((o) => '<button data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
  const slider = (k) => { const d = SLIDERS[k]; return '<div class="mv-sl"><div class="mv-sll"><span>' + d[0] + '</span><span data-show="' + k + '"></span></div><input type="range" data-k="' + k + '" min="' + d[1] + '" max="' + d[2] + '" step="' + d[3] + '"></div>'; };

  function build() {
    if (built) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    $('view-mkvideo').innerHTML = `
    <div class="card" style="max-width:none">
      <h3>Make Video <span id="mvSongName" style="color:var(--muted);font-weight:normal;font-size:15px"></span></h3>
      <div class="sub">Pick a song &mdash; its audio and saved lyric timestamps load on their own. Add a background (your cinemagraph video, or stills),
      style the lyrics, then hit Make Video at the bottom. It renders right here in the browser, so it works on any computer (Chrome or Edge).</div>
      <div class="mv-grid2">
        <div><span class="mv-lab">Artist</span><select id="mvArtist"></select></div>
        <div><span class="mv-lab">Song</span><select id="mvSong"></select></div>
      </div>
      <div id="mvStatus" class="mv-status"></div>
      <div class="save-bar" style="margin-top:14px">
        <button class="btn btn-blue mv-sm" id="mvFolderBtn">&#128193; Pick song folder</button>
        <button class="btn btn-ghost mv-sm" id="mvReload" title="Pull the latest saved timestamps">&#8635; Reload timestamps</button>
        <button class="btn btn-ghost mv-sm" id="mvEditTs">Edit timestamps</button>
        <span class="mv-dim" id="mvFolderName">Optional: pick the song's folder to click-add its video / images / MP3 &mdash; finished videos save back into it.</span>
        <input type="file" id="mvDirInput" webkitdirectory multiple style="display:none">
      </div>
      <div id="mvFolder" class="mv-chips"></div>
    </div>
    <div class="mv-main">
      <div class="mv-left">
        <div class="mv-stagewrap">
          <canvas id="mvCanvas"></canvas>
          <div class="mv-transport"><button class="mv-pp" id="mvPP">&#9654;</button><input type="range" id="mvSeek" min="0" max="1000" value="0"><span id="mvTime" class="mv-time">0:00 / 0:00</span></div>
        </div>
        <div class="mv-dim" style="margin:7px 2px">Drag the lyrics on the frame to move them &middot; click a word to stress it &middot; Space = play/pause.</div>
        <div class="mv-tabs"><button class="on" data-mvtab="lines">Lyric lines</button><button data-mvtab="hooks">&#9986; Hooks <span id="hkCount"></span></button></div>
        <div id="mvLinesPane">
        <div class="mv-tsbar hidden" id="mvTsBar">
          <button class="btn btn-ghost mv-sm" id="mvAddLine" title="Add a new lyric line at the current playhead">+ Line at playhead</button>
          <button class="btn btn-ghost mv-sm" id="mvAddGap" title="Clear the screen at the current playhead (instrumental / breath)">+ Clear screen here</button>
          <button class="btn btn-ghost mv-sm" id="mvAddSec" title="Add a section marker at the playhead (e.g. [Chorus]) &mdash; the line before it clears here">+ Section here</button>
          <button class="btn btn-ghost mv-sm" id="mvTsUndo" title="Undo the last lyric edit (Ctrl+Z)">&#8630; Undo</button>
          <button class="btn btn-red mv-sm" id="mvTsSave" disabled>Lyrics saved</button>
        </div>
        <div class="mv-dim" style="margin:6px 2px 0">Fix a line right here: edit the time or the words and press Enter. To re-time by ear, click the line, play, and press <b>Enter</b> the moment it’s sung (&#9201; does the same). Changes show in the preview immediately; <b>Save lyric changes</b> writes them to the song’s timestamps.</div>
        <div id="mvLines" class="mv-lines"></div>
        </div>
        <div id="mvHooksPane" class="hidden">
          <div class="hk-bar">
            <button class="btn btn-ghost mv-sm" data-hkadd="quick" title="Add a Quick hook (starts at 15s) at the playhead"><span class="hk-sw" style="background:#4cd08a"></span>+ Quick</button>
            <button class="btn btn-ghost mv-sm" data-hkadd="standard" title="Add a Standard hook (starts at 30s) at the playhead"><span class="hk-sw" style="background:#ff6a4d"></span>+ Standard</button>
            <button class="btn btn-ghost mv-sm" data-hkadd="extended" title="Add an Extended hook (starts at 45s) at the playhead"><span class="hk-sw" style="background:#58b7ff"></span>+ Extended</button>
            <button class="btn btn-blue mv-sm" id="hkSuggest" title="Pick starting spots from the chorus markers, repeated lines and the loud parts">&#10024; Suggest hooks</button>
            <span style="flex:1"></span>
            <span class="mv-dim" id="hkZoomLbl">whole song</span>
            <button class="btn btn-ghost mv-sm" id="hkZoomSel" title="Zoom the timeline to the selected hook">&#128269; Zoom to hook</button>
            <button class="btn btn-ghost mv-sm" id="hkZoomFit" title="Show the whole song">Whole song</button>
          </div>
          <div class="hk-tl"><canvas id="hkCanvas"></canvas></div>
          <div class="mv-dim" style="margin:6px 2px">Click the waveform to jump there &middot; <b>drag the middle</b> of a bar to move it, <b>drag either end</b> to set exactly where it starts and stops (snaps to the lyrics &mdash; hold <b>Shift</b> for free placement) &middot; <b>mouse wheel</b> zooms the timeline, Shift+wheel scrolls it &middot; while the song plays, <b>[</b> and <b>]</b> set the selected hook&rsquo;s start and end right there &middot; &#9654; plays the hook, &#9654;| plays just its last 4 seconds &middot; arrows move it (Alt+arrows trim the end), Delete removes it. Lengths are a guide, not a limit.</div>
          <details class="hk-tips"><summary>How to pick a good hook</summary>
            <div class="mv-dim">Start right on the line people will sing back &mdash; usually the chorus. The first second decides whether someone keeps watching, so skip slow intros and start on a word or a hit, not a breath.
            <b>Quick</b> (about 10&ndash;20s) = the one catchiest line or two. <b>Standard</b> (about 22&ndash;40s) = one full chorus, the everyday post. <b>Extended</b> (about 40&ndash;75s) = the build into the chorus and the chorus itself. Those are guides &mdash; end where the line ends, not on a number.
            Make several from different spots and post them over a few weeks; the ones that get watched to the end tell you which part of the song is the real hook.</div></details>
          <div id="hkList" class="hk-list"></div>
          <div class="hk-foot">
            <label class="mv-chk"><input type="checkbox" id="hk16" checked> 16:9</label>
            <label class="mv-chk"><input type="checkbox" id="hk9" checked> 9:16</label>
            <label class="mv-chk" title="Sound and picture fade out over the last second"><input type="checkbox" id="hkFade" checked> Fade out at the end</label>
            <span style="flex:1"></span>
            <button class="btn btn-ghost mv-sm" id="hkSave">Save hooks</button>
            <button class="btn btn-red mv-sm" id="hkGo">&#127916; Make hooks</button>
            <button class="btn btn-ghost mv-sm hidden" id="hkCancel">Stop</button>
          </div>
          <div class="mv-prog hidden" id="hkProg"><div></div></div>
          <div class="mv-dim" id="hkNow" style="margin-top:6px"></div>
          <div class="mv-dim" id="hkMsg" style="margin-top:4px">Uses this song&rsquo;s backgrounds and lyric look. Both sizes record at the same time, in real time, into a <b>Hooks</b> folder inside the song folder.</div>
        </div>
      </div>
      <div>
        <div class="card mv-card">
          <h4><span class="n">1</span>Backgrounds</h4>
          ${seg('fmt', [['16', '16:9 &middot; YouTube'], ['9', '9:16 &middot; Shorts']])}
          <div class="mv-dim">Each frame size has its own set. A video loops for its whole slot &mdash; one video = the whole song. Start times are optional (blank = auto).</div>
          <div id="mvBgList" class="mv-bglist"></div>
          <div class="mv-row"><input id="mvLink" placeholder="Paste a Dropbox link (video or image)"><button class="btn btn-ghost mv-sm" id="mvLinkAdd">Add</button></div>
          <div class="mv-row"><label class="btn btn-ghost mv-sm mv-file">Pick file(s)&hellip;<input type="file" id="mvFiles" accept="image/*,video/*" multiple></label>
            <button class="btn btn-ghost mv-sm" id="mvEven" title="Clear all start times">Spread evenly</button></div>
          <span class="mv-lab">Transition between backgrounds</span>
          ${seg('transition', [['dissolve', 'Dissolve'], ['fade', 'Fade (black)']])}
          ${slider('crossfade')}
          <label class="mv-chk"><input type="checkbox" id="mvKen"> Slow zoom on still images</label>
          <span class="mv-lab">End card <span id="mvEndName" style="text-transform:none;letter-spacing:0"></span></span>
          <div class="mv-row"><input id="mvEndLink" placeholder="Dropbox link&hellip;"><label class="btn btn-ghost mv-sm mv-file">Pick&hellip;<input type="file" id="mvEndFile" accept="image/*,video/*"></label><button class="btn btn-ghost mv-sm" id="mvEndClear" title="Remove end card">&#10005;</button></div>
          ${slider('endFade')}
        </div>
        <div class="card mv-card">
          <h4><span class="n">2</span>Lyrics look</h4>
          <span class="mv-lab" style="margin-top:0">Changes apply to</span>
          ${seg('move', [['all', 'All lines'], ['line', 'This line only']])}
          ${slider('size')}${slider('stressSize')}
          <span class="mv-lab">Place</span>
          <div class="mv-zones">${[[15, 18, '&#8598;'], [50, 18, '&#8593;'], [85, 18, '&#8599;'], [15, 50, '&#8592;'], [50, 50, '&#8226;'], [85, 50, '&#8594;'], [15, 82, '&#8601;'], [50, 82, '&#8595;'], [85, 82, '&#8600;']].map((z) => '<button data-zone="' + z[0] + ',' + z[1] + '">' + z[2] + '</button>').join('')}</div>
          ${slider('posX')}${slider('posY')}
          <span class="mv-lab">Layout</span>
          ${seg('ori', [['h', 'Horizontal'], ['v', 'Vertical']])}
          ${slider('vRows')}
          ${seg('align', [['left', 'Left'], ['center', 'Middle'], ['right', 'Right']])}
          <span class="mv-lab">Animation &amp; font</span>
          <select id="mvAnim" style="margin-bottom:6px">${ANIMS.map((a) => '<option value="' + a[0] + '">' + a[1] + '</option>').join('')}</select>
          <button class="mv-fontbtn" id="mvFontBtn" title="Browse fonts"></button>
          <div id="mvFavChips" class="mv-fchips"></div>
          ${seg('bold', [['false', 'Regular'], ['true', 'Bold']])}
          ${seg('upper', [['true', 'UPPERCASE'], ['false', 'Normal case']])}
          <span class="mv-lab">Colors &amp; outline</span>
          <div class="mv-colors"><label>Text<input type="color" data-col="text"></label><label>Stressed<input type="color" data-col="hi"></label><label>Outline<input type="color" data-col="out"></label></div>
          ${slider('ow')}
          <span class="mv-lab">Timing</span>
          ${slider('offset')}${slider('maxHold')}
          <div class="mv-dim">Gaps and instrumentals come from your timestamps: a line clears at the next [section] or [gap] marker.</div>
        </div>
        <div class="card mv-card">
          <h4><span class="n">3</span>Make video</h4>
          ${seg('lyricsOn', [['true', 'With lyrics'], ['false', 'No lyrics (clean)']])}
          ${seg('out', [['16', '16:9'], ['9', '9:16'], ['both', 'Both at once']])}
          <label class="mv-chk"><input type="checkbox" id="mvListen" checked> Play the audio out loud while it records</label>
          <label class="mv-chk" title="Same video at a much lower bitrate - the one to put in Dropbox for an Exclusive on the artist site"><input type="checkbox" id="mvWeb"> Also save an extra-small <b>website copy</b> (optional)</label>
          <div class="save-bar" style="margin-top:6px">
            <button class="btn btn-ghost mv-sm" id="mvSave">Save setup</button>
            <button class="btn btn-ghost mv-sm" id="mvTest" title="Records only the first 20 seconds">Quick test (20s)</button>
          </div>
          <button class="btn btn-red mv-go" id="mvGo">&#127916; Make Video</button>
          <button class="btn btn-ghost mv-sm hidden" id="mvCancel" style="width:100%;margin-top:8px">Cancel render</button>
          <div class="mv-prog hidden" id="mvProg"><div></div></div>
          <div class="mv-dim" id="mvRenderMsg" style="margin-top:8px">Records in real time &mdash; a 3-minute song takes about 3 minutes. Saves into your picked folder, or downloads.</div>
        </div>
      </div>
    </div>
    <div id="mvFontDrawer" class="mv-drawer hidden">
      <div class="mv-drhead"><b>Fonts</b><span class="mv-dim">click to try it on the preview \u00b7 \u2606 to favorite</span><button class="btn btn-ghost mv-sm" id="mvFtClose">Done</button></div>
      <input id="mvFtSearch" placeholder="Search fonts\u2026">
      <input id="mvFtSample" placeholder="Sample text (blank = the current lyric)">
      <div id="mvFtTabs" class="mv-ftabs"></div>
      <div id="mvFtList" class="mv-ftlist"></div>
      <div class="mv-row" style="margin-top:8px"><input id="mvFtAdd" placeholder="Add any Google Font by exact name (e.g. Rubik Dirt)"><button class="btn btn-blue mv-sm" id="mvFtAddBtn">Add</button></div>
      <div class="mv-dim">Browse them all at <a href="https://fonts.google.com" target="_blank" rel="noreferrer">fonts.google.com</a> \u2014 copy the name, paste it here.</div>
    </div>`;
    cv = $('mvCanvas'); cx = cv.getContext('2d');
    wire();
    setFmt('16');
    built = true;
    requestAnimationFrame(tick);
  }

  // ---------- controls ----------
  function tgtKey() { const i = S.shown >= 0 ? S.shown : S.pick; return i >= 0 && S.lines[i] ? S.lines[i].key : null; }
  function getVal(k) {
    const c = S.cfg, key = tgtKey();
    if (S.move === 'line' && key) {
      if (k === 'size' && c.lineSize[key] != null) return c.lineSize[key];
      if ((k === 'posX' || k === 'posY') && c.linePos[key]) return k === 'posX' ? c.linePos[key].x : c.linePos[key].y;
    }
    return c[k];
  }
  function setVal(k, v) {
    const c = S.cfg, key = tgtKey();
    if (S.move === 'line' && key && (k === 'size' || k === 'posX' || k === 'posY')) {
      const fresh = c.lineSize[key] == null && !c.linePos[key];
      if (k === 'size') c.lineSize[key] = v;
      else { const p = c.linePos[key] || { x: c.posX, y: c.posY }; p[k === 'posX' ? 'x' : 'y'] = v; c.linePos[key] = p; }
      if (fresh) renderLines();
    } else c[k] = v;
    S.dirty = true;
  }
  function setPos(x, y, key) {
    const c = S.cfg;
    if (S.move === 'line' && key) { const fresh = c.lineSize[key] == null && !c.linePos[key]; c.linePos[key] = { x: x, y: y }; if (fresh) renderLines(); }
    else { c.posX = x; c.posY = y; }
    S.dirty = true; syncControls();
  }
  function segVal(g) {
    if (g === 'fmt') return S.fmt; if (g === 'move') return S.move; if (g === 'out') return S.out;
    if (g === 'lyricsOn') return String(S.lyricsOn); if (g === 'bold') return String(fontWeight() >= 700); return String(S.cfg[g]);
  }
  function segSet(g, v) {
    if (S.rec && (g === 'out' || g === 'lyricsOn')) return;
    if (g === 'fmt') setFmt(v);
    else if (g === 'move') S.move = v;
    else if (g === 'out') S.out = v;
    else if (g === 'lyricsOn') S.lyricsOn = v === 'true';
    else if (g === 'upper') { S.cfg.upper = v === 'true'; S.dirty = true; renderDrawer(); }
    else if (g === 'bold') { S.cfg.bold = v === 'true'; S.dirty = true; ensureCurrentFont(); renderDrawer(); }
    else { S.cfg[g] = v; S.dirty = true; }
    syncControls();
  }
  function syncControls() {
    if (!built) return;
    document.querySelectorAll('#view-mkvideo .mv-seg').forEach((s) => { const v = segVal(s.dataset.g); s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); });
    document.querySelectorAll('#view-mkvideo [data-k]').forEach((r) => { const k = r.dataset.k, v = +getVal(k); if (document.activeElement !== r) r.value = v; const sh = document.querySelector('#view-mkvideo [data-show="' + k + '"]'); if (sh) sh.textContent = SLIDERS[k][4](v); });
    document.querySelectorAll('#view-mkvideo [data-col]').forEach((i) => { i.value = S.cfg[i.dataset.col]; });
    $('mvAnim').value = S.cfg.anim; renderFontBtn(); $('mvKen').checked = !!S.cfg.kenburns;
    const k = tgtKey();
    document.querySelector('#view-mkvideo [data-show="size"]').previousElementSibling.textContent = (S.move === 'line' ? (k ? 'Caption size (this line)' : 'Caption size (pick a line)') : 'Caption size (all lines)');
  }
  function setFmt(f) {
    S.fmt = f;
    const [W, H] = SIZES[f]; cv.width = W * PREVIEW_SCALE; cv.height = H * PREVIEW_SCALE;
    cv.classList.toggle('v', f === '9');
    renderBg(); renderEnd(); renderFolder();
  }

  // ---------- lines list ----------
  function renderLines() {
    const box = $('mvLines'); if (!box) return;
    const tb = $('mvTsBar'); if (tb) tb.classList.toggle('hidden', !S.song);
    const sv = $('mvTsSave'); if (sv) { sv.disabled = !S.tsDirty; sv.textContent = S.tsDirty ? '\u25cf Save lyric changes' : 'Lyrics saved'; }
    if (!S.song) { box.innerHTML = '<div class="mv-dim" style="padding:12px">Pick a song above.</div>'; return; }
    if (!S.ev.length) { box.innerHTML = '<div class="mv-dim" style="padding:12px">No saved timestamps for this song yet &mdash; stamp them in Lyric Timestamps (button above), save, then Reload timestamps. Or add lines right here with <b>+ Line at playhead</b>.</div>'; return; }
    const c = S.cfg, li = {};
    S.lines.forEach((L, i) => { li[L.evId] = i; });
    const keep = box.scrollTop;
    box.innerHTML = S.ev.map((e) => {
      const i = li[e.id], L = i != null ? S.lines[i] : null;
      const own = L && (c.linePos[L.key] || c.lineSize[L.key] != null);
      return '<div class="mv-line' + (e.marker ? ' mk' : '') + (e.id === S.sel ? ' pick' : '') + '" data-ev="' + e.id + '"' + (i != null ? ' data-li="' + i + '"' : '') + '>'
        + '<input class="mv-lt" data-evt="' + e.id + '" value="' + fmtT(e.t) + '" title="Start time (M:SS.s) \u2014 type a new one and press Enter">'
        + '<button class="mv-ib" data-evnow="' + e.id + '" title="Set to the current playhead (or select the row and press Enter while it plays)">&#9201;</button>'
        + '<button class="mv-ib" data-evn="' + e.id + ',-0.1" title="0.1s earlier">&minus;</button><button class="mv-ib" data-evn="' + e.id + ',0.1" title="0.1s later">+</button>'
        + '<input class="mv-lx" data-evx="' + e.id + '" value="' + esc(e.text) + '" title="' + (e.marker ? 'Section / [gap] marker \u2014 the lyric before it clears here' : 'Lyric text \u2014 fix spelling or missing words, press Enter') + '">'
        + (own ? '<span class="mv-tag" title="This line has its own size/position">own look</span><button class="mv-ib" data-reset="' + i + '" title="Reset this line to the all-lines look">&#8634;</button>' : '')
        + (e.marker ? '' : '<button class="mv-ib" data-evclr="' + e.id + '" title="Clear the screen after this line (adds a [gap]; if the song is playing inside this line, it lands at the playhead)">&#8676;&#8677;</button>'
          + '<button class="mv-ib" data-evmerge="' + e.id + '" title="Merge the next line into this one (it becomes a second row of this caption)">&#8681;</button>')
        + '<button class="mv-ib" data-evdel="' + e.id + '" title="Delete this line">&#10005;</button></div>';
    }).join('');
    box.scrollTop = keep;
    S._marked = null;
  }
  // ---------- lyric edits (saved back to data/lyrics/<song>-timestamps.txt) ----------
  function evById(id) { return S.ev.find((e) => e.id === +id); }
  function tsPush() { S.tsHist.push(JSON.stringify({ ev: S.ev, lp: S.cfg.linePos, ls: S.cfg.lineSize, st: S.cfg.stress })); if (S.tsHist.length > 100) S.tsHist.shift(); }
  function tsCommit() {
    // carry per-line looks (position / size / stressed words) over to the edited line's new key
    const oldK = {}; S.lines.forEach((L) => { oldK[L.evId] = L; });
    S.ev.sort((a, b) => a.t - b.t);
    S.lines = deriveLines(S.ev);
    const c = S.cfg, lp = {}, ls = {}, st = {};
    S.lines.forEach((L) => {
      const o = oldK[L.evId]; if (!o) return;
      if (c.linePos[o.key]) lp[L.key] = c.linePos[o.key];
      if (c.lineSize[o.key] != null) ls[L.key] = c.lineSize[o.key];
      Object.keys(c.stress).forEach((k) => { const cut = k.lastIndexOf(':'); if (k.slice(0, cut) === o.key && +k.slice(cut + 1) < L.words.length) st[L.key + ':' + k.slice(cut + 1)] = c.stress[k]; });
    });
    c.linePos = lp; c.lineSize = ls; c.stress = st;
    S.tsDirty = true; S.dirty = true; S.shown = -1; S._marked = null;
    renderLines(); syncControls();
  }
  function tsUndo() {
    if (!S.tsHist.length) return toast('Nothing to undo', true);
    const h = JSON.parse(S.tsHist.pop());
    S.ev = h.ev; S.cfg.linePos = h.lp; S.cfg.lineSize = h.ls; S.cfg.stress = h.st;
    S.lines = deriveLines(S.ev); S.tsDirty = true; renderLines(); syncControls();
  }
  const now10 = () => Math.round(((audio.currentTime || 0) + S.cfg.offset) * 10) / 10;
  function evSetTime(id, t) { const e = evById(id); if (!e || t == null || isNaN(t)) { renderLines(); return; } tsPush(); e.t = Math.max(0, Math.round(t * 10) / 10); tsCommit(); }
  function evSetText(id, tx) {
    const e = evById(id); tx = String(tx || '').trim();
    if (!e || tx === e.text) return;
    if (!tx) { renderLines(); return toast('Empty line \u2014 use \u2715 to delete it instead', true); }
    tsPush(); e.text = tx; e.marker = isMarker(tx); tsCommit();
  }
  function evDel(id) { const i = S.ev.findIndex((e) => e.id === +id); if (i < 0) return; tsPush(); S.ev.splice(i, 1); if (S.sel === +id) S.sel = null; tsCommit(); }
  // merge the next lyric line into this one as a second row ("a / b")
  function evMerge(id) {
    const e = evById(id); if (!e) return;
    const ord = S.ev.slice().sort((a, b) => a.t - b.t), n = ord[ord.indexOf(e) + 1];
    if (!n) return toast('This is the last line \u2014 nothing to merge', true);
    if (n.marker) return toast('A ' + n.text + ' marker sits right after this line \u2014 delete it first if you really want them together', true);
    tsPush(); e.text = e.text + ' / ' + n.text; S.ev.splice(S.ev.indexOf(n), 1); S.sel = e.id; tsCommit();
    toast('Merged \u2014 the caption now shows two rows');
  }
  // end this caption early: add a [gap] after it (at the playhead if it's inside the line, else ~80% through)
  function evClearAfter(id) {
    const e = evById(id); if (!e) return;
    const ord = S.ev.slice().sort((a, b) => a.t - b.t), n = ord.slice(ord.indexOf(e) + 1).find((x) => x.t > e.t);
    const end = n ? n.t : e.t + 6, ph = now10();
    let at = (ph > e.t + 0.2 && ph < end - 0.05) ? ph : Math.round((e.t + Math.max(0.6, (end - e.t) * 0.8)) * 10) / 10;
    if (n && at >= n.t) at = Math.round((n.t - 0.1) * 10) / 10;
    if (at <= e.t) return toast('No room after this line to clear the screen', true);
    tsPush(); const g = { id: ++_uid, t: at, text: '[gap]', marker: true }; S.ev.push(g); S.sel = g.id; tsCommit();
    toast('Screen clears at ' + fmtT(at) + ' \u2014 nudge it with \u2212/+, or play and press Enter the moment the singing stops');
  }
  function evAddSection() {
    if (!S.song) return;
    tsPush(); const e = { id: ++_uid, t: now10(), text: '[Section]', marker: true }; S.ev.push(e); S.sel = e.id; tsCommit();
    const inp = document.querySelector('#mvLines [data-evx="' + e.id + '"]'); if (inp) { inp.focus(); inp.setSelectionRange(1, 8); }
  }
  function evAdd(text) {
    if (!S.song) return;
    tsPush(); const e = { id: ++_uid, t: now10(), text: text, marker: isMarker(text) }; S.ev.push(e); S.sel = e.id; tsCommit();
    const inp = document.querySelector('#mvLines [data-evx="' + e.id + '"]'); if (inp && !e.marker) { inp.focus(); inp.select(); }
  }
  // Enter (while not typing) = stamp the selected row at the playhead, then select the next row
  function evStamp() {
    if (S.sel == null) return toast('Click a line first, then press Enter as it\u2019s sung', true);
    const e = evById(S.sel); if (!e) return;
    const idx = S.ev.indexOf(e), next = S.ev[idx + 1];
    tsPush(); e.t = now10(); S.sel = next ? next.id : e.id; tsCommit();
    const box = $('mvLines'), row = box.querySelector('[data-ev="' + S.sel + '"]');
    if (row && (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)) box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }
  function tsSerialize() {
    const f = (t) => { const m = Math.floor(t / 60), s = t - m * 60, whole = Math.abs(s - Math.round(s)) < 0.05; return m + ':' + (whole ? String(Math.round(s)).padStart(2, '0') : (s < 10 ? '0' : '') + s.toFixed(1)); };
    return S.ev.slice().sort((a, b) => a.t - b.t).map((e) => f(e.t) + '\t' + e.text).join('\n') + '\n';
  }
  async function saveTimestamps(quiet) {
    if (!S.song || !S.tsDirty) return true;
    try {
      await B().commitFile('data/lyrics/' + S.song.id + '-timestamps.txt', tsSerialize(), 'Timestamps (edited in Make Video): ' + S.song.id);
      S.tsDirty = false; renderLines(); if (!quiet) toast('Lyric changes saved');
      S.statusBits[0] = [true, S.lines.length + ' lyric lines']; showStatus();
      return true;
    } catch (e) { toast('Could not save lyrics: ' + e.message, true); return false; }
  }
  function markLine() {
    const i = S.shown; if (i === S._marked) return; S._marked = i;
    const box = $('mvLines');
    box.querySelectorAll('.mv-line').forEach((r) => {
      const on = r.dataset.li != null && +r.dataset.li === i; r.classList.toggle('cur', on);
      if (on && !audio.paused) box.scrollTop = r.offsetTop - box.clientHeight / 2;
    });
    if (S.move === 'line') syncControls();
  }
  function jumpToLine(i) {
    const L = S.lines[i]; if (!L) return;
    const words = L.words.filter((w) => !w.br), last = words.length ? words[words.length - 1].at : L.start;
    S.pick = i; S.sel = L.evId;
    audio.currentTime = Math.max(0, Math.min(last + 0.45, Math.min(L.end, L.start + S.cfg.maxHold) - 0.15) - S.cfg.offset);
    renderLines(); syncControls();
  }

  // ---------- backgrounds UI ----------
  function renderBg() {
    const box = $('mvBgList'); if (!box) return;
    if (document.activeElement && document.activeElement.classList.contains('mv-bgt')) { S.bgPending = true; return; }
    const list = S.bg[S.fmt];
    box.innerHTML = list.length ? list.map((b, i) => {
      const th = b.thumb ? '<img src="' + b.thumb + '">' : '<div class="mv-ph">' + (b.kind === 'video' ? '&#9654;' : '&#9635;') + '</div>';
      const state = (!b.url ? '<span class="mv-warn">re-pick this file (or pick its folder)</span>' : b.err ? '<span class="mv-warn">can\u2019t load \u2014 check the link</span>'
        : !b.ready ? '<span class="mv-dim">loading\u2026</span>' : (b.kind === 'video' ? '<span class="mv-tag">VIDEO ' + fmtS(b.el.duration) + '</span>' : ''))
        + ' <span class="mv-dim">' + (b.src ? 'Dropbox' : 'local file') + '</span>';
      return '<div class="mv-bg">' + th + '<div class="mv-bgn"><div title="' + esc(b.name) + '">' + esc(b.name) + '</div>' + state + '</div>'
        + '<input class="mv-bgt" data-bgt="' + i + '" value="' + (b.start == null ? '' : fmtT(b.start)) + '" placeholder="auto" title="Start time M:SS (blank = auto)">'
        + (i ? '<button class="mv-ib" data-bgup="' + i + '" title="Move up">&#8593;</button>' : '')
        + '<button class="mv-ib" data-bgrm="' + i + '" title="Remove">&#10005;</button></div>';
    }).join('') : '<div class="mv-dim">No ' + (S.fmt === '16' ? '16:9' : '9:16') + ' backgrounds yet \u2014 add your video or images below' + (S.dirFiles.length ? ', or click one in the folder list above' : '') + '.</div>';
  }
  function renderEnd() {
    const el = $('mvEndName'); if (!el) return;
    const e = S.end[S.fmt];
    el.innerHTML = e ? '&mdash; ' + esc(e.name) + (!e.url ? ' <span class="mv-warn">(re-pick)</span>' : e.err ? ' <span class="mv-warn">(can\u2019t load)</span>' : '') : '<span class="mv-dim">(none)</span>';
  }
  function addFiles(files, asEnd) {
    Array.from(files).forEach((f) => {
      const url = URL.createObjectURL(f);
      const miss = allItems().find((x) => !x.url && x.name === f.name); // re-pick of a remembered local file
      if (miss) { miss.url = url; mount(miss); return; }
      const it = { name: f.name, src: null, kind: kindOf(f.name) === 'video' || /^video\//.test(f.type) ? 'video' : 'image', start: null, url: url };
      mount(it);
      if (asEnd) S.end[S.fmt] = it; else S.bg[S.fmt].push(it);
    });
    S.dirty = true; renderBg(); renderEnd();
  }
  function addLink(v, asEnd) {
    v = (v || '').trim(); if (!v) return false;
    if (/dropbox\.com\/scl\/fo\//i.test(v)) { toast('That\u2019s a Dropbox FOLDER link \u2014 right-click the file itself and copy its link', true); return false; }
    const it = itemFrom({ src: v });
    if (asEnd) S.end[S.fmt] = it; else S.bg[S.fmt].push(it);
    S.dirty = true; renderBg(); renderEnd(); return true;
  }

  // ---------- folder ----------
  async function pickFolder() {
    if (!window.showDirectoryPicker) { $('mvDirInput').click(); return; }
    try {
      const h = await window.showDirectoryPicker({ id: 'htr-make-video', mode: 'readwrite' });
      const files = [];
      for await (const [name, fh] of h.entries()) if (fh.kind === 'file' && MEDIA.test(name) && !OUTPUT.test(name)) files.push({ name: name, get: () => fh.getFile() });
      S.dir = h; S.dirFiles = files;
      $('mvFolderName').innerHTML = '&#128193; <b>' + esc(h.name) + '</b> &mdash; finished videos save here.';
    } catch (e) { if (e.name !== 'AbortError') toast('Folder: ' + e.message, true); return; }
    afterFolder();
  }
  function onDirInput(inp) { // fallback for browsers without the folder API: read-only
    S.dir = null;
    S.dirFiles = Array.from(inp.files).filter((f) => MEDIA.test(f.name) && !OUTPUT.test(f.name) && (f.webkitRelativePath || '').split('/').length === 2).map((f) => ({ name: f.name, get: async () => f }));
    $('mvFolderName').textContent = 'Folder loaded (this browser can\u2019t save into it \u2014 videos will download instead).';
    afterFolder();
  }
  async function afterFolder() {
    S.dirFiles.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of allItems()) if (!it.url) { const f = S.dirFiles.find((x) => x.name === it.name); if (f) { it.url = URL.createObjectURL(await f.get()); mount(it); } }
    renderFolder(); renderBg(); renderEnd();
    if (!S.dirFiles.length) toast('No audio, video or images found in that folder', true);
  }
  function renderFolder() {
    const box = $('mvFolder'); if (!box) return;
    if (!S.dirFiles.length) { box.innerHTML = ''; return; }
    box.innerHTML = S.dirFiles.map((f, i) => { const au = AUDIO_EXT.test(f.name), k = au ? 'audio' : kindOf(f.name); return '<span class="mv-chip" data-fi="' + i + '">' + (au ? '&#127925; ' : k === 'video' ? '&#127916; ' : '&#128444; ') + esc(f.name) + '</span>'; }).join('')
      + '<div class="mv-dim" style="width:100%">Click &#127916;/&#128444; to add it as a ' + (S.fmt === '16' ? '16:9' : '9:16') + ' background &middot; Shift+click = end card &middot; click &#127925; to use that audio instead of the Dropbox MP3.</div>';
  }
  async function useFolderFile(i, shift) {
    const f = S.dirFiles[i]; if (!f) return;
    const file = await f.get();
    if (AUDIO_EXT.test(f.name)) { audio.src = URL.createObjectURL(file); S.audioName = f.name + ' (local)'; showStatus(); toast('Using local audio: ' + f.name); return; }
    addFiles([file], shift);
  }

  // ---------- song ----------
  function showStatus() {
    const s = S.statusBits || []; const box = $('mvStatus'); if (!box) return;
    box.innerHTML = s.map((b) => '<span class="' + (b[0] ? 'ok' : 'no') + '">' + (b[0] ? '&#10003; ' : '&#9888; ') + esc(b[1]) + '</span>').join('')
      + (S.audioName ? '<span class="mv-dim">Audio: ' + esc(S.audioName) + '</span>' : '');
  }
  async function loadSongs() {
    const b = B(); if (!b.gh) throw new Error('Studio not unlocked yet');
    const sf = await b.gh(P('data/master-songs.json'));
    S.songs = JSON.parse(b.b64decode(sf.content));
  }
  function fillArtists() {
    const sel = $('mvArtist'); if (sel.options.length > 1) return;
    const arts = (B().getArtists && B().getArtists()) || [];
    const nm = (id) => { const a = arts.find((x) => x.id === id); return (a && (a.name || a.displayName || a.artistName)) || id; };
    const ids = Array.from(new Set(S.songs.map((s) => s.artistId).filter(Boolean)));
    sel.innerHTML = '<option value="">\u2014 pick an artist \u2014</option>' + ids.map((id) => ({ id: id, n: nm(id) })).sort((a, b) => a.n.localeCompare(b.n))
      .map((o) => '<option value="' + esc(o.id) + '">' + esc(o.n) + '</option>').join('');
  }
  function fillSongs() {
    const aid = $('mvArtist').value;
    const mine = S.songs.filter((s) => s.artistId === aid).sort((a, b) => ((a.album || '') + a.title).localeCompare((b.album || '') + b.title));
    $('mvSong').innerHTML = '<option value="">\u2014 pick a song \u2014</option>' + mine.map((s) => '<option value="' + esc(s.id) + '">' + esc((s.album || 'Singles') + ' \u2014 ' + s.title) + '</option>').join('');
  }
  async function loadTimestamps() {
    const b = B();
    S.tsDirty = false; S.tsHist = []; S.sel = null;
    try { const f = await b.gh(P('data/lyrics/' + S.song.id + '-timestamps.txt?ref=main')); S.ev = parseEvents(b.b64decode(f.content)); S.lines = deriveLines(S.ev); return true; }
    catch (e) { S.ev = []; S.lines = []; return false; }
  }
  async function pickSong(id) {
    if (S.rec) { toast('Finish or cancel the render first', true); $('mvSong').value = S.song ? S.song.id : ''; return; }
    if ((S.dirty || S.tsDirty) && S.song && S.song.id !== id && !confirm('Unsaved ' + (S.tsDirty ? 'lyric edits and ' : '') + 'video setup changes for "' + S.song.title + '" will be lost. Switch songs anyway?')) { $('mvSong').value = S.song.id; return; }
    const song = S.songs.find((s) => s.id === id); if (!song) return;
    const b = B();
    audio.pause(); allItems().forEach((it) => { if (it.el && it.el.pause) it.el.pause(); });
    Object.assign(S, { song: song, lines: [], pick: -1, shown: -1, cfg: clone(DEF), bg: { '16': [], '9': [] }, end: { '16': null, '9': null }, dirty: false, total: 0, hooks: [] });
    H.sel = null; H.play = null; H.baseKey = ''; H.v0 = 0; H.v1 = 0;
    $('mvSongName').textContent = '\u2014 ' + song.title;
    const src = dbx(b.audioOf(song));
    audio.src = src || ''; S.audioName = src ? nameOf(src) : '';
    const bits = [];
    const hasTs = await loadTimestamps();
    bits.push(hasTs ? [true, S.lines.length + ' lyric lines'] : [false, 'no saved timestamps yet']);
    bits.push(src ? [true, 'audio'] : [false, 'no MP3 link on this song \u2014 pick its folder and click the MP3']);
    try {
      const f = await b.gh(P('data/video-projects/' + song.id + '.json?ref=main'));
      const p = JSON.parse(b.b64decode(f.content));
      S.cfg = Object.assign(clone(DEF), p.cfg || {});
      ['16', '9'].forEach((k) => { S.bg[k] = ((p.bg && p.bg[k]) || []).map(itemFrom); S.end[k] = p.end && p.end[k] ? itemFrom(p.end[k]) : null; });
      S.hooks = (Array.isArray(p.hooks) ? p.hooks : []).filter((h) => h && HK[h.type]).map((h) => Object.assign({ id: ++_uid, on: true }, h));
      bits.push([true, 'saved video setup loaded']);
    } catch (e) { bits.push([true, 'new video setup']); }
    S.statusBits = bits; showStatus();
    if (S.dirFiles.length) await afterFolder();
    renderLines(); renderBg(); renderEnd(); syncControls();
    ensureCurrentFont();
    hkRenderList(); if (H.mode === 'hooks') { hkDraw(); hkAnalyze(); }
  }
  async function saveSetup() {
    if (!S.song) return toast('Pick a song first', true);
    const pack = (it) => (it ? { name: it.name, src: it.src || null, kind: it.kind, start: it.start == null ? null : Math.round(it.start * 10) / 10 } : null);
    const data = { version: 1, song: S.song.id, updated: new Date().toISOString(), cfg: S.cfg,
      bg: { '16': S.bg['16'].map(pack), '9': S.bg['9'].map(pack) }, end: { '16': pack(S.end['16']), '9': pack(S.end['9']) },
      hooks: S.hooks.map((h) => ({ type: h.type, start: h.start, len: h.len, n: h.n, on: h.on !== false, done: h.done || null })) };
    if (S.tsDirty && !(await saveTimestamps(true))) return;
    try {
      $('mvSave').disabled = true;
      await B().commitFile('data/video-projects/' + S.song.id + '.json', JSON.stringify(data, null, 2) + '\n', 'Video setup: ' + S.song.id);
      S.dirty = false;
      const local = allItems().some((it) => !it.src);
      toast('Video setup saved' + (local ? ' \u2014 local files are remembered by name; pick the song folder next time and they reattach' : ''));
    } catch (e) { toast('Save failed: ' + e.message, true); }
    $('mvSave').disabled = false;
  }

  // ---------- audio graph + render ----------
  function ensureGraph() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const src = AC.createMediaElementSource(audio);
    monGain = AC.createGain(); src.connect(monGain); monGain.connect(AC.destination);
    // Renders do NOT record the <audio> player: after a rewind it can push the first slice of the song into the
    // stream twice (heard as the first note repeating ~0.5s in). Renders play a decoded copy on the audio clock instead.
    mdest = AC.createMediaStreamDestination();
  }
  let decoded = { url: '', buf: null };
  async function decodeSong() {
    const url = audio.currentSrc || audio.src;
    if (decoded.url === url && decoded.buf) return decoded.buf;
    setRenderMsg('Preparing the audio for recording\u2026');
    // no-store: a plain fetch can sit behind the preview player's own download of the same file (browser cache lock)
    const ab = await (await fetch(url, url.startsWith('blob:') ? {} : { cache: 'no-store' })).arrayBuffer();
    const buf = await AC.decodeAudioData(ab);
    decoded = { url: url, buf: buf };
    return buf;
  }
  function setRenderMsg(t) { const e = $('mvRenderMsg'); if (e) e.textContent = t; }
  // position in the song while recording = the audio clock, the same clock the recorded sound runs on
  function recTime() { const R = S.rec; if (!R) return 0; const f = R.from || 0; return R.t0 != null ? f + Math.max(0, AC.currentTime - R.t0) : f; }
  function togglePlay() {
    if (S.rec) return;
    if (!audio.src) return toast('No audio for this song yet', true);
    ensureGraph(); H.play = null;
    if (audio.paused) audio.play().catch((e) => toast('Audio: ' + e.message, true)); else audio.pause();
  }
  function pickMime() {
    const c = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return (window.MediaRecorder && c.find((m) => MediaRecorder.isTypeSupported(m))) || '';
  }
  async function makeVideo(limit, opt) {
    const O = opt || {};
    if (S.rec) return;
    if (!S.song) return toast('Pick a song first', true);
    if (!audio.src) return toast('No audio \u2014 add the MP3 link in Song Catalog, or pick the song folder and click the MP3', true);
    if (S.lyricsOn && !S.lines.length) return toast('No saved timestamps \u2014 stamp the lyrics first (or choose No lyrics)', true);
    const fmts = O.fmts || (S.out === 'both' ? ['16', '9'] : [S.out]);
    const used = [].concat.apply([], fmts.map((f) => S.bg[f].concat(S.end[f] ? [S.end[f]] : [])));
    const broken = used.filter((it) => !it.url || it.err);
    if (broken.length) return toast('Fix these backgrounds first: ' + broken.map((b) => b.name).join(', '), true);
    if (used.some((it) => !it.ready)) return toast('Backgrounds are still loading \u2014 give it a few seconds', true);
    const empty = fmts.filter((f) => !S.bg[f].length);
    if (empty.length && !O.quiet && !confirm('No backgrounds for ' + empty.map((f) => (f === '16' ? '16:9' : '9:16')).join(' & ') + ' \u2014 that video will be black behind the lyrics. Keep going?')) return;
    const mime = pickMime(); if (!mime) return toast('This browser can\u2019t record video \u2014 use Chrome or Edge', true);
    ensureGraph(); await AC.resume();
    await ensureCurrentFont();
    audio.pause();
    let songBuf;
    try { songBuf = await decodeSong(); } catch (e) { setRenderMsg(''); return toast('Couldn\u2019t load the song audio for recording: ' + e.message, true); }
    if (!S.total) S.total = songBuf.duration;
    const from = clamp(O.from || 0, 0, Math.max(0, songBuf.duration - 1));
    if (from) limit = Math.min(limit || songBuf.duration, songBuf.duration - from);
    syncVideos(fmts, from, false); await wait(700); // let video layers land on the first frame
    const at = mdest.stream.getAudioTracks()[0], ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    const list = fmts.map((f) => {
      const [W, H] = SIZES[f]; const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); drawFrame(ctx, f, from, 1, false, S.lyricsOn);
      const ms = new MediaStream([c.captureStream(30).getVideoTracks()[0], at.clone()]);
      const rec = new MediaRecorder(ms, { mimeType: mime, videoBitsPerSecond: 16000000, audioBitsPerSecond: 192000 });
      const r = { fmt: f, ctx: ctx, rec: rec, ms: ms, chunks: [], web: null };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
      if (!O.fmts && $('mvWeb').checked) { // second recorder on the same frames: ~2.5 Mbps is plenty for lyric videos on a phone or laptop
        const wr = new MediaRecorder(ms, { mimeType: mime, videoBitsPerSecond: 2500000, audioBitsPerSecond: 160000 });
        r.web = { rec: wr, chunks: [] };
        wr.ondataavailable = (e) => { if (e.data && e.data.size) r.web.chunks.push(e.data); };
      }
      return r;
    });
    S.rec = { list: list, lyrics: S.lyricsOn, ext: ext, mime: mime, limit: limit || 0, hidden: false, t0: null,
      from: from, names: O.names || null, sub: O.sub || '', label: O.label || '', fade: !!O.fade };
    const node = AC.createBufferSource(); node.buffer = songBuf;
    const listen = AC.createGain(); listen.gain.value = $('mvListen').checked ? 1 : 0;
    const vol = AC.createGain();                  // fades for clips that start / stop mid-song
    node.connect(vol); vol.connect(mdest); vol.connect(listen); listen.connect(AC.destination);
    node.onended = () => { if (S.rec && S.rec.node === node) finishRender(); };
    S.rec.node = node; S.rec.listen = listen;
    ['mvGo', 'mvTest', 'mvSave', 'hkGo'].forEach((id) => { if ($(id)) $(id).disabled = true; });
    $('mvCancel').classList.remove('hidden'); $('mvProg').classList.remove('hidden');
    list.forEach((r) => { r.rec.start(1000); if (r.web) r.web.rec.start(1000); });
    S.rec.acStart = AC.currentTime;
    const t0 = AC.currentTime + (from ? 0.15 : 0.25); // recorders are running; the song starts exactly here on the audio clock
    if (from) { vol.gain.setValueAtTime(0, t0); vol.gain.linearRampToValueAtTime(1, t0 + 0.06); }
    if (O.fade && S.rec.limit) { vol.gain.setValueAtTime(1, t0 + Math.max(0.1, S.rec.limit - 1)); vol.gain.linearRampToValueAtTime(0, t0 + S.rec.limit); }
    node.start(t0, from); S.rec.t0 = t0;
    if (S.rec.limit) node.stop(t0 + S.rec.limit + 0.05);
    startClock();
    return new Promise((res) => { S.rec.done = res; });
  }
  async function finishRender() {
    const R = S.rec; if (!R || R.finishing) return; R.finishing = true;
    stopClock();
    R.recorded = AC.currentTime - (R.acStart || AC.currentTime);
    try { R.node.onended = null; R.node.stop(); } catch (e) { }
    try { R.node.disconnect(); R.listen.disconnect(); } catch (e) { }
    const stopRec = (m) => new Promise((res) => { m.onstop = res; try { m.stop(); } catch (e) { res(); } });
    await Promise.all(R.list.map((r) => Promise.all([stopRec(r.rec), r.web ? stopRec(r.web.rec) : null])));
    R.list.forEach((r) => r.ms.getTracks().forEach((t) => t.stop()));
    S.rec = null;
    audio.currentTime = 0;
    ['mvGo', 'mvTest', 'mvSave'].forEach((id) => { $(id).disabled = false; });
    $('mvCancel').classList.add('hidden'); $('mvProg').classList.add('hidden');
    if ($('hkNow')) $('hkNow').textContent = '';
    if (R.cancel) { $('mvRenderMsg').textContent = 'Render cancelled.'; if (H.queue) H.queue.cancel = true; if (R.done) R.done({ cancel: true }); hkRenderList(); return; }
    const msgs = [];
    for (const r of R.list) {
      const blob = await withDuration(new Blob(r.chunks, { type: R.mime.split(';')[0] }), R.recorded);
      const name = R.names ? R.names[r.fmt] + '.' + R.ext : S.song.id + (R.lyrics ? '-lyric' : '') + '-' + (r.fmt === '16' ? '16x9' : '9x16') + (R.limit ? '-test' : '') + '.' + R.ext;
      msgs.push(await saveBlob(blob, name, R.sub) + ' <span class="mv-dim">(' + (blob.size / 1048576).toFixed(R.names ? 1 : 0) + ' MB)</span>');
      if (r.web && r.web.chunks.length) {
        const wb = await withDuration(new Blob(r.web.chunks, { type: R.mime.split(';')[0] }), R.recorded);
        msgs.push(await saveBlob(wb, name.replace(/(\.[a-z0-9]+)$/i, '-web$1')) + ' <span class="mv-dim">(' + (wb.size / 1048576).toFixed(0) + ' MB \u2014 website copy)</span>');
      }
    }
    $('mvRenderMsg').innerHTML = msgs.join('<br>') + (R.hidden ? '<br><span class="mv-warn">&#9888; This tab was hidden for part of the render. Give the video a quick watch \u2014 if a background video froze anywhere, re-render with the tab showing.</span>' : '');
    if (!R.names) toast(R.limit ? 'Test clip done' : 'Video done');
    hkRenderList();
    if (R.done) R.done({ cancel: false, msgs: msgs });
  }
  // Browsers record MP4 as a stream of fragments and leave the length in the header at 0, so players show no end
  // time and a stuck progress bar (Chrome even reports just the first fragment, ~3 s). Write the real length into the
  // header boxes (mvhd / tkhd / mdhd / mehd) - only the first few KB are touched, the rest of the file is reused as-is.
  async function withDuration(blob, seconds) {
    if (!/mp4/.test(blob.type) || !(seconds > 0)) return blob;
    try {
      const headLen = Math.min(blob.size, 256 * 1024);
      const buf = await blob.slice(0, headLen).arrayBuffer(), dv = new DataView(buf), found = {};
      let stop = false;
      const walk = (start, end) => {
        let p = start;
        while (!stop && p + 8 <= end) {
          let size = dv.getUint32(p), hs = 8;
          const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
          if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hs = 16; }
          if (type === 'moof' || type === 'mdat') { stop = true; break; }
          if (size < 8 || p + size > headLen) { stop = true; break; }
          if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'mvex') walk(p + hs, p + size);
          else if (type === 'mvhd' || type === 'tkhd' || type === 'mdhd' || type === 'mehd') (found[type] = found[type] || []).push(p);
          p += size;
        }
      };
      walk(0, headLen);
      if (!found.mvhd) return blob;
      const put = (off, ver, val) => { if (ver) dv.setBigUint64(off, BigInt(Math.round(val))); else dv.setUint32(off, Math.round(val)); };
      const mv = found.mvhd[0], mvVer = dv.getUint8(mv + 8), movieTS = dv.getUint32(mv + (mvVer ? 28 : 20));
      put(mv + (mvVer ? 32 : 24), mvVer, seconds * movieTS);
      (found.tkhd || []).forEach((p) => { const v = dv.getUint8(p + 8); put(p + (v ? 36 : 28), v, seconds * movieTS); });
      (found.mdhd || []).forEach((p) => { const v = dv.getUint8(p + 8), ts = dv.getUint32(p + (v ? 28 : 20)); put(p + (v ? 32 : 24), v, seconds * ts); });
      (found.mehd || []).forEach((p) => { const v = dv.getUint8(p + 8); put(p + 12, v, seconds * movieTS); });
      return new Blob([buf, blob.slice(headLen)], { type: blob.type });
    } catch (e) { console.warn('duration fix skipped', e); return blob; }
  }
  async function saveBlob(blob, name, sub) {
    if (S.dir) {
      try {
        const dir = sub ? await S.dir.getDirectoryHandle(sub, { create: true }) : S.dir;
        const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable();
        await w.write(blob); await w.close();
        return '&#10003; Saved <b>' + esc(name) + '</b> into ' + esc(S.dir.name + (sub ? '/' + sub : ''));
      } catch (e) { console.warn('folder save failed, downloading instead', e); }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 120000);
    return '&#10003; Downloaded <b>' + esc(name) + '</b>';
  }

  // ---------- hooks: short clips for TikTok / Reels / Shorts, cut from the same render engine ----------
  // A hook = { id, type, start, len, n, on, done }. Rendered straight from the song timeline (same backgrounds,
  // lyrics and look as the full video), both frame sizes at once, saved into <song folder>/Hooks/.
  // len = what a new one starts at; lo..hi = the usual range (shown as a hint only - any length from 3 s to 2 min is
  // allowed, because a hook should start and stop where the song does); sMin..sMax = what Suggest hooks tries
  const HK = {
    quick: { name: 'Quick', short: 'Q', len: 15, lo: 10, hi: 20, sMin: 12, sMax: 18, color: '#4cd08a', count: 8, gap: 6, ov: 0.5 },
    standard: { name: 'Standard', short: 'S', len: 30, lo: 22, hi: 40, sMin: 26, sMax: 34, color: '#ff6a4d', count: 4, gap: 10, ov: 0.5 },
    extended: { name: 'Extended', short: 'E', len: 45, lo: 40, hi: 75, sMin: 45, sMax: 60, color: '#58b7ff', count: 2, gap: 18, ov: 0.4 }
  };
  const HK_MIN = 3, HK_MAX = 120;
  const HK_ORDER = ['quick', 'standard', 'extended'];
  const SEC_COL = { chorus: '#9a7424', pre: '#2b6f69', post: '#80582c', verse: '#34507f', bridge: '#62428c', intro: '#3b3b3b', outro: '#3b3b3b', inst: '#4f5c30', other: '#4a4a4a' };
  const H = { mode: 'lines', peaks: null, energy: null, forUrl: '', loading: false, sel: null, drag: null, play: null, queue: null, rects: [], base: null, baseKey: '', G: 74, v0: 0, v1: 0 };
  const hkById = (id) => S.hooks.find((h) => h.id === +id);
  const hkDone = (h) => !!(h.done && Math.abs(h.done.start - h.start) < 0.05 && Math.abs(h.done.len - h.len) < 0.05);
  const r10 = (x) => Math.round(x * 10) / 10;
  function hkTotal() { return S.total || H.dur || 0; }
  function sectionsOf() {
    const mk = S.ev.filter((e) => e.marker && !/^\[(gap|start|end)\]$/i.test(e.text)).sort((a, b) => a.t - b.t);
    return mk.map((m, i) => ({ name: m.text.replace(/^\[|\]$/g, '').trim(), s: m.t, e: i + 1 < mk.length ? mk[i + 1].t : hkTotal() }));
  }
  function secKind(name) {
    const n = String(name).toLowerCase();
    if (/pre[\s-]?chorus|build|lift|climb/.test(n)) return 'pre';
    if (/post[\s-]?chorus/.test(n)) return 'post';
    if (/chorus|hook|refrain/.test(n)) return 'chorus';
    if (/bridge|middle/.test(n)) return 'bridge';
    if (/verse/.test(n)) return 'verse';
    if (/intro/.test(n)) return 'intro';
    if (/outro|coda|ending|fade/.test(n)) return 'outro';
    if (/solo|instrumental|interlude|break|drop|riff/.test(n)) return 'inst';
    return 'other';
  }
  // waveform peaks + loudness (0..1 per quarter second) from the decoded song
  async function hkAnalyze() {
    const url = audio.currentSrc || audio.src;
    if (!S.song || !url || H.loading) return;
    if (H.forUrl === url && H.energy) return;
    H.loading = true; hkDraw();
    const keep = $('mvRenderMsg') ? $('mvRenderMsg').innerHTML : '';
    try {
      ensureGraph();
      const buf = await decodeSong();
      const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
      const N = Math.min(60000, Math.max(2400, Math.ceil(buf.duration * 100))), per = Math.max(1, Math.floor(a.length / N)), peaks = new Float32Array(N);
      for (let i = 0; i < N; i++) { let m = 0; for (let j = i * per, z = Math.min(a.length, j + per); j < z; j += 3) { const v = (Math.abs(a[j]) + Math.abs(b[j])) / 2; if (v > m) m = v; } peaks[i] = m; }
      const win = Math.floor(buf.sampleRate * 0.25), M = Math.ceil(a.length / win), en = new Float32Array(M);
      for (let i = 0; i < M; i++) { let s = 0, c = 0; for (let j = i * win, z = Math.min(a.length, j + win); j < z; j += 6) { const v = (a[j] + b[j]) / 2; s += v * v; c++; } en[i] = Math.sqrt(s / Math.max(1, c)); }
      const srt = Array.from(en).sort((x, y) => x - y), lo = srt[Math.floor(M * 0.1)] || 0, hi = srt[Math.floor(M * 0.95)] || 1;
      for (let i = 0; i < M; i++) en[i] = clamp((en[i] - lo) / Math.max(1e-6, hi - lo), 0, 1);
      const pm = Math.max.apply(null, Array.from(peaks)) || 1;
      for (let i = 0; i < N; i++) peaks[i] /= pm;
      Object.assign(H, { peaks: peaks, energy: en, forUrl: url, dur: buf.duration });
      if (!S.total) S.total = buf.duration;
    } catch (e) { toast('Couldn’t read the song for the waveform: ' + e.message, true); }
    if ($('mvRenderMsg')) $('mvRenderMsg').innerHTML = keep;
    H.loading = false; H.baseKey = ''; hkDraw(); hkRenderList();
  }
  const enAt = (t) => (H.energy ? H.energy[clamp(Math.floor(t / 0.25), 0, H.energy.length - 1)] : 0.5);
  function enMean(a, b) { let s = 0, c = 0; for (let t = a; t < b; t += 0.25) { s += enAt(t); c++; } return c ? s / c : 0; }
  // where a hook may start: just ahead of each lyric line (so the first word isn't clipped) and on each section marker
  function hkSnaps() {
    const c = new Set();
    S.lines.forEach((L) => c.add(Math.max(0, Math.round((L.start - 0.3) * 10) / 10)));
    sectionsOf().forEach((s) => c.add(Math.round(s.s * 10) / 10));
    return Array.from(c).sort((a, b) => a - b);
  }
  function hkEnds() {
    const c = new Set();
    S.lines.forEach((L) => { c.add(r10(vocalEnd(L) + 0.3)); c.add(r10(L.start - 0.1)); });
    sectionsOf().forEach((s) => c.add(r10(s.s)));
    return Array.from(c).filter((t) => t > 0).sort((a, b) => a - b);
  }
  // snap distance is a few pixels, so zoomed in you can place it exactly
  function hkSnap(t, ends) {
    const tol = H.pxSec ? Math.min(0.9, 8 / H.pxSec) : 0.9;
    let best = t, d = tol;
    (ends ? hkEnds() : hkSnaps()).forEach((s) => { if (Math.abs(s - t) < d) { d = Math.abs(s - t); best = s; } });
    return best;
  }
  // "how chorus-like" each half second is: section markers first, repeated lyric lines as the fallback
  function hkChorusMap() {
    const T = hkTotal(), secs = sectionsOf(), key = (x) => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(), reps = {};
    S.lines.forEach((L) => { const k = key(L.text); reps[k] = (reps[k] || 0) + 1; });
    const KW = { chorus: 1, post: 0.75, pre: 0.55, bridge: 0.35, verse: 0.25, inst: 0.2, other: 0.3, intro: 0, outro: 0.1 };
    const out = new Float32Array(Math.ceil(T * 2) + 2);
    for (let i = 0; i < out.length; i++) {
      const t = i / 2; let v = null;
      secs.forEach((s) => { if (t >= s.s && t < s.e) v = KW[secKind(s.name)]; });
      const L = S.lines.find((x) => t >= x.start && t < Math.min(x.end, x.start + S.cfg.maxHold));
      const r = L ? reps[key(L.text)] : 0, rv = r >= 3 ? 0.9 : r === 2 ? 0.65 : L ? 0.25 : 0.1;
      out[i] = v == null ? rv : Math.max(v, rv * 0.8);
    }
    return out;
  }
  // roughly when the singing of a line stops (last word + a beat), never past the next line
  function vocalEnd(L) { const w = L.words.filter((x) => !x.br); return Math.min(L.end, (w.length ? w[w.length - 1].at : L.start) + 0.8); }
  const midLine = (t) => S.lines.some((L) => t > L.start + 0.15 && t < vocalEnd(L));
  // starting or ending in the middle of a sung line sounds chopped
  function hkEndScore(e) {
    if (e > hkTotal() - 0.2) return -0.3;
    return midLine(e) ? -0.15 : 0.1;
  }
  function hkScore(s, len, cm, secStarts, first, hookStarts) {
    const e = s + len; if (s < 0 || e > hkTotal() + 0.01) return -9;
    let c = 0, n = 0; for (let t = s; t < e; t += 0.5) { c += cm[Math.floor(t * 2)] || 0; n++; } c /= Math.max(1, n);
    let sc = 0.45 * c + 0.3 * enMean(s, e) + 0.25 * enMean(s, s + 2) + hkEndScore(e);
    if (midLine(s)) sc -= 0.2;
    if (s < first - 1.5) sc -= 0.35;                                   // a slow intro gets scrolled past
    if (secStarts.some((x) => Math.abs(x - s) < 0.4)) sc += 0.08;       // starting on a section edge feels intentional
    if (hookStarts.some((x) => Math.abs(x - s) < 0.5)) sc += 0.15;      // ...and on the chorus itself even more
    return sc;
  }
  async function hkSuggest() {
    if (!S.song) return toast('Pick a song first', true);
    if (!S.lines.length) return toast('This song needs saved timestamps first — that’s how hooks find the chorus', true);
    if (S.hooks.length && !confirm('Replace your ' + S.hooks.length + ' hook' + (S.hooks.length > 1 ? 's' : '') + ' with fresh suggestions?')) return;
    await hkAnalyze();
    const cm = hkChorusMap(), secs = sectionsOf(), secStarts = secs.map((s) => s.s), first = S.lines[0].start, out = [];
    const hookStarts = secs.filter((s) => secKind(s.name) === 'chorus').map((s) => { const L = S.lines.find((x) => x.start >= s.s - 0.1); return L ? L.start - 0.3 : s.s; });
    HK_ORDER.forEach((type) => {
      const d = HK[type], scored = [], cs = new Set(hkSnaps());
      // also try clips that END cleanly just after a line finishes
      S.lines.forEach((L) => { const s = r10(vocalEnd(L) + 0.3 - d.len); if (s >= 0) cs.add(s); });
      const cands = Array.from(cs);
      cands.forEach((s) => {
        let best = null;
        for (let L = d.sMin; L <= d.sMax + 0.001; L += 0.5) { const v = hkScore(s, L, cm, secStarts, first, hookStarts) - 0.006 * Math.abs(L - d.len); if (!best || v > best.v) best = { s: s, len: L, v: v }; }
        if (best && best.v > -5) scored.push(best);
      });
      scored.sort((a, b) => b.v - a.v);
      const chosen = [], floor = scored.length ? scored[0].v - 0.45 : 0;   // only spots nearly as good as the best one
      for (const c of scored) {
        if (chosen.length >= d.count || c.v < floor) break;
        const clash = chosen.some((x) => Math.abs(x.s - c.s) < d.gap || (Math.min(x.s + x.len, c.s + c.len) - Math.max(x.s, c.s)) / Math.min(x.len, c.len) > d.ov);
        if (!clash) chosen.push(c);
      }
      chosen.sort((a, b) => a.s - b.s).forEach((c, i) => out.push({ id: ++_uid, type: type, start: c.s, len: c.len, n: i + 1, on: true }));
    });
    S.hooks = out; S.dirty = true; H.sel = out.length ? out[0].id : null;
    hkRenderList(); hkDraw();
    toast(out.length ? out.length + ' hooks suggested — drag them around, then Make hooks' : 'Couldn’t find good spots — add hooks by hand', !out.length);
  }
  function hkAdd(type) {
    if (!S.song) return toast('Pick a song first', true);
    const d = HK[type], T = hkTotal(); if (!T) return toast('The song is still loading', true);
    const len = Math.min(d.len, T), start = clamp(hkSnap(Math.max(0, (audio.currentTime || 0) - 0.3)), 0, Math.max(0, T - len));
    const n = S.hooks.filter((h) => h.type === type).reduce((m, h) => Math.max(m, h.n || 0), 0) + 1;
    const h = { id: ++_uid, type: type, start: Math.round(start * 10) / 10, len: len, n: n, on: true };
    S.hooks.push(h); S.dirty = true; H.sel = h.id;
    hkRenderList(); hkDraw();
  }
  // move (start only), or set exact start and/or end - lengths are free between 3 s and 2 min
  function hkSet(h, start, len) {
    const T = hkTotal();
    if (len != null) h.len = r10(clamp(len, HK_MIN, Math.min(HK_MAX, T || HK_MAX)));
    if (start != null) h.start = r10(clamp(start, 0, Math.max(0, T - h.len)));
    if (h.start + h.len > T) h.start = Math.max(0, r10(T - h.len));
    S.dirty = true;
  }
  function hkSetStart(h, t) { const end = h.start + h.len; t = clamp(t, 0, end - HK_MIN); h.len = r10(end - r10(t)); h.start = r10(t); S.dirty = true; }
  function hkSetEnd(h, t) { const T = hkTotal(); t = clamp(t, h.start + HK_MIN, Math.min(T, h.start + HK_MAX)); h.len = r10(t - h.start); S.dirty = true; }
  // zoomed view of the song (v0..v1 seconds); 0,0 = the whole song
  function hkView() { const T = hkTotal(); return H.v1 > H.v0 && H.v1 - H.v0 < T ? [H.v0, H.v1] : [0, T]; }
  function hkZoom(a, b) {
    const T = hkTotal(); if (!T) return;
    let w = clamp(b - a, 4, T); a = clamp(a, 0, T - w);
    if (w >= T - 0.01) { H.v0 = 0; H.v1 = 0; } else { H.v0 = a; H.v1 = a + w; }
    H.baseKey = ''; hkDraw();
  }
  function hkZoomHook() { const h = hkById(H.sel); if (!h) return toast('Click a hook first', true); const pad = Math.max(2, h.len * 0.15); hkZoom(h.start - pad, h.start + h.len + pad); }
  function hkPlay(id, tail) {
    const h = hkById(id); if (!h) return;
    if (H.play && H.play.id === h.id && !!H.play.tail === !!tail && !audio.paused) { audio.pause(); H.play = null; hkRenderList(); return; }
    if (!audio.src) return toast('No audio for this song yet', true);
    ensureGraph(); H.sel = h.id; H.play = { id: h.id, end: h.start + h.len, tail: !!tail };
    audio.currentTime = tail ? Math.max(h.start, h.start + h.len - 4) : h.start; audio.play().catch((e) => toast('Audio: ' + e.message, true));
    hkRenderList();
  }
  // ----- timeline -----
  function hkLanes() {
    const lanes = {};
    HK_ORDER.forEach((type) => {
      const rows = [];
      S.hooks.filter((h) => h.type === type).sort((a, b) => a.start - b.start).forEach((h) => {
        let r = rows.findIndex((end) => end <= h.start + 0.01); if (r < 0) { r = rows.length; rows.push(0); }
        rows[r] = h.start + h.len; h._row = r;
      });
      lanes[type] = Math.max(1, rows.length);
    });
    return lanes;
  }
  function hkGeom(W) {
    const lanes = hkLanes(), RH = 15, top = { band: 0, wave: 20 }, waveH = 64;
    let y = top.wave + waveH + 8; const lane = {};
    HK_ORDER.forEach((t) => { lane[t] = { y: y, h: lanes[t] * RH + 4 }; y += lane[t].h + 5; });
    return { W: W, H: y + 2, band: 18, waveY: top.wave, waveH: waveH, lane: lane, RH: RH };
  }
  function hkDraw() {
    const c = $('hkCanvas'); if (!c || H.mode !== 'hooks' || !built) return;
    const T = hkTotal(), dpr = window.devicePixelRatio || 1, W = Math.max(300, c.parentElement.clientWidth), g = hkGeom(W);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(g.H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(g.H * dpr); c.style.height = g.H + 'px'; H.baseKey = ''; }
    const G = H.G, [v0, v1] = hkView(), span = Math.max(0.001, v1 - v0), PW = W - G - 6;
    const x = c.getContext('2d'), X = (t) => G + (T ? (t - v0) / span : 0) * PW;
    H.pxSec = PW / span;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    // static layer: section band + waveform + line ticks, cached until something changes
    const key = [W, g.H, T, v0, v1, H.forUrl, S.ev.length, S.ev.map((e) => e.t + e.text).join('|').length, S.lines.length].join(':');
    if (H.baseKey !== key) {
      const b = H.base || (H.base = document.createElement('canvas'));
      b.width = c.width; b.height = c.height; const bx = b.getContext('2d'); bx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bx.fillStyle = '#0b0907'; bx.fillRect(0, 0, W, g.H);
      bx.font = '600 10px system-ui,sans-serif'; bx.textBaseline = 'middle';
      bx.fillStyle = '#8f8676'; bx.fillText('SECTIONS', 6, g.band / 2 + 1); bx.fillText('SONG', 6, g.waveY + g.waveH / 2);
      HK_ORDER.forEach((t) => { bx.fillStyle = HK[t].color; bx.fillText(HK[t].name.toUpperCase(), 6, g.lane[t].y + g.lane[t].h / 2); });
      if (T) {
        bx.save(); bx.beginPath(); bx.rect(G, 0, PW, g.H); bx.clip();
        const secs = sectionsOf();
        if (!secs.length) { bx.fillStyle = '#6d6556'; bx.fillText('no [section] markers — add some in the timestamps for colored sections', G + 4, g.band / 2 + 1); }
        secs.forEach((s) => {
          const k = secKind(s.name), x0 = X(s.s), x1 = X(s.e);
          bx.fillStyle = SEC_COL[k]; bx.fillRect(x0, 1, Math.max(1, x1 - x0 - 1), g.band - 2);
          bx.fillStyle = 'rgba(255,255,255,.12)'; bx.fillRect(x0, g.waveY, Math.max(1, x1 - x0 - 1), g.waveH); // faint tint behind the wave
          bx.fillStyle = SEC_COL[k]; bx.globalAlpha = 0.28; bx.fillRect(x0, g.waveY, Math.max(1, x1 - x0 - 1), g.waveH); bx.globalAlpha = 1;
          if (x1 - x0 > 24) { bx.save(); bx.beginPath(); bx.rect(x0, 0, x1 - x0 - 2, g.band); bx.clip(); bx.fillStyle = '#fff'; bx.fillText(s.name, x0 + 4, g.band / 2 + 1); bx.restore(); }
        });
        bx.strokeStyle = 'rgba(230,189,82,.22)'; bx.lineWidth = 1;
        S.lines.forEach((L) => { const lx = Math.round(X(L.start)) + 0.5; bx.beginPath(); bx.moveTo(lx, g.waveY); bx.lineTo(lx, g.waveY + 5); bx.stroke(); });
        if (H.peaks) {
          const mid = g.waveY + g.waveH / 2, P = H.peaks, n = P.length;
          bx.fillStyle = '#cfc4ae';
          for (let px = G; px < W - 6; px++) {
            const i0 = Math.floor((v0 + (px - G) / PW * span) / T * n), i1 = Math.max(i0 + 1, Math.floor((v0 + (px + 1 - G) / PW * span) / T * n));
            let m = 0; for (let i = i0; i < i1 && i < n; i++) if (P[i] > m) m = P[i];
            const h = Math.max(1, m * (g.waveH / 2 - 3)); bx.fillRect(px, mid - h, 1, h * 2);
          }
        } else { bx.fillStyle = '#8f8676'; bx.fillText(H.loading ? 'Reading the song\u2026' : 'Waveform loads when the song audio is ready', G + 6, g.waveY + g.waveH / 2); }
        // time ruler along the bottom of the wave: finer ticks as you zoom in
        const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((st) => st * PW / span >= 55) || 60;
        bx.fillStyle = 'rgba(255,255,255,.55)'; bx.font = '10px system-ui,sans-serif';
        bx.strokeStyle = 'rgba(0,0,0,.85)'; bx.lineWidth = 3; bx.lineJoin = 'round';
        for (let tt = Math.ceil(v0 / step) * step; tt <= v1; tt += step) { const tx = X(tt), lb = step < 1 ? fmtT(tt) : fmtS(tt); bx.fillRect(Math.round(tx), g.waveY + g.waveH - 5, 1, 5); bx.strokeText(lb, tx + 3, g.waveY + g.waveH - 9); bx.fillText(lb, tx + 3, g.waveY + g.waveH - 9); }
        bx.restore();
      }
      HK_ORDER.forEach((t) => { bx.fillStyle = 'rgba(255,255,255,.035)'; bx.fillRect(G, g.lane[t].y, W - G - 6, g.lane[t].h); });
      H.baseKey = key;
    }
    x.clearRect(0, 0, W, g.H); x.drawImage(H.base, 0, 0, W, g.H);
    if (!T) return;
    // selected hook: tint the part of the song it covers
    const sel = hkById(H.sel);
    x.save(); x.beginPath(); x.rect(G, 0, PW, g.H); x.clip();
    if (sel) {
      x.fillStyle = HK[sel.type].color; x.globalAlpha = 0.16; x.fillRect(X(sel.start), 0, X(sel.start + sel.len) - X(sel.start), g.waveY + g.waveH); x.globalAlpha = 1;
      x.strokeStyle = HK[sel.type].color; x.lineWidth = 1; [sel.start, sel.start + sel.len].forEach((tt) => { const ex = Math.round(X(tt)) + 0.5; x.beginPath(); x.moveTo(ex, 0); x.lineTo(ex, g.H); x.stroke(); });
    }
    H.rects = [];
    x.font = '700 10.5px system-ui,sans-serif'; x.textBaseline = 'middle';
    S.hooks.forEach((h) => {
      const d = HK[h.type], L = g.lane[h.type], y0 = L.y + 2 + (h._row || 0) * g.RH, x0 = X(h.start), x1 = X(h.start + h.len), on = h.id === H.sel;
      x.globalAlpha = h.on === false ? 0.35 : 1;
      x.fillStyle = d.color; x.fillRect(x0, y0, Math.max(3, x1 - x0), g.RH - 3);
      if (on) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(x0 + 1, y0 + 1, Math.max(3, x1 - x0) - 2, g.RH - 5); }
      if (x1 - x0 > 16) { x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(x0 + 2, y0 + 2, 2, g.RH - 7); x.fillRect(x1 - 4, y0 + 2, 2, g.RH - 7); }
      x.fillStyle = '#111'; const lab = (x1 - x0 > 70 ? d.name + ' ' : d.short) + h.n + (x1 - x0 > 120 ? ' \u00b7 ' + h.len.toFixed(1) + 's' : '') + (hkDone(h) ? ' \u2713' : '');
      x.save(); x.beginPath(); x.rect(x0, y0, x1 - x0, g.RH); x.clip(); x.fillText(lab, x0 + 7, y0 + (g.RH - 3) / 2 + 1); x.restore();
      x.globalAlpha = 1;
      H.rects.push({ id: h.id, x0: x0, x1: Math.max(x0 + 3, x1), y0: y0, y1: y0 + g.RH - 3 });
    });
    x.restore();
    const t = S.rec ? recTime() : (audio.currentTime || 0), px = Math.round(X(t)) + 0.5;
    x.strokeStyle = '#ff3b30'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, g.H); x.stroke();
    const zl = $('hkZoomLbl'); if (zl) zl.textContent = span < T - 0.01 ? fmtS(v0) + '\u2013' + fmtS(v1) : 'whole song';
    H.geom = g; H.X = X; H.tAt = (cx) => clamp(v0 + (cx - G) / PW * span, 0, T);
  }
  // within 7 px of either end of a bar = trim that end (short bars: the outer third)
  function hkEdge(q, mx) { const w = q.x1 - q.x0, z = Math.min(7, w / 3); return mx <= q.x0 + z ? 'L' : mx >= q.x1 - z ? 'R' : null; }
  function hkWheel(e) {
    const T = hkTotal(); if (!T || !H.tAt) return;
    e.preventDefault();
    const [v0, v1] = hkView(), r = $('hkCanvas').getBoundingClientRect(), at = H.tAt(e.clientX - r.left);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (e.deltaX || e.deltaY) / (H.pxSec || 1); hkZoom(v0 + d, v1 + d); return; }
    const f = e.deltaY > 0 ? 1.25 : 0.8, w = (v1 - v0) * f;
    hkZoom(at - (at - v0) * f, at - (at - v0) * f + w);
  }
  function hkPointer(e) {
    const c = $('hkCanvas'), r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (e.type === 'pointerdown') {
      if (!H.tAt) return;
      const hit = H.rects.slice().reverse().find((q) => mx >= q.x0 - 2 && mx <= q.x1 + 2 && my >= q.y0 && my <= q.y1);
      if (hit) {
        const h = hkById(hit.id); H.sel = h.id;
        const edge = hkEdge(hit, mx);
        H.drag = { id: h.id, edge: edge, off: H.tAt(mx) - h.start, moved: false, x: mx };
        c.setPointerCapture(e.pointerId); hkRenderList(); hkDraw(); return;
      }
      if (my < H.geom.waveY + H.geom.waveH + 4) { audio.currentTime = H.tAt(mx); H.play = null; H.drag = { seek: true }; c.setPointerCapture(e.pointerId); hkDraw(); }
      return;
    }
    if (e.type === 'pointermove') {
      if (!H.drag) {
        const over = H.rects.find((q) => mx >= q.x0 - 2 && mx <= q.x1 + 2 && my >= q.y0 && my <= q.y1);
        c.style.cursor = over ? (hkEdge(over, mx) ? 'ew-resize' : 'grab') : (my < (H.geom ? H.geom.waveY + H.geom.waveH + 4 : 0) ? 'pointer' : 'default');
        return;
      }
      if (H.drag.seek) { audio.currentTime = H.tAt(mx); hkDraw(); return; }
      const h = hkById(H.drag.id); if (!h) return;
      if (Math.abs(mx - H.drag.x) > 2) H.drag.moved = true;
      if (!H.drag.moved) return;
      const tm = H.tAt(mx);
      if (H.drag.edge === 'L') hkSetStart(h, e.shiftKey ? tm : hkSnap(tm));
      else if (H.drag.edge === 'R') hkSetEnd(h, e.shiftKey ? tm : hkSnap(tm, true));
      else { let s = tm - H.drag.off; if (!e.shiftKey) s = hkSnap(s); hkSet(h, s, null); }
      hkDraw(); hkRow(h);
      // the preview shows the frame at whatever edge you're moving
      if (audio.paused) audio.currentTime = H.drag.edge === 'R' ? Math.max(h.start, h.start + h.len - 0.05) : h.start;
      return;
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      const d = H.drag; H.drag = null;
      if (d && !d.seek && d.moved) { hkRenderList(); hkDraw(); }
    }
  }
  // ----- list -----
  function hkRowHtml(h) {
    const d = HK[h.type], out = h.len < d.lo || h.len > d.hi, playing = (tail) => H.play && H.play.id === h.id && !!H.play.tail === tail && !audio.paused;
    return '<div class="hk-row' + (h.id === H.sel ? ' on' : '') + (h.on === false ? ' off' : '') + '" data-hk="' + h.id + '">'
      + '<span class="hk-dot" style="background:' + d.color + '"></span><b class="hk-name">' + d.name + ' ' + h.n + '</b>'
      + '<span class="hk-lab">start</span><input class="hk-t" data-hkt="' + h.id + '" value="' + fmtT(h.start) + '" title="Start (M:SS.s) \u2014 type and press Enter">'
      + '<button class="mv-ib" data-hkn="' + h.id + ',s,-0.1" title="Start 0.1s earlier">&minus;</button><button class="mv-ib" data-hkn="' + h.id + ',s,0.1" title="Start 0.1s later">+</button>'
      + '<span class="hk-lab">end</span><input class="hk-t" data-hke="' + h.id + '" value="' + fmtT(h.start + h.len) + '" title="End (M:SS.s) \u2014 type and press Enter">'
      + '<button class="mv-ib" data-hkn="' + h.id + ',e,-0.1" title="End 0.1s earlier">&minus;</button><button class="mv-ib" data-hkn="' + h.id + ',e,0.1" title="End 0.1s later">+</button>'
      + '<span class="hk-len' + (out ? ' out' : '') + '" title="' + (out ? 'Outside the usual ' + d.lo + '\u2013' + d.hi + 's for a ' + d.name + ' hook \u2014 fine if that\u2019s where the song says to cut' : 'Usual ' + d.name + ' length: ' + d.lo + '\u2013' + d.hi + 's') + '">' + h.len.toFixed(1) + 's</span>'
      + '<button class="mv-ib hk-play" data-hkplay="' + h.id + '" title="Play this hook from the start">' + (playing(false) ? '&#10074;&#10074;' : '&#9654;') + '</button>'
      + '<button class="mv-ib hk-play" data-hkplay="' + h.id + ',end" title="Play just the last 4 seconds (check the ending)">' + (playing(true) ? '&#10074;&#10074;' : '&#9654;|') + '</button>'
      + '<button class="mv-ib" data-hkzoom="' + h.id + '" title="Zoom the timeline to this hook">&#128269;</button>'
      + '<label class="hk-on" title="Include when you hit Make hooks"><input type="checkbox" data-hkon="' + h.id + '"' + (h.on === false ? '' : ' checked') + '> make</label>'
      + '<span class="hk-made">' + (hkDone(h) ? '&#10003; made' : '') + '</span>'
      + '<button class="mv-ib" data-hkdel="' + h.id + '" title="Delete this hook">&#10005;</button></div>';
  }
  function hkRow(h) { const r = document.querySelector('#hkList [data-hk="' + h.id + '"]'); if (r && document.activeElement && !r.contains(document.activeElement)) r.outerHTML = hkRowHtml(h); }
  function hkRenderList() {
    const box = $('hkList'); if (!box) return;
    const fm = ['16', '9'].filter((f) => $(f === '16' ? 'hk16' : 'hk9').checked).length, on = S.hooks.filter((h) => h.on !== false).length;
    $('hkCount').textContent = S.hooks.length ? '(' + S.hooks.length + ')' : '';
    if ($('hkGo') && !H.queue) { $('hkGo').textContent = on ? '🎬 Make ' + on + ' hook' + (on > 1 ? 's' : '') + (fm ? ' (' + on * fm + ' files)' : '') : '🎬 Make hooks'; $('hkGo').disabled = !on || !fm || !!S.rec; }
    if (!S.song) { box.innerHTML = '<div class="mv-dim" style="padding:10px">Pick a song above.</div>'; return; }
    if (!S.hooks.length) { box.innerHTML = '<div class="mv-dim" style="padding:10px">No hooks yet. Hit <b>Suggest hooks</b> for a starting set, or play the song and press <b>+ Quick / + Standard / + Extended</b> where you want one.</div>'; return; }
    const keep = box.scrollTop;
    box.innerHTML = HK_ORDER.map((type) => S.hooks.filter((h) => h.type === type).sort((a, b) => a.start - b.start).map(hkRowHtml).join('')).join('');
    box.scrollTop = keep;
  }
  function hkMode(m) {
    H.mode = m;
    document.querySelectorAll('#view-mkvideo [data-mvtab]').forEach((b) => b.classList.toggle('on', b.dataset.mvtab === m));
    $('mvLinesPane').classList.toggle('hidden', m !== 'lines'); $('mvHooksPane').classList.toggle('hidden', m !== 'hooks');
    document.querySelector('#view-mkvideo .mv-left').classList.toggle('hk', m === 'hooks');
    if (m === 'hooks') { hkRenderList(); H.baseKey = ''; hkDraw(); hkAnalyze(); }
  }
  async function hkMake() {
    if (S.rec || H.queue) return;
    const list = S.hooks.filter((h) => h.on !== false).sort((a, b) => HK_ORDER.indexOf(a.type) - HK_ORDER.indexOf(b.type) || a.start - b.start);
    const fmts = ['16', '9'].filter((f) => $(f === '16' ? 'hk16' : 'hk9').checked);
    if (!list.length) return toast('Tick at least one hook to make', true);
    if (!fmts.length) return toast('Pick 16:9, 9:16 or both', true);
    const empty = fmts.filter((f) => !S.bg[f].length);
    if (empty.length && !confirm('No backgrounds for ' + empty.map((f) => (f === '16' ? '16:9' : '9:16')).join(' & ') + ' — those hooks will be black behind the lyrics. Keep going?')) return;
    if (!S.dir && !confirm('No song folder picked, so all ' + list.length * fmts.length + ' files will download one at a time.\n\nTip: Cancel, click “Pick song folder” at the top, and they’ll save into a Hooks folder inside it. Download anyway?')) return;
    const secs = list.reduce((a, h) => a + h.len, 0);
    H.queue = { cancel: false, made: 0 };
    $('hkGo').disabled = true; $('hkCancel').classList.remove('hidden'); $('hkProg').classList.remove('hidden');
    $('hkMsg').innerHTML = 'Making ' + list.length + ' hooks — about ' + Math.ceil((secs + list.length * 2) / 60) + ' min (they record in real time, both sizes at once).';
    const log = [];
    for (let i = 0; i < list.length; i++) {
      if (H.queue.cancel) break;
      const h = list[i], d = HK[h.type], names = {};
      fmts.forEach((f) => { names[f] = S.song.id + '-hook-' + h.type + '-' + h.n + '-' + (f === '16' ? '16x9' : '9x16'); });
      const res = await makeVideo(h.len, { from: h.start, fmts: fmts, names: names, sub: 'Hooks', fade: $('hkFade').checked, label: 'Hook ' + (i + 1) + ' of ' + list.length + ' · ' + d.name + ' ' + h.n, quiet: true });
      if (!res || res.cancel) break;
      h.done = { start: h.start, len: h.len }; S.dirty = true; H.queue.made++;
      log.push('<b>' + d.name + ' ' + h.n + '</b>: ' + res.msgs.join(' &middot; '));
      $('hkMsg').innerHTML = log.join('<br>');
      hkRenderList(); hkDraw();
    }
    const made = H.queue.made, stopped = H.queue.cancel || made < list.length;
    H.queue = null;
    $('hkCancel').classList.add('hidden'); $('hkProg').classList.add('hidden');
    hkRenderList();
    $('hkMsg').innerHTML = (stopped ? 'Stopped after ' + made + ' of ' + list.length + ' hooks.' : '&#10003; All ' + made + ' hooks made' + (S.dir ? ' — they’re in <b>' + esc(S.dir.name) + '/Hooks</b>.' : '.')) + (log.length ? '<br>' + log.join('<br>') : '')
      + (made ? '<br><span class="mv-dim">Hit <b>Save hooks</b> so their spots (and the ✓ made marks) are remembered.</span>' : '');
    toast(stopped ? 'Hooks stopped' : 'Hooks done');
  }

  // ---------- wiring ----------
  function wire() {
    const root = $('view-mkvideo');
    $('mvArtist').onchange = () => { fillSongs(); };
    $('mvSong').onchange = () => { if ($('mvSong').value) pickSong($('mvSong').value); };
    $('mvFolderBtn').onclick = pickFolder;
    $('mvDirInput').onchange = function () { onDirInput(this); };
    $('mvReload').onclick = async () => { if (!S.song) return; if (S.tsDirty && !confirm('Throw away your unsaved lyric edits and reload the saved timestamps?')) return; const ok = await loadTimestamps(); S.statusBits[0] = ok ? [true, S.lines.length + ' lyric lines'] : [false, 'no saved timestamps yet']; showStatus(); renderLines(); toast(ok ? 'Timestamps reloaded' : 'Still no saved timestamps', !ok); };
    $('mvEditTs').onclick = () => {
      const song = S.song; window.showTab('lyrics');
      if (!song) return;
      setTimeout(async () => {
        try {
          const a = $('lyrArtist'); if (!a || !Array.from(a.options).some((o) => o.value === song.artistId)) return;
          a.value = song.artistId; await window.lyrLoadSongs(); $('lyrSong').value = song.id; await window.lyrSongChange(); window.edLoadExisting();
        } catch (e) { }
      }, 400);
    };
    $('mvPP').onclick = togglePlay;
    audio.addEventListener('play', () => { $('mvPP').innerHTML = '&#10074;&#10074;'; });
    audio.addEventListener('pause', () => { $('mvPP').innerHTML = '&#9654;'; });
    audio.addEventListener('loadedmetadata', () => { S.total = audio.duration || 0; });
    audio.addEventListener('ended', () => { if (S.rec) finishRender(); });
    audio.addEventListener('error', () => { if (audio.src) toast('Couldn\u2019t load the song audio \u2014 check the MP3 link in Song Catalog', true); });
    const seek = $('mvSeek');
    seek.oninput = () => { if (S.rec || !S.total) return; S.seeking = true; audio.currentTime = seek.value / 1000 * S.total; };
    seek.onchange = () => { S.seeking = false; };
    // canvas: drag the lyric block, click a word to stress it
    const toFull = (e) => { const r = cv.getBoundingClientRect(), [W, H] = SIZES[S.fmt]; return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
    const inBlock = (p) => { const b = S.block, pad = 24; return b && p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad; };
    cv.addEventListener('pointerdown', (e) => {
      const p = toFull(e); if (!inBlock(p) || S.rec) return;
      const b = S.block, L = S.lines[b.idx], c = S.cfg;
      const cur = (S.move === 'line' && c.linePos[L.key]) || { x: c.posX, y: c.posY };
      S.drag = { sx: p.x, sy: p.y, ox: cur.x, oy: cur.y, key: L.key, idx: b.idx, hit: S.hits.find((h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h), moved: false };
      S.pick = b.idx; cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      const d = S.drag, p = toFull(e);
      if (!d) { cv.style.cursor = inBlock(p) ? 'grab' : 'default'; return; }
      const [W, H] = SIZES[S.fmt], dx = p.x - d.sx, dy = p.y - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 8) return;
      d.moved = true; cv.style.cursor = 'grabbing';
      setPos(clamp(d.ox + dx / W * 100, 2, 98), clamp(d.oy + dy / H * 100, 2, 98), d.key);
    });
    cv.addEventListener('pointerup', () => {
      const d = S.drag; S.drag = null; if (!d) return;
      if (!d.moved && d.hit) { const k = d.hit.key; if (S.cfg.stress[k]) delete S.cfg.stress[k]; else S.cfg.stress[k] = 1; S.dirty = true; }
      renderLines(); syncControls();
    });
    // segmented buttons, sliders, zones, colors, selects
    root.addEventListener('click', (e) => {
      const sb = e.target.closest('.mv-seg button'); if (sb) { segSet(sb.closest('.mv-seg').dataset.g, sb.dataset.v); return; }
      const z = e.target.closest('[data-zone]'); if (z) { const [x, y] = z.dataset.zone.split(',').map(Number); setPos(x, y, tgtKey()); return; }
      const ln = e.target.closest('.mv-line');
      const rs = e.target.closest('[data-reset]');
      if (rs) { const L = S.lines[+rs.dataset.reset]; delete S.cfg.linePos[L.key]; delete S.cfg.lineSize[L.key]; S.dirty = true; renderLines(); syncControls(); return; }
      const now = e.target.closest('[data-evnow]'); if (now) { S.sel = +now.dataset.evnow; evSetTime(now.dataset.evnow, now10()); return; }
      const nd = e.target.closest('[data-evn]'); if (nd) { const [id, d] = nd.dataset.evn.split(','); const ev = evById(id); if (ev) evSetTime(id, ev.t + +d); return; }
      const dl = e.target.closest('[data-evdel]'); if (dl) { evDel(dl.dataset.evdel); return; }
      const mg = e.target.closest('[data-evmerge]'); if (mg) { evMerge(mg.dataset.evmerge); return; }
      const cl = e.target.closest('[data-evclr]'); if (cl) { evClearAfter(cl.dataset.evclr); return; }
      if (ln && !e.target.closest('input')) {
        S.sel = +ln.dataset.ev;
        if (ln.dataset.li != null) jumpToLine(+ln.dataset.li);
        else { const ev = evById(S.sel); if (ev) audio.currentTime = Math.max(0, ev.t - 1 - S.cfg.offset); renderLines(); }
        return;
      }
      if (ln) { S.sel = +ln.dataset.ev; ln.parentNode.querySelectorAll('.mv-line.pick').forEach((r) => r.classList.remove('pick')); ln.classList.add('pick'); return; }
      const up = e.target.closest('[data-bgup]'); if (up) { const l = S.bg[S.fmt], i = +up.dataset.bgup; l.splice(i - 1, 0, l.splice(i, 1)[0]); S.dirty = true; renderBg(); return; }
      const rm = e.target.closest('[data-bgrm]'); if (rm) { S.bg[S.fmt].splice(+rm.dataset.bgrm, 1); S.dirty = true; renderBg(); return; }
      const ch = e.target.closest('[data-fi]'); if (ch) { useFolderFile(+ch.dataset.fi, e.shiftKey); return; }
    });
    root.addEventListener('input', (e) => {
      const r = e.target.closest('[data-k]'); if (r) { setVal(r.dataset.k, +r.value); syncControls(); return; }
      const col = e.target.closest('[data-col]'); if (col) { S.cfg[col.dataset.col] = col.value; S.dirty = true; }
    });
    root.addEventListener('change', (e) => {
      const et = e.target.closest('[data-evt]'); if (et) { evSetTime(et.dataset.evt, parseT(et.value)); return; }
      const ex = e.target.closest('[data-evx]'); if (ex) { evSetText(ex.dataset.evx, ex.value); return; }
      const bt = e.target.closest('[data-bgt]');
      if (bt) { const it = S.bg[S.fmt][+bt.dataset.bgt]; if (it) { it.start = parseT(bt.value); S.dirty = true; } bt.blur(); S.bgPending = false; renderBg(); }
    });
    $('mvAnim').onchange = function () { S.cfg.anim = this.value; S.dirty = true; };
    $('mvFontBtn').onclick = () => openDrawer(!FT.open);
    $('mvFavChips').addEventListener('click', (e) => { const f = e.target.closest('[data-font]'); if (f) applyFont(f.dataset.font); });
    $('mvFontDrawer').addEventListener('click', (e) => {
      const st = e.target.closest('[data-star]'); if (st) { toggleFav(st.dataset.star); return; }
      const tb = e.target.closest('[data-ftab]'); if (tb) { FT.tab = tb.dataset.ftab; $('mvFtList').scrollTop = 0; renderDrawer(); return; }
      const fc = e.target.closest('[data-font]'); if (fc) applyFont(fc.dataset.font);
    });
    $('mvFtClose').onclick = () => openDrawer(false);
    $('mvFtSearch').oninput = function () { FT.q = this.value; renderDrawer(); };
    $('mvFtSample').oninput = function () { FT.sample = this.value.trim(); renderDrawer(); };
    $('mvFtAddBtn').onclick = addGoogleFont;
    $('mvFtAdd').onkeydown = (e) => { if (e.key === 'Enter') addGoogleFont(); };
    $('mvFontDrawer').addEventListener('keydown', (e) => { if (e.key === 'Escape') openDrawer(false); });
    $('mvKen').onchange = function () { S.cfg.kenburns = this.checked; S.dirty = true; };
    $('mvLinkAdd').onclick = () => { if (addLink($('mvLink').value)) $('mvLink').value = ''; };
    $('mvLink').onkeydown = (e) => { if (e.key === 'Enter') $('mvLinkAdd').click(); };
    $('mvFiles').onchange = function () { addFiles(this.files); this.value = ''; };
    $('mvEven').onclick = () => { S.bg[S.fmt].forEach((b) => { b.start = null; }); S.dirty = true; renderBg(); };
    $('mvEndLink').onchange = function () { if (addLink(this.value, true)) this.value = ''; };
    $('mvEndFile').onchange = function () { addFiles(this.files, true); this.value = ''; };
    $('mvEndClear').onclick = () => { S.end[S.fmt] = null; S.dirty = true; renderEnd(); };
    $('mvSave').onclick = saveSetup;
    $('mvAddLine').onclick = () => evAdd('New line');
    $('mvAddGap').onclick = () => evAdd('[gap]');
    $('mvAddSec').onclick = evAddSection;
    $('mvTsUndo').onclick = tsUndo;
    $('mvTsSave').onclick = () => saveTimestamps(false);
    $('mvLines').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.stopPropagation(); e.target.blur(); }
      if (e.key === 'Escape' && e.target.matches('input')) { const ev = evById(e.target.dataset.evt || e.target.dataset.evx); if (ev) e.target.value = e.target.dataset.evt ? fmtT(ev.t) : ev.text; e.target.blur(); }
    });
    document.querySelectorAll('#view-mkvideo [data-mvtab]').forEach((b) => { b.onclick = () => hkMode(b.dataset.mvtab); });
    document.querySelectorAll('#view-mkvideo [data-hkadd]').forEach((b) => { b.onclick = () => hkAdd(b.dataset.hkadd); });
    $('hkSuggest').onclick = hkSuggest;
    $('hkGo').onclick = hkMake;
    $('hkCancel').onclick = () => { if (H.queue) H.queue.cancel = true; if (S.rec) { S.rec.cancel = true; finishRender(); } };
    $('hkSave').onclick = saveSetup;
    ['hk16', 'hk9'].forEach((id) => { $(id).onchange = hkRenderList; });
    const hc = $('hkCanvas');
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((ev) => hc.addEventListener(ev, hkPointer));
    hc.addEventListener('dblclick', () => { if (H.sel) hkPlay(H.sel); });
    hc.addEventListener('wheel', hkWheel, { passive: false });
    $('hkZoomSel').onclick = hkZoomHook;
    $('hkZoomFit').onclick = () => hkZoom(0, hkTotal());
    if (window.ResizeObserver) new ResizeObserver(() => { if (H.mode === 'hooks') { H.baseKey = ''; hkDraw(); } }).observe(hc.parentElement);
    const hl = $('hkList');
    hl.addEventListener('click', (e) => {
      const pl = e.target.closest('[data-hkplay]'); if (pl) { const [id, w] = pl.dataset.hkplay.split(','); hkPlay(id, w === 'end'); return; }
      const zm = e.target.closest('[data-hkzoom]'); if (zm) { H.sel = +zm.dataset.hkzoom; hkRenderList(); hkZoomHook(); return; }
      const dl = e.target.closest('[data-hkdel]'); if (dl) { S.hooks = S.hooks.filter((h) => h.id !== +dl.dataset.hkdel); S.dirty = true; if (H.sel === +dl.dataset.hkdel) H.sel = null; hkRenderList(); hkDraw(); return; }
      const nd = e.target.closest('[data-hkn]'); if (nd) {
        const [id, which, d] = nd.dataset.hkn.split(','), h = hkById(id);
        if (h) {
          if (which === 'e') { hkSetEnd(h, h.start + h.len + +d); if (audio.paused) audio.currentTime = Math.max(h.start, h.start + h.len - 0.05); }
          else { hkSetStart(h, h.start + +d); if (audio.paused) audio.currentTime = h.start; }
          H.sel = h.id; hkRenderList(); hkDraw();
        }
        return;
      }
      if (e.target.closest('input, select, label')) return;
      const row = e.target.closest('[data-hk]'); if (row) { const h = hkById(row.dataset.hk); H.sel = h.id; if (audio.paused) audio.currentTime = h.start; hkRenderList(); hkDraw(); }
    });
    hl.addEventListener('change', (e) => {
      // typing a start keeps the end where it is (it's a trim, not a move); typing an end trims the end
      const tt = e.target.closest('[data-hkt]'); if (tt) { const h = hkById(tt.dataset.hkt), v = parseT(tt.value); if (h && v != null) { hkSetStart(h, v); H.sel = h.id; if (audio.paused) audio.currentTime = h.start; } hkRenderList(); hkDraw(); return; }
      const te = e.target.closest('[data-hke]'); if (te) { const h = hkById(te.dataset.hke), v = parseT(te.value); if (h && v != null) { hkSetEnd(h, v); H.sel = h.id; } hkRenderList(); hkDraw(); return; }
      const on = e.target.closest('[data-hkon]'); if (on) { const h = hkById(on.dataset.hkon); if (h) { h.on = on.checked; S.dirty = true; } hkRenderList(); hkDraw(); }
    });
    hl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.stopPropagation(); e.target.blur(); } });
    $('mvGo').onclick = () => makeVideo(0);
    $('mvTest').onclick = () => makeVideo(20);
    $('mvCancel').onclick = () => { if (S.rec) { S.rec.cancel = true; finishRender(); } };
    document.addEventListener('keydown', (e) => {
      if (root.classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
      if (e.code === 'Space') { e.preventDefault(); if (e.target && e.target.tagName === 'BUTTON') e.target.blur(); togglePlay(); } // a focused button would also 'click' on key-up and toggle twice
      if (H.mode === 'hooks') {
        const h = hkById(H.sel);
        if (h && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
          e.preventDefault(); const d = (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
          if (e.altKey) { hkSetEnd(h, h.start + h.len + d); if (audio.paused) audio.currentTime = Math.max(h.start, h.start + h.len - 0.05); }
          else { hkSet(h, h.start + d, null); if (audio.paused) audio.currentTime = h.start; }
          hkRow(h); hkDraw(); return;
        }
        // [ / ] = set the selected hook's start / end to right where the song is now (great while it plays)
        if (h && (e.code === 'BracketLeft' || e.code === 'BracketRight')) { e.preventDefault(); const t = r10(audio.currentTime || 0); if (e.code === 'BracketLeft') hkSetStart(h, t); else hkSetEnd(h, t); hkRenderList(); hkDraw(); return; }
        if (h && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); S.hooks = S.hooks.filter((x) => x !== h); H.sel = null; S.dirty = true; hkRenderList(); hkDraw(); return; }
        if (e.code === 'Enter' || e.code === 'NumpadEnter') return;   // Enter stamps lyric lines - not on the Hooks tab
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const btn = e.target && e.target.closest ? e.target.closest('button') : null;
        if (btn && !btn.closest('#mvLines, #mvTsBar')) return; // Enter on other buttons keeps its normal meaning
        if (btn) btn.blur();                                    // a row button still focused from a click
        e.preventDefault(); evStamp();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); tsUndo(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.rec) S.rec.hidden = true; });
    window.addEventListener('beforeunload', (e) => { if (S.rec || S.dirty || S.tsDirty) { e.preventDefault(); e.returnValue = ''; } });
    renderLines();
  }

  function placeUnderHeader() {
    const h = document.querySelector('header'), top = h && getComputedStyle(h).position === 'sticky' ? h.offsetHeight : 0;
    $('view-mkvideo').style.setProperty('--mvTop', (top + 8) + 'px');
  }
  window.addEventListener('resize', () => { if (built) placeUnderHeader(); });
  async function onShow() {
    build();
    placeUnderHeader();
    if (!FT.ready) { FT.ready = true; loadFontData().then(() => { renderFontBtn(); ensureCurrentFont(); }); }
    if (!S.songs) {
      try { await loadSongs(); } catch (e) { toast('Could not load songs: ' + e.message, true); return; }
    }
    fillArtists();
  }

  window.MV = { onShow: onShow, _state: S, _hk: H, _buildLines: buildLines, _dbx: dbx, _serialize: tsSerialize };
})();
