import com.kilombino.pyblockwatch.coinjoin.CoinjoinTx
import com.kilombino.pyblockwatch.crypto.*
import com.kilombino.pyblockwatch.crypto.Hashes.toHex
import java.io.File
import java.math.BigInteger

fun main(args: Array<String>) {
    val records = File(args[0]).readLines().filter { it.isNotBlank() }
    check(records.size == 2) { "Expected SegWit and Taproot records" }
    val results = records.map { line ->
        val parts = line.split("\t")
        check(parts.size == 5)
        val type = when(parts[0]) { "p2wpkh" -> ScriptType.P2WPKH; "p2tr" -> ScriptType.P2TR; else -> error("Unknown script type") }
        fun script(n: Int) = Hashes.hexToBytes(if(type == ScriptType.P2WPKH) "0014" + n.toString(16).repeat(40) else "5120" + n.toString(16).repeat(64))
        val coins = (1..2).map { n -> CoinjoinTx.Coin(n.toString(16).repeat(64), 0, 50000,
            Secp256k1.compress(Secp256k1.publicPoint(BigInteger.valueOf(n.toLong()))), type) }
        val change = CoinjoinTx.change(50000, 10000, 2.0, 1, type)!!
        val plan = CoinjoinTx.plan(coins, listOf(script(5), script(6)), listOf(TxBuilder.Output(script(3), change), TxBuilder.Output(script(4), change)), 10000)
        check(CoinjoinTx.txid(plan) == parts[1]) { "Cross-client txid mismatch" }
        val redSignatures = coins.mapIndexed { i, coin -> coin.outpoint to Hashes.hexToBytes(parts[i + 3]) }.toMap()
        coins.forEach { coin -> check(CoinjoinTx.verify(plan, coin, redSignatures[coin.outpoint]!!)) { "Kotlin rejected RedWallet signature" } }
        check(CoinjoinTx.assemble(plan, redSignatures).rawHex == parts[2]) { "Cross-client raw transaction mismatch" }
        val signatures = coins.mapIndexed { i, coin -> CoinjoinTx.sign(plan, coin, BigInteger.valueOf((i + 1).toLong())).toHex() }
        println("PASS Kotlin verifies RedWallet ${parts[0]} signatures and exact transaction bytes")
        "{\"type\":\"${parts[0]}\",\"txid\":\"${parts[1]}\",\"signatures\":[" + signatures.joinToString(",") { "\"$it\"" } + "]}"
    }
    File(args[1]).writeText("[" + results.joinToString(",") + "]\n")
}
