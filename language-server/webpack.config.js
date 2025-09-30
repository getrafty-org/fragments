const path = require('path');

module.exports = [
  // Main language server
  {
    target: 'node',
    mode: 'production',
    entry: './src/server.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'server.js'
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        'fgmpack-protocol': path.resolve(__dirname, '../protocol/dist/index.js'),
        'fgmpack-db': path.resolve(__dirname, '../fgmpack-db/dist/index.js')
      }
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              compilerOptions: {
                skipLibCheck: true
              }
            }
          },
          exclude: /node_modules/
        }
      ]
    },
    externals: {
      // Keep Node.js built-ins as external
      fs: 'commonjs fs',
      path: 'commonjs path',
      os: 'commonjs os',
      util: 'commonjs util',
      crypto: 'commonjs crypto',
      url: 'commonjs url'
    },
    optimization: {
      minimize: false // Keep readable for debugging
    }
  }
];
