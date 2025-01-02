package org.getrafty.fragments.listeners;

import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.event.CaretEvent;
import com.intellij.openapi.editor.event.CaretListener;
import com.intellij.openapi.editor.markup.*;
import com.intellij.ui.JBColor;
import org.jetbrains.annotations.NotNull;

import java.awt.*;
import java.util.Objects;

import static org.getrafty.fragments.FragmentUtils.FRAGMENT_PATTERN;

public class FragmentCaretListener implements CaretListener {
    public static final Color REGULAR = new Color(204, 237, 255, 30);
    public static final Color DARK = new Color(80, 104, 119);

    private final Editor editor;

    private RangeHighlighter currentHighlighter;

    public FragmentCaretListener(Editor editor) {
        this.editor = editor;
    }

    @Override
    public void caretPositionChanged(@NotNull CaretEvent event) {
        var document = editor.getDocument();
        var caretOffset = Objects.requireNonNull(event.getCaret()).getOffset();
        var text = document.getText();

        // Find if the caret is inside a fragment
        var matcher = FRAGMENT_PATTERN.matcher(text);
        boolean foundFragment = false;

        while (matcher.find()) {
            int fragmentStart = matcher.start(2);
            int fragmentEnd = matcher.end(2);

            if (caretOffset >= fragmentStart && caretOffset <= fragmentEnd) {
                highlightFragment(fragmentStart, fragmentEnd);
                foundFragment = true;
                break;
            }
        }

        // Remove highlighter if no fragment is found
        if (!foundFragment) {
            clearHighlight();
        }
    }

    private void highlightFragment(int start, int end) {
        var markupModel = editor.getMarkupModel();

        // Clear any existing highlighter
        clearHighlight();

        // Add new highlighter for the fragment
        TextAttributes attributes = new TextAttributes();
        attributes.setBackgroundColor(new JBColor(REGULAR, DARK));
        attributes.setEffectType(EffectType.BOXED);

        currentHighlighter = markupModel.addRangeHighlighter(
                start, end, HighlighterLayer.GUARDED_BLOCKS, attributes, HighlighterTargetArea.EXACT_RANGE
        );
    }

    private void clearHighlight() {
        if (currentHighlighter != null) {
            editor.getMarkupModel().removeHighlighter(currentHighlighter);
            currentHighlighter = null;
        }
    }
}
