Error._prepareStackTrace = Error.prepareStackTrace

Error.prepareStackTrace = function (err, stackTrace) {
	err.fileStack = stackTrace.map(v => v.getFileName()).filter(v => !/^node:internal\//.test(v)).filter((v, k, o) => o[k - 1] !== v).reverse()

	return Error._prepareStackTrace(err, stackTrace)
}

module.exports = function () {
	let e = new Error()

	Error.captureStackTrace(e, module.exports)

	e.stack

	return e.fileStack
}
