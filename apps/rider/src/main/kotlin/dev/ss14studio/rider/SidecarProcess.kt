package dev.ss14studio.rider

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.execution.configurations.GeneralCommandLine
import java.io.BufferedWriter
import java.io.IOException
import java.io.OutputStreamWriter
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owns the Node sidecar process and its JSON-lines protocol.
 *
 * stdout carries `ready`, `status`, `ide` and response messages. stdin carries
 * commands from the IDE. stderr is diagnostic logging only.
 */
class SidecarProcess(
    private val commandLine: GeneralCommandLine,
    private val onReady: (JsonObject) -> Unit,
    private val onStatus: (JsonObject) -> Unit,
    private val onIde: (JsonObject) -> Unit,
    private val onExit: (Int) -> Unit,
) : Disposable {
    private val logger = Logger.getInstance(SidecarProcess::class.java)
    private val stopped = AtomicBoolean(false)
    private val pending = ArrayDeque<String>()
    private var process: Process? = null
    private var writer: BufferedWriter? = null

    fun start() {
        val started = commandLine.createProcess()
        process = started
        synchronized(this) {
            writer = BufferedWriter(OutputStreamWriter(started.outputStream, Charsets.UTF_8))
            while (pending.isNotEmpty()) {
                writeLine(pending.removeFirst())
            }
        }
        AppExecutorUtil.getAppExecutorService().execute { readStdout(started) }
        AppExecutorUtil.getAppExecutorService().execute { readStderr(started) }
        AppExecutorUtil.getAppExecutorService().execute {
            val code = try {
                started.waitFor()
            } catch (_: InterruptedException) {
                -1
            }
            if (!stopped.get()) onExit(code)
        }
    }

    fun send(message: Map<String, Any?>) {
        val line = studioGson.toJson(message)
        synchronized(this) {
            if (writer == null) {
                pending.addLast(line)
                return
            }
            writeLine(line)
        }
    }

    private fun writeLine(line: String) {
        val target = writer ?: return
        try {
            target.write(line)
            target.newLine()
            target.flush()
        } catch (error: IOException) {
            logger.warn("Could not send a command to the SS14 Studio sidecar.", error)
        }
    }

    private fun readStdout(started: Process) {
        try {
            started.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { line ->
                    if (line.isBlank()) return@forEach
                    val message = parseJsonObject(line) ?: return@forEach
                    when (message.string("type")) {
                        "ready" -> onReady(message)
                        "status" -> onStatus(message)
                        "ide" -> onIde(message)
                        else -> logger.debug("Sidecar message: $line")
                    }
                }
            }
        } catch (error: IOException) {
            if (!stopped.get()) {
                logger.warn("Lost the SS14 Studio sidecar output stream.", error)
            }
        }
    }

    private fun readStderr(started: Process) {
        try {
            started.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { line ->
                    if (line.isNotBlank()) logger.info("[sidecar] $line")
                }
            }
        } catch (_: IOException) {
            // The process is gone; the exit handler reports it.
        }
    }

    override fun dispose() {
        if (!stopped.compareAndSet(false, true)) return
        synchronized(this) {
            try {
                writer?.write("{\"command\":\"shutdown\"}")
                writer?.newLine()
                writer?.flush()
            } catch (_: IOException) {
                // Fall through to destroy.
            }
            writer = null
        }
        val running = process
        process = null
        if (running != null) {
            AppExecutorUtil.getAppExecutorService().execute {
                try {
                    if (!running.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                        running.destroy()
                        if (!running.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                            running.destroyForcibly()
                        }
                    }
                } catch (_: InterruptedException) {
                    running.destroyForcibly()
                    Thread.currentThread().interrupt()
                }
            }
        }
    }
}
