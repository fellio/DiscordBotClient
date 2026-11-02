package local.botclient.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.lang.ref.WeakReference

class MessageEditorActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var closing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            BotClientApp.editorActivity = WeakReference(this)
        }
        buildUi()
        configureWebView()
        installDocumentScripts()
        installMessageListener()
        webView.loadUrl(EDITOR_URL)
    }

    override fun onDestroy() {
        if (BotClientApp.editorActivity?.get() === this) {
            BotClientApp.editorActivity = null
        }
        try {
            WebViewCompat.removeWebMessageListener(webView, NATIVE_CHANNEL)
        } catch (_: Exception) {
            // listener may already be detached
        }
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        dismiss()
    }

    fun deliverInit(payload: JSONObject) {
        val json = payload.toString()
        webView.post {
            webView.evaluateJavascript(
                "window.__bcEditorInit ? window.__bcEditorInit(JSON.parse(${JSONObject.quote(json)})) : 0",
                null,
            )
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }

        val bar = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#1E1F22"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56))
        }
        val close = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 20f
            gravity = Gravity.CENTER
            contentDescription = getString(R.string.close)
            layoutParams = FrameLayout.LayoutParams(dp(56), ViewGroup.LayoutParams.MATCH_PARENT)
            setOnClickListener { dismiss() }
        }
        val title = TextView(this).apply {
            text = getString(R.string.editor_title)
            setTextColor(Color.WHITE)
            textSize = 17f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        bar.addView(title)
        bar.addView(close)
        root.addView(bar)

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        root.addView(webView)
        setContentView(root)
    }

    private fun configureWebView() {
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            userAgentString = EDITOR_USER_AGENT
        }
        webView.webViewClient = EditorWebViewClient()
        webView.webChromeClient = EditorChromeClient()
    }

    private fun installDocumentScripts() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.e(TAG, "document start scripts are not supported")
            return
        }
        val shim = readAsset("android-shim.js")
        val frame = readAsset("editor-frame.js")
        if (shim.isNullOrEmpty() || frame.isNullOrEmpty()) {
            Log.e(TAG, "editor scripts are missing from assets")
            return
        }
        addDocumentStart(shim)
        addDocumentStart(frame)
    }

    private fun addDocumentStart(source: String) {
        try {
            WebViewCompat.addDocumentStartJavaScript(webView, source, setOf(ASSET_ORIGIN))
        } catch (exception: Exception) {
            Log.e(TAG, "document start script failed: ${exception.javaClass.simpleName}")
        }
    }

    private fun installMessageListener() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.e(TAG, "web message listeners are not supported")
            return
        }
        WebViewCompat.addWebMessageListener(
            webView,
            NATIVE_CHANNEL,
            setOf(ASSET_ORIGIN),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy,
                ) {
                    val raw = message.data ?: return
                    val envelope = try {
                        JSONObject(raw)
                    } catch (_: Exception) {
                        return
                    }
                    if (envelope.optString("kind") != "editor") return
                    handleEditorEvent(envelope.optJSONObject("payload"))
                }
            },
        )
    }

    private fun handleEditorEvent(event: JSONObject?) {
        if (event == null) return
        when (event.optString("type")) {
            "ready" -> {
                Log.d(TAG, "editor ready")
                sendToDiscord(JSONObject().put("type", "ready"))
            }
            "submit" -> {
                val data = event.optJSONObject("payload")
                Log.d(TAG, "editor submit files=${data?.optJSONArray("files")?.length() ?: 0}")
                sendToDiscord(JSONObject().put("type", "submit").put("data", data ?: JSONObject()))
                webView.postDelayed({ dismiss() }, 400)
            }
            "close" -> {
                Log.d(TAG, "editor close requested")
                webView.postDelayed({ dismiss() }, 600)
            }
        }
    }

    private fun sendToDiscord(payload: JSONObject) {
        val discord = BotClientApp.discordWebView?.get() ?: return
        val json = payload.toString()
        discord.post {
            discord.evaluateJavascript(
                "window.__bcEditorEvent ? window.__bcEditorEvent(JSON.parse(${JSONObject.quote(json)})) : 0",
                null,
            )
        }
    }

    private fun dismiss() {
        if (closing) return
        closing = true
        sendToDiscord(JSONObject().put("type", "closed"))
        webView.postDelayed({
            if (!isFinishing) finish()
        }, 150)
    }

    private fun readAsset(name: String): String? = try {
        assets.open(name).bufferedReader().use { it.readText() }
    } catch (exception: Exception) {
        Log.e(TAG, "asset $name unavailable: ${exception.javaClass.simpleName}")
        null
    }

    private fun presentLoadError(message: String) {
        if (isFinishing) return
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.editor_title))
            .setMessage(message)
            .setPositiveButton(getString(R.string.close)) { _, _ -> dismiss() }
            .show()
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            // no handler for this scheme
        }
    }

    private inner class EditorWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            return assetLoader.shouldInterceptRequest(request.url)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme?.lowercase()
            if (scheme == "https" && uri.host == ASSET_HOST) return false
            if (scheme == "about" || scheme == "data" || scheme == "blob") return false
            openExternal(uri)
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            Log.d(TAG, "editor loaded: ${url ?: "unknown"}")
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            Log.e(TAG, "editor navigation failed: ${error.description}")
            presentLoadError(error.description?.toString().orEmpty())
        }

        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "editor web process terminated")
            presentLoadError("エディタのプロセスが終了しました")
            return true
        }
    }

    private inner class EditorChromeClient : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            Log.d(TAG, "editor console: ${message.message().take(400)}")
            return true
        }

        override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
            return showDialog(message, result, confirmLabel = "OK", dismissLabel = null)
        }

        override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
            return showDialog(message, result, confirmLabel = "OK", dismissLabel = getString(R.string.close))
        }
    }

    private fun showDialog(message: String?, result: JsResult?, confirmLabel: String, dismissLabel: String?): Boolean {
        if (message == null || result == null) return false
        val builder = AlertDialog.Builder(this)
            .setTitle(getString(R.string.editor_title))
            .setMessage(message)
            .setPositiveButton(confirmLabel) { _, _ -> result.confirm() }
            .setOnCancelListener { result.cancel() }
        if (dismissLabel != null) {
            builder.setNegativeButton(dismissLabel) { _, _ -> result.cancel() }
        }
        builder.show()
        return true
    }

    companion object {
        private const val TAG = "BotClientEditor"
        private const val NATIVE_CHANNEL = "BCNative"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val ASSET_ORIGIN = "https://$ASSET_HOST"
        private const val EDITOR_URL = "$ASSET_ORIGIN/index.html"
        private const val EDITOR_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/140.0.0.0 Safari/537.36"
    }
}
