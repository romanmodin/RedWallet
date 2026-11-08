package io.bluewallet.bluewallet.lightning

import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import lndmobile.Lndmobile
import lndmobile.RecvStream
import java.util.UUID

// Called on the bridge's single worker; confirmation consumes the immutable
// review before any RPC, including when a broadcast times out.
internal object NodeManagement {
    private data class Review(val token: String, val address: String, val sats: Long, val fee: Long, val created: Long)
    private var review: Review? = null
    private val closing = mutableSetOf<String>()
    private fun channels() = RegtestNode.rpc { Lndmobile.listChannels(ByteArray(0),it) }.blobs[11].orEmpty().map(::Fields)
    fun run(action: String, value: String, sats: String, feeRate: String): Any = when (action) {
        "channels" -> Arguments.createArray().apply {
            channels().forEach { channel -> pushMap(Arguments.createMap().apply {
                putString("point",channel.string(3)); putString("peer",channel.string(2))
                putBoolean("active",channel.number(1) == 1L); putString("localSats",channel.number(6).toString())
            }) }
        }
        "channelStatus" -> {
            val pending = RegtestNode.rpc { Lndmobile.pendingChannels(ByteArray(0),it) }
            val open = RegtestNode.rpc { Lndmobile.listChannels(ByteArray(0),it) }
            Arguments.createArray().apply {
                ChannelStatus.decode(open, pending).forEach { channel -> pushMap(Arguments.createMap().apply {
                    putString("point",channel.point); putString("peer",channel.peer)
                    putString("state",channel.state); putBoolean("active",channel.state == "active")
                    putString("localSats",channel.localSats.toString())
                    channel.confirmationsRemaining?.let { putDouble("confirmationsRemaining",it.toDouble()) }
                }) }
            }
        }
        "withdrawReview" -> {
            RegtestNode.requireSynced()
            val amount = sats.toLong(); val fee = feeRate.toLong()
            require(value.startsWith(MainnetConfiguration.addressPrefix) && value.length <= 90 && value.all { it in 'a'..'z' || it in '0'..'9' })
            require(LightningAmounts.valid(amount) && LightningAmounts.validFeeRate(fee))
            val item = Review(UUID.randomUUID().toString(),value,amount,fee,SystemClock.elapsedRealtime())
            review = item
            Arguments.createMap().apply {
                putString("token",item.token); putString("address",item.address)
                putString("sats",item.sats.toString()); putString("feeRate",item.fee.toString())
            }
        }
        "withdraw" -> {
            val item = requireNotNull(review)
            require(value == item.token)
            review = null
            require(SystemClock.elapsedRealtime() - item.created in 0L..119999L)
            RegtestNode.requireSynced()
            RegtestNode.rpc { Lndmobile.sendCoins(message {
                writeString(1,item.address); writeUInt64(2,item.sats); writeUInt64(4,item.fee)
                writeString(7,"RedWallet withdrawal " + item.token); writeUInt64(8,1)
            },it) }.string(1)
        }
        "close" -> {
            val fee = feeRate.toLong()
            require(LightningAmounts.validFeeRate(fee) && value !in closing)
            RegtestNode.requireSynced()
            require(channels().any { it.string(3) == value })
            val parts = value.split(':')
            require(parts.size == 2 && Regex("[a-f0-9]{64}").matches(parts[0]))
            val index = parts[1].toLong(); require(index in 0L..4294967295L)
            val point = message { writeString(2,parts[0]); writeUInt64(3,index) }
            closing.add(value)
            val result = RegtestNode.rpc { callback ->
                Lndmobile.closeChannel(message { writeByteArray(1,point); writeUInt64(6,fee); writeUInt64(7,fee * 3) },object : RecvStream {
                    override fun onError(error: Exception) { callback.onError(error) }
                    override fun onResponse(data: ByteArray?) {
                        try {
                            val pending = Fields(requireNotNull(data)).blobs[1]?.firstOrNull() ?: return
                            val txid = Fields(pending).bytes(1).also { require(it.size == 32) }
                            // Use a normal protobuf wrapper for the single-shot RPC helper.
                            callback.onResponse(message { writeByteArray(1,txid) })
                        } catch (e: Exception) { callback.onError(e) }
                    }
                })
            }
            result.bytes(1).reversedArray().joinToString("") { "%02x".format(it) }
        }
        "history" -> {
            val response = RegtestNode.rpc { Lndmobile.getTransactions(ByteArray(0),it) }
            response.blobs[1].orEmpty().takeLast(20).map(::Fields).joinToString("\n") {
                "${it.number(2)} ${MainnetConfiguration.units} · ${it.number(3)} confirmations · ${it.string(1)}"
            }.ifEmpty { "No on-chain transactions." }
        }
        else -> error("Unknown node management operation")
    }
}
