package dev.ss14studio.rider

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import java.awt.Component
import java.awt.event.MouseEvent

class Ss14StudioStatusWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = Ss14StudioStatusWidget.ID

    override fun getDisplayName(): String = "SS14 Studio"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget =
        Ss14StudioStatusWidget(project)
}

class Ss14StudioStatusWidget(
    private val project: Project,
) : StatusBarWidget, StatusBarWidget.TextPresentation, Disposable {
    companion object {
        const val ID: String = "ss14studio.status"
    }

    private val service: Ss14StudioService = project.getService(Ss14StudioService::class.java)
    private val connection = project.messageBus.connect(this)
    private var text = "SS14 Studio"
    private var tooltip = "Open the SS14 Studio dashboard"

    init {
        connection.subscribe(SS14_STUDIO_STATUS_TOPIC, object : Ss14StudioStatusListener {
            override fun statusChanged(status: JsonObject) {
                update(status)
            }
        })
        service.lastStatus?.let(::update)
    }

    override fun ID(): String = ID

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun install(statusBar: StatusBar) = Unit

    override fun dispose() = Unit

    override fun getText(): String = text

    override fun getAlignment(): Float = Component.LEFT_ALIGNMENT

    override fun getTooltipText(): String = tooltip

    override fun getClickConsumer(): Consumer<MouseEvent> =
        Consumer { service.showDashboard() }

    private fun update(status: JsonObject) {
        val graphs = status.int("graphs") ?: 0
        val prototypes = status.int("prototypes") ?: 0
        val errors = status.int("errors") ?: 0
        val warnings = status.int("warnings") ?: 0
        val indexing = status.bool("indexing") == true
        text = buildString {
            append("SS14")
            if (indexing) append(" …")
            if (graphs > 0) append(" $graphs")
            if (errors > 0) append(" !$errors")
            else if (warnings > 0) append(" ?$warnings")
        }
        tooltip = buildString {
            append("SS14 Studio")
            if (indexing) append(" · indexing")
            append(" · $graphs graphs · $prototypes prototypes")
            if (errors > 0) append(" · $errors errors")
            if (warnings > 0) append(" · $warnings warnings")
            append("\nClick to open the dashboard.")
        }
    }
}
