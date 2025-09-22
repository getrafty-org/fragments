import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DocumentManager } from './documentManager';
import { FragmentFileLocator } from './fragmentFileLocator';
import { FragmentUtils, FRAGMENT_END_TOKEN, FRAGMENT_START_REGEX } from './fragmentUtils';
import { RevisionState } from './revisionState';
import { IFragmentStorage } from './storage';
import {
  AllRangesParams,
  ChangeVersionParams,
  DidPersistDocumentParams,
  FragmentAllRangesResult,
  FragmentChangeVersionResult,
  FragmentDocumentChange,
  FragmentIssue,
  FragmentMarkerRange,
  FragmentMarkerRangesResult,
  FragmentOperationResult,
  FragmentVersionInfo,
  InsertMarkerParams,
  InsertMarkerResult,
  MarkerPositionsParams,
  PullFragmentsParams,
  PullFragmentsResult,
  PushFragmentsParams,
  PushFragmentsResult
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
    private readonly fileLocator: FragmentFileLocator,
    private readonly revisionState: RevisionState
  ) {}

  async pullFragments(params: PullFragmentsParams): Promise<PullFragmentsResult> {
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

  async pushFragments(params: PushFragmentsParams): Promise<PushFragmentsResult> {
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

    const processedUris = new Set<string>();
    const documentChanges: FragmentDocumentChange[] = [];

    const openDocuments = this.documents
      .entries()
      .filter(document => FragmentUtils.containsFragmentMarkers(document.content));

    for (const document of openDocuments) {
      const result = await this.pullFragments({ textDocument: { uri: document.uri } });
      const revision = this.revisionState.next(document.uri);

      documentChanges.push({
        uri: document.uri,
        content: result.newContent,
        revision
      });
      processedUris.add(document.uri);
    }

    const discoveredFiles = await this.fileLocator.listFragmentFiles();
    for (const file of discoveredFiles) {
      if (processedUris.has(file.uri)) {
        continue;
      }

      const result = await this.pullFragments({ filePath: file.path });
      const revision = this.revisionState.next(file.uri);

      documentChanges.push({
        uri: file.uri,
        content: result.newContent,
        revision
      });
      processedUris.add(file.uri);
    }

    const removedUris = this.revisionState.prune(processedUris);

    return {
      success: true,
      version: params.version,
      documents: documentChanges,
      removedUris
    };
  }

  acknowledgePersist(params: DidPersistDocumentParams): FragmentOperationResult {
    const acknowledged = this.revisionState.acknowledge(params.uri, params.revision);
    if (acknowledged) {
      this.documents.markSavedIfPresent(params.uri);
    }

    return { success: true };
  }

  async insertMarker(params: InsertMarkerParams): Promise<InsertMarkerResult> {
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

  async getFragmentPositions(params: MarkerPositionsParams): Promise<FragmentMarkerRangesResult> {
    const document = this.documents.getRequired(params.textDocument.uri);
    const lines = document.content.split('\n');
    const lineContent = lines[params.line];

    if (!lineContent) {
      return { success: true, markerRanges: [] };
    }

    const startMatch = lineContent.match(FRAGMENT_START_REGEX);
    const endMatch = lineContent.includes(FRAGMENT_END_TOKEN);

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

  async getAllFragmentRanges(params: AllRangesParams): Promise<FragmentAllRangesResult> {
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

  private async resolveContent(params: PullFragmentsParams | PushFragmentsParams): Promise<ContentResolution> {
    if (params.textDocument) {
      const document = this.documents.getRequired(params.textDocument.uri);
      return {
        type: 'document',
        content: document.content,
        uri: document.uri
      };
    }

    if (params.filePath) {
      const absolutePath = path.isAbsolute(params.filePath)
        ? params.filePath
        : path.resolve(params.filePath);
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
      const line = lines[i];
      if (line.includes(FRAGMENT_END_TOKEN) || line.includes(`${FRAGMENT_END_TOKEN} -->`)) {
        return i;
      }
    }
    return -1;
  }

  private findMatchingStartLine(lines: string[], startIndex: number): { startLine: number; fragmentId: string } | null {
    for (let i = startIndex; i >= 0; i--) {
      const match = lines[i].match(FRAGMENT_START_REGEX);
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
