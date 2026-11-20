package com.loyaltytree.owner

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * New-order ringtone + notification ("New order #123 · BGC branch").
 *
 * The sound is res/raw/lt_new_order.ogg (copied in by the owner-v5 apply script).
 * It is looked up by name, so the app still builds without it and falls back to
 * the phone's default notification sound plus an in-app chime.
 * A channel's sound can't change after it is created, so a new sound needs a new id.
 */
object OrderAlerts {
    const val CHANNEL_ID = "lt_new_orders_v1"
    const val EXTRA_OPEN = "lt_open"
    const val OPEN_ORDERS = "orders"
    private const val SUMMARY_ID = 7_000_001

    private fun rawSound(context: Context): Int =
        context.resources.getIdentifier("lt_new_order", "raw", context.packageName)

    private fun soundUri(context: Context): Uri? {
        val id = rawSound(context)
        return if (id == 0) null else Uri.parse("android.resource://${context.packageName}/$id")
    }

    fun permissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun canNotify(context: Context): Boolean =
        permissionGranted(context) && NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "New orders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Rings when a customer places an order on the digital menu."
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
            enableLights(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            setSound(soundUri(context) ?: android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, attributes)
        }
        manager.createNotificationChannel(channel)
    }

    private fun smallIcon(context: Context): Int {
        val id = context.resources.getIdentifier("ic_lt_order", "drawable", context.packageName)
        return if (id != 0) id else android.R.drawable.ic_popup_reminder
    }

    private fun openOrders(context: Context, request: Int): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.putExtra(EXTRA_OPEN, OPEN_ORDERS)
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(context, request, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun branchText(name: String): String = when {
        name.isBlank() -> "No branch"
        name.endsWith("branch", ignoreCase = true) -> name
        else -> "$name branch"
    }

    private fun number(raw: String): String {
        val clean = raw.trim().removePrefix("#")
        return if (clean.isBlank() || clean.equals("Order", ignoreCase = true)) "" else "#$clean"
    }

    fun itemCount(order: LiveOrder): Int = order.items.sumOf { line ->
        line.name.substringBefore("×").trim().toIntOrNull() ?: 1
    }

    fun title(order: LiveOrder): String =
        listOf("New order ${number(order.number)}".trim(), branchText(order.branch)).joinToString(" · ")

    fun body(order: LiveOrder): String {
        val count = itemCount(order)
        val pay = if (order.paymentMethod == "cash" && order.payment == "unpaid") "Cash, waiting for payment" else ""
        return listOf("$count ${if (count == 1) "item" else "items"}", order.total, order.note, pay)
            .filter { it.isNotBlank() }.joinToString(" · ")
    }

    /** Posts one notification per order (at most 4, then one summary). Returns false when it could only chime. */
    @android.annotation.SuppressLint("MissingPermission")
    fun announce(context: Context, fresh: List<LiveOrder>): Boolean {
        if (fresh.isEmpty()) return true
        if (!canNotify(context)) {
            chime(context)
            return false
        }
        ensureChannel(context)
        val manager = NotificationManagerCompat.from(context)
        val shown = fresh.take(4)
        try {
            shown.forEachIndexed { index, order ->
                val lines = order.items.joinToString("\n") { it.name }
                val note = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(smallIcon(context))
                    .setContentTitle(title(order))
                    .setContentText(body(order))
                    .setStyle(NotificationCompat.BigTextStyle().bigText(listOf(body(order), lines).filter { it.isNotBlank() }.joinToString("\n")))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(false)
                    .setSilent(index > 0) // ring once per batch
                    .setContentIntent(openOrders(context, order.id.hashCode()))
                soundUri(context)?.let { note.setSound(it) } // Android 7 and older use this instead of the channel
                manager.notify(order.id.hashCode(), note.build())
            }
            if (fresh.size > shown.size) {
                val extra = fresh.size - shown.size
                val note = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(smallIcon(context))
                    .setContentTitle("$extra more new ${if (extra == 1) "order" else "orders"}")
                    .setContentText("Open Orders to see them all.")
                    .setSilent(true)
                    .setAutoCancel(true)
                    .setContentIntent(openOrders(context, SUMMARY_ID))
                manager.notify(SUMMARY_ID, note.build())
            }
        } catch (_: SecurityException) {
            chime(context)
            return false
        }
        return true
    }

    fun test(context: Context, branchName: String) {
        val sample = LiveOrder(
            id = "lt-test-${System.currentTimeMillis()}", number = "TEST", status = "new", customer = "Test",
            branch = branchName, pickup = "", total = "₱0", note = "This is how new orders will sound", payment = "paid",
            items = listOf(OrderLine("1 × Test item", ""))
        )
        announce(context, listOf(sample))
    }

    /** In-app chime when notifications are off. Uses the LoyaltyTree tone, or three quick beeps. */
    fun chime(context: Context) {
        val raw = rawSound(context)
        if (raw != 0) {
            val player = runCatching { MediaPlayer.create(context, raw) }.getOrNull()
            if (player != null) {
                player.setOnCompletionListener { it.release() }
                runCatching { player.start() }.onFailure { player.release() }
                return
            }
        }
        val tone = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90) }.getOrNull() ?: return
        val handler = Handler(Looper.getMainLooper())
        listOf(0L, 260L, 520L).forEach { at ->
            handler.postDelayed({ runCatching { tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 180) } }, at)
        }
        handler.postDelayed({ tone.release() }, 1100L)
    }
}
