package com.loyaltytree.owner

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * When an order was placed, in Philippine time: "7:10 AM · 5 min ago" for today,
 * "Nov 20, 7:10 AM" for older orders. Reads the API's created_at
 * (e.g. 2026-11-21T01:10:00.123+00:00; no zone means UTC).
 */
object OrderTime {
    private val manila: TimeZone = TimeZone.getTimeZone("Asia/Manila")
    private val zone = Regex("(Z|[+-]\\d{2}:?\\d{2})$")

    fun parse(raw: String): Long? {
        val text = raw.trim().replace(' ', 'T')
        if (text.length < 19) return null
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val base = runCatching { format.parse(text.take(19))?.time }.getOrNull() ?: return null
        val suffix = zone.find(text.substring(19))?.value ?: "Z"
        if (suffix == "Z") return base
        val sign = if (suffix.startsWith("-")) -1 else 1
        val digits = suffix.drop(1).replace(":", "")
        val minutes = (digits.take(2).toIntOrNull() ?: 0) * 60 + (digits.drop(2).toIntOrNull() ?: 0)
        return base - sign * minutes * 60_000L
    }

    private fun format(pattern: String, at: Long): String =
        SimpleDateFormat(pattern, Locale.US).apply { timeZone = manila }.format(java.util.Date(at))

    fun ago(at: Long, now: Long): String {
        val mins = ((now - at) / 60_000L).coerceAtLeast(0)
        return when {
            mins < 1 -> "just now"
            mins < 60 -> "$mins min ago"
            mins < 24 * 60 -> "${mins / 60} hr ago"
            else -> ""
        }
    }

    /** "7:10 AM · 5 min ago" today, "Nov 20, 7:10 AM" on other days, "" if unknown. */
    fun label(raw: String, now: Long = System.currentTimeMillis()): String {
        val at = parse(raw) ?: return ""
        val today = format("yyyyMMdd", at) == format("yyyyMMdd", now)
        if (!today) return format("MMM d, h:mm a", at)
        return listOf(format("h:mm a", at), ago(at, now)).filter { it.isNotBlank() }.joinToString(" · ")
    }
}
