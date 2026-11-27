package com.loyaltytree.owner

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.Instant
import java.math.BigDecimal
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray

private val AdminInk = Color(0xFF123E34)
private val AdminLime = Color(0xFFBDE8CF)
private val AdminPaper = Color(0xFFF2F6F4)
private val AdminMuted = Color(0xFF65736A)

private fun countLabel(value: Any?): String {
    val n = (value as? Number)?.toDouble() ?: return "—"
    return if (n.isFinite() && n >= 0 && n % 1 == 0.0 && n < Long.MAX_VALUE.toDouble()) "%,d".format(n.toLong()) else "—"
}

@Composable
internal fun AdminConsole(store: CounterStore, current: OwnerSession) {
    if (!current.isAdmin || store.session !== current) return
    key(current) {
        var tab by remember { mutableStateOf("Home") }
        var refresh by remember { mutableIntStateOf(0) }
        var busy by remember { mutableStateOf(true) }
        var note by remember { mutableStateOf("") }
        var data by remember { mutableStateOf<Any?>(null) }
        var period by remember { mutableIntStateOf(7) }
        var invoices by remember { mutableStateOf<JSONArray?>(null) }
        var analytics by remember { mutableStateOf<JSONObject?>(null) }
        val path = when (tab) {
            "Home" -> "/api/v1/admin/overview"
            "Clients" -> "/api/v1/admin/businesses"
            "Finance" -> "/api/v1/admin/businesses"
            "Activity" -> "/api/v1/admin/client-performance?days=$period"
            else -> null
        }
        LaunchedEffect(current, tab, refresh, period) {
            busy = true
            data = null
            note = ""
            if (path != null) {
                val response = withContext(Dispatchers.IO) {
                    try { API.get(path, current.token) }
                    catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: Exception) { null }
                }
                if (store.session !== current) return@LaunchedEffect
                when {
                    response?.first == 401 || response?.first == 403 -> {
                        store.signOut()
                        store.status = "Administrator access expired. Sign in again."
                        return@LaunchedEffect
                    }
                    response?.first != 200 -> note = "Could not load records. Refresh to retry."
                    tab in listOf("Home", "Activity") && response.second is JSONObject -> data = response.second
                    tab in listOf("Clients", "Finance") && response.second is JSONArray -> data = response.second
                    else -> note = "Unexpected response. Refresh to retry."
                }
            }
            val extraPath = when(tab) {
                "Finance" -> "/api/v1/admin/special-invoices"
                "Activity" -> "/api/v1/admin/platform-analytics?days=$period"
                else -> null
            }
            invoices = null
            analytics = null
            if (extraPath != null) {
                val extra = withContext(Dispatchers.IO) {
                    try { API.get(extraPath, current.token) }
                    catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: Exception) { null }
                }
                if (store.session !== current) return@LaunchedEffect
                if (extra?.first == 401 || extra?.first == 403) {
                    store.signOut()
                    store.status = "Administrator access expired. Sign in again."
                    return@LaunchedEffect
                }
                if (extra?.first == 200) {
                    if (tab == "Finance") invoices = extra.second as? JSONArray
                    if (tab == "Activity") analytics = extra.second as? JSONObject
                }
            }
            busy = false
        }
        Scaffold(containerColor = AdminPaper, bottomBar = {
            NavigationBar(containerColor = Color.White) {
                listOf("Home", "Clients", "Finance", "Activity", "Settings").forEach { item ->
                    NavigationBarItem(selected = tab == item, onClick = { if(tab != item) { data = null; note = ""; busy = true; tab = item } },
                        icon = { Text(when(item) { "Home" -> "⌂"; "Clients" -> "▤"; "Finance" -> "₱"; "Activity" -> "↗"; else -> "⚙" }, fontSize = 22.sp) },
                        label = { Text(if (item == "Activity") "Growth" else item, fontSize = 10.sp) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = AdminLime, selectedIconColor = AdminInk, selectedTextColor = AdminInk))
                }
            }
        }) { inset ->
            Column(Modifier.padding(inset).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("LoyaltyTree  /  ADMIN", color = AdminInk, fontWeight = FontWeight.Bold, fontSize = 19.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { refresh++ }, enabled = !busy && path != null) { Text("Refresh", color = AdminInk) }
                }
                Text(if (tab == "Home") "Command center" else tab, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = AdminInk)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = AdminInk)
                if (note.isNotEmpty()) Text(note, color = Color(0xFF9C3329))
                when(tab) {
                    "Home" -> {
                        val overview = data as? JSONObject
                        Column(Modifier.fillMaxWidth().background(AdminInk, RoundedCornerShape(22.dp)).padding(22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("NETWORK OVERVIEW", color = AdminLime, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(countLabel(overview?.opt("total_businesses")), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                                    Text("Businesses", color = AdminLime, fontSize = 13.sp)
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(countLabel(overview?.opt("total_branches")), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                                    Text("Total branches", color = AdminLime, fontSize = 13.sp)
                                }
                            }
                            Text("Platform-wide totals · refresh for latest records", color = Color(0xFFB7C8BB), fontSize = 12.sp)
                        }
                        Text("Daily report", fontWeight = FontWeight.Bold, fontSize = 21.sp, color = AdminInk)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            AdminMetric("New members today", "Unavailable", Modifier.weight(1f))
                            AdminMetric("New businesses today", "Unavailable", Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            AdminMetric("Due today", "Unavailable", Modifier.weight(1f))
                            AdminMetric("Billing calendar", "Open Finance", Modifier.weight(1f))
                        }
                        Text("Daily reporting requires verified server metrics. Missing values are not zero.", fontSize = 12.sp, color = AdminMuted)
                        Text("Network totals", fontWeight = FontWeight.Bold, fontSize = 21.sp, color = AdminInk)
                        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                            AdminMetric("Customers", countLabel(overview?.opt("total_customers")), Modifier.weight(1f))
                            AdminMetric("Pending businesses", countLabel(overview?.optJSONObject("status_breakdown")?.opt("PENDING")), Modifier.weight(1f))
                        }
                        Text("Quick access", fontWeight = FontWeight.Bold, fontSize = 21.sp, color = AdminInk)
                        listOf("Clients" to "Business accounts", "Finance" to "Invoice ledger", "Activity" to "Platform activity", "Settings" to "Account & security").forEach { (dest, label) ->
                            OutlinedButton(onClick = { data = null; tab = dest }, modifier = Modifier.fillMaxWidth()) { Text(label, color = AdminInk) }
                        }
                    }
                    "Clients" -> {
                        val rows = data as? JSONArray
                        if (rows != null) {
                            Text("Returned records: ${rows.length()}", color = AdminMuted)
                            for(i in 0 until rows.length()) {
                                val row = rows.optJSONObject(i) ?: continue
                                AdminMetric(row.optString("name", row.optString("business_name", "Business")), row.optString("status", "—"))
                            }
                            if(rows.length() == 0) Text("No records returned.")
                        }
                    }
                    "Finance" -> AdminBillingCalendar(data as? JSONArray, invoices)
                    "Activity" -> {
                        val report = data as? JSONObject
                        Text("Growth intelligence", fontWeight = FontWeight.Bold, fontSize = 22.sp, color = AdminInk)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(7, 30, 90).forEach { days ->
                                FilterChip(selected = period == days, onClick = { period = days }, label = { Text("$days days") })
                            }
                        }
                        val summary = report?.optJSONObject("summary")
                        Text("Recorded platform acquisition", fontWeight = FontWeight.Bold, color = AdminInk)
                        AdminMetric("Completed customer join events", countLabel(analytics?.opt("customer_join_completions")))
                        AdminMetric("Business signup events", countLabel(analytics?.opt("business_signups")))
                        if (analytics?.optBoolean("sample_truncated") == true) Text("Report is sampled; totals may be incomplete.", color = AdminMuted)
                        val traffic = adminRows(analytics?.optJSONArray("daily")).takeLast(7)
                        Text("Daily page views · last 7 reported days", fontWeight = FontWeight.Bold, color = AdminInk)
                        val peak = traffic.mapNotNull { (it.opt("views") as? Number)?.toDouble()?.takeIf { n -> n.isFinite() && n >= 0 } }.maxOrNull()?.coerceAtLeast(1.0) ?: 1.0
                        if (traffic.isEmpty()) Text("Daily traffic unavailable.", color = AdminMuted)
                        traffic.forEach { day ->
                            val views = (day.opt("views") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }
                            Row { Text(day.optString("date", "—"), modifier = Modifier.weight(1f), color = AdminMuted); Text(countLabel(views), color = AdminInk) }
                            if (views != null) Box(Modifier.fillMaxWidth().height(8.dp).background(Color.White, RoundedCornerShape(8.dp))) {
                                Box(Modifier.fillMaxWidth((views / peak).toFloat()).height(8.dp).background(AdminInk, RoundedCornerShape(8.dp)))
                            }
                        }
                        Text("Traffic is not a customer registration count. Exact calendar-day joins are not provided by this verified schema.", fontSize = 12.sp, color = AdminMuted)
                        AdminMetric("New loyalty members · selected period", countLabel(summary?.opt("new_customers")))
                        AdminMetric("Active members", countLabel(summary?.opt("active_members")))
                        AdminMetric("Returning members", countLabel(summary?.opt("returning_members")))
                        val ranked = adminRows(report?.optJSONArray("businesses")).mapNotNull { row ->
                            val n = (row.optJSONObject("crm")?.opt("new_customers") as? Number)?.toDouble()
                            if (n == null || !n.isFinite() || n < 0) null else row.optString("business_name", "Business") to n
                        }.sortedByDescending { it.second }.take(10)
                        Text("New members by business", fontWeight = FontWeight.Bold, color = AdminInk)
                        val max = ranked.maxOfOrNull { it.second }?.coerceAtLeast(1.0) ?: 1.0
                        if (ranked.isEmpty()) Text("No verified business breakdown available.", color = AdminMuted)
                        ranked.forEach { (name, n) ->
                            Row { Text(name, modifier = Modifier.weight(1f), color = AdminInk); Text(countLabel(n), color = AdminInk) }
                            Box(Modifier.fillMaxWidth().height(8.dp).background(Color.White, RoundedCornerShape(8.dp))) {
                                Box(Modifier.fillMaxWidth((n / max).toFloat()).height(8.dp).background(AdminInk, RoundedCornerShape(8.dp)))
                            }
                        }
                        Text("Period totals from client performance. Not a calendar-day registration series.", fontSize = 12.sp, color = AdminMuted)
                    }
                    "Settings" -> {
                        Text("Super administrator", color = AdminInk, fontWeight = FontWeight.Bold)
                        Text("Admin sign-in is required each time the app process restarts. No admin password or token is saved in merchant preferences.", color = AdminMuted)
                        Button(onClick = { store.signOut() }, colors = ButtonDefaults.buttonColors(containerColor = AdminInk), modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(18.dp)).padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, color = AdminMuted)
        Text(value, fontSize = 21.sp, fontWeight = FontWeight.SemiBold, color = AdminInk)

    }
}

private fun adminRows(rows: JSONArray?): List<JSONObject> =
    if (rows == null) emptyList() else (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }

private fun adminDate(raw: String): LocalDate? =
    runCatching { LocalDate.parse(raw) }.getOrNull()
        ?: runCatching { Instant.parse(raw).atZone(ZoneId.of("Asia/Manila")).toLocalDate() }.getOrNull()
        ?: runCatching { java.time.OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.of("Asia/Manila")).toLocalDate() }.getOrNull()

private fun adminPrice(row: JSONObject): BigDecimal? =
    row.opt("price_current")?.toString()?.toBigDecimalOrNull()?.takeIf { it.signum() >= 0 }

@Composable
private fun AdminBillingCalendar(rows: JSONArray?, invoices: JSONArray?) {
    val today = LocalDate.now(ZoneId.of("Asia/Manila"))
    var month by remember { mutableStateOf(YearMonth.from(today)) }
    var selected by remember { mutableStateOf(today) }
    val dated = adminRows(rows).mapNotNull { row ->
        adminDate(row.optString("subscription_expires_at", ""))?.let { it to row }
    }
    val daily = dated.filter { it.first == selected }.map { it.second }
    val invoiceDates = adminRows(invoices).filter { it.optString("status") != "void" }.mapNotNull { row -> adminDate(row.optString("due_date", ""))?.let { it to row } }
    Text("Subscription renewal calendar", color = AdminInk, fontWeight = FontWeight.Bold, fontSize = 21.sp)
    Text("Existing subscription expiry and current cycle price. Expected renewal, not an issued invoice or confirmed debt.", color = AdminMuted, fontSize = 12.sp)
    if (rows == null) { Text("Billing records unavailable.", color = AdminMuted); return }
    Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(20.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { month = month.minusMonths(1); selected = month.atDay(1) }) { Text("‹") }
            Text(month.month.name.lowercase().replaceFirstChar { it.uppercase() } + " " + month.year, modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold, color = AdminInk)
            TextButton(onClick = { month = month.plusMonths(1); selected = month.atDay(1) }) { Text("›") }
        }
        Row { listOf("M","T","W","T","F","S","S").forEach { d -> Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Text(d, fontSize = 12.sp, color = AdminMuted) } } }
        val offset = month.atDay(1).dayOfWeek.value - 1
        for (week in 0..5) {
            Row {
                for (day in 0..6) {
                    val n = week * 7 + day - offset + 1
                    if (n !in 1..month.lengthOfMonth()) Box(Modifier.weight(1f).height(42.dp))
                    else {
                        val date = month.atDay(n)
                        val count = dated.count { it.first == date }
                        val invoiceCount = invoiceDates.count { it.first == date }
                        Column(Modifier.weight(1f).height(42.dp).background(if (date == selected) AdminLime else Color.Transparent, RoundedCornerShape(9.dp)).clickable { selected = date }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(n.toString(), color = AdminInk, fontWeight = if (date == selected) FontWeight.Bold else FontWeight.Normal)
                            if (count > 0 || invoiceCount > 0) Text("$count R · $invoiceCount I", fontSize = 9.sp, color = AdminMuted)
                        }
                    }
                }
            }
        }
    }
    Text(selected.toString() + " · " + daily.size + " scheduled", fontWeight = FontWeight.Bold, color = AdminInk)
    val groups = daily.groupBy { it.optString("currency", "PHP") }
    groups.forEach { (currency, list) ->
        val prices = list.mapNotNull(::adminPrice)
        val total = prices.fold(BigDecimal.ZERO) { sum, value -> sum.add(value) }
        AdminMetric("Known cycle prices · $currency", if (prices.isEmpty()) "Unavailable" else "$currency " + total.toPlainString())
        if (prices.size != list.size) Text("Some cycle prices are unavailable.", color = AdminMuted)
    }
    daily.forEach { row ->
        val currency = row.optString("currency", "PHP")
        val price = adminPrice(row)?.toPlainString()
        AdminMetric(row.optString("name", row.optString("business_name", "Business")) + " · " + row.optString("subscription_status", "status unavailable"),
            (if (price == null) "Amount unavailable" else "$currency $price") + " · " + row.optString("billing_cycle", "cycle unavailable"))
    }
    if (daily.isEmpty()) Text("No recorded subscription expiries on this date.", color = AdminMuted)
    Text("Special invoice ledger", fontWeight = FontWeight.Bold, fontSize = 21.sp, color = AdminInk)
    Text("R = renewal · I = issued invoice. These amounts are separate to avoid double counting.", fontSize = 12.sp, color = AdminMuted)
    if (invoices == null) Text("Invoice records unavailable.", color = AdminMuted)
    else {
        val selectedInvoices = invoiceDates.filter { it.first == selected }.map { it.second }
        if (selectedInvoices.isEmpty()) Text("No non-void invoices due on this date.", color = AdminMuted)
        selectedInvoices.forEach { row ->
            val amount = row.opt("total_amount")?.toString()?.toBigDecimalOrNull()?.takeIf { it.signum() >= 0 }
            AdminMetric(row.optString("business_name", "Business") + " · " + row.optString("invoice_number", "Invoice"),
                (amount?.let { "₱" + it.toPlainString() } ?: "Amount unavailable") + " · " + row.optString("status", "Unknown"))
        }
    }
}
