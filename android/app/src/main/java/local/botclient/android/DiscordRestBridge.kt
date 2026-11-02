package local.botclient.android

import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object DiscordRestBridge {
    private const val TAG = "BotClientAPI"
    private const val BOT_USER_AGENT = "DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v2.0.0)"
    private val allowedMethods = setOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
    private val blockedHeaders = setOf(
        "origin", "referer", "cookie", "host", "content-length", "accept-encoding",
        "connection", "keep-alive", "transfer-encoding",
    )
    private val authPattern = Regex("^(bot|bearer)\\s", RegexOption.IGNORE_CASE)
    private val executor = Executors.newFixedThreadPool(4)

    fun handle(payload: JSONObject, callback: (JSONObject) -> Unit) {
        executor.execute {
            callback(runRequest(payload))
        }
    }

    private fun runRequest(payload: JSONObject): JSONObject {
        val urlString = payload.optString("url", "")
        val parsed = try {
            URL(urlString)
        } catch (_: Exception) {
            return error("blocked request")
        }
        val host = parsed.host.lowercase()
        if (parsed.protocol.lowercase() != "https" || (host != "discord.com" && !host.endsWith(".discord.com")) ||
            !parsed.path.startsWith("/api/")
        ) {
            return error("blocked request")
        }

        val method = payload.optString("method", "GET").uppercase()
        if (method !in allowedMethods) return error("blocked method")

        val headerSource = payload.optJSONObject("headers")
        val headers = LinkedHashMap<String, String>()
        if (headerSource != null) {
            for (key in headerSource.keys()) {
                if (key.isEmpty()) continue
                headers[key] = headerSource.opt(key)?.toString() ?: continue
            }
        }
        headers.keys.toList().forEach { key ->
            val lower = key.lowercase()
            if (lower in blockedHeaders || lower.startsWith("sec-")) headers.remove(key)
        }
        val authKey = headers.keys.firstOrNull { it.lowercase() == "authorization" }
        if (authKey != null) {
            val value = headers[authKey]?.trim().orEmpty()
            when {
                value.isEmpty() -> headers.remove(authKey)
                !authPattern.containsMatchIn(value) -> headers[authKey] = "Bot $value"
                else -> headers[authKey] = value
            }
        }
        headers["User-Agent"] = BOT_USER_AGENT

        val body = if (payload.has("body") && !payload.isNull("body")) {
            try {
                Base64.decode(payload.optString("body"), Base64.DEFAULT)
            } catch (_: Exception) {
                return error("invalid body")
            }
        } else {
            null
        }

        var connection: HttpURLConnection? = null
        return try {
            connection = (parsed.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 30_000
                readTimeout = 60_000
                requestMethod = method
                for ((name, value) in headers) setRequestProperty(name, value)
            }
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body) }
            }

            val status = connection.responseCode
            val statusText = connection.responseMessage.orEmpty()
            val bytes = readBody(connection, status)
            val responseHeaders = JSONObject()
            for ((name, values) in connection.headerFields) {
                if (name.isNullOrEmpty()) continue
                if (name.lowercase() == "set-cookie") continue
                responseHeaders.put(name, values?.joinToString(", ").orEmpty())
            }
            Log.d(TAG, "response: $method ${parsed.path} $status")
            JSONObject()
                .put("status", status)
                .put("statusText", statusText)
                .put("headers", responseHeaders)
                .put("body", Base64.encodeToString(bytes, Base64.NO_WRAP))
                .put("url", urlString)
        } catch (exception: Exception) {
            Log.d(TAG, "request failed: $method ${parsed.path} ${exception.javaClass.simpleName}")
            error("network")
        } finally {
            connection?.disconnect()
        }
    }

    private fun readBody(connection: HttpURLConnection, status: Int): ByteArray {
        val stream: InputStream? = if (status >= 400) connection.errorStream else connection.inputStream
        return stream?.use { it.readBytes() } ?: ByteArray(0)
    }

    private fun error(reason: String) = JSONObject().put("error", reason)
}
