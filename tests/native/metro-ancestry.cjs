const path = require('path');
const base = require('../../metro.config');
const service = require.resolve('../../class/xbt/separation-service.ts');
const fixture = require.resolve('./mined-ancestry-offline-http.ts');
module.exports = {
  ...base,
  projectRoot: path.resolve(__dirname, '../..'),
  resolver: {
    ...base.resolver,
    resolveRequest(context, name, platform) {
      if (context.originModulePath === service && name === './separation-http') return { type: 'sourceFile', filePath: fixture };
      return base.resolver.resolveRequest(context, name, platform);
    },
  },
};
