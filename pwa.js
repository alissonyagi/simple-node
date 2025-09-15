const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const express = require('express')
const config = require('./config')
const Strings = require('./Strings')
const Database = require('./Database')
const Util = require('./Util')

const str = new Strings('main/pwa')

const basePath = __dirname + '/pwa'
const createSQL = fs.readFileSync(__dirname + '/sql/pwa.sql', { encoding: 'utf8' })

async function getFiles (pathname, includes = []) {
	let ret = []
	let files = fs.readdirSync(pathname, { recursive: true, withFileTypes: true })

	for (let f of files) {
		if (f.isDirectory() || f.name[0] === '.')
			continue

		let full = path.resolve(f.parentPath, f.name)
		let relative = path.relative(pathname, full)

		if (pathname !== f.parentPath && includes.length > 0 && includes?.indexOf(relative) === -1)
			continue

		let sha1 = crypto.createHash('sha1')
		let stream = fs.createReadStream(full)

		let hash = await new Promise((resolve, reject) => {
			stream.on('data', data => sha1.update(data))
			stream.on('end', () => resolve(sha1.digest('hex')))
			stream.on('error', () => str.error('hash-failed', { filename: f.name }))
		})

		ret.push([relative, hash])
	}

	return ret
}

module.exports = async function (app, opts = {}) {
	let base = {
		root: 'static',
		index: 'index.html',
		database: 'db/pwa.sqlite',
		include: false
	}

	Util.merge(base, opts)

	let rootPath = path.resolve(config.project.path, base.root)
	let dbPath = path.resolve(config.project.path, base.database)

	if (!app?.use || !app?.get)
		throw str.error('invalid-express-object')

	app.use(/^\/no-cache-[0-9]+/, async (req, res, next) => {
		req.originalUrl = req.originalUrl.replace(/^\/no-cache-[0-9]+/, '')
		app._router.handle(req, res, next)
	})

	app.use(express.static(rootPath, { index: base.index }))
	app.use(express.static(basePath, { index: base.index }))

	app.get('/pwa-cache', async (req, res, next) => {
		try {
			let db = new Database(dbPath)

			let ref = null

			if (req.query.hash && /^[a-f0-9]{40}$/.test(req.query.hash)) {
				let last = await db.get('SELECT ID_FILE_CACHE FROM PWA_FILE_CACHE WHERE TX_FILE = "." AND TX_HASH = $hash ORDER BY DT_CREATION', { $hash: req.query.hash })
				ref = last?.ID_FILE_CACHE || null
			}

			let list = await db.all('SELECT TX_FILE, TX_HASH, VR_STATUS FROM PWA_FILE_CACHE WHERE ($ref IS NULL AND VR_STATUS = "active") OR (VR_STATUS IN ("active", "removed") AND ID_FILE_CACHE > $ref)', { $ref: ref })

			let ret = []

			for (let i = 0; i < list.length; i++) {
				let mark = list[i].TX_FILE === base.index || ref === null && list[i].TX_FILE === '.'
				ret.push([list[i].TX_FILE, list[i].VR_STATUS === 'active' ? (mark ? '*' : '') + list[i].TX_HASH : ''])
			}

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

	let db = new Database(dbPath)

	await db.run(createSQL);

	await db.begin()

	let old = await db.all('SELECT ID_FILE_CACHE, TX_FILE, TX_HASH FROM PWA_FILE_CACHE WHERE VR_STATUS = "active" ORDER BY DT_CREATION')
	let oldCache = {}

	for (let i = 0; i < old.length; i++)
		oldCache[old[i].TX_FILE] = old[i].TX_HASH

	let files = [].concat(await getFiles(basePath, base.include), await getFiles(rootPath))
	let current = {}

	for (let i = 0; i < files.length; i++)
		current[files[i][0]] = {
			hash: files[i][1],
			changed: oldCache[files[i][0]] !== files[i][1]
		}

	let cache = Object.keys(current).map(v => [v, current[v].hash])

	cache.sort((a, b) => a[0].localeCompare(b[0]))

	let sha1 = crypto.createHash('sha1')
	sha1.update(JSON.stringify(cache))
	let hash = sha1.digest('hex')

	cache.push(['.', hash])

	current['.'] = {
		hash: hash,
		changed: oldCache['.'] !== hash
	}

	let update = await db.prepare('UPDATE PWA_FILE_CACHE SET VR_STATUS = $status WHERE ID_FILE_CACHE = $id')
	let inactive = old.filter(v => !current[v.TX_FILE] || current[v.TX_FILE]?.changed)

	for (let i = 0; i < inactive.length; i++) {
		await update.run({ $id: inactive[i].ID_FILE_CACHE, $status: 'inactive' })
		str.info('cache-item-inactivated', { id: inactive[i].ID_FILE_CACHE, file: inactive[i].TX_FILE })
	}

	let insert = await db.prepare('INSERT INTO PWA_FILE_CACHE (TX_FILE, TX_HASH, VR_STATUS) VALUES ($file, $hash, $status)')
	let removed = old.filter(v => !current[v.TX_FILE])
	let changed = cache.filter(v => current[v[0]]?.changed)

	for (let i = 0; i < removed.length; i++) {
		await insert.run({ $file: removed[i].TX_FILE, $hash: removed[i].TX_HASH, $status: 'removed' })
		str.info('cache-item-removed', { file: removed[i][0] })
	}

	for (let i = 0; i < changed.length; i++) {
		await insert.run({ $file: changed[i][0], $hash: changed[i][1], $status: 'active' })
		str.info('cache-item-activated', { file: changed[i][0] })
	}

	await update.close()
	await insert.close()

	await db.commit()
	await db.close()

	return cache
}
