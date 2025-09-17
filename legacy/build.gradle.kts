import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("java")
    id("idea")
    id("org.jetbrains.intellij.platform") version "2.2.1"
}

group = "org.getrafty"
version = "git rev-parse --short=7 HEAD".runCommand(workingDir = rootDir)

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(IntelliJPlatformType.CLion, "2024.2.1") // Target CLion version
        testFramework(TestFrameworkType.Platform) // IntelliJ Platform-specific test framework
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito:mockito-core:5.5.0")
}

val publishToken: String by project

intellijPlatform {
    publishing {
        token.set(publishToken)
    }
    pluginConfiguration {
        ideaVersion {
            // Use the since-build of the CLion version
            untilBuild.set(provider { null })
        }
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
        vendor.set(JvmVendorSpec.JETBRAINS)
    }
}

tasks {
    test {
        useJUnit() // Forces Gradle to use JUnit 4
        testLogging {
            events("PASSED", "FAILED", "SKIPPED")
        }
    }

    wrapper {
        gradleVersion = "8.11" // Ensure compatibility with the IntelliJ Gradle plugin
    }

    runIde {
        jvmArgs("-Xmx16G") // Set JVM arguments for IDE debugging
    }
}

fun String.runCommand(
    workingDir: File = File("."),
    timeoutAmount: Long = 60,
    timeoutUnit: TimeUnit = TimeUnit.SECONDS
): String = ProcessBuilder(split("\\s(?=(?:[^'\"`]*(['\"`])[^'\"`]*\\1)*[^'\"`]*$)".toRegex()))
    .directory(workingDir)
    .redirectOutput(ProcessBuilder.Redirect.PIPE)
    .redirectError(ProcessBuilder.Redirect.PIPE)
    .start()
    .apply { waitFor(timeoutAmount, timeoutUnit) }
    .run {
        val error = errorStream.bufferedReader().readText().trim()
        if (error.isNotEmpty()) {
            throw Exception(error)
        }
        inputStream.bufferedReader().readText().trim()
    }