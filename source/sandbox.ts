import { getAddress, getAppConfiguration, provideErc20TokenInformation, signTransaction } from './index.js'

// source: https://github.com/LedgerHQ/ledger-live-common/blob/master/src/load/tokens/ethereum/erc20.js
const tokensArray = [
	["ethereum","dai_stablecoin_v1_0","SAI",18,"Dai Stablecoin v1.0","3045022100b97c2d3583b53dbda0b19463a0cf97199dd1ca848fd7d83b6671a9e9ff74d0ec02200c91b8a5077fe982706fee99ddcbdaaaee88dc03ffc7857c0ed99716a48c31a3","0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359",true,true],
	["ethereum","dai_stablecoin_v2_0","DAI",18,"Dai Stablecoin v2.0","3045022100b3aa979633284eb0f55459099333ab92cf06fdd58dc90e9c070000c8e968864c02207b10ec7d6609f51dda53d083a6e165a0abf3a77e13250e6f260772809b49aff5","0x6B175474E89094C44Da98b954EedeAC495271d0F",false,false],
	["ethereum","augur","REP",18,"Augur","3045022100ae8fe2f0e9f2b2ba551277801aea9ca52d064a37e086e4f71020f694ef97b33f022031a5d6ca5545252a34af01e83db83c1ba95918e61da0ca72d7464aad4c8fd9f1","0x1985365e9f78359a9B6AD760e32412f4a445E862",false,false],
	["ethereum","makerdao","MKR",18,"MakerDAO","304402200bca467156035534a4fa8aeafff967b3845fc3cc11f6eea446d283103d8d23f602206eb2e6a90dd67b0bc45a8660ef501c560952c671c32f7394ac23a74191ac4f31","0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",false,false],
	["ethereum","makerdao_","OLD_MKR",18,"MakerDAO","304402203164f08d348ebaab934943632302233ed4d9e42a7ba55ebc1bcaac42419edf53022010e2107f8f0bcf0d09ad3da2b8e582a0f428f9f3c45fb7f559fd51fee6a0b1b5","0xC66eA802717bFb9833400264Dd12c2bCeAa34a6d",true,true],
] as const
const tokens = tokensArray.reduce((aggregate, [,, symbol, decimals, name, signatureHex, addressHex]) => {
	if (aggregate[symbol] !== undefined) console.warn(`Duplicate token ${symbol}.`)
	const signature = uint8ArrayFromHexString(signatureHex)
	const address = uint8ArrayFromHexString(addressHex) as Uint8Array & {length:20}
	aggregate[symbol] = { symbol, decimals, name, signature, address }
	return aggregate
}, {} as { [key: string]: { symbol: string, decimals: number, name: string, signature: Uint8Array, address: Uint8Array & {length:20} } })

let state = 0

function setHighlight() {
	document.getElementById('address')!.parentElement!.style.backgroundColor = 'unset'
	document.getElementById('version')!.parentElement!.style.backgroundColor = 'unset'
	document.getElementById('signature')!.parentElement!.style.backgroundColor = 'unset'
	document.getElementById(state === 0 ? 'address' : state === 1 ? 'version' : 'signature')!.parentElement!.style.backgroundColor = 'yellow'
}
setHighlight()

function reset() {
	state = 0
	document.getElementById('address')!.innerText = ''
	document.getElementById('version')!.innerText = ''
	document.getElementById('signature')!.innerText = ''
	document.getElementById('error')!.innerText = ''
	setHighlight()
}
(window as any).derivationPathChangedHandler = reset

async function clickHandler() {
	try {
		const derivationPath = (document.getElementById('derivation-path')! as HTMLInputElement).value || `m/44'/60'/0'/0/0`
		switch (state) {
			case 0:
				const address = await getAddress(derivationPath)
				const addressString = address.toString(16).padStart(40, '0')
				document.getElementById('address')!.innerText = addressString
				state = 1
				break
			case 1:
				const appConfiguration = await getAppConfiguration()
				document.getElementById('version')!.innerText = `${appConfiguration.majorVersion}.${appConfiguration.minorVersion}.${appConfiguration.patchVersion}`
				state = 2
				break
			case 2:
				const token = tokens['DAI']
				// NOTE: `await` intentionally missing on this call because awaiting it causes Firefox to think that the user interaction chain ends when this call returns. by not awaiting it, we can instead rely on the internal locking system to properly queue this up with the following `signTransaction`, thus causing Firefox to think both APDU calls are part of the same user interaction
				// FIXME: provideErc20TokenInformation seems to be broken.  Need to dig and figure out what changed in Ledger and what I need to do to make this work again
				// provideErc20TokenInformation(token.symbol, token.address, token.decimals, 1, token.signature)
				provideErc20TokenInformation
				token
				const signature = await signTransaction(uint8ArrayFromHexString(`f8aa80850430e2340083030d409489d24a6b4ccb1b6faa2625fe562bdd9a2326035980b844a9059cbb000000000000000000000000${document.getElementById('address')!.innerText}00000000000000000000000000000000000000000000000098a7d9b8314c0000010000`))
				const rString = signature.r.toString(16)
				const sString = signature.s.toString(16)
				const vString = signature.v.toString(16)
				document.getElementById('signature')!.innerText = `{ r: "${rString}", s: "${sString}", v: "${vString}" }`
				state = 0
				break
			}
		setHighlight()
	} catch (error) {
		reset()
		if (typeof error === 'string') {
			document.getElementById('error')!.innerText = error
		} else if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
			document.getElementById('error')!.innerText = error.message
		} else {
			document.getElementById('error')!.innerText = JSON.stringify(error)
		}
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
