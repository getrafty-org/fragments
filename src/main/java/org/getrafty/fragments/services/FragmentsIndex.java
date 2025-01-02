package org.getrafty.fragments.services;

import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

import java.util.*;

@Service(Service.Level.PROJECT)
public final class FragmentsIndex {
    public record Entry(@NotNull String hash, @NotNull VirtualFile file, int startOffset, int endOffset) {
    }

    private final Map<String, Map<VirtualFile, List<OffsetRange>>> virtualFileListMap = new HashMap<>();

    public FragmentsIndex(@NotNull Project project) {}

    public void addFragmentIndexEntry(@NotNull Entry entry) {
        synchronized (virtualFileListMap) {
            virtualFileListMap.computeIfAbsent(entry.hash, a -> new HashMap<>())
                    .computeIfAbsent(entry.file, a -> new ArrayList<>())
                    .add(new OffsetRange(entry.startOffset, entry.endOffset));

        }
    }

    public Map<String, Map<VirtualFile, List<OffsetRange>>> findAllFragmentEntries() {
        return virtualFileListMap;
    }

    public List<OffsetRange> getOffsetsForFile(@NotNull String hash, @NotNull VirtualFile file) {
        synchronized (virtualFileListMap) {
            return virtualFileListMap.getOrDefault(hash, Collections.emptyMap())
                .getOrDefault(file, Collections.emptyList());
        }
    }

    public void forgetFragmentEntriesForFile(@NotNull VirtualFile file) {
        synchronized (virtualFileListMap) {
            virtualFileListMap.values().forEach(fileOccurrences -> fileOccurrences.remove(file));
            virtualFileListMap.entrySet().removeIf(entry -> entry.getValue().isEmpty());
        }
    }

    public void forgetFragmentEntryForFile(@NotNull String hash, @NotNull VirtualFile file) {
        synchronized (virtualFileListMap) {
            virtualFileListMap.computeIfPresent(hash, (key, fileSet) -> {
                fileSet.remove(file);
                return fileSet.isEmpty() ? null : fileSet;
            });
        }
    }

    public record OffsetRange(int start, int end) {
    }
}
