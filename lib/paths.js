const path = require('path')
const { resolveHome } = require('./utils')
const homeDir = resolveHome('~/.easy-pm')

module.exports = {
	homeDir,
	configsFile: path.resolve(homeDir, './configs'),
	startFlagFile: path.resolve(homeDir, './start_flag'),
	configsScriptPath: path.resolve(__dirname, '../bin/configs.js'),
	setupScriptPath: path.resolve(__dirname, '../bin/setup.js')
}