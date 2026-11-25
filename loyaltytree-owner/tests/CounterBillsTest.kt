package com.loyaltytree.owner

// Pure Kotlin checks. Compile with the LiveOrder/OrderLine model and CounterBills.kt.
fun main() {
    fun order(id: String, parent: String = "", amount: String = "150.00", payment: String = "unpaid", status: String = "new", branch: String = "a", source: String = "menu") = LiveOrder(
        id, id, status, "Customer", branch, "", "₱$amount", "", payment, emptyList(), source = source, branchId = branch,
        service = "dine-in", parentOrderId = parent, rawTotal = amount
    )
    val root = order("001", payment = "paid", status = "ready")
    val a = order("001A", "001", "75.25", "paid", "completed")
    val b = order("001B", "001", "60.50")
    val cancelled = order("001C", "001", "999", status = "cancelled")
    val grouped = groupCounterBills(listOf(b, a, cancelled, root)).single()
    check(grouped.parent == root)
    check(grouped.orders.map { it.id } == listOf("001", "001A", "001B", "001C"))
    check(billMoney(grouped.total!!) == "₱285.75")
    check(billMoney(grouped.paid!!) == "₱225.25")
    check(billMoney(grouped.balance!!) == "₱60.50")
    check(grouped.active && grouped.grouped)
    check(groupCounterBills(listOf(root, b.copy(branchId = "other"))).size == 2)
    check(groupCounterBills(listOf(root, b.copy(source = "ahead"))).size == 2)
    check(groupCounterBills(listOf(b)).single().parent == null)
    check(groupCounterBills(listOf(root.copy(status = "completed"), a)).single().active.not())
    check(groupCounterBills(listOf(root, b.copy(rawTotal = "invalid"))).single().total == null)
    check(groupCounterBills(listOf(root.copy(status = "completed"), b)).single().active)
    check(groupCounterBills(listOf(root.copy(source = "ahead"))).single().grouped.not())
    println("13 grouped-bill checks passed")
}
