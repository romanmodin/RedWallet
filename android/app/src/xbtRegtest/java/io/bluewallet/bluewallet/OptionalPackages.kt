package io.bluewallet.bluewallet

import com.facebook.react.ReactPackage

internal fun optionalPackages(): List<ReactPackage> = listOf(io.bluewallet.bluewallet.lightning.LightningPackage())
