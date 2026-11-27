package com.loyaltytree.owner

import androidx.compose.foundation.background
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
        val path = when (tab) {
            "Home" -> "/api/v1/admin/overview"
            "Clients" -> "/api/v1/admin/businesses"
            "Finance" -> "/api/v1/admin/special-invoices"
            "Activity" -> "/api/v1/admin/overview"
            else -> null
        }
        LaunchedEffect(current, tab, refresh) {
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
            busy = false
        }
        Scaffold(containerColor = AdminPaper, bottomBar = {
            NavigationBar(containerColor = Color.White) {
                listOf("Home", "Clients", "Finance", "Activity", "Settings").forEach { item ->
                    NavigationBarItem(selected = tab == item, onClick = { if(tab != item) { data = null; note = ""; busy = true; tab = item } },
                        icon = { Text(when(item) { "Home" -> "⌂"; "Clients" -> "▤"; "Finance" -> "₱"; "Activity" -> "↗"; else -> "⚙" }, fontSize = 22.sp) },
                        label = { Text(item, fontSize = 10.sp) },
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
                            AdminMetric("Errors today", "Unavailable", Modifier.weight(1f))
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
                    "Finance" -> {
                        Text("Special business invoices only. Paid status is not verified cash collected.", color = AdminMuted)
                        val rows = data as? JSONArray
                        if (rows != null) {
                            val valid = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
                            AdminMetric("Marked paid", countLabel(valid.count { it.optString("status") == "paid" }))
                            AdminMetric("Overdue", countLabel(valid.count { it.optString("status") == "overdue" }))
                            valid.forEach { row ->
                                AdminMetric(row.optString("invoice_number", "Invoice"), row.optString("status", "—"))
                            }
                        }
                    }
                    "Activity" -> {
                        val overview = data as? JSONObject
                        AdminMetric("Recorded activity · 30 days", countLabel(overview?.opt("stamps_30d")))
                        AdminMetric("Redemptions · 30 days", countLabel(overview?.opt("redemptions_30d")))
                        Text("Service health", color = AdminInk, fontWeight = FontWeight.Bold)
                        listOf("Render", "Supabase", "Wallet services", "NextPay").forEach { AdminMetric(it, "Not checked") }
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
