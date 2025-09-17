package org.getrafty.fragments.config;

import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Objects;
import java.util.Properties;

@Service(Service.Level.PROJECT)
public final class PluginConfig {
    private static final String CONFIG_FILE_NAME = "fragments.properties";
    private static final String DEFAULT_FRAGMENTS_FOLDER = ".fragments";

    public static final String PROP_FRAGMENTS_STORAGE_FOLDER = "fragments.folder";

    private final Path fragmetsDataPath;

    public PluginConfig(@NotNull Project project) {
        var projectBase = project.getBasePath();
        var configPath = Paths.get(Objects.requireNonNull(projectBase), CONFIG_FILE_NAME);

        final var properties = new Properties();
        if (Files.exists(configPath)) {
            try (var inputStream = Files.newInputStream(configPath)) {
                properties.load(inputStream);
            } catch (IOException ignored) {
                // ignored
            }
        }

        this.fragmetsDataPath = Paths.get(projectBase, properties.getProperty(PROP_FRAGMENTS_STORAGE_FOLDER, DEFAULT_FRAGMENTS_FOLDER));


    }

    public Path fragmetsDataPath() {
        return fragmetsDataPath;
    }
}
