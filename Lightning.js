const fs = require('node:fs')
const path = require('node:path')
const util = require('node:util')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const protoDir = __dirname

const defaultOpts = {
	keepCase: true,
	longs: String,
	enums: String,
	default: true,
	oneofs: true
}

const protoMap = {}

process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'

function autoload () {
	let base = path.resolve(protoDir, 'lnrpc')
	let files = fs.readdirSync(base, { recursive: true, withFileTypes: true })
	let regex = /\.proto$/

	for (let f of files) {
		if (f.isDirectory() || f.name[0] === '.' || !regex.test(f.name))
			continue

		let name = f.name.replace(regex, '')

		protoMap[name] = {
			rpc: path.basename(f.parentPath),
			file: path.resolve(f.parentPath, f.name)
		}
	}
}

autoload()

module.exports = class Lightning {
	host
	opts
	sslCreds
	credentials

	_loaded = {}

	constructor (host, cert, macaroon, opts = {}) {
		this.host = host
		this.opts = { ...defaultOpts, ...opts }

		if (typeof macaroon === 'string')
			macaroon = fs.readFileSync(macaroon)

		if (typeof cert === 'string')
			cert = fs.readFileSync(cert)

		this.sslCreds = grpc.credentials.createSsl(cert)

		if (macaroon) {
			let macaroonHex = macaroon.toString('hex')
			let macaroonCreds = grpc.credentials.createFromMetadataGenerator(function (args, callback) {
				let metadata = new grpc.Metadata()

				metadata.add('macaroon', macaroonHex)
				callback(null, metadata)
			})

			this.credentials = grpc.credentials.combineChannelCredentials(this.sslCreds, macaroonCreds)
		}

		return new Proxy(this, {
			get (target, prop, receiver) {
				if (target[prop])
					return target[prop]

				if (!protoMap[prop])
					return

				let protoList = [ protoMap['lightning'].file ]

				if (prop !== 'lightning')
					protoList.push(protoMap[prop].file)

				let definition = protoLoader.loadSync(protoList, target.opts)
				let rpc = grpc.loadPackageDefinition(definition)[protoMap[prop].rpc]
				let service = Object.keys(rpc).filter(v => rpc[v].service).pop()

				if (!service)
					return

				target._loaded[prop] = new rpc[service](target.host, target.credentials || target.sslCreds)
				target._loaded[prop]._promisified = {}

				return target[prop] = new Proxy(target._loaded[prop], {
					get (innerTarget, innerProp, innerReceiver) {
						if (typeof innerTarget[innerProp] !== 'function')
							return innerTarget[innerProp]
 
						if (innerTarget[innerProp].responseStream)
							return function (...args) {
								if (args.length === 0)
									args.push({})

								return innerTarget[innerProp](...args)
							}

						if (innerTarget._promisified[innerProp])
							return innerTarget._promisified[innerProp]

						return innerTarget._promisified[innerProp] = function (...args) {
							if (args.length === 0)
								args.push({})

							return new Promise((resolve, reject) => {
								innerTarget[innerProp](...args, (err, res) => {
									if (err)
										return reject(err)

									resolve(res)
								})
							})
						}
					}
				})
			}
		})
	}
}
