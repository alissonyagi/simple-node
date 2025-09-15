const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const Logger = require('./Logger')
const Strings = require('./Strings')
const Util = require('./Util')

let projectPath = require.main.path

process.chdir(projectPath)

if (projectPath === __dirname)
	projectPath = '..'

let baseObj = {
	project: {
		path: projectPath,
	},
	log: {
		level: Logger.ALL,
		verbose: false,
		format: '[{level}] {date:iso-read} {message}'
	},
	general: {
		language: 'en_US'
	}
}

let base = JSON.parse(JSON.stringify(baseObj))

let complement
let customConfig

try {
	customConfig = require.resolve(path.resolve(projectPath, 'config'))
}
catch (e) {
	complement = {}
}

if (customConfig) {
	let complementObj = require(customConfig)

	complement = JSON.parse(JSON.stringify(complementObj))
}

const config = Util.merge(base, complement, true)

Logger.setDefault(config.log)
Strings.setDefault({ language: config.general?.language, path: config.project?.path })

module.exports = config

if (customConfig)
	require.cache[customConfig].exports = config
