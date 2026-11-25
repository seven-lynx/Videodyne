package com.videodyne

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import com.videodyne.ui.PhoneRoot

/**
 * The phone app. There is deliberately no `dispatchKeyEvent` here: this app is driven by touch, and
 * the only key it cares about is Back, which Compose handles inside the UI (leave the player, close
 * a sheet, otherwise let the system close the app).
 */
class MainActivity : ComponentActivity() {
    private val vm: PhoneAppVm by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContent { PhoneRoot(vm) }
    }

    override fun onStart() { super.onStart(); vm.onForeground() }
    override fun onStop() { vm.onBackground(); super.onStop() }
}