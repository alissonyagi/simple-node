window.addEventListener('load', function () {
	if (location.pathname !== '/' && sessionStorage.getItem('__pwaLoaded') === 'true')
		return

	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', function (e) {
			var type = typeof e.data !== 'undefined' ? e.data.type : null
			var progressEvent = new Event('progress')

			switch (type) {
				case 'progress':
					progressEvent.data = e.data.data
					window.dispatchEvent(progressEvent)
					break
				case 'reload':
					if (sessionStorage.getItem('__pwaReload') === 'true')
						break
					sessionStorage.setItem('__pwaReload', 'true')
					window.location.reload()
					break
				case 'loaded':
					sessionStorage.setItem('__pwaLoaded', 'true')
					progressEvent.data = { current: 1, total: 1, name: 'pwa.js' }
					window.dispatchEvent(progressEvent)
					break
				default:
			}
		})

		navigator.serviceWorker.startMessages()

		navigator.serviceWorker.register('/pwa-sw.js').then(function () {
			console.info('[sw-registered]')

			if (navigator.serviceWorker.controller)
				navigator.serviceWorker.controller.postMessage({ type: 'update' })
		}).catch(function (err) {
			console.error('[sw-failed]', err)
		})
	}
	else {
		console.error('[sw-unsupported]')
		window.location = '/no-cache-' + Date.now() + '/index.html'
	}
})