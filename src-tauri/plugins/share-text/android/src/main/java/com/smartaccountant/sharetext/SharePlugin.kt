package com.smartaccountant.sharetext

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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

@InvokeArg
class ShareFilesArgs {
    var title: String? = null
    var filePaths: Array<String>? = null
    var fileNames: Array<String>? = null
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

    /**
     * Shares one or more files through the system share sheet (Drive, Files,
     * email, WhatsApp, ...). Used for backups, which are not WhatsApp messages.
     */
    @Command
    fun shareFiles(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFilesArgs::class.java)
        val paths = args.filePaths ?: emptyArray()
        val names = args.fileNames ?: emptyArray()
        if (paths.isEmpty() || paths.size != names.size) {
            invoke.reject("Nothing to share.")
            return
        }
        val dir = File(activity.cacheDir, "share").apply { mkdirs() }
        val uris = ArrayList<Uri>()
        for (i in paths.indices) {
            val source = File(paths[i])
            if (!source.exists()) {
                invoke.reject("A backup file was not found on this phone.")
                return
            }
            val safeName = names[i].replace(Regex("[^A-Za-z0-9._ -]"), "_")
            val target = File(dir, safeName)
            source.copyTo(target, overwrite = true)
            uris.add(FileProvider.getUriForFile(activity, "${activity.packageName}.sharetext.fileprovider", target))
        }
        val send = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).apply {
                type = mimeFor(names[0])
                putExtra(Intent.EXTRA_STREAM, uris[0])
            }
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "*/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
        }
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            activity.startActivity(Intent.createChooser(send, args.title ?: "Share backup"))
        } catch (e: ActivityNotFoundException) {
            invoke.reject("No app can receive the backup on this phone.")
            return
        }
        invoke.resolve()
    }

    private fun mimeFor(name: String): String = when {
        name.endsWith(".json", ignoreCase = true) -> "application/json"
        name.endsWith(".xlsx", ignoreCase = true) -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else -> "application/octet-stream"
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
