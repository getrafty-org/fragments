package org.getrafty.fragments.dao;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import org.getrafty.fragments.config.PluginConfig;
import org.jetbrains.annotations.NotNull;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

@Service(Service.Level.PROJECT)
public final class FragmentsDao {
    public static final String FRAGMENT_ID = "id";
    public static final String FRAGMENT_METADATA = "metadata";
    public static final String FRAGMENT_VERSIONS = "versions";
    public static final String FRAGMENT_CODE = "code";

    private final static ThreadLocal<Gson> GSON = ThreadLocal.withInitial(Gson::new);

    private final Path fragmentsFolder;

    public FragmentsDao(@NotNull Project project) {
        var config = project.getService(PluginConfig.class);

        this.fragmentsFolder = Path.of(Objects.requireNonNull(project.getBasePath()), config.fragmentsFolder());

        try {
            Files.createDirectories(fragmentsFolder);
        } catch (IOException e) {
            throw new RuntimeException("Failed to initialize Fragments folder", e);
        }
    }

    public void saveFragment(@NotNull String id, @NotNull String code, @NotNull String mode) {
        var fragmentPath = getSnippetFilePath(id);

        try {
            JsonObject root;

            if (Files.exists(fragmentPath)) {
                String json = Files.readString(fragmentPath);
                root = JsonParser.parseString(json).getAsJsonObject();
            } else {
                root = new JsonObject();
                root.addProperty(FRAGMENT_ID, id);
                root.add(FRAGMENT_METADATA, new JsonObject());
                root.add(FRAGMENT_VERSIONS, new JsonObject());
            }

            JsonObject versions = root.getAsJsonObject(FRAGMENT_VERSIONS);
            JsonObject versionData = new JsonObject();
            versionData.addProperty(FRAGMENT_CODE, code);

            versions.add(mode, versionData);

            Files.writeString(fragmentPath, GSON.get().toJson(root), StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (IOException e) {
            throw new RuntimeException("Failed to save fragment: " + id, e);
        }
    }

    public String findFragment(@NotNull String id, @NotNull String mode) {
        var snippetFile = getSnippetFilePath(id);
        try {
            if (Files.exists(snippetFile)) {
                var json = Files.readString(snippetFile);
                var root = JsonParser.parseString(json).getAsJsonObject();
                var versions = root.getAsJsonObject(FRAGMENT_VERSIONS);

                if (versions.has(mode)) {
                    return versions.getAsJsonObject(mode).get(FRAGMENT_CODE).getAsString();
                }
            }
        } catch (IOException e) {
            throw new RuntimeException("Failed to load fragment: " + id, e);
        }

        return null;
    }

    private @NotNull Path getSnippetFilePath(@NotNull String id) {
        return fragmentsFolder.resolve("@" + id + ".json");
    }
}
