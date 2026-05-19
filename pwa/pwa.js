window.sw = function () {}

if ('serviceWorker' in navigator) {
	navigator.serviceWorker.addEventListener('message', function (e) {
		if (!e.data || typeof e.data.type !== 'string')
			return

		var evt = new CustomEvent('sw-' + e.data.type, {
			detail: e.data.payload
		})

		window.dispatchEvent(evt)
	})

	navigator.serviceWorker.addEventListener('controllerchange', function () {
		window.location.reload()
	})

	navigator.serviceWorker.register('/pwa-sw.js').then(function (registration) {
		console.log('[sw-registered]')

		registration.addEventListener('updatefound', function () {
			console.log('[sw-update-found]')
		})

	}).catch(function (err) {
		console.error('[sw-failed]', err)
	})

	navigator.serviceWorker.ready.then(function (registration) {
		if (!registration.active)
			return

		window.sw = function (type, payload) {
			registration.active.postMessage({ type: type, payload: payload })
		}
	})
}
else {
	console.error('[sw-unsupported]')
	window.location = '/no-cache-' + Date.now() + window.location.pathname
}
