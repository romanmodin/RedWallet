package kilojoin.test
import com.kilombino.pyblockwatch.coinjoin.*
import com.kilombino.pyblockwatch.crypto.*
import org.json.JSONObject
import java.math.BigInteger
/** Actual upstream creator state machine. All funds/keys/chain observations are synthetic. */
fun main(args: Array<String>) {
    val type = if (args.single() == "p2tr") ScriptType.P2TR else ScriptType.P2WPKH
    fun pub(n: Long) = Secp256k1.compress(Secp256k1.multiply(BigInteger.valueOf(n), Secp256k1.G))
    fun script(n: Long) = Address.scriptPubKey(pub(n), type)
    val newPool = PoolSession.newPool(10000, 2.0, 5, 1, script = type, v3 = true)
    val coin = CoinjoinTx.Coin("22".repeat(32), 0, 50000, pub(2), type)
    val state = PoolSession.newState(newPool.terms, true, newPool.secret, listOf(coin), listOf(BigInteger.TWO), listOf("public-fixture"), script(6), script(4), creatorSecret = newPool.creatorSecret, blindPriv = newPool.blindPriv)
    val env = object: PoolSession.Env {
        override fun coinUnspent(c: CoinjoinTx.Coin): Boolean = c.value == 50000L && c.vout == 0 && ((c.txid == "11".repeat(32) && c.pubkey.contentEquals(pub(1))) || (c.txid == "22".repeat(32) && c.pubkey.contentEquals(pub(2)))) && c.type == type
        override fun confirmations(txid: String): Int? = null
        override fun broadcast(rawHex: String): String {
            synchronized(System.out) { println(JSONObject().put("broadcast", rawHex)) }
            return CoinjoinTx.txid(CoinjoinTx.plan(state.round.flatMap { it.coins }, state.outputs.map { Hashes.hexToBytes(it) }, state.round.filter { it.changeScript != null && it.changeValue > 0 }.map { TxBuilder.Output(it.changeScript!!, it.changeValue) }, state.terms.amount))
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
