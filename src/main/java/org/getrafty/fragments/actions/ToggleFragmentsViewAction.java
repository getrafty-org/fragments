package org.getrafty.fragments.actions;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.WindowManager;
import org.getrafty.fragments.services.FragmentsManager;
import org.getrafty.fragments.status.FragmentViewWidget;

import static org.getrafty.fragments.FragmentUtils.FRAGMENT_PATTERN;

@Service(Service.Level.PROJECT)
public final class ToggleFragmentsViewAction extends AnAction {

    @Override
    public void actionPerformed(AnActionEvent e) {
        var project = e.getProject();
        if (project == null) {
            return;
        }

        var fragmentsManager = project.getService(FragmentsManager.class);
        fragmentsManager.toggleFragmentVersion();

        var fileEditorManager = FileEditorManager.getInstance(project);
        for (FileEditor fileEditor : fileEditorManager.getAllEditors()) {
            if (fileEditor instanceof TextEditor) {
                var editor = ((TextEditor) fileEditor).getEditor();
                loadFragmentsIntoCurrentEditor(project, editor.getDocument());
            }
        }

        var statusBar = WindowManager.getInstance().getStatusBar(project);
        if (statusBar != null) {
            var widget = (FragmentViewWidget) statusBar.getWidget(FragmentViewWidget.FRAGMENT_VIEW_WIDGET);
            if (widget != null) {
                statusBar.updateWidget(widget.ID());
            }
        }
    }

    private void loadFragmentsIntoCurrentEditor(Project project, Document document) {
        var fragmentsManager = project.getService(FragmentsManager.class);


        String text = document.getText();

        var updatedText = new StringBuilder();
        int lastMatchEnd = 0;



        var matcher = FRAGMENT_PATTERN.matcher(text);

        while (matcher.find()) {
            String snippetId = matcher.group(1);
            String currentContent = matcher.group(2);
            var newContent = fragmentsManager.findFragment(snippetId);

            updatedText.append(text, lastMatchEnd, matcher.start());
            updatedText.append("// ==== YOUR CODE: @").append(snippetId).append(" ====");
            updatedText.append(newContent != null ? newContent : currentContent);
            updatedText.append("// ==== END YOUR CODE ====");
            lastMatchEnd = matcher.end();
        }

        updatedText.append(text.substring(lastMatchEnd));

        WriteCommandAction.runWriteCommandAction(null, () -> {
            document.setText(updatedText.toString());
        });
    }
}
