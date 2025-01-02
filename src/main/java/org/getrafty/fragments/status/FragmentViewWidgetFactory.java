package org.getrafty.fragments.status;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import org.jetbrains.annotations.NotNull;

public class FragmentViewWidgetFactory implements StatusBarWidgetFactory {
    public static final String FRAGMENT_VIEW_WIDGET_FACTORY = "FragmentViewWidgetFactory";

    @NotNull
    @Override
    public String getId() {
        return FRAGMENT_VIEW_WIDGET_FACTORY;
    }

    @NotNull
    @Override
    public String getDisplayName() {
        return "Fragment View";
    }

    @Override
    public boolean isAvailable(@NotNull Project project) {
        return true;
    }

    @NotNull
    @Override
    public StatusBarWidget createWidget(@NotNull Project project) {
        return new FragmentViewWidget(project);
    }

    @Override
    public boolean isConfigurable() {
        return false;
    }
}
