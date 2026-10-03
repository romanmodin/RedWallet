/** Restore only PEM armor altered by iOS smart dashes; never modify certificate data. */
export function normalizeCertificatePem(value: string): string {
  return value.replace(/^(?:-----|\u2014\u2014)(BEGIN|END) CERTIFICATE(?:-----|\u2014\u2014)(\r?)$/gm, '-----$1 CERTIFICATE-----$2');
}
