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
import org.getrafty.fragments.services.FragmentsIndex;
import org.jetbrains.annotations.NotNull;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class RemoveFragmentAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Editor editor = event.getData(com.intellij.openapi.actionSystem.CommonDataKeys.EDITOR);
        Project project = event.getProject();

        if (editor == null || project == null) {
            Messages.showErrorDialog("No active editor or project found!", "Error");
            return;
        }

        FragmentsIndex snippetIndexService = project.getService(FragmentsIndex.class);

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

            // Check if caret is within this snippet block
            if (caretOffset >= start && caretOffset <= end) {
                String hash = matcher.group(1).trim();

                WriteCommandAction.runWriteCommandAction(project, () -> {
                    document.deleteString(start, end);
                });

                snippetIndexService.forgetFragmentEntryForFile(hash, file);
                return;
            }
        }

        Messages.showErrorDialog("No snippet found at the current caret position.", "Error");
    }
}
