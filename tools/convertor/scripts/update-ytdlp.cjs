/** Update bundled yt-dlp binary (fixes YouTube when Google changes APIs). */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const constants = require(
  path.join(path.dirname(require.resolve('youtube-dl-exec')), 'constants.js')
);
const r = spawnSync(constants.YOUTUBE_DL_PATH, ['-U'], { stdio: 'inherit' });
process.exit(r.status === 0 ? 0 : r.status ?? 1);
