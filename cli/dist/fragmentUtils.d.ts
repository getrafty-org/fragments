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
export declare class FragmentUtils {
    static readonly FRAGMENT_PATTERN: RegExp;
    private static readonly COMMENT_STYLES;
    /**
     * Generate a unique fragment ID
     */
    static generateFragmentId(): string;
    /**
     * Get comment style for given language
     */
    static getCommentStyle(languageId: string): {
        start: string;
        end: string;
    };
    /**
     * Create fragment marker text for given language and indentation
     */
    static createFragmentMarker(fragmentId: string, languageId: string, indentation?: string): string;
    /**
     * Generate a complete marker insertion response
     */
    static generateMarkerInsertion(request: MarkerInsertionRequest): MarkerInsertionResult;
    /**
     * Check if content contains overlapping fragments
     */
    static hasOverlappingFragments(content: string, insertPosition: number): boolean;
    /**
     * Find all fragment markers in content
     */
    static findFragmentMarkers(content: string): FragmentMarker[];
    /**
     * Extract indentation from a line of text
     */
    static extractIndentation(lineContent: string): string;
    /**
     * Parse fragment from content with line numbers using stack-based approach for proper nesting
     */
    static parseFragmentsWithLines(content: string): Array<{
        id: string;
        startLine: number;
        endLine: number;
        currentContent: string;
        indentation: string;
    }>;
    /**
     * Detect fragments that are nested inside other fragments
     */
    static findNestedFragments(content: string): Array<{
        fragmentId: string;
        parentFragmentId: string;
        startLine: number;
        endLine: number;
    }>;
    /**
     * Replace fragment content in file content
     */
    static replaceFragmentContent(fileContent: string, fragmentId: string, newContent: string): string;
}
//# sourceMappingURL=fragmentUtils.d.ts.map