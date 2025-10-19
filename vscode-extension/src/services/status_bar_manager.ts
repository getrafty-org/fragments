import * as vscode from 'vscode';
import { Client } from '../client';
import { FragmentVersionInfo } from 'fgmpack-protocol';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly client: Client) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'fgmpack.switchVersion';
  }

  async initialize(): Promise<void> {
    await this.refresh();
    this.item.show();
  }

  async refresh(): Promise<void> {
    try {
      const versionData: FragmentVersionInfo = await this.client.getVersion();
      if (versionData && versionData.activeVersion) {
        this.item.text = `$(versions) ${versionData.activeVersion}`;
        this.item.tooltip = `fgmpack: ${versionData.activeVersion}. Click to switch versions.`;
      } else {
        this.item.text = `$(versions) fragments`;
        this.item.tooltip = 'Fragments not initialized.';
      }
    } catch (error) {
      this.item.text = `$(error) fragments`;
      this.item.tooltip = 'Error getting fragments version';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
