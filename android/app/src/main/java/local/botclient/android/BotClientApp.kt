package local.botclient.android

import android.app.Application
import android.webkit.WebView
import java.lang.ref.WeakReference

class BotClientApp : Application() {
    companion object {
        var discordWebView: WeakReference<WebView>? = null
        var editorActivity: WeakReference<MessageEditorActivity>? = null
    }
}
