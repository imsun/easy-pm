const path = require('path')
const { resolveHome } = require('./utils')
const homeDir = resolveHome('~/.easy-pm')

module.exports = {
	homeDir,
	configsDir: path.resolve(homeDir, './configs'),
	configsFile: path.resolve(homeDir, './config_paths'),
	startFlagFile: path.resolve(homeDir, './start_flag'),
	configsScript: path.resolve(__dirname, '../bin/configs.js'),
	setupScript: path.resolve(__dirname, '../bin/setup.js'),
	staticServerScript: path.resolve(__dirname, '../task/staticServer.js')
}