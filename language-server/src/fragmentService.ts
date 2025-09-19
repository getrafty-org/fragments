import * as fs from 'fs';
import { DocumentManager } from './documentManager';
import { FragmentUtils } from './fragmentUtils';
import { IFragmentStorage } from './storage';
import {
  ApplyFragmentsParams,
  FragmentAllRangesResult,
  FragmentApplyResult,
  FragmentGenerateMarkerResult,
  FragmentInitResult,
  FragmentIssue,
  FragmentMarkerRange,
  FragmentMarkerRangesResult,
  FragmentSaveResult,
  FragmentSwitchVersionResult,
  FragmentVersionInfo,
  GenerateMarkerParams,
  InitParams,
  FragmentRequestParams,
  SaveFragmentsParams,
  SwitchVersionParams
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
    private readonly storage: IFragmentStorage
  ) {}

  async applyFragments(params: ApplyFragmentsParams): Promise<FragmentApplyResult> {
    const resolution = this.resolveContent(params);
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
    } else if (resolution.filePath) {
      fs.writeFileSync(resolution.filePath, updatedContent, 'utf-8');
    }

    return {
      success: true,
      newContent: updatedContent,
      appliedCount,
      hasChanges: appliedCount > 0
    };
  }

  async saveFragments(params: SaveFragmentsParams): Promise<FragmentSaveResult> {
    const resolution = this.resolveContent(params);
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

  async switchVersion(params: SwitchVersionParams): Promise<FragmentSwitchVersionResult> {
    await this.storage.switchVersion(params.version);

    const results: Array<{ uri: string; result?: FragmentApplyResult; error?: string }> = [];
    for (const doc of this.documents.entries()) {
      try {
        const result = await this.applyFragments({ textDocument: { uri: doc.uri } });
        results.push({ uri: doc.uri, result });
      } catch (error) {
        results.push({
          uri: doc.uri,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      success: true,
      version: params.version,
      updatedDocuments: results
    };
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
    params: FragmentRequestParams['fragments/getFragmentPositions']
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
    params: FragmentRequestParams['fragments/getAllFragmentRanges']
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

  private resolveContent(params: ApplyFragmentsParams | SaveFragmentsParams): ContentResolution {
    if (params.textDocument) {
      const document = this.documents.getRequired(params.textDocument.uri);
      return {
        type: 'document',
        content: document.content,
        uri: document.uri
      };
    }

    if (params.filePath) {
      return {
        type: 'file',
        content: fs.readFileSync(params.filePath, 'utf-8'),
        filePath: params.filePath,
        uri: `file://${params.filePath}`
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
