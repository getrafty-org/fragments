package org.getrafty.fragments.listeners;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.event.EditorFactoryEvent;
import com.intellij.openapi.editor.event.EditorFactoryListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileDocumentManagerListener;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.FileEditorManagerListener;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.ProjectActivity;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.VirtualFile;
import kotlin.Unit;
import kotlin.coroutines.Continuation;
import org.getrafty.fragments.services.FragmentsDataService;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import static org.getrafty.fragments.FragmentUtils.FRAGMENT_PATTERN;
import static org.getrafty.fragments.FragmentUtils.loadFragmentsIntoCurrentEditor;

public class OnProjectOpened implements ProjectActivity {

    @Override
    public @Nullable Object execute(@NotNull Project project, @NotNull Continuation<? super Unit> continuation) {
        final var editorFactory = EditorFactory.getInstance();
        editorFactory.addEditorFactoryListener(onFragmentHoverAction(project), project);

        var connection = ApplicationManager.getApplication().getMessageBus().connect();

        connection.subscribe(FileDocumentManagerListener.TOPIC, new FileDocumentManagerListener() {
            @Override
            public void beforeDocumentSaving(@NotNull Document document) {
                final var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
                if (editor != null && editor.getDocument() == document) {
                    final var file = FileDocumentManager.getInstance().getFile(document);
                    if (file == null) {
                        return;
                    }

                    final var text = document.getText();
                    final var matcher = FRAGMENT_PATTERN.matcher(text); // TODO: Extract to fragment parser

                    final var fragmentsManager = project.getService(FragmentsDataService.class);
                    while (matcher.find()) {
                        var fragmentId = matcher.group(1).trim();
                        var fragmentCode = matcher.group(2);
                        fragmentsManager.saveFragment(fragmentId, fragmentCode);
                    }
                }
                FileDocumentManagerListener.super.beforeDocumentSaving(document);
            }
        });


        // Subscribe to file editor open events
        connection.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, onFileOpenedAction(project));

        return Unit.INSTANCE;
    }

    private static @NotNull FileEditorManagerListener onFileOpenedAction(@NotNull Project project) {
        return new FileEditorManagerListener() {
            @Override
            public void fileOpened(@NotNull FileEditorManager source, @NotNull VirtualFile file) {
                var editor = source.getSelectedTextEditor();

                if (editor != null) {

                    loadFragmentsIntoCurrentEditor(project, editor.getDocument());
                }
            }
        };
    }


    private static @NotNull EditorFactoryListener onFragmentHoverAction(@NotNull Project project) {
        return new EditorFactoryListener() {
            @Override
            public void editorCreated(@NotNull EditorFactoryEvent event) {
                final var editor = event.getEditor();
                if (editor.getProject() != project) {
                    return;
                }

                var caretListener = new FragmentHighlighter(editor);
                editor.getCaretModel().addCaretListener(new FragmentHighlighter(editor));
                Disposer.register(project, () -> editor.getCaretModel().removeCaretListener(caretListener));
            }
        };
    }
}
