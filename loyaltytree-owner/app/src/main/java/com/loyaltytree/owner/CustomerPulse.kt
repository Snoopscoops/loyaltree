package com.loyaltytree.owner

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.Locale

/** Purchase-only Customer Pulse. Every figure comes from owner-authenticated API data. */
@Composable
internal fun CustomerPulseNativeScreen(session: OwnerSession) {
    var days by remember { mutableIntStateOf(30) }
    var productId by remember { mutableStateOf("") }
    var weekday by remember { mutableIntStateOf(-1) }
    var hour by remember { mutableIntStateOf(-1) }
    var data by remember(session.slug) { mutableStateOf<JSONObject?>(null) }
    var error by remember(session.slug) { mutableStateOf("") }
    var loading by remember(session.slug) { mutableStateOf(false) }

    LaunchedEffect(session.slug, session.token, days, productId, weekday, hour) {
        loading = true
        error = ""
        val path = "menu-orders/customer-pulse?days=$days&product_id=${URLEncoder.encode(productId, "UTF-8")}&weekday=$weekday&hour=$hour"
        val response = ownerRead(session, path)
        if (response?.first in 200..299 && response?.second is JSONObject) {
            data = response.second as JSONObject
        } else {
            data = null
            error = when (response?.first) {
                401 -> "Session expired. Sign in again."
                403 -> "Only the account owner can view purchase intelligence."
                404 -> "Customer Pulse needs the v19.2 backend update."
                else -> "Customer Pulse could not load. Check your connection and try again."
            }
        }
        loading = false
    }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StitchHeading("Business intelligence", "Customer Pulse", "Real purchases · Philippine time (PHT)")
        StitchChoices(listOf("7 days", "30 days", "90 days"), "$days days") { option ->
            days = option.substringBefore(' ').toIntOrNull() ?: 30
        }
        if (loading) Text("Loading recorded purchases…", color = StitchStyle.muted)
        if (error.isNotBlank()) Text(error, color = StitchStyle.error)
        val report = data
        if (report != null) {
            if (report.optBoolean("limited_to_max_orders")) {
                Text("This period reached the reporting limit; select a shorter date range for complete figures.",
                    color = StitchStyle.error, fontSize = 12.sp)
            }
            val summary = report.optJSONObject("summary") ?: JSONObject()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StitchStat("Paid sales", php(summary, "sales"), "Confirmed digital-menu payments", Modifier.weight(1f))
                StitchStat("Paid orders", summary.optInt("paid_orders").toString(), "Not test payments", Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StitchStat("Per order", php(summary, "average_order_value"), "Average order value", Modifier.weight(1f))
                StitchStat("Per linked buyer", php(summary, "average_per_linked_buyer"), "Known card holders only", Modifier.weight(1f))
            }
            StitchSurface {
                StitchSectionTitle("Spending per guest & table", "Don't confuse orders, people, and table visits")
                PulseValue("Average per guest", php(summary, "average_per_guest"), "Needs guest count per order")
                PulseValue("Average per table visit", php(summary, "average_per_table_visit"), "Needs a seating/session ID")
                PulseValue("Average per table-day", php(summary, "average_per_table_day"), "Table number within one branch and date, not per seating")
            }
            val products = report.optJSONArray("products") ?: JSONArray()
            StitchSurface {
                StitchSectionTitle("Top purchased products", "Paid orders, by quantity")
                if (products.length() == 0) Text("No paid product orders in this period.", color = StitchStyle.muted)
                for (i in 0 until minOf(products.length(), 10)) {
                    val p = products.optJSONObject(i) ?: continue
                    PulseValue(p.optString("name"), "${p.optInt("quantity")} sold", "${p.optInt("orders")} paid orders")
                }
            }
            StitchSurface {
                StitchSectionTitle("Peak buying hours", "Orders by hour · Asia/Manila")
                val hourly = report.optJSONArray("hourly") ?: JSONArray()
                val values = (0 until hourly.length()).map { hourly.optJSONObject(it)?.optInt("orders") ?: 0 }
                StitchChart(values)
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("12 AM", color = StitchStyle.muted, fontSize = 11.sp)
                    Text("12 PM", color = StitchStyle.muted, fontSize = 11.sp)
                    Text("11 PM", color = StitchStyle.muted, fontSize = 11.sp)
                }
            }
            StitchSurface {
                StitchSectionTitle("Product × day × time", "Choose a product, day and exact hour")
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    PulseChip("All products", productId.isBlank()) { productId = "" }
                    for (i in 0 until minOf(products.length(), 20)) {
                        val p = products.optJSONObject(i) ?: continue
                        val id = p.optString("id")
                        PulseChip(p.optString("name"), productId == id) { productId = id }
                    }
                }
                val daysOfWeek = listOf("All days", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    daysOfWeek.forEachIndexed { index, label ->
                        val value = index - 1
                        PulseChip(label, weekday == value) { weekday = value }
                    }
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    PulseChip("Any hour", hour == -1) { hour = -1 }
                    (0..23).forEach { h -> PulseChip(hourLabel(h), hour == h) { hour = h } }
                }
                val matches = report.optJSONArray("product_hours") ?: JSONArray()
                if (matches.length() == 0) Text("No matching paid product purchases.", color = StitchStyle.muted)
                for (i in 0 until minOf(matches.length(), 20)) {
                    val record = matches.optJSONObject(i) ?: continue
                    PulseValue(record.optString("product"), "${record.optInt("quantity")} sold",
                        "${record.optString("day")} · ${hourLabel(record.optInt("hour"))} · ${record.optInt("orders")} orders")
                }
            }
            StitchSurface {
                StitchSectionTitle("Buying patterns by weekday", "Top time slots for each day")
                val weekly = report.optJSONArray("weekday_hours") ?: JSONArray()
                for (i in 0 until weekly.length()) {
                    val day = weekly.optJSONObject(i) ?: continue
                    val hours = day.optJSONArray("hours") ?: JSONArray()
                    if (hours.length() == 0) continue
                    val ranked = (0 until hours.length()).mapNotNull { hours.optJSONObject(it) }
                        .sortedByDescending { it.optInt("orders") }.take(3)
                    PulseValue(day.optString("day"), ranked.sumOf { it.optInt("orders") }.toString() + " orders in top hours",
                        ranked.joinToString(" · ") { "${hourLabel(it.optInt("hour"))}: ${it.optInt("orders")}" })
                }
            }
            val audience = report.optJSONObject("audience") ?: JSONObject()
            StitchSurface {
                StitchSectionTitle("Product audience", "Age, gender and occupation of loyalty-linked buyers")
                if (!audience.optBoolean("available")) {
                    Text("Not enough different linked buyers in this selection to show demographics safely.",
                        color = StitchStyle.muted, fontSize = 12.sp)
                } else {
                    listOf("age" to "Age range", "gender" to "Gender", "occupation" to "Occupation").forEach { (key, label) ->
                        Text(label, fontWeight = FontWeight.Bold, color = StitchStyle.forest, fontSize = 13.sp)
                        val groups = audience.optJSONArray(key) ?: JSONArray()
                        if (groups.length() == 0) Text("No sufficiently large group", fontSize = 11.sp, color = StitchStyle.muted)
                        for (i in 0 until groups.length()) {
                            val group = groups.optJSONObject(i) ?: continue
                            PulseValue(group.optString("label"), "${group.optInt("orders")} orders",
                                "${group.optInt("buyers")} distinct buyers")
                        }
                    }
                }
                Text("Only consented or voluntarily provided demographic data linked to loyalty cards is used. Small cohorts are hidden.",
                    color = StitchStyle.muted, fontSize = 11.sp)
            }
            Text("Paid digital-menu orders only. POS/offline sales and mock payments are excluded. Guest counts and seating visits are not currently tracked.",
                color = StitchStyle.muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun PulseChip(label: String, selected: Boolean, select: () -> Unit) {
    Text(label, Modifier.background(if (selected) StitchStyle.forest else StitchStyle.soft, RoundedCornerShape(24.dp))
        .clickable(onClick = select).padding(horizontal = 12.dp, vertical = 8.dp),
        color = if (selected) Color.White else StitchStyle.ink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun PulseValue(name: String, value: String, subtitle: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(name, fontSize = 12.sp, color = StitchStyle.ink, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            Text(value, fontSize = 13.sp, color = StitchStyle.forest, fontWeight = FontWeight.Bold)
        }
        Text(subtitle, fontSize = 10.sp, color = StitchStyle.muted)
    }
}

private fun php(data: JSONObject, key: String): String {
    if (!data.has(key) || data.isNull(key)) return "—"
    return "₱" + String.format(Locale.US, "%,.2f", data.optDouble(key, 0.0))
}

private fun hourLabel(hour: Int): String = "${if (hour % 12 == 0) 12 else hour % 12} ${if (hour < 12) "AM" else "PM"}"
