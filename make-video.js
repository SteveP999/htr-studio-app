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
    hits: [], block: null, drag: null, seeking: false, audioName: ''
  };
  const audio = new Audio(); audio.crossOrigin = 'anonymous'; audio.preload = 'auto';
  let AC = null, monGain = null, mdest = null, cv = null, cx = null, built = false;

  // ---------- timestamps -> lyric lines ----------
  // file format: "M:SS.s<TAB>text" per line; [brackets] are section markers / [gap]s that end the caption before them
  function buildLines(text) {
    const ev = [];
    text.split(/\r?\n/).forEach((ln) => {
      const m = ln.match(/^\s*(\d+):(\d{2}(?:\.\d+)?)\s+(.+)$/); if (!m) return;
      const tx = m[3].trim();
      ev.push({ t: +m[1] * 60 + parseFloat(m[2]), text: tx, marker: /^\[.*\]$/.test(tx) });
    });
    ev.sort((a, b) => a.t - b.t);
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
      out.push({ key: e.text + '#' + seen[e.text], start: e.t, end: end, text: e.text, words: words });
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
  function fontStr(px) { return (HEAVY.indexOf(S.cfg.font) >= 0 ? '800 ' : '400 ') + px.toFixed(1) + 'px "' + S.cfg.font + '", sans-serif'; }
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
    const t = audio.currentTime || 0, playing = !audio.paused;
    const set = new Set([S.fmt]); if (S.rec) S.rec.list.forEach((r) => set.add(r.fmt));
    syncVideos(Array.from(set), t, playing);
    if (S.rec) {
      S.rec.list.forEach((r) => drawFrame(r.ctx, r.fmt, t, 1, false, S.rec.lyrics));
      const lim = S.rec.limit || S.total;
      $('mvProg').firstChild.style.width = clamp(t / lim * 100, 0, 100) + '%';
      $('mvRenderMsg').textContent = 'Recording ' + fmtS(t) + ' / ' + fmtS(lim) + ' \u2014 you can switch windows, just don\u2019t close this tab.';
      if (S.rec.limit && t >= S.rec.limit) finishRender();
    }
    drawFrame(cx, S.fmt, t, PREVIEW_SCALE, true, S.lyricsOn);
    if (S.total) {
      if (!S.seeking) $('mvSeek').value = Math.round(t / S.total * 1000);
      $('mvTime').textContent = fmtS(t) + ' / ' + fmtS(S.total);
    }
    markLine();
  }

  // ---------- UI ----------
  const CSS = `
  .mv-main{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:18px;margin-top:18px;align-items:start}
  @media(max-width:1150px){.mv-main{grid-template-columns:1fr}}
  .mv-left{position:sticky;top:10px}
  .mv-stagewrap{background:#000;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  #mvCanvas{display:block;width:100%;height:auto;margin:0 auto;touch-action:none;background:#000}
  #mvCanvas.v{width:auto;height:min(68vh,760px)}
  .mv-transport{display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--panel)}
  .mv-pp{background:var(--red);color:#fff;width:40px;height:40px;border-radius:50%;font-size:15px;flex:none}
  .mv-transport input[type=range]{flex:1;padding:0;accent-color:var(--red);background:none;border:none}
  .mv-time{font-family:monospace;color:var(--muted);min-width:96px;text-align:right}
  .mv-lines{margin-top:10px;max-height:250px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel);position:relative}
  .mv-line{display:flex;gap:10px;padding:6px 10px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px}
  .mv-line:hover{background:var(--panel2)} .mv-line.cur{background:#3a1717} .mv-line.pick{outline:1px solid var(--warn);outline-offset:-1px}
  .mv-lt{font-family:monospace;color:var(--warn);min-width:54px} .mv-lx{flex:1}
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
        <div class="mv-dim" style="margin:7px 2px">Drag the lyrics on the frame to move them &middot; click a word to stress it &middot; Space = play/pause &middot; click a line below to jump to it.</div>
        <div id="mvLines" class="mv-lines"></div>
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
          <select id="mvFont">${FONTS.map((f) => '<option style="font-family:\'' + f + '\'">' + f + '</option>').join('')}</select>
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
    if (g === 'lyricsOn') return String(S.lyricsOn); return String(S.cfg[g]);
  }
  function segSet(g, v) {
    if (S.rec && (g === 'out' || g === 'lyricsOn')) return;
    if (g === 'fmt') setFmt(v);
    else if (g === 'move') S.move = v;
    else if (g === 'out') S.out = v;
    else if (g === 'lyricsOn') S.lyricsOn = v === 'true';
    else if (g === 'upper') { S.cfg.upper = v === 'true'; S.dirty = true; }
    else { S.cfg[g] = v; S.dirty = true; }
    syncControls();
  }
  function syncControls() {
    if (!built) return;
    document.querySelectorAll('#view-mkvideo .mv-seg').forEach((s) => { const v = segVal(s.dataset.g); s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); });
    document.querySelectorAll('#view-mkvideo [data-k]').forEach((r) => { const k = r.dataset.k, v = +getVal(k); if (document.activeElement !== r) r.value = v; const sh = document.querySelector('#view-mkvideo [data-show="' + k + '"]'); if (sh) sh.textContent = SLIDERS[k][4](v); });
    document.querySelectorAll('#view-mkvideo [data-col]').forEach((i) => { i.value = S.cfg[i.dataset.col]; });
    $('mvAnim').value = S.cfg.anim; $('mvFont').value = S.cfg.font; $('mvKen').checked = !!S.cfg.kenburns;
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
    if (!S.song) { box.innerHTML = '<div class="mv-dim" style="padding:12px">Pick a song above.</div>'; return; }
    if (!S.lines.length) { box.innerHTML = '<div class="mv-dim" style="padding:12px">No saved timestamps for this song yet &mdash; stamp them in Lyric Timestamps (button above), save, then Reload timestamps.</div>'; return; }
    const c = S.cfg;
    box.innerHTML = S.lines.map((L, i) => '<div class="mv-line' + (i === S.pick ? ' pick' : '') + '" data-i="' + i + '"><span class="mv-lt">' + fmtT(L.start) + '</span><span class="mv-lx">' + esc(L.text) + '</span>'
      + ((c.linePos[L.key] || c.lineSize[L.key] != null) ? '<span class="mv-tag" title="This line has its own size/position \u2014 click to select, then Reset">own look</span><button class="mv-ib" data-reset="' + i + '" title="Reset this line to the all-lines look">&#8634;</button>' : '')
      + '</div>').join('');
    S._marked = null;
  }
  function markLine() {
    const i = S.shown; if (i === S._marked) return; S._marked = i;
    const box = $('mvLines');
    box.querySelectorAll('.mv-line').forEach((r) => {
      const on = +r.dataset.i === i; r.classList.toggle('cur', on);
      if (on && !audio.paused) box.scrollTop = r.offsetTop - box.clientHeight / 2;
    });
    if (S.move === 'line') syncControls();
  }
  function jumpToLine(i) {
    const L = S.lines[i]; if (!L) return;
    const words = L.words.filter((w) => !w.br), last = words.length ? words[words.length - 1].at : L.start;
    S.pick = i;
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
    try { const f = await b.gh(P('data/lyrics/' + S.song.id + '-timestamps.txt?ref=main')); S.lines = buildLines(b.b64decode(f.content)); return true; }
    catch (e) { S.lines = []; return false; }
  }
  async function pickSong(id) {
    if (S.rec) { toast('Finish or cancel the render first', true); $('mvSong').value = S.song ? S.song.id : ''; return; }
    if (S.dirty && S.song && S.song.id !== id && !confirm('Unsaved video setup changes for "' + S.song.title + '" will be lost. Switch songs anyway?')) { $('mvSong').value = S.song.id; return; }
    const song = S.songs.find((s) => s.id === id); if (!song) return;
    const b = B();
    audio.pause(); allItems().forEach((it) => { if (it.el && it.el.pause) it.el.pause(); });
    Object.assign(S, { song: song, lines: [], pick: -1, shown: -1, cfg: clone(DEF), bg: { '16': [], '9': [] }, end: { '16': null, '9': null }, dirty: false, total: 0 });
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
      bits.push([true, 'saved video setup loaded']);
    } catch (e) { bits.push([true, 'new video setup']); }
    S.statusBits = bits; showStatus();
    if (S.dirFiles.length) await afterFolder();
    renderLines(); renderBg(); renderEnd(); syncControls();
    document.fonts.load(fontStr(80)).catch(() => { });
  }
  async function saveSetup() {
    if (!S.song) return toast('Pick a song first', true);
    const pack = (it) => (it ? { name: it.name, src: it.src || null, kind: it.kind, start: it.start == null ? null : Math.round(it.start * 10) / 10 } : null);
    const data = { version: 1, song: S.song.id, updated: new Date().toISOString(), cfg: S.cfg,
      bg: { '16': S.bg['16'].map(pack), '9': S.bg['9'].map(pack) }, end: { '16': pack(S.end['16']), '9': pack(S.end['9']) } };
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
    mdest = AC.createMediaStreamDestination(); src.connect(mdest);
  }
  function togglePlay() {
    if (S.rec) return;
    if (!audio.src) return toast('No audio for this song yet', true);
    ensureGraph();
    if (audio.paused) audio.play().catch((e) => toast('Audio: ' + e.message, true)); else audio.pause();
  }
  function pickMime() {
    const c = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return (window.MediaRecorder && c.find((m) => MediaRecorder.isTypeSupported(m))) || '';
  }
  async function makeVideo(limit) {
    if (S.rec) return;
    if (!S.song) return toast('Pick a song first', true);
    if (!audio.src) return toast('No audio \u2014 add the MP3 link in Song Catalog, or pick the song folder and click the MP3', true);
    if (S.lyricsOn && !S.lines.length) return toast('No saved timestamps \u2014 stamp the lyrics first (or choose No lyrics)', true);
    const fmts = S.out === 'both' ? ['16', '9'] : [S.out];
    const used = [].concat.apply([], fmts.map((f) => S.bg[f].concat(S.end[f] ? [S.end[f]] : [])));
    const broken = used.filter((it) => !it.url || it.err);
    if (broken.length) return toast('Fix these backgrounds first: ' + broken.map((b) => b.name).join(', '), true);
    if (used.some((it) => !it.ready)) return toast('Backgrounds are still loading \u2014 give it a few seconds', true);
    const empty = fmts.filter((f) => !S.bg[f].length);
    if (empty.length && !confirm('No backgrounds for ' + empty.map((f) => (f === '16' ? '16:9' : '9:16')).join(' & ') + ' \u2014 that video will be black behind the lyrics. Keep going?')) return;
    const mime = pickMime(); if (!mime) return toast('This browser can\u2019t record video \u2014 use Chrome or Edge', true);
    ensureGraph(); await AC.resume();
    await document.fonts.load(fontStr(80)).catch(() => { });
    audio.pause();
    if (!S.total) await new Promise((r) => { if (audio.readyState >= 1) r(); else audio.addEventListener('loadedmetadata', r, { once: true }); });
    await new Promise((r) => { const to = setTimeout(r, 2000); audio.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true }); audio.currentTime = 0; });
    syncVideos(fmts, 0, false); await wait(700); // let video layers land on frame 0
    const at = mdest.stream.getAudioTracks()[0], ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    const list = fmts.map((f) => {
      const [W, H] = SIZES[f]; const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); drawFrame(ctx, f, 0, 1, false, S.lyricsOn);
      const ms = new MediaStream([c.captureStream(30).getVideoTracks()[0], at.clone()]);
      const rec = new MediaRecorder(ms, { mimeType: mime, videoBitsPerSecond: 16000000, audioBitsPerSecond: 192000 });
      const r = { fmt: f, ctx: ctx, rec: rec, ms: ms, chunks: [] };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
      return r;
    });
    S.rec = { list: list, lyrics: S.lyricsOn, ext: ext, mime: mime, limit: limit || 0, hidden: false };
    monGain.gain.value = $('mvListen').checked ? 1 : 0;
    ['mvGo', 'mvTest', 'mvSave'].forEach((id) => { $(id).disabled = true; });
    $('mvCancel').classList.remove('hidden'); $('mvProg').classList.remove('hidden');
    startClock();
    list.forEach((r) => r.rec.start(1000));
    audio.play().catch((e) => { toast('Audio: ' + e.message, true); S.rec.cancel = true; finishRender(); });
  }
  async function finishRender() {
    const R = S.rec; if (!R || R.finishing) return; R.finishing = true;
    stopClock();
    audio.pause();
    await Promise.all(R.list.map((r) => new Promise((res) => { r.rec.onstop = res; try { r.rec.stop(); } catch (e) { res(); } })));
    R.list.forEach((r) => r.ms.getTracks().forEach((t) => t.stop()));
    if (monGain) monGain.gain.value = 1;
    S.rec = null;
    ['mvGo', 'mvTest', 'mvSave'].forEach((id) => { $(id).disabled = false; });
    $('mvCancel').classList.add('hidden'); $('mvProg').classList.add('hidden');
    if (R.cancel) { $('mvRenderMsg').textContent = 'Render cancelled.'; return; }
    const msgs = [];
    for (const r of R.list) {
      const blob = new Blob(r.chunks, { type: R.mime.split(';')[0] });
      const name = S.song.id + (R.lyrics ? '-lyric' : '') + '-' + (r.fmt === '16' ? '16x9' : '9x16') + (R.limit ? '-test' : '') + '.' + R.ext;
      msgs.push(await saveBlob(blob, name));
    }
    $('mvRenderMsg').innerHTML = msgs.join('<br>') + (R.hidden ? '<br><span class="mv-warn">&#9888; This tab was hidden for part of the render. Give the video a quick watch \u2014 if a background video froze anywhere, re-render with the tab showing.</span>' : '');
    toast(R.limit ? 'Test clip done' : 'Video done');
  }
  async function saveBlob(blob, name) {
    if (S.dir) {
      try {
        const fh = await S.dir.getFileHandle(name, { create: true }); const w = await fh.createWritable();
        await w.write(blob); await w.close();
        return '&#10003; Saved <b>' + esc(name) + '</b> into ' + esc(S.dir.name);
      } catch (e) { console.warn('folder save failed, downloading instead', e); }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 120000);
    return '&#10003; Downloaded <b>' + esc(name) + '</b>';
  }

  // ---------- wiring ----------
  function wire() {
    const root = $('view-mkvideo');
    $('mvArtist').onchange = () => { fillSongs(); };
    $('mvSong').onchange = () => { if ($('mvSong').value) pickSong($('mvSong').value); };
    $('mvFolderBtn').onclick = pickFolder;
    $('mvDirInput').onchange = function () { onDirInput(this); };
    $('mvReload').onclick = async () => { if (!S.song) return; const ok = await loadTimestamps(); S.statusBits[0] = ok ? [true, S.lines.length + ' lyric lines'] : [false, 'no saved timestamps yet']; showStatus(); renderLines(); toast(ok ? 'Timestamps reloaded' : 'Still no saved timestamps', !ok); };
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
      if (ln) { jumpToLine(+ln.dataset.i); return; }
      const up = e.target.closest('[data-bgup]'); if (up) { const l = S.bg[S.fmt], i = +up.dataset.bgup; l.splice(i - 1, 0, l.splice(i, 1)[0]); S.dirty = true; renderBg(); return; }
      const rm = e.target.closest('[data-bgrm]'); if (rm) { S.bg[S.fmt].splice(+rm.dataset.bgrm, 1); S.dirty = true; renderBg(); return; }
      const ch = e.target.closest('[data-fi]'); if (ch) { useFolderFile(+ch.dataset.fi, e.shiftKey); return; }
    });
    root.addEventListener('input', (e) => {
      const r = e.target.closest('[data-k]'); if (r) { setVal(r.dataset.k, +r.value); syncControls(); return; }
      const col = e.target.closest('[data-col]'); if (col) { S.cfg[col.dataset.col] = col.value; S.dirty = true; }
    });
    root.addEventListener('change', (e) => {
      const bt = e.target.closest('[data-bgt]');
      if (bt) { const it = S.bg[S.fmt][+bt.dataset.bgt]; if (it) { it.start = parseT(bt.value); S.dirty = true; } bt.blur(); S.bgPending = false; renderBg(); }
    });
    $('mvAnim').onchange = function () { S.cfg.anim = this.value; S.dirty = true; };
    $('mvFont').onchange = function () { S.cfg.font = this.value; S.dirty = true; document.fonts.load(fontStr(80)).catch(() => { }); };
    $('mvKen').onchange = function () { S.cfg.kenburns = this.checked; S.dirty = true; };
    $('mvLinkAdd').onclick = () => { if (addLink($('mvLink').value)) $('mvLink').value = ''; };
    $('mvLink').onkeydown = (e) => { if (e.key === 'Enter') $('mvLinkAdd').click(); };
    $('mvFiles').onchange = function () { addFiles(this.files); this.value = ''; };
    $('mvEven').onclick = () => { S.bg[S.fmt].forEach((b) => { b.start = null; }); S.dirty = true; renderBg(); };
    $('mvEndLink').onchange = function () { if (addLink(this.value, true)) this.value = ''; };
    $('mvEndFile').onchange = function () { addFiles(this.files, true); this.value = ''; };
    $('mvEndClear').onclick = () => { S.end[S.fmt] = null; S.dirty = true; renderEnd(); };
    $('mvSave').onclick = saveSetup;
    $('mvGo').onclick = () => makeVideo(0);
    $('mvTest').onclick = () => makeVideo(20);
    $('mvCancel').onclick = () => { if (S.rec) { S.rec.cancel = true; finishRender(); } };
    document.addEventListener('keydown', (e) => {
      if (root.classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.rec) S.rec.hidden = true; });
    window.addEventListener('beforeunload', (e) => { if (S.rec || S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    renderLines();
  }

  async function onShow() {
    build();
    FONTS.forEach((f) => document.fonts.load((HEAVY.indexOf(f) >= 0 ? '800 ' : '400 ') + '40px "' + f + '"').catch(() => { }));
    if (!S.songs) {
      try { await loadSongs(); } catch (e) { toast('Could not load songs: ' + e.message, true); return; }
    }
    fillArtists();
  }

  window.MV = { onShow: onShow, _state: S, _buildLines: buildLines, _dbx: dbx };
})();
