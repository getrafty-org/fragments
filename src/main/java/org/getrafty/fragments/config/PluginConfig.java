package org.getrafty.fragments.config;

import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.projectRoots.Sdk;
import com.intellij.openapi.roots.ProjectRootManager;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileManager;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.nio.file.Paths;
import java.util.Properties;

@Service(Service.Level.PROJECT)
public final class PluginConfig {
    private static final String CONFIG_FILE_NAME = "fragments.properties";
    private static final String DEFAULT_FRAGMENTS_FOLDER = ".fragments";

    public static final String PROP_FRAGMENTS_STORAGE_FOLDER = "fragments.folder";

    private final Properties properties = new Properties();

    public PluginConfig(@NotNull Project project) {
        var projectBase = getProjectBase(project);


        Messages.showErrorDialog("projectBase =: " + projectBase, "Error");


//        var configPath = Paths.get(remoteBaseDir, CONFIG_FILE_NAME);
//        var configFile = VirtualFileManager.getInstance().findFileByNioPath(configPath);
//
//        if (configFile == null || !configFile.exists()) {
//            Messages.showInfoMessage("No configuration file found at: " + CONFIG_FILE_NAME + " under baseDir: " + remoteBaseDir, "Info");
//            return;
//        }

//        try (var inputStream = configFile.getInputStream()) {
//            properties.load(inputStream);
//        } catch (IOException e) {
//            throw new RuntimeException("Failed to load Fragments configuration", e);
//        }
    }

    public String fragmentsFolder() {
        return properties.getProperty(PROP_FRAGMENTS_STORAGE_FOLDER, DEFAULT_FRAGMENTS_FOLDER);
    }

    private @Nullable VirtualFile getProjectBase(@NotNull Project project) {
        final var sdk = ProjectRootManager.getInstance(project).getProjectSdk();
        if (sdk != null) {
            return sdk.getHomeDirectory();
        }
        return project.getBaseDir(); // Fallback for non-remote projects
    }
}
