/* HTR Studio - Mastering
   Same engine as modules/mastering/htr_master.py (two-pass FFmpeg loudnorm, highpass 25Hz,
   48k/24-bit WAV + optional 320k MP3), running in the browser via FFmpeg WebAssembly.
   Works on any computer in Chrome/Edge. Source files are never modified - masters are new files
   written into a "Masters - <Profile>" folder inside the folder you pick.
   Only difference from the desktop engine: soxr isn't in the browser build, so the final
   192k->48k resample uses FFmpeg's standard resampler (null-tested: difference peaks at -68 dB). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (m, e) => ((window.HTRBridge && window.HTRBridge.toast) ? window.HTRBridge.toast(m, e) : alert(m));
  const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
  const PROFILES = [
    { slug: 'studio', name: 'Studio Recording', I: -14, TP: -1, LRA: 9, match: ['studio'] },
    { slug: 'live', name: 'Live Album', I: -14, TP: -1, LRA: 11, match: ['live'] },
    { slug: 'piano', name: 'New Age Piano', I: -16, TP: -1, LRA: 12, match: ['piano', 'new age', 'newage', 'new-age', 'instrumental'] },
    { slug: 'intimate', name: 'Movie Score - Intimate', I: -17, TP: -1, LRA: 13, match: ['intimate', 'soft'] },
    { slug: 'jazz', name: 'Movie Score - Elegant Jazz', I: -15, TP: -1, LRA: 10, match: ['jazz', 'elegant'] },
    { slug: 'triumphant', name: 'Movie Score - Triumphant', I: -14, TP: -1, LRA: 9, match: ['triumphant'] }
  ];
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const stem = (n) => n.replace(/\.[^.]+$/, '');
  const detect = (name) => { const l = name.toLowerCase(); const p = PROFILES.find((p) => p.match.some((k) => l.indexOf(k) >= 0)); return p ? p.slug : ''; };

  const S = {
    tool: 'master', mode: 'folder', profile: 'studio', custom: { I: -14, TP: -1, LRA: 10 },
    mp3: true, dry: false, dir: null, files: [], subs: [], conv: 'mp3', bitrate: '320k', running: false, cancel: false
  };
  let ff = null, ffLog = [], built = false;

  // ---------- FFmpeg ----------
  async function loadFF() {
    if (ff) return ff;
    if (!window.FFmpegWASM || !window.FFmpegUtil) throw new Error('FFmpeg scripts did not load - check your connection and refresh');
    setMsg('Loading the audio engine (about 30 MB the first time, cached after)\u2026');
    const { FFmpeg } = window.FFmpegWASM, { toBlobURL } = window.FFmpegUtil;
    const f = new FFmpeg();
    f.on('log', (e) => { ffLog.push(e.message); logLine(e.message); });
    await f.load({ coreURL: await toBlobURL(CORE + '/ffmpeg-core.js', 'text/javascript'), wasmURL: await toBlobURL(CORE + '/ffmpeg-core.wasm', 'application/wasm') });
    ff = f; return f;
  }
  function resetFF() { try { ff && ff.terminate(); } catch (e) { } ff = null; }
  async function run(args) {
    ffLog = [];
    const rc = await ff.exec(args);
    if (rc !== 0) throw new Error((ffLog.slice(-3).join(' | ') || 'FFmpeg failed').slice(0, 300));
    return ffLog.join('\n');
  }
  async function measure(inName, t) {
    const out = await run(['-hide_banner', '-nostats', '-i', inName, '-af', 'loudnorm=I=' + t.I + ':TP=' + t.TP + ':LRA=' + t.LRA + ':print_format=json', '-f', 'null', '-']);
    const m = out.match(/\{[^{}]*"input_i"[^{}]*\}/);
    if (!m) throw new Error('Loudness data was not returned');
    return JSON.parse(m[0]);
  }
  async function verify(name) { // integrated loudness + true peak of the finished master
    const out = await run(['-hide_banner', '-nostats', '-i', name, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
    const I = out.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/), P = out.match(/Peak:\s+(-?[\d.]+) dBFS/);
    return { I: I ? +I[1] : null, TP: P ? +P[1] : null };
  }

  // ---------- profiles ----------
  function target(slug) {
    if (slug === 'custom') return { name: 'Custom', I: +S.custom.I, TP: +S.custom.TP, LRA: +S.custom.LRA };
    const p = PROFILES.find((x) => x.slug === slug); return { name: p.name, I: p.I, TP: p.TP, LRA: p.LRA };
  }
  function masterFilter(t, m) {
    return 'highpass=f=25:poles=2,loudnorm=I=' + t.I + ':TP=' + t.TP + ':LRA=' + t.LRA
      + ':measured_I=' + m.input_i + ':measured_TP=' + m.input_tp + ':measured_LRA=' + m.input_lra
      + ':measured_thresh=' + m.input_thresh + ':offset=' + m.target_offset + ':linear=true,aresample=48000';
  }

  // ---------- disk ----------
  async function subdir(parent, path) { let d = parent; for (const p of path) d = await d.getDirectoryHandle(p, { create: true }); return d; }
  async function writeOut(dir, name, data) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
  async function listDir(dir) {
    const files = [], subs = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file') files.push({ name: name, h: h, on: true });
      else if (!/^(Masters|Converted)\b/i.test(name)) subs.push({ name: name, h: h });
    }
    files.sort((a, b) => a.name.localeCompare(b.name)); subs.sort((a, b) => a.name.localeCompare(b.name));
    return { files: files, subs: subs };
  }

  // ---------- one track ----------
  async function masterOne(fileH, outDir, slug, rel) {
    const t = target(slug), name = fileH.name;
    const r = { track: name, profile: t.name, targetLUFS: t.I, truePeakCeiling: t.TP, measuredLUFS: '', resultLUFS: '', resultTruePeak: '', status: '', output: '', mp3Output: '' };
    try {
      const file = await fileH.getFile();
      await ff.writeFile('in.wav', new Uint8Array(await file.arrayBuffer()));
      const m = await measure('in.wav', t);
      r.measuredLUFS = Math.round(+m.input_i * 10) / 10;
      if (S.dry) { r.status = 'Measured (dry run)'; return r; }
      await run(['-y', '-hide_banner', '-nostats', '-i', 'in.wav', '-af', masterFilter(t, m), '-c:a', 'pcm_s24le', 'out.wav']);
      await ff.deleteFile('in.wav');
      const v = await verify('out.wav'); r.resultLUFS = v.I; r.resultTruePeak = v.TP;
      const outName = stem(name) + '-mastered.wav';
      await writeOut(outDir, outName, await ff.readFile('out.wav'));
      r.output = rel + '/' + outName; r.status = 'Mastered';
      if (S.mp3) {
        try {
          await run(['-y', '-hide_banner', '-nostats', '-i', 'out.wav', '-codec:a', 'libmp3lame', '-b:a', '320k', 'out.mp3']);
          const mp3Name = stem(name) + '-mastered.mp3';
          await writeOut(outDir, mp3Name, await ff.readFile('out.mp3'));
          r.mp3Output = rel + '/' + mp3Name;
        } catch (e) { r.status = 'Mastered (MP3 failed: ' + e.message + ')'; }
      }
    } catch (e) {
      r.status = 'FAILED'; r.output = e.message || String(e);
      if (/memory|abort/i.test(r.output)) resetFF();
    } finally {
      for (const f of ['in.wav', 'out.wav', 'out.mp3']) { try { await ff.deleteFile(f); } catch (e) { } }
    }
    return r;
  }
  async function convertOne(fileH, outDir, rel) {
    const toMp3 = S.conv === 'mp3', name = fileH.name, outName = stem(name) + (toMp3 ? '.mp3' : '.wav');
    const r = { source: name, status: '', output: '' };
    try {
      const file = await fileH.getFile();
      await ff.writeFile('c.in', new Uint8Array(await file.arrayBuffer()));
      await run(['-y', '-hide_banner', '-nostats', '-i', 'c.in'].concat(toMp3 ? ['-codec:a', 'libmp3lame', '-b:a', S.bitrate] : ['-codec:a', 'pcm_s16le'], ['c.out.' + (toMp3 ? 'mp3' : 'wav')]));
      await writeOut(outDir, outName, await ff.readFile('c.out.' + (toMp3 ? 'mp3' : 'wav')));
      r.status = 'Converted'; r.output = rel + '/' + outName;
    } catch (e) { r.status = 'FAILED'; r.output = e.message || String(e); if (/memory|abort/i.test(r.output)) resetFF(); }
    finally { for (const f of ['c.in', 'c.out.mp3', 'c.out.wav']) { try { await ff.deleteFile(f); } catch (e) { } } }
    return r;
  }

  // ---------- reports (same columns as the desktop engine, plus the verified result) ----------
  function toCSV(rows, fields) {
    const q = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [fields.join(',')].concat(rows.map((r) => fields.map((f) => q(r[f])).join(','))).join('\r\n') + '\r\n';
  }
  async function writeReport(dir, base, rows, fields) {
    await writeOut(dir, base + '.csv', toCSV(rows, fields));
    await writeOut(dir, base + '.json', JSON.stringify(rows, null, 2));
  }
  const MFIELDS = ['track', 'profile', 'targetLUFS', 'truePeakCeiling', 'measuredLUFS', 'resultLUFS', 'resultTruePeak', 'status', 'output', 'mp3Output'];

  // ---------- job ----------
  function plan() {
    const wav = (f) => /\.wav$/i.test(f.name);
    if (S.tool === 'convert') {
      const ext = S.conv === 'mp3' ? /\.wav$/i : /\.mp3$/i;
      const list = S.files.filter((f) => f.on && ext.test(f.name));
      return list.length ? [{ label: 'Converted - ' + (S.conv === 'mp3' ? 'MP3' : 'WAV'), path: ['Converted - ' + (S.conv === 'mp3' ? 'MP3' : 'WAV')], files: list }] : [];
    }
    if (S.mode === 'auto') {
      return S.subs.filter((s) => s.slug && s.wavs.length).map((s) => ({ label: 'Masters/' + s.name, path: ['Masters', s.name], files: s.wavs.map((h) => ({ name: h.name, h: h })), slug: s.slug, report: ['Masters', s.name] }));
    }
    const list = S.files.filter((f) => f.on && wav(f));
    return list.length ? [{ label: 'Masters - ' + target(S.profile).name, path: ['Masters - ' + target(S.profile).name], files: list, slug: S.profile }] : [];
  }
  async function start() {
    if (S.running) return;
    if (!S.dir) return toast('Pick a folder first', true);
    if (S.tool === 'master' && S.profile === 'custom' && (isNaN(+S.custom.I) || isNaN(+S.custom.TP) || isNaN(+S.custom.LRA))) return toast('Fill in all three Custom numbers', true);
    const groups = plan(), total = groups.reduce((a, g) => a + g.files.length, 0);
    if (!total) return toast(S.tool === 'convert' ? 'No ' + (S.conv === 'mp3' ? 'WAV' : 'MP3') + ' files checked in that folder' : (S.mode === 'auto' ? 'No version folders with a profile picked' : 'No WAV files checked'), true);
    try { if ((await S.dir.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await S.dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('Need permission to write into that folder', true); } catch (e) { }
    S.running = true; S.cancel = false; setBusy(true); $('msLog').textContent = '';
    const rowsEl = $('msResults'); rowsEl.innerHTML = '';
    let done = 0; const all = [];
    try {
      await loadFF();
      for (const g of groups) {
        const outDir = S.dry ? null : await subdir(S.dir, g.path);
        const res = [];
        for (const f of g.files) {
          if (S.cancel) break;
          done++;
          setMsg((S.tool === 'convert' ? 'Converting' : S.dry ? 'Measuring' : 'Mastering') + ' ' + done + ' of ' + total + ': ' + f.name + '…');
          $('msBar').style.width = ((done - 1) / total * 100) + '%';
          const tr = document.createElement('tr'); tr.innerHTML = '<td>' + esc(f.name) + '</td><td colspan="4" class="ms-dim">working…</td>'; rowsEl.appendChild(tr);
          if (!ff) await loadFF();
          const r = S.tool === 'convert' ? await convertOne(f.h, outDir, S.dir.name + '/' + g.path.join('/')) : await masterOne(f.h, outDir, g.slug, S.dir.name + '/' + g.path.join('/'));
          res.push(r); all.push(r); tr.innerHTML = rowHTML(r);
        }
        if (res.length && !S.dry) {
          if (S.tool === 'convert') await writeReport(outDir, 'HTR-Conversion-Report', res, ['source', 'status', 'output']);
          else await writeReport(outDir, 'HTR-Mastering-Report', res, MFIELDS);
        }
        if (S.cancel) break;
      }
      if (S.tool === 'master' && S.mode === 'auto' && all.length && !S.dry) await writeReport(await subdir(S.dir, ['Masters']), 'HTR-Mastering-Report', all, MFIELDS);
      $('msBar').style.width = '100%';
      const bad = all.filter((r) => r.status === 'FAILED').length;
      const where = S.dry ? 'Dry run — nothing was written.' : 'Saved in <b>' + esc(S.dir.name) + '</b> → ' + groups.map((g) => '<b>' + esc(g.label) + '</b>').join(', ') + ' (report CSV/JSON included).';
      setMsg((S.cancel ? 'Stopped. ' : '') + (all.length - bad) + ' of ' + all.length + ' done' + (bad ? ', <span class="ms-bad">' + bad + ' failed</span>' : '') + '. ' + where, true);
      if (!S.cancel && S.tool === 'master' && !S.dry) setMsg($('msMsg').innerHTML + '<br>Play the masters in album order before release.', true);
    } catch (e) {
      setMsg('<span class="ms-bad">Stopped: ' + esc(e.message || e) + '</span>', true); resetFF();
    }
    S.running = false; setBusy(false);
  }
  function fmtN(v, suffix) { return v === '' || v == null ? '—' : (+v).toFixed(1) + (suffix || ''); }
  function rowHTML(r) {
    if (r.source != null) return '<td>' + esc(r.source) + '</td><td colspan="3" class="ms-dim">' + esc(r.status === 'FAILED' ? '' : r.output) + '</td><td class="' + (r.status === 'FAILED' ? 'ms-bad' : 'ms-ok') + '" title="' + esc(r.status === 'FAILED' ? r.output : '') + '">' + esc(r.status) + '</td>';
    const off = r.resultLUFS !== '' && r.resultLUFS != null && Math.abs(r.resultLUFS - r.targetLUFS) > 1;
    return '<td>' + esc(r.track) + '<div class="ms-dim">' + esc(r.profile) + ' · target ' + r.targetLUFS + ' LUFS</div></td>'
      + '<td>' + fmtN(r.measuredLUFS) + '</td><td' + (off ? ' class="ms-warn" title="More than 1 LU off target — the track probably hit the peak ceiling. Worth a listen."' : '') + '>' + fmtN(r.resultLUFS) + '</td><td>' + fmtN(r.resultTruePeak) + '</td>'
      + '<td class="' + (r.status === 'FAILED' ? 'ms-bad' : 'ms-ok') + '" title="' + esc(r.status === 'FAILED' ? r.output : r.output + (r.mp3Output ? '\n' + r.mp3Output : '')) + '">' + esc(r.status === 'FAILED' ? 'FAILED: ' + r.output : r.status + (r.mp3Output ? ' + MP3' : '')) + '</td>';
  }

  // ---------- UI ----------
  const CSS = `
  .ms-wrap{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:18px;align-items:start;margin-top:18px}
  @media(max-width:1100px){.ms-wrap{grid-template-columns:1fr}}
  .ms-seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:6px 0 10px}
  .ms-seg button{flex:1;background:var(--panel2);color:var(--muted);padding:9px 6px;font-size:14px;font-weight:600;border-radius:0}
  .ms-seg button.on{background:var(--red);color:#fff}
  .ms-lab{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:14px 0 5px;display:block}
  .ms-dim{color:var(--muted);font-size:12.5px;line-height:1.45}
  .ms-ok{color:var(--ok)} .ms-bad{color:#e05252} .ms-warn{color:var(--warn)}
  .ms-files{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel2);margin-top:8px}
  .ms-file{display:flex;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line);font-size:14px;cursor:pointer}
  .ms-file input{width:auto} .ms-file.off{color:var(--muted)}
  .ms-sub{display:flex;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line);font-size:14px}
  .ms-sub select{width:220px;padding:6px 8px;font-size:13px} .ms-sub .n{flex:1}
  .ms-profiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .ms-prof{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 10px;cursor:pointer;text-align:left;color:var(--cream)}
  .ms-prof b{display:block;font-size:14px} .ms-prof span{font-size:12px;color:var(--muted)}
  .ms-prof.on{border-color:var(--red);box-shadow:inset 0 0 0 1px var(--red)}
  .ms-custom{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px}
  .ms-custom input{padding:8px;font-size:14px}
  .ms-chk{display:flex;gap:8px;align-items:center;font-size:14px;margin:7px 0;cursor:pointer} .ms-chk input{width:auto}
  .ms-go{width:100%;font-size:19px !important;padding:14px !important;margin-top:10px;font-family:'Bebas Neue',sans-serif;letter-spacing:.05em}
  .ms-prog{height:8px;background:var(--panel2);border-radius:99px;overflow:hidden;margin-top:12px} .ms-prog>div{height:100%;width:0;background:var(--red);transition:width .3s}
  .ms-table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:10px}
  .ms-table th{text-align:left;font-weight:600;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--line)}
  .ms-table td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  .ms-log{max-height:160px;overflow:auto;background:#000;color:#8a8f98;font:11.5px/1.4 monospace;padding:8px;border-radius:8px;margin-top:10px;white-space:pre-wrap}
  `;
  const seg = (g, opts) => '<div class="ms-seg" data-g="' + g + '">' + opts.map((o) => '<button data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
  function build() {
    if (built) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    $('view-master').innerHTML = `
    <div class="card" style="max-width:none">
      <h3>Mastering</h3>
      <div class="sub">Two-pass loudness mastering, the same engine as the old HTR Mastering Engine, now running right here in the browser (Chrome or Edge, any computer).
      Pick a folder and choose a profile. Masters are new files in a <b>Masters</b> folder inside it; your mixes are never touched.</div>
      ${seg('tool', [['master', 'Master'], ['convert', 'Convert (WAV ↔ MP3)']])}
    </div>
    <div class="ms-wrap">
      <div class="card">
        <div id="msMasterMode">${seg('mode', [['folder', 'Songs in one folder'], ['auto', 'Whole album (version folders)']])}</div>
        <div id="msConvMode" class="hidden">${seg('conv', [['mp3', 'WAV → MP3'], ['wav', 'MP3 → WAV']])}</div>
        <div class="ms-dim" id="msModeHelp"></div>
        <div class="save-bar" style="margin-top:12px">
          <button class="btn btn-blue" id="msPick">&#128193; Pick folder</button>
          <span class="ms-dim" id="msFolderName">No folder picked yet.</span>
        </div>
        <div id="msList"></div>
        <div id="msOut" style="margin-top:14px"></div>
      </div>
      <div>
        <div class="card" id="msProfileCard">
          <span class="ms-lab" style="margin-top:0" id="msProfLab">Profile</span>
          <div class="ms-profiles">${PROFILES.map((p) => '<button class="ms-prof" data-prof="' + p.slug + '"><b>' + esc(p.name) + '</b><span>' + p.I + ' LUFS · ' + p.TP + ' dBTP · LRA ' + p.LRA + '</span></button>').join('')}
            <button class="ms-prof" data-prof="custom"><b>Custom</b><span>set your own targets</span></button></div>
          <div class="ms-custom hidden" id="msCustom">
            <label class="ms-dim">Target LUFS<input type="number" step="0.5" data-cu="I"></label>
            <label class="ms-dim">True peak dBTP<input type="number" step="0.1" data-cu="TP"></label>
            <label class="ms-dim">LRA<input type="number" step="1" data-cu="LRA"></label>
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <div id="msMasterOpts">
            <label class="ms-chk"><input type="checkbox" id="msMp3"> Also export MP3 (320 kbps)</label>
            <label class="ms-chk"><input type="checkbox" id="msDry"> Dry run (measure only, write nothing)</label>
          </div>
          <div id="msConvOpts" class="hidden"><span class="ms-lab" style="margin-top:0">MP3 bitrate</span>
            <select id="msBitrate"><option value="320k">320 kbps (best)</option><option value="256k">256 kbps</option><option value="192k">192 kbps</option><option value="128k">128 kbps (smallest)</option></select></div>
          <button class="btn btn-red ms-go" id="msGo">Start</button>
          <button class="btn btn-ghost hidden" id="msStop" style="width:100%;margin-top:8px">Stop after this song</button>
          <div class="ms-prog"><div id="msBar"></div></div>
          <div class="ms-dim" id="msMsg" style="margin-top:8px">About 25 seconds per song. Keep this tab open while it works.</div>
        </div>
      </div>
    </div>`;
    wire(); built = true; sync();
  }

  function setMsg(h, html) { const e = $('msMsg'); if (!e) return; if (html) e.innerHTML = h; else e.textContent = h; }
  let logBuf = [], logT = null;
  function logLine(s) {
    logBuf.push(s); if (logT) return;
    logT = setTimeout(() => { const e = $('msLog'); if (e) { e.textContent = (e.textContent + '\n' + logBuf.join('\n')).split('\n').slice(-300).join('\n'); e.scrollTop = e.scrollHeight; } logBuf = []; logT = null; }, 250);
  }
  function setBusy(b) {
    $('msGo').disabled = b; $('msPick').disabled = b; $('msStop').classList.toggle('hidden', !b);
    document.querySelectorAll('#view-master .ms-seg button, #view-master .ms-prof, #view-master .ms-file input, #view-master .ms-sub select').forEach((x) => { x.disabled = b; });
  }
  function sync() {
    if (!built) return;
    document.querySelectorAll('#view-master .ms-seg').forEach((s) => { const g = s.dataset.g, v = S[g]; s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); });
    const conv = S.tool === 'convert', auto = !conv && S.mode === 'auto';
    $('msMasterMode').classList.toggle('hidden', conv); $('msConvMode').classList.toggle('hidden', !conv);
    $('msMasterOpts').classList.toggle('hidden', conv); $('msConvOpts').classList.toggle('hidden', !conv || S.conv !== 'mp3');
    $('msProfileCard').classList.toggle('hidden', conv || auto);
    document.querySelectorAll('#view-master .ms-prof').forEach((b) => b.classList.toggle('on', b.dataset.prof === S.profile));
    $('msCustom').classList.toggle('hidden', S.profile !== 'custom');
    document.querySelectorAll('#view-master [data-cu]').forEach((i) => { if (document.activeElement !== i) i.value = S.custom[i.dataset.cu]; });
    $('msMp3').checked = S.mp3; $('msDry').checked = S.dry; $('msBitrate').value = S.bitrate;
    $('msGo').textContent = conv ? 'Start converting' : S.dry ? 'Measure only' : 'Start mastering';
    $('msModeHelp').innerHTML = conv ? 'Straight format change, no loudness processing. Output goes in a <b>Converted - ' + (S.conv === 'mp3' ? 'MP3' : 'WAV') + '</b> folder inside the one you pick.'
      : auto ? 'Pick the <b>album</b> folder that holds version subfolders (Studio, Live, Piano…). Each subfolder gets its own profile, auto-picked from its name. Output: <b>Masters/&lt;version&gt;</b> inside the album folder.'
        : 'Pick the folder with your mixed WAVs, and uncheck any you don’t want (one checked = a single). Output: <b>Masters - &lt;Profile&gt;</b> inside that folder.';
    renderList();
  }
  function renderList() {
    const box = $('msList'); if (!box) return;
    if (!S.dir) { box.innerHTML = ''; return; }
    const conv = S.tool === 'convert';
    if (!conv && S.mode === 'auto') {
      if (!S.subs.length) { box.innerHTML = '<div class="ms-dim" style="margin-top:10px">No subfolders with WAVs in here. If this folder holds the WAVs itself, use <b>Songs in one folder</b>.</div>'; return; }
      box.innerHTML = '<div class="ms-files">' + S.subs.map((s, i) => '<div class="ms-sub"><span class="n">&#128193; ' + esc(s.name) + ' <span class="ms-dim">(' + s.wavs.length + ' WAV)</span></span><select data-sub="' + i + '"><option value="">— skip —</option>'
        + PROFILES.map((p) => '<option value="' + p.slug + '"' + (s.slug === p.slug ? ' selected' : '') + '>' + esc(p.name) + ' (' + p.I + ')</option>').join('') + '</select></div>').join('') + '</div>'
        + '<div class="ms-dim" style="margin-top:6px">Folders whose name didn’t match a profile are set to skip — pick one to include them.</div>';
      return;
    }
    const ext = conv ? (S.conv === 'mp3' ? /\.wav$/i : /\.mp3$/i) : /\.wav$/i;
    const list = S.files.map((f, i) => ({ f: f, i: i })).filter((x) => ext.test(x.f.name));
    if (!list.length) { box.innerHTML = '<div class="ms-dim" style="margin-top:10px">No ' + (conv && S.conv === 'wav' ? 'MP3' : 'WAV') + ' files directly in this folder.' + (!conv && S.subs.length ? ' It has subfolders though — try <b>Whole album</b>.' : '') + '</div>'; return; }
    const on = list.filter((x) => x.f.on).length;
    box.innerHTML = '<div class="ms-dim" style="margin-top:10px">' + on + ' of ' + list.length + ' checked · <a href="#" data-all="1">all</a> · <a href="#" data-all="0">none</a></div><div class="ms-files">'
      + list.map((x) => '<label class="ms-file' + (x.f.on ? '' : ' off') + '"><input type="checkbox" data-fi="' + x.i + '"' + (x.f.on ? ' checked' : '') + '>' + esc(x.f.name) + '</label>').join('') + '</div>';
  }
  async function pick() {
    if (!window.showDirectoryPicker) return toast('This needs Chrome or Edge (folder access isn’t available in this browser)', true);
    let h;
    try { h = await window.showDirectoryPicker({ id: 'htr-mastering', mode: 'readwrite' }); } catch (e) { if (e.name !== 'AbortError') toast('Folder: ' + e.message, true); return; }
    setMsg('Reading folder…');
    const top = await listDir(h);
    for (const s of top.subs) { const inner = await listDir(s.h); s.wavs = inner.files.filter((f) => /\.wav$/i.test(f.name)).map((f) => f.h); s.slug = detect(s.name); }
    S.dir = h; S.files = top.files; S.subs = top.subs.filter((s) => s.wavs.length);
    // sensible default: a folder that only has version subfolders -> album mode
    if (S.tool === 'master' && !S.files.some((f) => /\.wav$/i.test(f.name)) && S.subs.length) S.mode = 'auto';
    $('msFolderName').innerHTML = '&#128193; <b>' + esc(h.name) + '</b>';
    setMsg('About 25 seconds per song. Keep this tab open while it works.');
    $('msOut').innerHTML = '<table class="ms-table"><thead><tr><th>Track</th><th>Before</th><th>After</th><th>Peak</th><th>Result</th></tr></thead><tbody id="msResults"></tbody></table>'
      + '<details style="margin-top:10px"><summary class="ms-dim" style="cursor:pointer">FFmpeg log</summary><div class="ms-log" id="msLog"></div></details>';
    sync();
  }
  function wire() {
    const root = $('view-master');
    root.addEventListener('click', (e) => {
      if (S.running) return;
      const sb = e.target.closest('.ms-seg button'); if (sb) { S[sb.closest('.ms-seg').dataset.g] = sb.dataset.v; sync(); return; }
      const pr = e.target.closest('.ms-prof'); if (pr) { S.profile = pr.dataset.prof; sync(); return; }
      const al = e.target.closest('[data-all]'); if (al) { e.preventDefault(); const ext = S.tool === 'convert' ? (S.conv === 'mp3' ? /\.wav$/i : /\.mp3$/i) : /\.wav$/i; S.files.forEach((f) => { if (ext.test(f.name)) f.on = al.dataset.all === '1'; }); renderList(); }
    });
    root.addEventListener('change', (e) => {
      const fi = e.target.closest('[data-fi]'); if (fi) { S.files[+fi.dataset.fi].on = fi.checked; renderList(); return; }
      const sb = e.target.closest('[data-sub]'); if (sb) { S.subs[+sb.dataset.sub].slug = sb.value; return; }
    });
    root.addEventListener('input', (e) => { const cu = e.target.closest('[data-cu]'); if (cu) S.custom[cu.dataset.cu] = cu.value; });
    $('msPick').onclick = pick;
    $('msMp3').onchange = function () { S.mp3 = this.checked; };
    $('msDry').onchange = function () { S.dry = this.checked; sync(); };
    $('msBitrate').onchange = function () { S.bitrate = this.value; };
    $('msGo').onclick = start;
    $('msStop').onclick = () => { S.cancel = true; setMsg('Stopping after the current song…'); };
    window.addEventListener('beforeunload', (e) => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
  }

  window.MS = { onShow: build, _state: S, _plan: plan };
})();
