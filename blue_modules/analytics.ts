// Remote analytics and crash reporting are disabled for RedWallet.
const A = async (_event: string) => {};

A.setOptOut = (_value: boolean) => {};

A.logError = (errorString: string) => {
  console.error(errorString);
};

export default A;
