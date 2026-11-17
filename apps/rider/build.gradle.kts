plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.20.1"
}

group = "dev.ss14studio"
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        rider(providers.gradleProperty("platformVersion").get())
        pluginVerifier()
        zipSigner()
    }
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    instrumentCode = false
    buildSearchableOptions = false

    pluginConfiguration {
        id = "dev.ss14studio.rider"
        name = "SS14 Studio"
        version = providers.gradleProperty("pluginVersion")
        description = """
            An all-in-one Space Station 14 development studio for Rider: construction graphs with
            entity sprites, YAML prototype inheritance and partials, RobustToolbox XAML tooling,
            RSI animation and pixel editing, and diff/merge views.

            The plugin keeps Rider's native editors as the default and opens Studio surfaces only
            when the user asks for them. It requires Node.js 18 or newer for the local UI sidecar.

            AI disclosure: this plugin and its shared web UI were generated with AI assistance and
            are reviewed by human maintainers. See AI-GENERATED.md in the source repository.
        """.trimIndent()
        vendor {
            name = "SS14 Studio"
            url = "https://github.com/ss14studio/ss14-studio"
        }
        ideaVersion {
            sinceBuild = "242"
            untilBuild = "263.*"
        }
    }
}

val verifyRiderAssets by tasks.registering {
    doLast {
        val required = listOf(
            "web/rider.html",
            "web/rider-bridge.js",
            "web/assets/studio.js",
            "web/assets/style.css",
            "sidecar/dist/sidecar.mjs",
            "web-files.txt",
        )
        val missing = required.filter { !project.file(it).exists() }
        if (missing.isNotEmpty()) {
            error(
                "Missing Rider assets: ${missing.joinToString()}. " +
                    "Run \"npm run build:rider\" from the repository root before building the plugin.",
            )
        }
    }
}

tasks.processResources {
    dependsOn(verifyRiderAssets)
    from("web") { into("web") }
    from("sidecar/dist/sidecar.mjs") { into("sidecar") }
    from("web-files.txt")
}
