import { randomBytes } from 'crypto';
import { FragmentID } from 'fgmpack-protocol';

export const FRAGMENT_START_PREFIX = '==== YOUR CODE: @';
export const FRAGMENT_END_TOKEN = '==== END YOUR CODE ====';
export const FRAGMENT_START_REGEX = /(.*)YOUR CODE: @([^\s]+) ====/;

export interface MarkerInsertionRequest {
  languageId: string;
  lineContent: string;
  indentation?: string;
}

export interface MarkerInsertionWithIdRequest {
  fragmentId: FragmentID;
  languageId: string;
  lineContent: string;
  indentation?: string;
}

export interface MarkerInsertionResult {
  fragmentId: FragmentID;
  markerText: string;
  insertPosition: 'line-end' | 'new-line';
}

export class FragmentUtils {
  public static readonly FRAGMENT_PATTERN = /\/\/ ==== YOUR CODE: @(.*?) ====(.*?)\/\/ ==== END YOUR CODE ====/gs;

  private static readonly COMMENT_STYLES: Record<string, { start: string; end: string }> = {
    'javascript': { start: '//', end: '' },
    'typescript': { start: '//', end: '' },
    'python': { start: '#', end: '' },
    'java': { start: '//', end: '' },
    'cpp': { start: '//', end: '' },
    'c': { start: '//', end: '' },
    'csharp': { start: '//', end: '' },
    'go': { start: '//', end: '' },
    'rust': { start: '//', end: '' },
    'php': { start: '//', end: '' },
    'html': { start: '<!--', end: '-->' },
    'xml': { start: '<!--', end: '-->' },
    'css': { start: '/*', end: '*/' },
    'scss': { start: '//', end: '' },
    'less': { start: '//', end: '' },
    'sql': { start: '--', end: '' },
    'bash': { start: '#', end: '' },
    'shell': { start: '#', end: '' },
    'powershell': { start: '#', end: '' },
    'yaml': { start: '#', end: '' },
    'dockerfile': { start: '#', end: '' },
    'ruby': { start: '#', end: '' },
    'perl': { start: '#', end: '' },
    'lua': { start: '--', end: '' },
    'swift': { start: '//', end: '' },
    'kotlin': { start: '//', end: '' },
    'scala': { start: '//', end: '' },
    'haskell': { start: '--', end: '' },
    'r': { start: '#', end: '' },
    'matlab': { start: '%', end: '' }
  };

  public static generateFragmentId(): FragmentID {
    return randomBytes(2).toString('hex') as FragmentID; // 4 hex chars, compact 2-byte ID
  }

  public static getCommentStyle(languageId: string): { start: string; end: string } {
    return this.COMMENT_STYLES[languageId] || { start: '//', end: '' };
  }

  public static createFragmentMarker(
    fragmentId: FragmentID,
    languageId: string,
    indentation: string = ''
  ): string {
    const comment = this.getCommentStyle(languageId);
    const startLine = `${indentation}${comment.start} ${FRAGMENT_START_PREFIX}${fragmentId} ====`.trimEnd();
    const endLineBase = `${indentation}${comment.start} ${FRAGMENT_END_TOKEN}`.trimEnd();

    if (comment.end) {
      const endLine = `${endLineBase} ${comment.end}`.trimEnd();
      return `${startLine}\n${indentation}\n${endLine}`;
    }

    return `${startLine}\n${indentation}\n${endLineBase}`;
  }

  public static generateMarkerInsertion(request: MarkerInsertionRequest): MarkerInsertionResult {
    const fragmentId = this.generateFragmentId();
    const indentation = request.indentation || '';
    const markerText = this.createFragmentMarker(fragmentId, request.languageId, indentation);

    return {
      fragmentId,
      markerText,
      insertPosition: 'line-end'
    };
  }

  public static generateMarkerInsertionWithId(request: MarkerInsertionWithIdRequest): MarkerInsertionResult {
    const indentation = request.indentation || '';
    const markerText = this.createFragmentMarker(request.fragmentId, request.languageId, indentation);

    return {
      fragmentId: request.fragmentId,
      markerText,
      insertPosition: 'line-end'
    };
  }

  public static extractIndentation(lineContent: string): string {
    const match = lineContent.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  public static parseFragmentsWithLines(content: string): Array<{
    id: FragmentID;
    startLine: number;
    endLine: number;
    currentContent: string;
    indentation: string;
  }> {
    const lines = content.split('\n');
    const fragments: Array<{
      id: FragmentID;
      startLine: number;
      endLine: number;
      currentContent: string;
      indentation: string;
    }> = [];

    const fragmentStack: Array<{
      id: FragmentID;
      startLine: number;
      indentation: string;
      contentLines: string[];
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const startMatch = line.match(/(.*)YOUR CODE: @([^\s]+) ====/);
      const endMatch = line.includes('==== END YOUR CODE ====');

      if (startMatch) {
        const fragmentId = startMatch[2] as FragmentID;
        const indentation = this.extractIndentation(line);

        fragmentStack.push({
          id: fragmentId,
          startLine: i,
          indentation: indentation,
          contentLines: []
        });
      } else if (endMatch && fragmentStack.length > 0) {
        const fragment = fragmentStack.pop()!;

        // Create the fragment with all content between start and end
        const currentContent = fragment.contentLines.join('\n');

        fragments.push({
          id: fragment.id,
          startLine: fragment.startLine,
          endLine: i,
          currentContent: currentContent,
          indentation: fragment.indentation
        });
      } else if (fragmentStack.length > 0) {
        for (const openFragment of fragmentStack) {
          openFragment.contentLines.push(line);
        }
      }
    }

    return fragments.sort((a, b) => a.startLine - b.startLine);
  }

  public static findNestedFragments(content: string): Array<{
    fragmentId: FragmentID;
    parentFragmentId: FragmentID;
    startLine: number;
    endLine: number;
  }> {
    const fragments = this.parseFragmentsWithLines(content);
    const nestedFragments: Array<{
      fragmentId: FragmentID;
      parentFragmentId: FragmentID;
      startLine: number;
      endLine: number;
    }> = [];

    const stack: Array<{
      id: FragmentID;
      startLine: number;
      endLine: number;
    }> = [];

    for (const fragment of fragments) {
      while (stack.length > 0 && fragment.startLine > stack[stack.length - 1].endLine) {
        stack.pop();
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (fragment.startLine > parent.startLine && fragment.endLine < parent.endLine) {
          nestedFragments.push({
            fragmentId: fragment.id,
            parentFragmentId: parent.id,
            startLine: fragment.startLine,
            endLine: fragment.endLine
          });
        }
      }

      stack.push({ id: fragment.id, startLine: fragment.startLine, endLine: fragment.endLine });
    }

    return nestedFragments;
  }

  public static replaceFragmentContent(
    fileContent: string,
    fragmentId: FragmentID,
    newContent: string
  ): string {
    const fragments = this.parseFragmentsWithLines(fileContent);
    const fragment = fragments.find(f => f.id === fragmentId);

    if (!fragment) {
      return fileContent;
    }

    const lines = fileContent.split('\n');
    const newLines = [...lines];

    // Remove old content lines (between start+1 and end-1)
    newLines.splice(fragment.startLine + 1, fragment.endLine - fragment.startLine - 1);

    // Insert new content
    if (newContent.trim()) {
      const processedContent = newContent.replace(/\\n/g, '\n');
      const contentLines = processedContent.split('\n');
      newLines.splice(fragment.startLine + 1, 0, ...contentLines);
    } else {
      newLines.splice(fragment.startLine + 1, 0, '');
    }

    return newLines.join('\n');
  }

  public static containsFragmentMarkers(content: string): boolean {
    return content.includes(FRAGMENT_START_PREFIX);
  }
}
