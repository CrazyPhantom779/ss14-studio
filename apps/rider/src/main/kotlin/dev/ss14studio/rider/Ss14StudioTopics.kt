package dev.ss14studio.rider

import com.google.gson.JsonObject
import com.intellij.openapi.util.Key
import com.intellij.util.messages.Topic

interface Ss14StudioStatusListener {
    fun statusChanged(status: JsonObject)
}

val SS14_STUDIO_STATUS_TOPIC: Topic<Ss14StudioStatusListener> =
    Topic.create("SS14 Studio status", Ss14StudioStatusListener::class.java)

/** Prevents the follow-editor listener from reacting to Studio-driven navigation. */
internal val SS14_STUDIO_NAVIGATION: Key<Long> = Key.create("ss14studio.navigation")
