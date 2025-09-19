export interface FragmentMarker {
  start: string;
  end: string;
  id: string;
}

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

    if (comment.end) {
      // Multi-line comment style (HTML, CSS)
      return `${indentation}${comment.start} ==== YOUR CODE: @${fragmentId} ====\n${indentation}\n${indentation}${comment.start} ==== END YOUR CODE ==== ${comment.end}`;
    } else {
      // Single-line comment style
      return `${indentation}${comment.start} ==== YOUR CODE: @${fragmentId} ====\n${indentation}\n${indentation}${comment.start} ==== END YOUR CODE ====`;
    }
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
   * Check if content contains overlapping fragments
   */
  public static hasOverlappingFragments(content: string, insertPosition: number): boolean {
    let match;
    const regex = new RegExp(this.FRAGMENT_PATTERN);

    while ((match = regex.exec(content)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;

      if (insertPosition >= matchStart && insertPosition <= matchEnd) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find all fragment markers in content
   */
  public static findFragmentMarkers(content: string): FragmentMarker[] {
    const markers: FragmentMarker[] = [];
    let match;

    const regex = new RegExp(this.FRAGMENT_PATTERN);

    while ((match = regex.exec(content)) !== null) {
      const fragmentId = match[1];

      markers.push({
        id: fragmentId,
        start: match[0].substring(0, match[0].indexOf('====', 4) + 4),
        end: match[0].substring(match[0].lastIndexOf('====')),
      });
    }

    return markers;
  }

  /**
   * Extract indentation from a line of text
   */
  public static extractIndentation(lineContent: string): string {
    const match = lineContent.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  /**
   * Parse fragment from content with line numbers
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const startMatch = line.match(/(.*)YOUR CODE: @([^\s]+) ====/);

      if (startMatch) {
        const fragmentId = startMatch[2];
        const indentation = this.extractIndentation(line);

        // Find the end marker
        let endLine = -1;
        let currentContent = '';

        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].includes('==== END YOUR CODE ====')) {
            endLine = j;
            break;
          }
          // Include all lines between markers (don't skip any)
          currentContent += lines[j] + '\n';
        }

        if (endLine !== -1) {
          fragments.push({
            id: fragmentId,
            startLine: i,
            endLine: endLine,
            currentContent: currentContent.replace(/\n$/, ''), // Remove trailing newline
            indentation
          });
        }
      }
    }

    return fragments;
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
}