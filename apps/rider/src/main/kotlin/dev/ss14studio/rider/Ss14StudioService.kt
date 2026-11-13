package dev.ss14studio.rider

import com.google.gson.JsonObject
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.ide.BrowserUtil
import com.intellij.ide.actions.RevealFileAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.RefreshQueue
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ide.ui.LafManager
import com.intellij.ide.ui.LafManagerListener
import com.intellij.ui.JBColor
import com.intellij.util.Alarm
import com.intellij.util.messages.MessageBusConnection
import java.awt.datatransfer.StringSelection
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.CopyOnWriteArrayList

@Service(Service.Level.PROJECT)
class Ss14StudioService(private val project: Project) : Disposable {
    private val logger = Logger.getInstance(Ss14StudioService::class.java)
    private val settings: Ss14StudioSettings get() = Ss14StudioSettings.getInstance()
    private val readyListeners = CopyOnWriteArrayList<(String) -> Unit>()
    private val statusListeners = CopyOnWriteArrayList<(JsonObject) -> Unit>()
    private val pendingPaths = LinkedHashSet<String>()
    private val changeAlarm = Alarm(Alarm.ThreadToUse.POOLED_THREAD, this)
    private var sidecar: SidecarProcess? = null
    private var projectConnection: MessageBusConnection? = null
    private var applicationConnection: MessageBusConnection? = null
    private var startInProgress = false
    private var disposed = false
    private var stateDir: Path? = null

    @Volatile
    var readyUrl: String? = null
        private set

    @Volatile
    var lastStatus: JsonObject? = null
        private set

    @Volatile
    var suppressFollowUntil: Long = 0L

    init {
        subscribeToFileChanges()
        subscribeToEditorSelection()
        subscribeToThemeChanges()
    }

    @Synchronized
    fun ensureStarted() {
        if (disposed || sidecar != null || startInProgress) return
        val basePath = project.basePath
        if (basePath == null) {
            notify("error", "Open a project folder before starting SS14 Studio.")
            return
        }
        startInProgress = true
        try {
            val version = pluginVersion()
            val installation = Path.of(PathManager.getSystemPath(), "ss14-studio", version)
            extractResources(installation, version)
            val web = installation.resolve("web")
            val script = installation.resolve("sidecar").resolve("sidecar.mjs")
            if (!Files.isRegularFile(script)) {
                notify(
                    "error",
                    "The SS14 Studio sidecar is missing from the plugin installation. Reinstall the plugin.",
                )
                return
            }
            val state = Path.of(
                PathManager.getSystemPath(),
                "ss14-studio",
                "state",
                stateKey(basePath),
            )
            Files.createDirectories(state.resolve("scratch"))
            stateDir = state

            val node = resolveNode()
            if (node == null) {
                notify(
                    "error",
                    "Node.js was not found. Install Node.js 18 or newer and set its path in Settings | Tools | SS14 Studio.",
                )
                return
            }

            val command = GeneralCommandLine(node, script.toString())
                .withWorkingDirectory(Path.of(basePath))
                .withCharset(Charsets.UTF_8)
                .withParameters(
                    "--project", basePath,
                    "--web", web.toString(),
                    "--state", state.toString(),
                    "--port", "0",
                    "--theme", currentTheme(),
                    "--version", version,
                )
            val roots = ProjectRootManager.getInstance(project).contentRoots
                .map { it.path }
                .ifEmpty { listOf(basePath) }
            for (root in roots) {
                command.addParameter("--root")
                command.addParameter(root)
            }

            val started = SidecarProcess(
                command,
                ::handleReady,
                ::handleStatus,
                ::handleIdeMessage,
                ::handleExit,
            )
            sidecar = started
            started.start()
            sendPreferences()
        } catch (error: Exception) {
            logger.error("Could not start the SS14 Studio sidecar.", error)
            notify("error", "Could not start SS14 Studio: ${error.message}")
        } finally {
            startInProgress = false
        }
    }

    fun showDashboard() {
        ensureStarted()
        activateToolWindow()
        sendCommand(mapOf("command" to "openDashboard"))
    }

    fun openInStudio(path: String, line: Int? = null) {
        ensureStarted()
        activateToolWindow()
        sendCommand(mapOf("command" to "open", "path" to path, "line" to line))
    }

    fun followInStudio(path: String, line: Int? = null) {
        ensureStarted()
        sendCommand(mapOf("command" to "open", "path" to path, "line" to line))
    }

    fun refreshIndex(showProgress: Boolean = false) {
        ensureStarted()
        if (!showProgress) {
            sendCommand(mapOf("command" to "refresh"))
            return
        }
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Refreshing SS14 Studio", false) {
            override fun run(indicator: ProgressIndicator) {
                sendCommand(mapOf("command" to "refresh"))
            }
        })
    }

    fun openSettings(setting: String? = null) {
        ShowSettingsUtil.getInstance().showSettingsDialog(project, "ss14studio.settings")
    }

    fun applySettings() {
        sendPreferences()
        if (settings.state.startSidecarOnProjectOpen) ensureStarted()
    }

    fun addReadyListener(listener: (String) -> Unit) {
        readyListeners.add(listener)
        readyUrl?.let(listener)
    }

    fun removeReadyListener(listener: (String) -> Unit) {
        readyListeners.remove(listener)
    }

    fun addStatusListener(listener: (JsonObject) -> Unit) {
        statusListeners.add(listener)
        lastStatus?.let(listener)
    }

    fun removeStatusListener(listener: (JsonObject) -> Unit) {
        statusListeners.remove(listener)
    }

    fun sendCommand(message: Map<String, Any?>) {
        sidecar?.send(message)
    }

    fun isRunning(): Boolean = sidecar != null

    private fun handleReady(message: JsonObject) {
        val url = message.string("url") ?: return
        readyUrl = url
        for (listener in readyListeners) listener(url)
    }

    private fun handleStatus(message: JsonObject) {
        val status = message.getAsJsonObject("status") ?: message
        lastStatus = status
        for (listener in statusListeners) listener(status)
        project.messageBus.syncPublisher(SS14_STUDIO_STATUS_TOPIC).statusChanged(status)
    }

    private fun handleExit(code: Int) {
        sidecar = null
        readyUrl = null
        if (disposed) return
        val level = if (code == 0) "warn" else "error"
        notify(level, "The SS14 Studio sidecar stopped (exit code $code). Reopen the tool window to restart it.")
    }

    private fun handleIdeMessage(message: JsonObject) {
        when (message.string("action")) {
            "notify" -> notify(message.string("level") ?: "info", message.string("message") ?: "")
            "openPath" -> message.string("path")?.let { openPath(it, message.int("line")) }
            "openUrl" -> message.string("url")?.let { BrowserUtil.browse(it) }
            "copyText" -> message.string("text")?.let {
                CopyPasteManager.getInstance().setContents(StringSelection(it))
            }
            "openSettings" -> openSettings(message.string("setting"))
            "refreshFiles" -> refreshFiles(message.array("paths"))
            "revealInExplorer" -> message.string("path")?.let { path ->
                RevealFileAction.openFile(Path.of(path))
            }
            "saveDocument" -> saveDocument(message)
            "pickFile" -> pickFile(message)
            "openScratch" -> openScratch(message)
            else -> logger.debug("Unknown sidecar action: ${message.string("action")}")
        }
    }

    private fun openPath(path: String, line: Int?) {
        suppressFollowUntil = System.currentTimeMillis() + 1200
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(path)
            if (file == null) {
                notify("error", "Could not find $path.")
                return@invokeLater
            }
            val descriptor = OpenFileDescriptor(project, file)
            val editor = FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
            if (editor != null && line != null && line > 0) {
                val lineIndex = (line - 1).coerceIn(0, (editor.document.lineCount - 1).coerceAtLeast(0))
                editor.caretModel.moveToOffset(editor.document.getLineStartOffset(lineIndex))
                editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
            }
        }
    }

    private fun refreshFiles(paths: List<String>) {
        if (paths.isEmpty()) return
        ApplicationManager.getApplication().invokeLater {
            val session = RefreshQueue.getInstance().createSession(true, true, null)
            for (path in paths) {
                LocalFileSystem.getInstance().refreshAndFindFileByPath(path)?.let(session::addFile)
            }
            session.launch()
        }
    }

    private fun saveDocument(message: JsonObject) {
        val path = message.string("path") ?: return
        val requestId = message.int("requestId")
        ApplicationManager.getApplication().invokeLater {
            val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(path)
            val document = file?.let { FileDocumentManager.getInstance().getDocument(it) }
            if (document != null) {
                FileDocumentManager.getInstance().saveDocument(document)
            }
            reply("saved", requestId, path)
        }
    }

    private fun pickFile(message: JsonObject) {
        val requestId = message.int("requestId")
        val title = message.string("title") ?: "Select a file"
        val directory = message.bool("directory") == true
        ApplicationManager.getApplication().invokeLater {
            val descriptor = if (directory) {
                FileChooserDescriptorFactory.createSingleFolderDescriptor()
            } else {
                FileChooserDescriptorFactory.createSingleFileDescriptor()
            }
            descriptor.title = title
            val chosen = FileChooser.chooseFile(descriptor, project, null)
            reply("filePicked", requestId, chosen?.path)
        }
    }

    private fun openScratch(message: JsonObject) {
        val directory = stateDir ?: return
        val name = (message.string("name") ?: "scratch.txt")
            .replace(Regex("[^A-Za-z0-9_.-]"), "_")
            .ifBlank { "scratch.txt" }
        val content = message.string("content") ?: ""
        val file = directory.resolve("scratch").resolve(name)
        Files.createDirectories(file.parent)
        Files.writeString(file, content)
        reply("scratchOpened", message.int("requestId"), file.toString())
        openPath(file.toString(), 1)
    }

    private fun reply(command: String, requestId: Int?, path: String?) {
        val message = mutableMapOf<String, Any?>("command" to command)
        if (requestId != null) message["requestId"] = requestId
        if (path != null) message["path"] = path
        sendCommand(message)
    }

    private fun sendPreferences() {
        sendCommand(
            mapOf(
                "command" to "setPreferences",
                "settings" to mapOf(
                    "followEditor" to settings.state.followEditor,
                    "autoRefresh" to settings.state.autoRefresh,
                ),
            ),
        )
    }

    private fun sendTheme() {
        sendCommand(mapOf("command" to "setTheme", "theme" to currentTheme()))
    }

    private fun currentTheme(): String {
        val name = LafManager.getInstance().currentUIThemeLookAndFeel?.name?.lowercase().orEmpty()
        if (name.contains("high contrast")) return "high-contrast"
        return if (JBColor.isBright()) "light" else "dark"
    }

    private fun subscribeToFileChanges() {
        projectConnection = project.messageBus.connect(this)
        projectConnection?.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: MutableList<out VFileEvent>) {
                if (!settings.state.autoRefresh) return
                val paths = events.mapNotNull { it.file?.path }
                    .filter(::isRelevantPath)
                    .distinct()
                    .take(300)
                if (paths.isEmpty()) return
                synchronized(pendingPaths) {
                    pendingPaths.addAll(paths)
                }
                changeAlarm.cancelAllRequests()
                changeAlarm.addRequest({
                    val batch = synchronized(pendingPaths) {
                        pendingPaths.toList().also { pendingPaths.clear() }
                    }
                    if (batch.isNotEmpty()) {
                        sendCommand(mapOf("command" to "filesChanged", "paths" to batch))
                    }
                }, 450)
            }
        })
    }

    private fun subscribeToEditorSelection() {
        projectConnection?.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) {
                    if (!settings.state.followEditor) return
                    if (System.currentTimeMillis() < suppressFollowUntil) return
                    val toolWindow = ToolWindowManager.getInstance(project)
                        .getToolWindow("SS14 Studio") ?: return
                    if (!toolWindow.isVisible) return
                    val file = event.newFile ?: return
                    if (!isStudioFile(file)) return
                    val editor = FileEditorManager.getInstance(project).getSelectedTextEditor() ?: return
                    if (editor.virtualFile != file) return
                    val line = editor.document.getLineNumber(editor.caretModel.offset) + 1
                    followInStudio(file.path, line)
                }
            },
        )
    }

    private fun subscribeToThemeChanges() {        applicationConnection = ApplicationManager.getApplication().messageBus.connect(this)
        applicationConnection?.subscribe(
            LafManagerListener.TOPIC,
            object : LafManagerListener {
                override fun lookAndFeelChanged(source: LafManager) {
                    sendTheme()
                }
            },
        )
    }

    private fun isRelevantPath(path: String): Boolean {
        val normalized = path.replace('\\', '/')
        val lower = normalized.lowercase()
        if (!lower.contains("/resources/") && !lower.contains("/content.")) return false
        if (lower.contains("/.idea/") || lower.contains("/node_modules/")) return false
        if (lower.contains("/library/") || lower.contains("/temp/") || lower.contains("/obj/")) return false
        return lower.endsWith(".yml") ||
            lower.endsWith(".yaml") ||
            lower.endsWith(".xaml") ||
            lower.endsWith(".cs") ||
            lower.endsWith(".json") ||
            lower.endsWith(".png")
    }

    private fun activateToolWindow() {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("SS14 Studio") ?: return
        toolWindow.activate(null, true)
    }

    private fun notify(level: String, message: String) {
        if (message.isBlank()) return
        val type = when (level) {
            "error" -> NotificationType.ERROR
            "warn", "warning" -> NotificationType.WARNING
            else -> NotificationType.INFORMATION
        }
        NotificationGroupManager.getInstance()
            .getNotificationGroup("SS14 Studio")
            .createNotification(message, type)
            .notify(project)
    }

    private fun extractResources(target: Path, version: String) {
        val marker = target.resolve(".complete")
        if (Files.isRegularFile(marker) && Files.readString(marker).trim() == version) return
        Files.createDirectories(target)
        val listing = javaClass.getResourceAsStream("/web-files.txt")
            ?: throw IllegalStateException("The plugin does not contain web-files.txt.")
        val files = listing.bufferedReader(Charsets.UTF_8).useLines { lines ->
            lines.filter { it.isNotBlank() }.toList()
        }
        for (relative in files) {
            val input = javaClass.getResourceAsStream("/$relative") ?: continue
            val output = target.resolve(relative)
            Files.createDirectories(output.parent)
            input.use { Files.copy(it, output, StandardCopyOption.REPLACE_EXISTING) }
        }
        Files.writeString(marker, version)
    }

    private fun resolveNode(): String? {
        val configured = settings.state.nodePath.trim()
        if (configured.isNotEmpty() && File(configured).canExecute()) return configured
        val executableNames = if (SystemInfo.isWindows) listOf("node.exe", "node") else listOf("node")
        val searchPath = System.getenv("PATH").orEmpty()
        for (directory in searchPath.split(File.pathSeparatorChar)) {
            if (directory.isBlank()) continue
            for (name in executableNames) {
                val candidate = File(directory, name)
                if (candidate.isFile && candidate.canExecute()) return candidate.absolutePath
            }
        }
        val common = buildList {
            if (SystemInfo.isWindows) {
                add("C:\\Program Files\\nodejs\\node.exe")
                System.getenv("LOCALAPPDATA")?.let { add("$it\\Programs\\nodejs\\node.exe") }
                System.getenv("ProgramFiles")?.let { add("$it\\nodejs\\node.exe") }
            } else {
                add("/usr/local/bin/node")
                add("/opt/homebrew/bin/node")
                add("/usr/bin/node")
            }
        }
        return common.firstOrNull { File(it).canExecute() }
    }

    private fun pluginVersion(): String {
        val plugin = com.intellij.ide.plugins.PluginManagerCore.getPlugin(
            com.intellij.openapi.extensions.PluginId.getId("dev.ss14studio.rider"),
        )
        return plugin?.version ?: "0.2.0"
    }

    private fun stateKey(basePath: String): String {
        val name = File(basePath).name
            .replace(Regex("[^A-Za-z0-9_.-]"), "_")
            .take(40)
            .ifBlank { "project" }
        return "$name-${Integer.toHexString(basePath.hashCode())}"
    }

    override fun dispose() {
        disposed = true
        changeAlarm.cancelAllRequests()
        projectConnection?.disconnect()
        applicationConnection?.disconnect()
        sidecar?.dispose()
        sidecar = null
        readyListeners.clear()
        statusListeners.clear()
    }
}
