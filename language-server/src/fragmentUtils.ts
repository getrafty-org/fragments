export const FRAGMENT_START_PREFIX = '==== YOUR CODE: @';
export const FRAGMENT_END_TOKEN = '==== END YOUR CODE ====';
export const FRAGMENT_START_REGEX = /(.*)YOUR CODE: @([^\s]+) ====/;

export interface MarkerInsertionRequest {
  languageId: string;
  lineContent: string;
  indentation?: string;
}

export interface MarkerInsertionResult {
  fragmentId: string;
  markerText: string;
  insertPosition: 'line-end' | 'new-line';
}

export class FragmentUtils {
  // Pattern to match fragment markers
  public static readonly FRAGMENT_PATTERN = /\/\/ ==== YOUR CODE: @(.*?) ====(.*?)\/\/ ==== END YOUR CODE ====/gs;

  // Comment styles for different languages
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

  /**
   * Generate a unique fragment ID
   */
  public static generateFragmentId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * Get comment style for given language
   */
  public static getCommentStyle(languageId: string): { start: string; end: string } {
    return this.COMMENT_STYLES[languageId] || { start: '//', end: '' };
  }

  /**
   * Create fragment marker text for given language and indentation
   */
  public static createFragmentMarker(
    fragmentId: string,
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

  /**
   * Generate a complete marker insertion response
   */
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

  /**
   * Extract indentation from a line of text
   */
  public static extractIndentation(lineContent: string): string {
    const match = lineContent.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  /**
   * Parse fragment from content with line numbers using stack-based approach for proper nesting
   */
  public static parseFragmentsWithLines(content: string): Array<{
    id: string;
    startLine: number;
    endLine: number;
    currentContent: string;
    indentation: string;
  }> {
    const lines = content.split('\n');
    const fragments: Array<{
      id: string;
      startLine: number;
      endLine: number;
      currentContent: string;
      indentation: string;
    }> = [];

    // Stack to track nested fragments
    const fragmentStack: Array<{
      id: string;
      startLine: number;
      indentation: string;
      contentLines: string[];
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const startMatch = line.match(/(.*)YOUR CODE: @([^\s]+) ====/);
      const endMatch = line.includes('==== END YOUR CODE ====');

      if (startMatch) {
        // Found a start marker - push to stack
        const fragmentId = startMatch[2];
        const indentation = this.extractIndentation(line);

        fragmentStack.push({
          id: fragmentId,
          startLine: i,
          indentation: indentation,
          contentLines: []
        });
      } else if (endMatch && fragmentStack.length > 0) {
        // Found an end marker - pop from stack
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
        // We're inside fragment(s) - add this line to all open fragments
        for (const openFragment of fragmentStack) {
          openFragment.contentLines.push(line);
        }
      }
    }

    // Sort fragments by start line for consistent ordering
    return fragments.sort((a, b) => a.startLine - b.startLine);
  }

  /**
   * Detect fragments that are nested inside other fragments
   */
  public static findNestedFragments(content: string): Array<{
    fragmentId: string;
    parentFragmentId: string;
    startLine: number;
    endLine: number;
  }> {
    const fragments = this.parseFragmentsWithLines(content);
    const nestedFragments: Array<{
      fragmentId: string;
      parentFragmentId: string;
      startLine: number;
      endLine: number;
    }> = [];

    const stack: Array<{
      id: string;
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

  /**
   * Replace fragment content in file content
   */
  public static replaceFragmentContent(
    fileContent: string,
    fragmentId: string,
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
      // Handle escaped newlines from JSON
      const processedContent = newContent.replace(/\\n/g, '\n');
      const contentLines = processedContent.split('\n');
      // Preserve exact indentation as stored - don't modify it
      newLines.splice(fragment.startLine + 1, 0, ...contentLines);
    } else {
      // Just add empty line
      newLines.splice(fragment.startLine + 1, 0, '');
    }

    return newLines.join('\n');
  }

  public static containsFragmentMarkers(content: string): boolean {
    return content.includes(FRAGMENT_START_PREFIX);
  }
}
