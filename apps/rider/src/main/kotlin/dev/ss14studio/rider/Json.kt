package dev.ss14studio.rider

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser

internal val studioGson = Gson()

internal fun parseJsonObject(text: String): JsonObject? =
    try {
        JsonParser.parseString(text).asJsonObject
    } catch (_: Exception) {
        null
    }

internal fun JsonObject.string(name: String): String? {
    val value = get(name) ?: return null
    return if (value.isJsonNull) null else runCatching { value.asString }.getOrNull()
}

internal fun JsonObject.int(name: String): Int? {
    val value = get(name) ?: return null
    return if (value.isJsonNull) null else runCatching { value.asInt }.getOrNull()
}

internal fun JsonObject.bool(name: String): Boolean? {
    val value = get(name) ?: return null
    return if (value.isJsonNull) null else runCatching { value.asBoolean }.getOrNull()
}

internal fun JsonObject.array(name: String): List<String> {
    val value = get(name) ?: return emptyList()
    if (!value.isJsonArray) return emptyList()
    return value.asJsonArray.mapNotNull { element ->
        if (element.isJsonNull) null else runCatching { element.asString }.getOrNull()
    }
}
