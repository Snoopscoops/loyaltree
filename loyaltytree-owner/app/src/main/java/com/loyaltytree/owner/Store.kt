package com.loyaltytree.owner

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

data class OwnerSession(val token: String, val slug: String, val businessName: String, val email: String, val role: String)
data class Member(val id: String, val name: String, val phone: String, val email: String, val stamps: Int, val points: String, val lastVisit: String, val birthdayMonth: Int = 0, val birthdayDay: Int = 0)
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
data class OrderLine(val name: String, val detail: String)
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
    val paymentMethod: String = ""
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
            json.optString("role")
        )
    }

    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            loading = true
            status = ""
            val result = io { API.post("/api/v1/auth/login", null, JSONObject().put("email", email).put("password", password)) }
            loading = false
            if (result == null) { status = "No connection. Check the signal and try again."; return@launch }
            val (code, body) = result
            val json = body as? JSONObject
            val token = json?.optString("token").orEmpty()
            if (code != 200 || token.isBlank()) { status = API.message(body, "Could not sign in."); return@launch }
            val role = json?.optString("role").orEmpty()
            val slug = json?.optString("business_slug").orEmpty()
            if ((role != "owner" && role != "manager") || slug.isBlank()) {
                status = "Use a business owner account. This phone is the counter, not admin."
                return@launch
            }
            val next = OwnerSession(token, slug, json?.optString("business_name").ifNullOrBlank("LoyaltyTree"), email, role)
            prefs.edit().putString("session", JSONObject().put("token", next.token).put("slug", next.slug).put("businessName", next.businessName).put("email", next.email).put("role", next.role).toString()).apply()
            session = next
            refresh()
        }
    }

    fun signOut() {
        session = null
        members = emptyList()
        menuRows = emptyList()
        status = ""
        prefs.edit().remove("session").apply()
    }

    fun refresh() {
        val current = session ?: return
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
            memberCount = fact(stats.second, "total_customers") ?: "0"
            members = parseMembers(people.second)
            if (board != null) applyBoard(board.second, board.first)
            loadSetup(current)
            fetchOrders(current)
            loading = false
        }
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
        ordersBranch = id
        val current = session ?: return
        viewModelScope.launch { fetchSummary(current) }
    }

    private suspend fun fetchSummary(current: OwnerSession) {
        val branch = java.net.URLEncoder.encode(ordersBranch, "UTF-8")
        val result = io { API.get("/api/v1/business/${current.slug}/menu-orders/summary?branch=$branch", current.token) }
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
    fun downloadReport(done: (ShareReport) -> Unit) {
        val current = session ?: return
        if (reportBusy) return
        val query = when (reportRange) {
            "yesterday" -> {
                val day = Calendar.getInstance(TimeZone.getTimeZone("Asia/Manila"))
                day.add(Calendar.DAY_OF_MONTH, -1)
                "date=${manila(day)}"
            }
            "week" -> "period=week"
            "month" -> "period=month"
            else -> "date=${manila()}"
        }
        val branch = java.net.URLEncoder.encode(ordersBranch, "UTF-8")
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

    fun markPaid(id: String) {
        val current = session ?: return
        viewModelScope.launch {
            orderBusy = id
            ordersNote = ""
            val result = io { API.patch("/api/v1/business/${current.slug}/menu-orders/$id/payment", current.token, JSONObject().put("payment_status", "paid")) }
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
        val apiPeriod = when (period) {
            "today" -> "today"
            "7d" -> "week"
            "90d" -> "3months"
            else -> "month"
        }
        val branch = java.net.URLEncoder.encode(analyticsBranch, "UTF-8")
        viewModelScope.launch {
            insightsLoading = true
            val result = io { API.get("/api/v1/business/${current.slug}/menu-orders/insights?period=$apiPeriod&branch=$branch", current.token) }
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
                    val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", true)
                    val result = io { API.post("/api/v1/business/${current.slug}/stamp", current.token, body) }
                    if (result == null || result.first >= 400) {
                        error = if (result == null) "Could not reach the server." else API.message(result.second, "Could not add the stamp.")
                        break
                    }
                    added += 1
                }
            } else {
                val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", true).put("delta", delta)
                    .put("reason", "Owner correction in the LoyaltyTree app")
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
            val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", true).put("amount_spent", amount)
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
            val body = JSONObject().put("customer_public_id", customer.id).put("as_owner", true)
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

    private suspend fun fetchOrders(current: OwnerSession) {
        val menu = io { API.get("/api/v1/business/${current.slug}/menu-orders", current.token) }
        val ahead = io { API.get("/api/v1/business/${current.slug}/order-ahead/orders?limit=100", current.token) }
        if (menu == null && ahead == null) {
            ordersNote = "Could not reach orders."
            return
        }
        val combined = buildList {
            if (menu != null && menu.first < 400) addAll(parseOrders(menu.second, "menu"))
            if (ahead != null && ahead.first < 400) addAll(parseOrders(ahead.second, "ahead"))
        }
        orders = combined.distinctBy { it.id }
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
                        add(OrderLine("$qty × $name", modifierText(item.opt("modifiers"))))
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
                        paymentMethod = row.optString("payment_method")
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
        viewModelScope.launch {
            loading = true
            status = ""
            val next = JSONArray(pins.toString())
            val lat = pinLat.toDoubleOrNull()
            val lng = pinLng.toDoubleOrNull()
            if (lat != null && lng != null) {
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

    fun saveGuest() {
        val current = session ?: return
        viewModelScope.launch {
            guestStatus = ""
            val links = JSONArray(otherLinks.toString())
            if (instagramURL.isNotBlank()) links.put(JSONObject().put("label", "Instagram").put("url", instagramURL.trim()))
            if (facebookURL.isNotBlank()) links.put(JSONObject().put("label", "Facebook").put("url", facebookURL.trim()))
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
        otherLinks = JSONArray()
        for (i in 0 until links.length()) {
            val link = links.optJSONObject(i) ?: continue
            val label = link.optString("label")
            val url = link.optString("url")
            val blob = (label + " " + url).lowercase()
            when {
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
