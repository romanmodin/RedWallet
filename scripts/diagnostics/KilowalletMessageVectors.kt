// Offline generator; uses unmodified Kilowallet source at the commit recorded below.
// All keys here are disposable public test constants. Never use them for funds.
import com.kilombino.pyblockwatch.coinjoin.Nip44
import com.kilombino.pyblockwatch.coinjoin.NostrEvent
import com.kilombino.pyblockwatch.crypto.Hashes
import com.kilombino.pyblockwatch.crypto.Hashes.toHex
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger

fun main() {
    val creator = BigInteger.ONE
    val pool = BigInteger.valueOf(2)
    val join = BigInteger.valueOf(3)
    val creatorPub = NostrEvent.pubOf(creator)
    val poolPub = NostrEvent.pubOf(pool)
    val joinPub = NostrEvent.pubOf(join)
    val vectors = JSONArray()
    for (length in listOf(1, 31, 32, 33, 63, 64, 65, 255, 256, 257, 1024)) {
        val text = "a".repeat(length)
        val key = Nip44.conversationKey(creator, Hashes.hexToBytes(joinPub))
        val nonce = ByteArray(32) { length.toByte() }
        val ciphertext = Nip44.encrypt(text, key, nonce)
        check(Nip44.decrypt(ciphertext, Nip44.conversationKey(join, Hashes.hexToBytes(creatorPub))) == text)
        vectors.put(JSONObject().put("length", length).put("plaintext", text).put("nonce", nonce.toHex()).put("key", key.toHex()).put("ciphertext", ciphertext))
    }
    val messages = JSONArray()
    val bodies = listOf(
        JSONObject().put("type", "welcome").put("pool_secret", pool.toString(16)).put("token", "11".repeat(32)).put("seq", 1),
        JSONObject().put("type", "roster").put("seats", JSONArray()).put("seq", 2),
        JSONObject().put("type", "vote_open").put("by", "22".repeat(32)).put("seq", 3),
        JSONObject().put("type", "blind_sig").put("sigs", JSONArray(listOf("aa", "bb"))).put("seq", 4)
    )
    for ((index, body) in bodies.withIndex()) {
        val recipient = if (index == 0) joinPub else poolPub
        val text = body.toString()
        val encrypted = Nip44.encrypt(text, Nip44.conversationKey(creator, Hashes.hexToBytes(recipient)), ByteArray(32) { (index + 1).toByte() })
        val event = NostrEvent.sign(creator, 2023, listOf(listOf("p", recipient)), encrypted, 10000)
        check(event.verify())
        messages.put(JSONObject().put("body", body).put("event", event.toJson()))
    }
    println(JSONObject().put("upstreamCommit", "233733def7e492084f4d57e5faa1d76b9ab2ce79").put("creator", creatorPub).put("pool", poolPub).put("join", joinPub).put("encryption", vectors).put("messages", messages).toString(2))
}
