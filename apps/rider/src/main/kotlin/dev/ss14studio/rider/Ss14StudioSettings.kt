package dev.ss14studio.rider

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "Ss14StudioSettings", storages = [Storage("ss14-studio.xml")])
@Service(Service.Level.APP)
class Ss14StudioSettings : PersistentStateComponent<Ss14StudioSettings.State> {
    data class State(
        var nodePath: String = "",
        var followEditor: Boolean = true,
        var autoRefresh: Boolean = true,
        var startSidecarOnProjectOpen: Boolean = true,
    )

    private var myState = State()

    override fun getState(): State = myState

    override fun loadState(state: State) {
        myState = state
    }

    companion object {
        fun getInstance(): Ss14StudioSettings =
            ApplicationManager.getApplication().getService(Ss14StudioSettings::class.java)
    }
}
