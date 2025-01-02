import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("java")
    id("idea")
    id("org.jetbrains.intellij.platform") version "2.2.1"

}

group = "org.getrafty"
version = "0.1"

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
