declare module 'hyperdht' {
  import { EventEmitter } from 'events'

  // --- KeyPair ---
  export interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }

  // --- Node / Address ---
  export interface Node {
    host: string
    port: number
    id?: Buffer | null
    token?: Buffer | null
  }

  // --- Firewall constants ---
  export interface Firewall {
    UNKNOWN: 0
    OPEN: 1
    CONSISTENT: 2
    RANDOM: 3
  }

  // --- Error constants ---
  export interface ErrorCodes {
    NONE: 0
    ABORTED: 1
    VERSION_MISMATCH: 2
    TRY_LATER: 3
    SEQ_REUSED: 16
    SEQ_TOO_LOW: 17
  }

  // --- Command constants ---
  export interface Commands {
    PEER_HANDSHAKE: 0
    PEER_HOLEPUNCH: 1
    FIND_PEER: 2
    LOOKUP: 3
    ANNOUNCE: 4
    UNANNOUNCE: 5
    MUTABLE_PUT: 6
    MUTABLE_GET: 7
    IMMUTABLE_PUT: 8
    IMMUTABLE_GET: 9
    PLUGIN: 10
  }

  // --- Query result types ---
  export interface LookupResult {
    token: Buffer
    from: Node
    to: Node
    peers: Array<{ publicKey: Buffer; relayAddresses: Node[] }>
    bump: number
  }

  export interface FindPeerResult {
    token: Buffer
    from: Node
    to: Node
    peer: { publicKey: Buffer; relayAddresses: Node[] }
  }

  export interface ImmutableResult {
    token: Buffer
    from: Node
    to: Node
    value: Buffer
  }

  export interface MutableResult {
    token: Buffer
    from: Node
    to: Node
    seq: number
    value: Buffer
    signature: Buffer
  }

  // --- Query (from dht-rpc, used by findPeer / lookup / etc.) ---
  export interface Query extends EventEmitter, AsyncIterable<LookupResult | FindPeerResult | MutableResult | ImmutableResult | null> {
    closestNodes: Node[]
    successes: number
    errors: number
    finished(): Promise<null>
    destroy(): void
  }

  // --- DHT query result node (base) ---
  export interface DhtNode {
    host: string
    port: number
    token?: Buffer
  }

  // --- Server options ---
  export interface ServerOptions {
    firewall?: (remotePublicKey: Buffer, payload: unknown, clientAddress: Node) => boolean | Promise<boolean>
    holepunch?: (remoteFirewall: number, localFirewall: number, remoteAddresses: Node[], localAddresses: Node[]) => boolean | Promise<boolean>
    relayThrough?: Buffer | Buffer[] | (() => Buffer | null) | null
    relayKeepAlive?: number
    pool?: ConnectionPool | null
    shareLocalAddress?: boolean
    reusableSocket?: boolean
    createHandshake?: (keyPair: KeyPair, remotePublicKey: Buffer | null) => unknown
    createSecretStream?: (isInitiator: boolean, rawStream: unknown, opts: object) => unknown
    handshakeClearWait?: number
    onconnection?: (encryptedSocket: SecretStream) => void
  }

  // --- Server class ---
  class Server extends EventEmitter {
    readonly dht: HyperDHT
    readonly target: Buffer | null
    readonly closed: boolean
    readonly suspended: boolean

    listening: boolean
    publicKey: Buffer | null
    relayAddresses: Node[]

    onconnection(encryptedSocket: SecretStream): void

    listen(keyPair?: KeyPair, opts?: object): Promise<Server>
    close(): Promise<void>
    address(): { publicKey: Buffer; host: string; port: number } | null
    suspend(opts?: { log?: (msg: string) => void }): Promise<void>
    resume(): Promise<void>
    refresh(): void
    notifyOnline(): void
  }

  // --- ConnectionPool ---
  class ConnectionPool extends EventEmitter {
    connecting: number
    connections: IterableIterator<unknown>

    has(publicKey: Buffer): boolean
    get(publicKey: Buffer): SecretStream | null
  }

  // --- Stats shape ---
  export interface HyperDhtStats {
    punches: { consistent: number; random: number; open: number }
    relaying: { attempts: number; successes: number; aborts: number }
    queries?: { active: number; total: number }
    requests?: object
    commands?: object
  }

  // --- HyperDHT constructor options ---
  export interface HyperDHTOptions {
    host?: string
    port?: number
    bootstrap?: Node[] | false
    nodes?: Node[]
    seed?: Buffer
    keyPair?: KeyPair
    ephemeral?: boolean
    firewalled?: boolean
    concurrency?: number
    maxSize?: number
    maxAge?: number
    connectionKeepAlive?: number | false
    randomPunchInterval?: number
    deferRandomPunch?: boolean
    filterNode?: (node: Node) => boolean
    maxPingDelay?: number
    sendDownHints?: boolean
    downHintsRateLimit?: number
    quickFirewall?: boolean
    adaptive?: boolean
  }

  // --- HyperDHT class ---
  class HyperDHT extends EventEmitter {
    readonly bootstrapNodes: Node[]
    readonly concurrency: number
    readonly ephemeral: boolean
    readonly firewalled: boolean
    readonly destroyed: boolean
    readonly suspended: boolean
    readonly bootstrapped: boolean
    readonly randomized: boolean
    readonly online: boolean
    readonly degraded: boolean

    readonly defaultKeyPair: KeyPair

    readonly listening: Set<Server>
    readonly rawStreams: { size: number; add(opts: object): unknown; clear(): Promise<void>; [Symbol.iterator](): IterableIterator<unknown> }
    readonly plugins: Map<string, unknown>

    readonly stats: HyperDhtStats

    id: Buffer | null
    host: string | null
    port: number | null
    socket: unknown
    health: unknown

    // connection keep-alive and punch interval settings
    readonly connectionKeepAlive: number
    readonly _randomPunchInterval: number

    // static members
    static DEFAULTS: object
    static BOOTSTRAP: Node[]
    static FIREWALL: Firewall

    static keyPair(seed?: Buffer): KeyPair
    static hash(data: Buffer): Buffer
    static connectRawStream(encryptedStream: SecretStream, rawStream: unknown, remoteId: number): void

    constructor(opts?: HyperDHTOptions)

    // Core connection methods
    connect(remotePublicKey: Buffer | string, opts?: ConnectOptions): SecretStream
    createServer(opts: ServerOptions, onconnection?: (encryptedSocket: SecretStream) => void): Server
    createServer(onconnection: (encryptedSocket: SecretStream) => void): Server
    pool(): ConnectionPool

    // Lifecycle
    resume(opts?: { log?: (msg: string) => void }): Promise<void>
    suspend(opts?: { log?: (msg: string) => void }): Promise<void>
    destroy(opts?: { force?: boolean }): Promise<void>

    // Inherited from dht-rpc
    bind(): Promise<void>
    address(): { address: string; port: number; family: string } | null
    remoteAddress(): { host: string; port: number } | null
    localAddress(): { host: string; port: number } | null
    fullyBootstrapped(): Promise<void>
    addNode(node: { host: string; port: number }): void
    toArray(opts?: { limit?: number }): Node[]
    ping(node: { host: string; port: number }, opts?: object): Promise<unknown>
    findNode(target: Buffer, opts?: object): Query
    session(): unknown

    // HyperDHT-specific peer methods
    findPeer(publicKey: Buffer, opts?: object): Query
    lookup(target: Buffer, opts?: object): Query
    lookupAndUnannounce(target: Buffer, keyPair: KeyPair, opts?: object): Query
    unannounce(target: Buffer, keyPair: KeyPair, opts?: object): Promise<void>
    announce(target: Buffer, keyPair: KeyPair, relayAddresses: Node[], opts?: { clear?: boolean; bump?: number }): Query

    // DHT storage
    immutableGet(target: Buffer, opts?: object): Promise<ImmutableResult | null>
    immutablePut(value: Buffer, opts?: object): Promise<{ hash: Buffer; closestNodes: Node[] }>
    mutableGet(publicKey: Buffer, opts?: { seq?: number; refresh?: (result: MutableResult) => boolean; latest?: boolean }): Promise<MutableResult | null>
    mutablePut(keyPair: KeyPair, value: Buffer, opts?: { seq?: number }): Promise<{ publicKey: Buffer; closestNodes: Node[]; seq: number; signature: Buffer }>

    // Other
    validateLocalAddresses(addresses: { host: string; port: number }[]): Promise<{ host: string; port: number }[]>
    register(name: string, plugin: object): void
  }

  // --- Connect options ---
  export interface ConnectOptions {
    keyPair?: KeyPair
    relayThrough?: Buffer | Buffer[] | (() => Buffer | null)
    relayAddresses?: Node[]
    relayKeepAlive?: number
    reusableSocket?: boolean
    localConnection?: boolean
    fastOpen?: boolean
    pool?: ConnectionPool
    createHandshake?: (keyPair: KeyPair, remotePublicKey: Buffer) => unknown
    createSecretStream?: (isInitiator: boolean, rawStream: unknown, opts: object) => unknown
    holepunch?: boolean | ((remoteFirewall: number, localFirewall: number, remoteAddresses: Node[], localAddresses: Node[]) => boolean)
  }

  // --- SecretStream (from @hyperswarm/secret-stream) ---
  class SecretStream extends EventEmitter {
    publicKey: Buffer
    remotePublicKey: Buffer
    isInitiator: boolean
    encrypted: Buffer | null
    rawStream: unknown | null
    localProtocol: unknown
    remoteProtocol: unknown

    start(rawStream: unknown, opts?: object): void
    destroy(err?: Error): void
    setKeepAlive(keepAlive: number): void
    setTimeout(timeout: number): void
    cork(): void
    uncork(): void
    flush(): Promise<void>
    send(data: Buffer): void
    close(): void
  }

  export default HyperDHT
  export { HyperDHT, Server, ConnectionPool, KeyPair, Node, Query }
}

// --- testnet ---
declare module 'hyperdht/testnet' {
  import HyperDHT from 'hyperdht'

  export interface TestnetOptions {
    host?: string
    port?: number
    bootstrap?: Array<{ host: string; port: number }>
    teardown?: (fn: () => void, opts: { order?: number }) => void
  }

  class Testnet implements Iterable<HyperDHT> {
    nodes: HyperDHT[]
    bootstrap: Array<{ host: string; port: number }>

    createNode(opts?: object): HyperDHT
    destroy(): Promise<void>
    [Symbol.iterator](): Iterator<HyperDHT>
  }

  export default function createTestnet(size?: number, opts?: TestnetOptions): Promise<Testnet>
}
