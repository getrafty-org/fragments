package org.getrafty.fragments.listeners;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.event.BulkAwareDocumentListener;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.EditorFactoryEvent;
import com.intellij.openapi.editor.event.EditorFactoryListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileDocumentManagerListener;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.FileEditorManagerListener;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.ProjectActivity;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileManager;
import com.intellij.openapi.vfs.VirtualFileManagerListener;
import com.intellij.openapi.vfs.newvfs.BulkFileListener;
import com.intellij.openapi.vfs.newvfs.events.VFileEvent;
import com.intellij.util.messages.MessageBusConnection;
import kotlin.Unit;
import kotlin.coroutines.Continuation;
import org.getrafty.fragments.FragmentUtils;
import org.getrafty.fragments.inspection.FragmentCollisionHighlighter;
import org.getrafty.fragments.services.FragmentsIndex;
import org.getrafty.fragments.services.FragmentsManager;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.getrafty.fragments.FragmentUtils.FRAGMENT_PATTERN;

public class OnProjectOpened implements ProjectActivity {

    @Override
    public @Nullable Object execute(@NotNull Project project, @NotNull Continuation<? super Unit> continuation) {
//        final var editorFactory = EditorFactory.getInstance();
//        editorFactory.addEditorFactoryListener(onFragmentHoverAction(project), project);

        var connection = ApplicationManager.getApplication().getMessageBus().connect();

        connection.subscribe(FileDocumentManagerListener.TOPIC, new FileDocumentManagerListener() {
            @Override
            public void beforeDocumentSaving(@NotNull Document document) {
                var index = project.getService(FragmentsIndex.class);
                final var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
                if (editor != null && editor.getDocument() == document) {
                    final var file = FileDocumentManager.getInstance().getFile(document);
                    if (file == null) {
                        return;
                    }
                    FragmentUtils.reindexFile(file, index);



                    final var text = document.getText();
                    final var matcher = FRAGMENT_PATTERN.matcher(text); // TODO: Extract to fragment parser

                    final var fragmentsManager = project.getService(FragmentsManager.class);
                    while (matcher.find()) {
                        var fragmentId = matcher.group(1).trim();
                        var fragmentCode = matcher.group(2);
                        fragmentsManager.saveFragment(fragmentId, fragmentCode);
                    }

                    // misc.:
                    final var highlighter = project.getService(FragmentCollisionHighlighter.class);
                    highlighter.highlightDuplicates(editor);
                }
                FileDocumentManagerListener.super.beforeDocumentSaving(document);
            }
        });

        // Subscribe to document save events
//        connection.subscribe(FileDocumentManagerListener.TOPIC, onFileSaveAction(project));

//        // Subscribe to file editor open events
//        connection.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, onFileOpenedAction(project));

        // Subscribe to virtual file changes
//        connection.subscribe(VirtualFileManager.VFS_CHANGES, onFileChangedAction(project));

        return Unit.INSTANCE;
    }

    private static @NotNull BulkFileListener onFileChangedAction(@NotNull Project project) {
        return new BulkFileListener() {
            @Override
            public void after(@NotNull List<? extends VFileEvent> events) {
                var index = project.getService(FragmentsIndex.class);
                for (VFileEvent event : events) {
                    System.out.println("@DBG: BulkFileListener: File save event: " + event.getPath());
//                    var file = event.getFile();
//                    if (file != null && !file.isDirectory() && file.isValid()) {
//                        var document = FileDocumentManager.getInstance().getDocument(file);
//                        if (document != null) {
//                            index.forgetFragmentEntriesForFile(file); // Clear the old index for the file
//                            FragmentUtils.reindexFile(file, index); // Reindex the file
//
//                            // Clear old highlights and apply updated ones
//                            var editorManager = FileEditorManager.getInstance(project);
//                            var editor = editorManager.getSelectedTextEditor();
//
//                            if (editor != null && editor.getDocument() == FileDocumentManager.getInstance().getDocument(file)) {
//                                var highlighter = project.getService(FragmentCollisionHighlighter.class);
//                                highlighter.highlightDuplicates(editor);
//                            }
//                        }
//                    }
                }
            }
        };
    }

    private static @NotNull FileEditorManagerListener onFileOpenedAction(@NotNull Project project) {
        return new FileEditorManagerListener() {
            @Override
            public void fileOpened(@NotNull FileEditorManager source, @NotNull VirtualFile file) {
                System.out.println("@DBG: FileEditorManagerListener: File save event: " + file.getPath());

                var editor = source.getSelectedTextEditor();

                if (editor != null) {
                    // Use SnippetIndexer to reindex the file
                    FragmentUtils.reindexFile(file, project.getService(FragmentsIndex.class));

                    // Highlight duplicates in the editor
                    project.getService(FragmentCollisionHighlighter.class).highlightDuplicates(editor);
                }
            }
        };
    }

    private static @NotNull FileDocumentManagerListener onFileSaveAction(@NotNull Project project) {
        return new FileDocumentManagerListener() {
            @Override
            public void beforeDocumentSaving(@NotNull Document document) {
                Messages.showErrorDialog("file:", "Error");

                var text = document.getText();
                var file = FileDocumentManager.getInstance().getFile(document);



                if (file == null) {
                    return;
                }

                FragmentUtils.reindexFile(file, project.getService(FragmentsIndex.class));


                var matcher = FRAGMENT_PATTERN.matcher(text);// TODO: Extract to fragment parser
                var fragmentsManager = project.getService(FragmentsManager.class);

                while (matcher.find()) {
                    var fragmentId = matcher.group(1).trim();
                    var fragmentCode = matcher.group(2);
                    fragmentsManager.saveFragment(fragmentId, fragmentCode);
                }
            }
        };
    }

    private static @NotNull EditorFactoryListener onFragmentHoverAction(@NotNull Project project) {
        return new EditorFactoryListener() {
            @Override
            public void editorCreated(@NotNull EditorFactoryEvent event) {
                var editor = event.getEditor();

                editor.getDocument().addDocumentListener(
                        new BulkAwareDocumentListener() {
                            @Override
                            public void documentChanged(@NotNull DocumentEvent event) {
                                System.out.println("@DBG: BulkAwareDocumentListener.documentChanged");

                                BulkAwareDocumentListener.super.documentChanged(event);
                            }
                        }
                );

                if (editor.getProject() != project) {
                    return; // Ignore editors not associated with this project
                }

                // Attach the FragmentCaretListener
                var caretListener = new FragmentCaretListener(editor);
                editor.getCaretModel().addCaretListener(new FragmentCaretListener(editor));
                // Ensure the listener is removed when the editor is released
                Disposer.register(project, () -> editor.getCaretModel().removeCaretListener(caretListener));
            }
        };
    }
}
