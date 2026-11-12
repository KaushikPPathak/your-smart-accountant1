package com.smartaccountant.sharetext

import androidx.core.content.FileProvider

/** Own provider class so it does not collide with the app's generated FileProvider in the manifest. */
class ShareFileProvider : FileProvider()
