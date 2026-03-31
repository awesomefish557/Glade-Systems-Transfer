/** YouTube → MP4 / audio page (Glade styling). API: /convertor/api/* proxied to CONVERTOR_ORIGIN. */
export function convertorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Convertor — Glade Systems</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      background: #050d06;
      font-family: Georgia, serif;
      color: #aed4b8;
      padding: 28px 20px 48px;
    }
    .wrap { max-width: 520px; margin: 0 auto; }
    h1 {
      font-size: 22px;
      font-style: italic;
      font-weight: 600;
      margin-bottom: 6px;
      color: #c8e8d0;
    }
    .sub {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-family: Arial, sans-serif;
      color: rgba(90, 158, 111, 0.75);
      margin-bottom: 28px;
    }
    label {
      display: block;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-family: Arial, sans-serif;
      color: rgba(140, 200, 160, 0.65);
      margin-bottom: 8px;
    }
    input[type="url"] {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid rgba(74, 124, 89, 0.45);
      border-radius: 4px;
      background: rgba(8, 22, 12, 0.85);
      color: #d4ecd8;
      font-size: 14px;
      font-family: ui-monospace, monospace;
      color-scheme: dark;
    }
    input:focus {
      outline: none;
      border-color: rgba(140, 200, 160, 0.5);
    }
    .row { margin-bottom: 18px; }
    .modes {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .modes label.opt {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 10px 14px;
      border: 1px solid rgba(74, 124, 89, 0.4);
      border-radius: 4px;
      background: rgba(8, 22, 12, 0.5);
      text-transform: none;
      letter-spacing: normal;
      font-size: 13px;
      color: #9ec9ae;
      font-family: Georgia, serif;
    }
    .modes input { accent-color: #5a9e6f; }
    .quality-btns {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .q-btn {
      flex: 1;
      min-width: 120px;
      padding: 14px 16px;
      border-radius: 4px;
      border: 1px solid rgba(74, 124, 89, 0.5);
      background: rgba(8, 22, 12, 0.75);
      color: #d4ecd8;
      font-family: Georgia, serif;
      font-size: 15px;
      cursor: pointer;
      text-align: center;
      transition: border-color 0.15s, background 0.15s;
    }
    .q-btn:hover {
      border-color: rgba(140, 200, 160, 0.45);
      background: rgba(14, 32, 18, 0.9);
    }
    .q-btn.is-on {
      border-color: rgba(140, 200, 160, 0.75);
      background: rgba(40, 85, 55, 0.35);
      box-shadow: 0 0 0 1px rgba(140, 200, 160, 0.2);
    }
    .q-btn .q-sub {
      display: block;
      margin-top: 6px;
      font-size: 11px;
      font-family: Arial, sans-serif;
      letter-spacing: 0.06em;
      color: rgba(140, 200, 160, 0.65);
      text-transform: none;
    }
    button, .btn {
      display: inline-block;
      padding: 12px 22px;
      border: none;
      border-radius: 4px;
      background: linear-gradient(180deg, rgba(90, 158, 111, 0.35), rgba(60, 110, 75, 0.5));
      color: #e8f5ea;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-family: Arial, sans-serif;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid rgba(140, 200, 160, 0.25);
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button:hover:not(:disabled), .btn:hover { background: rgba(90, 158, 111, 0.45); }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 22px; }
    .meta {
      font-size: 13px;
      color: #7ab08a;
      margin-top: 16px;
      line-height: 1.45;
    }
    .err {
      margin-top: 14px;
      padding: 12px;
      border-radius: 4px;
      background: rgba(80, 30, 30, 0.35);
      border: 1px solid rgba(180, 80, 80, 0.35);
      color: #e8a8a8;
      font-size: 13px;
    }
    .hint {
      margin-top: 20px;
      font-size: 11px;
      color: rgba(90, 158, 111, 0.55);
      line-height: 1.5;
      font-family: Arial, sans-serif;
    }
    a.back {
      display: inline-block;
      margin-top: 28px;
      font-size: 11px;
      color: #5a9e6f;
      text-decoration: none;
      letter-spacing: 0.08em;
      font-family: Arial, sans-serif;
    }
    a.back:hover { color: #7ec492; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Convertor</h1>
    <p class="sub">YouTube → MP4 or MP3</p>

    <div class="row">
      <label for="url">YouTube link</label>
      <input type="url" id="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off">
    </div>

    <div class="row">
      <label>Output</label>
      <div class="modes">
        <label class="opt"><input type="radio" name="mode" value="video" checked> MP4 (video)</label>
        <label class="opt"><input type="radio" name="mode" value="audio"> MP3 (audio)</label>
      </div>
    </div>

    <div class="row" id="quality-row" hidden>
      <label>Quality</label>
      <div class="quality-btns" id="quality-btns"></div>
    </div>

    <div class="actions">
      <button type="button" id="lookup">Look up</button>
      <a class="btn" id="download" href="#" style="display:none">Download</a>
    </div>

    <p class="meta" id="title-out" hidden></p>
    <p class="meta" id="info-out" hidden style="color: rgba(150, 205, 165, 0.9)"></p>
    <div class="err" id="err" hidden></div>
    <p class="hint">
      Output is <strong>MP4</strong> (video) or <strong>MP3</strong> (audio). <strong>ffmpeg</strong> must be on PATH for MP3 and for MP4 when YouTube has no single MP4 file (merge).
      Check <code style="color:#7ab08a">http://127.0.0.1:3847/health</code> — <code style="color:#7ab08a">"ffmpeg": true</code> when ready.
      Run <code style="color:#7ab08a">npm start</code> in <code style="color:#7ab08a">convertor</code>. Use <strong>http://</strong> for local Glade or <code style="color:#7ab08a">CONVERTOR_ORIGIN</code> in <code style="color:#7ab08a">router/.dev.vars</code>.
      Only download what you’re allowed to.
    </p>
    <a class="back" href="/">← back to glade</a>
  </div>

  <script>
    const h = window.location.hostname;
    const isLocalHost =
      h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
    /** HTTPS pages cannot call http://127.0.0.1 (mixed content) — use worker proxy instead. */
    const useDirectConvertor = isLocalHost && window.location.protocol === 'http:';
    let localPort = '3847';
    try {
      const p = localStorage.getItem('glade_convertor_port');
      if (p && /^[0-9]{2,5}$/.test(p)) localPort = p;
    } catch (e) { /* ignore */ }
    const LOCAL_CONVERTOR = 'http://127.0.0.1:' + localPort;
    function api(path) {
      const p = path.startsWith('/') ? path : '/' + path;
      if (useDirectConvertor) return LOCAL_CONVERTOR + '/api' + p;
      return '/convertor/api' + p;
    }
    if (isLocalHost && window.location.protocol === 'https:') {
      const hostForHttp = h === '::1' || h === '[::1]' ? 'localhost' : h;
      const portPart = window.location.port ? ':' + window.location.port : '';
      const el = document.createElement('p');
      el.className = 'err';
      el.style.marginBottom = '14px';
      el.innerHTML =
        'This tab is <strong>HTTPS</strong>. Browsers block calls to <code>http://127.0.0.1</code> (mixed content). ' +
        'Open <strong>http://' +
        hostForHttp +
        portPart +
        window.location.pathname +
        '</strong> instead, or set <code>CONVERTOR_ORIGIN=http://127.0.0.1:' +
        localPort +
        '</code> in <code>router/.dev.vars</code> so the worker can proxy (plain <code>wrangler dev</code>, not <code>--remote</code>).';
      document.querySelector('.wrap').prepend(el);
    }
    const urlEl = document.getElementById('url');
    const qualityRow = document.getElementById('quality-row');
    const qualityBtns = document.getElementById('quality-btns');
    const lookupBtn = document.getElementById('lookup');
    const downloadEl = document.getElementById('download');
    const titleOut = document.getElementById('title-out');
    const infoOut = document.getElementById('info-out');
    const errEl = document.getElementById('err');
    let lastInfo = null;
    let selectedItag = '';

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.hidden = !msg;
    }

    function formatDetail(f) {
      if (!f) return '';
      const bits = [f.label, f.container].filter(Boolean);
      return bits.join(' · ');
    }

    function buildDownloadHref() {
      const u = encodeURIComponent(urlEl.value.trim());
      const mode = document.querySelector('input[name="mode"]:checked').value;
      if (!u || !selectedItag) return '#';
      return api('/download?url=' + u + '&mode=' + (mode === 'audio' ? 'audio' : 'video') + '&itag=' + encodeURIComponent(selectedItag));
    }

    function setItag(itag) {
      selectedItag = String(itag);
      qualityBtns.querySelectorAll('.q-btn').forEach((b) => {
        b.classList.toggle('is-on', b.getAttribute('data-itag') === selectedItag);
      });
      downloadEl.href = buildDownloadHref();
    }

    function renderQualityButtons() {
      qualityBtns.innerHTML = '';
      const mode = document.querySelector('input[name="mode"]:checked').value;
      const list = mode === 'audio' ? (lastInfo && lastInfo.audioFormats) : (lastInfo && lastInfo.videoFormats);
      if (!list || !list.length) {
        qualityRow.hidden = true;
        downloadEl.style.display = 'none';
        selectedItag = '';
        return;
      }
      qualityRow.hidden = false;

      function addBtn(title, f) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'q-btn';
        b.setAttribute('data-itag', String(f.itag));
        b.textContent = title;
        const sub = document.createElement('span');
        sub.className = 'q-sub';
        sub.textContent = formatDetail(f);
        b.appendChild(sub);
        b.addEventListener('click', () => setItag(f.itag));
        qualityBtns.appendChild(b);
      }

      if (list.length === 1) {
        addBtn('Best available', list[0]);
      } else {
        const hi = list[0];
        const lo = list[list.length - 1];
        const same = String(hi.itag) === String(lo.itag);
        if (same) {
          addBtn('Best available', hi);
        } else {
          addBtn('High', hi);
          addBtn('Low', lo);
        }
      }

      setItag(qualityBtns.querySelector('.q-btn').getAttribute('data-itag'));
      downloadEl.style.display = 'inline-block';
    }

    document.querySelectorAll('input[name="mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (lastInfo) renderQualityButtons();
      });
    });

    lookupBtn.addEventListener('click', async () => {
      showErr('');
      infoOut.hidden = true;
      infoOut.textContent = '';
      titleOut.hidden = true;
      downloadEl.style.display = 'none';
      lastInfo = null;
      selectedItag = '';
      qualityBtns.innerHTML = '';
      qualityRow.hidden = true;
      const raw = urlEl.value.trim();
      if (!raw) {
        showErr('Paste a YouTube URL.');
        return;
      }
      lookupBtn.disabled = true;
      try {
        const res = await fetch(api('/info?url=' + encodeURIComponent(raw)));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error) {
            showErr(String(data.error));
          } else if (res.status === 503) {
            showErr(
              'Convertor API unavailable. Run npm start in the convertor folder and set CONVERTOR_ORIGIN (e.g. router/.dev.vars for wrangler dev).'
            );
          } else {
            showErr('Request failed (' + res.status + '). Check the convertor terminal for errors (Python 3.9+ may be required for yt-dlp).');
          }
          return;
        }
        lastInfo = data;
        titleOut.textContent = data.title || '';
        titleOut.hidden = !data.title;
        if (data.note) {
          infoOut.textContent = data.note;
          infoOut.hidden = false;
        }
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const hasV = data.videoFormats && data.videoFormats.length;
        const hasA = data.audioFormats && data.audioFormats.length;
        if (mode === 'audio' && !hasA) {
          showErr(
            data.note ||
              'MP3 needs ffmpeg on the convertor machine. Install ffmpeg, restart the convertor, and check /health shows "ffmpeg": true.'
          );
          return;
        }
        if (mode === 'video' && !hasV) {
          showErr(
            data.note ||
              'No MP4 option for this video. Install ffmpeg for merged MP4, or try another link.'
          );
          return;
        }
        renderQualityButtons();
      } catch (e) {
        const m = e && e.message ? String(e.message) : String(e);
        if (/Failed to fetch|NetworkError|Load failed|refused/i.test(m)) {
          showErr(
            'Could not reach the convertor. Start it: cd convertor → npm start. ' +
              (useDirectConvertor
                ? 'You are on HTTP — if this persists, try http://127.0.0.1:' +
                  localPort +
                  '/health in a new tab (should show ok and ffmpeg).'
                : 'You are using the worker proxy — ensure router/.dev.vars has CONVERTOR_ORIGIN=http://127.0.0.1:' +
                  localPort +
                  ' and use wrangler dev without --remote. If this page is HTTPS on localhost, switch to http:// or see the yellow note above.')
          );
        } else {
          showErr('Network error: ' + m);
        }
      } finally {
        lookupBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
