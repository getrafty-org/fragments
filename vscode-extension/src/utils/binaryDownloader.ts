import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const chmod = promisify(fs.chmod);
const access = promisify(fs.access);

const BIN_NAME_PREFIX = "fgmpack-language-server";

export class BinaryDownloader {
  private readonly localBinDir: string;

  constructor(context: vscode.ExtensionContext) {
    // On Linux/Mac: ~/.config/Code/User/globalStorage/<publisher>.<extension-name>
    // On Windows: %APPDATA%\Code\User\globalStorage\<publisher>.<extension-name>
    this.localBinDir = context.globalStorageUri.fsPath;
  }

  getLocalBinaryPath(): string {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryName = `${BIN_NAME_PREFIX}-${process.platform}-${process.arch}${ext}`;
    return path.join(this.localBinDir, binaryName);
  }

  async isBinaryInstalled(): Promise<boolean> {
    try {
      await access(this.getLocalBinaryPath(), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  async downloadBinary(): Promise<string> {
    const binaryPath = this.getLocalBinaryPath();

    await mkdir(this.localBinDir, { recursive: true });

    const downloadUrl = await this.getDownloadUrl();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading fgmpack language server',
        cancellable: false
      },
      async (progress) => {
        progress.report({ increment: 0, message: 'Starting download...' });
        await this.downloadFile(downloadUrl, binaryPath, progress);
        progress.report({ increment: 100, message: 'Download complete' });
      }
    );

    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      await chmod(binaryPath, 0o755);
    }

    return binaryPath;
  }

  private async getDownloadUrl(): Promise<string> {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const assetName = `${BIN_NAME_PREFIX}-${process.platform}-${process.arch}${ext}`;
    return `https://github.com/getrafty-org/fragments/releases/latest/download/${assetName}`;
  }

  private downloadFile(
    url: string,
    dest: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      let downloadedBytes = 0;
      let totalBytes = 0;

      const request = https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }
          file.close();
          fs.unlinkSync(dest);
          this.downloadFile(redirectUrl, dest, progress).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            progress.report({
              increment: 1,
              message: `${percent}% (${Math.round(downloadedBytes / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB)`
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    });
  }
}
