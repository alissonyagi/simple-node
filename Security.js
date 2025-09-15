const crypto = require('node:crypto')
const querystring = require('node:querystring')
const jose = require('jose')
const base32 = require('hi-base32')
const hotp = require('hotp')
const Strings = require('./Strings')
const Message = require('./Message')
const JSONSchema = require('./JSONSchema')

const str = new Strings('main/Security')
const jsonSchema = new JSONSchema(__dirname + '/json-schema')

const defaultProperty = 'signature'
const defaultAlgorithm = 'RS256'

const schemas = {
	otp: jsonSchema.load('Security.OTP')
}

module.exports = class Security {
	#keychain

	constructor (keychain) {
		this.#keychain = {
			privateKey: keychain.privateKey ? crypto.createPrivateKey({ key: keychain.privateKey, passphrase: keychain.passphrase }) : null,
			publicKey: keychain.publicKey ? crypto.createPublicKey(keychain.publicKey) : null,
			algorithm: keychain.algorithm || defaultAlgorithm
		}

		if (!this.#keychain.privateKey && !this.#keychain.publicKey)
			throw str.error('no-keys-specified')
	}

	async sign (obj, prop = defaultProperty) {
		try {
			let json = JSON.stringify(obj)
			let ret = JSON.parse(json)

			let buf = Buffer.from(json)
			let key = this.#keychain.privateKey ? this.#keychain.privateKey : this.#keychain.publicKey
			let header = {
				alg: this.#keychain.algorithm
			}

			let encoded = await new jose.FlattenedSign(buf).setProtectedHeader(header).sign(key)

			ret[prop] = encoded.protected + '..' + encoded.signature

			return ret
		}
		catch (e) {
			throw str.error('signing-failed', null, { error: e })
		}
	}

	async verify (obj, ignore = [], prop = defaultProperty) {
		try {
			if (!(ignore instanceof Array))
				ignore = []

			ignore.push(prop)

			let validate = JSON.parse(JSON.stringify(obj))

			ignore.forEach(v => delete validate[v])

			let parts = obj.signature.split('.')
			let buf = Buffer.from(JSON.stringify(validate))

			let encoded = {
				protected: parts[0],
				payload: buf.toString('base64url'),
				signature: parts[2]
			}

			let key = this.#keychain.publicKey ? this.#keychain.publicKey : this.#keychain.privateKey

			let decoded = await jose.flattenedVerify(encoded, key)

			return decoded.payload ? true : false
		}
		catch (e) {
			throw str.error('verification-failed', null, { error: e })
		}
	}

	static OTP = class OTP {
		issuer
		account
		type
		algorithm
		digits
		secret
		counter
		period

		static fromURI (uri) {
			let url

			try {
				url = new URL(uri)
			}
			catch (e) {
				throw str.error('otp-invalid-uri', null, { error: e })
			}

			if (url.protocol !== 'otpauth:')
				throw str.error('otp-invalid-protocol', null, { protocol: url.protocol })

			let parts = url.pathname.substring(1).replace('%3A', ':').split(':')
			let query = querystring.parse(url.search.substring(1))

			let opts = {
				issuer: parts.length > 1 ? parts[0] : 'default',
				account: parts.length > 1 ? parts[1] : parts[0],
				type: url.host,
				algorithm: typeof query.algorithm === 'string' ? query.algorithm.toLowerCase() : null,
				digits: query.digits ? parseInt(query.digits) : null,
				secret: query.secret
			}

			if (query.counter)
				opts.counter = parseInt(query.counter)

			if (query.period)
				opts.period = parseInt(query.period)

			return new OTP(opts)
		}

		constructor (opts = {}) {
			if (!schemas.otp(opts))
				throw str.error('otp-invalid-option', null, { opts: opts, error: schemas.otp.errors })

			Object.defineProperties(this, {
				issuer: {
					enumerable: true,
					value: opts.issuer
				},
				account: {
					enumerable: true,
					value: opts.account
				},
				type: {
					enumerable: true,
					value: opts?.type || 'hotp'
				},
				algorithm: {
					enumerable: true,
					value: opts?.algorithm || 'sha256'
				},
				digits: {
					enumerable: true,
					value: opts?.digits || 6
				},
				secret: {
					enumerable: true,
					value: opts?.secret || base32.encode(crypto.randomBytes(20).toString('hex'))
				}
			})

			switch (this.type) {
				case 'hotp':
					Object.defineProperty(this, 'counter', {
						enumerable: true,
						value: opts?.counter || 0
					})
					break
				case 'totp':
					Object.defineProperty(this, 'period', {
						enumerable: true,
						value: opts?.period || 30
					})
					break
				default:
			}
		}

		get uri () {
			let query = {
				secret: this.secret,
				issuer: this.issuer,
				algorithm: this.algorithm.toUpperCase(),
				digits: this.digits
			}

			switch (this.type) {
				case 'hotp':
					query.counter = this.counter
					break
				case 'totp':
					query.period = this.period
					break
				default:
			}

			return 'otpauth://' + this.type + '/' + encodeURIComponent(this.issuer) + ':' + encodeURIComponent(this.account) + '?' + querystring.stringify(query)
		}

		export () {
			let obj = {
				issuer: this.issuer,
				account: this.account,
				type: this.type,
				algorithm: this.algorithm,
				digits: this.digits,
				secret: this.secret,
				uri: this.uri
			}

			if (typeof this.counter !== 'undefined')
				obj.counter = this.counter

			if (typeof this.period !== 'undefined')
				obj.period = this.period

			return obj
		}

		verify (token, step = 0) {
			if (typeof token !== 'string' || token.length === 0)
				throw str.error('otp-invalid-token', null, { token: token })

			if (typeof step !== 'number' || step < 0 || parseInt(step) !== step)
				throw str.error('otp-invalid-step', null, { step: step })

			let secret = base32.decode(this.secret)
			let cur

			switch (this.type) {
				case 'hotp':
					cur = hotp(secret, this.counter + step, { algorithm: this.algorithm, digits: this.digits })
					break
				case 'totp':
					cur = hotp.totp(secret, { algorithm: this.algorithm, digits: this.digits, timeStep: this.period, time: (Date.now() / 1000) + step * this.period })
					break
				default:
					cur = false
			}

			return token === cur
		}
	}
}
