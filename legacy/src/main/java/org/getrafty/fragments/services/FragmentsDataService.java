package org.getrafty.fragments.services;

import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import org.getrafty.fragments.dao.FragmentsDao;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.PROJECT)
public final class FragmentsDataService {
   public enum FragmentVersion {
       PUBLIC,
       PRIVATE,
    }

    public static FragmentVersion CURRENT_FRAGMENT_VERSION = FragmentVersion.PUBLIC;

    private final FragmentsDao fragmentsDao;

    public FragmentsDataService(@NotNull Project project) {
        this.fragmentsDao = project.getService(FragmentsDao.class);
    }

    public void saveFragment(String fragmentId, String fragmentCode) {
        fragmentsDao.saveFragment(fragmentId, fragmentCode, CURRENT_FRAGMENT_VERSION.name());
    }

    public String findFragment(String fragmentId) {
        return fragmentsDao.findFragment(fragmentId, CURRENT_FRAGMENT_VERSION.name());
    }

    public static void swapFragmentVersion() {
        CURRENT_FRAGMENT_VERSION = (CURRENT_FRAGMENT_VERSION == FragmentVersion.PRIVATE)
                ? FragmentVersion.PUBLIC
                : FragmentVersion.PRIVATE;
    }
}
