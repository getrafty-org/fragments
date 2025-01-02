package org.getrafty.fragments.actions;

import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Document;
import com.intellij.testFramework.fixtures.BasePlatformTestCase;

public class InsertFragmentActionTest extends BasePlatformTestCase {

    private InsertFragmentAction action;

    @Override
    protected void setUp() throws Exception {
        super.setUp();
        action = new InsertFragmentAction();
    }

    public void testInsertFragmentAtMiddleOfLine() {
        // Arrange
        myFixture.configureByText("temp.cpp", "int x = 42;");

        // Act
        WriteCommandAction.runWriteCommandAction(getProject(), () -> {
            myFixture.getEditor().getCaretModel().moveToOffset(5);
        });

        myFixture.testAction(action);

        // Assert
        var document = myFixture.getEditor().getDocument();
        var lines = document.getText().split("\n");

        assertEquals("int x = 42;", lines[0]);
        assertTrue(lines[1].startsWith("// ==== YOUR CODE: @"));
        assertEquals("", lines[2]);
        assertEquals("// ==== END YOUR CODE ====", lines[3]);
    }

    public void testInsertFragmentAtStart() {
        // Arrange
        myFixture.configureByText("temp.cpp", "int x = 42;");

        // Act
        WriteCommandAction.runWriteCommandAction(getProject(), () -> {
            myFixture.getEditor().getCaretModel().moveToOffset(0);
        });

        myFixture.testAction(action);

        // Assert
        var document = myFixture.getEditor().getDocument();
        var lines = document.getText().split("\n");

        assertEquals("int x = 42;", lines[0]);
        assertTrue(lines[1].startsWith("// ==== YOUR CODE: @"));
        assertEquals("", lines[2]);
        assertEquals("// ==== END YOUR CODE ====", lines[3]);
    }

    public void testInsertFragmentAtEnd() {
        // Arrange
        myFixture.configureByText("temp.cpp", "int x = 42;");

        // Act
        WriteCommandAction.runWriteCommandAction(getProject(), () -> {
            int endOffset = myFixture.getEditor().getDocument().getTextLength();
            myFixture.getEditor().getCaretModel().moveToOffset(endOffset);
        });

        myFixture.testAction(action);

        // Assert
        var document = myFixture.getEditor().getDocument();
        var lines = document.getText().split("\n");

        assertEquals("int x = 42;", lines[0]);
        assertTrue(lines[1].startsWith("// ==== YOUR CODE: @"));
        assertEquals("", lines[2]);
        assertEquals("// ==== END YOUR CODE ====", lines[3]);
    }

    public void testPreventOverlappingFragment() {
        // Configure a file in the editor with an existing fragment
        myFixture.configureByText("temp.cpp", "// ==== YOUR CODE: @frag ====\nint x = 42;\n// ==== END YOUR CODE ====");

        // Set caret position inside the existing fragment
        WriteCommandAction.runWriteCommandAction(getProject(), () -> {
            myFixture.getEditor().getCaretModel().moveToOffset(20);
        });

        Document document = myFixture.getEditor().getDocument();
        String updatedText = document.getText();

        assertEquals("// ==== YOUR CODE: @frag ====\nint x = 42;\n// ==== END YOUR CODE ====", updatedText);

    }
}
