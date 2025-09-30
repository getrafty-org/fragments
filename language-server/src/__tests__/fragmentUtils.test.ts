import { describe, test, expect } from '@jest/globals';
import { FragmentUtils, FRAGMENT_START_PREFIX, FRAGMENT_END_TOKEN } from '../fragmentUtils';
import { FragmentID } from 'fgmpack-protocol';

describe('FragmentUtils', () => {
  describe('generateFragmentId', () => {
    test('should generate 4-character hex string', () => {
      const id = FragmentUtils.generateFragmentId();
      expect(id).toMatch(/^[0-9a-f]{4}$/);
      expect(id).toHaveLength(4);
    });

    test('should generate unique IDs', () => {
      const id1 = FragmentUtils.generateFragmentId();
      const id2 = FragmentUtils.generateFragmentId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('getCommentStyle', () => {
    test('should return correct comment style for JavaScript', () => {
      const style = FragmentUtils.getCommentStyle('javascript');
      expect(style).toEqual({ start: '//', end: '' });
    });

    test('should return correct comment style for HTML', () => {
      const style = FragmentUtils.getCommentStyle('html');
      expect(style).toEqual({ start: '<!--', end: '-->' });
    });

    test('should return default comment style for unknown language', () => {
      const style = FragmentUtils.getCommentStyle('unknown');
      expect(style).toEqual({ start: '//', end: '' });
    });

    test('should return correct comment style for Python', () => {
      const style = FragmentUtils.getCommentStyle('python');
      expect(style).toEqual({ start: '#', end: '' });
    });
  });

  describe('createFragmentMarker', () => {
    test('should create marker for JavaScript without indentation', () => {
      const marker = FragmentUtils.createFragmentMarker('abcd' as FragmentID, 'javascript');
      const expected = `// ${FRAGMENT_START_PREFIX}abcd ====\n\n// ${FRAGMENT_END_TOKEN}`;
      expect(marker).toBe(expected);
    });

    test('should create marker for JavaScript with indentation', () => {
      const marker = FragmentUtils.createFragmentMarker('abcd' as FragmentID, 'javascript', '  ');
      const expected = `  // ${FRAGMENT_START_PREFIX}abcd ====\n  \n  // ${FRAGMENT_END_TOKEN}`;
      expect(marker).toBe(expected);
    });

    test('should create marker for HTML with block comments', () => {
      const marker = FragmentUtils.createFragmentMarker('abcd' as FragmentID, 'html');
      const expected = `<!-- ${FRAGMENT_START_PREFIX}abcd ====\n\n<!-- ${FRAGMENT_END_TOKEN} -->`;
      expect(marker).toBe(expected);
    });

    test('should create marker for Python with hash comments', () => {
      const marker = FragmentUtils.createFragmentMarker('1234' as FragmentID, 'python', '    ');
      const expected = `    # ${FRAGMENT_START_PREFIX}1234 ====\n    \n    # ${FRAGMENT_END_TOKEN}`;
      expect(marker).toBe(expected);
    });
  });

  describe('generateMarkerInsertion', () => {
    test('should generate complete marker insertion', () => {
      const result = FragmentUtils.generateMarkerInsertion({
        languageId: 'javascript',
        lineContent: 'console.log("test");',
        indentation: '  '
      });

      expect(result.fragmentId).toMatch(/^[0-9a-f]{4}$/);
      expect(result.markerText).toContain(FRAGMENT_START_PREFIX);
      expect(result.markerText).toContain(FRAGMENT_END_TOKEN);
      expect(result.insertPosition).toBe('line-end');
    });
  });

  describe('generateMarkerInsertionWithId', () => {
    test('should generate marker insertion with specific ID', () => {
      const result = FragmentUtils.generateMarkerInsertionWithId({
        fragmentId: 'test' as FragmentID,
        languageId: 'javascript',
        lineContent: 'console.log("test");',
        indentation: '  '
      });

      expect(result.fragmentId).toBe('test');
      expect(result.markerText).toContain(`${FRAGMENT_START_PREFIX}test ====`);
      expect(result.markerText).toContain(FRAGMENT_END_TOKEN);
      expect(result.insertPosition).toBe('line-end');
    });
  });

  describe('extractIndentation', () => {
    test('should extract spaces indentation', () => {
      const indentation = FragmentUtils.extractIndentation('    const x = 1;');
      expect(indentation).toBe('    ');
    });

    test('should extract tabs indentation', () => {
      const indentation = FragmentUtils.extractIndentation('\t\tconst x = 1;');
      expect(indentation).toBe('\t\t');
    });

    test('should return empty string for no indentation', () => {
      const indentation = FragmentUtils.extractIndentation('const x = 1;');
      expect(indentation).toBe('');
    });

    test('should extract mixed indentation', () => {
      const indentation = FragmentUtils.extractIndentation('  \t  const x = 1;');
      expect(indentation).toBe('  \t  ');
    });
  });

  describe('parseFragmentsWithLines', () => {
    test('should parse single fragment', () => {
      const content = `line 0
// ==== YOUR CODE: @frag1 ====
fragment content
more content
// ==== END YOUR CODE ====
line 5`;

      const fragments = FragmentUtils.parseFragmentsWithLines(content);
      expect(fragments).toHaveLength(1);
      expect(fragments[0].id).toBe('frag1');
      expect(fragments[0].startLine).toBe(1);
      expect(fragments[0].endLine).toBe(4);
      expect(fragments[0].currentContent).toBe('fragment content\nmore content');
    });

    test('should parse multiple fragments', () => {
      const content = `line 0
// ==== YOUR CODE: @frag1 ====
content 1
// ==== END YOUR CODE ====
line 4
// ==== YOUR CODE: @frag2 ====
content 2
// ==== END YOUR CODE ====
line 8`;

      const fragments = FragmentUtils.parseFragmentsWithLines(content);
      expect(fragments).toHaveLength(2);
      expect(fragments[0].id).toBe('frag1');
      expect(fragments[1].id).toBe('frag2');
    });

    test('should handle empty fragment content', () => {
      const content = `// ==== YOUR CODE: @empty ====
// ==== END YOUR CODE ====`;

      const fragments = FragmentUtils.parseFragmentsWithLines(content);
      expect(fragments).toHaveLength(1);
      expect(fragments[0].currentContent).toBe('');
    });

    test('should extract correct indentation', () => {
      const content = `  // ==== YOUR CODE: @indented ====
  fragment content
  // ==== END YOUR CODE ====`;

      const fragments = FragmentUtils.parseFragmentsWithLines(content);
      expect(fragments[0].indentation).toBe('  ');
    });
  });

  describe('findNestedFragments', () => {
    test('should detect nested fragments', () => {
      const content = `// ==== YOUR CODE: @outer ====
outer content
// ==== YOUR CODE: @inner ====
inner content
// ==== END YOUR CODE ====
more outer content
// ==== END YOUR CODE ====`;

      const nested = FragmentUtils.findNestedFragments(content);
      expect(nested).toHaveLength(1);
      expect(nested[0].fragmentId).toBe('inner');
      expect(nested[0].parentFragmentId).toBe('outer');
    });

    test('should return empty array for non-nested fragments', () => {
      const content = `// ==== YOUR CODE: @frag1 ====
content 1
// ==== END YOUR CODE ====
// ==== YOUR CODE: @frag2 ====
content 2
// ==== END YOUR CODE ====`;

      const nested = FragmentUtils.findNestedFragments(content);
      expect(nested).toHaveLength(0);
    });
  });

  describe('replaceFragmentContent', () => {
    test('should replace fragment content', () => {
      const content = `line 0
// ==== YOUR CODE: @test ====
old content
// ==== END YOUR CODE ====
line 4`;

      const result = FragmentUtils.replaceFragmentContent(content, 'test' as FragmentID, 'new content');
      expect(result).toContain('new content');
      expect(result).not.toContain('old content');
    });

    test('should handle multiline replacement', () => {
      const content = `// ==== YOUR CODE: @test ====
old line 1
old line 2
// ==== END YOUR CODE ====`;

      const result = FragmentUtils.replaceFragmentContent(content, 'test' as FragmentID, 'new line 1\nnew line 2');
      expect(result).toContain('new line 1');
      expect(result).toContain('new line 2');
      expect(result).not.toContain('old line 1');
    });

    test('should return original content for non-existent fragment', () => {
      const content = `// ==== YOUR CODE: @test ====
content
// ==== END YOUR CODE ====`;

      const result = FragmentUtils.replaceFragmentContent(content, 'nonexistent' as FragmentID, 'new content');
      expect(result).toBe(content);
    });

    test('should handle empty replacement content', () => {
      const content = `// ==== YOUR CODE: @test ====
old content
// ==== END YOUR CODE ====`;

      const result = FragmentUtils.replaceFragmentContent(content, 'test' as FragmentID, '');
      expect(result).toContain('// ==== YOUR CODE: @test ====');
      expect(result).toContain('// ==== END YOUR CODE ====');
      expect(result).not.toContain('old content');
    });
  });

  describe('containsFragmentMarkers', () => {
    test('should return true for content with fragment markers', () => {
      const content = `// ${FRAGMENT_START_PREFIX}test ====`;
      expect(FragmentUtils.containsFragmentMarkers(content)).toBe(true);
    });

    test('should return false for content without fragment markers', () => {
      const content = 'regular code content';
      expect(FragmentUtils.containsFragmentMarkers(content)).toBe(false);
    });

    test('should return true for content with multiple markers', () => {
      const content = `// ${FRAGMENT_START_PREFIX}test1 ====\n// ${FRAGMENT_START_PREFIX}test2 ====`;
      expect(FragmentUtils.containsFragmentMarkers(content)).toBe(true);
    });
  });
});
