import * as vscode from 'vscode';
import { FragmentsLanguageClient } from '../client';
import { FragmentVersionInfo } from 'fragments-protocol';

export class FragmentStatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly client: FragmentsLanguageClient) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'fragments.switchVersion';
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
        this.item.tooltip = `Fragments version: ${versionData.activeVersion}. Click to switch versions.`;
      } else {
        this.item.text = `$(versions) fragments`;
        this.item.tooltip = 'Fragments not initialized. Click to initialize.';
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
