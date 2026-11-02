package local.botclient.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.lang.ref.WeakReference

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorPanel: LinearLayout
    private lateinit var errorText: TextView

    private var pageFailed = false
    private var didAttemptDebugLogin = false
    private var debugToken: String? = null
    private var uiTestTarget: String? = null
    private var uiTestMessage = "BotClient Android UI test"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
            debugToken = intent.getStringExtra("bc_bot_token")
            uiTestTarget = intent.getStringExtra("bc_ui_test")
            uiTestMessage = intent.getStringExtra("bc_ui_test_message") ?: uiTestMessage
        }

        buildUi()
        configureWebView()
        installDocumentScripts()
        installMessageListener()

        BotClientApp.discordWebView = WeakReference(webView)
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        webView.loadUrl(DISCORD_URL)
    }

    override fun onDestroy() {
        if (BotClientApp.discordWebView?.get() === webView) {
            BotClientApp.discordWebView = null
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
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        root.addView(webView)

        progress = ProgressBar(this).apply {
            indeterminateTintList = ColorStateList.valueOf(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            )
        }
        root.addView(progress)

        errorPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        val title = TextView(this).apply {
            text = getString(R.string.load_error)
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER
        }
        errorText = TextView(this).apply {
            setTextColor(Color.parseColor("#B5BAC1"))
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(20))
        }
        val retry = Button(this).apply {
            text = getString(R.string.retry)
            setOnClickListener {
                showLoading()
                webView.loadUrl(DISCORD_URL)
            }
        }
        errorPanel.addView(title)
        errorPanel.addView(errorText)
        errorPanel.addView(retry)
        root.addView(errorPanel)

        setContentView(root)
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = MOBILE_USER_AGENT
        }
        webView.webViewClient = DiscordWebViewClient()
        webView.webChromeClient = DiscordChromeClient()
    }

    private fun installDocumentScripts() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.e(TAG, "document start scripts are not supported")
            return
        }
        val shim = readAsset("android-shim.js")
        val bridge = readAsset("bridge.js")
        val css = readAsset("Vencord.css")
        if (bridge.isNullOrEmpty()) {
            Log.e(TAG, "bridge.js is missing from assets")
            return
        }
        val debugFlag = if (BuildConfig.DEBUG) "window.__bcDebugLogs = true;\n" else ""
        val bootstrap = buildString {
            append(debugFlag)
            append("window.__bcPlatformName = \"BotClient Android\";\n")
            append("window.__bcVencordCss = ")
            append(JSONObject.quote(css ?: ""))
            append(";\n")
            append(shim ?: "")
            append('\n')
            append(bridge)
        }
        addDocumentStart(bootstrap)
        installVencord()
        val token = debugToken
        if (BuildConfig.DEBUG && !token.isNullOrEmpty()) {
            addDocumentStart(
                "if (window.top === window) { try { localStorage.setItem('token', JSON.stringify(" +
                    JSONObject.quote(token) + ")); } catch {} }",
            )
        }
        readAsset("uitest.js")?.let(::addDocumentStart)
    }

    private fun installVencord() {
        val source = readAsset("Vencord.js")
        if (source.isNullOrEmpty()) {
            Log.e(TAG, "Vencord.js is missing from assets")
            return
        }
        val base64 = android.util.Base64.encodeToString(source.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
        base64.chunked(CHUNK_SIZE).forEachIndexed { index, chunk ->
            val operator = if (index == 0) "=" else "+="
            addDocumentStart(
                "if (window.top === window) { window.__bcVencordSourceBase64 $operator \"$chunk\"; }",
            )
        }
        addDocumentStart(
            """
            (() => {
              if (window.top !== window) return;
              try {
                const binary = atob(window.__bcVencordSourceBase64 || "");
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
                const source = new TextDecoder().decode(bytes);
                (0, eval)(source + "\n;window.__bcVencordTail = true; window.Vencord = Vencord;");
              } catch (error) {
                window.__bcVencordError = String((error && (error.stack || error.message)) || error);
                console.error("vencord boot failed", error);
              }
              try { delete window.__bcVencordSourceBase64; } catch {}
            })();
            """.trimIndent(),
        )
    }

    private fun addDocumentStart(source: String) {
        try {
            WebViewCompat.addDocumentStartJavaScript(webView, source, DISCORD_ORIGINS)
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
            DISCORD_ORIGINS,
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
                    when (envelope.optString("kind")) {
                        "log" -> Log.d(TAG, "web: ${envelope.optString("payload").take(400)}")
                        "api" -> {
                            val payload = envelope.optJSONObject("payload") ?: return
                            DiscordRestBridge.handle(payload) { reply ->
                                val response = JSONObject()
                                    .put("id", envelope.optString("id"))
                                    .put("payload", reply)
                                webView.post {
                                    try {
                                        replyProxy.postMessage(response.toString())
                                    } catch (_: Exception) {
                                        // page may have navigated away
                                    }
                                }
                            }
                        }
                        "editor" -> handleEditorMessage(envelope.optJSONObject("payload"))
                    }
                }
            },
        )
    }

    private fun handleEditorMessage(payload: JSONObject?) {
        if (payload == null) return
        when (payload.optString("type")) {
            "open" -> openEditor()
            "init" -> {
                val init = payload.optJSONObject("payload") ?: return
                BotClientApp.editorActivity?.get()?.deliverInit(init)
            }
        }
    }

    private fun openEditor() {
        val existing = BotClientApp.editorActivity?.get()
        if (existing != null && !existing.isFinishing) {
            Log.d(TAG, "editor is already open")
            return
        }
        startActivity(Intent(this, MessageEditorActivity::class.java))
    }

    private fun readAsset(name: String): String? = try {
        assets.open(name).bufferedReader().use { it.readText() }
    } catch (exception: Exception) {
        Log.e(TAG, "asset $name unavailable: ${exception.javaClass.simpleName}")
        null
    }

    private fun showLoading() {
        pageFailed = false
        errorPanel.visibility = View.GONE
        progress.visibility = View.VISIBLE
    }

    private fun showError(message: String) {
        progress.visibility = View.GONE
        errorText.text = message
        errorPanel.visibility = View.VISIBLE
    }

    private fun attemptDebugLogin() {
        if (!BuildConfig.DEBUG) return
        val token = debugToken
        if (token.isNullOrEmpty() || didAttemptDebugLogin) return
        didAttemptDebugLogin = true
        webView.postDelayed({
            val literal = JSONObject.quote(token)
            val script = """
                (() => {
                  if (!window.__bcLoginBot || !location.pathname.startsWith("/login")) return 0;
                  Promise.resolve(window.__bcLoginBot($literal)).then(ok => {
                    if (!ok && window.__bcAutoLogin) window.__bcAutoLogin($literal);
                  }).catch(() => {
                    if (window.__bcAutoLogin) window.__bcAutoLogin($literal);
                  });
                  return 1;
                })()
            """.trimIndent()
            webView.evaluateJavascript(script) { result ->
                Log.d(TAG, "auto login: $result")
            }
        }, 1500)
    }

    private fun runUITest() {
        if (!BuildConfig.DEBUG) return
        val target = uiTestTarget ?: return
        val parts = target.split("/", limit = 3)
        if (parts.size < 2) {
            Log.e(TAG, "bc_ui_test must be <guild>/<channel>")
            return
        }
        val script = "window.__bcRunUITest ? window.__bcRunUITest(" +
            "${JSONObject.quote(parts[0])}, ${JSONObject.quote(parts[1])}, ${JSONObject.quote(uiTestMessage)}) : 'missing'"
        webView.evaluateJavascript(script) { result ->
            Log.d(TAG, "ui test: $result")
        }
    }

    private fun logDiagnostics(delayMs: Long) {
        if (!BuildConfig.DEBUG) return
        webView.postDelayed({
            webView.evaluateJavascript("JSON.stringify(window.__bcDiag ? window.__bcDiag() : null)") { result ->
                Log.d(TAG, "diag: $result")
            }
        }, delayMs)
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            // no handler for this scheme
        }
    }

    private fun isDiscord(uri: Uri): Boolean {
        val host = uri.host?.lowercase() ?: return false
        return uri.scheme?.lowercase() == "https" && (host == "discord.com" || host.endsWith(".discord.com"))
    }

    private inner class DiscordWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isDiscord(uri)) return false
            openExternal(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            pageFailed = false
            showLoading()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            progress.visibility = View.GONE
            if (!pageFailed) errorPanel.visibility = View.GONE
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "page loaded: ${url ?: "unknown"}")
                webView.evaluateJavascript("window.__bcDebugState ? window.__bcDebugState() : null") { result ->
                    Log.d(TAG, "debug state: $result")
                }
                logDiagnostics(6_000)
                logDiagnostics(14_000)
                runUITest()
            }
            attemptDebugLogin()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            pageFailed = true
            Log.e(TAG, "navigation failed: ${error.description}")
            showError(error.description?.toString().orEmpty())
        }
    }

    private inner class DiscordChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            if (newProgress < 100) {
                if (!pageFailed) progress.visibility = View.VISIBLE
            } else if (!pageFailed) {
                progress.visibility = View.GONE
            }
        }

        override fun onCreateWindow(
            view: WebView?,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: Message,
        ): Boolean {
            val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
            val popup = WebView(this@MainActivity).apply {
                settings.javaScriptEnabled = true
                settings.userAgentString = MOBILE_USER_AGENT
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(popupView: WebView, request: WebResourceRequest): Boolean {
                        val uri = request.url
                        if (isDiscord(uri)) webView.loadUrl(uri.toString()) else openExternal(uri)
                        popupView.destroy()
                        return true
                    }

                    override fun onPageFinished(popupView: WebView, url: String?) {
                        if (url == null || url == "about:blank") return
                        popupView.destroy()
                    }
                }
            }
            transport.webView = popup
            resultMsg.sendToTarget()
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
            .setTitle("Discord")
            .setMessage(message)
            .setPositiveButton(confirmLabel) { _, _ -> result.confirm() }
            .setOnCancelListener { result.cancel() }
        if (dismissLabel == null) {
            builder.setCancelable(true)
        } else {
            builder.setNegativeButton(dismissLabel) { _, _ -> result.cancel() }
        }
        builder.show()
        return true
    }

    companion object {
        private const val TAG = "BotClientWeb"
        private const val NATIVE_CHANNEL = "BCNative"
        private const val CHUNK_SIZE = 200_000
        private const val DISCORD_URL = "https://discord.com/login"
        private const val MOBILE_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/140.0.0.0 Mobile Safari/537.36"
        private val DISCORD_ORIGINS = setOf("https://discord.com", "https://*.discord.com")
    }
}
