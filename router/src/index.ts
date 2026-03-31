import { convertorPage } from './convertorPage';

function stripPrefix(path: string, prefix: string): string {
  const stripped = path.slice(prefix.length);
  return stripped.startsWith('/') ? stripped : '/' + stripped;
}

export interface Env {
  /** Base URL of the Node convertor service, e.g. http://127.0.0.1:3847 (no trailing slash) */
  CONVERTOR_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '') {
      return new Response(landingPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (path.startsWith('/convertor/api')) {
      return proxyConvertorApi(request, env);
    }

    if (path === '/convertor' || path === '/convertor/') {
      return new Response(convertorPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (path === '/app' || path.startsWith('/app/')) {
      const dest = 'https://glade-ui.pages.dev' + stripPrefix(path, '/app');
      return fetch(new Request(dest, request));
    }

    if (path.startsWith('/seer')) {
      const dest = 'https://master.seer-11i.pages.dev' + stripPrefix(path, '/seer');
      return fetch(new Request(dest, request));
    }

    if (path.startsWith('/cosmo')) {
      const dest = 'http://cosmo.gladesystems.uk:5000' + stripPrefix(path, '/cosmo');
      return fetch(new Request(dest, request));
    }

    if (path.startsWith('/delphi')) {
      const dest = 'https://delphi-ui.pages.dev' + stripPrefix(path, '/delphi');
      return fetch(new Request(dest, request));
    }

    if (path.startsWith('/lighthouse')) {
      return new Response(lighthousePage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

async function proxyConvertorApi(request: Request, env: Env): Promise<Response> {
  const origin = env.CONVERTOR_ORIGIN?.replace(/\/$/, '');
  if (!origin) {
    return new Response(
      JSON.stringify({
        error:
          'Convertor service not configured. Set CONVERTOR_ORIGIN on the worker and run the convertor service.',
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
  const url = new URL(request.url);
  const inner = url.pathname.replace(/^\/convertor/, '') + url.search;
  const dest = origin + inner;
  const init: RequestInit = { method: request.method, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }
  try {
    return await fetch(dest, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({
        error: `Cannot reach convertor at ${origin} (${msg}). Local dev: run "npm start" in convertor/; use plain "wrangler dev" (not --remote) with CONVERTOR_ORIGIN=http://127.0.0.1:3847 in .dev.vars.`,
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

function landingPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Glade Systems</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #050d06; overflow: hidden; font-family: Georgia, serif; }
    canvas { position: fixed; inset: 0; z-index: 0; }

    #title-cv {
      position: fixed;
      top: 50%;
      left: 0;
      transform: translateY(-50%);
      z-index: 2;
      pointer-events: none;
      width: 100vw;
      height: 140px;
    }

    .constellation {
      position: fixed; cursor: pointer; z-index: 3;
      transition: opacity 0.4s;
    }
    .c-lines { transition: opacity 0.4s; }
    .c-label {
      font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      color: rgba(140,200,160,0); font-family: Arial, sans-serif;
      text-align: center; position: absolute;
      width: 120px; left: 50%; transform: translateX(-50%);
      transition: color 0.4s; pointer-events: none; margin-top: 4px;
    }
    .constellation:hover .c-label { color: rgba(160,215,175,0.85); }
    .constellation:hover .c-lines { opacity: 1 !important; }

    .settings-bar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 32px; z-index: 4;
    }
    .settings-bar a {
      font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
      color: rgba(45,74,53,0.5); font-family: Arial, sans-serif;
      text-decoration: none; cursor: pointer; transition: color 0.3s;
    }
    .settings-bar a:hover { color: rgba(140,200,160,0.7); }

    .grass { position: fixed; bottom: 0; left: 0; width: 100%; z-index: 1; pointer-events: none; }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <canvas id="title-cv" aria-hidden="true"></canvas>

  <!-- SEER — top left, eye/arc shape -->
  <div class="constellation" style="left:10%;top:15%" onclick="location.href='/seer'">
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="15" y1="65" x2="32" y2="48"/>
        <line x1="32" y1="48" x2="45" y2="22"/>
        <line x1="45" y1="22" x2="60" y2="40"/>
        <line x1="60" y1="40" x2="72" y2="58"/>
        <line x1="45" y1="22" x2="48" y2="8"/>
        <line x1="32" y1="48" x2="20" y2="38"/>
      </g>
      <circle cx="15" cy="65" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="32" cy="48" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="45" cy="22" r="3.4" fill="rgba(220,245,220,0.95)"/>
      <circle cx="60" cy="40" r="2.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="72" cy="58" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="48" cy="8" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="20" cy="38" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <text x="45" y="16" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">S</text>
    </svg>
    <div class="c-label">Seer</div>
  </div>

  <!-- COSMO — top right, hive/hexagon -->
  <div class="constellation" style="right:12%;top:12%" onclick="location.href='/cosmo'">
    <svg width="100" height="95" viewBox="0 0 100 95" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="50" y1="8" x2="78" y2="25"/>
        <line x1="78" y1="25" x2="78" y2="58"/>
        <line x1="78" y1="58" x2="50" y2="75"/>
        <line x1="50" y1="75" x2="22" y2="58"/>
        <line x1="22" y1="58" x2="22" y2="25"/>
        <line x1="22" y1="25" x2="50" y2="8"/>
        <line x1="50" y1="8" x2="50" y2="42"/>
        <line x1="50" y1="42" x2="78" y2="25"/>
        <line x1="50" y1="42" x2="22" y2="25"/>
        <line x1="50" y1="42" x2="50" y2="75"/>
      </g>
      <circle cx="50" cy="8" r="3.4" fill="rgba(220,245,220,0.95)"/>
      <circle cx="78" cy="25" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="78" cy="58" r="2.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="50" cy="75" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="22" cy="58" r="2.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="22" cy="25" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="50" cy="42" r="2.64" fill="rgba(200,230,200,0.85)"/>
      <text x="50" y="4" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">C</text>
    </svg>
    <div class="c-label">Cosmo</div>
  </div>

  <!-- GOVERNOR — upper centre-left, balance / mandate -->
  <div class="constellation" style="left:24%;top:18%" onclick="location.href='/app/#governor'">
    <svg width="82" height="82" viewBox="0 0 82 82" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="41" y1="14" x2="28" y2="32"/>
        <line x1="41" y1="14" x2="54" y2="32"/>
        <line x1="28" y1="32" x2="22" y2="52"/>
        <line x1="54" y1="32" x2="60" y2="52"/>
        <line x1="22" y1="52" x2="41" y2="64"/>
        <line x1="60" y1="52" x2="41" y2="64"/>
        <line x1="41" y1="14" x2="41" y2="38"/>
        <line x1="22" y1="52" x2="60" y2="52"/>
      </g>
      <circle cx="41" cy="14" r="3" fill="rgba(220,245,220,0.95)"/>
      <circle cx="28" cy="32" r="2.16" fill="rgba(200,230,200,0.85)"/>
      <circle cx="54" cy="32" r="2.16" fill="rgba(200,230,200,0.85)"/>
      <circle cx="22" cy="52" r="2.04" fill="rgba(185,220,190,0.7)"/>
      <circle cx="60" cy="52" r="2.04" fill="rgba(185,220,190,0.7)"/>
      <circle cx="41" cy="38" r="1.92" fill="rgba(200,230,200,0.85)"/>
      <circle cx="41" cy="64" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <text x="41" y="10" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">G</text>
    </svg>
    <div class="c-label">Governor</div>
  </div>

  <!-- RYLEE — upper centre-right, project nodes -->
  <div class="constellation" style="right:24%;top:18%" onclick="location.href='/app/#rylee'">
    <svg width="82" height="82" viewBox="0 0 82 82" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="20" y1="58" x2="38" y2="24"/>
        <line x1="38" y1="24" x2="62" y2="42"/>
        <line x1="62" y1="42" x2="44" y2="66"/>
        <line x1="44" y1="66" x2="20" y2="58"/>
        <line x1="38" y1="24" x2="52" y2="20"/>
        <line x1="52" y1="20" x2="62" y2="42"/>
      </g>
      <circle cx="20" cy="58" r="2.04" fill="rgba(185,220,190,0.7)"/>
      <circle cx="38" cy="24" r="2.64" fill="rgba(200,230,200,0.85)"/>
      <circle cx="62" cy="42" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="44" cy="66" r="2.16" fill="rgba(185,220,190,0.7)"/>
      <circle cx="52" cy="20" r="3" fill="rgba(220,245,220,0.95)"/>
      <text x="52" y="16" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">R</text>
    </svg>
    <div class="c-label">Rylee</div>
  </div>

  <!-- DELPHI — left, temple columns -->
  <div class="constellation" style="left:14%;bottom:28%" onclick="location.href='/delphi'">
    <svg width="90" height="95" viewBox="0 0 90 95" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="15" y1="78" x2="15" y2="35"/>
        <line x1="45" y1="78" x2="45" y2="28"/>
        <line x1="75" y1="78" x2="75" y2="35"/>
        <line x1="15" y1="35" x2="45" y2="15"/>
        <line x1="45" y1="15" x2="75" y2="35"/>
        <line x1="10" y1="78" x2="80" y2="78"/>
        <line x1="45" y1="15" x2="45" y2="8"/>
        <line x1="30" y1="55" x2="60" y2="55"/>
      </g>
      <circle cx="15" cy="78" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="15" cy="35" r="2.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="45" cy="78" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="45" cy="28" r="2.64" fill="rgba(200,230,200,0.85)"/>
      <circle cx="45" cy="15" r="3" fill="rgba(220,245,220,0.95)"/>
      <circle cx="45" cy="8" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="75" cy="78" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="75" cy="35" r="2.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="10" cy="78" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="80" cy="78" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="30" cy="55" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="60" cy="55" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <text x="45" y="4" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">D</text>
    </svg>
    <div class="c-label">Delphi</div>
  </div>

  <!-- LIGHTHOUSE — right, tower with beams -->
  <div class="constellation" style="right:14%;bottom:25%" onclick="location.href='/lighthouse'">
    <svg width="95" height="100" viewBox="0 0 95 100" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="48" y1="8" x2="48" y2="65"/>
        <line x1="35" y1="65" x2="61" y2="65"/>
        <line x1="30" y1="75" x2="66" y2="75"/>
        <line x1="20" y1="85" x2="75" y2="85"/>
        <line x1="48" y1="8" x2="12" y2="28"/>
        <line x1="48" y1="8" x2="82" y2="22"/>
        <line x1="48" y1="8" x2="78" y2="42"/>
        <line x1="48" y1="8" x2="15" y2="45"/>
      </g>
      <circle cx="48" cy="8" r="3.6" fill="rgba(220,245,220,0.95)"/>
      <circle cx="48" cy="65" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="35" cy="65" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="61" cy="65" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="30" cy="75" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="66" cy="75" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="20" cy="85" r="2.16" fill="rgba(185,220,190,0.7)"/>
      <circle cx="75" cy="85" r="2.16" fill="rgba(185,220,190,0.7)"/>
      <circle cx="12" cy="28" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="82" cy="22" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="78" cy="42" r="1.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="15" cy="45" r="1.2" fill="rgba(185,220,190,0.7)"/>
      <text x="48" y="4" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">L</text>
    </svg>
    <div class="c-label">Lighthouse</div>
  </div>

  <!-- CONVERTOR — top centre, same row as governor / rylee -->
  <div class="constellation" style="left:50%;top:18%;transform:translateX(-50%)" onclick="location.href='/convertor'">
    <svg width="78" height="72" viewBox="0 0 78 72" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.7" opacity="0.55">
        <line x1="12" y1="36" x2="28" y2="22"/>
        <line x1="28" y1="22" x2="50" y2="22"/>
        <line x1="50" y1="22" x2="66" y2="36"/>
        <line x1="66" y1="36" x2="50" y2="50"/>
        <line x1="50" y1="50" x2="28" y2="50"/>
        <line x1="28" y1="50" x2="12" y2="36"/>
        <line x1="28" y1="22" x2="28" y2="50"/>
        <line x1="50" y1="22" x2="50" y2="50"/>
      </g>
      <circle cx="12" cy="36" r="2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="28" cy="22" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="50" cy="22" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="66" cy="36" r="2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="50" cy="50" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="28" cy="50" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="39" cy="36" r="2.88" fill="rgba(220,245,220,0.95)"/>
      <text x="39" y="8" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">T</text>
    </svg>
    <div class="c-label">Convertor</div>
  </div>

  <!-- GLADE APP — centre, subtle G constellation -->
  <div class="constellation" style="left:50%;top:68%;transform:translateX(-50%)" onclick="location.href='/app'">
    <svg width="70" height="60" viewBox="0 0 70 60" fill="none">
      <g class="c-lines" stroke="rgba(140,200,160,0.4)" stroke-width="0.6" opacity="0.55">
        <line x1="10" y1="45" x2="25" y2="20"/>
        <line x1="25" y1="20" x2="45" y2="15"/>
        <line x1="45" y1="15" x2="58" y2="30"/>
        <line x1="58" y1="30" x2="42" y2="35"/>
        <line x1="42" y1="35" x2="42" y2="48"/>
        <line x1="10" y1="45" x2="35" y2="50"/>
        <line x1="35" y1="50" x2="58" y2="30"/>
      </g>
      <circle cx="10" cy="45" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="25" cy="20" r="2.4" fill="rgba(200,230,200,0.85)"/>
      <circle cx="45" cy="15" r="2.64" fill="rgba(200,230,200,0.85)"/>
      <circle cx="58" cy="30" r="2.2" fill="rgba(185,220,190,0.7)"/>
      <circle cx="42" cy="35" r="1.8" fill="rgba(185,220,190,0.7)"/>
      <circle cx="42" cy="48" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <circle cx="35" cy="50" r="1.44" fill="rgba(185,220,190,0.7)"/>
      <text x="35" y="8" text-anchor="middle" font-size="9"
        fill="rgba(140,200,160,0.55)" font-family="Georgia,serif">G</text>
    </svg>
    <div class="c-label" style="font-size:9px">open glade</div>
  </div>

  <!-- Grass -->
  <svg class="grass" viewBox="0 0 1400 55" preserveAspectRatio="xMidYMax meet"
    style="position:fixed;bottom:0;left:0;width:100%;pointer-events:none;z-index:1">
    <g stroke-linecap="round" fill="none" id="grass-g"></g>
  </svg>

  <!-- Settings -->
  <div class="settings-bar">
    <a onclick="location.href='/app'">open glade</a>
    <a id="settings-btn">settings</a>
    <a onclick="location.href='/app'">history</a>
  </div>

  <script>
    const cv = document.getElementById('c');
    const c = cv.getContext('2d');
    let blobs = [];

    function rebuildBlobs() {
      blobs = Array.from({ length: 5 }, () => ({
        x: Math.random() * cv.width,
        y: Math.random() * cv.height,
        r: 200 + Math.random() * 300,
        dx: (Math.random() - 0.5) * 0.15,
        dy: (Math.random() - 0.5) * 0.15,
        hue: 128 + Math.random() * 20,
        op: 0.04 + Math.random() * 0.06,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.002 + Math.random() * 0.004,
      }));
    }

    let stars = [];
    function rebuildStars() {
      stars = Array.from({ length: 180 }, () => ({
        x: Math.random() * cv.width,
        y: Math.random() * cv.height,
        r: Math.random() * 1.2 + 0.2,
        b: Math.random() * 0.5 + 0.2,
        ph: Math.random() * Math.PI * 2,
        sp: Math.random() < 0.1 ? 0.015 + Math.random() * 0.02 : 0.003 + Math.random() * 0.006,
        sh: Math.random() < 0.1 ? 0.2 + Math.random() * 0.3 : 0.05 + Math.random() * 0.1,
      }));
    }

    const titleCv = document.getElementById('title-cv');
    let tc = null;

    function resizeTitle() {
      titleCv.style.width = '100vw';
      titleCv.style.height = '140px';
      titleCv.style.left = '0';
      titleCv.style.transform = 'translateY(-50%)';
      titleCv.width = window.innerWidth * 2;
      titleCv.height = 280;
      tc = titleCv.getContext('2d');
      tc.setTransform(2, 0, 0, 2, 0, 0);
    }

    function resize() {
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
      rebuildBlobs();
      rebuildStars();
      resizeTitle();
    }
    resize();
    window.addEventListener('resize', resize);

    function drawTitle(time) {
      if (!tc) return;
      const w = window.innerWidth;
      const cx = w / 2;
      tc.clearRect(0, 0, w, 140);
      tc.font = '600 58px Georgia, serif';
      tc.textAlign = 'center';
      tc.letterSpacing = '0.5em';

      tc.strokeStyle = \`rgba(160,200,155,\${0.38 + Math.sin(time * 0.3) * 0.05})\`;
      tc.lineWidth = 0.8;
      tc.strokeText('GLADE SYSTEMS', cx, 72);

      const scanX = ((time * 60) % (w + 200)) - 100;
      const shimmerGrad = tc.createLinearGradient(scanX - 60, 0, scanX + 60, 0);
      shimmerGrad.addColorStop(0, 'rgba(200,240,200,0)');
      shimmerGrad.addColorStop(0.4, 'rgba(200,240,200,0.06)');
      shimmerGrad.addColorStop(0.5, 'rgba(220,255,220,0.12)');
      shimmerGrad.addColorStop(0.6, 'rgba(200,240,200,0.06)');
      shimmerGrad.addColorStop(1, 'rgba(200,240,200,0)');
      tc.strokeStyle = shimmerGrad;
      tc.lineWidth = 0.8;
      tc.strokeText('GLADE SYSTEMS', cx, 72);

      tc.font = '11px Arial, sans-serif';
      tc.letterSpacing = '0.22em';
      tc.fillStyle = \`rgba(74,124,89,\${0.4 + Math.sin(time * 0.2 + 1) * 0.06})\`;
      tc.fillText('A PERSONAL OPERATING SYSTEM', cx, 100);
    }

    let t = 0;
    function draw() {
      t += 0.016;
      c.fillStyle = '#050d06';
      c.fillRect(0, 0, cv.width, cv.height);

      blobs.forEach((b) => {
        b.pulse += b.pulseSpeed;
        b.x += b.dx;
        b.y += b.dy;
        if (b.x < -b.r) b.x = cv.width + b.r;
        if (b.x > cv.width + b.r) b.x = -b.r;
        if (b.y < -b.r) b.y = cv.height + b.r;
        if (b.y > cv.height + b.r) b.y = -b.r;
        const r = b.r + Math.sin(b.pulse) * 30;
        const op = b.op + Math.sin(b.pulse) * 0.02;
        const g2 = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        g2.addColorStop(0, \`hsla(\${b.hue},50%,12%,\${op})\`);
        g2.addColorStop(0.5, \`hsla(\${b.hue + 8},40%,8%,\${op * 0.5})\`);
        g2.addColorStop(1, 'transparent');
        c.fillStyle = g2;
        c.beginPath();
        c.arc(b.x, b.y, r, 0, Math.PI * 2);
        c.fill();
      });

      // Moon
      c.globalAlpha = 0.45;
      const mg = c.createRadialGradient(cv.width-80,55,0,cv.width-80,55,60);
      mg.addColorStop(0,'rgba(190,220,180,0.7)');
      mg.addColorStop(0.4,'rgba(150,200,140,0.15)');
      mg.addColorStop(1,'transparent');
      c.fillStyle = mg; c.beginPath(); c.arc(cv.width-80,55,60,0,Math.PI*2); c.fill();
      c.globalAlpha = 0.65;
      c.fillStyle='rgba(200,225,190,0.55)'; c.beginPath(); c.arc(cv.width-80,55,18,0,Math.PI*2); c.fill();
      c.fillStyle='rgba(5,13,6,0.9)'; c.beginPath(); c.arc(cv.width-88,51,16,0,Math.PI*2); c.fill();
      c.globalAlpha = 1;

      stars.forEach(s => {
        const sh = s.b*(1-s.sh+s.sh*(0.5+0.5*Math.sin(t*s.sp*60+s.ph)));
        const spike = Math.sin(t*s.sp*60+s.ph) > 0.94;
        c.globalAlpha = sh;
        if(spike) {
          c.strokeStyle = 'rgba(200,230,195,0.3)'; c.lineWidth = 0.3;
          c.beginPath();
          c.moveTo(s.x-s.r*3,s.y); c.lineTo(s.x+s.r*3,s.y);
          c.moveTo(s.x,s.y-s.r*3); c.lineTo(s.x,s.y+s.r*3);
          c.stroke();
        }
        c.fillStyle = 'rgba(200,230,195,1)';
        c.beginPath(); c.arc(s.x,s.y,spike?s.r*1.4:s.r,0,Math.PI*2); c.fill();
      });
      c.globalAlpha = 1;

      drawTitle(t);
      requestAnimationFrame(draw);
    }
    draw();

    // Grass
    const gg = document.getElementById('grass-g');
    for(let x=0; x<1400; x+=2+Math.random()*4) {
      const h = 8+Math.random()*22;
      const bend = (Math.random()-0.5)*14;
      const thick = 0.6+Math.random()*2.4;
      const col = Math.random()>0.4?'#0a1a0d':'#081508';
      const p = document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',\`M\${x} 55 C\${x+bend*0.3} \${55-h*0.4} \${x+bend*0.7} \${55-h*0.7} \${x+bend} \${55-h}\`);
      p.setAttribute('stroke', col);
      p.setAttribute('stroke-width', String(thick));
      gg.appendChild(p);
    }

    // Constellation hover
    document.querySelectorAll('.constellation').forEach(el => {
      el.addEventListener('mouseenter', () => {
        el.querySelector('.c-lines').style.opacity = '0.9';
      });
      el.addEventListener('mouseleave', () => {
        el.querySelector('.c-lines').style.opacity = '0.55';
      });
    });
  </script>
</body>
</html>`;
}

function lighthousePage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Lighthouse — Glade Systems</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #050d06; font-family: Georgia, serif;
           display: flex; align-items: center; justify-content: center;
           height: 100vh; color: #4a7c59; flex-direction: column; gap: 12px; }
    h1 { font-size: 20px; color: #aed4b8; font-style: italic; }
    p { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; }
    a { font-size: 11px; color: #5a9e6f; text-decoration: none; 
        letter-spacing: 0.08em; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Lighthouse</h1>
  <p>threat scanning — coming soon</p>
  <a href="/">← back to glade</a>
</body>
</html>`;
}
