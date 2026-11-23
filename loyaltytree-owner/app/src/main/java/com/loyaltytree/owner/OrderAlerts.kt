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
import android.os.PowerManager
import androidx.compose.runtime.mutableStateOf
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * New-order ring + notification ("New order #123 · BGC branch").
 *
 * owner-v9: the app plays res/raw/lt_new_order.ogg itself at ALARM volume
 * (rings even when the phone is on vibrate), for both the push and the
 * 20-second check. The "New orders" channel is silent so it never rings twice;
 * it still pops up and vibrates. Optional "ring until opened": repeats for up to
 * 30 seconds, stops when the app is opened or "Stop ringing" is tapped.
 * The sound is looked up by name, so the app still builds without it (then: beeps).
 * A channel's sound can't change after it is created, so v1 is deleted and v2 is new.
 */
object OrderAlerts {
    const val CHANNEL_ID = "lt_new_orders_v2"
    private val OLD_CHANNELS = listOf("lt_new_orders_v1")
    const val PREF_RING_UNTIL_OPENED = "ringUntilOpened"
    private const val RING_LIMIT_MS = 30_000L
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

    private val seenLock = Any()

    /** Same key for the 20-second poll and the push service, so one order rings only once. */
    fun seenKey(slug: String, role: String, branchId: String) = "seenOrders:$slug:$role:$branchId"

    /**
     * Marks [ids] as seen on this phone and returns the ones that were new.
     * [firstLoadQuiet]: when nothing is stored yet (first load after sign-in), only remember.
     */
    fun claim(context: Context, key: String, ids: List<String>, firstLoadQuiet: Boolean): Set<String> = synchronized(seenLock) {
        val prefs = context.getSharedPreferences("lt", Context.MODE_PRIVATE)
        val stored = prefs.getString(key, null)
        val seen = stored?.split(",")?.filter { it.isNotBlank() }?.toMutableList() ?: mutableListOf()
        val unseen = ids.filter { it.isNotBlank() && it !in seen }.distinct()
        prefs.edit().putString(key, (seen + unseen).takeLast(400).joinToString(",")).apply()
        if (stored == null && firstLoadQuiet) emptySet() else unseen.toSet()
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        OLD_CHANNELS.forEach { old -> runCatching { manager.deleteNotificationChannel(old) } }
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "New orders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Shows new digital menu orders. The LoyaltyTree app plays the ring itself at alarm volume."
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
            enableLights(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(null, null) // the app rings (ring()), so the notification itself stays quiet
        }
        manager.createNotificationChannel(channel)
    }

    /** "high", "low" (no pop-up) or "off" for the New orders channel. Older Android: "high". */
    fun channelState(context: Context): String {
        if (Build.VERSION.SDK_INT < 26) return "high"
        ensureChannel(context)
        val manager = context.getSystemService(NotificationManager::class.java) ?: return "high"
        val channel = manager.getNotificationChannel(CHANNEL_ID) ?: return "off"
        if (Build.VERSION.SDK_INT >= 28) {
            val group = channel.group?.let { manager.getNotificationChannelGroup(it) }
            if (group?.isBlocked == true) return "off"
        }
        return when {
            channel.importance == NotificationManager.IMPORTANCE_NONE -> "off"
            channel.importance < NotificationManager.IMPORTANCE_HIGH -> "low"
            else -> "high"
        }
    }

    fun hasRingtone(context: Context): Boolean = rawSound(context) != 0

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
        ring(context) // once per batch, alarm volume; the notification below is quiet
        if (!canNotify(context)) return false
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
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(false)
                    .setSilent(index > 0) // pop up once per batch
                    .setContentIntent(openOrders(context, order.id.hashCode()))
                manager.notify(order.id.hashCode(), note.build())
            }
            if (fresh.size > shown.size) {
                val extra = fresh.size - shown.size
                val note = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(smallIcon(context))
                    .setContentTitle("$extra more new ${if (extra == 1) "order" else "orders"}")
                    .setContentText("Open Orders to see them all.")
                    .setSilent(true)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setAutoCancel(true)
                    .setContentIntent(openOrders(context, SUMMARY_ID))
                manager.notify(SUMMARY_ID, note.build())
            }
        } catch (_: SecurityException) {
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

    // ----- The ring itself (owner-v9) -----

    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var startedHidden = false

    /** True while the order ring is playing (the app shows "Stop ringing"). */
    val ringing = mutableStateOf(false)

    /** Set by the app screen: true while LoyaltyTree is open on screen. */
    @Volatile
    var appVisible = false
        private set

    private val stopLater = Runnable { stopNow() }

    private val alarmAttributes: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    fun ringUntilOpened(context: Context): Boolean =
        context.getSharedPreferences("lt", Context.MODE_PRIVATE).getBoolean(PREF_RING_UNTIL_OPENED, false)

    /** Plays the LoyaltyTree order tone at alarm volume. Safe from any thread. */
    fun ring(context: Context) {
        val app = context.applicationContext
        main.post { start(app) }
    }

    /** Stops the ring (Stop ringing button, or the app was opened). */
    fun stopRinging() {
        main.post { stopNow() }
    }

    /** Called when the app screen opens or closes. Opening the app stops a ring that started while it was closed. */
    fun onAppVisible(visible: Boolean) {
        appVisible = visible
        if (visible) main.post { if (ringing.value && startedHidden) stopNow() }
    }

    private fun start(context: Context) {
        stopNow()
        val loop = ringUntilOpened(context)
        val uri = soundUri(context)
        if (uri == null) {
            beep()
            return
        }
        val next = MediaPlayer()
        val ok = runCatching {
            next.setAudioAttributes(alarmAttributes)
            next.setDataSource(context, uri)
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.WAKE_LOCK) == PackageManager.PERMISSION_GRANTED) {
                next.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK)
            }
            next.isLooping = loop
            next.setOnCompletionListener { done -> if (player === done) stopNow() }
            next.setOnErrorListener { failed, _, _ -> if (player === failed) stopNow(); true }
            next.prepare()
            next.start()
        }.isSuccess
        if (!ok) {
            runCatching { next.release() }
            beep()
            return
        }
        player = next
        startedHidden = !appVisible
        ringing.value = true
        main.postDelayed(stopLater, if (loop) RING_LIMIT_MS else 6_000L)
    }

    private fun stopNow() {
        main.removeCallbacks(stopLater)
        player?.let { current ->
            runCatching { if (current.isPlaying) current.stop() }
            runCatching { current.release() }
        }
        player = null
        ringing.value = false
    }

    /** Fallback when the tone file is missing or can't play: three quick beeps at alarm volume. */
    private fun beep() {
        val tone = runCatching { ToneGenerator(AudioManager.STREAM_ALARM, 90) }.getOrNull() ?: return
        listOf(0L, 260L, 520L).forEach { at ->
            main.postDelayed({ runCatching { tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 180) } }, at)
        }
        main.postDelayed({ runCatching { tone.release() } }, 1100L)
    }
}
