package com.kilombino.pyblockwatch.coinjoin
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList
/** Test-only transport. No sockets or production relay. Signed encrypted events cross stdio. */
class RelayClient(val url: String, val onEvent: (String, NostrEvent) -> Unit, val onClosed: (Throwable?) -> Unit = {}) {
    var connected = false
    var lastHeard = System.currentTimeMillis()
    private val filters = java.util.concurrent.ConcurrentHashMap<String, List<JSONObject>>()
    fun connect() { connected = true; clients.add(this) }
    fun close() { connected = false; clients.remove(this) }
    fun ping(): Boolean { lastHeard = System.currentTimeMillis(); return true }
    fun subscribe(id: String, value: List<JSONObject>, waitEose: Boolean = true) { filters[id] = value }
    fun unsubscribe(id: String) { filters.remove(id) }
    fun publish(event: NostrEvent): Pair<Boolean, String> {
        require(event.verify())
        synchronized(System.out) { println(JSONObject().put("event", event.toJson())) }
        deliver(event)
        return Pair(true, "test relay accepted")
    }
    companion object {
        val clients = CopyOnWriteArrayList<RelayClient>()
        fun deliver(event: NostrEvent) {
            require(event.verify())
            clients.forEach { client -> client.filters.forEach { (id, choices) ->
                if (choices.any { f ->
                    fun includes(name: String, value: Any): Boolean = !f.has(name) || (0 until f.getJSONArray(name).length()).any { f.getJSONArray(name).get(it) == value }
                    includes("kinds", event.kind) && includes("authors", event.pubkey) && includes("#p", event.tag("p") ?: "") && includes("#d", event.tag("d") ?: "")
                }) { client.lastHeard = System.currentTimeMillis(); client.onEvent(id, event) }
            } }
        }
    }
}
