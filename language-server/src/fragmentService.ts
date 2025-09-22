import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { DocumentManager } from './documentManager';
import { FragmentUtils } from './fragmentUtils';
import { IFragmentStorage } from './storage';
import {
  ApplyFragmentsParams,
  ChangeVersionParams,
  DidPersistDocumentParams,
  FragmentAllRangesResult,
  FragmentApplyResult,
  FragmentChangeVersionResult,
  FragmentDocumentChange,
  FragmentGenerateMarkerResult,
  FragmentInitResult,
  FragmentIssue,
  FragmentMarkerRange,
  FragmentMarkerRangesResult,
  FragmentOperationResult,
  FragmentSaveResult,
  FragmentVersionInfo,
  GenerateMarkerParams,
  InitParams,
  FragmentRequestParams,
  SaveFragmentsParams
} from 'fragments-protocol';

interface ContentResolution {
  type: 'document' | 'file';
  content: string;
  uri?: string;
  filePath?: string;
}

export class FragmentService {
  constructor(
    private readonly documents: DocumentManager,
    private readonly storage: IFragmentStorage,
    private readonly workspaceRoot: string
  ) {}

  private readonly fileRevisions = new Map<string, number>();
  private readonly pendingPersistRevisions = new Map<string, number>();
  private readonly ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'out', 'build']);

  async applyFragments(params: ApplyFragmentsParams): Promise<FragmentApplyResult> {
    const resolution = await this.resolveContent(params);
    const data = await this.storage.load();
    const fragments = FragmentUtils.parseFragmentsWithLines(resolution.content);

    for (const fragment of fragments) {
      await this.storage.ensureFragment(fragment.id, fragment.currentContent);
    }

    let updatedContent = resolution.content;
    let appliedCount = 0;

    for (const fragment of fragments) {
      const fragmentData = await this.storage.getFragmentContent(fragment.id, data.activeVersion);
      if (fragmentData !== null && fragmentData !== fragment.currentContent) {
        updatedContent = FragmentUtils.replaceFragmentContent(updatedContent, fragment.id, fragmentData);
        appliedCount++;
      }
    }

    if (resolution.type === 'document' && resolution.uri) {
      this.documents.updateContent(resolution.uri, updatedContent);
    }

    return {
      success: true,
      newContent: updatedContent,
      appliedCount,
      hasChanges: appliedCount > 0
    };
  }

  async saveFragments(params: SaveFragmentsParams): Promise<FragmentSaveResult> {
    const resolution = await this.resolveContent(params);
    const data = await this.storage.load();
    const fragments = FragmentUtils.parseFragmentsWithLines(resolution.content);
    const nestedFragments = FragmentUtils.findNestedFragments(resolution.content);

    if (nestedFragments.length > 0) {
      const issues: FragmentIssue[] = nestedFragments.map(nested => ({
        type: 'nested-fragment',
        fragmentId: nested.fragmentId,
        parentFragmentId: nested.parentFragmentId,
        startLine: nested.startLine,
        endLine: nested.endLine,
        message: `Fragment @${nested.fragmentId} is nested inside fragment @${nested.parentFragmentId}. Nested fragments are not supported.`
      }));

      return {
        success: false,
        fragmentsSaved: 0,
        activeVersion: data.activeVersion,
        issues
      };
    }

    for (const fragment of fragments) {
      await this.storage.ensureFragment(fragment.id, fragment.currentContent);
    }

    let savedCount = 0;
    for (const fragment of fragments) {
      await this.storage.updateFragment(fragment.id, data.activeVersion, fragment.currentContent);
      savedCount++;
    }

    if (resolution.type === 'document' && resolution.uri) {
      this.documents.markSaved(resolution.uri);
    }

    return {
      success: true,
      activeVersion: data.activeVersion,
      fragmentsSaved: savedCount
    };
  }

  async changeVersion(params: ChangeVersionParams): Promise<FragmentChangeVersionResult> {
    await this.storage.switchVersion(params.version);

    const filesWithFragments = await this.discoverFragmentFiles();
    const absoluteFiles = new Set(filesWithFragments.map(file => this.ensureAbsoluteFilePath(file)));

    for (const document of this.documents.entries()) {
      const docPath = this.filePathFromUri(document.uri);
      if (!docPath || absoluteFiles.has(docPath)) {
        continue;
      }

      const fragments = FragmentUtils.parseFragmentsWithLines(document.content);
      if (fragments.length === 0) {
        continue;
      }

      absoluteFiles.add(docPath);
      filesWithFragments.push(docPath);
    }
    const seenUris = new Set<string>();
    const documentChanges: FragmentDocumentChange[] = [];

    for (const filePath of filesWithFragments) {
      const absolutePath = this.ensureAbsoluteFilePath(filePath);
      const uri = pathToFileURL(absolutePath).toString();
      seenUris.add(uri);

      const isOpen = Boolean(this.documents.get(uri));
      const result = await this.applyFragments(
        isOpen ? { textDocument: { uri } } : { filePath: absolutePath }
      );

      const revision = (this.fileRevisions.get(uri) ?? 0) + 1;
      this.fileRevisions.set(uri, revision);
      this.pendingPersistRevisions.set(uri, revision);

      documentChanges.push({
        uri,
        content: result.newContent,
        revision
      });
    }

    const removedUris: string[] = [];
    for (const [trackedUri] of this.fileRevisions) {
      if (!seenUris.has(trackedUri)) {
        removedUris.push(trackedUri);
      }
    }

    for (const uri of removedUris) {
      this.fileRevisions.delete(uri);
      this.pendingPersistRevisions.delete(uri);
    }

    return {
      success: true,
      version: params.version,
      documents: documentChanges,
      removedUris
    };
  }

  acknowledgePersist(params: DidPersistDocumentParams): FragmentOperationResult {
    const expectedRevision = this.pendingPersistRevisions.get(params.uri);

    if (expectedRevision !== undefined && expectedRevision === params.revision) {
      this.pendingPersistRevisions.delete(params.uri);
      this.fileRevisions.set(params.uri, params.revision);
      this.documents.markSavedIfPresent(params.uri);
    }

    return { success: true };
  }

  async generateMarker(params: GenerateMarkerParams): Promise<FragmentGenerateMarkerResult> {
    const markerResult = FragmentUtils.generateMarkerInsertion({
      languageId: params.languageId,
      lineContent: params.lineContent || '',
      indentation: params.indentation || ''
    });

    return {
      success: true,
      fragmentId: markerResult.fragmentId,
      markerText: markerResult.markerText,
      insertPosition: markerResult.insertPosition
    };
  }

  async getVersion(): Promise<FragmentVersionInfo> {
    const data = await this.storage.load();
    if (data) {
      return {
        activeVersion: data.activeVersion,
        availableVersions: data.availableVersions,
        initialized: true
      };
    }

    return {
      activeVersion: 'public',
      availableVersions: ['public', 'private'],
      initialized: false
    };
  }

  async getFragmentPositions(
    params: FragmentRequestParams['fragments/query/getFragmentPositions']
  ): Promise<FragmentMarkerRangesResult> {
    const document = this.documents.getRequired(params.textDocument.uri);
    const lines = document.content.split('\n');
    const lineContent = lines[params.line];

    if (!lineContent) {
      return { success: true, markerRanges: [] };
    }

    const startMatch = lineContent.match(/(.*)YOUR CODE: @([^\s]+) ====/);
    const endMatch = lineContent.includes('==== END YOUR CODE ====');

    if (startMatch) {
      const fragmentId = startMatch[2];
      const endLine = this.findMatchingEndLine(lines, params.line + 1);
      if (endLine !== -1) {
        const startLineContent = lines[params.line];
        const endLineContent = lines[endLine];
        return {
          success: true,
          markerRanges: [
            ...buildMarkerSymbolRanges(params.line, startLineContent, fragmentId, true, false),
            ...buildMarkerSymbolRanges(endLine, endLineContent, fragmentId, false, true)
          ]
        };
      }
    } else if (endMatch) {
      const { startLine, fragmentId } = this.findMatchingStartLine(lines, params.line - 1) || {};
      if (typeof startLine === 'number' && fragmentId) {
        const startLineContent = lines[startLine];
        const endLineContent = lines[params.line];
        return {
          success: true,
          markerRanges: [
            ...buildMarkerSymbolRanges(startLine, startLineContent, fragmentId, true, false),
            ...buildMarkerSymbolRanges(params.line, endLineContent, fragmentId, false, true)
          ]
        };
      }
    }

    return { success: true, markerRanges: [] };
  }

  async getAllFragmentRanges(
    params: FragmentRequestParams['fragments/query/getAllFragmentRanges']
  ): Promise<FragmentAllRangesResult> {
    const document = this.documents.getRequired(params.textDocument.uri);
    const fragments = FragmentUtils.parseFragmentsWithLines(document.content);

    return {
      success: true,
      fragments: fragments.map(fragment => ({
        id: fragment.id,
        startLine: fragment.startLine,
        endLine: fragment.endLine
      }))
    };
  }

  async init(params: InitParams): Promise<FragmentInitResult> {
    const { versions = ['public', 'private'], activeVersion = 'public' } = params;
    await this.storage.initialize(versions, activeVersion);
    return { success: true, message: 'Fragments initialized successfully' };
  }

  private ensureAbsoluteFilePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);
  }

  private filePathFromUri(uri: string): string | null {
    try {
      return this.ensureAbsoluteFilePath(fileURLToPath(uri));
    } catch {
      return null;
    }
  }

  private async discoverFragmentFiles(): Promise<string[]> {
    const results: string[] = [];
    await this.walkForFragments(this.workspaceRoot, results);
    return results;
  }

  private async walkForFragments(directory: string, results: string[]): Promise<void> {
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (this.ignoredDirectories.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await this.walkForFragments(fullPath, results);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let content: string;
      try {
        content = await fs.promises.readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      if (!content.includes('==== YOUR CODE: @')) {
        continue;
      }

      const fragments = FragmentUtils.parseFragmentsWithLines(content);
      if (fragments.length > 0) {
        results.push(fullPath);
      }
    }
  }

  private async resolveContent(params: ApplyFragmentsParams | SaveFragmentsParams): Promise<ContentResolution> {
    if (params.textDocument) {
      const document = this.documents.getRequired(params.textDocument.uri);
      return {
        type: 'document',
        content: document.content,
        uri: document.uri
      };
    }

    if (params.filePath) {
      const absolutePath = this.ensureAbsoluteFilePath(params.filePath);
      const content = await fs.promises.readFile(absolutePath, 'utf-8');
      return {
        type: 'file',
        content,
        filePath: absolutePath,
        uri: pathToFileURL(absolutePath).toString()
      };
    }

    throw new Error('Either textDocument or filePath required');
  }

  private findMatchingEndLine(lines: string[], startIndex: number): number {
    for (let i = startIndex; i < lines.length; i++) {
      if (lines[i].includes('==== END YOUR CODE ====') || lines[i].includes('==== END YOUR CODE ==== -->')) {
        return i;
      }
    }
    return -1;
  }

  private findMatchingStartLine(lines: string[], startIndex: number): { startLine: number; fragmentId: string } | null {
    for (let i = startIndex; i >= 0; i--) {
      const match = lines[i].match(/(.*)YOUR CODE: @([^\s]+) ====/);
      if (match) {
        return { startLine: i, fragmentId: match[2] };
      }
    }
    return null;
  }
}

function buildMarkerSymbolRanges(
  lineIndex: number,
  content: string,
  fragmentId: string,
  isStartMarker: boolean,
  isEndMarker: boolean
): FragmentMarkerRange[] {
  const firstNonWhitespace = Math.max(content.search(/\S|$/), 0);
  if (firstNonWhitespace >= content.length) {
    return [];
  }

  const remainder = content.slice(firstNonWhitespace);
  const startTokenMatch = remainder.match(/^[^\s=<>-]+|^<+[!\-]+|^[-#\/]+/);
  const startTokenLength = startTokenMatch ? startTokenMatch[0].length : 1;

  const ranges: FragmentMarkerRange[] = [
    {
      startLine: lineIndex,
      startCharacter: firstNonWhitespace,
      endLine: lineIndex,
      endCharacter: firstNonWhitespace + startTokenLength,
      isStartMarker,
      isEndMarker,
      fragmentId
    }
  ];

  const trimmedEnd = content.trimEnd();
  const closingTokens = ['-->', '*/'];
  for (const token of closingTokens) {
    if (trimmedEnd.endsWith(token)) {
      const tokenStart = content.lastIndexOf(token);
      if (tokenStart !== -1 && tokenStart >= firstNonWhitespace + startTokenLength) {
        ranges.push({
          startLine: lineIndex,
          startCharacter: tokenStart,
          endLine: lineIndex,
          endCharacter: tokenStart + token.length,
          isStartMarker,
          isEndMarker,
          fragmentId
        });
      }
      break;
    }
  }

  return ranges;
}
