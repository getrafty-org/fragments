package org.getrafty.fragments.status;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import com.intellij.util.Consumer;
import org.getrafty.fragments.services.FragmentsDataService;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.awt.*;
import java.awt.event.MouseEvent;

import static org.getrafty.fragments.FragmentUtils.loadFragmentsIntoCurrentEditor;

public class FragmentStatusWidget implements StatusBarWidget, StatusBarWidget.TextPresentation {
    public static class FragmentStatusWidgetFactory implements StatusBarWidgetFactory {
        public static final String FRAGMENT_VIEW_WIDGET_FACTORY = "FragmentViewWidgetFactory";

        @NotNull
        @Override
        public String getId() {
            return FRAGMENT_VIEW_WIDGET_FACTORY;
        }

        @NotNull
        @Override
        public String getDisplayName() {
            return "Fragment Status";
        }

        @NotNull
        @Override
        public StatusBarWidget createWidget(@NotNull Project project) {
            return new FragmentStatusWidget(project);
        }

        @Override
        public boolean isConfigurable() {
            return false;
        }
    }

    public static final String FRAGMENT_VIEW_WIDGET = "FragmentViewWidget";

    private final Project project;
    private StatusBar statusBar;

    public FragmentStatusWidget(@NotNull Project project) {
        this.project = project;
    }

    @NotNull
    @Override
    public String ID() {
        return FRAGMENT_VIEW_WIDGET;
    }

    @Nullable
    @Override
    public WidgetPresentation getPresentation() {
        return this;
    }

    @NotNull
    @Override
    public String getText() {
        return FragmentsDataService.CURRENT_FRAGMENT_VERSION == FragmentsDataService.FragmentVersion.PUBLIC
                ? "@Public "
                : "@Private";
    }

    @Nullable
    @Override
    public String getTooltipText() {
        return "Click to switch view mode";
    }

    @Override
    public float getAlignment() {
        return Component.CENTER_ALIGNMENT;
    }

    @Override
    public void install(@NotNull StatusBar statusBar) {
        this.statusBar = statusBar;
    }

    @Override
    public Consumer<MouseEvent> getClickConsumer() {
        return event -> {
            FragmentsDataService.swapFragmentVersion();

            var fileEditorManager = FileEditorManager.getInstance(project);
            for (FileEditor fileEditor : fileEditorManager.getAllEditors()) {
                if (fileEditor instanceof TextEditor) {
                    var editor = ((TextEditor) fileEditor).getEditor();
                    loadFragmentsIntoCurrentEditor(project, editor.getDocument());
                }
            }

            // Refresh the widget text
            if (statusBar != null) {
                statusBar.updateWidget(ID());
            }
        };
    }
}
