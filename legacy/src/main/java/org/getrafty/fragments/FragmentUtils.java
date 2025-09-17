package org.getrafty.fragments;

import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.project.Project;
import org.getrafty.fragments.services.FragmentsDataService;

import java.util.regex.Pattern;

public class FragmentUtils {
    public static final Pattern FRAGMENT_PATTERN = Pattern.compile(
            "// ==== YOUR CODE: @(.*?) ====(.*?)// ==== END YOUR CODE ====",
            Pattern.DOTALL
    );

    public static void loadFragmentsIntoCurrentEditor(Project project, Document document) {
        var fragmentsManager = project.getService(FragmentsDataService.class);


        String text = document.getText();

        var updatedText = new StringBuilder();
        int lastMatchEnd = 0;

        var matcher = FRAGMENT_PATTERN.matcher(text);

        while (matcher.find()) {
            String snippetId = matcher.group(1);
            String currentContent = matcher.group(2);
            var newContent = fragmentsManager.findFragment(snippetId);

            updatedText.append(text, lastMatchEnd, matcher.start());
            updatedText.append("// ==== YOUR CODE: @").append(snippetId).append(" ====");
            updatedText.append(newContent != null ? newContent : currentContent);
            updatedText.append("// ==== END YOUR CODE ====");
            lastMatchEnd = matcher.end();
        }

        updatedText.append(text.substring(lastMatchEnd));

        WriteCommandAction.runWriteCommandAction(null, () -> {
            document.setText(updatedText.toString());
        });
    }
}
