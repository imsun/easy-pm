const fs = require('fs-promise')
const tls = require('tls')
const http = require('http')
const spdy = require('spdy')
const express = require('express')
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

const LE = require('letsencrypt')
const leStore = require('le-store-certbot').create({
	configDir: path.resolve(homeDir, './letsencrypt/etc'),
	debug: false
})
const leChallenge = require('le-challenge-fs').create({
	webrootPath: path.resolve(homeDir, './letsencrypt/var/'),
	debug: false
})
function leAgree(opts, agreeCb) {
	agreeCb(null, opts.tosUrl)
}
const le = LE.create({
	server: LE.productionServerUrl,
	store: leStore,
	challenges: { 'http-01': leChallenge },
	challengeType: 'http-01',
	agreeToTerms: leAgree,
	debug: false
})

const setupScriptPath = path.resolve(__dirname, './setup.js')
const isRoot = process.getuid() === 0
let rootPrefix = ''
let startFlag = false
let configPaths = []

const servers = {}

process.on('message', function(packet) {
	const msg = packet.data.msg
	const command = msg.command
	let res = {}
	switch (command) {
		case 'stop':
			stop(msg.data)
			break
	}
	process.send({
		type : 'process:msg',
		data : {
			res,
			id: packet.data.id,
		}
	})
})

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
				epm_server_port: config.port || 80,
				PORT: app.port
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
	.then(configs => Promise.all(configs.map((config, index) => createServer(configPaths[index], config))))
	.then(() => fs.writeFile(startFlagFile, '0', 'utf8'))

function stop(configPaths) {
	configPaths.forEach(configPath => {
		if (servers[configPath]) {
			servers[configPath].forEach(server => server.close())
		}
	})
}

function createServer(configPath, config) {
	const root = path.resolve(configPath, '..', resolveHome(config.root))
	const port = config.port || 80
	const ssl = config.ssl

	const routes = {}
	config.apps.forEach(app => {
		const port = app.env && app.env.PORT || app.port
		if (app.domains && port) {
			app.domains.forEach(domain => {
				routes[domain] = port
			})
		}
	})

	const serverHandler = express()
	serverHandler.use('/', le.middleware())
	serverHandler.all('*', (req, res) => {
		const host = req.headers.host.split(':')[0]
		if (ssl
			&& ssl.sites
			&& !ssl.disable_redirect
			&& ssl.sites[host]
			&& !ssl.sites[host].disable_redirect
			&& req.protocol !== 'https') {
			const port = ssl.port || 443
			res.redirect(`https://${host}:${port}${req.url}`)
			return
		}
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
			if (hookedApp && req.headers['x-hub-signature']) {
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
	})
	const server = http.createServer(serverHandler).listen(port)
	servers[configPath] = servers[configPath] || []
	servers[configPath].push(server)

	if (ssl) {
		const port = ssl.port || 443
		const secureContext = {}
		const acmeDomains = []
		if (ssl.sites) {
			Object.keys(ssl.sites).forEach(domain => {
				const site = ssl.sites[domain]
				if (site === 'auto') {
					acmeDomains.push(domain)
				} else {
					const context = {}
					;['key', 'cert', 'ca'].forEach(key => {
						if (site[key]) {
							context[key] = fs.readFileSync(path.resolve(configPath, '..', resolveHome(site[key])), 'utf8')
						}
					})
					secureContext[domain] = tls.createSecureContext(context)
				}
			})
		}
		const options = {
			SNICallback(domain, callback) {
				if (secureContext[domain]) {
					if (callback) {
						callback(null, secureContext[domain])
					} else {
						return secureContext[domain]
					}
				} else {
					throw new Error(`https not supported for ${domain}`)
				}
			}
		}
		if (acmeDomains.length <= 0) {
			spdy.createServer(options, serverHandler).listen(port)
			return
		}

		return Promise.all(acmeDomains.map(domain => le.check({ domains: [domain] })))
			.then(results => {
				if (results.reduce((prev, current) => prev && current, true)) {
					return results
				}
				return Promise.all(acmeDomains.map(domain => le.register({
					domains: [domain],
					email: ssl.email || 'me@imsun.net',
					agreeTos: true,
					rsaKeySize: ssl.rsaKeySize || 2048,
					challengeType: 'http-01'
				})))
			})
			.then(results => {
				acmeDomains.forEach((domain, index) => {
					secureContext[domain] = tls.createSecureContext({
						key: results[index].privkey,
						cert: results[index].cert
					})
				})
				const server = spdy.createServer(options, serverHandler).listen(port)
				servers[configPath].push(server)
			})
	}
}