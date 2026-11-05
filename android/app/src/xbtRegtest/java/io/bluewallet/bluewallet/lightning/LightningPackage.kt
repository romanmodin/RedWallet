package io.bluewallet.bluewallet.lightning

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.Executors

class LightningPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(LightningBridge(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

private val nodeThread = Executors.newSingleThreadExecutor()
class LightningBridge(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "XBTLightningBridge"
    private fun submit(promise: Promise, action: () -> Any) {
        nodeThread.execute {
            try { promise.resolve(action()) }
            catch (e: Exception) { promise.reject("xbt_node_failed", if (e is IllegalStateException) e.message ?: "Node operation failed." else "Node operation failed. Check the supplied values, connection and node state.") }
        }
    }
    @ReactMethod fun peer(promise: Promise) = submit(promise) { MainnetConfiguration.savedPeer(context) }
    @ReactMethod fun manage(operation: String, value: String, sats: String, feeRate: String, promise: Promise) =
        submit(promise) { NodeManagement.run(operation, value, sats, feeRate) }
    @ReactMethod fun run(action: String, peer: String, promise: Promise) = submit(promise) { RegtestNode.run(context,action,peer) }
    @ReactMethod fun invoice(operation: String, value: String, hash: String, sats: String, promise: Promise) =
        submit(promise) { RegtestNode.invoice(operation,value,hash,sats) }
    @ReactMethod fun recovery(operation: String, phrase: String, source: String, promise: Promise) =
        submit(promise) { RegtestNode.recovery(context,operation,phrase,source) }
}
