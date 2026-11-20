package com.loyaltytree.owner

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * New-order push from the LoyaltyTree server (Firebase Cloud Messaging).
 *
 * The server sends data-only messages, so this service always builds the
 * notification itself: "New order #123 · BGC branch" on the "New orders" channel
 * with the lt_new_order chime (OrderAlerts). Tapping it opens the Orders tab.
 * Works while the app is closed or the phone is locked.
 *
 * The phone decides if it rings: signed in to that business, alerts switched on,
 * branch not muted by the owner, and not already rung by the 20-second poll.
 */
class OrderPushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val signedIn = OrderPush.session(this) ?: return
        val context = applicationContext
        Thread { runCatching { OrderPush.register(context, signedIn.slug, signedIn.token, token) } }.start()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != "new_order") return
        val signedIn = OrderPush.session(this) ?: return // signed out: stay quiet
        if (data["business"].orEmpty() != signedIn.slug) return
        val orderId = data["order_id"].orEmpty()
        if (orderId.isBlank()) return
        val branchId = data["branch_public_id"].orEmpty()
        // Staff tied to a branch only ring for that branch (the server already filters; this is a second check).
        if (signedIn.isStaff && signedIn.branchId.isNotBlank() && branchId != signedIn.branchId) return
        val prefs = getSharedPreferences("lt", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("orderAlerts", true)) return
        val muted = prefs.getStringSet("mutedBranches", emptySet()) ?: emptySet()
        if (!signedIn.isStaff && branchId in muted) return
        val key = OrderAlerts.seenKey(signedIn.slug, signedIn.role, signedIn.branchId)
        if (orderId !in OrderAlerts.claim(this, key, listOf(orderId), firstLoadQuiet = false)) return
        val lines = data["lines"].orEmpty().split("\n").filter { it.isNotBlank() }.map { OrderLine(it, "") }
        val order = LiveOrder(
            id = orderId,
            number = data["order_number"].orEmpty().ifBlank { "Order" },
            status = "new",
            customer = "",
            branch = data["branch_name"].orEmpty(),
            pickup = "",
            total = data["total"].orEmpty(),
            note = data["note"].orEmpty(),
            payment = data["payment_status"].orEmpty(),
            items = lines.ifEmpty { listOf(OrderLine("${data["items"].orEmpty().ifBlank { "1" }} × Item", "")) },
            source = "menu",
            branchId = branchId,
            createdAt = data["created_at"].orEmpty(),
            paymentMethod = data["payment_method"].orEmpty()
        )
        OrderAlerts.announce(applicationContext, listOf(order))
    }
}

/** Device token helpers shared by CounterStore and OrderPushService. */
object OrderPush {

    /** The signed-in session saved by CounterStore, or null when signed out. */
    fun session(context: Context): OwnerSession? {
        val raw = context.getSharedPreferences("lt", Context.MODE_PRIVATE).getString("session", null) ?: return null
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val slug = json.optString("slug")
        val token = json.optString("token")
        if (slug.isBlank() || token.isBlank()) return null
        return OwnerSession(
            token, slug, json.optString("businessName"), json.optString("email"), json.optString("role"),
            json.optString("staffName"), json.optString("branchId"), json.optString("branchName")
        )
    }

    /** Gets this phone's FCM token. Quietly does nothing if Firebase is not set up in this build. */
    fun currentToken(context: Context, done: (String) -> Unit) {
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (!token.isNullOrBlank()) done(token)
            }
        }
    }

    private fun appVersion(context: Context): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()
    }.getOrDefault("")

    /** Blocking: call off the main thread. */
    fun register(context: Context, slug: String, sessionToken: String, pushToken: String) =
        API.post(
            "/api/v1/business/$slug/app-devices",
            sessionToken,
            JSONObject().put("token", pushToken).put("platform", "android").put("app_version", appVersion(context))
        )

    /** On sign-out: tell the server to forget this phone, then drop the token so nothing reaches it. */
    fun signOut(context: Context, slug: String) {
        Thread {
            runCatching {
                val messaging = FirebaseMessaging.getInstance()
                val token = Tasks.await(messaging.token, 10, TimeUnit.SECONDS)
                if (!token.isNullOrBlank()) {
                    runCatching { API.post("/api/v1/business/$slug/app-devices/remove", null, JSONObject().put("token", token)) }
                }
                Tasks.await(messaging.deleteToken(), 10, TimeUnit.SECONDS)
            }
        }.start()
    }
}
