package org.getrafty.fragments.services;

import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import org.getrafty.fragments.dao.FragmentsDao;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.PROJECT)
public final class FragmentsManager {
   public enum FragmentVersion {
        MAINTAINER,
        USER
    }

    private final FragmentsDao fragmentsDao;
    
    public static FragmentVersion CURRENT_FRAGMENT_VERSION = FragmentVersion.USER;

    public FragmentsManager(@NotNull Project project) {
        this.fragmentsDao = project.getService(FragmentsDao.class);
    }

    public void saveFragment(String fragmentId, String fragmentCode) {
        fragmentsDao.saveFragment(fragmentId, fragmentCode, CURRENT_FRAGMENT_VERSION.name());
    }

    public String findFragment(String fragmentId) {
        return fragmentsDao.findFragment(fragmentId, CURRENT_FRAGMENT_VERSION.name());
    }

    public void toggleFragmentVersion() {
        CURRENT_FRAGMENT_VERSION = (CURRENT_FRAGMENT_VERSION == FragmentVersion.MAINTAINER)
                ? FragmentVersion.USER
                : FragmentVersion.MAINTAINER;
    }
}
