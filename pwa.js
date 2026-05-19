const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const express = require('express')
const config = require('./config')
const Strings = require('./Strings')
const Database = require('./Database')
const Util = require('./Util')

const str = new Strings('main/pwa')

const basePath = path.resolve(__dirname, 'pwa')
const swFile = path.resolve(basePath, 'pwa-sw.js')

const hashList = {}

function sql (file) {
	return fs.readFileSync(path.resolve(__dirname, 'sql', file + '.sql'), { encoding: 'utf8' })
}

function sha1 (data) {
	let hash = crypto.createHash('sha1')

	hash.update(data)

	return hash.digest('hex')
}

async function getFiles (pathname, includes = []) {
	let ret = []
	let files = fs.readdirSync(pathname, { recursive: true, withFileTypes: true })

	for (let f of files) {
		if (f.isDirectory() || f.name[0] === '.')
			continue

		let full = path.resolve(f.parentPath, f.name)
		let relative = path.relative(pathname, full)

		if (full === swFile || pathname !== f.parentPath && includes.length > 0 && includes?.indexOf(relative) === -1)
			continue

		let hash = await fileHash(full)

		hashList[full] = hash

		ret.push([relative, hash])
	}

	return ret
}

async function fileHash (path) {
	let hash = crypto.createHash('sha1')
	let stream = fs.createReadStream(path)

	return new Promise((resolve, reject) => {
		stream.on('data', data => hash.update(data))
		stream.on('end', () => resolve(hash.digest('hex')))
		stream.on('error', () => str.error('hash-failed', { filename: fs.basename(path) }))
	})
}

function setHeaders (res, path, stat) {
	if (res.includeHash)
		res.setHeader('X-PWA-Hash', hashList[path] || '')
}

module.exports = async function (app, opts = {}) {
	let base = {
		root: 'static',
		index: 'index.html',
		database: 'db/pwa.sqlite',
		include: []
	}

	Util.merge(base, opts)

	const rootPath = path.resolve(config.project.path, base.root)
	const dbPath = path.resolve(config.project.path, base.database)

	if (!app?.use || !app?.get)
		throw str.error('invalid-express-object')

	app.use(/^\/no-cache-[0-9]+/, async (req, res, next) => {
		req.noCache = true
		req.originalUrl = req.originalUrl.replace(/^\/no-cache-[0-9]+/, '')

		app._router.handle(req, res, next)
	})

	app.use((req, res, next) => {
		res.includeHash = req.noCache !== true && req.method === 'GET'
		next()
	})

	app.use(express.static(rootPath, { index: base.index, setHeaders }))
	app.use(express.static(basePath, { index: base.index, setHeaders }))

	app.get('/pwa-cache', async (req, res, next) => {
		try {
			let db = new Database(dbPath)
			let hash = req.query.hash && /^[a-f0-9]{40}$/.test(req.query.hash) ? req.query.hash : null
			let last = await db.all(sql('pwa.last'), { $hash: hash })
			let ret = []

			last.forEach(v => {
				let mark = v.tx_status === 'active' && v.tx_file === base.index || hash === null && v.tx_file === '.'
				ret.push([v.tx_file, (mark ? '*' : '') + v.tx_hash])
			})

			ret.sort((a, b) => a[0].localeCompare(b[0]))

			await db.close()

			res.status(200).json(ret)
		}
		catch (e) {
			str.error('cache-list-failed', null, { error: e })
			res.status(500).send()
		}
	})

	str.info('loading-hashes')

	const db = new Database(dbPath)

	await db.run(sql('pwa'));

	const tx = await db.begin()

	let old = await tx.all(sql('pwa.current'))
	let cached = {}

	old.forEach(v => cached[v.tx_file] = v.tx_hash)

	let files = [].concat(await getFiles(basePath, base.include), await getFiles(rootPath))
	let active = {}

	files.forEach(f => {
		active[f[0]] = {
			hash: f[1],
			changed: cached[f[0]] !== f[1]
		}
	})

	let cache = Object.keys(active).map(v => [v, active[v].hash])

	cache.sort((a, b) => a[0].localeCompare(b[0]))

	let hash = sha1(JSON.stringify(cache))

	cache.push(['.', hash])

	active['.'] = {
		hash: hash,
		changed: cached['.'] !== hash
	}

	let update = await tx.prepare(sql('pwa.update'))
	let inactive = old.filter(v => !active[v.tx_file] || active[v.tx_file]?.changed)

	for (let v of inactive) {
		await update.run({ $id: v.id_file_cache, $status: 'inactive' })
		str.info('cache-item-inactivated', { id: v.id_file_cache, file: v.tx_file })
	}

	let insert = await tx.prepare(sql('pwa.insert'))
	let removed = old.filter(v => !active[v.tx_file])
	let changed = cache.filter(v => active[v[0]]?.changed)

	for (let v of removed) {
		await insert.run({ $file: v.tx_file, $hash: v.tx_hash, $status: 'removed' })
		str.info('cache-item-removed', { file: v.tx_file })
	}

	for (let v of changed) {
		await insert.run({ $file: v[0], $hash: v[1], $status: 'active' })
		str.info('cache-item-activated', { file: v[0] })
	}

	await tx.commit()
	await db.close()

	return cache
}
