const path = require('path');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

module.exports = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel' },
    { name: '@electron-forge/maker-zip' },
    { name: '@electron-forge/maker-deb' },
    { name: '@electron-forge/maker-rpm' }
  ],
  plugins: [
    [
      '@electron-forge/plugin-webpack',
      {
        mainConfig: path.resolve(__dirname, 'webpack.main.config.js'),
        renderer: {
          config: path.resolve(__dirname, 'webpack.renderer.config.js'),
          entryPoints: [
            {
              html: path.resolve(__dirname, 'public', 'index.html'),
              js: path.resolve(__dirname, 'src', 'renderer.tsx'),
              name: 'main_window',
              preload: {
                js: path.resolve(__dirname, 'src', 'preload.ts')
              }
            }
          ]
        }
      }
    ]
  ]
};
