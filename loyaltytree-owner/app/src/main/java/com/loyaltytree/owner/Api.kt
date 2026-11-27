package com.loyaltytree.owner

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object API {
    private const val ROOT = "https://api.theloyaltytree.com"

    fun get(path: String, token: String): Pair<Int, Any> = send(path, "GET", token, null)
    fun post(path: String, token: String?, json: JSONObject): Pair<Int, Any> = send(path, "POST", token, json)
    fun put(path: String, token: String, json: JSONObject): Pair<Int, Any> = send(path, "PUT", token, json)
    fun patch(path: String, token: String, json: JSONObject): Pair<Int, Any> = send(path, "PATCH", token, json)
    fun delete(path: String, token: String): Pair<Int, Any> = send(path, "DELETE", token, null)

    fun message(body: Any, fallback: String): String {
        val json = body as? JSONObject ?: return fallback
        val detail = json.opt("detail")
        if (detail is String && detail.isNotBlank()) return detail
        if (detail is JSONArray && detail.length() > 0) {
            val first = detail.optJSONObject(0)
            val msg = first?.optString("msg").orEmpty()
            if (msg.isNotBlank()) return msg
        }
        return fallback
    }

    fun plain(value: Any?): String? {
        if (value == null || value == JSONObject.NULL) return null
        if (value is Int) return value.toString()
        if (value is Long) return value.toString()
        if (value is Double) {
            return if (value % 1.0 == 0.0) value.toInt().toString() else String.format("%.1f", value)
        }
        if (value is String && value.isNotEmpty()) return value
        return null
    }

    private fun send(path: String, method: String, token: String?, json: JSONObject?): Pair<Int, Any> {
        val connection = (URL(ROOT + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 25000
            readTimeout = 25000
            setRequestProperty("Accept", "application/json")
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
            if (json != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        if (json != null) connection.outputStream.use { it.write(json.toString().toByteArray()) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        if (text.isBlank()) return code to JSONObject()
        return try {
            code to when {
                text.trim().startsWith("[") -> JSONArray(text)
                else -> JSONObject(text)
            }
        } catch (_: Exception) {
            code to JSONObject()
        }
    }
}
