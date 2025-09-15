const cacheName = 'pwa'

async function digest (data) {
	if (typeof data === 'string')
		data = new TextEncoder().encode(data)

	let sha1 = await crypto.subtle.digest('SHA-1', data)
	let buf = new Uint8Array(sha1)
	let hex = []

	for (let i = 0; i < buf.length; i++)
		hex.push(digest.byteHex[buf[i]])

	return hex.join('')
}

digest.byteHex = (() => {
	let ret = []

	for (let i = 0; i <= 255; i++)
		ret.push(i.toString(16).padStart(2, '0'))

	return ret
})()

async function current () {
	let cache = await caches.open(cacheName)
	let items = await cache.matchAll()

	let decoder = new TextDecoder()
	let cacheList = []

	for (let i = 0; i < items.length; i++) {
		let url = new URL(items[i].url).pathname.substr(1)

		if (!url)
			continue

		cacheList.push([url, await digest(await items[i].arrayBuffer())])
	}

	cacheList.sort((a, b) => a[0].localeCompare(b[0]))
	cacheList.push(['.', await digest(JSON.stringify(cacheList))])

	return cacheList
}

async function pwaUpdate () {
	try {
		let cacheList = await current()
		let hash = cacheList.filter(v => v[0] === '.')[0]?.[1] || null

		console.info('[pwa-current-cache]', cacheList)

		let res

		try {
			res = await fetch('/pwa-cache?hash=' + hash)
		}
		catch (e) {
			return console.error('[pwa-cache-unreachable]', e)
		}

		if (res?.status !== 200)
			return console.error('[pwa-cache-fetch-failed]', res.body)

		let list = await res.json()

		if (!list || !(list instanceof Array))
			return console.error('[pwa-invalid-response]', list)

		let main = list.filter(v => v[0] === '.')[0]

		if (list.length === 0 || main?.[1] === hash)
			return await pwaMessage('loaded')

		console.info('[pwa-outdated-items]', list)

		if (main?.[1][0] === '*') {
			await caches.delete(cacheName)
			main[1] = main[1].substring(1)
		}

		let cache = await caches.open(cacheName)
		let count = 1
		let total = list.length - 1

		for (let i = 0; i < list.length; i++) {
			if (list[i][0] === '.')
				continue

			await cache.delete(list[i][0])

			if (list[i][1][0] === '*') {
				await cache.delete('/')
				await cache.add('/')
			}

			if (list[i][1] !== '')
				await cache.add(list[i][0])

			await pwaMessage('progress', { current: count++, total: total, name: list[i][0] })
		}

		console.info('[pwa-cache-updated]')

		await pwaMessage('reload')
	}
	catch (e) {
		console.error('[pwa-cache-failed]', e)
	}
}

async function pwaGet (req) {
	let cached = await caches.match(req)

	if (cached) {
		console.info('[pwa-cache-hit]', req.url)
		return cached
	}

	console.info('[pwa-cache-miss]', req.url)
	return fetch(req)
}

async function pwaMessage (type, data) {
	let list = await self.clients.matchAll({ includeUncontrolled: true })

	if (!list?.length)
		return

	list.forEach(v => v.postMessage({ type: type, data: data }))
}

self.addEventListener('fetch', e => {
	e.respondWith(pwaGet(e.request))
})

self.addEventListener('activate', async e => {
	console.info('[pwa-activated]')
})

self.addEventListener('install', async e => {
	console.info('[pwa-installed]')
	e.waitUntil(pwaUpdate().then(() => self.skipWaiting()))
})

self.addEventListener('message', async e => {
	let type = e.data?.type

	switch (type) {
		case 'update':
			await pwaUpdate()
			break
		case 'clear':
			await caches.delete(cacheName)
			await pwaMessage('reload')
			break
		default:
	}
})