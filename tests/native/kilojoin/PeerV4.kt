package kilojoin.test
import com.kilombino.pyblockwatch.coinjoin.*
import com.kilombino.pyblockwatch.crypto.*
import org.json.JSONObject
import java.math.BigInteger
/** Actual upstream creator state machine. All funds/keys/chain observations are synthetic. */
fun main(args: Array<String>) {
    val type = if (args[0] == "p2tr") ScriptType.P2TR else ScriptType.P2WPKH
    val count = args[1].toInt()
    fun pub(n: Long) = Secp256k1.compress(Secp256k1.multiply(BigInteger.valueOf(n), Secp256k1.G))
    fun script(n: Long) = Address.scriptPubKey(pub(n), type)
    val newPool = PoolSession.newPool(10000, 2.0, 5, 1, script = type, v3 = true, outputs = count)
    val fixture = if (args.size > 2) JSONObject(args[2]) else null
    fun rpc(method: String, vararg values: String): String {
        val config = fixture!!.getJSONArray("cli")
        val command = (0 until config.length()).map { config.getString(it) } + listOf(method) + values
        val proc = ProcessBuilder(command).start()
        val result = proc.inputStream.bufferedReader().readText().trim()
        require(proc.waitFor() == 0) { "isolated fixture RPC failed" }
        return result
    }
    val coin = if (fixture == null) CoinjoinTx.Coin("22".repeat(32), 0, 100000, pub(2), type) else fixture.getJSONObject("coin").let { CoinjoinTx.Coin(it.getString("txid"), it.getInt("vout"), it.getLong("value"), pub(2), type) }
    val state = PoolSession.newState(newPool.terms, true, newPool.secret, listOf(coin), listOf(BigInteger.TWO), listOf("public-fixture"), List(count) { script(30L + it) }, script(4), creatorSecret = newPool.creatorSecret, blindPriv = newPool.blindPriv)
    val env = object: PoolSession.Env {
        override fun coinUnspent(c: CoinjoinTx.Coin): Boolean = if (fixture != null) {
            val result = rpc("gettxout", c.txid, c.vout.toString())
            if (result.isEmpty() || result == "null") false else JSONObject(result).let { it.getBigDecimal("value").movePointRight(8).longValueExact() == c.value && it.getJSONObject("scriptPubKey").getString("hex") == Address.scriptPubKey(c.pubkey, c.type).joinToString("") { "%02x".format(it) } }
        } else c.value == 100000L && c.vout == 0 && ((c.txid == "11".repeat(32) && c.pubkey.contentEquals(pub(1))) || (c.txid == "22".repeat(32) && c.pubkey.contentEquals(pub(2)))) && c.type == type
        override fun confirmations(txid: String): Int? = null
        override fun broadcast(rawHex: String): String {
            val accepted = if (fixture != null) rpc("sendrawtransaction", rawHex) else null
            synchronized(System.out) { println(JSONObject().put("broadcast", rawHex)) }
            if (accepted != null) return accepted
            return CoinjoinTx.txid(CoinjoinTx.plan(state.round.flatMap { it.coins }, state.outputs.map { Hashes.hexToBytes(it) }, state.round.filter { it.changeScript != null && it.changeValue > 0 }.map { TxBuilder.Output(it.changeScript!!, it.changeValue) }, state.terms.amount, count))
        }
        override fun save(state: PoolSession.State) { PoolSession.State.parse(state.toJson()) }
        override fun event(e: PoolSession.Event) { synchronized(System.out) { println(JSONObject().put("phase", e.javaClass.simpleName)) } }
        override fun log(msg: String) { System.err.println(msg) }
    }
    val session = PoolSession(env, state)
    session.autoKeys = listOf(BigInteger.TWO)
    try {
        session.start()
        generateSequence(::readLine).forEach { line -> RelayClient.deliver(NostrEvent.parse(JSONObject(line))!!) }
    } finally { session.stop() }
}
