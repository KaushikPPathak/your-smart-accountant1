package com.smartaccountant.sharetext

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareTextArgs {
    var text: String? = null
}

@InvokeArg
class ShareFileArgs {
    var text: String? = null
    var filePath: String? = null
    var fileName: String? = null
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {

    /** Opens WhatsApp with the text; falls back to the system share sheet if WhatsApp is missing. */
    @Command
    fun shareText(invoke: Invoke) {
        val args = invoke.parseArgs(ShareTextArgs::class.java)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, args.text ?: "")
        }
        launch(send, invoke)
    }

    /** Opens WhatsApp with the text and a PDF attached; falls back to the share sheet. */
    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileArgs::class.java)
        val source = File(args.filePath ?: "")
        if (!source.exists()) {
            invoke.reject("The statement PDF was not found on this phone.")
            return
        }

        // Copy into the app's cache folder, which the FileProvider exposes (see share_paths.xml).
        val dir = File(activity.cacheDir, "share").apply { mkdirs() }
        val safeName = (args.fileName ?: "statement.pdf").replace(Regex("[^A-Za-z0-9._ -]"), "_")
        val target = File(dir, safeName)
        source.copyTo(target, overwrite = true)

        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.sharetext.fileprovider", target)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, args.text ?: "")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        launch(send, invoke)
    }

    private fun launch(send: Intent, invoke: Invoke) {
        try {
            activity.startActivity(Intent(send).setPackage("com.whatsapp"))
        } catch (e: ActivityNotFoundException) {
            try {
                activity.startActivity(Intent.createChooser(send, "Share statement"))
            } catch (e2: ActivityNotFoundException) {
                invoke.reject("No app can receive the message on this phone.")
                return
            }
        }
        invoke.resolve()
    }
}
