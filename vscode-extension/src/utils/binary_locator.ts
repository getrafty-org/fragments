import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const chmod = promisify(fs.chmod);
const access = promisify(fs.access);
const execFileAsync = promisify(execFile);

const BIN_NAME_PREFIX = "fgmpackd";
const BASE_URL = "https://github.com/getrafty-org/fragments/releases/latest/download/"

export class BinaryLocator {
  private readonly localBinDir: string;

  constructor(context: vscode.ExtensionContext) {
    // On Linux/Mac: ~/.config/Code/User/globalStorage/<publisher>.<extension-name>
    // On Windows: %APPDATA%\Code\User\globalStorage\<publisher>.<extension-name>
    this.localBinDir = context.globalStorageUri.fsPath;
  }

  async locate(): Promise<string> {
    const systemBinary = await this.findBinary();
    if (systemBinary) {
      return systemBinary;
    }
    return this.downloadBinary();
  }

  private async findBinary(): Promise<string | null> {
    const binaryName = this.getBinaryName();

    if (process.env.HOME) {
      const localBinPath = path.join(process.env.HOME, '.local', 'bin', binaryName);
      try {
        await access(localBinPath, fs.constants.X_OK);
        return localBinPath;
      } catch {
      }
    }

    // Check system PATH
    try {
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [binaryName]);
      const candidates = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const candidate of candidates) {
        try {
          await access(
            candidate,
            process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
          );
          return candidate;
        } catch {
          continue;
        }
      }
    } catch {
    }

    // Check extension's global storage
    try {
      await access(path.join(this.localBinDir, binaryName), fs.constants.X_OK)
      return path.join(this.localBinDir, binaryName);
    } catch {
    }

    return null;
  }

  private getBinaryName(): string {
    const platform = process.platform;
    const arch = process.arch;

    let platformSuffix: string;
    if (platform === 'win32') {
      platformSuffix = arch === 'x64' ? '-windows-x86-64.exe' : `-windows-${arch}.exe`;
    } else if (platform === 'darwin') {
      platformSuffix = arch === 'x64' ? '-macos-x86-64' : `-macos-${arch}`;
    } else if (platform === 'linux') {
      if (arch === 'x64') {
        platformSuffix = '-linux-x86-64';
      } else if (arch === 'arm64') {
        platformSuffix = '-linux-arm64';
      } else {
        platformSuffix = `-linux-${arch}`;
      }
    } else {
      // Fallback for unknown platforms
      platformSuffix = `-${platform}-${arch}`;
    }

    return `${BIN_NAME_PREFIX}${platformSuffix}`;
  }

  async downloadBinary(): Promise<string> {
    const binaryPath = path.join(this.localBinDir, this.getBinaryName());

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

    if (process.platform !== 'win32') {
      await chmod(binaryPath, 0o755);
    }

    return binaryPath;
  }

  private async getDownloadUrl(): Promise<string> {
    return `${BASE_URL}${this.getBinaryName()}`;
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
