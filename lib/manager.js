const fs = require('fs-promise')
const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const pm2 = require('pm2')
const username = require('username')
const { resolveHome, getAppDir, getFreePort } = require('./utils')
const { configsFile, configsScript, setupScript, staticServerScript } = require('./paths')

const isRoot = process.getuid() === 0

module.exports = { setup, getAppsByConfig, addConfig, deleteConfig, startConfig, startAll, deleteAll }

function setup() {
	return username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			return shell.exec(`${rootPrefix} node ${setupScript}`)
		})
}

function getAppsByConfig(configPath) {
	return new Promise((resolve, reject) => {
		pm2.connect(err => {
			if (err) return reject(err)

			pm2.list((err, apps) => {
				if (err) return reject(err)
				resolve(apps.filter(app => app.pm2_env.epm_config_path === configPath))
			})
		})
	})
}

function addConfig(configPath) {
	return username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			return shell.exec(`${rootPrefix} node ${configsScript} add ${configPath}`)
		})
}

function deleteConfig(configPath) {
	return username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			return shell.exec(`${rootPrefix} node ${configsScript} delete ${configPath}`)
		})
}

function startConfig(configPath) {
	return fs.readFile(configPath, 'utf8')
		.then(configStr => {
			const config = JSON.parse(configStr)
			const root = path.resolve(configPath, '..', resolveHome(config.root))

			return Promise.all(config.apps.map(app => {
				const type = app.type || 'node'
				const branch = app.branch || 'master'
				const appPath = path.resolve(root, getAppDir(app))
				const configPathHash = crypto.createHash('sha1').update(configPath).digest('hex')
				let script
				let args

				app.env = Object.assign({
					epm_name: app.name,
					epm_branch: branch,
					epm_config_path: configPath,
					epm_server_port: config.port || 80,
					PORT: app.port
				}, app.env)

				switch (type) {
					case 'node':
						script = 'npm'
						args = 'start'
						break
					case 'static':
						script = staticServerScript
						args = `-r "${app.root || './'}"`
						break
					default:
						return Promise.reject(new Error('unknown type of app'))
				}

				const appConfig = Object.assign({
					script,
					args,
					cwd: appPath,
					watch: true
				}, app, {
					name: `${app.name}-${configPathHash}`
				})

				if (appConfig.env.PORT) {
					return appConfig
				}
				return getFreePort()
					.then(port => {
						appConfig.env.PORT = port
						return appConfig
					})
			}))
		})
		.then(apps => new Promise((resolve, reject) => {
			pm2.start({ apps }, err => {
				if (err) reject(err)
				else resolve(apps)
			})
		}))
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