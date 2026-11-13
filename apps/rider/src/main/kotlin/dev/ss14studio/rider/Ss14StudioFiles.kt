package dev.ss14studio.rider

import com.intellij.openapi.vfs.VirtualFile

fun isStudioFile(file: VirtualFile): Boolean {
    if (file.isDirectory) return false
    val name = file.name.lowercase()
    val path = file.path.replace('\\', '/').lowercase()
    if (name.endsWith(".yml") || name.endsWith(".yaml")) return true
    if (name.endsWith(".xaml") || name.endsWith(".xaml.cs")) return true
    if (path.contains(".rsi/") || path.endsWith(".rsi")) return true
    return name == "meta.json" && path.contains(".rsi/")
}
