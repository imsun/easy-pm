const fs = require('fs-promise')
const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const pm2 = require('pm2')
const username = require('username')
const { resolveHome, getAppDir } = require('./utils')
const { configsFile, configsScriptPath, setupScriptPath } = require('./paths')

const isRoot = process.getuid() === 0

module.exports = { setup, addConfig, deleteConfig, startConfig, startAll, deleteAll }

function setup() {
	return username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			return shell.exec(`${rootPrefix} node ${setupScriptPath}`)
		})
}

function addConfig(configPath) {
	return username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			return shell.exec(`${rootPrefix} node ${configsScriptPath} add ${configPath}`)
		})
}

function deleteConfig(configPath) {
	return username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			return shell.exec(`${rootPrefix} node ${configsScriptPath} delete ${configPath}`)
		})
}

function startConfig(configPath) {
	return fs.readFile(configPath, 'utf8')
		.then(configStr => {
			const config = JSON.parse(configStr)
			const root = path.resolve(configPath, '..', resolveHome(config.root))
			const apps = config.apps.map(app => {
				const branch = app.branch || 'master'
				const appPath = path.resolve(root, getAppDir(app))
				const configPathHash = crypto.createHash('sha1').update(configPath).digest('hex')
				app.env = Object.assign({
					epm_name: app.name,
					epm_branch: branch,
					epm_config_path: configPath,
					epm_server_port: config.port || 80,
					PORT: app.port
				}, app.env)
				return Object.assign({
					cwd: appPath,
					script: 'npm',
					args: 'start',
					watch: true
				}, app, {
					name: `${app.name}-${configPathHash}`
				})
			})

			return new Promise((resolve, reject) => {
				pm2.start({ apps }, err => {
					if (err) reject(err)
					else resolve(apps)
				})
			})
		})
}

function startAll() {
	return new Promise((resolve, reject) => {
		pm2.connect(err => {
			if (err) return reject(err)
			resolve()
		})
	})
		.then(() => fs.readFile(configsFile, 'utf8'))
		.then(configsStr => {
			const configPaths = configsStr.split('\n').filter(s => !/^\s*$/.test(s))
			return Promise.all(configPaths.map(configPath => startConfig(configPath)))
				.then(() => {
					pm2.disconnect()
					return configPaths
				})
		})
}

function deleteAll() {
	return new Promise((resolve, reject) => {
		pm2.connect(err => {
			if (err) return reject(err)

			pm2.list((err, apps) => {
				if (err) return reject(err)
				resolve(apps)
			})
		})
	})
		.then(apps => Promise.all(
			apps.filter(app => app.pm2_env.epm_config_path)
				.map(app => new Promise((resolve, reject) => {
					pm2.delete(app.pm_id, err => {
						if (err) return reject(err)
						resolve()
					})
				}))
		))
		.then(() => pm2.disconnect())
}