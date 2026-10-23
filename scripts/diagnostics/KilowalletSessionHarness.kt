// Offline harness for actual unmodified PoolSession; disposable synthetic inputs only.
import com.kilombino.pyblockwatch.coinjoin.*
import com.kilombino.pyblockwatch.crypto.*
import org.json.JSONObject
import org.json.JSONArray
import java.math.BigInteger
fun main() {
    val input = JSONObject(System.`in`.bufferedReader().readText())
    val state: PoolSession.State
    if (input.optString("command") == "setup") {
        val count = input.getInt("outputs")
        val type = if (input.optString("script") == "p2tr") ScriptType.P2TR else ScriptType.P2WPKH
        val pool = PoolSession.newPool(input.optLong("amount", 1000000), 1.0, input.optInt("maxPeers", 2), 2, script = type, maxInputs = 10, v3 = true, outputs = count)
        // A deliberately short legitimate pool scalar exercises the compatibility correction.
        val terms = pool.terms.copy(poolPub = NostrEvent.pubOf(BigInteger.valueOf(2)))
        val coinKey = BigInteger.valueOf(4)
        val coin = CoinjoinTx.Coin("44".repeat(32), 0, 20000000, Secp256k1.compress(Secp256k1.publicPoint(coinKey)), type)
        fun script(n: Int) = Address.scriptPubKey(Secp256k1.compress(Secp256k1.publicPoint(BigInteger.valueOf(n.toLong()))), type)
        state = PoolSession.newState(terms, true, "2", listOf(coin), listOf(coinKey), listOf("synthetic"), (0 until count).map { script(20+it) }, script(6), creatorSecret = pool.creatorSecret, blindPriv = pool.blindPriv)
    } else state = PoolSession.State.parse(input.getJSONObject("state"))
    val env = object : PoolSession.Env {
        override fun coinUnspent(coin: CoinjoinTx.Coin) = !input.optBoolean("failChain")
        override fun broadcast(rawHex: String): String = error("Broadcast prohibited in offline harness")
        override fun confirmations(txid: String): Int? = null
        override fun save(state: PoolSession.State) {}
        override fun event(e: PoolSession.Event) {}
    }
    val session = PoolSession(env, state)
    val relay = RelayClient("offline", { _, _ -> })
    PoolSession::class.java.getDeclaredField("relay").apply { isAccessible = true }.set(session, relay)
    try {
        if (input.optString("command") == "setup") {
            PoolSession::class.java.getDeclaredMethod("creatorStart").apply { isAccessible = true }.invoke(session)
            // Fill all but the final seat with real upstream-generated join requests.
            for (index in 0 until state.terms.maxPeers - 2) {
                val k = BigInteger.valueOf(100L + index)
                fun script(n: Int) = Address.scriptPubKey(Secp256k1.compress(Secp256k1.publicPoint(BigInteger.valueOf(n.toLong()))), state.terms.script)
                val coin = CoinjoinTx.Coin((5 + index).toString().repeat(64), 0, 20000000, Secp256k1.compress(Secp256k1.publicPoint(k)), state.terms.script)
                val memberState = PoolSession.newState(state.terms, false, null, listOf(coin), listOf(k), listOf("synthetic"), (0 until state.terms.outputs).map { script(200 + index * 10 + it) }, script(300 + index))
                val member = PoolSession(env, memberState)
                PoolSession::class.java.getDeclaredField("relay").apply { isAccessible = true }.set(member, relay)
                try {
                    PoolSession::class.java.getDeclaredMethod("sendJoin").apply { isAccessible = true }.invoke(member)
                    val join = RelayClient.published.last()
                    PoolSession::class.java.getDeclaredMethod("onEvent", NostrEvent::class.java).apply { isAccessible = true }.invoke(session, join)
                } finally { member.stop(); relay.connect() }
            }

        } else {
            val receive = PoolSession::class.java.getDeclaredMethod("onEvent", NostrEvent::class.java).apply { isAccessible = true }
            val events = input.getJSONArray("events")
            for (i in 0 until events.length()) receive.invoke(session, NostrEvent.parse(events.getJSONObject(i)))
            if (input.optBoolean("completeSeedVotes")) {
                // The seeded seats have no running timers/UI; submit their authenticated
                // test votes through the real event boundary, rather than bypassing it.
                for (seat in state.seats.filter { it.coin.txid.first() in '5'..'7' }) {
                    val token = state.tokens[seat.tokenHash] ?: error("missing synthetic token")
                    val body = JSONObject().put("type", "vote").put("token_hash", seat.tokenHash).put("vote_id", state.voteId).put("accept", true)
                        .put("mac", Protocol.mac(token, "vote", state.voteId!!, true))
                    val key = BigInteger(state.poolSecret, 16)
                    val ev = NostrEvent.sign(key, Protocol.KIND_MSG, listOf(listOf("p", state.terms.poolPub)), Nip44.encrypt(body.toString(), Nip44.conversationKey(key, Hashes.hexToBytes(state.terms.poolPub))))
                    receive.invoke(session, ev)
                }
            }

        }
        println(JSONObject().put("state", state.toJson()).put("events", JSONArray(RelayClient.published.map { it.toJson() })).toString())
    } finally { session.stop() }
}
