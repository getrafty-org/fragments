package org.getrafty.fragments.dao;

import com.intellij.openapi.project.Project;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

public class FragmentsDaoTest {

    @Mock
    private Project mockProject;

    private FragmentsDao fragmentsDao;
    private Path tempDir;

    @Before
    public void setUp() throws Exception {
        // Initialize mocks
        MockitoAnnotations.openMocks(this);

        // Create a temporary directory in the filesystem for testing
        tempDir = Files.createTempDirectory("fragments_test");

        // Mock the behavior of Project's base path
        when(mockProject.getBasePath()).thenReturn(tempDir.toString());

        // Initialize the FragmentsDao with the mocked project
        fragmentsDao = new FragmentsDao(mockProject);
    }

    @After
    public void tearDown() throws Exception {
        // Clean up the temporary directory after the tests
        if (Files.exists(tempDir)) {
            Files.walk(tempDir)
                    .sorted(Comparator.reverseOrder()) // Delete files before directories
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (Exception ignored) {
                        }
                    });
        }
    }

    @Test
    public void testSaveAndFindFragment() {
        String fragmentId = "testFragment";
        String fragmentCode = "int x = 42;";
        String mode = "USER";

        // Save the fragment
        fragmentsDao.saveFragment(fragmentId, fragmentCode, mode);

        // Retrieve the fragment
        String retrievedCode = fragmentsDao.findFragment(fragmentId, mode);

        // Verify the saved fragment can be retrieved correctly
        assertNotNull("Fragment should be found", retrievedCode);
        assertEquals("Fragment content should match", fragmentCode, retrievedCode);
    }

    @Test
    public void testFindNonexistentFragment() {
        String result = fragmentsDao.findFragment("nonexistent", "USER");

        // Verify that trying to find a non-existent fragment returns null
        assertNull("Non-existent fragment should return null", result);
    }

    @Test
    public void testSaveMultipleFragmentsDifferentVersions() {
        String fragmentId = "multiVersionFragment";
        String userCode = "int user = 42;";
        String maintainerCode = "int maintainer = 99;";

        // Save USER version of the fragment
        fragmentsDao.saveFragment(fragmentId, userCode, "USER");

        // Save MAINTAINER version of the fragment
        fragmentsDao.saveFragment(fragmentId, maintainerCode, "MAINTAINER");

        // Retrieve each version
        String retrievedUserCode = fragmentsDao.findFragment(fragmentId, "USER");
        String retrievedMaintainerCode = fragmentsDao.findFragment(fragmentId, "MAINTAINER");

        // Verify both versions are saved and retrieved correctly
        assertNotNull("User version should be found", retrievedUserCode);
        assertNotNull("Maintainer version should be found", retrievedMaintainerCode);
        assertEquals("User code should match", userCode, retrievedUserCode);
        assertEquals("Maintainer code should match", maintainerCode, retrievedMaintainerCode);
    }

    @Test
    public void testSaveOverwritesFragment() {
        String fragmentId = "overwriteFragment";
        String initialCode = "int x = 42;";
        String updatedCode = "int x = 99;";
        String mode = "USER";

        // Save initial fragment
        fragmentsDao.saveFragment(fragmentId, initialCode, mode);

        // Save updated fragment
        fragmentsDao.saveFragment(fragmentId, updatedCode, mode);

        // Retrieve the updated fragment
        String retrievedCode = fragmentsDao.findFragment(fragmentId, mode);

        // Verify the fragment is updated
        assertNotNull("Fragment should be found", retrievedCode);
        assertEquals("Fragment should reflect updated code", updatedCode, retrievedCode);
    }

    @Test
    public void testStorageInTemporaryDirectory() {
        String fragmentId = "tempStorageFragment";
        String fragmentCode = "int x = 42;";
        String mode = "USER";

        // Save a fragment
        fragmentsDao.saveFragment(fragmentId, fragmentCode, mode);

        // Adjust the expected path to include the .fragments directory
        Path expectedFilePath = tempDir.resolve(".fragments").resolve("@" + fragmentId + ".json");

        // Verify the fragment file exists
        assertTrue("Fragment file should exist in temporary directory", Files.exists(expectedFilePath));
    }

}
