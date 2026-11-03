package io.bluewallet.bluewallet.lightning

import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import lndmobile.Callback
import lndmobile.Lndmobile
import lndmobile.RecvStream
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

internal object RegtestNode {
    private var started = false
    private val empty = ByteArray(0)
    private val publicKey = Regex("(02|03)[0-9a-f]{64}")
    private fun host(value: String): String {
        val octets = value.split('.').map { it.toIntOrNull() ?: -1 }
        require(octets.size == 4 && octets.all { it in 0..255 } && octets.joinToString(".") == value)
        require(octets[0] in listOf(10,127) || octets.take(2) == listOf(192,168) || octets[0] == 172 && octets[1] in 16..31)
        return value
    }
    private fun rpc(call: (Callback) -> Unit): Fields {
        val result = CompletableFuture<ByteArray>()
        call(object : Callback {
            override fun onResponse(data: ByteArray?) { result.complete(data ?: empty) }
            override fun onError(error: Exception) { result.completeExceptionally(error) }
        })
        return Fields(result.get(60, TimeUnit.SECONDS))
    }
    private fun dir(context: Context) = File(context.noBackupFilesDir, "XBTLightning-regtest")
    private fun start(context: Context, peer: String) {
        val address = host(peer)
        if (started) return
        val folder = dir(context)
        check(folder.mkdirs() || folder.isDirectory)
        val conf = File(folder, "lnd.conf")
        conf.writeText(listOf("[Application Options]", "nolisten=true", "norest=true", "nobootstrap=true", "tlsdisableautofill=true",
            "[Bitcoin]", "bitcoin.regtest=true", "bitcoin.blake2b-activation-height=150", "bitcoin.node=neutrino",
            "[neutrino]", "neutrino.connect=" + address + ":18444").joinToString("\n"))
        started = true
        rpc { Lndmobile.start("--lnddir=" + folder.path + " --configfile=" + conf.path, it) }
    }
    private fun status(): String {
        if (!started) return "Stopped"
        return when (rpc { Lndmobile.getState(empty, it) }.number(1)) {
            0L -> "Needs setup"; 1L -> "Locked"; 2L -> "Unlocked"; 3L -> "RPC ready"; 4L -> "Running"; 255L -> "Starting"
            else -> error("Invalid wallet state")
        }
    }
    private fun provision(context: Context, restore: Pair<List<ByteArray>, ByteArray>? = null) {
        val state = status()
        val file = File(dir(context), "device-credentials")
        val previous = Recovery.readDevice(file)
        if (state == "Locked" && restore == null) {
            val password = Recovery.decode(requireNotNull(previous).getString("password"))
            rpc { Lndmobile.unlockWallet(message { writeByteArray(1, password) }, it) }
            return
        }
        require(state == "Needs setup")
        val credentials = previous ?: run {
            val words = restore?.first ?: requireNotNull(rpc { Lndmobile.genSeed(empty, it) }.blobs[1])
            require(words.size == 24)
            JSONObject().put("words", Recovery.wordsJson(words)).put("password", Recovery.encode(Recovery.randomBytes(32)))
                .put("pending", restore == null).also { Recovery.storeDevice(file, it) }
        }
        val words = Recovery.words(credentials)
        if (restore != null) require(restore.first.map(Recovery::encode) == words.map(Recovery::encode))
        else require(credentials.getBoolean("pending"))
        val request = message {
            writeByteArray(1, Recovery.decode(credentials.getString("password")))
            words.forEach { writeByteArray(2, it) }
            if (restore != null) {
                writeUInt64(4,2500)
                writeByteArray(5,message { writeByteArray(2,message { writeByteArray(2,restore.second) }) })
            }
        }
        rpc { Lndmobile.initWallet(request,it) }
        Recovery.storeDevice(file, credentials.put("pending",false))
    }
    private fun backup() = Fields(rpc { Lndmobile.exportAllChannelBackups(empty,it) }.bytes(2)).bytes(2).also { require(it.isNotEmpty()) }
    private fun export(context: Context, ext: String, data: ByteArray): String =
        Uri.fromFile(File.createTempFile("RedWallet-regtest-",ext,context.cacheDir).apply { writeBytes(data) }).toString()
    fun recovery(context: Context, action: String, phrase: String, source: String): String = when (action) {
        "export" -> {
            val saved = requireNotNull(Recovery.readDevice(File(dir(context), "device-credentials")))
            export(context,".rwln",Recovery.export(phrase,Recovery.words(saved),backup()))
        }
        "restore" -> {
            require(status() == "Needs setup")
            val uri = Uri.parse(source)
            require(uri.scheme == "file")
            val chosen = File(requireNotNull(uri.path)).canonicalFile
            require(chosen.path.startsWith(context.cacheDir.canonicalPath + "/") && chosen.isFile && chosen.length() in 1..Recovery.LIMIT.toLong())
            provision(context, Recovery.import(phrase,chosen.readBytes()))
            "Recovery submitted."
        }
        else -> error("Unknown recovery operation")
    }
    fun run(context: Context, action: String, peer: String): String = when (action) {
        "status" -> status()
        "start" -> { start(context,peer); status() }
        "setup" -> { provision(context); status() }
        "backup" -> export(context,".backup",backup())
        "fund" -> rpc { Lndmobile.newAddress(message { writeUInt64(1,4) },it) }.string(1).also { require(it.startsWith("bcrt1")) }
        "details" -> {
            val info = rpc { Lndmobile.getInfo(empty,it) }
            val wallet = rpc { Lndmobile.walletBalance(empty,it) }
            val channels = rpc { Lndmobile.channelBalance(empty,it) }
            fun balance(field: Int) = channels.blobs[field]?.firstOrNull()?.let { Fields(it).number(1) } ?: 0
            "Node: " + info.string(1) + "\nChain height: " + info.number(6) + "\nSynced: " + (info.number(9) == 1L) +
                "\nConfirmed funding balance: " + wallet.number(2) + " test sats\nLocal / remote channel balance: " +
                balance(3) + " / " + balance(4) + " test sats\nActive channels: " + info.number(4)
        }
        "history" -> {
            val payments = rpc { Lndmobile.listPayments(message { writeUInt64(1,1); writeUInt64(3,10); writeUInt64(4,1) },it) }
            payments.blobs[1].orEmpty().map(::Fields).joinToString("\n") {
                val label = mapOf(1L to "In flight",2L to "Settled",3L to "Failed",4L to "Initiated")[it.number(10)] ?: "Unknown"
                it.number(7).toString() + " test sats · " + label + " · " + it.string(1).take(12)
            }.ifEmpty { "No outgoing test payments." }
        }
        else -> error("Unknown node operation")
    }
    private fun decode(invoice: String): Fields {
        require(invoice.startsWith("lnbcrt") && invoice.length <= 8192)
        val fields = rpc { Lndmobile.decodePayReq(message { writeString(1,invoice) },it) }
        require(fields.blobs[13].orEmpty().any { Fields(it).number(1) in 512L..513L })
        require(fields.number(3) in 1L..1_000_000L && fields.number(12) == fields.number(3)*1000)
        return fields
    }
    fun invoice(operation: String, value: String, hash: String, sats: String): Any = when (operation) {
        "connect" -> {
            val parts = value.split('@', ':')
            require(parts.size == 3 && publicKey.matches(parts[0]) && parts[2].toInt() in 1..65535)
            val endpoint = host(parts[1]) + ":" + parts[2].toInt()
            val address = message { writeString(1,parts[0]); writeString(2,endpoint) }
            rpc { Lndmobile.connectPeer(message { writeByteArray(1,address); writeUInt64(3,15) },it) }
            "Peer connected."
        }
        "open" -> {
            val amount = sats.toLong()
            require(publicKey.matches(value) && amount in 20_000L..1_000_000L)
            val point = rpc { Lndmobile.openChannelSync(message { writeString(3,value); writeUInt64(4,amount); writeUInt64(1,1); writeUInt64(8,1) },it) }
            val id = point.blobs[1]?.firstOrNull()?.also { require(it.size == 32) }?.reversedArray()?.joinToString("") { "%02x".format(it) } ?: point.string(2)
            id + ":" + point.number(3)
        }
        "receive" -> {
            val amount = sats.toLong()
            require(amount in 1L..1_000_000L)
            rpc { Lndmobile.addInvoice(message { writeUInt64(5,amount); writeUInt64(11,3600); writeUInt64(15,1) },it) }
                .string(2).also { require(it.startsWith("lnbcrt")) }
        }
        "decode" -> decode(value).let { fields -> Arguments.createMap().apply {
            putString("sats",fields.number(3).toString()); putString("hash",fields.string(2)); putString("destination",fields.string(1))
        } }
        "pay" -> {
            val decoded = decode(value)
            require(decoded.string(2) == hash && decoded.number(3) == sats.toLong())
            val result = rpc { callback ->
                Lndmobile.routerSendPaymentV2(message { writeString(5,value); writeUInt64(6,30); writeUInt64(7,10) },object : RecvStream {
                    override fun onError(error: Exception) { callback.onError(error) }
                    override fun onResponse(data: ByteArray?) {
                        try { if (Fields(requireNotNull(data)).number(10) in 2L..3L) callback.onResponse(data) }
                        catch (e: Exception) { callback.onError(e) }
                    }
                })
            }
            require(result.string(1) == hash)
            result.number(10) == 2L
        }
        else -> error("Unknown invoice operation")
    }
}
