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
export interface AddressUtxos {
    utxos: Array<Utxo>;
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
export interface BridgeOperatorStatus {
    isOperator: boolean;
    operatorConfigured: boolean;
}
export type BridgeResult = {
    __kind__: "ok";
    ok: ServerStatus;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_1 = {
    __kind__: "ok";
    ok: RawTransaction;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_2 = {
    __kind__: "ok";
    ok: FeeEstimate;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_3 = {
    __kind__: "ok";
    ok: AddressUtxos;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_4 = {
    __kind__: "ok";
    ok: AddressHistory;
} | {
    __kind__: "err";
    err: BridgeError;
};
export type BridgeResult_5 = {
    __kind__: "ok";
    ok: AddressBalance;
} | {
    __kind__: "err";
    err: BridgeError;
};
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
export interface RawTransaction {
    hex: string;
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
    height: bigint;
    protocolVersion: string;
    checkpointConfigured: boolean;
    serverVersion: string;
    checkpointHeight?: bigint;
    checkpointHash?: string;
}
export interface Utxo {
    height: bigint;
    value: bigint;
    txid: string;
    vout: number;
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
    clearBridgeConfig(): Promise<void>;
    execute(qJson: string): Promise<Result>;
    getAddressBalance(address: string): Promise<BridgeResult_5>;
    getAddressHistory(address: string): Promise<BridgeResult_4>;
    getAddressUtxos(address: string): Promise<BridgeResult_3>;
    getApiDoc(): Promise<string>;
    getBridgeOperatorStatus(): Promise<BridgeOperatorStatus>;
    getBridgeStatus(): Promise<BridgeStatus>;
    getCallerUserRole(): Promise<UserRole>;
    getFeeEstimate(): Promise<BridgeResult_2>;
    getRawTransaction(txid: string): Promise<BridgeResult_1>;
    getServerStatus(): Promise<BridgeResult>;
    isCallerAdmin(): Promise<boolean>;
    schema(): Promise<string>;
    setBridgeConfig(baseUrl: string, secret: string): Promise<void>;
    /**
     * / Recovery/rotation is controller-only. Public login roles confer no power.
     */
    setBridgeOperator(operator: Principal): Promise<void>;
    transformBridgeResponse(args: {
        context: Uint8Array;
        response: HttpRequestResult;
    }): Promise<HttpRequestResult>;
}
