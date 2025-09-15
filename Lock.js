const fs = require('node:fs')
const path = require('node:path')
const config = require('./config')
const Strings = require('./Strings')

const str = new Strings('Lock')

module.exports = class Lock {
	#secret

	filename
	lockfile
	locked

	constructor (file) {
		this.filename = path.resolve(config.project?.path || __dirname, file)
		this.lockfile = this.filename + '.lock'

		this.lock()
	}

	isLocked () {
		if (!fs.existsSync(this.lockfile))
			return false

		let secret = fs.readFileSync(this.lockfile, { encoding: 'utf8' })

		return secret === this.#secret
	}

	lock () {
		if (fs.existsSync(this.lockfile))
			throw str.error('file-locked')

		this.#secret = Date.now() + '/' + Math.random()

		fs.writeFileSync(this.lockfile, this.#secret)
	}

	unlock () {
		if (!this.isLocked())
			return

		fs.rmSync(this.lockfile)
	}

	writeStream () {
		if (!this.isLocked())
			this.lock()

		return fs.createWriteStream(this.filename)
	}

	write (...args) {
		if (!this.isLocked())
			this.lock()

		fs.writeFileSync(this.filename, ...args)
	}

	copyFrom (src, mode) {
		if (!this.isLocked())
			this.lock()

		fs.copyFileSync(src, this.filename, mode)
	}

	copyTo (dst, mode) {
		let dstLock = new Lock(dst)

		dstLock.copyFrom(this.filename, mode)

		dstLock.unlock()
	}
}
