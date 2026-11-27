package com.loyaltytree.owner

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Native owner tools use the SAME authenticated business APIs as the website.
 * No WebView, no external website session, no owner token embedded in links.
 * Dangerous provider and gift-card payment operations are intentionally not faked.
 */
internal enum class MoreTool(val title: String) {
    Dashboard("Customer Dashboard"),
    Pulse("Customer Pulse"),
    Team("Team & branches"),
    Crm("Customer CRM"),
    Loyalty("Loyalty programs"),
    Satisfaction("Satisfaction"),
    Retention("Retention"),
    GiftCards("Gift cards"),
    Pos("POS integration"),
    Referrals("Referrals")
}

private val MoreInk = Color(0xFF123C32)
private val MoreMuted = Color(0xFF607569)
private val MoreLine = Color(0xFFE1E9DF)
private val MoreShape = RoundedCornerShape(15.dp)

@Composable
internal fun NativeMoreScreen(
    tool: MoreTool,
    session: OwnerSession,
    openCustomer: (String) -> Unit,
    openCard: () -> Unit,
    openCashiers: () -> Unit,
    openGreetings: () -> Unit,
    openCrm: () -> Unit,
    openCustomerEditor: (String) -> Unit
) {
    when (tool) {
        MoreTool.Dashboard -> CustomerFacingEditorScreen(openCustomerEditor)
        MoreTool.Pulse -> NativeScroll { CustomerPulseNativeScreen(session) }
        MoreTool.Team -> TeamNativeScreen(session, openCashiers)
        MoreTool.Crm -> CrmNativeScreen(session, openCustomer)
        MoreTool.Loyalty -> LoyaltyNativeScreen(session, openCard)
        MoreTool.Satisfaction -> SatisfactionNativeScreen(session)
        MoreTool.Retention -> RetentionNativeScreen(session, openGreetings)
        MoreTool.GiftCards -> GiftCardsNativeScreen(session)
        MoreTool.Pos -> PosNativeScreen(session)
        MoreTool.Referrals -> ReferralsNativeScreen(session)
    }
}

private fun ownerPath(session: OwnerSession, path: String): String =
    "/api/v1/business/${java.net.URLEncoder.encode(session.slug, "UTF-8")}/$path"

internal suspend fun ownerRead(session: OwnerSession, path: String): Pair<Int, Any>? =
    withContext(Dispatchers.IO) { runCatching { API.get(ownerPath(session, path), session.token) }.getOrNull() }

private suspend fun ownerWrite(
    session: OwnerSession, method: String, path: String, body: JSONObject
): Pair<Int, Any>? = withContext(Dispatchers.IO) {
    runCatching {
        val url = ownerPath(session, path)
        when (method) {
            "POST" -> API.post(url, session.token, body)
            "PATCH" -> API.patch(url, session.token, body)
            "PUT" -> API.put(url, session.token, body)
            else -> throw IllegalArgumentException("Unsupported write")
        }
    }.getOrNull()
}

private fun apiError(result: Pair<Int, Any>?, fallback: String): String = when {
    result == null -> "Connection unavailable. Please try again."
    result.first in 200..299 -> ""
    result.first == 401 -> "Session expired. Sign in again."
    result.first == 403 -> API.message(result.second, "Your plan or account does not have access.")
    else -> API.message(result.second, fallback)
}

private fun JSONArray.toObjects(): List<JSONObject> = buildList {
    for (i in 0 until length()) optJSONObject(i)?.let { add(it) }
}

@Composable
private fun NativeLoad(
    session: OwnerSession, path: String, inset: Boolean = true,
    body: @Composable (Any, () -> Unit) -> Unit
) {
    var stamp by remember(session.slug, path) { mutableIntStateOf(0) }
    var payload by remember(session.slug, path) { mutableStateOf<Any?>(null) }
    var error by remember(session.slug, path) { mutableStateOf("") }
    var busy by remember(session.slug, path) { mutableStateOf(true) }
    LaunchedEffect(session.slug, session.token, path, stamp) {
        busy = true
        error = ""
        val res = ownerRead(session, path)
        if (res == null || res.first !in 200..299) {
            error = apiError(res, "Could not load ${path.substringBefore('?')}.")
            payload = null
        } else {
            payload = res.second
        }
        busy = false
    }
    Column(Modifier.fillMaxWidth().padding(if (inset) 16.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (busy) Text("Loading…", color = MoreMuted)
        if (error.isNotBlank()) {
            Text(error, color = Color(0xFF9F2D2D), fontSize = 13.sp)
            MoreAction("Try again") { stamp++ }
        }
        payload?.let { body(it) { stamp++ } }
    }
}

@Composable
private fun NativeScroll(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Color(0xFFF4F7F1)).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) { content() }
}

@Composable
private fun MorePanel(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().border(1.dp, MoreLine, MoreShape).background(Color.White, MoreShape).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) { content() }
}

@Composable
private fun MoreHeader(title: String, caption: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, fontWeight = FontWeight.Bold, color = MoreInk, fontSize = 22.sp)
        Text(caption, color = MoreMuted, fontSize = 13.sp)
    }
}

@Composable
private fun MoreRow(label: String, value: String) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = MoreMuted, fontSize = 12.sp)
        Text(value.ifBlank { "—" }, color = MoreInk, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

@Composable
private fun MoreAction(title: String, enabled: Boolean = true, action: () -> Unit) {
    Button(
        onClick = action, enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = MoreInk),
        shape = RoundedCornerShape(12.dp)
    ) { Text(title) }
}

@Composable
private fun MoreInput(label: String, value: String, changed: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = changed, label = { Text(label) },
        modifier = Modifier.fillMaxWidth(), singleLine = true)
}

@Composable
private fun TeamNativeScreen(session: OwnerSession, openCashiers: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    NativeScroll {
        NativeLoad(session, "branches") { raw, reload ->
            val branches = (raw as? JSONArray)?.toObjects().orEmpty()
            StitchHeading("Operations & team", "Team & Branch Management", "Manage outlets, staff and access permissions")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StitchStat("Branches", branches.size.toString(), "All outlets", Modifier.weight(1f))
                StitchStat("Active", branches.count { it.optBoolean("is_active", true) }.toString(), "Operating locations", Modifier.weight(1f))
            }
            MoreAction(if (adding) "Close new branch" else "+ Add branch") { adding = !adding }
            if (adding) MorePanel {
                StitchSectionTitle("New Branch", "Set up a new business location")
                MoreInput("New branch name", name) { name = it }
                MoreInput("Address (optional)", address) { address = it }
                MoreAction(if (busy) "Saving…" else "Add branch", !busy && name.trim().isNotBlank()) {
                    scope.launch {
                        busy = true
                        val res = ownerWrite(session, "POST", "branches", JSONObject().put("name", name.trim()).put("address", address.trim()))
                        busy = false
                        val failure = apiError(res, "Could not add branch.")
                        message = if (failure.isEmpty()) "Branch added." else failure
                        if (failure.isEmpty()) { name = ""; address = ""; adding = false; reload() }
                    }
                }
                if (message.isNotBlank()) Text(message, color = MoreInk)
            }
            branches.forEach { row ->
                val id = row.optString("public_id")
                var edit by remember(id) { mutableStateOf(false) }
                var newName by remember(id) { mutableStateOf(row.optString("name")) }
                var newAddress by remember(id) { mutableStateOf(row.optString("address")) }
                var active by remember(id) { mutableStateOf(row.optBoolean("is_active", true)) }
                MorePanel {
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(row.optString("name"), fontWeight = FontWeight.Bold, fontSize = 16.sp, color = MoreInk, modifier = Modifier.weight(1f))
                        Text(if (row.optBoolean("is_active", true)) "● Active" else "○ Inactive",
                            color = if (row.optBoolean("is_active", true)) Color(0xFF247E5E) else MoreMuted,
                            fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
                    }
                    Text(row.optString("address").ifBlank { "No branch address provided" }, color = MoreMuted, fontSize = 12.sp)
                    if (edit) {
                        MoreInput("Branch name", newName) { newName = it }
                        MoreInput("Address", newAddress) { newAddress = it }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Active", color = MoreInk)
                            androidx.compose.material3.Switch(active, { active = it })
                        }
                        MoreAction("Save branch", !busy && newName.trim().isNotBlank()) {
                            scope.launch {
                                busy = true
                                val body = JSONObject().put("name", newName.trim()).put("address", newAddress.trim()).put("is_active", active)
                                val res = ownerWrite(session, "PATCH", "branches/${java.net.URLEncoder.encode(id, "UTF-8")}", body)
                                busy = false
                                val failure = apiError(res, "Could not update branch.")
                                message = if (failure.isEmpty()) "Branch updated." else failure
                                if (failure.isEmpty()) { edit = false; reload() }
                            }
                        }
                    } else {
                        MoreAction("Edit branch") { edit = true }
                    }
                }
            }
            MorePanel {
                StitchSectionTitle("Staff & permissions", "Manage native cashier assignments")
                MoreAction("Manage staff assignments") { openCashiers() }
                Text("New staff invitations require secure PIN onboarding; this app will not issue default-PIN invitations.", color = MoreMuted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun CustomerFacingEditorScreen(openEditor: (String) -> Unit) {
    NativeScroll {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            StitchHeading("Customer experience", "Customer Dashboard", "Manage what customers see when they join or scan")
            Column(Modifier.fillMaxWidth().background(StitchStyle.forest, RoundedCornerShape(18.dp)).padding(18.dp)) {
                Text("YOUR CUSTOMER EXPERIENCE", color = StitchStyle.mint, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text("Everything your customers see, in one place", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("Select a section to update its customer-facing settings.", color = Color.White.copy(alpha=.85f), fontSize = 12.sp)
            }
            val entries = listOf(
                Triple("digital_menu", "Digital Menu", "Products, photos, prices, availability and QR menu"),
                Triple("campaigns", "Campaigns", "Offers and customer promotions"),
                Triple("notifications", "Notifications", "Birthday and win-back messages"),
                Triple("wifi", "Guest Wi-Fi", "Network details displayed to customers"),
                Triple("points", "LT Points", "Customer rewards and LoyaltyTree points"),
                Triple("socials", "Social Links", "Your customer-facing social media profiles")
            )
            entries.forEach { (key, title, subtitle) ->
                StitchSurface(Modifier.clickable { openEditor(key) }) {
                    Text(title + "   ›", color = StitchStyle.forest, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(subtitle, color = StitchStyle.muted, fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun CrmNativeScreen(session: OwnerSession, openCustomer: (String) -> Unit) {
    NativeScroll {
        Spacer(Modifier.height(6.dp))
        NativeLoad(session, "crm", inset = false) { raw, _ ->
            if (raw is JSONObject) StitchCrm(raw, openCustomer)
            else Text("CRM data is unavailable.", color = MoreMuted)
        }
    }
}

@Composable
private fun LoyaltyNativeScreen(session: OwnerSession, openCard: () -> Unit) {
    NativeScroll {
        Spacer(Modifier.height(6.dp))
        NativeLoad(session, "programs", inset = false) { raw, _ ->
            if (raw is JSONObject) StitchLoyalty(raw, openCard)
            else Text("Loyalty program data is unavailable.", color = MoreMuted)
        }
    }
}

@Composable
private fun SatisfactionNativeScreen(session: OwnerSession) {
    NativeScroll {
        NativeLoad(session, "feedback") { raw, _ ->
            val data = raw as? JSONObject ?: JSONObject()
            val summary = data.optJSONObject("summary") ?: JSONObject()
            MoreHeader("Customer satisfaction", "Customer feedback submitted through LoyaltyTree.")
            MorePanel {
                MoreRow("Responses", summary.optString("response_count", "0"))
                MoreRow("Average rating", summary.optString("average_rating", "Not yet rated") + " / 5")
                MoreRow("Positive responses", summary.optString("positive_percent", "0") + "%")
                MoreRow("Service · Quality · Value", listOf("service_average", "quality_average", "value_average").joinToString(" · ") { summary.optString(it, "—") })
            }
            val feedback = data.optJSONArray("feedback")?.toObjects().orEmpty()
            if (feedback.isEmpty()) Text("No feedback yet.", color = MoreMuted)
            feedback.take(75).forEach { row ->
                MorePanel {
                    Text(row.optString("customer_name", "Customer"), fontWeight = FontWeight.Bold, color = MoreInk)
                    MoreRow("Rating", "${row.optInt("rating")} / 5")
                    val comment = row.optString("comment")
                    if (comment.isNotBlank()) Text(comment, color = MoreInk)
                    MoreRow("Submitted", row.optString("created_at"))
                }
            }
        }
    }
}

@Composable
private fun RetentionNativeScreen(session: OwnerSession, openGreetings: () -> Unit) {
    NativeScroll {
        Spacer(Modifier.height(6.dp))
        NativeLoad(session, "retention-analytics", inset = false) { raw, _ ->
            if (raw is JSONObject) StitchRetentionOverview(raw, openGreetings)
            else Text("Retention report is unavailable.", color = MoreMuted)
        }
        NativeLoad(session, "retention-opportunities", inset = false) { raw, _ ->
            if (raw is JSONObject) StitchRetentionOpportunities(raw)
            else Text("Retention opportunities are unavailable.", color = MoreMuted)
        }
    }
}

@Composable
private fun GiftCardsNativeScreen(session: OwnerSession) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var faceValue by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    NativeScroll {
        NativeLoad(session, "gift-cards/overview") { raw, reloadOverview ->
            val data = raw as? JSONObject ?: JSONObject()
            MoreHeader("Gift cards", "Digital gift card inventory. The website and app share the same records.")
            MorePanel {
                MoreRow("Plan", data.optString("plan"))
                MoreRow("Issued", data.optInt("total_issued").toString())
                MoreRow("Available", data.optInt("available_cards").toString())
                MoreRow("Outstanding value", "₱${data.optString("outstanding_value", "0")}")
                MoreRow("Redeemed value", "₱${data.optString("redeemed_value", "0")}")
            }
            if (data.optBoolean("feature_enabled")) {
                MorePanel {
                    Text("Issue digital amount cards", color = MoreInk, fontWeight = FontWeight.Bold)
                    Text("Creating cards creates new customer-facing gift liabilities. Review the totals before confirming.", color = MoreMuted, fontSize = 12.sp)
                    MoreInput("Gift card title", name) { name = it; confirm = false }
                    MoreInput("Value (₱)", faceValue) { faceValue = it; confirm = false }
                    MoreInput("Quantity (1–20)", quantity) { quantity = it; confirm = false }
                    val amount = faceValue.toDoubleOrNull()
                    val count = quantity.toIntOrNull()
                    val valid = name.isNotBlank() && amount != null && amount > 0 && amount.isFinite() && count != null && count in 1..20
                    if (confirm && valid) {
                        Text("Confirm issuance: $count digital cards, ₱$amount each (₱${amount!! * count!!} total face value).", color = MoreInk, fontWeight = FontWeight.Bold)
                    }
                    MoreAction(if (confirm) "Confirm and issue cards" else "Review issuance", valid && !busy) {
                        if (!confirm) confirm = true
                        else scope.launch {
                            busy = true
                            val payload = JSONObject().put("name", name.trim()).put("gift_type", "amount")
                                .put("face_value", amount!!).put("quantity", count!!).put("print_option", "digital")
                            val res = ownerWrite(session, "POST", "gift-card-batches", payload)
                            busy = false
                            val failure = apiError(res, "Could not issue gift cards.")
                            message = if (failure.isEmpty()) "Cards issued. Refresh the card list." else failure
                            confirm = false
                            if (failure.isEmpty()) { name = ""; faceValue = ""; quantity = "1"; reloadOverview() }
                        }
                    }
                    if (message.isNotBlank()) Text(message, color = MoreInk)
                }
            } else {
                Text("New issuance is not included in this plan; existing gift cards remain visible.", color = MoreMuted)
            }
        }
        NativeLoad(session, "gift-cards?limit=100") { raw, reloadCards ->
            val data = raw as? JSONObject ?: JSONObject()
            val cards = data.optJSONArray("cards")?.toObjects().orEmpty()
            MorePanel {
                MoreRow("Listed cards", cards.size.toString())
                MoreAction("Refresh card list") { reloadCards() }
            }
            cards.take(75).forEach { row ->
                MorePanel {
                    Text(row.optString("name", "Gift card"), color = MoreInk, fontWeight = FontWeight.Bold)
                    MoreRow("Status", row.optString("status").replace('_', ' '))
                    MoreRow("Balance", if (row.optString("gift_type") == "item") "${row.optString("remaining_quantity")} uses" else "₱${row.optString("remaining_amount", "0")}")
                    MoreRow("Expires", row.optString("expires_at", "—"))
                }
            }
        }
    }
}

@Composable
private fun PosNativeScreen(session: OwnerSession) {
    var provider by remember { mutableStateOf("storehub") }
    NativeScroll {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MoreHeader("POS integration", "Native provider status, branch links and recent activity. Protected by your plan.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MoreAction("StoreHub") { provider = "storehub" }
                MoreAction("Loyverse") { provider = "loyverse" }
            }
        }
        NativeLoad(session, "pos?provider=$provider") { raw, _ ->
            val data = raw as? JSONObject ?: JSONObject()
            MorePanel {
                MoreRow("Provider", provider.replaceFirstChar { it.uppercase() })
                MoreRow("Plan", data.optString("plan", "—"))
                val integration = data.optJSONObject("integration") ?: JSONObject()
                MoreRow("Status", integration.optString("status", "Not connected"))
                val connection = data.optJSONObject(if (provider == "storehub") "storehub_connection" else "loyverse_connection")
                MoreRow("Credentials", if (connection?.optBoolean("credentials_saved") == true) "Stored securely on server" else "Not connected")
                MoreRow("Branch mappings", (data.optJSONArray("branch_mappings")?.length() ?: 0).toString())
                MoreRow("Recent transactions", (data.optJSONArray("recent_transactions")?.length() ?: 0).toString())
            }
            data.optJSONArray("branch_mappings")?.toObjects()?.forEach { row ->
                MorePanel {
                    MoreRow("Branch", row.optString("branch_name", row.optString("branch_public_id")))
                    MoreRow("POS location", row.optString("external_location_name", row.optString("external_location_id")))
                }
            }
            Text("Provider connection, test transactions and go-live require a separate verified workflow. No test sale or connection is performed by opening this screen.", color = MoreMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun ReferralsNativeScreen(session: OwnerSession) {
    val context = LocalContext.current
    NativeScroll {
        NativeLoad(session, "referrals") { raw, _ ->
            val data = raw as? JSONObject ?: JSONObject()
            val link = data.optString("referral_link")
            MoreHeader("Referrals", "Share your business referral link and see earned months.")
            MorePanel {
                MoreRow("Referral code", data.optString("referral_code"))
                MoreRow("Signups", data.optInt("signups").toString())
                MoreRow("Paying referrals", data.optInt("paying").toString())
                MoreRow("Free months earned", data.optInt("months_earned").toString())
                Text(data.optString("reward"), color = MoreMuted, fontSize = 13.sp)
                if (link.startsWith("https://")) MoreAction("Share referral link") {
                    val intent = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, link) }
                    context.startActivity(Intent.createChooser(intent, "Share LoyaltyTree referral"))
                }
            }
            data.optJSONArray("referrals")?.toObjects()?.forEach { row ->
                MorePanel {
                    Text(row.optString("name", "Business"), color = MoreInk, fontWeight = FontWeight.Bold)
                    MoreRow("Status", row.optString("status"))
                    MoreRow("Paid", if (row.optBoolean("paid")) "Yes" else "Not yet")
                }
            }
        }
    }
}
