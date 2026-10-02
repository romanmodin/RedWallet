/* These keys belong only to the local test server and hold no wallet funds. */
const fs = require("fs");
const path = require("path");
const net = require("net");
const tls = require("tls");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

describe("patched Electrum TLS authentication", () => {
  let directory;
  let Client;
  const fixture = (name) =>
    fs.readFileSync(path.join(__dirname, "../fixtures/tls", name));
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(__dirname, "../../.tls-test-"));
    const destination = path.join(directory, "node_modules/electrum-client");
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(
      path.dirname(require.resolve("electrum-client/package.json")),
      destination,
      { recursive: true },
    );
    if (
      fs
        .readFileSync(path.join(destination, "lib/client.js"), "utf8")
        .includes("rejectUnauthorized: false")
    ) {
      execFileSync("patch", [
        "--batch",
        "-p1",
        "-d",
        directory,
        "-i",
        path.join(__dirname, "../../patches/electrum-client+3.1.1.patch"),
      ]);
    }
    Client = createRequire(__filename)(path.join(destination, "lib/client.js"));
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  async function exercise({
    host = "localhost",
    ca,
    cert = "server.pem",
    accepted = false,
  }) {
    let requests = 0;
    const sockets = new Set();
    const server = tls.createServer(
      { key: fixture("server.key"), cert: fixture(cert) },
      (socket) => {
        socket.on("data", (data) => {
          requests++;
          const request = JSON.parse(data.toString());
          socket.write(
            JSON.stringify({ id: request.id, result: "authenticated" }) + "\n",
          );
        });
      },
    );
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("tlsClientError", () => {});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const client = new Client(
      net,
      tls,
      server.address().port,
      host,
      "tls",
      ca ? { ca: fixture(typeof ca === "string" ? ca : "ca.pem") } : undefined,
    );
    client.onError = () => {};
    try {
      const connecting = client.connect();
      await expect(client.request("wallet.query", [])).rejects.toThrow(
        "Connection to server lost",
      );
      if (accepted) {
        await connecting;
        await expect(client.request("wallet.query", [])).resolves.toBe(
          "authenticated",
        );
        expect(requests).toBe(1);
      } else {
        await expect(connecting).rejects.toThrow();
        expect(client.status).toBe(0);
        expect(requests).toBe(0);
      }
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("authenticates an explicitly trusted private CA before sending a request", async () => {
    await exercise({ ca: true, accepted: true });
  });
  it("authenticates an explicitly trusted server certificate", async () => {
    await exercise({
      ca: "replacement.pem",
      cert: "replacement.pem",
      accepted: true,
    });
  });
  it("rejects an expired certificate even when it is the trust anchor", async () => {
    await exercise({ ca: "expired.pem", cert: "expired.pem" });
  });
  it("rejects an untrusted certificate without sending a wallet request", async () => {
    await exercise({});
  });
  it("rejects a trusted chain with the wrong server name", async () => {
    await exercise({ ca: true, host: "127.0.0.1" });
  });
  it("rejects an expired certificate even with explicit CA trust", async () => {
    await exercise({ ca: true, cert: "expired.pem" });
  });
  it("rejects a replacement certificate with a matching name and a different issuer", async () => {
    await exercise({ ca: true, cert: "replacement.pem", host: "127.0.0.1" });
  });
  it("uses the React Native secure factory and waits beyond its TCP connect event", async () => {
    const { EventEmitter } = require("events");
    const socket = new EventEmitter();
    for (const method of [
      "setTimeout",
      "setEncoding",
      "setKeepAlive",
      "setNoDelay",
      "end",
      "destroy",
    ])
      socket[method] = () => {};
    socket.write = jest.fn();
    const transport = {
      connectTLS: jest.fn(() => socket),
      connect: jest.fn(() => {
        throw new Error("Plain TCP alias must not be used");
      }),
    };
    const client = new Client(net, transport, 50002, "private.example", "tls");
    const pending = client.connect();
    socket.emit("connect");
    await expect(client.request("wallet.query", [])).rejects.toThrow(
      "Connection to server lost",
    );
    expect(socket.write).not.toHaveBeenCalled();
    expect(transport.connect).not.toHaveBeenCalled();
    expect(transport.connectTLS).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectUnauthorized: true,
        servername: "private.example",
      }),
    );
    socket.emit("secureConnect");
    await pending;
    expect(client.status).toBe(1);
    client.close();
  });
  it("refuses an option that disables authentication", () => {
    expect(
      () =>
        new Client(net, tls, 50002, "localhost", "tls", {
          rejectUnauthorized: false,
        }),
    ).toThrow("forbidden");
  });
});
