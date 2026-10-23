// Test transport only. No sockets; actual PoolSession/crypto are compiled unchanged.
package com.kilombino.pyblockwatch.coinjoin
import org.json.JSONObject
class RelayClient(private val url: String, private val onEvent: (String, NostrEvent) -> Unit, private val onClosed: (Throwable?) -> Unit = {}) {
    var connected = true
    var lastHeard = System.currentTimeMillis()
    fun connect() { connected = true }
    fun close() { connected = false }
    fun ping() = true
    fun subscribe(subId: String, filters: List<JSONObject>, waitEose: Boolean = true, timeoutSec: Long = 15) {}
    fun unsubscribe(subId: String) {}
    fun publish(ev: NostrEvent, timeoutSec: Long = 15): Pair<Boolean, String> { published.add(ev); return true to "offline accepted" }
    companion object { val published = mutableListOf<NostrEvent>() }
}
