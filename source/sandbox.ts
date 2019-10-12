import { getAddress, getAppConfiguration, provideErc20TokenInformation, signTransaction } from './index'

// source: https://github.com/LedgerHQ/ledger-live-common/blob/master/src/load/tokens/ethereum/erc20.js
const tokensArray = [
	["ethereum","dai_stablecoin_v1_0","DAI",18,"Dai Stablecoin v1.0","304402206f6dfa58551422cc068adc2089dc63818b7269d4f74f047c4bfc1fc98fb67d17022029c3ed5a3d43b1a469d47ddef0107f41532325a4397ded8cc8b8864205c67009","0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359",false,false],
	["ethereum","augur","REP",18,"Augur","3045022100ae8fe2f0e9f2b2ba551277801aea9ca52d064a37e086e4f71020f694ef97b33f022031a5d6ca5545252a34af01e83db83c1ba95918e61da0ca72d7464aad4c8fd9f1","0x1985365e9f78359a9B6AD760e32412f4a445E862",false,false],
	["ethereum","makerdao","MKR",18,"MakerDAO","304402200bca467156035534a4fa8aeafff967b3845fc3cc11f6eea446d283103d8d23f602206eb2e6a90dd67b0bc45a8660ef501c560952c671c32f7394ac23a74191ac4f31","0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",false,false],
] as const
const tokens = tokensArray.reduce((aggregate, [,, symbol, decimals,, signatureHex, addressHex]) => {
	if (aggregate[symbol] !== undefined) console.warn(`Duplicate token ${symbol}.`)
	const signature = uint8ArrayFromHexString(signatureHex)
	const address = uint8ArrayFromHexString(addressHex) as Uint8Array & {length:20}
	aggregate[symbol] = { symbol, decimals, name, signature, address }
	return aggregate
}, {} as { [key: string]: { symbol: string, decimals: number, name: string, signature: Uint8Array, address: Uint8Array & {length:20} } })

let state = 0
async function clickHandler() {
	switch (state) {
		case 0:
			state = 1
			const address = await getAddress()
			const addressString = address.toString(16)
			document.getElementById('address')!.innerText = addressString
			break
		case 1:
			state = 2
			const appConfiguration = await getAppConfiguration()
			document.getElementById('version')!.innerText = `${appConfiguration.majorVersion}.${appConfiguration.minorVersion}.${appConfiguration.patchVersion}`
			break
		case 2:
			state = 0
			const token = tokens['DAI']
			// NOTE: `await` intentionally missing on this call because awaiting it causes Firefox to think that the user interaction chain ends when this call returns. by not awaiting it, we can instead rely on the internal locking system to properly queue this up with the following `signTransaction`, thus causing Firefox to think both APDU calls are part of the same user interaction
			provideErc20TokenInformation(token.symbol, token.address, token.decimals, 1, token.signature)
			const signature = await signTransaction(uint8ArrayFromHexString(`f8aa80850430e2340083030d409489d24a6b4ccb1b6faa2625fe562bdd9a2326035980b844a9059cbb000000000000000000000000${document.getElementById('address')!.innerText}00000000000000000000000000000000000000000000000098a7d9b8314c0000010000`))
			const rString = signature.r.toString(16)
			const sString = signature.s.toString(16)
			const vString = signature.v.toString(16)
			document.getElementById('signature')!.innerText = `{ r: "${rString}", s: "${sString}", v: "${vString}" }`
			break
	}
}
(window as any).clickHandler = clickHandler

function uint8ArrayFromHexString(hex: string): Uint8Array {
	const match = /^(?:0x)?([a-fA-F0-9]*)$/.exec(hex)
	if (match === null) throw new Error(`Expected a hex string encoded byte array with an optional '0x' prefix but received ${hex}`)
	const normalized = match[1]
	if (normalized.length % 2) throw new Error(`Hex string encoded byte array must be an even number of charcaters long.`)
	const bytes = new Uint8Array(normalized.length / 2)
	for (let i = 0; i < normalized.length; i += 2) {
		bytes[i / 2] = Number.parseInt(`${normalized[i]}${normalized[i + 1]}`, 16)
	}
	return bytes
}
