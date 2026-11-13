package dev.ss14studio.rider

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants

class StudioToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = StudioPanel(project)
        val content = ContentFactory.getInstance().createContent(panel.component, "Studio", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
        project.getService(Ss14StudioService::class.java).ensureStarted()
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}

private class StudioPanel(private val project: Project) : Disposable {
    private val service: Ss14StudioService = project.getService(Ss14StudioService::class.java)
    private val statusLabel = JBLabel("Starting SS14 Studio…")
    private var browser: JBCefBrowser? = null
    private val readyListener: (String) -> Unit = { url ->
        ApplicationManager.getApplication().invokeLater {
            browser?.loadURL(url)
        }
    }
    private val statusListener: (JsonObject) -> Unit = { status ->
        ApplicationManager.getApplication().invokeLater {
            updateStatus(status)
        }
    }

    val component: JComponent

    init {
        val root = JPanel(BorderLayout())
        root.border = JBUI.Borders.empty()

        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 6, 4))
        val brand = JBLabel("SS14 Studio")
        brand.font = brand.font.deriveFont(Font.BOLD)
        toolbar.add(brand)
        toolbar.add(verticalSeparator())
        toolbar.add(button("Dashboard") { service.showDashboard() })
        toolbar.add(button("Refresh") { service.refreshIndex() })
        toolbar.add(button("Settings") { service.openSettings() })
        statusLabel.horizontalAlignment = SwingConstants.RIGHT
        statusLabel.foreground = JBColor.GRAY
        toolbar.add(statusLabel)
        root.add(toolbar, BorderLayout.NORTH)

        if (JBCefApp.isSupported()) {
            val created = try {
                JBCefBrowser()
            } catch (_: Exception) {
                null
            }
            browser = created
            if (created != null) {
                created.component.background = JBColor.PanelBackground
                root.add(created.component, BorderLayout.CENTER)
            } else {
                root.add(fallback("The embedded browser could not be created."), BorderLayout.CENTER)
            }
        } else {
            root.add(
                fallback(
                    "JCEF is not available in this IDE. Enable the bundled JCEF runtime or use the VS Code edition.",
                ),
                BorderLayout.CENTER,
            )
        }

        component = root
        service.addReadyListener(readyListener)
        service.addStatusListener(statusListener)
    }

    private fun updateStatus(status: JsonObject) {
        val graphs = status.int("graphs") ?: 0
        val prototypes = status.int("prototypes") ?: 0
        val errors = status.int("errors") ?: 0
        val warnings = status.int("warnings") ?: 0
        val indexing = status.bool("indexing") == true
        statusLabel.text = buildString {
            if (indexing) append("Indexing… ")
            append("$graphs graphs · $prototypes prototypes")
            if (errors > 0) append(" · $errors errors")
            if (warnings > 0) append(" · $warnings warnings")
        }
    }

    private fun button(text: String, action: () -> Unit): JButton =
        JButton(text).apply {
            addActionListener { action() }
            isFocusable = false
        }

    private fun verticalSeparator(): JComponent =
        JPanel().apply {
            preferredSize = java.awt.Dimension(1, 18)
            background = JBColor.border()
        }

    private fun fallback(message: String): JComponent =
        JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty(32)
            add(
                JBLabel(
                    "<html><body style='width:420px'>" +
                        "<h2>SS14 Studio</h2>" +
                        "<p>$message</p>" +
                        "<p>Install Node.js 18 or newer, then reopen this tool window.</p>" +
                        "</body></html>",
                ),
                BorderLayout.NORTH,
            )
        }

    override fun dispose() {
        service.removeReadyListener(readyListener)
        service.removeStatusListener(statusListener)
        browser?.dispose()
        browser = null
    }
}
