package com.videodyne

import android.app.Application

/**
 * The phone app's view model: everything the shared [AppVm] does, except that opening the app does
 * not tune (and therefore does not start an encoder on the server) until a channel is tapped.
 */
class PhoneAppVm(app: Application) : AppVm(app) {
    override val autoTuneOnLaunch = false
}
