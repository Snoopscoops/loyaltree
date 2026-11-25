package com.loyaltytree.owner

import java.math.BigDecimal
import java.math.RoundingMode

internal data class CounterBillKey(val source: String, val branch: String, val root: String)
internal data class CounterBill(val key: CounterBillKey, val parent: LiveOrder?, val orders: List<LiveOrder>) {
    val grouped = orders.any { it.source == "menu" && (it.service == "dine-in" || it.parentOrderId.isNotBlank()) }
    val active = orders.any { it.status in setOf("new", "preparing", "ready") }
    private val billable = orders.filterNot { it.status == "cancelled" }
    private fun sum(rows: List<LiveOrder>): BigDecimal? {
        var result = BigDecimal.ZERO
        for (row in rows) {
            val value = row.rawTotal.toBigDecimalOrNull() ?: return null
            if (value.signum() < 0) return null
            result = result.add(value)
        }
        return result
    }
    val total = sum(billable)
    val paid = sum(billable.filter { it.payment == "paid" })
    val balance = if (total != null && paid != null) total.subtract(paid) else null
}

internal fun groupCounterBills(orders: List<LiveOrder>): List<CounterBill> = orders.groupBy { order ->
    CounterBillKey(order.source, order.branchId, if (order.source == "menu") order.parentOrderId.ifBlank { order.id } else order.id)
}.map { (key, members) ->
    val parent = members.firstOrNull { it.id == key.root && it.parentOrderId.isBlank() }
    val children = members.filter { it.id != parent?.id }.sortedWith(compareBy<LiveOrder> { it.createdAt }.thenBy { it.number })
    CounterBill(key, parent, listOfNotNull(parent) + children)
}

internal fun billMoney(value: BigDecimal): String = "₱" + value.setScale(2, RoundingMode.HALF_UP).toPlainString()
