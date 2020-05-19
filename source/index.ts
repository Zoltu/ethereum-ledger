import { Semaphore } from './vendor/semaphore-async-await/semaphore'

interface Signature {
	r: bigint
	s: bigint
	v: bigint
}

interface AppConfiguration {
	contractSupport: boolean
	needsExternalTokenInformation: boolean
	majorVersion: number
	minorVersion: number
	patchVersion: number
}

// TODO: better messages
const StatusCodes = {
	pinRemainingAttempts: { message: 'PIN_REMAINING_ATTEMPTS', code: 0x63c0 },
	incorrectLength: { message: 'INCORRECT_LENGTH', code: 0x6700 },
	commandIncompatibleFileStructure: { message: 'COMMAND_INCOMPATIBLE_FILE_STRUCTURE', code: 0x6981 },
	securityStatusNotSatisfied: { message: 'SECURITY_STATUS_NOT_SATISFIED', code: 0x6982 },
	conditionsOfUseNotSatisfied: { message: 'CONDITIONS_OF_USE_NOT_SATISFIED', code: 0x6985 },
	incorrectData: { message: 'INCORRECT_DATA', code: 0x6a80 },
	notEnoughMemorySpace: { message: 'NOT_ENOUGH_MEMORY_SPACE', code: 0x6a84 },
	referencedDataNotFound: { message: 'REFERENCED_DATA_NOT_FOUND', code: 0x6a88 },
	fileAlreadyExists: { message: 'FILE_ALREADY_EXISTS', code: 0x6a89 },
	incorrectP1P2: { message: 'INCORRECT_P1_P2', code: 0x6b00 },
	insNotSupported: { message: 'INS_NOT_SUPPORTED', code: 0x6d00 },
	claNotSupported: { message: 'CLA_NOT_SUPPORTED', code: 0x6e00 },
	technicalProblem: { message: 'TECHNICAL_PROBLEM', code: 0x6f00 },
	ok: { message: 'OK', code: 0x9000 },
	memoryProblem: { message: 'MEMORY_PROBLEM', code: 0x9240 },
	noEfSelected: { message: 'NO_EF_SELECTED', code: 0x9400 },
	invalidOffset: { message: 'INVALID_OFFSET', code: 0x9402 },
	fileNotFound: { message: 'FILE_NOT_FOUND', code: 0x9404 },
	inconsistentFile: { message: 'INCONSISTENT_FILE', code: 0x9408 },
	algorithmNotSupported: { message: 'ALGORITHM_NOT_SUPPORTED', code: 0x9484 },
	invalidKcv: { message: 'INVALID_KCV', code: 0x9485 },
	codeNotInitialized: { message: 'CODE_NOT_INITIALIZED', code: 0x9802 },
	accessConditionNotFulfilled: { message: 'ACCESS_CONDITION_NOT_FULFILLED', code: 0x9804 },
	contradictionSecretCodeStatus: { message: 'CONTRADICTION_SECRET_CODE_STATUS', code: 0x9808 },
	contradictionInvalidation: { message: 'CONTRADICTION_INVALIDATION', code: 0x9810 },
	codeBlocked: { message: 'CODE_BLOCKED', code: 0x9840 },
	maxValueReached: { message: 'MAX_VALUE_REACHED', code: 0x9850 },
	gpAuthFailed: { message: 'GP_AUTH_FAILED', code: 0x6300 },
	licensing: { message: 'LICENSING', code: 0x6f42 },
	halted: { message: 'HALTED', code: 0x6faa },
}


/// ADPU Instructions (https://github.com/LedgerHQ/ledger-app-eth/blob/master/doc/ethapp.asc#general-purpose-apdus)

interface IAdpuInstruction {
	readonly toBytes: () => readonly Uint8Array[]
	readonly parseResult: (result: Uint8Array) => ReturnType<AdpuInstruction['parseResult']>
}

class GetAddressInstruction implements IAdpuInstruction {
	public constructor(
		private readonly derivationPath: string = `m/44'/60'/0'/0/0`,
	) { }
	public readonly toBytes = () => [encodeInstruction(2, 0, 0, derivationPathToBytes(this.derivationPath))]
	public readonly parseResult = (result: Uint8Array): bigint => {
		const publicKeyLength = result[0]
		const publicKeyStart = 1
		const publicKeyEnd = publicKeyStart + publicKeyLength
		// const publicKeyBytes = result.slice(publicKeyStart, publicKeyEnd)
		const addressLength = result[publicKeyEnd]
		if (addressLength !== 40) throw new Error(`Expected a 40 byte address but received ${addressLength} bytes.`)
		const addressStart = publicKeyEnd + 1
		const addressBytes = result.slice(addressStart, addressStart + 40)
		return decodeAsciiAddress(addressBytes as Uint8Array & {length:40})
	}
}

class SignTransactionInstruction implements IAdpuInstruction {
	public constructor(
		private readonly rlpEncodedTransaction: Uint8Array,
		private readonly derivationPath: string = `m/44'/60'/0'/0/0`,
	) { }
	public readonly toBytes = () => chunk(4, new Uint8Array([...derivationPathToBytes(this.derivationPath), ...this.rlpEncodedTransaction]))
	public readonly parseResult = decodeSignature
}

class GetAppConfigurationInstruction implements IAdpuInstruction {
	public readonly toBytes = () => [encodeInstruction(6, 0, 0, new Uint8Array([0, 4]))]
	public readonly parseResult = (result: Uint8Array): AppConfiguration => {
		return {
			contractSupport: Boolean(result[0] & 0x01),
			needsExternalTokenInformation: Boolean(result[0] & 0x02),
			majorVersion: result[1],
			minorVersion: result[2],
			patchVersion: result[3],
		}
	}
}

class SignPersonalMessageInstruction implements IAdpuInstruction {
	public constructor(
		private readonly message: string,
		private readonly derivationPath: string = `m/44'/60'/0'/0/0`,
	) { }
	public readonly toBytes = () => chunk(8, new Uint8Array([...derivationPathToBytes(this.derivationPath), ...encodeString(this.message)]))
	public readonly parseResult = decodeSignature
}

class ProvideErc20TokenInformationInstruction implements IAdpuInstruction {
	public constructor(
		private readonly symbol: string,
		private readonly address: Uint8Array & {length:20},
		private readonly decimals: number,
		private readonly chainId: number,
		private readonly signature: Uint8Array,
	) { }
	public readonly toBytes = () => [encodeInstruction(10, 0, 0, new Uint8Array([...encodeString(this.symbol), ...this.address, ...encodeUint32(this.decimals), ...encodeUint32(this.chainId), ...this.signature]))]
	public readonly parseResult = (): void => { }
}

type AdpuInstruction = GetAddressInstruction | SignTransactionInstruction | SignPersonalMessageInstruction | ProvideErc20TokenInformationInstruction | GetAppConfigurationInstruction


/// ADPU Transport

const scrambleKey = new TextEncoder().encode('w0w')
const lock = new Semaphore(1)

export function scramblePayload(dataUnit: Uint8Array) {
	if (dataUnit.length === 0) return dataUnit;
	const result = new Uint8Array(dataUnit.length);
	for (let i = 0; i < dataUnit.length; i++) {
		result[i] = dataUnit[i] ^ scrambleKey[i % scrambleKey.length];
	}
	return result;
}

async function exchange(dataUnit: Uint8Array): Promise<ArrayBuffer> {
	const credentialRequestOptions: CredentialRequestOptions = {
		publicKey: {
			timeout: 2 * 60 * 1000,
			challenge: new Uint8Array(32),
			allowCredentials: [{
				id: scramblePayload(dataUnit),
				type: 'public-key',
			}],
		}
	}
	const result = await navigator.credentials.get(credentialRequestOptions) as PublicKeyCredential
	if (result === null) throw new Error(`Unexpected error: null result from navigator.credentials.get.`)
	return (result.response as AuthenticatorAssertionResponse).signature
}

async function send<T extends ReturnType<AdpuInstruction['parseResult']>>(instruction: Extract<AdpuInstruction, {parseResult: (_: Uint8Array) => T}>): Promise<T> {
	return await lock.execute(async () => {
		const chunks = instruction.toBytes()
		let result: ArrayBuffer|undefined = undefined
		for (const chunk of chunks) {
			result = await exchange(chunk)
			if (result.byteLength < 2) throw new Error(`Received a response from the ledger that was shorter than expected.  Received length: ${result.byteLength}`)
			const statusCode = new DataView(result).getUint16(result.byteLength - 2, false)
			if (statusCode !== StatusCodes.ok.code) {
				const status = Object.values(StatusCodes).find(x => x.code === statusCode)
				const message = status === undefined ? 'Unknown code' : status.message
				throw new Error(`Received error code 0x${statusCode.toString(16)} from ledger: ${message}`)
			}
		}
		if (result === undefined) throw new Error(`ADPU operation had no data.  This is a bug.`)
		return instruction.parseResult(new Uint8Array(result.slice(0, -2)))
	})
}


/// ADPU encoding/decoding

function chunk(instruction: number, data: Uint8Array): Uint8Array[] {
	const result = []
	for (let i = 0; i < data.length; i += 150) {
		const isFirstChunk = i === 0
		const chunkStart = i
		const chunkEnd = Math.min(data.length, i + 150)
		const chunk = data.slice(chunkStart, chunkEnd)
		result.push(encodeInstruction(instruction, isFirstChunk ? 0x00 : 0x80, 0x00, chunk))
	}
	return result
}

function validateDerivationPath(derivationPath: string): boolean {
	return /^m(?:\/\d+'?)*$/g.test(derivationPath)
}

function encodeString(value: string): Uint8Array {
	const encodedString = new TextEncoder().encode(value)
	if (encodedString.length > 0xff) throw new Error(`String is too long to encode.  ${value}`)
	return new Uint8Array([encodedString.length, ...encodedString])
}

function encodeUint32(value: number): Uint8Array {
	const buffer = new ArrayBuffer(4)
	new DataView(buffer).setUint32(0, value, false)
	return new Uint8Array(buffer)
}

function encodeChunkLength(chunkLength: number): Uint8Array {
	// https://en.wikipedia.org/wiki/Smart_card_application_protocol_data_unit
	if (chunkLength === 0) return new Uint8Array(0)
	if (chunkLength <= 255) return new Uint8Array([chunkLength])
	if (chunkLength === 256) return new Uint8Array([0])
	if (chunkLength <= 65535) return new Uint8Array([0, chunkLength >>> 8, chunkLength & 0xff])
	throw new Error(`Data chunk is too long to ADPU encode.`)
}

function encodeInstruction(instruction: number, parameter1: number, parameter2: number, data: Uint8Array): Uint8Array {
	return new Uint8Array([0xe0, instruction, parameter1, parameter2, ...encodeChunkLength(data.length), ...data])
}

function decodeDerivationPath(derivationPath: string): number[] {
	if (!validateDerivationPath(derivationPath)) throw new Error(`Invalid derivation path ${derivationPath}`);

	const result: number[] = []
	const regularExpression = /\/(\d+'?)/g
	let match = null
	while ((match = regularExpression.exec(derivationPath)) !== null) {
		const hardened = match[1].lastIndexOf(`'`) !== -1
		const index = Number.parseInt(hardened ? match[1].slice(0, -1) : match[1])
		if (index >= 0x80000000) throw new Error(`Invalid derivation path segment ${match[1]} in path ${derivationPath}`)
		result.push(index + (hardened ? 0x80000000 : 0))
	}

	return result
}

function derivationPathToBytes(derivationPath: string): Uint8Array {
	const derivationPathSegments = decodeDerivationPath(derivationPath)
	const dataToWriteBuffer = new ArrayBuffer(1 + derivationPathSegments.length * 4)
	new Uint8Array(dataToWriteBuffer)[0] = derivationPathSegments.length
	for (let i = 0; i < derivationPathSegments.length; ++i) {
		const offset = 1 + i * 4
		const segment = derivationPathSegments[i]
		new DataView(dataToWriteBuffer).setUint32(offset, segment, false)
	}
	return new Uint8Array(dataToWriteBuffer)
}

function decodeSignature(signatureBytes: Uint8Array): Signature {
	if (signatureBytes.length !== 65) throw new Error(`Received a signature that was longer than expected. Actual length: ${signatureBytes.length}; expected length: 65`)
	return {
		v: bytesToInteger(signatureBytes.slice(0, 1)),
		r: bytesToInteger(signatureBytes.slice(1, 33)),
		s: bytesToInteger(signatureBytes.slice(33, 65)),
	}
}

function decodeAsciiAddress(address: Uint8Array & {length:40}): bigint {
	const addressAsString = new TextDecoder().decode(address)
	return BigInt(`0x${addressAsString}`)
}

function bytesToInteger(bytes: Uint8Array) {
	let value = 0n
	for (let byte of bytes) {
		value = (value << 8n) + BigInt(byte)
	}
	return value
}


/// Public API

export async function getAddress(derivationPath?: string): Promise<bigint> {
	const instruction = new GetAddressInstruction(derivationPath)
	return await send(instruction)
}

export async function signTransaction(rlpEncodedTransaction: Uint8Array, derivationPath?: string): Promise<Signature> {
	const instruction = new SignTransactionInstruction(rlpEncodedTransaction, derivationPath)
	return await send(instruction)
}

export async function signMessage(message: string, derivationPath?: string): Promise<Signature> {
	const instruction = new SignPersonalMessageInstruction(message, derivationPath)
	return await send(instruction)
}

export async function provideErc20TokenInformation(symbol: string, address: Uint8Array & {length:20}, decimals: number, chainId: number, signature: Uint8Array): Promise<void> {
	const instruction = new ProvideErc20TokenInformationInstruction(symbol, address, decimals, chainId, signature)
	return await send(instruction)
}

export async function getAppConfiguration(): Promise<AppConfiguration> {
	const instruction = new GetAppConfigurationInstruction()
	return await send(instruction)
}
