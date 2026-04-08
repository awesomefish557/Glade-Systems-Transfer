/**
 * Glade convertor — MP4 video and MP3 audio only (yt-dlp + ffmpeg for transcode/merge).
 * Progressive MP4 streams without ffmpeg; MP3 and merged MP4 require ffmpeg on PATH.
 */
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

const { join } = path;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load convertor/.env into process.env (does not override existing vars). */
function loadLocalEnv() {
  const p = join(__dirname, '.env');
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadLocalEnv();

const require = createRequire(import.meta.url);
const youtubedl = require('youtube-dl-exec');
const { YOUTUBE_DL_PATH } = require(
  path.join(path.dirname(require.resolve('youtube-dl-exec')), 'constants.js')
);

const ITAG_MERGE_MP4 = '__merge_mp4__';
const ITAG_MP3_HI = '__mp3_hi__';
const ITAG_MP3_LO = '__mp3_lo__';

const PORT = Number(process.env.PORT || 3847);
const HOST = process.env.HOST || '127.0.0.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, body) {
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

function safeFilename(name, ext) {
  const base = (name || 'download').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120);
  return `${base}.${ext}`;
}

function isYoutubeUrl(s) {
  try {
    const u = new URL(s);
    return /youtube\.com|youtu\.be/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Optional: full path to ffmpeg.exe, or a folder that contains ffmpeg.exe.
 * Example (PowerShell): $env:FFMPEG_PATH = "C:\...\bin\ffmpeg.exe"
 */
function resolvedFfmpegExe() {
  const raw = process.env.FFMPEG_PATH?.trim();
  if (!raw) return null;
  const n = raw.replace(/[/\\]+$/, '');
  const lower = n.toLowerCase();
  if (lower.endsWith('ffmpeg.exe') && existsSync(n)) return n;
  const inBin = join(n, 'ffmpeg.exe');
  if (existsSync(inBin)) return inBin;
  return null;
}

function hasFfmpeg() {
  const exe = resolvedFfmpegExe();
  if (exe) {
    const r = spawnSync(exe, ['-hide_banner', '-version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return r.status === 0;
  }
  const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0;
}

/** yt-dlp needs --ffmpeg-location pointing at the directory containing ffmpeg. */
function ffmpegLocationArgv() {
  const exe = resolvedFfmpegExe();
  if (exe) return ['--ffmpeg-location', path.dirname(exe)];
  return [];
}

/** Progressive single file; optional MP4-only. */
function progressiveVideoFormats(formats, { mp4Only = false } = {}) {
  if (!Array.isArray(formats)) return [];
  const all = formats.filter(
    (f) =>
      f.url &&
      f.vcodec &&
      f.vcodec !== 'none' &&
      f.acodec &&
      f.acodec !== 'none' &&
      !String(f.protocol || '').includes('m3u8') &&
      !String(f.protocol || '').includes('m3u8_native') &&
      (!mp4Only || String(f.ext || '').toLowerCase() === 'mp4')
  );
  const byHeight = new Map();
  for (const f of all.sort((a, b) => (b.height || 0) - (a.height || 0))) {
    const h = f.height ?? 0;
    if (!byHeight.has(h)) byHeight.set(h, f);
  }
  return [...byHeight.values()].map((f) => ({
    itag: String(f.format_id),
    label: f.format_note || f.resolution || (f.height ? `${f.height}p` : f.format_id),
    height: f.height,
    container: 'mp4',
  }));
}

const YT_EXTRACTOR_TRIES = [
  null,
  'youtube:player_client=android,web',
  'youtube:player_client=web',
  'youtube:player_client=tv_embedded',
  'youtube:player_client=ios,web',
];

async function getMetaWithExtractor(videoUrl) {
  let lastErr;
  for (const extractorArgs of YT_EXTRACTOR_TRIES) {
    try {
      const opts = {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
        noPlaylist: true,
      };
      if (extractorArgs) opts.extractorArgs = extractorArgs;
      const meta = await youtubedl(videoUrl, opts);
      return { meta, extractorArgs };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function extractorArgsToArgv(extractorArgs) {
  return extractorArgs ? ['--extractor-args', extractorArgs] : [];
}

function runYtDlpSpawn(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YOUTUBE_DL_PATH, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(-1200) || `yt-dlp exited ${code}`));
    });
  });
}

function streamYtDlp(args, res, onError) {
  const proc = spawn(YOUTUBE_DL_PATH, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(res);
  proc.stderr.on('data', () => {});
  proc.on('error', (err) => onError(err));
  proc.on('exit', (code) => {
    if (code !== 0 && !res.writableEnded) {
      onError(new Error(`yt-dlp exited with code ${code}`));
    }
  });
}

/**
 * Download with yt-dlp into temp dir, then stream one file to res.
 * @param {string[]} ytdlpMidArgs flags between output template and URL (e.g. -x --audio-format mp3)
 */
async function downloadViaTempFile(res, videoUrl, title, fileExt, contentType, extractorArgs, ytdlpMidArgs) {
  const dir = await mkdtemp(join(tmpdir(), 'glade-conv-'));
  try {
    const outTmpl = join(dir, 'out.%(ext)s');
    const args = [
      '-o',
      outTmpl,
      '--no-warnings',
      '--no-playlist',
      ...extractorArgsToArgv(extractorArgs),
      ...ffmpegLocationArgv(),
      ...ytdlpMidArgs,
      videoUrl,
    ];
    await runYtDlpSpawn(args);
    const files = await readdir(dir);
    const wanted = '.' + fileExt.toLowerCase();
    const name = files.find((f) => f.toLowerCase().endsWith(wanted));
    if (!name) {
      throw new Error(`Expected output .${fileExt}, got: ${files.join(', ') || '(empty)'}`);
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeFilename(title, fileExt)}"`,
    });
    await pipeline(createReadStream(join(dir, name)), res);
  } catch (e) {
    if (!res.headersSent) {
      json(res, 502, { error: e instanceof Error ? e.message : 'Download failed' });
    } else {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  let u;
  try {
    u = new URL(req.url || '/', `http://${HOST}`);
  } catch {
    json(res, 400, { error: 'Bad URL' });
    return;
  }

  const pathname = u.pathname;

  if (pathname === '/api/info') {
    const videoUrl = u.searchParams.get('url')?.trim();
    if (!videoUrl || !isYoutubeUrl(videoUrl)) {
      json(res, 400, { error: 'Valid YouTube URL required' });
      return;
    }
    try {
      const { meta } = await getMetaWithExtractor(videoUrl);
      const ffmpeg = hasFfmpeg();
      let video = progressiveVideoFormats(meta.formats, { mp4Only: true });
      if (!video.length && ffmpeg) {
        video = [
          {
            itag: ITAG_MERGE_MP4,
            label: 'Best MP4 (merges video+audio)',
            container: 'mp4',
          },
        ];
      }
      const audio = ffmpeg
        ? [
            { itag: ITAG_MP3_HI, label: 'Higher quality MP3', container: 'mp3' },
            { itag: ITAG_MP3_LO, label: 'Smaller MP3', container: 'mp3' },
          ]
        : [];
      const notes = [];
      if (!ffmpeg) {
        notes.push(
          'Install ffmpeg and add it to PATH for MP3 downloads and for MP4 when YouTube has no single-file MP4.'
        );
      }
      if (!video.length && !ffmpeg) {
        notes.push('This video has no single-file MP4; ffmpeg is required to build an MP4.');
      }
      json(res, 200, {
        title: meta.title || meta.fulltitle || 'download',
        videoId: meta.id,
        videoFormats: video,
        audioFormats: audio,
        ffmpeg,
        note: notes.length ? notes.join(' ') : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to read video';
      json(res, 502, { error: msg });
    }
    return;
  }

  if (pathname === '/api/download') {
    const videoUrl = u.searchParams.get('url')?.trim();
    const mode = u.searchParams.get('mode');
    const itag = u.searchParams.get('itag');
    if (!videoUrl || !isYoutubeUrl(videoUrl)) {
      json(res, 400, { error: 'Valid YouTube URL required' });
      return;
    }
    if (!itag) {
      json(res, 400, { error: 'Missing itag' });
      return;
    }

    try {
      const { meta, extractorArgs } = await getMetaWithExtractor(videoUrl);
      const title = meta.title || meta.fulltitle || 'download';

      if (mode === 'audio') {
        if (itag !== ITAG_MP3_HI && itag !== ITAG_MP3_LO) {
          json(res, 400, { error: 'Audio output is MP3 only; use the quality buttons from Look up.' });
          return;
        }
        if (!hasFfmpeg()) {
          json(res, 503, { error: 'ffmpeg is required for MP3. Install ffmpeg and ensure it is on PATH.' });
          return;
        }
        const quality = itag === ITAG_MP3_LO ? '5' : '0';
        await downloadViaTempFile(
          res,
          videoUrl,
          title,
          'mp3',
          'audio/mpeg',
          extractorArgs,
          ['-x', '--audio-format', 'mp3', '--audio-quality', quality]
        );
        return;
      }

      if (mode !== 'video') {
        json(res, 400, { error: 'Invalid mode' });
        return;
      }

      if (itag === ITAG_MERGE_MP4) {
        if (!hasFfmpeg()) {
          json(res, 503, { error: 'ffmpeg is required to merge streams into MP4.' });
          return;
        }
        await downloadViaTempFile(
          res,
          videoUrl,
          title,
          'mp4',
          'video/mp4',
          extractorArgs,
          [
            '-f',
            'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
            '--merge-output-format',
            'mp4',
          ]
        );
        return;
      }

      const pick = meta.formats.find((f) => String(f.format_id) === String(itag));
      if (!pick || !pick.url) {
        json(res, 404, { error: 'No matching format' });
        return;
      }
      if (String(pick.ext || '').toLowerCase() !== 'mp4') {
        json(res, 400, { error: 'Only MP4 video is allowed; use the merge option if no single MP4 exists.' });
        return;
      }
      if (!pick.vcodec || pick.vcodec === 'none' || !pick.acodec || pick.acodec === 'none') {
        json(res, 400, { error: 'Selected format is not a combined MP4 video+audio stream.' });
        return;
      }

      const filename = safeFilename(title, 'mp4');
      const args = [
        '-o',
        '-',
        '-f',
        String(itag),
        '--no-warnings',
        '--no-playlist',
        ...extractorArgsToArgv(extractorArgs),
        videoUrl,
      ];

      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });

      streamYtDlp(args, res, (err) => {
        if (!res.headersSent) json(res, 502, { error: err.message });
        else {
          try {
            res.destroy();
          } catch {
            /* ignore */
          }
        }
      });
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : 'Download failed' });
    }
    return;
  }

  if (pathname === '/health') {
    json(res, 200, { ok: true, ffmpeg: hasFfmpeg() });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use (another convertor is probably still running).\n` +
        `  Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F\n` +
        `  Or another port:  $env:PORT=3848; npm start  then in the browser console:\n` +
        `  localStorage.setItem('glade_convertor_port','3848')`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const local = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
  console.log(`Glade convertor listening on ${HOST}:${PORT} (${local})`);
  const ff = resolvedFfmpegExe();
  console.log(
    `ffmpeg: ${hasFfmpeg() ? 'yes' : 'no'}${ff ? ` (FFMPEG_PATH=${ff})` : hasFfmpeg() ? ' (PATH)' : ' — install ffmpeg or set FFMPEG_PATH to ffmpeg.exe'}`
  );
});
