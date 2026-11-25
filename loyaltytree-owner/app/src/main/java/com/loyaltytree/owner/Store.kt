package com.loyaltytree.owner

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

data class OwnerSession(
    val token: String,
    val slug: String,
    val businessName: String,
    val email: String,
    val role: String,
    val staffName: String = "",
    val branchId: String = "",
    val branchName: String = ""
) {
    /** Managers and cashiers sign in with their staff email + PIN and get the limited, orders-first app. */
    val isStaff get() = role == "manager" || role == "cashier"
    val isOwner get() = role == "owner"
    /** Owner and managers see the daily summary and can download the sales report. */
    val canReport get() = role == "owner" || role == "manager"
    /** Removing stamps is a correction: owner and managers only. */
    val canCorrectStamps get() = role == "owner" || role == "manager"
    val roleLabel get() = role.replaceFirstChar { it.uppercase() }
}
data class Member(val id: String, val name: String, val phone: String, val email: String, val stamps: Int, val points: String, val lastVisit: String, val birthdayMonth: Int = 0, val birthdayDay: Int = 0)
data class MenuStockOption(val id: String, val name: String)
data class MenuStockItem(val id: String, val name: String, val variants: List<MenuStockOption>)
data class MenuStockRow(val branchId: String, val itemId: String, val variantKey: String,
                        val opening: Int, val reserved: Int, val consumed: Int, val remaining: Int)
data class MenuRow(val id: String, val categoryId: String, val category: String, val name: String, val price: String, val priceNumber: String, val detail: String, val available: Boolean, val shown: Boolean, val sortOrder: Int = 0, val directGroups: List<String> = emptyList(), val excludedGroups: List<String> = emptyList(), val unavailableBranches: List<String> = emptyList())
data class OptionChoice(val id: String, val name: String, val price: String)
data class OptionGroup(val id: String, val name: String, val required: Boolean, val appliesToAll: Boolean, val categoryIds: List<String>, val options: List<OptionChoice>) {
    val choices: String get() = options.joinToString(", ") { it.name }
}
data class StampReward(val id: String, val stamps: Int, val name: String)
data class PointsPrize(val id: String, val name: String, val cost: String)
data class HourBar(val id: String, val label: String, val count: Int)
data class BranchPlace(val id: String, val name: String)
data class CampaignRow(val id: String, val name: String, val detail: String)
data class StatFact(val id: String, val label: String, val value: String)
data class BillPrice(val id: String, val label: String, val pesos: Int)
data class BillPay(val id: String, val title: String, val detail: String)
data class ActivityLine(val id: String, val title: String, val detail: String, val whenText: String)
data class CustomerMenuOrder(val number: String, val status: String, val paymentStatus: String, val total: String, val spent: String, val whenText: String, val branch: String, val items: String)
data class CustomerOrderHistory(val orderCount: Int, val paidCount: Int, val totalSpent: String, val complete: Boolean, val orders: List<CustomerMenuOrder>)
data class OrderLine(val name: String, val detail: String, val id: String = "", val quantity: Int = 1)
data class CounterMenuGroup(val name: String, val minimum: Int, val maximum: Int, val options: List<OptionChoice>)
data class CounterMenuItem(val id: String, val name: String, val price: String, val groups: List<CounterMenuGroup>)
data class CounterAddLine(val item: CounterMenuItem, val quantity: Int, val options: List<OptionChoice>)
data class LiveOrder(
    val id: String,
    val number: String,
    val status: String,
    val customer: String,
    val branch: String,
    val pickup: String,
    val total: String,
    val note: String,
    val payment: String,
    val items: List<OrderLine>,
    val source: String = "ahead",
    val branchId: String = "",
    val service: String = "",
    val createdAt: String = "",
    val paymentMethod: String = "",
    val parentOrderId: String = "",
    val canAddSubOrder: Boolean = false,
    val canVoidItems: Boolean = false,
    val canCancel: Boolean? = null,
    val rawTotal: String = "",
    val tableNo: String = ""
)
data class NamedCount(val id: String, val name: String, val detail: String)
data class DaySummary(
    val date: String,
    val orders: Int,
    val sales: String,
    val dineIn: Int,
    val pickup: Int,
    val cancelled: Int,
    val topItems: List<NamedCount>,
    val branches: List<NamedCount>,
    val payments: List<NamedCount> = emptyList(),
    val paid: String = "",
    val unpaid: String = ""
)
data class ShareReport(val uri: android.net.Uri?, val filename: String, val text: String)
data class Cashier(val id: String, val name: String, val email: String, val role: String, val active: Boolean, val branchId: String, val branchName: String)
data class InsightSection(val id: String, val title: String, val note: String, val rows: List<NamedCount>)
data class Kpi(val label: String, val value: String, val change: Double?, val inPoints: Boolean = false)
data class TrendBar(val label: String, val sales: Double, val orders: Int)
data class RankedItem(val name: String, val quantity: Int, val sales: String)
data class InsightGroup(val label: String, val orders: Int, val share: Double, val topItem: String)
data class ProductBuyerGroup(val dimension: String, val label: String, val orders: Int)
data class ProductBuyerInsight(val name: String, val quantity: Int, val orders: Int, val groups: List<ProductBuyerGroup>, val hiddenGroups: Int)
data class InsightCard(val id: String, val title: String, val note: String, val groups: List<InsightGroup>, val hiddenGroups: Int)
data class ScanCustomer(
    val id: String,
    val name: String,
    val phone: String,
    val cardType: String,
    val stamps: Int,
    val goal: Int,
    val points: Int,
    val rewardReady: Boolean,
    val rewardName: String,
    val nextPrize: String,
    val nextPrizeCost: Int,
    val pointsPer: Double,
    val pesosPer: Double
) {
    val usesPoints get() = cardType == "points"
}

/** The customer id inside a wallet card QR: https://…/stamp/<id>, a bare id, or a URL. Null for gift cards / blanks. */
fun customerIdFromScan(raw: String): String? {
    val text = raw.trim()
    if (text.isEmpty()) return null
    if (Regex("^LTGC:", RegexOption.IGNORE_CASE).containsMatchIn(text)) return null
    if (Regex("/gift(-scan)?/", RegexOption.IGNORE_CASE).containsMatchIn(text)) return null
    if (Regex("^GC-[A-Z0-9-]+$", RegexOption.IGNORE_CASE).matches(text)) return null
    if (Regex("[?&]gift=").containsMatchIn(text)) return null
    var id = text.substringBefore('#').substringBefore('?').trimEnd('/')
    if (id.contains('/')) id = id.substringAfterLast('/')
    id = id.trim()
    return if (id.isEmpty() || id.length > 80 || !Regex("^[A-Za-z0-9_-]+$").matches(id)) null else id
}

fun isGiftCardScan(raw: String): Boolean {
    val text = raw.trim()
    return Regex("^LTGC:|/gift(-scan)?/|^GC-|[?&]gift=", RegexOption.IGNORE_CASE).containsMatchIn(text)
}

class CounterStore(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("lt", Context.MODE_PRIVATE)

    var session by mutableStateOf<OwnerSession?>(null)
    var members by mutableStateOf<List<Member>>(emptyList())
    var menuRows by mutableStateOf<List<MenuRow>>(emptyList())
    var menuStockItems by mutableStateOf<List<MenuStockItem>>(emptyList())
    var menuStockRows by mutableStateOf<List<MenuStockRow>>(emptyList())
    var menuStockBranches by mutableStateOf<List<BranchPlace>>(emptyList())
    var menuStockDay by mutableStateOf("")
    var menuStockNote by mutableStateOf("")
    var menuStockBusy by mutableStateOf(false)

    var orders by mutableStateOf<List<LiveOrder>>(emptyList())
    var ordersNote by mutableStateOf("")
    var orderBusy by mutableStateOf("")
    var ordersBranch by mutableStateOf("")
    var daySummary by mutableStateOf<DaySummary?>(null)
    var reportRange by mutableStateOf("today")
    var reportBusy by mutableStateOf(false)
    var reportNote by mutableStateOf("")
    var insights by mutableStateOf<List<InsightSection>>(emptyList())
    var insightsTop by mutableStateOf<List<NamedCount>>(emptyList())
    var insightsNote by mutableStateOf("")
    var analyticsBranch by mutableStateOf("")
    var menuAnalyticsPeriod by mutableStateOf("month")
    var insightProducts by mutableStateOf<List<ProductBuyerInsight>>(emptyList())
    private var insightRequest = 0
    var insightKpis by mutableStateOf<List<Kpi>>(emptyList())
    var insightTrend by mutableStateOf<List<TrendBar>>(emptyList())
    var insightTrendUnit by mutableStateOf("day")
    var insightItems by mutableStateOf<List<RankedItem>>(emptyList())
    var insightCards by mutableStateOf<List<InsightCard>>(emptyList())
    var insightRange by mutableStateOf("")
    var insightsLoading by mutableStateOf(false)
    var scanCustomer by mutableStateOf<ScanCustomer?>(null)
    var scanNote by mutableStateOf("")
    var scanDone by mutableStateOf("")
    var scanBusy by mutableStateOf(false)
    var cashiers by mutableStateOf<List<Cashier>>(emptyList())
    var cashiersNote by mutableStateOf("")
    var cashierBusy by mutableStateOf("")
    var optionGroups by mutableStateOf<List<OptionGroup>>(emptyList())
    var menuCategories by mutableStateOf<List<StatFact>>(emptyList())
    var branches by mutableStateOf<List<BranchPlace>>(emptyList())
    var campaigns by mutableStateOf<List<CampaignRow>>(emptyList())
    var analytics by mutableStateOf<List<StatFact>>(emptyList())
    var topMembers by mutableStateOf<List<NamedCount>>(emptyList())
    var loading by mutableStateOf(false)
    var status by mutableStateOf("")
    var setupStatus by mutableStateOf("")
    var guestStatus by mutableStateOf("")
    var campaignNote by mutableStateOf("")
    var announcementNote by mutableStateOf("")
    var announcementRoom by mutableStateOf("")
    var billingNote by mutableStateOf("")
    var period by mutableStateOf("30d")
    var cardStamps by mutableStateOf("0")
    var cardRewards by mutableStateOf("0")
    var cardNew by mutableStateOf("0")
    var todayStamps by mutableStateOf("0")
    var todayRewards by mutableStateOf("0")
    var todayNew by mutableStateOf("0")
    var cameBackRate by mutableStateOf(0.0)
    var memberCount by mutableStateOf("0")
    var cardName by mutableStateOf("Loyalty card")
    var stampGoal by mutableStateOf(8)
    var rewardName by mutableStateOf("Free reward")
    var cardType by mutableStateOf("stamp")
    var cardColor by mutableStateOf("#073f36")
    var stampOnce by mutableStateOf(false)
    var stampRewards by mutableStateOf<List<StampReward>>(emptyList())
    var welcomeOn by mutableStateOf(false)
    var welcomeName by mutableStateOf("")
    var welcomeTrigger by mutableStateOf("join")
    var welcomeDays by mutableStateOf(30)
    var cardExpires by mutableStateOf(false)
    var cardExpireDays by mutableStateOf(365)
    var agreementMode by mutableStateOf("off")
    var agreementTitle by mutableStateOf("Customer Terms & Conditions")
    var agreementBody by mutableStateOf("")
    var agreementAck by mutableStateOf("I have read and agree to these terms.")
    var pointsPer by mutableStateOf("10")
    var pointsPesos by mutableStateOf("100")
    var pointsCap by mutableStateOf("")
    var pointsPrizes by mutableStateOf<List<PointsPrize>>(emptyList())
    var membershipDays by mutableStateOf(30)
    var membershipPrice by mutableStateOf("0")
    var membershipPerks by mutableStateOf("")
    var membershipTerms by mutableStateOf("")
    var membershipVisits by mutableStateOf(true)
    var membershipQuick by mutableStateOf(false)
    var cardActive by mutableStateOf("0")
    var cardAverage by mutableStateOf("0")
    var churnCount by mutableStateOf(0)
    var dailyBars by mutableStateOf<List<HourBar>>(emptyList())
    var hourBars by mutableStateOf<List<HourBar>>(emptyList())
    var branchFacts by mutableStateOf<List<NamedCount>>(emptyList())
    var billboardOn by mutableStateOf(false)
    var billboardAllowed by mutableStateOf(true)
    var billboardMessage by mutableStateOf("")
    var billboardNote by mutableStateOf("")
    var pinLabel by mutableStateOf("")
    var pinLat by mutableStateOf("")
    var pinLng by mutableStateOf("")
    var wifiOn by mutableStateOf(false)
    var wifiName by mutableStateOf("")
    var wifiPassword by mutableStateOf("")
    var socialsOn by mutableStateOf(false)
    var instagramURL by mutableStateOf("")
    var facebookURL by mutableStateOf("")
    var tiktokURL by mutableStateOf("")
    var reviewURL by mutableStateOf("")
    var bookOn by mutableStateOf(false)
    var bookURL by mutableStateOf("")
    var bookNote by mutableStateOf("")
    var reserveOn by mutableStateOf(false)
    var reserveURL by mutableStateOf("")
    var reserveNote by mutableStateOf("")
    var openTime by mutableStateOf("")
    var closeTime by mutableStateOf("")
    var birthdayOn by mutableStateOf(true)
    var birthdayMessage by mutableStateOf("")
    var birthdayRewardOn by mutableStateOf(false)
    var birthdayRewardName by mutableStateOf("")
    var birthdayRewardDays by mutableStateOf(7)
    var birthdayTiming by mutableStateOf("birthday")
    var churnDays by mutableStateOf(30)
    var churnMessage by mutableStateOf("")
    var birthdaySent by mutableStateOf("0")
    var churnSent by mutableStateOf("0")
    var billPlan by mutableStateOf("")
    var billStatus by mutableStateOf("")
    var billDays by mutableStateOf("")
    var billExpires by mutableStateOf("")
    var billPrices by mutableStateOf<List<BillPrice>>(emptyList())
    var billPays by mutableStateOf<List<BillPay>>(emptyList())
    var accountPhone by mutableStateOf("")
    var accountAddress by mutableStateOf("")
    var accountContact by mutableStateOf("")
    var accountStatus by mutableStateOf("")
    var analyticsProgram by mutableStateOf("")
    var analyticsNote by mutableStateOf("")
    var seenOpening by mutableStateOf(prefs.getBoolean("seenOpening", false))
    var staffNeedsBranch by mutableStateOf(false)
    var alertsOn by mutableStateOf(prefs.getBoolean("orderAlerts", true))
    var mutedBranches by mutableStateOf(prefs.getStringSet("mutedBranches", emptySet())?.toSet() ?: emptySet())
    var alertsNote by mutableStateOf("")
    /** owner-v9: repeat the order ring for up to 30 seconds until the app is opened. */
    var ringUntilOpened by mutableStateOf(prefs.getBoolean(OrderAlerts.PREF_RING_UNTIL_OPENED, false))
    /** owner-v9 Sound check: "" (not checked yet), "checking", "on", "no_firebase", "server" (server did not accept). */
    var pushState by mutableStateOf("")
    /** Bumped when a new-order notification is tapped, so the app jumps to Orders. */
    var openOrdersTick by mutableStateOf(0)

    private var watchJob: Job? = null

    private var pins = JSONArray()
    private var cardConfig = JSONObject()
    private var otherLinks = JSONArray()

    val joinLink: String get() = "https://theloyaltytree.com/join/${session?.slug.orEmpty()}"

    init { restore() }

    fun markOpened() {
        seenOpening = true
        prefs.edit().putBoolean("seenOpening", true).apply()
    }

    private fun restore() {
        val raw = prefs.getString("session", null) ?: return
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        session = OwnerSession(
            json.optString("token"),
            json.optString("slug"),
            json.optString("businessName"),
            json.optString("email"),
            json.optString("role"),
            json.optString("staffName"),
            json.optString("branchId"),
            json.optString("branchName")
        )
    }

    private fun saveSession(next: OwnerSession) {
        prefs.edit().putString(
            "session",
            JSONObject().put("token", next.token).put("slug", next.slug).put("businessName", next.businessName)
                .put("email", next.email).put("role", next.role).put("staffName", next.staffName)
                .put("branchId", next.branchId).put("branchName", next.branchName).toString()
        ).apply()
    }

    /** Owner: email + password. Staff (manager or cashier): the email + PIN the owner set in Cashiers. Same login API. */
    fun signIn(email: String, password: String, staff: Boolean = false) {
        viewModelScope.launch {
            loading = true
            status = ""
            val result = io { API.post("/api/v1/auth/login", null, JSONObject().put("email", email).put("password", password)) }
            loading = false
            if (result == null) { status = "No connection. Check the signal and try again."; return@launch }
            val (code, body) = result
            val json = body as? JSONObject
            val token = json?.optString("token").orEmpty()
            if (code != 200 || token.isBlank()) {
                status = API.message(body, if (staff) "Check your email and PIN." else "Could not sign in.")
                return@launch
            }
            val role = json?.optString("role").orEmpty().lowercase()
            val slug = json?.optString("business_slug").orEmpty()
            if (role !in listOf("owner", "manager", "cashier") || slug.isBlank()) {
                status = "This account can't use the LoyaltyTree app. Use an owner, manager or cashier account."
                return@launch
            }
            val next = OwnerSession(
                token, slug, json?.optString("business_name").ifNullOrBlank("LoyaltyTree"), email, role,
                staffName = json?.optString("name").orEmpty().takeIf { role != "owner" }.orEmpty(),
                branchId = json?.optString("branch_public_id").orEmpty().takeIf { it != "null" }.orEmpty(),
                branchName = json?.optString("branch_name").orEmpty().takeIf { it != "null" }.orEmpty()
            )
            saveSession(next)
            session = next
            refresh()
        }
    }

    fun signOut() {
        // Stop pushes to this phone first (works even if the 12-hour shift sign-in already ended).
        session?.let { OrderPush.signOut(getApplication<Application>(), it.slug) }
        pushRegistered = ""
        pushState = ""
        OrderAlerts.stopRinging()
        watchJob?.cancel()
        watchJob = null
        session = null
        clearMenuStock()
        members = emptyList()
        menuRows = emptyList()
        orders = emptyList()
        ordersBranch = ""
        daySummary = null
        staffNeedsBranch = false
        status = ""
        prefs.edit().remove("session").apply()
    }

    fun refresh() {
        val current = session ?: return
        if (current.isStaff) {
            refreshStaff(current)
            return
        }
        startOrderWatch()
        viewModelScope.launch {
            loading = true
            status = ""
            val stats = io { API.get("/api/v1/business/${current.slug}/stats", current.token) }
            val people = io { API.get("/api/v1/business/${current.slug}/customers", current.token) }
            val board = io { API.get("/api/v1/business/${current.slug}/geofence", current.token) }
            if (stats == null || people == null) {
                loading = false
                status = "Signed in, but the branch did not load. Pull to try again."
                return@launch
            }
            if (stats.first == 401 || people.first == 401) {
                loading = false
                signOut()
                status = "Sign in again."
                return@launch
            }
            registerPush(current)
            memberCount = fact(stats.second, "total_customers") ?: "0"
            members = parseMembers(people.second)
            if (board != null) applyBoard(board.second, board.first)
            loadSetup(current)
            fetchOrders(current)
            loading = false
        }
    }

    /** Staff only load what they can use: their access (role + branch) and the orders of their branch. */
    private fun refreshStaff(current: OwnerSession) {
        viewModelScope.launch {
            loading = true
            status = ""
            val access = io { API.get("/api/v1/business/${current.slug}/menu-orders/access", current.token) }
            if (access != null && access.first == 401) {
                loading = false
                signOut()
                status = "Your 12-hour shift sign-in ended. Sign in again."
                return@launch
            }
            if (access != null && access.first == 403) {
                loading = false
                signOut()
                status = API.message(access.second, "This staff account can't sign in right now. Ask the owner.")
                return@launch
            }
            val json = access?.second as? JSONObject
            if (access != null && access.first < 400 && json != null) {
                val branch = json.optJSONObject("branch")
                staffNeedsBranch = json.optBoolean("needs_branch")
                val next = current.copy(
                    role = json.optString("role").ifBlank { current.role },
                    staffName = json.optString("name").ifBlank { current.staffName },
                    branchId = branch?.optString("public_id").orEmpty(),
                    branchName = branch?.optString("name").orEmpty()
                )
                if (next != current) {
                    saveSession(next)
                    session = next
                }
            }
            loading = false
            if (access != null && access.first < 400) registerPush(session ?: current)
            if (!staffNeedsBranch) {
                fetchOrders(session ?: current)
                startOrderWatch()
            }
        }
    }

    // ----- New-order push (FCM): rings even when the app is closed -----

    private var pushRegistered = ""

    /** Tells the server this phone should ring for new orders (owner: all branches, staff: their branch). */
    private fun registerPush(current: OwnerSession) {
        val context = getApplication<Application>()
        if (pushState.isBlank()) pushState = "checking"
        OrderPush.currentToken(context, failed = { pushState = "no_firebase" }) { token ->
            val signature = "${current.slug}|${current.role}|${current.branchId}|$token"
            if (session?.slug != current.slug) return@currentToken
            if (signature == pushRegistered) {
                pushState = "on"
                return@currentToken
            }
            viewModelScope.launch {
                val result = io { OrderPush.register(context, current.slug, current.token, token) }
                if (result != null && result.first < 400) {
                    pushRegistered = signature
                    pushState = "on"
                } else {
                    pushState = "server"
                }
            }
        }
    }

    /** Sound check: register this phone for push again (e.g. after turning notifications on). */
    fun recheckPush() {
        val current = session ?: return
        pushRegistered = ""
        pushState = "checking"
        registerPush(current)
    }

    fun chooseRingUntilOpened(on: Boolean) {
        ringUntilOpened = on
        prefs.edit().putBoolean(OrderAlerts.PREF_RING_UNTIL_OPENED, on).apply()
        if (!on) OrderAlerts.stopRinging()
    }

    // ----- New-order ringtone + notification -----

    /** Checks for new orders every 20 seconds while the app is open or was used recently. */
    private fun startOrderWatch() {
        if (watchJob?.isActive == true) return
        watchJob = viewModelScope.launch {
            while (isActive) {
                delay(20_000)
                val current = session ?: break
                if (current.isStaff && staffNeedsBranch) continue
                fetchOrders(current, quiet = true)
            }
        }
    }

    private fun seenKey(current: OwnerSession) = OrderAlerts.seenKey(current.slug, current.role, current.branchId)

    /**
     * Rings for orders this phone has not seen yet. The first load after sign-in only remembers what is already there.
     * Orders that already rang through a push (OrderPushService) are in the same seen list, so they don't ring twice.
     */
    private fun ringForNew(current: OwnerSession, list: List<LiveOrder>) {
        val context = getApplication<Application>()
        val unseen = OrderAlerts.claim(context, seenKey(current), list.map { it.id }, firstLoadQuiet = true)
        val fresh = list.filter { order ->
            order.id in unseen && order.status == "new" && recent(order.createdAt) &&
                (current.isStaff || order.branchId !in mutedBranches)
        }
        if (fresh.isEmpty() || !alertsOn) return
        if (!OrderAlerts.announce(context, fresh)) {
            alertsNote = "Notifications are off for LoyaltyTree. New orders still ring, but nothing pops up. Turn them on in Order alerts."
        }
    }

    /** Ignore old "new" orders (e.g. the phone was off overnight): only ring for the last 3 hours. */
    private fun recent(createdAt: String): Boolean {
        if (createdAt.length < 19) return true
        val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        val base = runCatching { format.parse(createdAt.take(19).replace(' ', 'T'))?.time }.getOrNull() ?: return true
        val offset = Regex("([+-])(\\d{2}):?(\\d{2})$").find(createdAt)?.destructured?.let { (sign, h, m) ->
            (h.toLong() * 60 + m.toLong()) * 60_000L * (if (sign == "-") -1 else 1)
        } ?: 0L
        return base - offset > System.currentTimeMillis() - 3 * 3600_000L
    }

    fun setAlerts(on: Boolean) {
        alertsOn = on
        prefs.edit().putBoolean("orderAlerts", on).apply()
    }

    fun setBranchAlert(branchId: String, on: Boolean) {
        mutedBranches = if (on) mutedBranches - branchId else mutedBranches + branchId
        prefs.edit().putStringSet("mutedBranches", mutedBranches).apply()
    }

    fun openOrdersFromNotification() {
        openOrdersTick += 1
        loadOrders()
    }

    private suspend fun loadSetup(current: OwnerSession) {
        io { API.get("/api/v1/business/${current.slug}/analytics?range=$period", current.token) }?.let { applyAnalytics(it.second, it.first) }
        io { API.get("/api/v1/business/${current.slug}/retention-settings", current.token) }?.let { applyGreetings(it.second, it.first) }
        io { API.get("/api/v1/business/${current.slug}/automation-stats", current.token) }?.let { applySent(it.second) }
        io { API.get("/api/v1/business/${current.slug}/loyalty-config", current.token) }?.let { applyCard(it.second, it.first) }
        io { API.get("/api/v1/business/${current.slug}/order-ahead/menu", current.token) }?.let { applyMenu(it.second, it.first) }
        io { API.get("/api/v1/business/${current.slug}/guest-page", current.token) }?.let { applyGuest(it.second, it.first) }
        io { API.get("/api/v1/business/${current.slug}/branches", current.token) }?.let { applyBranches(it.second, it.first) }
        io { API.get("/api/v1/business/${current.slug}/customer-agreement", current.token) }?.let { applyAgreement(it.second, it.first) }
    }

    fun loadOrders() {
        val current = session ?: return
        viewModelScope.launch { fetchOrders(current) }
    }

    fun chooseOrdersBranch(id: String) {
        if (ordersBranch != id) daySummary = null
        ordersBranch = id
        val current = session ?: return
        viewModelScope.launch { fetchSummary(current) }
    }

    private suspend fun fetchSummary(current: OwnerSession) {
        if (!current.canReport) {
            daySummary = null
            return
        }
        val requestedBranch = ordersBranch
        val branch = java.net.URLEncoder.encode(requestedBranch, "UTF-8")
        val result = io { API.get("/api/v1/business/${current.slug}/menu-orders/summary?branch=$branch", current.token) }
        if (session != current || ordersBranch != requestedBranch) return
        if (result == null || result.first >= 400) {
            daySummary = null
            return
        }
        val json = result.second as? JSONObject ?: return
        daySummary = DaySummary(
            date = json.optString("date"),
            orders = json.optInt("orders"),
            sales = pesos(json.opt("sales")),
            dineIn = json.optInt("dine_in"),
            pickup = json.optInt("pickup"),
            cancelled = json.optInt("cancelled"),
            topItems = namedItems(json.optJSONArray("top_items")),
            payments = buildList {
                val methods = json.optJSONObject("payments")?.optJSONArray("by_method") ?: JSONArray()
                for (i in 0 until methods.length()) {
                    val row = methods.optJSONObject(i) ?: continue
                    add(NamedCount(row.optString("method").ifBlank { "m$i" }, row.optString("label").ifBlank { "Other" }, "${row.optInt("orders")} · ${pesos(row.opt("sales"))}"))
                }
            },
            paid = json.optJSONObject("payments")?.optJSONObject("paid")?.let { "${it.optInt("orders")} · ${pesos(it.opt("sales"))}" }.orEmpty(),
            unpaid = json.optJSONObject("payments")?.optJSONObject("unpaid")?.let { "${it.optInt("orders")} · ${pesos(it.opt("sales"))}" }.orEmpty(),
            branches = buildList {
                val rows = json.optJSONArray("branches") ?: JSONArray()
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    val cancelled = row.optInt("cancelled")
                    val extra = if (cancelled > 0) " · $cancelled cancelled" else ""
                    add(NamedCount(row.optString("public_id").ifBlank { "none-$i" }, row.optString("name").ifBlank { "Before branches" }, "${row.optInt("orders")} ${if (row.optInt("orders") == 1) "order" else "orders"} · ${pesos(row.opt("sales"))}$extra"))
                }
            }
        )
    }

    /** Download the sales report (CSV) for the Orders branch filter, then hand it to [done] to share. */
    fun downloadReport(analytics: Boolean = false, done: (ShareReport) -> Unit) {
        val current = session ?: return
        if (reportBusy) return
        val query = if (analytics) "period=$menuAnalyticsPeriod" else when (reportRange) {
            "yesterday" -> {
                val day = Calendar.getInstance(TimeZone.getTimeZone("Asia/Manila"))
                day.add(Calendar.DAY_OF_MONTH, -1)
                "date=${manila(day)}"
            }
            "week" -> "period=week"
            "month" -> "period=month"
            else -> "date=${manila()}"
        }
        val branch = java.net.URLEncoder.encode(if (analytics) analyticsBranch else ordersBranch, "UTF-8")
        viewModelScope.launch {
            reportBusy = true
            reportNote = ""
            val result = io { API.get("/api/v1/business/${current.slug}/menu-orders/report?format=json&$query&branch=$branch", current.token) }
            if (result == null || result.first >= 400) {
                reportBusy = false
                reportNote = if (result == null) "Could not reach the server." else API.message(result.second, "The sales report is not ready yet.")
                return@launch
            }
            val json = result.second as? JSONObject
            val csv = json?.optString("csv").orEmpty()
            if (json == null || csv.isBlank()) {
                reportBusy = false
                reportNote = "The sales report is not ready yet. Update the server first."
                return@launch
            }
            val filename = json.optString("filename").ifBlank { "loyaltytree-sales-${manila()}.csv" }
            val text = json.optString("text")
            val uri = io { saveToDownloads(filename, csv) }
            reportBusy = false
            reportNote = if (uri != null) "Saved to Downloads/LoyaltyTree: $filename" else "Could not save the file on this phone, so only the summary text is shared."
            done(ShareReport(uri, filename, text))
        }
    }

    /** Saves into Downloads/LoyaltyTree (Android 10+, no storage permission needed). */
    private fun saveToDownloads(filename: String, csv: String): android.net.Uri? {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) return null
        val resolver = getApplication<Application>().contentResolver
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/csv")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/LoyaltyTree")
        }
        val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        val written = runCatching {
            resolver.openOutputStream(uri)?.use { stream ->
                // The BOM makes Excel and Google Sheets show the peso sign correctly.
                stream.write("\uFEFF$csv".toByteArray(Charsets.UTF_8))
                true
            } ?: false
        }.getOrDefault(false)
        if (!written) {
            runCatching { resolver.delete(uri, null, null) }
            return null
        }
        return uri
    }

    fun markPaid(id: String, rawTotal: String) {
        val amount = rawTotal.toBigDecimalOrNull()?.toPlainString() ?: run {
            ordersNote = "Refresh the order before confirming payment."
            return
        }
        val current = session ?: return
        viewModelScope.launch {
            orderBusy = id
            ordersNote = ""
            val result = io { API.patch("/api/v1/business/${current.slug}/menu-orders/$id/payment?expected_amount=$amount", current.token, JSONObject().put("payment_status", "paid")) }
            orderBusy = ""
            if (result == null) {
                ordersNote = "Could not reach the server."
                return@launch
            }
            if (result.first >= 400) {
                ordersNote = API.message(result.second, "Could not mark the order paid.")
                return@launch
            }
            fetchOrders(current)
        }
    }

    fun loadCashiers() {
        val current = session ?: return
        viewModelScope.launch {
            val result = io { API.get("/api/v1/business/${current.slug}/staff", current.token) }
            if (result == null || result.first >= 400) {
                cashiersNote = if (result == null) "Could not reach the server." else API.message(result.second, "Could not load cashiers.")
                return@launch
            }
            val rows = result.second as? JSONArray ?: (result.second as? JSONObject)?.optJSONArray("staff") ?: JSONArray()
            cashiers = buildList {
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    val id = row.optString("public_id")
                    if (id.isBlank()) continue
                    val role = row.optString("role").ifBlank { "cashier" }
                    if (role != "cashier" && role != "manager") continue
                    add(Cashier(id, row.optString("name").ifBlank { "Staff" }, row.optString("email"), role, row.optBoolean("is_active", true), row.optString("branch_public_id"), row.optString("branch_name")))
                }
            }.sortedWith(compareBy({ !it.active }, { it.name.lowercase() }))
            cashiersNote = if (cashiers.isEmpty()) "No cashiers yet. Invite them from the web dashboard." else ""
        }
    }

    fun assignCashier(id: String, branchId: String) {
        val current = session ?: return
        viewModelScope.launch {
            cashierBusy = id
            cashiersNote = ""
            val result = io { API.patch("/api/v1/business/${current.slug}/staff/$id", current.token, JSONObject().put("branch_public_id", branchId)) }
            cashierBusy = ""
            if (result == null || result.first >= 400) {
                cashiersNote = if (result == null) "Could not reach the server." else API.message(result.second, "Could not change the branch.")
                return@launch
            }
            val name = branches.firstOrNull { it.id == branchId }?.name.orEmpty()
            cashiers = cashiers.map { if (it.id == id) it.copy(branchId = branchId, branchName = name) else it }
        }
    }

    fun chooseAnalyticsBranch(id: String) {
        analyticsBranch = id
        loadInsights()
    }

    fun loadInsights() {
        val current = session ?: return
        val apiPeriod = menuAnalyticsPeriod
        val request = ++insightRequest
        val branch = java.net.URLEncoder.encode(analyticsBranch, "UTF-8")
        insightKpis = emptyList()
        insightTrend = emptyList()
        insightItems = emptyList()
        insightCards = emptyList()
        insightProducts = emptyList()
        insightRange = ""
        insightsNote = ""
        viewModelScope.launch {
            insightsLoading = true
            val result = io { API.get("/api/v1/business/${current.slug}/menu-orders/insights?period=$apiPeriod&branch=$branch", current.token) }
            if (request != insightRequest || session?.slug != current.slug) return@launch
            insightsLoading = false
            if (result == null || result.first >= 400) {
                insights = emptyList()
                insightsTop = emptyList()
                insightKpis = emptyList()
                insightTrend = emptyList()
                insightItems = emptyList()
                insightCards = emptyList()
                insightsNote = if (result == null) "Could not reach menu order insights." else API.message(result.second, "Menu order insights are not ready yet.")
                return@launch
            }
            val json = result.second as? JSONObject ?: return@launch
            applyInsights(json)
        }
    }

    private fun num(value: Any?): Double? = if (value == null || value == JSONObject.NULL) null else API.plain(value)?.toDoubleOrNull()

    private fun applyInsights(json: JSONObject) {
        val now = json.optJSONObject("kpis") ?: JSONObject()
        val change = json.optJSONObject("change") ?: JSONObject()
        insightKpis = listOf(
            Kpi("Sales", pesos(now.opt("sales")), num(change.opt("sales"))),
            Kpi("Orders", now.optInt("orders").toString(), num(change.opt("orders"))),
            Kpi("Avg order", pesos(now.opt("avg_order")), num(change.opt("avg_order"))),
            Kpi("Members", "${(num(now.opt("members_percent")) ?: 0.0).toInt()}%", num(change.opt("members_percent")), inPoints = true)
        )
        insightTrendUnit = json.optString("trend_unit").ifBlank { "day" }
        insightTrend = buildList {
            val rows = json.optJSONArray("trend") ?: JSONArray()
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                add(TrendBar(row.optString("label"), num(row.opt("sales")) ?: 0.0, row.optInt("orders")))
            }
        }
        insightItems = buildList {
            val rows = json.optJSONArray("top_items") ?: JSONArray()
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                add(RankedItem(row.optString("name").ifBlank { "Item" }, row.optInt("quantity"), pesos(row.opt("sales"))))
            }
        }
        insightsTop = insightItems.map { NamedCount(it.name, it.name, it.quantity.toString()) }
        insightProducts = buildList {
            val products = json.optJSONArray("product_buyers") ?: JSONArray()
            for (i in 0 until products.length()) {
                val product = products.optJSONObject(i) ?: continue
                val groups = buildList {
                    val rows = product.optJSONArray("groups") ?: JSONArray()
                    for (j in 0 until rows.length()) {
                        val group = rows.optJSONObject(j) ?: continue
                        add(ProductBuyerGroup(group.optString("dimension"), group.optString("label"), group.optInt("orders")))
                    }
                }
                add(ProductBuyerInsight(product.optString("name"), product.optInt("quantity"), product.optInt("orders"), groups, product.optInt("hidden_groups")))
            }
        }
        val titles = mapOf(
            "age" to "Age", "gender" to "Gender", "occupation" to "Occupation", "membership" to "Members vs walk-ins",
            "tenure" to "New vs returning", "time" to "Time of day", "weekday" to "Day of week", "branch" to "Branch"
        )
        val order = listOf("age", "gender", "occupation", "membership", "tenure", "time", "weekday", "branch")
        val sections = json.optJSONArray("sections") ?: JSONArray()
        insightCards = buildList {
            for (i in 0 until sections.length()) {
                val section = sections.optJSONObject(i) ?: continue
                val groups = section.optJSONArray("groups") ?: JSONArray()
                var hidden = 0
                val shown = buildList {
                    for (j in 0 until groups.length()) {
                        val group = groups.optJSONObject(j) ?: continue
                        val count = group.optInt("orders")
                        if (count <= 0) continue
                        if (group.optBoolean("hidden")) {
                            hidden += 1
                            continue
                        }
                        val label = group.optString("label").let { if (it == "No branch saved") "Before branches" else it }
                        add(InsightGroup(label, count, num(group.opt("share_percent")) ?: 0.0, group.optString("top_item")))
                    }
                }
                if (shown.isEmpty() && hidden == 0) continue
                val key = section.optString("key")
                add(InsightCard(key, titles[key] ?: section.optString("title"), section.optString("note"), shown.sortedByDescending { it.orders }, hidden))
            }
        }.sortedBy { order.indexOf(it.id).let { index -> if (index < 0) 99 else index } }
        insights = emptyList()
        insightRange = listOf(json.optString("start"), json.optString("end")).filter { it.isNotBlank() }.distinct().joinToString(" – ") { shortDate(it) }
        val orders = json.optInt("orders")
        insightsNote = if (orders == 0) "No digital menu orders in this period yet." else
            "Age, gender and occupation come only from loyalty cards connected on the menu. City is not collected."
    }

    private fun shortDate(iso: String): String {
        val parts = iso.split("-")
        if (parts.size != 3) return iso
        val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
        val month = parts[1].toIntOrNull()?.let { months.getOrNull(it - 1) } ?: return iso
        return "$month ${parts[2].toIntOrNull() ?: parts[2]}"
    }

    // ----- Add a stamp / points (owner session, no cashier login) -----

    fun clearScan() {
        scanCustomer = null
        scanNote = ""
        scanDone = ""
    }

    fun scanFailed(message: String) {
        scanCustomer = null
        scanDone = ""
        scanNote = message
    }

    fun lookupScan(raw: String) {
        if (isGiftCardScan(raw)) {
            scanFailed("That is a gift card. Gift cards are not handled here yet.")
            return
        }
        val id = customerIdFromScan(raw)
        if (id == null) {
            scanFailed("That code is not a LoyaltyTree card. Scan the QR on the customer's Apple or Google Wallet card.")
            return
        }
        loadScanCustomer(id)
    }

    fun loadScanCustomer(id: String, done: String = "") {
        val current = session ?: return
        viewModelScope.launch {
            scanBusy = true
            scanNote = ""
            val result = io { API.get("/api/v1/customer/${java.net.URLEncoder.encode(id, "UTF-8")}", current.token) }
            scanBusy = false
            if (result == null) {
                scanFailed("Could not reach the server. Check the connection and scan again.")
                return@launch
            }
            if (result.first == 404) {
                scanFailed("Card not found. Ask the customer to open their wallet card and scan again.")
                return@launch
            }
            if (result.first >= 400) {
                scanFailed(API.message(result.second, "Could not read that card."))
                return@launch
            }
            val json = result.second as? JSONObject ?: return@launch scanFailed("Could not read that card.")
            val owner = json.optJSONObject("business")?.optString("public_id").orEmpty()
            if (owner.isNotBlank() && owner != current.slug) {
                scanFailed("This card belongs to another business.")
                return@launch
            }
            val customer = json.optJSONObject("customer") ?: JSONObject()
            val program = json.optJSONObject("program") ?: JSONObject()
            val programType = program.optString("card_type")
            val type = when {
                programType == "hybrid" -> if (program.optString("hybrid_loyalty_type") == "stamp") "stamp" else "points"
                programType.isNotBlank() -> programType
                else -> json.optString("current_card_type").ifBlank { "stamp" }
            }
            if (type != "stamp" && type != "points") {
                scanFailed("This is a ${type.replaceFirstChar { it.uppercase() }} card. Only stamp and points cards can be updated here.")
                return@launch
            }
            val goal = program.optInt("stamp_goal", 8).coerceAtLeast(1)
            val stamps = customer.optInt("stamp_count")
            val points = customer.optInt("points_balance")
            val prizes = program.optJSONArray("points_prizes") ?: JSONArray()
            var ready = ""
            var next = ""
            var nextCost = 0
            for (i in 0 until prizes.length()) {
                val prize = prizes.optJSONObject(i) ?: continue
                val cost = prize.optInt("points_cost")
                val name = prize.optString("name").ifBlank { "Reward" }
                if (cost <= 0) continue
                if (cost <= points && (ready.isBlank())) ready = name
                if (cost > points && (nextCost == 0 || cost < nextCost)) {
                    next = name
                    nextCost = cost
                }
            }
            val rewardReady = if (type == "points") ready.isNotBlank() else (customer.optBoolean("reward_unlocked") || stamps >= goal)
            scanCustomer = ScanCustomer(
                id = customer.optString("public_id").ifBlank { id },
                name = customer.optString("name").ifBlank { "Customer" },
                phone = customer.optString("phone"),
                cardType = type,
                stamps = stamps,
                goal = goal,
                points = points,
                rewardReady = rewardReady,
                rewardName = if (type == "points") ready else program.optString("reward_name").ifBlank { rewardName },
                nextPrize = next,
                nextPrizeCost = nextCost,
                pointsPer = num(program.opt("points_per_amount")) ?: 0.0,
                pesosPer = (num(program.opt("points_amount_pesos")) ?: 1.0).coerceAtLeast(1.0)
            )
            scanDone = done
        }
    }

    /** Same formula as the server's /points-sale: int(amount / pesos * points). */
    fun previewPoints(amount: Double, customer: ScanCustomer): Int =
        if (amount <= 0 || customer.pointsPer <= 0) 0 else ((amount / customer.pesosPer) * customer.pointsPer).toInt()

    fun changeStamps(delta: Int) {
        val current = session ?: return
        val customer = scanCustomer ?: return
        if (delta == 0) return
        viewModelScope.launch {
            scanBusy = true
            scanNote = ""
            var added = 0
            var error = ""
            if (delta > 0) {
                for (i in 0 until delta) {
                    val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", current.isOwner)
                    val result = io { API.post("/api/v1/business/${current.slug}/stamp", current.token, body) }
                    if (result == null || result.first >= 400) {
                        error = if (result == null) "Could not reach the server." else API.message(result.second, "Could not add the stamp.")
                        break
                    }
                    added += 1
                }
            } else {
                val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", current.isOwner).put("delta", delta)
                    .put("reason", "${current.roleLabel} correction in the LoyaltyTree app")
                val result = io { API.post("/api/v1/business/${current.slug}/stamp/adjust", current.token, body) }
                if (result == null || result.first >= 400) {
                    error = if (result == null) "Could not reach the server." else API.message(result.second, "Could not remove the stamp.")
                } else {
                    added = delta
                }
            }
            scanBusy = false
            val done = when {
                added > 0 -> "Added $added stamp${if (added == 1) "" else "s"} for ${customer.name}."
                added < 0 -> "Removed ${-added} stamp${if (added == -1) "" else "s"} from ${customer.name}."
                else -> ""
            }
            if (added != 0) loadScanCustomer(customer.id, done)
            scanNote = if (error.isNotBlank() && added > 0) "Stopped after $added: $error" else error
        }
    }

    fun addSalePoints(amountText: String) {
        val current = session ?: return
        val customer = scanCustomer ?: return
        val amount = amountText.trim().replace(",", "").toDoubleOrNull()
        if (amount == null || amount <= 0) {
            scanNote = "Enter the amount spent in pesos."
            return
        }
        viewModelScope.launch {
            scanBusy = true
            scanNote = ""
            val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", current.isOwner).put("amount_spent", amount)
            val result = io { API.post("/api/v1/business/${current.slug}/points-sale", current.token, body) }
            scanBusy = false
            if (result == null || result.first >= 400) {
                scanNote = if (result == null) "Could not reach the server." else API.message(result.second, "Could not add points.")
                return@launch
            }
            val json = result.second as? JSONObject
            val earned = json?.optInt("points_earned") ?: 0
            val done = if (earned > 0) "+$earned points for ${customer.name}." else "${customer.name} is at the points cap. No points added."
            loadScanCustomer(customer.id, done)
        }
    }

    fun redeemStampReward() {
        val current = session ?: return
        val customer = scanCustomer ?: return
        viewModelScope.launch {
            scanBusy = true
            scanNote = ""
            val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", current.isOwner)
            val result = io { API.post("/api/v1/business/${current.slug}/reward/redeem", current.token, body) }
            scanBusy = false
            if (result == null || result.first >= 400) {
                scanNote = if (result == null) "Could not reach the server." else API.message(result.second, "Could not redeem the reward.")
                return@launch
            }
            loadScanCustomer(customer.id, "Reward redeemed for ${customer.name}.")
        }
    }

    private fun namedItems(rows: JSONArray?): List<NamedCount> = buildList {
        val list = rows ?: JSONArray()
        for (i in 0 until list.length()) {
            val row = list.optJSONObject(i) ?: continue
            add(NamedCount("i$i", row.optString("name").ifBlank { "Item" }, row.optInt("quantity").toString()))
        }
    }

    fun setOrderStatus(id: String, next: String) {
        val current = session ?: return
        viewModelScope.launch {
            orderBusy = id
            ordersNote = ""
            val source = orders.find { it.id == id }?.source ?: "ahead"
            val result = io {
                val path = if (source == "menu") {
                    "/api/v1/business/${current.slug}/menu-orders/$id/status"
                } else {
                    "/api/v1/business/${current.slug}/order-ahead/orders/$id/status"
                }
                API.patch(path, current.token, JSONObject().put("status", next))
            }
            orderBusy = ""
            if (result == null) {
                ordersNote = "Could not reach the server."
                return@launch
            }
            if (result.first >= 400) {
                ordersNote = API.message(result.second, "Could not update the order.")
                return@launch
            }
            fetchOrders(current)
        }
    }

    fun loadCounterMenu(order: LiveOrder, done: (List<CounterMenuItem>, String) -> Unit) {
        val current = session ?: return done(emptyList(), "Sign in again to load the menu.")
        viewModelScope.launch {
            val branch = android.net.Uri.encode(order.branchId)
            val slug = android.net.Uri.encode(current.slug)
            val result = io { API.get("/api/v1/public/menu/$slug?branch=$branch", "") }
            val items = (result?.second as? JSONObject)?.optJSONArray("items")
            if (result == null || result.first >= 400 || items == null) {
                done(emptyList(), result?.let { API.message(it.second, "Could not load the menu.") }
                    ?: "Could not reach the menu.")
                return@launch
            }
            done(buildList {
                for (i in 0 until items.length()) {
                    val item = items.optJSONObject(i) ?: continue
                    val id = item.optString("public_id")
                    if (id.isBlank() || !item.optBoolean("is_available", true)) continue
                    val unavailable = item.optJSONArray("unavailable_branch_public_ids") ?: JSONArray()
                    if ((0 until unavailable.length()).any { unavailable.optString(it) == order.branchId }) continue
                    val stock = item.optJSONObject("branch_stock")?.optJSONArray(order.branchId) ?: JSONArray()
                    val soldOut = (0 until stock.length()).mapNotNull { stock.optJSONObject(it) }
                        .filter { it.optInt("remaining") <= 0 }.map { it.optString("variant_key") }.toSet()
                    if ("*" in soldOut) continue
                    val groups = item.optJSONArray("modifier_groups") ?: JSONArray()
                    val choices = (0 until groups.length()).mapNotNull { index ->
                        val group = groups.optJSONObject(index) ?: return@mapNotNull null
                        val options = group.optJSONArray("options") ?: JSONArray()
                        val available = (0 until options.length()).mapNotNull option@{ optionIndex ->
                            val option = options.optJSONObject(optionIndex) ?: return@option null
                            val optionId = option.optString("public_id")
                            if (optionId.isBlank() || optionId in soldOut) return@option null
                            OptionChoice(optionId, option.optString("name"), pesos(option.opt("price_delta")))
                        }
                        val minimum = maxOf(group.optInt("min_selections"), if (group.optBoolean("is_required")) 1 else 0)
                        val maximum = if (group.optString("selection_type") == "single") 1
                            else group.optInt("max_selections").takeIf { it > 0 } ?: available.size
                        CounterMenuGroup(group.optString("name"), minimum, maximum, available)
                    }
                    if (choices.any { it.options.size < it.minimum }) continue
                    add(CounterMenuItem(id, item.optString("name"), pesos(item.opt("base_price")), choices))
                }
            }, "")
        }
    }

    fun addCounterSubOrder(order: LiveOrder, requestId: String, lines: List<CounterAddLine>, done: (String) -> Unit) {
        val items = JSONArray()
        lines.forEach { line ->
            val options = JSONArray()
            line.options.forEach { options.put(JSONObject().put("public_id", it.id)) }
            items.put(JSONObject().put("item_id", line.item.id)
                .put("quantity", line.quantity).put("options", options))
        }
        adjustCounterOrder(order.id, "sub-orders", JSONObject().put("request_id", requestId).put("items", items),
            create = true, done = done)
    }

    fun voidCounterItem(order: LiveOrder, requestId: String, line: OrderLine, quantity: Int, reason: String, done: (String) -> Unit) {
        val body = JSONObject().put("request_id", requestId).put("line_id", line.id)
            .put("quantity", quantity).put("reason", reason)
        adjustCounterOrder(order.id, "void-item", body, done = done)
    }

    fun cancelCounterOrder(order: LiveOrder, reason: String, done: (String) -> Unit) =
        adjustCounterOrder(order.id, "status", JSONObject().put("status", "cancelled").put("reason", reason), done = done)

    private fun adjustCounterOrder(id: String, action: String, body: JSONObject, create: Boolean = false, done: (String) -> Unit) {
        val current = session ?: return done("Sign in again to update the order.")
        if (orderBusy.isNotBlank()) return done("Another order update is in progress.")
        orderBusy = id
        viewModelScope.launch {
            val path = "/api/v1/business/${current.slug}/menu-orders/$id/$action"
            val result = io { if (create) API.post(path, current.token, body) else API.patch(path, current.token, body) }
            orderBusy = ""
            when {
                result == null -> done("Could not reach the server. Try again.")
                result.first >= 400 -> done(API.message(result.second, "Could not update the order."))
                else -> {
                    done("")
                    fetchOrders(current)
                }
            }
        }
    }

    private suspend fun fetchOrders(current: OwnerSession, quiet: Boolean = false) {
        val menu = io { API.get("/api/v1/business/${current.slug}/menu-orders", current.token) }
        val ahead = io { API.get("/api/v1/business/${current.slug}/order-ahead/orders?limit=100", current.token) }
        if (menu == null && ahead == null) {
            if (!quiet) ordersNote = "Could not reach orders."
            return
        }
        if (session != current) return
        if (current.isStaff && menu != null && menu.first == 401) {
            signOut()
            status = "Your 12-hour shift sign-in ended. Sign in again."
            return
        }
        if (current.isStaff && menu != null && menu.first == 403 && API.message(menu.second, "").contains("assign your branch", ignoreCase = true)) {
            staffNeedsBranch = true
            orders = emptyList()
            return
        }
        val combined = buildList {
            if (menu != null && menu.first < 400) addAll(parseOrders(menu.second, "menu"))
            if (ahead != null && ahead.first < 400) addAll(parseOrders(ahead.second, "ahead"))
        }
        orders = combined.distinctBy { it.id }
        if (menu != null && menu.first < 400) ringForNew(current, orders)
        fetchSummary(current)
        val blocked = listOfNotNull(menu, ahead).filter { it.first >= 400 }
            .map { API.message(it.second, "Could not load orders.") }
            .filter { !it.contains("Order Ahead must be enabled", ignoreCase = true) }
        ordersNote = if (combined.isEmpty()) blocked.firstOrNull().orEmpty() else ""
    }

    private fun parseOrders(body: Any, source: String): List<LiveOrder> {
        val json = body as? JSONObject ?: return emptyList()
        val rows = json.optJSONArray("orders") ?: return emptyList()
        return buildList {
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                val id = row.optString("public_id")
                if (id.isBlank()) continue
                val customer = row.optJSONObject("customer")
                val branch = row.optJSONObject("branch")
                val items = row.optJSONArray("items") ?: JSONArray()
                val lines = buildList {
                    for (j in 0 until items.length()) {
                        val item = items.optJSONObject(j) ?: continue
                        val qty = API.plain(item.opt("quantity")) ?: "1"
                        val name = item.optString("item_name").ifBlank { "Item" }
                        add(OrderLine("$qty × $name", modifierText(item.opt("modifiers")),
                            item.optString("line_id"), item.optInt("quantity", 1)))
                    }
                }
                add(
                    LiveOrder(
                        id = id,
                        number = row.optString("order_number").ifBlank { "Order" },
                        status = row.optString("status").ifBlank { "new" },
                        customer = customer?.optString("name").orEmpty().ifBlank { "Customer" },
                        branch = branch?.optString("name").orEmpty(),
                        pickup = row.optString("pickup_at"),
                        total = pesos(row.opt("total")),
                        note = row.optString("customer_note"),
                        payment = row.optString("payment_status"),
                        items = lines,
                        source = source,
                        branchId = branch?.optString("public_id").orEmpty(),
                        service = row.optString("service"),
                        createdAt = row.optString("created_at"),
                        paymentMethod = row.optString("payment_method"),
                        parentOrderId = API.plain(row.opt("parent_order_public_id")).orEmpty(),
                        canAddSubOrder = row.optBoolean("can_create_suborder"),
                        canVoidItems = row.optBoolean("can_void_items"),
                        canCancel = row.takeIf { it.has("can_cancel") }?.optBoolean("can_cancel"),
                        rawTotal = row.optString("total"),
                        tableNo = API.plain(row.opt("table_no")).orEmpty()
                    )
                )
            }
        }
    }

    private fun modifierText(raw: Any?): String {
        val array = when (raw) {
            is JSONArray -> raw
            is String -> runCatching { JSONArray(raw) }.getOrNull()
            else -> null
        } ?: return ""
        return buildList {
            for (i in 0 until array.length()) {
                val name = array.optJSONObject(i)?.optString("option_name").orEmpty()
                if (name.isNotBlank()) add(name)
            }
        }.joinToString(", ")
    }

    private fun pesos(value: Any?): String {
        val amount = API.plain(value)?.toDoubleOrNull() ?: return "₱0"
        val shown = if (amount % 1.0 == 0.0) amount.toInt().toString() else String.format("%.2f", amount)
        return "₱$shown"
    }

    fun selectRange(range: String) {
        period = range
        val current = session ?: return
        if (range == "today") return
        viewModelScope.launch {
            io { API.get("/api/v1/business/${current.slug}/analytics?range=$range", current.token) }?.let { applyAnalytics(it.second, it.first) }
        }
    }

    fun saveBillboard() {
        val current = session ?: return
        val lat = pinLat.trim().toDoubleOrNull()
        val lng = pinLng.trim().toDoubleOrNull()
        val validPin = lat != null && lng != null && lat.isFinite() && lng.isFinite() && lat in -85.0..85.0 && lng in -180.0..180.0
        if (!validPin && (billboardOn || pinLat.isNotBlank() || pinLng.isNotBlank())) {
            status = "Enter a valid latitude and longitude before saving."
            return
        }
        viewModelScope.launch {
            loading = true
            status = ""
            val next = JSONArray(pins.toString())
            if (validPin && lat != null && lng != null) {
                val pin = if (next.length() > 0) next.getJSONObject(0) else JSONObject()
                pin.put("label", pinLabel.ifBlank { current.businessName })
                pin.put("latitude", lat)
                pin.put("longitude", lng)
                pin.put("message", billboardMessage)
                if (next.length() == 0) next.put(pin) else next.put(0, pin)
            }
            val body = JSONObject()
                .put("enabled", billboardOn)
                .put("message", billboardMessage)
                .put("radius_meters", 150)
                .put("max_per_day", 1)
                .put("max_per_week", 3)
                .put("pins", next)
            val result = io { API.put("/api/v1/business/${current.slug}/geofence", current.token, body) }
            loading = false
            if (result == null) { status = "Could not reach the server."; return@launch }
            if (result.first == 401) { signOut(); return@launch }
            if (result.first >= 400) { status = API.message(result.second, "Could not save the billboard."); return@launch }
            applyBoard(result.second, result.first)
            status = if (billboardOn) "Saved. Nearby alerts are on." else "Saved. Nearby alerts are off."
        }
    }

    private var menuStockScope: OwnerSession? = null

    private fun clearMenuStock() {
        menuStockScope = null
        menuStockBranches = emptyList()
        menuStockItems = emptyList()
        menuStockRows = emptyList()
        menuStockDay = ""
        menuStockNote = ""
        menuStockBusy = false
    }

    /** Daily serving limits: the server validates branch permissions and saves atomically. */
    fun loadMenuStock() {
        val current = session ?: return
        viewModelScope.launch {
            if (menuStockScope != current) clearMenuStock()
            if (menuStockBusy) return@launch
            menuStockScope = current
            menuStockBusy = true
            val result = io { API.get("/api/v1/business/${current.slug}/menu-inventory", current.token) }
            if (session != current) return@launch
            menuStockBusy = false
            if (result == null || result.first >= 400) {
                clearMenuStock()
                menuStockNote = if (result == null) "Could not reach daily inventory." else API.message(result.second, "Daily inventory unavailable.")
                return@launch
            }
            val body = result.second as? JSONObject ?: run { clearMenuStock(); menuStockNote = "Invalid inventory response."; return@launch }
            menuStockDay = body.optString("service_day")
            val bs = body.optJSONArray("branches") ?: JSONArray()
            menuStockBranches = buildList { for (i in 0 until bs.length()) {
                val b = bs.optJSONObject(i) ?: continue
                add(BranchPlace(b.optString("public_id"),b.optString("name","Branch")))
            } }
            val items = body.optJSONArray("items") ?: JSONArray()
            menuStockItems = buildList { for (i in 0 until items.length()) {
                val x = items.optJSONObject(i) ?: continue
                val vars = x.optJSONArray("variants") ?: JSONArray()
                val options = buildList { for (j in 0 until vars.length()) {
                    val v = vars.optJSONObject(j) ?: continue
                    add(MenuStockOption(v.optString("public_id"),v.optString("name","Variant")))
                } }
                add(MenuStockItem(x.optString("public_id"),x.optString("name","Item"),options))
            } }
            val rows = body.optJSONArray("rows") ?: JSONArray()
            menuStockRows = buildList { for (i in 0 until rows.length()) {
                val x = rows.optJSONObject(i) ?: continue
                add(MenuStockRow(x.optString("branch_public_id"),x.optString("item_public_id"),
                    x.optString("variant_key","*"), x.optInt("initial_servings"),
                    x.optInt("reserved"),x.optInt("consumed"),x.optInt("remaining")))
            } }
            menuStockNote = ""
        }
    }

    fun setMenuStock(branchId: String, itemId: String, variantKey: String, opening: String, repeatDaily: Boolean) {
        val current = session ?: return
        if (menuStockScope != current || menuStockBusy) return
        val number = opening.toIntOrNull()
        if (number == null || number !in 0..100000) {
            menuStockNote = "Enter a whole number from 0 to 100000."
            return
        }
        if (branchId.isBlank() || itemId.isBlank()) {
            menuStockNote = "Choose a branch and menu item."
            return
        }
        viewModelScope.launch {
            menuStockBusy = true
            val body = JSONObject().put("branch_public_id",branchId).put("item_public_id",itemId)
                .put("variant_key",variantKey).put("initial_servings",number).put("repeat_daily",repeatDaily)
            val result = io { API.put("/api/v1/business/${current.slug}/menu-inventory",current.token,body) }
            if (session != current) return@launch
            menuStockBusy = false
            if (result == null || result.first >= 400) {
                if (result?.first == 401 || result?.first == 403) clearMenuStock()
                menuStockNote = if (result == null) "Could not reach daily inventory." else API.message(result.second,"Could not save servings.")
                return@launch
            }
            loadMenuStock()
        }
    }

    fun setMenuAvailable(id: String, on: Boolean) {
        val current = session ?: return
        menuRows = menuRows.map { if (it.id == id) it.copy(available = on) else it }
        viewModelScope.launch {
            val result = io { API.patch("/api/v1/business/${current.slug}/order-ahead/items/$id/availability", current.token, JSONObject().put("is_available", on)) }
            if (result == null || result.first >= 400) {
                menuRows = menuRows.map { if (it.id == id) it.copy(available = !on) else it }
                setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not update that item.")
            }
        }
    }

    fun addCategory(name: String, done: (String?) -> Unit) {
        val current = session ?: return
        val clean = name.trim()
        if (clean.isEmpty()) return
        viewModelScope.launch {
            val body = JSONObject().put("name", clean).put("description", "").put("sort_order", menuCategories.size).put("is_active", true)
            val result = io { API.post("/api/v1/business/${current.slug}/order-ahead/categories", current.token, body) }
            if (result == null || result.first >= 400) {
                setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not add the section.")
                done(null)
            } else {
                val id = (result.second as? JSONObject)?.optJSONObject("category")?.optString("public_id")
                refresh()
                done(id)
            }
        }
    }

    private fun validTikTokURL(value: String): Boolean {
        val text = value.trim()
        if (text.length > 300 || text.any { it.isWhitespace() || it.isISOControl() || it == '\\' }) return false
        val url = runCatching { java.net.URI(text) }.getOrNull() ?: return false
        val host = url.host?.lowercase().orEmpty()
        return url.scheme.equals("https", ignoreCase = true) && url.userInfo == null && url.port == -1 &&
            (host == "tiktok.com" || host.endsWith(".tiktok.com")) &&
            !url.rawPath.isNullOrBlank() && url.rawPath != "/"
    }

    fun saveGuest() {
        val current = session ?: return
        viewModelScope.launch {
            guestStatus = ""
            val tiktok = tiktokURL.trim()
            if (tiktok.isNotEmpty() && !validTikTokURL(tiktok)) {
                guestStatus = "Enter a valid HTTPS TikTok link (tiktok.com)."
                return@launch
            }
            val links = JSONArray(otherLinks.toString())
            if (instagramURL.isNotBlank()) links.put(JSONObject().put("label", "Instagram").put("url", instagramURL.trim()))
            if (facebookURL.isNotBlank()) links.put(JSONObject().put("label", "Facebook").put("url", facebookURL.trim()))
            if (tiktok.isNotEmpty()) links.put(JSONObject().put("label", "TikTok").put("url", tiktok))
            if (links.length() > 4) {
                guestStatus = "Maximum four social links. Contact support to remove an unlisted link."
                return@launch
            }
            val body = JSONObject()
                .put("wifi_published", wifiOn)
                .put("wifi_name", wifiName.trim())
                .put("wifi_password", wifiPassword)
                .put("socials_published", socialsOn)
                .put("links", links)
                .put("review_url", reviewURL.trim())
                .put("book_published", bookOn)
                .put("book_url", bookURL)
                .put("book_note", bookNote)
                .put("reserve_published", reserveOn)
                .put("reserve_url", reserveURL)
                .put("reserve_note", reserveNote)
                .put("opening_time", openTime.trim())
                .put("closing_time", closeTime.trim())
            val result = io { API.post("/api/v1/business/${current.slug}/guest-page", current.token, body) }
            if (result == null || result.first >= 400) {
                guestStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not save Wi-Fi and socials.")
            } else {
                applyGuest(result.second, result.first)
                guestStatus = "Saved. Customers see this the next time they scan."
            }
        }
    }

    fun saveGreetings() {
        val current = session ?: return
        if (birthdayRewardOn && birthdayRewardName.isBlank()) { setupStatus = "Name the birthday coupon before turning it on."; return }
        viewModelScope.launch {
            loading = true
            setupStatus = ""
            val body = JSONObject()
                .put("birthday_enabled", birthdayOn)
                .put("birthday_message", birthdayMessage)
                .put("birthday_reward_enabled", birthdayRewardOn)
                .put("birthday_reward_name", birthdayRewardName)
                .put("birthday_reward_validity_days", birthdayRewardDays)
                .put("birthday_send_timing", birthdayTiming)
                .put("win_back_message", churnMessage)
                .put("churn_days", churnDays)
            val result = io { API.put("/api/v1/business/${current.slug}/retention-settings", current.token, body) }
            loading = false
            if (result == null || result.first >= 400) setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not save greetings.")
            else { applyGreetings(result.second, result.first); setupStatus = "Saved." }
        }
    }

    fun sendAnnouncement(title: String, message: String, scope: String, branchId: String) {
        val current = session ?: return
        if (title.isBlank() || message.isBlank()) { announcementNote = "Write a title and a message."; return }
        if (scope == "branch" && branchId.isBlank()) { announcementNote = "Choose a branch."; return }
        viewModelScope.launch {
            loading = true
            announcementNote = ""
            val body = JSONObject()
                .put("title", title.trim())
                .put("message", message.trim())
                .put("type", "info")
                .put("is_active", true)
                .put("target_scope", scope)
                .put("branch_public_id", if (scope == "branch") branchId else "")
                .put("program_public_id", "")
            val result = io { API.post("/api/v1/business/${current.slug}/announcements", current.token, body) }
            loading = false
            val json = result?.second as? JSONObject
            if (result == null || result.first >= 400 || json == null) {
                announcementNote = if (result == null) "Could not reach the server." else API.message(result.second, "Could not send the announcement.")
                return@launch
            }
            val sent = json.optBoolean("_push_sent")
            val count = API.plain(json.opt("_push_target_count")).orEmpty()
            val who = if (scope == "branch") "the selected branch" else "the whole business"
            announcementNote = if (sent) if (count.isBlank()) "Sent to $who." else "Sent to $count customers in $who." else "Saved, but the wallet push was not accepted."
        }
    }

    fun loadCampaigns() {
        val current = session ?: return
        viewModelScope.launch {
            val result = io { API.get("/api/v1/business/${current.slug}/campaigns", current.token) } ?: return@launch
            val rows = (result.second as? JSONObject)?.optJSONArray("campaigns") ?: return@launch
            val list = mutableListOf<CampaignRow>()
            for (i in 0 until minOf(rows.length(), 6)) {
                val row = rows.optJSONObject(i) ?: continue
                val summary = row.optJSONObject("summary") ?: JSONObject()
                val state = (row.optString("effective_status").ifBlank { row.optString("status", "scheduled") }).replace("_", " ")
                list.add(CampaignRow(row.optString("public_id", row.optString("name")), row.optString("name", "Campaign"), "$state · ${API.plain(summary.opt("issued")) ?: "0"} vouchers · ${API.plain(summary.opt("redeemed")) ?: "0"} used"))
            }
            campaigns = list
        }
    }

    fun startCampaign(name: String, kind: String, value: String, start: String, end: String, scope: String, branchId: String) {
        val current = session ?: return
        if (name.isBlank()) { campaignNote = "Name the campaign."; return }
        if (end < start) { campaignNote = "The end date has to be on or after the start."; return }
        if (scope == "single_branch" && branchId.isBlank()) { campaignNote = "Choose a branch."; return }
        val amount = value.toIntOrNull() ?: 0
        if (kind != "buy_one_take_one" && amount <= 0) { campaignNote = "Enter the discount."; return }
        if (kind == "percent_discount" && amount > 100) { campaignNote = "Percent off cannot be more than 100."; return }
        viewModelScope.launch {
            loading = true
            campaignNote = ""
            val label = when (kind) {
                "percent_discount" -> "$amount% off"
                "fixed_discount" -> "₱$amount off"
                else -> "Buy 1 Take 1"
            }
            val body = JSONObject()
                .put("name", name.trim())
                .put("description", JSONObject.NULL)
                .put("scope", scope)
                .put("branch_public_ids", if (scope == "single_branch") JSONArray().put(branchId) else JSONArray())
                .put("qualifying_start_date", start)
                .put("qualifying_end_date", end)
                .put("qualification_type", "any_purchase")
                .put("minimum_spend", 0)
                .put("reward_type", kind)
                .put("reward_label", label)
                .put("reward_description", JSONObject.NULL)
                .put("coupon_start_date", start)
                .put("coupon_end_date", end)
                .put("min_redemption_spend", 0)
                .put("max_per_member", 1)
                .put("applicable_product_text", JSONObject.NULL)
                .put("status", "scheduled")
            if (kind == "buy_one_take_one") body.put("reward_value", JSONObject.NULL) else body.put("reward_value", amount)
            val result = io { API.post("/api/v1/business/${current.slug}/campaigns", current.token, body) }
            loading = false
            if (result == null || result.first >= 400) campaignNote = if (result == null) "Could not reach the server." else API.message(result.second, "Could not start the campaign.")
            else { campaignNote = "Started. The voucher is available from $start until $end, then it ends."; loadCampaigns() }
        }
    }

    fun saveCard() {
        val current = session ?: return
        if (cardConfig.length() == 0) { setupStatus = "The card did not load, so it was not changed."; return }
        viewModelScope.launch {
            loading = true
            setupStatus = ""
            val body = JSONObject(cardConfig.toString())
            body.put("card_type", cardType)
            body.put("card_name", cardName)
            body.put("primary_color", cardColor)
            body.put("stamp_once_per_day", stampOnce)
            body.put("welcome_reward_enabled", welcomeOn)
            body.put("welcome_reward_name", welcomeName)
            body.put("welcome_reward_trigger", welcomeTrigger)
            body.put("welcome_reward_validity_days", welcomeDays)
            body.put("card_expiration_enabled", cardExpires)
            body.put("card_validity_days", cardExpireDays)
            body.put("points_per_amount", pointsPer.toDoubleOrNull() ?: 10.0)
            body.put("points_amount_pesos", pointsPesos.toDoubleOrNull() ?: 100.0)
            if (pointsCap.isBlank()) body.put("points_cap_limit", JSONObject.NULL) else body.put("points_cap_limit", pointsCap.toIntOrNull() ?: 0)
            body.put("points_prizes", JSONArray().apply {
                pointsPrizes.filter { it.name.isNotBlank() }.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("points_cost", it.cost.toIntOrNull() ?: 0)) }
            })
            body.put("membership_duration_days", membershipDays)
            body.put("membership_price", membershipPrice.toDoubleOrNull() ?: 0.0)
            body.put("membership_services", JSONArray().apply { membershipPerks.lines().map { it.trim() }.filter { it.isNotEmpty() }.forEach { put(it) } })
            body.put("membership_terms", membershipTerms)
            body.put("membership_visit_logging_enabled", membershipVisits)
            body.put("membership_quick_checkin", membershipQuick)
            if (cardType == "stamp") {
                val rewards = stampRewards.sortedBy { it.stamps }
                if (rewards.isNotEmpty()) {
                    body.put("stamp_goal", rewards.last().stamps)
                    body.put("reward_name", rewards.last().name)
                } else {
                    body.put("stamp_goal", stampGoal)
                    body.put("reward_name", rewardName)
                }
                body.put("stamp_rewards", JSONArray().apply {
                    rewards.forEach { put(JSONObject().put("id", it.id).put("stamps", it.stamps).put("reward_name", it.name)) }
                })
            } else {
                body.put("stamp_goal", stampGoal)
                body.put("reward_name", rewardName)
            }
            val result = io { API.post("/api/v1/business/${current.slug}/loyalty-config", current.token, body) }
            loading = false
            if (result == null || result.first >= 400) {
                setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not save the card.")
                return@launch
            }
            val saved = result.second as? JSONObject
            applyCard(if (saved?.optString("card_type").isNullOrBlank()) body else saved!!, result.first)
            saveAgreement(current)
            setupStatus = "Card saved."
        }
    }

    private suspend fun saveAgreement(current: OwnerSession) {
        val body = JSONObject()
            .put("mode", agreementMode)
            .put("draft_title", agreementTitle.trim())
            .put("draft_body", agreementBody.trim())
            .put("draft_acknowledgment_text", agreementAck.trim())
        io { API.put("/api/v1/business/${current.slug}/customer-agreement", current.token, body) }?.let { applyAgreement(it.second, it.first) }
    }

    fun groupsOn(categoryId: String) = optionGroups.filter { it.appliesToAll || categoryId in it.categoryIds }.map { it.id }

    fun saveMenuItem(id: String?, name: String, price: String, detail: String, categoryId: String, shown: Boolean, inStock: Boolean, selected: Set<String>, unavailable: List<String>, sortOrder: Int, done: (Boolean) -> Unit = {}) {
        val current = session ?: return
        val pesos = price.replace(",", "").toDoubleOrNull()
        if (name.isBlank() || pesos == null || pesos < 0) { setupStatus = "Enter an item name and a price. Use 0 if it is free."; done(false); return }
        if (id == null && categoryId.isBlank()) { setupStatus = "Choose a section first."; done(false); return }
        viewModelScope.launch {
            loading = true
            setupStatus = ""
            val inherited = groupsOn(categoryId).toSet()
            val body = JSONObject()
                .put("name", name.trim())
                .put("description", detail.trim())
                .put("base_price", pesos)
                .put("image_url", "")
                .put("is_active", shown)
                .put("is_available", inStock)
                .put("modifier_group_public_ids", JSONArray().apply { selected.subtract(inherited).forEach { put(it) } })
                .put("excluded_inherited_modifier_group_public_ids", JSONArray().apply { inherited.subtract(selected).forEach { put(it) } })
                .put("unavailable_branch_public_ids", JSONArray().apply { unavailable.forEach { put(it) } })
                .put("sort_order", sortOrder)
            if (categoryId.isNotBlank()) body.put("category_public_id", categoryId)
            val result = if (id == null) io { API.post("/api/v1/business/${current.slug}/order-ahead/items", current.token, body) }
            else io { API.patch("/api/v1/business/${current.slug}/order-ahead/items/$id", current.token, body) }
            loading = false
            if (result == null || result.first >= 400) {
                setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not save the item.")
                done(false)
            } else {
                setupStatus = "Saved."
                refresh()
                done(true)
            }
        }
    }

    fun addMenuItem(name: String, price: String, categoryId: String) {
        saveMenuItem(null, name, price, "", categoryId, true, true, groupsOn(categoryId).toSet(), emptyList(), menuRows.size)
    }

    fun saveOptionGroup(id: String?, name: String, required: Boolean, categoryIds: List<String>, options: List<OptionChoice>, done: (String?) -> Unit = {}) {
        val current = session ?: return
        val choices = options.filter { it.name.isNotBlank() }
        if (name.isBlank() || choices.isEmpty()) { setupStatus = "Name the group and add at least one choice."; done(null); return }
        viewModelScope.launch {
            loading = true
            setupStatus = ""
            val payload = JSONArray()
            choices.forEachIndexed { index, choice ->
                val row = JSONObject().put("name", choice.name.trim()).put("price_delta", choice.price.replace(",", "").toDoubleOrNull() ?: 0.0).put("is_active", true).put("sort_order", index)
                if (!choice.id.startsWith("new-")) row.put("public_id", choice.id)
                payload.put(row)
            }
            val body = JSONObject()
                .put("name", name.trim())
                .put("selection_type", "single")
                .put("is_required", required)
                .put("min_selections", if (required) 1 else 0)
                .put("max_selections", 1)
                .put("is_active", true)
                .put("applies_to_all", false)
                .put("category_public_ids", JSONArray().apply { categoryIds.forEach { put(it) } })
                .put("sort_order", 0)
                .put("options", payload)
            val result = if (id == null) io { API.post("/api/v1/business/${current.slug}/order-ahead/modifier-groups", current.token, body) }
            else io { API.patch("/api/v1/business/${current.slug}/order-ahead/modifier-groups/$id", current.token, body) }
            loading = false
            if (result == null || result.first >= 400) {
                setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not save that option group.")
                done(null)
            } else {
                val obj = result.second as? JSONObject
                val nested = obj?.optJSONObject("modifier_group")?.optString("public_id").orEmpty()
                val created = nested.ifBlank { obj?.optString("public_id").orEmpty() }
                refresh()
                setupStatus = ""
                done(id ?: created)
            }
        }
    }

    fun deleteOptionGroup(id: String) {
        val current = session ?: return
        viewModelScope.launch {
            val result = io { API.delete("/api/v1/business/${current.slug}/order-ahead/modifier-groups/$id", current.token) }
            if (result == null || result.first >= 400) setupStatus = if (result == null) "Could not reach the server." else API.message(result.second, "Could not delete that option group.")
            else refresh()
        }
    }

    fun customerMenuOrders(id: String, done: (CustomerOrderHistory?, String) -> Unit) {
        val current = session ?: return done(null, "Please sign in again.")
        if (!current.isOwner) return done(null, "Only the owner can see customer spending.")
        viewModelScope.launch {
            val result = io { API.get("/api/v1/business/${current.slug}/customers/$id/menu-order-history", current.token) }
            val body = result?.second as? JSONObject
            if (result == null || result.first >= 400 || body == null) {
                done(null, if (result == null) "Could not connect to the server." else API.message(result.second, "Orders unavailable. Try again."))
                return@launch
            }
            val summary = body.optJSONObject("summary")
            val rows = body.optJSONArray("orders") ?: JSONArray()
            val orders = mutableListOf<CustomerMenuOrder>()
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                val items = row.optJSONArray("items") ?: JSONArray()
                val names = mutableListOf<String>()
                for (j in 0 until minOf(items.length(), 40)) {
                    val item = items.optJSONObject(j) ?: continue
                    names.add("${item.optInt("quantity", 1)}× ${item.optString("name", "Item")}")
                }
                orders.add(CustomerMenuOrder(
                    row.optString("order_number"), row.optString("status"), row.optString("payment_status"),
                    API.plain(row.opt("total")) ?: "—", API.plain(row.opt("verified_spent")) ?: "0",
                    row.optString("created_at"), row.optString("branch_name"), names.joinToString(", ")
                ))
            }
            done(CustomerOrderHistory(summary?.optInt("total_orders") ?: orders.size,
                summary?.optInt("completed_paid_orders") ?: 0,
                API.plain(summary?.opt("total_spent")) ?: "0",
                summary?.optBoolean("complete", false) ?: false, orders), "")
        }
    }

    fun activity(id: String, done: (List<ActivityLine>) -> Unit) {
        val current = session ?: return
        viewModelScope.launch {
            val result = io { API.get("/api/v1/business/${current.slug}/customers/$id/stamp-history", current.token) }
            val rows = result?.second as? JSONArray
            if (result == null || result.first >= 400 || rows == null) { done(emptyList()); return@launch }
            val lines = mutableListOf<ActivityLine>()
            for (i in 0 until minOf(rows.length(), 30)) {
                val row = rows.optJSONObject(i) ?: continue
                val kind = row.optString("activity_type", "stamp")
                val number = API.plain(row.opt("stamp_number"))
                val title = when (kind) {
                    "stamp" -> if (number == null) "Stamp" else "Stamp $number"
                    "coupon_issued" -> "Coupon issued"
                    "coupon_redeemed" -> "Coupon used"
                    else -> row.optString("activity_label").ifBlank { kind.replace("_", " ") }
                }
                val who = row.optString("staff_name").let { if (it.isBlank() || it == "null") "" else it }
                val reward = row.optString("reward_text").ifBlank { row.optString("activity_detail") }.let { if (it == "null") "" else it }
                val detail = listOf(who, reward).filter { it.isNotBlank() }.joinToString(" · ")
                lines.add(ActivityLine(row.optString("id", "$i"), title, detail, row.optString("created_at")))
            }
            done(lines)
        }
    }

    fun giveCoupon(memberId: String, text: String, done: (String) -> Unit) {
        val current = session ?: return
        val clean = text.trim()
        if (clean.isEmpty()) { done("Write what the coupon is for."); return }
        viewModelScope.launch {
            val result = io { API.post("/api/v1/business/${current.slug}/customers/$memberId/coupons", current.token, JSONObject().put("reward_text", clean)) }
            done(if (result == null) "Could not reach the server." else if (result.first >= 400) API.message(result.second, "Could not add the coupon.") else "Coupon added.")
        }
    }

    fun loadBilling() {
        val current = session ?: return
        viewModelScope.launch {
            val result = io { API.get("/api/v1/business/${current.slug}/subscription", current.token) }
            val json = result?.second as? JSONObject
            if (result == null || result.first >= 400 || json == null) { billingNote = "Billing did not load."; return@launch }
            billPlan = json.optString("plan", "starter").replaceFirstChar { it.uppercase() }
            billStatus = json.optString("subscription_status")
            billDays = API.plain(json.opt("days_left")).orEmpty()
            billExpires = json.optString("subscription_expires_at").take(10)
            val pricing = json.optJSONObject("pricing") ?: JSONObject()
            billPrices = listOf("monthly" to "1 month", "3_months" to "3 months", "6_months" to "6 months", "annual" to "1 year").mapNotNull { (key, label) ->
                val pesos = API.plain(pricing.opt(key))?.toDoubleOrNull()?.toInt() ?: return@mapNotNull null
                BillPrice(key, label, pesos)
            }
            val pays = io { API.get("/api/v1/business/${current.slug}/subscription/payments", current.token) }
            val rows = pays?.second as? JSONArray
            val list = mutableListOf<BillPay>()
            if (rows != null) for (i in 0 until minOf(rows.length(), 4)) {
                val row = rows.optJSONObject(i) ?: continue
                val amount = (API.plain(row.opt("display_amount")) ?: API.plain(row.opt("amount")) ?: "0").toDoubleOrNull()?.toInt() ?: 0
                list.add(BillPay("pay-$i", "₱$amount · ${row.optString("status")}", row.optString("created_at").take(10)))
            }
            billPays = list
        }
    }

    fun loadAccount() {
        val current = session ?: return
        viewModelScope.launch {
            val result = io { API.get("/api/v1/business/${current.slug}", current.token) }
            val json = result?.second as? JSONObject ?: return@launch
            accountPhone = json.optString("phone")
            accountAddress = json.optString("address")
            accountContact = json.optString("contact_person")
            accountStatus = json.optString("status")
        }
    }

    fun manila(date: Calendar = Calendar.getInstance(TimeZone.getTimeZone("Asia/Manila"))): String {
        return String.format("%04d-%02d-%02d", date.get(Calendar.YEAR), date.get(Calendar.MONTH) + 1, date.get(Calendar.DAY_OF_MONTH))
    }

    private fun applyBoard(body: Any, code: Int) {
        val json = body as? JSONObject
        if (code >= 400 || json == null) { billboardNote = API.message(body, "Billboard did not load."); return }
        billboardAllowed = json.optBoolean("feature_enabled", true)
        billboardOn = json.optBoolean("enabled", false)
        billboardMessage = json.optString("message", "You are near us. Open your Loyalty Tree card.")
        billboardNote = if (billboardAllowed) "" else json.optString("access_message", "Nearby alerts are not on this plan.")
        pins = json.optJSONArray("pins") ?: JSONArray()
        val first = pins.optJSONObject(0)
        pinLabel = first?.optString("label").ifNullOrBlank(first?.optString("branch_name").orEmpty())
        pinLat = API.plain(first?.opt("latitude")).orEmpty()
        pinLng = API.plain(first?.opt("longitude")).orEmpty()
    }

    private fun applyAnalytics(body: Any, code: Int) {
        val json = body as? JSONObject ?: return
        val overview = json.optJSONObject("overview") ?: return
        if (code >= 400) return
        analyticsProgram = json.optString("program_name")
        cardStamps = API.plain(overview.opt("total_stamps")) ?: "0"
        cardRewards = API.plain(overview.opt("total_rewards")) ?: "0"
        cardNew = API.plain(overview.opt("new_customers")) ?: "0"
        cardActive = API.plain(overview.opt("active_members")) ?: "0"
        cardAverage = API.plain(overview.opt("avg_stamps_per_customer")) ?: "0"
        cameBackRate = API.plain(overview.opt("adoption_rate"))?.toDoubleOrNull() ?: 0.0
        memberCount = API.plain(overview.opt("total_customers")) ?: memberCount
        val people = json.optJSONObject("customers") ?: JSONObject()
        churnCount = API.plain(people.opt("churn_risk"))?.toDoubleOrNull()?.toInt() ?: 0
        analytics = listOf(
            StatFact("stamps", "Stamps", cardStamps),
            StatFact("rewards", "Rewards used", cardRewards),
            StatFact("new", "New members", cardNew),
            StatFact("active", "Active members", cardActive),
            StatFact("members", "Members", memberCount),
            StatFact("quiet", "Gone quiet", churnCount.toString()),
            StatFact("back", "Came back", "${cameBackRate.toInt()}%"),
            StatFact("average", "Stamps per active", cardAverage)
        )
        val tops = people.optJSONArray("top_customers") ?: JSONArray()
        val list = mutableListOf<NamedCount>()
        for (i in 0 until minOf(tops.length(), 8)) {
            val row = tops.optJSONObject(i) ?: continue
            list.add(NamedCount("top-$i", row.optString("name", "Member"), "${API.plain(row.opt("stamps")) ?: "0"} stamps"))
        }
        topMembers = list
        val trends = json.optJSONObject("trends") ?: JSONObject()
        dailyBars = bars(trends.optJSONArray("stamps"), "day")
        val clock = json.optJSONObject("time_analytics") ?: JSONObject()
        val hours = clock.optJSONArray("hours") ?: JSONArray()
        val hourList = mutableListOf<HourBar>()
        for (i in 0 until hours.length()) {
            val row = hours.optJSONObject(i) ?: continue
            val count = (API.plain(row.opt("activity_count"))?.toIntOrNull() ?: 0) + (API.plain(row.opt("reward_count"))?.toIntOrNull() ?: 0)
            if (count <= 0) continue
            val label = row.optString("label")
            hourList.add(HourBar(label, label, count))
        }
        hourBars = hourList
        val branchesJson = json.optJSONArray("branch_performance") ?: JSONArray()
        val branchList = mutableListOf<NamedCount>()
        for (i in 0 until branchesJson.length()) {
            val row = branchesJson.optJSONObject(i) ?: continue
            val name = row.optString("name", "Branch")
            branchList.add(NamedCount("branch-$i", name, "${API.plain(row.opt("activities")) ?: "0"} stamps · ${API.plain(row.opt("rewards")) ?: "0"} rewards"))
        }
        branchFacts = branchList
        todayStamps = todayPoint(trends.optJSONArray("stamps"))
        todayRewards = todayPoint(trends.optJSONArray("rewards"))
        todayNew = todayPoint(trends.optJSONArray("customers"))
        analyticsNote = if (json.optJSONObject("revenue")?.optBoolean("tracked") == true) "" else "Sales amounts are not on the card yet."
    }

    private fun bars(rows: JSONArray?, prefix: String): List<HourBar> {
        if (rows == null) return emptyList()
        val list = mutableListOf<HourBar>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val count = API.plain(row.opt("value"))?.toDoubleOrNull()?.toInt() ?: 0
            if (count <= 0) continue
            val label = row.optString("label")
            list.add(HourBar("$prefix-$label", label, count))
        }
        return list
    }

    private fun todayPoint(rows: JSONArray?): String {
        if (rows == null) return "0"
        val now = Calendar.getInstance()
        val month = java.text.DateFormatSymbols(java.util.Locale.US).shortMonths[now.get(Calendar.MONTH)]
        val day = now.get(Calendar.DAY_OF_MONTH)
        val labels = setOf("$month $day", String.format("%s %02d", month, day))
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optString("label") in labels) return API.plain(row.opt("value")) ?: "0"
        }
        return "0"
    }

    private fun applyGreetings(body: Any, code: Int) {
        val json = body as? JSONObject ?: return
        if (code >= 400) return
        birthdayOn = json.optBoolean("birthday_enabled", true)
        birthdayMessage = json.optString("birthday_message")
        birthdayRewardOn = json.optBoolean("birthday_reward_enabled", false)
        birthdayRewardName = json.optString("birthday_reward_name")
        birthdayRewardDays = json.optInt("birthday_reward_validity_days", 7)
        birthdayTiming = json.optString("birthday_send_timing", "birthday")
        churnMessage = json.optString("win_back_message")
        churnDays = json.optInt("churn_days", 30)
    }

    private fun applySent(body: Any) {
        val json = body as? JSONObject ?: return
        birthdaySent = API.plain(json.optJSONObject("birthday")?.opt("last_7_days")) ?: birthdaySent
        churnSent = API.plain(json.optJSONObject("win_back")?.opt("last_7_days")) ?: churnSent
    }

    private fun applyCard(body: Any, code: Int) {
        val json = body as? JSONObject ?: return
        if (code >= 400) return
        cardConfig = json
        cardName = json.optString("card_name").ifBlank { "Loyalty card" }
        stampGoal = json.optInt("stamp_goal", 8)
        rewardName = json.optString("reward_name").ifBlank { "Free reward" }
        cardType = json.optString("card_type", "stamp")
        cardColor = json.optString("primary_color").ifBlank { "#073f36" }
        stampOnce = json.optBoolean("stamp_once_per_day", false)
        welcomeOn = json.optBoolean("welcome_reward_enabled", false)
        welcomeName = json.optString("welcome_reward_name")
        welcomeTrigger = json.optString("welcome_reward_trigger", "join")
        welcomeDays = json.optInt("welcome_reward_validity_days", 30)
        cardExpires = json.optBoolean("card_expiration_enabled", false)
        cardExpireDays = json.optInt("card_validity_days", 365)
        pointsPer = API.plain(json.opt("points_per_amount")) ?: "10"
        pointsPesos = API.plain(json.opt("points_amount_pesos")) ?: "100"
        pointsCap = API.plain(json.opt("points_cap_limit")) ?: ""
        val prizes = json.optJSONArray("points_prizes") ?: JSONArray()
        pointsPrizes = (0 until prizes.length()).mapNotNull { index ->
            val row = prizes.optJSONObject(index) ?: return@mapNotNull null
            val name = row.optString("name")
            if (name.isBlank()) null else PointsPrize(row.optString("id").ifBlank { "prize-$index" }, name, API.plain(row.opt("points_cost")) ?: "0")
        }
        membershipDays = json.optInt("membership_duration_days", 30)
        membershipPrice = API.plain(json.opt("membership_price")) ?: "0"
        val services = json.optJSONArray("membership_services")
        membershipPerks = if (services == null) "" else (0 until services.length()).mapNotNull { services.optString(it).takeIf { line -> line.isNotBlank() } }.joinToString("\n")
        membershipTerms = json.optString("membership_terms")
        membershipVisits = json.optBoolean("membership_visit_logging_enabled", true)
        membershipQuick = json.optBoolean("membership_quick_checkin", false)
        val rewards = json.optJSONArray("stamp_rewards") ?: JSONArray()
        stampRewards = (0 until rewards.length()).mapNotNull { index ->
            val row = rewards.optJSONObject(index) ?: return@mapNotNull null
            val stamps = API.plain(row.opt("stamps"))?.toIntOrNull() ?: 0
            val name = row.optString("reward_name")
            if (stamps <= 0 || name.isBlank()) null else StampReward(row.optString("id").ifBlank { "reward-$index" }, stamps, name)
        }.sortedBy { it.stamps }
        stampRewards.lastOrNull()?.let {
            stampGoal = it.stamps
            rewardName = it.name
        }
    }

    private fun applyAgreement(body: Any, code: Int) {
        val json = body as? JSONObject ?: return
        if (code >= 400) return
        val mode = json.optString("mode", "off")
        agreementMode = if (mode in setOf("off", "checkbox", "signature")) mode else "off"
        agreementTitle = json.optString("draft_title").ifBlank { "Customer Terms & Conditions" }
        agreementBody = json.optString("draft_body")
        agreementAck = json.optString("draft_acknowledgment_text").ifBlank { "I have read and agree to these terms." }
    }

    private fun applyMenu(body: Any, code: Int) {
        val json = body as? JSONObject
        if (code >= 400 || json == null) { menuRows = emptyList(); return }
        val categories = json.optJSONArray("categories") ?: JSONArray()
        val names = mutableMapOf<String, String>()
        val cats = mutableListOf<StatFact>()
        for (i in 0 until categories.length()) {
            val row = categories.optJSONObject(i) ?: continue
            val id = row.optString("public_id")
            if (id.isBlank()) continue
            val name = row.optString("name", "Menu")
            names[id] = name
            cats.add(StatFact(id, name, name))
        }
        menuCategories = cats.sortedBy { it.label }
        val items = json.optJSONArray("items") ?: JSONArray()
        val rows = mutableListOf<MenuRow>()
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i) ?: continue
            val id = row.optString("public_id")
            if (id.isBlank()) continue
            val categoryId = row.optString("category_public_id")
            val price = API.plain(row.opt("base_price")) ?: "0"
            rows.add(MenuRow(
                id, categoryId, names[categoryId] ?: "Menu", row.optString("name", "Item"), "₱$price", price,
                row.optString("description"), row.optBoolean("is_available", true), row.optBoolean("is_active", true),
                row.optInt("sort_order", i), jsonStrings(row.opt("direct_modifier_group_public_ids")),
                jsonStrings(row.opt("excluded_inherited_modifier_group_public_ids")), jsonStrings(row.opt("unavailable_branch_public_ids"))
            ))
        }
        menuRows = rows
        val groups = json.optJSONArray("modifier_groups") ?: JSONArray()
        val parsed = mutableListOf<OptionGroup>()
        for (i in 0 until groups.length()) {
            val row = groups.optJSONObject(i) ?: continue
            if (!row.optBoolean("is_active", true)) continue
            val id = row.optString("public_id")
            if (id.isBlank()) continue
            val options = row.optJSONArray("options") ?: JSONArray()
            val choices = mutableListOf<OptionChoice>()
            for (j in 0 until options.length()) {
                val option = options.optJSONObject(j) ?: continue
                if (!option.optBoolean("is_active", true)) continue
                val optionId = option.optString("public_id").ifBlank { "opt-$j" }
                choices.add(OptionChoice(optionId, option.optString("name"), API.plain(option.opt("price_delta")) ?: "0"))
            }
            parsed.add(OptionGroup(id, row.optString("name", "Options"), row.optBoolean("is_required", false), row.optBoolean("applies_to_all", false), jsonStrings(row.opt("category_public_ids")), choices))
        }
        optionGroups = parsed
    }

    private fun applyGuest(body: Any, code: Int) {
        val json = body as? JSONObject ?: return
        if (code >= 400) return
        wifiOn = json.optBoolean("wifi_published", false)
        wifiName = json.optString("wifi_name")
        wifiPassword = json.optString("wifi_password")
        socialsOn = json.optBoolean("socials_published", false)
        reviewURL = json.optString("review_url")
        bookOn = json.optBoolean("book_published", false)
        bookURL = json.optString("book_url")
        bookNote = json.optString("book_note")
        reserveOn = json.optBoolean("reserve_published", false)
        reserveURL = json.optString("reserve_url")
        if (json.has("reserve_note")) reserveNote = json.optString("reserve_note")
        if (json.has("opening_time")) openTime = json.optString("opening_time")
        if (json.has("closing_time")) closeTime = json.optString("closing_time")
        val links = json.optJSONArray("links") ?: JSONArray()
        instagramURL = ""
        facebookURL = ""
        tiktokURL = ""
        otherLinks = JSONArray()
        for (i in 0 until links.length()) {
            val link = links.optJSONObject(i) ?: continue
            val label = link.optString("label")
            val url = link.optString("url")
            val blob = (label + " " + url).lowercase()
            when {
                label.trim().equals("TikTok", ignoreCase = true) || validTikTokURL(url) -> tiktokURL = url
                "instagram" in blob -> instagramURL = url
                "facebook" in blob || "fb.com" in blob -> facebookURL = url
                url.isNotBlank() -> otherLinks.put(JSONObject().put("label", label.ifBlank { "Link" }).put("url", url))
            }
        }
    }

    private fun applyBranches(body: Any, code: Int) {
        if (code >= 400) return
        val rows = body as? JSONArray ?: (body as? JSONObject)?.optJSONArray("branches") ?: return
        val list = mutableListOf<BranchPlace>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (!row.optBoolean("is_active", true)) continue
            val id = row.optString("public_id").ifBlank { row.optString("id") }
            if (id.isBlank()) continue
            list.add(BranchPlace(id, row.optString("name", "Branch")))
        }
        branches = list
    }

    private fun parseMembers(body: Any): List<Member> {
        val rows = body as? JSONArray ?: (body as? JSONObject)?.optJSONArray("customers") ?: return emptyList()
        val list = mutableListOf<Member>()
        for (i in 0 until minOf(rows.length(), 300)) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("public_id").ifBlank { row.optString("id", "m-$i") }
            list.add(Member(
                id,
                row.optString("name").ifBlank { row.optString("full_name").ifBlank { row.optString("customer_name", "Member") } },
                row.optString("phone").ifBlank { row.optString("mobile") },
                row.optString("email"),
                API.plain(row.opt("stamp_count"))?.toIntOrNull() ?: 0,
                API.plain(row.opt("points_balance")) ?: API.plain(row.opt("lt_points")) ?: "0",
                row.optString("last_stamp_at").ifBlank { "No stamp yet" },
                API.plain(row.opt("birthday_month"))?.toIntOrNull() ?: 0,
                API.plain(row.opt("birthday_day"))?.toIntOrNull() ?: 0
            ))
        }
        return list
    }

    private fun jsonStrings(value: Any?): List<String> {
        val rows = value as? JSONArray ?: return emptyList()
        return (0 until rows.length()).mapNotNull { rows.optString(it).takeIf { text -> text.isNotBlank() } }
    }

    private fun fact(body: Any, key: String): String? {
        val json = body as? JSONObject ?: return null
        return API.plain(json.opt(key))
    }

    private suspend fun <T> io(block: () -> T): T? = withContext(Dispatchers.IO) { runCatching { block() }.getOrNull() }
}

private fun String?.ifNullOrBlank(fallback: String) = if (this.isNullOrBlank()) fallback else this
