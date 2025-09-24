const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
  target: 'node', // VS Code extensions run in Node.js
  mode: 'production',

  entry: './vscode-extension/src/extension.ts', // Entry point of the extension
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode' // The vscode-module is created on-the-fly and must be excluded
  },
  node: {
    __dirname: false // Leave __dirname behavior intact
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      'fgmpack-protocol': path.resolve(__dirname, 'protocol/dist/index.js'),
      'fragments-language-server': path.resolve(__dirname, 'language-server/dist/src/storage.js')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};

module.exports = config;