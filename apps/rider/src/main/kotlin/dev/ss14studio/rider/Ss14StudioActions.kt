package dev.ss14studio.rider

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.Project

class OpenDashboardAction : AnAction(
    "Open SS14 Studio",
    "Open the SS14 Studio dashboard for this project",
    StudioIcons.ICON,
) {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        project.getService(Ss14StudioService::class.java).showDashboard()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}

class OpenCurrentFileAction : AnAction(
    "Open in SS14 Studio",
    "Open this YAML, XAML or RSI in the SS14 Studio tool window",
    StudioIcons.ICON,
) {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val editor = event.getData(CommonDataKeys.EDITOR)
        val line = editor?.caretModel?.logicalPosition?.line?.plus(1)
        project.getService(Ss14StudioService::class.java).openInStudio(file.path, line)
    }

    override fun update(event: AnActionEvent) {
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE)
        event.presentation.isEnabledAndVisible =
            event.project != null && file != null && isStudioFile(file)
    }
}

class RefreshStudioAction : AnAction(
    "Refresh SS14 Studio Index",
    "Rescan construction graphs, prototypes, locales and sprites",
    StudioIcons.ICON,
) {
    override fun actionPerformed(event: AnActionEvent) {
        val project: Project = event.project ?: return
        project.getService(Ss14StudioService::class.java).refreshIndex()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }
}
