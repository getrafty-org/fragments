package org.getrafty.fragments.actions;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import org.jetbrains.annotations.NotNull;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.intellij.openapi.actionSystem.CommonDataKeys.*;

public class RemoveFragmentAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Editor editor = event.getData(EDITOR);
        Project project = event.getProject();

        if (editor == null || project == null) {
            Messages.showErrorDialog("No active editor or project found!", "Error");
            return;
        }

        Document document = editor.getDocument();
        VirtualFile file = FileDocumentManager.getInstance().getFile(document);
        if (file == null) {
            Messages.showErrorDialog("Unable to determine the file for the editor.", "Error");
            return;
        }

        int caretOffset = editor.getCaretModel().getOffset();
        String text = document.getText();

        // TODO: Extract to fragment parser
        Pattern pattern = Pattern.compile("// ==== YOUR CODE: @(.*?) ====(.*?)// ==== END YOUR CODE ====", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(text);

        while (matcher.find()) {
            int start = matcher.start();
            int end = matcher.end();
            if (caretOffset >= start && caretOffset <= end) {
                WriteCommandAction.runWriteCommandAction(project, () -> {
                    document.deleteString(start, end);
                });

                return;
            }
        }

        Messages.showErrorDialog("No snippet found at the current caret position.", "Error");
    }
}
