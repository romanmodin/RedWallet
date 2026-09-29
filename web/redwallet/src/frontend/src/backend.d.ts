import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface AddressBalance {
    unconfirmed: bigint;
    confirmed: bigint;
}
export interface AddressHistory {
    entries: Array<HistoryEntry>;
}
export type BridgeError = {
    __kind__: "not_configured";
    not_configured: null;
} | {
    __kind__: "malformed_response";
    malformed_response: string;
} | {
    __kind__: "invalid_input";
    invalid_input: string;
} | {
    __kind__: "backend_unavailable";
    backend_unavailable: string;
};
export type BridgeResult = {
    __kind__: "ok";
    ok: ServerStatus;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_1 = {
    __kind__: "ok";
    ok: FeeEstimate;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_2 = {
    __kind__: "ok";
    ok: AddressHistory;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_3 = {
    __kind__: "ok";
    ok: AddressBalance;
} | {
    __kind__: "err";
    err: BridgeError;
};
export interface BridgeOperatorStatus {
    isOperator: boolean;
    operatorConfigured: boolean;
}
export interface BridgeStatus {
    checkpointConfigured: boolean;
    configured: boolean;
}
export interface Cell {
    value: Value;
    name: string;
}
export type Error_ = {
    __kind__: "FrontendOriginsNotConfigured";
    FrontendOriginsNotConfigured: null;
} | {
    __kind__: "MixedSsoSources";
    MixedSsoSources: {
        otherKeys: Array<string>;
        ssoKeys: Array<string>;
    };
} | {
    __kind__: "Stale";
    Stale: {
        ageNs: bigint;
    };
} | {
    __kind__: "MalformedCandid";
    MalformedCandid: null;
} | {
    __kind__: "AmbiguousAttribute";
    AmbiguousAttribute: {
        field: string;
        sources: Array<string>;
    };
} | {
    __kind__: "NoAttributes";
    NoAttributes: null;
} | {
    __kind__: "UnknownNonce";
    UnknownNonce: null;
} | {
    __kind__: "UntrustedSsoSource";
    UntrustedSsoSource: {
        domain: string;
    };
} | {
    __kind__: "MissingField";
    MissingField: string;
} | {
    __kind__: "FrontendOriginMismatch";
    FrontendOriginMismatch: {
        got: string;
        expected: Array<string>;
    };
};
export interface FeeEstimate {
    satoshisPerKb: bigint;
}
export interface HistoryEntry {
    height: bigint;
    value?: bigint;
    txid: string;
}
export interface HttpHeader {
    value: string;
    name: string;
}
export interface HttpRequestResult {
    status: bigint;
    body: Uint8Array;
    headers: Array<HttpHeader>;
}
export interface Result {
    hasMore: boolean;
    rows: Array<Array<Cell>>;
}
export type Result__1 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: Error_;
};
export interface ServerStatus {
    checkpointHeight?: bigint;
    checkpointHash?: string;
    height: bigint;
    protocolVersion: string;
    checkpointConfigured: boolean;
    serverVersion: string;
}
export type Value = {
    __kind__: "int";
    int: bigint;
} | {
    __kind__: "nat";
    nat: bigint;
} | {
    __kind__: "float";
    float: number;
} | {
    __kind__: "bool";
    bool: boolean;
} | {
    __kind__: "null";
    null: null;
} | {
    __kind__: "text";
    text: string;
};
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    /**
     * / Clears the bridge configuration. Admin-only. After this, every read
     * / returns `#not_configured`.
     */
    clearBridgeConfig(): Promise<void>;
    execute(qJson: string): Promise<Result>;
    /**
     * / Reads an address balance through the bridge.
     */
    getAddressBalance(address: string): Promise<BridgeResult_3>;
    /**
     * / Reads address history through the bridge.
     */
    getAddressHistory(address: string): Promise<BridgeResult_2>;
    /**
     * / Reports only whether a bridge is configured. Never returns the URL or
     * / secret.
     */
    getBridgeStatus(): Promise<BridgeStatus>;
    getBridgeOperatorStatus(): Promise<BridgeOperatorStatus>;
    setBridgeOperator(operator: Principal): Promise<void>;
    getCallerUserRole(): Promise<UserRole>;
    /**
     * / Reads a fee estimate through the bridge. The bridge requires a target
     * / block count in `[1, 1008]`; the canister uses a fixed default.
     */
    getFeeEstimate(): Promise<BridgeResult_1>;
    /**
     * / Reads server/network status through the bridge. Uses the allowlisted
     * / `server.version` method (there is no `server.status` on the bridge). The
     * / checkpoint is reported as unconfigured.
     */
    getServerStatus(): Promise<BridgeResult>;
    isCallerAdmin(): Promise<boolean>;
    schema(): Promise<string>;
    /**
     * / Sets the bridge base URL and deployment secret. Admin-only. The URL must
     * / be HTTPS. Neither value is echoed back.
     */
    setBridgeConfig(baseUrl: string, secret: string): Promise<void>;
    /**
     * / Consensus-safe transform: strips volatile headers so all replicas agree
     * / on the response. The body is passed through unchanged.
     */
    transformBridgeResponse(args: {
        context: Uint8Array;
        response: HttpRequestResult;
    }): Promise<HttpRequestResult>;
}
