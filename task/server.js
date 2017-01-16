const fs = require('fs-promise')
const tls = require('tls')
const http = require('http')
const spdy = require('spdy')
const express = require('express')
const compression = require('compression')
const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const pm2 = require('pm2')
const proxy = require('http-proxy').createProxyServer({})
const username = require('username')

const manager = require('../lib/manager')
const { resolveHome, getAppDir } = require('../lib/utils')
const { homeDir, configsFile, startFlagFile } = require('../lib/paths')

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

const isRoot = process.getuid() === 0
let rootPrefix = ''
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
			id: packet.data.id
		}
	})
})

username()
	.then(name => {
		rootPrefix = isRoot ? `sudo -u ${name}` : ''
		return fs.readFile(startFlagFile, 'utf8')
	})
	.then(flag => {
		if (flag === '1') {
			return fs.readFile(configsFile, 'utf8')
				.then(configsStr => configsStr.split('\n').filter(s => !/^\s*$/.test(s)))
		} else {
			return manager.setup()
				.then(() => manager.deleteAll())
				.then(() => manager.startAll())
		}
	})
	.then(_configPaths => {
		configPaths = _configPaths
		return Promise.all(configPaths.map(configPath => fs.readFile(configPath, 'utf8')))
	})
	.then(configStrs => Promise.all(configStrs.map((configStr, index) => createServer(configPaths[index], JSON.parse(configStr)))))
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

	const sites = {}
	manager.getAppsByConfig(configPath)
		.then(apps => {
			config.apps.forEach(app => {
				const runningApp = apps.find(_app => _app.pm2_env.epm_name === app.name)
				const port = runningApp && runningApp.pm2_env.PORT
					|| app.env && app.env.PORT
					|| app.port
				const gzip = app.gzip === undefined ? true : app.gzip
				if (app.domains && port) {
					app.domains.forEach(domain => {
						sites[domain] = sites[domain] || {}
						sites[domain].port = port
						sites[domain].gzip = gzip
					})
				}
			})
		})

	const serverHandler = express()
	serverHandler.use('/', le.middleware())
	serverHandler.use(compression({
		filter: (req, res) => {
			const host = req.headers.host.split(':')[0]
			if (req.headers['x-no-compression']
				|| config.gzip !== undefined && !config.gzip
				|| sites[host] && !sites[host].gzip
			) {
				return false
			}
			return compression.filter(req, res)
		}
	}))
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
		if (sites[host]) {
			proxy.web(req, res, {
				target: `http://127.0.0.1:${sites[host].port}`,
				ws: true
			}, err => {
				console.log(err)
				res.end()
			})
		} else {
			const chunks = []
			let listeningApps = []

			if (req.headers['x-hub-signature']) {
				req.on('data', chunk => chunks.push(chunk))
					.on('end', () => {
						const body = Buffer.concat(chunks).toString()
						const ghSignature = req.headers['x-hub-signature'].replace(/^sha1=/, '')
						const signature = crypto.createHmac('sha1', config.webhook.token).update(body).digest('hex')

						if (signature === ghSignature) {
							const pushInfo = JSON.parse(body)
							if (!pushInfo.ref) return

							const branch = pushInfo.ref.split('/').pop()
							const[, owner, repo] = req.url.match(/^\/hooks\/(.+?)\/(.+?)\/?([\?|#].*)?$/)
							const repoPath = path.resolve(root, `${owner}/${repo}`)
							shell.exec(`cd ${repoPath} && ${rootPrefix} git pull && ${rootPrefix} git checkout ${branch} && ${rootPrefix} git submodule update --init --recursive && ${rootPrefix} npm install`)
							listeningApps = config.apps.filter(app => {
								const [, appOwner, appRepo] = app.repository.match(/.+?([^\/|:]+?)\/([^\/]+?)\.git/)
								const appBranch = app.branch || 'master'
								return appOwner === owner && appRepo === repo && appBranch === branch
							})
						}
					})
			}
			res.end(JSON.stringify(listeningApps))
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