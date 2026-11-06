package io.bluewallet.bluewallet.lightning

// Read-only; never infer an active channel from an unconfirmed funding output.
internal data class ChannelStatus(
    val point: String,
    val peer: String,
    val state: String,
    val localSats: Long,
    val confirmationsRemaining: Long? = null
) {
    companion object {
        fun decode(open: Fields, pending: Fields): List<ChannelStatus> {
            val items = mutableMapOf<String, ChannelStatus>()
            open.blobs[11].orEmpty().map(::Fields).forEach { channel ->
                val point = channel.string(3)
                items[point] = ChannelStatus(point,channel.string(2),
                    if (channel.number(1) == 1L) "active" else "inactive",channel.number(6))
            }
            listOf(2 to "pending",3 to "closing",5 to "closing",4 to "forceClosing").forEach { (field,state) ->
                pending.blobs[field].orEmpty().map(::Fields).forEach { wrapper ->
                    val channel = Fields(wrapper.bytes(1))
                    val point = channel.string(2)
                    // Open supersedes pending; closing supersedes open.
                    if (state != "pending" || point !in items) {
                        items[point] = ChannelStatus(point,channel.string(1),state,channel.number(4),
                            if (state == "pending") wrapper.numbers[7] else null)
                    }
                }
            }
            return items.values.sortedBy { it.point }
        }
    }
}
