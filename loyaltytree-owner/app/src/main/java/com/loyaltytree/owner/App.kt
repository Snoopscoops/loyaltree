@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.loyaltytree.owner

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Store
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

private val Forest = Color(0xFF0F766E)
private val Ink = Color(0xFF0F172A)
private val Ivory = Color(0xFFF6FAF9)
private val Lime = Color(0xFFDDF7EA)
private val Gold = Color(0xFF0F766E)
private val Muted = Color(0xFF475569)
private val Line = Color(0xFFE0EAE7)
private val Track = Color(0xFFDDF7EA)
private val DeepTeal = Color(0xFF073F36)
private val RewardYellow = Color(0xFFFDB601)
private val Bad = Color(0xFF9F2D2D)
private val Shape = RoundedCornerShape(16.dp)
private val Pill = RoundedCornerShape(12.dp)

private sealed class Page {
    data object None : Page()
    data object Analytics : Page()
    data object Stock : Page()
    data object Campaign : Page()
    data object Billboard : Page()
    data object Greetings : Page()
    data class Guest(val part: String) : Page()
    data object Card : Page()
    data object Account : Page()
    data object Billing : Page()
    data object Points : Page()
    data object Cashiers : Page()
    data object Stamp : Page()
    data object Alerts : Page()
    data class Customer(val id: String) : Page()
}

private val OwnerDock = listOf(
    "Home" to Icons.Default.Home,
    "Orders" to Icons.Default.Receipt,
    "Menu" to Icons.Default.Restaurant,
    "Customers" to Icons.Default.Person,
    "More" to Icons.Default.MoreHoriz
)

private sealed class MenuSheet {
    data object Closed : MenuSheet()
    data object Add : MenuSheet()
    data class Edit(val id: String) : MenuSheet()
    data class Group(val id: String?, val backToAdd: Boolean) : MenuSheet()
}

@Composable
fun LoyaltyTreeApp(store: CounterStore = viewModel()) {
    var showOpening by remember { mutableStateOf(!store.seenOpening) }
    LaunchedEffect(showOpening) {
        if (showOpening) {
            delay(1500)
            store.markOpened()
            showOpening = false
        }
    }
    if (showOpening) {
        Box(Modifier.fillMaxSize().background(Forest), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Mark(88)
                Spacer(Modifier.height(16.dp))
                Text("Loyalty Tree", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("Business", color = Lime, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        return
    }
    val current = store.session
    when {
        current == null -> LoginScreen(store)
        current.isStaff -> StaffShell(store)
        else -> Shell(store)
    }
}

/** Asks for the Android 13+ notification permission once, and opens Orders when a new-order notification is tapped. */
@Composable
private fun OrderAlertHooks(store: CounterStore) {
    val context = LocalContext.current
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        store.alertsNote = if (granted) "" else "Notifications are off. New orders still ring, but nothing pops up."
    }
    LaunchedEffect(store.session?.slug) {
        OrderAlerts.ensureChannel(context)
        if (Build.VERSION.SDK_INT >= 33 && !OrderAlerts.permissionGranted(context)) {
            runCatching { ask.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
    }
    val activity = remember(context) { context.findActivity() }
    LaunchedEffect(activity) {
        val intent = activity?.intent
        if (intent?.getStringExtra(OrderAlerts.EXTRA_OPEN) == OrderAlerts.OPEN_ORDERS) {
            intent.removeExtra(OrderAlerts.EXTRA_OPEN)
            store.openOrdersFromNotification()
        }
    }
    androidx.compose.runtime.DisposableEffect(activity) {
        val listener = androidx.core.util.Consumer<Intent> { intent ->
            if (intent.getStringExtra(OrderAlerts.EXTRA_OPEN) == OrderAlerts.OPEN_ORDERS) store.openOrdersFromNotification()
        }
        activity?.addOnNewIntentListener(listener)
        onDispose { activity?.removeOnNewIntentListener(listener) }
    }
    // owner-v9: opening the app stops a ring that started while it was closed, and refreshes the Sound check.
    androidx.compose.runtime.DisposableEffect(activity) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            when (event) {
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> {
                    OrderAlerts.onAppVisible(true)
                    SoundCheckTick.intValue++
                }
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> OrderAlerts.onAppVisible(false)
                else -> Unit
            }
        }
        activity?.lifecycle?.addObserver(observer)
        if (activity?.lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) == true) OrderAlerts.onAppVisible(true)
        onDispose { activity?.lifecycle?.removeObserver(observer) }
    }
}

/** Bumped every time the app comes back on screen, so the Sound check re-reads the phone settings. */
private val SoundCheckTick = mutableIntStateOf(0)

/** owner-v9: shown while an order is ringing. */
@Composable
private fun RingingBar() {
    if (!OrderAlerts.ringing.value) return
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Forest).clickable { OrderAlerts.stopRinging() }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("New order ringing", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text("Stop ringing", color = Color.White, fontWeight = FontWeight.Bold)
    }
}

private fun Context.findActivity(): androidx.activity.ComponentActivity? {
    var current: Context? = this
    while (current is android.content.ContextWrapper) {
        if (current is androidx.activity.ComponentActivity) return current
        current = current.baseContext
    }
    return null
}

private val StaffDock = listOf(
    "Orders" to Icons.Default.Receipt,
    "Stamps" to Icons.Default.Star,
    "Me" to Icons.Default.Person
)

/** Staff have orders and stamps; managers also get branch inventory, not full menu administration. */
@Composable
private fun StaffShell(store: CounterStore) {
    var tab by remember { mutableIntStateOf(0) }
    val view = LocalView.current
    LaunchedEffect(store.session?.slug) { store.refresh() }
    LaunchedEffect(store.openOrdersTick) { if (store.openOrdersTick > 0) tab = 0 }
    OrderAlertHooks(store)
    BackHandler(tab != 0) { tab = 0 }
    val manager = store.session?.role == "manager"
    val dock = if (manager) StaffDock.take(2) + ("Stock" to Icons.Default.Restaurant) + StaffDock.drop(2) else StaffDock
    Scaffold(containerColor = Ivory, bottomBar = {
        Dock(tab, dock) {
            tick(view)
            if (it == 1 && tab != 1) store.clearScan()
            tab = it
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(Ivory)) {
            StaffHeader(store)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    0 -> OrdersScreen(store)
                    1 -> if (store.staffNeedsBranch) NeedsBranch(store) else StampScreen(store)
                    2 -> if (manager) Scroll { DailyStockCard(store, alwaysOpen = true) } else StaffMeScreen(store)
                    else -> StaffMeScreen(store)
                }
            }
        }
    }
}

@Composable
private fun StaffHeader(store: CounterStore) {
    val current = store.session ?: return
    val branch = if (current.branchName.isNotBlank()) branchLabel(current.branchName) else if (current.role == "manager") "All branches" else "No branch yet"
    Row(Modifier.fillMaxWidth().background(Forest).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(current.staffName.ifBlank { current.email }, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${current.roleLabel} · $branch", color = Lime, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(current.businessName, color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun NeedsBranch(store: CounterStore) {
    Scroll {
        Card {
            Text("No branch yet", color = Forest, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text("Ask the owner to assign your branch.", color = Ink, fontSize = 15.sp)
            Text("The owner does this in the LoyaltyTree app under More, then Cashiers. Then tap Check again.", color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
        }
        Primary(if (store.loading) "Checking" else "Check again", enabled = !store.loading) { store.refresh() }
        Secondary("Log out") { store.signOut() }
    }
}

@Composable
private fun StaffMeScreen(store: CounterStore) {
    val current = store.session ?: return
    Scroll {
        Text("Me", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Card {
            Info("Name", current.staffName.ifBlank { "Staff" })
            Info("Role", current.roleLabel)
            Info("Branch", if (current.branchName.isNotBlank()) current.branchName else if (current.role == "manager") "All branches" else "Not assigned")
            Info("Business", current.businessName)
            Info("Email", current.email)
        }
        Card {
            Text("WHAT YOU CAN DO", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text("• See and update orders for your branch", color = Ink, fontSize = 14.sp)
            Text("• Mark cash orders as paid", color = Ink, fontSize = 14.sp)
            Text("• Scan a card to add stamps or points", color = Ink, fontSize = 14.sp)
            if (current.canReport) {
                Text("• See today's sales and download the sales report", color = Ink, fontSize = 14.sp)
                Text("• Correct stamps", color = Ink, fontSize = 14.sp)
            }
            if (current.role == "manager") Text("• Adjust daily stock for your assigned branch", color = Ink, fontSize = 14.sp)
            Text("Menu prices, customers, billing and settings stay with the owner.", color = Muted, fontSize = 12.sp)
        }
        AlertSettings(store)
        Text("You stay signed in for 12 hours, then sign in again with your PIN.", color = Muted, fontSize = 12.sp)
        Secondary("Log out") { store.signOut() }
    }
}

@Composable
private fun AlertsScreen(store: CounterStore) {
    Scroll {
        AlertSettings(store)
    }
}

@Composable
private fun AlertSettings(store: CounterStore) {
    val context = LocalContext.current
    val current = store.session ?: return
    val allowed = OrderAlerts.canNotify(context)
    Card {
        Text("NEW ORDER ALERTS", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Ring for new orders", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(
                    if (current.isStaff) "Only orders for ${if (current.branchName.isNotBlank()) branchLabel(current.branchName) else "your branches"}."
                    else "Every branch. The notification names the branch.",
                    color = Muted, fontSize = 13.sp
                )
            }
            Switch(store.alertsOn, { store.setAlerts(it) }, colors = switchColors())
        }
        if (current.isOwner && store.alertsOn && store.branches.size > 1) {
            Text("Branches", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            store.branches.forEach { place ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(branchLabel(place.name), color = Ink, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Switch(place.id !in store.mutedBranches, { store.setBranchAlert(place.id, it) }, colors = switchColors())
                }
            }
        }
        if (!allowed) {
            Text("Notifications are off for LoyaltyTree. Turn them on so new orders ring even when the screen is off.", color = Bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Secondary("Turn on notifications") {
                val intent = if (Build.VERSION.SDK_INT >= 26) {
                    Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                } else {
                    Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                }
                runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
        }
        if (store.alertsOn) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Ring until opened", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text("Keeps ringing for up to 30 seconds, or until you open the app.", color = Muted, fontSize = 13.sp)
                }
                Switch(store.ringUntilOpened, { store.chooseRingUntilOpened(it) }, colors = switchColors())
            }
        }
        RingingBar()
        Secondary("Play test alert") {
            OrderAlerts.test(context, current.branchName.ifBlank { store.branches.firstOrNull()?.name.orEmpty() })
        }
        if (store.alertsNote.isNotBlank()) Text(store.alertsNote, color = Muted, fontSize = 12.sp)
        Text("The ring plays at alarm volume, so it still rings when the phone is on vibrate. With push set up, orders ring even when the app is closed.", color = Muted, fontSize = 12.sp, lineHeight = 17.sp)
    }
    SoundCheck(store)
}

private enum class Health { Good, Warn, Bad }

@Composable
private fun SoundRow(title: String, value: String, health: Health, action: String? = null, onAction: () -> Unit = {}) {
    val color = when (health) { Health.Good -> Forest; Health.Warn -> Amber; Health.Bad -> Bad }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(title, color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(value, color = if (health == Health.Good) Muted else color, fontSize = 12.sp, lineHeight = 16.sp)
        }
        if (action != null) TextButton(onClick = onAction) { Text(action, color = Forest, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
    }
}

private fun openSettings(context: Context, vararg intents: Intent) {
    for (intent in intents) {
        if (runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess) return
    }
}

private fun appDetails(context: Context) =
    Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))

/** owner-v9: one place to see why the order ring might be quiet, with a button to the right setting. */
@Composable
private fun SoundCheck(store: CounterStore) {
    val context = LocalContext.current
    var bump by remember { mutableIntStateOf(0) }
    val key = SoundCheckTick.intValue + bump // re-read when the app comes back from Settings
    val audio = remember(key) { context.getSystemService(android.media.AudioManager::class.java) }
    val notifications = remember(key) { context.getSystemService(android.app.NotificationManager::class.java) }
    val power = remember(key) { context.getSystemService(android.os.PowerManager::class.java) }
    val activityManager = remember(key) { context.getSystemService(android.app.ActivityManager::class.java) }
    LaunchedEffect(Unit) { if (store.pushState.isBlank()) store.recheckPush() }
    Card {
        Text("SOUND CHECK", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)

        val permission = OrderAlerts.permissionGranted(context) && androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
        SoundRow(
            "Notifications", if (permission) "Allowed" else "Off. Orders ring but nothing pops up.",
            if (permission) Health.Good else Health.Bad, if (permission) null else "Turn on"
        ) {
            openSettings(context,
                Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName),
                appDetails(context))
        }

        val channel = remember(key) { OrderAlerts.channelState(context) }
        SoundRow(
            "\"New orders\" pop-up",
            when (channel) { "high" -> "On, pops up on screen"; "low" -> "Turned down, won't pop up"; else -> "Turned off for this app" },
            when (channel) { "high" -> Health.Good; "low" -> Health.Warn; else -> Health.Bad },
            if (Build.VERSION.SDK_INT >= 26) "Settings" else null
        ) {
            openSettings(context,
                Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, OrderAlerts.CHANNEL_ID),
                Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
        }

        SoundRow(
            "Order tone", if (OrderAlerts.hasRingtone(context)) "LoyaltyTree tone" else "Tone file missing in this build, using beeps",
            if (OrderAlerts.hasRingtone(context)) Health.Good else Health.Warn
        )

        if (audio != null) {
            val alarm = runCatching { audio.getStreamVolume(android.media.AudioManager.STREAM_ALARM) }.getOrDefault(0)
            val alarmMax = runCatching { audio.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM) }.getOrDefault(1).coerceAtLeast(1)
            val percent = alarm * 100 / alarmMax
            SoundRow(
                "Alarm volume (the order ring)", "$percent%" + if (percent == 0) ", the ring is silent" else if (percent < 50) ", may be hard to hear" else "",
                when { percent == 0 -> Health.Bad; percent < 50 -> Health.Warn; else -> Health.Good },
                if (percent < 80) "Turn up" else null
            ) {
                val ok = runCatching {
                    audio.setStreamVolume(android.media.AudioManager.STREAM_ALARM, (alarmMax * 8 + 9) / 10, android.media.AudioManager.FLAG_SHOW_UI)
                }.isSuccess
                if (!ok) openSettings(context, Intent(android.provider.Settings.ACTION_SOUND_SETTINGS))
                bump++
            }
            val notifyVolume = runCatching { audio.getStreamVolume(android.media.AudioManager.STREAM_NOTIFICATION) }.getOrDefault(0)
            val notifyMax = runCatching { audio.getStreamMaxVolume(android.media.AudioManager.STREAM_NOTIFICATION) }.getOrDefault(1).coerceAtLeast(1)
            val mode = when (audio.ringerMode) {
                android.media.AudioManager.RINGER_MODE_SILENT -> "Silent"
                android.media.AudioManager.RINGER_MODE_VIBRATE -> "Vibrate"
                else -> "Sound on"
            }
            SoundRow(
                "Phone sound mode", "$mode · notification volume ${notifyVolume * 100 / notifyMax}%. Orders still ring at alarm volume.",
                Health.Good
            )
        }

        if (notifications != null && Build.VERSION.SDK_INT >= 23) {
            val filter = notifications.currentInterruptionFilter
            val alarmsAllowed = when (filter) {
                android.app.NotificationManager.INTERRUPTION_FILTER_ALL, android.app.NotificationManager.INTERRUPTION_FILTER_UNKNOWN -> true
                android.app.NotificationManager.INTERRUPTION_FILTER_NONE -> false
                android.app.NotificationManager.INTERRUPTION_FILTER_ALARMS -> true
                else -> runCatching {
                    Build.VERSION.SDK_INT < 28 ||
                        notifications.notificationPolicy.priorityCategories and android.app.NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS != 0
                }.getOrDefault(true)
            }
            val dndOff = filter == android.app.NotificationManager.INTERRUPTION_FILTER_ALL || filter == android.app.NotificationManager.INTERRUPTION_FILTER_UNKNOWN
            SoundRow(
                "Do Not Disturb",
                when {
                    dndOff -> "Off"
                    alarmsAllowed -> "On. Alarms still ring, but pop-ups may be hidden."
                    else -> "On and blocking alarms. Orders will not ring."
                },
                when { dndOff -> Health.Good; alarmsAllowed -> Health.Warn; else -> Health.Bad },
                if (dndOff) null else "Settings"
            ) {
                openSettings(context, Intent("android.settings.ZEN_MODE_SETTINGS"), Intent(android.provider.Settings.ACTION_SOUND_SETTINGS))
            }
        }

        val unrestricted = power == null || Build.VERSION.SDK_INT < 23 || power.isIgnoringBatteryOptimizations(context.packageName)
        val background = Build.VERSION.SDK_INT >= 28 && activityManager?.isBackgroundRestricted == true
        SoundRow(
            "Battery",
            when {
                background -> "Restricted. Android may block alerts when the app is closed."
                unrestricted -> "Not restricted"
                else -> "Optimized. Alerts can be late when the app is closed. Set LoyaltyTree to Unrestricted."
            },
            when { background -> Health.Bad; unrestricted -> Health.Good; else -> Health.Warn },
            if (unrestricted && !background) null else "Settings"
        ) {
            if (background || Build.VERSION.SDK_INT < 23) openSettings(context, appDetails(context))
            else openSettings(context, Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), appDetails(context))
        }

        SoundRow(
            "Push (rings when the app is closed)",
            when (store.pushState) {
                "on" -> "This phone is registered"
                "no_firebase" -> "Not set up in this build (google-services.json). Rings only while the app is open."
                "server" -> "The server did not accept this phone. Rings only while the app is open."
                else -> "Checking"
            },
            when (store.pushState) { "on" -> Health.Good; "checking", "" -> Health.Warn; else -> Health.Bad },
            if (store.pushState == "on" || store.pushState == "checking") null else "Retry"
        ) { store.recheckPush() }

        Text("Xiaomi, Oppo, Vivo, Realme: also allow Autostart for LoyaltyTree in the phone's app settings.", color = Muted, fontSize = 12.sp, lineHeight = 17.sp)
        Secondary("Open LoyaltyTree app settings") { openSettings(context, appDetails(context)) }
    }
}

@Composable
private fun Shell(store: CounterStore) {
    var tab by remember { mutableIntStateOf(0) }
    var page by remember { mutableStateOf<Page>(Page.None) }
    val view = LocalView.current
    LaunchedEffect(store.session?.slug) { store.refresh() }
    LaunchedEffect(store.openOrdersTick) {
        if (store.openOrdersTick > 0) {
            tab = 1
            page = Page.None
        }
    }
    OrderAlertHooks(store)
    BackHandler(page !is Page.None) { page = Page.None }
    val saving = page is Page.Guest || page is Page.Billboard || page is Page.Card
    Scaffold(containerColor = Ivory, bottomBar = {
        Dock(tab) {
            tick(view)
            tab = it
            page = Page.None
        }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(Ivory)) {
            if (page !is Page.None) {
                NavBar(
                    title = pageTitle(page, store),
                    onBack = { page = Page.None },
                    action = if (saving) if (store.loading) "Saving" else "Save" else null,
                    onAction = {
                        when (page) {
                            is Page.Guest -> store.saveGuest()
                            Page.Billboard -> store.saveBillboard()
                            Page.Card -> store.saveCard()
                            else -> Unit
                        }
                    }
                )
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (val current = page) {
                    Page.None -> when (tab) {
                        0 -> HomeScreen(store,
                            openAnalytics = { page = Page.Analytics },
                            openCampaign = { page = Page.Campaign },
                            openStamp = { page = Page.Stamp },
                            openOrders = { tab = 1; page = Page.None },
                            openMenu = { tab = 2; page = Page.None },
                            openStock = { page = Page.Stock },
                            openCustomers = { tab = 3; page = Page.None },
                            openAlerts = { page = Page.Alerts },
                            openAccount = { page = Page.Account }
                        )
                        1 -> OrdersScreen(store)
                        2 -> MenuScreen(store)
                        3 -> CustomersScreen(store) { page = Page.Customer(it) }
                        else -> MoreScreen(store, { page = it }) { tab = 2; page = Page.None }
                    }
                    Page.Analytics -> AnalyticsScreen(store)
                    Page.Stock -> Scroll { DailyStockCard(store, alwaysOpen = true) }
                    Page.Campaign -> CampaignScreen(store)
                    Page.Billboard -> BillboardScreen(store)
                    Page.Greetings -> GreetingsScreen(store)
                    is Page.Guest -> GuestScreen(store, current.part)
                    Page.Card -> CardScreen(store)
                    Page.Account -> AccountScreen(store) { page = Page.Billing }
                    Page.Billing -> BillingScreen(store)
                    Page.Points -> PointsScreen()
                    Page.Cashiers -> CashiersScreen(store)
                    Page.Stamp -> StampScreen(store)
                    Page.Alerts -> AlertsScreen(store)
                    is Page.Customer -> CustomerScreen(store, current.id)
                }
            }
        }
    }
}

private fun pageTitle(page: Page, store: CounterStore): String = when (page) {
    Page.Analytics -> "Analytics"
    Page.Stock -> "Daily stock"
    Page.Campaign -> "Campaign"
    Page.Billboard -> "Billboard"
    Page.Greetings -> "Notifications"
    is Page.Guest -> when (page.part) {
        "socials" -> "Socials"
        "book" -> "Book our place"
        "reserve" -> "Reserve a table"
        else -> "Wi-Fi"
    }
    Page.Card -> "Card"
    Page.Account -> "Account"
    Page.Billing -> "Billing"
    Page.Points -> "LT Points"
    Page.Cashiers -> "Cashiers"
    Page.Stamp -> if (store.cardType == "points") "Add points" else "Add a stamp"
    Page.Alerts -> "Order alerts"
    is Page.Customer -> store.members.firstOrNull { it.id == page.id }?.name ?: "Customer"
    Page.None -> ""
}

@Composable
private fun LoginScreen(store: CounterStore) {
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var staff by remember { mutableStateOf(false) }
    val ready = email.contains("@") && password.length >= 4
    Column(Modifier.fillMaxSize().background(Ivory).imePadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Mark(72)
        Spacer(Modifier.height(16.dp))
        Text("Sign in", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text(if (staff) "Managers and cashiers: use the email and PIN from the owner." else "Use the email for this business.", color = Muted, fontSize = 15.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Track).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("Owner" to false, "Staff" to true).forEach { (label, value) ->
                Box(
                    Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (staff == value) Forest else Color.Transparent).clickable {
                        staff = value
                        password = ""
                        store.status = ""
                    }.padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(label, color = if (staff == value) Color.White else Forest, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Column(Modifier.fillMaxWidth().clip(Shape).background(Color.White).border(1.dp, Line, Shape).padding(18.dp)) {
            Field("Email", email, { email = it })
            Spacer(Modifier.height(12.dp))
            if (staff) Field("PIN", password, { password = it.filter { ch -> ch.isDigit() }.take(12) }, password = true, number = true)
            else Field("Password", password, { password = it }, password = true)
            if (store.status.isNotBlank()) Text(store.status, color = Bad, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
            Spacer(Modifier.height(12.dp))
            Primary(if (store.loading) "Signing in" else "Sign in", enabled = ready && !store.loading) {
                store.signIn(email.trim(), password, staff)
            }
            if (staff) {
                Text("Staff see orders for their branch and can add stamps. You stay signed in for 12 hours.", color = Muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(top = 10.dp), textAlign = TextAlign.Center)
            } else {
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://theloyaltytree.com/signup"))) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Create a business account", color = Forest, fontWeight = FontWeight.SemiBold)
                }
                Text("Registration and payment stay on the website.", color = Muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun HomeScreen(
    store: CounterStore, openAnalytics: () -> Unit, openCampaign: () -> Unit, openStamp: () -> Unit,
    openOrders: () -> Unit, openMenu: () -> Unit, openStock: () -> Unit, openCustomers: () -> Unit,
    openAlerts: () -> Unit, openAccount: () -> Unit
) {
    var branchMenu by remember { mutableStateOf(false) }
    val shownOrders = store.orders.filter { store.ordersBranch.isBlank() || it.branchId == store.ordersBranch }
    val bills = groupCounterBills(shownOrders)
    val branchName = store.branches.firstOrNull { it.id == store.ordersBranch }?.name
        ?: if (store.branches.size == 1) store.branches[0].name else "All branches"
    val metricReady = !store.loading && store.analytics.isNotEmpty()
    val recent = shownOrders.sortedByDescending { it.createdAt }.take(3)
    val context = LocalContext.current
    val view = LocalView.current
    var enlarged by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1400)
            copied = false
        }
    }
    fun copyLink() {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("join", store.joinLink))
        copied = true
        confirm(view)
    }
    Scroll {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Mark(44)
            Text("LoyaltyTree", color = DeepTeal, fontSize = 23.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.size(40.dp).clip(Pill).clickable { openAlerts() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Notifications, "Order alerts", tint = DeepTeal)
            }
            Box(Modifier.size(40.dp).clip(Pill).background(Track).clickable { openAccount() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Person, "Account", tint = DeepTeal)
            }
        }
        Box {
            Row(Modifier.clip(RoundedCornerShape(99.dp)).background(Track).clickable(enabled = store.branches.size > 1) { branchMenu = true }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Store, null, tint = DeepTeal, modifier = Modifier.size(18.dp))
                Text(branchName, color = DeepTeal, fontWeight = FontWeight.SemiBold)
                if (store.branches.size > 1) Text("⌄", color = DeepTeal)
            }
            androidx.compose.material3.DropdownMenu(expanded = branchMenu, onDismissRequest = { branchMenu = false }) {
                androidx.compose.material3.DropdownMenuItem(text = { Text("All branches") }, onClick = { branchMenu = false; store.chooseOrdersBranch("") })
                store.branches.forEach { branch ->
                    androidx.compose.material3.DropdownMenuItem(text = { Text(branch.name) }, onClick = { branchMenu = false; store.chooseOrdersBranch(branch.id) })
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Business overview", color = Ink, fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.Black)
            Text(store.session?.businessName ?: "Your business", color = DeepTeal, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text("Digitalize. Secure. Connect.", color = Muted, fontSize = 14.sp)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DashboardMetric("Today's sales", store.daySummary?.sales ?: "—", Icons.Default.Payments, Modifier.weight(1f))
            DashboardMetric("Active bills", if (store.loading || store.ordersNote.isNotBlank()) "—" else bills.count { it.active }.toString(), Icons.Default.ShoppingBag, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DashboardMetric("Customers", if (metricReady) store.memberCount else "—", Icons.Default.Group, Modifier.weight(1f))
            DashboardMetric("Rewards today", if (metricReady) store.todayRewards else "—", Icons.Default.Star, Modifier.weight(1f), reward = true)
        }
        Text("Customers and rewards cover the whole business.", color = Muted, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DashboardAction(if (store.cardType == "points") "Scan to earn" else "Scan to stamp", Icons.Default.QrCodeScanner, Modifier.weight(1f), DeepTeal) { store.clearScan(); openStamp() }
            DashboardAction("Orders", Icons.Default.Receipt, Modifier.weight(1f), Forest, openOrders)
            DashboardAction("Menu", Icons.Default.Restaurant, Modifier.weight(1f), Forest, openMenu)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DashboardAction("Stock", Icons.Default.Inventory2, Modifier.weight(1f), Forest, openStock)
            DashboardAction("Customers", Icons.Default.Group, Modifier.weight(1f), DeepTeal, openCustomers)
            DashboardAction("Reports", Icons.Default.BarChart, Modifier.weight(1f), Forest, openOrders)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Recent activity", color = Ink, fontWeight = FontWeight.Bold, fontSize = 22.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = openOrders) { Text("View all ›", color = Forest, fontWeight = FontWeight.SemiBold) }
        }
        Card {
            if (recent.isEmpty()) Text(if (store.loading) "Loading orders…" else if (store.ordersNote.isNotBlank()) "Orders temporarily unavailable." else "No recent orders.", color = Muted, fontSize = 14.sp)
            recent.forEachIndexed { index, order ->
                if (index > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
                Row(Modifier.fillMaxWidth().clickable { openOrders() }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(40.dp).clip(Pill).background(Track), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.ShoppingBag, null, tint = Forest)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(order.number.ifBlank { "Order" }, color = Ink, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(order.total + if (order.branch.isBlank()) "" else " · " + order.branch, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(order.status.replace('_', ' ').replaceFirstChar { it.uppercase() }, color = if (order.status == "cancelled") Bad else Forest, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Text("Loyalty insights", color = Ink, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Track).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("Today" to "today", "7 days" to "7d", "30 days" to "30d", "90 days" to "90d").forEach { (label, id) ->
                val on = store.period == id
                Box(
                    Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (on) Forest else Color.Transparent).clickable {
                        tick(view)
                        store.selectRange(id)
                    }.padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(label, color = if (on) Color.White else Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("Stamps", if (store.period == "today") store.todayStamps else store.cardStamps, Modifier.weight(1f))
            Metric("Rewards", if (store.period == "today") store.todayRewards else store.cardRewards, Modifier.weight(1f))
            Metric("New", if (store.period == "today") store.todayNew else store.cardNew, Modifier.weight(1f))
        }
        Text("${store.memberCount} members  ·  ${store.cameBackRate.toInt()}% came back", color = Forest, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { Secondary("Analytics", openAnalytics) }
            Box(Modifier.weight(1f)) { Primary("Campaign", onClick = openCampaign) }
        }
        Column(Modifier.fillMaxWidth().clip(Shape).background(Color.White).border(1.dp, Line, Shape)) {
            Row(Modifier.fillMaxWidth().clickable { enlarged = true }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Qr(store.joinLink, 64)
                Spacer(Modifier.size(14.dp))
                Column(Modifier.weight(1f)) {
                    Text("Join QR", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    Text("Customers scan this to join.", color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
                }
                Text("›", color = Muted, fontSize = 22.sp)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
            Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).fillMaxSize().clickable { enlarged = true }, contentAlignment = Alignment.Center) {
                    Text("Enlarge", color = Forest, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
                Box(Modifier.width(1.dp).height(22.dp).background(Line))
                Box(Modifier.weight(1f).fillMaxSize().clickable { copyLink() }, contentAlignment = Alignment.Center) {
                    Text(if (copied) "Copied" else "Copy link", color = Forest, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
        if (store.status.isNotBlank()) Text(store.status, color = Bad, fontWeight = FontWeight.SemiBold)
    }
    if (enlarged) {
        ModalBottomSheet(onDismissRequest = { enlarged = false }, containerColor = Ivory, dragHandle = { BottomSheetDefaults.DragHandle(color = Muted.copy(alpha = 0.45f)) }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 12.dp).navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Customer join QR", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Qr(store.joinLink, 240)
                Text("Customers scan this to join.", color = Muted)
                Primary("Share link") {
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, store.joinLink), "Share"))
                }
                Secondary(if (copied) "Copied" else "Copy link") { copyLink() }
            }
        }
    }
}

@Composable
private fun DashboardMetric(label: String, value: String, icon: ImageVector, modifier: Modifier, reward: Boolean = false) {
    Row(modifier.clip(Shape).background(Color(0xFFEAF6F3)).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(icon, null, tint = if (reward) Color(0xFF956700) else Forest, modifier = Modifier.size(26.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text(value, color = Ink, fontSize = 21.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DashboardAction(label: String, icon: ImageVector, modifier: Modifier, fill: Color, action: () -> Unit) {
    Column(modifier.heightIn(min = 96.dp).clip(Shape).background(fill).clickable { action() }.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(28.dp))
        Spacer(Modifier.height(7.dp))
        Text(label, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, lineHeight = 16.sp)
    }
}

@Composable
private fun OrdersScreen(store: CounterStore) {
    LaunchedEffect(store.session?.slug) { store.loadOrders() }
    val who = store.session
    if (who != null && who.isStaff && store.staffNeedsBranch) {
        NeedsBranch(store)
        return
    }
    val canReport = who?.canReport == true
    val shown = if (store.ordersBranch.isBlank()) store.orders else store.orders.filter { it.branchId == store.ordersBranch }
    val bills = groupCounterBills(shown)
    val current = bills.filter { it.active }
    val earlier = bills.filterNot { it.active }
    Scroll {
        Text("Orders", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text(
            if (who != null && who.isStaff && who.branchName.isNotBlank()) "Digital menu orders for ${branchLabel(who.branchName)}."
            else "Orders placed on the digital menu show up here.",
            color = Muted, fontSize = 15.sp
        )
        RingingBar()
        // owner-v14: UI-only placeholder. No NextPay integration, redirect,
        // refund API request, payment mutation or refund action is wired.
        Card {
            Text("Refunds", color = Forest, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Primary("Refunds · Coming soon", enabled = false) { }
            Text("Refund processing is not available yet. Awaiting NextPay refund protocols. No refunds can be started from this app.", color = Muted, fontSize = 12.sp)
        }
        if (store.alertsNote.isNotBlank()) Text(store.alertsNote, color = Amber, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (who?.isOwner == true && store.branches.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BranchChip("All", store.ordersBranch.isBlank()) { store.chooseOrdersBranch("") }
                store.branches.forEach { place -> BranchChip(place.name, store.ordersBranch == place.id) { store.chooseOrdersBranch(place.id) } }
            }
        }
        if (canReport) {
            store.daySummary?.let { DaySummaryCard(it, showBranches = who?.isOwner == true && store.ordersBranch.isBlank() && store.branches.size > 1) }
            SalesReportCard(store)
        }
        if (store.ordersNote.isNotBlank()) Text(store.ordersNote, color = Bad, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        if (current.isEmpty()) Text("No current orders.", color = Muted)
        if (store.orders.count { it.source == "menu" } >= 100) Text("Showing recent orders. Older bill entries may be missing; refresh or check the full sales report.", color = Muted, fontSize = 12.sp)
        current.forEach { bill -> androidx.compose.runtime.key(bill.key) { CounterBillCard(store, bill) } }
        if (earlier.isNotEmpty()) {
            Text("EARLIER", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            earlier.take(12).forEach { bill -> androidx.compose.runtime.key(bill.key) { CounterBillCard(store, bill) } }
        }
        Secondary("Refresh") { store.loadOrders() }
    }
}

@Composable
private fun CashiersScreen(store: CounterStore) {
    LaunchedEffect(store.session?.slug) { store.loadCashiers() }
    Scroll {
        Text("Cashiers", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Pick the branch each cashier works at.", color = Muted, fontSize = 15.sp)
        if (store.cashiersNote.isNotBlank()) Text(store.cashiersNote, color = if (store.cashiers.isEmpty()) Muted else Bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        store.cashiers.forEach { person ->
            val busy = store.cashierBusy == person.id
            Card {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(person.name, color = Ink, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(if (!person.active) "Inactive" else person.role.replaceFirstChar { it.uppercase() }, color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                if (person.email.isNotBlank()) Text(person.email, color = Muted, fontSize = 13.sp)
                Text(if (busy) "Saving…" else if (person.branchName.isNotBlank()) branchLabel(person.branchName) else "No branch yet", color = Forest, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                if (store.branches.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        store.branches.forEach { place ->
                            BranchChip(place.name, person.branchId == place.id) { if (!busy && person.branchId != place.id) store.assignCashier(person.id, place.id) }
                        }
                        BranchChip("No branch", person.branchId.isBlank()) { if (!busy && person.branchId.isNotBlank()) store.assignCashier(person.id, "") }
                    }
                }
            }
        }
        Secondary("Refresh") { store.loadCashiers() }
    }
}

@Composable
private fun BranchChip(title: String, selected: Boolean, onClick: () -> Unit) {
    val view = LocalView.current
    Box(Modifier.clip(RoundedCornerShape(99.dp)).background(if (selected) Forest else Color.White).border(1.dp, if (selected) Forest else Line, RoundedCornerShape(99.dp)).clickable { tick(view); onClick() }.padding(horizontal = 16.dp, vertical = 9.dp), contentAlignment = Alignment.Center) {
        Text(title, color = if (selected) Color.White else Forest, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1)
    }
}

@Composable
private fun SalesReportCard(store: CounterStore) {
    val context = LocalContext.current
    val branchName = store.branches.firstOrNull { it.id == store.ordersBranch }?.name
        ?: store.session?.branchName?.takeIf { store.session?.isStaff == true && it.isNotBlank() }
    Card {
        Text("SALES REPORT", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Text("Download a file with every order, totals, top items and who bought what. Send it on Messenger, Viber or email.", color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Today" to "today", "Yesterday" to "yesterday", "This week" to "week", "This month" to "month").forEach { (label, id) ->
                BranchChip(label, store.reportRange == id) { store.reportRange = id }
            }
        }
        Text(if (branchName != null) branchLabel(branchName) else "All branches", color = Forest, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Primary(if (store.reportBusy) "Preparing report…" else "Download & share report", enabled = !store.reportBusy) {
            store.downloadReport { report -> shareReport(context, report) }
        }
        if (store.reportNote.isNotBlank()) Text(store.reportNote, color = if (store.reportNote.startsWith("Saved")) Forest else Bad, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun shareReport(context: Context, report: ShareReport) {
    val send = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_SUBJECT, report.filename.removeSuffix(".csv")).putExtra(Intent.EXTRA_TEXT, report.text)
    if (report.uri != null) {
        send.setType("text/csv").putExtra(Intent.EXTRA_STREAM, report.uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(report.filename, report.uri)
    } else {
        send.setType("text/plain")
    }
    runCatching { context.startActivity(Intent.createChooser(send, "Send sales report")) }
}

@Composable
private fun DaySummaryCard(summary: DaySummary, showBranches: Boolean) {
    Card {
        Text("TODAY", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Column {
                Text(summary.sales, color = Forest, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("${summary.orders} ${if (summary.orders == 1) "order" else "orders"}", color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("Dine in ${summary.dineIn} · Pickup ${summary.pickup}", color = Muted, fontSize = 13.sp)
                Text("Cancelled ${summary.cancelled}", color = if (summary.cancelled > 0) Bad else Muted, fontSize = 13.sp)
            }
        }
        if (summary.topItems.isNotEmpty()) {
            Text("Top items", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            summary.topItems.forEachIndexed { index, item -> Info("${index + 1}. ${item.name}", "× ${item.detail}") }
        }
        if (summary.payments.isNotEmpty()) {
            Text("By payment", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            summary.payments.forEach { Info(it.name, it.detail) }
            if (summary.paid.isNotBlank()) Info("Paid", summary.paid)
            if (summary.unpaid.isNotBlank()) Info("Unpaid", summary.unpaid)
        }
        if (showBranches && summary.branches.isNotEmpty()) {
            Text("By branch", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            summary.branches.forEach { Info(it.name, it.detail) }
        }
        if (summary.orders == 0 && summary.cancelled == 0) Text("No orders yet today.", color = Muted, fontSize = 13.sp)
    }
}

private fun paymentBadge(method: String, status: String): String? {
    val label = when (method) {
        "cash" -> "Cash"
        "qrph" -> "GCash/Maya (QR Ph)"
        "card" -> "Card"
        else -> return null
    }
    return when (status) {
        "unpaid" -> "$label · Unpaid"
        "paid_test" -> "Paid · $label (test)"
        else -> "Paid · $label"
    }
}

private fun branchLabel(name: String): String =
    if (name.isBlank() || name.endsWith("branch", ignoreCase = true)) name else "$name branch"

@Composable
private fun CounterBillCard(store: CounterStore, bill: CounterBill) {
    val parent = bill.parent
    if (!bill.grouped) {
        OrderCard(store, bill.orders.single())
        return
    }
    var adding by remember(bill.key) { mutableStateOf(false) }
    var expanded by remember(bill.key) { mutableStateOf(setOfNotNull(parent?.id)) }
    val busy = store.orderBusy.isNotBlank()
    val limited = store.orders.count { it.source == "menu" } >= 100 || parent == null
    Card {
        Text(parent?.number ?: "Additional orders", color = Forest, fontWeight = FontWeight.Bold, fontSize = 20.sp)
        Text(listOfNotNull(parent?.customer, parent?.tableNo?.takeIf { it.isNotBlank() }?.let { "Table $it" },
            branchLabel(bill.orders.first().branch)).filter { it.isNotBlank() }.joinToString(" · "), color = Muted, fontSize = 13.sp)
        Text(if (limited) "Loaded bill total" else "Combined bill", color = Muted, fontSize = 13.sp)
        Text(bill.total?.let(::billMoney) ?: "Unavailable", color = Forest, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column { Text("Paid", color = Muted, fontSize = 12.sp); Text(bill.paid?.let(::billMoney) ?: "—", color = Forest, fontWeight = FontWeight.Bold) }
            Column(horizontalAlignment = Alignment.End) { Text("Balance", color = Muted, fontSize = 12.sp); Text(bill.balance?.let(::billMoney) ?: "—", color = Ink, fontWeight = FontWeight.Bold) }
        }
        if (limited) Text("Some order details may not be loaded. Do not use this subtotal as a payment amount.", color = Muted, fontSize = 12.sp)
        if (parent?.canAddSubOrder == true) Primary("＋ Add order", enabled = !busy) { adding = true }
        bill.orders.forEach { order ->
            androidx.compose.runtime.key(order.id) {
                val open = order.id in expanded
                val label = if (order.parentOrderId.isBlank()) "Main order" else "Additional order"
                Column(Modifier.fillMaxWidth().border(1.dp, Line, Pill).clip(Pill).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth().clickable { expanded = if (open) expanded - order.id else expanded + order.id }, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("$label · ${order.number}", color = Forest, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            Text("${order.status.replaceFirstChar { it.uppercase() }} · ${if (order.status == "cancelled") "Cancelled" else if (order.payment == "paid") "Paid" else "Unpaid"}", color = Muted, fontSize = 12.sp)
                        }
                        Text("${order.total}  ${if (open) "▴" else "▾"}", color = Forest, fontWeight = FontWeight.Bold)
                    }
                    if (open) OrderCard(store, order, insideBill = true,
                        blockCompletion = order.id == parent?.id && bill.orders.any { it.id != order.id && it.status != "cancelled" && (it.status != "completed" || it.payment != "paid") })
                }
            }
        }
        if (parent?.canAddSubOrder == true && adding) CounterAddOrderDialog(store, parent) { adding = false }
    }
}

@Composable
private fun OrderCard(store: CounterStore, order: LiveOrder, insideBill: Boolean = false, blockCompletion: Boolean = false) {
    val busy = store.orderBusy.isNotBlank()
    var adding by remember(order.id) { mutableStateOf(false) }
    var cancelling by remember(order.id) { mutableStateOf(false) }
    var voiding by remember(order.id) { mutableStateOf<OrderLine?>(null) }
    val next = when (order.status) {
        "new" -> "preparing" to "Start preparing"
        "preparing" -> "ready" to "Mark ready"
        "ready" -> "completed" to "Complete"
        else -> null
    }
    val content: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(order.number, color = Forest, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text(order.status.replaceFirstChar { it.uppercase() }, color = if (order.status == "cancelled") Bad else Forest, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
        if (order.parentOrderId.isNotBlank()) {
            val parent = store.orders.firstOrNull { it.id == order.parentOrderId }
            Text(parent?.let { "Additional order for ${it.number}" } ?: "Additional order",
                color = Muted, fontSize = 13.sp)
        }
        // When the order was placed (Philippine time). "5 min ago" refreshes every 30 seconds.
        val now by androidx.compose.runtime.produceState(System.currentTimeMillis()) {
            while (true) {
                kotlinx.coroutines.delay(30_000)
                value = System.currentTimeMillis()
            }
        }
        val placed = OrderTime.label(order.createdAt, now)
        if (placed.isNotBlank()) Text("Ordered $placed", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        if (order.payment == "pending") Text("Unpaid · confirm the test payment on the menu", color = Bad, fontSize = 13.sp)
        val unpaid = order.payment == "unpaid"
        val awaitingCash = order.source == "menu" && order.paymentMethod == "cash" && unpaid && order.status != "cancelled"
        if (awaitingCash) {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFFFF1C2)).border(1.dp, Color(0xFFE0A400), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Awaiting payment", color = Color(0xFF5C3D00), fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text("Cash · ${order.total}", color = Color(0xFF5C3D00), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        } else paymentBadge(order.paymentMethod, order.payment)?.let { badge ->
            Box(Modifier.clip(RoundedCornerShape(99.dp)).background(if (unpaid) Color(0xFFFFF1D6) else Track).padding(horizontal = 10.dp, vertical = 4.dp)) {
                Text(badge, color = if (unpaid) Color(0xFF7A4E00) else Forest, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
        Text(listOf(order.customer, branchLabel(order.branch)).filter { it.isNotBlank() }.joinToString(" · "), color = Ink, fontSize = 14.sp)
        if (order.pickup.isNotBlank()) Text("Pickup ${tidy(order.pickup)}", color = Muted, fontSize = 13.sp)
        order.items.forEach { line ->
            Text(line.name, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (line.detail.isNotBlank()) Text(line.detail, color = Muted, fontSize = 13.sp)
            if (order.canVoidItems && line.id.isNotBlank()) {
                TextButton(onClick = { voiding = line }, enabled = !busy) { Text("Void item") }
            }
        }
        if (order.note.isNotBlank()) Text(order.note, color = Muted, fontSize = 13.sp)
        Text(order.total, color = Forest, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        if (awaitingCash) {
            // Cash first: the kitchen can start only after the cashier confirms the payment.
            Primary(if (busy) "Saving" else "Mark as paid", enabled = !busy) { store.markPaid(order.id, order.rawTotal) }
            Text("Start preparing unlocks after the payment is marked paid.", color = Muted, fontSize = 12.sp)
        } else if (order.source == "menu" && order.payment == "unpaid" && order.status != "cancelled") {
            Secondary(if (busy) "Saving" else "Mark as paid") { if (!busy) store.markPaid(order.id, order.rawTotal) }
        }
        if (next != null && !awaitingCash) {
            val blocked = next.first == "completed" && blockCompletion
            Primary(if (busy) "Saving" else next.second, enabled = !busy && !blocked) { store.setOrderStatus(order.id, next.first) }
            if (blocked) Text("Finish or cancel all add-ons first.", color = Muted, fontSize = 12.sp)
        }
        if (!insideBill && order.canAddSubOrder) {
            Secondary("Add items as a separate order") { if (!busy) adding = true }
        }
        if (order.canCancel == true) {
            Secondary("Cancel order") { if (!busy) cancelling = true }
        } else if (order.canCancel == null && next != null && (order.status == "new" || order.status == "preparing")) {
            Secondary(if (busy) "Saving" else "Cancel order") { if (!busy) store.setOrderStatus(order.id, "cancelled") }
        }
    }
    if (insideBill) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { content() } else Card { content() }
    if (adding) CounterAddOrderDialog(store, order) { adding = false }
    if (cancelling) CounterAdjustmentDialog(store, order, null) { cancelling = false }
    voiding?.let { line -> CounterAdjustmentDialog(store, order, line) { voiding = null } }
}

@Composable
private fun CounterAdjustmentDialog(store: CounterStore, order: LiveOrder, line: OrderLine?, close: () -> Unit) {
    val busy = store.orderBusy.isNotBlank()
    var reason by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    var error by remember { mutableStateOf("") }
    val count = quantity.toIntOrNull()
    val valid = reason.isNotBlank() && (line == null || count != null && count in 1..line.quantity)
    val requestId = remember(quantity, reason) { UUID.randomUUID().toString() }
    val action = if (line == null) "Cancel order" else "Void item"
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { Text(action) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(line?.name ?: order.number, color = Ink)
                if (line != null && line.quantity > 1) {
                    Field("Quantity to void", quantity, { if (!busy) quantity = it.filter(Char::isDigit).take(2) }, number = true)
                }
                Field("Reason", reason, { if (!busy) reason = it.take(250) }, lines = 2)
                if (error.isNotBlank()) Text(error, color = Bad)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && valid, onClick = {
                val done: (String) -> Unit = { message ->
                    if (message.isEmpty()) close() else error = message
                }
                if (line == null) store.cancelCounterOrder(order, reason, done)
                else if (count != null) store.voidCounterItem(order, requestId, line, count, reason, done)
            }) { Text(if (busy) "Saving" else action) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Back") } }
    )
}

@Composable
private fun CounterAddOrderDialog(store: CounterStore, order: LiveOrder, close: () -> Unit) {
    val busy = store.orderBusy.isNotBlank()
    var loading by remember { mutableStateOf(true) }
    var catalog by remember { mutableStateOf<List<CounterMenuItem>>(emptyList()) }
    var item by remember { mutableStateOf<CounterMenuItem?>(null) }
    var choices by remember { mutableStateOf<Map<Int, List<OptionChoice>>>(emptyMap()) }
    var quantity by remember { mutableStateOf("1") }
    var lines by remember { mutableStateOf<List<CounterAddLine>>(emptyList()) }
    var error by remember { mutableStateOf("") }
    val requestId = remember(lines) { UUID.randomUUID().toString() }
    LaunchedEffect(order.id) {
        store.loadCounterMenu(order) { items, message ->
            catalog = items
            error = message
            loading = false
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = { Text("Additional order") },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This order has its own cash payment.", color = Muted)
                lines.forEachIndexed { index, line ->
                    Text("${line.quantity} × ${line.item.name}", color = Ink, fontWeight = FontWeight.SemiBold)
                    if (line.options.isNotEmpty()) Text(line.options.joinToString { it.name }, color = Muted)
                    TextButton(enabled = !busy, onClick = { lines = lines.filterIndexed { pos, _ -> pos != index } }) {
                        Text("Remove")
                    }
                }
                val selected = item
                if (selected != null) {
                    Text(selected.name, color = Ink, fontWeight = FontWeight.Bold)
                    selected.groups.forEachIndexed { index, group ->
                        if (group.options.isNotEmpty()) {
                            Text(group.name + if (group.minimum > 0) " · choose ${group.minimum} or more" else "", color = Muted)
                            val picked = choices[index].orEmpty()
                            group.options.forEach { option ->
                                Choice(option.name, option in picked) {
                                    if (!busy) {
                                        val updated = when {
                                            option in picked -> picked - option
                                            group.maximum == 1 -> listOf(option)
                                            picked.size < group.maximum -> picked + option
                                            else -> picked
                                        }
                                        choices = choices + (index to updated)
                                    }
                                }
                            }
                        }
                    }
                    Field("Quantity", quantity, { if (!busy) quantity = it.filter(Char::isDigit).take(2) }, number = true)
                    val count = quantity.toIntOrNull()
                    val ready = count != null && count in 1..20 &&
                        selected.groups.indices.all { choices[it].orEmpty().size >= selected.groups[it].minimum }
                    TextButton(enabled = !busy && ready, onClick = {
                        if (count != null) lines = lines + CounterAddLine(selected, count, choices.values.flatten())
                        item = null
                    }) { Text("Add to order") }
                    TextButton(enabled = !busy, onClick = { item = null }) { Text("Back to items") }
                } else if (lines.size < 40) {
                    if (loading) Text("Loading menu…", color = Muted)
                    else if (catalog.isEmpty() && error.isBlank()) Text("No items are available at this branch.", color = Muted)
                    catalog.forEach { menuItem ->
                        Choice("${menuItem.name} · ${menuItem.price}", false) {
                            if (!busy) {
                                choices = emptyMap()
                                quantity = "1"
                                item = menuItem
                            }
                        }
                    }
                }
                if (error.isNotBlank()) Text(error, color = Bad)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && lines.isNotEmpty() && item == null, onClick = {
                store.addCounterSubOrder(order, requestId, lines) { message ->
                    if (message.isEmpty()) close() else error = message
                }
            }) { Text(if (busy) "Saving" else "Create order") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Back") } }
    )
}

@Composable
private fun DailyStockCard(store: CounterStore, alwaysOpen: Boolean = false) {
    var stockVisible by remember { mutableStateOf(alwaysOpen) }
    var stockBranch by remember { mutableStateOf("") }
    var stockItem by remember { mutableStateOf("") }
    var stockVariant by remember { mutableStateOf("*") }
    var stockOpening by remember { mutableStateOf("") }
    var stockRepeat by remember { mutableStateOf(true) }
    var stockBranchMenu by remember { mutableStateOf(false) }
    var stockVariantMenu by remember { mutableStateOf(false) }
    val stockRow = store.menuStockRows.find { it.branchId == stockBranch && it.itemId == stockItem && it.variantKey == stockVariant }
    LaunchedEffect(store.menuStockBranches, store.menuStockItems) {
        if (store.menuStockBranches.none { it.id == stockBranch }) {
            stockBranch = store.menuStockBranches.firstOrNull()?.id.orEmpty()
            stockItem = ""
            stockVariant = "*"
            stockOpening = ""
        }
        if (store.menuStockItems.none { it.id == stockItem }) stockItem = ""
    }
    LaunchedEffect(alwaysOpen, store.session?.slug, store.session?.branchId) {
        if (alwaysOpen) store.loadMenuStock()
    }
        Card {
            Text("Daily stock", color = Forest, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            if (!alwaysOpen) Secondary(if (stockVisible) "Hide stock" else "Manage stock") {
                stockVisible = !stockVisible
                if (stockVisible) store.loadMenuStock()
            }
            if (stockVisible) {
                Text("${store.menuStockDay} · Philippine time", color = Muted, fontSize = 12.sp)
                if (store.menuStockBusy) Text("Updating stock…", color = Muted)
                if (store.menuStockNote.isNotBlank()) Text(store.menuStockNote, color = Bad, fontSize = 13.sp)
                Text("Branch", color = Ink, fontWeight = FontWeight.SemiBold)
                if (store.session?.role == "manager") {
                    Text(store.menuStockBranches.singleOrNull()?.name ?: "Ask the owner to assign your branch.", color = Forest, fontWeight = FontWeight.SemiBold)
                } else Box {
                    Secondary((store.menuStockBranches.find { it.id == stockBranch }?.name ?: "Choose branch") + "  ▾") {
                        if (!store.menuStockBusy) stockBranchMenu = true
                    }
                    androidx.compose.material3.DropdownMenu(expanded = stockBranchMenu, onDismissRequest = { stockBranchMenu = false }) {
                        store.menuStockBranches.forEach { branch ->
                            androidx.compose.material3.DropdownMenuItem(text = { Text(branch.name) }, onClick = {
                                stockBranch = branch.id
                                stockItem = ""
                                stockVariant = "*"
                                stockOpening = ""
                                stockBranchMenu = false
                            })
                        }
                    }
                }
                Text("Menu items", color = Ink, fontWeight = FontWeight.SemiBold)
                if (store.menuStockItems.isEmpty() && !store.menuStockBusy) Text("No menu items available.", color = Muted)
                store.menuStockItems.forEach { menuItem ->
                    val rows = store.menuStockRows.filter { it.branchId == stockBranch && it.itemId == menuItem.id }
                    val shared = rows.find { it.variantKey == "*" }
                    val variantCount = rows.count { it.variantKey != "*" }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !store.menuStockBusy && stockBranch.isNotBlank() && store.menuStockBranches.any { it.id == stockBranch }) {
                            stockItem = if (stockItem == menuItem.id) "" else menuItem.id
                            stockVariant = "*"
                            stockOpening = ""
                            stockRepeat = true
                        }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(menuItem.name, color = Ink, fontWeight = FontWeight.SemiBold)
                            Text(buildString {
                                append(if (shared == null) "No shared limit" else if (shared.remaining == 0) "Sold out" else "${shared.remaining} remaining")
                                if (variantCount > 0) append(" · $variantCount variant limits")
                            }, color = if (shared?.remaining == 0) Bad else Muted, fontSize = 13.sp)
                        }
                        Text(if (stockItem == menuItem.id) "Close" else "Edit ›", color = Forest, fontWeight = FontWeight.SemiBold)
                    }
                    if (stockItem == menuItem.id) {
                        Column(Modifier.fillMaxWidth().clip(Shape).background(Ivory).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (menuItem.variants.isNotEmpty()) {
                                Box {
                                    Secondary((if (stockVariant == "*") "All variants · shared" else menuItem.variants.find { it.id == stockVariant }?.name ?: "Choose variant") + "  ▾") {
                                        if (!store.menuStockBusy) stockVariantMenu = true
                                    }
                                    androidx.compose.material3.DropdownMenu(expanded = stockVariantMenu, onDismissRequest = { stockVariantMenu = false }) {
                                        androidx.compose.material3.DropdownMenuItem(text = { Text("All variants · shared") }, onClick = {
                                            stockVariant = "*"; stockOpening = ""; stockVariantMenu = false
                                        })
                                        menuItem.variants.forEach { option ->
                                            val variantStock = rows.find { it.variantKey == option.id }
                                            androidx.compose.material3.DropdownMenuItem(text = { Text(option.name + (variantStock?.let { " · ${it.remaining} left" } ?: " · No limit")) }, onClick = {
                                                stockVariant = option.id; stockOpening = ""; stockVariantMenu = false
                                            })
                                        }
                                    }
                                }
                            }
                            if (stockRow != null) Text("${stockRow.remaining} left · ${stockRow.reserved} reserved · ${stockRow.consumed} consumed", color = Forest, fontSize = 13.sp)
                            Field("Opening servings", stockOpening, { stockOpening = it }, hint = stockRow?.opening?.toString() ?: "e.g. 30", number = true)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Repeat every day", modifier = Modifier.weight(1f), color = Ink)
                                Switch(stockRepeat, { stockRepeat = it }, colors = switchColors(), enabled = !store.menuStockBusy)
                            }
                            Primary(if (store.menuStockBusy) "Saving…" else "Save stock", enabled = !store.menuStockBusy && store.menuStockBranches.any { it.id == stockBranch } && (stockOpening.toIntOrNull()?.let { it in 0..100000 } == true)) {
                                store.setMenuStock(stockBranch, stockItem, stockVariant, stockOpening, stockRepeat)
                            }
                        }
                    }
                }
                Text("Shared and variant limits remain independent.", color = Muted, fontSize = 12.sp)
            }
        }
}

@Composable
private fun MenuScreen(store: CounterStore) {
    var sheet by remember { mutableStateOf<MenuSheet>(MenuSheet.Closed) }
    var groupKey by remember { mutableIntStateOf(0) }
    var step by remember { mutableIntStateOf(0) }
    var forward by remember { mutableStateOf(true) }
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    var section by remember { mutableStateOf("") }
    var newSection by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var groupsPrimed by remember { mutableStateOf(false) }
    var unavailable by remember { mutableStateOf<Set<String>>(emptySet()) }
    var shown by remember { mutableStateOf(true) }
    var inStock by remember { mutableStateOf(true) }
    val view = LocalView.current
    fun go(next: Int) {
        forward = next >= step
        step = next
        tick(view)
    }
    fun openAdd() {
        tick(view)
        name = ""
        price = ""
        detail = ""
        section = ""
        newSection = ""
        selected = emptySet()
        groupsPrimed = false
        unavailable = emptySet()
        shown = true
        inStock = true
        step = 0
        store.setupStatus = ""
        sheet = MenuSheet.Add
    }
    fun openGroup(id: String?, backToAdd: Boolean) {
        groupKey += 1
        store.setupStatus = ""
        sheet = MenuSheet.Group(id, backToAdd)
    }
    LaunchedEffect(step, section) {
        if (sheet is MenuSheet.Add && step == 2 && !groupsPrimed) {
            selected = store.groupsOn(section).toSet()
            groupsPrimed = true
        }
    }
    LaunchedEffect(store.setupStatus, sheet) {
        if (store.setupStatus == "Saved." && (sheet is MenuSheet.Add || sheet is MenuSheet.Edit)) {
            sheet = MenuSheet.Closed
            confirm(view)
        }
    }
    Scroll {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Menu", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
                Text(if (store.menuRows.isEmpty()) "Add your first item with +." else "Tap an item to edit it. Turn it off when it is sold out.", color = Muted, fontSize = 15.sp)
            }
            Box(Modifier.size(40.dp).clip(CircleShape).background(Forest).clickable { openAdd() }, contentAlignment = Alignment.Center) {
                Text("+", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Medium)
            }
        }
        DailyStockCard(store)
        Card {
            Text("Hours", color = Forest, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text("One opening and one closing for the whole menu. Same every day.", color = Muted, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                Box(Modifier.weight(1f)) { Field("Opens", store.openTime, { store.openTime = it }, hint = "10:00 AM") }
                Box(Modifier.weight(1f)) { Field("Closes", store.closeTime, { store.closeTime = it }, hint = "10:00 PM") }
            }
            Secondary("Save hours") { store.saveGuest() }
            if (store.guestStatus.isNotBlank()) Text(store.guestStatus, color = Forest, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
        if (store.setupStatus.isNotBlank() && sheet is MenuSheet.Closed) Text(store.setupStatus, color = if (store.setupStatus == "Saved.") Forest else Bad, fontWeight = FontWeight.SemiBold)
        val categories = store.menuRows.map { it.category }.distinct()
        if (categories.isEmpty()) Text("No items yet.", color = Muted)
        categories.forEach { category ->
            Text(category, color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Column(Modifier.fillMaxWidth().clip(Shape).background(Color.White).border(1.dp, Line, Shape).padding(horizontal = 14.dp)) {
                store.menuRows.filter { it.category == category }.forEachIndexed { index, item ->
                    if (index > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).clickable {
                            store.setupStatus = ""
                            sheet = MenuSheet.Edit(item.id)
                        }) {
                            Text(item.name, fontWeight = FontWeight.SemiBold, color = Ink)
                            Text(if (!item.shown) "Hidden · ${item.price}" else if (item.available) item.price else "Sold out · ${item.price}", color = if (item.available && item.shown) Muted else Bad, fontSize = 13.sp)
                        }
                        Text("›", color = Muted, fontSize = 22.sp, modifier = Modifier.clickable {
                            store.setupStatus = ""
                            sheet = MenuSheet.Edit(item.id)
                        }.padding(horizontal = 8.dp))
                        Switch(item.available, { store.setMenuAvailable(item.id, it) }, colors = switchColors())
                    }
                }
            }
        }
        Text("Option groups", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text("Size, sugar, add-ons. Tap one to edit it, then tick it on an item.", color = Muted, fontSize = 13.sp)
        Column(Modifier.fillMaxWidth().clip(Shape).background(Color.White).border(1.dp, Line, Shape).padding(horizontal = 14.dp)) {
            if (store.optionGroups.isEmpty()) Text("No option groups yet.", color = Muted, fontSize = 14.sp, modifier = Modifier.padding(vertical = 12.dp))
            store.optionGroups.forEachIndexed { index, group ->
                if (index > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
                Column(Modifier.fillMaxWidth().clickable { openGroup(group.id, false) }.padding(vertical = 12.dp)) {
                    Text(group.name, fontWeight = FontWeight.SemiBold, color = Ink)
                    Text(buildString {
                        if (group.required) append("Required · ")
                        append(group.choices.ifBlank { "No choices" })
                    }, color = Muted, fontSize = 13.sp)
                }
            }
        }
        Secondary("Add option group") { openGroup(null, false) }
    }
    if (sheet !is MenuSheet.Closed) {
        ModalBottomSheet(onDismissRequest = { sheet = MenuSheet.Closed }, containerColor = Ivory, dragHandle = { BottomSheetDefaults.DragHandle(color = Muted.copy(alpha = 0.45f)) }) {
            when (val current = sheet) {
                is MenuSheet.Add -> Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp).imePadding().navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("${step + 1} of 4", color = Muted, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        repeat(4) { index -> Box(Modifier.weight(1f).height(4.dp).clip(RoundedCornerShape(99.dp)).background(if (index <= step) Forest else Line)) }
                    }
                    AnimatedContent(targetState = step, transitionSpec = {
                        val dir = if (forward) 1 else -1
                        (slideInHorizontally { it * dir } + fadeIn()).togetherWith(slideOutHorizontally { -it * dir } + fadeOut())
                    }, label = "add-item") { currentStep ->
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            when (currentStep) {
                                0 -> {
                                    Text("Where does this item go?", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                    Text("Pick a section, like Coffee or Food. You can add one here.", color = Muted)
                                    store.menuCategories.forEach { row -> Choice(row.label, section == row.id) { section = row.id; newSection = ""; groupsPrimed = false } }
                                    Field("New section", newSection, { newSection = it }, hint = "Coffee")
                                }
                                1 -> {
                                    Text("Name and price", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                    Text("One line is enough. Use 0 if it is free.", color = Muted)
                                    Field("Item name", name, { name = it }, hint = "Iced latte")
                                    Field("Price", price, { price = it }, hint = "120", number = true)
                                    Field("Description", detail, { detail = it }, hint = "12 oz, less sweet")
                                }
                                2 -> {
                                    Text("Which option groups?", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                    Text("Tick what this item can have, like Size or Sugar level.", color = Muted)
                                    if (store.optionGroups.isEmpty()) Text("No option groups yet. Add one, or continue without.", color = Muted, fontSize = 14.sp)
                                    store.optionGroups.forEach { group ->
                                        CheckLine(group.name, group.choices, group.id in selected) {
                                            groupsPrimed = true
                                            selected = if (group.id in selected) selected - group.id else selected + group.id
                                        }
                                    }
                                    Secondary("Add option group") { openGroup(null, true) }
                                }
                                else -> {
                                    Text("Which branches can sell it?", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                    Text("Ticked branches can sell this item. Untick a branch to hide it there.", color = Muted)
                                    if (store.branches.isEmpty()) Text("No branches yet. This item is available everywhere.", color = Muted, fontSize = 14.sp)
                                    store.branches.forEach { branch ->
                                        CheckLine(branch.name, "", branch.id !in unavailable) {
                                            unavailable = if (branch.id in unavailable) unavailable - branch.id else unavailable + branch.id
                                        }
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Show on the menu", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                                        Switch(shown, { shown = it }, colors = switchColors())
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("In stock now", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                                        Switch(inStock, { inStock = it }, colors = switchColors())
                                    }
                                }
                            }
                        }
                    }
                    if (store.setupStatus.isNotBlank()) Text(store.setupStatus, color = Bad, fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (step > 0) Box(Modifier.weight(1f)) { Secondary("Back") { store.setupStatus = ""; go(step - 1) } }
                        Box(Modifier.weight(1f)) {
                            when (step) {
                                0 -> Primary(if (store.loading) "Saving" else "Continue", enabled = !store.loading) {
                                    val typed = newSection.trim()
                                    if (typed.isNotEmpty()) {
                                        store.addCategory(typed) { id ->
                                            if (id != null) {
                                                section = id
                                                newSection = ""
                                                groupsPrimed = false
                                                go(1)
                                            }
                                        }
                                    } else if (section.isNotBlank()) go(1)
                                    else store.setupStatus = "Choose a section, or type a new one."
                                }
                                1 -> Primary("Continue") {
                                    if (name.isBlank()) store.setupStatus = "Enter the item name."
                                    else if (price.replace(",", "").toDoubleOrNull()?.let { it >= 0 } != true) store.setupStatus = "Enter a price. Use 0 if it is free."
                                    else { store.setupStatus = ""; go(2) }
                                }
                                2 -> Primary("Continue") { go(3) }
                                else -> Primary(if (store.loading) "Saving" else "Add item", enabled = !store.loading) {
                                    store.saveMenuItem(null, name, price, detail, section, shown, inStock, selected, unavailable.toList(), store.menuRows.size)
                                }
                            }
                        }
                    }
                }
                is MenuSheet.Edit -> {
                    val item = store.menuRows.firstOrNull { it.id == current.id }
                    if (item == null) Text("That item is not loaded.", color = Muted, modifier = Modifier.padding(24.dp))
                    else ItemEditor(store, item)
                }
                is MenuSheet.Group -> GroupEditor(store, store.optionGroups.firstOrNull { it.id == current.id }, groupKey) { id ->
                    if (id != null && current.backToAdd) selected = selected + id
                    sheet = if (current.backToAdd) MenuSheet.Add else MenuSheet.Closed
                }
                MenuSheet.Closed -> Unit
            }
        }
    }
}

@Composable
private fun ItemEditor(store: CounterStore, item: MenuRow) {
    var name by remember(item.id) { mutableStateOf(item.name) }
    var price by remember(item.id) { mutableStateOf(item.priceNumber) }
    var detail by remember(item.id) { mutableStateOf(if (item.detail == "null") "" else item.detail) }
    var categoryId by remember(item.id) { mutableStateOf(item.categoryId) }
    var shown by remember(item.id) { mutableStateOf(item.shown) }
    var inStock by remember(item.id) { mutableStateOf(item.available) }
    var selected by remember(item.id) {
        val inherited = store.groupsOn(item.categoryId).toSet()
        mutableStateOf(inherited.minus(item.excludedGroups.toSet()).plus(item.directGroups))
    }
    var unavailable by remember(item.id) { mutableStateOf(item.unavailableBranches.toSet()) }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp).imePadding().navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Edit item", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Field("Item name", name, { name = it })
        Field("Price", price, { price = it }, number = true)
        Field("Description", detail, { detail = it })
        Text("Section", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        store.menuCategories.forEach { row ->
            Choice(row.label, categoryId == row.id) {
                categoryId = row.id
                selected = store.groupsOn(row.id).toSet()
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Show on the menu", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
            Switch(shown, { shown = it }, colors = switchColors())
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("In stock now", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
            Switch(inStock, { inStock = it }, colors = switchColors())
        }
        Text("Branches that can sell it", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (store.branches.isEmpty()) Text("No branches yet. This item is available everywhere.", color = Muted, fontSize = 14.sp)
        store.branches.forEach { branch ->
            CheckLine(branch.name, "", branch.id !in unavailable) {
                unavailable = if (branch.id in unavailable) unavailable - branch.id else unavailable + branch.id
            }
        }
        Text("Option groups", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (store.optionGroups.isEmpty()) Text("No option groups yet.", color = Muted, fontSize = 14.sp)
        store.optionGroups.forEach { group ->
            CheckLine(group.name, group.choices, group.id in selected) {
                selected = if (group.id in selected) selected - group.id else selected + group.id
            }
        }
        if (store.setupStatus.isNotBlank()) Text(store.setupStatus, color = Bad, fontWeight = FontWeight.SemiBold)
        Primary(if (store.loading) "Saving" else "Save item", enabled = !store.loading) {
            store.saveMenuItem(item.id, name, price, detail, categoryId, shown, inStock, selected, unavailable.toList(), item.sortOrder)
        }
    }
}

@Composable
private fun GroupEditor(store: CounterStore, group: OptionGroup?, key: Int, onDone: (String?) -> Unit) {
    var name by remember(group?.id, key) { mutableStateOf(group?.name ?: "") }
    var required by remember(group?.id, key) { mutableStateOf(group?.required ?: false) }
    var sections by remember(group?.id, key) { mutableStateOf(group?.categoryIds?.toSet() ?: emptySet()) }
    var options by remember(group?.id, key) { mutableStateOf(if (group == null || group.options.isEmpty()) listOf(OptionChoice("new-1", "", "0")) else group.options) }
    var confirmDelete by remember(group?.id, key) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp).imePadding().navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (group == null) "Add option group" else "Edit option group", color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text("Example: Sugar level, with 0%, 50%, and 100%. The customer picks one.", color = Muted, fontSize = 14.sp)
        Field("Group name", name, { name = it }, hint = "Sugar level")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Customer must pick one", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
            Switch(required, { required = it }, colors = switchColors())
        }
        Text("Use on these sections", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (store.menuCategories.isEmpty()) Text("Add a section first, or tick this group on one item.", color = Muted, fontSize = 13.sp)
        store.menuCategories.forEach { section ->
            CheckLine(section.label, "", section.id in sections) {
                sections = if (section.id in sections) sections - section.id else sections + section.id
            }
        }
        Text("Choices", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        options.forEach { option ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                Box(Modifier.weight(1f)) { Field("Choice", option.name, { value -> options = options.map { if (it.id == option.id) it.copy(name = value) else it } }, hint = "Small") }
                Box(Modifier.width(96.dp)) { Field("₱ extra", option.price, { value -> options = options.map { if (it.id == option.id) it.copy(price = value) else it } }, hint = "0", number = true) }
            }
            if (options.size > 1) Text("Remove", color = Bad, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.clickable { options = options.filter { it.id != option.id } })
        }
        Secondary("Add a choice") { options = options + OptionChoice("new-${System.nanoTime()}", "", "0") }
        if (store.setupStatus.isNotBlank()) Text(store.setupStatus, color = Bad, fontWeight = FontWeight.SemiBold)
        Primary(if (store.loading) "Saving" else "Save group", enabled = !store.loading) {
            store.saveOptionGroup(group?.id, name, required, sections.toList(), options) { id ->
                if (id != null) onDone(id.ifBlank { null })
            }
        }
        if (group != null && !confirmDelete) Secondary("Delete group") { confirmDelete = true }
        if (confirmDelete && group != null) {
            Text("Delete ${group.name}? It will be removed from every item.", color = Bad, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { Secondary("Keep") { confirmDelete = false } }
                Box(Modifier.weight(1f)) {
                    Primary("Delete") {
                        confirmDelete = false
                        store.deleteOptionGroup(group.id)
                        onDone(null)
                    }
                }
            }
        }
    }
}

@Composable
private fun CustomersScreen(store: CounterStore, open: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val filtered = store.members.filter { query.isBlank() || it.name.contains(query, true) || it.phone.contains(query) }
    Scroll {
        Text("Customers", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text(if (query.isBlank()) "${store.members.size} loaded" else "${filtered.size} of ${store.members.size}", color = Muted)
        Field("", query, { query = it }, hint = "Search name or phone", onCard = false)
        if (filtered.isEmpty()) Text(if (store.loading) "Loading members." else if (query.isBlank()) "No members yet." else "No members match.", color = Muted)
        filtered.forEach { member ->
            Row(Modifier.fillMaxWidth().clip(Shape).background(Color.White).border(1.dp, Line, Shape).clickable { open(member.id) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(Track), contentAlignment = Alignment.Center) {
                    Text(member.name.trim().take(1).uppercase().ifBlank { "•" }, color = Forest, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(member.name, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(member.phone.ifBlank { member.email }, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("${member.stamps}", color = Forest, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("stamps", color = Muted, fontSize = 11.sp)
                }
                Spacer(Modifier.size(6.dp))
                Text("›", color = Muted, fontSize = 22.sp)
            }
        }
    }
}

@Composable
private fun CustomerScreen(store: CounterStore, id: String) {
    val member = store.members.firstOrNull { it.id == id }
    var lines by remember { mutableStateOf<List<ActivityLine>>(emptyList()) }
    var menuHistory by remember(id) { mutableStateOf<CustomerOrderHistory?>(null) }
    var menuHistoryError by remember(id) { mutableStateOf("") }
    var historyTab by remember(id) { mutableStateOf("Activity") }
    var coupon by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val context = LocalContext.current
    LaunchedEffect(id) { store.activity(id) { lines = it } }
    LaunchedEffect(id) { store.customerMenuOrders(id) { result, error -> menuHistory = result; menuHistoryError = error } }
    if (member == null) { Scroll { Text("Member not loaded.", color = Muted) }; return }
    val months = listOf("", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    val birthday = if (member.birthdayMonth in 1..12 && member.birthdayDay > 0) "${months[member.birthdayMonth]} ${member.birthdayDay}" else ""
    Scroll {
        Text(member.name, color = Forest, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text(store.cardName, color = Muted, fontWeight = FontWeight.SemiBold)
        Card {
            Info("Phone", member.phone.ifBlank { "—" })
            Info("Email", member.email.ifBlank { "—" })
            Info("Stamps", "${member.stamps} of ${store.stampGoal}")
            Info("LT Points", member.points.ifBlank { "0" })
            if (birthday.isNotBlank()) Info("Birthday", birthday)
            Info("Last visit", tidy(member.lastVisit).ifBlank { "—" })
        }
        Secondary("Share join link") {
            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, store.joinLink), "Share"))
        }
        Card {
            Text("Coupon", color = Forest, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text("Type what they get. Example: Free drink, ₱50 off.", color = Muted, fontSize = 13.sp)
            Field("Coupon", coupon, { coupon = it })
            Secondary("Add coupon") { store.giveCoupon(member.id, coupon) { note = it } }
            if (note.isNotBlank()) Text(note, color = Forest, fontWeight = FontWeight.SemiBold)
        }
        Text("Customer History", color = Forest, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Card {
            if (menuHistory == null) {
                Text(menuHistoryError.ifBlank { "Loading linked menu orders…" }, color = Muted, fontSize = 13.sp)
            } else {
                val summary = menuHistory!!
                Info("Linked orders", "${summary.orderCount}")
                Info("Completed paid orders", "${summary.paidCount}")
                Info("Verified spent", "₱${summary.totalSpent}")
                if (!summary.complete) Text("Recent linked orders only. Totals are not lifetime totals.", color = Muted, fontSize = 12.sp)
                Text("Excludes unpaid, cancelled and test payments. Other purchasing channels are not included.", color = Muted, fontSize = 12.sp)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("Activity", "Orders").forEach { choice ->
                Box(Modifier.weight(1f)) {
                    Secondary(if (historyTab == choice) "✓ $choice" else choice) { historyTab = choice }
                }
            }
        }
        if (historyTab == "Activity") {
        Text("Activity", color = Forest, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        if (lines.isEmpty()) Text(if (member.stamps > 0) "Stamps are on the card. Recent activity is still loading." else "No stamps yet.", color = Muted)
        lines.forEach { line ->
            val detail = tidyDetail(line.detail)
            val whenText = tidy(line.whenText)
            Card {
                Column {
                    Text(line.title, fontWeight = FontWeight.SemiBold, color = Ink)
                    if (detail.isNotBlank()) Text(detail, color = Muted, fontSize = 13.sp)
                    if (whenText.isNotBlank()) Text(whenText, color = Muted, fontSize = 12.sp)
                }
            }
        }
        } else {
            if (menuHistory == null) Text(menuHistoryError.ifBlank { "Loading orders…" }, color = Muted)
            else if (menuHistory!!.orders.isEmpty()) Text("No linked menu orders yet.", color = Muted)
            else menuHistory!!.orders.forEach { order ->
                Card {
                    Text(order.number.ifBlank { "Order" }, color = Forest, fontWeight = FontWeight.Bold)
                    Text("₱${order.total} · ${order.status} · ${order.paymentStatus}", color = Ink)
                    if (order.items.isNotBlank()) Text(order.items, color = Muted, fontSize = 13.sp)
                    Text(listOf(tidy(order.whenText), order.branch).filter { it.isNotBlank() }.joinToString(" · "), color = Muted, fontSize = 12.sp)
                }
            }
        }
        Text("1 LT Point per visit. This phone does not add a stamp.", color = Muted, fontSize = 13.sp)
    }
}

@Composable
private fun MoreScreen(store: CounterStore, open: (Page) -> Unit, openMenu: () -> Unit) {
    Scroll {
        Text("More", color = Forest, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text(store.session?.businessName ?: "Your business", fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 16.sp)
        Text(store.session?.email ?: "", color = Muted, fontSize = 14.sp)
        Section("What customers see", "Shown after they scan your QR.") {
            RowLink("Digital menu", when {
                store.openTime.isNotBlank() && store.closeTime.isNotBlank() -> "${store.menuRows.size} items · ${store.openTime}–${store.closeTime}"
                store.menuRows.isEmpty() -> "No items yet"
                else -> "${store.menuRows.size} items"
            }) { openMenu() }
            RowLink("Wi-Fi", if (store.wifiOn) "Shown on the scan page" else "Hidden") { open(Page.Guest("wifi")) }
            RowLink("Socials", if (store.socialsOn) "Shown on the scan page" else "Hidden") { open(Page.Guest("socials")) }
            RowLink("Book our place", if (store.bookOn) "Shown on the menu" else "Hidden") { open(Page.Guest("book")) }
            RowLink("Reserve a table", if (store.reserveOn) "Shown on the menu" else "Hidden") { open(Page.Guest("reserve")) }
        }
        Section("Your business", "The tools you use after the scan.") {
            RowLink("Analytics", "Last 30 days") { open(Page.Analytics) }
            RowLink("Notifications", "Birthday, churn, and announcements") { open(Page.Greetings) }
            RowLink("Digital billboard", if (store.billboardOn) "On · 150 m" else "Off") { open(Page.Billboard) }
            RowLink("Card setup", store.cardName) { open(Page.Card) }
            RowLink("LT Points", "1 per visit") { open(Page.Points) }
            RowLink("Cashiers", "Assign each cashier to a branch") { open(Page.Cashiers) }
            RowLink("Order alerts", if (store.alertsOn) "Ring + notification for new orders" else "Off") { open(Page.Alerts) }
        }
        Card { Column { Text("Loyalty Tree benefits", fontWeight = FontWeight.SemiBold, color = Muted); Text("Coming soon", color = Muted, fontSize = 13.sp) } }
        Card { RowLink("Account management", "Billing, details, and account") { open(Page.Account) } }
        Secondary("Log out") { store.signOut() }
    }
}

@Composable
private fun AnalyticsScreen(store: CounterStore) {
    val view = LocalView.current
    LaunchedEffect(store.session?.slug, store.period) { store.loadInsights() }
    val month = java.util.Calendar.getInstance().get(java.util.Calendar.MONTH) + 1
    val birthdays = store.members.filter { it.birthdayMonth == month && it.birthdayDay > 0 }.sortedBy { it.birthdayDay }
    val months = listOf("", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    val previous = when (store.period) {
        "today" -> "vs yesterday"
        "7d" -> "vs last week"
        "90d" -> "vs the 3 months before"
        else -> "vs last month"
    }
    Scroll {
        Text(store.analyticsProgram.ifBlank { "This business" }, color = Forest, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Track).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("Today" to "today", "This week" to "7d", "This month" to "30d", "3 months" to "90d").forEach { (label, id) ->
                val on = store.period == id
                Box(Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (on) Forest else Color.Transparent).clickable { tick(view); store.selectRange(id) }.padding(vertical = 9.dp), contentAlignment = Alignment.Center) {
                    Text(label, color = if (on) Color.White else Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                }
            }
        }
        if (store.branches.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BranchChip("All branches", store.analyticsBranch.isBlank()) { store.chooseAnalyticsBranch("") }
                store.branches.forEach { branch -> BranchChip(branch.name, store.analyticsBranch == branch.id) { store.chooseAnalyticsBranch(branch.id) } }
            }
        }
        if (store.insightRange.isNotBlank()) Text("Menu orders · ${store.insightRange} · Manila time", color = Muted, fontSize = 13.sp)

        if (store.insightKpis.isNotEmpty()) {
            store.insightKpis.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { KpiCard(it, previous, Modifier.weight(1f)) }
                }
            }
        }
        if (store.insightTrend.any { it.orders > 0 }) {
            Text(when (store.insightTrendUnit) { "hour" -> "Sales by hour"; "week" -> "Sales by week"; else -> "Sales by day" }, color = Forest, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Card { TrendChart(store.insightTrend) }
        }
        if (store.insightItems.isNotEmpty()) {
            Text("Top items", color = Forest, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Card {
                val peak = store.insightItems.maxOf { it.quantity }.coerceAtLeast(1)
                store.insightItems.forEachIndexed { index, item -> RankedRow(index + 1, item, peak) }
            }
        }
        if (store.insightCards.isNotEmpty()) {
            Text("Who orders what", color = Forest, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            store.insightCards.forEach { InsightCardView(it) }
        }
        if (store.insightsLoading && store.insightKpis.isEmpty()) Text("Loading menu orders…", color = Muted, fontSize = 13.sp)
        if (store.insightsNote.isNotBlank()) Text(store.insightsNote, color = Muted, fontSize = 12.sp)

        Text("Loyalty card", color = Forest, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("Stamps", if (store.period == "today") store.todayStamps else store.cardStamps, Modifier.weight(1f))
            Metric("Rewards", if (store.period == "today") store.todayRewards else store.cardRewards, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("New", if (store.period == "today") store.todayNew else store.cardNew, Modifier.weight(1f))
            Metric("Active", if (store.period == "today") "—" else store.cardActive, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("Members", store.memberCount, Modifier.weight(1f))
            Metric("Gone quiet", store.churnCount.toString(), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("Came back", "${store.cameBackRate.toInt()}%", Modifier.weight(1f))
            Metric("Per active", if (store.period == "today") "—" else store.cardAverage, Modifier.weight(1f))
        }
        Text("Birthdays this month", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(if (birthdays.isEmpty()) "No birthdays this month." else "${birthdays.size} ${if (birthdays.size == 1) "member" else "members"}.", color = Forest, fontWeight = FontWeight.SemiBold)
        birthdays.take(6).forEach { member ->
            Card { Info(member.name, "${months.getOrElse(member.birthdayMonth) { "" }} ${member.birthdayDay}") }
        }
        if (store.topMembers.isNotEmpty()) {
            Text("Most stamps on a card", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Card { store.topMembers.forEach { Info(it.name, it.detail) } }
        }
        if (store.hourBars.isNotEmpty() && store.period != "today") {
            Text("Card activity by hour", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Card {
                val peak = store.hourBars.maxOf { it.count }.coerceAtLeast(1)
                store.hourBars.forEach { MiniBar(it.label, it.count, peak) }
            }
        }
        if (store.analyticsNote.isNotBlank()) Text(store.analyticsNote, color = Muted, fontSize = 13.sp)
    }
}

private fun plural(count: Int, word: String): String = "$count ${if (count == 1) word else word + "s"}"

private fun peso(amount: Double): String {
    val whole = amount.toLong()
    return if (amount - whole < 0.005) "₱" + String.format(Locale.US, "%,d", whole) else "₱" + String.format(Locale.US, "%,.2f", amount)
}

private val Amber = Color(0xFF8A5A00)

@Composable
private fun KpiCard(kpi: Kpi, previous: String, modifier: Modifier) {
    Column(modifier.clip(Shape).background(Color.White).border(1.dp, Line, Shape).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(kpi.label, color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Text(kpi.value, color = Forest, fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val change = kpi.change
        if (change == null) {
            Text("No earlier data", color = Muted, fontSize = 11.sp)
        } else {
            val up = change >= 0
            val amount = if (kpi.inPoints) "${String.format(Locale.US, "%.0f", kotlin.math.abs(change))} pts" else "${String.format(Locale.US, "%.0f", kotlin.math.abs(change))}%"
            Text("${if (up) "▲" else "▼"} $amount $previous", color = if (up) Gold else Bad, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun TrendChart(bars: List<TrendBar>) {
    val peak = bars.maxOf { it.sales }.coerceAtLeast(1.0)
    val best = bars.maxByOrNull { it.sales }
    if (best != null && best.sales > 0) Text("Best: ${best.label} · ${peso(best.sales)}", color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    Canvas(Modifier.fillMaxWidth().height(140.dp)) {
        val count = bars.size.coerceAtLeast(1)
        val slot = size.width / count
        val barWidth = (slot * 0.64f).coerceAtLeast(2f)
        drawLine(Line, Offset(0f, size.height - 1f), Offset(size.width, size.height - 1f), strokeWidth = 2f)
        bars.forEachIndexed { index, bar ->
            val h = (bar.sales / peak).toFloat() * (size.height - 6f)
            if (h > 0f) {
                drawRoundRect(
                    color = if (bar == best) Forest else Gold.copy(alpha = 0.55f),
                    topLeft = Offset(index * slot + (slot - barWidth) / 2f, size.height - h),
                    size = Size(barWidth, h),
                    cornerRadius = CornerRadius(barWidth / 4f, barWidth / 4f)
                )
            }
        }
    }
    // A few labels under the chart, so it stays readable with 30+ bars.
    val step = when {
        bars.size <= 8 -> 1
        bars.size <= 16 -> 2
        else -> (bars.size + 5) / 6
    }
    Row(Modifier.fillMaxWidth()) {
        bars.forEachIndexed { index, bar ->
            Text(if (index % step == 0) bar.label else "", color = Muted, fontSize = 10.sp, maxLines = 1, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun ShareBar(fraction: Float, strong: Boolean) {
    Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(99.dp)).background(Track)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0.02f, 1f)).height(10.dp).clip(RoundedCornerShape(99.dp)).background(if (strong) Forest else Gold.copy(alpha = 0.7f)))
    }
}

@Composable
private fun RankedRow(rank: Int, item: RankedItem, peak: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("$rank", color = if (rank == 1) Forest else Muted, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.width(24.dp))
            Text(item.name, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text("×${item.quantity}", color = Forest, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            if (item.sales != "₱0") Text("  ${item.sales}", color = Muted, fontSize = 13.sp)
        }
        Box(Modifier.padding(start = 24.dp)) { ShareBar(item.quantity.toFloat() / peak, rank == 1) }
    }
}

@Composable
private fun InsightCardView(card: InsightCard) {
    Card {
        Text(card.title, color = Forest, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        if (card.groups.isEmpty()) {
            Text("Need more orders to show this", color = Muted, fontSize = 13.sp)
        } else {
            val leader = card.groups.maxOf { it.orders }
            card.groups.forEach { group ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(group.label, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text("${group.share.toInt()}%", color = Forest, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text("  ${plural(group.orders, "order")}", color = Muted, fontSize = 12.sp)
                    }
                    ShareBar((group.share / 100.0).toFloat(), group.orders == leader)
                    if (group.topItem.isNotBlank()) Text("Most ordered: ${group.topItem}", color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (card.hiddenGroups > 0) Text("Need more orders to show ${if (card.hiddenGroups == 1) "1 more group" else "${card.hiddenGroups} more groups"}", color = Muted, fontSize = 12.sp)
        }
        if (card.note.isNotBlank() && card.groups.isNotEmpty()) Text(card.note, color = Muted, fontSize = 11.sp)
    }
}

private fun startCodeScan(context: Context, onCode: (String) -> Unit, onFail: (String) -> Unit) {
    // Google code scanner: Play services shows the camera UI, so the app needs no camera permission.
    val options = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_AZTEC, Barcode.FORMAT_PDF417, Barcode.FORMAT_CODE_128)
        .build()
    runCatching {
        GmsBarcodeScanning.getClient(context, options).startScan()
            .addOnSuccessListener { code ->
                val raw = code.rawValue
                if (raw.isNullOrBlank()) onFail("Could not read that code. Try again.") else onCode(raw)
            }
            .addOnCanceledListener { }
            .addOnFailureListener { error ->
                onFail("The scanner could not start${error.message?.let { ": $it" } ?: ""}. Make sure Google Play services is up to date, then try again.")
            }
    }.onFailure { onFail("The scanner could not start on this phone. Search the customer by name instead.") }
}

@Composable
private fun StampScreen(store: CounterStore) {
    val context = LocalContext.current
    val view = LocalView.current
    var query by remember { mutableStateOf("") }
    var stampCount by remember { mutableIntStateOf(1) }
    var amount by remember { mutableStateOf("") }
    fun scan() {
        store.clearScan()
        startCodeScan(context, { code -> stampCount = 1; amount = ""; store.lookupScan(code) }) { message -> store.scanFailed(message) }
    }
    LaunchedEffect(Unit) { if (store.scanCustomer == null) scan() }
    LaunchedEffect(store.scanDone) { if (store.scanDone.isNotBlank()) confirm(view) }
    val customer = store.scanCustomer
    Scroll {
        if (customer == null) {
            Primary(if (store.scanBusy) "Reading card" else "Scan customer's card", enabled = !store.scanBusy) { scan() }
            Text("Scan the QR on the customer's Apple or Google Wallet card.", color = Muted, fontSize = 13.sp)
            if (store.scanNote.isNotBlank()) Text(store.scanNote, color = Bad, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (store.session?.isOwner != true) return@Scroll
            Text("Or find the customer", color = Forest, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Field("Name or phone", query, { query = it })
            val clean = query.trim().lowercase()
            val digits = clean.filter { it.isDigit() }
            if (clean.length >= 2) {
                val hits = store.members.filter { member ->
                    member.name.lowercase().contains(clean) || (digits.length >= 3 && member.phone.filter { it.isDigit() }.contains(digits))
                }.take(12)
                if (hits.isEmpty()) Text("No customer matches \"${query.trim()}\".", color = Muted, fontSize = 13.sp)
                hits.forEach { member ->
                    RowLink(member.name, listOf(member.phone, if (store.cardType == "points") "${member.points} pts" else plural(member.stamps, "stamp")).filter { it.isNotBlank() }.joinToString(" · ")) {
                        stampCount = 1
                        amount = ""
                        store.loadScanCustomer(member.id)
                    }
                }
            }
            return@Scroll
        }
        Card {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(customer.name, color = Forest, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (customer.phone.isNotBlank()) Text(customer.phone, color = Muted, fontSize = 13.sp)
                }
                if (customer.rewardReady) {
                    Box(Modifier.clip(RoundedCornerShape(99.dp)).background(Lime).padding(horizontal = 12.dp, vertical = 6.dp)) {
                        Text("Reward ready", color = Forest, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
            if (customer.usesPoints) {
                Text("${String.format(Locale.US, "%,d", customer.points)} points", color = Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                when {
                    customer.rewardReady && customer.rewardName.isNotBlank() -> Text("Can redeem: ${customer.rewardName}", color = Forest, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    customer.nextPrizeCost > 0 -> {
                        ShareBar(customer.points.toFloat() / customer.nextPrizeCost, true)
                        Text("${customer.nextPrizeCost - customer.points} more points for ${customer.nextPrize}", color = Muted, fontSize = 13.sp)
                    }
                }
            } else {
                Text("${customer.stamps} / ${customer.goal} stamps", color = Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                ShareBar(customer.stamps.toFloat() / customer.goal, true)
                Text(
                    if (customer.rewardReady) "${customer.rewardName} is ready to claim."
                    else "${plural(customer.goal - customer.stamps, "more stamp")} for ${customer.rewardName}",
                    color = if (customer.rewardReady) Forest else Muted, fontSize = 13.sp, fontWeight = if (customer.rewardReady) FontWeight.SemiBold else FontWeight.Normal
                )
            }
        }
        if (store.scanDone.isNotBlank()) Text(store.scanDone, color = Forest, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        if (store.scanNote.isNotBlank()) Text(store.scanNote, color = Bad, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        if (customer.usesPoints) {
            Field("Amount spent (₱)", amount, { amount = it.filter { ch -> ch.isDigit() || ch == '.' } }, number = true)
            val spent = amount.toDoubleOrNull() ?: 0.0
            val earn = store.previewPoints(spent, customer)
            Text(
                if (customer.pointsPer > 0) "${peso(customer.pesosPer)} = ${plural(customer.pointsPer.toInt(), "point")}" + (if (spent > 0) " · this sale earns ${plural(earn, "point")}" else "")
                else "Points rule not set. Set it in Card settings.",
                color = Muted, fontSize = 13.sp
            )
            Primary(if (store.scanBusy) "Saving" else if (earn > 0) "Add ${plural(earn, "point")}" else "Add points", enabled = !store.scanBusy && spent > 0) {
                store.addSalePoints(amount)
                amount = ""
            }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                // Removing stamps is a correction for the owner and managers only.
                val lowest = if (store.session?.canCorrectStamps == true) -customer.stamps.coerceIn(0, 10) else 1
                StepButton("−", enabled = (if (stampCount == 1) -1 else stampCount - 1) >= lowest) {
                    stampCount = (stampCount - 1).let { if (it == 0) -1 else it }
                }
                Text(if (stampCount > 0) "+$stampCount" else "$stampCount", color = if (stampCount < 0) Bad else Forest, fontSize = 34.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.width(96.dp))
                StepButton("+", enabled = stampCount < 10) {
                    stampCount = (stampCount + 1).let { if (it == 0) 1 else it }
                }
            }
            Primary(
                when {
                    store.scanBusy -> "Saving"
                    stampCount > 0 -> "Add ${plural(stampCount, "stamp")}"
                    else -> "Remove ${plural(-stampCount, "stamp")}"
                },
                enabled = !store.scanBusy
            ) {
                store.changeStamps(stampCount)
                stampCount = 1
            }
            if (customer.rewardReady) Secondary(if (store.scanBusy) "Saving" else "Redeem reward") { if (!store.scanBusy) store.redeemStampReward() }
        }
        Secondary("Scan next customer") { scan() }
    }
}

@Composable
private fun StepButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    val view = LocalView.current
    Box(
        Modifier.size(56.dp).clip(CircleShape).background(if (enabled) Track else Line).clickable(enabled = enabled) { tick(view); onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = if (enabled) Forest else Muted, fontSize = 28.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun CampaignScreen(store: CounterStore) {
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("percent_discount") }
    var value by remember { mutableStateOf("10") }
    var scope by remember { mutableStateOf("nationwide") }
    var branchId by remember { mutableStateOf("") }
    val start = store.manila()
    val endCal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Manila")).apply { add(java.util.Calendar.DAY_OF_YEAR, 7) }
    val end = store.manila(endCal)
    LaunchedEffect(Unit) { store.loadCampaigns() }
    Scroll {
        Text("Members who buy during these dates get the voucher. Stamps stay the same.", color = Muted)
        Field("Campaign name", name, { name = it })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("percent_discount" to "% off", "fixed_discount" to "₱ off", "buy_one_take_one" to "Buy 1 Take 1").forEach { item ->
                Box(Modifier.weight(1f)) { Choice(item.second, kind == item.first) { kind = item.first } }
            }
        }
        if (kind != "buy_one_take_one") Field(if (kind == "percent_discount") "Percent" else "Pesos", value, { value = it })
        Text("Starts $start · ends $end", color = Muted, fontSize = 13.sp)
        Text("The coupon disappears after the end date.", color = Muted, fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { Choice("Whole business", scope == "nationwide") { scope = "nationwide" } }
            Box(Modifier.weight(1f)) { Choice("One branch", scope == "single_branch") { scope = "single_branch" } }
        }
        if (scope == "single_branch") store.branches.forEach { branch -> Choice(branch.name, branchId == branch.id) { branchId = branch.id } }
        if (store.campaignNote.isNotBlank()) Text(store.campaignNote, color = if (store.campaignNote.startsWith("Started")) Forest else Bad, fontWeight = FontWeight.SemiBold)
        Primary(if (store.loading) "Starting" else "Start campaign", enabled = !store.loading) {
            store.startCampaign(name, kind, value, start, end, scope, branchId)
        }
        store.campaigns.forEach { row ->
            Card { Column { Text(row.name, fontWeight = FontWeight.SemiBold); Text(row.detail, color = Muted, fontSize = 13.sp) } }
        }
    }
}

@Composable
private fun BillboardScreen(store: CounterStore) {
    val context = LocalContext.current
    val location = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) { store.status = "Location was not allowed. Type the pin instead."; return@rememberLauncherForActivityResult }
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val place = runCatching { manager.getLastKnownLocation(LocationManager.GPS_PROVIDER) ?: manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) }.getOrNull()
        if (place == null) store.status = "Location was not ready. Type the pin instead."
        else {
            store.pinLat = String.format(Locale.US, "%.6f", place.latitude)
            store.pinLng = String.format(Locale.US, "%.6f", place.longitude)
        }
    }
    Scroll {
        Text("150 meters. iPhone can show your line. Android only says they are nearby.", color = Muted)
        if (!store.billboardAllowed) {
            Card { Text(store.billboardNote.ifBlank { "Nearby alerts are not on this plan." }) }
        } else {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (store.billboardOn) "On" else "Off", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Ink)
                        Text(store.pinLabel.ifBlank { "Saved pin" }, color = Muted, fontSize = 13.sp)
                    }
                    Switch(store.billboardOn, { store.billboardOn = it }, colors = switchColors())
                }
            }
            Card {
                Text("Lock screen", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Field("Short line", store.billboardMessage, { store.billboardMessage = it.take(80) })
                Text("${store.billboardMessage.length} / 80", color = Muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End)
            }
            Card {
                Text("Location", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Field("Place name", store.pinLabel, { store.pinLabel = it })
                Field("Latitude", store.pinLat, { store.pinLat = it })
                Field("Longitude", store.pinLng, { store.pinLng = it })
                Secondary("Use this phone's location") { location.launch(Manifest.permission.ACCESS_FINE_LOCATION) }
            }
            Column(Modifier.fillMaxWidth().clip(Shape).background(Forest).padding(14.dp)) {
                Text(store.session?.businessName ?: "LoyaltyTree", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(if (store.billboardOn) store.billboardMessage.ifBlank { "Your line" } else "Billboard is off.", color = Color.White, fontSize = 15.sp)
            }
            if (store.status.isNotBlank()) Text(store.status, color = Forest, fontWeight = FontWeight.SemiBold)
            Text("Save is at the top right.", color = Muted, fontSize = 13.sp)
        }
    }
}

@Composable
private fun GreetingsScreen(store: CounterStore) {
    var title by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var scope by remember { mutableStateOf("business") }
    var branch by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { store.refresh() }
    Scroll {
        Text("Birthday ${store.birthdaySent} sent this week. Churn ${store.churnSent} sent this week.", color = Muted)
        Card {
            Text("Announcement", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink)
            Text("Pushes to the wallet. Choose the whole business or one branch.", color = Muted, fontSize = 13.sp)
            Field("Title", title, { title = it })
            Field("Message", message, { message = it })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { Choice("Whole business", scope == "business") { scope = "business" } }
                Box(Modifier.weight(1f)) { Choice("One branch", scope == "branch") { scope = "branch" } }
            }
            if (scope == "branch") store.branches.forEach { row -> Choice(row.name, branch == row.id) { branch = row.id } }
            if (store.announcementNote.isNotBlank()) Text(store.announcementNote, color = if (store.announcementNote.startsWith("Sent")) Forest else Bad, fontWeight = FontWeight.SemiBold)
            Primary(if (store.loading) "Sending" else "Send announcement", enabled = !store.loading) { store.sendAnnouncement(title, message, scope, branch) }
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Birthday greeting", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), color = Ink)
                Switch(store.birthdayOn, { store.birthdayOn = it }, colors = switchColors())
            }
            Field("Birthday message", store.birthdayMessage, { store.birthdayMessage = it.take(500) })
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Birthday coupon", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), color = Ink)
                Switch(store.birthdayRewardOn, { store.birthdayRewardOn = it }, colors = switchColors())
            }
            Field("Coupon name", store.birthdayRewardName, { store.birthdayRewardName = it.take(80) })
            StepRow("Valid ${store.birthdayRewardDays} days", { if (store.birthdayRewardDays > 1) store.birthdayRewardDays-- }, { if (store.birthdayRewardDays < 60) store.birthdayRewardDays++ })
            listOf("birthday" to "On the birthday", "1_day_before" to "1 day before", "3_days_before" to "3 days before", "7_days_before" to "7 days before", "month_start" to "Start of the month").forEach { option ->
                Choice(option.second, store.birthdayTiming == option.first) { store.birthdayTiming = option.first }
            }
        }
        Card {
            Text("Churn greeting", fontWeight = FontWeight.Bold, color = Ink)
            StepRow("After ${store.churnDays} quiet days", { if (store.churnDays > 7) store.churnDays-- }, { if (store.churnDays < 365) store.churnDays++ })
            Field("Come back message", store.churnMessage, { store.churnMessage = it.take(500) })
        }
        if (store.setupStatus.isNotBlank()) Text(store.setupStatus, color = Forest, fontWeight = FontWeight.SemiBold)
        Primary(if (store.loading) "Saving" else "Save greetings", enabled = !store.loading) { store.saveGreetings() }
    }
}

@Composable
private fun GuestScreen(store: CounterStore, part: String) {
    Scroll {
        Text("What your customers see when they scan your QR.", color = Muted)
        Card {
            when (part) {
                "wifi" -> {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Show Wi-Fi", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink); Switch(store.wifiOn, { store.wifiOn = it }, colors = switchColors()) }
                    Field("Network name", store.wifiName, { store.wifiName = it })
                    Field("Password", store.wifiPassword, { store.wifiPassword = it }, password = true)
                }
                "socials" -> {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Show socials", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink); Switch(store.socialsOn, { store.socialsOn = it }, colors = switchColors()) }
                    Field("Instagram", store.instagramURL, { store.instagramURL = it })
                    Field("Facebook", store.facebookURL, { store.facebookURL = it })
                    Field("Google review", store.reviewURL, { store.reviewURL = it })
                }
                "book" -> {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Show on the menu", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink); Switch(store.bookOn, { store.bookOn = it }, colors = switchColors()) }
                    Field("Link", store.bookURL, { store.bookURL = it }, hint = "https://")
                    AvailabilityEditor(store.bookNote, { store.bookNote = it }, "book")
                }
                else -> {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Show on the menu", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink); Switch(store.reserveOn, { store.reserveOn = it }, colors = switchColors()) }
                    Field("Link", store.reserveURL, { store.reserveURL = it }, hint = "https://")
                    AvailabilityEditor(store.reserveNote, { store.reserveNote = it }, "reserve a table")
                }
            }
        }
        if (store.guestStatus.isNotBlank()) Text(store.guestStatus, color = Forest, fontWeight = FontWeight.SemiBold)
        Text("Save is at the top right.", color = Muted, fontSize = 13.sp)
    }
}

@Composable
private fun AvailabilityEditor(note: String, onNote: (String) -> Unit, verb: String) {
    val month = remember {
        val zone = TimeZone.getTimeZone("Asia/Manila")
        SimpleDateFormat("MMMM yyyy", Locale.US).apply { timeZone = zone }.format(java.util.Date())
    }
    val wholeLine = "Available the whole month ($month)."
    val whole = note.trim().startsWith("Available the whole month")
    Text("When they can $verb", color = Ink, fontWeight = FontWeight.SemiBold)
    Text("Write the days and hours, or open it for the whole month. Customers see this after they scan.", color = Muted, fontSize = 13.sp)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f)) {
            Choice("Specific", !whole) { if (whole) onNote("") }
        }
        Box(Modifier.weight(1f)) {
            Choice("Whole month", whole) { onNote(wholeLine) }
        }
    }
    if (whole) {
        Text(if (note.isBlank()) wholeLine else note.trim(), color = Forest, fontWeight = FontWeight.SemiBold)
    } else {
        Field("Available", note, onNote, hint = "Sat and Sun, 10 am–6 pm", lines = 3)
    }
}

@Composable
private fun CardScreen(store: CounterStore) {
    var hexText by remember { mutableStateOf(store.cardColor) }
    var milestoneStamps by remember { mutableStateOf("") }
    var milestoneName by remember { mutableStateOf("") }
    var milestoneNote by remember { mutableStateOf("") }
    var prizeCost by remember { mutableStateOf("") }
    var prizeName by remember { mutableStateOf("") }
    val palette = listOf("#81d6d6", "#073f36", "#102d28", "#0f766e", "#1d4e89", "#9f2d2d", "#d7b578")
    val preview = hexColor(store.cardColor) ?: Forest
    Scroll {
        Column(Modifier.fillMaxWidth().clip(Shape).background(preview).padding(16.dp)) {
            Text(store.cardName.ifBlank { "Loyalty card" }, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(when (store.cardType) {
                "points" -> "${store.pointsPer} points per ₱${store.pointsPesos}"
                "membership" -> "${store.membershipDays} days · ₱${store.membershipPrice}"
                else -> "${store.stampGoal} stamps · ${store.rewardName}"
            }, color = Color.White.copy(alpha = 0.88f), fontSize = 14.sp)
        }
        Text("Card name, rewards, color, welcome reward, and the signup agreement. Save is at the top right.", color = Muted, fontSize = 14.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("stamp" to "Stamps", "points" to "Points", "membership" to "Subscription").forEach { (id, label) ->
                val on = store.cardType == id
                Box(Modifier.weight(1f).height(40.dp).clip(Pill).background(if (on) Forest else Color.White).border(1.dp, if (on) Forest else Line, Pill).clickable { store.cardType = id }, contentAlignment = Alignment.Center) {
                    Text(label, color = if (on) Color.White else Forest, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, maxLines = 1)
                }
            }
        }
        Field("Card name", store.cardName, { store.cardName = it })
        Text("Customer agreement", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Text("Off is a normal signup. Checkbox is terms only. Signature asks them to sign.", color = Muted, fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("off" to "Off", "checkbox" to "Checkbox", "signature" to "Signature").forEach { (id, label) ->
                Box(Modifier.weight(1f)) { Choice(label, store.agreementMode == id) { store.agreementMode = id } }
            }
        }
        if (store.agreementMode != "off") {
            Field("Title", store.agreementTitle, { store.agreementTitle = it })
            Field("Terms", store.agreementBody, { store.agreementBody = it }, lines = 4)
            Field("Checkbox line", store.agreementAck, { store.agreementAck = it })
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Welcome reward", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                Switch(store.welcomeOn, { store.welcomeOn = it }, colors = switchColors())
            }
            if (store.welcomeOn) {
                Field("Reward name", store.welcomeName, { store.welcomeName = it }, hint = "Free drink")
                Choice("When they join", store.welcomeTrigger == "join") { store.welcomeTrigger = "join" }
                Choice("After the first purchase", store.welcomeTrigger == "first_purchase") { store.welcomeTrigger = "first_purchase" }
                StepRow("Valid ${store.welcomeDays} days", { if (store.welcomeDays > 1) store.welcomeDays-- }, { if (store.welcomeDays < 365) store.welcomeDays++ })
            }
        }
        Text("Color", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            palette.forEach { hex ->
                val color = hexColor(hex) ?: Forest
                Box(Modifier.size(32.dp).clip(CircleShape).background(color).border(2.dp, if (store.cardColor.equals(hex, true)) Ink else Color.Transparent, CircleShape).clickable {
                    store.cardColor = hex
                    hexText = hex
                })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            Box(Modifier.weight(1f)) { Field("Hex", hexText, { hexText = it }, hint = "#073f36") }
            Box(Modifier.width(88.dp)) {
                Primary("Use") {
                    val next = normalizeHex(hexText)
                    if (next == null) store.setupStatus = "Use a color like #073f36."
                    else {
                        store.cardColor = next
                        hexText = next
                        store.setupStatus = ""
                    }
                }
            }
        }
        Card {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Expire the card", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                Switch(store.cardExpires, { store.cardExpires = it }, colors = switchColors())
            }
            Text("Each customer's cycle starts when they join.", color = Muted, fontSize = 13.sp)
            if (store.cardExpires) StepRow("${store.cardExpireDays} days", { if (store.cardExpireDays > 1) store.cardExpireDays-- }, { if (store.cardExpireDays < 3650) store.cardExpireDays++ })
        }
        if (store.cardType == "stamp") {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("One stamp a day", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                    Switch(store.stampOnce, { store.stampOnce = it }, colors = switchColors())
                }
            }
            Text("Rewards and milestones", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text("Example: 4 stamps, then a free drink. The last milestone is the full card.", color = Muted, fontSize = 13.sp)
            if (store.stampRewards.isEmpty()) {
                Field("Final reward", store.rewardName, { store.rewardName = it })
                StepRow("Stamp goal ${store.stampGoal}", { if (store.stampGoal > 1) store.stampGoal-- }, { store.stampGoal++ })
            }
            store.stampRewards.forEach { reward ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${reward.stamps} stamps → ${reward.name}", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                    Text("Remove", color = Bad, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable {
                        val next = store.stampRewards.filter { it.id != reward.id }
                        store.stampRewards = next
                        next.lastOrNull()?.let { store.stampGoal = it.stamps; store.rewardName = it.name }
                    })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                Box(Modifier.width(96.dp)) { Field("Stamps", milestoneStamps, { milestoneStamps = it.filter { ch -> ch.isDigit() } }, number = true) }
                Box(Modifier.weight(1f)) { Field("Reward", milestoneName, { milestoneName = it }, hint = "Free drink") }
            }
            if (milestoneNote.isNotBlank()) Text(milestoneNote, color = Bad, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Secondary("Add stamp reward") {
                val stamps = milestoneStamps.toIntOrNull()
                val reward = milestoneName.trim()
                milestoneNote = when {
                    stamps == null || stamps <= 0 -> "Enter how many stamps."
                    reward.isEmpty() -> "Enter the reward name."
                    store.stampRewards.any { it.stamps == stamps } -> "That stamp count already has a reward."
                    else -> ""
                }
                if (milestoneNote.isEmpty() && stamps != null) {
                    val next = (store.stampRewards + StampReward("new-$stamps", stamps, reward)).sortedBy { it.stamps }
                    store.stampRewards = next
                    store.stampGoal = next.last().stamps
                    store.rewardName = next.last().name
                    milestoneStamps = ""
                    milestoneName = ""
                }
            }
        }
        if (store.cardType == "points") {
            Text("How they earn", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                Box(Modifier.weight(1f)) { Field("Points", store.pointsPer, { store.pointsPer = it }, number = true) }
                Box(Modifier.weight(1f)) { Field("For every ₱", store.pointsPesos, { store.pointsPesos = it }, number = true) }
            }
            Field("Maximum points", store.pointsCap, { store.pointsCap = it.filter { ch -> ch.isDigit() } }, hint = "Blank means no limit", number = true)
            Text("Points rewards", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            store.pointsPrizes.forEach { prize ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${prize.cost} points → ${prize.name}", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                    Text("Remove", color = Bad, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable {
                        store.pointsPrizes = store.pointsPrizes.filter { it.id != prize.id }
                    })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                Box(Modifier.width(96.dp)) { Field("Points", prizeCost, { prizeCost = it.filter { ch -> ch.isDigit() } }, number = true) }
                Box(Modifier.weight(1f)) { Field("Reward", prizeName, { prizeName = it }, hint = "Free drink") }
            }
            Secondary("Add points reward") {
                val cost = prizeCost.toIntOrNull()
                val reward = prizeName.trim()
                if (reward.isNotEmpty() && cost != null && cost > 0) {
                    store.pointsPrizes = store.pointsPrizes + PointsPrize("new-$cost", reward, cost.toString())
                    prizeCost = ""
                    prizeName = ""
                    store.setupStatus = ""
                } else store.setupStatus = "Enter the points and the reward name."
            }
        }
        if (store.cardType == "membership") {
            Text("Subscription", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            StepRow("${store.membershipDays} days", { if (store.membershipDays > 1) store.membershipDays-- }, { if (store.membershipDays < 3650) store.membershipDays++ })
            Field("Price in pesos", store.membershipPrice, { store.membershipPrice = it }, number = true)
            Field("Perks, one per line", store.membershipPerks, { store.membershipPerks = it }, lines = 4, hint = "Unlimited access")
            Field("Terms", store.membershipTerms, { store.membershipTerms = it }, lines = 3)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Log a visit in the cashier", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                Switch(store.membershipVisits, { store.membershipVisits = it }, colors = switchColors())
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Quick check-in", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
                Switch(store.membershipQuick, { store.membershipQuick = it }, colors = switchColors())
            }
        }
        if (store.setupStatus.isNotBlank()) Text(store.setupStatus, color = if (store.setupStatus.startsWith("Card saved")) Forest else Bad, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PointsScreen() {
    Scroll {
        Text("1 point per visit.", color = Forest, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text("A customer earns one LT Point when they visit this business. Not one point for every stamp on the card.", color = Muted, fontSize = 16.sp)
    }
}

@Composable
private fun AccountScreen(store: CounterStore, openBilling: () -> Unit) {
    LaunchedEffect(Unit) { store.loadAccount(); store.loadBilling() }
    Scroll {
        Card {
            Info("Business", store.session?.businessName ?: "")
            Info("Contact", store.accountContact.ifBlank { "—" })
            Info("Email", store.session?.email ?: "")
            Info("Mobile", store.accountPhone.ifBlank { "—" })
            Info("Address", store.accountAddress.ifBlank { "—" })
            Info("Status", store.accountStatus.ifBlank { "—" })
        }
        Card { RowLink("Billing", if (store.billPlan.isBlank()) "Plan and payment" else "${store.billPlan} · ${store.billDays} days left") { openBilling() } }
    }
}

@Composable
private fun BillingScreen(store: CounterStore) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { store.loadBilling() }
    Scroll {
        Text(if (store.billPlan.isBlank()) "Loading the plan" else "${store.billPlan} · ${store.billStatus}", fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 18.sp)
        if (store.billDays.isNotBlank()) Text("${store.billDays} days left${if (store.billExpires.isBlank()) "" else " · until ${store.billExpires}"}", color = Muted)
        store.billPrices.forEach { price -> Card { Info(price.label, "₱${price.pesos}") } }
        Text("Payment is on the website. This app does not charge a card or show a payment QR.", color = Muted)
        Primary("Manage billing on the website") { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://theloyaltytree.com/login"))) }
        if (store.billingNote.isNotBlank()) Text(store.billingNote, color = Bad, fontWeight = FontWeight.SemiBold)
        store.billPays.forEach { pay -> Card { Column { Text(pay.title, fontWeight = FontWeight.SemiBold); Text(pay.detail, color = Muted, fontSize = 13.sp) } } }
    }
}

@Composable
private fun Scroll(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
}

@Composable
private fun Mark(size: Int) {
    Image(painterResource(R.drawable.lt_mark), "LoyaltyTree", modifier = Modifier.size(size.dp).clip(CircleShape))
}

@Composable
private fun NavBar(title: String, onBack: () -> Unit, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(Color.White).border(1.dp, Line, CircleShape).clickable { onBack() }, contentAlignment = Alignment.Center) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Forest)
        }
        Text(title, modifier = Modifier.weight(1f).padding(horizontal = 8.dp), textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (action == null) Spacer(Modifier.width(36.dp))
        else Text(action, color = Forest, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(enabled = action != "Saving") { onAction() }.padding(horizontal = 4.dp))
    }
}

@Composable
private fun Dock(tab: Int, items: List<Pair<String, ImageVector>> = OwnerDock, onSelect: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Ivory).padding(horizontal = 14.dp, vertical = 8.dp)
            .shadow(12.dp, RoundedCornerShape(28.dp), ambientColor = Color(0x22123C32), spotColor = Color(0x22123C32))
            .clip(RoundedCornerShape(28.dp)).background(Color.White).padding(horizontal = 4.dp, vertical = 6.dp)
    ) {
        items.forEachIndexed { index, item ->
            val on = tab == index
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(20.dp)).background(if (on) Track else Color.Transparent).clickable { onSelect(index) }.padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(item.second, item.first, tint = Forest, modifier = Modifier.size(20.dp))
                Text(item.first, color = if (on) Forest else Muted, fontSize = 10.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(Shape).background(Color.White).border(1.dp, Line, Shape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, password: Boolean = false, hint: String = "", onCard: Boolean = true, number: Boolean = false, lines: Int = 1) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label.isNotBlank()) Text(label, color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = lines <= 1,
            textStyle = TextStyle(color = Ink, fontSize = 16.sp),
            cursorBrush = SolidColor(Forest),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = when {
                password && number -> KeyboardType.NumberPassword
                password -> KeyboardType.Password
                number -> KeyboardType.Decimal
                else -> KeyboardType.Text
            }),
            modifier = Modifier.fillMaxWidth().height(if (lines <= 1) 48.dp else (lines * 24).dp).clip(Pill).background(if (onCard) Ivory else Color.White).border(1.dp, Line, Pill).padding(horizontal = 14.dp, vertical = if (lines <= 1) 0.dp else 10.dp),
            decorationBox = { inner ->
                Box(Modifier.fillMaxSize(), contentAlignment = if (lines <= 1) Alignment.CenterStart else Alignment.TopStart) {
                    if (value.isEmpty() && hint.isNotBlank()) Text(hint, color = Muted, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    inner()
                }
            }
        )
    }
}

@Composable
private fun Primary(title: String, enabled: Boolean = true, onClick: () -> Unit) {
    val view = LocalView.current
    Box(Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(14.dp)).background(if (enabled) Forest else Line).clickable(enabled) { tick(view); onClick() }, contentAlignment = Alignment.Center) {
        Text(title, color = if (enabled) Color.White else Muted, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Secondary(title: String, onClick: () -> Unit) {
    val view = LocalView.current
    Box(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).border(1.dp, Line, RoundedCornerShape(14.dp)).clickable { tick(view); onClick() }, contentAlignment = Alignment.Center) {
        Text(title, color = Forest, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Choice(title: String, selected: Boolean, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(42.dp).clip(Pill).background(if (selected) Forest else Ivory).clickable { onClick() }.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
        Text(title, color = if (selected) Color.White else Forest, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    }
}

@Composable
private fun Metric(title: String, value: String, modifier: Modifier) {
    Column(modifier.clip(Shape).background(Color.White).border(1.dp, Line, Shape).padding(horizontal = 12.dp, vertical = 14.dp)) {
        Text(title, color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(value, color = Forest, fontSize = 26.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun MiniBar(label: String, count: Int, peak: Int) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, color = Muted, fontSize = 12.sp, modifier = Modifier.width(64.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(99.dp)).background(Track)) {
            Box(Modifier.fillMaxWidth((count.toFloat() / peak).coerceIn(0.04f, 1f)).height(8.dp).clip(RoundedCornerShape(99.dp)).background(Forest))
        }
        Text("$count", color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(32.dp), textAlign = TextAlign.End)
    }
}

@Composable
private fun CheckLine(title: String, detail: String, checked: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(Pill).clickable { onClick() }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(if (checked) Forest else Color.White).border(1.dp, if (checked) Forest else Line, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
            if (checked) Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            if (detail.isNotBlank()) Text(detail, color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

private fun hexColor(raw: String): Color? {
    val hex = normalizeHex(raw) ?: return null
    return Color(android.graphics.Color.parseColor(hex))
}

private fun normalizeHex(raw: String): String? {
    val cleaned = raw.trim().removePrefix("#")
    if (cleaned.length != 6 || cleaned.any { it !in "0123456789abcdefABCDEF" }) return null
    return "#${cleaned.lowercase()}"
}

@Composable
private fun Info(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Muted, modifier = Modifier.weight(0.9f), fontSize = 13.sp)
        Text(value, fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 14.sp, modifier = Modifier.weight(1.4f), lineHeight = 18.sp)
    }
}

@Composable
private fun RowLink(title: String, detail: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(Pill).clickable { onClick() }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold, color = Ink)
            Text(detail, color = Muted, fontSize = 13.sp)
        }
        Text("›", color = Muted, fontSize = 22.sp)
    }
}

@Composable
private fun Section(title: String, note: String, content: @Composable () -> Unit) {
    Card {
        Text(title, color = Forest, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Text(note, color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
        content()
    }
}

@Composable
private fun StepRow(label: String, minus: () -> Unit, plus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink)
        Text("−", modifier = Modifier.clip(CircleShape).background(Track).clickable { minus() }.padding(horizontal = 14.dp, vertical = 6.dp), fontWeight = FontWeight.Bold, color = Forest)
        Spacer(Modifier.size(8.dp))
        Text("+", modifier = Modifier.clip(CircleShape).background(Track).clickable { plus() }.padding(horizontal = 14.dp, vertical = 6.dp), fontWeight = FontWeight.Bold, color = Forest)
    }
}

@Composable
private fun Qr(text: String, size: Int) {
    val bitmap = remember(text, size) { qrBitmap(text, size) }
    Image(bitmap.asImageBitmap(), "QR", modifier = Modifier.size(size.dp).clip(RoundedCornerShape(8.dp)).background(Color.White))
}

private fun qrBitmap(text: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(text.ifBlank { " " }, BarcodeFormat.QR_CODE, size, size)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val ink = android.graphics.Color.parseColor("#123C32")
    for (x in 0 until size) for (y in 0 until size) bitmap.setPixel(x, y, if (matrix.get(x, y)) ink else android.graphics.Color.WHITE)
    return bitmap
}

private fun tick(view: android.view.View) {
    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
}

private fun confirm(view: android.view.View) {
    val kind = if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.CONTEXT_CLICK
    view.performHapticFeedback(kind)
}

private fun tidy(raw: String): String {
    val text = raw.trim()
    if (text.isBlank() || text.equals("null", true)) return ""
    val source = text.substringBefore("+").substringBefore("Z").replace(Regex("\\.\\d+"), "")
    val parsed = runCatching {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
            isLenient = false
        }.parse(source)
    }.getOrNull() ?: runCatching {
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }.parse(source.take(10))
    }.getOrNull() ?: return text
    val pattern = if (source.length > 10) "MMM d, yyyy · h:mm a" else "MMM d, yyyy"
    return SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Manila") }.format(parsed)
}

private fun tidyDetail(raw: String): String =
    raw.split("·").map { it.trim() }.filter { it.isNotBlank() && !it.equals("null", true) }.joinToString(" · ")

@Composable
private fun switchColors() = SwitchDefaults.colors(checkedTrackColor = Forest, checkedThumbColor = Color.White, uncheckedTrackColor = Line, uncheckedThumbColor = Color.White, uncheckedBorderColor = Line)
