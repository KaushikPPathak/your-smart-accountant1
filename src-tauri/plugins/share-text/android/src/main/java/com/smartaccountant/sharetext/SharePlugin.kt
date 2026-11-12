package com.smartaccountant.sharetext

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ShareTextArgs {
    var text: String? = null
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {

    /** Opens WhatsApp with the text; falls back to the system share sheet if WhatsApp is missing. */
    @Command
    fun shareText(invoke: Invoke) {
        val args = invoke.parseArgs(ShareTextArgs::class.java)
        val text = args.text ?: ""

        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }

        try {
            val whatsapp = Intent(send).setPackage("com.whatsapp")
            activity.startActivity(whatsapp)
        } catch (e: ActivityNotFoundException) {
            try {
                activity.startActivity(Intent.createChooser(send, "Share ledger"))
            } catch (e2: ActivityNotFoundException) {
                invoke.reject("No app can receive the message on this phone.")
                return
            }
        }
        invoke.resolve()
    }
}
