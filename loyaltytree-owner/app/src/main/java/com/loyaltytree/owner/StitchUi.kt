package com.loyaltytree.owner

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max

/** Native interpretation of the owner's approved Google Stitch v19.1 screens.
 * Colors/spacing align with Forest Retail Pulse; all figures are real API values.
 */
internal object StitchStyle {
    val forest = Color(0xFF063B2F)
    val dark = Color(0xFF00241B)
    val ink = Color(0xFF18342C)
    val muted = Color(0xFF65786F)
    val teal = Color(0xFF29695A)
    val mint = Color(0xFFACEDD9)
    val soft = Color(0xFFEDF4EE)
    val paper = Color(0xFFF9FAF8)
    val stroke = Color(0xFFE3EBE6)
    val amber = Color(0xFFF2B67B)
    val error = Color(0xFFAA503F)
    val radius = RoundedCornerShape(19.dp)
}

@Composable
internal fun StitchSurface(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().border(1.dp, StitchStyle.stroke, StitchStyle.radius)
            .background(Color.White, StitchStyle.radius).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) { content() }
}

@Composable
internal fun StitchHeading(eyebrow: String, title: String, subtitle: String = "") {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(eyebrow.uppercase(Locale.US), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = StitchStyle.teal, letterSpacing = 1.1.sp)
        Text(title, fontSize = 25.sp, fontWeight = FontWeight.Bold, color = StitchStyle.dark, lineHeight = 30.sp)
        if (subtitle.isNotBlank()) Text(subtitle, fontSize = 12.sp, color = StitchStyle.muted, lineHeight = 18.sp)
    }
}

@Composable
private fun StitchPill(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(30.dp)).background(if (selected) StitchStyle.forest else StitchStyle.soft)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = if (selected) Color.White else StitchStyle.ink, fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
internal fun StitchChoices(items: List<String>, selected: String, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        items.forEach { label -> StitchPill(label, selected == label) { onChange(label) } }
    }
}

@Composable
internal fun StitchStat(label: String, value: String, hint: String, modifier: Modifier = Modifier, accent: Color = StitchStyle.teal) {
    Column(
        modifier.border(1.dp, StitchStyle.stroke, RoundedCornerShape(15.dp))
            .background(Color.White, RoundedCornerShape(15.dp)).padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(label.uppercase(Locale.US), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = StitchStyle.muted)
        Text(value, fontSize = 25.sp, fontWeight = FontWeight.Bold, color = StitchStyle.ink, maxLines = 1)
        Text(hint, color = accent, fontSize = 10.sp, maxLines = 2)
    }
}

@Composable
internal fun StitchPrimary(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = StitchStyle.forest)) { Text(label, fontSize = 12.sp) }
}

@Composable
internal fun StitchSectionTitle(title: String, subtitle: String = "") {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, fontWeight = FontWeight.Bold, color = StitchStyle.dark, fontSize = 16.sp)
        if (subtitle.isNotBlank()) Text(subtitle, color = StitchStyle.muted, fontSize = 11.sp)
    }
}

@Composable
internal fun StitchMeter(value: Float, accent: Color = StitchStyle.teal) {
    Box(Modifier.fillMaxWidth().height(9.dp).clip(CircleShape).background(StitchStyle.soft)) {
        Box(Modifier.fillMaxWidth(value.coerceIn(0f, 1f)).height(9.dp).clip(CircleShape).background(accent))
    }
}

@Composable
internal fun StitchChart(values: List<Int>, modifier: Modifier = Modifier) {
    if (values.isEmpty()) {
        Text("Not enough dated records to display a chart.", color = StitchStyle.muted, fontSize = 12.sp)
        return
    }
    val maximum = max(1, values.maxOrNull() ?: 1).toFloat()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(modifier.fillMaxWidth().height(128.dp)) {
            val left = 6.dp.toPx()
            val top = 10.dp.toPx()
            val bottom = size.height - 12.dp.toPx()
            val right = size.width - 8.dp.toPx()
            for (line in 0..3) {
                val y = top + (bottom - top) * line / 3f
                drawLine(StitchStyle.stroke, Offset(left, y), Offset(right, y), strokeWidth = 1.dp.toPx())
            }
            val points = values.mapIndexed { index, number ->
                val x = if (values.size == 1) (left + right) / 2f else left + (right - left) * index / (values.size - 1).toFloat()
                Offset(x, bottom - (number / maximum) * (bottom - top))
            }
            if (points.size > 1) {
                val linePath = Path().apply {
                    moveTo(points.first().x, points.first().y)
                    points.drop(1).forEach { lineTo(it.x, it.y) }
                }
                drawPath(linePath, StitchStyle.teal, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
            }
            points.forEach { drawCircle(StitchStyle.forest, radius = 3.1.dp.toPx(), center = it) }
        }
    }
}

private fun numberField(value: JSONObject, key: String): String =
    if (value.isNull(key) || !value.has(key)) "—" else value.optString(key).ifBlank { "—" }

private fun dateMillis(value: String?): Long? {
    if (value.isNullOrBlank() || value.length < 10) return null
    return runCatching {
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }.parse(value.substring(0, 10))?.time
    }.getOrNull()
}

private fun crmRows(data: JSONObject): List<JSONObject> {
    val array = data.optJSONArray("customers") ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}

private fun countInWindow(rows: List<JSONObject>, days: Int): Int {
    val threshold = System.currentTimeMillis() - days.toLong() * 86_400_000
    return rows.count { dateMillis(it.optString("created_at"))?.let { stamp -> stamp >= threshold } == true }
}

/** Buckets show recorded signups only, not invented visits or sales. */
private fun signupsByBucket(rows: List<JSONObject>, days: Int, buckets: Int = 7): List<Int> {
    val start = System.currentTimeMillis() - days.toLong() * 86_400_000
    val result = IntArray(buckets)
    rows.forEach { customer ->
        val timestamp = dateMillis(customer.optString("created_at")) ?: return@forEach
        if (timestamp >= start && timestamp <= System.currentTimeMillis()) {
            val fraction = (timestamp - start).toDouble() / (days.toLong() * 86_400_000)
            result[(fraction * buckets).toInt().coerceIn(0, buckets - 1)]++
        }
    }
    return result.toList()
}

private fun readableSegment(raw: String): String = when (raw) {
    "new" -> "New"
    "active" -> "Active"
    "frequent" -> "Frequent"
    "at_risk" -> "At risk"
    "inactive_60" -> "Inactive 60+ days"
    "inactive_90" -> "Inactive 90+ days"
    else -> raw.replace('_', ' ').replaceFirstChar { it.uppercase() }.ifBlank { "Unclassified" }
}

private fun segmentTint(key: String): Color = when (key) {
    "frequent", "active" -> StitchStyle.teal
    "new" -> Color(0xFF4D7D9C)
    "at_risk" -> Color(0xFFB07A32)
    else -> StitchStyle.error
}

@Composable
internal fun StitchDashboard(data: JSONObject, openCrm: () -> Unit) {
    val rows = remember(data) { crmRows(data) }
    var days by remember { mutableStateOf("30 Days") }
    val window = when (days) { "7 Days" -> 7; "90 Days" -> 90; else -> 30 }
    val total = numberField(data, "total_customers")
    val active = rows.count { (it.optJSONObject("crm")?.optInt("days_since_last_activity", Int.MAX_VALUE) ?: Int.MAX_VALUE) < 30 }
    val returning = rows.count { (it.optJSONObject("crm")?.optInt("total_transactions") ?: 0) >= 2 }
    val hasDatedRows = rows.any { dateMillis(it.optString("created_at")) != null }
    val newCount = countInWindow(rows, window)
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        StitchHeading("Customer intelligence", "Customer Dashboard", "Live member data • Loyalty activity")
        StitchChoices(listOf("7 Days", "30 Days", "90 Days"), days) { days = it }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("Total customers", total, "All-time members", Modifier.weight(1f))
            StitchStat("Active (30d)", active.toString(), "Recent signup or activity", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("New members", if (hasDatedRows) newCount.toString() else "—", "Joined in $window days", Modifier.weight(1f))
            StitchStat("Returning", returning.toString(), "2+ recorded transactions", Modifier.weight(1f))
        }
        StitchSurface {
            StitchSectionTitle("Customer Growth", "New registrations in the last $window days")
            if (hasDatedRows) {
                StitchChart(signupsByBucket(rows, window))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("$window days ago", fontSize = 10.sp, color = StitchStyle.muted)
                    Text("Today", fontSize = 10.sp, color = StitchStyle.muted)
                }
            } else Text("Registration dates are unavailable for these members.", color = StitchStyle.muted, fontSize = 12.sp)
        }
        StitchSurface {
            StitchSectionTitle("New vs Returning", "Returning = 2+ recorded successful loyalty transactions")
            val all = rows.size.coerceAtLeast(1)
            StitchMeter(returning.toFloat() / all)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Returning  $returning", fontSize = 12.sp, color = StitchStyle.teal, fontWeight = FontWeight.SemiBold)
                Text("Others  ${rows.size - returning}", fontSize = 12.sp, color = StitchStyle.muted)
            }
        }
        StitchSurface {
            StitchSectionTitle("Loyalty Engagement", "Segments based on activity and visit frequency")
            val counts = rows.groupingBy { it.optJSONObject("crm")?.optString("segment") ?: "unknown" }.eachCount()
            listOf("frequent", "active", "new", "at_risk", "inactive_60", "inactive_90").forEach { key ->
                val n = counts[key] ?: 0
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(readableSegment(key), fontSize = 12.sp, color = StitchStyle.ink)
                    Text(n.toString(), fontWeight = FontWeight.SemiBold, color = segmentTint(key), fontSize = 12.sp)
                }
                StitchMeter(n.toFloat() / rows.size.coerceAtLeast(1), segmentTint(key))
            }
        }
        StitchPrimary("View customer directory  →", Modifier.fillMaxWidth(), openCrm)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
internal fun StitchCrm(data: JSONObject, openCustomer: (String) -> Unit) {
    val rows = remember(data) { crmRows(data) }
    var query by remember { mutableStateOf("") }
    var segment by remember { mutableStateOf("All") }
    var selectedId by remember { mutableStateOf("") }
    val selected = rows.firstOrNull { it.optString("public_id") == selectedId }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        if (selected != null) {
            StitchCustomerProfile(selected, onBack = { selectedId = "" }, onFullProfile = {
                openCustomer(selected.optString("public_id"))
            })
            return@Column
        }
        StitchHeading("CRM & insights", "Customer Directory", "Customer records • Loyalty segments")
        val active = rows.count { it.optJSONObject("crm")?.optString("segment") in listOf("active", "frequent") }
        StitchSurface {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("TOTAL CUSTOMERS", color = StitchStyle.muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(numberField(data, "total_customers"), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = StitchStyle.forest)
                }
                Column(Modifier.weight(1f)) {
                    Text("ENGAGED SEGMENTS", color = StitchStyle.muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(active.toString(), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = StitchStyle.teal)
                }
            }
        }
        StitchSurface {
            StitchSectionTitle("Registration Activity", "Recorded member signups • past 30 days")
            if (rows.any { dateMillis(it.optString("created_at")) != null }) StitchChart(signupsByBucket(rows, 30))
            else Text("Registration dates unavailable", color = StitchStyle.muted, fontSize = 12.sp)
        }
        OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(),
            label = { Text("Search name, phone or email") }, singleLine = true,
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = StitchStyle.teal) },
            shape = RoundedCornerShape(15.dp))
        StitchChoices(listOf("All", "Active", "Frequent", "New", "At risk", "Inactive"), segment) { segment = it }
        val filtered = rows.filter { row ->
            val type = row.optJSONObject("crm")?.optString("segment").orEmpty()
            val matched = when (segment) {
                "Active" -> type == "active"; "Frequent" -> type == "frequent"
                "New" -> type == "new"; "At risk" -> type == "at_risk"
                "Inactive" -> type in listOf("inactive_60", "inactive_90")
                else -> true
            }
            matched && (query.isBlank() || listOf("name", "phone", "email").any { row.optString(it).contains(query.trim(), ignoreCase = true) })
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            StitchSectionTitle("Customers", "${filtered.size} matching records")
        }
        if (filtered.isEmpty()) StitchSurface { Text("No customers match these filters.", fontSize = 13.sp, color = StitchStyle.muted) }
        filtered.take(75).forEach { customer ->
            val details = customer.optJSONObject("crm") ?: JSONObject()
            val key = details.optString("segment", "unknown")
            StitchSurface {
                Row(Modifier.fillMaxWidth().clickable { selectedId = customer.optString("public_id") }, verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(42.dp).background(StitchStyle.soft, CircleShape), contentAlignment = Alignment.Center) {
                        Text(customer.optString("name", "?").take(1).uppercase(Locale.US), color = StitchStyle.forest, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(customer.optString("name", "Customer"), color = StitchStyle.dark, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(readableSegment(key), color = segmentTint(key), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Icon(Icons.Default.ChevronRight, contentDescription = "View profile", tint = StitchStyle.muted)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Transactions: ${numberField(details, "total_transactions")}", fontSize = 11.sp, color = StitchStyle.muted)
                    val last = numberField(details, "days_since_last_activity")
                    Text(if (last == "—") "No activity date" else "$last days ago", fontSize = 11.sp, color = StitchStyle.muted)
                }
            }
        }
        if (filtered.size > 75) Text("Showing 75 customers. Use search to narrow results.", fontSize = 11.sp, color = StitchStyle.muted)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun StitchCustomerProfile(customer: JSONObject, onBack: () -> Unit, onFullProfile: () -> Unit) {
    val metrics = customer.optJSONObject("crm") ?: JSONObject()
    Text("‹  Back to Customer Directory", Modifier.clickable(onClick = onBack).padding(vertical = 6.dp), color = StitchStyle.teal, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    StitchSurface {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).background(StitchStyle.mint, CircleShape), contentAlignment = Alignment.Center) {
                Text(customer.optString("name").take(1).uppercase(Locale.US), fontSize = 22.sp, color = StitchStyle.forest, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(customer.optString("name", "Customer"), color = StitchStyle.dark, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Text(readableSegment(metrics.optString("segment")), color = segmentTint(metrics.optString("segment")), fontSize = 12.sp)
                Text("Loyalty member", fontSize = 11.sp, color = StitchStyle.muted)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("Transactions", numberField(metrics, "total_transactions"), "Successful activity", Modifier.weight(1f))
            StitchStat("Stamp balance", numberField(customer, "stamp_count"), "Current stamps", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("Points", numberField(customer, "points_balance"), "Current balance", Modifier.weight(1f))
            StitchStat("Last active", numberField(metrics, "days_since_last_activity"), "Days ago", Modifier.weight(1f))
        }
        StitchSectionTitle("Customer details", "Data synced from the existing CRM")
        val joined = customer.optString("created_at").take(10)
        if (joined.isNotBlank()) Text("Joined  $joined", fontSize = 12.sp, color = StitchStyle.muted)
        val last = metrics.optString("last_activity_at").take(10)
        if (last.isNotBlank()) Text("Last recorded activity  $last", fontSize = 12.sp, color = StitchStyle.muted)
        StitchPrimary("Open loyalty history  →", Modifier.fillMaxWidth(), onFullProfile)
    }
}

@Composable
internal fun StitchLoyalty(data: JSONObject, openCard: () -> Unit) {
    val array = data.optJSONArray("programs")
    val programs = (0 until (array?.length() ?: 0)).mapNotNull { array?.optJSONObject(it) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        StitchHeading("Membership & rewards", "Loyalty Programs", "Manage programs and customer rewards")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("Programs", programs.size.toString(), "Configured programs", Modifier.weight(1f))
            StitchStat("Program limit", numberField(data, "max_programs"), "Plan: ${data.optString("plan", "—")}", Modifier.weight(1f))
        }
        if (programs.isEmpty()) StitchSurface { Text("No loyalty programs configured yet.", color = StitchStyle.muted) }
        programs.forEach { item ->
            val type = item.optString("card_type", "Loyalty").replace('_', ' ').replaceFirstChar { it.uppercase() }
            val name = item.optString("name", item.optString("card_name", "Loyalty program"))
            Column(
                Modifier.fillMaxWidth().clip(StitchStyle.radius).background(StitchStyle.forest).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Star, null, tint = StitchStyle.mint, modifier = Modifier.size(26.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("LOYALTYTREE REWARDS", color = StitchStyle.mint, fontSize = 10.sp, letterSpacing = 1.sp)
                        Text(name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                    }
                }
                Text(type, color = Color.White.copy(alpha = .9f), fontSize = 13.sp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Members", color = StitchStyle.mint, fontSize = 12.sp)
                    Text(numberField(item, "customer_count"), color = Color.White, fontWeight = FontWeight.Bold)
                }
                Text(if (item.optBoolean("is_default")) "● Default program" else "Configured program", color = StitchStyle.mint, fontSize = 11.sp)
                if (item.optBoolean("is_default")) {
                    Button(onClick = openCard, shape = RoundedCornerShape(11.dp), colors = ButtonDefaults.buttonColors(containerColor = StitchStyle.mint, contentColor = StitchStyle.dark)) {
                        Text("Edit card & rewards", fontWeight = FontWeight.SemiBold)
                    }
                } else Text("Advanced program changes are managed using the same server settings as the website.", color = Color.White.copy(alpha = .75f), fontSize = 11.sp)
            }
        }
        StitchSurface {
            StitchSectionTitle("Card configuration", "Preview and edit the default loyalty card")
            Text("Use the existing native editor to update rewards, stamp goals, points and appearance. Changes sync to your website.", color = StitchStyle.muted, fontSize = 12.sp)
            StitchPrimary("Open card settings  →", Modifier.fillMaxWidth(), openCard)
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
internal fun StitchRetentionOverview(data: JSONObject, openGreetings: () -> Unit) {
    val segments = data.optJSONObject("segments") ?: JSONObject()
    var range by remember { mutableStateOf("30 Days") }
    val activeKey = when (range) { "60 Days" -> "active_60"; "90 Days" -> "active_90"; else -> "active_30" }
    val period = when (range) { "60 Days" -> 60; "90 Days" -> 90; else -> 30 }
    val repeat = data.optDouble("repeat_customer_rate", Double.NaN)
    val total = data.optInt("total_customers")
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        StitchHeading("Member analytics", "Retention Dashboard", "Understand repeat activity and win-back opportunities")
        StitchChoices(listOf("30 Days", "60 Days", "90 Days"), range) { range = it }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("Repeat rate", if (repeat.isFinite()) "${"%.1f".format(Locale.US, repeat)}%" else "—", "Members with 2+ transactions", Modifier.weight(1f))
            StitchStat("Returning", numberField(data, "repeat_customers"), "2+ recorded transactions", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StitchStat("Active ($period d)", numberField(data, activeKey), "Signup or recent activity", Modifier.weight(1f))
            StitchStat("At risk", numberField(segments, "at_risk"), "Inactive 30–59 days", Modifier.weight(1f), StitchStyle.error)
        }
        StitchSurface {
            StitchSectionTitle("Repeat Visit Rate", "Share of members with two or more recorded activities")
            if (repeat.isFinite()) {
                Text("${"%.1f".format(Locale.US, repeat)}%", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = StitchStyle.forest)
                StitchMeter((repeat / 100).toFloat())
            } else Text("No verified repeat activity rate available.", fontSize = 12.sp, color = StitchStyle.muted)
        }
        StitchSurface {
            StitchSectionTitle("Active Members by Window", "Rolling activity groups, not a historical trend")
            listOf(30, 60, 90).forEach { d ->
                val number = data.optInt("active_$d")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Last $d days", fontSize = 12.sp, color = StitchStyle.ink)
                    Text(number.toString(), fontSize = 12.sp, color = StitchStyle.forest, fontWeight = FontWeight.Bold)
                }
                StitchMeter(number.toFloat() / total.coerceAtLeast(1))
            }
        }
        StitchSurface {
            StitchSectionTitle("Customer Segments", "Current classification based on recent loyalty activity")
            listOf("active", "frequent", "new", "at_risk", "inactive_60", "inactive_90").forEach { key ->
                val amount = segments.optInt(key)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(readableSegment(key), fontSize = 12.sp, color = StitchStyle.ink)
                    Text(amount.toString(), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = segmentTint(key))
                }
                StitchMeter(amount.toFloat() / total.coerceAtLeast(1), segmentTint(key))
            }
        }
        StitchPrimary("Birthday & win-back settings  →", Modifier.fillMaxWidth(), openGreetings)
    }
}

@Composable
internal fun StitchRetentionOpportunities(data: JSONObject) {
    val list = data.optJSONArray("opportunities")
    val rows = (0 until (list?.length() ?: 0)).mapNotNull { list?.optJSONObject(it) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StitchSectionTitle("Retention Opportunities", "${numberField(data, "total")} suggested follow-ups")
        if (rows.isEmpty()) StitchSurface {
            Text("No immediate follow-up opportunities.", color = StitchStyle.ink, fontWeight = FontWeight.SemiBold)
            Text("New suggestions will appear as customers approach a reward or become inactive.", color = StitchStyle.muted, fontSize = 12.sp)
        }
        rows.take(25).forEach { row ->
            val winBack = row.optString("type") == "win_back"
            StitchSurface {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(34.dp).background(if (winBack) Color(0xFFFFEFE0) else StitchStyle.soft, CircleShape), contentAlignment = Alignment.Center) {
                        Icon(if (winBack) Icons.Default.Notifications else Icons.Default.Star, null,
                            tint = if (winBack) Color(0xFFB16B29) else StitchStyle.teal, modifier = Modifier.size(19.dp))
                    }
                    Spacer(Modifier.width(9.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (winBack) "Win-back opportunity" else "Almost at a reward", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = StitchStyle.ink)
                        Text(row.optString("customer_name", "Customer"), fontSize = 12.sp, color = StitchStyle.muted)
                    }
                    Text(readableSegment(row.optString("segment")), fontSize = 10.sp, color = StitchStyle.teal)
                }
                if (winBack && row.has("days_inactive")) Text("${row.optInt("days_inactive")} days since last recorded activity", fontSize = 11.sp, color = StitchStyle.muted)
                Text(row.optString("suggested_message", "Review this customer segment."), color = StitchStyle.ink, fontSize = 12.sp, lineHeight = 17.sp)
            }
        }
        if (rows.size > 25) Text("Showing 25 of ${rows.size} opportunities.", color = StitchStyle.muted, fontSize = 11.sp)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun StitchHubItem(icon: ImageVector, title: String, detail: String, tint: Color = StitchStyle.teal, click: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).clickable(onClick = click).padding(vertical = 10.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).background(tint.copy(alpha = .12f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(21.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = StitchStyle.ink, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Text(detail, color = StitchStyle.muted, fontSize = 10.sp, maxLines = 2)
        }
        Icon(Icons.Default.ChevronRight, null, tint = StitchStyle.muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun StitchHubSection(title: String, subtitle: String, initiallyOpen: Boolean = false, content: @Composable () -> Unit) {
    var expanded by remember { mutableStateOf(initiallyOpen) }
    StitchSurface {
        Row(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title.uppercase(Locale.US), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = StitchStyle.dark, letterSpacing = .8.sp)
                Text(subtitle, fontSize = 10.sp, color = StitchStyle.muted)
            }
            Icon(if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown, null, tint = StitchStyle.teal)
        }
        if (expanded) content()
    }
}

@Composable
internal fun StitchMoreHub(
    store: CounterStore,
    openDashboard: () -> Unit,
    openNative: (MoreTool) -> Unit,
    openMenu: () -> Unit,
    openMenuPreview: () -> Unit,
    openDailyStock: () -> Unit,
    openExisting: (String) -> Unit
) {
    val session = store.session
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        StitchHeading("LoyaltyTree Owner", "More", session?.businessName ?: "Advanced business tools")
        Column(Modifier.fillMaxWidth().clip(StitchStyle.radius).background(StitchStyle.forest).clickable(onClick = openDashboard).padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Widgets, null, tint = StitchStyle.mint, modifier = Modifier.size(25.dp))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text("CUSTOMER DASHBOARD", color = StitchStyle.mint, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = .8.sp)
                    Text("Edit what customers see", color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                }
                Icon(Icons.Default.ChevronRight, "Open customer-facing tools", tint = Color.White)
            }
            Text("Digital Menu · Campaigns · Notifications · Guest Wi-Fi · LT Points · Socials", color = Color.White.copy(alpha = .88f), fontSize = 12.sp)
        }
        StitchHubSection("Customer Pulse", "Purchase patterns and audience analytics") {
            StitchHubItem(Icons.Default.BarChart, "Customer Pulse", "Product buyers, demographics, peak hours & spending") { openNative(MoreTool.Pulse) }
        }
        StitchHubSection("Operations & Team", "Manage branches, menus and inventory") {
            StitchHubItem(Icons.Default.Store, "Team & Branch Management", "Staff permissions and branch configuration") { openNative(MoreTool.Team) }
            StitchHubItem(Icons.Default.RestaurantMenu, "Full QR Menu Builder", "Items, categories, options and preview") { openMenuPreview() }
            StitchHubItem(Icons.Default.Inventory2, "Daily Servings", "Branch stock limits and daily resets", Color(0xFFA66337)) { openDailyStock() }
        }
        StitchHubSection("Customers & Loyalty", "Understand members and rewards") {
            StitchHubItem(Icons.Default.People, "CRM & Customer Insights", "Directory, activity charts and filters") { openNative(MoreTool.Crm) }
            StitchHubItem(Icons.Default.Star, "Loyalty Programs", "Cards, stamp goals and rewards") { openNative(MoreTool.Loyalty) }
            StitchHubItem(Icons.Default.Favorite, "Satisfaction & Feedback", "Ratings and customer responses", Color(0xFFB16B29)) { openNative(MoreTool.Satisfaction) }
            StitchHubItem(Icons.Default.TrendingUp, "Retention", "Repeat visits and win-back opportunities", Color(0xFFB46F46)) { openNative(MoreTool.Retention) }
        }
        StitchHubSection("Growth & Integrations", "Tools for business expansion") {
            StitchHubItem(Icons.Default.CardGiftcard, "Gift Cards", "Issued cards and remaining balances") { openNative(MoreTool.GiftCards) }
            StitchHubItem(Icons.Default.CreditCard, "POS Integration", "Connected providers and branch mappings") { openNative(MoreTool.Pos) }
            StitchHubItem(Icons.Default.Share, "Referrals", "Invite partners and view rewards", Color(0xFFC77D42)) { openNative(MoreTool.Referrals) }
        }
        StitchHubSection("Business Settings", "Existing native tools and account controls") {
            StitchHubItem(Icons.Default.Menu, "Edit Digital Menu", "Menu items and modifiers") { openMenu() }
            StitchHubItem(Icons.Default.BarChart, "Sales & Analytics", "Sales, visits and reports") { openExisting("analytics") }
            StitchHubItem(Icons.Default.Notifications, "Campaigns & Notifications", "Birthday and win-back rules") { openExisting("notifications") }
            StitchHubItem(Icons.Default.Star, "Card setup", "Default card and appearance") { openExisting("card") }
            StitchHubItem(Icons.Default.People, "Staff assignments", "Cashier roles and branches") { openExisting("cashiers") }
            StitchHubItem(Icons.Default.Wifi, "Guest Wi-Fi", "Guest-facing information") { openExisting("wifi") }
            StitchHubItem(Icons.Default.Share, "Social links", "Business social media") { openExisting("socials") }
            StitchHubItem(Icons.Default.Event, "Book our place", "Booking information") { openExisting("book") }
            StitchHubItem(Icons.Default.EventAvailable, "Reserve a table", "Table booking settings") { openExisting("reserve") }
            StitchHubItem(Icons.Default.Tv, "Digital Billboard", "Display visibility") { openExisting("billboard") }
            StitchHubItem(Icons.Default.Star, "LT Points", "LoyaltyTree points") { openExisting("points") }
            StitchHubItem(Icons.Default.Notifications, "Order alerts", "Notification controls") { openExisting("alerts") }
            StitchHubItem(Icons.Default.Settings, "Account management", "Billing, details and account") { openExisting("account") }
        }
        StitchPrimary("Log out", Modifier.fillMaxWidth()) { store.signOut() }
        Text("LoyaltyTree Owner • Native Android", Modifier.fillMaxWidth(), color = StitchStyle.muted, fontSize = 10.sp)
    }
}
