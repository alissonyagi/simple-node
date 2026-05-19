const cacheName = 'pwa'
const hashHeader = 'X-PWA-Hash'

let pause = false

self.addEventListener('install', event => {
	event.waitUntil(update())
	self.skipWaiting()
})

self.addEventListener('activate', event => {
	event.waitUntil(clients.claim())
})

self.addEventListener('fetch', event => {
	event.respondWith((async () => {
		if (pause === true || event.request.method !== 'GET')
			return await noStore(event.request)

		const cache = await caches.open(cacheName)
		const cached = await cache.match(event.request)

		if (cached) {
			console.debug('[pwa-cache-hit]', event.request.url)
			return cached
		}

		console.debug('[pwa-cache-miss]', event.request.url)

		return await noStore(event.request)
	})())
})

self.addEventListener('message', async event => {
	console.debug('[pwa-message]', event.data)

	switch (event.data.type) {
		case 'pause':
			pause = true
			broadcast('paused')
			break
		case 'resume':
			pause = false
			broadcast('resumed')
			break
		case 'clear':
			pause = true
			await caches.delete(cacheName)
			broadcast('clean')
			break
		case 'update':
			update()
			break
		case 'current':
			broadcast('current', await current())
			break
		default:
			return
	}
})

async function broadcast (type, payload) {
	const clients = await self.clients.matchAll()

	for (let client of clients)
		await client.postMessage({
			type: type,
			payload: payload
		})
}

async function noStore (request) {
	try {
		return await fetch(request, { cache: 'no-store' })
	}
	catch (e) {
		console.error('[pwa-network-fail]', request.url)
		console.error(e)
		throw e
	}
}

async function sha1 (str) {
	const encoder = new TextEncoder()
	const data = encoder.encode(str)
	const buf = await crypto.subtle.digest('SHA-1', data)

	const hash = new Uint8Array(buf)
	const hex = new Array(hash.length)

	for (let i = 0; i < hash.length; i++)
		hex[i] = hash[i].toString(16).padStart(2, '0')

	return hex.join('')
}

async function current () {
	const cache = await caches.open(cacheName)
	const items = await cache.keys()
	const list = []

	for (let item of items) {
		let url = new URL(item.url).pathname.substr(1)

		if (!url)
			return

		let response = await cache.match(item)

		list.push([url, response.headers.get(hashHeader)])
	}

	list.sort((a, b) => a[0].localeCompare(b[0]))
	list.push(['.', await sha1(JSON.stringify(list))])

	return list
}

function main (hashes) {
	let ret = hashes.filter(v => v[0] === '.')
	return ret[0] ? ret[0][1] : ''
}

async function renew (item, isIndex) {
	try {
		const cache = await caches.open(cacheName)

		await cache.delete(item)

		const opts = {
			headers: {
				'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
				'Pragma': 'no-cache',
				'Expires': '0'
			},
			cache: 'no-store'
                }

		let res = await fetch(item, opts)

		if (!res.ok)
			throw new Error({ status: res.status, item: item })

		if (isIndex === true)
			await cache.put('/', res.clone())

		await cache.put(item, res)
	}
	catch (e) {
		console.error('[pwa-cache-renew-failed]', e)
	}
}

async function update () {
	const hashes = await current()
	const hash = main(hashes)

	let list

	try {
		let res = await fetch('/pwa-cache?hash=' + hash + '&ts=' + Date.now())

		if (res.status !== 200)
			throw new Error(res.status)

		list = await res.json()

		if (!list || !(list instanceof Array))
			throw new Error('Response is not a valid JSON array.')
	}
	catch (e) {
		return console.error('[pwa-cache-fetch-failed]', e)
	}

	let last = main(list)

	if (list.length === 0 || last === hash)
		return broadcast('active')

	console.debug('[pwa-outdated-items]', list)

	if (last[0] === '*') {
		await caches.delete(cacheName)
		last = last.substr(1)
	}

	let count = 0
	let total = list.length - 1

	for (let i = 0; i < list.length; i++) {
		if (list[i][0] === '.')
			continue

		await renew(list[i][0], list[i][1][0] === '*')
		await broadcast('progress', { current: ++count, total: total, name: list[i][0] })
	}

	console.debug('[pwa-cache-updated]')

	return broadcast('updated')
}
