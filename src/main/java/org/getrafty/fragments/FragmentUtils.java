package org.getrafty.fragments;

import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.vfs.VirtualFile;
import org.getrafty.fragments.services.FragmentsIndex;
import org.jetbrains.annotations.NotNull;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class FragmentUtils {
    public static final Pattern FRAGMENT_PATTERN = Pattern.compile(
            "// ==== YOUR CODE: @(.*?) ====(.*?)// ==== END YOUR CODE ====",
            Pattern.DOTALL
    );

    public static void reindexFile(@NotNull VirtualFile file, @NotNull FragmentsIndex fragmentIndex) {
        var document = FileDocumentManager.getInstance().getDocument(file);
        if (document == null) {
            return;
        }

        fragmentIndex.forgetFragmentEntriesForFile(file);

        // Extract and register snippets
        String fileContent = document.getText();
        Matcher matcher = FRAGMENT_PATTERN.matcher(fileContent);

        while (matcher.find()) {
            String fragmentId = matcher.group(1).trim();
            int startOffset = matcher.start();
            int endOffset = matcher.end();
            var entry = new FragmentsIndex.Entry(
                    fragmentId,
                    file,
                    startOffset,
                    endOffset
            );
            fragmentIndex.addFragmentIndexEntry(entry);
        }
    }
}
