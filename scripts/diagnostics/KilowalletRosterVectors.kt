// Offline disposable-key vectors from actual Kilowallet Protocol/CoinjoinTx.
import com.kilombino.pyblockwatch.coinjoin.*
import com.kilombino.pyblockwatch.crypto.*
import com.kilombino.pyblockwatch.crypto.Hashes.toHex
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger

fun main() {
    val fees = JSONArray()
    val seats = JSONArray()
    val pool = "0123456789abcdef"
    for (type in listOf(ScriptType.P2WPKH, ScriptType.P2TR)) {
        for (outputs in 1..5) for (inputs in listOf(1, 2, 8, 10)) for (rate in listOf(1.0, 1.25, 2.0, 500.0)) {
            val amount = 1000000L
            val without = CoinjoinTx.feeShare(rate, false, inputs, type, outputs)
            val with = CoinjoinTx.feeShare(rate, true, inputs, type, outputs)
            for (value in listOf(amount * outputs + without - 1, amount * outputs + without, amount * outputs + with + 294, amount * outputs + with + 295)) {
                fees.put(JSONObject().put("type", Protocol.scriptName(type)).put("outputs", outputs).put("inputs", inputs).put("rate", rate).put("amount", amount).put("value", value).put("feeWithChange", with).put("feeWithoutChange", without).put("change", CoinjoinTx.change(value, amount, rate, inputs, type, outputs) ?: JSONObject.NULL))
            }
        }
        for (outputs in listOf(1, 2, 5)) for (inputs in listOf(1, 2)) {
            val join = NostrEvent.pubOf(BigInteger.valueOf(7))
            val coins = (1..inputs).map { i -> CoinjoinTx.Coin(i.toString().repeat(64), i - 1, 10000000L, Secp256k1.compress(Secp256k1.publicPoint(BigInteger.valueOf(i.toLong()))), type) }
            val change = CoinjoinTx.change(coins.sumOf { it.value }, 1000000L, 1.0, inputs, type, outputs)!!
            val script = Address.scriptPubKey(Secp256k1.compress(Secp256k1.publicPoint(BigInteger.valueOf(6))), type)
            val proofs = coins.mapIndexed { i, coin -> CoinjoinTx.proveOwnership(pool, join, coin, BigInteger.valueOf(i.toLong() + 1)).toHex() }
            val seat = Protocol.Seat(Protocol.tokenHash("test-token"), coins, script, change, join, proofs)
            seats.put(JSONObject().put("type", Protocol.scriptName(type)).put("outputs", outputs).put("seat", seat.toJson()).put("changeMessage", Protocol.changeMessage(pool, coins, script, change).toHex()).put("coinScripts", JSONArray(coins.map { it.script.toHex() })))
        }
    }
    println(JSONObject().put("upstreamCommit", "233733def7e492084f4d57e5faa1d76b9ab2ce79").put("poolId", pool).put("fees", fees).put("seats", seats).toString(2))
}
