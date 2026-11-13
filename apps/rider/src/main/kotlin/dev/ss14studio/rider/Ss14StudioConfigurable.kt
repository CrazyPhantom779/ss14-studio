package dev.ss14studio.rider

import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

class Ss14StudioConfigurable(private val project: Project) : SearchableConfigurable {
    private val settings: Ss14StudioSettings get() = Ss14StudioSettings.getInstance()
    private var nodeField: JBTextField? = null
    private var followCheck: JBCheckBox? = null
    private var autoRefreshCheck: JBCheckBox? = null
    private var startCheck: JBCheckBox? = null

    override fun getId(): String = "ss14studio.settings"

    override fun getDisplayName(): String = "SS14 Studio"

    override fun createComponent(): JComponent {
        val node = JBTextField(settings.state.nodePath)
        val follow = JBCheckBox(
            "Follow the active editor when the tool window is visible",
            settings.state.followEditor,
        )
        val autoRefresh = JBCheckBox(
            "Refresh the studio when project files change",
            settings.state.autoRefresh,
        )
        val start = JBCheckBox(
            "Start the sidecar when an SS14 project opens",
            settings.state.startSidecarOnProjectOpen,
        )
        nodeField = node
        followCheck = follow
        autoRefreshCheck = autoRefresh
        startCheck = start

        val hint = JLabel(
            "<html><body style='width:520px'>" +
                "<p>SS14 Studio runs its UI in a local Node.js sidecar. Graph display options, " +
                "prototype settings and layouts live in the Studio Settings panel inside the tool window.</p>" +
                "<p>Leave the Node path empty to detect <code>node</code> from <code>PATH</code>.</p>" +
                "</body></html>",
        )

        return FormBuilder.createFormBuilder()
            .addLabeledComponent("Node.js executable:", node)
            .addComponent(follow)
            .addComponent(autoRefresh)
            .addComponent(start)
            .addVerticalGap(8)
            .addComponent(hint)
            .addComponentFillVertically(JPanel(), JBUI.scale(8))
            .panel
    }

    override fun isModified(): Boolean =
        (nodeField?.text?.trim() ?: settings.state.nodePath) != settings.state.nodePath ||
            (followCheck?.isSelected ?: settings.state.followEditor) != settings.state.followEditor ||
            (autoRefreshCheck?.isSelected ?: settings.state.autoRefresh) != settings.state.autoRefresh ||
            (startCheck?.isSelected ?: settings.state.startSidecarOnProjectOpen) !=
            settings.state.startSidecarOnProjectOpen

    override fun apply() {
        val state = settings.state
        state.nodePath = nodeField?.text?.trim().orEmpty()
        state.followEditor = followCheck?.isSelected ?: state.followEditor
        state.autoRefresh = autoRefreshCheck?.isSelected ?: state.autoRefresh
        state.startSidecarOnProjectOpen = startCheck?.isSelected ?: state.startSidecarOnProjectOpen
        project.getService(Ss14StudioService::class.java).applySettings()
    }

    override fun reset() {
        nodeField?.text = settings.state.nodePath
        followCheck?.isSelected = settings.state.followEditor
        autoRefreshCheck?.isSelected = settings.state.autoRefresh
        startCheck?.isSelected = settings.state.startSidecarOnProjectOpen
    }
}
