package com.smartaccountant.securekey

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class KeyArgs {
    var companyId: String? = null
    var keyBase64: String? = null
}

@InvokeArg
class IdArgs {
    var companyId: String? = null
}

/**
 * Each company key is encrypted with an AES key that lives in the Android
 * Keystore (hardware-backed where available). Only the ciphertext is kept in
 * app-private preferences, so the key cannot be read off the phone's storage.
 */
@TauriPlugin
class SecureKeyPlugin(private val activity: Activity) : Plugin(activity) {

    private val prefs by lazy { activity.getSharedPreferences("secure_keys", Context.MODE_PRIVATE) }

    private fun keystore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun alias(companyId: String) = "smartaccountant.companykey.$companyId"

    private fun wrappingKey(companyId: String): SecretKey {
        val ks = keystore()
        val a = alias(companyId)
        if (!ks.containsAlias(a)) {
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            gen.init(
                KeyGenParameterSpec.Builder(a, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            gen.generateKey()
        }
        return ks.getKey(a, null) as SecretKey
    }

    @Command
    fun setKey(invoke: Invoke) {
        val args = invoke.parseArgs(KeyArgs::class.java)
        val id = args.companyId
        val keyB64 = args.keyBase64
        if (id == null || keyB64 == null) {
            invoke.reject("Missing company id or key")
            return
        }
        try {
            val raw = Base64.decode(keyB64, Base64.NO_WRAP)
            if (raw.size != 32) {
                invoke.reject("Company key must be 256 bits")
                return
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(id))
            val iv = cipher.iv
            val ct = cipher.doFinal(raw)
            prefs.edit()
                .putString(id, Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP))
                .apply()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("Could not store the key: ${e.message}")
        }
    }

    @Command
    fun getKey(invoke: Invoke) {
        val args = invoke.parseArgs(IdArgs::class.java)
        val id = args.companyId
        if (id == null) {
            invoke.reject("Missing company id")
            return
        }
        val stored = prefs.getString(id, null)
        if (stored == null) {
            val none = JSObject()
            none.put("value", JSONObject.NULL)
            invoke.resolve(none)
            return
        }
        try {
            val parts = stored.split(":")
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey(id), GCMParameterSpec(128, iv))
            val raw = cipher.doFinal(ct)
            invoke.resolve(JSObject().put("value", Base64.encodeToString(raw, Base64.NO_WRAP)))
        } catch (e: Exception) {
            invoke.reject("Could not read the key: ${e.message}")
        }
    }

    @Command
    fun deleteKey(invoke: Invoke) {
        val args = invoke.parseArgs(IdArgs::class.java)
        val id = args.companyId
        if (id == null) {
            invoke.reject("Missing company id")
            return
        }
        try {
            prefs.edit().remove(id).apply()
            val ks = keystore()
            if (ks.containsAlias(alias(id))) ks.deleteEntry(alias(id))
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("Could not delete the key: ${e.message}")
        }
    }
}
