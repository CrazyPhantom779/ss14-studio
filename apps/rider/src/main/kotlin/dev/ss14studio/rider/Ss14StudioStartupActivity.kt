package dev.ss14studio.rider

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.StartupActivity
import java.io.File

class Ss14StudioStartupActivity : StartupActivity.DumbAware {
    override fun runActivity(project: Project) {
        val settings = Ss14StudioSettings.getInstance()
        if (!settings.state.startSidecarOnProjectOpen) return
        val basePath = project.basePath ?: return
        if (!File(basePath, "Resources").isDirectory && !File(basePath, "Content.Shared").isDirectory) {
            return
        }
        project.getService(Ss14StudioService::class.java).ensureStarted()
    }
}
