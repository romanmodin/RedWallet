export class WalletDescriptor {
  static getDescriptor(fpHex: string, path: string, xpub: string): string {
    switch (true) {
      case path.startsWith("m/84'"):
        return `wpkh([${fpHex.toLowerCase()}/${path.replace('m/', '')}]${xpub}/<0;1>/*)`;
      case path.startsWith("m/86'"):
        return `tr([${fpHex.toLowerCase()}/${path.replace('m/', '')}]${xpub})`;
      default:
        throw new Error('Dont know how to make a descriptor');
    }
  }
}
