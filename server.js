const fs = require('fs-promise')
const http = require('http')
const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const pm2 = require('pm2')
const proxy = require('http-proxy').createProxyServer({})
const username = require('username')
const resolveHome = require('./resolveHome')

const homeDir = resolveHome('~/.easy-pm')
const configsFile = path.resolve(homeDir, './configs')
const startFlagFile = path.resolve(homeDir, './start_flag')

const setupScriptPath = path.resolve(__dirname, './setup.js')
const isRoot = process.getuid() === 0
let rootPrefix = ''
let startFlag = false
let configPaths = []

fs.readFile(startFlagFile, 'utf8')
	.then(flag => {
		startFlag = flag === '1'
		return username()
	})
	.then(name => {
		rootPrefix = isRoot ? `sudo -u ${name}` : ''
		if (startFlag) return
		shell.exec(`${rootPrefix} node ${setupScriptPath}`)
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
	})
	.then(() => fs.readFile(configsFile, 'utf8'))
	.then(configsString => {
		configPaths = configsString.split('\n').filter(s => !/^\s*$/.test(s))
		return Promise.all(configPaths.map(configPath => fs.readFile(configPath, 'utf8')))
	})
	.then(configStrs => {
		return new Promise((resolve, reject) => {
			pm2.connect(err => {
				if (err) return reject(err)
				resolve(configStrs)
			})
		})
	})
	.then(configStrs => Promise.all(configStrs.map((configStr, index) => {
		const configPath = configPaths[index]
		const config = JSON.parse(configStr)
		if (startFlag) return config

		const root = path.resolve(configPath, '..', resolveHome(config.root))
		const apps = config.apps.map(app => {
			const branch = app.branch || 'master'
			const configPathHash = crypto.createHash('sha1').update(configPath).digest('hex')
			app.env = Object.assign({
				epm_config_path: configPath,
				epm_server_port: config.port || 80
			}, app.env)
			return Object.assign({
				cwd: path.resolve(root, `${app.name}@${branch}`),
				script: 'npm',
				args: 'start',
				watch: true
			}, app, {
				name: `${app.name}-${branch}-${configPathHash}`
			})
		})

		return new Promise((resolve, reject) => {
			pm2.start({ apps }, err => {
				if (err) reject(err)
				resolve(config)
			})
		})
	})))
	.then(configs => {
		pm2.disconnect()
		return configs
	})
	.then(configs => Promise.all(configs.map((config, index) => {
		const configPath = configPaths[index]
		const root = path.resolve(configPath, '..', resolveHome(config.root))
		const port = config.port || 80

		const routes = {}
		config.apps.forEach(app => {
			if (app.domains && app.env && app.env.PORT) {
				app.domains.forEach(domain => {
					routes[domain] = app.env.PORT
				})
			}
		})
		http.createServer((req, res) => {
			const host = req.headers.host.split(':')[0]
			if (routes[host]) {
				proxy.web(req, res, {
					target: `http://127.0.0.1:${routes[host]}`,
					ws: true
				}, err => {
					console.log(err)
					res.end()
				})
			} else {
				const chunks = []
				const hookedApp = config.apps.find(app => {
					const re = new RegExp(`^/hooks/${app.name}/?([\?|#].*)?$`)
					return re.test(req.url)
				})
				if (hookedApp) {
					const branch = hookedApp.branch || 'master'
					const appPath = path.resolve(root, `${hookedApp.name}@${branch}`)
					req.on('data', chunk => chunks.push(chunk))
						.on('end', () => {
							const body = Buffer.concat(chunks).toString()
							const ghSignature = req.headers['x-hub-signature'].replace(/^sha1=/, '')
							const signature = crypto.createHmac('sha1', config.webhook.token).update(body).digest('hex')
							if (signature === ghSignature) {
								shell.exec(`cd ${appPath} && ${rootPrefix} git pull && ${rootPrefix} git checkout ${branch} && ${rootPrefix} npm install`)
							}
						})
				}
				res.end()
			}
		}).listen(port)
	})))
	.then(() => fs.writeFile(startFlagFile, '0', 'utf8'))