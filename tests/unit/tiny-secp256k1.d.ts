declare module 'tiny-secp256k1' {
  const ecc: {
    verify(messageHash: Uint8Array, publicKey: Uint8Array, signature: Uint8Array): boolean;
    sign(messageHash: Uint8Array, privateKey: Uint8Array): Uint8Array;
    pointFromScalar(privateKey: Uint8Array, compressed?: boolean): Uint8Array | null;
  };
  export default ecc;
}
