// Offline process bridge: actual Hermes participant <-> actual Kotlin creator.
// No network, wallet storage, transaction signer, or broadcasting endpoint.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const esbuild = require(process.env.REDWALLET_ESBUILD_MODULE || 'esbuild');
const root = path.resolve(__dirname, '../..');
const hermes = process.env.REDWALLET_HERMES_BIN;
const kotlinClasspath = process.env.REDWALLET_KOTLIN_CLASSPATH;
const resultPath = process.argv[2];
const stress = process.argv[3] === '--stress';
if (process.argv[3] && !stress) throw new Error('Only optional argument supported: --stress');
if (!hermes || !kotlinClasspath || !resultPath)
  throw new Error('Set REDWALLET_HERMES_BIN and REDWALLET_KOTLIN_CLASSPATH; supply result JSON path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'redwallet-hermes-dialogue-'));
const options = { absWorkingDir: root, bundle: true, platform: 'browser', target: 'es2020', format: 'iife', write: false };
const globals = esbuild.buildSync({
  ...options,
  stdin: {
    resolveDir: root,
    contents:
      "globalThis.global = globalThis; globalThis.Buffer = require('buffer/').Buffer; globalThis.TextEncoder = require('text-encoding').TextEncoder; globalThis.TextDecoder = require('text-encoding').TextDecoder;",
  },
}).outputFiles[0].text;
const bundle = esbuild.buildSync({ ...options, entryPoints: ['scripts/diagnostics/hermes-kilowallet-dialogue.ts'] }).outputFiles[0].text;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bundleSha256 = hash(bundle);
const globalsSha256 = hash(globals);
const entrySha256 = hash(fs.readFileSync(path.join(root, 'scripts/diagnostics/hermes-kilowallet-dialogue.ts')));
const kotlin = request =>
  JSON.parse(
    execFileSync('java', ['-cp', kotlinClasspath, 'KilowalletSessionHarnessKt'], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
const results = [];
const startedAt = new Date().toISOString();
for (const type of ['p2wpkh', 'p2tr']) {
  for (const peers of stress ? [5] : [2, 5]) {
    for (const outputs of stress ? [5] : [1, 2, 5]) {
      const id = `${type}-${peers}-${outputs}`;
      const setup = kotlin({
        command: 'setup',
        outputs,
        script: type,
        maxPeers: peers,
        amount: peers === 5 ? 3000000 : 1000000,
        retainSeedMembers: true,
      });
      const fixture = { setup, type, peers, outputs, stress, now: Math.floor(Date.now() / 1000), replies: [] };
      const transcript = [];
      let result;
      for (let step = 0; step < 12; step++) {
        const scriptPath = path.join(temp, id + '.js');
        fs.writeFileSync(scriptPath, globals + '\nglobalThis.__fixture=' + JSON.stringify(fixture) + ';\n' + bundle);
        const raw = execFileSync(hermes, [scriptPath], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
        const message = JSON.parse(raw.trim());
        if (!message.pending) {
          result = message;
          break;
        }
        if (message.exchange !== fixture.replies.length + 1 || message.requestHash !== hash(JSON.stringify(message.request)))
          throw new Error('Bridge request integrity failed');
        const reply = kotlin(message.request);
        transcript.push({ request: message.request, reply });
        fixture.replies.push({ requestHash: message.requestHash, reply });
      }
      if (!result) throw new Error('Exceeded bounded dialogue exchanges');
      const transcriptPath = path.join(temp, id + '.json');
      fs.writeFileSync(transcriptPath, JSON.stringify({ fixture, transcript }, null, 2) + '\n');
      result.transcriptSha256 = hash(fs.readFileSync(transcriptPath));
      results.push(result);
      console.log(
        JSON.stringify({
          case: id,
          ok: result.ok,
          phase: result.finalPhase || result.phase,
          error: result.error,
          checks: result.checks.length,
        }),
      );
      fs.writeFileSync(
        resultPath,
        JSON.stringify(
          {
            startedAt,
            checkedAt: new Date().toISOString(),
            hermesSha256: hash(fs.readFileSync(hermes)),
            bundleSha256,
            globalsSha256,
            entrySha256,
            transcriptDirectory: temp,
            results,
          },
          null,
          2,
        ) + '\n',
      );
    }
  }
}
if (results.some(result => !result.ok)) process.exitCode = 1;
